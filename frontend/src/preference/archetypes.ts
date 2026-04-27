import type { CandidateVisual, FeatureVector, PromptStrategy } from './types';

export interface Archetype {
  name: string;
  strategy: PromptStrategy;
  features: Partial<FeatureVector>;
  prompt: string;
  negativePrompt: string;
  tags: string[];
  visual: CandidateVisual;
}

// Used only for the onboarding preview cards and as a visual-styling fallback for
// LLM-synthesized candidates (cycled by index). The LLM owns prompt generation;
// these archetypes do NOT shape what the model produces.
export const archetypes: Archetype[] = [
  {
    name: 'warm coastal sale',
    strategy: 'exploit',
    features: {
      'palette.brightness': 0.86,
      'palette.warmth': 0.88,
      'setting.coastal': 0.9,
      'lighting.sunny': 0.88,
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
    name: 'dark editorial credibility',
    strategy: 'explore',
    features: {
      'palette.brightness': 0.32,
      'composition.minimal': 0.78,
      'composition.editorial': 0.88,
      'lighting.moody': 0.64,
      'mood.premium': 0.9,
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
    name: 'urban neon push',
    strategy: 'contrast',
    features: {
      'palette.saturation': 0.88,
      'composition.dynamic': 0.86,
      'setting.urban': 0.88,
      'lighting.synthetic': 0.86,
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
  }
];
