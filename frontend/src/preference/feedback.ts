import { FEATURE_KEYS, FEATURE_META } from './features';
import { REASON_EQUIVALENT_SWIPES } from './constants';
import { extractReasonFacets } from './reasonExtraction';
import { updateSemanticMemory } from './semanticMemory';
import {
  applyCandidateFeatureEvidence,
  applyFacetEvidence,
  decayPreferenceEvidence,
  refreshPreferenceDerivedState
} from './state';
import type {
  FeedbackEvent,
  ImageCandidate,
  PreferenceState
} from './types';

export function updateStateFromFeedback(
  state: PreferenceState,
  candidate: ImageCandidate,
  feedback: FeedbackEvent,
  batchNumber: number,
  allFeedback: FeedbackEvent[]
): PreferenceState {
  let next: PreferenceState = decayPreferenceEvidence({
    ...state,
    version: state.version + 1,
    facets: { ...state.facets },
    semanticMemory: updateSemanticMemory(state.semanticMemory, feedback, candidate),
    unresolvedTerms: [...state.unresolvedTerms],
    ambiguities: [...state.ambiguities],
    contradictions: [...state.contradictions],
    lastExtractedFacets: feedback.extractedFacets
  });

  const eventId = feedback.id;

  next = applyCandidateFeatureEvidence(next, candidate, feedback, batchNumber);

  feedback.extractedFacets.forEach(extracted => {
    const previous = next.facets[extracted.feature];
    if (!previous) {
      return;
    }
    next.facets[extracted.feature] = applyFacetEvidence(previous, {
      polarity: extracted.sentiment,
      amount: extracted.confidence * REASON_EQUIVALENT_SWIPES,
      eventId,
      sourceType: 'reason',
      batchNumber
    });
  });

  const extracted = extractReasonFacets(feedback.reasonText, feedback.reasonChips, feedback.action);
  extracted.unresolvedTerms.forEach(term => {
    const alreadyExists = next.unresolvedTerms.some(existing => existing.term === term.term && !existing.asked);
    if (!alreadyExists) {
      next.unresolvedTerms.push({
        ...term,
        feedbackEventId: feedback.id,
        asked: false
      });
    }
  });

  if (
    (candidate.intendedFeatures['palette.blueDominance'] ?? 0) > 0.5 &&
    (candidate.intendedFeatures['lighting.moody'] ?? 0) > 0.45 &&
    feedback.action === 'dislike' &&
    !next.ambiguities.some(item => item.feature === 'palette.blueDominance' && !item.asked)
  ) {
    next.ambiguities.push({
      id: `amb-blue-${feedback.id}`,
      question: 'whether blue itself is wrong, or only cold/moody blue',
      feature: 'palette.blueDominance',
      options: ['Avoid blue completely', 'Blue is okay as a sunny accent', 'The cold mood was the issue'],
      priority: 0.82,
      asked: false
    });
  }

  if (
    (candidate.intendedFeatures['setting.urban'] ?? 0) > 0.62 &&
    (candidate.intendedFeatures['lighting.synthetic'] ?? 0) > 0.55 &&
    feedback.action === 'dislike' &&
    !next.ambiguities.some(item => item.feature === 'setting.urban' && !item.asked)
  ) {
    next.ambiguities.push({
      id: `amb-urban-${feedback.id}`,
      question: 'whether urban is wrong, or just the synthetic neon execution',
      feature: 'setting.urban',
      options: ['Urban direction is wrong', 'Urban is okay, neon is wrong', 'Right direction, wrong execution'],
      priority: 0.76,
      asked: false
    });
  }

  const recent = allFeedback.slice(-5);
  FEATURE_KEYS.forEach(feature => {
    const globalWeight = next.facets[feature].weight;
    const recentWeight = recent.reduce((sum, event) => {
      const eventDirection = event.action === 'like' ? 1 : -1;
      return sum + eventDirection * (event.imageId === candidate.imageId ? candidate.intendedFeatures[feature] ?? 0 : 0);
    }, 0);

    if (
      recent.length >= 4 &&
      Math.sign(globalWeight) !== Math.sign(recentWeight) &&
      Math.abs(globalWeight) > 0.42 &&
      Math.abs(recentWeight) > 0.7 &&
      !next.contradictions.some(item => item.feature === feature && !item.asked)
    ) {
      next.contradictions.push({
        id: `contr-${feature}-${feedback.id}`,
        message: `Earlier evidence pointed ${globalWeight > 0 ? 'toward' : 'away from'} ${FEATURE_META[feature].label}, but recent choices suggest the opposite.`,
        feature,
        globalWeight,
        recentWeight,
        severity: Math.min(1, Math.abs(globalWeight) + Math.abs(recentWeight) / 3),
        asked: false
      });
    }
  });

  return refreshPreferenceDerivedState(next);
}

export function incorporateAnalyzedCandidateFeatures(
  state: PreferenceState,
  analyzedCandidates: ImageCandidate[],
  feedbackEvents: FeedbackEvent[],
  batchNumber: number
): PreferenceState {
  let next = state;
  analyzedCandidates.forEach(candidate => {
    const feedback = feedbackEvents.find(event => event.imageId === candidate.imageId);
    if (!feedback) {
      return;
    }
    next = applyCandidateFeatureEvidence(next, candidate, feedback, batchNumber);
  });
  return next === state ? state : refreshPreferenceDerivedState(next);
}
