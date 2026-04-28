import type { OnboardingState } from './types';

// Display-only labels for the loading UI. Backend owns the real model/size/quality
// and returns them in the response — read those fields for post-generation display.
export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_IMAGE_SIZE = '1024x1024';
export const OPENAI_IMAGE_QUALITY = 'medium';
export const PREFERENCE_PRIOR_ALPHA = 1;
export const PREFERENCE_PRIOR_BETA = 1;
export const PREFERENCE_EVIDENCE_DECAY = 0.97;
export const REASON_EQUIVALENT_SWIPES = 3;
export const PREFERENCE_EVIDENCE_SATURATION = 10;
export const FEATURE_EVIDENCE_FLOOR = 0.1;

export const DEFAULT_ONBOARDING: OnboardingState = {
  brandName: 'Harbor & Thread',
  category: 'Fashion retail',
  goal: 'Create social posts for a seasonal sale without making the brand feel cheap.',
  audience: 'Style-conscious local shoppers who care about quality.',
  tone: [],
  avoid: ''
};

export const LIKE_REASON_FALLBACKS = [
  'Feels premium',
  'Strong product clarity',
  'Feels native to social',
  'Warm color works',
  'Clean layout',
  'Human context helps',
  'Offer feels subtle',
  'Right audience'
];

export const DISLIKE_REASON_FALLBACKS = [
  'Too promotional',
  'Too much text',
  'Feels generic',
  'Wrong audience',
  'Composition feels cluttered',
  'Product is unclear',
  'Color feels off-brand',
  'Needs more human context'
];
