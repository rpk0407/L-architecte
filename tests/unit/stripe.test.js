import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, formEncode, stripeProvider } from '../../server/payments/stripe.js';

const secret = 'whsec_test_123';
const sign = (body, t) => 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');

test('a correctly signed webhook verifies; altered, replayed or foreign ones do not', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  const now = 1_800_000_000;
  assert.equal(verifyStripeSignature(body, sign(body, now), secret, now), true);
  assert.equal(verifyStripeSignature(body + ' ', sign(body, now), secret, now), false);
  assert.equal(verifyStripeSignature(body, sign(body, now - 600), secret, now), false, 'older than 5 minutes');
  assert.equal(verifyStripeSignature(body, sign(body, now), 'whsec_other', now), false);
  assert.equal(verifyStripeSignature(body, '', secret, now), false);
});

test('checkout sessions are form-encoded the way Stripe expects', () => {
  const f = formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 1800 } }], metadata: { lx: 'py_1' } });
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '1800');
  assert.equal(f.get('metadata[lx]'), 'py_1');
});

test('the provider maps a paid session to our words', async () => {
  const p = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: secret, fetchImpl: async () => new Response('{}') });
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 1800, payment_intent: 'pi_1' } } });
  assert.deepEqual(p.parseWebhook(body, sign(body, now)), { kind: 'paid', ref: 'cs_1', amount: 1800, chargeRef: 'pi_1', customer: undefined, pm: undefined });
  assert.throws(() => p.parseWebhook(body, 't=1,v1=00'), /Signature/);
});

test('a checkout request carries an idempotency key and never the card', async () => {
  let seen;
  const p = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: secret, fetchImpl: async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ id: 'cs_9', url: 'https://checkout.stripe.com/c/pay/cs_9' })); } });
  const r = await p.createCheckout({ id: 'py_9', amount: 2500, label: 'Acompte', successUrl: 'https://x/ok', cancelUrl: 'https://x/ko' });
  assert.equal(r.url, 'https://checkout.stripe.com/c/pay/cs_9');
  assert.equal(seen.init.headers['idempotency-key'], 'lx-co-py_9');
  assert.match(seen.url, /\/v1\/checkout\/sessions$/);
});
