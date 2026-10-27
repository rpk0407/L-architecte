// @ts-check
// AC-01 · A client's rhythm, one rule for the client (/moi, « Ta prochaine coupe vers le … ») and for the salon (FID-04's
// follow-ups, AC-04's « la même chose ? »), so the two never disagree. One visit says nothing about a rhythm: below two
// done visits there is no due day, and nobody makes one up.
import { addDays, diffDays } from '../../shared/dates.js';

/** The rhythm assumed when two visits give no usable gap (insights.js uses the same 28 days). */
export const DEFAULT_CADENCE = 28;

/**
 * From a client's figures (an entry of insights.js clientStats, or statsOfDays below).
 * @param {{ visits?: number, cadence?: number|null, lastDay?: string|null } | null | undefined} stats
 * @returns {{ visits: number, cadence: number|null, lastDay: string|null, dueDay: string|null }}
 */
export function rhythmOf(stats) {
  const visits = (stats && stats.visits) || 0;
  const lastDay = (stats && stats.lastDay) || null;
  const cadence = (stats && stats.cadence) || null;
  return { visits, cadence, lastDay, dueDay: visits >= 2 && lastDay ? addDays(lastDay, cadence || DEFAULT_CADENCE) : null };
}

/**
 * The same figures from a list of visit days, computed the way insights.js clientStats does (the median of the gaps of at
 * least 5 days between the last 7 visits): for a fenced account, whose visits before the fence must not count.
 * @param {string[]} days
 */
export function statsOfDays(days) {
  const d = [...days].sort();
  const gaps = [];
  for (let i = Math.max(1, d.length - 6); i < d.length; i++) { const g = diffDays(d[i - 1], d[i]); if (g >= 5) gaps.push(g); }
  gaps.sort((a, b) => a - b);
  const m = Math.floor(gaps.length / 2);
  const cadence = !gaps.length ? null : gaps.length % 2 ? gaps[m] : Math.round((gaps[m - 1] + gaps[m]) / 2);
  return { visits: d.length, cadence, lastDay: d[d.length - 1] || null };
}
