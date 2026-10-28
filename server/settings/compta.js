// @ts-check
// Comptabilité (CPT-03): how the books are kept, read by the ledger (domain/ledger.js), the cash book (CPT-04) and the
// accountant's pack (CPT-05). Every choice here is « à valider une fois avec ton comptable »: the defaults are the
// plan's (decision 14): regime to confirm, VAT on services on collection, gift cards taxed when used (as the till does
// today), deposits taxed the day they are paid, Stripe's fees self-assessed (Stripe Payments Europe bills from Ireland).
//   regime          the VAT regime; 'simplifie' disappears on 1 January 2027 (the screen says so)
//   servicesVat     'encaissements' (the default for services) or 'debits' (an option: deposits then carry no VAT)
//   giftcards       'multiple' only in v1: VAT when the card is used, as the till (sales.js) books it. 'unique' (VAT at
//                   sale) changes the till itself, so it comes with CPT-06, never here alone
//   depositVat      VAT on a deposit (any online payment still unused at the end of its day) the day it is paid
//   feesReverseCharge  the VAT on Stripe's fees, due and deductible at once (autoliquidation, 445200 / 445662)
//   legalForm       'a-confirmer' | 'ei' | 'societe': the owner's withdrawals (108000) or a partner's account (455000), CPT-04
//   accounts        role → number (shared/accounts.js has the roles, their default numbers and labels)
//   journals        the journal codes of the files
//   accountant      who receives the pack (CPT-05): name, firm, e-mail. They name a person: commands/shop.js keeps them in
//                   the event's pii, out of the chain
//   autoSend        the month's pack goes by itself once the accountant's e-mail is set (CPT-05)
//   ereporting      the e-reporting of B2C sales (from 1 September 2027), its cadence (CPT-05)
// No import of the engine here: the settings registry (index.js) loads this file while the engine is still loading.
import { str, bool, opt, obj, oneOf, day, InvalidInput } from '../lib/validate.js';
import { ACCOUNT_ROLES, DEFAULT_ACCOUNTS, ACCOUNT_PATTERN } from '../../shared/accounts.js';

export const REGIMES = /** @type {const} */ (['a-confirmer', 'reel-mensuel', 'reel-trimestriel', 'simplifie', 'franchise']);
export const GIFTCARD_VAT = /** @type {const} */ (['multiple']);
export const LEGAL_FORMS = /** @type {const} */ (['a-confirmer', 'ei', 'societe']);
export const CADENCES = /** @type {const} */ (['mensuel', 'decade', 'bimestriel']);

const accountsSchema = obj(Object.fromEntries(ACCOUNT_ROLES.map((x) => [x.role, opt(str({ max: 10, pattern: ACCOUNT_PATTERN }))])));
const code = () => opt(str({ min: 1, max: 6, pattern: /^[A-Z0-9]+$/, lower: false }));
/** Two journals with one code would share their entries' numbers (VE000001): the accountant's software merges them. */
export function journalClash(journals) {
  const seen = new Set();
  for (const v of Object.values(journals || {})) { if (!v) continue; if (seen.has(v)) return v; seen.add(v); }
  return null;
}
const journalsSchema = obj({ sales: code(), cash: code(), bank: code(), misc: code() });
const journalsChecked = {
  parse(x, p) {
    const v = journalsSchema.parse(x, p);
    const dup = journalClash(v);
    if (dup) throw new InvalidInput(p, 'deux journaux ont le même code (' + dup + ')');
    return v;
  }
};

/** Mise en route › Nouveautés (WP-10): the regime is the one thing to settle with the accountant before the first file. */
const golive = {
  label: 'Comptabilité',
  // the regime is set in Réglages › Comptabilité (features.js would send it to Données otherwise)
  to: 'compta',
  /** @param {any} s */
  state(s) {
    const c = s && s.settings && s.settings.compta;
    const on = !!c && c.regime !== 'a-confirmer';
    return { on, blocker: on ? '' : 'régime TVA à confirmer avec ton comptable' };
  }
};

export default /** @type {const} */ ({
  key: 'compta',
  defaults: () => ({
    regime: 'a-confirmer', servicesVat: 'encaissements', giftcards: 'multiple', depositVat: true, feesReverseCharge: true, legalForm: 'a-confirmer',
    accounts: { ...DEFAULT_ACCOUNTS },
    journals: { sales: 'VE', cash: 'CA', bank: 'BQ', misc: 'OD' },
    accountant: { name: '', firm: '', email: '' },
    autoSend: true,
    ereporting: { from: '2027-09-01', cadence: 'mensuel' }
  }),
  schema: obj({
    regime: opt(oneOf(REGIMES)), servicesVat: opt(oneOf(/** @type {const} */ (['encaissements', 'debits']))), giftcards: opt(oneOf(GIFTCARD_VAT)),
    depositVat: opt(bool()), feesReverseCharge: opt(bool()), legalForm: opt(oneOf(LEGAL_FORMS)),
    accounts: opt(accountsSchema),
    journals: opt(journalsChecked),
    accountant: opt(obj({
      name: opt(str({ max: 120 })), firm: opt(str({ max: 120 })),
      email: opt(str({ max: 120, lower: true, pattern: /^([^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,})?$/ }))
    })),
    autoSend: opt(bool()),
    ereporting: opt(obj({ from: opt(day()), cadence: opt(oneOf(CADENCES)) }))
  }),
  golive
});
