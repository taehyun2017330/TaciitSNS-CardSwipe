#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from headless_runner.artifacts import slugify, utc_stamp
from headless_runner.config import REPO_ROOT, ExperimentConfig
from headless_runner.runner import run_experiment


def _read_records(run_dir: Path) -> list[dict[str, Any]]:
    path = run_dir / "records.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _best_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not records:
        return None
    return max(records, key=lambda item: float(item.get("targetFitScore", 0)))


def _best_satisfied_record(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    satisfied = [record for record in records if record.get("satisfied") is True]
    if not satisfied:
        return None
    return max(satisfied, key=lambda item: float(item.get("targetFitScore", 0)))


def _score_by_batch(records: list[dict[str, Any]]) -> list[str]:
    output = []
    for batch in sorted({record["batch"] for record in records}):
        batch_records = [record for record in records if record["batch"] == batch]
        best = max(float(record.get("targetFitScore", 0)) for record in batch_records)
        output.append(f"{batch}:{best:.2f}")
    return output


def _write_suite_summary(suite_dir: Path, rows: list[dict[str, Any]]) -> None:
    lines = [
        "# Target Steering Suite",
        "",
        "| Target | Best | Satisfied | Best Image | Batch Best Scores | Notes |",
        "| --- | ---: | --- | --- | --- | --- |",
    ]
    for row in rows:
        best = row.get("best") or {}
        satisfied = row.get("bestSatisfied") or {}
        image_path = best.get("imagePath", "")
        image_link = f"[{Path(image_path).name}]({row['runDir']}/{image_path})" if image_path else ""
        notes = str(best.get("progressNotes", "")).replace("|", "/")
        lines.append(
            f"| {row['targetName']} | {float(best.get('targetFitScore', 0)):.2f} "
            f"| {float(satisfied.get('targetFitScore', 0)):.2f} "
            f"| {image_link} | {', '.join(row.get('batchScores', []))} | {notes} |"
        )
    lines.append("")
    suite_dir.mkdir(parents=True, exist_ok=True)
    (suite_dir / "suite-summary.md").write_text("\n".join(lines), encoding="utf-8")
    (suite_dir / "suite-summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run TacitSNS steering experiments across target images.")
    parser.add_argument(
        "--input-dir",
        default=str(REPO_ROOT / "experiments" / "input images"),
        help="Directory containing target images.",
    )
    parser.add_argument("--glob", default="image *.*", help="Glob for target images inside input-dir.")
    parser.add_argument("--limit", type=int, default=0, help="Optional max target count.")
    parser.add_argument("--batches", type=int, default=12, help="Maximum batches per target.")
    parser.add_argument("--initial-batch-size", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--generation-concurrency", type=int, default=4)
    parser.add_argument("--analysis-batch-size", type=int, default=2)
    parser.add_argument("--target-score", type=float, default=0.9)
    parser.add_argument("--min-batches", type=int, default=2)
    parser.add_argument("--judge-model", default="gpt-4o")
    parser.add_argument("--target-onboarding-model", default="gpt-4o")
    parser.add_argument("--no-stop-at-target", action="store_true")
    parser.add_argument("--no-stream-logs", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    input_dir = Path(args.input_dir).expanduser()
    targets = sorted(path for path in input_dir.glob(args.glob) if path.is_file())
    if args.limit > 0:
        targets = targets[: args.limit]
    if not targets:
        raise SystemExit(f"No targets found in {input_dir} matching {args.glob!r}")

    suite_dir = REPO_ROOT / "experiments" / "suites" / f"{utc_stamp()}-target-suite"
    rows: list[dict[str, Any]] = []
    for index, target in enumerate(targets, start=1):
        target_name = target.stem.replace(" ", "-")
        print(f"\n=== Target {index}/{len(targets)}: {target.name} ===", flush=True)
        config = ExperimentConfig(
            runName=f"{target_name}-steering",
            outDir=str(suite_dir / "runs"),
            targetImage=str(target),
            autoOnboardingFromTarget=True,
            batches=args.batches,
            initialBatchSize=args.initial_batch_size,
            batchSize=args.batch_size,
            generationConcurrency=args.generation_concurrency,
            analysisBatchSize=args.analysis_batch_size,
            targetScore=args.target_score,
            minBatches=args.min_batches,
            judgeModel=args.judge_model,
            targetOnboardingModel=args.target_onboarding_model,
            stopAtTarget=not args.no_stop_at_target,
            streamLogs=not args.no_stream_logs,
            dryRun=args.dry_run,
        )
        run_dir = run_experiment(config)
        records = _read_records(run_dir)
        best = _best_record(records)
        best_satisfied = _best_satisfied_record(records)
        rows.append(
            {
                "targetName": target.name,
                "targetPath": str(target),
                "runDir": str(run_dir.relative_to(REPO_ROOT)),
                "best": best,
                "bestSatisfied": best_satisfied,
                "batchScores": _score_by_batch(records),
            }
        )
        _write_suite_summary(suite_dir, rows)
        if best:
            satisfied_text = (
                f", satisfied {float(best_satisfied.get('targetFitScore', 0)):.2f}"
                if best_satisfied else ", not satisfied"
            )
            print(
                f"Target {target.name} best score {float(best.get('targetFitScore', 0)):.2f} "
                f"at {best.get('imagePath')}{satisfied_text}",
                flush=True,
            )

    print(f"\nSuite artifacts written to: {suite_dir}", flush=True)


if __name__ == "__main__":
    main()
