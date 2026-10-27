// @ts-check
// Online payments after the checkout, as the projection folds them: money given back at the provider without the till
// (payment.refundedOutside), chargebacks (payment.disputed, payment.disputeClosed) and payouts with their fees
// (payout.recorded). The payment itself (created, succeeded, refunded) stays in core/state.js, which hands
// payment.succeeded on here for the charge index. Registered in core/extensions.js; the commands are in
// commands/payments.js. No personal data here: the provider's customer and card ids live in pii (state.js), and an
// erasure blanks them below. No import of the engine or the state here (see core/extensions.js).
import { fmtEur } from '../../shared/money.js';
import { localParts } from '../../shared/dates.js';
import { providerLabel } from '../payments/labels.js';

/** dd/mm, the salon's day of an instant */
const ddmm = (ms) => { const d = localParts(ms).day; return d.slice(8, 10) + '/' + d.slice(5, 7); };
const eu = (c) => fmtEur(c, { decimals: c % 100 !== 0 });

/**
 * What the till's credit notes paid back online for this payment: the online credit notes of its ticket, shared across
 * the ticket's online payments in their order, each up to its amount.
 * @returns {number}
 */
export function creditedOnline(s, py) {
  const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
  if (!sale) return 0;
  let rest = 0;
  for (const id of sale.refundIds || []) { const rf = s.refunds.get(id); if (rf && rf.method === 'online') rest += rf.amount; }
  for (const p of sale.payments || []) {
    if (!p.paymentId) continue;
    const other = s.payments.get(p.paymentId);
    const take = Math.min(rest, other ? other.amount : p.amount);
    if (p.paymentId === py.id) return take;
    rest -= take;
  }
  return 0;
}
/** What our records give back of it: refundOnline's refunds and the till's online credit notes. */
export const booked = (s, py) => Math.min(py.amount, (py.refunded || 0) + creditedOnline(s, py));
/** What the provider has given back, as far as we know: its own word (charge.refunded) or our records, the larger. */
export const providerKnown = (s, py) => Math.min(py.amount, Math.max(py.providerRefunded || 0, booked(s, py)));
/** Given back at the provider and in no credit note yet: what the owner still has to write an avoir for. */
export const outsideOpen = (s, py) => Math.max(0, Math.min(py.amount, py.providerRefunded || 0) - booked(s, py));

/** @type {import('../core/extensions.js').Extension} */
export const paymentsExtension = {
  init(s) { s.disputes = new Map(); s.payouts = new Map(); s.paymentByCharge = new Map(); },
  on: {
    // handed on by state.js after its own case: disputes, refunds and payouts name the charge, not the checkout page
    'payment.succeeded': (s, e, d) => { const py = s.payments.get(d.id); if (py && py.chargeRef) s.paymentByCharge.set(py.chargeRef, py.id); },
    'payment.refundedOutside': (s, e, d) => {
      const py = s.payments.get(d.id);
      if (!py) return;
      py.providerRefunded = Math.min(py.amount, Math.max(py.providerRefunded || 0, d.total ?? (py.providerRefunded || 0) + d.amount));
      py.outsideAt = e.at;
      // on no ticket yet and given back in full: nothing left to cash in, the till must not deduct it any more
      if (!py.usedBy && py.status === 'paid' && py.providerRefunded >= py.amount) {
        Object.assign(py, { status: 'refunded', endedAt: e.at, reason: 'Remboursé chez le prestataire' });
        const a = py.apptId ? s.appts.get(py.apptId) : null;
        if (a && a.deposit && a.deposit.paymentId === py.id && !a.saleId) a.deposit = { ...a.deposit, paid: 0 };
      }
    },
    // opened, or its amount, reason or answer date changed (the command writes it only then)
    'payment.disputed': (s, e, d) => {
      const x = d.dispute || {};
      const cur = s.disputes.get(x.id);
      s.disputes.set(x.id, { id: x.id, pid: d.id, amount: x.amount, reason: x.reason || '', dueBy: x.dueBy || 0, status: cur ? cur.status : 'open', openedAt: cur ? cur.openedAt : e.at, updatedAt: e.at, closedAt: cur ? cur.closedAt : 0 });
      const py = s.payments.get(d.id);
      if (py) py.disputeId = x.id;
    },
    'payment.disputeClosed': (s, e, d) => { const x = s.disputes.get(d.disputeId); if (x) Object.assign(x, { status: d.status, closedAt: e.at }); },
    'payout.recorded': (s, e, d) => {
      s.payouts.set(d.id, { id: d.id, amount: d.amount, gross: d.gross, fee: d.fee, arrival: d.arrival, items: d.items || [], count: (d.items || []).length, at: e.at, ...(d.truncated ? { truncated: true } : {}) });
      // the payment's own charge carries its fee (a refund or a dispute line of the same payment does not overwrite it)
      for (const it of d.items || []) {
        if (!it.pid || (it.type !== 'charge' && it.type !== 'payment')) continue;
        const py = s.payments.get(it.pid);
        if (py) Object.assign(py, { fee: it.fee, net: it.net, payoutId: d.id });
      }
    },
    // the provider's customer and card ids of the erased files' payments (their pii goes with the events, state.js)
    'client.erased': (s, e, d) => {
      const ids = new Set(d.ids || [d.id]);
      for (const py of s.payments.values()) {
        const a = py.apptId ? s.appts.get(py.apptId) : null;
        if (ids.has(py.cid) || (a && ids.has(a.clientId))) { py.customer = null; py.pm = null; }
      }
    }
  },
  feed: ['payment.disputed', 'payment.refundedOutside', 'payout.recorded'],
  // money lines, for whoever sees every sale; the appointment's barber travels with them (TEAM-01's toasts)
  item(r, f) {
    const s = r.s, d = f.data || {};
    if (!r.caps.has('sale.all')) return null;
    const base = { v: f.v, at: f.at, by: f.actor.t, money: true };
    if (f.type === 'payout.recorded') {
      const n = (d.items || []).length;
      return { ...base, kind: 'payment', title: 'Virement ' + providerLabel(f.actor.t === 'provider' ? f.actor.id : '') + ' ' + eu(d.amount) + ' · frais ' + eu(d.fee), sub: n + ' opération' + (n > 1 ? 's' : '') + (d.arrival ? ' · sur ton compte le ' + ddmm(d.arrival) : '') };
    }
    const py = s.payments.get(d.id);
    if (!py) return null;
    const a = py.apptId ? s.appts.get(py.apptId) : null;
    const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
    // a tap opens the ticket when there is one (the avoir is made there, on its day), else the appointment; the
    // provider is the payment's own, not whoever wrote the line (the till's fallback writes it as the staff)
    const ref = { paymentId: py.id, ...(sale ? { saleId: sale.id, day: sale.day } : a ? { apptId: a.id, day: a.day } : {}), ...(a ? { staffId: a.staffId } : {}) };
    const label = providerLabel(py.provider);
    if (f.type === 'payment.disputed') {
      const x = d.dispute || {};
      return { ...base, kind: 'dispute', title: 'Litige ouvert · ' + eu(x.amount || 0) + (x.dueBy ? ' · réponse avant le ' + ddmm(x.dueBy) : ''), sub: py.label || '', ...ref };
    }
    return { ...base, kind: 'refund', title: 'Remboursé chez ' + label + ' ' + eu(d.amount), sub: py.usedBy ? 'Sans avoir : fais l’avoir depuis le ticket' : py.label || '', ...ref };
  }
};
