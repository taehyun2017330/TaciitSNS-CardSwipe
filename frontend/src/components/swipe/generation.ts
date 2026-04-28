import { apiFetch } from '../../api';
import type {
  ImageCandidate,
  OnboardingState,
  SwipeImageGenerationResponse
} from '../../preference/types';
import type { ImageAnalysisPayload } from '../../preference/analysis';

export const SLATE_SIZE = 8;
export const IMAGE_GENERATION_CONCURRENCY = 4;

export function buildSwipeImageGenerationRequest(
  onboarding: OnboardingState,
  selectedCandidates: ImageCandidate[],
  referenceImageUrl: string | null = null,
  batchNumber: number = 1
) {
  const exploitIndex = referenceImageUrl
    ? selectedCandidates.findIndex(candidate => candidate.strategy === 'exploit')
    : -1;

  return {
    brandName: onboarding.brandName,
    category: onboarding.category,
    goal: onboarding.goal,
    audience: onboarding.audience,
    tone: onboarding.tone.join(', '),
    avoid: onboarding.avoid,
    referenceImageUrl: referenceImageUrl ?? '',
    batchNumber,
    plans: selectedCandidates.map((candidate, index) => ({
      id: candidate.id,
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      useReference: index === exploitIndex
    }))
  };
}

export async function requestSwipeImages(
  onboarding: OnboardingState,
  selectedCandidates: ImageCandidate[],
  referenceImageUrl: string | null = null,
  batchNumber: number = 1
): Promise<SwipeImageGenerationResponse> {
  const response = await apiFetch('/api/swipe/generate-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSwipeImageGenerationRequest(onboarding, selectedCandidates, referenceImageUrl, batchNumber))
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Image generation failed with ${response.status}`);
  }

  return response.json();
}

export function makeSlate(candidates: ImageCandidate[], batchId: string, size = SLATE_SIZE): ImageCandidate[] {
  if (!candidates.length) {
    return [];
  }

  return Array.from({ length: size }, (_, index) => {
    const existing = candidates[index];
    const base = existing ?? candidates[index % candidates.length];
    return {
      ...base,
      id: existing ? base.id : `${batchId}-fallback-plan-${index}`,
      imageId: `${batchId}-image-${index}`,
      batchId
    };
  });
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
}

export function requireReadyAnalysis(analysis: ImageAnalysisPayload | undefined): ImageAnalysisPayload {
  if (!analysis) {
    throw new Error('Vision analysis returned no result for this image.');
  }

  const shared = analysis.rationaleSuggestions.map(item => item.trim()).filter(Boolean);
  const likeRationales = analysis.likeRationaleSuggestions.map(item => item.trim()).filter(Boolean);
  const dislikeRationales = analysis.dislikeRationaleSuggestions.map(item => item.trim()).filter(Boolean);
  const readyLikeRationales = likeRationales.length ? likeRationales : shared;
  const readyDislikeRationales = dislikeRationales.length ? dislikeRationales : shared;

  if (!readyLikeRationales.length || !readyDislikeRationales.length) {
    throw new Error('Vision analysis returned no rationale suggestions.');
  }

  return {
    ...analysis,
    imageSummary: analysis.imageSummary.trim(),
    rationaleSuggestions: shared,
    likeRationaleSuggestions: readyLikeRationales,
    dislikeRationaleSuggestions: readyDislikeRationales
  };
}
