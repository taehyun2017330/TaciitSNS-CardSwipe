import { apiFetch } from '../api';
import { archetypes } from './archetypes';
import { createFeatureVector, getTopFacets } from './model';
import { chooseStrategyMix } from './strategyPolicy';
import type {
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceState,
  PromptPlan,
  PromptStrategy,
  SwipePromptSynthesisResponse,
  SynthesizedPlanResponse
} from './types';

const FIRST_BATCH_DIVERSITY_LANES = [
  'macro product hero, close crop, bold color field, sensory liquid or texture action',
  'clean clinical studio still life, product clarity, restrained palette, precise spacing',
  'ingredient or material flat lay, tactile props, overhead composition, natural detail',
  'premium editorial campaign poster, strong typography system, graphic hierarchy',
  'human-scale demonstration crop, hands or usage cue, product still dominant',
  'glossy luxury ad treatment, reflection, dramatic light, high finish',
  'soft everyday setting, shelf or counter context, ambient light, approachable mood',
  'abstract sensory close-up, gel, splash, pads, texture, minimal brand environment'
];

const NEGATIVE_ONLY_REPAIR_LANES = [
  'repair subject route: keep the user goal, but test a human-centered lifestyle direction rather than a product-only or object-only scene',
  'repair graphic route: test bold scattered social text overlays, stickers, doodles, callouts, and collage elements',
  'repair crop route: test a tighter person-centered crop or camera distance instead of a generic full scene',
  'repair palette route: test a brighter younger color system without defaulting to generic red-green Christmas styling',
  'repair typography route: test poster-like text hierarchy and playful type density instead of clean ad typography',
  'repair setting route: test a casual lived-in setting with social-photo energy instead of polished staged holiday decor',
  'contrast route: deliberately test a hip, trendy, youth-culture visual language that may be less traditionally cozy',
  'boundary route: push the playful/graphic treatment far enough to see whether the user wants social-native maximalism'
];

function buildDiversityBrief(batchNumber: number, feedbackEvents: FeedbackEvent[], count: number) {
  const likeCount = feedbackEvents.filter(event => event.action === 'like').length;
  const dislikeCount = feedbackEvents.filter(event => event.action === 'dislike').length;
  const likeShare = feedbackEvents.length ? likeCount / feedbackEvents.length : 0;
  const hasEnoughPositiveEvidence = likeCount >= 3 && likeShare >= 0.35;

  if (batchNumber <= 1 || feedbackEvents.length < 2) {
    return {
      diversityBrief:
        'Initial discovery slate: cast a wide net. Each plan must occupy a different visual lane so swipes reveal broad taste signals before convergence. Do not repeat palette, setting, camera distance, typography treatment, or product staging across the first slate.',
      diversityLanes: FIRST_BATCH_DIVERSITY_LANES.slice(0, count)
    };
  }

  if (dislikeCount > 0 && likeCount === 0) {
    return {
      diversityBrief:
        'Negative-only repair slate: the user has not liked anything yet, so do not converge. Treat dislikes as evidence that the current routes are wrong. Produce distinct repair hypotheses that preserve the onboarding goal and audience while testing different interpretations of what was missing. Do not make all plans the same cozy holiday scene, gift-box still life, or Christmas setup unless a prior like explicitly supported that route.',
      diversityLanes: NEGATIVE_ONLY_REPAIR_LANES.slice(0, count)
    };
  }

  if (!hasEnoughPositiveEvidence) {
    return {
      diversityBrief:
        'Early steering slate: there are not enough likes to converge yet. Keep the slate coherent around the user goal, but each plan must test a visibly different repair path. Reuse only the strongest repeated positive cues, and vary subject, crop, setting, palette, typography, and graphic overlay treatment across the slate.',
      diversityLanes: NEGATIVE_ONLY_REPAIR_LANES.slice(0, count)
    };
  }

  return {
    diversityBrief:
      'Convergence slate: enough images have been liked to build a recognizable family around the strongest liked and correction signals. Most plans should preserve the same core subject, camera distance, layout logic, palette family, and graphic treatment while varying one controlled attribute at a time. Keep two visible variations in the slate so the user can still steer if the current family is slightly wrong.',
    diversityLanes: []
  };
}

function isPromptStrategy(value: string): value is PromptStrategy {
  return (
    value === 'exploit' ||
    value === 'explore' ||
    value === 'diagnostic' ||
    value === 'repair' ||
    value === 'contrast' ||
    value === 'near_neighbor' ||
    value === 'boundary_test'
  );
}

