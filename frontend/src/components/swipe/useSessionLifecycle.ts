import { useEffect } from 'react';

import { requestClarification } from '../../preference/clarification';
import {
  createInitialPreferenceState,
  incorporateAnalyzedCandidateFeatures
} from '../../preference/model';
import {
  clearSession,
  loadSession,
  saveSession
} from '../../preference/persistence';
import type {
  BubbleAction,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceState,
  TraceEvent
} from '../../preference/types';
import { createTrace } from '../../preference/utils';
import type { SetState } from './types';

type UseSessionLifecycleArgs = {
  batchComplete: boolean;
  batchNumber: number;
  candidates: ImageCandidate[];
  enableClarification: boolean;
  feedbackEvents: FeedbackEvent[];
  generateNextBatch: (
    nextState: PreferenceState,
    nextBatchNumber: number,
    nextOnboarding?: OnboardingState,
    recentFeedback?: FeedbackEvent[],
    referenceImageUrl?: string | null
  ) => Promise<void>;
  onboarding: OnboardingState;
  phase: 'onboarding' | 'studio';
  preferenceState: PreferenceState;
  setBatchNumber: SetState<number>;
  setFeedbackEvents: SetState<FeedbackEvent[]>;
  setLastLikedImageUrl: SetState<string | null>;
  setLlmBubble: SetState<BubbleAction | null>;
  setOnboarding: SetState<OnboardingState>;
  setPhase: SetState<'onboarding' | 'studio'>;
  setPreferenceState: SetState<PreferenceState>;
  setTraceEvents: SetState<TraceEvent[]>;
};

export function useSessionLifecycle({
  batchComplete,
  batchNumber,
  candidates,
  enableClarification,
  feedbackEvents,
  generateNextBatch,
  onboarding,
  phase,
  preferenceState,
  setBatchNumber,
  setFeedbackEvents,
  setLastLikedImageUrl,
  setLlmBubble,
  setOnboarding,
  setPhase,
  setPreferenceState,
  setTraceEvents
}: UseSessionLifecycleArgs) {
  const startSession = () => {
    const saved = loadSession(onboarding.brandName, onboarding.category);

    if (saved) {
      setOnboarding(saved.onboarding);
      setPreferenceState(saved.preferenceState);
      setFeedbackEvents(saved.feedbackEvents);
      setBatchNumber(saved.batchNumber);
      setTraceEvents([
        createTrace(
          'session_started',
          'Resumed saved session',
          `${saved.onboarding.brandName} · ${saved.feedbackEvents.length} prior swipes · saved ${saved.savedAt}`
        )
      ]);
      const nextBatch = saved.batchNumber + 1;
      setBatchNumber(nextBatch);
      void generateNextBatch(saved.preferenceState, nextBatch, saved.onboarding, saved.feedbackEvents);
      setPhase('studio');
      return;
    }

    const nextState = createInitialPreferenceState(onboarding);
    setPreferenceState(nextState);
    setFeedbackEvents([]);
    setLastLikedImageUrl(null);
    setTraceEvents([
      createTrace('session_started', 'Session started', `${onboarding.brandName} - ${onboarding.category}`)
    ]);
    setBatchNumber(1);
    void generateNextBatch(nextState, 1, onboarding, [], null);
    setPhase('studio');
  };

  const forgetSavedMemory = () => {
    clearSession(onboarding.brandName, onboarding.category);
    const nextState = createInitialPreferenceState(onboarding);
    setPreferenceState(nextState);
    setFeedbackEvents([]);
    setLastLikedImageUrl(null);
    setBatchNumber(1);
    setTraceEvents(current => [
      createTrace('session_started', 'Cleared saved memory', `Wiped persisted state for ${onboarding.brandName}.`),
      ...current
    ]);
    void generateNextBatch(nextState, 1, onboarding, [], null);
  };

  useEffect(() => {
    if (phase !== 'studio') {
      return;
    }
    if (feedbackEvents.length === 0 && batchNumber <= 1) {
      return;
    }
    saveSession(onboarding, preferenceState, feedbackEvents, batchNumber);
  }, [batchNumber, feedbackEvents, onboarding, phase, preferenceState]);

  useEffect(() => {
    if (phase !== 'studio' || !feedbackEvents.length || !candidates.length) {
      return;
    }
    setPreferenceState(current =>
      incorporateAnalyzedCandidateFeatures(current, candidates, feedbackEvents, batchNumber)
    );
  }, [batchNumber, candidates, feedbackEvents, phase, setPreferenceState]);

  useEffect(() => {
    setLlmBubble(null);
  }, [batchNumber, setLlmBubble]);

  useEffect(() => {
    if (!enableClarification || phase !== 'studio' || !batchComplete) {
      return;
    }
    let cancelled = false;
    void requestClarification(onboarding, preferenceState, feedbackEvents, batchComplete)
      .then(bubble => {
        if (!cancelled && bubble) {
          setLlmBubble(bubble);
        }
      })
      .catch(error => {
        console.warn('[clarification] request failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [batchComplete, batchNumber, enableClarification, feedbackEvents, onboarding, phase, preferenceState, setLlmBubble]);

  return {
    forgetSavedMemory,
    startSession
  };
}
