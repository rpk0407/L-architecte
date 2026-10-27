// @ts-check
// Stripe through its REST API (no SDK: fewer dependencies, faster cold starts).
// Card data never touches this server: clients pay on Stripe Checkout (Apple Pay, Google Pay, cards),
// which keeps the salon in the lightest PCI scope (SAQ A).
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { STRIPE_PAY_MIN } from '../domain/policy.js';

const API = 'https://api.stripe.com/v1';

/** Stripe's form encoding: a[b][c]=v */
export function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) formEncode(v, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? formEncode(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else out.append(key, String(v));
  }
  return out;
}

/**
 * Verify a webhook. Header: "t=1700000000,v1=hex,v1=hex". Rejects replays older than `tolerance` seconds.
 * @returns {boolean}
 */
export function verifyStripeSignature(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  if (!header || !secret) return false;
  let t = 0;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v) sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const want = Buffer.from(createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex'));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === want.length && timingSafeEqual(b, want); });
}

/** Stripe's dispute statuses that still wait for an answer or a decision: 'open' in our words. Every other one ends
 *  it: won (the money comes back), lost (it stays with the client), and anything else (an inquiry closed, a dispute
 *  prevented or the charge refunded, statuses later API versions may add) is 'warning_closed': no money moved. */
const DISPUTE_OPEN = new Set(['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review']);
const disputeStatus = (st, closed) => (st === 'won' || st === 'lost' ? st : !closed && DISPUTE_OPEN.has(st) ? 'open' : 'warning_closed');

/** « Visa •• 4242 », « SEPA •• 1234 »: a card or a mandate as the member and the owner read it, never more than the last four. */
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', cartes_bancaires: 'CB', diners: 'Diners', discover: 'Discover', jcb: 'JCB', unionpay: 'UnionPay' };
export function cardLabel(pm) {
  if (!pm || typeof pm !== 'object') return '';
  if (pm.card) { const b = String(pm.card.display_brand || pm.card.brand || '').toLowerCase(); return ((Object.hasOwn(BRAND, b) ? BRAND[b] : 'Carte') + ' •• ' + String(pm.card.last4 || '')).trim(); }
  if (pm.sepa_debit) return 'SEPA •• ' + String(pm.sepa_debit.last4 || '');
  return '';
}
/** an object Stripe may send expanded or as its id */
const idOf = (x) => (x && typeof x === 'object' ? x.id : x) || undefined;
/** the subscription an invoice bills: under parent since the basil version, on the invoice itself before */
const invoiceSub = (o) => idOf(o.parent && o.parent.subscription_details && o.parent.subscription_details.subscription) || idOf(o.subscription) || undefined;

/**
 * @param {{ secretKey: string, webhookSecret: string, fetchImpl?: typeof fetch }} o webhookSecret: one signing secret, or
 * several separated by commas (a secret being rolled, the test and live endpoints): a signature valid for any passes.
 * @returns {import('./provider.js').PaymentProvider}
 */
