// @ts-check
// Online payments (deposits, QR at the chair, card guarantees, gift cards bought on /carte-cadeau). The provider call
// happens outside the decision (it is a network side effect); these handlers only record what the provider said.
import { fail } from '../core/engine.js';
import { getAppt, getClient } from './common.js';
import { str, int, opt, obj, oneOf, either, parse } from '../lib/validate.js';
import { normPhone, isEmail, capFirst } from '../lib/util.js';
import { instantOf, isDay } from '../../shared/dates.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { mailConfirmation, mailOwner } from '../domain/mails.js';
import { payDeadline } from '../domain/policy.js';
import { busyIntervals } from '../domain/availability.js';
import { providerKnown } from '../projections/payments.js';
import { advanceRate } from '../domain/ledger.js';

const KINDS = new Set(['deposit', 'qr', 'guarantee', 'giftcard']);

/* ---------------- a gift card ordered online ---------------- */

export const GIFT_MIN = 2000, GIFT_MAX = 20000;
/** How far ahead the text may be planned: a December order for the 24th, not next year's birthday. */
export const GIFT_SEND_DAYS = 120;
const phoneIn = str({ min: 6, max: 32 });
const giftSchema = obj({
  amount: int({ min: GIFT_MIN, max: GIFT_MAX }),
  buyer: obj({ first: str({ min: 1, max: 40 }), phone: phoneIn, email: opt(str({ max: 120, lower: true })) }),
  recipient: opt(obj({ first: opt(str({ max: 40 })), phone: opt(phoneIn) })),
  message: opt(str({ max: 120 })),
  delivery: oneOf(/** @type {const} */ (['buyer', 'recipient'])),
  // an instant, or the salon's wall clock as /carte-cadeau sends it ('2026-12-24T19:00', Paris time)
  sendAt: opt(either([int({ min: 0, max: 8.64e15 }), str({ pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, max: 16 })]))
});

/**
 * What the buyer typed on /carte-cadeau, checked and normalised: the route runs it before any provider call, the
 * command again. sendAt is 0 for "now"; a moment already past (a slow payment) also means now.
 * @param {any} input @param {number} now
 */
export function giftOrder(input, now) {
  const x = parse(giftSchema, input || {});
  const phone = (v, who) => { const p = normPhone(v); if (!p) fail(400, 'invalid', who + ' : numéro de téléphone invalide.'); return p; };
  const buyer = { first: capFirst(x.buyer.first), phone: phone(x.buyer.phone, 'Ton numéro'), email: x.buyer.email || '' };
  if (buyer.email && !isEmail(buyer.email)) fail(400, 'invalid', 'E-mail invalide.');
  const recipient = { first: capFirst((x.recipient && x.recipient.first) || ''), phone: x.recipient && x.recipient.phone ? phone(x.recipient.phone, 'Son numéro') : '' };
  if (x.delivery === 'recipient' && !recipient.phone) fail(400, 'invalid', 'Donne son numéro pour lui envoyer la carte par SMS.');
  let sendAt = 0;
  if (x.sendAt != null) {
    const s = String(x.sendAt);
    const at = typeof x.sendAt === 'number' ? x.sendAt : isDay(s.slice(0, 10)) && +s.slice(11, 13) < 24 && +s.slice(14) < 60 ? instantOf(s.slice(0, 10), +s.slice(11, 13) * 60 + +s.slice(14)) : NaN;
    if (!Number.isFinite(at)) fail(400, 'invalid', 'Date d’envoi invalide.');
    if (at > now + GIFT_SEND_DAYS * 86400000) fail(400, 'invalid', 'L’envoi se programme jusqu’à ' + GIFT_SEND_DAYS + ' jours à l’avance.');
    sendAt = at > now + 60000 ? at : 0;
  }
  return { amount: x.amount, buyer, recipient, message: x.message || '', delivery: x.delivery, sendAt };
}

