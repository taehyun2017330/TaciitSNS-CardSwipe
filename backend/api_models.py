from typing import List

from pydantic import BaseModel, Field


class SwipeImagePlanRequest(BaseModel):
    id: str
    prompt: str
    negativePrompt: str = ""
    strategy: str = ""
    hypothesis: str = ""


class SwipeImageGenerationRequest(BaseModel):
    brandName: str = ""
    category: str = ""
    goal: str = ""
    plans: List[SwipeImagePlanRequest]
    model: str = "gpt-image-2"
    size: str = "1024x1024"
    quality: str = "medium"
    outputFormat: str = "png"


class SwipeGeneratedImage(BaseModel):
    planId: str
    imageUrl: str
    model: str
    size: str
    quality: str
    prompt: str
    revisedPrompt: str = ""


class SwipeImageGenerationResponse(BaseModel):
    model: str
    size: str
    quality: str
    images: List[SwipeGeneratedImage] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
