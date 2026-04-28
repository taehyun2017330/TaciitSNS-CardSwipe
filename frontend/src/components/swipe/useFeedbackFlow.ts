import { useCallback, useRef, useState } from 'react';

import {
  extractReasonFacets,
  updateStateFromFeedback
} from '../../preference/model';
import type {
  FeedbackAction,
  FeedbackEvent,
  ImageCandidate,
  PreferenceState,
  TraceEvent
} from '../../preference/types';
import { createTrace, nowIso } from '../../preference/utils';
import type { PendingDecision, SetState } from './types';

type UseFeedbackFlowArgs = {
  batchNumber: number;
  candidates: ImageCandidate[];
  feedbackEvents: FeedbackEvent[];
  pendingDecision: PendingDecision | null;
  preferenceState: PreferenceState;
  reasonChips: string[];
  reasonText: string;
  setActiveIndex: SetState<number>;
  setFeedbackEvents: SetState<FeedbackEvent[]>;
  setIsGridOpen: SetState<boolean>;
  setLastLikedImageUrl: SetState<string | null>;
  setPendingDecision: SetState<PendingDecision | null>;
  setPreferenceState: SetState<PreferenceState>;
  setReasonChips: SetState<string[]>;
  setReasonText: SetState<string>;
  setTraceEvents: SetState<TraceEvent[]>;
};

export function useFeedbackFlow({
  batchNumber,
  candidates,
  feedbackEvents,
  pendingDecision,
  preferenceState,
  reasonChips,
  reasonText,
  setActiveIndex,
  setFeedbackEvents,
  setIsGridOpen,
  setLastLikedImageUrl,
  setPendingDecision,
  setPreferenceState,
  setReasonChips,
  setReasonText,
  setTraceEvents
}: UseFeedbackFlowArgs) {
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const feedbackNoticeTimer = useRef<number | null>(null);

  const showFeedbackNotice = useCallback((message: string) => {
    setFeedbackNotice(message);
    if (feedbackNoticeTimer.current) {
      window.clearTimeout(feedbackNoticeTimer.current);
    }
    feedbackNoticeTimer.current = window.setTimeout(() => {
      setFeedbackNotice(null);
      feedbackNoticeTimer.current = null;
    }, 1800);
  }, []);

  const beginFeedback = useCallback(
    (candidate: ImageCandidate | null, action: FeedbackAction, source: FeedbackEvent['source'] = 'button') => {
      if (!candidate || candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed') {
        return;
      }

      const existing = feedbackEvents.find(event => event.imageId === candidate.imageId);

      const index = candidates.findIndex(item => item.imageId === candidate.imageId);
      if (index >= 0) {
        setActiveIndex(index);
      }
      setIsGridOpen(false);
      setReasonText(existing?.reasonText ?? '');
      setReasonChips(existing?.reasonChips ?? []);
      setPendingDecision({ candidate, action, source, previousFeedback: existing });
    },
    [candidates, feedbackEvents, setActiveIndex, setIsGridOpen, setPendingDecision, setReasonChips, setReasonText]
  );

  const cancelPendingDecision = useCallback(() => {
    setPendingDecision(null);
    setReasonText('');
    setReasonChips([]);
  }, [setPendingDecision, setReasonChips, setReasonText]);

  const commitFeedback = useCallback(() => {
    if (!pendingDecision) {
      return;
    }

    const candidate =
      candidates.find(item => item.imageId === pendingDecision.candidate.imageId) ?? pendingDecision.candidate;
    const { action, source } = pendingDecision;

    if (candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed') {
      return;
    }

    const existing = feedbackEvents.find(event => event.imageId === candidate.imageId);

    const extracted = extractReasonFacets(reasonText, reasonChips, action);
    const feedback: FeedbackEvent = {
      id: existing?.id ?? `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      batchId: candidate.batchId,
      imageId: candidate.imageId,
      action,
      source,
      reasonText: reasonText.trim(),
      reasonChips,
      extractedFacets: extracted.facets,
      createdAt: existing?.createdAt ?? nowIso()
    };

    const nextFeedbackEvents = existing
      ? feedbackEvents.map(event => (event.imageId === candidate.imageId ? feedback : event))
      : [...feedbackEvents, feedback];
    const shouldUpdatePreferenceState = !existing || existing.action !== action;
    const nextState = shouldUpdatePreferenceState
      ? updateStateFromFeedback(preferenceState, candidate, feedback, batchNumber, nextFeedbackEvents)
      : preferenceState;

    setFeedbackEvents(nextFeedbackEvents);
    if (shouldUpdatePreferenceState) {
      setPreferenceState(nextState);
    }
    if (action === 'like' && candidate.imageUrl) {
      setLastLikedImageUrl(candidate.imageUrl);
    }
    showFeedbackNotice(existing ? 'Settings saved.' : `${action === 'like' ? 'Liked' : 'Disliked'} saved.`);
    setTraceEvents(current => [
      ...(existing
        ? [
            createTrace(
              'preference_updated',
              `${action === 'like' ? 'Liked' : 'Disliked'} settings saved`,
              feedback.reasonText || feedback.reasonChips.join(', ') || 'No reason supplied.'
            )
          ]
        : []),
      createTrace(
        action === 'like' ? 'image_liked' : 'image_disliked',
        `${action === 'like' ? 'Liked' : 'Disliked'} ${candidate.visual.headline}`,
        feedback.reasonText || feedback.reasonChips.join(', ') || 'No reason supplied.'
      ),
      ...(feedback.extractedFacets.length
        ? [
            createTrace(
              'reason_added',
              'Extracted reason facets',
              feedback.extractedFacets.map(facet => `${facet.sentiment > 0 ? '+' : '-'} ${facet.label}`).join(', ')
            )
          ]
        : []),
      createTrace('preference_updated', `Preference state v${nextState.version}`, nextState.summary),
      ...current
    ]);

    setReasonText('');
    setReasonChips([]);
    setPendingDecision(null);
    const nextIndex = candidates.findIndex(item => item.imageId === candidate.imageId) + 1;
    setActiveIndex(Math.min(candidates.length, nextIndex));
  }, [
    batchNumber,
    candidates,
    feedbackEvents,
    pendingDecision,
    preferenceState,
    reasonChips,
    reasonText,
    setActiveIndex,
    setFeedbackEvents,
    setLastLikedImageUrl,
    setPendingDecision,
    setPreferenceState,
    setReasonChips,
    setReasonText,
    setTraceEvents,
    showFeedbackNotice
  ]);

  const toggleReasonChip = useCallback((chip: string) => {
    setReasonChips(current =>
      current.includes(chip) ? current.filter(item => item !== chip) : [...current, chip]
    );
  }, [setReasonChips]);

  return {
    beginFeedback,
    cancelPendingDecision,
    commitFeedback,
    feedbackNotice,
    toggleReasonChip
  };
}
