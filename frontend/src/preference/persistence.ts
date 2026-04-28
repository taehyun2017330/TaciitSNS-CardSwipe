import type { FeedbackEvent, OnboardingState, PreferenceState } from './types';
import { normalizePreferenceState } from './model';

const STORAGE_PREFIX = 'tacitsns-swipe:v3:';
const STORAGE_VERSION = 3;

interface PersistedSession {
  version: number;
  savedAt: string;
  onboarding: OnboardingState;
  preferenceState: PreferenceState;
  feedbackEvents: FeedbackEvent[];
  batchNumber: number;
}

function makeKey(brandName: string, category: string) {
  const normalized = `${brandName.trim().toLowerCase()}|${category.trim().toLowerCase()}`;
  return STORAGE_PREFIX + normalized;
}

function compactPreferenceState(preferenceState: PreferenceState): PreferenceState {
  return {
    ...preferenceState,
    facets: Object.fromEntries(
      Object.entries(preferenceState.facets).map(([key, facet]) => [
        key,
        {
          feature: facet.feature,
          label: facet.label,
          dimension: facet.dimension,
          alpha: facet.alpha,
          beta: facet.beta,
          evidenceFor: facet.evidenceFor,
          evidenceAgainst: facet.evidenceAgainst,
          sourceTypes: facet.sourceTypes,
          lastSeenBatch: facet.lastSeenBatch
        }
      ])
    ) as PreferenceState['facets']
  };
}

export function saveSession(
  onboarding: OnboardingState,
  preferenceState: PreferenceState,
  feedbackEvents: FeedbackEvent[],
  batchNumber: number
) {
  if (!onboarding.brandName.trim()) {
    return;
  }
  const payload: PersistedSession = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    onboarding,
    preferenceState: compactPreferenceState(preferenceState),
    feedbackEvents,
    batchNumber
  };
  try {
    window.localStorage.setItem(makeKey(onboarding.brandName, onboarding.category), JSON.stringify(payload));
  } catch (error) {
    console.warn('[persistence] save failed', error);
  }
}

export function loadSession(brandName: string, category: string): PersistedSession | null {
  if (!brandName.trim()) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(makeKey(brandName, category));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedSession;
    if (parsed.version !== STORAGE_VERSION) {
      return null;
    }
    return {
      ...parsed,
      preferenceState: normalizePreferenceState(parsed.preferenceState, parsed.onboarding)
    };
  } catch (error) {
    console.warn('[persistence] load failed', error);
    return null;
  }
}

export function clearSession(brandName: string, category: string) {
  try {
    window.localStorage.removeItem(makeKey(brandName, category));
  } catch (error) {
    console.warn('[persistence] clear failed', error);
  }
}
