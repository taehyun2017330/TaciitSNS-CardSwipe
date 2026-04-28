from __future__ import annotations

from typing import Any


def candidate_for_steering(
    candidate: dict[str, Any],
    analysis: dict[str, Any],
    batch_number: int,
) -> dict[str, Any]:
    plan = candidate["plan"]
    return {
        **plan,
        "id": plan.get("id", ""),
        "batchId": f"batch-{batch_number}",
        "imageId": candidate["imageId"],
        "imageUrl": candidate.get("imageUrl", ""),
        "generatedPrompt": candidate.get("revisedPrompt") or candidate.get("prompt", ""),
        "generationStatus": "generated",
        "intendedFeatures": analysis.get("features", {}),
        "imageSummary": analysis.get("imageSummary", ""),
        "suggestedRationales": analysis.get("rationaleSuggestions", []),
        "suggestedLikeRationales": analysis.get("likeRationaleSuggestions", []),
        "suggestedDislikeRationales": analysis.get("dislikeRationaleSuggestions", []),
        "caption": plan.get("prompt", ""),
        "tags": plan.get("targetAttributes", []),
        "visual": {
            "headline": analysis.get("imageSummary") or plan.get("hypothesis", "") or plan.get("strategy", ""),
            "subline": plan.get("hypothesis", ""),
            "label": plan.get("strategy", ""),
            "paletteClass": "",
            "compositionClass": "",
            "textureClass": "",
        },
    }


def candidate_for_generation(plan: dict[str, Any], plan_index: int, batch_number: int) -> dict[str, Any]:
    return {
        **plan,
        "id": plan.get("id", f"batch-{batch_number}-synth-{plan_index}"),
        "batchId": f"batch-{batch_number}",
        "imageId": f"batch-{batch_number}-image-{plan_index}",
        "intendedFeatures": {},
        "caption": plan.get("prompt", ""),
        "tags": plan.get("targetAttributes", []),
        "visual": {
            "headline": plan.get("hypothesis", ""),
            "subline": "",
            "label": plan.get("strategy", ""),
            "paletteClass": "",
            "compositionClass": "",
            "textureClass": "",
        },
    }
