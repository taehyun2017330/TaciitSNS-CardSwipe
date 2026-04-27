const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8001';

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_URL || DEFAULT_API_BASE_URL);

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

async function request(path: string, init?: RequestInit) {
  const url = `${API_BASE_URL}${path}`;

  if (import.meta.env.DEV) {
    console.log(`[api] → ${init?.method ?? 'GET'} ${url}`);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.log(`[api] ✗ ${url}`, error);
    }
    throw new ApiUnavailableError(`Failed to reach API for ${path}`);
  }

  if (import.meta.env.DEV) {
    response
      .clone()
      .text()
      .then(body => {
        const parsed = (() => {
          try {
            return JSON.parse(body);
          } catch {
            return body;
          }
        })();
        console.log(`[api] ← ${response.status} ${url}`, parsed);
      })
      .catch(err => console.log(`[api] ← ${response.status} ${url} (body read failed)`, err));
  }

  return response;
}

export function apiFetch(path: string, init?: RequestInit) {
  return request(path, init);
}
