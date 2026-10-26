// @ts-check
// Online payments (deposits, QR at the chair, card guarantees). The provider call happens outside the
// decision (it is a network side effect); these handlers only record what the provider said.
import { fail } from '../core/engine.js';
import { getAppt, getClient } from './common.js';
import { queueMessage, apptVars } from '../domain/messages.js';

const KINDS = new Set(['deposit', 'qr', 'guarantee']);

export const createPayment = {
  run(s, input, ctx) {
    if (!KINDS.has(input.kind)) fail(400, 'invalid', 'Type de paiement inconnu.');
    if (input.kind === 'qr') ctx.need('sale.create');
    if (!Number.isInteger(input.amount) || input.amount < 50 || input.amount > 1000000) fail(400, 'invalid', 'Montant invalide.');
    if (input.apptId) getAppt(s, input.apptId);
    ctx.emit('payment.created', {
      id: input.id, kind: input.kind, amount: input.amount, provider: input.provider, providerRef: input.providerRef || null,
      url: input.url || null, apptId: input.apptId || null, exp: input.exp || ctx.now + 30 * 60000, label: String(input.label || '').slice(0, 80)
    });
    return { id: input.id };
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
    ctx.emit('payment.succeeded', { id: py.id, pm: input.pm || null, customer: input.customer || null, chargeRef: input.chargeRef || null });
    if (py.apptId && (py.kind === 'deposit' || py.kind === 'guarantee')) {
      const a = getAppt(s, py.apptId);
      if (a.status === 'pending') {
        ctx.emit('appt.confirmed', { id: a.id, cid: a.clientId || undefined });
        const c = a.clientId ? getClient(s, a.clientId) : null;
        if (c && c.phone && a.sms && s.settings.messages.confirmation) {
          queueMessage(s, ctx, { key: 'conf_' + a.id + '_' + a.moves, template: 'confirmation', to: c.phone, cid: c.id, apptId: a.id, vars: apptVars(s, a, ctx.meta.linkFor) });
        }
      } else if (a.status === 'cancelled') {
        // paid after the booking expired: the API refunds it, we only keep the record
        return { ok: true, late: true };
      }
    }
    return { ok: true };
  }
};

export const paymentEnded = {
  run(s, input, ctx) {
    const py = s.payments.get(input.id);
    if (!py) fail(404, 'not_found', 'Paiement inconnu.');
    const type = { failed: 'payment.failed', expired: 'payment.expired', refunded: 'payment.refunded' }[input.status];
    if (!type) fail(400, 'invalid', 'Statut inconnu.');
    if (py.status === input.status) return { ok: true };
    if (input.status !== 'refunded' && py.status !== 'pending') return { ok: true };
    ctx.emit(type, { id: py.id, reason: String(input.reason || '').slice(0, 120) });
    return { ok: true };
  }
};
