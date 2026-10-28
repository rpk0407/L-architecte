// @ts-check
// The words that explain the team's figures (TEAM-03), one copy for the Comptoir and the tests: why what the team
// performed (Chiffre réalisé) is not what came in (Encaissé). Carnets and memberships are money for later, counted when
// a cut is done; a free loyalty cut is counted as if paid; a line rung up without a barber is the salon's.
import { fmtEur as eur } from './money.js';

// in euros and cents, as the team table: the two figures side by side never mix « 15 462 € » and « 15 028,50 € »
const fmtEur = (c) => eur(c, { decimals: true });

/**
 * The gap sentence in pieces, [text, cents] each, so the Comptoir can blur the amounts (« Masquer les montants »);
 * [] without a gap object.
 * @param {{ revenue: number, performed?: number, gap?: { prepaidSold: number, prepaidUsed: number, rewards: number, unassigned: number } }} r
 * @returns {[string, number][]}
 */
export function gapParts(r) {
  if (!r.gap || r.performed == null) return [];
  const g = r.gap;
  /** @type {[string, number][]} */
  const why = [['carnets et abonnements vendus ', g.prepaidSold], ['consommés ', g.prepaidUsed], ['remises fidélité ', g.rewards], ['sans barbier ', g.unassigned]];
  /** @type {[string, number][]} */
  const out = [['Réalisé par l’équipe ', r.performed], [' · Encaissé ', r.revenue]];
  why.filter(([, v]) => v).forEach(([k, v], i) => out.push([(i ? ', ' : ' · écart : ') + k, v]));
  return out;
}

/**
 * « Réalisé par l’équipe 8 420 € · Encaissé 8 900 € · écart : carnets et abonnements vendus 640 €, consommés 160 € »,
 * with « remises fidélité » and « sans barbier » when they apply; '' without a gap object.
 * @param {{ revenue: number, performed?: number, gap?: { prepaidSold: number, prepaidUsed: number, rewards: number, unassigned: number } }} r
 */
export function gapWords(r) {
  return gapParts(r).map(([k, v]) => k + fmtEur(v)).join('');
}

/** « Commission sur le prix HT · coupes de carnet pour qui coupe » @param {{ base: string, cutCredit: string }} R */
export function rulesWords(R) {
  return 'Commission sur le prix ' + (R.base === 'ht' ? 'HT' : 'TTC') + ' · coupes de carnet ' + (R.cutCredit === 'seller' ? 'pour qui vend' : 'pour qui coupe');
}
