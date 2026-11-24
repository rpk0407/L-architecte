// « Au choix du client » (settings/deposits.js mode 'choice', the code's default): no deposit is ever asked. At booking the
// client chooses « payer au salon » (nothing online, as ever) or « payer maintenant » (the whole price on Stripe's page:
// card, Apple Pay, Google Pay). Checked on the salon as it runs live, over HTTP: production mode, a salon that never
// stored a `deposits` setting, everything by e-mail (booking.contact 'email', no SMS provider), « annulable à tout
// moment » (cancelUntilHours 0), nothing stored about the client space, Stripe on a fake network (no request ever reaches Stripe).
//   - the choice reaches the site only with a real way to pay; without Stripe the booking is what it always was;
//   - « au salon »: a confirmed booking, no payment, Stripe never called;
//   - « maintenant »: the booking is confirmed at once (never held hostage by the payment), the Checkout is for the whole
//     price, card only (the wallets ride on it), and Stripe's notice marks it paid, once;
//   - an abandoned, failed or impossible payment loses nothing: the booking stands, he pays at the salon;
//   - a cancellation gives the money back, the till deducts it and never takes it twice, an absence leaves the owner
//     the decision (keep or give back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService, updateService } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { setStatus, createAppointment } from '../../server/commands/agenda.js';
import { depositFor } from '../../server/domain/policy.js';
import { riskDeposit } from '../../server/domain/risk.js';
import { defaultSettings } from '../../server/settings/index.js';
import { browser } from './client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const LATER = addDays(DAY, 1);
const WH = 'whsec_choice';
const CRON = 'cron-secret-0123456789';

function fakeStripe(now) {
  const log = [];
  const state = { n: 0, byKey: new Map(), down: false };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const key = init.headers['idempotency-key'] || null;
    log.push({ method: init.method, path, body, idem: key });
    if (state.down) return new Response(JSON.stringify({ error: { message: 'api down', type: 'api_error' } }), { status: 503 });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
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
const sign = (body) => { const t = Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + createHmac('sha256', WH).update(t + '.' + body).digest('hex'); };

/** The live salon's shape. Its `deposits` setting is never written: the code's default decides, as on the live journal. */
async function live(t, { stripe = true } = {}) {
  const real = globalThis.fetch;
  const leaked = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { leaked.push(String((url && url.url) || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; assert.deepEqual(leaked, [], 'a request left the server'); });
  const clock = { now: at(DAY, 10) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', CRON_SECRET: CRON, ...(stripe ? { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH } : {}) };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const fake = fakeStripe(() => clock.now);
  if (stripe) rt.pay = fake.provider;
  assert.equal(rt.sms, null, 'no SMS provider, as on the live salon');
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: rt.engine.state.staff.get(boss.id), caps: capsOf(rt.engine.state.staff.get(boss.id), rt.engine.state.settings) });
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = {};
  ids.ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.ben = (await rt.engine.run(addStaff, { name: 'Ben', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2500, dur: 30, slug: 'cl' }, asOwner())).id;
  ids.tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 6000, dur: 60, slug: 'tr' }, asOwner())).id;
  // as the live salon: everything by e-mail, cancellable at any time. Nothing about deposits is stored
  await rt.engine.run(updateSettings, { booking: { contact: 'email', cancelUntilHours: 0 } }, asOwner());
  assert.equal(rt.engine.journal.some((e) => e.type === 'settings.updated' && e.data && e.data.patch && e.data.patch.deposits), false, 'no deposits setting was ever stored');
  const s = () => rt.engine.state;
  const hook = (ev) => {
    const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), ...ev });
    return browser(rt).raw('POST', '/api/pay/stripe/webhook', body, { 'stripe-signature': sign(body), 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
  };
  const paidEv = (py) => ({ type: 'checkout.session.completed', data: { object: { id: py.providerRef, payment_status: 'paid', amount_total: py.amount, currency: 'eur', payment_intent: 'pi_' + py.providerRef.slice(3) } } });
  let n = 0;
  /** a booking from the site, as site.html sends it: `pay: 'now'` only when the client chose « payer maintenant » */
  const book = async (extra = {}, headers) => {
    const r = await browser(rt).post('/api/public/bookings', { serviceIds: [ids.cut], staffId: ids.ali, day: LATER, start: 600, first: 'Léon', email: 'leon.' + ++n + '@exemple.fr', ...extra }, headers);
    const appt = () => (r.status === 201 ? s().appts.get(s().apptByCode.get(r.json.code)) : null);
    const pays = () => (appt() ? [...s().payments.values()].filter((p) => p.apptId === appt().id) : []);
    return { r, appt, pays, token: r.json && r.json.token };
  };
  const page = async (token) => (await browser(rt).get('/api/public/bookings/' + token)).json;
  const tick = async () => assert.equal((await browser(rt).get('/api/cron/tick', { authorization: 'Bearer ' + CRON })).status, 200);
  const count = (type) => rt.engine.journal.filter((e) => e.type === type).length;
  const calls = (method, path) => fake.log.filter((c) => c.method === method && c.path === path);
  const mails = (a, template) => [...s().messages.values()].filter((m) => m.apptId === a.id && m.channel === 'email' && (!template || m.template === template));
  return { rt, clock, owner, fake, ids, s, hook, paidEv, book, page, tick, count, calls, mails, asOwner };
}

