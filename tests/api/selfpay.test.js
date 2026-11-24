// « Payer ma coupe »: the client pays his cut himself on his own page once he is at the salon, over HTTP, with Stripe on a
// fake network (no request ever reaches Stripe). The amount is the server's (deposit taken off, tip apart, a carnet that
// covers the visit, a product the barber added), the ticket is the till's own and exists once whatever Stripe or the
// client repeat (notice twice, double tap, a notice after the link was withdrawn or after cash), a link pays only what
// it may (a friend his place, the organiser the group), and without Stripe nothing shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService, addProduct, adjustStock } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { setStatus } from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { dayTotals } from '../../server/domain/cash.js';
import { meTodo } from '../../server/domain/me.js';
import { lookupAppointments } from '../../server/commands/lookup.js';
import { browser } from './client.js';
import { at } from '../helpers.js';

const DAY = '2026-11-03'; // a Tuesday
const WH = 'whsec_selfpay';

function fakeStripe(now) {
  const log = [];
  const state = { n: 0, byKey: new Map() };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const key = init.headers['idempotency-key'] || null;
    log.push({ method: init.method, path, body, idem: key });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (key && state.byKey.has(key)) return ok(state.byKey.get(key));
    let out = null;
    if (init.method === 'POST' && path === '/checkout/sessions') { state.n++; out = { id: 'cs_' + state.n, url: 'https://checkout.stripe.com/c/cs_' + state.n }; }
    else if (init.method === 'POST' && /^\/checkout\/sessions\/[^/]+\/expire$/.test(path)) out = { id: path.split('/')[3], status: 'expired' };
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

async function salon(t, { stripe = true, selfPay = true } = {}) {
  const real = globalThis.fetch;
  const leaked = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { leaked.push(String((url && url.url) || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; assert.deepEqual(leaked, [], 'a request left the server'); });
  const clock = { now: at(DAY, 10) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', CRON_SECRET: 'cron-secret-0123456789', ...(stripe ? { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH } : {}) };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const fake = fakeStripe(() => clock.now);
  if (stripe) rt.pay = fake.provider;
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: rt.engine.state.staff.get(boss.id), caps: capsOf(rt.engine.state.staff.get(boss.id), rt.engine.state.settings) });
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = {};
  ids.ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.ben = (await rt.engine.run(addStaff, { name: 'Ben', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 3000, dur: 30, slug: 'cl' }, asOwner())).id;
  ids.tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  ids.pack = (await rt.engine.run(addService, { name: 'Carnet 5 coupes', category: 'Carnets', price: 12000, dur: 30, online: false, pack: { credits: 5, days: 120 } }, asOwner())).id;
  ids.oil = (await rt.engine.run(addProduct, { name: 'Huile', price: 1500, cost: 600 }, asOwner())).id;
  await rt.engine.run(adjustStock, { id: ids.oil, delta: 10, reason: 'Stock initial' }, asOwner());
  if (selfPay) await rt.engine.run(updateSettings, { payments: { selfPay: true } }, asOwner());
  const s = () => rt.engine.state;
  const hook = (ev) => {
    const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), ...ev });
    return browser(rt).raw('POST', '/api/pay/stripe/webhook', body, { 'stripe-signature': sign(body), 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
  };
  const paidEv = (py, o = {}) => ({ type: 'checkout.session.completed', data: { object: { id: py.providerRef, payment_status: 'paid', amount_total: o.amount ?? py.amount, currency: 'eur', payment_intent: 'pi_' + py.providerRef.slice(3) } } });
  /** a booking of today on the site; a deposit asked is paid at once (Stripe's notice) */
  const book = async (extra = {}) => {
    const r = await browser(rt).post('/api/public/bookings', { serviceIds: [ids.cut], staffId: ids.ali, day: DAY, start: 840, first: 'Léon', phone: '0611223344', ...extra });
    assert.equal(r.status, 201, r.text);
    const appt = () => s().appts.get(s().apptByCode.get(r.json.code));
    if (r.json.status === 'pending') {
      const dep = [...s().payments.values()].find((p) => p.apptId === appt().id && p.kind === 'deposit');
      assert.equal((await hook(paidEv(dep))).status, 200);
      assert.equal(appt().status, 'booked');
    }
    return { r, token: r.json.token, appt };
  };
  const seat = (a, status = 'in_chair') => rt.engine.run(setStatus, { id: a.id, status }, asOwner());
  const page = async (token) => (await browser(rt).get('/api/public/bookings/' + token)).json;
  const tap = (token, body) => browser(rt).post('/api/public/bookings/' + token + '/checkout', body);
  const selfPays = () => [...s().payments.values()].filter((p) => p.self);
  const count = (type) => rt.engine.journal.filter((e) => e.type === type).length;
  const refunds = () => fake.log.filter((c) => c.method === 'POST' && c.path === '/refunds');
  return { rt, clock, owner, fake, ids, s, hook, paidEv, book, seat, page, tap, selfPays, count, refunds, asOwner };
}

