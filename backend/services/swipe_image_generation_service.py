import asyncio
import base64
import os
from typing import Dict, List, Optional, Tuple

import httpx

from api_models import (
    SwipeGeneratedImage,
    SwipeImageGenerationRequest,
    SwipeImageGenerationResponse,
    SwipeImagePlanRequest,
)
from services.gemini_image_generation_service import generate_one_gemini_image


OPENAI_IMAGE_GENERATION_URL = "https://api.openai.com/v1/images/generations"
OPENAI_IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits"
MAX_IMAGE_ATTEMPTS = 3
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
GEMINI_BATCH_LIMIT = 100  # Test config: use Gemini for everything. Reset to 3 to re-enable OpenAI for batch 4+.


def _decode_data_url(data_url: str) -> Optional[bytes]:
    if not data_url.startswith("data:"):
        return None
    try:
        _, b64 = data_url.split(",", 1)
        return base64.b64decode(b64)
    except Exception:
        return None


def _strip_avoid_prefix(text: str) -> str:
    cleaned = text.strip().rstrip(".")
    lowered = cleaned.lower()
    for prefix in ("avoid ", "avoiding "):
        if lowered.startswith(prefix):
            return cleaned[len(prefix):].strip()
    return cleaned


def _build_image_prompt(
    plan: SwipeImagePlanRequest,
    request: SwipeImageGenerationRequest,
) -> str:
    sections: list[str] = []

    opener = f"Square 1024x1024 social media marketing post for {request.brandName.strip()}." \
        if request.brandName.strip() else "Square 1024x1024 social media marketing post."
    sections.append(opener)

    descriptor_parts: list[str] = []
    if request.category.strip():
        descriptor_parts.append(f"a {request.category.strip()} brand")
    if request.audience.strip():
        descriptor_parts.append(f"speaking to {request.audience.strip()}")
    if descriptor_parts:
        sections.append("The brand is " + ", ".join(descriptor_parts) + ".")

    if request.goal.strip():
        sections.append(f"Campaign goal: {request.goal.strip()}.")
    if request.tone.strip():
        sections.append(f"Brand tone: {request.tone.strip()}.")

    sections.append("")
    sections.append(plan.prompt.strip())

    avoidance: list[str] = []
    if plan.negativePrompt.strip():
        avoidance.append(_strip_avoid_prefix(plan.negativePrompt))
    if request.avoid.strip():
        avoidance.append(_strip_avoid_prefix(request.avoid))
    if avoidance:
        sections.append("")
        sections.append("Avoid: " + "; ".join(part for part in avoidance if part) + ".")

    sections.append("")
    sections.append(
        "Deliver editorial, premium quality with strong visual hierarchy and a credible "
        "product/campaign feel. Any on-image text should be sparse, large, and legible. "
        "No watermarks, UI chrome, or placeholder labels."
    )

    return "\n".join(sections)


async def _call_openai_image_api(
    client: httpx.AsyncClient,
    api_key: str,
    request: SwipeImageGenerationRequest,
    plan: SwipeImagePlanRequest,
    prompt: str,
) -> httpx.Response:
    use_reference = plan.useReference and request.referenceImageUrl
    reference_bytes = _decode_data_url(request.referenceImageUrl) if use_reference else None

    if use_reference and reference_bytes:
        files = {"image": ("reference.png", reference_bytes, "image/png")}
        data = {
            "model": request.model,
            "prompt": prompt,
            "size": request.size,
            "quality": request.quality,
            "n": "1",
        }
        return await client.post(
            OPENAI_IMAGE_EDITS_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files=files,
        )

    payload: Dict[str, object] = {
        "model": request.model,
        "prompt": prompt,
        "size": request.size,
        "quality": request.quality,
        "n": 1,
    }
    return await client.post(
        OPENAI_IMAGE_GENERATION_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
    )


def _should_use_gemini(request: SwipeImageGenerationRequest, plan: SwipeImagePlanRequest) -> bool:
    if request.batchNumber > GEMINI_BATCH_LIMIT:
        return False
    # Reference-based gen needs OpenAI's /v1/images/edits — Gemini path skips reference.
    if plan.useReference and request.referenceImageUrl:
        return False
    return True


async def _generate_one_image(
    client: httpx.AsyncClient,
    openai_key: str,
    gemini_key: str,
    request: SwipeImageGenerationRequest,
    plan: SwipeImagePlanRequest,
) -> Tuple[SwipeGeneratedImage | None, str | None]:
    prompt = _build_image_prompt(plan, request)

    if _should_use_gemini(request, plan) and gemini_key:
        return await generate_one_gemini_image(client, gemini_key, request, plan, prompt)

    last_error = ""
    for attempt in range(1, MAX_IMAGE_ATTEMPTS + 1):
        try:
            response = await _call_openai_image_api(client, openai_key, request, plan, prompt)
            response.raise_for_status()
            body = response.json()
            first_image = (body.get("data") or [{}])[0]
            b64_json = first_image.get("b64_json")
            image_url = first_image.get("url")

            if b64_json:
                image_url = f"data:image/png;base64,{b64_json}"

            if not image_url:
                return None, f"No image data returned for plan {plan.id}."

            return (
                SwipeGeneratedImage(
                    planId=plan.id,
                    imageUrl=image_url,
                    model=request.model,
                    size=request.size,
                    quality=request.quality,
                    prompt=prompt,
                    revisedPrompt=first_image.get("revised_prompt") or "",
                    analyzedFeatures={},
                ),
                None,
            )
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response is not None else 0
            detail = exc.response.text[:600] if exc.response is not None else str(exc)
            last_error = f"OpenAI image generation failed for plan {plan.id}: {detail}"
            if status_code not in RETRYABLE_STATUS_CODES or attempt == MAX_IMAGE_ATTEMPTS:
                return None, last_error
        except httpx.HTTPError as exc:
            last_error = f"OpenAI image generation failed for plan {plan.id}: {exc}"
            if attempt == MAX_IMAGE_ATTEMPTS:
                return None, last_error
        except Exception as exc:
            return None, f"OpenAI image generation failed for plan {plan.id}: {exc}"

        await asyncio.sleep(1.5 * attempt)

    return None, last_error or f"OpenAI image generation failed for plan {plan.id}."


async def generate_swipe_images(
    request: SwipeImageGenerationRequest,
) -> SwipeImageGenerationResponse:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not openai_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    semaphore = asyncio.Semaphore(4)

    async with httpx.AsyncClient(timeout=180.0) as client:
        async def run(plan: SwipeImagePlanRequest):
            async with semaphore:
                return await _generate_one_image(client, openai_key, gemini_key, request, plan)

        results = await asyncio.gather(*(run(plan) for plan in request.plans[:4]))

    images: List[SwipeGeneratedImage] = []
    errors: List[str] = []
    for image, error in results:
        if image:
            images.append(image)
        if error:
            errors.append(error)

    response_model = images[0].model if images else request.model
    return SwipeImageGenerationResponse(
        model=response_model,
        size=request.size,
        quality=request.quality,
        images=images,
        errors=errors,
    )