test('the code default is « au choix du client », and the Réglages accept it beside the three older modes', async (t) => {
  assert.equal(defaultSettings().deposits.mode, 'choice');
  const x = await live(t);
  assert.equal(x.s().settings.deposits.mode, 'choice', 'a salon that never stored the setting runs on the default');
  for (const mode of ['threshold', 'all', 'none', 'choice']) assert.equal((await x.owner.patch('/api/v1/settings', { deposits: { mode } })).status, 200, mode);
  assert.equal((await x.owner.patch('/api/v1/settings', { deposits: { mode: 'maybe' } })).status, 400);
  assert.equal(x.s().settings.deposits.mode, 'choice');
});

test('the choice reaches the site only with a real way to pay online; no service announces a deposit', async (t) => {
  const x = await live(t);
  // a service with its own deposit in the Catalogue, a client who missed: nothing is mandatory in this mode
  await x.rt.engine.run(updateService, { id: x.ids.tr, patch: { deposit: 2000 } }, x.asOwner());
  await x.rt.engine.run(updateSettings, { deposits: { riskBased: true } }, x.asOwner());
  const pub = (await browser(x.rt).get('/api/public/salon')).json;
  assert.deepEqual(pub.payments, { provider: 'stripe', live: true });
  assert.equal(pub.deposits.mode, 'choice');
  assert.deepEqual(pub.services.map((sv) => sv.deposit), [0, 0], 'the site mirrors no deposit');
  assert.equal(pub.booking.cancelUntilHours, 0);
  assert.equal(depositFor(x.s(), [{ id: x.ids.tr, price: 6000 }], { payLive: true, risk: true }), 0);
  const b = await x.book({ serviceIds: [x.ids.tr], start: 660 });
  assert.equal(b.r.status, 201, b.r.text);
  assert.equal(b.r.json.status, 'booked', '60 € with its own deposit rule: booked at once all the same');
  assert.equal(b.r.json.deposit, 0);

  // without Stripe (payments.live false): no choice at all, and a browser that asks to pay now is simply booked
  const off = await live(t, { stripe: false });
  const pub0 = (await browser(off.rt).get('/api/public/salon')).json;
  assert.deepEqual(pub0.payments, { provider: 'simulated', live: false });
  assert.equal(pub0.deposits.mode, 'none', 'the site is told there is nothing to choose');
  const b0 = await off.book({ pay: 'now' });
  assert.equal(b0.r.status, 201, b0.r.text);
  assert.equal(b0.r.json.status, 'booked');
  assert.equal(b0.r.json.payment, null);
  assert.equal(b0.r.json.payNow, undefined);
  assert.equal(b0.pays().length, 0);
  assert.equal(off.mails(b0.appt(), 'confirmation').length, 1);
});

