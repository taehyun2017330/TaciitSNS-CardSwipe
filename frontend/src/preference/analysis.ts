import { apiFetch } from '../api';
import type { FeatureVector } from './types';

interface AnalysisResult {
  planId: string;
  features: Partial<FeatureVector>;
  imageSummary?: string;
  rationaleSuggestions?: string[];
  likeRationaleSuggestions?: string[];
  dislikeRationaleSuggestions?: string[];
}

interface AnalysisResponse {
  results: AnalysisResult[];
}

export interface ImageAnalysisPayload {
  features: Partial<FeatureVector>;
  imageSummary: string;
  rationaleSuggestions: string[];
  likeRationaleSuggestions: string[];
  dislikeRationaleSuggestions: string[];
}

export async function requestImageAnalysis(
  images: Array<{ planId: string; imageUrl: string }>
): Promise<Map<string, ImageAnalysisPayload>> {
  if (!images.length) {
    return new Map();
  }

  const response = await apiFetch('/api/swipe/analyze-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Image analysis failed with ${response.status}`);
  }

  const body = (await response.json()) as AnalysisResponse;
  const map = new Map<string, ImageAnalysisPayload>();
  for (const result of body.results ?? []) {
    map.set(result.planId, {
      features: result.features ?? {},
      imageSummary: result.imageSummary ?? '',
      rationaleSuggestions: (result.rationaleSuggestions ?? []).filter(Boolean),
      likeRationaleSuggestions: (result.likeRationaleSuggestions ?? []).filter(Boolean),
      dislikeRationaleSuggestions: (result.dislikeRationaleSuggestions ?? []).filter(Boolean)
    });
  }
  return map;
}
