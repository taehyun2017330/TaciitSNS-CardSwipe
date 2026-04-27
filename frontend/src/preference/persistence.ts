import type { FeedbackEvent, OnboardingState, PreferenceState } from './types';

const STORAGE_PREFIX = 'tacitsns-swipe:v1:';
const STORAGE_VERSION = 1;

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
    preferenceState,
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
    return parsed;
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
