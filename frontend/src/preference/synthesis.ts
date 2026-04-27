import { apiFetch } from '../api';
import { archetypes } from './archetypes';
import { createFeatureVector } from './model';
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

function isPromptStrategy(value: string): value is PromptStrategy {
  return value === 'exploit' || value === 'explore' || value === 'diagnostic' || value === 'repair' || value === 'contrast';
}

function buildSynthesisRequest(
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
