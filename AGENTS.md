# AGENTS.md

## Project Boundary

This is the standalone TacitSNS swipe-steering prototype. Work inside this repository only unless the user explicitly asks to modify `TacitSNS-Simple`.

Do not load the old TacitSNS-Simple frontend/backend for routine work on this prototype.

## Read First

- `README.md`
- `frontend/src/PreferenceSwipePrototype.tsx`
- `frontend/src/PreferenceSwipePrototype.css`
- `backend/main.py`
- `backend/services/swipe_image_generation_service.py`

## Ignore

Avoid reading generated folders unless debugging tooling itself:

- `frontend/node_modules/`
- `frontend/build/`
- `backend/.venv/`
- `backend/__pycache__/`

## Design Direction

Keep the interface light-mode, calm, editorial, and practical for small business owners with limited design vocabulary. The product should feel like a careful creative assistant, not a toy.

## Core Prototype Goals

- Simple onboarding for category, goal, audience, tone, and avoid-list.
- Four-card swipe slate with like/dislike, keyboard shortcuts, optional reasons, and grid view.
- Structured preference memory owned by the app, not by the LLM.
- Local prompt-plan scoring before image generation.
- OpenAI image generation through the backend with `gpt-image-2`, `1024x1024`, `medium`.
- Always-visible dynamic clarification bubble with summarize, probe, clarify, challenge, and passive insight modes.
- Debug visibility for extracted facets, current preference weights, prompt-plan scores, and trace events.
