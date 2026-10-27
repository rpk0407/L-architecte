// @ts-check
// A barber's monthly statement (TEAM-03): what he performed, his estimated commission, his tips, the cuts of carnets and
// memberships credited to him, the refunds deducted, his days. Read from report()'s rows only, so Mes chiffres, the agenda
// and the payroll CSV give the same numbers; the accountant's payroll pack reuses it and never recomputes a commission.
// An estimate for the payroll provider: « Estimation, la paie fait foi ».
import { addDays, dayRange, monthStart, monthEnd, weekday, instantOf, MONTHS_FR } from '../../shared/dates.js';
import { report } from './insights.js';
import { staffIntervals, shopIntervals, UNDECIDED } from './availability.js';
import { hadTill } from './cash.js';
import { payRulesOf } from '../settings/team.js';

export const PROVISIONAL = 'mois non clôturé : chiffres provisoires';

/** « novembre 2026 » @param {string} month YYYY-MM */
export const monthWords = (month) => MONTHS_FR[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);

/**
 * Days of the month (up to `last`) he was due in and was away: an approved absence on a day his week and the salon
 * open; a part of a day counts as a day.
 */
function absences(s, staffId, days) {
  const st = s.staff.get(staffId);
  if (!st) return 0;
  return days.filter((d) => ((st.schedule && st.schedule[weekday(d)]) || []).length && shopIntervals(s, d).length
    && [...s.timeoff.values()].some((t) => t.staffId === staffId && d >= t.from && d <= t.to && !UNDECIDED.has(t.status))).length;
}

/**
 * @param {any} s @param {string} staffId @param {string} month YYYY-MM
 * @param {string} [today] the salon's day: the month stops there, and a month not over is provisional (default: the month
 *   is read as complete)
 * @param {number} [now]
 */
export function staffStatement(s, staffId, month, today, now) {
  const from = month + '-01', end = monthEnd(from);
  const day = today || end;
  const to = day < end ? day : end;
  const st = s.staff.get(staffId);
  const rules = payRulesOf(s.settings);
  const rep = to >= from ? report(s, { from, to, staffId, today: day, now: now ?? instantOf(day, 1439) }) : null;
  const row = rep && rep.staff[0];
  const days = to >= from ? dayRange(from, to) : [];
  const zero = { n: 0, net: 0 };
  const refunds = row ? row.refunds : 0, refundCount = row ? row.refundCount : 0;
  const carnet = row ? row.cutsCarnet : { n: 0, value: 0, estimated: 0 };
  const warnings = [];
  if (refundCount) warnings.push(refundCount + (refundCount > 1 ? ' remboursements déduits' : ' remboursement déduit'));
  if (carnet.estimated) warnings.push('coupes de carnet repris de l’ancien site : valeur estimée (prix du carnet ÷ coupes)');
  // a day with something at the till and no Z, or a month that is not over: the figures may still move
  const provisional = (!!today && today <= end) || days.some((d) => hadTill(s, d) && !s.closures.has(d));
  if (provisional) warnings.push(PROVISIONAL);
  return {
    month, from, to, label: monthWords(month), provisional,
    staff: { id: staffId, name: st ? st.name : '', color: st ? st.color : '' },
    base: rules.base, rates: (st && st.commission) || { service: 0, product: 0 }, cutCredit: rules.cutCredit, memberCredit: rules.memberCredit, rewardCredit: rules.rewardCredit,
    performed: row ? row.revenue : 0, performedHt: row ? row.revenueHT : 0, commission: row ? row.commission : 0,
    services: row ? row.paid.services : zero, products: row ? row.paid.products : zero, fees: row ? row.paid.fees : zero, packs: row ? row.paid.packs : zero,
    cuts: { carnet, member: row ? row.cutsMember : { n: 0, value: 0 } }, rewards: row ? row.rewards : { n: 0, value: 0 },
    refunds, refundCount, tips: { card: row ? row.tipsCard : 0, cash: row ? row.tipsCash : 0 }, discountsGiven: row ? row.discounts : 0,
    done: row ? row.done : 0, noShows: row ? row.noShows : 0, walkins: row ? row.walkins : 0,
    absenceDays: absences(s, staffId, days), workedDays: days.filter((d) => staffIntervals(s, staffId, d).length).length,
    warnings
  };
}

/** The month before `day`'s, as YYYY-MM (the statement a barber checks at the start of a month). */
export const lastMonth = (day) => addDays(monthStart(day), -1).slice(0, 7);
