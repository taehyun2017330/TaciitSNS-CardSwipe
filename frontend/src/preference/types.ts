import type { FeatureKey, FeatureVector } from './features';

export type FeedbackAction = 'like' | 'dislike';
export type BubbleMode = 'idle_insight' | 'summarize' | 'probe' | 'clarify' | 'challenge';
export type PromptStrategy = 'exploit' | 'explore' | 'diagnostic' | 'repair' | 'contrast' | 'near_neighbor' | 'boundary_test';
export type { FeatureKey, FeatureVector } from './features';

export interface OnboardingState {
  brandName: string;
  category: string;
  goal: string;
  audience: string;
  tone: string[];
  avoid: string;
}

export interface CandidateVisual {
  headline: string;
  subline: string;
  label: string;
  paletteClass: string;
  compositionClass: string;
  textureClass: string;
}

export interface PromptPlan {
  id: string;
  batchId: string;
  strategy: PromptStrategy;
  hypothesis: string;
  prompt: string;
  negativePrompt: string;
  targetAttributes: string[];
  intendedFeatures: FeatureVector;
  scoreBreakdown: {
    preferenceMatch: number;
    userGoalAlignment: number;
    diversityBonus: number;
    informationGain: number;
    repairValue: number;
    dislikedFeaturePenalty: number;
    finalScore: number;
  };
  rationale: string;
}

export interface ImageCandidate extends PromptPlan {
  imageId: string;
  imageUrl?: string;
  generatedPrompt?: string;
  generationStatus?: 'mock' | 'generating' | 'generated' | 'failed';
  generationError?: string;
  readyAt?: number;
  imageSummary?: string;
  suggestedRationales?: string[];
  suggestedLikeRationales?: string[];
  suggestedDislikeRationales?: string[];
  caption: string;
  tags: string[];
  visual: CandidateVisual;
}

export interface ExtractedReasonFacet {
  feature: FeatureKey;
  label: string;
  sentiment: 1 | -1;
  confidence: number;
  source: string;
}

export interface SemanticSignal {
  label: string;
  source: string;
  feedbackEventId: string;
  polarity: 1 | -1;
  confidence: number;
}

export interface FeedbackEvent {
  id: string;
  batchId: string;
  imageId: string;
  action: FeedbackAction;
  source: 'button' | 'keyboard' | 'grid';
  reasonText: string;
  reasonChips: string[];
  extractedFacets: ExtractedReasonFacet[];
  createdAt: string;
}

export interface PreferenceFacet {
  feature: FeatureKey;
  label: string;
  dimension: string;
  alpha: number;
  beta: number;
  mean: number;
  weight: number;
  directionConfidence: number;
  evidenceConfidence: number;
  confidence: number;
  evidenceVolume: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  sourceTypes: Array<'swipe' | 'reason' | 'clarification' | 'onboarding'>;
  lastSeenBatch: number;
}

export interface SemanticMemory {
  likedDirections: SemanticSignal[];
  dislikedDirections: SemanticSignal[];
  hardAvoids: SemanticSignal[];
  uncertainties: string[];
  styleBrief: string;
  positiveExemplars: string[];
  negativeExemplars: string[];
}

export interface UnresolvedTerm {
  term: string;
  possibleMeanings: string[];
  mappingConfidence: number;
  feedbackEventId: string;
  asked: boolean;
}

export interface AmbiguityRecord {
  id: string;
  question: string;
  feature: FeatureKey;
  options: string[];
  priority: number;
  asked: boolean;
}

export interface ContradictionRecord {
  id: string;
  message: string;
  feature: FeatureKey;
  globalWeight: number;
  recentWeight: number;
  severity: number;
  asked: boolean;
}

export interface PreferenceState {
  version: number;
  summary: string;
  facets: Record<FeatureKey, PreferenceFacet>;
  semanticMemory: SemanticMemory;
  visionEvidenceImageIds: string[];
  unresolvedTerms: UnresolvedTerm[];
  ambiguities: AmbiguityRecord[];
  contradictions: ContradictionRecord[];
  currentGenerationGuidance: {
    leanInto: string[];
    avoid: string[];
    testNext: string[];
    semanticBrief: string;
    strategyMix: PromptStrategy[];
  };
  lastExtractedFacets: ExtractedReasonFacet[];
  questionHistory: string[];
}

export interface BubbleAction {
  mode: BubbleMode;
  message: string;
  options: string[];
  target?: FeatureKey;
  unresolvedTerm?: string;
  internalReason: string;
}

export interface TraceEvent {
  id: string;
  type:
    | 'session_started'
    | 'batch_generated'
    | 'image_liked'
    | 'image_disliked'
    | 'reason_added'
    | 'preference_updated'
    | 'clarification_asked'
    | 'clarification_answered';
  title: string;
  detail: string;
  createdAt: string;
}

export interface SwipeGeneratedImageResponse {
  planId: string;
  imageUrl: string;
  model: string;
  size: string;
  quality: string;
  prompt: string;
  revisedPrompt?: string;
  analyzedFeatures?: Partial<FeatureVector>;
}

export interface SwipeImageGenerationResponse {
  model: string;
  size: string;
  quality: string;
  images: SwipeGeneratedImageResponse[];
  errors: string[];
}

export interface SynthesizedPlanResponse {
  id: string;
  strategy: string;
  hypothesis: string;
  prompt: string;
  negativePrompt: string;
  targetAttributes?: string[];
}

export interface SwipePromptSynthesisResponse {
  plans: SynthesizedPlanResponse[];
}
