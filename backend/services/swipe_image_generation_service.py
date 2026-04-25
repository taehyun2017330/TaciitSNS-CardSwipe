import asyncio
import os
from typing import Dict, List, Tuple

import httpx

from api_models import (
    SwipeGeneratedImage,
    SwipeImageGenerationRequest,
    SwipeImageGenerationResponse,
    SwipeImagePlanRequest,
)


OPENAI_IMAGE_GENERATION_URL = "https://api.openai.com/v1/images/generations"
MAX_IMAGE_ATTEMPTS = 3
RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


def _build_image_prompt(
    plan: SwipeImagePlanRequest,
    request: SwipeImageGenerationRequest,
) -> str:
    negative = plan.negativePrompt.strip()
    avoid_line = f"\nAvoid: {negative}" if negative else ""
    brand_line = f"Brand/project: {request.brandName}".strip()
    category_line = f"Category: {request.category}".strip()
    goal_line = f"Goal: {request.goal}".strip()

    return f"""Create a square social media marketing image.
{brand_line}
{category_line}
{goal_line}
Strategy: {plan.strategy or "preference-steered candidate"}
Hypothesis being tested: {plan.hypothesis or "unknown"}

Creative direction:
{plan.prompt}
{avoid_line}

Output requirements:
- Finished 1024x1024 social post image.
- Premium, credible, editorial quality suitable for a small business.
- Strong visual hierarchy with product/campaign feel.
- If text appears, keep it sparse, large, and readable.
- Do not include watermarks, UI chrome, or placeholder labels."""


async def _generate_one_image(
    client: httpx.AsyncClient,
    api_key: str,
    request: SwipeImageGenerationRequest,
    plan: SwipeImagePlanRequest,
) -> Tuple[SwipeGeneratedImage | None, str | None]:
    prompt = _build_image_prompt(plan, request)
    payload: Dict[str, object] = {
        "model": request.model,
        "prompt": prompt,
        "size": request.size,
        "quality": request.quality,
        "n": 1,
    }

    if request.outputFormat:
        payload["output_format"] = request.outputFormat

    last_error = ""
    for attempt in range(1, MAX_IMAGE_ATTEMPTS + 1):
        try:
            response = await client.post(
                OPENAI_IMAGE_GENERATION_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
            first_image = (body.get("data") or [{}])[0]
            b64_json = first_image.get("b64_json")
            image_url = first_image.get("url")

            if b64_json:
                image_url = f"data:image/{request.outputFormat or 'png'};base64,{b64_json}"

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
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")

    semaphore = asyncio.Semaphore(2)

    async with httpx.AsyncClient(timeout=180.0) as client:
        async def run(plan: SwipeImagePlanRequest):
            async with semaphore:
                return await _generate_one_image(client, api_key, request, plan)

        results = await asyncio.gather(*(run(plan) for plan in request.plans[:4]))

    images: List[SwipeGeneratedImage] = []
    errors: List[str] = []
    for image, error in results:
        if image:
            images.append(image)
        if error:
            errors.append(error)

    return SwipeImageGenerationResponse(
        model=request.model,
        size=request.size,
        quality=request.quality,
        images=images,
        errors=errors,
    )
