import json
import os
from typing import Dict, List

import httpx


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
VISION_MODEL = "gpt-4o-mini"
VISION_TIMEOUT_SECONDS = 60.0

FEATURE_KEYS: List[str] = [
    "palette.brightness",
    "palette.saturation",
    "palette.warmth",
    "palette.blueDominance",
    "composition.minimal",
    "composition.editorial",
    "composition.dynamic",
    "composition.cluttered",
    "setting.coastal",
    "setting.urban",
    "setting.studio",
    "lighting.sunny",
    "lighting.moody",
    "lighting.synthetic",
    "typography.clean",
    "typography.playful",
    "marketing.saleEmphasis",
    "marketing.subtlety",
    "mood.premium",
    "mood.credible",
    "mood.playful",
    "mood.energetic",
    "mood.calm",
    "mood.cheap",
]


def _feature_object_schema() -> dict:
    feature_props = {
        key: {"type": "number", "minimum": 0, "maximum": 1}
        for key in FEATURE_KEYS
    }
    return {
        "type": "object",
        "properties": feature_props,
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
                },
                "required": ["position", "features"],
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
        "Feature definitions:\n"
        "- palette.brightness: light/bright vs dark\n"
        "- palette.saturation: vivid vs muted color\n"
        "- palette.warmth: warm color temperature (reds/oranges/yellows)\n"
        "- palette.blueDominance: blue is the dominant color family\n"
        "- composition.minimal: spacious, restrained layout\n"
        "- composition.editorial: magazine-like, refined hierarchy\n"
        "- composition.dynamic: motion, asymmetry, energy in the layout\n"
        "- composition.cluttered: busy, many competing elements\n"
        "- setting.coastal: beach, water, sand, summer-outdoor\n"
        "- setting.urban: city, street, architecture\n"
        "- setting.studio: clean studio product shot\n"
        "- lighting.sunny: natural bright daylight\n"
        "- lighting.moody: low-key, dramatic, shadowed\n"
        "- lighting.synthetic: neon, hard artificial, AI-glow\n"
        "- typography.clean: refined, simple sans/serif\n"
        "- typography.playful: bold, decorative, sticker-like\n"
        "- marketing.saleEmphasis: prominent discount/sale messaging\n"
        "- marketing.subtlety: offer is understated or absent\n"
        "- mood.premium: high-end, expensive feel\n"
        "- mood.credible: trustworthy, professional\n"
        "- mood.playful: fun, light\n"
        "- mood.energetic: exciting, kinetic\n"
        "- mood.calm: quiet, restful\n"
        "- mood.cheap: low-quality, generic, off-brand\n\n"
        "Return one entry per image, in the order received. The 'position' field must "
        "match the image's index (0-based)."
    )


async def analyze_images(
    client: httpx.AsyncClient,
    api_key: str,
    image_urls: List[str],
) -> List[Dict[str, float]]:
    if not image_urls:
        return []

    user_content: List[dict] = [
        {
            "type": "text",
            "text": (
                f"Score each of the {len(image_urls)} images. Return one entry per "
                "image with its position (0-based)."
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

    by_position: Dict[int, Dict[str, float]] = {}
    for entry in results:
        pos = entry.get("position")
        features = entry.get("features") or {}
        if isinstance(pos, int):
            by_position[pos] = {key: float(features.get(key, 0.0)) for key in FEATURE_KEYS}

    empty: Dict[str, float] = {key: 0.0 for key in FEATURE_KEYS}
    return [by_position.get(index, empty) for index in range(len(image_urls))]
