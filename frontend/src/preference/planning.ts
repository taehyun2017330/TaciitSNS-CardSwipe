import { archetypes } from './archetypes';
import { FEATURE_KEYS } from './features';
import { createFeatureVector, getTopFacets } from './state';
import type {
  FeatureVector,
  ImageCandidate,
  OnboardingState,
  PreferenceState,
  PromptPlan,
  PromptStrategy
} from './types';

export function scorePlan(
  features: FeatureVector,
  state: PreferenceState,
  onboarding: OnboardingState,
  selectedPlans: PromptPlan[]
): PromptPlan['scoreBreakdown'] {
  const preferenceMatch = FEATURE_KEYS.reduce((sum, key) => {
    const facet = state.facets[key];
    return sum + (features[key] ?? 0) * facet.weight * (0.55 + facet.confidence);
  }, 0);

  const userGoalText = `${onboarding.goal} ${onboarding.category} ${onboarding.tone.join(' ')}`.toLowerCase();
  const userGoalAlignment =
    (userGoalText.includes('sale') ? (features['marketing.saleEmphasis'] ?? 0) * 0.18 + (features['marketing.subtlety'] ?? 0) * 0.24 : 0.1) +
    (userGoalText.includes('premium') || userGoalText.includes('cheap')
      ? (features['mood.premium'] ?? 0) * 0.24 + (features['mood.credible'] ?? 0) * 0.18
      : 0.08) +
    (userGoalText.includes('fashion') ? (features['composition.editorial'] ?? 0) * 0.16 : 0.06);

  const diversityBonus = selectedPlans.length
    ? Math.min(
        0.6,
        selectedPlans.reduce((sum, plan) => {
          const distance = FEATURE_KEYS.reduce((total, key) => total + Math.abs((features[key] ?? 0) - (plan.intendedFeatures[key] ?? 0)), 0);
          return sum + distance / FEATURE_KEYS.length;
        }, 0) / selectedPlans.length
      )
    : 0.35;

  const informationGain = Math.min(
    0.8,
    state.currentGenerationGuidance.testNext.length * 0.08 +
      FEATURE_KEYS.reduce((sum, key) => {
        const facet = state.facets[key];
        const featurePresence = features[key] ?? 0;
        if (featurePresence <= 0.35) {
          return sum;
        }
        const diagnosticValue =
          facet.evidenceVolume >= 1.5 && facet.directionConfidence < 0.35
            ? 0.08
            : 0;
        const exploreValue = facet.evidenceVolume < 0.4 ? 0.025 : 0;
        return sum + featurePresence * (diagnosticValue + exploreValue);
      }, 0)
  );

  const repairValue = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + (1 - (features[facet.feature] ?? 0)) * Math.abs(facet.weight) * 0.16;
  }, 0);

  const dislikedFeaturePenalty = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + Math.max(0, (features[facet.feature] ?? 0) - 0.3) * Math.abs(facet.weight) * (0.8 + facet.confidence);
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
      targetAttributes: archetype.tags,
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
  const preferredStrategies: PromptStrategy[] = ['exploit', 'repair', 'diagnostic', 'explore', 'near_neighbor', 'boundary_test'];

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
