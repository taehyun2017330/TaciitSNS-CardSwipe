import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

import { apiFetch } from './api';
import './PreferenceSwipePrototype.css';

type FeedbackAction = 'like' | 'dislike';
type BubbleMode = 'idle_insight' | 'summarize' | 'probe' | 'clarify' | 'challenge';
type PromptStrategy = 'exploit' | 'explore' | 'diagnostic' | 'repair' | 'contrast';
type FeatureKey =
  | 'palette.brightness'
  | 'palette.saturation'
  | 'palette.warmth'
  | 'palette.blueDominance'
  | 'composition.minimal'
  | 'composition.editorial'
  | 'composition.dynamic'
  | 'composition.cluttered'
  | 'setting.coastal'
  | 'setting.urban'
  | 'setting.studio'
  | 'lighting.sunny'
  | 'lighting.moody'
  | 'lighting.synthetic'
  | 'typography.clean'
  | 'typography.playful'
  | 'marketing.saleEmphasis'
  | 'marketing.subtlety'
  | 'mood.premium'
  | 'mood.credible'
  | 'mood.playful'
  | 'mood.energetic'
  | 'mood.calm'
  | 'mood.cheap';

type FeatureVector = Record<FeatureKey, number>;

interface OnboardingState {
  brandName: string;
  category: string;
  goal: string;
  audience: string;
  tone: string[];
  avoid: string;
}

