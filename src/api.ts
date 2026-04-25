const DEFAULT_API_HOST =
  typeof window !== 'undefined' && window.location.hostname
    ? window.location.hostname
    : '127.0.0.1';
const DEFAULT_API_BASE_URL = `http://${DEFAULT_API_HOST}:8001`;
const FALLBACK_API_BASE_URLS = [
  'http://127.0.0.1:8001',
  'http://localhost:8001'
];
const LEGACY_API_BASE_URLS = [
  'http://127.0.0.1:8000',
  'http://localhost:8000'
];
const API_UNAVAILABLE_COOLDOWN_MS = 30000;

const unavailableCandidates = new Map<string, number>();

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

function buildApiCandidates(configuredUrl?: string) {
  const normalizedConfigured = configuredUrl ? normalizeBaseUrl(configuredUrl) : null;
  const candidates = [
    DEFAULT_API_BASE_URL,
    normalizedConfigured,
    ...FALLBACK_API_BASE_URLS,
    ...LEGACY_API_BASE_URLS
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates.map(normalizeBaseUrl)));
}

function isCandidateTemporarilyUnavailable(baseUrl: string) {
  const retryAfter = unavailableCandidates.get(baseUrl);
  if (!retryAfter) {
    return false;
  }

  if (retryAfter <= Date.now()) {
    unavailableCandidates.delete(baseUrl);
    return false;
  }

  return true;
}

function markCandidateUnavailable(baseUrl: string) {
  unavailableCandidates.set(baseUrl, Date.now() + API_UNAVAILABLE_COOLDOWN_MS);
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL);
export const BRAND_AUTOCOMPLETE_API_URL = normalizeBaseUrl(
  import.meta.env.VITE_BRAND_AUTOCOMPLETE_API_URL || API_BASE_URL
);

async function fetchWithFallback(path: string, init: RequestInit | undefined, candidates: string[]) {
  let lastError: unknown = null;
  const availableCandidates = candidates.filter(baseUrl => !isCandidateTemporarilyUnavailable(baseUrl));

  if (availableCandidates.length === 0) {
    throw new ApiUnavailableError(`API temporarily unavailable for ${path}`);
  }

  for (const baseUrl of availableCandidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      unavailableCandidates.delete(baseUrl);
      return response;
    } catch (error) {
      markCandidateUnavailable(baseUrl);
      lastError = error;
    }
  }

  throw lastError ?? new ApiUnavailableError(`Failed to reach API for ${path}`);
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetchWithFallback(path, init, buildApiCandidates(import.meta.env.VITE_API_URL));
}

export function autocompleteApiFetch(path: string, init?: RequestInit) {
  return fetchWithFallback(
    path,
    init,
    buildApiCandidates(import.meta.env.VITE_BRAND_AUTOCOMPLETE_API_URL || import.meta.env.VITE_API_URL)
  );
}
