import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api_models import (
    SwipeClarificationRequest,
    SwipeImageAnalysisRequest,
    SwipeImageAnalysisResponse,
    SwipeImageAnalysisResult,
    SwipeImageGenerationRequest,
    SwipePromptSynthesisRequest,
)

import httpx

from services.swipe_clarification_service import generate_clarification
from services.experiment_dashboard_service import (
    build_experiment_detail,
    build_experiment_list,
    experiments_dir,
)
from services.swipe_image_analysis_service import analyze_images
from services.swipe_image_generation_service import generate_swipe_images
from services.swipe_prompt_synthesis_service import synthesize_prompts

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

app = FastAPI(title="TacitSNS Swipe Steering API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):(300[0-9]|5173)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount(
    "/experiment-assets",
    StaticFiles(directory=experiments_dir(PROJECT_ROOT)),
    name="experiment-assets",
)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "openaiConfigured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
    }


@app.get("/api/experiments/runs")
async def list_experiment_runs():
    return build_experiment_list(PROJECT_ROOT)


@app.get("/api/experiments/runs/{run_id}")
async def get_experiment_run(run_id: str):
    detail = build_experiment_detail(PROJECT_ROOT, run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Experiment run not found.")
    return detail


@app.post("/api/swipe/synthesize-prompts")
async def synthesize_prompts_endpoint(request: SwipePromptSynthesisRequest):
    try:
        return await synthesize_prompts(request)
    except Exception as exc:
        detail = str(exc) or exc.__class__.__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/api/swipe/generate-images")
async def generate_swipe_images_endpoint(request: SwipeImageGenerationRequest):
    try:
        return await generate_swipe_images(request)
    except Exception as exc:
        detail = str(exc) or exc.__class__.__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/api/swipe/analyze-images", response_model=SwipeImageAnalysisResponse)
async def analyze_images_endpoint(request: SwipeImageAnalysisRequest):
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")
    if not request.images:
        return SwipeImageAnalysisResponse(results=[])
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            analysis_results = await analyze_images(
                client, api_key, [item.imageUrl for item in request.images]
            )
        return SwipeImageAnalysisResponse(
            results=[
                SwipeImageAnalysisResult(
                    planId=item.planId,
                    features=result.get("features", {}),
                    imageSummary=result.get("imageSummary", ""),
                    rationaleSuggestions=result.get("rationaleSuggestions", []),
                    likeRationaleSuggestions=result.get("likeRationaleSuggestions", []),
                    dislikeRationaleSuggestions=result.get("dislikeRationaleSuggestions", []),
                )
                for item, result in zip(request.images, analysis_results)
            ]
        )
    except Exception as exc:
        detail = str(exc) or exc.__class__.__name__
        raise HTTPException(status_code=500, detail=detail) from exc


@app.post("/api/swipe/clarify")
async def clarify_endpoint(request: SwipeClarificationRequest):
    try:
        return await generate_clarification(request)
    except Exception as exc:
        detail = str(exc) or exc.__class__.__name__
        raise HTTPException(status_code=500, detail=detail) from exc