test('« À régler » shows once the client is at the salon, never before, never when the owner keeps it off', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  let p = await x.page(token);
  assert.equal(p.pay, undefined, 'booked, not arrived: nothing to pay yet');
  assert.equal(p.today, true);
  assert.equal((await x.tap(token, { expect: 3000, tip: 0 })).status, 409);
  await x.seat(appt(), 'arrived');
  p = await x.page(token);
  assert.equal(p.pay.state, 'due');
  assert.equal(p.pay.amount, 3000);
  assert.deepEqual(p.pay.lines, [{ name: 'Coupe', qty: 1, amount: 3000 }]);
  assert.deepEqual(p.pay.tips, [200, 500]);
  // his space says it too (« Ce qui manque »), and « Retrouver mon rendez-vous » texts this appointment's link first
  const todo = meTodo(x.s(), [appt().clientId], null, { now: x.clock.now, today: DAY, origin: 'https://salon.test', payLive: true, tokenFor: () => 'tok' }, null);
  assert.deepEqual(todo.items.filter((i) => i.id.startsWith('pay_')).map((i) => [i.amount, i.action.href]), [[3000, '/r/tok?payer']]);
  assert.equal(meTodo(x.s(), [appt().clientId], null, { now: x.clock.now, today: DAY, origin: 'https://salon.test', payLive: false, tokenFor: () => 'tok' }, null).items.filter((i) => i.id.startsWith('pay_')).length, 0);
  const lk = await x.rt.engine.run(lookupAppointments, { phone: '0611223344' }, { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { linkFor: (a) => 'https://salon.test/r/' + a.code } });
  assert.equal(lk.sent, true, 'a client in the chair with his cut to pay gets his link');
  // the owner's switch
  await x.rt.engine.run(updateSettings, { payments: { selfPay: false } }, x.asOwner());
  assert.equal((await x.page(token)).pay, undefined);
  const off = await x.tap(token, { expect: 3000, tip: 0 });
  assert.equal(off.status, 409);
  assert.equal(off.json.error.code, 'off');
  assert.equal(x.selfPays().length, 0);
});

