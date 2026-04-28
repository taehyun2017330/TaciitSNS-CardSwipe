import facetCatalog from '../../../shared/facet_catalog.json';

export interface FacetDefinition {
  key: string;
  label: string;
  dimension: string;
  description: string;
  aliases: string[];
}

export type FeatureKey = string;
export type FeatureVector = Record<FeatureKey, number>;

export const FEATURE_CATALOG = facetCatalog as FacetDefinition[];
export const FEATURE_KEYS = FEATURE_CATALOG.map(facet => facet.key);

export const FEATURE_META = FEATURE_CATALOG.reduce((acc, facet) => {
  acc[facet.key] = {
    key: facet.key,
    label: facet.label,
    dimension: facet.dimension,
    description: facet.description,
    aliases: facet.aliases
  };
  return acc;
}, {} as Record<FeatureKey, FacetDefinition>);

export const EMPTY_FEATURES = FEATURE_KEYS.reduce((acc, key) => {
  acc[key] = 0;
  return acc;
}, {} as FeatureVector);

export function knownFeatureKey(key: string): key is FeatureKey {
  return key in FEATURE_META;
}

export function makeFeatureVector(values: Partial<FeatureVector>): FeatureVector {
  return {
    ...EMPTY_FEATURES,
    ...Object.fromEntries(
      Object.entries(values).filter(([key, value]) => knownFeatureKey(key) && Number.isFinite(value))
    )
  };
}