interface PromptPlan {
  id: string;
  batchId: string;
  strategy: PromptStrategy;
  hypothesis: string;
  prompt: string;
  negativePrompt: string;
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

interface ImageCandidate extends PromptPlan {
  imageId: string;
  imageUrl?: string;
  generatedPrompt?: string;
  generationStatus?: 'mock' | 'generating' | 'generated' | 'failed';
  generationError?: string;
  caption: string;
  tags: string[];
  visual: {
    headline: string;
    subline: string;
    label: string;
    paletteClass: string;
    compositionClass: string;
    textureClass: string;
  };
}

interface ExtractedReasonFacet {
  feature: FeatureKey;
  label: string;
  sentiment: 1 | -1;
  confidence: number;
  source: string;
}

interface FeedbackEvent {
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

interface PreferenceFacet {
  feature: FeatureKey;
  label: string;
  dimension: string;
  weight: number;
  confidence: number;
  evidenceFor: string[];
  evidenceAgainst: string[];
  sourceTypes: Array<'swipe' | 'reason' | 'clarification' | 'onboarding'>;
  lastSeenBatch: number;
}

interface UnresolvedTerm {
  term: string;
  possibleMeanings: string[];
  mappingConfidence: number;
  feedbackEventId: string;
  asked: boolean;
}

interface AmbiguityRecord {
  id: string;
  question: string;
  feature: FeatureKey;
  options: string[];
  priority: number;
  asked: boolean;
}

interface ContradictionRecord {
  id: string;
  message: string;
  feature: FeatureKey;
  globalWeight: number;
  recentWeight: number;
  severity: number;
  asked: boolean;
}

interface PreferenceState {
  version: number;
  summary: string;
  facets: Record<FeatureKey, PreferenceFacet>;
  unresolvedTerms: UnresolvedTerm[];
  ambiguities: AmbiguityRecord[];
  contradictions: ContradictionRecord[];
  currentGenerationGuidance: {
    leanInto: string[];
    avoid: string[];
    testNext: string[];
  };
  lastExtractedFacets: ExtractedReasonFacet[];
  questionHistory: string[];
}

interface BubbleAction {
  mode: BubbleMode;
  message: string;
  options: string[];
  target?: FeatureKey;
  unresolvedTerm?: string;
  internalReason: string;
}

interface TraceEvent {
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

interface SwipeGeneratedImageResponse {
  planId: string;
  imageUrl: string;
  model: string;
  size: string;
  quality: string;
  prompt: string;
  revisedPrompt?: string;
}

interface SwipeImageGenerationResponse {
  model: string;
  size: string;
  quality: string;
  images: SwipeGeneratedImageResponse[];
  errors: string[];
}

const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const OPENAI_IMAGE_SIZE = '1024x1024';
const OPENAI_IMAGE_QUALITY = 'medium';

const FEATURE_META: Record<FeatureKey, { label: string; dimension: string }> = {
  'palette.brightness': { label: 'bright palette', dimension: 'palette' },
  'palette.saturation': { label: 'saturated color', dimension: 'palette' },
  'palette.warmth': { label: 'warm color temperature', dimension: 'palette' },
  'palette.blueDominance': { label: 'blue-dominant palette', dimension: 'palette' },
  'composition.minimal': { label: 'minimal composition', dimension: 'composition' },
  'composition.editorial': { label: 'editorial composition', dimension: 'composition' },
  'composition.dynamic': { label: 'dynamic composition', dimension: 'composition' },
  'composition.cluttered': { label: 'cluttered layout', dimension: 'composition' },
  'setting.coastal': { label: 'coastal or beach setting', dimension: 'setting' },
  'setting.urban': { label: 'urban setting', dimension: 'setting' },
  'setting.studio': { label: 'studio product setting', dimension: 'setting' },
  'lighting.sunny': { label: 'sunny lighting', dimension: 'lighting' },
  'lighting.moody': { label: 'moody lighting', dimension: 'lighting' },
  'lighting.synthetic': { label: 'synthetic lighting', dimension: 'lighting' },
  'typography.clean': { label: 'clean typography', dimension: 'typography' },
  'typography.playful': { label: 'playful typography', dimension: 'typography' },
  'marketing.saleEmphasis': { label: 'strong sale emphasis', dimension: 'marketing' },
  'marketing.subtlety': { label: 'subtle offer treatment', dimension: 'marketing' },
  'mood.premium': { label: 'premium mood', dimension: 'mood' },
  'mood.credible': { label: 'credible tone', dimension: 'mood' },
  'mood.playful': { label: 'playful mood', dimension: 'mood' },
  'mood.energetic': { label: 'energetic mood', dimension: 'mood' },
  'mood.calm': { label: 'calm mood', dimension: 'mood' },
  'mood.cheap': { label: 'cheap-looking cues', dimension: 'mood' }
};

const FEATURE_KEYS = Object.keys(FEATURE_META) as FeatureKey[];

const EMPTY_FEATURES = FEATURE_KEYS.reduce((acc, key) => {
  acc[key] = 0;
  return acc;
}, {} as FeatureVector);

const DEFAULT_ONBOARDING: OnboardingState = {
  brandName: 'Harbor & Thread',
  category: 'Fashion retail',
  goal: 'Create social posts for a seasonal sale without making the brand feel cheap.',
  audience: 'Style-conscious local shoppers who care about quality.',
  tone: ['credible', 'premium', 'warm'],
  avoid: 'generic discount graphics, synthetic backgrounds, cluttered sale badges'
};

const QUICK_REASONS = [
  'Feels premium',
  'Too promotional',
  'Color works',
  'Wrong mood',
  'Clean layout',
  'Too generic',
  'Better for my brand',
  'Not the audience'
];

const TONE_OPTIONS = ['premium', 'warm', 'playful', 'credible', 'calm', 'energetic', 'editorial', 'minimal'];

function clamp(value: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function nowIso() {
  return new Date().toISOString();
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function createFeatureVector(values: Partial<FeatureVector>): FeatureVector {
  return {
    ...EMPTY_FEATURES,
    ...values
  };
}

function createInitialPreferenceState(onboarding: OnboardingState): PreferenceState {
  const facets = FEATURE_KEYS.reduce((acc, feature) => {
    acc[feature] = {
      feature,
      label: FEATURE_META[feature].label,
      dimension: FEATURE_META[feature].dimension,
      weight: 0,
      confidence: 0,
      evidenceFor: [],
      evidenceAgainst: [],
      sourceTypes: [],
      lastSeenBatch: 0
    };
    return acc;
  }, {} as Record<FeatureKey, PreferenceFacet>);

  const toneToFeatures: Record<string, FeatureKey[]> = {
    premium: ['mood.premium', 'typography.clean', 'marketing.subtlety'],
    warm: ['palette.warmth', 'lighting.sunny'],
    playful: ['mood.playful', 'typography.playful'],
    credible: ['mood.credible', 'composition.editorial'],
    calm: ['mood.calm', 'composition.minimal'],
    energetic: ['mood.energetic', 'composition.dynamic'],
    editorial: ['composition.editorial', 'mood.premium'],
    minimal: ['composition.minimal', 'typography.clean']
  };

  onboarding.tone.forEach(tone => {
    toneToFeatures[tone]?.forEach(feature => {
      facets[feature] = {
        ...facets[feature],
        weight: clamp(facets[feature].weight + 0.22),
        confidence: clamp(facets[feature].confidence + 0.24, 0, 1),
        sourceTypes: Array.from(new Set([...facets[feature].sourceTypes, 'onboarding']))
      };
    });
  });

  if (onboarding.avoid.toLowerCase().includes('clutter')) {
    facets['composition.cluttered'] = {
      ...facets['composition.cluttered'],
      weight: -0.32,
      confidence: 0.34,
      sourceTypes: ['onboarding']
    };
  }

  if (onboarding.avoid.toLowerCase().includes('discount') || onboarding.avoid.toLowerCase().includes('promo')) {
    facets['marketing.saleEmphasis'] = {
      ...facets['marketing.saleEmphasis'],
      weight: -0.28,
      confidence: 0.31,
      sourceTypes: ['onboarding']
    };
  }

  return refreshPreferenceDerivedState({
    version: 1,
    summary: 'Waiting for swipe evidence.',
    facets,
    unresolvedTerms: [],
    ambiguities: [],
    contradictions: [],
    currentGenerationGuidance: {
      leanInto: [],
      avoid: [],
      testNext: []
    },
    lastExtractedFacets: [],
    questionHistory: []
  });
}

function getTopFacets(state: PreferenceState, polarity: 'positive' | 'negative', count = 4) {
  return FEATURE_KEYS
    .map(key => state.facets[key])
    .filter(facet => (polarity === 'positive' ? facet.weight > 0.12 : facet.weight < -0.12))
    .sort((a, b) => {
      const left = Math.abs(a.weight) * (0.6 + a.confidence);
      const right = Math.abs(b.weight) * (0.6 + b.confidence);
      return right - left;
    })
    .slice(0, count);
}

function refreshPreferenceDerivedState(state: PreferenceState): PreferenceState {
  const positive = getTopFacets(state, 'positive', 5);
  const negative = getTopFacets(state, 'negative', 5);
  const uncertainStrong = FEATURE_KEYS
    .map(key => state.facets[key])
    .filter(facet => Math.abs(facet.weight) > 0.22 && facet.confidence < 0.55)
    .slice(0, 3);

  const summaryParts = [];
  if (positive.length) {
    summaryParts.push(`Leaning toward ${positive.slice(0, 3).map(f => f.label).join(', ')}.`);
  }
  if (negative.length) {
    summaryParts.push(`Avoiding ${negative.slice(0, 3).map(f => f.label).join(', ')}.`);
  }

  return {
    ...state,
    summary: summaryParts.join(' ') || 'Waiting for swipe evidence.',
    currentGenerationGuidance: {
      leanInto: positive.map(facet => facet.label),
      avoid: negative.map(facet => facet.label),
      testNext: [
        ...state.unresolvedTerms
          .filter(term => !term.asked)
          .slice(0, 2)
          .map(term => `what "${term.term}" should mean visually`),
        ...state.ambiguities
          .filter(item => !item.asked)
          .slice(0, 2)
          .map(item => item.question),
        ...uncertainStrong.map(facet => `whether ${facet.label} is a true preference`)
      ].slice(0, 4)
    }
  };
}

function extractReasonFacets(reasonText: string, reasonChips: string[], action: FeedbackAction): {
  facets: ExtractedReasonFacet[];
  unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>>;
} {
  const text = `${reasonText} ${reasonChips.join(' ')}`.toLowerCase();
  const direction: 1 | -1 = action === 'like' ? 1 : -1;
  const facets: ExtractedReasonFacet[] = [];
  const unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>> = [];

  const add = (feature: FeatureKey, sentiment: 1 | -1, confidence: number, source: string) => {
    facets.push({
      feature,
      label: FEATURE_META[feature].label,
      sentiment,
      confidence,
      source
    });
  };

  if (!text.trim()) {
    return { facets, unresolvedTerms };
  }

  if (/premium|expensive|luxury|elevated|high[- ]end/.test(text)) {
    add('mood.premium', direction, 0.74, 'premium');
    add('typography.clean', direction, 0.48, 'premium');
    unresolvedTerms.push({
      term: 'premium',
      possibleMeanings: ['cleaner typography', 'lower discount emphasis', 'more editorial composition', 'darker/refined palette'],
      mappingConfidence: 0.42
    });
  }

  if (/cheap|discounty|salesy|too promotional|promo|loud sale/.test(text)) {
    add('mood.cheap', action === 'like' ? 1 : -1, 0.84, 'cheap/promotional');
    add('marketing.saleEmphasis', action === 'like' ? 1 : -1, 0.82, 'cheap/promotional');
    add('marketing.subtlety', action === 'like' ? -1 : 1, 0.72, 'cheap/promotional');
  }

  if (/clean|simple|minimal|not busy/.test(text)) {
    add('composition.minimal', direction, 0.78, 'clean/minimal');
    add('typography.clean', direction, 0.74, 'clean/minimal');
  }

  if (/clutter|busy|too much|crowded/.test(text)) {
    add('composition.cluttered', action === 'like' ? 1 : -1, 0.86, 'clutter');
  }

  if (/bright|sunny|light/.test(text)) {
    add('palette.brightness', direction, 0.74, 'bright/sunny');
    add('lighting.sunny', direction, 0.7, 'bright/sunny');
  }

  if (/warm|coral|yellow|gold|sand/.test(text)) {
    add('palette.warmth', direction, 0.72, 'warm color');
  }

  if (/blue|cool|cold/.test(text)) {
    add('palette.blueDominance', direction, 0.68, 'blue/cool');
    unresolvedTerms.push({
      term: 'blue',
      possibleMeanings: ['avoid blue completely', 'avoid cold blue dominance', 'allow sunny blue accents'],
      mappingConfidence: 0.46
    });
  }

  if (/beach|coastal|summer|outdoor/.test(text)) {
    add('setting.coastal', direction, 0.78, 'coastal');
  }

  if (/urban|city|street/.test(text)) {
    add('setting.urban', direction, 0.7, 'urban');
  }

  if (/editorial|campaign|magazine/.test(text)) {
    add('composition.editorial', direction, 0.8, 'editorial');
  }

  if (/generic|stock|template/.test(text)) {
    add('mood.credible', action === 'like' ? -1 : 1, 0.7, 'generic');
    unresolvedTerms.push({
      term: 'generic',
      possibleMeanings: ['too template-like', 'wrong audience', 'weak product specificity', 'not enough brand personality'],
      mappingConfidence: 0.39
    });
  }

  if (/neon|synthetic|fake|ai/.test(text)) {
    add('lighting.synthetic', action === 'like' ? 1 : -1, 0.84, 'synthetic lighting');
  }

  if (/calm|quiet|restrained/.test(text)) {
    add('mood.calm', direction, 0.76, 'calm');
  }

  if (/energy|energetic|bold|movement/.test(text)) {
    add('mood.energetic', direction, 0.76, 'energy');
  }

  return { facets, unresolvedTerms };
}

function createTrace(type: TraceEvent['type'], title: string, detail: string): TraceEvent {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    detail,
    createdAt: nowIso()
  };
}

const archetypes: Array<{
  name: string;
  strategy: PromptStrategy;
  features: Partial<FeatureVector>;
  prompt: string;
  negativePrompt: string;
  tags: string[];
  visual: ImageCandidate['visual'];
}> = [
  {
    name: 'warm coastal sale',
    strategy: 'exploit',
    features: {
      'palette.brightness': 0.86,
      'palette.saturation': 0.7,
      'palette.warmth': 0.88,
      'palette.blueDominance': 0.22,
      'setting.coastal': 0.9,
      'lighting.sunny': 0.88,
      'typography.clean': 0.78,
      'marketing.subtlety': 0.72,
      'mood.premium': 0.66,
      'mood.credible': 0.72
    },
    prompt: 'Warm coastal fashion sale post with sunlit sand tones, restrained coral accents, clean premium typography, credible seasonal campaign mood.',
    negativePrompt: 'Avoid loud discount badges, cold blue dominance, cluttered product collage, synthetic neon lighting.',
    tags: ['coastal', 'warm', 'premium'],
    visual: {
      headline: 'Season Edit',
      subline: 'Selected pieces, refined for summer',
      label: 'Private Sale',
      paletteClass: 'swipe-post-card--warm',
      compositionClass: 'swipe-post-card--editorial',
      textureClass: 'swipe-post-card--coastal'
    }
  },
  {
    name: 'bright market energy',
    strategy: 'diagnostic',
    features: {
      'palette.brightness': 0.9,
      'palette.saturation': 0.86,
      'palette.warmth': 0.78,
      'composition.dynamic': 0.76,
      'setting.urban': 0.52,
      'lighting.sunny': 0.7,
      'typography.playful': 0.55,
      'mood.energetic': 0.82,
      'marketing.saleEmphasis': 0.54
    },
    prompt: 'Bright saturated summer market sale post with lively warm color, confident movement, and energetic but still polished retail layout.',
    negativePrompt: 'Avoid generic stock discount design, avoid cold moody palette.',
    tags: ['bright', 'energetic', 'diagnostic'],
    visual: {
      headline: 'Weekend Color',
      subline: 'Fresh arrivals with a limited offer',
      label: '20% Weekend',
      paletteClass: 'swipe-post-card--bright',
      compositionClass: 'swipe-post-card--dynamic',
      textureClass: 'swipe-post-card--market'
    }
  },
  {
    name: 'dark editorial credibility',
    strategy: 'explore',
    features: {
      'palette.brightness': 0.32,
      'palette.saturation': 0.38,
      'palette.warmth': 0.46,
      'composition.minimal': 0.78,
      'composition.editorial': 0.88,
      'setting.studio': 0.72,
      'lighting.moody': 0.64,
      'typography.clean': 0.88,
      'marketing.subtlety': 0.86,
      'mood.premium': 0.9,
      'mood.credible': 0.86,
      'mood.calm': 0.72
    },
    prompt: 'Dark editorial studio sale post with restrained product staging, fine typography, subtle offer language, credible premium campaign direction.',
    negativePrompt: 'Avoid playful discount stickers, loud urgency, cluttered collage, cheap sale aesthetics.',
    tags: ['editorial', 'premium', 'calm'],
    visual: {
      headline: 'Archive Offer',
      subline: 'Quiet pieces with lasting value',
      label: 'Members First',
      paletteClass: 'swipe-post-card--dark',
      compositionClass: 'swipe-post-card--minimal',
      textureClass: 'swipe-post-card--studio'
    }
  },
  {
    name: 'cool blue campaign',
    strategy: 'diagnostic',
    features: {
      'palette.brightness': 0.5,
      'palette.saturation': 0.46,
      'palette.blueDominance': 0.9,
      'composition.editorial': 0.62,
      'setting.coastal': 0.42,
      'lighting.moody': 0.74,
      'typography.clean': 0.68,
      'marketing.subtlety': 0.54,
      'mood.calm': 0.7,
      'mood.premium': 0.58
    },
    prompt: 'Cool blue editorial sale post with calm water-toned palette and restrained typography, testing blue dominance versus mood.',
    negativePrompt: 'Avoid warm coral palette and sunny beach treatment.',
    tags: ['blue', 'calm', 'diagnostic'],
    visual: {
      headline: 'Blue Hours',
      subline: 'A quieter seasonal selection',
      label: 'Soft Markdowns',
      paletteClass: 'swipe-post-card--blue',
      compositionClass: 'swipe-post-card--minimal',
      textureClass: 'swipe-post-card--coastal'
    }
  },
  {
    name: 'urban neon push',
    strategy: 'contrast',
    features: {
      'palette.brightness': 0.58,
      'palette.saturation': 0.88,
      'palette.blueDominance': 0.62,
      'composition.dynamic': 0.86,
      'composition.cluttered': 0.54,
      'setting.urban': 0.88,
      'lighting.synthetic': 0.86,
      'typography.playful': 0.68,
      'marketing.saleEmphasis': 0.72,
      'mood.energetic': 0.84
    },
    prompt: 'Urban neon flash sale post with bold street energy, high contrast accents, motion-forward typography, and urgent retail attitude.',
    negativePrompt: 'Avoid restrained editorial quietness.',
    tags: ['urban', 'neon', 'contrast'],
    visual: {
      headline: 'City Drop',
      subline: 'Fast pieces for late nights',
      label: 'Flash Sale',
      paletteClass: 'swipe-post-card--neon',
      compositionClass: 'swipe-post-card--dynamic',
      textureClass: 'swipe-post-card--urban'
    }
  },
  {
    name: 'clean product proof',
    strategy: 'repair',
    features: {
      'palette.brightness': 0.72,
      'palette.warmth': 0.56,
      'composition.minimal': 0.9,
      'composition.editorial': 0.62,
      'setting.studio': 0.86,
      'typography.clean': 0.92,
      'marketing.subtlety': 0.82,
      'mood.credible': 0.92,
      'mood.premium': 0.72,
      'mood.calm': 0.66
    },
    prompt: 'Clean product proof sale post with natural fabric detail, generous whitespace, subtle offer treatment, and credible small-business quality cues.',
    negativePrompt: 'Avoid clutter, loud sale labels, synthetic AI background, generic fashion collage.',
    tags: ['clean', 'credible', 'studio'],
    visual: {
      headline: 'Made to Last',
      subline: 'A closer look at the pieces on offer',
      label: 'Quality Edit',
      paletteClass: 'swipe-post-card--linen',
      compositionClass: 'swipe-post-card--minimal',
      textureClass: 'swipe-post-card--studio'
    }
  },
  {
    name: 'playful sticker sale',
    strategy: 'explore',
    features: {
      'palette.brightness': 0.82,
      'palette.saturation': 0.78,
      'palette.warmth': 0.54,
      'composition.dynamic': 0.72,
      'composition.cluttered': 0.5,
      'typography.playful': 0.88,
      'marketing.saleEmphasis': 0.82,
      'mood.playful': 0.9,
      'mood.energetic': 0.64,
      'mood.cheap': 0.42
    },
    prompt: 'Playful sale post with sticker-like offer treatment, optimistic color, approachable typography, and direct retail energy.',
    negativePrompt: 'Avoid quiet luxury restraint and dark editorial styling.',
    tags: ['playful', 'sale-heavy', 'explore'],
    visual: {
      headline: 'Little Finds',
      subline: 'Good pieces, lighter prices',
      label: 'Sale Picks',
      paletteClass: 'swipe-post-card--playful',
      compositionClass: 'swipe-post-card--dynamic',
      textureClass: 'swipe-post-card--market'
    }
  },
  {
    name: 'sunny blue accent',
    strategy: 'diagnostic',
    features: {
      'palette.brightness': 0.84,
      'palette.saturation': 0.68,
      'palette.warmth': 0.72,
      'palette.blueDominance': 0.36,
      'composition.editorial': 0.68,
      'setting.coastal': 0.82,
      'lighting.sunny': 0.9,
      'typography.clean': 0.74,
      'marketing.subtlety': 0.66,
      'mood.credible': 0.72
    },
    prompt: 'Sunny beach sale post where blue appears only as a small water accent, anchored by warm sand, coral type, and credible campaign styling.',
    negativePrompt: 'Avoid cold or moody blue dominance, avoid synthetic water glow, avoid cheap discount graphics.',
    tags: ['blue accent', 'coastal', 'diagnostic'],
    visual: {
      headline: 'Sunlit Selects',
      subline: 'Warm-weather staples, gently reduced',
      label: 'Early Access',
      paletteClass: 'swipe-post-card--sunny-blue',
      compositionClass: 'swipe-post-card--editorial',
      textureClass: 'swipe-post-card--coastal'
    }
  },
  {
    name: 'warm editorial no beach',
    strategy: 'diagnostic',
    features: {
      'palette.brightness': 0.78,
      'palette.saturation': 0.58,
      'palette.warmth': 0.84,
      'composition.editorial': 0.82,
      'setting.studio': 0.62,
      'lighting.sunny': 0.7,
      'typography.clean': 0.82,
      'marketing.subtlety': 0.74,
      'mood.premium': 0.76,
      'mood.credible': 0.78
    },
    prompt: 'Warm editorial sale post without a beach setting, using natural light, polished typography, and premium retail restraint.',
    negativePrompt: 'Avoid coastal cues, blue water, crowded sale stickers.',
    tags: ['warm', 'no beach', 'diagnostic'],
    visual: {
      headline: 'Warm Edit',
      subline: 'A softer way to announce the sale',
      label: 'Seasonal Offer',
      paletteClass: 'swipe-post-card--terra',
      compositionClass: 'swipe-post-card--editorial',
      textureClass: 'swipe-post-card--studio'
    }
  },
  {
    name: 'direct discount grid',
    strategy: 'contrast',
    features: {
      'palette.brightness': 0.76,
      'palette.saturation': 0.7,
      'composition.cluttered': 0.82,
      'composition.dynamic': 0.58,
      'typography.playful': 0.62,
      'marketing.saleEmphasis': 0.94,
      'mood.energetic': 0.7,
      'mood.cheap': 0.68
    },
    prompt: 'Direct discount grid sale post with multiple offer modules, large percentage typography, and obvious retail urgency.',
    negativePrompt: 'Avoid subtlety, minimal layout, quiet editorial hierarchy.',
    tags: ['discount-heavy', 'contrast'],
    visual: {
      headline: 'Sale Now',
      subline: 'Multiple deals across the shop',
      label: 'Up to 40%',
      paletteClass: 'swipe-post-card--discount',
      compositionClass: 'swipe-post-card--busy',
      textureClass: 'swipe-post-card--market'
    }
  }
];

function featureValue(plan: PromptPlan | ImageCandidate, feature: FeatureKey) {
  return plan.intendedFeatures[feature] ?? 0;
}

function scorePlan(
  features: FeatureVector,
  state: PreferenceState,
  onboarding: OnboardingState,
  selectedPlans: PromptPlan[]
): PromptPlan['scoreBreakdown'] {
  const preferenceMatch = FEATURE_KEYS.reduce((sum, key) => {
    const facet = state.facets[key];
    return sum + features[key] * facet.weight * (0.55 + facet.confidence);
  }, 0);

  const userGoalText = `${onboarding.goal} ${onboarding.category} ${onboarding.tone.join(' ')}`.toLowerCase();
  const userGoalAlignment =
    (userGoalText.includes('sale') ? features['marketing.saleEmphasis'] * 0.18 + features['marketing.subtlety'] * 0.24 : 0.1) +
    (userGoalText.includes('premium') || userGoalText.includes('cheap')
      ? features['mood.premium'] * 0.24 + features['mood.credible'] * 0.18
      : 0.08) +
    (userGoalText.includes('fashion') ? features['composition.editorial'] * 0.16 : 0.06);

  const diversityBonus = selectedPlans.length
    ? Math.min(
        0.6,
        selectedPlans.reduce((sum, plan) => {
          const distance = FEATURE_KEYS.reduce((total, key) => total + Math.abs(features[key] - plan.intendedFeatures[key]), 0);
          return sum + distance / FEATURE_KEYS.length;
        }, 0) / selectedPlans.length
      )
    : 0.35;

  const informationGain = Math.min(
    0.8,
    state.currentGenerationGuidance.testNext.length * 0.08 +
      FEATURE_KEYS.reduce((sum, key) => {
        const facet = state.facets[key];
        return sum + (Math.abs(facet.weight) > 0.2 && facet.confidence < 0.56 && features[key] > 0.35 ? 0.07 : 0);
      }, 0)
  );

  const repairValue = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + (1 - features[facet.feature]) * Math.abs(facet.weight) * 0.16;
  }, 0);

