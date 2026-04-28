import { useCallback, useMemo, useState } from 'react';

import {
  DEFAULT_ONBOARDING,
  DISLIKE_REASON_FALLBACKS,
  LIKE_REASON_FALLBACKS
} from '../preference/constants';
import {
  applyClarificationAnswer,
  createInitialPreferenceState,
  getTopFacets,
  selectBubbleAction
} from '../preference/model';
import type {
  BubbleAction,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PromptPlan,
  TraceEvent
} from '../preference/types';
import { createTrace } from '../preference/utils';
import { OnboardingView } from './swipe/OnboardingView';
import { StudioTopbar } from './swipe/StudioTopbar';
import { SwipeStage } from './swipe/SwipeStage';
import { SystemDrawer } from './swipe/SystemDrawer';
import { SLATE_SIZE } from './swipe/generation';
import type { PendingDecision } from './swipe/types';
import { useBatchGeneration } from './swipe/useBatchGeneration';
import { useFeedbackFlow } from './swipe/useFeedbackFlow';
import { useSessionLifecycle } from './swipe/useSessionLifecycle';
import { useSwipeKeyboard } from './swipe/useSwipeKeyboard';
import './PreferenceSwipePrototype.css';

const ENABLE_CLARIFICATION = false;

type PreferenceSwipePrototypeProps = {
  onOpenExperiments?: () => void;
};

