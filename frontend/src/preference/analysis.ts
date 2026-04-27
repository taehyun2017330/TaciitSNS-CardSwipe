import { apiFetch } from '../api';
import type { FeatureVector } from './types';

interface AnalysisResult {
  planId: string;
  features: Partial<FeatureVector>;
}

interface AnalysisResponse {
  results: AnalysisResult[];
}

export async function requestImageAnalysis(
  images: Array<{ planId: string; imageUrl: string }>
): Promise<Map<string, Partial<FeatureVector>>> {
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
  const map = new Map<string, Partial<FeatureVector>>();
  for (const result of body.results ?? []) {
    map.set(result.planId, result.features ?? {});
  }
  return map;
}
