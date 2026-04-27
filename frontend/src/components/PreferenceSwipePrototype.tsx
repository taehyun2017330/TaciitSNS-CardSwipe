import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Braces,
  Check,
  ChevronLeft,
  Grid3X3,
  History,
  Layers,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X
} from 'lucide-react';

import { apiFetch } from '../api';
import { archetypes } from '../preference/archetypes';
import {
  DEFAULT_ONBOARDING,
  OPENAI_IMAGE_QUALITY,
  OPENAI_IMAGE_SIZE,
  QUICK_REASONS,
  TONE_OPTIONS
} from '../preference/constants';
import {
  applyClarificationAnswer,
  createCandidateFromPlan,
  createFeatureVector,
  createInitialPreferenceState,
  extractReasonFacets,
  getTopFacets,
  selectBubbleAction,
  updateStateFromFeedback
} from '../preference/model';
import { requestImageAnalysis } from '../preference/analysis';
import { requestClarification } from '../preference/clarification';
import {
  clearSession,
  loadSession,
  saveSession
} from '../preference/persistence';
import {
  requestSynthesizedPlans,
  synthesizedPlanToCandidate
} from '../preference/synthesis';
import type {
  BubbleAction,
  FeedbackAction,
  FeedbackEvent,
  ImageCandidate,
  OnboardingState,
  PreferenceState,
  PromptPlan,
  SwipeImageGenerationResponse,
  TraceEvent
} from '../preference/types';
import { createTrace, delay, formatTime, nowIso } from '../preference/utils';
import './PreferenceSwipePrototype.css';

