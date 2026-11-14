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
  // the shop's figure is its revenue (Chiffre d’affaires): « Encaissé » is kept for the money that came in (HOW.takings)
  const out = [['Réalisé par l’équipe ', r.performed], [' · Chiffre d’affaires ', r.revenue]];
  why.filter(([, v]) => v).forEach(([k, v], i) => out.push([(i ? ', ' : ' · écart : ') + k, v]));
  return out;
}

/**
 * « Réalisé par l’équipe 8 420 € · Chiffre d’affaires 8 900 € · écart : carnets et abonnements vendus 640 €, consommés 160 € »,
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

/**
 * How each number of Pilotage and Rapports is computed, in one plain sentence: the caption or tooltip under the figure,
 * written once so the two screens never explain the same number two ways. The formulas themselves live in
 * server/domain/insights.js (report, goalOf) and server/domain/cockpit.js (compareOf, todayOf); each key names its own.
 */
export const HOW = {
  /** report().revenue */
  revenue: 'Ventes TTC de la période, avoirs déduits le jour de l’avoir. Les cartes cadeaux vendues et les pourboires n’en font pas partie.',
  /** cockpit takingsOf(): the Z's `takings` */
  takings: 'Argent réellement entré : carte, espèces et paiements en ligne, cartes cadeaux vendues et pourboires compris. Ce qui est réglé par carte cadeau ou par acompte est entré un autre jour.',
  /** goalOf().projection */
  pace: 'Chiffre du mois ÷ jours ouverts écoulés × jours ouverts du mois. Aujourd’hui ne compte que pour la part de la journée déjà passée.',
  /** cockpit compareOf() */
  compare: 'Un mois ou une semaine en cours se compare à jours ouverts égaux : les jours ouverts déjà terminés, contre autant de jours ouverts au début de la période d’avant.',
  /** report().occupancy */
  fill: 'Minutes réservées ÷ minutes d’ouverture des fauteuils. Un barbier parti compte jusqu’à son départ.',
  /** report().clients */
  clients: 'Personnes servies : tickets qui portent une prestation ou un produit. Un prélèvement d’abonnement, un carnet ou une carte cadeau vendus seuls ne comptent pas.',
  /** report().avgTicket */
  basket: 'Prestations et produits payés ÷ tickets qui en portent. Abonnements, carnets et cartes cadeaux vendus sont à part.',
  /** insights noShowLoss() */
  noShow: 'Prix des rendez-vous manqués, moins l’acompte gardé.',
  /** report().products[].margin */
  margin: 'Prix de vente HT − prix d’achat HT, retours déduits.',
  /** cockpit todayOf(), aheadOf() */
  free: 'Heures de travail à venir, moins les rendez-vous et les indisponibilités posées dans l’agenda.',
  planned: 'Somme des prix des rendez-vous du jour, hors absences et annulations.'
};
