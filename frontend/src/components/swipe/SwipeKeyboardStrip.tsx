import type { FeedbackAction, FeedbackEvent, ImageCandidate } from '../../preference/types';
import type { SetState } from './types';

type SwipeKeyboardStripProps = {
  activeCandidate: ImageCandidate | null;
  activeIndex: number;
  batchComplete: boolean;
  beginFeedback: (candidate: ImageCandidate | null, action: FeedbackAction, source?: FeedbackEvent['source']) => void;
  cancelPendingDecision: () => void;
  candidatesLength: number;
  commitFeedback: () => void;
  handleGenerateNext: () => void;
  isActiveCandidatePending: boolean;
  isAwaitingVision: boolean;
  isGridOpen: boolean;
  isRationaleMode: boolean;
  setActiveIndex: SetState<number>;
  setIsGridOpen: SetState<boolean>;
};

export function SwipeKeyboardStrip({
  activeCandidate,
  activeIndex,
  batchComplete,
  beginFeedback,
  cancelPendingDecision,
  candidatesLength,
  commitFeedback,
  handleGenerateNext,
  isActiveCandidatePending,
  isAwaitingVision,
  isGridOpen,
  isRationaleMode,
  setActiveIndex,
  setIsGridOpen
}: SwipeKeyboardStripProps) {
  if (isRationaleMode) {
    return (
      <div className="swipe-keyboard-strip swipe-keyboard-strip--rationale" aria-label="Rationale keyboard controls">
        <div className="swipe-keyboard-strip__group">
          <span><kbd>1-9</kbd> reasons</span>
        </div>
        <div className="swipe-keyboard-strip__group">
          <button type="button" onClick={cancelPendingDecision}>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            Close
          </button>
          <button type="button" onClick={commitFeedback}>
            <kbd>←</kbd>
            <kbd>→</kbd>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (batchComplete) {
    return (
      <div className="swipe-keyboard-strip" aria-label="Review keyboard controls">
        <button
          type="button"
          onClick={() => {
            setActiveIndex(0);
            setIsGridOpen(true);
          }}
        >
          <kbd>←</kbd>
          Review cards
        </button>
        <button type="button" onClick={handleGenerateNext} disabled={isAwaitingVision}>
          Next 8
          <kbd>→</kbd>
        </button>
      </div>
    );
  }

  if (isGridOpen) {
    return null;
  }

  return (
    <div className="swipe-keyboard-strip" aria-label="Swipe keyboard controls">
      <div className="swipe-keyboard-strip__group swipe-keyboard-strip__group--nav">
        <button
          type="button"
          title="Previous image"
          disabled={activeIndex <= 0}
          onClick={() => setActiveIndex(index => Math.max(0, index - 1))}
        >
          <kbd>←</kbd>
          Prev
        </button>
        <button
          type="button"
          title="Next image"
          disabled={activeIndex >= candidatesLength - 1}
          onClick={() => setActiveIndex(index => Math.min(candidatesLength - 1, index + 1))}
        >
          Next
          <kbd>→</kbd>
        </button>
      </div>
      <div className="swipe-keyboard-strip__group swipe-keyboard-strip__group--decision">
        <button
          className="swipe-keyboard-strip__dislike"
          type="button"
          title="Dislike this image"
          disabled={!activeCandidate || isActiveCandidatePending || activeCandidate?.generationStatus === 'failed' || isRationaleMode}
          onClick={() => beginFeedback(activeCandidate, 'dislike')}
        >
          <kbd>↓</kbd>
          Dislike
        </button>
        <button
          className="swipe-keyboard-strip__like"
          type="button"
          title="Like this image"
          disabled={!activeCandidate || isActiveCandidatePending || activeCandidate?.generationStatus === 'failed' || isRationaleMode}
          onClick={() => beginFeedback(activeCandidate, 'like')}
        >
          <kbd>↑</kbd>
          Like
        </button>
      </div>
      <div className="swipe-keyboard-strip__group">
        <button
          type="button"
          title={isGridOpen ? 'Show stack' : 'Show grid'}
          onClick={() => setIsGridOpen(open => !open)}
        >
          <kbd>Space</kbd>
          Grid
        </button>
      </div>
    </div>
  );
}
