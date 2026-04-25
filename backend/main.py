from datetime import datetime
from pathlib import Path
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api_models import SwipeImageGenerationRequest
from services.swipe_image_generation_service import generate_swipe_images

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

LOCAL_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:5173",
]

app = FastAPI(title="TacitSNS Swipe Steering API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "openaiConfigured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
    }


@app.post("/api/swipe/generate-images")
async def generate_swipe_images_endpoint(request: SwipeImageGenerationRequest):
    try:
        return await generate_swipe_images(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
