// @ts-check
// The loyalty card's arithmetic and words (FID-02), shared by the server, the Comptoir and /moi so the till, the client
// file and the client's own page always say the same. Pure: no state, no clock.
import { fmtEur } from './money.js';

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
 * The card in a few words: « 6/9 tampons », « 180/250 points », « Prochaine coupe offerte », « Ne participe pas ».
 * @param {{ units: number, goal: number, model?: string, off?: boolean, rewards?: { reward?: Reward }[] }} card
 */
export function cardWords(card) {
  if (!card) return '';
  if (card.off) return 'Ne participe pas';
  const r = card.rewards && card.rewards.length ? card.rewards[0].reward : null;
  if (r) return r.kind === 'amount' ? fmtEur(r.amount || 0) + ' offerts au prochain passage' : 'Prochaine coupe offerte';
  return card.units + '/' + card.goal + (card.model === 'points' ? ' points' : ' tampons');
}
