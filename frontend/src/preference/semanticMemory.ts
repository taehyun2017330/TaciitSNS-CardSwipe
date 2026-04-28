import type { FeedbackEvent, ImageCandidate, SemanticMemory, SemanticSignal } from './types';

const MAX_SIGNALS = 10;

export function createSemanticMemory(): SemanticMemory {
  return {
    likedDirections: [],
    dislikedDirections: [],
    hardAvoids: [],
    uncertainties: [],
    styleBrief: 'No semantic style evidence yet.',
    positiveExemplars: [],
    negativeExemplars: []
  };
}

function cleanSignal(text: string) {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^e\.g\.\s*/i, '')
    .replace(/[.。]+$/g, '');
}

function uniqueSignals(signals: SemanticSignal[]) {
  const seen = new Set<string>();
  return signals.filter(signal => {
    const key = signal.label.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function appendSignals(current: SemanticSignal[], additions: SemanticSignal[]) {
  return uniqueSignals([...additions, ...current]).slice(0, MAX_SIGNALS);
}

function phraseFromFeedback(feedback: FeedbackEvent) {
  const explicit = cleanSignal(feedback.reasonText);
  if (explicit) {
    return explicit;
  }
  return feedback.reasonChips.map(cleanSignal).filter(Boolean).join(', ');
}

function candidateDirection(candidate: ImageCandidate) {
  const tags = candidate.tags.slice(0, 3).join(', ');
  return cleanSignal(candidate.hypothesis || tags || candidate.prompt.slice(0, 96));
}

function hasHardAvoidCue(text: string) {
  return /too|avoid|wrong|bad|cheap|generic|template|stock|fake|clutter|busy|salesy|promotional|not/i.test(text);
}

function hasDesiredCorrectionCue(text: string) {
  return /\b(need|needs|want|prefer|missing|lacks?|lacking|should|closer|more like|make it more|not enough|not prominent enough|does not have|doesn't have|has no|without)\b/i.test(text);
}

function normalizeCorrectionPhrase(text: string) {
  return cleanSignal(text)
    .replace(/^(the|this|current)?\s*(image|candidate|visual|direction)?\s*(lacks?|is missing|does not have|doesn't have|has no|without)\s+/i, 'Needs ')
    .replace(/\s+/g, ' ');
}

function summarize(memory: Omit<SemanticMemory, 'styleBrief'>): string {
  const liked = memory.likedDirections.slice(0, 3).map(signal => signal.label);
  const disliked = memory.dislikedDirections.slice(0, 3).map(signal => signal.label);
  const hardAvoids = memory.hardAvoids.slice(0, 2).map(signal => signal.label);

  const parts = [];
  if (liked.length) {
    parts.push(`Prefer: ${liked.join('; ')}`);
  }
  if (disliked.length) {
    parts.push(`Avoid: ${disliked.join('; ')}`);
  }
  if (hardAvoids.length) {
    parts.push(`Hard avoids: ${hardAvoids.join('; ')}`);
  }
  return parts.join('. ') || 'No semantic style evidence yet.';
}

export function updateSemanticMemory(
  memory: SemanticMemory,
  feedback: FeedbackEvent,
  candidate: ImageCandidate
): SemanticMemory {
  const rawPhrase = phraseFromFeedback(feedback);
  const phrase =
    feedback.action === 'dislike' && hasDesiredCorrectionCue(rawPhrase)
      ? normalizeCorrectionPhrase(rawPhrase)
      : rawPhrase;
  const direction = candidateDirection(candidate);
  const label = phrase || direction;
  const signal: SemanticSignal = {
    label,
    source: phrase ? 'reason' : 'image',
    feedbackEventId: feedback.id,
    polarity: feedback.action === 'like' ? 1 : -1,
    confidence: phrase ? 0.82 : 0.48
  };
  const desiredCorrection =
    feedback.action === 'dislike' && phrase && hasDesiredCorrectionCue(phrase)
      ? {
          ...signal,
          polarity: 1 as const,
          confidence: Math.max(signal.confidence, 0.72)
        }
      : null;
  const next: Omit<SemanticMemory, 'styleBrief'> = {
    likedDirections:
      feedback.action === 'like'
        ? appendSignals(memory.likedDirections, [signal])
        : desiredCorrection
          ? appendSignals(memory.likedDirections, [desiredCorrection])
          : memory.likedDirections,
    dislikedDirections:
      feedback.action === 'dislike' && !desiredCorrection
        ? appendSignals(memory.dislikedDirections, [signal])
        : memory.dislikedDirections,
    hardAvoids:
      feedback.action === 'dislike' && !desiredCorrection && hasHardAvoidCue(signal.label)
        ? appendSignals(memory.hardAvoids, [{ ...signal, confidence: Math.max(signal.confidence, 0.88) }])
        : memory.hardAvoids,
    uncertainties: memory.uncertainties,
    positiveExemplars:
      feedback.action === 'like'
        ? [candidate.imageId, ...memory.positiveExemplars.filter(id => id !== candidate.imageId)].slice(0, 6)
        : memory.positiveExemplars,
    negativeExemplars:
      feedback.action === 'dislike'
        ? [candidate.imageId, ...memory.negativeExemplars.filter(id => id !== candidate.imageId)].slice(0, 6)
        : memory.negativeExemplars
  };

  if (/premium|generic|audience|brand|native|template/i.test(label)) {
    next.uncertainties = [
      `what "${label.slice(0, 42)}" should mean visually`,
      ...next.uncertainties
    ].slice(0, 6);
  }

  return {
    ...next,
    styleBrief: summarize(next)
  };
}

export function normalizeSemanticMemory(memory?: Partial<SemanticMemory>): SemanticMemory {
  const base = createSemanticMemory();
  const normalized: Omit<SemanticMemory, 'styleBrief'> = {
    likedDirections: memory?.likedDirections ?? base.likedDirections,
    dislikedDirections: memory?.dislikedDirections ?? base.dislikedDirections,
    hardAvoids: memory?.hardAvoids ?? base.hardAvoids,
    uncertainties: memory?.uncertainties ?? base.uncertainties,
    positiveExemplars: memory?.positiveExemplars ?? base.positiveExemplars,
    negativeExemplars: memory?.negativeExemplars ?? base.negativeExemplars
  };
  return {
    ...normalized,
    styleBrief: memory?.styleBrief || summarize(normalized)
  };
}
