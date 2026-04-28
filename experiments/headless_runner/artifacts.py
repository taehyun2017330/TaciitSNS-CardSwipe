from __future__ import annotations

import base64
import json
import mimetypes
import re
import shutil
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower())
    return cleaned.strip("-") or "run"


def utc_stamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d-%H%M%S")


def make_run_dir(out_dir: str, run_name: str, repo_root: Path) -> Path:
    base = Path(out_dir)
    if not base.is_absolute():
        base = repo_root / base
    run_dir = base / f"{utc_stamp()}-{slugify(run_name)}"
    (run_dir / "images").mkdir(parents=True, exist_ok=True)
    (run_dir / "api").mkdir(parents=True, exist_ok=True)
    return run_dir


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def data_url_to_bytes(data_url: str) -> tuple[bytes, str]:
    header, encoded = data_url.split(",", 1)
    mime = header.split(";")[0].replace("data:", "") or "image/png"
    return base64.b64decode(encoded), mime


def image_source_to_data_url(source: str) -> str:
    if source.startswith("data:"):
        return source
    if source.startswith("http://") or source.startswith("https://"):
        return source
    path = Path(source).expanduser()
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def save_image_source(source: str, destination_base: Path) -> Path:
    destination_base.parent.mkdir(parents=True, exist_ok=True)
    if source.startswith("data:"):
        image_bytes, mime = data_url_to_bytes(source)
        extension = mimetypes.guess_extension(mime) or ".png"
        destination = destination_base.with_suffix(extension)
        destination.write_bytes(image_bytes)
        return destination
    if source.startswith("http://") or source.startswith("https://"):
        extension = Path(source.split("?")[0]).suffix or ".png"
        destination = destination_base.with_suffix(extension)
        with urllib.request.urlopen(source, timeout=60.0) as response:
            destination.write_bytes(response.read())
        return destination
    source_path = Path(source).expanduser()
    extension = source_path.suffix or ".png"
    destination = destination_base.with_suffix(extension)
    shutil.copyfile(source_path, destination)
    return destination


def without_large_images(payload: Any) -> Any:
    if isinstance(payload, list):
        return [without_large_images(item) for item in payload]
    if isinstance(payload, dict):
        redacted: dict[str, Any] = {}
        for key, value in payload.items():
            if key == "imageUrl" and isinstance(value, str) and value.startswith("data:"):
                redacted[key] = f"{value[:32]}...<redacted data url>"
            else:
                redacted[key] = without_large_images(value)
        return redacted
    return payload

