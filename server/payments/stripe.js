// @ts-check
// Stripe through its REST API (no SDK: fewer dependencies, faster cold starts).
// Card data never touches this server: clients pay on Stripe Checkout (Apple Pay, Google Pay, cards),
// which keeps the salon in the lightest PCI scope (SAQ A).
import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function stripeProvider({ secretKey, webhookSecret, fetchImpl = fetch }) {
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
      const msg = body && body.error && body.error.message ? body.error.message : 'Stripe ' + res.status;
      throw Object.assign(new Error('Paiement en ligne indisponible : ' + msg), { status: 502, code: 'provider', expose: true });
    }
    return body;
  }
  return {
    name: 'stripe',
    live: String(secretKey).startsWith('sk_live_'),
    /**
     * @param {{ id: string, amount: number, label: string, successUrl: string, cancelUrl: string, email?: string, mode?: 'payment'|'setup', metadata?: Record<string,string> }} o
     */
    async createCheckout(o) {
      const expires = Math.floor(Date.now() / 1000) + 31 * 60;
      const common = { success_url: o.successUrl, cancel_url: o.cancelUrl, client_reference_id: o.id, metadata: { lx: o.id, ...(o.metadata || {}) }, expires_at: expires, locale: 'fr', customer_email: o.email || undefined };
      const params = o.mode === 'setup'
        ? { ...common, mode: 'setup', currency: 'eur', customer_creation: 'always', setup_intent_data: { metadata: { lx: o.id } } }
        : { ...common, mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: o.amount, product_data: { name: o.label } } }], payment_intent_data: { metadata: { lx: o.id }, description: o.label } };
      const s = await call('POST', '/checkout/sessions', params, 'lx-co-' + o.id);
      return { ref: s.id, url: s.url, exp: expires * 1000 };
    },
    async refund(chargeRef, amount, idem) {
      const r = await call('POST', '/refunds', { payment_intent: chargeRef, amount }, 'lx-rf-' + idem);
      return { ref: r.id, status: r.status };
    },
    /** Charge a saved card off-session (no-show fee on a card guarantee). */
    async chargeSaved({ customer, pm, amount, label, idem }) {
      const pi = await call('POST', '/payment_intents', { amount, currency: 'eur', customer, payment_method: pm, off_session: true, confirm: true, description: label }, 'lx-pi-' + idem);
      return { ref: pi.id, status: pi.status };
    },
    /**
     * Webhook → what happened, in our words. Unknown events are ignored.
     * @returns {{ kind: 'paid'|'expired'|'failed', ref: string, amount?: number, chargeRef?: string, pm?: string, customer?: string } | null}
     */
    parseWebhook(rawBody, sigHeader) {
      if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) throw Object.assign(new Error('Signature invalide.'), { status: 400, code: 'signature', expose: true });
      const ev = JSON.parse(rawBody);
      const o = ev.data && ev.data.object;
      if (!o) return null;
      if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && (o.payment_status === 'paid' || o.mode === 'setup')) {
        return { kind: 'paid', ref: o.id, amount: o.amount_total ?? undefined, chargeRef: o.payment_intent || undefined, customer: o.customer || undefined, pm: o.setup_intent || undefined };
      }
      if (ev.type === 'checkout.session.expired') return { kind: 'expired', ref: o.id };
      if (ev.type === 'checkout.session.async_payment_failed') return { kind: 'failed', ref: o.id };
      return null;
    }
  };
}
