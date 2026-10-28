// @ts-check
// Fidélité: the stamp card (FID-02). Off until the owner launches it, after the final WordPress sync; on in the demo.
// Written by the owner only (PATCH /api/v1/settings needs 'settings'). v1 is stamps only: points, products earning,
// « VIP ×2 » and the birthday reward are later ideas (their event shapes are reserved in projections/loyalty.js).
//   goal        paid visits per reward: 9, the 10th cut offered
//   minNet      what a visit must pay on services to earn a stamp (cents)
//   reward      what the full card gives: { kind: 'service', refs (the services it may pay, [] = any), cap (cents, the
//               most it takes off one cut; 0 = the whole price: settings merge, so a cap once set is cleared with 0) }
//               or { kind: 'amount', amount (cents off a line) }
//   rewardDays  how long a reward stays usable; resetDays: a card without a visit for that long starts again (0: never)
//   headStart   at launch, the stamps given for the last 12 months: 'none', 'half' (≤ goal/2), 'full' (≤ goal − 1)
//   referral    { enabled, referrer, referee (rewards like `reward`), perYear (referrals a client may make in a
//               calendar year, 0: no limit) }
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { int, bool, opt, obj, arr, id, oneOf, InvalidInput } from '../lib/validate.js';

export const HEAD_STARTS = /** @type {const} */ (['none', 'half', 'full']);

/** The most a service reward takes off: 0 (the whole price) or 1 € to 200 €. */
const capField = () => ({
  optional: false,
  parse(/** @type {any} */ x, /** @type {string} */ p) {
    const n = int({ min: 0, max: 20000 }).parse(x, p);
    if (n !== 0 && n < 100) throw new InvalidInput(p, '0 (le prix entier) ou entre 100 et 20000');
    return n;
  }
});

/** A reward as the settings (or a gift) hold it: a service offered, up to a cap, or an amount off. */
export const rewardSchema = () => {
  const service = obj({ kind: oneOf(/** @type {const} */ (['service'])), refs: opt(arr(id(), { max: 10 })), cap: opt(capField()) });
  const amount = obj({ kind: oneOf(/** @type {const} */ (['amount'])), amount: int({ min: 100, max: 20000 }) });
  return {
    parse(/** @type {any} */ x, /** @type {string} */ p) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) throw new InvalidInput(p, 'objet attendu');
      if (x.kind === 'amount') return amount.parse(x, p);
      if (x.kind !== 'service') throw new InvalidInput((p ? p + '.' : '') + 'kind', 'valeur non permise');
      const v = service.parse(x, p);
      if (v.refs && new Set(v.refs).size !== v.refs.length) throw new InvalidInput((p ? p + '.' : '') + 'refs', 'prestation en double');
      return { refs: [], ...v };
    }
  };
};

/** 0 (never) or 90 to 1095 days. */
const resetDays = () => ({
  optional: false,
  parse(/** @type {any} */ x, /** @type {string} */ p) {
    const n = int({ min: 0, max: 1095 }).parse(x, p);
    if (n !== 0 && n < 90) throw new InvalidInput(p, '0 (jamais) ou entre 90 et 1095');
    return n;
  }
});

const loyaltySchema = obj({
  enabled: opt(bool()),
  goal: opt(int({ min: 2, max: 5000 })),
  minNet: opt(int({ min: 0, max: 10000 })),
  reward: opt(rewardSchema()),
  rewardDays: opt(int({ min: 30, max: 730 })),
  resetDays: opt(resetDays()),
  headStart: opt(oneOf(HEAD_STARTS)),
  referral: opt(obj({ enabled: opt(bool()), referrer: opt(rewardSchema()), referee: opt(rewardSchema()), perYear: opt(int({ min: 0, max: 20 })) }))
});

function defaults() {
  return {
    enabled: false,
    goal: 9,
    minNet: 1000,
    reward: /** @type {{ kind: 'service'|'amount', refs?: string[], cap?: number, amount?: number }} */ ({ kind: 'service', refs: [], cap: 2500 }),
    rewardDays: 180,
    resetDays: 365,
    headStart: /** @type {'none'|'half'|'full'} */ ('half'),
    referral: {
      enabled: false,
      referrer: /** @type {{ kind: 'service'|'amount', refs?: string[], cap?: number, amount?: number }} */ ({ kind: 'amount', amount: 500 }),
      referee: /** @type {{ kind: 'service'|'amount', refs?: string[], cap?: number, amount?: number }} */ ({ kind: 'amount', amount: 500 }),
      perYear: 5
    }
  };
}
/** @typedef {ReturnType<typeof defaults>} Loyalty */

/**
 * Mise en route › Nouveautés (WP-10): switched on, then launched (the head start) once the old site's clients and visits
 * are all in; a receipt text the owner saved before FID-02 has no {fidelite}, so the card would not show on it.
 */
const golive = {
  label: 'Fidélité',
  /** @param {any} s */
  state(s) {
    const enabled = !!(s.settings.loyalty && s.settings.loyalty.enabled);
    const launched = !!(s.loyalty && s.loyalty.launched);
    const M = s.settings.messages;
    const receipt = !M || !M.templates || typeof M.templates.receipt !== 'string' || M.templates.receipt.includes('{fidelite}');
    const blocker = !enabled ? 'À lancer après la synchro finale WordPress'
      : !launched ? 'Programme activé : lance la reprise des cartes'
      : !receipt ? 'Le reçu SMS n’affiche pas la carte : Réglages › Messages › Reçu › Texte d’origine' : '';
    return { on: enabled && launched, enabled, launched, blocker };
  }
};

export default /** @type {const} */ ({ key: 'loyalty', defaults, schema: loyaltySchema, golive });
