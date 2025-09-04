import fs from 'fs';
import path from 'path';
import type { Candidate } from './candidates';

export type ScoreContext = {
  device?: 'mobile' | 'desktop' | 'unknown';
  localTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'late';
};

export type ScoreResult = { score: number; reasons: string[] };

/**
 * Load weights.json. If missing, fallback to zeros.
 */
function loadWeights(): Record<string, number> {
  try {
    const p = path.join(__dirname, '..', 'config', 'weights.json');
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as Record<string, number>;
  } catch (e) {
    // Missing or invalid weights file → use defaults (zeros)
    return {
      version: 0,
      neverOpened: 0,
      freshForgotten: 0,
      timeFit: 0,
      frequentSource: 0,
      bridge: 0,
      duplicatePenalty: 0,
      sameDomainPenalty: 0,
    };
  }
}

const WEIGHTS = loadWeights();

/**
 * Simple time-fit matcher: returns true if readingBucket fits time of day
 * (This is intentionally simple and deterministic for explainability.)
 */
function timeFits(bucket: Candidate['readingBucket'], ctx?: ScoreContext): boolean {
  if (!bucket || !ctx?.localTimeOfDay) return false;

  // Very simple heuristics:
  // morning -> SHORT or MEDIUM
  // afternoon -> MEDIUM or LONG
  // evening -> LONG or XLONG
  // late -> SHORT
  const tod = ctx.localTimeOfDay;
  if (tod === 'morning') return bucket === 'SHORT' || bucket === 'MEDIUM';
  if (tod === 'afternoon') return bucket === 'MEDIUM' || bucket === 'LONG';
  if (tod === 'evening') return bucket === 'LONG' || bucket === 'XLONG';
  if (tod === 'late') return bucket === 'SHORT';
  return false;
}

/**
 * Score a single candidate in an explainable, stable way.
 */
export default function scoreItem(c: Candidate, ctx?: ScoreContext): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (c.neverOpened) {
    const w = Number(WEIGHTS.neverOpened || 0);
    if (w !== 0) {
      score += w;
      reasons.push('never opened');
    }
  }

  if (c.isFreshForgotten) {
    const w = Number(WEIGHTS.freshForgotten || 0);
    if (w !== 0) {
      score += w;
      reasons.push('fresh forgotten');
    }
  }

  if (timeFits(c.readingBucket, ctx)) {
    const w = Number(WEIGHTS.timeFit || 0);
    if (w !== 0) {
      score += w;
      const bucket = c.readingBucket ?? 'unknown';
      reasons.push(`fits ${ctx?.localTimeOfDay ?? 'time'}-${bucket.toLowerCase()}`);
    }
  }

  if (c.isFrequentSource) {
    const w = Number(WEIGHTS.frequentSource || 0);
    if (w !== 0) {
      score += w;
      reasons.push('frequent source');
    }
  }

  if (c.isBridge) {
    const w = Number(WEIGHTS.bridge || 0);
    if (w !== 0) {
      score += w;
      reasons.push('bridge');
    }
  }

  // Ensure integer score
  score = Math.round(score);

  return { score, reasons };
}