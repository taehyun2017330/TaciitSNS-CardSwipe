# TacitSNS Swipe Steering

Standalone prototype for the simplified TacitSNS preference-steering image workflow.

This codebase is intentionally separate from `TacitSNS-Simple` so future work can focus on the new swipe interaction without loading the old workshop prototype.

## Structure

- `frontend/`: Vite React app for onboarding, swipe cards, preference memory, trace/debug panels, and dynamic clarification.
- `backend/`: FastAPI app with the OpenAI image generation endpoint used by the prototype.

## Run Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# add OPENAI_API_KEY to .env
uvicorn main:app --host 127.0.0.1 --port 8001
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on `http://127.0.0.1:3002/`.

## Image Generation

The frontend builds eight-card batches. Each card is revealed only after image generation and rationale analysis both complete.

The backend image request defaults are:

- model: `gpt-image-2`
- size: `1024x1024`
- quality: `medium`

If image generation or rationale analysis fails for a card, the UI keeps that card in a failed placeholder state instead of showing an incomplete image.