async function requestOpenAiImages(
  onboarding: OnboardingState,
  selectedCandidates: ImageCandidate[],
  referenceImageUrl: string | null = null,
  batchNumber: number = 1
): Promise<SwipeImageGenerationResponse> {
  const exploitIndex = referenceImageUrl
    ? selectedCandidates.findIndex(candidate => candidate.strategy === 'exploit')
    : -1;

  const response = await apiFetch('/api/swipe/generate-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandName: onboarding.brandName,
      category: onboarding.category,
      goal: onboarding.goal,
      audience: onboarding.audience,
      tone: onboarding.tone.join(', '),
      avoid: onboarding.avoid,
      referenceImageUrl: referenceImageUrl ?? '',
      batchNumber,
      plans: selectedCandidates.map((candidate, index) => ({
        id: candidate.id,
        prompt: candidate.prompt,
        negativePrompt: candidate.negativePrompt,
        useReference: index === exploitIndex
      }))
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Image generation failed with ${response.status}`);
  }

  return response.json();
}

const MiniPostCard = ({ candidate, isActive = false }: { candidate: ImageCandidate; isActive?: boolean }) => (
  <div
    className={[
      'swipe-post-card',
      candidate.imageUrl ? 'swipe-post-card--real-image' : '',
      candidate.generationStatus === 'generating' ? 'is-generating' : '',
      candidate.generationStatus === 'failed' ? 'is-failed' : '',
      candidate.visual.paletteClass,
      candidate.visual.compositionClass,
      candidate.visual.textureClass,
      isActive ? 'is-active' : ''
    ].join(' ')}
  >
    {candidate.imageUrl ? (
      <img className="swipe-post-card__image" src={candidate.imageUrl} alt={candidate.caption} />
    ) : candidate.generationStatus === 'failed' ? (
      <div className="swipe-post-card__failure">
        <strong>Generation failed</strong>
        <p>{candidate.generationError || 'No real image was returned for this card.'}</p>
      </div>
    ) : (
      <>
        <div className="swipe-post-card__grain" />
        <div className="swipe-post-card__media">
          <span className="swipe-post-card__plane swipe-post-card__plane--one" />
          <span className="swipe-post-card__plane swipe-post-card__plane--two" />
          <span className="swipe-post-card__product swipe-post-card__product--one" />
          <span className="swipe-post-card__product swipe-post-card__product--two" />
        </div>
        <div className="swipe-post-card__copy">
          <span>{candidate.visual.label}</span>
          <strong>{candidate.visual.headline}</strong>
          <p>{candidate.visual.subline}</p>
        </div>
      </>
    )}
    {candidate.generationStatus === 'failed' ? (
      <div className="swipe-post-card__status swipe-post-card__status--failed">Real image unavailable</div>
    ) : null}
  </div>
);

function PreferenceSwipePrototype() {
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
  const [showDebug, setShowDebug] = useState(true);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [lastLikedImageUrl, setLastLikedImageUrl] = useState<string | null>(null);
  const [llmBubble, setLlmBubble] = useState<BubbleAction | null>(null);

  const pendingVisionRef = useRef<Promise<void> | null>(null);
  const [isAwaitingVision, setIsAwaitingVision] = useState(false);

  const activeCandidate = candidates[activeIndex] ?? null;
  const isActiveCandidatePending = activeCandidate?.generationStatus === 'generating';
  const isGeneratingBatch = isGeneratingImages || candidates.some(candidate => candidate.generationStatus === 'generating');
  const renderedImageCount = candidates.filter(candidate => Boolean(candidate.imageUrl)).length;
  const imagesRendered = candidates.length > 0 && candidates.every(candidate => candidate.imageUrl || candidate.generationStatus === 'failed');
  const analysisInFlight = imagesRendered && candidates.some(candidate => candidate.generationStatus === 'generating');
  // Test config: Gemini for everything. Reset SHOW_CLARIFICATION + backend GEMINI_BATCH_LIMIT to re-enable.
  const SHOW_CLARIFICATION = false;
  const activeImageModel = 'gemini-2.5-flash-image';
  const batchFeedback = feedbackEvents.filter(event => event.batchId === `batch-${batchNumber}`);
  const batchComplete = candidates.length > 0 && batchFeedback.length >= candidates.length;

  const localBubble = useMemo(
    () => selectBubbleAction(preferenceState, feedbackEvents, batchComplete),
    [batchComplete, feedbackEvents, preferenceState]
  );
  const bubbleAction: BubbleAction = llmBubble ?? localBubble;

  const generateNextBatch = useCallback(async (nextState: PreferenceState, nextBatchNumber: number, nextOnboarding = onboarding, recentFeedback: FeedbackEvent[] = feedbackEvents, referenceImageUrl: string | null = lastLikedImageUrl) => {
    setIsGeneratingImages(true);
    setGenerationError(null);
    setActiveIndex(0);
    setIsGridOpen(false);
    setReasonText('');
    setReasonChips([]);

    let candidatesForBatch: ImageCandidate[] = [];
    try {
      const synthesized = await requestSynthesizedPlans(nextOnboarding, nextState, recentFeedback, nextBatchNumber);
      if (!synthesized.length) {
        throw new Error('Synthesis returned no plans.');
      }
      candidatesForBatch = synthesized.map((plan, index) => ({
        ...synthesizedPlanToCandidate(plan, index, nextBatchNumber),
        generationStatus: 'generating' as const
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prompt synthesis failed.';
      setGenerationError(`Could not synthesize prompts: ${message}`);
      setIsGeneratingImages(false);
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

    let generatedImages: SwipeImageGenerationResponse['images'] = [];
    try {
      const [response] = await Promise.all([
        requestOpenAiImages(nextOnboarding, candidatesForBatch, referenceImageUrl, nextBatchNumber),
        delay(700)
      ]);
      generatedImages = response.images;
      const imagesByPlanId = new Map(response.images.map(image => [image.planId, image]));
      // Unlock swipes immediately on gen completion. Vision runs in background below.
      setCandidates(current =>
        current.map(candidate => {
          const image = imagesByPlanId.get(candidate.id);
          if (!image) {
            return {
              ...candidate,
              generationStatus: 'failed' as const,
              generationError: response.errors[0] || 'No generated image returned for this plan.'
            };
          }
          return {
            ...candidate,
            imageUrl: image.imageUrl,
            generatedPrompt: image.revisedPrompt || image.prompt,
            generationStatus: 'generated' as const
          };
        })
      );
      setTraceEvents(current => [
        createTrace(
          'batch_generated',
          `Images ready`,
          `${response.images.length}/${candidatesForBatch.length} generated with ${response.model}, ${response.size}, ${response.quality}. Vision analysis running in background.`
        ),
        ...current
      ]);
      if (response.errors.length) {
        setGenerationError(response.errors.join(' '));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI image generation failed.';
      setGenerationError(message);
      setCandidates(current =>
        current.map(candidate => ({
          ...candidate,
          generationStatus: 'failed' as const,
          generationError: message
        }))
      );
      setTraceEvents(current => [
        createTrace('batch_generated', 'OpenAI generation fallback', message),
        ...current
      ]);
      setIsGeneratingImages(false);
      return;
    }

    setIsGeneratingImages(false);

    // Background vision: doesn't block swipes. handleGenerateNext awaits this
    // before firing the next batch's synthesis so preference state is current.
    const visionPromise = (async () => {
      try {
        const featuresByPlanId = await requestImageAnalysis(
          generatedImages.map(image => ({ planId: image.planId, imageUrl: image.imageUrl }))
        );
        setCandidates(current =>
          current.map(candidate => {
            const visionFeatures = featuresByPlanId.get(candidate.id);
            if (!visionFeatures) return candidate;
            return {
              ...candidate,
              intendedFeatures: createFeatureVector(visionFeatures)
            };
          })
        );
        setTraceEvents(current => [
          createTrace(
            'batch_generated',
            `Vision analysis complete`,
            `Scored ${featuresByPlanId.size} images on 24 features.`
          ),
          ...current
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vision analysis failed.';
        setTraceEvents(current => [
          createTrace('batch_generated', 'Vision analysis fallback', message),
          ...current
        ]);
      }
    })();
    pendingVisionRef.current = visionPromise;
    void visionPromise.finally(() => {
      if (pendingVisionRef.current === visionPromise) {
        pendingVisionRef.current = null;
      }
    });
  }, [feedbackEvents, lastLikedImageUrl, onboarding]);

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
    setLlmBubble(null);
  }, [batchNumber]);

  useEffect(() => {
    if (!SHOW_CLARIFICATION) {
      return;
    }
    if (phase !== 'studio' || !batchComplete) {
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
  }, [SHOW_CLARIFICATION, batchComplete, batchNumber, feedbackEvents, onboarding, phase, preferenceState]);

  const submitFeedback = useCallback(
    (candidate: ImageCandidate | null, action: FeedbackAction, source: FeedbackEvent['source'] = 'button') => {
      if (!candidate) {
        return;
      }

      if (candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed') {
        return;
      }

      const existing = feedbackEvents.some(event => event.imageId === candidate.imageId);
      if (existing) {
        return;
      }

      const extracted = extractReasonFacets(reasonText, reasonChips, action);
      const feedback: FeedbackEvent = {
        id: `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        batchId: candidate.batchId,
        imageId: candidate.imageId,
        action,
        source,
        reasonText: reasonText.trim(),
        reasonChips,
        extractedFacets: extracted.facets,
        createdAt: nowIso()
      };

      const nextFeedbackEvents = [...feedbackEvents, feedback];
      const nextState = updateStateFromFeedback(preferenceState, candidate, feedback, batchNumber, nextFeedbackEvents);

      setFeedbackEvents(nextFeedbackEvents);
      setPreferenceState(nextState);
      if (action === 'like' && candidate.imageUrl) {
        setLastLikedImageUrl(candidate.imageUrl);
      }
      setTraceEvents(current => [
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
      const nextIndex = candidates.findIndex(item => item.imageId === candidate.imageId) + 1;
      setActiveIndex(Math.min(candidates.length, nextIndex));
    },
    [batchNumber, candidates, feedbackEvents, preferenceState, reasonChips, reasonText]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        phase !== 'studio' ||
        !event.metaKey ||
        !activeCandidate ||
        activeCandidate.generationStatus === 'generating' ||
        activeCandidate.generationStatus === 'failed' ||
        batchComplete
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        submitFeedback(activeCandidate, 'dislike', 'keyboard');
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        submitFeedback(activeCandidate, 'like', 'keyboard');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeCandidate, batchComplete, phase, submitFeedback]);

  const handleGenerateNext = async () => {
    if (pendingVisionRef.current) {
      setIsAwaitingVision(true);
      try {
        await pendingVisionRef.current;
      } finally {
        setIsAwaitingVision(false);
      }
    }
    const next = batchNumber + 1;
    setBatchNumber(next);
    void generateNextBatch(preferenceState, next);
  };

  const handleBubbleAnswer = (answer: string) => {
    const nextState = applyClarificationAnswer(preferenceState, bubbleAction, answer);
    setPreferenceState(nextState);
    setTraceEvents(current => [
      createTrace('clarification_answered', bubbleAction.mode, answer),
      createTrace('preference_updated', `Preference state v${nextState.version}`, nextState.summary),
      ...current
    ]);
  };

  const toggleReasonChip = (chip: string) => {
    setReasonChips(current =>
      current.includes(chip) ? current.filter(item => item !== chip) : [...current, chip]
    );
  };

  const selectedPlanIds = new Set(candidates.map(candidate => candidate.id));
  const rankedPlanList = [...promptPlans].sort((a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore);
  const topPositive = getTopFacets(preferenceState, 'positive', 5);
  const topNegative = getTopFacets(preferenceState, 'negative', 5);

  if (phase === 'onboarding') {
    return (
      <div className="swipe-prototype swipe-prototype--onboarding">
        <main className="swipe-onboarding">
          <section className="swipe-onboarding__copy">
            <div className="swipe-kicker">
              <Sparkles size={16} />
              TacitSNS preference steering
            </div>
            <h1>Teach the image model by choosing, not writing prompts.</h1>
            <p>
              Start with a simple goal. The system generates four directions, watches your swipes,
              stores preference evidence, and asks a clarification only when it would improve the next slate.
            </p>
            <div className="swipe-onboarding__preview" aria-hidden="true">
              {archetypes.slice(0, 3).map((item, index) => {
                const plan: PromptPlan = {
                  id: `preview-${index}`,
                  batchId: 'preview',
                  strategy: item.strategy,
                  hypothesis: '',
                  prompt: item.prompt,
                  negativePrompt: item.negativePrompt,
                  intendedFeatures: createFeatureVector(item.features),
                  rationale: '',
                  scoreBreakdown: {
                    preferenceMatch: 0,
                    userGoalAlignment: 0,
                    diversityBonus: 0,
                    informationGain: 0,
                    repairValue: 0,
                    dislikedFeaturePenalty: 0,
                    finalScore: 0
                  }
                };
                return (
                  <MiniPostCard
                    key={item.name}
                    candidate={createCandidateFromPlan(plan, index)}
                    isActive={index === 1}
                  />
                );
              })}
            </div>
          </section>

          <section className="swipe-onboarding__form" aria-label="Onboarding">
            <label>
              <span>Brand or project</span>
              <input
                value={onboarding.brandName}
                onChange={event => setOnboarding(current => ({ ...current, brandName: event.target.value }))}
              />
            </label>

            <label>
              <span>Category</span>
              <input
                value={onboarding.category}
                onChange={event => setOnboarding(current => ({ ...current, category: event.target.value }))}
              />
            </label>

            <label>
              <span>Post goal</span>
              <textarea
                value={onboarding.goal}
                onChange={event => setOnboarding(current => ({ ...current, goal: event.target.value }))}
                rows={3}
              />
            </label>

            <label>
              <span>Audience</span>
              <input
                value={onboarding.audience}
                onChange={event => setOnboarding(current => ({ ...current, audience: event.target.value }))}
              />
            </label>

            <div className="swipe-fieldset">
              <span>Starting tone</span>
              <div className="swipe-chip-row">
                {TONE_OPTIONS.map(tone => (
                  <button
                    type="button"
                    key={tone}
                    className={onboarding.tone.includes(tone) ? 'is-selected' : ''}
                    onClick={() =>
                      setOnboarding(current => ({
                        ...current,
                        tone: current.tone.includes(tone)
                          ? current.tone.filter(item => item !== tone)
                          : [...current.tone, tone]
                      }))
                    }
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </div>

            <label>
              <span>Avoid</span>
              <textarea
                value={onboarding.avoid}
                onChange={event => setOnboarding(current => ({ ...current, avoid: event.target.value }))}
                rows={2}
              />
            </label>

            <button className="swipe-primary-button" type="button" onClick={startSession}>
              <Sparkles size={18} />
              Generate first 4
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="swipe-prototype">
      <header className="swipe-topbar">
        <button className="swipe-icon-text-button" type="button" onClick={() => setPhase('onboarding')}>
          <ChevronLeft size={17} />
          Onboarding
        </button>
        <div>
          <span>{onboarding.category}</span>
          <strong>{onboarding.brandName}</strong>
        </div>
        <button className="swipe-icon-text-button" type="button" onClick={() => setShowDebug(value => !value)}>
          <Braces size={17} />
          {showDebug ? 'Hide debug' : 'Show debug'}
        </button>
      </header>

      <main className="swipe-workbench">
        <aside className="swipe-memory-rail" aria-label="Preference memory">
          <section className="swipe-rail-block swipe-rail-block--summary">
            <div className="swipe-section-heading">
              <Layers size={16} />
              <h2>Preference memory</h2>
            </div>
            <p>{preferenceState.summary}</p>
            <dl>
              <div>
                <dt>State</dt>
                <dd>v{preferenceState.version}</dd>
              </div>
              <div>
                <dt>Swipes</dt>
                <dd>{feedbackEvents.length}</dd>
              </div>
              <div>
                <dt>Batch</dt>
                <dd>{batchNumber}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="swipe-link-button"
              onClick={forgetSavedMemory}
              title="Wipe persisted state for this brand"
            >
              Forget saved memory
            </button>
          </section>

          <section className="swipe-rail-block">
            <h3>Lean into</h3>
            <div className="swipe-weight-list">
              {topPositive.length ? topPositive.map(facet => (
                <div key={facet.feature} className="swipe-weight-item">
                  <span>{facet.label}</span>
                  <div>
                    <i style={{ width: `${Math.round(Math.abs(facet.weight) * 100)}%` }} />
                  </div>
                  <em>{facet.weight.toFixed(2)} / {facet.confidence.toFixed(2)}</em>
                </div>
              )) : <p className="swipe-muted">No stable likes yet.</p>}
            </div>
          </section>

          <section className="swipe-rail-block">
            <h3>Avoid</h3>
            <div className="swipe-weight-list swipe-weight-list--negative">
              {topNegative.length ? topNegative.map(facet => (
                <div key={facet.feature} className="swipe-weight-item">
                  <span>{facet.label}</span>
                  <div>
                    <i style={{ width: `${Math.round(Math.abs(facet.weight) * 100)}%` }} />
                  </div>
                  <em>{facet.weight.toFixed(2)} / {facet.confidence.toFixed(2)}</em>
                </div>
              )) : <p className="swipe-muted">No stable dislikes yet.</p>}
            </div>
          </section>

          <section className="swipe-rail-block swipe-traceboard">
            <div className="swipe-section-heading">
              <History size={16} />
              <h2>Traceboard</h2>
            </div>
            <div className="swipe-trace-list">
              {traceEvents.slice(0, 9).map(event => (
                <article key={event.id}>
                  <span>{formatTime(event.createdAt)}</span>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>

        <section className="swipe-stage" aria-label="Swipe cards">
          <div className="swipe-stage__header">
            <div>
              <span>Slate {batchNumber}</span>
              <h1>
                {batchComplete
                  ? 'Ready for the next four'
                  : isGeneratingBatch
                    ? `Generating real ${OPENAI_IMAGE_SIZE} images`
                    : activeCandidate?.hypothesis ?? 'Review the slate'}
              </h1>
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

          {generationError ? (
            <div className="swipe-generation-error">
              <strong>Real image generation did not complete for every card.</strong>
              <p>{generationError}</p>
            </div>
          ) : null}

          {isGeneratingBatch ? (
            <div className="swipe-generation-loading" role="status" aria-live="polite">
              <div className="swipe-generation-loading__mark">
                <Sparkles size={18} />
              </div>
              <div>
                {analysisInFlight ? (
                  <>
                    <strong>Analyzing visuals to unlock swipes…</strong>
                    <p>Reading palette, composition, and mood with vision (~5s).</p>
                  </>
                ) : (
                  <>
                    <strong>Generating images with {activeImageModel}</strong>
                    <p>{OPENAI_IMAGE_SIZE} · {OPENAI_IMAGE_QUALITY} quality · {renderedImageCount} of {candidates.length || 4} returned</p>
                  </>
                )}
              </div>
              <div className="swipe-generation-loading__bar" aria-hidden="true">
                <i />
              </div>
            </div>
          ) : null}

          {!isGridOpen ? (
            <div className="swipe-card-stack">
              {candidates.map((candidate, index) => {
                const offset = index - activeIndex;
                const isPast = offset < 0;
                return (
                  <div
                    key={candidate.imageId}
                    className={[
                      'swipe-stack-card',
                      index === activeIndex ? 'is-front' : '',
                      isPast ? 'is-past' : ''
                    ].join(' ')}
                    style={{
                      transform: `translateX(${offset * 10}px) translateY(${Math.abs(offset) * 8}px) rotate(${offset * 1.8}deg)`,
                      zIndex: candidates.length - Math.abs(offset),
                      opacity: isPast ? 0 : 1 - Math.max(0, offset) * 0.14,
                      pointerEvents: index === activeIndex ? 'auto' : 'none'
                    }}
                  >
                    <MiniPostCard candidate={candidate} isActive={index === activeIndex} />
                  </div>
                );
              })}

              {isGeneratingBatch ? (
                <div className="swipe-card-stack__loading" aria-hidden="true">
                  <div className="swipe-loading-spinner" />
                  <strong>Preparing your slate</strong>
                  <span>Swiping unlocks when the images finish loading.</span>
                </div>
              ) : null}

              {batchComplete ? (
                <div className="swipe-slate-complete">
                  <Check size={28} />
                  <h2>Four signals captured</h2>
                  <p>{preferenceState.currentGenerationGuidance.testNext[0] || preferenceState.summary}</p>
                  <button
                    className="swipe-primary-button"
                    type="button"
                    onClick={handleGenerateNext}
                    disabled={isAwaitingVision}
                  >
                    <Sparkles size={18} />
                    {isAwaitingVision ? 'Finishing analysis…' : 'Generate next 4'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="swipe-grid-view">
              {candidates.map(candidate => {
                const already = feedbackEvents.find(event => event.imageId === candidate.imageId);
                return (
                  <article key={candidate.imageId} className={already ? `is-${already.action}` : ''}>
                    <MiniPostCard candidate={candidate} />
                    <div>
                      <strong>{candidate.strategy}</strong>
                      <p>{candidate.hypothesis}</p>
                    </div>
                    <div className="swipe-grid-actions">
                      <button
                        type="button"
                        title="Dislike"
                        disabled={Boolean(already) || candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed'}
                        onClick={() => submitFeedback(candidate, 'dislike', 'grid')}
                      >
                        <ThumbsDown size={16} />
                      </button>
                      <button
                        type="button"
                        title="Like"
                        disabled={Boolean(already) || candidate.generationStatus === 'generating' || candidate.generationStatus === 'failed'}
                        onClick={() => submitFeedback(candidate, 'like', 'grid')}
                      >
                        <ThumbsUp size={16} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!batchComplete ? (
            <div className="swipe-feedback-console">
              <div className="swipe-feedback-console__reason">
                <label htmlFor="swipe-reason">Optional reason for this card</label>
                <textarea
                  id="swipe-reason"
                  value={reasonText}
                  onChange={event => setReasonText(event.target.value)}
                  placeholder="e.g. too promotional, the warm color works, feels more premium..."
                  disabled={isActiveCandidatePending || activeCandidate?.generationStatus === 'failed'}
                  rows={2}
                />
                <div className="swipe-chip-row">
                  {QUICK_REASONS.map(chip => (
                    <button
                      type="button"
                      key={chip}
                      className={reasonChips.includes(chip) ? 'is-selected' : ''}
                      disabled={isActiveCandidatePending || activeCandidate?.generationStatus === 'failed'}
                      onClick={() => toggleReasonChip(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="swipe-decision-row">
                <button
                  className="swipe-decision-button swipe-decision-button--no"
                  type="button"
                  disabled={isActiveCandidatePending || activeCandidate?.generationStatus === 'failed'}
                  onClick={() => submitFeedback(activeCandidate, 'dislike')}
                >
                  <X size={20} />
                  <span>Command Left</span>
                </button>
                <button
                  className="swipe-decision-button swipe-decision-button--yes"
                  type="button"
                  disabled={isActiveCandidatePending || activeCandidate?.generationStatus === 'failed'}
                  onClick={() => submitFeedback(activeCandidate, 'like')}
                >
                  <Check size={20} />
                  <span>Command Right</span>
                </button>
              </div>
            </div>
          ) : null}

          {showDebug ? (
            <section className="swipe-debug-panel">
              <div className="swipe-section-heading">
                <Braces size={16} />
                <h2>System debug</h2>
              </div>
              <div className="swipe-debug-grid">
                <div>
                  <h3>Latest extracted facets</h3>
                  {preferenceState.lastExtractedFacets.length ? (
                    <ul>
                      {preferenceState.lastExtractedFacets.map((facet, index) => (
                        <li key={`${facet.feature}-${index}`}>
                          <span>{facet.sentiment > 0 ? '+' : '-'}</span>
                          {facet.label}
                          <em>{facet.confidence.toFixed(2)}</em>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="swipe-muted">No explicit reason facets extracted yet.</p>
                  )}
                </div>
                <div>
                  <h3>Selected prompt plans</h3>
                  <ul>
                    {rankedPlanList.slice(0, 6).map(plan => (
                      <li key={plan.id} className={selectedPlanIds.has(plan.id) ? 'is-selected' : ''}>
                        <span>{plan.strategy}</span>
                        {plan.hypothesis}
                        <em>{plan.scoreBreakdown.finalScore.toFixed(2)}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </section>

        <aside className="swipe-ai-rail" aria-label="Dynamic clarification">
          {SHOW_CLARIFICATION && (
            <section className={`swipe-ai-bubble swipe-ai-bubble--${bubbleAction.mode}`}>
              <div className="swipe-section-heading">
                <MessageCircleQuestion size={16} />
                <h2>Expert clarification</h2>
              </div>
              <span className="swipe-ai-mode">{bubbleAction.mode.replace('_', ' ')}</span>
              <p>{bubbleAction.message}</p>
              {bubbleAction.options.length ? (
                <div className="swipe-ai-options">
                  {bubbleAction.options.map(option => (
                    <button type="button" key={option} onClick={() => handleBubbleAnswer(option)}>
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          )}

          <section className="swipe-rail-block">
            <h3>Generation guidance</h3>
            <div className="swipe-guidance-list">
              <strong>Lean into</strong>
              <p>{preferenceState.currentGenerationGuidance.leanInto.join(', ') || 'Gathering evidence.'}</p>
              <strong>Avoid</strong>
              <p>{preferenceState.currentGenerationGuidance.avoid.join(', ') || 'No strong negatives yet.'}</p>
              <strong>Test next</strong>
              <p>{preferenceState.currentGenerationGuidance.testNext.join(', ') || 'No targeted uncertainty yet.'}</p>
            </div>
          </section>

          {SHOW_CLARIFICATION && (
            <section className="swipe-rail-block">
              <h3>Why this bubble appeared</h3>
              <p className="swipe-muted">{bubbleAction.internalReason}</p>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

export default PreferenceSwipePrototype;
