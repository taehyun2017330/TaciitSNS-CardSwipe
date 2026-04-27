import { archetypes } from './archetypes';
import { EMPTY_FEATURES, FEATURE_KEYS, FEATURE_META } from './features';
import type {
  AmbiguityRecord,
  BubbleAction,
  ContradictionRecord,
  ExtractedReasonFacet,
  FeatureKey,
  FeatureVector,
  FeedbackAction,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceFacet,
  PreferenceState,
  PromptPlan,
  PromptStrategy,
  UnresolvedTerm
} from './types';
import { clamp } from './utils';

export function createFeatureVector(values: Partial<FeatureVector>): FeatureVector {
  return {
    ...EMPTY_FEATURES,
    ...values
  };
}

export function getTopFacets(state: PreferenceState, polarity: 'positive' | 'negative', count = 4) {
  return FEATURE_KEYS
    .map(key => state.facets[key])
    .filter(facet => (polarity === 'positive' ? facet.weight > 0.12 : facet.weight < -0.12))
    .sort((a, b) => {
      const left = Math.abs(a.weight) * (0.6 + a.confidence);
      const right = Math.abs(b.weight) * (0.6 + b.confidence);
      return right - left;
    })
    .slice(0, count);
}

export function refreshPreferenceDerivedState(state: PreferenceState): PreferenceState {
  const positive = getTopFacets(state, 'positive', 5);
  const negative = getTopFacets(state, 'negative', 5);
  const uncertainStrong = FEATURE_KEYS
    .map(key => state.facets[key])
    .filter(facet => Math.abs(facet.weight) > 0.22 && facet.confidence < 0.55)
    .slice(0, 3);

  const summaryParts = [];
  if (positive.length) {
    summaryParts.push(`Leaning toward ${positive.slice(0, 3).map(f => f.label).join(', ')}.`);
  }
  if (negative.length) {
    summaryParts.push(`Avoiding ${negative.slice(0, 3).map(f => f.label).join(', ')}.`);
  }

  return {
    ...state,
    summary: summaryParts.join(' ') || 'Waiting for swipe evidence.',
    currentGenerationGuidance: {
      leanInto: positive.map(facet => facet.label),
      avoid: negative.map(facet => facet.label),
      testNext: [
        ...state.unresolvedTerms
          .filter(term => !term.asked)
          .slice(0, 2)
          .map(term => `what "${term.term}" should mean visually`),
        ...state.ambiguities
          .filter(item => !item.asked)
          .slice(0, 2)
          .map(item => item.question),
        ...uncertainStrong.map(facet => `whether ${facet.label} is a true preference`)
      ].slice(0, 4)
    }
  };
}

export function createInitialPreferenceState(onboarding: OnboardingState): PreferenceState {
  const facets = FEATURE_KEYS.reduce((acc, feature) => {
    acc[feature] = {
      feature,
      label: FEATURE_META[feature].label,
      dimension: FEATURE_META[feature].dimension,
      weight: 0,
      confidence: 0,
      evidenceFor: [],
      evidenceAgainst: [],
      sourceTypes: [],
      lastSeenBatch: 0
    };
    return acc;
  }, {} as Record<FeatureKey, PreferenceFacet>);

  const toneToFeatures: Record<string, FeatureKey[]> = {
    premium: ['mood.premium', 'typography.clean', 'marketing.subtlety'],
    warm: ['palette.warmth', 'lighting.sunny'],
    playful: ['mood.playful', 'typography.playful'],
    credible: ['mood.credible', 'composition.editorial'],
    calm: ['mood.calm', 'composition.minimal'],
    energetic: ['mood.energetic', 'composition.dynamic'],
    editorial: ['composition.editorial', 'mood.premium'],
    minimal: ['composition.minimal', 'typography.clean']
  };

  onboarding.tone.forEach(tone => {
    toneToFeatures[tone]?.forEach(feature => {
      facets[feature] = {
        ...facets[feature],
        weight: clamp(facets[feature].weight + 0.22),
        confidence: clamp(facets[feature].confidence + 0.24, 0, 1),
        sourceTypes: Array.from(new Set([...facets[feature].sourceTypes, 'onboarding']))
      };
    });
  });

  if (onboarding.avoid.toLowerCase().includes('clutter')) {
    facets['composition.cluttered'] = {
      ...facets['composition.cluttered'],
      weight: -0.32,
      confidence: 0.34,
      sourceTypes: ['onboarding']
    };
  }

  if (onboarding.avoid.toLowerCase().includes('discount') || onboarding.avoid.toLowerCase().includes('promo')) {
    facets['marketing.saleEmphasis'] = {
      ...facets['marketing.saleEmphasis'],
      weight: -0.28,
      confidence: 0.31,
      sourceTypes: ['onboarding']
    };
  }

  return refreshPreferenceDerivedState({
    version: 1,
    summary: 'Waiting for swipe evidence.',
    facets,
    unresolvedTerms: [],
    ambiguities: [],
    contradictions: [],
    currentGenerationGuidance: {
      leanInto: [],
      avoid: [],
      testNext: []
    },
    lastExtractedFacets: [],
    questionHistory: []
  });
}

