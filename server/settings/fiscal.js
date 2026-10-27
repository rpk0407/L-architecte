// @ts-check
// The fiscal year (CPT-01a): the month it ends, so the month closure of that month also closes the year
// (commands/fiscal.js). An entrepreneur individuel usually closes in December; a company may close another month.
// Changing it acts from the next month closed: a year already closed keeps its months, the year then running ends at the
// new month (shorter or longer), so no month is left out of every year (domain/fiscal.js yearTotals).
import { int, opt, obj } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'fiscal',
  defaults: () => ({ yearEndMonth: 12 }),
  schema: obj({ yearEndMonth: opt(int({ min: 1, max: 12 })) }),
  // Mise en route › Nouveautés (WP-10): the signing key belongs outside the data, in LX_SIGN_KEY
  golive: {
    label: 'Clé de signature',
    /** @param {any} _s @param {{ signer?: { source: string } }} rt */
    state: (_s, rt) => {
      const source = rt && rt.signer ? rt.signer.source : '';
      return { on: source === 'env', blocker: source === 'env' ? '' : source === 'demo' ? 'clé de la démo' : 'gardée avec les données' };
    }
  }
});
