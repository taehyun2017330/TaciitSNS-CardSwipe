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

export const archetypes: Archetype[] = [
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