export const createPayment = {
  run(s, input, ctx) {
    if (!KINDS.has(input.kind)) fail(400, 'invalid', 'Type de paiement inconnu.');
    if (input.kind === 'qr' || input.kind === 'giftcard') ctx.need('sale.create');
    if (!Number.isInteger(input.amount) || input.amount < 50 || input.amount > 1000000) fail(400, 'invalid', 'Montant invalide.');
    if (input.apptId) getAppt(s, input.apptId);
    /** @type {any} */
    let gift = null;
    if (input.kind === 'giftcard') {
      const o = giftOrder(input.order, ctx.now);
      if (o.amount !== input.amount) fail(400, 'invalid', 'Montant invalide.');
      if (!s.settings.payments.giftcard) fail(409, 'off', 'Les cartes cadeaux sont désactivées.');
      // no file before the money is in (an abandoned checkout leaves none): the id of the one this number has, or the id
      // the buyer's new file will take once paid (sellGiftcardOnline), so an erasure of that file finds the order's data
      const known = s.clientByPhone.get(o.buyer.phone);
      const cid = known && s.clients.has(known) ? known : ctx.id('cl');
      gift = { cid, data: { delivery: o.delivery, sendAt: o.sendAt }, pii: { order: { buyer: o.buyer, recipient: o.recipient, message: o.message } } };
    }
    // the file it is for (PAY-01): the appointment's client, the gift card's buyer, or the member's file a caller names;
    // a QR at the till has none
    const appt = input.apptId ? s.appts.get(input.apptId) : null;
    const cid = gift ? gift.cid : input.cid && s.clients.has(input.cid) ? input.cid : (appt && appt.clientId) || undefined;
    ctx.emit('payment.created', {
      id: input.id, kind: input.kind, amount: input.amount, provider: input.provider, providerRef: input.providerRef || null,
      url: input.url || null, apptId: input.apptId || null, exp: input.exp || ctx.now + 30 * 60000, label: String(input.label || '').slice(0, 80),
      // names and numbers travel in pii (read back from the journal at fulfilment, routes-giftshop.js orderOf)
      ...(cid ? { cid } : {}), ...(gift ? { gift: gift.data } : {})
    }, gift ? gift.pii : undefined);
    return { id: input.id, ...(gift ? { cid: gift.cid } : {}) };
  }
};

