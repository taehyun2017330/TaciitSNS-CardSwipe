import type { FeedbackEvent, PreferenceState, PromptStrategy } from './types';

const FIRST_BATCH_WIDE_MIX: PromptStrategy[] = [
  'explore',
  'contrast',
  'diagnostic',
  'explore',
  'boundary_test',
  'explore',
  'contrast',
  'diagnostic'
];

function averageConfidence(state: PreferenceState) {
  const facets = Object.values(state.facets).filter(
    facet => facet.evidenceVolume >= 0.5 && Math.abs(facet.weight) > 0.12
  );
  if (!facets.length) {
    return 0;
  }
  return facets.reduce((sum, facet) => sum + facet.confidence, 0) / facets.length;
}

function diagnosticFacetCount(state: PreferenceState) {
  return Object.values(state.facets).filter(
    facet => facet.evidenceVolume >= 1.5 && facet.directionConfidence < 0.35
  ).length;
}

export function chooseStrategyMix(
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchNumber: number,
  count = 4
): PromptStrategy[] {
  const recent = feedbackEvents.slice(-4);
  const dislikeCount = recent.filter(event => event.action === 'dislike').length;
  const totalLikeCount = feedbackEvents.filter(event => event.action === 'like').length;
  const totalDislikeCount = feedbackEvents.filter(event => event.action === 'dislike').length;
  const likeShare = feedbackEvents.length ? totalLikeCount / feedbackEvents.length : 0;
  const confidence = averageConfidence(state);
  const diagnosticCount = diagnosticFacetCount(state);
  const hasUncertainty =
    state.currentGenerationGuidance.testNext.length > 0 ||
    state.semanticMemory.uncertainties.length > 0 ||
    diagnosticCount > 0;
  const hasPositiveCorrection = state.semanticMemory.likedDirections.length > 0;
  const hasEnoughPositiveEvidence = totalLikeCount >= 3 && likeShare >= 0.35;
  const hasOnlyNegativeEvidence = totalDislikeCount > 0 && totalLikeCount === 0;

  let mix: PromptStrategy[];
  if (batchNumber <= 1 || feedbackEvents.length < 2) {
    mix = FIRST_BATCH_WIDE_MIX;
  } else if (hasOnlyNegativeEvidence) {
    mix = ['repair', 'diagnostic', 'contrast', 'repair', 'boundary_test', 'explore', 'diagnostic', 'near_neighbor'];
  } else if (!hasEnoughPositiveEvidence && dislikeCount >= 3) {
    mix = ['repair', 'diagnostic', 'contrast', 'near_neighbor', 'repair', 'boundary_test', 'explore', 'diagnostic'];
  } else if (diagnosticCount >= 2) {
    mix = ['diagnostic', 'exploit', 'diagnostic', dislikeCount ? 'repair' : 'near_neighbor', 'exploit'];
  } else if (hasPositiveCorrection && hasEnoughPositiveEvidence && feedbackEvents.length >= 6) {
    mix = [
      'exploit',
      'near_neighbor',
      'exploit',
      dislikeCount ? 'repair' : 'near_neighbor',
      'exploit',
      'near_neighbor',
      'diagnostic',
      dislikeCount ? 'repair' : 'boundary_test'
    ];
  } else if (dislikeCount >= 3) {
    mix = ['repair', 'repair', 'diagnostic', 'near_neighbor', 'repair', 'exploit'];
  } else if (confidence > 0.68 && hasEnoughPositiveEvidence && feedbackEvents.length >= 6) {
    mix = ['exploit', 'exploit', 'near_neighbor', 'exploit', dislikeCount ? 'repair' : 'near_neighbor'];
  } else if (hasUncertainty) {
    mix = ['diagnostic', 'repair', 'near_neighbor', 'contrast', 'exploit'];
  } else {
    mix = ['exploit', 'near_neighbor', 'repair', 'diagnostic'];
  }

  const filler: PromptStrategy[] =
    batchNumber <= 1 || feedbackEvents.length < 2
      ? ['explore', 'contrast', 'diagnostic', 'boundary_test']
      : hasEnoughPositiveEvidence
        ? ['near_neighbor', 'exploit', 'repair', 'diagnostic', 'near_neighbor', 'exploit', 'boundary_test']
        : ['repair', 'diagnostic', 'contrast', 'explore', 'boundary_test', 'near_neighbor'];
  const expanded = [...mix];
  for (const strategy of filler) {
    if (expanded.length >= count) break;
    expanded.push(strategy);
  }
  while (expanded.length < count) {
    expanded.push(filler[expanded.length % filler.length]);
  }

  return expanded.slice(0, count);
}