test('he pays with a tip: the till’s ticket, numbered like any other, « en ligne », the tip apart from revenue', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  await x.seat(appt());
  // the browser's own figures are not the server's
  const lied = await x.tap(token, { expect: 100, tip: 0, amount: 100 });
  assert.equal(lied.status, 409);
  assert.equal(lied.json.error.code, 'changed');
  assert.equal(lied.json.error.amount ?? lied.json.error.extra?.amount ?? 3000, 3000);
  assert.equal((await x.tap(token, { expect: 3000, tip: -5 })).status, 400);
  assert.equal((await x.tap(token, { expect: 3000, tip: 999999 })).status, 400);
  const r = await x.tap(token, { expect: 3000, tip: 200 });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.url, /^https:\/\/checkout\.stripe\.com\//);
  const [py] = x.selfPays();
  assert.equal(py.kind, 'qr');
  assert.equal(py.amount, 3200);
  assert.deepEqual(py.self, { tip: 200 });
  assert.equal(x.fake.log.find((c) => c.path === '/checkout/sessions').body['line_items[0][price_data][unit_amount]'], '3200');
  // the till sees him on the payment page
  const seen = (await x.owner.get('/api/v1/appointments/' + appt().id)).json.appt;
  assert.equal(seen.onlinePay.state, 'paying');
  assert.equal(seen.onlinePay.due, 3200);
  assert.equal((await x.page(token)).pay.paying, true);
  // Stripe says paid: one ticket
  const h = await x.hook(x.paidEv(py));
  assert.equal(h.status, 200, h.text);
  const a = appt();
  assert.equal(a.status, 'done');
  const sale = x.s().sales.get(a.saleId);
  assert.equal(sale.number, 1);
  assert.equal(sale.day, DAY);
  assert.deepEqual(sale.lines.map((l) => [l.kind, l.name, l.net, l.staffId]), [['service', 'Coupe', 3000, x.ids.ali]]);
  assert.deepEqual(sale.payments, [{ method: 'online', amount: 3200, paymentId: py.id }]);
  assert.deepEqual(sale.tip, { amount: 200, staffId: x.ids.ali });
  assert.equal(sale.totals.total, 3000);
  assert.equal(sale.totals.revenue, 3000, 'the tip is not revenue');
  assert.equal(sale.totals.due, 3200);
  assert.equal(sale.demo, undefined);
  assert.equal(x.s().payments.get(py.id).usedBy, sale.id);
  assert.equal(dayTotals(x.s(), DAY).byMethod.online, 3200);
  // his page: « Payé · merci » with his receipt; the till: « Payé en ligne »
  const p = await x.page(token);
  assert.equal(p.pay.state, 'paid');
  assert.equal(p.pay.online, true);
  assert.equal(p.pay.total, 3200);
  assert.equal(p.pay.ticket, 'T000001');
  assert.match(p.pay.receipt, /\/recu\//);
  const after = (await x.owner.get('/api/v1/appointments/' + a.id)).json.appt;
  assert.equal(after.paidOnline, true);
  assert.equal(after.onlinePay, undefined);
  // the same notice again, and a second tap: nothing more
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.count('sale.completed'), 1);
  assert.equal(x.refunds().length, 0);
  const again = await x.tap(token, { expect: 3000, tip: 0 });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'paid');
  // the till that rings him up now is told he paid online
  const till = await x.owner.post('/api/v1/sales', { apptId: a.id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: [{ method: 'card', amount: 3000 }] });
  assert.equal(till.status, 409);
  assert.equal(till.json.error.code, 'paid_online');
  assert.equal(x.count('sale.completed'), 1);
});

test('the deposit paid at booking is taken off; a carnet that covers the visit asks nothing', async (t) => {
  const x = await salon(t);
  // a salon that asks a deposit from 50 € (the default asks nothing: the client chooses)
  await x.rt.engine.run(updateSettings, { deposits: { mode: 'threshold' } }, x.asOwner());
  const dep = await x.book({ serviceIds: [x.ids.tr], first: 'Marc', phone: '0611223355' });
  assert.equal(dep.r.json.deposit, 1500);
  await x.seat(dep.appt());
  const p = await x.page(dep.token);
  assert.equal(p.pay.state, 'due');
  assert.equal(p.pay.amount, 3500);
  assert.equal(p.pay.deposit, 1500);
  assert.equal(p.pay.total, 5000);
  assert.equal((await x.tap(dep.token, { expect: 3500, tip: 0 })).status, 200);
  const py = x.selfPays()[0];
  assert.equal(py.amount, 3500);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  const sale = x.s().sales.get(dep.appt().saleId);
  assert.deepEqual(sale.payments.map((q) => [q.method, q.amount]), [['deposit', 1500], ['online', 3500]]);
  assert.equal(sale.totals.due, 5000);

  // a carnet bought at the till covers the next cut: 0 €, no payment asked
  const c = await x.book({ first: 'Noé', phone: '0611223366', start: 900 });
  const cid = c.appt().clientId;
  await x.rt.engine.run(S.checkout, { clientId: cid, lines: [{ kind: 'pack', ref: x.ids.pack, staffId: x.ids.ali }], payments: [{ method: 'card', amount: 12000 }] }, x.asOwner());
  await x.seat(c.appt());
  const q = await x.page(c.token);
  assert.equal(q.pay.state, 'covered');
  assert.equal(q.pay.amount, 0);
  assert.deepEqual(q.pay.lines, [{ name: 'Coupe · carnet 1/5', qty: 1, amount: 0, was: 3000 }]);
  const no = await x.tap(c.token, { expect: 0, tip: 0 });
  assert.equal(no.status, 409);
  assert.equal(no.json.error.code, 'nothing');
  assert.equal(x.selfPays().length, 1);
});

