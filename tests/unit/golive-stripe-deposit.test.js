// Go-live audit · the deposit at booking with Stripe plugged in, over HTTP, on a fake network (no request ever reaches
// Stripe: the provider gets a fetch of our own, and the real one throws). What a client and Stripe can do in any order:
// a deposit computed by the server whatever the browser sends, in whole cents and in euros; a notice with a bad or old
// signature; the same notice twice, or again after the refund; a payment landing after the hold expired; a double tap
// on « Réserver »; a tab closed in the middle; a cancellation inside and outside the delay; Stripe down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { depositFor } from '../../server/domain/policy.js';
import { browser } from '../api/client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const LATER = addDays(DAY, 2);
const WH = 'whsec_golive';
const CRON = 'cron-secret-0123456789';

/** Stripe on a fake network: every call logged; refunds replayed by idempotency key as Stripe does; `down` fails the next call. */
function fakeStripe(now) {
  const log = [];
  const state = { down: false, n: 0, byKey: new Map() };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.stripe.com');
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const key = init.headers['idempotency-key'] || null;
    log.push({ method: init.method, path, body, idem: key });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (state.down) { state.down = false; return new Response(JSON.stringify({ error: { type: 'api_error', message: 'Stripe is down' } }), { status: 503 }); }
    if (key && state.byKey.has(key)) return ok(state.byKey.get(key));
    let out = null;
    if (init.method === 'POST' && path === '/checkout/sessions') { state.n++; out = { id: 'cs_' + state.n, url: 'https://checkout.stripe.com/c/cs_' + state.n }; }
    else if (init.method === 'GET' && path.startsWith('/checkout/sessions/')) return ok({ id: path.split('/').pop(), payment_intent: 'pi_' + path.split('/').pop().slice(3) });
    else if (init.method === 'POST' && path === '/refunds') out = { id: 're_' + log.length, status: 'succeeded', amount: Number(body.amount), payment_intent: body.payment_intent, metadata: { lx: body['metadata[lx]'] }, created: Math.floor(now() / 1000) };
    else if (init.method === 'GET' && path === '/refunds') return ok({ data: [...state.byKey.values()].filter((x) => x.payment_intent === u.searchParams.get('payment_intent')), has_more: false });
    if (!out) return new Response(JSON.stringify({ error: { message: 'No such route' } }), { status: 404 });
    if (key) state.byKey.set(key, out);
    return ok(out);
  };
  return { log, state, provider: stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH, fetchImpl }) };
}
const sign = (body, secret = WH, t = Math.floor(Date.now() / 1000)) => 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');

async function withStripe(t, { hour = 10 } = {}) {
  // the real network is closed for the whole test: only the fake Stripe above answers
  const real = globalThis.fetch;
  const leaked = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { leaked.push(String(url && url.url || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; assert.deepEqual(leaked, [], 'a request left the server'); });
  const clock = { now: at(DAY, hour) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', CRON_SECRET: CRON, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const fake = fakeStripe(() => clock.now);
  rt.pay = fake.provider;
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) });
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = {};
  ids.ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  ids.odd = (await rt.engine.run(addService, { name: 'Couleur', category: 'Couleur', price: 5590, dur: 60, slug: 'co' }, asOwner())).id;
  const s = () => rt.engine.state;
  const hook = (ev, o = {}) => {
    const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), ...ev });
    return browser(rt).raw('POST', '/api/pay/stripe/webhook', body, { 'stripe-signature': o.signature ?? sign(body, o.secret, o.t), 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
  };
  const book = async (extra = {}, headers) => {
    const r = await browser(rt).post('/api/public/bookings', { serviceIds: [ids.tr], staffId: ids.ali, day: LATER, start: 600, first: 'Léon', phone: '0611223344', ...extra }, headers);
    const appt = r.status === 201 ? s().appts.get(s().apptByCode.get(r.json.code)) : null;
    const py = appt ? [...s().payments.values()].find((p) => p.apptId === appt.id) : null;
    return { r, appt, py };
  };
  const paid = (py, o = {}) => ({ type: 'checkout.session.completed', data: { object: { id: py.providerRef, payment_status: 'paid', amount_total: o.amount ?? py.amount, currency: 'eur', payment_intent: o.pi || 'pi_' + py.providerRef.slice(3) } } });
  const tick = async () => assert.equal((await browser(rt).get('/api/cron/tick', { authorization: 'Bearer ' + CRON })).status, 200);
  const count = (type) => rt.engine.journal.filter((e) => e.type === type).length;
  return { rt, clock, owner, fake, ids, s, hook, book, paid, tick, count, asOwner };
}

