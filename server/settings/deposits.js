// @ts-check
// Acomptes: when an online booking pays part of the price up front, and the planned no-show fee.
import { int, opt, obj, oneOf, money } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'deposits',
  defaults: () => ({ mode: 'threshold', thresholdCents: 5000, percent: 30, noShowFeeCents: 1000 }),
  schema: obj({ mode: opt(oneOf(/** @type {const} */ (['none', 'threshold', 'all']))), thresholdCents: opt(money()), percent: opt(int({ min: 5, max: 100 })), noShowFeeCents: opt(money(20000)) })
});