  const dislikedFeaturePenalty = getTopFacets(state, 'negative', 5).reduce((sum, facet) => {
    return sum + Math.max(0, features[facet.feature] - 0.3) * Math.abs(facet.weight) * (0.8 + facet.confidence);
  }, 0);

  const finalScore =
    0.4 * preferenceMatch +
    0.2 * userGoalAlignment +
    0.15 * diversityBonus +
    0.15 * informationGain +
    0.1 * repairValue -
    0.3 * dislikedFeaturePenalty;

  return {
    preferenceMatch,
    userGoalAlignment,
    diversityBonus,
    informationGain,
    repairValue,
    dislikedFeaturePenalty,
    finalScore
  };
}

function buildPromptPlans(onboarding: OnboardingState, state: PreferenceState, batchNumber: number): PromptPlan[] {
  const selectedForScoring: PromptPlan[] = [];

  return archetypes.map((archetype, index) => {
    const features = createFeatureVector(archetype.features);
    const scoreBreakdown = scorePlan(features, state, onboarding, selectedForScoring);
    const batchId = `batch-${batchNumber}`;
    const positive = state.currentGenerationGuidance.leanInto.slice(0, 2).join(' and ');
    const negative = state.currentGenerationGuidance.avoid.slice(0, 2).join(' and ');
    const hypothesis =
      batchNumber === 1
        ? `Initial read on whether ${archetype.tags.slice(0, 2).join(' + ')} fits the goal.`
        : archetype.strategy === 'diagnostic'
          ? `Test ${archetype.tags[0]} against current uncertainty.`
          : archetype.strategy === 'repair'
            ? `Repair recent dislikes by reducing ${negative || 'risky visual cues'}.`
            : `Lean into ${positive || archetype.tags[0]} while keeping the slate varied.`;

    const plan: PromptPlan = {
      id: `${batchId}-plan-${index}`,
      batchId,
      strategy: archetype.strategy,
      hypothesis,
      prompt: `${archetype.prompt} Brand: ${onboarding.brandName}. Goal: ${onboarding.goal}`,
      negativePrompt: archetype.negativePrompt,
      intendedFeatures: features,
      scoreBreakdown,
      rationale:
        batchNumber === 1
          ? 'Seed the model with a wide but relevant taste sample.'
          : `Score balances preference match, repair value, and diagnostic value for ${archetype.name}.`
    };
    selectedForScoring.push(plan);
    return plan;
  });
}

function selectSlate(plans: PromptPlan[]): PromptPlan[] {
  const sorted = [...plans].sort((a, b) => b.scoreBreakdown.finalScore - a.scoreBreakdown.finalScore);
  const selected: PromptPlan[] = [];
  const preferredStrategies: PromptStrategy[] = ['exploit', 'repair', 'diagnostic', 'explore'];

  preferredStrategies.forEach(strategy => {
    const next = sorted.find(plan => plan.strategy === strategy && !selected.some(existing => existing.id === plan.id));
    if (next) {
      selected.push(next);
    }
  });

  sorted.forEach(plan => {
    if (selected.length < 4 && !selected.some(existing => existing.id === plan.id)) {
      selected.push(plan);
    }
  });

  return selected.slice(0, 4);
}

function createCandidateFromPlan(plan: PromptPlan, index: number): ImageCandidate {
  const archetype = archetypes.find(item => plan.prompt.includes(item.prompt.slice(0, 28))) ?? archetypes[index % archetypes.length];
  return {
    ...plan,
    imageId: `${plan.batchId}-image-${index}`,
    generationStatus: 'mock',
    caption: archetype.prompt,
    tags: archetype.tags,
    visual: archetype.visual
  };
}

function generateBatch(onboarding: OnboardingState, state: PreferenceState, batchNumber: number) {
  const plans = buildPromptPlans(onboarding, state, batchNumber);
  const slate = selectSlate(plans);
  return {
    batchId: `batch-${batchNumber}`,
    promptPlans: plans,
    candidates: slate.map(createCandidateFromPlan)
  };
}

async function requestOpenAiImages(
  onboarding: OnboardingState,
  selectedCandidates: ImageCandidate[]
): Promise<SwipeImageGenerationResponse> {
  const response = await apiFetch('/api/swipe/generate-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandName: onboarding.brandName,
      category: onboarding.category,
      goal: onboarding.goal,
      model: OPENAI_IMAGE_MODEL,
      size: OPENAI_IMAGE_SIZE,
      quality: OPENAI_IMAGE_QUALITY,
      outputFormat: 'png',
      plans: selectedCandidates.map(candidate => ({
        id: candidate.id,
        prompt: candidate.prompt,
        negativePrompt: candidate.negativePrompt,
        strategy: candidate.strategy,
        hypothesis: candidate.hypothesis
      }))
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Image generation failed with ${response.status}`);
  }

  return response.json();
}

function updateStateFromFeedback(
  state: PreferenceState,
  candidate: ImageCandidate,
  feedback: FeedbackEvent,
  batchNumber: number,
  allFeedback: FeedbackEvent[]
): PreferenceState {
  const next: PreferenceState = {
    ...state,
    version: state.version + 1,
    facets: { ...state.facets },
    unresolvedTerms: [...state.unresolvedTerms],
    ambiguities: [...state.ambiguities],
    contradictions: [...state.contradictions],
    lastExtractedFacets: feedback.extractedFacets
  };

  const direction = feedback.action === 'like' ? 1 : -1;
  const eventId = feedback.id;

  FEATURE_KEYS.forEach(feature => {
    const value = candidate.intendedFeatures[feature];
    if (value < 0.25) {
      return;
    }

    const previous = next.facets[feature];
    const delta = direction * value * 0.075;
    const sourceTypes = Array.from(new Set([...previous.sourceTypes, 'swipe'] as PreferenceFacet['sourceTypes']));

    next.facets[feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + Math.abs(value) * 0.035, 0, 1),
      evidenceFor: direction === 1 ? [...previous.evidenceFor, eventId] : previous.evidenceFor,
      evidenceAgainst: direction === -1 ? [...previous.evidenceAgainst, eventId] : previous.evidenceAgainst,
      sourceTypes,
      lastSeenBatch: batchNumber
    };
  });

  feedback.extractedFacets.forEach(extracted => {
    const previous = next.facets[extracted.feature];
    const delta = extracted.sentiment * extracted.confidence * 0.24;
    const sourceTypes = Array.from(new Set([...previous.sourceTypes, 'reason'] as PreferenceFacet['sourceTypes']));
    next.facets[extracted.feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + extracted.confidence * 0.2, 0, 1),
      evidenceFor: extracted.sentiment === 1 ? [...previous.evidenceFor, eventId] : previous.evidenceFor,
      evidenceAgainst: extracted.sentiment === -1 ? [...previous.evidenceAgainst, eventId] : previous.evidenceAgainst,
      sourceTypes,
      lastSeenBatch: batchNumber
    };
  });

  const extracted = extractReasonFacets(feedback.reasonText, feedback.reasonChips, feedback.action);
  extracted.unresolvedTerms.forEach(term => {
    const alreadyExists = next.unresolvedTerms.some(existing => existing.term === term.term && !existing.asked);
    if (!alreadyExists) {
      next.unresolvedTerms.push({
        ...term,
        feedbackEventId: feedback.id,
        asked: false
      });
    }
  });

  if (
    candidate.intendedFeatures['palette.blueDominance'] > 0.5 &&
    candidate.intendedFeatures['lighting.moody'] > 0.45 &&
    feedback.action === 'dislike' &&
    !next.ambiguities.some(item => item.feature === 'palette.blueDominance' && !item.asked)
  ) {
    next.ambiguities.push({
      id: `amb-blue-${feedback.id}`,
      question: 'whether blue itself is wrong, or only cold/moody blue',
      feature: 'palette.blueDominance',
      options: ['Avoid blue completely', 'Blue is okay as a sunny accent', 'The cold mood was the issue'],
      priority: 0.82,
      asked: false
    });
  }

  if (
    candidate.intendedFeatures['setting.urban'] > 0.62 &&
    candidate.intendedFeatures['lighting.synthetic'] > 0.55 &&
    feedback.action === 'dislike' &&
    !next.ambiguities.some(item => item.feature === 'setting.urban' && !item.asked)
  ) {
    next.ambiguities.push({
      id: `amb-urban-${feedback.id}`,
      question: 'whether urban is wrong, or just the synthetic neon execution',
      feature: 'setting.urban',
      options: ['Urban direction is wrong', 'Urban is okay, neon is wrong', 'Right direction, wrong execution'],
      priority: 0.76,
      asked: false
    });
  }

  const recent = allFeedback.slice(-5);
  FEATURE_KEYS.forEach(feature => {
    const globalWeight = next.facets[feature].weight;
    const recentWeight = recent.reduce((sum, event) => {
      const eventDirection = event.action === 'like' ? 1 : -1;
      return sum + eventDirection * (event.imageId === candidate.imageId ? candidate.intendedFeatures[feature] : 0);
    }, 0);

    if (
      recent.length >= 4 &&
      Math.sign(globalWeight) !== Math.sign(recentWeight) &&
      Math.abs(globalWeight) > 0.42 &&
      Math.abs(recentWeight) > 0.7 &&
      !next.contradictions.some(item => item.feature === feature && !item.asked)
    ) {
      next.contradictions.push({
        id: `contr-${feature}-${feedback.id}`,
        message: `Earlier evidence pointed ${globalWeight > 0 ? 'toward' : 'away from'} ${FEATURE_META[feature].label}, but recent choices suggest the opposite.`,
        feature,
        globalWeight,
        recentWeight,
        severity: Math.min(1, Math.abs(globalWeight) + Math.abs(recentWeight) / 3),
        asked: false
      });
    }
  });

  return refreshPreferenceDerivedState(next);
}

function applyClarificationAnswer(state: PreferenceState, bubble: BubbleAction, answer: string): PreferenceState {
  const next: PreferenceState = {
    ...state,
    version: state.version + 1,
    facets: { ...state.facets },
    unresolvedTerms: state.unresolvedTerms.map(term =>
      term.term === bubble.unresolvedTerm ? { ...term, asked: true } : term
    ),
    ambiguities: state.ambiguities.map(item =>
      item.feature === bubble.target ? { ...item, asked: true } : item
    ),
    contradictions: state.contradictions.map(item =>
      item.feature === bubble.target ? { ...item, asked: true } : item
    ),
    questionHistory: [...state.questionHistory, bubble.message]
  };

  const reinforce = (feature: FeatureKey, delta: number, confidence = 0.18) => {
    const previous = next.facets[feature];
    next.facets[feature] = {
      ...previous,
      weight: clamp(previous.weight + delta),
      confidence: clamp(previous.confidence + confidence, 0, 1),
      sourceTypes: Array.from(new Set([...previous.sourceTypes, 'clarification'] as PreferenceFacet['sourceTypes']))
    };
  };

  if (bubble.mode === 'summarize') {
    const amount = answer.toLowerCase().startsWith('yes') ? 0.12 : answer.toLowerCase().startsWith('mostly') ? 0.05 : -0.12;
    getTopFacets(state, 'positive', 3).forEach(facet => reinforce(facet.feature, amount, 0.12));
    getTopFacets(state, 'negative', 3).forEach(facet => reinforce(facet.feature, -amount, 0.12));
  }

  if (bubble.unresolvedTerm === 'premium') {
    if (answer.includes('typography')) reinforce('typography.clean', 0.34, 0.26);
    if (answer.includes('discount')) reinforce('marketing.subtlety', 0.34, 0.26);
    if (answer.includes('editorial')) reinforce('composition.editorial', 0.34, 0.26);
    if (answer.includes('palette')) {
      reinforce('palette.brightness', -0.18, 0.16);
      reinforce('mood.premium', 0.22, 0.16);
    }
  }

  if (bubble.unresolvedTerm === 'blue' || bubble.target === 'palette.blueDominance') {
    if (answer.includes('Avoid')) reinforce('palette.blueDominance', -0.46, 0.28);
    if (answer.includes('sunny accent')) {
      reinforce('palette.blueDominance', 0.16, 0.12);
      reinforce('lighting.sunny', 0.2, 0.12);
      reinforce('lighting.moody', -0.22, 0.16);
    }
    if (answer.includes('cold mood')) {
      reinforce('lighting.moody', -0.34, 0.24);
      reinforce('palette.blueDominance', -0.08, 0.08);
    }
  }

  if (bubble.target === 'setting.urban') {
    if (answer.includes('Urban direction is wrong')) reinforce('setting.urban', -0.42, 0.24);
    if (answer.includes('neon is wrong')) {
      reinforce('setting.urban', 0.16, 0.1);
      reinforce('lighting.synthetic', -0.42, 0.28);
    }
    if (answer.includes('wrong execution')) {
      reinforce('setting.urban', 0.1, 0.1);
      reinforce('composition.cluttered', -0.18, 0.12);
      reinforce('lighting.synthetic', -0.22, 0.18);
    }
  }

  if (bubble.mode === 'challenge' && bubble.target) {
    if (answer.includes('goal changed')) {
      FEATURE_KEYS.forEach(feature => {
        const previous = next.facets[feature];
        next.facets[feature] = {
          ...previous,
          weight: previous.lastSeenBatch >= state.version - 2 ? previous.weight : previous.weight * 0.62,
          confidence: previous.confidence * 0.86
        };
      });
    } else if (answer.includes('cleaner')) {
      reinforce('mood.energetic', 0.16, 0.12);
      reinforce('composition.cluttered', -0.32, 0.22);
      reinforce('typography.clean', 0.24, 0.18);
    }
  }

  return refreshPreferenceDerivedState(next);
}

function selectBubbleAction(
  state: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchComplete: boolean
): BubbleAction {
  const recentQuestions = new Set(state.questionHistory.slice(-4));
  const latestFeedback = feedbackEvents[feedbackEvents.length - 1];
  const latestReason = latestFeedback?.reasonText || latestFeedback?.reasonChips.join(' ') || '';

  const unresolved = state.unresolvedTerms.find(term => !term.asked && term.mappingConfidence < 0.55);
  if (unresolved && latestReason.toLowerCase().includes(unresolved.term)) {
    const message =
      unresolved.term === 'premium'
        ? 'When you say "premium," what should I change first?'
        : unresolved.term === 'blue'
          ? 'Should blue be avoided completely, or is it okay when it feels sunny and secondary?'
          : `When you say "${unresolved.term}," what should I treat as the real issue?`;

    if (!recentQuestions.has(message)) {
      return {
        mode: 'probe',
        message,
        options: unresolved.possibleMeanings,
        unresolvedTerm: unresolved.term,
        internalReason: `Low mapping confidence for "${unresolved.term}" (${unresolved.mappingConfidence.toFixed(2)}).`
      };
    }
  }

  const contradiction = state.contradictions.find(item => !item.asked && item.severity > 0.65);
  if (contradiction && feedbackEvents.length >= 6) {
    const message = `${contradiction.message} Has the goal changed?`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'challenge',
        message,
        options: ['My goal changed', 'Same goal, wrong earlier execution', 'Still want that energy, just cleaner'],
        target: contradiction.feature,
        internalReason: `Global weight ${contradiction.globalWeight.toFixed(2)} conflicts with recent weight ${contradiction.recentWeight.toFixed(2)}.`
      };
    }
  }

  const ambiguity = state.ambiguities.find(item => !item.asked && item.priority > 0.7);
  if (ambiguity && (batchComplete || feedbackEvents.length >= 3)) {
    const message = `I need to separate two things: ${ambiguity.question}.`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'clarify',
        message,
        options: ambiguity.options,
        target: ambiguity.feature,
        internalReason: `Ambiguity priority ${ambiguity.priority.toFixed(2)} for ${FEATURE_META[ambiguity.feature].label}.`
      };
    }
  }

  const positives = getTopFacets(state, 'positive', 3);
  const negatives = getTopFacets(state, 'negative', 2);
  const supportCount = positives.reduce((sum, facet) => sum + facet.evidenceFor.length, 0);
  const oppositionCount = negatives.reduce((sum, facet) => sum + facet.evidenceAgainst.length, 0);
  const summaryConfidence = positives.reduce((sum, facet) => sum + facet.confidence, 0) / Math.max(1, positives.length);

  if (batchComplete && supportCount + oppositionCount >= 4 && summaryConfidence > 0.54) {
    const message = `I’m reading your taste as: ${state.summary}`;
    if (!recentQuestions.has(message)) {
      return {
        mode: 'summarize',
        message,
        options: ['Yes, that is right', 'Mostly right', 'No, revise that'],
        internalReason: `Stable summary with ${supportCount + oppositionCount} evidence points and ${summaryConfidence.toFixed(2)} mean confidence.`
      };
    }
  }

  const passive =
    state.currentGenerationGuidance.testNext[0]
      ? `I’m testing ${state.currentGenerationGuidance.testNext[0]}.`
      : state.summary !== 'Waiting for swipe evidence.'
        ? state.summary
        : 'Swipe a few examples and I’ll turn the pattern into steering memory.';

  return {
    mode: 'idle_insight',
    message: passive,
    options: [],
    internalReason: 'No question cleared the information-gain threshold.'
  };
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
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
    {candidate.generationStatus === 'generating' ? (
      <div className="swipe-post-card__status">Generating with {OPENAI_IMAGE_MODEL}</div>
    ) : null}
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

  const activeCandidate = candidates[activeIndex] ?? null;
  const isActiveCandidatePending = activeCandidate?.generationStatus === 'generating';
  const isGeneratingBatch = isGeneratingImages || candidates.some(candidate => candidate.generationStatus === 'generating');
  const generatedImageCount = candidates.filter(candidate => candidate.generationStatus === 'generated').length;
  const batchFeedback = feedbackEvents.filter(event => event.batchId === `batch-${batchNumber}`);
  const batchComplete = candidates.length > 0 && batchFeedback.length >= candidates.length;

  const bubbleAction = useMemo(
    () => selectBubbleAction(preferenceState, feedbackEvents, batchComplete),
    [batchComplete, feedbackEvents, preferenceState]
  );

  const generateNextBatch = useCallback(async (nextState: PreferenceState, nextBatchNumber: number, nextOnboarding = onboarding) => {
    const batch = generateBatch(nextOnboarding, nextState, nextBatchNumber);
    const generatingCandidates = batch.candidates.map(candidate => ({
      ...candidate,
      generationStatus: 'generating' as const
    }));

    setPromptPlans(batch.promptPlans);
    setCandidates(generatingCandidates);
    setActiveIndex(0);
    setIsGridOpen(false);
    setReasonText('');
    setReasonChips([]);
    setGenerationError(null);
    setTraceEvents(current => [
      createTrace(
        'batch_generated',
        `Generated slate ${nextBatchNumber}`,
        `${OPENAI_IMAGE_MODEL}, ${OPENAI_IMAGE_SIZE}, ${OPENAI_IMAGE_QUALITY}. ${batch.candidates.map(candidate => `${candidate.strategy}: ${candidate.tags.join(', ')}`).join(' | ')}`
      ),
      ...current
    ]);

    setIsGeneratingImages(true);
    try {
      const [response] = await Promise.all([
        requestOpenAiImages(nextOnboarding, batch.candidates),
        delay(700)
      ]);
      const imagesByPlanId = new Map(response.images.map(image => [image.planId, image]));
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
          `OpenAI images ready`,
          `${response.images.length}/4 generated with ${response.model}, ${response.size}, ${response.quality}.`
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
    } finally {
      setIsGeneratingImages(false);
    }
  }, [onboarding]);

  const startSession = () => {
    const nextState = createInitialPreferenceState(onboarding);
    setPreferenceState(nextState);
    setFeedbackEvents([]);
    setTraceEvents([
      createTrace('session_started', 'Session started', `${onboarding.brandName} - ${onboarding.category}`)
    ]);
    setBatchNumber(1);
    void generateNextBatch(nextState, 1, onboarding);
    setPhase('studio');
  };

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

  const handleGenerateNext = () => {
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
                <strong>Generating images with {OPENAI_IMAGE_MODEL}</strong>
                <p>{OPENAI_IMAGE_SIZE} · {OPENAI_IMAGE_QUALITY} quality · {generatedImageCount} of {candidates.length || 4} returned</p>
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
                  <button className="swipe-primary-button" type="button" onClick={handleGenerateNext}>
                    <Sparkles size={18} />
                    Generate next 4
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

          <section className="swipe-rail-block">
            <h3>Why this bubble appeared</h3>
            <p className="swipe-muted">{bubbleAction.internalReason}</p>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default PreferenceSwipePrototype;
