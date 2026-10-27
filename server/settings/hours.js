// @ts-check
// Horaires: the shop's usual week, and the days it is closed.
import { week } from '../lib/validate.js';

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
