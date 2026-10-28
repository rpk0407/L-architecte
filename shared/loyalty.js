// @ts-check
// The loyalty card's arithmetic and words (FID-02), shared by the server, the Comptoir and /moi so the till, the client
// file and the client's own page always say the same. Pure: no state, no clock.
import { fmtEur } from './money.js';
import { dayParts, MONTHS_FR } from './dates.js';

/**
 * @typedef {{ kind: 'service'|'amount', refs?: string[], cap?: number, amount?: number }} Reward
 * @typedef {{ kind: string, ref?: string|null, unit: number, qty?: number, discount?: number }} RewardLine
 */

/**
 * Cents a reward takes off one line, 0 when it does not apply. A service reward pays one unit of a service line (one
 * of `refs` when set), up to its cap; an amount comes off any service or product line, up to what the line still costs.
 * @param {Reward} reward @param {RewardLine} line
 */
export function rewardValue(reward, line) {
  if (!reward || !line) return 0;
  const qty = line.qty || 1;
  const left = Math.max(0, line.unit * qty - (line.discount || 0));
  if (reward.kind === 'service') {
    if (line.kind !== 'service') return 0;
    if (reward.refs && reward.refs.length && !reward.refs.includes(line.ref || '')) return 0;
    return Math.max(0, Math.min(reward.cap || line.unit, line.unit, left));
  }
  if (reward.kind === 'amount') {
    if (line.kind !== 'service' && line.kind !== 'product') return 0;
    return Math.max(0, Math.min(reward.amount || 0, left));
  }
  return 0;
}

/**
 * « Coupe classique offerte », « Une prestation offerte (jusqu’à 25 €) », « 5 € offerts ».
 * @param {Reward} reward @param {(id: string) => string} [nameOf] a service's name, '' when unknown
 */
export function rewardWords(reward, nameOf = () => '') {
  if (!reward) return '';
  if (reward.kind === 'amount') return fmtEur(reward.amount || 0) + ' offerts';
  const refs = reward.refs || [];
  const one = refs.length === 1 ? nameOf(refs[0]) : '';
  if (one) return one + ' offerte';
  return 'Une prestation offerte' + (reward.cap ? ' (jusqu’à ' + fmtEur(reward.cap) + ')' : '');
}

/**
 * The card in a few words: « 6/9 tampons », « 180/250 points », « Prochaine prestation offerte », « Ne participe pas ».
 * @param {{ units: number, goal: number, model?: string, off?: boolean, rewards?: { reward?: Reward }[] }} card
 */
export function cardWords(card) {
  if (!card) return '';
  if (card.off) return 'Ne participe pas';
  const r = card.rewards && card.rewards.length ? card.rewards[0].reward : null;
  if (r) return r.kind === 'amount' ? fmtEur(r.amount || 0) + ' offerts au prochain passage' : 'Prochaine prestation offerte';
  return card.units + '/' + card.goal + (card.model === 'points' ? ' points' : ' tampons');
}

/* ---------------- the card's sentences (FID-03): the Comptoir, /moi and the règlement say the same ---------------- */

/** « 3 », « 3 novembre », « 1er mars »: a day for a sentence. @param {string} day YYYY-MM-DD */
export function dayWords(day) {
  const p = dayParts(day);
  return (p.d === 1 ? '1er' : String(p.d)) + ' ' + MONTHS_FR[p.m - 1];
}
/** « 6 mois », « 12 mois », « 24 mois », « 45 jours »: a length of time kept as the salon set it. @param {number} days */
export function lapseWords(days) {
  const years = Math.round(days / 365);
  if (years >= 1 && Math.abs(days - years * 365) <= 5) return years * 12 + ' mois';
  return days >= 60 && days % 30 === 0 ? days / 30 + ' mois' : days + ' jours';
}
const lcFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/**
 * The card's rule in one line: « 9 passages = la 10e prestation offerte ». A reward that names one service says « prestation
 * offerte : Barbe » (the name's gender is not ours to guess), any other service « prestation offerte » (it pays any
 * service, as the reward's own label says); an amount « 9 passages = 5 € offerts au 10e passage ».
 * @param {{ goal: number, reward: Reward }} cfg @param {(id: string) => string} [nameOf]
 */
