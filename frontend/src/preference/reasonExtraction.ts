import { FEATURE_META, knownFeatureKey } from './features';
import type { ExtractedReasonFacet, FeatureKey, FeedbackAction, UnresolvedTerm } from './types';

interface ReasonRule {
  pattern: RegExp;
  features: Array<{
    key: FeatureKey;
    confidence: number;
    invertForDislike?: boolean;
    forceSentiment?: (action: FeedbackAction) => 1 | -1;
  }>;
  source: string;
  unresolved?: Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>;
}

const directionFor = (action: FeedbackAction): 1 | -1 => (action === 'like' ? 1 : -1);
const antiDirectionFor = (action: FeedbackAction): 1 | -1 => (action === 'like' ? -1 : 1);
const hasDesiredCorrectionCue = (text: string) =>
  /\b(need|needs|want|prefer|missing|lacks?|lacking|should|closer|more like|make it more|not enough|not prominent enough|does not have|doesn't have|has no|without)\b/.test(text);
const isGenericNegativeChip = (text: string) =>
  /\b(lacks?|lacking|no|less|limited|could benefit|could use|not suitable|may not|wrong|too)\b/.test(text);

const RULES: ReasonRule[] = [
  {
    pattern: /premium|expensive|luxury|elevated|high[- ]end/,
    source: 'premium positioning',
    features: [
      { key: 'mood.premium', confidence: 0.78 },
      { key: 'typography.clean', confidence: 0.48 },
      { key: 'marketing.subtlety', confidence: 0.44 }
    ],
    unresolved: {
      term: 'premium',
      possibleMeanings: ['cleaner typography', 'lower discount emphasis', 'more editorial composition', 'darker/refined palette'],
      mappingConfidence: 0.42
    }
  },
  {
    pattern: /cheap|discounty|salesy|too promotional|promo|loud sale|bargain/,
    source: 'cheap/promotional',
    features: [
      { key: 'mood.cheap', confidence: 0.86, forceSentiment: action => (action === 'like' ? 1 : -1) },
      { key: 'marketing.saleEmphasis', confidence: 0.82, forceSentiment: action => (action === 'like' ? 1 : -1) },
      { key: 'marketing.subtlety', confidence: 0.72, forceSentiment: action => (action === 'like' ? -1 : 1) }
    ]
  },
  {
    pattern: /clean|simple|minimal|not busy|spacious/,
    source: 'clean/minimal',
    features: [
      { key: 'composition.minimal', confidence: 0.78 },
      { key: 'typography.clean', confidence: 0.74 }
    ]
  },
  {
    pattern: /clutter|busy|too much|crowded|overwhelming/,
    source: 'visual clutter',
    features: [
      { key: 'composition.cluttered', confidence: 0.86, forceSentiment: action => (action === 'like' ? 1 : -1) },
      { key: 'typography.textDensity', confidence: 0.58, forceSentiment: action => (action === 'like' ? 1 : -1) }
    ]
  },
  {
    pattern: /too much text|text heavy|wordy|copy dense/,
    source: 'text density',
    features: [
      { key: 'typography.textDensity', confidence: 0.84, forceSentiment: action => (action === 'like' ? 1 : -1) },
      { key: 'typography.clean', confidence: 0.42, forceSentiment: action => (action === 'like' ? -1 : 1) }
    ]
  },
  {
    pattern: /bright|sunny|light|airy/,
    source: 'bright/sunny',
    features: [
      { key: 'palette.brightness', confidence: 0.74 },
      { key: 'lighting.sunny', confidence: 0.7 }
    ]
  },
  {
    pattern: /warm|coral|orange|red|yellow|gold|sand|cream/,
    source: 'warm color',
    features: [
      { key: 'palette.warmth', confidence: 0.72 },
      { key: 'palette.saturation', confidence: 0.42 }
    ]
  },
  {
    pattern: /blue|cool|cold|cyan/,
    source: 'blue/cool',
    features: [{ key: 'palette.blueDominance', confidence: 0.68 }],
    unresolved: {
      term: 'blue',
      possibleMeanings: ['avoid blue completely', 'avoid cold blue dominance', 'allow sunny blue accents'],
      mappingConfidence: 0.46
    }
  },
  {
    pattern: /beach|coastal|summer|resort|outdoor/,
    source: 'setting',
    features: [
      { key: 'setting.coastal', confidence: 0.72 },
      { key: 'subject.lifestyleContext', confidence: 0.44 }
    ]
  },
  {
    pattern: /urban|city|street/,
    source: 'urban setting',
    features: [{ key: 'setting.urban', confidence: 0.7 }]
  },
  {
    pattern: /studio|catalog|packshot|product[- ]only/,
    source: 'studio/product staging',
    features: [
      { key: 'setting.studio', confidence: 0.68 },
      { key: 'subject.productOnly', confidence: 0.64 },
      { key: 'subject.productProminence', confidence: 0.46 }
    ]
  },
  {
    pattern: /person|people|model|face|human|wearing/,
    source: 'human presence',
    features: [
      { key: 'subject.humanPresence', confidence: 0.72 },
      { key: 'subject.lifestyleContext', confidence: 0.54 }
    ]
  },
  {
    pattern: /product is clear|clear product|show.*product|what.*selling|product hero|close[- ]up|macro|tight crop/,
    source: 'product clarity',
    features: [
      { key: 'business.productClarity', confidence: 0.78 },
      { key: 'subject.productProminence', confidence: 0.72 },
      { key: 'subject.productOnly', confidence: 0.48 }
    ]
  },
  {
    pattern: /liquid|pour|splash|gel|texture|toner pad|pads?|dressing pad/,
    source: 'sensory product detail',
    features: [
      { key: 'composition.dynamic', confidence: 0.68 },
      { key: 'subject.productProminence', confidence: 0.58 },
      { key: 'business.productClarity', confidence: 0.5 }
    ]
  },
  {
    pattern: /editorial|campaign|magazine|art direction/,
    source: 'editorial',
    features: [{ key: 'composition.editorial', confidence: 0.8 }]
  },
  {
    pattern: /generic|stock|template|cookie[- ]cutter/,
    source: 'template/generic',
    features: [
      { key: 'sns.templateFeel', confidence: 0.84, forceSentiment: action => (action === 'like' ? 1 : -1) },
      { key: 'mood.credible', confidence: 0.52, forceSentiment: action => (action === 'like' ? -1 : 1) }
    ],
    unresolved: {
      term: 'generic',
      possibleMeanings: ['too template-like', 'wrong audience', 'weak product specificity', 'not enough brand personality'],
      mappingConfidence: 0.39
    }
  },
  {
    pattern: /ugc|authentic|creator|real|native/,
    source: 'platform-native',
    features: [
      { key: 'sns.ugcFeel', confidence: 0.72 },
      { key: 'sns.platformNative', confidence: 0.66 }
    ]
  },
  {
    pattern: /neon|synthetic|fake|ai|unrealistic/,
    source: 'synthetic lighting',
    features: [{ key: 'lighting.synthetic', confidence: 0.84, forceSentiment: action => (action === 'like' ? 1 : -1) }]
  },
  {
    pattern: /calm|quiet|restrained|serene/,
    source: 'calm',
    features: [{ key: 'mood.calm', confidence: 0.76 }]
  },
  {
    pattern: /energy|energetic|bold|movement|exciting|scroll[- ]stopping|eye[- ]catching/,
    source: 'energy',
    features: [
      { key: 'mood.energetic', confidence: 0.76 },
      { key: 'sns.scrollStoppingIntensity', confidence: 0.62 }
    ]
  },
  {
    pattern: /audience|customer|not for them|right person|wrong person/,
    source: 'audience fit',
    features: [{ key: 'business.audienceFit', confidence: 0.7 }]
  }
];

export function extractReasonFacets(reasonText: string, reasonChips: string[], action: FeedbackAction): {
  facets: ExtractedReasonFacet[];
  unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>>;
} {
  const reasonOnly = reasonText.toLowerCase();
  const useDesiredDirection = action === 'dislike' && hasDesiredCorrectionCue(reasonOnly);
  const chipsForExtraction = useDesiredDirection
    ? reasonChips.filter(chip => !isGenericNegativeChip(chip.toLowerCase()))
    : reasonChips;
  const text = `${reasonText} ${chipsForExtraction.join(' ')}`.toLowerCase();
  const facets: ExtractedReasonFacet[] = [];
  const unresolvedTerms: Array<Omit<UnresolvedTerm, 'feedbackEventId' | 'asked'>> = [];

  if (!text.trim()) {
    return { facets, unresolvedTerms };
  }

  RULES.forEach(rule => {
    if (!rule.pattern.test(text)) {
      return;
    }
    rule.features.forEach(feature => {
      if (!knownFeatureKey(feature.key)) {
        return;
      }
      const sentiment = feature.forceSentiment
        ? feature.forceSentiment(action)
        : feature.invertForDislike
          ? antiDirectionFor(action)
          : useDesiredDirection
            ? 1
            : directionFor(action);
      facets.push({
        feature: feature.key,
        label: FEATURE_META[feature.key].label,
        sentiment,
        confidence: feature.confidence,
        source: rule.source
      });
    });
    if (rule.unresolved) {
      unresolvedTerms.push(rule.unresolved);
    }
  });

  return { facets, unresolvedTerms };
}