test('the deposit is the server’s: whole euros in cents, in EUR, whatever the browser sends', async (t) => {
  const x = await withStripe(t);
  // the site announces it, and the booking asks exactly that
  const salon = (await browser(x.rt).get('/api/public/salon')).json;
  assert.deepEqual(salon.payments, { provider: 'stripe', live: true });
  assert.equal(salon.deposits.mode, 'threshold');
  assert.equal(salon.deposits.percent, 30);
  // a browser that sends its own amounts gets the server's
  const { r, appt, py } = await x.book({ serviceIds: [x.ids.odd], deposit: 1, amount: 1, price: 1, status: 'booked', paid: true });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.deposit, 1700, '30 % of 55,90 € is 16,77 €: asked as 17 €');
  assert.equal(appt.price, 5590);
  assert.equal(appt.status, 'pending');
  assert.equal(py.amount, 1700);
  const co = x.fake.log.find((c) => c.path === '/checkout/sessions');
  assert.equal(co.body['line_items[0][price_data][unit_amount]'], '1700');
  assert.equal(co.body['line_items[0][price_data][currency]'], 'eur');
  assert.equal(co.body.mode, 'payment');
  assert.equal(co.idem, 'lx-co-' + py.id, 'one checkout page per payment, however often the request is sent');
  assert.match(r.json.payment.url, /^https:\/\/checkout\.stripe\.com\//);
  // Stripe saying another amount was paid confirms nothing
  const wrong = await x.hook(x.paid(py, { amount: 100 }));
  assert.equal(wrong.status, 200);
  assert.equal(wrong.json.ignored, 'amount');
  assert.equal(x.s().appts.get(appt.id).status, 'pending');
  assert.equal(x.s().payments.get(py.id).status, 'pending');
});

test('the deposit rule never leaves a fraction of a cent, never exceeds the price, never asks under 5 €', () => {
  let seed = 20261113;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 4000; i++) {
    const price = 500 + Math.floor(rnd() * 30000);
    const percent = 5 + Math.floor(rnd() * 96);
    const s = { settings: { deposits: { mode: 'all', thresholdCents: 0, percent } }, services: new Map() };
    const d = depositFor(s, [{ id: 'a', price }]);
    assert.ok(Number.isInteger(d) && d >= 500 && d <= price, price + ' at ' + percent + ' % gave ' + d);
    assert.ok(d === price || d % 100 === 0, 'a whole number of euros, or the whole price');
  }
});

test('a notice with a wrong, missing or old signature confirms nothing; the right one confirms once, however often it comes', async (t) => {
  const x = await withStripe(t);
  const { appt, py } = await x.book();
  for (const o of [{ secret: 'whsec_other' }, { signature: '' }, { signature: 't=1,v1=00' }, { t: Math.floor(Date.now() / 1000) - 3600 }]) {
    const r = await x.hook(x.paid(py), o);
    assert.equal(r.status, 400, JSON.stringify(o));
    assert.equal(r.json.error.code, 'signature');
  }
  assert.equal(x.s().appts.get(appt.id).status, 'pending');
  assert.equal(x.count('payment.succeeded'), 0);

  assert.equal((await x.hook(x.paid(py))).status, 200);
  assert.equal(x.s().appts.get(appt.id).status, 'booked');
  assert.equal(x.s().appts.get(appt.id).deposit.paid, 1500);
  // Stripe sends it again (its first answer was lost), then the async twin of the same event
  assert.equal((await x.hook(x.paid(py))).status, 200);
  assert.equal((await x.hook({ ...x.paid(py), type: 'checkout.session.async_payment_succeeded' })).status, 200);
  // out of order: the page's expiry notice landing after the payment changes nothing
  assert.equal((await x.hook({ type: 'checkout.session.expired', data: { object: { id: py.providerRef } } })).status, 200);
  assert.equal((await x.hook({ type: 'checkout.session.async_payment_failed', data: { object: { id: py.providerRef } } })).status, 200);
  assert.equal(x.count('payment.succeeded'), 1);
  assert.equal(x.count('appt.confirmed'), 1);
  assert.equal(x.s().payments.get(py.id).status, 'paid');
  assert.equal([...x.s().messages.values()].filter((m) => m.template === 'confirmation' && m.apptId === appt.id).length, 1, 'one confirmation text');
});

