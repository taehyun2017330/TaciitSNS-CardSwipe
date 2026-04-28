from __future__ import annotations

import json
import os
import re
from typing import Any

from .api_client import ApiError, post_json_absolute


OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


HUMAN_TERMS = re.compile(r"\b(human|person|people|model|face|portrait|wearing|someone|woman|man)\b", re.I)
NO_HUMAN_CONTEXT = re.compile(
    r"\b(?:no|without|not)\s+(?:human|person|people|model|face|portrait)|product[- ]only|packshot",
    re.I,
)
MISSING_PREFIX = re.compile(
    r"^\s*(?:the|this|current)?\s*(?:image|candidate|visual|direction)?\s*"
    r"(?:lacks?|is missing|does not have|doesn't have|has no|without)\s+",
    re.I,
)


JUDGE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["like", "dislike"]},
        "targetFitScore": {"type": "number", "minimum": 0, "maximum": 1},
        "satisfied": {"type": "boolean"},
        "selectedReasonIndexes": {
            "type": "array",
            "items": {"type": "integer", "minimum": 1, "maximum": 9},
            "maxItems": 3,
        },
        "specificReason": {"type": "string"},
        "progressNotes": {"type": "string"},
        "visibleProblems": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "action",
        "targetFitScore",
        "satisfied",
        "selectedReasonIndexes",
        "specificReason",
        "progressNotes",
        "visibleProblems",
    ],
    "additionalProperties": False,
}