test('the barber adds a product and sends the link: the page asks the new amount, the old one is refused', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  await x.seat(appt());
  assert.equal((await x.page(token)).pay.amount, 3000);
  const ticket = { lines: [{ kind: 'service', ref: x.ids.cut, staffId: x.ids.ali }, { kind: 'product', ref: x.ids.oil, qty: 1, staffId: x.ids.ali }], discount: { amount: 500, reason: 'Fidélité' } };
  const sent = await x.owner.post('/api/v1/appointments/' + appt().id + '/pay-link', { ticket });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json.due, 4000);
  assert.equal(sent.json.sent, 'sms');
  assert.match(sent.json.url, /\/r\/.+\?payer$/);
  // the text leaves by the salon's channel, with the amount and his link
  const msg = [...x.s().messages.values()].find((m) => m.template === 'payLink');
  assert.ok(msg, 'the link is queued');
  assert.equal(msg.apptId, appt().id);
  // the till waits
  assert.deepEqual((await x.owner.get('/api/v1/appointments/' + appt().id)).json.appt.onlinePay.state, 'sent');
  const p = await x.page(token);
  assert.equal(p.pay.amount, 4000);
  assert.equal(p.pay.discount, 500);
  assert.deepEqual(p.pay.lines.map((l) => l.name), ['Coupe', 'Huile']);
  // the page he had open still says 30 €
  const stale = await x.tap(token, { expect: 3000, tip: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'changed');
  assert.match(stale.json.error.message, /montant a changé/);
  const ok = await x.tap(token, { expect: 4000, tip: 500 });
  assert.equal(ok.status, 200, ok.text);
  const py = x.selfPays()[0];
  assert.equal(py.amount, 4500);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  const sale = x.s().sales.get(appt().saleId);
  assert.deepEqual(sale.lines.map((l) => [l.kind, l.name]), [['service', 'Coupe'], ['product', 'Huile']]);
  assert.equal(sale.totals.discount, 500);
  assert.equal(sale.totals.total, 4000);
  assert.equal(sale.tip.amount, 500);
  assert.equal(x.s().products.get(x.ids.oil).stock, 9);
  assert.equal(sale.cashierId, [...x.s().staff.values()].find((st) => st.role === 'owner').id, 'the ticket he prepared is his');
  // a discount beyond a barber's cap is refused when the link is sent, as at the till
  const b2 = await x.book({ first: 'Sam', phone: '0611223377', start: 960 });
  await x.seat(b2.appt());
  const ali = x.s().staff.get(x.ids.ali);
  const res = x.rt.engine.run((await import('../../server/commands/selfpay.js')).requestSelfPay, { id: b2.appt().id, ticket: { lines: [{ kind: 'service', ref: x.ids.cut, staffId: x.ids.ali }], discount: { amount: 2500, reason: 'Fidélité' } } }, { actor: { t: 'staff', id: ali.id }, staff: ali, caps: capsOf(ali, x.s().settings), meta: {} });
  await assert.rejects(res, (e) => e.code === 'discount');
});

test('a double tap opens one page; another tip replaces it; a page replaced then paid is refunded', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  await x.seat(appt());
  const a = await x.tap(token, { expect: 3000, tip: 0 });
  const b = await x.tap(token, { expect: 3000, tip: 0 });
  assert.equal(a.json.url, b.json.url);
  assert.equal(x.selfPays().length, 1);
  assert.equal(x.fake.log.filter((c) => c.path === '/checkout/sessions').length, 1);
  // he goes back and adds a tip: the first page is closed, at Stripe too
  const c = await x.tap(token, { expect: 3000, tip: 500 });
  assert.notEqual(c.json.url, a.json.url);
  const [first, second] = x.selfPays();
  assert.equal(x.s().payments.get(first.id).status, 'expired');
  assert.ok(x.fake.log.some((q) => q.path === '/checkout/sessions/' + first.providerRef + '/expire'));
  // the closed page paid all the same (another tab): given back, no ticket from it
  assert.equal((await x.hook(x.paidEv(first))).status, 200);
  assert.equal(x.count('sale.completed'), 0);
  assert.equal(x.refunds().length, 1);
  assert.equal(x.refunds()[0].body.amount, '3000');
  assert.equal(x.s().payments.get(first.id).status, 'refunded');
  // the right page: the ticket
  assert.equal((await x.hook(x.paidEv(second))).status, 200);
  assert.equal(x.count('sale.completed'), 1);
  assert.equal(x.s().sales.get(appt().saleId).tip.amount, 500);
  // the refund's notice coming again changes nothing
  assert.equal((await x.hook(x.paidEv(first))).status, 200);
  assert.equal(x.refunds().length, 1);
  assert.equal(x.count('sale.completed'), 1);
});