test('a double tap on « Réserver » is one booking and one checkout page; a second client on the slot is refused', async (t) => {
  const x = await withStripe(t);
  const rq = { 'x-request-id': 'bbbbbbbb-0000-4000-8000-000000000001' };
  const a = await x.book({}, rq);
  const b = await x.book({}, rq);
  assert.equal(a.r.status, 201);
  assert.equal(b.r.status, 201);
  assert.equal(b.r.json.code, a.r.json.code);
  assert.equal(b.r.json.payment.url, a.r.json.payment.url);
  assert.equal(x.s().appts.size, 1);
  assert.equal(x.s().payments.size, 1);
  assert.equal(x.fake.log.filter((c) => c.path === '/checkout/sessions').length, 1);
  const other = await x.book({ first: 'Marc', phone: '0611223355' });
  assert.equal(other.r.status, 409, other.r.text);
});

test('the tab closed in the middle: the slot waits 31 minutes, then is free again; the link pays the same page meanwhile', async (t) => {
  const x = await withStripe(t);
  const { r, appt, py } = await x.book();
  const free = async () => (await browser(x.rt).get('/api/public/availability?services=' + x.ids.tr + '&staff=' + x.ids.ali + '&from=' + LATER + '&days=1&fresh=1')).json.days[0].slots.some((sl) => sl.m === 600);
  assert.equal(await free(), false, 'held while the client may still pay');
  // back from the SMS-less link (the site kept it): the same page, never a second one
  const again = await browser(x.rt).post('/api/public/bookings/' + r.json.token + '/pay', {});
  assert.equal(again.status, 200);
  assert.equal(again.json.url, py.url);
  x.clock.now += 20 * 60000;
  await x.tick();
  assert.equal(x.s().appts.get(appt.id).status, 'pending', 'a Stripe page lives 30 minutes: the booking waits for it');
  x.clock.now += 12 * 60000;
  await x.tick();
  assert.equal(x.s().appts.get(appt.id).status, 'cancelled');
  assert.equal(await free(), true);
  assert.equal((await x.hook({ type: 'checkout.session.expired', data: { object: { id: py.providerRef } } })).status, 200);
  assert.equal(x.s().payments.get(py.id).status, 'expired');
  // nothing was charged, nothing is refunded, no text ever left for a booking that never was
  assert.equal(x.fake.log.filter((c) => c.path === '/refunds').length, 0);
  assert.equal([...x.s().messages.values()].filter((m) => m.apptId === appt.id).length, 0);
});

