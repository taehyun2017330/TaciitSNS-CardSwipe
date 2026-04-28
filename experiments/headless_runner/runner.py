from __future__ import annotations

import concurrent.futures
import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .api_client import ApiError, SwipeApiClient, load_env_file
from .artifacts import (
    append_jsonl,
    image_source_to_data_url,
    make_run_dir,
    save_image_source,
    without_large_images,
    write_json,
)
from .candidates import candidate_for_generation, candidate_for_steering
from .config import REPO_ROOT, ExperimentConfig, config_to_dict
from .judge import AiTargetJudge
from .logger import RunLogger
from .onboarding import generate_onboarding_from_target
from .reporting import write_report
from .steering_bridge import SteeringBridge


def _onboarding_dict(config: ExperimentConfig) -> dict[str, Any]:
    return asdict(config.onboarding)


def _write_dry_run(run_dir: Path, config: ExperimentConfig, logger: RunLogger) -> None:
    if not config.resumeRunDir:
        write_json(run_dir / "config.json", config_to_dict(config))
    write_json(
        run_dir / "dry-run.json",
        {
            "status": "ok",
            "message": "Dry run created the experiment folder without calling onboarding, generation, vision, or judge APIs.",
            "nextCommand": "Remove --dry-run to execute a full paid experiment.",
            "autoOnboardingSkipped": config.autoOnboardingFromTarget,
        },
    )
    (run_dir / "summary.md").write_text(
        "# Steering Experiment Dry Run\n\n"
        "The runner configuration loaded correctly. No API calls were made.\n",
        encoding="utf-8",
    )
    logger.log("Dry run finished without API calls", auto_onboarding_skipped=config.autoOnboardingFromTarget)


def _resolve_run_dir(path: str) -> Path:
    run_dir = Path(path).expanduser()
    if not run_dir.is_absolute():
        run_dir = REPO_ROOT / run_dir
    return run_dir


