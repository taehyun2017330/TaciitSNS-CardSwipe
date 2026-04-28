import {
  Check,
  ChevronLeft,
  Sparkles
} from 'lucide-react';

import type { FeedbackAction, FeedbackEvent, ImageCandidate } from '../../preference/types';
import { CandidateGrid } from './CandidateGrid';
import { MiniPostCard } from './MiniPostCard';
import { StackLoadingCard } from './StackLoadingCard';
import { SwipeKeyboardStrip } from './SwipeKeyboardStrip';
import { SwipeStageHeader } from './SwipeStageHeader';
import type { BatchReview, PendingDecision, SetState } from './types';

type SwipeStageProps = {
  activeCandidate: ImageCandidate | null;
  activeIndex: number;
  activeRationaleOptions: string[];
  batchComplete: boolean;
  beginFeedback: (candidate: ImageCandidate | null, action: FeedbackAction, source?: FeedbackEvent['source']) => void;
  cancelPendingDecision: () => void;
  candidates: ImageCandidate[];
  commitFeedback: () => void;
  currentBatchReviews: BatchReview[];
  feedbackNotice: string | null;
  generationError: string | null;
  handleGenerateNext: () => void;
  isActiveCandidatePending: boolean;
  isAwaitingVision: boolean;
  isGeneratingBatch: boolean;
  isGridOpen: boolean;
  isRationaleMode: boolean;
  pendingDecision: PendingDecision | null;
  pendingVisionActive: boolean;
  preferenceSummary: string;
  reasonChips: string[];
  reasonText: string;
  plannedCandidateCount: number;
  setActiveIndex: SetState<number>;
  setIsGridOpen: SetState<boolean>;
  setReasonText: SetState<string>;
  slateSize: number;
  startSession: () => void;
  toggleReasonChip: (chip: string) => void;
};

