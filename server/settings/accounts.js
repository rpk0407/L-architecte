// @ts-check
// Espace client (AC-01): optional client accounts, opened with a code by SMS on a file the salon already knows (by e-mail
// for a salon that asks an address and not a number: settings.booking.contact 'email').
//   enabled     the entry points (site, /moi, the lookup text's line) and the sign-in routes. true or false once the
//               owner has chosen (Réglages › Réservation); absent until then, which means: open for a salon that writes by
//               e-mail (booking.contact 'email': the code goes to the client's address, nothing to wait for), closed for
//               one that texts, until its SMS route is tested and the switch to the new site is done (decision 3 of the
//               plan). On in the demo (seed). Read it through accountsOn(s), never straight from the settings.
//   sessionDays how long a signed-in phone stays signed in without signing in again (the cookie lx_c slides every week)
//   fenceDays   a file whose last activity is older than this opens « fenced »: the new holder of a recycled number sees
//               nothing from before the day the account opens (decision 12)
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { int, bool, opt, obj } from '../lib/validate.js';

/** Is the client space open? (every route and entry point asks this one question) @param {any} s */
export function accountsOn(s) {
  const a = s && s.settings && s.settings.accounts;
  if (!a) return false;
  return a.enabled == null ? byMail(s) : !!a.enabled;
}
/** Does the salon ask an address and not a number? (commands/accounts.js mailMode: not imported, see the header) */
const byMail = (s) => !!(s && s.settings && s.settings.booking && s.settings.booking.contact === 'email');

/**
 * The settings as a screen reads them: accounts.enabled is the answer (true or false), never the « not chosen yet ».
 * @param {any} s @returns {any}
 */
export const settingsShown = (s) => ({ ...s.settings, accounts: { ...s.settings.accounts, enabled: accountsOn(s) } });

/** Mise en route › Nouveautés (WP-10) */
const golive = {
  label: 'Espace client',
  /** @param {any} s */
  state(s) {
    const on = accountsOn(s);
    // a salon that sends everything by e-mail has nothing to wait for from the SMS: the code goes to the client's address
    const mail = byMail(s);
    return { on, blocker: on ? '' : mail ? 'Prêt à ouvrir : le code de connexion part par e-mail' : 'S’ouvre quand le SMS est testé et la bascule faite' };
  }
};

export default /** @type {const} */ ({
  key: 'accounts',
  // no `enabled` here: until the owner chooses, accountsOn(s) answers from how the salon writes to its clients
  defaults: () => ({ sessionDays: 180, fenceDays: 180 }),
  schema: obj({ enabled: opt(bool()), sessionDays: opt(int({ min: 30, max: 400 })), fenceDays: opt(int({ min: 90, max: 1095 })) }),
  golive
});
