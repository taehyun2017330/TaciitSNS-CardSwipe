import { Grid3X3, Layers, RotateCcw } from 'lucide-react';

import type { ImageCandidate } from '../../preference/types';
import type { PendingDecision, SetState } from './types';

type SwipeStageHeaderProps = {
  activeCandidate: ImageCandidate | null;
  activeIndex: number;
  batchComplete: boolean;
  candidatesLength: number;
  isGeneratingBatch: boolean;
  isGridOpen: boolean;
  isRationaleMode: boolean;
  pendingDecision: PendingDecision | null;
  setIsGridOpen: SetState<boolean>;
  slateSize: number;
  startSession: () => void;
};

export function SwipeStageHeader({
  activeCandidate,
  activeIndex,
  batchComplete,
  candidatesLength,
  isGeneratingBatch,
  isGridOpen,
  isRationaleMode,
  pendingDecision,
  setIsGridOpen,
  slateSize,
  startSession
}: SwipeStageHeaderProps) {
  const title = batchComplete
    ? 'Review feedback'
    : isRationaleMode
      ? pendingDecision?.action === 'like'
        ? 'Why like this image?'
        : 'Why dislike this image?'
      : activeCandidate?.imageSummary || (isGeneratingBatch ? 'Loading image' : 'Browse images');

  return (
    <div className="swipe-stage__header">
      <div>
        <span>Image {Math.min(activeIndex + 1, candidatesLength || slateSize)} of {candidatesLength || slateSize}</span>
        <h1>{title}</h1>
      </div>
      <div className="swipe-stage__actions">
        <button
          className="swipe-icon-button"
          type="button"
          title={isGridOpen ? 'Show card stack' : 'Show grid'}
          onClick={() => setIsGridOpen(open => !open)}
        >
          {isGridOpen ? <Layers size={18} /> : <Grid3X3 size={18} />}
        </button>
        <button className="swipe-icon-button" type="button" title="Reset current session" onClick={startSession}>
          <RotateCcw size={18} />
        </button>
      </div>
    </div>
  );
}
