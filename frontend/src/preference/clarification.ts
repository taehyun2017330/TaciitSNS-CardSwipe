import { apiFetch } from '../api';
import type {
  BubbleAction,
  BubbleMode,
  FeedbackEvent,
  OnboardingState,
  PreferenceState
} from './types';

interface ClarificationResponse {
  mode: string;
  message: string;
  options: string[];
  internalReason: string;
}

function isBubbleMode(value: string): value is BubbleMode {
  return (
    value === 'idle_insight' ||
    value === 'summarize' ||
    value === 'probe' ||
    value === 'clarify' ||
    value === 'challenge'
  );
}

export async function requestClarification(
  onboarding: OnboardingState,
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchComplete: boolean
): Promise<BubbleAction | null> {
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

  const response = await apiFetch('/api/swipe/clarify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandName: onboarding.brandName,
      category: onboarding.category,
      goal: onboarding.goal,
      summary: state.summary,
      leanInto: state.currentGenerationGuidance.leanInto,
      avoidFacets: state.currentGenerationGuidance.avoid,
      testNext: state.currentGenerationGuidance.testNext,
      recentLikes,
      recentDislikes,
      batchComplete,
      swipeCount: feedbackEvents.length,
      recentQuestions: state.questionHistory.slice(-4)
    })
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as ClarificationResponse;
  const mode: BubbleMode = isBubbleMode(body.mode) ? body.mode : 'idle_insight';

  return {
    mode,
    message: body.message,
    options: body.options ?? [],
    internalReason: body.internalReason ?? ''
  };
}
