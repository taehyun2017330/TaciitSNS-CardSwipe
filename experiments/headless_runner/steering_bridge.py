from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


class SteeringBridgeError(RuntimeError):
    pass


class SteeringBridge:
    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        self.script = repo_root / "experiments" / "headless_runner" / "steering_bridge.mjs"
        self.process: subprocess.Popen[str] | None = None
        self.next_id = 1

    def __enter__(self) -> "SteeringBridge":
        self.start()
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.close()

    def start(self) -> None:
        if self.process:
            return
        self.process = subprocess.Popen(
            ["node", str(self.script)],
            cwd=str(self.repo_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def close(self) -> None:
        if not self.process:
            return
        if self.process.stdin:
            self.process.stdin.close()
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
        self.process = None

    def call(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.process or not self.process.stdin or not self.process.stdout:
            raise SteeringBridgeError("Steering bridge is not running.")
        request_id = self.next_id
        self.next_id += 1
        payload = {"id": request_id, **payload}
        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            stderr = self.process.stderr.read() if self.process.stderr else ""
            raise SteeringBridgeError(f"Steering bridge exited unexpectedly. {stderr}".strip())
        response = json.loads(line)
        if not response.get("ok"):
            raise SteeringBridgeError(response.get("error", "Unknown steering bridge error."))
        return response["result"]

    def initial_state(self, onboarding: dict[str, Any]) -> dict[str, Any]:
        return self.call({"op": "initialState", "onboarding": onboarding})

    def synthesis_payload(
        self,
        onboarding: dict[str, Any],
        state: dict[str, Any],
        feedback_events: list[dict[str, Any]],
        batch_number: int,
        count: int,
    ) -> dict[str, Any]:
        return self.call({
            "op": "synthesisPayload",
            "onboarding": onboarding,
            "state": state,
            "feedbackEvents": feedback_events,
            "batchNumber": batch_number,
            "count": count,
        })["payload"]

    def image_generation_payload(
        self,
        onboarding: dict[str, Any],
        selected_candidates: list[dict[str, Any]],
        reference_image_url: str,
        batch_number: int,
    ) -> dict[str, Any]:
        return self.call({
            "op": "imageGenerationPayload",
            "onboarding": onboarding,
            "selectedCandidates": selected_candidates,
            "referenceImageUrl": reference_image_url,
            "batchNumber": batch_number,
        })["payload"]

    def rationale_options(self, action: str, candidate: dict[str, Any]) -> list[str]:
        return self.call({
            "op": "rationaleOptions",
            "action": action,
            "candidate": candidate,
        })["options"]

    def apply_feedback(
        self,
        state: dict[str, Any],
        feedback_events: list[dict[str, Any]],
        candidate: dict[str, Any],
        action: str,
        reason_text: str,
        reason_chips: list[str],
        batch_number: int,
        feedback_id: str,
    ) -> dict[str, Any]:
        return self.call({
            "op": "applyFeedback",
            "state": state,
            "feedbackEvents": feedback_events,
            "candidate": candidate,
            "action": action,
            "source": "keyboard",
            "reasonText": reason_text,
            "reasonChips": reason_chips,
            "batchNumber": batch_number,
            "feedbackId": feedback_id,
        })