/** Called by the webhook (or the simulated checkout). Idempotent: a second notification is ignored. */
export const paymentSucceeded = {
  run(s, input, ctx) {
    const pid = input.id || s.paymentByRef.get(input.providerRef || '');
    const py = s.payments.get(pid || '');
    if (!py) fail(404, 'not_found', 'Paiement inconnu.');
    if (py.status === 'paid') return { ok: true, already: true };
    if (input.amount != null && input.amount !== py.amount && py.kind !== 'guarantee') fail(409, 'amount', 'Montant reçu différent du montant attendu.');
    // the provider's customer and card ids tie a person to a card: in pii under the file, so its erasure takes them;
    // with no file (a QR at the till) they are not kept at all. The charge ref stays in data: reconciliation needs it
    const ap = py.apptId ? s.appts.get(py.apptId) : null;
    const cid = py.cid || (ap && ap.clientId) || undefined;
    const ids = cid && (input.customer || input.pm) ? { ...(input.customer ? { customer: String(input.customer) } : {}), ...(input.pm ? { pm: String(input.pm) } : {}) } : undefined;
    // the VAT rate it carries if it stays an advance, frozen now: a later catalogue edit never rewrites a month exported
    const vat = py.kind === 'guarantee' ? null : advanceRate(s, py);
    ctx.emit('payment.succeeded', { id: py.id, chargeRef: input.chargeRef || null, ...(cid ? { cid } : {}), ...(vat != null ? { vat } : {}) }, ids);
    if (py.apptId && (py.kind === 'deposit' || py.kind === 'guarantee')) {
      const a = getAppt(s, py.apptId);
      // paid after its deadline (the tick has not run yet): the slot may already belong to someone else
      if (a.status === 'pending' && payDeadline(s, a) < ctx.now && busyIntervals(s, a.staffId, a.day, { now: ctx.now, ignoreAppt: a.id }).some(([x, y]) => x < a.start + a.dur && a.start < y)) {
        ctx.emit('appt.cancelled', { id: a.id, by: 'system', reason: 'Acompte réglé trop tard', cid: a.clientId || undefined });
        return { ok: true, late: true };
      }
      if (a.status === 'pending') {
        ctx.emit('appt.confirmed', { id: a.id, cid: a.clientId || undefined });
        const c = a.clientId ? getClient(s, a.clientId) : null;
        if (c && c.phone && a.sms && s.settings.messages.confirmation) {
          queueMessage(s, ctx, { key: 'conf_' + a.id + '_' + a.moves, template: 'confirmation', to: c.phone, cid: c.id, apptId: a.id, vars: apptVars(s, a, ctx.meta.linkFor) });
        }
        // the e-mail with the calendar file, and the owner's alert of an online booking, wait for the deposit (WP-02)
        const paid = { ...a, status: 'booked', deposit: a.deposit && py.kind === 'deposit' ? { ...a.deposit, paid: py.amount } : a.deposit };
        if (c) mailConfirmation(s, ctx, paid, { to: c.email, first: c.first, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '' });
        if (a.source === 'site') mailOwner(s, ctx, paid, 'booked');
      } else if (a.status === 'cancelled') {
        // paid after the booking expired: the API refunds it, we only keep the record
        return { ok: true, late: true };
      }
    }
    return { ok: true };
  }
};

/** amount (refunded only): a part given back, which keeps the rest paid; without it the whole payment. */
export const paymentEnded = {
  run(s, input, ctx) {
    const py = s.payments.get(input.id);
    if (!py) fail(404, 'not_found', 'Paiement inconnu.');
    const type = { failed: 'payment.failed', expired: 'payment.expired', refunded: 'payment.refunded' }[input.status];
    if (!type) fail(400, 'invalid', 'Statut inconnu.');
    if (py.status === input.status) return { ok: true };
    if (input.status !== 'refunded' && py.status !== 'pending') return { ok: true };
    const part = input.status === 'refunded' && input.amount != null ? input.amount : null;
    if (part != null && (!Number.isInteger(part) || part < 1 || part > py.amount - (py.refunded || 0))) fail(400, 'invalid', 'Montant de remboursement invalide.');
    ctx.emit(type, { id: py.id, reason: String(input.reason || '').slice(0, 120), ...(part != null && part < py.amount ? { amount: part } : {}) });
    return { ok: true };
  }
};

/* ---------------- what the provider says after the checkout (PAY-01, payments/handlers.js) ---------------- */

const PROVIDER_REF = str({ max: 80 });

/**
 * The provider has given back more of a payment than our records say (a refund from its dashboard, or the till's
 * credit note that failed after the provider refunded): recorded, so money out is never invisible. total: what the
 * provider says is refunded in all, so the same notice twice, or one that only repeats our own refund, writes nothing.
 */
export const paymentRefundedOutside = {
  run(s, input, ctx) {
    const py = s.payments.get(input.id || s.paymentByCharge.get(input.chargeRef || '') || '');
    if (!py) fail(404, 'not_found', 'Paiement inconnu.');
    if (!Number.isInteger(input.total) || input.total < 0) fail(400, 'invalid', 'Montant invalide.');
    const total = Math.min(py.amount, input.total);
    const known = providerKnown(s, py);
    if (total <= known) return { ok: true, already: true };
    ctx.emit('payment.refundedOutside', { id: py.id, amount: total - known, total, providerRefund: input.providerRefund ? PROVIDER_REF.parse(String(input.providerRefund).slice(0, 80), 'providerRefund') : null });
    return { ok: true, amount: total - known };
  }
};

