// @ts-check
// The monthly membership in words (PAY-07), the one place a plan and its use are said: the site's card, the member page,
// the /moi row, the till's line, the client file, Mon espace, the board and the texts all read it, on the server and in
// the browser alike. Pure: no state, no clock.
//
// A plan (or the member who signed for it) says how often:
//   rhythm 'month' (absent: every plan and member from before PAY-07)  cuts per billing month (0 = illimité), minDays
//   rhythm 'week'                                                      perWeek (1-3) and what a missed week does:
//     missed 'lost'   one cut (perWeek) per calendar week, Monday to Sunday, no catching up
//     missed 'month'  the month's perWeek × 4 cuts, whenever he wants, one a day at most
//     missed 'free'   no ceiling, one a day at most: the salon only sees his weeks
// For a weekly plan cuts and minDays are derived (derivedCuts): the till's quota and gap rules keep working for 'month'
// and 'free', and the calendar week is the one new rule ('lost', domain/membership.js cover).
import { addDays, dayParts, isDay, pad2, weekStart } from './dates.js';
import { fmtEur } from './money.js';

export const RHYTHMS = /** @type {const} */ (['month', 'week']);
export const MISSED = /** @type {const} */ (['lost', 'month', 'free']);
export const PER_WEEK_MAX = 3;
/** the weeks a billing month is counted for: the 'month' rule's quota is perWeek × 4 */
export const WEEKS_A_MONTH = 4;

/** @typedef {{ rhythm?: string, perWeek?: number, missed?: string, cuts?: number, minDays?: number }} Rhythm */

/** @param {Rhythm | null | undefined} m @returns {'month'|'week'} */
export const rhythmOf = (m) => (m && m.rhythm === 'week' ? 'week' : 'month');
/** @param {Rhythm | null | undefined} m */
export const perWeekOf = (m) => (rhythmOf(m) === 'week' ? Math.max(1, Math.min(PER_WEEK_MAX, Number.isInteger(m && m.perWeek) ? /** @type {number} */ (/** @type {Rhythm} */ (m).perWeek) : 1)) : 0);
/** @param {Rhythm | null | undefined} m @returns {'lost'|'month'|'free'|null} */
export const missedOf = (m) => (rhythmOf(m) !== 'week' ? null : m && (m.missed === 'month' || m.missed === 'free') ? m.missed : 'lost');
/** The calendar week is the rule (one a week, a missed week is lost). @param {Rhythm | null | undefined} m */
export const weekRule = (m) => missedOf(m) === 'lost';

/** What a weekly plan stores for the till's quota and gap: lost and free have no month ceiling, one a day at most. */
export function derivedCuts(/** @type {Rhythm} */ p) {
  const n = perWeekOf(p), rule = missedOf(p);
  return { cuts: rule === 'month' ? n * WEEKS_A_MONTH : 0, minDays: 1 };
}

const cuts = (n) => n + (n > 1 ? ' coupes' : ' coupe');
const ddmm = (day) => { const p = dayParts(day); return pad2(p.d) + '/' + pad2(p.m); };

/**
 * How often, in words: « 1 coupe par semaine », « 2 coupes par semaine », « 4 coupes par mois », « coupes illimitées,
 * une par jour au plus »; a monthly plan as before: « 2 coupes par mois », « 1 coupe tous les 7 jours », « coupes
 * illimitées ». detail: the contract's words (the mails, the acknowledgements), where a gap is said in full.
 * @param {Rhythm} p @param {{ detail?: boolean }} [o]
 */
export function planWords(p, o = {}) {
  const rule = missedOf(p);
  if (rule === 'lost') return cuts(perWeekOf(p)) + ' par semaine';
  if (rule === 'month') return cuts(perWeekOf(p) * WEEKS_A_MONTH) + ' par mois';
  if (rule === 'free') return 'coupes illimitées, une par jour au plus';
  const gap = p.minDays || 0;
  if (p.cuts) return cuts(p.cuts) + ' par mois' + (o.detail && gap ? ', une tous les ' + gap + ' jours au plus' : '');
  if (!gap) return 'coupes illimitées';
  if (gap === 1) return 'coupes illimitées, une par jour au plus';
  return o.detail ? 'coupes illimitées, une tous les ' + gap + ' jours au plus' : '1 coupe tous les ' + gap + ' jours';
}

const MISSED_FR = { lost: 'perdue', month: 'rattrapable dans le mois', free: 'pas de limite' };
/** « Semaine manquée : perdue » / « rattrapable dans le mois » / « pas de limite »; '' for a monthly plan. @param {Rhythm} p */
export function missedWords(p) {
  const rule = missedOf(p);
  return rule ? 'Semaine manquée : ' + MISSED_FR[rule] : '';
}

