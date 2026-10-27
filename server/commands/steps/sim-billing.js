// @ts-check
// The demo's billing (PAY-02): with the simulated provider nothing renews a membership, so the demo does what Stripe
// would. A member whose last paid period is over gets the next one paid (memberPaid, invoice sim_<id>_<n>: run twice,
// nothing more), on the anchor's day of the month; a member flagged demoFail is refused once (memberFailed) and pays
// two days later; a cancellation that took effect ends the member. Demo salon and simulated members only: in
// production the provider's webhooks do all of this (PAY-03).
// One ticket per tick at most: a ticket's number is read from the state, which a second one in the same write would
// not see yet. The demo's sixteen members are caught up within minutes.
import { memberPaid, memberFailed, endMember } from '../memberships.js';
import { periodEndAt } from '../../domain/membership.js';

const RETRY_MS = 2 * 86400000;

/** The next thing the simulated provider would do for this member today, or null. */
export function simNext(m, day, now) {
  if (m.provider !== 'simulated' || !m.activatedAt || m.ended || m.withdrawn || !m.periods.length) return null;
  if (m.cancel && m.cancel.effective <= day) return { kind: 'end' };
  const n = m.periods.length;
  const last = m.periods[n - 1];
  if (day < last.end) return null;
  // cancelled at the end of this period: nothing more to collect
  if (m.cancel && m.cancel.effective <= last.end) return null;
  const invoice = 'sim_' + m.id + '_' + n;
  if (m.demoFail && !m.failed.length) return { kind: 'fail', invoice };
  if (m.pastDue && m.pastDue.invoice === invoice && now < m.pastDue.nextAt) return null;
  return { kind: 'pay', invoice, start: last.end, end: periodEndAt(m, n) };
}

export default {
  name: 'sim-billing',
  /** @param {any} s @param {import('../../core/engine.js').Ctx} ctx */
  run(s, ctx) {
    if (s.mode !== 'demo' || !s.members || !s.members.size) return;
    // another step already rang a ticket in this write: next tick
    if (ctx.drafts.some((d) => d.type === 'sale.completed')) return;
    const day = ctx.local.day;
    for (const m of s.members.values()) {
      const next = simNext(m, day, ctx.now);
      if (!next) continue;
      // one member refused (an overlap, a sealed day) costs only its own events: the others still renew
      const mark = ctx.drafts.length;
      try {
        if (next.kind === 'end') { endMember.run(s, { id: m.id, reason: 'cancelled' }, ctx); continue; }
        if (next.kind === 'fail') { memberFailed.run(s, { id: m.id, invoice: next.invoice, attempt: 1, nextAt: ctx.now + RETRY_MS }, ctx); continue; }
        memberPaid.run(s, { id: m.id, invoice: next.invoice, amount: m.price, periodStart: next.start, periodEnd: next.end, chargeRef: 'sim_ch_' + m.id + '_' + m.periods.length }, ctx);
        return;
      } catch { ctx.drafts.length = mark; }
    }
  }
};
