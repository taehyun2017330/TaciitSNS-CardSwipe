import json
import os
from typing import List

import httpx

from api_models import (
    SwipePromptSynthesisRequest,
    SwipePromptSynthesisResponse,
    SynthesizedPlan,
)
from services.facet_catalog import load_facet_catalog


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
SYNTHESIS_MODEL = "gpt-4o-mini"
SYNTHESIS_TIMEOUT_SECONDS = 30.0
STRATEGIES = ["exploit", "repair", "diagnostic", "explore", "contrast", "near_neighbor", "boundary_test"]


def _build_system_prompt() -> str:
    return (
        "You are an art director steering an AI image-generation system for a small "
        "business. The user gives feedback by swiping on images. Each batch you produce "
        "must contain prompts that are intentionally varied so the user's swipes provide "
        "useful signal.\n\n"
        "For each plan, return:\n"
        "- strategy: one of 'exploit' (lean into known positives), 'repair' (steer away "
        "from recent dislikes), 'diagnostic' (test an uncertain preference), 'explore' "
        "(introduce a new direction worth probing), 'contrast' (deliberately different "
        "from neighboring plans to widen the search), 'near_neighbor' (small variation near "
        "a liked direction), or 'boundary_test' (test how far a preference extends).\n"
        "- hypothesis: one sentence describing what this plan is testing or reinforcing.\n"
        "- targetAttributes: 3-6 human-readable attributes this plan intentionally manipulates.\n"
        "- prompt: a complete creative brief — subject, composition, palette, lighting, "
        "mood, typography. 2-4 sentences. Be specific and evocative. Do NOT include the "
        "brand name unless the user has indicated it should appear visually.\n"
        "- negativePrompt: a short comma-separated list of cues to avoid for this plan. "
        "Do not start with 'Avoid' — the system adds that framing.\n\n"
        "Diversity matters in the first batch: never produce two first-batch plans with "
        "the same palette + setting + mood. "
        "In the first discovery batch, maximize stylistic distance across the whole slate: "
        "different camera distance, product staging, visual world, typography, texture, "
        "lighting, and palette. Do not converge before there is swipe evidence. "
        "Do not converge just because feedback exists. If the user disliked everything "
        "or there are only one or two likes, make a repair/search slate with clearly "
        "different hypotheses. In that state, vary subject, crop, setting, palette, "
        "typography, and graphic treatment across the batch so the next swipes can reveal "
        "which route is promising. Converge only after repeated likes point to the same "
        "visual family. When convergence is appropriate, most plans should share the learned "
        "subject, composition, palette family, layout logic, and graphic treatment while "
        "still keeping a couple of visible variations. "
        "When feedback asks for exact label or poster wording, preserve the label/text "
        "hierarchy and approximate content, but do not let every plan become text-heavy; "
        "image models may distort exact words, so keep the visual structure and product "
        "identity clear. "
        "Honor the user's stated 'lean into' and 'avoid' signals strongly. When recent "
        "verbatim feedback contradicts the prior preference state, treat the recent "
        "feedback as more current. If the memory contains phrases like 'needs', 'requires', "
        "'closer', 'more like', or 'missing', treat those as concrete positive target "
        "constraints that must appear in exploit and near_neighbor plans. Use the facet "
        "catalog as measurement language, not as a limit on possible creative directions."
    )