def _read_json_file(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _records_from_events(run_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    events_path = run_dir / "events.jsonl"
    if not events_path.exists():
        return records
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "candidate_reviewed":
            records.append(event)
    return records


def _last_completed_batch(run_dir: Path) -> int:
    completed = 0
    events_path = run_dir / "events.jsonl"
    if not events_path.exists():
        return completed
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "batch_finished":
            completed = max(completed, int(event.get("batch", 0)))
    return completed


def _best_liked_image_url(run_dir: Path, records: list[dict[str, Any]]) -> str:
    liked = [
        record for record in records
        if record.get("action") == "like" and record.get("imagePath")
    ]
    if not liked:
        return ""
    best = max(liked, key=lambda item: float(item.get("targetFitScore", 0)))
    return image_source_to_data_url(str(run_dir / best["imagePath"]))


def _apply_auto_onboarding(config: ExperimentConfig, target_understanding: dict[str, Any]) -> None:
    generated = target_understanding.get("onboarding", {})
    current = asdict(config.onboarding)
    for key in ("brandName", "category", "goal", "audience"):
        if key in generated and generated[key] is not None:
            current[key] = generated[key]
    config.onboarding.__dict__.update(current)
    if not config.targetBrief:
        config.targetBrief = target_understanding.get("targetBrief", "").strip()
    if config.runName == "steering-experiment":
        config.runName = target_understanding.get("runName", "target-image-steering") or "target-image-steering"


def _empty_analysis_result(plan_id: str) -> dict[str, Any]:
    return {
        "planId": plan_id,
        "features": {},
        "imageSummary": "",
        "rationaleSuggestions": [],
        "likeRationaleSuggestions": [],
        "dislikeRationaleSuggestions": [],
    }


def _analyze_generated_images(
    client: SwipeApiClient,
    generated: list[dict[str, Any]],
    run_dir: Path,
    batch_number: int,
    config: ExperimentConfig,
    logger: RunLogger,
) -> dict[str, dict[str, Any]]:
    analysis_by_plan: dict[str, dict[str, Any]] = {}
    chunk_size = max(1, config.analysisBatchSize)
    for start in range(0, len(generated), chunk_size):
        chunk = generated[start:start + chunk_size]
        request = [{"planId": item["plan"]["id"], "imageUrl": item["imageUrl"]} for item in chunk]
        chunk_id = f"{start // chunk_size + 1:02d}"
        try:
            response = client.analyze_images(request)
            write_json(
                run_dir / "api" / f"batch-{batch_number:02d}-analysis-{chunk_id}.json",
                without_large_images(response),
            )
            for item in response.get("results", []):
                if item.get("planId"):
                    analysis_by_plan[item["planId"]] = item
        except Exception as exc:
            error_payload = {
                "type": "analysis_failed",
                "batch": batch_number,
                "chunk": chunk_id,
                "planIds": [item["plan"]["id"] for item in chunk],
                "error": str(exc),
            }
            append_jsonl(run_dir / "events.jsonl", error_payload)
            write_json(run_dir / "api" / f"batch-{batch_number:02d}-analysis-{chunk_id}-error.json", error_payload)
            logger.log("Image analysis failed; continuing with fallback analysis", batch=batch_number, chunk=chunk_id, error=str(exc))
            for item in chunk:
                analysis_by_plan[item["plan"]["id"]] = _empty_analysis_result(item["plan"]["id"])

    return analysis_by_plan


def run_experiment(config: ExperimentConfig) -> Path:
    load_env_file(REPO_ROOT / "backend" / ".env")
    resume_run_dir = _resolve_run_dir(config.resumeRunDir) if config.resumeRunDir else None
    target_understanding: dict[str, Any] | None = None
    if config.autoOnboardingFromTarget and not config.dryRun and not resume_run_dir:
        if not config.targetImage:
            raise ApiError("--auto-onboarding-from-target requires --target-image.")
        print("Reading target image and generating onboarding text...", flush=True)
        target_understanding = generate_onboarding_from_target(
            config.targetImage,
            config.targetOnboardingModel,
        )
        _apply_auto_onboarding(config, target_understanding)

    if resume_run_dir:
        run_dir = resume_run_dir
        if not run_dir.exists():
            raise ApiError(f"Resume run directory does not exist: {run_dir}")
    else:
        run_dir = make_run_dir(config.outDir, config.runName, REPO_ROOT)
    logger = RunLogger(run_dir, stream=config.streamLogs, append=bool(resume_run_dir))
    if resume_run_dir:
        logger.log("Resuming experiment run", path=run_dir)
        append_jsonl(run_dir / "events.jsonl", {"type": "run_resumed", "path": str(run_dir)})
    else:
        logger.log("Experiment run created", path=run_dir)
        write_json(run_dir / "config.json", config_to_dict(config))
    if target_understanding:
        write_json(run_dir / "target-understanding.json", target_understanding)
        logger.log(
            "Auto onboarding generated from target image",
            brand=config.onboarding.brandName,
            category=config.onboarding.category,
        )

    if config.dryRun:
        _write_dry_run(run_dir, config, logger)
        return run_dir

    if not config.targetImage and not config.targetBrief:
        raise ApiError("Provide --target-image, --target-brief, or both.")

    target_image_url = image_source_to_data_url(config.targetImage) if config.targetImage else ""
    if config.targetImage and not resume_run_dir:
        target_path = save_image_source(config.targetImage, run_dir / "target")
        append_jsonl(run_dir / "events.jsonl", {"type": "target_saved", "path": str(target_path)})
        logger.log("Target image saved", path=target_path.relative_to(run_dir))

    client = SwipeApiClient(config.apiBase)
    judge = AiTargetJudge(config.judgeModel, config.targetBrief, target_image_url)
    onboarding = _onboarding_dict(config)
    records: list[dict[str, Any]] = _records_from_events(run_dir) if resume_run_dir else []
    best_liked_image_url = _best_liked_image_url(run_dir, records) if resume_run_dir else ""
    best_score = max((float(record.get("targetFitScore", 0)) for record in records), default=0.0)
    best_satisfied_score = max(
        (
            float(record.get("targetFitScore", 0))
            for record in records
            if record.get("satisfied") is True
        ),
        default=0.0,
    )

    logger.log("Checking backend health", api=config.apiBase)
    health = client.health()
    append_jsonl(run_dir / "events.jsonl", {"type": "health", "response": health})
    logger.log("Backend health check passed", configured=health.get("openaiConfigured"))

    with SteeringBridge(REPO_ROOT) as steering:
        if resume_run_dir:
            preference_state = _read_json_file(run_dir / "preference-state.json", {})
            feedback_events = _read_json_file(run_dir / "feedback-events.json", [])
            start_batch = _last_completed_batch(run_dir) + 1
            if not preference_state or not isinstance(feedback_events, list):
                raise ApiError(f"Cannot resume without preference-state.json and feedback-events.json in {run_dir}")
            logger.log(
                "Steering bridge resumed",
                source="frontend/src/preference",
                next_batch=start_batch,
                existing_records=len(records),
                best_score=f"{best_score:.3f}",
            )
        else:
            initial = steering.initial_state(onboarding)
            preference_state = initial["state"]
            feedback_events = initial["feedbackEvents"]
            start_batch = 1
            append_jsonl(
                run_dir / "events.jsonl",
                {
                    "type": "steering_bridge_started",
                    "sourceOfTruth": "frontend/src/preference",
                    "summary": preference_state.get("summary", ""),
                },
            )
            logger.log("Steering bridge started", source="frontend/src/preference")

        for batch_number in range(start_batch, config.batches + 1):
            batch_started = time.time()
            batch_size = config.initialBatchSize if batch_number == 1 else config.batchSize
            phase = "initial diversity" if batch_number == 1 else "preference steering"
            logger.log(
                "Synthesizing prompt plans",
                batch=batch_number,
                count=batch_size,
                phase=phase,
                memory=preference_state.get("summary", "No preferences yet."),
            )
            synthesis_payload = steering.synthesis_payload(
                onboarding,
                preference_state,
                feedback_events,
                batch_number,
                batch_size,
            )
            synthesis = client.synthesize_payload(synthesis_payload)
            write_json(run_dir / "api" / f"batch-{batch_number:02d}-synthesis-payload.json", synthesis_payload)
            write_json(run_dir / "api" / f"batch-{batch_number:02d}-synthesis.json", synthesis)
            plans = synthesis.get("plans", [])[:batch_size]
            logger.log("Prompt plans ready", batch=batch_number, plans=len(plans))
            append_jsonl(
                run_dir / "events.jsonl",
                {
                    "type": "batch_synthesized",
                    "batch": batch_number,
                    "planCount": len(plans),
                    "preferenceSummary": preference_state.get("summary", ""),
                    "generationGuidance": preference_state.get("currentGenerationGuidance", {}),
                },
            )

            generated: list[dict[str, Any]] = []
            logger.log(
                "Generating images",
                batch=batch_number,
                plans=len(plans),
                concurrency=config.generationConcurrency,
            )
            with concurrent.futures.ThreadPoolExecutor(max_workers=config.generationConcurrency) as executor:
                future_map = {}
                for plan_index, plan in enumerate(plans):
                    generation_candidate = candidate_for_generation(plan, plan_index, batch_number)
                    image_payload = steering.image_generation_payload(
                        onboarding,
                        [generation_candidate],
                        best_liked_image_url,
                        batch_number,
                    )
                    future = executor.submit(client.generate_payload, image_payload)
                    future_map[future] = (plan, plan_index, image_payload)
                for future in concurrent.futures.as_completed(future_map):
                    plan, plan_index, image_payload = future_map[future]
                    try:
                        response = future.result()
                        write_json(
                            run_dir / "api" / f"batch-{batch_number:02d}-{plan['id']}-generation-payload.json",
                            without_large_images(image_payload),
                        )
                        write_json(
                            run_dir / "api" / f"batch-{batch_number:02d}-{plan['id']}-generation.json",
                            without_large_images(response),
                        )
                        image = (response.get("images") or [{}])[0]
                        if not image.get("imageUrl"):
                            raise ApiError("; ".join(response.get("errors", [])) or f"No image for {plan['id']}")
                        image_path = save_image_source(
                            image["imageUrl"],
                            run_dir / "images" / f"batch-{batch_number:02d}-{plan['id']}",
                        )
                        generated.append(
                            {
                                "imageId": f"batch-{batch_number}-image-{plan_index}",
                                "planIndex": plan_index,
                                "plan": plan,
                                "imageUrl": image["imageUrl"],
                                "imagePath": str(image_path.relative_to(run_dir)),
                                "model": image.get("model", response.get("model", "")),
                                "prompt": image.get("prompt", ""),
                                "revisedPrompt": image.get("revisedPrompt", ""),
                            }
                        )
                        logger.log(
                            "Image generated",
                            batch=batch_number,
                            plan=plan.get("id"),
                            saved=image_path.relative_to(run_dir),
                        )
                    except Exception as exc:
                        append_jsonl(
                            run_dir / "events.jsonl",
                            {
                                "type": "generation_failed",
                                "batch": batch_number,
                                "planId": plan.get("id"),
                                "error": str(exc),
                            },
                        )
                        logger.log("Image generation failed", batch=batch_number, plan=plan.get("id"), error=str(exc))

            generated.sort(key=lambda item: item["planIndex"])
            logger.log("Analyzing generated images", batch=batch_number, images=len(generated), chunk_size=config.analysisBatchSize)
            analysis_by_plan = _analyze_generated_images(
                client,
                generated,
                run_dir,
                batch_number,
                config,
                logger,
            )
            logger.log("Image analysis ready", batch=batch_number, analyzed=len(analysis_by_plan))

            for candidate in generated:
                analysis = analysis_by_plan.get(candidate["plan"]["id"], {})
                rationale_candidate = {
                    "suggestedRationales": analysis.get("rationaleSuggestions", []),
                    "suggestedLikeRationales": analysis.get("likeRationaleSuggestions", []),
                    "suggestedDislikeRationales": analysis.get("dislikeRationaleSuggestions", []),
                }
                like_reasons = steering.rationale_options("like", rationale_candidate)
                dislike_reasons = steering.rationale_options("dislike", rationale_candidate)
                decision = judge.decide(candidate, analysis, like_reasons, dislike_reasons, preference_state.get("summary", ""))
                steering_candidate = candidate_for_steering(candidate, analysis, batch_number)
                bridge_update = steering.apply_feedback(
                    preference_state,
                    feedback_events,
                    steering_candidate,
                    decision["action"],
                    decision.get("specificReason", ""),
                    decision.get("selectedReasons", []),
                    batch_number,
                    f"feedback-{batch_number}-{candidate['imageId']}",
                )
                preference_state = bridge_update["state"]
                feedback_events = bridge_update["feedbackEvents"]

                score = float(decision.get("targetFitScore", 0))
                is_satisfied = (
                    decision.get("satisfied") is True
                    and decision["action"] == "like"
                    and score >= config.targetScore
                )
                if decision["action"] == "like" and score >= best_score:
                    best_liked_image_url = candidate["imageUrl"]
                best_score = max(best_score, score)
                if is_satisfied:
                    best_satisfied_score = max(best_satisfied_score, score)
                record = {
                    "type": "candidate_reviewed",
                    "batch": batch_number,
                    "imageId": candidate["imageId"],
                    "planId": candidate["plan"]["id"],
                    "strategy": candidate["plan"].get("strategy", ""),
                    "imagePath": candidate["imagePath"],
                    "imageSummary": analysis.get("imageSummary", ""),
                    "likeReasons": like_reasons,
                    "dislikeReasons": dislike_reasons,
                    "feedbackEvent": bridge_update["feedback"],
                    "preferenceSummaryAfter": preference_state.get("summary", ""),
                    **decision,
                }
                records.append(record)
                append_jsonl(run_dir / "events.jsonl", record)
                logger.log(
                    "Candidate reviewed",
                    batch=batch_number,
                    image=candidate["imageId"],
                    action=decision["action"],
                    score=f"{score:.3f}",
                    satisfied=is_satisfied,
                    reasons=len(decision.get("selectedReasons", [])),
                )

            write_json(run_dir / "preference-state.json", preference_state)
            write_json(run_dir / "feedback-events.json", feedback_events)
            elapsed = round(time.time() - batch_started, 2)
            append_jsonl(
                run_dir / "events.jsonl",
                {
                    "type": "batch_finished",
                    "batch": batch_number,
                    "seconds": elapsed,
                    "bestScoreSoFar": round(best_score, 3),
                    "bestSatisfiedScoreSoFar": round(best_satisfied_score, 3),
                    "preferenceSummary": preference_state.get("summary", ""),
                },
            )
            logger.log(
                "Batch finished",
                batch=batch_number,
                seconds=elapsed,
                best_score=f"{best_score:.3f}",
                best_satisfied=f"{best_satisfied_score:.3f}",
                memory=preference_state.get("summary", "No preferences yet."),
            )
            if best_satisfied_score >= config.targetScore:
                append_jsonl(
                    run_dir / "events.jsonl",
                    {
                        "type": "target_satisfied",
                        "batch": batch_number,
                        "bestSatisfiedScore": round(best_satisfied_score, 3),
                    },
                )
                if config.stopAtTarget and batch_number >= config.minBatches:
                    logger.log(
                        "Target satisfied",
                        batch=batch_number,
                        best_satisfied=f"{best_satisfied_score:.3f}",
                    )
                    break
                logger.log(
                    "Target satisfied, continuing",
                    batch=batch_number,
                    best_satisfied=f"{best_satisfied_score:.3f}",
                    min_batches=config.minBatches,
                    stop_at_target=config.stopAtTarget,
                )

    write_report(run_dir, config, records, preference_state)
    write_json(run_dir / "records.json", records)
    logger.log("Report written", summary=run_dir / "summary.md", records=len(records))
    return run_dir