export function stripeProvider({ secretKey, webhookSecret, fetchImpl = fetch }) {
  const secrets = String(webhookSecret || '').split(',').map((x) => x.trim()).filter(Boolean);
  /**
   * One call to Stripe. Its own words never reach a client: a card refused says so in French (402 declined), anything
   * else is "indisponible" (502); Stripe's message goes to the log and to e.detail, which only staff routes show.
   */
  async function call(method, path, params, idem) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        authorization: 'Bearer ' + secretKey,
        'content-type': 'application/x-www-form-urlencoded',
        'stripe-version': '2025-03-31.basil',
        ...(idem ? { 'idempotency-key': idem } : {})
      },
      body: params ? formEncode(params).toString() : undefined,
      signal: AbortSignal.timeout(8000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (body && body.error) || {};
      const detail = err.message || 'Stripe ' + res.status;
      console.error('[lx] stripe', method, path, res.status, err.type || '', err.code || '', detail);
      const card = err.type === 'card_error';
      throw Object.assign(new Error(card ? 'Paiement refusé par ta banque. Essaie une autre carte.' : 'Paiement en ligne indisponible, réessaie dans un instant.'), {
        status: card ? 402 : 502, code: card ? 'declined' : 'provider', expose: true, detail, stripe: { status: res.status, type: err.type || '', code: err.code || '', decline: err.decline_code || '', pi: err.payment_intent ? err.payment_intent.id : '' }
      });
    }
    return body;
  }
  const q = (params) => '?' + formEncode(params).toString();
  /** lookup key → Price id, per instance: the same plan at the same price is asked of Stripe once */
  const prices = new Map();
  /** A subscription as it is now: status, the cancellation set, the card's label, our member (metadata.lx). */
  async function getSubscription(sub) {
    const x = await call('GET', '/subscriptions/' + encodeURIComponent(sub) + q({ 'expand[]': 'default_payment_method' }));
    const item = x.items && x.items.data && x.items.data[0];
    const periodEnd = ((item && item.current_period_end) || x.current_period_end || 0) * 1000;
    return {
      id: x.id, status: String(x.status || ''), lx: (x.metadata && x.metadata.lx) || '', customer: idOf(x.customer) || '', card: cardLabel(x.default_payment_method),
      cancelAtPeriodEnd: !!x.cancel_at_period_end, cancelAt: x.cancel_at_period_end ? periodEnd || null : x.cancel_at ? x.cancel_at * 1000 : null,
      pausedUntil: x.pause_collection ? (x.pause_collection.resumes_at || 0) * 1000 || null : null, held: !!x.pause_collection,
      endReason: String((x.cancellation_details && x.cancellation_details.reason) || ''), periodEnd, latestInvoice: idOf(x.latest_invoice) || '',
      trialEnd: (x.trial_end || 0) * 1000 || null
    };
  }
  return {
    name: 'stripe',
    live: /^(sk|rk)_live_/.test(String(secretKey)),
    caps: { checkout: true, refund: true, setup: true, offSession: true, billing: true, portal: true, terminal: false, payouts: true },
    sigHeader: 'stripe-signature',
    /**
     * payMin: how long the booking waits for this payment. The page outlives it by a minute, so a client
     * still on it is never cut off; Stripe takes 30 minutes to 24 hours.
     */
    async createCheckout(o) {
      const expires = Math.floor(Date.now() / 1000) + Math.min(24 * 60 - 1, Math.max(STRIPE_PAY_MIN, (o.payMin || 0) + 1)) * 60;
      const common = { success_url: o.successUrl, cancel_url: o.cancelUrl, client_reference_id: o.id, metadata: { lx: o.id, ...(o.metadata || {}) }, expires_at: expires, locale: 'fr', customer_email: o.email || undefined };
      const params = o.mode === 'setup'
        ? { ...common, mode: 'setup', currency: 'eur', customer_creation: 'always', setup_intent_data: { metadata: { lx: o.id } } }
        : { ...common, mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: o.amount, product_data: { name: o.label } } }], payment_intent_data: { metadata: { lx: o.id }, description: o.label } };
      const s = await call('POST', '/checkout/sessions', params, 'lx-co-' + o.id);
      return { ref: s.id, url: s.url, exp: expires * 1000 };
    },
    /** metadata.lx marks it ours, so its charge.refunded notice is never taken for a refund made in the dashboard */
    async refund(chargeRef, amount, idem) {
      // a membership's invoice paid without a PaymentIntent names its charge (ch_…): Stripe refunds that one by charge
      const target = String(chargeRef).startsWith('ch_') ? { charge: chargeRef } : { payment_intent: chargeRef };
      const r = await call('POST', '/refunds', { ...target, amount, metadata: { lx: idem } }, 'lx-rf-' + idem);
      return { ref: r.id, status: r.status };
    },
    /** A charge's refunds (the last 100), each told ours (refund() above) or not; failed and cancelled ones left out. */
    async listRefunds(chargeRef) {
      const r = await call('GET', '/refunds' + q({ payment_intent: chargeRef, limit: 100 }));
      return (r.data || []).filter((x) => x.status !== 'failed' && x.status !== 'canceled').map((x) => ({ ref: x.id, amount: x.amount, ours: !!(x.metadata && x.metadata.lx), at: (x.created || 0) * 1000 }));
    },
    /**
     * Charge a saved card off-session (PAY-06: a no-show fee on a card guarantee). A card that needs its holder (3-D
     * Secure) or is refused is an answer, not an error: requires_action or failed, with Stripe's code.
     */
    async chargeSaved({ customer, pm, amount, label, idem }) {
      try {
        const pi = await call('POST', '/payment_intents', { amount, currency: 'eur', customer, payment_method: pm, off_session: true, confirm: true, description: label }, 'lx-pi-' + idem);
        const status = pi.status === 'succeeded' ? 'succeeded' : pi.status === 'requires_action' || pi.status === 'requires_confirmation' ? 'requires_action' : 'failed';
        return { ref: pi.id, status, ...(status === 'succeeded' ? {} : { code: pi.status }) };
      } catch (e) {
        const x = /** @type {any} */ (e).stripe;
        if (!x || x.status !== 402) throw e;
        return { ref: x.pi, status: x.code === 'authentication_required' ? 'requires_action' : 'failed', code: x.decline || x.code || 'card_declined' };
      }
    },
    /** The PaymentIntent behind a checkout page (a payment recorded before its charge was known), or the subscription
     *  a membership's checkout started (a member whose first invoice is not paid yet: no subscription in our records). */
    async retrieveCharge(sessionId) {
      const s = await call('GET', '/checkout/sessions/' + encodeURIComponent(sessionId));
      return { chargeRef: idOf(s && s.payment_intent) || null, subscription: idOf(s && s.subscription) || null };
    },

    /* ---------------- Stripe Billing: the monthly membership (PAY-03) ---------------- */

    /**
     * The Price of a plan at a price, found by its lookup key (lx_<planId>_<cents>) or created once: nothing is stored on
     * our side, a price change makes a new Price and members keep theirs (Stripe bills each subscription its own).
     * @param {{ id: string, name: string }} plan @param {number} price
     */
    async ensurePrice(plan, price) {
      const key = 'lx_' + plan.id + '_' + price;
      if (prices.has(key)) return prices.get(key);
      const found = await call('GET', '/prices' + q({ 'lookup_keys[]': key, active: true, limit: 1 }));
      let id = found && found.data && found.data[0] ? found.data[0].id : '';
      // transfer_lookup_key: a Price archived in the dashboard gives its key to the new one instead of refusing it
      if (!id) id = (await call('POST', '/prices', { currency: 'eur', unit_amount: price, recurring: { interval: 'month' }, product_data: { name: plan.name }, lookup_key: key, transfer_lookup_key: true }, 'lx-price-' + plan.id + '-' + price)).id;
      prices.set(key, id);
      return id;
    },
    /**
     * The membership's Checkout page (mode subscription). Not starting now (the client did not tick « commencer tout de
     * suite »): nothing is charged before startAt (trial_end, the day after the 14 days of withdrawal); our words never
     * say « essai ». metadata.lx on the session and the subscription: every later notice finds its member. The page
     * lives 31 minutes like a deposit's, or expiresMin (an offer texted by the salon: up to Stripe's 24 hours). note:
     * the line above Stripe's button (a deferred start: « rien n'est prélevé avant », against Stripe's own trial words).
     * A retry must send Stripe the same parameters under the same key (else Stripe answers 400): the page's end counts
     * from the next 10-minute mark, and the key names the parameters, so a request sent again gets the same page and
     * one whose parameters moved gets a new page, never an error.
     */
    async createSubscription(o) {
      const mark = Math.ceil(Date.now() / 600000) * 600;
      const expires = mark + Math.min(24 * 60 - 11, Math.max(STRIPE_PAY_MIN, o.expiresMin || 0)) * 60;
      const params = {
        mode: 'subscription', line_items: [{ price: o.price, quantity: 1 }], customer_email: o.email || undefined, client_reference_id: o.id,
        metadata: { lx: o.id }, subscription_data: { metadata: { lx: o.id }, ...(o.startNow || !o.startAt ? {} : { trial_end: Math.floor(o.startAt / 1000) }) },
        payment_method_types: o.sepa ? ['card', 'sepa_debit'] : ['card'], locale: 'fr', expires_at: expires, success_url: o.successUrl, cancel_url: o.cancelUrl,
        ...(o.note ? { custom_text: { submit: { message: String(o.note).slice(0, 1200) } } } : {})
      };
      const key = 'lx-sub-' + o.id + '-' + createHash('sha256').update(formEncode(params).toString()).digest('hex').slice(0, 16);
      const s = await call('POST', '/checkout/sessions', params, key);
      return { ref: s.id, url: s.url, exp: expires * 1000 };
    },
    /** A subscription as it is now: every billing notice re-reads it, so one seen twice or out of order says the same. */
    getSubscription,
    /** An invoice as it is now: what it paid (amount_paid), the period it covers, the PaymentIntent a refund goes through. */
    async getInvoice(inv) {
      const x = await call('GET', '/invoices/' + encodeURIComponent(inv) + q({ 'expand[]': 'payments' }));
      const line = x.lines && x.lines.data && x.lines.data[0];
      const pay = x.payments && x.payments.data && x.payments.data.find((p) => p.status === 'paid') || (x.payments && x.payments.data && x.payments.data[0]);
      const chargeRef = (pay && pay.payment && (idOf(pay.payment.payment_intent) || idOf(pay.payment.charge))) || idOf(x.payment_intent) || idOf(x.charge) || '';
      return {
        id: x.id, subscription: invoiceSub(x) || '', status: String(x.status || ''), amount: x.amount_paid || 0, due: x.amount_due || 0,
        periodStart: ((line && line.period && line.period.start) || x.period_start || 0) * 1000, periodEnd: ((line && line.period && line.period.end) || x.period_end || 0) * 1000,
        chargeRef, hostedUrl: x.hosted_invoice_url || '', attempt: x.attempt_count || 0, nextAt: (x.next_payment_attempt || 0) * 1000
      };
    },
    /**
     * now: the subscription ends today (DELETE) and its open invoice is voided, so Smart Retries stop; otherwise it
     * stops at the end of the paid period (cancel_at_period_end). Already cancelled at Stripe: nothing to do.
     */
    async cancelSubscription(sub, { now = false } = {}) {
      const path = '/subscriptions/' + encodeURIComponent(sub);
      if (!now) { await call('POST', path, { cancel_at_period_end: true }); return { ok: true }; }
      try { await call('DELETE', path); }
      catch (e) { if ((await getSubscription(sub)).status !== 'canceled') throw e; }
      const open = await call('GET', '/invoices' + q({ subscription: sub, status: 'open', limit: 10 }));
      for (const x of (open && open.data) || []) await call('POST', '/invoices/' + encodeURIComponent(x.id) + '/void');
      return { ok: true };
    },
    /** A disputed membership: the invoices to come are voided (pause_collection void) until released; nothing else. */
    async holdBilling(sub) { await call('POST', '/subscriptions/' + encodeURIComponent(sub), { pause_collection: { behavior: 'void' } }); return { ok: true }; },
    /** The dispute won: billing goes on as before. */
    async releaseBilling(sub) { await call('POST', '/subscriptions/' + encodeURIComponent(sub), { pause_collection: '' }); return { ok: true }; },
    /** Stripe's hosted page to change the card (its portal on the payment-method flow), back to returnUrl after. */
    async portalUrl(customer, returnUrl) {
      const x = await call('POST', '/billing_portal/sessions', { customer, return_url: returnUrl, flow_data: { type: 'payment_method_update' } });
      return { url: x.url };
    },
    /**
     * What a payout carried: each balance transaction with its fee (Stripe's fees come from Ireland: the salon
     * self-assesses their VAT, CPT-03). The payout's own line is left out (its amount is what reached the bank; the
     * date comes with the payout.paid notice). Up to 5 pages of 100: truncated says lines were left out.
     */
    async listPayout(po) {
      /** @type {import('./provider.js').PayoutItem[]} */
      const items = [];
      let after = '', amount = 0, arrival = 0, truncated = false;
      for (let page = 0; page < 5; page++) {
        const r = await call('GET', '/balance_transactions' + q({ payout: po, limit: 100, 'expand[]': 'data.source', ...(after ? { starting_after: after } : {}) }));
        for (const t of r.data || []) {
          if (t.type === 'payout') { amount -= t.amount; arrival = (t.available_on || 0) * 1000; continue; }
          const src = t.source && typeof t.source === 'object' ? t.source : null;
          items.push({ type: t.type, amount: t.amount, fee: t.fee, net: t.net, chargeRef: src ? src.payment_intent || src.id || null : typeof t.source === 'string' ? t.source : null, ref: t.id });
        }
        if (!r.has_more || !(r.data || []).length) break;
        if (page === 4) truncated = true;
        after = r.data[r.data.length - 1].id;
      }
      return { amount, arrival, items, ...(truncated ? { truncated } : {}) };
    },
    /**
     * Webhook → what happened, in our words. Unknown events are ignored (null).
     * @returns {import('./provider.js').ProviderEvent | null}
     */
    parseWebhook(rawBody, sigHeader) {
      if (!secrets.some((k) => verifyStripeSignature(rawBody, sigHeader, k))) throw Object.assign(new Error('Signature invalide.'), { status: 400, code: 'signature', expose: true });
      const ev = JSON.parse(rawBody);
      const o = ev.data && ev.data.object;
      if (!o) return null;
      const pi = idOf;
      // a membership's checkout (PAY-03): the subscription it started; its invoices say the money
      if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') return { kind: 'sub.started', ref: o.id, subscription: idOf(o.subscription) || '', customer: idOf(o.customer) || '' };
      if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && (o.payment_status === 'paid' || o.mode === 'setup')) {
        return { kind: 'paid', ref: o.id, amount: o.amount_total ?? undefined, chargeRef: pi(o.payment_intent), customer: o.customer || undefined, pm: o.setup_intent || undefined };
      }
      if (ev.type === 'checkout.session.expired') return { kind: 'expired', ref: o.id };
      if (ev.type === 'checkout.session.async_payment_failed') return { kind: 'failed', ref: o.id };
      // a refund from our server or from Stripe's dashboard: amount_refunded is the charge's total so far
      if (ev.type === 'charge.refunded') {
        const last = o.refunds && Array.isArray(o.refunds.data) && o.refunds.data[0];
        return { kind: 'refunded', ref: o.id, chargeRef: pi(o.payment_intent) || o.id, amount: o.amount_refunded, ...(last && last.id ? { refundRef: last.id } : {}) };
      }
      if (ev.type === 'charge.dispute.created' || ev.type === 'charge.dispute.updated' || ev.type === 'charge.dispute.closed') {
        const due = o.evidence_details && o.evidence_details.due_by;
        return { kind: 'dispute', ref: o.id, chargeRef: pi(o.payment_intent) || pi(o.charge), dispute: { id: o.id, amount: o.amount, reason: String(o.reason || ''), status: disputeStatus(o.status, ev.type === 'charge.dispute.closed'), dueBy: due ? due * 1000 : 0 } };
      }
      // an automatic payout's lines can be listed only once Stripe has reconciled it: payout.paid may come before
      // (reconciliation 'in_progress'), payout.reconciliation_completed comes after, with the same payout
      if (ev.type === 'payout.paid' || ev.type === 'payout.reconciliation_completed') {
        return { kind: 'payout', ref: o.id, amount: o.amount, arrival: (o.arrival_date || 0) * 1000, ...(o.reconciliation_status ? { reconciliation: String(o.reconciliation_status) } : {}) };
      }
      // Stripe Billing (PAY-03): each one re-read from Stripe by its handler (payments/billing.js) before anything is written.
      // invoice.created and the others are answered at once (null: 200): Stripe holds an invoice up to 72 h while its
      // invoice.created notice fails
      if (ev.type === 'invoice.paid') return { kind: 'invoice.paid', ref: o.id, invoice: o.id, subscription: invoiceSub(o) || '' };
      if (ev.type === 'invoice.payment_failed') return { kind: 'invoice.failed', ref: o.id, invoice: o.id, subscription: invoiceSub(o) || '', attempt: o.attempt_count || 1, nextAt: (o.next_payment_attempt || 0) * 1000 };
      if (ev.type === 'invoice.payment_action_required') return { kind: 'invoice.action', ref: o.id, invoice: o.id, subscription: invoiceSub(o) || '', url: o.hosted_invoice_url || '' };
      if (/^customer\.subscription\.(updated|deleted|paused|resumed)$/.test(ev.type)) return { kind: 'sub.changed', ref: o.id, subscription: o.id };
      return null;
    }
  };
}