export function buildSynthesisRequest(
  onboarding: OnboardingState,
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchNumber: number,
  count: number
) {
  const recentLikes = feedbackEvents
    .filter(event => event.action === 'like')
    .slice(-5)
    .reverse()
    .map(event => event.reasonText.trim() || event.reasonChips.join(', '))
    .filter(text => text.length > 0);

  const recentDislikes = feedbackEvents
    .filter(event => event.action === 'dislike')
    .slice(-5)
    .reverse()
    .map(event => event.reasonText.trim() || event.reasonChips.join(', '))
    .filter(text => text.length > 0);
  const weightedFacets = [
    ...getTopFacets(state, 'positive', 8),
    ...getTopFacets(state, 'negative', 8)
  ].map(facet => ({
    key: facet.feature,
    label: facet.label,
    dimension: facet.dimension,
    alpha: Number(facet.alpha.toFixed(3)),
    beta: Number(facet.beta.toFixed(3)),
    weight: Number(facet.weight.toFixed(3)),
    confidence: Number(facet.confidence.toFixed(3)),
    evidenceVolume: Number(facet.evidenceVolume.toFixed(3)),
    directionConfidence: Number(facet.directionConfidence.toFixed(3)),
    evidenceConfidence: Number(facet.evidenceConfidence.toFixed(3))
  }));
  const strategyMix = chooseStrategyMix(state, feedbackEvents, batchNumber, count);
  const diversity = buildDiversityBrief(batchNumber, feedbackEvents, count);

  return {
    brandName: onboarding.brandName,
    category: onboarding.category,
    goal: onboarding.goal,
    audience: onboarding.audience,
    tone: onboarding.tone.join(', '),
    avoid: onboarding.avoid,
    leanInto: state.currentGenerationGuidance.leanInto,
    avoidFacets: state.currentGenerationGuidance.avoid,
    testNext: state.currentGenerationGuidance.testNext,
    preferenceSummary: state.summary,
    semanticBrief: state.currentGenerationGuidance.semanticBrief,
    semanticMemory: {
      likedDirections: state.semanticMemory.likedDirections.slice(0, 8).map(signal => signal.label),
      dislikedDirections: state.semanticMemory.dislikedDirections.slice(0, 8).map(signal => signal.label),
      hardAvoids: state.semanticMemory.hardAvoids.slice(0, 8).map(signal => signal.label),
      uncertainties: state.semanticMemory.uncertainties.slice(0, 6)
    },
    weightedFacets,
    strategyMix,
    ...diversity,
    recentLikes,
    recentDislikes,
    batchNumber,
    count
  };
}

export async function requestSynthesizedPlans(
  onboarding: OnboardingState,
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchNumber: number,
  count = 4
): Promise<SynthesizedPlanResponse[]> {
  const response = await apiFetch('/api/swipe/synthesize-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSynthesisRequest(onboarding, state, feedbackEvents, batchNumber, count))
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Prompt synthesis failed with ${response.status}`);
  }

  const body = (await response.json()) as SwipePromptSynthesisResponse;
  return body.plans ?? [];
}

export function synthesizedPlanToCandidate(
  synth: SynthesizedPlanResponse,
  index: number,
  batchNumber: number
): ImageCandidate {
  const archetypeForVisuals = archetypes[index % archetypes.length];
  const strategy: PromptStrategy = isPromptStrategy(synth.strategy) ? synth.strategy : 'explore';

  const plan: PromptPlan = {
    id: synth.id || `batch-${batchNumber}-synth-${index}`,
    batchId: `batch-${batchNumber}`,
    strategy,
    hypothesis: synth.hypothesis || '',
    prompt: synth.prompt || '',
    negativePrompt: synth.negativePrompt || '',
    targetAttributes: synth.targetAttributes ?? [],
    intendedFeatures: createFeatureVector({}),
    rationale: 'LLM-synthesized from current preference state and recent feedback.',
    scoreBreakdown: {
      preferenceMatch: 0,
      userGoalAlignment: 0,
      diversityBonus: 0,
      informationGain: 0,
      repairValue: 0,
      dislikedFeaturePenalty: 0,
      finalScore: 0
    }
  };

  return {
    ...plan,
    imageId: `batch-${batchNumber}-image-${index}`,
    generationStatus: 'mock',
    caption: synth.prompt || archetypeForVisuals.prompt,
    tags: archetypeForVisuals.tags,
    visual: archetypeForVisuals.visual
  };
}
