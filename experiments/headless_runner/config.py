from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class OnboardingConfig:
    brandName: str = "Harbor & Thread"
    category: str = "Fashion retail"
    goal: str = "Create social posts for a seasonal sale without making the brand feel cheap."
    audience: str = "Style-conscious local shoppers who care about quality."
    tone: list[str] = field(default_factory=list)
    avoid: str = ""


@dataclass
class ExperimentConfig:
    runName: str = "steering-experiment"
    apiBase: str = "http://127.0.0.1:8001"
    outDir: str = "experiments/runs"
    resumeRunDir: str = ""
    targetImage: str = ""
    targetBrief: str = ""
    autoOnboardingFromTarget: bool = False
    onboarding: OnboardingConfig = field(default_factory=OnboardingConfig)
    batches: int = 12
    initialBatchSize: int = 8
    batchSize: int = 8
    generationConcurrency: int = 4
    analysisBatchSize: int = 2
    targetScore: float = 0.9
    minBatches: int = 2
    stopAtTarget: bool = True
    judgeModel: str = "gpt-4o"
    targetOnboardingModel: str = "gpt-4o"
    streamLogs: bool = True
    dryRun: bool = False


def _read_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _list_from_tone(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def _merge_onboarding(base: OnboardingConfig, data: dict[str, Any]) -> OnboardingConfig:
    merged = asdict(base)
    for key in merged:
        if key in data and data[key] is not None:
            merged[key] = data[key]
    merged["tone"] = _list_from_tone(merged.get("tone"))
    return OnboardingConfig(**merged)


def load_config(args: argparse.Namespace) -> ExperimentConfig:
    raw = _read_json(args.config)
    onboarding = _merge_onboarding(OnboardingConfig(), raw.get("onboarding", {}))
    config_data = {
        "runName": raw.get("runName", "steering-experiment"),
        "apiBase": raw.get("apiBase", "http://127.0.0.1:8001"),
        "outDir": raw.get("outDir", "experiments/runs"),
        "resumeRunDir": raw.get("resumeRunDir", ""),
        "targetImage": raw.get("targetImage", ""),
        "targetBrief": raw.get("targetBrief", ""),
        "autoOnboardingFromTarget": bool(raw.get("autoOnboardingFromTarget", False)),
        "onboarding": onboarding,
        "batches": int(raw.get("batches", 12)),
        "initialBatchSize": int(raw.get("initialBatchSize", raw.get("batchSize", 8))),
        "batchSize": int(raw.get("batchSize", 8)),
        "generationConcurrency": int(raw.get("generationConcurrency", 4)),
        "analysisBatchSize": int(raw.get("analysisBatchSize", 2)),
        "targetScore": float(raw.get("targetScore", 0.9)),
        "minBatches": int(raw.get("minBatches", 2)),
        "stopAtTarget": bool(raw.get("stopAtTarget", True)),
        "judgeModel": raw.get("judgeModel", "gpt-4o"),
        "targetOnboardingModel": raw.get("targetOnboardingModel", raw.get("judgeModel", "gpt-4o")),
        "streamLogs": bool(raw.get("streamLogs", True)),
        "dryRun": bool(raw.get("dryRun", False)),
    }

    cli_overrides = {
        "runName": args.run_name,
        "apiBase": args.api_base,
        "outDir": args.out_dir,
        "resumeRunDir": args.resume_run_dir,
        "targetImage": args.target_image,
        "targetBrief": args.target_brief,
        "batches": args.batches,
        "initialBatchSize": args.initial_batch_size,
        "batchSize": args.batch_size,
        "generationConcurrency": args.generation_concurrency,
        "analysisBatchSize": args.analysis_batch_size,
        "targetScore": args.target_score,
        "minBatches": args.min_batches,
        "judgeModel": args.judge_model,
        "targetOnboardingModel": args.target_onboarding_model,
    }
    for key, value in cli_overrides.items():
        if value is not None:
            config_data[key] = value

    onboarding_overrides = {
        "brandName": args.brand_name,
        "category": args.category,
        "goal": args.goal,
        "audience": args.audience,
        "tone": args.tone,
        "avoid": args.avoid,
    }
    config_data["onboarding"] = _merge_onboarding(
        config_data["onboarding"],
        {key: value for key, value in onboarding_overrides.items() if value is not None},
    )

    if args.dry_run:
        config_data["dryRun"] = True
    if args.auto_onboarding_from_target:
        config_data["autoOnboardingFromTarget"] = True
    if args.no_stream_logs:
        config_data["streamLogs"] = False
    if args.no_stop_at_target:
        config_data["stopAtTarget"] = False

    return ExperimentConfig(**config_data)


def config_to_dict(config: ExperimentConfig) -> dict[str, Any]:
    data = asdict(config)
    onboarding = asdict(config.onboarding)
    public_onboarding = {
        "brandName": onboarding["brandName"],
        "category": onboarding["category"],
        "goal": onboarding["goal"],
        "audience": onboarding["audience"],
    }
    if onboarding["tone"]:
        public_onboarding["tone"] = onboarding["tone"]
    if onboarding["avoid"]:
        public_onboarding["avoid"] = onboarding["avoid"]
    data["onboarding"] = public_onboarding
    return data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a headless TacitSNS swipe-steering experiment."
    )
    parser.add_argument("--config", help="Path to an experiment JSON config.")
    parser.add_argument("--run-name", dest="run_name")
    parser.add_argument("--api-base", dest="api_base")
    parser.add_argument("--out-dir", dest="out_dir")
    parser.add_argument("--resume-run-dir", dest="resume_run_dir", help="Resume an existing run directory from its latest completed batch.")
    parser.add_argument("--target-image", dest="target_image")
    parser.add_argument("--target-brief", dest="target_brief")
    parser.add_argument(
        "--auto-onboarding-from-target",
        dest="auto_onboarding_from_target",
        action="store_true",
        help="Use the target image to generate normal-user onboarding text before the run.",
    )
    parser.add_argument("--brand-name", dest="brand_name")
    parser.add_argument("--category")
    parser.add_argument("--goal")
    parser.add_argument("--audience")
    parser.add_argument("--tone", help=argparse.SUPPRESS)
    parser.add_argument("--avoid", help=argparse.SUPPRESS)
    parser.add_argument("--batches", type=int, help="Maximum batches to run before giving up.")
    parser.add_argument("--initial-batch-size", dest="initial_batch_size", type=int)
    parser.add_argument("--batch-size", dest="batch_size", type=int)
    parser.add_argument("--generation-concurrency", dest="generation_concurrency", type=int)
    parser.add_argument("--analysis-batch-size", dest="analysis_batch_size", type=int)
    parser.add_argument("--target-score", dest="target_score", type=float)
    parser.add_argument("--min-batches", dest="min_batches", type=int)
    parser.add_argument("--no-stop-at-target", dest="no_stop_at_target", action="store_true")
    parser.add_argument("--judge-model", dest="judge_model")
    parser.add_argument("--target-onboarding-model", dest="target_onboarding_model")
    parser.add_argument("--no-stream-logs", dest="no_stream_logs", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser
