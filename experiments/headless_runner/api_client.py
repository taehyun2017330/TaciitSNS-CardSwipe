from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


class ApiError(RuntimeError):
    pass


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#") or "=" not in cleaned:
            continue
        key, value = cleaned.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def post_json_absolute(
    url: str,
    payload: dict[str, Any],
    timeout: float = 90.0,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise ApiError(f"POST {url} failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"POST {url} failed: {exc}") from exc


def get_json_absolute(url: str, timeout: float = 20.0) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise ApiError(f"GET {url} failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"GET {url} failed: {exc}") from exc


class SwipeApiClient:
    def __init__(self, api_base: str):
        self.api_base = api_base.rstrip("/")

    def health(self) -> dict[str, Any]:
        return get_json_absolute(f"{self.api_base}/health", timeout=20.0)

    def synthesize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return post_json_absolute(
            f"{self.api_base}/api/swipe/synthesize-prompts",
            payload,
            timeout=60.0,
        )

    def generate_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return post_json_absolute(
            f"{self.api_base}/api/swipe/generate-images",
            payload,
            timeout=220.0,
        )

    def analyze_images(self, images: list[dict[str, str]]) -> dict[str, Any]:
        return post_json_absolute(
            f"{self.api_base}/api/swipe/analyze-images",
            {"images": images},
            timeout=120.0,
        )