function PreferenceSwipePrototype({ onOpenExperiments }: PreferenceSwipePrototypeProps) {
  const [phase, setPhase] = useState<'onboarding' | 'studio'>('onboarding');
  const [onboarding, setOnboarding] = useState<OnboardingState>(DEFAULT_ONBOARDING);
  const [preferenceState, setPreferenceState] = useState(() => createInitialPreferenceState(DEFAULT_ONBOARDING));
  const [batchNumber, setBatchNumber] = useState(1);
  const [promptPlans, setPromptPlans] = useState<PromptPlan[]>([]);
  const [candidates, setCandidates] = useState<ImageCandidate[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([]);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isGridOpen, setIsGridOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [reasonChips, setReasonChips] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [lastLikedImageUrl, setLastLikedImageUrl] = useState<string | null>(null);
  const [llmBubble, setLlmBubble] = useState<BubbleAction | null>(null);
  const {
    awaitPendingVision,
    generateNextBatch,
    generationError,
    isAwaitingVision,
    isGeneratingImages,
    pendingVisionActive
  } = useBatchGeneration({
    feedbackEvents,
    lastLikedImageUrl,
    onboarding,
    setActiveIndex,
    setCandidates,
    setIsGridOpen,
    setPendingDecision,
    setPromptPlans,
    setReasonChips,
    setReasonText,
    setTraceEvents
  });

  const isGeneratingBatch = isGeneratingImages || candidates.some(candidate => candidate.generationStatus === 'generating');
  const reviewableCandidates = useMemo(
    () =>
      candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => candidate.generationStatus === 'generated' && Boolean(candidate.imageUrl))
        .sort((left, right) => {
          const leftReady = left.candidate.readyAt ?? left.index;
          const rightReady = right.candidate.readyAt ?? right.index;
          return leftReady === rightReady ? left.index - right.index : leftReady - rightReady;
        })
        .map(({ candidate }) => candidate),
    [candidates]
  );
  const activeCandidate = reviewableCandidates[activeIndex] ?? null;
  const isActiveCandidatePending = !activeCandidate && isGeneratingBatch;
  const batchFeedback = feedbackEvents.filter(event => event.batchId === `batch-${batchNumber}`);
  const reviewedReadyCount = batchFeedback.filter(event =>
    reviewableCandidates.some(candidate => candidate.imageId === event.imageId)
  ).length;
  const batchComplete = reviewableCandidates.length > 0 && !isGeneratingBatch && reviewedReadyCount >= reviewableCandidates.length;
  const isRationaleMode = Boolean(
    pendingDecision && activeCandidate && pendingDecision.candidate.imageId === activeCandidate.imageId
  );
  const activeRationaleOptions = useMemo(() => {
    const action = pendingDecision?.action;
    const suggested =
      action === 'like'
        ? activeCandidate?.suggestedLikeRationales ?? activeCandidate?.suggestedRationales ?? []
        : action === 'dislike'
          ? activeCandidate?.suggestedDislikeRationales ?? activeCandidate?.suggestedRationales ?? []
          : activeCandidate?.suggestedRationales ?? [];
    const fallbacks = action === 'dislike' ? DISLIKE_REASON_FALLBACKS : LIKE_REASON_FALLBACKS;
    return Array.from(
      new Set([...suggested, ...fallbacks].map(item => item.trim()).filter(Boolean))
    ).slice(0, 9);
  }, [activeCandidate, pendingDecision?.action]);
  const currentBatchReviews = useMemo(
    () =>
      reviewableCandidates
        .flatMap((candidate, index) => {
          const feedback = batchFeedback.find(event => event.imageId === candidate.imageId);
          return feedback ? [{ index, candidate, feedback }] : [];
        }),
    [batchFeedback, reviewableCandidates]
  );

  const localBubble = useMemo(
    () => selectBubbleAction(preferenceState, feedbackEvents, batchComplete),
    [batchComplete, feedbackEvents, preferenceState]
  );
  const bubbleAction: BubbleAction = llmBubble ?? localBubble;

  const { forgetSavedMemory, startSession } = useSessionLifecycle({
    batchComplete,
    batchNumber,
    candidates,
    enableClarification: ENABLE_CLARIFICATION,
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
  });

  const {
    beginFeedback,
    cancelPendingDecision,
    commitFeedback,
    feedbackNotice,
    toggleReasonChip
  } = useFeedbackFlow({
    batchNumber,
    candidates: reviewableCandidates,
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
  });

  const handleGenerateNext = useCallback(async () => {
    await awaitPendingVision();
    const next = batchNumber + 1;
    setBatchNumber(next);
    void generateNextBatch(preferenceState, next);
  }, [awaitPendingVision, batchNumber, generateNextBatch, preferenceState]);

  useSwipeKeyboard({
    activeCandidate,
    activeRationaleOptions,
    batchComplete,
    beginFeedback,
    cancelPendingDecision,
    candidatesLength: reviewableCandidates.length,
    commitFeedback,
    handleGenerateNext,
    isGridOpen,
    pendingDecision,
    phase,
    setActiveIndex,
    setIsGridOpen,
    setReasonChips
  });

  const handleBubbleAnswer = (answer: string) => {
    const nextState = applyClarificationAnswer(preferenceState, bubbleAction, answer);
    setPreferenceState(nextState);
    setTraceEvents(current => [
      createTrace('clarification_answered', bubbleAction.mode, answer),
      createTrace('preference_updated', `Preference state v${nextState.version}`, nextState.summary),
      ...current
    ]);
  };

  const selectedPlanIds = new Set<string>(candidates.map(candidate => candidate.id));
  const rankedPlanList = [...promptPlans].sort((a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore);
  const topPositive = getTopFacets(preferenceState, 'positive', 5);
  const topNegative = getTopFacets(preferenceState, 'negative', 5);

  if (phase === 'onboarding') {
    return (
      <OnboardingView
        onboarding={onboarding}
        onOpenExperiments={onOpenExperiments}
        setOnboarding={setOnboarding}
        onStartSession={startSession}
      />
    );
  }

  return (
    <div className="swipe-prototype">
      <StudioTopbar
        onboarding={onboarding}
        onBackToOnboarding={() => setPhase('onboarding')}
        onOpenExperiments={onOpenExperiments}
        onToggleDebug={() => setShowDebug(value => !value)}
      />

      <main className="swipe-workbench">
        <SwipeStage
          activeCandidate={activeCandidate}
          activeIndex={activeIndex}
          activeRationaleOptions={activeRationaleOptions}
          batchComplete={batchComplete}
          beginFeedback={beginFeedback}
          cancelPendingDecision={cancelPendingDecision}
          candidates={reviewableCandidates}
          commitFeedback={commitFeedback}
          currentBatchReviews={currentBatchReviews}
          feedbackNotice={feedbackNotice}
          generationError={generationError}
          handleGenerateNext={handleGenerateNext}
          isActiveCandidatePending={Boolean(isActiveCandidatePending)}
          isAwaitingVision={isAwaitingVision}
          isGeneratingBatch={isGeneratingBatch}
          isGridOpen={isGridOpen}
          isRationaleMode={isRationaleMode}
          pendingDecision={pendingDecision}
          pendingVisionActive={pendingVisionActive}
          preferenceSummary={preferenceState.summary}
          reasonChips={reasonChips}
          reasonText={reasonText}
          plannedCandidateCount={candidates.length || SLATE_SIZE}
          setActiveIndex={setActiveIndex}
          setIsGridOpen={setIsGridOpen}
          setReasonText={setReasonText}
          slateSize={SLATE_SIZE}
          startSession={startSession}
          toggleReasonChip={toggleReasonChip}
        />
      </main>

      {showDebug ? (
        <SystemDrawer
          batchNumber={batchNumber}
          bubbleAction={bubbleAction}
          feedbackEvents={feedbackEvents}
          onBubbleAnswer={handleBubbleAnswer}
          onClose={() => setShowDebug(false)}
          onForgetSavedMemory={forgetSavedMemory}
          preferenceState={preferenceState}
          rankedPlanList={rankedPlanList}
          selectedPlanIds={selectedPlanIds}
          showClarification={ENABLE_CLARIFICATION}
          topNegative={topNegative}
          topPositive={topPositive}
          traceEvents={traceEvents}
        />
      ) : null}
    </div>
  );
}

export default PreferenceSwipePrototype;
