import { ThumbsDown, ThumbsUp } from 'lucide-react';

import type { FeedbackAction, FeedbackEvent, ImageCandidate } from '../../preference/types';
import { MiniPostCard } from './MiniPostCard';
import type { BatchReview } from './types';

type CandidateGridProps = {
  activeIndex: number;
  beginFeedback: (candidate: ImageCandidate | null, action: FeedbackAction, source?: FeedbackEvent['source']) => void;
  candidates: ImageCandidate[];
  currentBatchReviews: BatchReview[];
};

export function CandidateGrid({
  activeIndex,
  beginFeedback,
  candidates,
  currentBatchReviews
}: CandidateGridProps) {
  return (
    <div className="swipe-grid-view">
      {candidates.map((candidate, index) => {
        const already = currentBatchReviews.find(review => review.candidate.imageId === candidate.imageId)?.feedback;
        return (
          <article
            key={candidate.imageId}
            className={[
              already ? `is-${already.action}` : '',
              index === activeIndex ? 'is-active-grid' : ''
            ].join(' ')}
          >
            <MiniPostCard candidate={candidate} />
            <div>
              <strong>Card {index + 1}</strong>
              <p>{already ? (already.action === 'like' ? 'Liked' : 'Disliked') : 'Unreviewed'}</p>
            </div>
            <div className="swipe-grid-actions">
              <button
                type="button"
                title={already ? 'Update dislike signal' : 'Dislike'}
                disabled={candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed'}
                onClick={() => beginFeedback(candidate, 'dislike', 'grid')}
              >
                <ThumbsDown size={16} />
              </button>
              <button
                type="button"
                title={already ? 'Update like signal' : 'Like'}
                disabled={candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed'}
                onClick={() => beginFeedback(candidate, 'like', 'grid')}
              >
                <ThumbsUp size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