export function extractReasonFacets(reasonText: string, reasonChips: string[], action: FeedbackAction): {
  facets: ExtractedReasonFacet[];
  unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>>;
} {
  const text = `${reasonText} ${reasonChips.join(' ')}`.toLowerCase();
  const direction: 1 | -1 = action === 'like' ? 1 : -1;
  const facets: ExtractedReasonFacet[] = [];
  const unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>> = [];

  const add = (feature: FeatureKey, sentiment: 1 | -1, confidence: number, source: string) => {
    facets.push({
      feature,
      label: FEATURE_META[feature].label,
      sentiment,
      confidence,
      source
    });
  };

  if (!text.trim()) {
    return { facets, unresolvedTerms };
  }

  if (/premium|expensive|luxury|elevated|high[- ]end/.test(text)) {
    add('mood.premium', direction, 0.74, 'premium');
    add('typography.clean', direction, 0.48, 'premium');
    unresolvedTerms.push({
      term: 'premium',
      possibleMeanings: ['cleaner typography', 'lower discount emphasis', 'more editorial composition', 'darker/refined palette'],
      mappingConfidence: 0.42
    });
  }

  if (/cheap|discounty|salesy|too promotional|promo|loud sale/.test(text)) {
    add('mood.cheap', action === 'like' ? 1 : -1, 0.84, 'cheap/promotional');
    add('marketing.saleEmphasis', action === 'like' ? 1 : -1, 0.82, 'cheap/promotional');
    add('marketing.subtlety', action === 'like' ? -1 : 1, 0.72, 'cheap/promotional');
  }

  if (/clean|simple|minimal|not busy/.test(text)) {
    add('composition.minimal', direction, 0.78, 'clean/minimal');
    add('typography.clean', direction, 0.74, 'clean/minimal');
  }

  if (/clutter|busy|too much|crowded/.test(text)) {
    add('composition.cluttered', action === 'like' ? 1 : -1, 0.86, 'clutter');
  }

  if (/bright|sunny|light/.test(text)) {
    add('palette.brightness', direction, 0.74, 'bright/sunny');
    add('lighting.sunny', direction, 0.7, 'bright/sunny');
  }

  if (/warm|coral|yellow|gold|sand/.test(text)) {
    add('palette.warmth', direction, 0.72, 'warm color');
  }

  if (/blue|cool|cold/.test(text)) {
    add('palette.blueDominance', direction, 0.68, 'blue/cool');
    unresolvedTerms.push({
      term: 'blue',
      possibleMeanings: ['avoid blue completely', 'avoid cold blue dominance', 'allow sunny blue accents'],
      mappingConfidence: 0.46
    });
  }

  if (/beach|coastal|summer|outdoor/.test(text)) {
    add('setting.coastal', direction, 0.78, 'coastal');
  }

  if (/urban|city|street/.test(text)) {
    add('setting.urban', direction, 0.7, 'urban');
  }

  if (/editorial|campaign|magazine/.test(text)) {
    add('composition.editorial', direction, 0.8, 'editorial');
  }

  if (/generic|stock|template/.test(text)) {
    add('mood.credible', action === 'like' ? -1 : 1, 0.7, 'generic');
    unresolvedTerms.push({
      term: 'generic',
      possibleMeanings: ['too template-like', 'wrong audience', 'weak product specificity', 'not enough brand personality'],
      mappingConfidence: 0.39
    });
  }

  if (/neon|synthetic|fake|ai/.test(text)) {
    add('lighting.synthetic', action === 'like' ? 1 : -1, 0.84, 'synthetic lighting');
  }

  if (/calm|quiet|restrained/.test(text)) {
    add('mood.calm', direction, 0.76, 'calm');
  }

  if (/energy|energetic|bold|movement/.test(text)) {
    add('mood.energetic', direction, 0.76, 'energy');
  }

  return { facets, unresolvedTerms };
}

