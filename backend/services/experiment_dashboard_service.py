from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import quote


RUN_ID_PATTERN = re.compile(r"^(\d{8})-(\d{6})-")
IMAGE_NAME_PATTERN = re.compile(r"^batch-(\d+)-(.+)$")


def experiments_dir(project_root: Path) -> Path:
    return project_root / "experiments"


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _tail_text(path: Path, max_bytes: int = 8000) -> str:
    if not path.exists():
        return ""
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            handle.seek(max(0, size - max_bytes))
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _latest_mtime(run_dir: Path) -> float:
    candidates = [
        run_dir,
        run_dir / "run.log",
        run_dir / "records.json",
        run_dir / "summary.md",
        run_dir / "preference-state.json",
        run_dir / "feedback-events.json",
        run_dir / "target-understanding.json",
    ]
    candidates.extend((run_dir / "images").glob("*"))
    candidates.extend((run_dir / "api").glob("batch-*-synthesis*.json"))

    latest = 0.0
    for path in candidates:
        try:
            if path.exists():
                latest = max(latest, path.stat().st_mtime)
        except OSError:
            continue
    return latest


def _iso_from_timestamp(timestamp: float) -> str:
    if not timestamp:
        return ""
    return datetime.fromtimestamp(timestamp).isoformat()


def _started_at_from_run_id(run_id: str) -> str:
    match = RUN_ID_PATTERN.match(run_id)
    if not match:
        return ""
    try:
        return datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S").isoformat()
    except ValueError:
        return ""


def _asset_url_for_experiment_path(project_root: Path, value: str) -> str:
    if not value:
        return ""

    root = experiments_dir(project_root).resolve()
    raw = value.replace("\\", "/")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        if raw.startswith("experiments/"):
            path = project_root / raw
        else:
            path = root / raw

    try:
        rel = path.resolve().relative_to(root)
    except (OSError, ValueError):
        return ""

    return f"/experiment-assets/{quote(rel.as_posix(), safe='/-_.')}"


def _asset_url_for_run_image(run_id: str, image_path: str) -> str:
    if not image_path:
        return ""
    clean = image_path.replace("\\", "/").lstrip("/")
    if clean.startswith("experiments/runs/"):
        parts = clean.split("/", 3)
        clean = parts[3] if len(parts) == 4 else ""
    if clean.startswith(f"runs/{run_id}/"):
        clean = clean[len(f"runs/{run_id}/"):]
    return f"/experiment-assets/runs/{quote(run_id, safe='-_.')}/{quote(clean, safe='/-_.')}"


