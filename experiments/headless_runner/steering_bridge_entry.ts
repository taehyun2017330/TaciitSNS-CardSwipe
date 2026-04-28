import {
  createFeatureVector,
  createInitialPreferenceState,
  extractReasonFacets,
  normalizePreferenceState,
  updateStateFromFeedback
} from '../../frontend/src/preference/model';
import {
  DISLIKE_REASON_FALLBACKS,
  LIKE_REASON_FALLBACKS
} from '../../frontend/src/preference/constants';
import { buildSynthesisRequest } from '../../frontend/src/preference/synthesis';
import { buildSwipeImageGenerationRequest } from '../../frontend/src/components/swipe/generation';
import type {
  FeedbackAction,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceState
} from '../../frontend/src/preference/types';

type BridgeRequest =
  | {
      op: 'initialState';
      onboarding: OnboardingState;
    }
  | {
      op: 'synthesisPayload';
      onboarding: OnboardingState;
      state: PreferenceState;
      feedbackEvents: FeedbackEvent[];
      batchNumber: number;
      count: number;
    }
  | {
      op: 'imageGenerationPayload';
      onboarding: OnboardingState;
      selectedCandidates: ImageCandidate[];
      referenceImageUrl?: string;
      batchNumber: number;
    }
  | {
      op: 'rationaleOptions';
      action: FeedbackAction;
      candidate: Partial<ImageCandidate>;
    }
  | {
      op: 'applyFeedback';
      state: PreferenceState;
      feedbackEvents: FeedbackEvent[];
      candidate: ImageCandidate;
      action: FeedbackAction;
      reasonText: string;
      reasonChips: string[];
      source?: FeedbackEvent['source'];
      batchNumber: number;
      feedbackId?: string;
      createdAt?: string;
    };

function normalizeCandidate(candidate: ImageCandidate): ImageCandidate {
  return {
    ...candidate,
    intendedFeatures: createFeatureVector(candidate.intendedFeatures ?? {})
  };
}

function unique(items: string[], limit = 9) {
  const seen = new Set<string>();
  const output: string[] = [];
  items.forEach(item => {
    const cleaned = item.trim();
    const key = cleaned.toLowerCase();
    if (cleaned && !seen.has(key) && output.length < limit) {
      seen.add(key);
      output.push(cleaned);
    }
  });
  return output;
}

export function handle(request: BridgeRequest) {
  if (request.op === 'initialState') {
    return {
      state: createInitialPreferenceState(request.onboarding),
      feedbackEvents: []
    };
  }

  if (request.op === 'synthesisPayload') {
    return {
      payload: buildSynthesisRequest(
        request.onboarding,
        normalizePreferenceState(request.state, request.onboarding),
        request.feedbackEvents,
        request.batchNumber,
        request.count
      )
    };
  }

  if (request.op === 'imageGenerationPayload') {
    return {
      payload: buildSwipeImageGenerationRequest(
        request.onboarding,
        request.selectedCandidates.map(candidate => normalizeCandidate(candidate)),
        request.referenceImageUrl ?? null,
        request.batchNumber
      )
    };
  }

  if (request.op === 'rationaleOptions') {
    const suggested =
      request.action === 'like'
        ? request.candidate.suggestedLikeRationales ?? request.candidate.suggestedRationales ?? []
        : request.candidate.suggestedDislikeRationales ?? request.candidate.suggestedRationales ?? [];
    const fallbacks = request.action === 'dislike' ? DISLIKE_REASON_FALLBACKS : LIKE_REASON_FALLBACKS;
    return {
      options: unique([...suggested, ...fallbacks].map(item => item.trim()).filter(Boolean))
    };
  }

  if (request.op === 'applyFeedback') {
    const candidate = normalizeCandidate(request.candidate);
    const existing = request.feedbackEvents.find(event => event.imageId === candidate.imageId);
    const extracted = extractReasonFacets(request.reasonText, request.reasonChips, request.action);
    const feedback: FeedbackEvent = {
      id: existing?.id ?? request.feedbackId ?? `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      batchId: candidate.batchId,
      imageId: candidate.imageId,
      action: request.action,
      source: request.source ?? 'keyboard',
      reasonText: request.reasonText.trim(),
      reasonChips: request.reasonChips,
      extractedFacets: extracted.facets,
      createdAt: existing?.createdAt ?? request.createdAt ?? new Date().toISOString()
    };
    const feedbackEvents = existing
      ? request.feedbackEvents.map(event => (event.imageId === candidate.imageId ? feedback : event))
      : [...request.feedbackEvents, feedback];
    const shouldUpdatePreferenceState = !existing || existing.action !== request.action;
    const state = shouldUpdatePreferenceState
      ? updateStateFromFeedback(
          normalizePreferenceState(request.state, {
            brandName: '',
            category: '',
            goal: '',
            audience: '',
            tone: [],
            avoid: ''
          }),
          candidate,
          feedback,
          request.batchNumber,
          feedbackEvents
        )
      : request.state;

    return {
      state,
      feedback,
      feedbackEvents
    };
  }

  throw new Error(`Unsupported bridge operation: ${(request as { op?: string }).op}`);
}
