import { useCallback, useRef, useState } from 'react';

import { requestImageAnalysis } from '../../preference/analysis';
import {
  createFeatureVector,
  generateBatch
} from '../../preference/model';
import {
  requestSynthesizedPlans,
  synthesizedPlanToCandidate
} from '../../preference/synthesis';
import type {
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceState,
  PromptPlan,
  TraceEvent
} from '../../preference/types';
import { createTrace } from '../../preference/utils';
import {
  IMAGE_GENERATION_CONCURRENCY,
  SLATE_SIZE,
  makeSlate,
  requestSwipeImages,
  requireReadyAnalysis,
  runWithConcurrency
} from './generation';
import type { PendingDecision, SetState } from './types';

type UseBatchGenerationArgs = {
  feedbackEvents: FeedbackEvent[];
  lastLikedImageUrl: string | null;
  onboarding: OnboardingState;
  setActiveIndex: SetState<number>;
  setCandidates: SetState<ImageCandidate[]>;
  setIsGridOpen: SetState<boolean>;
  setPendingDecision: SetState<PendingDecision | null>;
  setPromptPlans: SetState<PromptPlan[]>;
  setReasonChips: SetState<string[]>;
  setReasonText: SetState<string>;
  setTraceEvents: SetState<TraceEvent[]>;
};

export function useBatchGeneration({
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
}: UseBatchGenerationArgs) {
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isAwaitingVision, setIsAwaitingVision] = useState(false);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [pendingVisionActive, setPendingVisionActive] = useState(false);
  const pendingVisionRef = useRef<Promise<void> | null>(null);

  const generateNextBatch = useCallback(async (
    nextState: PreferenceState,
    nextBatchNumber: number,
    nextOnboarding = onboarding,
    recentFeedback: FeedbackEvent[] = feedbackEvents,
    referenceImageUrl: string | null = lastLikedImageUrl
  ) => {
    setIsGeneratingImages(true);
    setGenerationError(null);
    setActiveIndex(0);
    setIsGridOpen(false);
    setReasonText('');
    setReasonChips([]);
    setPendingDecision(null);

    const placeholderBatch = generateBatch(nextOnboarding, nextState, nextBatchNumber);
    const batchId = `batch-${nextBatchNumber}`;
    const placeholderCandidates = makeSlate(placeholderBatch.candidates, batchId).map(candidate => ({
      ...candidate,
      generationStatus: 'generating' as const
    }));
    setPromptPlans(placeholderBatch.promptPlans);
    setCandidates(placeholderCandidates);

    let candidatesForBatch: ImageCandidate[] = [];
    try {
      const synthesized = await requestSynthesizedPlans(nextOnboarding, nextState, recentFeedback, nextBatchNumber, SLATE_SIZE);
      if (!synthesized.length) {
        throw new Error('Synthesis returned no plans.');
      }
      candidatesForBatch = makeSlate(
        synthesized.map((plan, index) => ({
          ...synthesizedPlanToCandidate(plan, index, nextBatchNumber),
          generationStatus: 'generating' as const
        })),
        batchId
      ).map(candidate => ({
        ...candidate,
        generationStatus: 'generating' as const
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prompt synthesis failed.';
      setGenerationError(`Could not synthesize prompts: ${message}`);
      setIsGeneratingImages(false);
      setCandidates(current =>
        current.map(candidate => ({
          ...candidate,
          generationStatus: 'failed' as const,
          generationError: message
        }))
      );
      setTraceEvents(current => [
        createTrace('batch_generated', 'Synthesis failed', message),
        ...current
      ]);
      return;
    }

    setPromptPlans(candidatesForBatch);
    setCandidates(candidatesForBatch);
    setTraceEvents(current => [
      createTrace(
        'batch_generated',
        `Synthesized slate ${nextBatchNumber}`,
        candidatesForBatch.map(candidate => `${candidate.strategy}: ${candidate.hypothesis}`).join(' | ')
      ),
      ...current
    ]);

    const analysisPromises: Promise<void>[] = [];
    const generationPromise = (async () => {
      await runWithConcurrency(candidatesForBatch, IMAGE_GENERATION_CONCURRENCY, async candidate => {
        try {
          const response = await requestSwipeImages(nextOnboarding, [candidate], referenceImageUrl, nextBatchNumber);
          const image = response.images.find(item => item.planId === candidate.id) ?? response.images[0];
          if (!image) {
            throw new Error(response.errors[0] || `No generated image returned for ${candidate.id}.`);
          }

          if (response.errors.length) {
            setGenerationError(current => [current, ...response.errors].filter(Boolean).join(' '));
          }

          const analysisPromise = (async () => {
            try {
              const analysisByPlanId = await requestImageAnalysis([{ planId: image.planId, imageUrl: image.imageUrl }]);
              const analysis = requireReadyAnalysis(analysisByPlanId.get(image.planId));
              setCandidates(current =>
                current.map(item =>
                  item.id === candidate.id
                    ? {
                        ...item,
                        imageUrl: image.imageUrl,
                        generatedPrompt: image.revisedPrompt || image.prompt,
                        generationStatus: 'generated' as const,
                        readyAt: Date.now(),
                        intendedFeatures: createFeatureVector(analysis.features),
                        imageSummary: analysis.imageSummary,
                        suggestedRationales: analysis.rationaleSuggestions,
                        suggestedLikeRationales: analysis.likeRationaleSuggestions,
                        suggestedDislikeRationales: analysis.dislikeRationaleSuggestions
                      }
                    : item
                )
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Vision analysis failed.';
              setGenerationError(current => [current, `Rationale suggestions failed: ${message}`].filter(Boolean).join(' '));
              setCandidates(current =>
                current.map(item =>
                  item.id === candidate.id
                    ? {
                        ...item,
                        generatedPrompt: image.revisedPrompt || image.prompt,
                        generationStatus: 'failed' as const,
                        generationError: `Rationale suggestions failed: ${message}`
                      }
                    : item
                )
              );
              setTraceEvents(current => [
                createTrace('batch_generated', 'Rationale analysis failed', message),
                ...current
              ]);
            }
          })();
          analysisPromises.push(analysisPromise);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Image generation failed.';
          setGenerationError(current => [current, message].filter(Boolean).join(' '));
          setCandidates(current =>
            current.map(item =>
              item.id === candidate.id
                ? {
                    ...item,
                    generationStatus: 'failed' as const,
                    generationError: message
                  }
                : item
            )
          );
          setTraceEvents(current => [
            createTrace('batch_generated', 'Image generation fallback', message),
            ...current
          ]);
        }
      });

      await Promise.allSettled(analysisPromises);
      setIsGeneratingImages(false);
      setTraceEvents(current => [
        createTrace(
          'batch_generated',
          'Images ready',
          `Finished progressive generation and rationale analysis for ${candidatesForBatch.length} images.`
        ),
        ...current
      ]);
    })();
    pendingVisionRef.current = generationPromise;
    setPendingVisionActive(true);
    void generationPromise.finally(() => {
      if (pendingVisionRef.current === generationPromise) {
        pendingVisionRef.current = null;
        setPendingVisionActive(false);
      }
    });
  }, [
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
  ]);

  const awaitPendingVision = useCallback(async () => {
    if (!pendingVisionRef.current) {
      return;
    }
    setIsAwaitingVision(true);
    try {
      await pendingVisionRef.current;
    } finally {
      setIsAwaitingVision(false);
    }
  }, []);

  return {
    awaitPendingVision,
    generateNextBatch,
    generationError,
    isAwaitingVision,
    isGeneratingImages,
    pendingVisionActive
  };
}