def _records_from_events(run_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    events_path = run_dir / "events.jsonl"
    if not events_path.exists():
        return records

    try:
        lines = events_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return records

    for line in lines:
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "candidate_reviewed":
            records.append(event)
    return records


def _read_reviewed_records(run_dir: Path) -> list[dict[str, Any]]:
    records = _read_json(run_dir / "records.json", [])
    if not isinstance(records, list) or not records:
        records = _records_from_events(run_dir)
    return [record for record in records if isinstance(record, dict)]


def _plan_index(value: str) -> int:
    match = re.search(r"-(\d+)$", value or "")
    return int(match.group(1)) if match else 999


def _record_sort_key(record: dict[str, Any]) -> tuple[int, int, str]:
    batch = int(record.get("batch") or 0)
    plan_id = str(record.get("planId") or record.get("imageId") or "")
    return batch, _plan_index(plan_id), plan_id


def _pending_image_records(run_dir: Path, reviewed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = {str(record.get("planId") or "") for record in reviewed}
    pending: list[dict[str, Any]] = []
    images_dir = run_dir / "images"
    if not images_dir.exists():
        return pending

    for image in sorted(images_dir.iterdir()):
        if not image.is_file():
            continue
        match = IMAGE_NAME_PATTERN.match(image.stem)
        if not match:
            continue
        batch_number = int(match.group(1))
        plan_id = match.group(2)
        if plan_id in seen:
            continue
        pending.append(
            {
                "type": "candidate_pending",
                "batch": batch_number,
                "imageId": "",
                "planId": plan_id,
                "strategy": "",
                "imagePath": f"images/{image.name}",
                "imageSummary": "",
                "action": "pending",
                "selectedReasons": [],
                "specificReason": "",
                "progressNotes": "Waiting for judge feedback.",
                "visibleProblems": [],
                "targetFitScore": None,
                "pending": True,
            }
        )
    return pending


def _score(record: dict[str, Any]) -> float:
    try:
        return float(record.get("targetFitScore") or 0)
    except (TypeError, ValueError):
        return 0.0


def _status_for_run(run_dir: Path) -> str:
    log_path = run_dir / "run.log"
    log_tail = _tail_text(log_path)
    if (run_dir / "summary.md").exists() or "Report written" in log_tail:
        return "finished"
    if "Traceback" in log_tail or "ApiError" in log_tail:
        return "failed"
    if log_path.exists():
        try:
            if time.time() - log_path.stat().st_mtime < 30 * 60:
                return "running"
        except OSError:
            pass
        return "stalled"
    return "draft"


def _latest_log_line(run_dir: Path) -> str:
    text = _tail_text(run_dir / "run.log")
    lines = [line for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def _load_steering_snapshots(run_dir: Path) -> dict[int, dict[str, Any]]:
    snapshots: dict[int, dict[str, Any]] = {}
    api_dir = run_dir / "api"
    if not api_dir.exists():
        return snapshots

    for payload_path in sorted(api_dir.glob("batch-*-synthesis-payload.json")):
        match = re.search(r"batch-(\d+)-synthesis-payload", payload_path.name)
        if not match:
            continue
        batch_number = int(match.group(1))
        payload = _read_json(payload_path, {})
        synthesis = _read_json(api_dir / f"batch-{batch_number:02d}-synthesis.json", {})
        plans = synthesis.get("plans", []) if isinstance(synthesis, dict) else []
        plan_map = {
            str(plan.get("id")): plan
            for plan in plans
            if isinstance(plan, dict) and plan.get("id")
        }
        if not isinstance(payload, dict):
            payload = {}
        snapshots[batch_number] = {
            "batchNumber": batch_number,
            "phase": "initial diversity" if batch_number == 1 else "preference steering",
            "preferenceSummary": payload.get("preferenceSummary", ""),
            "semanticBrief": payload.get("semanticBrief", ""),
            "leanInto": payload.get("leanInto", []),
            "avoidFacets": payload.get("avoidFacets", []),
            "testNext": payload.get("testNext", []),
            "strategyMix": payload.get("strategyMix", []),
            "plans": plans,
            "_plansById": plan_map,
        }
    return snapshots


def _public_snapshot(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    if not snapshot:
        return None
    return {key: value for key, value in snapshot.items() if not key.startswith("_")}


def _enrich_record(
    run_id: str,
    record: dict[str, Any],
    snapshots: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    batch_number = int(record.get("batch") or 0)
    plan_id = str(record.get("planId") or "")
    plan = snapshots.get(batch_number, {}).get("_plansById", {}).get(plan_id, {})
    feedback = record.get("feedbackEvent") if isinstance(record.get("feedbackEvent"), dict) else {}
    selected_reasons = record.get("selectedReasons")
    if not isinstance(selected_reasons, list):
        selected_reasons = feedback.get("reasonChips", []) if isinstance(feedback.get("reasonChips"), list) else []

    enriched = {
        **record,
        "imageUrl": _asset_url_for_run_image(run_id, str(record.get("imagePath") or "")),
        "action": record.get("action") or feedback.get("action") or "pending",
        "score": _score(record),
        "selectedReasons": selected_reasons,
        "specificReason": record.get("specificReason") or feedback.get("reasonText", ""),
        "createdAt": feedback.get("createdAt", ""),
        "planHypothesis": plan.get("hypothesis", ""),
        "planPrompt": plan.get("prompt", ""),
        "planNegativePrompt": plan.get("negativePrompt", ""),
        "planTargetAttributes": plan.get("targetAttributes", []),
        "strategy": record.get("strategy") or plan.get("strategy", ""),
    }
    return enriched


def _final_and_best_records(records: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str]:
    reviewed = [record for record in records if record.get("action") != "pending"]
    if not reviewed:
        return None, None, "none"

    best = max(reviewed, key=_score)
    satisfied = [record for record in reviewed if record.get("satisfied") is True]
    if satisfied:
        return sorted(satisfied, key=_record_sort_key)[-1], best, "satisfied"
    return best, best, "best"


def _run_summary(project_root: Path, run_dir: Path) -> dict[str, Any]:
    run_id = run_dir.name
    config = _read_json(run_dir / "config.json", {})
    target_understanding = _read_json(run_dir / "target-understanding.json", {})
    records = sorted(_read_reviewed_records(run_dir), key=_record_sort_key)
    final_record, best_record, final_kind = _final_and_best_records(records)
    latest_mtime = _latest_mtime(run_dir)
    target_image = ""
    if isinstance(config, dict):
        target_image = str(config.get("targetImage") or "")
    if not target_image and isinstance(target_understanding, dict):
        target_image = str(target_understanding.get("targetImage") or "")

    batches = sorted({int(record.get("batch") or 0) for record in records if record.get("batch")})
    satisfied_count = len([record for record in records if record.get("satisfied") is True])
    best_score = _score(best_record or {})
    return {
        "id": run_id,
        "runName": config.get("runName", run_id) if isinstance(config, dict) else run_id,
        "status": _status_for_run(run_dir),
        "startedAt": _started_at_from_run_id(run_id),
        "updatedAt": _iso_from_timestamp(latest_mtime),
        "targetImageUrl": _asset_url_for_experiment_path(project_root, target_image),
        "targetBrief": (
            target_understanding.get("targetBrief")
            if isinstance(target_understanding, dict) and target_understanding.get("targetBrief")
            else config.get("targetBrief", "") if isinstance(config, dict) else ""
        ),
        "recordCount": len(records),
        "batchCount": len(batches),
        "latestBatch": max(batches) if batches else 0,
        "targetScore": config.get("targetScore", None) if isinstance(config, dict) else None,
        "bestScore": best_score,
        "satisfiedCount": satisfied_count,
        "finalKind": final_kind,
        "finalImageUrl": _asset_url_for_run_image(run_id, str((final_record or {}).get("imagePath") or "")),
        "bestImageUrl": _asset_url_for_run_image(run_id, str((best_record or {}).get("imagePath") or "")),
        "latestLogLine": _latest_log_line(run_dir),
    }


def build_experiment_list(project_root: Path) -> dict[str, Any]:
    runs_dir = experiments_dir(project_root) / "runs"
    if not runs_dir.exists():
        return {"runs": [], "activeCount": 0, "updatedAt": datetime.utcnow().isoformat()}

    summaries = [
        _run_summary(project_root, run_dir)
        for run_dir in runs_dir.iterdir()
        if run_dir.is_dir() and not run_dir.name.startswith(".")
    ]
    summaries.sort(key=lambda item: item.get("startedAt") or item.get("id") or "", reverse=True)
    return {
        "runs": summaries,
        "activeCount": len([item for item in summaries if item.get("status") == "running"]),
        "updatedAt": datetime.utcnow().isoformat(),
    }


def build_experiment_detail(project_root: Path, run_id: str) -> dict[str, Any] | None:
    runs_dir = experiments_dir(project_root) / "runs"
    run_dir = (runs_dir / run_id).resolve()
    try:
        run_dir.relative_to(runs_dir.resolve())
    except (OSError, ValueError):
        return None
    if not run_dir.exists() or not run_dir.is_dir():
        return None

    config = _read_json(run_dir / "config.json", {})
    target_understanding = _read_json(run_dir / "target-understanding.json", {})
    preference_state = _read_json(run_dir / "preference-state.json", {})
    snapshots = _load_steering_snapshots(run_dir)
    reviewed = _read_reviewed_records(run_dir)
    records = sorted(reviewed + _pending_image_records(run_dir, reviewed), key=_record_sort_key)
    enriched_records = [_enrich_record(run_id, record, snapshots) for record in records]
    final_record, best_record, final_kind = _final_and_best_records(enriched_records)

    batch_numbers = sorted(
        {
            *(int(record.get("batch") or 0) for record in enriched_records if record.get("batch")),
            *snapshots.keys(),
        }
    )
    batches = []
    for batch_number in batch_numbers:
        batch_records = [record for record in enriched_records if int(record.get("batch") or 0) == batch_number]
        batches.append(
            {
                "batchNumber": batch_number,
                "steering": _public_snapshot(snapshots.get(batch_number)),
                "nextSteering": _public_snapshot(snapshots.get(batch_number + 1)),
                "records": batch_records,
            }
        )

    target_image = str(config.get("targetImage") or "") if isinstance(config, dict) else ""
    return {
        **_run_summary(project_root, run_dir),
        "config": config,
        "targetUnderstanding": target_understanding,
        "preferenceState": preference_state,
        "targetImageUrl": _asset_url_for_experiment_path(project_root, target_image),
        "records": enriched_records,
        "batches": batches,
        "finalRecord": final_record,
        "bestRecord": best_record,
        "finalKind": final_kind,
        "summaryMarkdown": (run_dir / "summary.md").read_text(encoding="utf-8") if (run_dir / "summary.md").exists() else "",
    }
