from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any


class RunLogger:
    def __init__(self, run_dir: Path, stream: bool = True, append: bool = False):
        self.path = run_dir / "run.log"
        self.stream = stream
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not append:
            self.path.write_text("", encoding="utf-8")

    def log(self, message: str, **fields: Any) -> None:
        suffix = ""
        if fields:
            compact = " ".join(f"{key}={value}" for key, value in fields.items() if value is not None)
            suffix = f" | {compact}" if compact else ""
        line = f"[{datetime.now().strftime('%H:%M:%S')}] {message}{suffix}"
        if self.stream:
            print(line, flush=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