def _build_user_message(request: SwipePromptSynthesisRequest) -> str:
    sections: List[str] = []

    sections.append(f"Batch number: {request.batchNumber}")
    sections.append(f"Plans needed: {request.count}")
    sections.append("")

    brand_lines = []
    if request.brandName.strip():
        brand_lines.append(f"Brand: {request.brandName.strip()}")
    if request.category.strip():
        brand_lines.append(f"Category: {request.category.strip()}")
    if request.audience.strip():
        brand_lines.append(f"Audience: {request.audience.strip()}")
    if request.tone.strip():
        brand_lines.append(f"Tone: {request.tone.strip()}")
    if request.goal.strip():
        brand_lines.append(f"Goal: {request.goal.strip()}")
    if request.avoid.strip():
        brand_lines.append(f"User-stated avoid: {request.avoid.strip()}")
    if brand_lines:
        sections.append("Brand context:")
        sections.extend(f"- {line}" for line in brand_lines)
        sections.append("")

    if request.preferenceSummary.strip():
        sections.append("Preference memory summary:")
        sections.append(request.preferenceSummary.strip())
        sections.append("")

    if request.semanticBrief.strip():
        sections.append("Semantic style memory:")
        sections.append(request.semanticBrief.strip())
        sections.append("")

    semantic_memory = request.semanticMemory or {}
    liked_values = [
        str(item).strip()
        for item in semantic_memory.get("likedDirections", [])
        if str(item).strip()
    ]
    concrete_targets = [
        item
        for item in liked_values
        if any(token in item.lower() for token in ["need", "requires", "closer", "more like", "missing", "should"])
    ]
    if concrete_targets:
        sections.append("Concrete target constraints inferred from feedback:")
        sections.extend(f"- {item}" for item in concrete_targets[:6])
        sections.append(
            "Use these as must-have positive constraints in exploit and near_neighbor plans. "
            "Do not place them in negativePrompt unless explicitly phrased as something to avoid."
        )
        sections.append("")

    for key, label in [
        ("likedDirections", "Semantic liked directions"),
        ("dislikedDirections", "Semantic disliked directions"),
        ("hardAvoids", "Hard avoids"),
        ("uncertainties", "Open semantic uncertainties"),
    ]:
        values = [str(item) for item in semantic_memory.get(key, []) if str(item).strip()]
        if values:
            sections.append(f"{label}:")
            sections.extend(f"- {item}" for item in values[:8])
            sections.append("")

    if request.leanInto:
        sections.append("Currently leaning into (from prior swipes):")
        sections.extend(f"- {item}" for item in request.leanInto)
        sections.append("")

    if request.avoidFacets:
        sections.append("Currently avoiding (from prior swipes):")
        sections.extend(f"- {item}" for item in request.avoidFacets)
        sections.append("")

    if request.recentLikes:
        sections.append("Recent verbatim like reasons (most recent first):")
        sections.extend(f'- "{item}"' for item in request.recentLikes)
        sections.append("")

    if request.recentDislikes:
        sections.append("Recent verbatim dislike reasons (most recent first):")
        sections.extend(f'- "{item}"' for item in request.recentDislikes)
        sections.append("")

    if request.testNext:
        sections.append("Open uncertainty to probe:")
        sections.extend(f"- {item}" for item in request.testNext)
        sections.append("")

    if request.weightedFacets:
        sections.append("Highest-confidence scored facets:")
        for facet in request.weightedFacets[:16]:
            sections.append(
                "- {label} ({key}, {dimension}): weight {weight}, confidence {confidence}, "
                "alpha/beta {alpha}/{beta}, evidence {evidence}".format(
                    label=facet.get("label", ""),
                    key=facet.get("key", ""),
                    dimension=facet.get("dimension", ""),
                    weight=facet.get("weight", 0),
                    confidence=facet.get("confidence", 0),
                    alpha=facet.get("alpha", 1),
                    beta=facet.get("beta", 1),
                    evidence=facet.get("evidenceVolume", 0),
                )
            )
        sections.append("")

    if request.strategyMix:
        sections.append("Desired slate strategy mix in order:")
        sections.append(", ".join(request.strategyMix))
        sections.append("")

    if request.diversityBrief.strip():
        sections.append("Diversity and convergence rule:")
        sections.append(request.diversityBrief.strip())
        sections.append("")

    if request.diversityLanes:
        sections.append("Required lane for each plan index:")
        for index, lane in enumerate(request.diversityLanes[: request.count]):
            sections.append(f"- Plan {index}: {lane}")
        sections.append("")

    sections.append("Facet catalog dimensions available for targetAttributes:")
    catalog = load_facet_catalog()
    sections.extend(f"- {facet['key']}: {facet['label']}" for facet in catalog)
    sections.append("")

    sections.append(
        f"Produce exactly {request.count} prompts. Follow the desired slate strategy mix "
        "and required lanes when provided. If the mix conflicts with evidence, keep useful "
        "diversity but explain the stronger choice in the hypothesis. The first batch should "
        "feel like a broad taste survey. Later batches should follow the supplied diversity "
        "and convergence rule: if likes are absent or sparse, keep repair paths visibly "
        "different; if repeated likes establish a visual family, converge while preserving "
        "a couple of visible variations."
    )

    return "\n".join(sections)


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "plans": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "strategy": {
                        "type": "string",
                        "enum": STRATEGIES,
                    },
                    "hypothesis": {"type": "string"},
                    "targetAttributes": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "prompt": {"type": "string"},
                    "negativePrompt": {"type": "string"},
                },
                "required": ["strategy", "hypothesis", "targetAttributes", "prompt", "negativePrompt"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["plans"],
    "additionalProperties": False,
}


async def synthesize_prompts(
    request: SwipePromptSynthesisRequest,
) -> SwipePromptSynthesisResponse:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    payload = {
        "model": SYNTHESIS_MODEL,
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_message(request)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "prompt_plans",
                "schema": _RESPONSE_SCHEMA,
                "strict": True,
            },
        },
        "temperature": 0.85,
    }

    async with httpx.AsyncClient(timeout=SYNTHESIS_TIMEOUT_SECONDS) as client:
        response = await client.post(
            OPENAI_CHAT_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Prompt synthesis failed ({response.status_code}): {response.text[:600]}"
        )

    body = response.json()
    content = body["choices"][0]["message"]["content"]
    parsed = json.loads(content)

    plans = parsed.get("plans") or []
    batch_id = f"batch-{request.batchNumber}"

    return SwipePromptSynthesisResponse(
        plans=[
            SynthesizedPlan(
                id=f"{batch_id}-synth-{index}",
                strategy=plan.get("strategy", "explore"),
                hypothesis=plan.get("hypothesis", ""),
                prompt=plan.get("prompt", ""),
                negativePrompt=plan.get("negativePrompt", ""),
                targetAttributes=plan.get("targetAttributes", []),
            )
            for index, plan in enumerate(plans[: request.count])
        ]
    )
