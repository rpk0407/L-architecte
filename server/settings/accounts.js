// @ts-check
// Espace client (AC-01): optional client accounts, opened with a code by SMS on a file the salon already knows.
//   enabled     the entry points (site, /moi, the lookup text's line) and the sign-in routes; off in production until the
//               SMS route is tested and the switch to the new site is done (decision 3 of the plan), on in the demo (seed)
//   sessionDays how long a signed-in phone stays signed in without signing in again (the cookie lx_c slides every week)
//   fenceDays   a file whose last activity is older than this opens « fenced »: the new holder of a recycled number sees
//               nothing from before the day the account opens (decision 12)
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { int, bool, opt, obj } from '../lib/validate.js';

/** Is the client space open? (every route and entry point asks this one question) @param {any} s */
export const accountsOn = (s) => !!(s && s.settings && s.settings.accounts && s.settings.accounts.enabled);

/** Mise en route › Nouveautés (WP-10) */
const golive = {
  label: 'Espace client',
  /** @param {any} s */
  state(s) {
    const on = accountsOn(s);
    return { on, blocker: on ? '' : 'S’ouvre quand le SMS est testé et la bascule faite' };
  }
};

export default /** @type {const} */ ({
  key: 'accounts',
  defaults: () => ({ enabled: false, sessionDays: 180, fenceDays: 180 }),
  schema: obj({ enabled: opt(bool()), sessionDays: opt(int({ min: 30, max: 400 })), fenceDays: opt(int({ min: 90, max: 1095 })) }),
  golive
});
