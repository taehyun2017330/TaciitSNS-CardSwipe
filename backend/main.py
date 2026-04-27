from datetime import datetime
from pathlib import Path
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api_models import (
    SwipeClarificationRequest,
    SwipeImageAnalysisRequest,
    SwipeImageAnalysisResponse,
    SwipeImageAnalysisResult,
    SwipeImageGenerationRequest,
    SwipePromptSynthesisRequest,
)

import httpx
import os

from services.swipe_clarification_service import generate_clarification
from services.swipe_image_analysis_service import analyze_images
from services.swipe_image_generation_service import generate_swipe_images
from services.swipe_prompt_synthesis_service import synthesize_prompts

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")

app = FastAPI(title="TacitSNS Swipe Steering API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):(300[0-9]|5173)",
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


@app.post("/api/swipe/synthesize-prompts")
async def synthesize_prompts_endpoint(request: SwipePromptSynthesisRequest):
    try:
        return await synthesize_prompts(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/swipe/generate-images")
async def generate_swipe_images_endpoint(request: SwipeImageGenerationRequest):
    try:
        return await generate_swipe_images(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/swipe/analyze-images", response_model=SwipeImageAnalysisResponse)
async def analyze_images_endpoint(request: SwipeImageAnalysisRequest):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")
    if not request.images:
        return SwipeImageAnalysisResponse(results=[])
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            feature_lists = await analyze_images(
                client, api_key, [item.imageUrl for item in request.images]
            )
        return SwipeImageAnalysisResponse(
            results=[
                SwipeImageAnalysisResult(planId=item.planId, features=features)
                for item, features in zip(request.images, feature_lists)
            ]
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/swipe/clarify")
async def clarify_endpoint(request: SwipeClarificationRequest):
    try:
        return await generate_clarification(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


