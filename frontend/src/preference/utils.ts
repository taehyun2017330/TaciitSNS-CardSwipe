import type { TraceEvent } from './types';

export function clamp(value: number, min = -1, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function createTrace(type: TraceEvent['type'], title: string, detail: string): TraceEvent {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    title,
    detail,
    createdAt: nowIso()
  };
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
}