const disputeSchema = obj({ id: str({ min: 1, max: 80 }), amount: int({ min: 0, max: 10000000 }), reason: opt(str({ max: 60 })), status: opt(str({ max: 30 })), dueBy: opt(int({ min: 0, max: 8.64e15 })) });
/**
 * A chargeback opened on a payment, or changed (amount, reason, answer date). One per dispute id: the same notice
 * again writes nothing. A notice of a closed dispute never seen open records it first (paymentDisputeClosed follows).
 */
export const paymentDisputed = {
  run(s, input, ctx) {
    const py = s.payments.get(input.id || '');
    if (!py) fail(404, 'not_found', 'Paiement inconnu.');
    const x = parse(disputeSchema, input.dispute || {});
    const cur = s.disputes.get(x.id);
    if (cur && cur.pid !== py.id) fail(409, 'invalid', 'Ce litige concerne un autre paiement.');
    const dispute = { id: x.id, amount: x.amount, reason: x.reason || '', dueBy: x.dueBy || 0 };
    if (cur && (cur.status !== 'open' || (cur.amount === dispute.amount && cur.reason === dispute.reason && cur.dueBy === dispute.dueBy))) return { ok: true, already: true };
    ctx.emit('payment.disputed', { id: py.id, dispute });
    return { ok: true };
  }
};
export const DISPUTE_ENDS = /** @type {const} */ (['won', 'lost', 'warning_closed']);
export const paymentDisputeClosed = {
  run(s, input, ctx) {
    const x = s.disputes.get(input.disputeId || '');
    if (!x || x.pid !== input.id) fail(404, 'not_found', 'Litige inconnu.');
    if (!DISPUTE_ENDS.includes(input.status)) fail(400, 'invalid', 'Issue du litige inconnue.');
    if (x.status !== 'open') return { ok: true, already: true };
    ctx.emit('payment.disputeClosed', { id: x.pid, disputeId: x.id, status: input.status });
    return { ok: true };
  }
};

/** A payout's lines, at most this many in its event (a salon's day is a few dozen). */
export const PAYOUT_ITEMS = 500;
const payoutItem = obj({ pid: opt(str({ max: 40 })), type: str({ min: 1, max: 40 }), amount: int({ min: -100000000, max: 100000000 }), fee: int({ min: -10000000, max: 10000000 }), net: int({ min: -100000000, max: 100000000 }), ref: opt(str({ max: 80 })) });
/**
 * Money sent to the bank, with what it carried: each line's fee is the provider's (CPT-03 books them and the
 * self-assessed VAT); pid is our payment when the charge is ours, null otherwise. Once per payout id. truncated: the
 * provider had more lines than were read (5 pages) or kept (PAYOUT_ITEMS): gross and fee then cover only these.
 */
export const payoutRecorded = {
  run(s, input, ctx) {
    const id = str({ min: 3, max: 80 }).parse(input.id, 'id');
    if (s.payouts.has(id)) return { ok: true, already: true };
    const items = (Array.isArray(input.items) ? input.items : []).slice(0, PAYOUT_ITEMS).map((x, i) => {
      const it = payoutItem.parse(x, 'items.' + i);
      return { pid: it.pid && s.payments.has(it.pid) ? it.pid : null, type: it.type, amount: it.amount, fee: it.fee, net: it.net, ...(it.ref ? { ref: it.ref } : {}) };
    });
    const amount = int({ min: -100000000, max: 100000000 }).parse(input.amount, 'amount');
    const arrival = int({ min: 0, max: 8.64e15 }).parse(input.arrival || 0, 'arrival');
    const gross = items.reduce((t, x) => t + x.amount, 0), fee = items.reduce((t, x) => t + x.fee, 0);
    ctx.emit('payout.recorded', { id, amount, gross, fee, arrival, items, ...(input.truncated === true ? { truncated: true } : {}) });
    return { ok: true, items: items.length };
  }
};