export function scorePlan(
  features: FeatureVector,
  state: PreferenceState,
  onboarding: OnboardingState,
  selectedPlans: PromptPlan[]
): PromptPlan['scoreBreakdown'] {
  const preferenceMatch = FEATURE_KEYS.reduce((sum, key) => {
    const facet = state.facets[key];
    return sum + features[key] * facet.weight * (0.55 + facet.confidence);
  }, 0);

  const userGoalText = `${onboarding.goal} ${onboarding.category} ${onboarding.tone.join(' ')}`.toLowerCase();
  const userGoalAlignment =
    (userGoalText.includes('sale') ? features['marketing.saleEmphasis'] * 0.18 + features['marketing.subtlety'] * 0.24 : 0.1) +
    (userGoalText.includes('premium') || userGoalText.includes('cheap')
      ? features['mood.premium'] * 0.24 + features['mood.credible'] * 0.18
      : 0.08) +
    (userGoalText.includes('fashion') ? features['composition.editorial'] * 0.16 : 0.06);

  const diversityBonus = selectedPlans.length
    ? Math.min(
        0.6,
        selectedPlans.reduce((sum, plan) => {
          const distance = FEATURE_KEYS.reduce((total, key) => total + Math.abs(features[key] - plan.intendedFeatures[key]), 0);
          return sum + distance / FEATURE_KEYS.length;
        }, 0) / selectedPlans.length
      )
    : 0.35;

  const informationGain = Math.min(
    0.8,
    state.currentGenerationGuidance.testNext.length * 0.08 +
      FEATURE_KEYS.reduce((sum, key) => {
        const facet = state.facets[key];
        return sum + (Math.abs(facet.weight) > 0.2 && facet.confidence < 0.56 && features[key] > 0.35 ? 0.07 : 0);
      }, 0)
  );

  const repairValue = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + (1 - features[facet.feature]) * Math.abs(facet.weight) * 0.16;
  }, 0);

  const dislikedFeaturePenalty = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + Math.max(0, features[facet.feature] - 0.3) * Math.abs(facet.weight) * (0.8 + facet.confidence);
  }, 0);

  const finalScore =
    0.4 * preferenceMatch +
    0.2 * userGoalAlignment +
    0.15 * diversityBonus +
    0.15 * informationGain +
    0.1 * repairValue -
    0.3 * dislikedFeaturePenalty;

  return {
    preferenceMatch,
    userGoalAlignment,
    diversityBonus,
    informationGain,
    repairValue,
    dislikedFeaturePenalty,
    finalScore
  };
}

export function buildPromptPlans(onboarding: OnboardingState, state: PreferenceState, batchNumber: number): PromptPlan[] {
  const selectedForScoring: PromptPlan[] = [];

  return archetypes.map((archetype, index) => {
    const features = createFeatureVector(archetype.features);
    const scoreBreakdown = scorePlan(features, state, onboarding, selectedForScoring);
    const batchId = `batch-${batchNumber}`;
    const positive = state.currentGenerationGuidance.leanInto.slice(0, 2).join(' and ');
    const negative = state.currentGenerationGuidance.avoid.slice(0, 2).join(' and ');
    const hypothesis =
      batchNumber === 1
        ? `Initial read on whether ${archetype.tags.slice(0, 2).join(' + ')} fits the goal.`
        : archetype.strategy === 'diagnostic'
          ? `Test ${archetype.tags[0]} against current uncertainty.`
          : archetype.strategy === 'repair'
            ? `Repair recent dislikes by reducing ${negative || 'risky visual cues'}.`
            : `Lean into ${positive || archetype.tags[0]} while keeping the slate varied.`;

    const plan: PromptPlan = {
      id: `${batchId}-plan-${index}`,
      batchId,
      strategy: archetype.strategy,
      hypothesis,
      prompt: archetype.prompt,
      negativePrompt: archetype.negativePrompt,
      intendedFeatures: features,
      scoreBreakdown,
      rationale:
        batchNumber === 1
          ? 'Seed the model with a wide but relevant taste sample.'
          : `Score balances preference match, repair value, and diagnostic value for ${archetype.name}.`
    };
    selectedForScoring.push(plan);
    return plan;
  });
}

