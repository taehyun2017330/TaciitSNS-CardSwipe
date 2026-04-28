import { FEATURE_KEYS, FEATURE_META, makeFeatureVector } from './features';
import {
  FEATURE_EVIDENCE_FLOOR,
  PREFERENCE_EVIDENCE_DECAY,
  PREFERENCE_EVIDENCE_SATURATION,
  PREFERENCE_PRIOR_ALPHA,
  PREFERENCE_PRIOR_BETA
} from './constants';
import { createSemanticMemory, normalizeSemanticMemory } from './semanticMemory';
import { chooseStrategyMix } from './strategyPolicy';
import type {
  FeatureKey,
  FeatureVector,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceFacet,
  PreferenceState
} from './types';
import { clamp } from './utils';

type PreferenceFacetSeed = Partial<PreferenceFacet> & Pick<PreferenceFacet, 'feature' | 'label' | 'dimension'>;
type EvidenceSource = PreferenceFacet['sourceTypes'][number];

export function createFeatureVector(values: Partial<FeatureVector>): FeatureVector {
  return makeFeatureVector(values);
}

function hasStoredEvidenceCounts(facet: Partial<PreferenceFacet>) {
  return (
    Number.isFinite(facet.alpha) &&
    Number.isFinite(facet.beta) &&
    Number(facet.alpha) > 0 &&
    Number(facet.beta) > 0
  );
}

function getEvidenceCounts(facet: Partial<PreferenceFacet>) {
  if (hasStoredEvidenceCounts(facet)) {
    return {
      alpha: Math.max(PREFERENCE_PRIOR_ALPHA, Number(facet.alpha)),
      beta: Math.max(PREFERENCE_PRIOR_BETA, Number(facet.beta))
    };
  }

  if (Number.isFinite(facet.weight) && Number.isFinite(facet.confidence)) {
    const direction = clamp(Number(facet.weight));
    const legacyEvidence = clamp(
      Math.max(Math.abs(direction), Number(facet.confidence)),
      0,
      1
    ) * PREFERENCE_EVIDENCE_SATURATION;
    return {
      alpha: PREFERENCE_PRIOR_ALPHA + legacyEvidence * Math.max(0, direction),
      beta: PREFERENCE_PRIOR_BETA + legacyEvidence * Math.max(0, -direction)
    };
  }

  return {
    alpha: PREFERENCE_PRIOR_ALPHA,
    beta: PREFERENCE_PRIOR_BETA
  };
}

export function derivePreferenceFacet(facet: PreferenceFacetSeed): PreferenceFacet {
  const { alpha, beta } = getEvidenceCounts(facet);
  const total = alpha + beta;
  const mean = total > 0 ? alpha / total : 0.5;
  const weight = clamp((mean - 0.5) * 2);
  const directionConfidence = clamp(Math.abs(mean - 0.5) * 2, 0, 1);
  const evidenceVolume = Math.max(0, total - PREFERENCE_PRIOR_ALPHA - PREFERENCE_PRIOR_BETA);
  const evidenceConfidence = clamp(evidenceVolume / PREFERENCE_EVIDENCE_SATURATION, 0, 1);

  return {
    feature: facet.feature,
    label: facet.label,
    dimension: facet.dimension,
    alpha,
    beta,
    mean,
    weight,
    directionConfidence,
    evidenceConfidence,
    confidence: directionConfidence * evidenceConfidence,
    evidenceVolume,
    evidenceFor: facet.evidenceFor ?? [],
    evidenceAgainst: facet.evidenceAgainst ?? [],
    sourceTypes: facet.sourceTypes ?? [],
    lastSeenBatch: facet.lastSeenBatch ?? 0
  };
}

function createEmptyPreferenceFacet(feature: FeatureKey): PreferenceFacet {
  return derivePreferenceFacet({
    feature,
    label: FEATURE_META[feature].label,
    dimension: FEATURE_META[feature].dimension,
    alpha: PREFERENCE_PRIOR_ALPHA,
    beta: PREFERENCE_PRIOR_BETA,
    evidenceFor: [],
    evidenceAgainst: [],
    sourceTypes: [],
    lastSeenBatch: 0
  });
}