test('« payer au salon »: a confirmed booking as ever, no payment, Stripe never called', async (t) => {
  const x = await live(t);
  for (const extra of [{}, { pay: 'salon', start: 660 }]) {
    const b = await x.book(extra);
    assert.equal(b.r.status, 201, b.r.text);
    assert.equal(b.r.json.status, 'booked');
    assert.equal(b.r.json.deposit, 0);
    assert.equal(b.r.json.payment, null);
    assert.equal(b.r.json.payNow, undefined);
    const a = b.appt();
    assert.equal(a.status, 'booked');
    assert.equal(a.deposit, null);
    assert.equal(b.pays().length, 0);
    assert.equal(x.mails(a, 'confirmation').length, 1, 'the confirmation leaves at once, by e-mail');
    const p = await x.page(b.token);
    assert.equal(p.status, 'booked');
    assert.equal(p.deposit, null);
    assert.equal(p.prepay, undefined);
  }
  assert.equal(x.fake.log.length, 0, 'Stripe is not involved at all');
  assert.equal(x.count('payment.created'), 0);
  // the day after, nothing has expired: there was nothing to wait for
  x.clock.now += 3 * 3600000;
  await x.tick();
  assert.deepEqual([...x.s().appts.values()].map((a) => a.status), ['booked', 'booked']);
});

test('« payer maintenant »: confirmed at once, a Checkout for the whole price by card (wallets ride on it), paid by Stripe’s notice, once', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now' });
  assert.equal(b.r.status, 201, b.r.text);
  // the booking never waits for the money: confirmed, its e-mail already on its way
  assert.equal(b.r.json.status, 'booked');
  assert.equal(b.r.json.deposit, 0, 'no deposit is asked');
  assert.deepEqual(b.r.json.payNow, { amount: 2500, ok: true });
  assert.equal(b.r.json.payment.url, 'https://checkout.stripe.com/c/cs_1');
  const a = b.appt();
  assert.equal(a.status, 'booked');
  assert.equal(a.deposit, null, 'nothing on the booking until the money is in');
  assert.equal(x.mails(a, 'confirmation').length, 1);
  // one Checkout Session: the whole price, in EUR, card only (Apple Pay and Google Pay are card wallets), back to his page
  const co = x.calls('POST', '/checkout/sessions');
  assert.equal(co.length, 1);
  assert.equal(co[0].body.mode, 'payment');
  assert.equal(co[0].body['line_items[0][price_data][unit_amount]'], '2500');
  assert.equal(co[0].body['line_items[0][price_data][currency]'], 'eur');
  assert.equal(co[0].body['line_items[0][price_data][product_data][name]'], 'Coupe');
  assert.deepEqual(Object.keys(co[0].body).filter((k) => k.startsWith('payment_method_types')).map((k) => co[0].body[k]), ['card']);
  assert.match(co[0].body.success_url, new RegExp('/r/' + b.token + '\\?paiement=ok$'));
  assert.match(co[0].body.cancel_url, new RegExp('/r/' + b.token + '\\?paiement=annule$'));
  assert.match(co[0].body.customer_email, /^leon\.\d+@exemple\.fr$/);
  const [py] = b.pays();
  assert.deepEqual([py.kind, py.amount, py.status, py.full, py.provider], ['deposit', 2500, 'pending', true, 'stripe']);
  // his page, while he has not paid: confirmed, and the way back to the payment
  let p = await x.page(b.token);
  assert.equal(p.status, 'booked');
  assert.equal(p.deposit, null);
  assert.deepEqual(p.prepay, { amount: 2500, url: 'https://checkout.stripe.com/c/cs_1' });
  // Stripe's notice: paid. The booking was already confirmed, so nothing is confirmed twice and no second mail leaves
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(b.pays()[0].status, 'paid');
  assert.deepEqual(b.appt().deposit, { amount: 2500, paid: 2500, paymentId: py.id, full: true });
  assert.equal(b.appt().status, 'booked');
  assert.equal(x.count('appt.confirmed'), 0);
  assert.equal(x.mails(a, 'confirmation').length, 1);
  p = await x.page(b.token);
  assert.deepEqual(p.deposit, { amount: 2500, paid: 2500, url: null, full: true });
  assert.equal(p.prepay, undefined);
  // the same notice again, and again: once
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.count('payment.succeeded'), 1);
  assert.equal(x.calls('POST', '/refunds').length, 0);
  // the agenda's sheet carries it for the till
  const sheet = (await x.owner.get('/api/v1/appointments/' + a.id)).json;
  assert.deepEqual((sheet.appt || sheet).deposit, { amount: 2500, paid: 2500, paymentId: py.id, full: true });
});

