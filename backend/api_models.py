from typing import Any, Dict, List

from pydantic import BaseModel, Field


class SwipeImagePlanRequest(BaseModel):
    id: str
    prompt: str
    negativePrompt: str = ""
    useReference: bool = False


class SwipeImageGenerationRequest(BaseModel):
    brandName: str = ""
    category: str = ""
    goal: str = ""
    audience: str = ""
    tone: str = ""
    avoid: str = ""
    plans: List[SwipeImagePlanRequest]
    model: str = "gpt-image-2"
    size: str = "1024x1024"
    quality: str = "medium"
    referenceImageUrl: str = ""
    batchNumber: int = 1


class SwipeGeneratedImage(BaseModel):
    planId: str
    imageUrl: str
    model: str
    size: str
    quality: str
    prompt: str
    revisedPrompt: str = ""
    analyzedFeatures: Dict[str, float] = Field(default_factory=dict)


class SwipeImageGenerationResponse(BaseModel):
    model: str
    size: str
    quality: str
    images: List[SwipeGeneratedImage] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class SwipePromptSynthesisRequest(BaseModel):
    brandName: str = ""
    category: str = ""
    goal: str = ""
    audience: str = ""
    tone: str = ""
    avoid: str = ""
    leanInto: List[str] = Field(default_factory=list)
    avoidFacets: List[str] = Field(default_factory=list)
    testNext: List[str] = Field(default_factory=list)
    preferenceSummary: str = ""
    semanticBrief: str = ""
    semanticMemory: Dict[str, Any] = Field(default_factory=dict)
    weightedFacets: List[Dict[str, Any]] = Field(default_factory=list)
    strategyMix: List[str] = Field(default_factory=list)
    diversityBrief: str = ""
    diversityLanes: List[str] = Field(default_factory=list)
    recentLikes: List[str] = Field(default_factory=list)
    recentDislikes: List[str] = Field(default_factory=list)
    batchNumber: int = 1
    count: int = 4


class SynthesizedPlan(BaseModel):
    id: str
    strategy: str
    hypothesis: str
    prompt: str
    negativePrompt: str
    targetAttributes: List[str] = Field(default_factory=list)


class SwipePromptSynthesisResponse(BaseModel):
    plans: List[SynthesizedPlan]


class SwipeImageAnalysisItem(BaseModel):
    planId: str
    imageUrl: str


class SwipeImageAnalysisRequest(BaseModel):
    images: List[SwipeImageAnalysisItem]


class SwipeImageAnalysisResult(BaseModel):
    planId: str
    features: Dict[str, float] = Field(default_factory=dict)
    imageSummary: str = ""
    rationaleSuggestions: List[str] = Field(default_factory=list)
    likeRationaleSuggestions: List[str] = Field(default_factory=list)
    dislikeRationaleSuggestions: List[str] = Field(default_factory=list)


class SwipeImageAnalysisResponse(BaseModel):
    results: List[SwipeImageAnalysisResult] = Field(default_factory=list)


class SwipeClarificationRequest(BaseModel):
    brandName: str = ""
    category: str = ""
    goal: str = ""
    leanInto: List[str] = Field(default_factory=list)
    avoidFacets: List[str] = Field(default_factory=list)
    testNext: List[str] = Field(default_factory=list)
    recentLikes: List[str] = Field(default_factory=list)
    recentDislikes: List[str] = Field(default_factory=list)
    summary: str = ""
    batchComplete: bool = False
    swipeCount: int = 0
    recentQuestions: List[str] = Field(default_factory=list)


class SwipeClarificationResponse(BaseModel):
    mode: str
    message: str
    options: List[str] = Field(default_factory=list)
    internalReason: str = ""
