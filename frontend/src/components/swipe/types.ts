import type { Dispatch, SetStateAction } from 'react';

import type { FeedbackAction, FeedbackEvent, ImageCandidate } from '../../preference/types';

export type PendingDecision = {
  candidate: ImageCandidate;
  action: FeedbackAction;
  source: FeedbackEvent['source'];
  previousFeedback?: FeedbackEvent;
};

export type BatchReview = {
  index: number;
  candidate: ImageCandidate;
  feedback: FeedbackEvent;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