export function ruleWords(cfg, nameOf = () => '') {
  const g = cfg.goal, r = cfg.reward || { kind: 'service' };
  const nth = g + 1 + 'e';
  if (r.kind === 'amount') return g + ' passages = ' + fmtEur(r.amount || 0) + ' offerts au ' + nth + ' passage';
  const refs = r.refs || [];
  const one = refs.length === 1 ? nameOf(refs[0]) : '';
  return g + ' passages = la ' + nth + (one ? ' prestation offerte : ' + one : ' prestation offerte');
}
/** What the full card wins, as a client says it: « ta prestation offerte », « tes 5 € offerts ». @param {Reward} reward */
function wonWords(reward) {
  if (reward && reward.kind === 'amount') return 'tes ' + fmtEur(reward.amount || 0) + ' offerts';
  return 'ta prestation offerte';
}
/**
 * The card's headline for its holder: « Encore 3 passages avant ta prestation offerte », or, when a reward waits, « Ta prestation
 * offerte t’attend jusqu’au 12 mai » (« · et 1 autre » for the rest).
 * @param {{ units: number, goal: number, rewards?: { reward: Reward, expires: string }[] }} card @param {{ reward: Reward }} cfg
 */
export function headlineWords(card, cfg) {
  const w = card.rewards && card.rewards[0];
  if (w) {
    const more = card.rewards.length > 1 ? ' · et ' + (card.rewards.length - 1) + (card.rewards.length > 2 ? ' autres' : ' autre') : '';
    const s = wonWords(w.reward);
    return s.charAt(0).toUpperCase() + s.slice(1) + (w.reward.kind === 'amount' ? ' t’attendent' : ' t’attend') + ' jusqu’au ' + dayWords(w.expires) + more;
  }
  const left = Math.max(1, card.goal - Math.max(0, card.units));
  return 'Encore ' + left + ' passage' + (left > 1 ? 's' : '') + ' avant ' + wonWords(cfg.reward);
}

/**
 * The règlement of the card, generated from the salon's own settings (Réglages › Fidélité shows it, /moi shows it the
 * same): who, what earns, the reward, its validity, the reset, no cash value, a refund, the referral, and the notice.
 * @param {{ goal: number, minNet: number, reward: Reward, rewardDays: number, resetDays: number, referral?: { enabled?: boolean, referrer: Reward, referee: Reward, perYear?: number } }} cfg
 * @param {(id: string) => string} [nameOf] @returns {string[]}
 */
export function termsText(cfg, nameOf = () => '') {
  const lines = [
    'Qui participe : tout client qui a une fiche au salon, automatiquement. Tu peux demander à ne pas participer, au salon ou dans ton espace.',
    'Ce qui donne un tampon : un passage payé, avec ' + (cfg.minNet > 0 ? 'au moins ' + fmtEur(cfg.minNet) + ' de prestations réglées' : 'une prestation réglée') + ', et un seul par jour. Une coupe payée par un carnet ou par un abonnement n’en donne pas.',
    'La récompense : quand ta carte de ' + cfg.goal + ' tampons est pleine, tu gagnes ' + lcFirst(rewardWords(cfg.reward, nameOf)) + ', à utiliser sur ton prochain passage.',
    'Sa durée : une récompense se garde ' + lapseWords(cfg.rewardDays) + '. Passé ce délai, elle expire.'
  ];
  if (cfg.resetDays) lines.push('Ta carte repart de zéro après ' + lapseWords(cfg.resetDays) + ' sans passage.');
  lines.push('Les tampons et les récompenses n’ont aucune valeur en argent : ils ne se rachètent pas et ne se donnent pas à quelqu’un d’autre.');
  lines.push('Si un ticket est remboursé, son tampon est repris.');
  const R = cfg.referral;
  if (R && R.enabled) {
    lines.push('Parrainage : ton ami reçoit ' + lcFirst(rewardWords(R.referee, nameOf)) + ' sur sa première visite, et toi ' + lcFirst(rewardWords(R.referrer, nameOf)) + ' quand il a payé son premier passage' + (R.perYear ? ' (' + R.perYear + ' parrainages par an au plus)' : '') + '. Ton ami ne voit que ton prénom.');
  }
  lines.push('Le salon peut changer ces règles en te prévenant 30 jours avant. Les récompenses déjà gagnées restent valables.');
  return lines;
}
