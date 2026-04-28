from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import ExperimentConfig


def unique_items(items: list[str], limit: int = 9) -> list[str]:
    seen = set()
    output = []
    for item in items:
        cleaned = str(item).strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            output.append(cleaned)
        if len(output) >= limit:
            break
    return output


def summarize_problems(records: list[dict[str, Any]]) -> list[str]:
    problems: list[str] = []
    scores_by_batch: dict[int, list[float]] = {}
    for record in records:
        scores_by_batch.setdefault(record["batch"], []).append(record.get("targetFitScore", 0))
        problems.extend(record.get("visibleProblems", []))

    best_so_far = 0.0
    stagnant = 0
    for batch in sorted(scores_by_batch):
        batch_best = max(scores_by_batch[batch] or [0])
        if batch_best <= best_so_far + 0.025:
            stagnant += 1
        else:
            stagnant = 0
        best_so_far = max(best_so_far, batch_best)
    if stagnant >= 2:
        problems.append("No meaningful target-fit improvement across recent batches.")

    liked = [record for record in records if record.get("action") == "like"]
    satisfied = [record for record in records if record.get("satisfied") is True]
    if not liked:
        problems.append("The judge did not like any generated image; the search may be too far from the target.")
    if not satisfied:
        problems.append("The judge never marked a generated image as a satisfactory endpoint.")
    if records and len(liked) == len(records):
        problems.append("The judge liked every generated image; the simulated feedback may be too lenient to steer a narrow target.")

    unique_summaries = []
    for record in records:
        summary = record.get("imageSummary", "").lower().strip()
        if summary and summary not in unique_summaries:
            unique_summaries.append(summary)
    if records and len(unique_summaries) / len(records) < 0.45:
        problems.append("Image summaries were repetitive; visual diversity may be too low.")

    first_batch = [record for record in records if record.get("batch") == 1]
    first_batch_summaries = {
        record.get("imageSummary", "").lower().strip()
        for record in first_batch
        if record.get("imageSummary", "").strip()
    }
    if len(first_batch) >= 4 and len(first_batch_summaries) / len(first_batch) < 0.65:
        problems.append("The first exploration batch was not diverse enough for broad preference discovery.")

    if scores_by_batch and max(scores_by_batch) > 1:
        first_best = max(scores_by_batch.get(1, [0]) or [0])
        final_best = max(scores_by_batch[max(scores_by_batch)] or [0])
        if final_best <= first_best + 0.04:
            problems.append("Later batches did not clearly improve over the first exploration batch.")

    return unique_items(problems, limit=12)


def write_report(
    run_dir: Path,
    config: ExperimentConfig,
    records: list[dict[str, Any]],
    preference_state: dict[str, Any],
) -> None:
    best = max(records, key=lambda item: item.get("targetFitScore", 0), default=None)
    best_satisfied = max(
        (record for record in records if record.get("satisfied") is True),
        key=lambda item: item.get("targetFitScore", 0),
        default=None,
    )
    problems = summarize_problems(records)
    lines = [
        "# Headless Steering Experiment",
        "",
        f"Run: `{config.runName}`",
        f"Target score threshold: `{config.targetScore}`",
        f"Batches requested: `{config.batches}`",
        f"Initial batch size: `{config.initialBatchSize}`",
        f"Steering batch size: `{config.batchSize}`",
        f"Minimum batches before early stop: `{config.minBatches}`",
        f"Stop at target: `{config.stopAtTarget}`",
        "",
    ]
    if best:
        lines.extend([
            "## Best Candidate",
            "",
            f"- Score: `{best.get('targetFitScore', 0):.3f}`",
            f"- Action: `{best.get('action')}`",
            f"- Satisfied: `{best.get('satisfied', False)}`",
            f"- Image: [{best.get('imagePath')}]({best.get('imagePath')})",
            f"- Notes: {best.get('progressNotes', '')}",
            "",
        ])
    if best_satisfied and best_satisfied is not best:
        lines.extend([
            "## Best Satisfactory Endpoint",
            "",
            f"- Score: `{best_satisfied.get('targetFitScore', 0):.3f}`",
            f"- Image: [{best_satisfied.get('imagePath')}]({best_satisfied.get('imagePath')})",
            f"- Notes: {best_satisfied.get('progressNotes', '')}",
            "",
        ])

    lines.extend([
        "## Timeline",
        "",
        "| Batch | Image | Score | Action | Satisfied | Reasons | Notes |",
        "| --- | --- | ---: | --- | --- | --- | --- |",
    ])
    for record in records:
        reasons = "; ".join(record.get("selectedReasons", []))
        lines.append(
            f"| {record['batch']} | [{Path(record['imagePath']).name}]({record['imagePath']}) "
            f"| {record.get('targetFitScore', 0):.3f} | {record.get('action')} "
            f"| {record.get('satisfied', False)} "
            f"| {reasons} | {record.get('progressNotes', '').replace('|', '/')} |"
        )

    lines.extend(["", "## Final Preference State", "", preference_state.get("summary", "No preference summary."), ""])
    guidance = preference_state.get("currentGenerationGuidance", {})
    lines.extend([
        "- Lean into: " + (", ".join(guidance.get("leanInto", [])) or "none"),
        "- Avoid: " + (", ".join(guidance.get("avoid", [])) or "none"),
        "- Strategy mix: " + ", ".join(guidance.get("strategyMix", [])),
        "",
        "## Possible Problems",
        "",
    ])
    if problems:
        lines.extend(f"- {problem}" for problem in problems)
    else:
        lines.append("- No automatic problems detected.")
    lines.append("")
    (run_dir / "summary.md").write_text("\n".join(lines), encoding="utf-8")
