import { FEATURE_KEYS } from './features';
import { REASON_EQUIVALENT_SWIPES } from './constants';
import {
  applyFacetEvidence,
  decayPreferenceEvidence,
  decayPreferenceFacet,
  getTopFacets,
  refreshPreferenceDerivedState
} from './state';
import type {
  BubbleAction,
  FeatureKey,
  FeedbackEvent,
  PreferenceState
} from './types';

export function applyClarificationAnswer(state: PreferenceState, bubble: BubbleAction, answer: string): PreferenceState {
  const next: PreferenceState = decayPreferenceEvidence({
    ...state,
    version: state.version + 1,
    facets: { ...state.facets },
    unresolvedTerms: state.unresolvedTerms.map(term =>
      term.term === bubble.unresolvedTerm ? { ...term, asked: true } : term
    ),
    ambiguities: state.ambiguities.map(item =>
      item.feature === bubble.target ? { ...item, asked: true } : item
    ),
    contradictions: state.contradictions.map(item =>
      item.feature === bubble.target ? { ...item, asked: true } : item
    ),
    questionHistory: [...state.questionHistory, bubble.message]
  });

  const reinforce = (feature: FeatureKey, directionWeight: number, evidenceStrength = 0.18) => {
    const previous = next.facets[feature];
    next.facets[feature] = applyFacetEvidence(previous, {
      polarity: directionWeight >= 0 ? 1 : -1,
      amount: Math.max(Math.abs(directionWeight), evidenceStrength) * REASON_EQUIVALENT_SWIPES,
      sourceType: 'clarification'
    });
  };

  if (bubble.mode === 'summarize') {
    const amount = answer.toLowerCase().startsWith('yes') ? 0.12 : answer.toLowerCase().startsWith('mostly') ? 0.05 : -0.12;
    getTopFacets(state, 'positive', 3).forEach(facet => reinforce(facet.feature, amount, 0.12));
    getTopFacets(state, 'negative', 3).forEach(facet => reinforce(facet.feature, -amount, 0.12));
  }

  if (bubble.unresolvedTerm === 'premium') {
    if (answer.includes('typography')) reinforce('typography.clean', 0.34, 0.26);
    if (answer.includes('discount')) reinforce('marketing.subtlety', 0.34, 0.26);
    if (answer.includes('editorial')) reinforce('composition.editorial', 0.34, 0.26);
    if (answer.includes('palette')) {
      reinforce('palette.brightness', -0.18, 0.16);
      reinforce('mood.premium', 0.22, 0.16);
    }
  }

  if (bubble.unresolvedTerm === 'blue' || bubble.target === 'palette.blueDominance') {
    if (answer.includes('Avoid')) reinforce('palette.blueDominance', -0.46, 0.28);
    if (answer.includes('sunny accent')) {
      reinforce('palette.blueDominance', 0.16, 0.12);
      reinforce('lighting.sunny', 0.2, 0.12);
      reinforce('lighting.moody', -0.22, 0.16);
    }
    if (answer.includes('cold mood')) {
      reinforce('lighting.moody', -0.34, 0.24);
      reinforce('palette.blueDominance', -0.08, 0.08);
    }
  }

  if (bubble.target === 'setting.urban') {
    if (answer.includes('Urban direction is wrong')) reinforce('setting.urban', -0.42, 0.24);
    if (answer.includes('neon is wrong')) {
      reinforce('setting.urban', 0.16, 0.1);
      reinforce('lighting.synthetic', -0.42, 0.28);
    }
    if (answer.includes('wrong execution')) {
      reinforce('setting.urban', 0.1, 0.1);
      reinforce('composition.cluttered', -0.18, 0.12);
      reinforce('lighting.synthetic', -0.22, 0.18);
    }
  }

  if (bubble.mode === 'challenge' && bubble.target) {
    if (answer.includes('goal changed')) {
      FEATURE_KEYS.forEach(feature => {
        const previous = next.facets[feature];
        next.facets[feature] = decayPreferenceFacet(
          previous,
          previous.lastSeenBatch >= state.version - 2 ? 0.86 : 0.62
        );
      });
    } else if (answer.includes('cleaner')) {
      reinforce('mood.energetic', 0.16, 0.12);
      reinforce('composition.cluttered', -0.32, 0.22);
      reinforce('typography.clean', 0.24, 0.18);
    }
  }

  return refreshPreferenceDerivedState(next);
}

export function selectBubbleAction(
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchComplete: boolean
): BubbleAction {
  const message = batchComplete
    ? 'Reading your latest swipes…'
    : state.currentGenerationGuidance.testNext[0]
      ? `Testing ${state.currentGenerationGuidance.testNext[0]}.`
      : state.summary !== 'Waiting for swipe evidence.'
        ? state.summary
        : feedbackEvents.length === 0
          ? 'Swipe a few examples and I will turn the pattern into steering memory.'
          : 'Watching your swipes — I will surface a question when the next batch completes.';

  return {
    mode: 'idle_insight',
    message,
    options: [],
    internalReason: batchComplete
      ? 'Awaiting LLM clarification call.'
      : 'Mid-batch — LLM clarification fires when batch completes.'
  };
}