function derivePreferenceFacets(facets: PreferenceState['facets']) {
  return FEATURE_KEYS.reduce((acc, key) => {
    const empty = createEmptyPreferenceFacet(key);
    const existing = facets?.[key] as Partial<PreferenceFacet> | undefined;
    acc[key] = existing
      ? derivePreferenceFacet({
          ...empty,
          ...existing,
          alpha: existing.alpha,
          beta: existing.beta,
          feature: key,
          label: FEATURE_META[key].label,
          dimension: FEATURE_META[key].dimension
        })
      : empty;
    return acc;
  }, {} as Record<FeatureKey, PreferenceFacet>);
}

export function decayPreferenceFacet(facet: PreferenceFacet, decay = PREFERENCE_EVIDENCE_DECAY): PreferenceFacet {
  const derived = derivePreferenceFacet(facet);
  return derivePreferenceFacet({
    ...derived,
    alpha: PREFERENCE_PRIOR_ALPHA + (derived.alpha - PREFERENCE_PRIOR_ALPHA) * decay,
    beta: PREFERENCE_PRIOR_BETA + (derived.beta - PREFERENCE_PRIOR_BETA) * decay
  });
}

export function decayPreferenceEvidence(state: PreferenceState, decay = PREFERENCE_EVIDENCE_DECAY): PreferenceState {
  return {
    ...state,
    facets: FEATURE_KEYS.reduce((acc, key) => {
      acc[key] = decayPreferenceFacet(state.facets[key], decay);
      return acc;
    }, {} as Record<FeatureKey, PreferenceFacet>)
  };
}

export function applyFacetEvidence(
  facet: PreferenceFacet,
  options: {
    polarity: 1 | -1;
    amount: number;
    eventId?: string;
    sourceType: EvidenceSource;
    batchNumber?: number;
  }
): PreferenceFacet {
  const amount = Math.max(0, options.amount);
  const derived = derivePreferenceFacet(facet);
  if (amount <= 0) {
    return derived;
  }

  return derivePreferenceFacet({
    ...derived,
    alpha: derived.alpha + (options.polarity === 1 ? amount : 0),
    beta: derived.beta + (options.polarity === -1 ? amount : 0),
    evidenceFor:
      options.polarity === 1 && options.eventId
        ? [...derived.evidenceFor, options.eventId]
        : derived.evidenceFor,
    evidenceAgainst:
      options.polarity === -1 && options.eventId
        ? [...derived.evidenceAgainst, options.eventId]
        : derived.evidenceAgainst,
    sourceTypes: Array.from(new Set([...derived.sourceTypes, options.sourceType] as PreferenceFacet['sourceTypes'])),
    lastSeenBatch: options.batchNumber ?? derived.lastSeenBatch
  });
}

export function getTopFacets(state: PreferenceState, polarity: 'positive' | 'negative', count = 4) {
  return FEATURE_KEYS
    .map(key => state.facets[key])
    .filter(Boolean)
    .filter(facet => (polarity === 'positive' ? facet.weight > 0.12 : facet.weight < -0.12))
    .sort((a, b) => {
      const left = Math.abs(a.weight) * (0.6 + a.confidence);
      const right = Math.abs(b.weight) * (0.6 + b.confidence);
      return right - left;
    })
    .slice(0, count);
}

export function refreshPreferenceDerivedState(state: PreferenceState): PreferenceState {
  const facets = derivePreferenceFacets(state.facets);
  const semanticMemory = normalizeSemanticMemory(state.semanticMemory);
  const derivedState = {
    ...state,
    facets,
    semanticMemory
  };
  const positive = getTopFacets(derivedState, 'positive', 5);
  const negative = getTopFacets(derivedState, 'negative', 5);
  const uncertainStrong = FEATURE_KEYS
    .map(key => facets[key])
    .filter(Boolean)
    .filter(facet => facet.evidenceVolume >= 1.5 && facet.directionConfidence < 0.35)
    .slice(0, 3);

  const summaryParts = [];
  if (positive.length) {
    summaryParts.push(`Leaning toward ${positive.slice(0, 3).map(f => f.label).join(', ')}.`);
  }
  if (negative.length) {
    summaryParts.push(`Avoiding ${negative.slice(0, 3).map(f => f.label).join(', ')}.`);
  }
  if (semanticMemory.styleBrief !== 'No semantic style evidence yet.') {
    summaryParts.push(semanticMemory.styleBrief);
  }

  const strategyMix = chooseStrategyMix(derivedState as PreferenceState, [], state.version);

  return {
    ...derivedState,
    semanticMemory,
    summary: summaryParts.join(' ') || 'Waiting for swipe evidence.',
    currentGenerationGuidance: {
      leanInto: [
        ...positive.map(facet => facet.label),
        ...semanticMemory.likedDirections.slice(0, 4).map(signal => signal.label)
      ].slice(0, 8),
      avoid: [
        ...negative.map(facet => facet.label),
        ...semanticMemory.hardAvoids.slice(0, 4).map(signal => signal.label),
        ...semanticMemory.dislikedDirections.slice(0, 3).map(signal => signal.label)
      ].slice(0, 8),
      testNext: [
        ...state.unresolvedTerms
          .filter(term => !term.asked)
          .slice(0, 2)
          .map(term => `what "${term.term}" should mean visually`),
        ...semanticMemory.uncertainties.slice(0, 2),
        ...state.ambiguities
          .filter(item => !item.asked)
          .slice(0, 2)
          .map(item => item.question),
        ...uncertainStrong.map(facet => `whether ${facet.label} is a true preference`)
      ].slice(0, 4),
      semanticBrief: semanticMemory.styleBrief,
      strategyMix
    }
  };
}

