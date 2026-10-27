// @ts-check
// Horaires: the shop's usual week, the days it is closed, and the days it opens when it usually doesn't.
import { week, arr, obj, opt, str, day, id, intervals, either, oneOf, InvalidInput } from '../lib/validate.js';
import { fmtTime, DAYS_FR } from '../../shared/dates.js';

export default /** @type {const} */ ({
  key: 'hours',
  /** weekday (0 = Sunday) → open intervals in minutes */
  defaults: () => { const day = [[540, 1110]]; return { 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day }; },
  // ends after starts and no overlap: checked by updateSettings (checkIntervals), which words it per day
  schema: week()
});

/** Exceptional closures: written only through addClosure / removeClosure, so there is no patch schema. */
export const closures = /** @type {const} */ ({
  key: 'closures',
  defaults: () => /** @type {{ id: string, from: string, to: string, label: string }[]} */ ([]),
  schema: null
});

/** @typedef {{ id: string, day: string, intervals: [number, number][], label: string, staff: 'all' | string[] }} Opening */

const item = obj({
  id: opt(id()), day: day(), intervals: intervals(), label: opt(str({ max: 60 })),
  staff: opt(either([oneOf(/** @type {const} */ (['all'])), arr(id(), { min: 1, max: 20 })]))
});
/**
 * The whole list in one patch (PATCH /api/v1/settings { openings }): replacing it is idempotent, and a closure on
 * the same day still wins (domain/availability.js). One opening per day, sorted, its hours in order and apart. The
 * past ones stay in the list: the reports of those days count their hours (Réglages › Horaires sends them back and
 * drops only those more than 400 days old, so 200 is years of December Mondays).
 * @type {import('../lib/validate.js').Schema<Opening[]>}
 */
const openingsSchema = {
  parse(x, p) {
    const list = arr(item, { max: 200 }).parse(x, p);
    const out = /** @type {Opening[]} */ ([]);
    list.forEach((o, i) => {
      const at = p + '[' + i + ']';
      const iv = [...o.intervals].sort((a, b) => a[0] - b[0]);
      if (!iv.length) throw new InvalidInput(at + '.intervals', 'au moins une plage horaire');
      iv.forEach(([a, b], j) => {
        if (!(a < b)) throw new InvalidInput(at, 'la fin doit être après le début');
        if (j && a < iv[j - 1][1]) throw new InvalidInput(at, 'des plages se chevauchent');
      });
      if (out.some((y) => y.day === o.day)) throw new InvalidInput(at, 'une seule ouverture par jour');
      out.push({ id: o.id || 'op-' + o.day, day: o.day, intervals: /** @type {[number, number][]} */ (iv.map(([a, b]) => [a, b])), label: o.label || 'Ouverture exceptionnelle', staff: o.staff || 'all' });
    });
    return out.sort((a, b) => (a.day < b.day ? -1 : 1));
  }
};

/** Exceptional openings ('ouverts exceptionnellement les lundis 21 & 28 décembre'): those days follow these hours. */
export const openings = /** @type {const} */ ({
  key: 'openings',
  defaults: () => /** @type {Opening[]} */ ([]),
  schema: openingsSchema
});

/* ---------------- the hours in words (the site's footer, FAQ and description: /api/public/salon) ---------------- */

const WEEK = [1, 2, 3, 4, 5, 6, 0];
/** @param {any} hours weekday → [[start, end], …] in minutes @param {number} d */
const ivOf = (hours, d) => (hours && (hours[d] || hours[String(d)])) || [];
const ivText = (/** @type {number[][]} */ iv) => iv.map(([a, b]) => fmtTime(a) + ' – ' + fmtTime(b)).join(' et ');
const andList = (/** @type {string[]} */ xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' et ' + xs[xs.length - 1]);

/** "Du mardi au samedi, 9 h – 18 h 30" ; days with other hours get their own part ("… · le samedi, 9 h – 17 h"). */
export function hoursText(/** @type {any} */ hours) {
  /** @type {{ sig: string, iv: number[][], days: number[] }[]} */
  const groups = [];
  for (const d of WEEK) {
    const iv = ivOf(hours, d);
    if (!iv.length) continue;
    const sig = JSON.stringify(iv);
    const g = groups.find((x) => x.sig === sig);
    if (g) g.days.push(d); else groups.push({ sig, iv, days: [d] });
  }
  if (!groups.length) return '';
  const parts = groups.map((g) => {
    // consecutive days (in the week from Monday) read as "du mardi au samedi"
    /** @type {number[][]} */
    const runs = [];
    for (const d of g.days) { const r = runs[runs.length - 1]; if (r && WEEK.indexOf(d) === WEEK.indexOf(r[r.length - 1]) + 1) r.push(d); else runs.push([d]); }
    // two days in a row are two items: "le lundi, le mardi et du jeudi au samedi", never "le lundi et le mardi et …"
    const label = andList(runs.flatMap((r) => (r.length >= 3 ? ['du ' + DAYS_FR[r[0]] + ' au ' + DAYS_FR[r[r.length - 1]]] : r.map((d) => 'le ' + DAYS_FR[d]))));
    return label + ', ' + ivText(g.iv);
  });
  const s = parts.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "le dimanche et le lundi"; empty when the salon opens every day */
export function closedText(/** @type {any} */ hours) {
  return andList([0, 1, 2, 3, 4, 5, 6].filter((d) => !ivOf(hours, d).length).map((d) => 'le ' + DAYS_FR[d]));
}
