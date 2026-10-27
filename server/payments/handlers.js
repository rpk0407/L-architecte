// @ts-check
// What each kind of provider notice does (payments/provider.js ProviderEvent, read by the webhook route in
// http/routes-payments.js). A REGISTRY: one line per kind, so a package adds its kinds (PAY-03 the subscription and
// invoice ones, PAY-06 the off-session ones) without touching the route.
//
// Idempotency is per object, never per event id: a payment is paid once (its status), a refund is counted against the
// total the provider says it gave back, a dispute is written once per id and state, a payout once per id. A notice
// sent twice, out of order or after our own write therefore changes nothing, and no store of event ids is needed.
//
// A handler answers what the route says back to the provider; a domain refusal it throws (unknown payment, amount
// mismatch) is answered 200 so the provider stops retrying; a store or network failure throws a 5xx, and it retries.
import { afterProviderPaid } from '../http/routes-public.js';
import { paymentEnded, paymentRefundedOutside, paymentDisputed, paymentDisputeClosed, payoutRecorded, PAYOUT_ITEMS } from '../commands/payments.js';
import { booked, providerKnown } from '../projections/payments.js';
import { HttpError } from '../http/kit.js';

/** our record of what the provider said: the actor is chained, the provider's name only */
export const PROVIDER = (r) => ({ actor: /** @type {const} */ ({ t: 'provider', id: r.rt.pay.name }), caps: new Set(), meta: r.meta });
const run = (r, cmd, input) => r.rt.engine.run(cmd, input, PROVIDER(r));
/** the payment a checkout notice names (its page), or a charge notice names (refund, dispute, payout line) */
const byRef = (r, ev) => r.s.paymentByRef.get(ev.ref) || null;
const byCharge = (r, ev) => (ev.chargeRef && r.s.paymentByCharge.get(ev.chargeRef)) || null;
const UNKNOWN = { ignored: 'unknown' };
/** how long our own refund may take to reach our records (two writes on two instances) before it counts as lost */
const IN_FLIGHT = 10 * 60000;
/** what our records hold of our own refunds of a payment: refundOnline's, and the till's credit notes that moved money */
function oursBooked(s, py) {
  const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
  let outside = 0;
  for (const id of (sale && sale.refundIds) || []) { const rf = s.refunds.get(id); if (rf && rf.method === 'online' && rf.providerRef === 'outside') outside += rf.amount; }
  return Math.max(0, booked(s, py) - outside);
}

/**
 * What a dispute means beyond its record, by the kind of payment disputed: one entry per payment kind that needs
 * more (PAY-03: a disputed membership payment suspends the membership). A deposit, a QR or a gift card needs nothing
 * more: the owner answers from Caisse with the dossier, and CPT reads s.disputes for the books. A hook runs only when
 * the notice wrote something (opened, changed or closed: `written` says which), never for a repeat; still, a notice
 * may come again after a write whose answer was lost, so a hook stays idempotent per (dispute id, status).
 * @type {{ kind: string, run: (r: any, ev: import('./provider.js').ProviderEvent, payment: any, written: { disputed: boolean, closed: boolean }) => Promise<any> }[]}
 */
export const DISPUTE_HOOKS = [];

/** @type {Record<string, (r: any, ev: import('./provider.js').ProviderEvent) => Promise<any>>} */
export const HANDLERS = {
  paid: async (r, ev) => (byRef(r, ev) ? afterProviderPaid(r, ev, r.rt.pay.name) : UNKNOWN),
  expired: async (r, ev) => { const pid = byRef(r, ev); return pid ? run(r, paymentEnded, { id: pid, status: 'expired' }) : UNKNOWN; },
  failed: async (r, ev) => { const pid = byRef(r, ev); return pid ? run(r, paymentEnded, { id: pid, status: 'failed' }) : UNKNOWN; },
  /**
   * ev.amount is all the charge has given back, ours included. When it says more than we know, the provider is asked
   * which refunds are ours (refund() tags them): one of ours our records do not hold yet, made minutes ago, is our
   * own write still on its way (refundOnline or the till, on another instance), so the notice is answered 503 and the
   * provider sends it again later, when our record has landed. Older, our write failed: the money out is recorded
   * here, as made outside, so it is never invisible. Should a refund recorded here be followed by its credit note
   * (« remboursé hors caisse », providerRef 'outside'), that is one refund, not two (CPT-03 books the money out once).
   */
  refunded: async (r, ev) => {
    const pid = byCharge(r, ev);
    if (!pid) return UNKNOWN;
    const py = r.s.payments.get(pid);
    if (py && ev.amount > providerKnown(r.s, py) && r.rt.pay.listRefunds && ev.chargeRef) {
      const list = await r.rt.pay.listRefunds(ev.chargeRef);
      const ours = list.filter((x) => x.ours);
      if (ours.reduce((t, x) => t + x.amount, 0) > oursBooked(r.s, py) && ours.some((x) => r.now - x.at < IN_FLIGHT)) throw new HttpError(503, 'in_flight', 'Remboursement en cours d’enregistrement.');
    }
    return run(r, paymentRefundedOutside, { id: pid, total: ev.amount, providerRefund: ev.refundRef || ev.ref });
  },
  dispute: async (r, ev) => {
    const pid = byCharge(r, ev);
    if (!pid || !ev.dispute) return UNKNOWN;
    const x = ev.dispute;
    const opened = await run(r, paymentDisputed, { id: pid, dispute: x });
    const closed = x.status !== 'open' ? await run(r, paymentDisputeClosed, { id: pid, disputeId: x.id, status: x.status }) : null;
    const written = { disputed: !opened.already, closed: !!closed && !closed.already };
    const py = r.s.payments.get(pid);
    if (written.disputed || written.closed) for (const h of DISPUTE_HOOKS) if (py && h.kind === py.kind) await h.run(r, ev, py, written);
    return closed || opened;
  },
  // the lines are asked of the provider (a network failure: 5xx, the provider sends the notice again). Not before
  // the provider has reconciled the payout: its lines would be missing, and a payout is recorded once
  payout: async (r, ev) => {
    if (r.s.payouts.has(ev.ref)) return { already: true };
    if (ev.reconciliation === 'in_progress') return { ignored: 'reconciling' };
    const po = await r.rt.pay.listPayout(ev.ref);
    const items = po.items.slice(0, PAYOUT_ITEMS).map((x) => ({ pid: (x.chargeRef && r.s.paymentByCharge.get(x.chargeRef)) || null, type: x.type, amount: x.amount, fee: x.fee, net: x.net, ref: x.ref }));
    return run(r, payoutRecorded, { id: ev.ref, amount: ev.amount ?? po.amount, arrival: ev.arrival || po.arrival, items, truncated: !!po.truncated || po.items.length > PAYOUT_ITEMS });
  }
};