export function createInitialPreferenceState(_onboarding: OnboardingState): PreferenceState {
  const facets = FEATURE_KEYS.reduce((acc, feature) => {
    acc[feature] = createEmptyPreferenceFacet(feature);
    return acc;
  }, {} as Record<FeatureKey, PreferenceFacet>);

  return refreshPreferenceDerivedState({
    version: 1,
    summary: 'Waiting for swipe evidence.',
    facets,
    semanticMemory: createSemanticMemory(),
    visionEvidenceImageIds: [],
    unresolvedTerms: [],
    ambiguities: [],
    contradictions: [],
    currentGenerationGuidance: {
      leanInto: [],
      avoid: [],
      testNext: [],
      semanticBrief: '',
      strategyMix: ['explore', 'explore', 'diagnostic', 'exploit']
    },
    lastExtractedFacets: [],
    questionHistory: []
  });
}

export function normalizePreferenceState(state: PreferenceState | null | undefined, onboarding: OnboardingState): PreferenceState {
  if (!state) {
    return createInitialPreferenceState(onboarding);
  }

  const fresh = createInitialPreferenceState(onboarding);
  const facets = FEATURE_KEYS.reduce((acc, key) => {
    const existing = state.facets?.[key] as Partial<PreferenceFacet> | undefined;
    acc[key] = existing
      ? derivePreferenceFacet({
          ...fresh.facets[key],
          ...existing,
          alpha: existing.alpha,
          beta: existing.beta,
          feature: key,
          label: FEATURE_META[key].label,
          dimension: FEATURE_META[key].dimension
        })
      : fresh.facets[key];
    return acc;
  }, {} as Record<FeatureKey, PreferenceFacet>);

  return refreshPreferenceDerivedState({
    ...fresh,
    ...state,
    facets,
    semanticMemory: normalizeSemanticMemory(state.semanticMemory),
    visionEvidenceImageIds: state.visionEvidenceImageIds ?? [],
    currentGenerationGuidance: {
      ...fresh.currentGenerationGuidance,
      ...state.currentGenerationGuidance
    }
  });
}

export function applyCandidateFeatureEvidence(
  state: PreferenceState,
  candidate: ImageCandidate,
  feedback: FeedbackEvent,
  batchNumber: number
) {
  if (state.visionEvidenceImageIds.includes(candidate.imageId)) {
    return state;
  }

  let touched = false;
  const direction = feedback.action === 'like' ? 1 : -1;
  const eventId = feedback.id;
  const next: PreferenceState = {
    ...state,
    facets: { ...state.facets }
  };

  FEATURE_KEYS.forEach(feature => {
    const value = candidate.intendedFeatures[feature] ?? 0;
    if (value < FEATURE_EVIDENCE_FLOOR) {
      return;
    }

    const previous = next.facets[feature];
    touched = true;
    next.facets[feature] = applyFacetEvidence(previous, {
      polarity: direction,
      amount: value,
      eventId,
      sourceType: 'swipe',
      batchNumber
    });
  });

  return touched
    ? {
        ...next,
        visionEvidenceImageIds: [...next.visionEvidenceImageIds, candidate.imageId]
      }
    : next;
}
