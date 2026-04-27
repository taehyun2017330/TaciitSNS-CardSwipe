import type { FeatureKey, FeatureVector } from './types';

export const FEATURE_META: Record<FeatureKey, { label: string; dimension: string }> = {
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

export const FEATURE_KEYS = Object.keys(FEATURE_META) as FeatureKey[];

export const EMPTY_FEATURES = FEATURE_KEYS.reduce((acc, key) => {
  acc[key] = 0;
  return acc;
}, {} as FeatureVector);