class AiTargetJudge:
    def __init__(self, model: str, target_brief: str, target_image_url: str = ""):
        self.model = model
        self.target_brief = target_brief
        self.target_image_url = target_image_url
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()

    def _target_has_human_context(self) -> bool:
        return bool(HUMAN_TERMS.search(self.target_brief)) and not bool(NO_HUMAN_CONTEXT.search(self.target_brief))

    def _reason_matches_target_context(self, reason: str) -> bool:
        if self._target_has_human_context():
            return True
        return not bool(HUMAN_TERMS.search(reason))

    def _normalize_specific_reason(self, reason: str, action: str) -> str:
        cleaned = reason.strip()
        if action != "dislike" or not cleaned:
            return cleaned

        sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", cleaned) if part.strip()]
        normalized: list[str] = []
        for sentence in sentences:
            rewritten = MISSING_PREFIX.sub("Needs ", sentence).strip()
            if rewritten != sentence and not rewritten.lower().startswith("needs "):
                rewritten = f"Needs {rewritten[0].lower()}{rewritten[1:]}"
            normalized.append(rewritten)
        return " ".join(normalized).strip()

    def decide(
        self,
        candidate: dict[str, Any],
        analysis: dict[str, Any],
        like_reasons: list[str],
        dislike_reasons: list[str],
        memory_summary: str,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise ApiError("OPENAI_API_KEY is required for the AI judge.")

        text = (
            "You are a small-business owner. You are not a designer. You do not "
            "have formal design vocabulary. You opened a swipe app to get images "
            "for your brand. You swipe right on things that feel right and left "
            "on things that feel wrong. That is it.\n\n"
            "A like is cheap. It means 'make more like this.' It does not mean "
            "'this is perfect.' It does not mean 'I would publish this today.' "
            "It means the vibe, the style, the energy, or the direction is "
            "promising enough that you want the system to keep going this way. "
            "If you are unsure, like it. A wrong like costs almost nothing. "
            "A wrong dislike could stop a promising direction.\n\n"
            "A dislike means 'stop going this way.' Use it when the image would "
            "teach the system the wrong lesson: wrong vibe, wrong subject, "
            "wrong energy entirely. Do not dislike an image just because it is "
            "imperfect. Most early images are imperfect.\n\n"
            "Follow this thinking sequence exactly:\n\n"
            "STEP 1 - GUT REACTION\n"
            "Look at the candidate image. Before analyzing anything, answer one "
            "question as yourself, the business owner: 'Does this feel like it "
            "is heading in the right direction for what I want?' Yes or no. "
            "That answer determines action. Yes means action='like'. No means "
            "action='dislike'. Write your gut reaction in one casual sentence "
            "and put it in progressNotes.\n\n"
            "STEP 2 - REASONS (only after your gut reaction)\n"
            "If you liked it: what about it felt right? The colors? The mood? "
            "The layout? The subject? Say it the way you would text a friend.\n"
            "If you disliked it: what felt off? Say what you wanted instead, "
            "not what is wrong. For example: 'I wanted something warmer and "
            "closer up' not 'lacks warmth and has poor framing.' Put this "
            "plain-language reason in specificReason when it adds useful detail "
            "beyond selected chips. If no chips fit, specificReason must contain "
            "your Step 2 words.\n\n"
            "STEP 3 - REASON CHIPS\n"
            "Now look at the reason chip list below. Pick 0-3 chips, but ONLY "
            "chips that match what you already said in Step 2. If a chip "
            "mentions a feature that does not exist in the target image, skip "
            "it; you would never complain about missing something that was "
            "never supposed to be there. If no chips fit what you said, leave "
            "selectedReasonIndexes empty and put your Step 2 words in "
            "specificReason.\n\n"
            "STEP 4 - SCORES (last, not first)\n"
            "targetFitScore: how close is this to being a final answer? This "
            "is separate from like/dislike. You can like an image at 0.4 "
            "because the direction is right even though it is far from done. "
            "You can dislike an image at 0.5 because the direction is wrong "
            "even though some details happen to match.\n"
            "satisfied: true only when you would genuinely stop swiping and "
            "use this image. This is rare. Most liked images are not "
            "satisfying yet.\n\n"
            "CALIBRATION\n"
            "- Image has the right color palette and mood but wrong subject -> "
            "LIKE, score ~0.3-0.4, satisfied=false\n"
            "- Image has right subject and vibe but text/layout needs work -> "
            "LIKE, score ~0.5-0.7, satisfied=false\n"
            "- Image feels completely off, wrong energy -> "
            "DISLIKE, score ~0.1-0.3\n"
            "- Image is close enough you would use it -> "
            "LIKE, score ~0.85+, satisfied=true\n"
            "- Image is pretty but heading in a totally different direction -> "
            "DISLIKE, even if it is well-made\n\n"
            "Return JSON only. Use visibleProblems for short concrete blockers "
            "you can see in the candidate image; leave it empty when there are "
            "no meaningful blockers.\n\n"
            f"Target brief:\n{self.target_brief or '(use the target image as the target)'}\n\n"
            f"Current memory summary:\n{memory_summary}\n\n"
            f"Candidate plan strategy: {candidate['plan'].get('strategy')}\n"
            f"Candidate hypothesis: {candidate['plan'].get('hypothesis')}\n"
            f"Candidate prompt: {candidate['plan'].get('prompt')}\n"
            f"Vision summary: {analysis.get('imageSummary', '')}\n\n"
            "Like reason chips (pick ONLY if they match your gut reaction):\n"
            + "\n".join(f"{idx + 1}. {reason}" for idx, reason in enumerate(like_reasons))
            + "\n\nDislike reason chips (pick ONLY if they match your gut reaction):\n"
            + "\n".join(f"{idx + 1}. {reason}" for idx, reason in enumerate(dislike_reasons))
        )

        content: list[dict[str, Any]] = [{"type": "text", "text": text}]
        if self.target_image_url:
            content.extend([
                {"type": "text", "text": "Target image:"},
                {"type": "image_url", "image_url": {"url": self.target_image_url, "detail": "low"}},
            ])
        content.extend([
            {"type": "text", "text": "Generated candidate image:"},
            {"type": "image_url", "image_url": {"url": candidate["imageUrl"], "detail": "low"}},
        ])

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a simulated end user for a visual preference-steering "
                        "experiment. Behave like a non-expert business owner. Your gut "
                        "reaction determines the like/dislike action; scores and endpoint "
                        "satisfaction are judged afterward."
                    ),
                },
                {"role": "user", "content": content},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "steering_judgment",
                    "schema": JUDGE_RESPONSE_SCHEMA,
                    "strict": True,
                },
            },
            "temperature": 0.15,
        }
        response = post_json_absolute(
            OPENAI_CHAT_URL,
            payload,
            timeout=90.0,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )
        content_text = response["choices"][0]["message"]["content"]
        parsed = json.loads(content_text)
        action = parsed["action"]
        score = float(parsed.get("targetFitScore", 0))

        specific_reason = self._normalize_specific_reason(
            parsed.get("specificReason", ""),
            action,
        )
        reason_source = like_reasons if action == "like" else dislike_reasons
        selected = []
        selected_indexes = parsed.get("selectedReasonIndexes", [])
        for index in selected_indexes:
            if 1 <= index <= len(reason_source):
                reason = reason_source[index - 1]
                if self._reason_matches_target_context(reason):
                    selected.append(reason)
                else:
                    specific_reason = specific_reason or "The suggested reason does not match the target context."
        if len(selected) != len(selected_indexes):
            selected_indexes = []
        return {
            "action": action,
            "rawAction": action,
            "targetFitScore": score,
            "satisfied": bool(parsed.get("satisfied", False)) and action == "like",
            "selectedReasons": selected,
            "selectedReasonIndexes": selected_indexes,
            "specificReason": specific_reason,
            "progressNotes": parsed.get("progressNotes", "").strip(),
            "visibleProblems": parsed.get("visibleProblems", []),
        }


class DryRunJudge:
    def decide(
        self,
        candidate: dict[str, Any],
        analysis: dict[str, Any],
        like_reasons: list[str],
        dislike_reasons: list[str],
        memory_summary: str,
    ) -> dict[str, Any]:
        action = "like" if int(candidate["imageId"].split("-")[-1]) % 2 == 0 else "dislike"
        source = like_reasons if action == "like" else dislike_reasons
        return {
            "action": action,
            "targetFitScore": 0.5,
            "satisfied": False,
            "selectedReasons": source[:2],
            "selectedReasonIndexes": [1, 2],
            "specificReason": "",
            "progressNotes": "Dry run placeholder decision.",
            "visibleProblems": [],
        }