export function SwipeStage({
  activeCandidate,
  activeIndex,
  activeRationaleOptions,
  batchComplete,
  beginFeedback,
  cancelPendingDecision,
  candidates,
  commitFeedback,
  currentBatchReviews,
  feedbackNotice,
  generationError,
  handleGenerateNext,
  isActiveCandidatePending,
  isAwaitingVision,
  isGeneratingBatch,
  isGridOpen,
  isRationaleMode,
  pendingDecision,
  pendingVisionActive,
  preferenceSummary,
  reasonChips,
  reasonText,
  plannedCandidateCount,
  setActiveIndex,
  setIsGridOpen,
  setReasonText,
  slateSize,
  startSession,
  toggleReasonChip
}: SwipeStageProps) {
  const stackCandidates = candidates.slice(activeIndex, activeIndex + 4);
  const hiddenTailCount = Math.max(0, candidates.length - activeIndex - stackCandidates.length);
  const isWaitingForFirstImage = isGeneratingBatch && candidates.length === 0;
  const shouldShowTailLoader =
    isGeneratingBatch &&
    candidates.length > 0 &&
    candidates.length < plannedCandidateCount &&
    activeIndex >= candidates.length - 1;
  const hasMoreCards = hiddenTailCount > 0 || shouldShowTailLoader;

  return (
    <section className="swipe-stage" aria-label="Swipe cards">
      <SwipeStageHeader
        activeCandidate={activeCandidate}
        activeIndex={activeIndex}
        batchComplete={batchComplete}
        candidatesLength={candidates.length}
        isGeneratingBatch={isGeneratingBatch}
        isGridOpen={isGridOpen}
        isRationaleMode={isRationaleMode}
        pendingDecision={pendingDecision}
        setIsGridOpen={setIsGridOpen}
        slateSize={slateSize}
        startSession={startSession}
      />

      {generationError ? (
        <div className="swipe-generation-error">
          <strong>Real image generation did not complete for every card.</strong>
          <p>{generationError}</p>
        </div>
      ) : null}

      {feedbackNotice ? (
        <div className="swipe-feedback-notice" role="status" aria-live="polite">
          {feedbackNotice}
        </div>
      ) : null}

      {!isGridOpen ? (
        <div className={`swipe-card-stack ${hasMoreCards ? 'has-more-cards' : ''}`}>
          {isWaitingForFirstImage ? <StackLoadingCard variant="initial" /> : null}

          {stackCandidates.map((candidate, stackIndex) => {
            const index = activeIndex + stackIndex;
            const offset = stackIndex;
            const isActive = stackIndex === 0;
            const isCardInRationaleMode = isRationaleMode && isActive;
            const previousFeedback = isCardInRationaleMode ? pendingDecision?.previousFeedback : undefined;
            const priorActionLabel = previousFeedback?.action === 'like' ? 'liked' : 'disliked';
            const nextActionLabel = pendingDecision?.action === 'like' ? 'liked' : 'disliked';
            return (
              <div
                key={candidate.imageId}
                className={[
                  'swipe-stack-card',
                  isActive ? 'is-front' : '',
                  isCardInRationaleMode ? 'is-rationale-mode' : '',
                  isCardInRationaleMode ? `is-action-${pendingDecision?.action ?? 'like'}` : ''
                ].join(' ')}
                style={{
                  transform: `translateX(${offset * 11}px) translateY(${offset * 8}px) rotate(${offset * 1.65}deg)`,
                  zIndex: 10 - offset,
                  opacity: 1 - offset * 0.16,
                  pointerEvents: isActive ? 'auto' : 'none'
                }}
              >
                <div className="swipe-flip-card">
                  <div className="swipe-flip-card__face swipe-flip-card__front" aria-hidden={isCardInRationaleMode}>
                    <MiniPostCard candidate={candidate} isActive={isActive} />
                  </div>
                  <div className="swipe-flip-card__face swipe-flip-card__back" aria-hidden={!isCardInRationaleMode}>
                    {isCardInRationaleMode ? (
                      <div className={`swipe-rationale-card swipe-rationale-card--${pendingDecision?.action ?? 'like'}`}>
                        <div className="swipe-rationale-card__image" aria-label="Selected image">
                          <MiniPostCard candidate={candidate} isActive />
                        </div>

                        <div className="swipe-rationale-card__content">
                          <div>
                            <span>{pendingDecision?.action === 'like' ? 'Potential like reasons' : 'Potential dislike reasons'}</span>
                            <h2>{candidate.imageSummary || candidate.visual.headline}</h2>
                            <p>
                              {candidate.suggestedRationales?.length ||
                              candidate.suggestedLikeRationales?.length ||
                              candidate.suggestedDislikeRationales?.length
                                ? 'Use number keys to pick the reasons that match.'
                                : pendingVisionActive
                                  ? 'Vision suggestions are still arriving. You can continue or add your own note.'
                                  : 'Pick a quick reason or add your own note.'}
                            </p>
                          </div>

                          {previousFeedback ? (
                            <div className="swipe-rationale-card__notice">
                              Already {priorActionLabel}.{' '}
                              {previousFeedback.action === pendingDecision?.action
                                ? 'Saving updates these reasons. Are you sure?'
                                : `Saving will change this to ${nextActionLabel}. Are you sure?`}
                            </div>
                          ) : null}

                          <div className="swipe-rationale-card__chips">
                            {activeRationaleOptions.map((chip, chipIndex) => (
                              <button
                                type="button"
                                key={chip}
                                className={reasonChips.includes(chip) ? 'is-selected' : ''}
                                onClick={() => toggleReasonChip(chip)}
                              >
                                <kbd>{chipIndex + 1}</kbd>
                                <span>{chip}</span>
                              </button>
                            ))}
                          </div>

                          <textarea
                            value={reasonText}
                            onChange={event => setReasonText(event.target.value)}
                            placeholder="Add a specific reason..."
                            rows={3}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}

          {shouldShowTailLoader ? (
            <div
              className="swipe-stack-card swipe-stack-card--loading"
              style={{
                transform: 'translateX(11px) translateY(8px) rotate(1.65deg)',
                zIndex: 9,
                opacity: 0.84,
                pointerEvents: 'none'
              }}
            >
              <StackLoadingCard variant="tail" />
            </div>
          ) : null}

          {batchComplete ? (
            <div className="swipe-slate-complete">
              <Check size={28} />
              <h2>{candidates.length} signals captured</h2>
              <p>{preferenceSummary}</p>
              <div className="swipe-review-list">
                {currentBatchReviews.map(({ feedback, candidate, index }) => (
                  <article key={feedback.id} className={`is-${feedback.action}`}>
                    <button
                      type="button"
                      className="swipe-review-thumb"
                      onClick={() => {
                        setActiveIndex(index);
                        setIsGridOpen(true);
                      }}
                      title={`Open card ${index + 1} in grid`}
                    >
                      {candidate.imageUrl ? (
                        <img src={candidate.imageUrl} alt={candidate.caption} />
                      ) : (
                        <MiniPostCard candidate={candidate} />
                      )}
                    </button>
                    <div>
                      <strong>{feedback.action === 'like' ? 'Liked' : 'Disliked'}</strong>
                      <span>{candidate.imageSummary || candidate.visual.headline || `Card ${index + 1}`}</span>
                      <p>{feedback.reasonText || feedback.reasonChips.join(', ') || 'No reason added.'}</p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="swipe-review-actions">
                <button
                  className="swipe-secondary-button"
                  type="button"
                  onClick={() => {
                    setActiveIndex(0);
                    setIsGridOpen(true);
                  }}
                >
                  <ChevronLeft size={17} />
                  Review cards
                </button>
                <button
                  className="swipe-primary-button"
                  type="button"
                  onClick={handleGenerateNext}
                  disabled={isAwaitingVision}
                >
                  <Sparkles size={18} />
                  {isAwaitingVision ? 'Finishing analysis…' : 'Generate next 8'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <CandidateGrid
          activeIndex={activeIndex}
          beginFeedback={beginFeedback}
          candidates={candidates}
          currentBatchReviews={currentBatchReviews}
        />
      )}

      <SwipeKeyboardStrip
        activeCandidate={activeCandidate}
        activeIndex={activeIndex}
        batchComplete={batchComplete}
        beginFeedback={beginFeedback}
        cancelPendingDecision={cancelPendingDecision}
        candidatesLength={candidates.length}
        commitFeedback={commitFeedback}
        handleGenerateNext={handleGenerateNext}
        isActiveCandidatePending={isActiveCandidatePending}
        isAwaitingVision={isAwaitingVision}
        isGridOpen={isGridOpen}
        isRationaleMode={isRationaleMode}
        setActiveIndex={setActiveIndex}
        setIsGridOpen={setIsGridOpen}
      />
    </section>
  );
}