test('a double tap on « Réserver et payer » is one booking and one payment page', async (t) => {
  const x = await live(t);
  const rid = { 'x-request-id': 'tap-0123456789abcdef' };
  const b1 = await x.book({ pay: 'now', email: 'double@exemple.fr' }, rid);
  const b2 = await x.book({ pay: 'now', email: 'double@exemple.fr' }, rid);
  assert.equal(b1.r.status, 201, b1.r.text);
  assert.equal(b2.r.status, 201, b2.r.text);
  assert.equal(b2.r.json.code, b1.r.json.code);
  assert.equal(b2.r.json.payment.url, b1.r.json.payment.url);
  assert.equal(x.count('appt.booked'), 1);
  assert.equal(x.count('payment.created'), 1);
  assert.equal(x.calls('POST', '/checkout/sessions').length, 1);
});

test('an abandoned or failed payment page loses nothing: the booking stands, the slot is his, he pays at the salon', async (t) => {
  const x = await live(t);
  const gone = await x.book({ pay: 'now' });
  const failed = await x.book({ pay: 'now', start: 660 });
  const [py1] = gone.pays(), [py2] = failed.pays();
  // his bank refuses: Stripe says so
  assert.equal((await x.hook({ type: 'checkout.session.async_payment_failed', data: { object: { id: py2.providerRef } } })).status, 200);
  // he closes the tab: 40 minutes later the old deposit rule would have freed the slot. Not here
  x.clock.now += 40 * 60000;
  await x.tick();
  assert.equal(gone.appt().status, 'booked');
  assert.equal((await x.hook({ type: 'checkout.session.expired', data: { object: { id: py1.providerRef } } })).status, 200);
  assert.deepEqual([gone.pays()[0].status, failed.pays()[0].status], ['expired', 'failed']);
  await x.tick();
  for (const b of [gone, failed]) {
    assert.equal(b.appt().status, 'booked', 'never cancelled for an unpaid choice');
    assert.equal(b.appt().deposit, null);
    const p = await x.page(b.token);
    assert.equal(p.status, 'booked');
    assert.equal(p.prepay, undefined, 'the dead page is not offered again');
    assert.equal(p.canChange, true);
  }
  assert.equal(x.count('appt.cancelled'), 0);
  // the slot is still taken: nobody else can book it
  const other = await x.book({ start: 600 });
  assert.equal(other.r.status, 409);
  // the till rings him up as anyone: the whole price, by card
  const sale = await x.owner.post('/api/v1/sales', { apptId: failed.appt().id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: [{ method: 'card', amount: 2500 }] });
  assert.equal(sale.status, 200, sale.text);
});

test('Stripe down when he chooses to pay now: the booking is kept and he is told to pay at the salon', async (t) => {
  const x = await live(t);
  x.fake.state.down = true;
  const b = await x.book({ pay: 'now' });
  assert.equal(b.r.status, 201, b.r.text);
  assert.equal(b.r.json.status, 'booked');
  assert.equal(b.r.json.payment, null);
  assert.deepEqual(b.r.json.payNow, { amount: 2500, ok: false, failed: true });
  assert.equal(b.appt().status, 'booked');
  assert.equal(b.pays().length, 0);
  assert.equal(x.count('appt.cancelled'), 0);
  assert.equal(x.mails(b.appt(), 'confirmation').length, 1);
});

