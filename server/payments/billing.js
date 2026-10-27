// @ts-check
// Stripe Billing seen from our side (PAY-03): the glue between the provider's notices about invoices and subscriptions
// and PAY-02's membership commands. Every notice is re-read from the provider (getInvoice, getSubscription) before a
// command runs, so one seen twice, late or out of order says what is true now; the commands are idempotent per invoice
// and per state, so nothing is written twice. The member is found by its subscription (memberByRef) or by the id we
// put in the subscription's metadata (lx), which also finds a member whose first invoice is not paid yet.
// The provider's calls that follow from the contract live here too: holding the billing of a disputed membership, and
// sending back money no contract covers (a renewal after a cancellation Stripe never heard of, a second subscription).
import { memberPaid, memberFailed, memberSync } from '../commands/memberships.js';
import { billingAlert, memberScheduled } from '../commands/member-billing.js';
import { disputeHeld } from '../domain/membership.js';
import { memberToken, MEMBER_TEXT_TTL } from '../auth/member-token.js';
import { providerLabel } from './labels.js';

const UNKNOWN = { ignored: 'unknown' };

/** The member's page, signed for ttl: what {lien} says in the texts and mails of every member command (ctx.meta.memberLink). */
export function memberMeta(r, ttl = MEMBER_TEXT_TTL) {
  return { ...r.meta, memberLink: (m) => r.origin + '/abo/' + memberToken(r.rt.secret, m.id, r.now + ttl) };
}
/** our record of what the provider said, with the member's link for the texts it sends */
export const BILLING = (r, ttl) => ({ actor: /** @type {const} */ ({ t: 'provider', id: r.rt.pay.name }), caps: new Set(), meta: memberMeta(r, ttl) });
const run = (r, cmd, input) => r.rt.engine.run(cmd, input, BILLING(r));

/** @param {any} s @param {string} sub @param {string} [lx] */
export function memberBySub(s, sub, lx) {
  const id = (sub && s.memberByRef.get(sub)) || '';
  return (id && s.members.get(id)) || (lx && s.members.get(lx)) || null;
}
/**
 * The provider a member's contract runs with, when it is plugged in and has billing; else null: the demo's simulated
 * billing drives itself, and a provider unplugged since (keys removed) is not asked (`gone` says so).
 */
export function billingOf(r, m) {
  if (!m || !m.provider || m.provider === 'simulated') return null;
  const p = r.rt.pay;
  return p && p.name === m.provider && p.caps && p.caps.billing && p.getSubscription ? p : null;
}
/** A contract whose provider is no longer plugged in: nothing here can stop it there. */
const gone = (r, m) => !!m && !!m.provider && m.provider !== 'simulated' && !billingOf(r, m);
/** The subscription behind a member: from its first payment (pii), else from its checkout (a start in 14 days). */
export async function subscriptionOf(r, m) {
  if (m.subscription) return m.subscription;
  const p = billingOf(r, m);
  if (!p || !m.providerRef) return '';
  return (await p.retrieveCharge(m.providerRef)).subscription || '';
}

/**
 * An invoice as it is now. Paid (and not the 0 € one of a start in 14 days): memberPaid, the ticket of the month; one no
 * contract covers any more is sent back and its subscription stopped. Refused while retries go on (or the bank asks to
 * confirm): memberFailed, one text per invoice. Anything else (draft, void) writes nothing.
 * @param {any} r @param {string} invoiceId @param {{ action?: boolean }} [o]
 */
