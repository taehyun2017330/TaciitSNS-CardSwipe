import type { OnboardingState } from './types';

// Display-only labels for the loading UI. Backend owns the real model/size/quality
// and returns them in the response — read those fields for post-generation display.
export const OPENAI_IMAGE_MODEL = 'gpt-image-2';
export const OPENAI_IMAGE_SIZE = '1024x1024';
export const OPENAI_IMAGE_QUALITY = 'medium';

export const DEFAULT_ONBOARDING: OnboardingState = {
  brandName: 'Harbor & Thread',
  category: 'Fashion retail',
  goal: 'Create social posts for a seasonal sale without making the brand feel cheap.',
  audience: 'Style-conscious local shoppers who care about quality.',
  tone: ['credible', 'premium', 'warm'],
  avoid: 'generic discount graphics, synthetic backgrounds, cluttered sale badges'
};

export const QUICK_REASONS = [
  'Feels premium',
  'Too promotional',
  'Color works',
  'Wrong mood',
  'Clean layout',
  'Too generic',
  'Better for my brand',
  'Not the audience'
];

export const TONE_OPTIONS = ['premium', 'warm', 'playful', 'credible', 'calm', 'energetic', 'editorial', 'minimal'];
