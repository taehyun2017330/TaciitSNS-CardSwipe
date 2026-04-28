import { useEffect } from 'react';

import type { FeedbackEvent, ImageCandidate } from '../../preference/types';
import type { PendingDecision, SetState } from './types';

type UseSwipeKeyboardArgs = {
  activeCandidate: ImageCandidate | null;
  activeRationaleOptions: string[];
  batchComplete: boolean;
  beginFeedback: (candidate: ImageCandidate | null, action: 'like' | 'dislike', source?: FeedbackEvent['source']) => void;
  cancelPendingDecision: () => void;
  candidatesLength: number;
  commitFeedback: () => void;
  handleGenerateNext: () => void;
  isGridOpen: boolean;
  pendingDecision: PendingDecision | null;
  phase: 'onboarding' | 'studio';
  setActiveIndex: SetState<number>;
  setIsGridOpen: SetState<boolean>;
  setReasonChips: SetState<string[]>;
};

export function useSwipeKeyboard({
  activeCandidate,
  activeRationaleOptions,
  batchComplete,
  beginFeedback,
  cancelPendingDecision,
  candidatesLength,
  commitFeedback,
  handleGenerateNext,
  isGridOpen,
  pendingDecision,
  phase,
  setActiveIndex,
  setIsGridOpen,
  setReasonChips
}: UseSwipeKeyboardArgs) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (phase !== 'studio') {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isTextField = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';

      if (pendingDecision) {
        if (event.key === 'Escape' || (!isTextField && (event.key === 'ArrowUp' || event.key === 'ArrowDown'))) {
          event.preventDefault();
          cancelPendingDecision();
          return;
        }
        if (!isTextField && /^[1-9]$/.test(event.key)) {
          const option = activeRationaleOptions[Number(event.key) - 1];
          if (option) {
            event.preventDefault();
            setReasonChips(current =>
              current.includes(option) ? current.filter(item => item !== option) : [...current, option]
            );
          }
          return;
        }
        if (!isTextField && (event.key === 'Enter' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          commitFeedback();
        }
        return;
      }

      if (!isTextField && (event.key === ' ' || event.code === 'Space')) {
        event.preventDefault();
        setIsGridOpen(open => !open);
        return;
      }

      if (batchComplete) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          handleGenerateNext();
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          setActiveIndex(0);
          setIsGridOpen(true);
        }
        return;
      }

      if (isTextField || isGridOpen) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex(index => Math.max(0, index - 1));
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex(index => Math.min(candidatesLength - 1, index + 1));
        return;
      }

      if (!activeCandidate) {
        return;
      }

      if (activeCandidate.generationStatus === 'generating' || activeCandidate.generationStatus === 'failed') {
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        beginFeedback(activeCandidate, 'like', 'keyboard');
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        beginFeedback(activeCandidate, 'dislike', 'keyboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeCandidate,
    activeRationaleOptions,
    batchComplete,
    beginFeedback,
    cancelPendingDecision,
    candidatesLength,
    commitFeedback,
    handleGenerateNext,
    isGridOpen,
    pendingDecision,
    phase,
    setActiveIndex,
    setIsGridOpen,
    setReasonChips
  ]);
}