export function selectSlate(plans: PromptPlan[]): PromptPlan[] {
  const sorted = [...plans].sort((a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore);
  const selected: PromptPlan[] = [];
  const preferredStrategies: PromptStrategy[] = ['exploit', 'repair', 'diagnostic', 'explore'];

  preferredStrategies.forEach(strategy => {
    const next = sorted.find(plan => plan.strategy === strategy && !selected.some(existing => existing.id === plan.id));
    if (next) {
      selected.push(next);
    }
  });

  sorted.forEach(plan => {
    if (selected.length < 4 && !selected.some(existing => existing.id === plan.id)) {
      selected.push(plan);
    }
  });

  return selected.slice(0, 4);
}

export function createCandidateFromPlan(plan: PromptPlan, index: number): ImageCandidate {
  const archetype = archetypes.find(item => plan.prompt.includes(item.prompt.slice(0, 28))) ?? archetypes[index % archetypes.length];
  return {
    ...plan,
    imageId: `${plan.batchId}-image-${index}`,
    generationStatus: 'mock',
    caption: archetype.prompt,
    tags: archetype.tags,
    visual: archetype.visual
  };
}

export function generateBatch(onboarding: OnboardingState, state: PreferenceState, batchNumber: number) {
  const plans = buildPromptPlans(onboarding, state, batchNumber);
  const slate = selectSlate(plans);
  return {
    batchId: `batch-${batchNumber}`,
    promptPlans: plans,
    candidates: slate.map(createCandidateFromPlan)
  };
}

export function updateStateFromFeedback(
  state: PreferenceState,
  candidate: ImageCandidate,
  feedback: FeedbackEvent,
  batchNumber: number,
  allFeedback: FeedbackEvent[]
): PreferenceState {
  const next: PreferenceState = {
    ...state,
    version: state.version + 1,
    facets: { ...state.facets },
    unresolvedTerms: [...state.unresolvedTerms],
    ambiguities: [...state.ambiguities],
    contradictions: [...state.contradictions],
    lastExtractedFacets: feedback.extractedFacets
  };

  const direction = feedback.action === 'like' ? 1 : -1;
  const eventId = feedback.id;

  FEATURE_KEYS.forEach(feature => {
    const value = candidate.intendedFeatures[feature];
    if (value < 0.25) {
      return;
    }

    const previous = next.facets[feature];
    const delta = direction * value * 0.075;
    const sourceTypes = Array.from(new Set([...previous.sourceTypes, 'swipe'] as PreferenceFacet['sourceTypes']));

    next.facets[feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + Math.abs(value) * 0.035, 0, 1),
      evidenceFor: direction === 1 ? [...previous.evidenceFor, eventId] : previous.evidenceFor,
      evidenceAgainst: direction === -1 ? [...previous.evidenceAgainst, eventId] : previous.evidenceAgainst,
      sourceTypes,
      lastSeenBatch: batchNumber
    };
  });

  feedback.extractedFacets.forEach(extracted => {
    const previous = next.facets[extracted.feature];
    const delta = extracted.sentiment * extracted.confidence * 0.24;
    const sourceTypes = Array.from(new Set([...previous.sourceTypes, 'reason'] as PreferenceFacet['sourceTypes']));
    next.facets[extracted.feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + extracted.confidence * 0.2, 0, 1),
      evidenceFor: extracted.sentiment === 1 ? [...previous.evidenceFor, eventId] : previous.evidenceFor,
      evidenceAgainst: extracted.sentiment === -1 ? [...previous.evidenceAgainst, eventId] : previous.evidenceAgainst,
      sourceTypes,
      lastSeenBatch: batchNumber
    };
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
    candidate.intendedFeatures['palette.blueDominance'] > 0.5 &&
    candidate.intendedFeatures['lighting.moody'] > 0.45 &&
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
    candidate.intendedFeatures['setting.urban'] > 0.62 &&
    candidate.intendedFeatures['lighting.synthetic'] > 0.55 &&
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
      return sum + eventDirection * (event.imageId === candidate.imageId ? candidate.intendedFeatures[feature] : 0);
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

export function applyClarificationAnswer(state: PreferenceState, bubble: BubbleAction, answer: string): PreferenceState {
  const next: PreferenceState = {
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
  };

  const reinforce = (feature: FeatureKey, delta: number, confidence = 0.18) => {
    const previous = next.facets[feature];
    next.facets[feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + confidence, 0, 1),
      sourceTypes: Array.from(new Set([...previous.sourceTypes, 'clarification'] as PreferenceFacet['sourceTypes']))
    };
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
        next.facets[feature] = {
          ...previous,
          weight: previous.lastSeenBatch >= state.version - 2 ? previous.weight : previous.weight * 0.62,
          confidence: previous.confidence * 0.86
        };
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
  const recentQuestions = new Set(state.questionHistory.slice(-4));
  const latestFeedback = feedbackEvents[feedbackEvents.length - 1];
  const latestReason = latestFeedback?.reasonText || latestFeedback?.reasonChips.join(' ') || '';

  const unresolved = state.unresolvedTerms.find(term => !term.asked && term.mappingConfidence < 0.55);
  if (unresolved && latestReason.toLowerCase().includes(unresolved.term)) {
    const message =
      unresolved.term === 'premium'
        ? 'When you say "premium," what should I change first?'
        : unresolved.term === 'blue'
          ? 'Should blue be avoided completely, or is it okay when it feels sunny and secondary?'
          : `When you say "${unresolved.term}," what should I treat as the real issue?`;

    if (!recentQuestions.has(message)) {
      return {
        mode: 'probe',
        message,
        options: unresolved.possibleMeanings,
        unresolvedTerm: unresolved.term,
        internalReason: `Low mapping confidence for "${unresolved.term}" (${unresolved.mappingConfidence.toFixed(2)}).`
      };
    }
  }

  const contradiction = state.contradictions.find(item => !item.asked && item.severity > 0.65);
  if (contradiction && feedbackEvents.length >= 6) {
    const message = `${contradiction.message} Has the goal changed?`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'challenge',
        message,
        options: ['My goal changed', 'Same goal, wrong earlier execution', 'Still want that energy, just cleaner'],
        target: contradiction.feature,
        internalReason: `Global weight ${contradiction.globalWeight.toFixed(2)} conflicts with recent weight ${contradiction.recentWeight.toFixed(2)}.`
      };
    }
  }

  const ambiguity = state.ambiguities.find(item => !item.asked && item.priority > 0.7);
  if (ambiguity && (batchComplete || feedbackEvents.length >= 3)) {
    const message = `I need to separate two things: ${ambiguity.question}.`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'clarify',
        message,
        options: ambiguity.options,
        target: ambiguity.feature,
        internalReason: `Ambiguity priority ${ambiguity.priority.toFixed(2)} for ${FEATURE_META[ambiguity.feature].label}.`
      };
    }
  }

  const positives = getTopFacets(state, 'positive', 3);
  const negatives = getTopFacets(state, 'negative', 2);
  const supportCount = positives.reduce((sum, facet) => sum + facet.evidenceFor.length, 0);
  const oppositionCount = negatives.reduce((sum, facet) => sum + facet.evidenceAgainst.length, 0);
  const summaryConfidence = positives.reduce((sum, facet) => sum + facet.confidence, 0) / Math.max(1, positives.length);

  if (batchComplete && supportCount + oppositionCount >= 4 && summaryConfidence > 0.54) {
    const message = `I’m reading your taste as: ${state.summary}`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'summarize',
        message,
        options: ['Yes, that is right', 'Mostly right', 'No, revise that'],
        internalReason: `Stable summary with ${supportCount + oppositionCount} evidence points and ${summaryConfidence.toFixed(2)} mean confidence.`
      };
    }
  }

  const passive =
    state.currentGenerationGuidance.testNext[0]
      ? `I’m testing ${state.currentGenerationGuidance.testNext[0]}.`
      : state.summary !== 'Waiting for swipe evidence.'
        ? state.summary
        : 'Swipe a few examples and I’ll turn the pattern into steering memory.';

  return {
    mode: 'idle_insight',
    message: passive,
    options: [],
    internalReason: 'No question cleared the information-gain threshold.'
  };
}