/**
 * The offer as the client reads it, the line Réglages previews: « 80 €/mois · 1 coupe par semaine · semaine manquée
 * perdue ». A rule with no ceiling says nothing more than its words.
 * @param {Rhythm & { price: number }} p
 */
export function offerWords(p) {
  const rule = missedOf(p);
  const tail = rule === 'lost' ? ' · semaine manquée perdue' : rule === 'month' ? ' · semaine manquée rattrapable dans le mois' : '';
  return fmtEur(p.price, { decimals: p.price % 100 !== 0 }) + '/mois · ' + planWords(p) + tail;
}

/**
 * Where a member stands, in words: « Cette semaine : prise » / « Cette semaine : à prendre » for a weekly plan (« 1/2 »
 * past one a week; « · 2/4 ce mois-ci » when a missed week is caught up in the month), « 1/2 ce mois-ci » otherwise
 * (« 3 ce mois-ci (illimité) » with no ceiling).
 * @param {Rhythm} m @param {{ used: number, of: number, week?: { used: number, of?: number } | null }} u
 */
export function useWords(m, u) {
  if (rhythmOf(m) !== 'week') return (u.of ? u.used + '/' + u.of : u.used + ' (illimité)') + ' ce mois-ci';
  const n = perWeekOf(m), w = u.week ? u.week.used : 0;
  const week = 'Cette semaine : ' + (n > 1 ? Math.min(w, n) + '/' + n : w ? 'prise' : 'à prendre');
  return missedOf(m) === 'month' ? week + ' · ' + u.used + '/' + u.of + ' ce mois-ci' : week;
}

/**
 * The same, short, for a chip (the till, the client file, Mon espace): « semaine prise », « semaine à prendre », « 1/2
 * cette semaine »; « 1/2 ce mois », « 3 ce mois » for a monthly plan.
 * @param {Rhythm} m @param {{ used: number, of: number, week?: { used: number, of?: number } | null }} u
 */
export function shortWords(m, u) {
  if (rhythmOf(m) !== 'week') return (u.of ? u.used + '/' + u.of : u.used) + ' ce mois';
  const n = perWeekOf(m), w = u.week ? u.week.used : 0;
  return n > 1 ? Math.min(w, n) + '/' + n + ' cette semaine' : w ? 'semaine prise' : 'semaine à prendre';
}

/**
 * The till's line of a covered cut (« Coupe classique · Abonnement · semaine du 03/11 (1/1) »): the calendar week for
 * a weekly plan, the billing month it counts in otherwise (« Abonnement · coupe 2/2 (26/09–25/10) », « Abonnement
 * illimité (03/11–02/12) »: a month's name would read « sept. » for a cut of 1 October in a period from 26 September).
 * @param {Rhythm} m @param {number} used this cut's rank, in its week or its month
 * @param {{ start?: string, end?: string, week?: { start: string } | null }} [period]
 */
export function labelWords(m, used, period = {}) {
  const rule = missedOf(m);
  if ((rule === 'lost' || rule === 'free') && period.week && isDay(period.week.start)) {
    return 'Abonnement · semaine du ' + ddmm(period.week.start) + (rule === 'lost' ? ' (' + used + '/' + perWeekOf(m) + ')' : '');
  }
  const span = period.start && period.end && isDay(period.start) && isDay(period.end) ? ' (' + ddmm(period.start) + '–' + ddmm(addDays(period.end, -1)) + ')' : '';
  return m.cuts ? 'Abonnement · coupe ' + used + '/' + m.cuts + span : 'Abonnement illimité' + span;
}

/**
 * What a booking says when the membership pays it (« Inclus dans ton abonnement · 1/2 ce mois »): the week it falls in
 * for a weekly plan, the month's count otherwise.
 * @param {Rhythm} m @param {{ used: number, of: number, week?: { start: string } | null }} c
 */
export function bookedWords(m, c) {
  const rule = missedOf(m);
  if (rule === 'lost' || rule === 'free') return c.week && isDay(c.week.start) ? 'semaine du ' + ddmm(c.week.start) : 'cette semaine';
  return c.of ? c.used + '/' + c.of + ' ce mois' : 'illimité';
}

/** The Monday of a salon day's week, and the day after its Sunday. @param {string} day */
export function weekOf(day) { const start = weekStart(day); return { start, end: addDays(start, 6), next: addDays(start, 7) }; }