test('the barber takes cash while the client pays online: one ticket, the online payment goes back', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  await x.seat(appt());
  assert.equal((await x.tap(token, { expect: 3000, tip: 200 })).status, 200);
  const py = x.selfPays()[0];
  // the till got there first
  const till = await x.owner.post('/api/v1/sales', { apptId: appt().id, lines: [{ kind: 'service', ref: x.ids.cut }], payments: [{ method: 'card', amount: 3000 }] });
  assert.equal(till.status, 200, till.text);
  // Stripe's notice arrives after
  const h = await x.hook(x.paidEv(py));
  assert.equal(h.status, 200, h.text);
  assert.equal(x.count('sale.completed'), 1);
  assert.equal(x.refunds().length, 1);
  assert.equal(x.refunds()[0].body.amount, '3200');
  const now = x.s().payments.get(py.id);
  assert.equal(now.status, 'refunded');
  assert.equal(now.usedBy, undefined);
  // his page says both: paid at the salon, the online payment given back; the till does not say « payé en ligne »
  const p = await x.page(token);
  assert.equal(p.pay.state, 'paid');
  assert.equal(p.pay.online, false);
  assert.equal(p.pay.refunded, 3200);
  assert.equal((await x.owner.get('/api/v1/appointments/' + appt().id)).json.appt.paidOnline, undefined);
  // again: no second refund
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.refunds().length, 1);
});

test('« Annuler et encaisser autrement » withdraws the link; a payment that lands after it, or for an amount that changed, is refunded', async (t) => {
  const x = await salon(t);
  const { token, appt } = await x.book();
  await x.seat(appt());
  const ticket = { lines: [{ kind: 'service', ref: x.ids.cut, staffId: x.ids.ali }, { kind: 'product', ref: x.ids.oil, staffId: x.ids.ali }] };
  assert.equal((await x.owner.post('/api/v1/appointments/' + appt().id + '/pay-link', { ticket })).status, 200);
  assert.equal((await x.tap(token, { expect: 4500, tip: 0 })).status, 200);
  const py = x.selfPays()[0];
  const del = await x.owner.del('/api/v1/appointments/' + appt().id + '/pay-link');
  assert.equal(del.status, 200, del.text);
  assert.equal(appt().pay, null);
  assert.equal(x.s().payments.get(py.id).status, 'expired');
  assert.ok(x.fake.log.some((q) => q.path === '/checkout/sessions/' + py.providerRef + '/expire'));
  assert.equal((await x.owner.get('/api/v1/appointments/' + appt().id)).json.appt.onlinePay, undefined);
  // the page is back to the plain ticket
  assert.equal((await x.page(token)).pay.amount, 3000);
  // the withdrawn page is paid after all
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.count('sale.completed'), 0);
  assert.equal(x.refunds().length, 1);
  assert.ok(!appt().saleId);

  // he opens the page at 30 €, the barber then adds a product and sends the link: what he pays no longer fits
  assert.equal((await x.tap(token, { expect: 3000, tip: 0 })).status, 200);
  const old = x.selfPays().find((p) => p.status === 'pending');
  await x.rt.engine.run((await import('../../server/commands/selfpay.js')).requestSelfPay, { id: appt().id, ticket, send: false }, { ...x.asOwner(), meta: {} });
  assert.equal((await x.hook(x.paidEv(old))).status, 200);
  assert.equal(x.count('sale.completed'), 0);
  assert.equal(x.refunds().length, 2);
  const p = await x.page(token);
  assert.equal(p.pay.state, 'due');
  assert.equal(p.pay.amount, 4500);
  assert.equal(p.pay.refunded, 3000);
});

