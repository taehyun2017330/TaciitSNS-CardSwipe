import json
import os
from typing import List

import httpx

from api_models import SwipeClarificationRequest, SwipeClarificationResponse


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
CLARIFICATION_MODEL = "gpt-4o-mini"
CLARIFICATION_TIMEOUT_SECONDS = 20.0


def _build_system_prompt() -> str:
    return (
        "You are an art-direction assistant guiding a user through preference learning. "
        "After each batch of swipes, you ask AT MOST ONE clarification question that "
        "would meaningfully improve the next batch. If no question would help, return "
        "an 'idle_insight' message that summarizes what you've learned without asking.\n\n"
        "Modes:\n"
        "- probe: ask the user to define an ambiguous term they used (e.g. 'when you say "
        "premium, what specifically?'). Use when reason text is vague.\n"
        "- clarify: separate two confounded preferences (e.g. 'is blue itself wrong, or "
        "is it the cold mood?'). Use when likes/dislikes contradict on adjacent features.\n"
        "- challenge: surface a contradiction with the user's earlier evidence and ask if "
        "the goal has shifted. Use only with high-confidence contradictions.\n"
        "- summarize: state your read of their taste and ask for confirmation. Use when "
        "you have stable signal across multiple swipes.\n"
        "- idle_insight: a non-question reflection. Use when no clarification would help.\n\n"
        "Each option in the options array should be a short, plausible answer the user "
        "could click. For idle_insight, return an empty options array. Keep the message "
        "to 1-2 sentences, conversational. Do not repeat any of the recent questions."
    )


def _build_user_message(request: SwipeClarificationRequest) -> str:
    sections: List[str] = []
    sections.append(f"Total swipes so far: {request.swipeCount}")
    sections.append(f"Batch complete: {request.batchComplete}")
    sections.append("")

    brand_lines = []
    if request.brandName.strip():
        brand_lines.append(f"Brand: {request.brandName.strip()}")
    if request.category.strip():
        brand_lines.append(f"Category: {request.category.strip()}")
    if request.goal.strip():
        brand_lines.append(f"Goal: {request.goal.strip()}")
    if brand_lines:
        sections.append("Brand context:")
        sections.extend(f"- {line}" for line in brand_lines)
        sections.append("")

    if request.summary.strip():
        sections.append(f"Current taste summary: {request.summary.strip()}")
        sections.append("")

    if request.leanInto:
        sections.append("Leaning into:")
        sections.extend(f"- {item}" for item in request.leanInto)
        sections.append("")

    if request.avoidFacets:
        sections.append("Avoiding:")
        sections.extend(f"- {item}" for item in request.avoidFacets)
        sections.append("")

    if request.testNext:
        sections.append("Open uncertainty:")
        sections.extend(f"- {item}" for item in request.testNext)
        sections.append("")

    if request.recentLikes:
        sections.append("Recent verbatim like reasons:")
        sections.extend(f'- "{item}"' for item in request.recentLikes)
        sections.append("")

    if request.recentDislikes:
        sections.append("Recent verbatim dislike reasons:")
        sections.extend(f'- "{item}"' for item in request.recentDislikes)
        sections.append("")

    if request.recentQuestions:
        sections.append("Recent questions you have already asked (do NOT repeat):")
        sections.extend(f'- "{item}"' for item in request.recentQuestions)
        sections.append("")

    sections.append(
        "Pick the single most useful next move. Bias toward 'idle_insight' if the user "
        "has fewer than 4 swipes or if no specific clarification would shift the next batch."
    )
    return "\n".join(sections)


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["probe", "clarify", "challenge", "summarize", "idle_insight"],
        },
        "message": {"type": "string"},
        "options": {"type": "array", "items": {"type": "string"}},
        "internalReason": {"type": "string"},
    },
    "required": ["mode", "message", "options", "internalReason"],
    "additionalProperties": False,
}


async def generate_clarification(
    request: SwipeClarificationRequest,
) -> SwipeClarificationResponse:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    payload = {
        "model": CLARIFICATION_MODEL,
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_message(request)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "clarification",
                "schema": _RESPONSE_SCHEMA,
                "strict": True,
            },
        },
        "temperature": 0.6,
    }

    async with httpx.AsyncClient(timeout=CLARIFICATION_TIMEOUT_SECONDS) as client:
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
            f"Clarification failed ({response.status_code}): {response.text[:600]}"
        )

    body = response.json()
    content = body["choices"][0]["message"]["content"]
    parsed = json.loads(content)

    return SwipeClarificationResponse(
        mode=parsed.get("mode", "idle_insight"),
        message=parsed.get("message", ""),
        options=parsed.get("options", []),
        internalReason=parsed.get("internalReason", ""),
    )
