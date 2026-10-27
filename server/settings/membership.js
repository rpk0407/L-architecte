// @ts-check
// Abonnements: the monthly membership (PAY-02). Off until the owner switches it on, once a lawyer has read the CGV;
// on in the demo. Written by the owner only (PATCH /api/v1/settings needs 'settings').
//   plans      at most 4 formules: { id, name, price (cents a month), cuts (covered cuts per billing month, 0 = illimité),
//              minDays (days between two covered cuts, fair use: 7 by default for illimité, 0 otherwise), serviceIds
//              (the services a covered cut may be), vat (bp; payments.vat when not set), online (sold on the site), blurb,
//              active }. A member keeps what he signed for (domain/membership.js): changing a plan moves no one.
//   graceDays  how long a member keeps his cuts after a failed renewal, while the provider retries
// No pause, no SEPA, no plan change in v1 (the event names are reserved, commands/memberships.js).
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { str, int, bool, opt, obj, arr, id, InvalidInput } from '../lib/validate.js';

export const PLANS_MAX = 4;
/** a plan's id: lower case, digits and dashes, as in a link (/abonnement#essentiel) */
export const PLAN_ID = /^[a-z0-9][a-z0-9-]{1,23}$/;

const planSchema = () => obj({
  id: str({ min: 2, max: 24, pattern: PLAN_ID }),
  name: str({ min: 2, max: 40 }),
  price: int({ min: 500, max: 50000 }),
  cuts: int({ min: 0, max: 8 }),
  minDays: opt(int({ min: 0, max: 30 })),
  serviceIds: arr(id(), { min: 1, max: 20 }),
  vat: opt(int({ min: 0, max: 3000 })),
  online: opt(bool()),
  blurb: opt(str({ max: 120 })),
  active: opt(bool())
});

/** A settings patch of it: plan ids once each; minDays, online, blurb and active filled in. */
const membershipSchema = (() => {
  const o = obj({ enabled: opt(bool()), plans: opt(arr(planSchema(), { max: PLANS_MAX })), graceDays: opt(int({ min: 0, max: 14 })) });
  return { parse(/** @type {any} */ x, /** @type {string} */ p) {
    const v = o.parse(x, p);
    const at = (k) => (p ? p + '.' : '') + k;
    if (v.plans) {
      const seen = new Set();
      v.plans.forEach((pl, i) => {
        if (seen.has(pl.id)) throw new InvalidInput(at('plans[' + i + '].id'), 'deux formules ont le même code');
        seen.add(pl.id);
        if (new Set(pl.serviceIds).size !== pl.serviceIds.length) throw new InvalidInput(at('plans[' + i + '].serviceIds'), 'prestation en double');
        // illimité without a gap would be a cut a day: fair use asks a week unless the owner says otherwise
        pl.minDays = pl.minDays ?? (pl.cuts === 0 ? 7 : 0);
        pl.online = pl.online !== false; pl.blurb = pl.blurb || ''; pl.active = pl.active !== false;
      });
    }
    return v;
  } };
})();
export { membershipSchema };

function defaults() {
  return {
    enabled: false,
    plans: /** @type {{ id: string, name: string, price: number, cuts: number, minDays: number, serviceIds: string[], vat?: number, online: boolean, blurb: string, active: boolean }[]} */ ([]),
    graceDays: 7
  };
}
/** @typedef {ReturnType<typeof defaults>} Membership */

/** Mise en route › Nouveautés (WP-10): off in production until the owner switches it on, after the lawyer's review. */
const golive = {
  label: 'Abonnements',
  /** @param {any} s */
  state(s) {
    const on = !!(s.settings.membership && s.settings.membership.enabled);
    return { on, blocker: on ? '' : 'En attente de la relecture des CGV' };
  }
};

export default /** @type {const} */ ({ key: 'membership', defaults, schema: membershipSchema, golive });

/**
 * What the schema cannot see, checked against the state when the owner saves (commands/shop.js): every covered service
 * exists in the catalogue, and the memberships open only with a formule on sale. Else nothing could ever be covered.
 * @param {any} s @param {{ enabled?: boolean, plans?: any[] }} patch
 */
export function checkMembership(s, patch) {
  const was = s.settings.membership || {};
  const plans = patch.plans ?? was.plans ?? [];
  if (patch.plans) patch.plans.forEach((pl, i) => {
    if (pl.serviceIds.some((x) => !s.services.has(x))) throw new InvalidInput('membership.plans[' + i + '].serviceIds', 'prestation inconnue');
  });
  if ((patch.enabled ?? was.enabled) && !plans.some((pl) => pl.active !== false)) throw new InvalidInput('membership.enabled', 'aucune formule en vente : ajoute-en une d’abord');
}

/** The plan of this id as the settings hold it now, or null. @param {any} settings @param {string} planId */
export function planOf(settings, planId) {
  const M = settings.membership || {};
  return (M.plans || []).find((x) => x.id === planId) || null;
}
