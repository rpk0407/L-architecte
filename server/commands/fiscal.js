// @ts-check
// Closing a month (CPT-01a): the sum of its Z, sealed and numbered like a Z, and the year with it when the month ends the
// fiscal year. Months close in order, without gaps, once every day of the month with till activity has its Z; the tick
// does it by itself after 05:00 (commands/steps/fiscal.js), the owner can do it sooner (Caisse › Clôture). The figures
// come from domain/fiscal.js; the projection is projections/fiscal.js.
import { fail } from '../core/engine.js';
import { isMonth, monthOf, monthNo, yearNo, monthWords, nextMonth, waitingDay, monthTotals, yearTotals, yearEndOf } from '../domain/fiscal.js';
import { DAYS_FR, dayParts } from '../../shared/dates.js';

export const closePeriod = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'system') ctx.need('closure');
    const month = input && input.month;
    if (!isMonth(month)) fail(400, 'invalid', 'Mois invalide (AAAA-MM attendu).');
    const today = ctx.local.day;
    if (month >= monthOf(today)) fail(409, 'not_over', 'Le mois n’est pas fini.');
    if (s.periodByKey.has('M:' + month)) fail(409, 'closed', 'Ce mois est déjà clôturé.');
    const next = nextMonth(s);
    // the first month is the month of the first Z: before it there is nothing to close
    if (!next || month < next) fail(409, 'nothing', 'Aucune clôture Z ce mois-là : rien à clôturer.');
    if (month > next) fail(409, 'missed', 'Clôture d’abord ' + monthWords(next, today) + '.', { month: next });
    const wait = waitingDay(s, month, today);
    if (wait) { const p = dayParts(wait); fail(409, 'days', `Il manque le Z du ${DAYS_FR[p.wd]} ${p.d} : clôture-le d’abord.`, { day: wait }); }

    const number = s.monthSeq + 1;
    const rec = { id: ctx.id('pm'), kind: 'month', period: month, number, ...monthTotals(s, month) };
    ctx.emit('period.closed', rec);
    let year = null;
    if (Number(month.slice(5, 7)) === yearEndOf(s)) {
      const n = s.yearSeq + 1;
      const y = { id: ctx.id('py'), kind: 'year', period: month.slice(0, 4), number: n, ...yearTotals(s, month, rec) };
      ctx.emit('period.closed', y);
      year = { ref: yearNo(n), number: n, period: y.period };
    }
    return { ref: monthNo(number), number, month, net: rec.totals.netTtc, year };
  },
  /** A retried request answers from the events it wrote. @param {{ type: string, data: any }[]} events */
  replay(events) {
    const m = events.find((e) => e.type === 'period.closed' && e.data.kind === 'month');
    const y = events.find((e) => e.type === 'period.closed' && e.data.kind === 'year');
    if (!m) return { ok: true };
    return { ref: monthNo(m.data.number), number: m.data.number, month: m.data.period, net: m.data.totals.netTtc, year: y ? { ref: yearNo(y.data.number), number: y.data.number, period: y.data.period } : null };
  }
};