test('paid after the hold expired: the money goes back once, and Stripe repeating the notice changes nothing', async (t) => {
  const x = await withStripe(t);
  const { appt, py } = await x.book();
  x.clock.now += 40 * 60000;
  await x.tick();
  assert.equal(x.s().appts.get(appt.id).status, 'cancelled');
  // the slot went to someone else at the counter meanwhile
  const first = await x.hook(x.paid(py));
  assert.equal(first.status, 200);
  const refunds = () => x.fake.log.filter((c) => c.method === 'POST' && c.path === '/refunds');
  assert.equal(refunds().length, 1);
  assert.equal(refunds()[0].body.amount, '1500');
  assert.equal(refunds()[0].body.payment_intent, 'pi_' + py.providerRef.slice(3));
  assert.equal(x.s().payments.get(py.id).status, 'refunded');
  assert.equal(x.s().appts.get(appt.id).status, 'cancelled');
  // the notice again (Stripe retries for three days when an answer is lost), and our own refund's notice
  assert.equal((await x.hook(x.paid(py))).status, 200);
  assert.equal((await x.hook({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_' + py.providerRef.slice(3), amount_refunded: 1500 } } })).status, 200);
  const p = x.s().payments.get(py.id);
  assert.equal(p.status, 'refunded', 'a refunded deposit never reads paid again');
  assert.equal(p.refunded, 1500);
  assert.equal(x.count('payment.succeeded'), 1);
  assert.equal(x.count('payment.refunded'), 1);
  assert.equal(x.count('payment.refundedOutside'), 0);
  assert.equal(refunds().length, 1, 'refunded once at Stripe');
  // nothing to keep or refund in Caisse › À traiter, and the till refuses to use it
  x.clock.now += 26 * 3600000;
  const online = (await x.owner.get('/api/v1/payments/online')).json;
  assert.deepEqual(online.todo, []);
  const use = await x.owner.post('/api/v1/sales', { lines: [{ kind: 'fee', name: 'Acompte', unit: 1500 }], payments: [{ method: 'online', amount: 1500, ref: py.id }] });
  assert.equal(use.status, 409);
});

test('paid just after the deadline while the slot is still free: the booking is confirmed, not thrown away', async (t) => {
  const x = await withStripe(t);
  const { appt, py } = await x.book();
  x.clock.now += 33 * 60000; // past the 31 minutes, before any tick ran
  assert.equal((await x.hook(x.paid(py))).status, 200);
  assert.equal(x.s().appts.get(appt.id).status, 'booked');
  assert.equal(x.fake.log.filter((c) => c.path === '/refunds').length, 0);
});

test('cancelled by the client inside the delay: refunded in full at Stripe, once; outside the delay: refused, the deposit stays', async (t) => {
  const x = await withStripe(t);
  const { r, appt, py } = await x.book();
  await x.hook(x.paid(py));
  const refunds = () => x.fake.log.filter((c) => c.method === 'POST' && c.path === '/refunds');
  // 12 hours before by default: the day before at 11:00 is inside the delay
  x.clock.now = at(addDays(LATER, -1), 11);
  const c1 = await browser(x.rt).post('/api/public/bookings/' + r.json.token + '/cancel', {});
  assert.equal(c1.status, 200, c1.text);
  assert.equal(x.s().appts.get(appt.id).status, 'cancelled');
  assert.equal(refunds().length, 1);
  assert.equal(refunds()[0].body.amount, '1500');
  assert.equal(refunds()[0].idem, 'lx-rf-' + py.id);
  assert.equal(x.s().payments.get(py.id).status, 'refunded');
  // a second tap on « Annuler »
  assert.equal((await browser(x.rt).post('/api/public/bookings/' + r.json.token + '/cancel', {})).status, 409);
  assert.equal(refunds().length, 1);

  // another booking, cancelled two hours before: too late online, nothing moves
  const b = await x.book({ first: 'Marc', phone: '0611223355', start: 720 });
  assert.equal(b.r.status, 201, b.r.text);
  await x.hook(x.paid(b.py));
  x.clock.now = at(LATER, 10);
  const c2 = await browser(x.rt).post('/api/public/bookings/' + b.r.json.token + '/cancel', {});
  assert.equal(c2.status, 409);
  assert.equal(c2.json.error.code, 'too_late');
  assert.equal(x.s().appts.get(b.appt.id).status, 'booked');
  assert.equal(x.s().payments.get(b.py.id).status, 'paid');
  assert.equal(refunds().length, 1);
});

test('Stripe down at booking: nothing is booked, nothing is held, the client is told to try again', async (t) => {
  const x = await withStripe(t);
  const err = console.error;
  console.error = () => {};
  t.after(() => { console.error = err; });
  x.fake.state.down = true;
  const { r } = await x.book();
  assert.equal(r.status, 502, r.text);
  assert.match(r.json.error.message, /réessaie/);
  assert.doesNotMatch(r.text, /Stripe is down/, 'Stripe’s own words never reach a client');
  assert.equal([...x.s().appts.values()].filter((a) => a.status !== 'cancelled').length, 0);
  assert.equal(x.s().payments.size, 0);
  // the same client tries again a moment later and gets through
  const again = await x.book();
  assert.equal(again.r.status, 201, again.r.text);
  assert.equal(again.r.json.status, 'pending');
});

test('Stripe’s key without its webhook secret in production: no deposit is asked, and the owner is told why', async (t) => {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url) => { throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; });
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', STRIPE_SECRET_KEY: 'sk_live_x' }, clock: () => at(DAY, 10), store: memoryStore() });
  assert.equal(rt.pay.name, 'simulated', 'a payment nobody could confirm is never started');
  assert.ok(rt.warnings.some((w) => /STRIPE_WEBHOOK_SECRET manquant/.test(w)));
  // and a demo never takes live keys
  const demo = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, clock: () => at(DAY, 10), store: memoryStore() });
  assert.equal(demo.pay.name, 'simulated');
});
