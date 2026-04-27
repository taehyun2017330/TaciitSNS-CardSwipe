import json
import os
from typing import List

import httpx

from api_models import (
    SwipePromptSynthesisRequest,
    SwipePromptSynthesisResponse,
    SynthesizedPlan,
)


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
SYNTHESIS_MODEL = "gpt-4o-mini"
SYNTHESIS_TIMEOUT_SECONDS = 30.0


def _build_system_prompt() -> str:
    return (
        "You are an art director steering an AI image-generation system for a small "
        "business. The user gives feedback by swiping on images. Each batch you produce "
        "must contain prompts that are intentionally varied so the user's swipes provide "
        "useful signal.\n\n"
        "For each plan, return:\n"
        "- strategy: one of 'exploit' (lean into known positives), 'repair' (steer away "
        "from recent dislikes), 'diagnostic' (test an uncertain preference), or 'explore' "
        "(introduce a new direction worth probing).\n"
        "- hypothesis: one sentence describing what this plan is testing or reinforcing.\n"
        "- prompt: a complete creative brief — subject, composition, palette, lighting, "
        "mood, typography. 2-4 sentences. Be specific and evocative. Do NOT include the "
        "brand name unless the user has indicated it should appear visually.\n"
        "- negativePrompt: a short comma-separated list of cues to avoid for this plan. "
        "Do not start with 'Avoid' — the system adds that framing.\n\n"
        "Diversity matters: never produce two plans with the same palette + setting + mood. "
        "Honor the user's stated 'lean into' and 'avoid' signals strongly. When recent "
        "verbatim feedback contradicts the prior preference state, treat the recent "
        "feedback as more current."
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

    sections.append(
        f"Produce exactly {request.count} prompts. Mix strategies — do not return "
        "four 'exploit' plans. If the user has dislikes, at least one should be 'repair'. "
        "If there is open uncertainty, at least one should be 'diagnostic'."
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
                        "enum": ["exploit", "explore", "diagnostic", "repair"],
                    },
                    "hypothesis": {"type": "string"},
                    "prompt": {"type": "string"},
                    "negativePrompt": {"type": "string"},
                },
                "required": ["strategy", "hypothesis", "prompt", "negativePrompt"],
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
            )
            for index, plan in enumerate(plans[: request.count])
        ]
    )
