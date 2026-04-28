import json
from typing import Any, Dict, List

import httpx

from services.facet_catalog import feature_definitions, feature_keys, feature_schema


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
VISION_MODEL = "gpt-4o-mini"
VISION_TIMEOUT_SECONDS = 60.0
FEATURE_KEYS: List[str] = feature_keys()


def _feature_object_schema() -> dict:
    return {
        "type": "object",
        "properties": feature_schema(),
        "required": FEATURE_KEYS,
        "additionalProperties": False,
    }


_BATCH_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "position": {"type": "integer"},
                    "features": _feature_object_schema(),
                    "imageSummary": {"type": "string"},
                    "rationaleSuggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "likeRationaleSuggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "dislikeRationaleSuggestions": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "position",
                    "features",
                    "imageSummary",
                    "rationaleSuggestions",
                    "likeRationaleSuggestions",
                    "dislikeRationaleSuggestions",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


def _build_system_prompt() -> str:
    return (
        "You analyze marketing images for an AI image-steering system. For each image, "
        "score it on every visual feature from 0.0 (not present) to 1.0 (strongly present). "
        "Be honest — if a feature is absent, return a low score. Calibrated mid-range "
        "values matter; preference learning depends on the differences between images.\n\n"
        "Also produce an imageSummary, 3-5 likeRationaleSuggestions, 3-5 "
        "dislikeRationaleSuggestions, and a combined rationaleSuggestions list. These are "
        "selectable chips shown after a human likes or dislikes the image. They must be "
        "concrete, image-specific, and useful for preference learning. Like suggestions "
        "should explain why someone might want more images like this. Dislike suggestions "
        "should explain why someone might steer away from this image. Keep each suggestion "
        "under 12 words and do not mention invisible implementation details.\n\n"
        "Feature definitions:\n"
        f"{feature_definitions()}\n\n"
        "Return one entry per image, in the order received. The 'position' field must "
        "match the image's index (0-based)."
    )


async def analyze_images(
    client: httpx.AsyncClient,
    api_key: str,
    image_urls: List[str],
) -> List[Dict[str, Any]]:
    if not image_urls:
        return []

    user_content: List[dict] = [
        {
            "type": "text",
            "text": (
                f"Score each of the {len(image_urls)} images. Return one entry per "
                "image with its position (0-based), feature scores, one short imageSummary, "
                "and rationaleSuggestions."
            ),
        }
    ]
    for index, url in enumerate(image_urls):
        user_content.append({"type": "text", "text": f"Image at position {index}:"})
        user_content.append({"type": "image_url", "image_url": {"url": url, "detail": "low"}})

    payload = {
        "model": VISION_MODEL,
        "messages": [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": user_content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "image_features_batch",
                "schema": _BATCH_RESPONSE_SCHEMA,
                "strict": True,
            },
        },
        "temperature": 0.2,
    }

    response = await client.post(
        OPENAI_CHAT_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=VISION_TIMEOUT_SECONDS,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"Image analysis failed ({response.status_code}): {response.text[:600]}"
        )

    body = response.json()
    content = body["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    results = parsed.get("results") or []

    empty_features: Dict[str, float] = {key: 0.0 for key in FEATURE_KEYS}
    empty_result: Dict[str, Any] = {
        "features": empty_features,
        "imageSummary": "",
        "rationaleSuggestions": [],
        "likeRationaleSuggestions": [],
        "dislikeRationaleSuggestions": [],
    }
    by_position: Dict[int, Dict[str, Any]] = {}
    for entry in results:
        pos = entry.get("position")
        features = entry.get("features") or {}
        if isinstance(pos, int):
            suggestions = entry.get("rationaleSuggestions") or []
            like_suggestions = entry.get("likeRationaleSuggestions") or []
            dislike_suggestions = entry.get("dislikeRationaleSuggestions") or []
            by_position[pos] = {
                "features": {key: float(features.get(key, 0.0)) for key in FEATURE_KEYS},
                "imageSummary": str(entry.get("imageSummary") or ""),
                "rationaleSuggestions": [
                    str(item).strip()
                    for item in suggestions
                    if str(item).strip()
                ][:6],
                "likeRationaleSuggestions": [
                    str(item).strip()
                    for item in like_suggestions
                    if str(item).strip()
                ][:5],
                "dislikeRationaleSuggestions": [
                    str(item).strip()
                    for item in dislike_suggestions
                    if str(item).strip()
                ][:5],
            }

    return [by_position.get(index, empty_result) for index in range(len(image_urls))]