test('a link pays only what it may: a stranger nothing, a friend his own place, the organiser the group', async (t) => {
  const x = await salon(t);
  const r = await browser(x.rt).post('/api/public/bookings', {
    serviceIds: [x.ids.cut], staffId: x.ids.ali, day: DAY, start: 840, first: 'Karim', phone: '0612000071',
    others: [{ serviceIds: [x.ids.cut], staffId: x.ids.ben, day: DAY, start: 840, guest: { kind: 'other', first: 'Adam', phone: '0612000072' } }]
  });
  assert.equal(r.status, 201, r.text);
  const [me, friend] = r.json.people;
  const appts = r.json.people.map((p) => () => x.s().appts.get(x.s().apptByCode.get(p.code)));
  const other = await x.book({ first: 'Zed', phone: '0612000099', start: 960 });
  // a made-up link opens nothing and pays nothing
  assert.equal((await browser(x.rt).get('/api/public/bookings/' + me.token.slice(0, -3) + 'abc')).status, 404);
  assert.equal((await x.tap(me.token.slice(0, -3) + 'abc', { expect: 3000, tip: 0 })).status, 404);
  await x.seat(appts[0]());
  await x.seat(appts[1]());
  // another client's link shows his own booking only
  assert.equal((await x.page(other.token)).pay, undefined);
  // the friend's link: his place, never the group
  const fp = await x.page(friend.token);
  assert.equal(fp.guestLink, true);
  assert.equal(fp.pay.state, 'due');
  assert.equal(fp.pay.amount, 3000);
  assert.equal(fp.pay.group, undefined);
  const no = await x.tap(friend.token, { expect: 6000, tip: 0, group: true });
  assert.equal(no.status, 403);
  // the organiser: his place, or everybody here
  const op = await x.page(me.token);
  assert.equal(op.pay.amount, 3000);
  assert.equal(op.pay.group.amount, 6000);
  assert.equal(op.pay.group.n, 2);
  assert.deepEqual(op.pay.group.names, ['Adam']);
  const go = await x.tap(me.token, { expect: 6000, tip: 0, group: true });
  assert.equal(go.status, 200, go.text);
  const py = x.selfPays()[0];
  assert.equal(py.amount, 6000);
  assert.deepEqual(py.self.group, [appts[1]().id]);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(x.count('sale.completed'), 1);
  const sale = x.s().sales.get(appts[0]().saleId);
  assert.equal(appts[1]().saleId, sale.id);
  assert.equal(appts[1]().status, 'done');
  assert.deepEqual(sale.lines.map((l) => l.staffId), [x.ids.ali, x.ids.ben]);
  // the organiser reads his receipt; the friend reads « payé », never the ticket
  const mine = (await x.page(me.token)).pay;
  assert.equal(mine.state, 'paid');
  assert.match(mine.receipt, /\/recu\//);
  const his = (await x.page(friend.token)).pay;
  assert.equal(his.state, 'paid');
  assert.equal(his.receipt, undefined);
  assert.equal(his.total, undefined);
  assert.equal(his.ticket, undefined);
});

test('a friend pays his own place from his link: one ticket for him, the others stay to pay', async (t) => {
  const x = await salon(t);
  const r = await browser(x.rt).post('/api/public/bookings', {
    serviceIds: [x.ids.cut], staffId: x.ids.ali, day: DAY, start: 840, first: 'Karim', phone: '0612000071',
    others: [{ serviceIds: [x.ids.cut], staffId: x.ids.ben, day: DAY, start: 840, guest: { kind: 'other', first: 'Adam', phone: '0612000072' } }]
  });
  const [me, friend] = r.json.people;
  const appt = (p) => x.s().appts.get(x.s().apptByCode.get(p.code));
  await x.seat(appt(me));
  await x.seat(appt(friend));
  assert.equal((await x.tap(friend.token, { expect: 3000, tip: 0 })).status, 200);
  const py = x.selfPays()[0];
  assert.equal(py.apptId, appt(friend).id);
  assert.equal(py.self.group, undefined);
  assert.equal((await x.hook(x.paidEv(py))).status, 200);
  assert.equal(appt(friend).status, 'done');
  assert.ok(!appt(me).saleId);
  const op = (await x.page(me.token)).pay;
  assert.equal(op.state, 'due');
  assert.equal(op.amount, 3000);
  assert.equal(op.group, undefined, 'nobody else of the group is left to pay');
});

test('without Stripe in production nothing shows and nothing can be asked', async (t) => {
  const x = await salon(t, { stripe: false });
  const { token, appt } = await x.book();
  await x.seat(appt());
  assert.equal((await x.page(token)).pay, undefined);
  const r = await x.tap(token, { expect: 3000, tip: 0 });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'off');
  const link = await x.owner.post('/api/v1/appointments/' + appt().id + '/pay-link', { ticket: { lines: [{ kind: 'service', ref: x.ids.cut, staffId: x.ids.ali }] } });
  assert.equal(link.status, 409);
  assert.equal(link.json.error.code, 'no_provider');
  assert.equal(x.selfPays().length, 0);
});
