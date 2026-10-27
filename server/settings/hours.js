// @ts-check
// Horaires: the shop's usual week, the days it is closed, and the days it opens when it usually doesn't.
import { week, arr, obj, opt, str, day, id, intervals, either, oneOf, InvalidInput } from '../lib/validate.js';

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