test('cancelled by the client, even ten minutes before: the whole payment goes back to his card, once', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now' });
  const [py] = b.pays();
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  // cancelUntilHours 0: cancellable until the appointment starts
  x.clock.now = at(LATER, 9, 50);
  assert.equal((await x.page(b.token)).canChange, true);
  const cx = await browser(x.rt).post('/api/public/bookings/' + b.token + '/cancel', {});
  assert.equal(cx.status, 200, cx.text);
  assert.equal(cx.json.status, 'cancelled');
  const rf = x.calls('POST', '/refunds');
  assert.equal(rf.length, 1);
  assert.equal(rf[0].body.amount, '2500');
  assert.equal(rf[0].body.payment_intent, 'pi_1');
  assert.equal(b.pays()[0].status, 'refunded');
  assert.equal(b.pays()[0].refunded, 2500);
  // a second tap, and Stripe repeating that it was paid: nothing more moves, and it never reads « paid » again
  assert.equal((await browser(x.rt).post('/api/public/bookings/' + b.token + '/cancel', {})).status, 409);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.calls('POST', '/refunds').length, 1);
  assert.equal(b.pays()[0].status, 'refunded');
  // nothing is left for the owner to handle
  x.clock.now += 2 * 86400000;
  assert.equal((await x.owner.post('/api/auth/login', { email: 'gerant@salon.test', password: 'Architecte13!' })).status, 200);
  const online = (await x.owner.get('/api/v1/payments/online')).json;
  assert.deepEqual(online.todo, []);
});

test('cancelled before he paid, then paid on the page left open: the money goes straight back', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now' });
  const [py] = b.pays();
  assert.equal((await browser(x.rt).post('/api/public/bookings/' + b.token + '/cancel', {})).status, 200);
  assert.equal(x.calls('POST', '/refunds').length, 0, 'nothing was paid yet');
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.calls('POST', '/refunds').length, 1);
  assert.equal(x.calls('POST', '/refunds')[0].body.amount, '2500');
  assert.equal(b.pays()[0].status, 'refunded');
  assert.equal(b.appt().deposit, null);
  assert.equal(b.appt().status, 'cancelled');
});

test('the till deducts what was paid online and never takes it twice', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now', day: DAY, start: 840 });
  const [py] = b.pays();
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  const a = b.appt();
  await x.rt.engine.run(setStatus, { id: a.id, status: 'in_chair' }, x.asOwner());
  // « Payer ma coupe » on his page would ask nothing either: the till's own quote says what is left
  const pay = [{ method: 'deposit', amount: 2500, ref: py.id }];
  // the ticket the Comptoir opens: the cut, paid by the online payment, nothing left to take
  const more = await x.owner.post('/api/v1/sales', { apptId: a.id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: [...pay, { method: 'card', amount: 2500 }] });
  assert.equal(more.status, 400, 'the price paid online and the same price by card: refused, the ticket is 25 €');
  assert.equal(x.count('sale.completed'), 0);
  const sale = await x.owner.post('/api/v1/sales', { apptId: a.id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: pay });
  assert.equal(sale.status, 200, sale.text);
  const sl = x.s().sales.get(b.appt().saleId);
  assert.equal(sl.totals.due, 2500);
  assert.deepEqual(sl.payments.map((q) => [q.method, q.amount, q.paymentId]), [['deposit', 2500, py.id]]);
  assert.equal(b.pays()[0].usedBy, sl.id);
  assert.equal(b.appt().status, 'done');
  // the same payment on another ticket: refused
  const other = await x.rt.engine.run(createAppointment, { name: 'Autre', serviceIds: [x.ids.cut], staffId: x.ids.ben, day: DAY, start: 840 }, x.asOwner());
  const twice = await x.owner.post('/api/v1/sales', { apptId: other.id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: pay });
  assert.equal(twice.status, 409);
  // his receipt says « en ligne », not « acompte »
  const receipt = (await browser(x.rt).get('/api/public/receipts/' + (await import('../../server/auth/session.js')).signLink(x.rt.secret, 'receipt', String(sl.number)))).json;
  assert.deepEqual(receipt.payments, [{ method: 'online', amount: 2500 }]);
  assert.equal(x.calls('POST', '/refunds').length, 0);
});

test('rung up at the till while his payment page was still open: what he pays afterwards goes straight back', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now', day: DAY, start: 840 });
  const [py] = b.pays();
  const a = b.appt();
  await x.rt.engine.run(setStatus, { id: a.id, status: 'in_chair' }, x.asOwner());
  const sale = await x.owner.post('/api/v1/sales', { apptId: a.id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: [{ method: 'card', amount: 2500 }] });
  assert.equal(sale.status, 200, sale.text);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.calls('POST', '/refunds').length, 1, 'paid twice is given back at once');
  assert.equal(b.pays()[0].status, 'refunded');
  assert.equal(b.appt().deposit, null);
  assert.equal(x.count('sale.completed'), 1);
});

