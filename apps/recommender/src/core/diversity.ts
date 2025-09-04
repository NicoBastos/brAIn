import type { Candidate } from './candidates';

export type Scored = Candidate & { score: number; reasons: string[] };

export type DiversityOpts = {
  k: number;
  allowSameDomain: boolean;
  requireShortIfAvailable?: boolean;
  minDistinctThemes?: number;
  nearDuplicateChecker?: (aId: string, bId: string) => boolean;
};

/**
 * Select up to k items from a ranked list while enforcing domain, duplicate,
 * reading-length and theme diversity guards.
 *
 * Behavior simplified for scaffold:
 * - First pass: accept items in score order respecting domain guard and near-duplicates
 * - Second pass: fill remaining slots ignoring domain guard but still avoiding near-duplicates
 * - If any SHORT exists in original pool and none selected, swap lowest non-SHORT with best SHORT
 * - Try to ensure at least minDistinctThemes by swapping in items from missing themes
 */
export default function applyDiversity(itemsIn: Scored[], opts: DiversityOpts): Scored[] {
  if (!itemsIn || opts.k <= 0) return [];
  const k = opts.k;
  const allowSameDomain = !!opts.allowSameDomain;
  const requireShortIfAvailable = opts.requireShortIfAvailable !== false;
  const minDistinctThemes = opts.minDistinctThemes ?? 2;
  const nearDup = opts.nearDuplicateChecker;

  // Sort by score desc (stable-ish)
  const items = [...itemsIn].sort((a, b) => b.score - a.score);

  const selected: Scored[] = [];
  const seenDomains = new Set<string>();
  const selectedIds = new Set<string>();

  // First pass: domain guard + near-duplicates
  for (const it of items) {
    if (selected.length >= k) break;
    if (!allowSameDomain && it.domain && seenDomains.has(it.domain)) continue;

    if (nearDup) {
      let dup = false;
      for (const s of selected) {
        if (nearDup(s.id, it.id)) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
    }

    selected.push(it);
    if (it.domain) seenDomains.add(it.domain);
    selectedIds.add(it.id);
  }

  // Second pass: fill remaining ignoring domain guard but still avoid near-duplicates
  if (selected.length < k) {
    for (const it of items) {
      if (selected.length >= k) break;
      if (selectedIds.has(it.id)) continue;

      if (nearDup) {
        let dup = false;
        for (const s of selected) {
          if (nearDup(s.id, it.id)) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
      }

      selected.push(it);
      selectedIds.add(it.id);
    }
  }

  // Enforce reading length mix (SHORT)
  const originalHasShort = items.some((i) => i.readingBucket === 'SHORT');
  const selectedHasShort = selected.some((i) => i.readingBucket === 'SHORT');
  if (requireShortIfAvailable && originalHasShort && !selectedHasShort) {
    const bestShort = items.find((i) => i.readingBucket === 'SHORT' && !selectedIds.has(i.id));
    if (bestShort) {
      // replace lowest scored non-SHORT in selected
      let replaceIdx = -1;
      for (let i = selected.length - 1; i >= 0; i--) {
        if (selected[i].readingBucket !== 'SHORT') {
          replaceIdx = i;
          break;
        }
      }
      if (replaceIdx !== -1) {
        selectedIds.delete(selected[replaceIdx].id);
        selected[replaceIdx] = bestShort;
        selectedIds.add(bestShort.id);
      }
    }
  }

  // Enforce theme diversity
  const themesInSelected = new Set<string>();
  for (const s of selected) (s.themeIds ?? []).forEach((t: string) => themesInSelected.add(t));
  const originalHasThemes = items.some((i) => (i.themeIds ?? []).length > 0);

  if (originalHasThemes && themesInSelected.size < minDistinctThemes) {
    // collect missing themes from pool
    const poolThemes = new Set<string>();
    for (const it of items) (it.themeIds ?? []).forEach((t: string) => poolThemes.add(t));
    const missing = Array.from(poolThemes).filter((t) => !themesInSelected.has(t));

    for (const theme of missing) {
      if (selected.length >= k) break;
      const candidate = items.find((it) => (it.themeIds ?? []).includes(theme) && !selectedIds.has(it.id));
      if (!candidate) continue;

      // replace lowest scored selected item that doesn't already cover this theme
      let replaceIdx = -1;
      for (let i = selected.length - 1; i >= 0; i--) {
        if (!((selected[i].themeIds ?? []).includes(theme))) {
          replaceIdx = i;
          break;
        }
      }
      if (replaceIdx !== -1) {
        selectedIds.delete(selected[replaceIdx].id);
        selected[replaceIdx] = candidate;
        selectedIds.add(candidate.id);
        (candidate.themeIds ?? []).forEach((t: string) => themesInSelected.add(t));
      }
    }
  }

  return selected.slice(0, k);
}