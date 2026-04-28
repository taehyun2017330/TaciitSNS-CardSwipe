from __future__ import annotations

import json
import os
from typing import Any

from .api_client import ApiError, post_json_absolute
from .artifacts import image_source_to_data_url, slugify
from .judge import OPENAI_CHAT_URL


TARGET_ONBOARDING_SCHEMA = {
    "type": "object",
    "properties": {
        "runName": {"type": "string"},
        "targetBrief": {"type": "string"},
        "imageDescription": {"type": "string"},
        "normalUserRationale": {"type": "string"},
        "onboarding": {
            "type": "object",
            "properties": {
                "brandName": {"type": "string"},
                "category": {"type": "string"},
                "goal": {"type": "string"},
                "audience": {"type": "string"},
            },
            "required": ["brandName", "category", "goal", "audience"],
            "additionalProperties": False,
        },
    },
    "required": ["runName", "targetBrief", "imageDescription", "normalUserRationale", "onboarding"],
    "additionalProperties": False,
}


def generate_onboarding_from_target(target_image: str, model: str) -> dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ApiError("OPENAI_API_KEY is required for --auto-onboarding-from-target.")

    target_image_url = image_source_to_data_url(target_image)
    prompt = (
        "Look at the target image and create the onboarding text a normal small-business "
        "owner or marketing user would type into a swipe-based image steering tool to get "
        "more images in this direction. Avoid designer jargon unless it is something a "
        "normal user would naturally say. If text or brand is visible, transcribe it when "
        "useful. The current onboarding screen only accepts brand/project, category, post "
        "goal, and audience. Do not invent separate tone or avoid inputs.\n\n"
        "For targetBrief, be strict and visual: include the product type, color palette, "
        "camera distance, composition, background, props, motion/liquid effects, and any "
        "must-not drift such as lifestyle scenes or unrelated multi-product sets. If the "
        "target is a poster, collage, or social graphic, describe the exact layout system: "
        "text hierarchy, text placement, overlay cards, stickers, grid/background pattern, "
        "crop, typography feel, and which visible words matter. Mark exact wording as "
        "critical only when the visible words are the point of the target, because image "
        "generators often approximate text. The judge will use "
        "targetBrief to reject broad category matches that miss distinctive details."
    )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You convert a target social/product image into concise onboarding "
                    "inputs for an image-generation preference-steering experiment."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": target_image_url, "detail": "low"}},
                ],
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "target_onboarding",
                "schema": TARGET_ONBOARDING_SCHEMA,
                "strict": True,
            },
        },
        "temperature": 0.2,
    }
    response = post_json_absolute(
        OPENAI_CHAT_URL,
        payload,
        timeout=90.0,
        headers={"Authorization": f"Bearer {api_key}"},
    )
    parsed = json.loads(response["choices"][0]["message"]["content"])
    parsed["runName"] = slugify(parsed.get("runName") or "target-image-steering")
    return parsed