test('he paid and did not come: the money stays until the owner decides, keep it or give it back', async (t) => {
  const x = await live(t);
  const kept = await x.book({ pay: 'now', day: DAY, start: 840, first: 'Marc' });
  const back = await x.book({ pay: 'now', day: DAY, start: 900, first: 'Nadir' });
  for (const b of [kept, back]) assert.equal((await x.hook(x.paidEv(b.pays()[0]))).status, 200);
  x.clock.now = at(DAY, 16);
  for (const b of [kept, back]) await x.rt.engine.run(setStatus, { id: b.appt().id, status: 'no_show' }, x.asOwner());
  assert.equal(x.calls('POST', '/refunds').length, 0, 'an absence refunds nothing by itself');
  x.clock.now = at(addDays(DAY, 2), 10);
  assert.equal((await x.owner.post('/api/auth/login', { email: 'gerant@salon.test', password: 'Architecte13!' })).status, 200);
  const todo = (await x.owner.get('/api/v1/payments/online')).json.todo;
  assert.deepEqual(todo.map((y) => [y.kind, y.payKind, y.full, y.amount, y.apptStatus]).sort(), [['unused', 'deposit', true, 2500, 'no_show'], ['unused', 'deposit', true, 2500, 'no_show']]);
  // kept: a ticket of one line, paid by the online payment
  const keep = await x.owner.post('/api/v1/payments/' + kept.pays()[0].id + '/keep', {});
  assert.equal(keep.status, 200, keep.text);
  const sl = x.s().sales.get(kept.pays()[0].usedBy);
  assert.match(sl.lines[0].name, /^Paiement en ligne conservé · absence du 03\/11$/);
  assert.equal(sl.totals.due, 2500);
  // given back
  const rf = await x.owner.post('/api/v1/payments/' + back.pays()[0].id + '/refund', {});
  assert.equal(rf.status, 200, rf.text);
  assert.equal(x.calls('POST', '/refunds').length, 1);
  assert.equal(back.pays()[0].status, 'refunded');
  assert.deepEqual((await x.owner.get('/api/v1/payments/online')).json.todo, []);
});

test('the salon cancels a booking paid online: refunded when the owner asks for it, said back either way', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now' });
  assert.equal((await x.hook(x.paidEv(b.pays()[0]))).status, 200);
  const r = await x.owner.post('/api/v1/appointments/' + b.appt().id + '/cancel', { reason: 'Annulé par le salon', notify: true, refundDeposit: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.refunded, true);
  assert.equal(x.calls('POST', '/refunds').length, 1);
  assert.equal(b.pays()[0].status, 'refunded');
});

test('a client whose carnet already pays the cut is not charged online: booked, told to pay at the salon, nothing said of his file', async (t) => {
  const x = await live(t);
  const pack = (await x.rt.engine.run(addService, { name: 'Formule Entretien 5 semaines', category: 'Formule', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [x.ids.cut], weekly: true, missed: 'lost' } }, x.asOwner())).id;
  const made = await x.owner.post('/api/v1/clients', { first: 'Karim', last: 'Formule', email: 'karim.formule@exemple.fr' });
  assert.equal(made.status, 200, made.text);
  const sold = await x.owner.post('/api/v1/sales', { clientId: made.json.id, lines: [{ kind: 'pack', ref: pack }], payments: [{ method: 'card', amount: 8000 }] });
  assert.equal(sold.status, 200, sold.text);
  const b = await x.book({ pay: 'now', first: 'Karim', email: 'karim.formule@exemple.fr' });
  assert.equal(b.r.status, 201, b.r.text);
  assert.equal(b.appt().clientId, made.json.id, 'the booking landed on his file');
  assert.equal(b.r.json.status, 'booked');
  assert.equal(b.r.json.payment, null);
  assert.deepEqual(b.r.json.payNow, { amount: 2500, ok: false, failed: true });
  assert.equal(b.pays().length, 0);
  assert.equal(x.calls('POST', '/checkout/sessions').length, 0);
  // someone else, the same cut: he pays online as asked
  const other = await x.book({ pay: 'now', start: 660 });
  assert.equal(other.r.json.payNow.ok, true);
});