export async function syncInvoice(r, invoiceId, o = {}) {
  const p = r.rt.pay;
  if (!p.getInvoice || !p.getSubscription || !invoiceId) return UNKNOWN;
  const inv = await p.getInvoice(invoiceId);
  if (!inv.subscription) return { ignored: 'not_membership' };
  const sub = await p.getSubscription(inv.subscription);
  const m = memberBySub(r.s, inv.subscription, sub.lx);
  if (!m) return UNKNOWN;
  if (inv.status === 'paid') {
    if (!(inv.amount > 0)) return { ignored: 'free' };
    try {
      return await run(r, memberPaid, {
        id: m.id, invoice: inv.id, amount: inv.amount, periodStart: inv.periodStart, periodEnd: inv.periodEnd,
        // no PaymentIntent (paid another way): the invoice still names the money, a refund is then made at Stripe
        chargeRef: inv.chargeRef || inv.id, customer: sub.customer || undefined, subscription: sub.id, card: sub.card || undefined
      });
    } catch (e) {
      const x = /** @type {any} */ (e);
      if (x && x.status === 409 && (x.code === 'ended' || x.code === 'already')) return sendBack(r, m, inv, sub);
      throw e;
    }
  }
  if (inv.status === 'open' && (inv.attempt > 0 || o.action)) {
    return run(r, memberFailed, { id: m.id, invoice: inv.id, attempt: Math.max(1, inv.attempt || 1), nextAt: inv.nextAt || 0, action: !!o.action, ...(o.action && /^https:\/\//.test(inv.hostedUrl) ? { url: inv.hostedUrl } : {}) });
  }
  return { ignored: 'status' };
}

/**
 * Money no contract covers (the member ended, cancelled before this period, or a second subscription of a file that
 * already has one): given back at once, keyed by the invoice so a retry refunds nothing more, and that subscription
 * stopped, so it never charges again. The owner hears of it.
 */
async function sendBack(r, m, inv, sub) {
  const p = r.rt.pay;
  if (inv.chargeRef) await p.refund(inv.chargeRef, inv.amount, 'orphan-' + inv.id);
  if (sub.status !== 'canceled' && p.cancelSubscription) await p.cancelSubscription(sub.id, { now: true });
  await run(r, billingAlert, { kind: 'orphan', memberId: m.id, amount: inv.amount, invoice: inv.id });
  return { ignored: 'sent_back' };
}

/**
 * A subscription as it is now, into memberSync: a cancellation set in Stripe's portal gets the acknowledgement, an end
 * ends the member. Stripe ends a subscription « canceled » whatever the cause: after its retries (cancellation_details
 * payment_failed, or our record of a refused renewal without the client's own request) it is an end for want of payment.
 * @param {any} r @param {string} subId
 */
export async function syncSubscription(r, subId) {
  const p = r.rt.pay;
  if (!p.getSubscription || !subId) return UNKNOWN;
  const sub = await p.getSubscription(subId);
  const m = memberBySub(r.s, subId, sub.lx);
  if (!m) return UNKNOWN;
  let status = sub.status;
  if (status === 'canceled' && m.activatedAt && (sub.endReason === 'payment_failed' || (m.pastDue && sub.endReason !== 'cancellation_requested'))) status = 'unpaid';
  // a start in 14 days: the checkout is done, nothing is paid yet; the client gets the contract's confirmation now
  if (status === 'trialing' && !m.activatedAt && !m.ended) await run(r, memberScheduled, { id: m.id, ...(sub.trialEnd ? { startAt: sub.trialEnd } : {}) });
  return run(r, memberSync, { id: m.id, snapshot: { status, ...(sub.cancelAt ? { cancelAt: sub.cancelAt } : {}) } });
}

/** The Comptoir's « re-read Stripe now » and the list's catch-up: the subscription, then its latest invoice. @param {any} r @param {any} m */
export async function syncMember(r, m) {
  const p = billingOf(r, m);
  if (!p) return { ignored: 'no_billing' };
  const sub = await subscriptionOf(r, m);
  if (!sub) return { ignored: 'no_subscription' };
  const res = await syncSubscription(r, sub);
  const latest = (await p.getSubscription(sub)).latestInvoice;
  if (latest) await syncInvoice(r, latest);
  return res;
}

/**
 * The provider's side of a cancellation the commands recorded: at the end of the paid period, or now (the subscription
 * deleted, its open invoice voided). A failure is the answer's, never the client's: the cancellation stands, the
 * Comptoir's sync and the next invoice's send-back put Stripe right.
 * @param {any} r @param {any} m @param {{ now: boolean }} o @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function cancelAtProvider(r, m, o) {
  if (gone(r, m)) return { ok: false, error: providerLabel(m.provider) + ' n’est plus branché : résilie-le depuis son tableau de bord' };
  const p = billingOf(r, m);
  if (!p || !p.cancelSubscription) return { ok: true };
  try {
    const sub = await subscriptionOf(r, m);
    if (sub) await p.cancelSubscription(sub, { now: o.now });
    return { ok: true };
  } catch (e) {
    const why = (e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message)) || 'erreur';
    console.error('[lx] membership cancel at provider failed', m.id, why);
    return { ok: false, error: why };
  }
}

/**
 * DISPUTE_HOOKS' membership entry (payments/handlers.js): a month disputed suspends the contract. Open: Stripe voids
 * the invoices to come (holdBilling), the member reads unpaid (the projection folds the dispute) and the owner is asked
 * « résilier ? ». Lost: the owner makes the credit note of that month. Won (or closed without money moving): billing
 * goes on, unless another dispute still holds it or the contract is ending. Run on every notice of the dispute: each
 * call is idempotent, so a provider call that failed is tried again with the provider's retry.
 * @param {any} r @param {any} ev @param {any} py
 */
export async function membershipDispute(r, ev, py) {
  const m = py.memberId ? r.s.members.get(py.memberId) : null;
  const d = ev.dispute ? r.s.disputes.get(ev.dispute.id) : null;
  if (!m || !d) return;
  const p = billingOf(r, m);
  const sub = p ? await subscriptionOf(r, m) : '';
  const runs = !m.ended && !m.withdrawn;
  if (d.status === 'open') {
    if (p && p.holdBilling && sub && runs) await p.holdBilling(sub);
    await run(r, billingAlert, { kind: 'memberDispute', memberId: m.id, paymentId: py.id, disputeId: d.id });
  } else if (d.status === 'lost') {
    await run(r, billingAlert, { kind: 'memberDisputeLost', memberId: m.id, paymentId: py.id, disputeId: d.id });
  } else if (p && p.releaseBilling && sub && runs && !m.cancel && !disputeHeld(m)) {
    await p.releaseBilling(sub);
  }
}

/** The handlers' lines for the billing kinds (payments/handlers.js HANDLERS). */
export const BILLING_HANDLERS = {
  'sub.started': async (r, ev) => syncSubscription(r, ev.subscription),
  'sub.changed': async (r, ev) => syncSubscription(r, ev.subscription),
  'invoice.paid': async (r, ev) => syncInvoice(r, ev.invoice),
  'invoice.failed': async (r, ev) => syncInvoice(r, ev.invoice),
  'invoice.action': async (r, ev) => syncInvoice(r, ev.invoice, { action: true })
};
