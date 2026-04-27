import asyncio
from typing import Tuple

import httpx

from api_models import (
    SwipeGeneratedImage,
    SwipeImageGenerationRequest,
    SwipeImagePlanRequest,
)


GEMINI_IMAGE_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    "models/gemini-2.5-flash-image:generateContent"
)
GEMINI_MODEL_LABEL = "gemini-2.5-flash-image"
MAX_IMAGE_ATTEMPTS = 3
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


def _extract_inline_image(body: dict) -> str:
    """Walk the Gemini response shape to find the first inlineData base64 image."""
    candidates = body.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        parts = content.get("parts") or []
        for part in parts:
            inline = part.get("inlineData") or part.get("inline_data") or {}
            data = inline.get("data")
            if data:
                mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
                return f"data:{mime};base64,{data}"
    return ""


async def generate_one_gemini_image(
    client: httpx.AsyncClient,
    api_key: str,
    request: SwipeImageGenerationRequest,
    plan: SwipeImagePlanRequest,
    prompt: str,
) -> Tuple[SwipeGeneratedImage | None, str | None]:
    payload = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "responseModalities": ["IMAGE"]
        },
    }

    last_error = ""
    for attempt in range(1, MAX_IMAGE_ATTEMPTS + 1):
        try:
            response = await client.post(
                GEMINI_IMAGE_URL,
                params={"key": api_key},
                json=payload,
                timeout=60.0,
            )

            if response.status_code != 200:
                detail = response.text[:600]
                last_error = (
                    f"Gemini image generation failed for plan {plan.id} "
                    f"({response.status_code}): {detail}"
                )
                if response.status_code in RETRYABLE_STATUS_CODES and attempt < MAX_IMAGE_ATTEMPTS:
                    await asyncio.sleep(1.5 * attempt)
                    continue
                return None, last_error

            body = response.json()
            image_url = _extract_inline_image(body)
            if not image_url:
                return None, f"No image data returned for plan {plan.id} (Gemini)."

            return (
                SwipeGeneratedImage(
                    planId=plan.id,
                    imageUrl=image_url,
                    model=GEMINI_MODEL_LABEL,
                    size=request.size,
                    quality=request.quality,
                    prompt=prompt,
                    revisedPrompt="",
                ),
                None,
            )
        except httpx.HTTPError as exc:
            last_error = f"Gemini image generation failed for plan {plan.id}: {exc}"
            if attempt == MAX_IMAGE_ATTEMPTS:
                return None, last_error
        except Exception as exc:
            return None, f"Gemini image generation failed for plan {plan.id}: {exc}"

        await asyncio.sleep(1.5 * attempt)

    return None, last_error or f"Gemini image generation failed for plan {plan.id}."