test('several people in one booking, or a move: no payment page, everyone pays at the salon', async (t) => {
  const x = await live(t);
  const b = await x.book({ pay: 'now', others: [{ serviceIds: [x.ids.cut], staffId: x.ids.ben, day: LATER, start: 600, guest: { kind: 'other', first: 'Sami' } }] });
  assert.equal(b.r.status, 201, b.r.text);
  assert.equal(b.r.json.people.length, 2);
  assert.equal(b.r.json.payment, null);
  assert.equal(b.r.json.payNow, undefined);
  assert.equal(x.count('payment.created'), 0);
  assert.equal(x.fake.log.length, 0);
});

test('the older modes are untouched: a salon that sets « acompte au-delà d’un montant » still holds the booking for it', async (t) => {
  const x = await live(t);
  await x.rt.engine.run(updateSettings, { deposits: { mode: 'threshold' } }, x.asOwner());
  // a browser asking to « pay now » changes nothing there: the deposit rule decides
  const b = await x.book({ serviceIds: [x.ids.tr], pay: 'now' });
  assert.equal(b.r.status, 201, b.r.text);
  assert.equal(b.r.json.status, 'pending');
  assert.equal(b.r.json.deposit, 1800);
  assert.equal(b.r.json.payNow, undefined);
  const [py] = b.pays();
  assert.deepEqual([py.amount, py.full], [1800, undefined]);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(b.appt().status, 'booked');
  assert.deepEqual(b.appt().deposit.paid, 1800);
  assert.equal(b.appt().deposit.full, undefined);
  // and the history rule only speaks in that mode
  assert.equal(riskDeposit(x.s(), null, DAY), false);
  const cheap = await x.book({ start: 780 });
  assert.equal(cheap.r.json.status, 'booked', '25 € is under the threshold');
});

test('site.html: the choice is one self-contained block, « au salon » first, the three ways to pay said, shown only with online payment live', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../public/site.html', import.meta.url), 'utf8');
  // its <sc-if> opens and closes on its own line, around the radiogroup and nothing else (a misplaced one hides chapters)
  const line = html.split('\n').find((l) => l.includes('value="{{payAsk}}"'));
  assert.ok(line, 'the choice is in the booking sheet');
  assert.match(line, /^<sc-if value="\{\{payAsk\}\}" hint-placeholder-val="\{\{ false \}\}"><div class="payc"[^>]*>.*role="radiogroup".*<\/div><\/div><\/sc-if>$/);
  assert.equal((line.match(/<sc-if/g) || []).length, 1);
  assert.equal((line.match(/<\/sc-if>/g) || []).length, 1);
  assert.equal((html.match(/<sc-if/g) || []).length, (html.match(/<\/sc-if>/g) || []).length, 'every <sc-if> is closed');
  // asked only when the salon's answer says a real payment exists and the mode is 'choice'
  assert.match(html, /sal\.payments\.live === true && sal\.deposits && sal\.deposits\.mode === 'choice'/);
  // « au salon » comes first and is the state the sheet starts from
  assert.ok(html.indexOf("t: 'Payer au salon'") > 0 && html.indexOf("t: 'Payer au salon'") < html.indexOf("t: 'Payer maintenant · '"));
  assert.match(html, /fPay: 'salon', forgot: false/);
  assert.match(html, /Carte \(crédit ou débit\), Apple Pay ou Google Pay\./);
  // the request says « now » only when it was asked and chosen
  assert.match(html, /pay: this\.bkPayAsk\(b\) && s0\.fPay === 'now' \? 'now' : undefined/);
  // the CGV say it too, only in that mode
  const cgv = readFileSync(new URL('../../public/cgv.html', import.meta.url), 'utf8');
  assert.equal((cgv.match(/data-if="payChoice" hidden/g) || []).length, 2);
});
