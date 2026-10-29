// The payment core (PAY-01): one provider contract, webhooks that never make Stripe retry for days, refunds that go
// through the provider a payment used and never lie, disputes, payouts and their fees, the customer's ids out of the chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { providerFor, moneyMode } from '../../server/payments/provider.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { createPayment, paymentSucceeded, paymentEnded } from '../../server/commands/payments.js';
import { refundOnline } from '../../server/http/routes-public.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { browser } from '../api/client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import { piiOf } from '../../server/core/journal.js';

const DAY = '2026-11-03'; // a Tuesday
const LATER = addDays(DAY, 1);
const SECRET = 'test-secret-0123456789';
const WH = ['whsec_old', 'whsec_new'];
const SYS = { actor: { t: 'system', id: 'test' }, caps: new Set(['sale.create']) };
const SIM = { actor: { t: 'provider', id: 'simulated' }, caps: new Set() };

/** Stripe over a fake network: every call logged, answers by path; `fail` makes the next refund refused. Refunds are
 *  kept (state.refunds, ours with metadata.lx) and replayed by idempotency key, as Stripe does. */
function fakeStripe(now = () => Date.now()) {
  const log = [];
  let n = 0;
  const state = { fail: null, txns: [], pages: null, refunds: [], byKey: new Map() };
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    log.push({ method: init.method, path, query: u.search, body, idem: init.headers['idempotency-key'] || null });
    const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
    if (init.method === 'POST' && path === '/checkout/sessions') { n++; return ok({ id: 'cs_' + n, url: 'https://checkout.stripe.com/c/cs_' + n }); }
    if (init.method === 'GET' && path.startsWith('/checkout/sessions/')) return ok({ id: path.split('/').pop(), payment_intent: 'pi_' + path.split('/').pop().slice(3) });
    if (init.method === 'POST' && path === '/refunds') {
      if (state.fail) { const f = state.fail; state.fail = null; return new Response(JSON.stringify({ error: f }), { status: f.type === 'card_error' ? 402 : 400 }); }
      const key = init.headers['idempotency-key'];
      if (key && state.byKey.has(key)) return ok(state.byKey.get(key));
      const rf = { id: 're_' + log.length, status: 'succeeded', amount: Number(body.amount), payment_intent: body.payment_intent, metadata: body['metadata[lx]'] ? { lx: body['metadata[lx]'] } : {}, created: Math.floor(now() / 1000) };
      state.refunds.push(rf);
      if (key) state.byKey.set(key, rf);
      return ok(rf);
    }
    if (init.method === 'GET' && path === '/refunds') return ok({ data: state.refunds.filter((x) => x.payment_intent === u.searchParams.get('payment_intent')), has_more: false });
    if (init.method === 'GET' && path === '/balance_transactions') {
      // pages: every answer says more follow (a payout of thousands of lines)
      if (state.pages) return ok({ data: [{ id: 'txn_p' + log.length, type: 'charge', amount: 100, fee: 3, net: 97, source: { id: 'ch_p', payment_intent: 'pi_p' } }], has_more: true });
      return ok({ data: state.txns, has_more: false });
    }
    return new Response(JSON.stringify({ error: { message: 'No such route' } }), { status: 404 });
  };
  return { log, state, fetchImpl, provider: stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH.join(','), fetchImpl }) };
}
const sign = (body, secret, t = Math.floor(Date.now() / 1000)) => 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');

/** A real salon installed through the setup screen, plugged into the fake Stripe, with a barber and a cut at 50 €. */
async function production({ stripe = true } = {}) {
  const clock = { now: at(DAY, 10) };
  const env = { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13', ...(stripe ? { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: WH.join(',') } : {}) };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const fake = fakeStripe(() => clock.now);
  if (stripe) rt.pay = fake.provider;
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) });
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  const tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  return { rt, clock, owner, fake, ids: { ali, tr }, s: () => rt.engine.state };
}
const hook = (t, ev, { secret = WH[1], path = '/api/pay/stripe/webhook' } = {}) => {
  const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), ...ev });
  return browser(t.rt).raw('POST', path, body, { 'stripe-signature': sign(body, secret), 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
};
const paidEvent = (cs, amount, pi) => ({ type: 'checkout.session.completed', data: { object: { id: cs, payment_status: 'paid', amount_total: amount, payment_intent: pi, customer: 'cus_9', setup_intent: null } } });

/** A booking with a deposit, paid through Stripe's webhook: { appt, payment }. */
async function paidDeposit(t, { start = 600, first = 'Léon', phone = '0611223344', pi = 'pi_dep' } = {}) {
  const site = browser(t.rt);
  const b = await site.post('/api/public/bookings', { serviceIds: [t.ids.tr], staffId: t.ids.ali, day: LATER, start, first, phone });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  const s = t.s();
  const appt = s.appts.get(s.apptByCode.get(b.json.code));
  const py = [...s.payments.values()].find((p) => p.apptId === appt.id);
  const r = await hook(t, paidEvent(py.providerRef, py.amount, pi));
  assert.equal(r.status, 200, r.text);
  assert.equal(s.payments.get(py.id).status, 'paid');
  return { appt, py: s.payments.get(py.id), token: b.json.token };
}
/** the amounts' non-breaking spaces, as plain ones */
const sp = (x) => x.replace(/\s/g, ' ');
const count = (t, type) => t.rt.engine.journal.filter((e) => e.type === type).length;

test('a webhook signed with the second of two secrets passes, a bad one is refused, the old address still works', async () => {
  const t = await production();
  const { py } = await paidDeposit(t);
  assert.equal(py.chargeRef, 'pi_dep');
  const body = JSON.stringify({ type: 'checkout.session.expired', data: { object: { id: 'cs_x' } } });
  const bad = await browser(t.rt).raw('POST', '/api/pay/stripe/webhook', body, { 'stripe-signature': sign(body, 'whsec_other'), 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' });
  assert.equal(bad.status, 400);
  const first = await hook(t, { type: 'checkout.session.expired', data: { object: { id: 'cs_unknown' } } }, { secret: WH[0], path: '/api/stripe/webhook' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { received: true, ignored: 'unknown' });
  // another provider's endpoint: nothing plugged in answers there
  assert.equal((await browser(t.rt).raw('POST', '/api/pay/paypal/webhook', body, { 'content-type': 'application/json' })).status, 404);
  // an event we do not map, or a kind no handler knows: 200, never a retry
  assert.deepEqual((await hook(t, { type: 'customer.created', data: { object: { id: 'cus_1' } } })).json, { received: true });
});

test('the customer and card ids leave the chain: in pii under the file, dropped without one; old events still fold', async () => {
  const t = await production();
  const { appt, py } = await paidDeposit(t);
  const ev = t.rt.engine.journal.find((e) => e.type === 'payment.succeeded' && e.data.id === py.id);
  assert.equal(ev.data.cid, appt.clientId);
  assert.ok(!('customer' in ev.data) && !('pm' in ev.data), JSON.stringify(ev.data));
  assert.deepEqual(piiOf(ev.pii), { customer: 'cus_9' });
  assert.equal(py.customer, 'cus_9');
  assert.equal(t.rt.engine.journal.find((e) => e.type === 'payment.created' && e.data.id === py.id).data.cid, appt.clientId);
  // a QR at the till has no file: the processor's ids are not kept at all
  await t.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 2000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { providerRef: 'cs_qr', amount: 2000, chargeRef: 'pi_qr', customer: 'cus_qr', pm: 'seti_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  const qr = t.rt.engine.journal.find((e) => e.type === 'payment.succeeded' && e.data.id === 'py_qr');
  assert.equal(qr.pii, undefined);
  assert.ok(!('cid' in qr.data) && !JSON.stringify(qr.data).includes('cus_qr'));
  assert.equal(t.s().payments.get('py_qr').customer, null);
  // a journal written before PAY-01 (ids in data) replays the same
  const s = emptyState();
  const base = { v: 1, at: 1, actor: { t: 'system', id: 'x' }, h: 'h', p: 'p' };
  evolve(s, { ...base, id: 'e1', type: 'payment.created', data: { id: 'py_old', kind: 'deposit', amount: 1500, provider: 'stripe', providerRef: 'cs_old' } });
  evolve(s, { ...base, id: 'e2', v: 2, type: 'payment.succeeded', data: { id: 'py_old', pm: 'pm_old', customer: 'cus_old', chargeRef: 'pi_old' } });
  assert.deepEqual([s.payments.get('py_old').customer, s.payments.get('py_old').pm, s.payments.get('py_old').status], ['cus_old', 'pm_old', 'paid']);
  assert.equal(s.paymentByCharge.get('pi_old'), 'py_old');
  // erasing the file takes them out of the journal and out of memory (the deposit goes back first)
  const er = await t.owner.post('/api/v1/clients/' + appt.clientId + '/erase', { cancelUpcoming: true });
  assert.equal(er.status, 200, er.text);
  assert.equal(er.json.refunded, 1);
  assert.equal(t.s().payments.get(py.id).customer, null);
  assert.equal(t.rt.engine.journal.find((e) => e.type === 'payment.succeeded' && e.data.id === py.id).pii, undefined);
});

test('a refund made in Stripe’s dashboard is recorded once; the deposit no longer counts at the till', async () => {
  const t = await production();
  const { appt, py } = await paidDeposit(t);
  const ev = { type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_dep', amount_refunded: py.amount } } };
  assert.equal((await hook(t, ev)).status, 200);
  assert.equal(count(t, 'payment.refundedOutside'), 1);
  const e = t.rt.engine.journal.find((x) => x.type === 'payment.refundedOutside');
  assert.deepEqual({ id: e.data.id, amount: e.data.amount }, { id: py.id, amount: py.amount });
  assert.equal(e.actor.id, 'stripe');
  assert.equal(t.s().payments.get(py.id).status, 'refunded', 'on no ticket and given back in full');
  assert.equal(t.s().appts.get(appt.id).deposit.paid, 0, 'the till asks the whole price');
  assert.equal((await hook(t, ev)).status, 200);
  assert.equal(count(t, 'payment.refundedOutside'), 1, 'the same notice again writes nothing');
  // the health card hears of the last webhook
  assert.equal((await t.owner.get('/api/v1/health')).json.stripe.lastWebhook, e.at);
});

test('our own refund coming back by webhook is not an outside refund; a failed refund leaves the payment paid', async () => {
  const t = await production();
  const { py } = await paidDeposit(t);
  // a payment recorded before its charge was known: the provider is asked for it, then refunded
  t.s().payments.get(py.id).chargeRef = null;
  t.fake.log.length = 0;
  t.fake.state.fail = { type: 'invalid_request_error', message: 'Charge already refunded' };
  const r = { rt: t.rt, get s() { return t.rt.engine.state; }, meta: {} };
  const ko = await refundOnline(r, t.s().payments.get(py.id), 'Test');
  assert.equal(ko.ok, false);
  assert.match(ko.error, /already refunded/, 'the provider’s words for the Comptoir');
  assert.equal(t.s().payments.get(py.id).status, 'paid');
  assert.deepEqual(t.fake.log.map((x) => x.method + ' ' + x.path), ['GET /checkout/sessions/' + py.providerRef, 'POST /refunds']);
  t.fake.log.length = 0;
  const ok = await refundOnline(r, t.s().payments.get(py.id), 'Annulé par le salon');
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(t.fake.log.map((x) => x.method + ' ' + x.path), ['GET /checkout/sessions/' + py.providerRef, 'POST /refunds']);
  assert.equal(t.fake.log[1].body.payment_intent, 'pi_' + py.providerRef.slice(3));
  assert.equal(t.fake.log[1].idem, 'lx-rf-' + py.id, 'the whole payment keeps its one key');
  assert.equal(t.s().payments.get(py.id).status, 'refunded');
  await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: 'pi_dep', amount_refunded: py.amount } } });
  assert.equal(count(t, 'payment.refundedOutside'), 0);
});

test('a dispute is recorded with its answer date, closed once, shown in the feed and in Caisse with its dossier', async () => {
  const t = await production();
  const { py } = await paidDeposit(t);
  const due = Math.floor(at(addDays(DAY, 9), 23, 59) / 1000);
  const dis = (type, status) => ({ type, data: { object: { id: 'du_1', payment_intent: 'pi_dep', amount: py.amount, reason: 'fraudulent', status, evidence_details: { due_by: due } } } });
  assert.equal((await hook(t, dis('charge.dispute.created', 'needs_response'))).status, 200);
  const d = t.s().disputes.get('du_1');
  assert.deepEqual({ pid: d.pid, amount: d.amount, dueBy: d.dueBy, status: d.status }, { pid: py.id, amount: py.amount, dueBy: due * 1000, status: 'open' });
  await hook(t, dis('charge.dispute.updated', 'needs_response'));
  assert.equal(count(t, 'payment.disputed'), 1, 'nothing changed, nothing written');
  const feed = (await t.owner.get('/api/v1/feed')).json.items;
  assert.ok(feed.some((f) => f.kind === 'dispute' && sp(f.title) === 'Litige ouvert · 15 € · réponse avant le 12/11'), JSON.stringify(feed.map((f) => f.title)));
  const online = (await t.owner.get('/api/v1/payments/online')).json;
  const item = online.todo.find((x) => x.kind === 'dispute');
  assert.equal(item.paymentId, py.id);
  assert.equal(online.payments.find((x) => x.id === py.id).status, 'disputed');
  const dossier = (await t.owner.get('/api/v1/payments/' + py.id + '/evidence')).json.text;
  for (const want of ['Réservation : faite le', 'sur le site du salon', 'Conditions générales de vente acceptées', 'Litige : du_1', 'fraude déclarée', 'Client : Léon']) assert.ok(dossier.includes(want), want + '\n' + dossier);
  assert.ok(!/0611223344|\+33611223344|06 11 22 33 44|@/.test(dossier), 'no number, no e-mail');
  assert.equal((await hook(t, dis('charge.dispute.closed', 'lost'))).status, 200);
  assert.equal(t.s().disputes.get('du_1').status, 'lost');
  await hook(t, dis('charge.dispute.closed', 'lost'));
  assert.equal(count(t, 'payment.disputeClosed'), 1);
  assert.deepEqual(t.rt.engine.journal.find((e) => e.type === 'payment.disputeClosed').data, { id: py.id, disputeId: 'du_1', status: 'lost' });
  assert.ok(!(await t.owner.get('/api/v1/payments/online')).json.todo.some((x) => x.kind === 'dispute'));
});

test('a payout records its lines and fees; the payments it carried get fee, net and payout', async () => {
  const t = await production();
  const a = await paidDeposit(t, { start: 600, pi: 'pi_a' });
  const b = await paidDeposit(t, { start: 720, first: 'Bruno', phone: '0622222222', pi: 'pi_b' });
  t.fake.state.txns = [
    { id: 'txn_1', type: 'charge', amount: 1500, fee: 47, net: 1453, source: { id: 'ch_a', payment_intent: 'pi_a' } },
    { id: 'txn_2', type: 'charge', amount: 1500, fee: 47, net: 1453, source: { id: 'ch_b', payment_intent: 'pi_b' } },
    { id: 'txn_3', type: 'charge', amount: 2000, fee: 55, net: 1945, source: { id: 'ch_z', payment_intent: 'pi_elsewhere' } },
    { id: 'txn_4', type: 'payout', amount: -4851, fee: 0, net: -4851, source: 'po_1' }
  ];
  const arrival = Math.floor(at(addDays(DAY, 2), 9) / 1000);
  const ev = { type: 'payout.paid', data: { object: { id: 'po_1', amount: 4851, arrival_date: arrival } } };
  assert.equal((await hook(t, ev)).status, 200);
  const call = t.fake.log.find((x) => x.path === '/balance_transactions');
  assert.match(decodeURIComponent(call.query), /payout=po_1/);
  assert.match(decodeURIComponent(call.query), /expand\[\]=data\.source/);
  const e = t.rt.engine.journal.find((x) => x.type === 'payout.recorded');
  assert.deepEqual({ id: e.data.id, amount: e.data.amount, gross: e.data.gross, fee: e.data.fee, arrival: e.data.arrival }, { id: 'po_1', amount: 4851, gross: 5000, fee: 149, arrival: arrival * 1000 });
  assert.deepEqual(e.data.items.map((x) => x.pid), [a.py.id, b.py.id, null], 'the unknown charge keeps pid null, the payout line is left out');
  for (const p of [a.py, b.py]) assert.deepEqual((({ fee, net, payoutId }) => ({ fee, net, payoutId }))(t.s().payments.get(p.id)), { fee: 47, net: 1453, payoutId: 'po_1' });
  await hook(t, ev);
  assert.equal(count(t, 'payout.recorded'), 1, 'once per payout');
  const online = (await t.owner.get('/api/v1/payments/online')).json;
  assert.deepEqual(online.payouts.map((x) => ({ id: x.id, amount: x.amount, fee: x.fee, count: x.count })), [{ id: 'po_1', amount: 4851, fee: 149, count: 3 }]);
  assert.equal(online.payments.find((x) => x.id === a.py.id).fee, 47);
  const feed = (await t.owner.get('/api/v1/feed')).json.items;
  assert.ok(feed.some((f) => sp(f.title) === 'Virement Stripe 48,51 € · frais 1,49 €'), JSON.stringify(feed.map((f) => f.title)));
});

test('a payment whose amount differs is answered 200 { ignored: amount }, so Stripe stops retrying', async () => {
  const t = await production();
  const site = browser(t.rt);
  const b = await site.post('/api/public/bookings', { serviceIds: [t.ids.tr], staffId: t.ids.ali, day: LATER, start: 600, first: 'Léon', phone: '0611223344' });
  const py = [...t.s().payments.values()].find((p) => p.apptId === t.s().apptByCode.get(b.json.code));
  const r = await hook(t, paidEvent(py.providerRef, py.amount + 100, 'pi_x'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { received: true, ignored: 'amount' });
  assert.equal(t.s().payments.get(py.id).status, 'pending');
});

test('the till’s online refund: a provider gone answers provider_gone, « hors caisse » records it; a dashboard refund is never refunded twice', async () => {
  // a payment made through Stripe, Stripe since unplugged (production on the simulated provider)
  const t = await production({ stripe: false });
  assert.equal(t.rt.pay.name, 'simulated');
  await t.rt.engine.run(createPayment, { id: 'py_old', kind: 'qr', amount: 5000, provider: 'stripe', providerRef: 'cs_old', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { id: 'py_old', amount: 5000, chargeRef: 'pi_old' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  const sale = await t.owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: t.ids.tr, staffId: t.ids.ali }], payments: [{ method: 'online', amount: 5000, ref: 'py_old' }] }, { 'x-request-id': 'till-sale-1' });
  assert.equal(sale.status, 200, JSON.stringify(sale.json));
  const path = '/api/v1/sales/' + sale.json.id + '/refund';
  const gone = await t.owner.post(path, { amount: 5000, method: 'online', reason: 'Prestation ratée' });
  assert.equal(gone.status, 409);
  assert.equal(gone.json.error.code, 'provider_gone');
  assert.match(gone.json.error.message, /Ce paiement est passé par Stripe, qui n’est plus branché/);
  assert.equal(t.s().refunds.size, 0);
  assert.throws(() => providerFor(t.rt, 'stripe'), (e) => e.code === 'provider_gone');
  const outside = await t.owner.post(path, { amount: 5000, method: 'online', reason: 'Prestation ratée', outside: true });
  assert.equal(outside.status, 200, JSON.stringify(outside.json));
  assert.equal(t.s().refunds.get(outside.json.id).providerRef, 'outside');

  // with Stripe: a partial refund in the dashboard after the ticket shows in Caisse; the credit note then moves nothing
  const u = await production();
  await u.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 5000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await u.rt.engine.run(paymentSucceeded, { id: 'py_qr', amount: 5000, chargeRef: 'pi_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  const s2 = await u.owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: u.ids.tr, staffId: u.ids.ali }], payments: [{ method: 'online', amount: 5000, ref: 'py_qr' }] }, { 'x-request-id': 'till-sale-2' });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  await hook(u, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 2000 } } });
  const todo = (await u.owner.get('/api/v1/payments/online')).json.todo;
  assert.deepEqual(todo.filter((x) => x.kind === 'outside').map((x) => ({ amount: x.amount, saleId: x.saleId })), [{ amount: 2000, saleId: s2.json.id }]);
  assert.equal(u.s().payments.get('py_qr').status, 'paid', 'on a ticket: the avoir says it, not the payment');
  u.fake.log.length = 0;
  const p2 = '/api/v1/sales/' + s2.json.id + '/refund';
  const avoir = await u.owner.post(p2, { amount: 3000, method: 'online', reason: 'Geste commercial' });
  assert.equal(avoir.status, 200, JSON.stringify(avoir.json));
  assert.deepEqual(u.fake.log.filter((x) => x.path === '/refunds').map((x) => x.body.amount), ['1000'], 'only what Stripe had not given back yet');
  assert.ok(!(await u.owner.get('/api/v1/payments/online')).json.todo.some((x) => x.kind === 'outside'));
  // Stripe's notice of that refund repeats what we know
  await hook(u, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3000 } } });
  assert.equal(count(u, 'payment.refundedOutside'), 1);
});

test('the till’s credit note failing after Stripe refunded: the refund is recorded as made outside', async () => {
  const t = await production();
  await t.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 5000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { id: 'py_qr', amount: 5000, chargeRef: 'pi_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  const sale = await t.owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: t.ids.tr, staffId: t.ids.ali }], payments: [{ method: 'online', amount: 5000, ref: 'py_qr' }] }, { 'x-request-id': 'till-sale-3' });
  assert.equal(sale.status, 200);
  // the day is sealed between the checks and the credit note (another device's Z): Stripe has refunded already
  const real = t.fake.provider.refund;
  t.rt.pay = { ...t.fake.provider, refund: async (...a) => { const res = await real(...a); t.rt.engine.state.closures.set(DAY, { day: DAY }); return res; } };
  const r = await t.owner.post('/api/v1/sales/' + sale.json.id + '/refund', { amount: 5000, method: 'online', reason: 'Prestation ratée' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'day_closed');
  t.rt.engine.state.closures.delete(DAY);
  const e = t.rt.engine.journal.find((x) => x.type === 'payment.refundedOutside');
  assert.ok(e, 'the money out is visible');
  assert.deepEqual({ id: e.data.id, amount: e.data.amount }, { id: 'py_qr', amount: 5000 });
  assert.ok((await t.owner.get('/api/v1/payments/online')).json.todo.some((x) => x.kind === 'outside' && x.amount === 5000));
});

test('Stripe’s own words never reach a client: a refused card says it in French', async () => {
  const t = await production();
  const raw = 'Your card was declined. Request req_123 for acct_456.';
  t.rt.pay = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH[0], fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: raw } }), { status: 402 }) });
  const site = browser(t.rt);
  const r = await site.post('/api/public/bookings', { serviceIds: [t.ids.tr], staffId: t.ids.ali, day: LATER, start: 600, first: 'Léon', phone: '0611223344' });
  assert.equal(r.status, 402);
  assert.deepEqual(r.json.error, { code: 'declined', message: 'Paiement refusé par ta banque. Essaie une autre carte.' });
  assert.ok(!r.text.includes('declined.') && !r.text.includes('req_123'));
  t.rt.pay = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH[0], fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'api_error', message: 'Internal glitch acct_456' } }), { status: 500 }) });
  const r2 = await site.post('/api/public/bookings', { serviceIds: [t.ids.tr], staffId: t.ids.ali, day: LATER, start: 720, first: 'Bruno', phone: '0622222222' });
  assert.equal(r2.status, 502);
  assert.equal(r2.json.error.message, 'Paiement en ligne indisponible, réessaie dans un instant.');
  assert.ok(!r2.text.includes('acct_456'));
  // an off-session charge refused is an answer, not an error (PAY-06)
  const p = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH[0], fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'card_error', code: 'authentication_required', message: 'auth', payment_intent: { id: 'pi_auth' } } }), { status: 402 }) });
  assert.deepEqual(await p.chargeSaved({ customer: 'cus', pm: 'pm', amount: 1000, label: 'x', idem: '1' }), { ref: 'pi_auth', status: 'requires_action', code: 'authentication_required' });
  assert.equal(p.caps.offSession, true);
});

test('moneyMode: demo, live, test and off', async () => {
  const fake = (mode, journal, pay) => ({ rt: { cfg: { mode }, pay }, s: { mode: journal } });
  assert.equal(moneyMode(fake('demo', 'demo', { name: 'simulated', live: false })), 'demo');
  assert.equal(moneyMode(fake('production', 'production', { name: 'stripe', live: true })), 'live');
  assert.equal(moneyMode(fake('production', 'production', { name: 'stripe', live: false })), 'test');
  assert.equal(moneyMode(fake('production', 'production', { name: 'simulated', live: false })), 'off');
  // a demo journal opened in production is not the demo
  assert.equal(moneyMode(fake('production', 'demo', { name: 'simulated', live: false })), 'off');
});

test('a payout still being reconciled is not recorded until Stripe says it is done; a cut list says so', async () => {
  const t = await production();
  const a = await paidDeposit(t, { pi: 'pi_a' });
  t.fake.state.txns = [{ id: 'txn_1', type: 'charge', amount: 1500, fee: 47, net: 1453, source: { id: 'ch_a', payment_intent: 'pi_a' } }];
  const po = (type, st) => ({ type, data: { object: { id: 'po_9', amount: 1453, arrival_date: Math.floor(at(addDays(DAY, 2), 9) / 1000), reconciliation_status: st } } });
  t.fake.log.length = 0;
  const early = await hook(t, po('payout.paid', 'in_progress'));
  assert.equal(early.status, 200);
  assert.deepEqual(early.json, { received: true, ignored: 'reconciling' });
  assert.equal(count(t, 'payout.recorded'), 0);
  assert.ok(!t.fake.log.some((x) => x.path === '/balance_transactions'), 'its lines are not asked yet');
  assert.equal((await hook(t, po('payout.reconciliation_completed', 'completed'))).status, 200);
  assert.equal(count(t, 'payout.recorded'), 1);
  assert.equal(t.s().payments.get(a.py.id).fee, 47);
  assert.equal(t.rt.engine.journal.find((e) => e.type === 'payout.recorded').data.truncated, undefined);
  // a payout.paid already completed (it came after the reconciliation) records it right away, once
  t.fake.state.pages = true;
  assert.equal((await hook(t, po('payout.paid', 'completed'))).status, 200);
  assert.equal(count(t, 'payout.recorded'), 1, 'once per payout');
  const big = { type: 'payout.paid', data: { object: { id: 'po_big', amount: 500, arrival_date: 1, reconciliation_status: 'completed' } } };
  assert.equal((await hook(t, big)).status, 200);
  const e = t.rt.engine.journal.find((x) => x.type === 'payout.recorded' && x.data.id === 'po_big');
  assert.equal(e.data.items.length, 5, 'five pages read');
  assert.equal(e.data.truncated, true, 'and the event says the list was cut');
});

test('our own refund whose notice outruns our record is not taken for a dashboard one; a dashboard refund beside it is', async () => {
  const t = await production();
  await t.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 5000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { id: 'py_qr', amount: 5000, chargeRef: 'pi_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  // refundOnline on another instance: Stripe has refunded, our paymentEnded is not written yet
  await t.fake.provider.refund('pi_qr', 2000, 'py_qr-0');
  assert.equal(t.fake.log.at(-1).body['metadata[lx]'], 'py_qr-0', 'our refunds are tagged');
  // and the owner gives back 10 € more from Stripe's dashboard (no tag)
  t.fake.state.refunds.push({ id: 're_dash', status: 'succeeded', amount: 1000, payment_intent: 'pi_qr', metadata: {}, created: Math.floor(t.clock.now / 1000) });
  const early = await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3000 } } });
  assert.equal(early.status, 503, 'ours on its way: Stripe sends it again later');
  assert.equal(count(t, 'payment.refundedOutside'), 0, 'nothing taken for a dashboard refund');
  assert.ok(t.fake.log.some((x) => x.method === 'GET' && x.path === '/refunds'), 'Stripe was asked whose refunds they are');
  // our record lands: the notice again records the dashboard's 10 € only, once
  await t.rt.engine.run(paymentEnded, { id: 'py_qr', status: 'refunded', reason: 'x', amount: 2000 }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  assert.equal((await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3000 } } })).status, 200);
  assert.deepEqual(t.rt.engine.journal.filter((e) => e.type === 'payment.refundedOutside').map((e) => e.data.amount), [1000]);
  await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3000 } } });
  assert.equal(count(t, 'payment.refundedOutside'), 1);
  // ours whose record never came (its write failed): after a while the money out is recorded all the same
  await t.fake.provider.refund('pi_qr', 500, 'py_qr-3000');
  assert.equal((await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3500 } } })).status, 503);
  t.clock.now += 11 * 60000;
  assert.equal((await hook(t, { type: 'charge.refunded', data: { object: { id: 'ch_qr', payment_intent: 'pi_qr', amount_refunded: 3500 } } })).status, 200);
  assert.deepEqual(t.rt.engine.journal.filter((e) => e.type === 'payment.refundedOutside').map((e) => e.data.amount), [1000, 500]);
});

test('the till refund: a replayed request refunds once; « hors caisse » never records more than the payment holds; a full refund by credit notes reads refunded', async () => {
  const t = await production();
  await t.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 3000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { id: 'py_qr', amount: 3000, chargeRef: 'pi_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  const sale = await t.owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: t.ids.tr, staffId: t.ids.ali }], payments: [{ method: 'online', amount: 3000, ref: 'py_qr' }, { method: 'card', amount: 2000 }] }, { 'x-request-id': 'till-sale-9' });
  assert.equal(sale.status, 200, sale.text);
  const path = '/api/v1/sales/' + sale.json.id + '/refund';
  t.fake.log.length = 0;
  const one = await t.owner.post(path, { amount: 1000, method: 'online', reason: 'Geste commercial' }, { 'x-request-id': 'refund-req-1' });
  assert.equal(one.status, 200, one.text);
  const two = await t.owner.post(path, { amount: 1000, method: 'online', reason: 'Geste commercial' }, { 'x-request-id': 'refund-req-1' });
  assert.equal(two.status, 200, two.text);
  assert.equal(two.json.id, one.json.id, 'the first answer');
  const posts = t.fake.log.filter((x) => x.method === 'POST' && x.path === '/refunds');
  assert.equal(posts.length, 1, 'one refund at Stripe');
  assert.equal(posts[0].idem, 'lx-rf-' + sale.json.id + '-rq-refund-req-1', 'keyed by the request');
  assert.equal(t.s().refunds.size, 1);
  // 10 € given back; « hors caisse » may record at most the 20 € no credit note holds
  const over = await t.owner.post(path, { amount: 2500, method: 'online', reason: 'Geste commercial', outside: true });
  assert.equal(over.status, 400, over.text);
  assert.match(sp(over.json.error.message), /Au plus 20 €/);
  // a refused refund is not a refused card
  t.fake.state.fail = { type: 'card_error', code: 'expired_card', message: 'The card has expired.' };
  const ko = await t.owner.post(path, { amount: 2000, method: 'online', reason: 'Geste commercial' });
  assert.equal(ko.status, 402);
  assert.equal(ko.json.error.message, 'Remboursement refusé par Stripe : The card has expired.');
  const rest = await t.owner.post(path, { amount: 2000, method: 'online', reason: 'Geste commercial' });
  assert.equal(rest.status, 200, rest.text);
  const row = (await t.owner.get('/api/v1/payments/online')).json.payments.find((x) => x.id === 'py_qr');
  assert.deepEqual({ status: row.status, refunded: row.refunded }, { status: 'refunded', refunded: 3000 });
});

test('a deposit whose visit will not happen is kept on a ticket or given back from Caisse; never both, never twice', async () => {
  const t = await production();
  const a = await paidDeposit(t, { start: 600, pi: 'pi_a' });
  const b = await paidDeposit(t, { start: 720, first: 'Bruno', phone: '0622222222', pi: 'pi_b' });
  // a deposit still waiting for its visit is cashed in on its ticket, not here
  assert.equal((await t.owner.post('/api/v1/payments/' + a.py.id + '/keep', {})).status, 409);
  // the salon cancels both without giving the deposits back (a late call), then the day goes by
  for (const x of [a, b]) assert.equal((await t.owner.post('/api/v1/appointments/' + x.appt.id + '/cancel', { reason: 'Appel tardif' })).status, 200);
  t.clock.now = at(addDays(DAY, 3), 10);
  const todo = (await t.owner.get('/api/v1/payments/online')).json.todo.filter((x) => x.kind === 'unused');
  assert.deepEqual(todo.map((x) => ({ id: x.paymentId, st: x.apptStatus, by: x.cancelBy, first: x.first, day: x.day })).sort((x, y) => x.first.localeCompare(y.first)),
    [{ id: b.py.id, st: 'cancelled', by: 'salon', first: 'Bruno', day: LATER }, { id: a.py.id, st: 'cancelled', by: 'salon', first: 'Léon', day: LATER }]);
  // the till's appointment path refuses a cancelled visit: Caisse keeps the deposit on its own ticket instead
  const keep = await t.owner.post('/api/v1/payments/' + a.py.id + '/keep', {}, { 'x-request-id': 'keep-req-1' });
  assert.equal(keep.status, 200, keep.text);
  const sale = t.s().sales.get(keep.json.id);
  assert.deepEqual(sale.lines.map((l) => ({ kind: l.kind, name: l.name, net: l.net })), [{ kind: 'fee', name: 'Acompte conservé · annulation du 04/11', net: a.py.amount }]);
  assert.deepEqual(sale.payments.map((p) => ({ method: p.method, paymentId: p.paymentId })), [{ method: 'online', paymentId: a.py.id }]);
  assert.equal(sale.clientId, a.appt.clientId);
  assert.equal(t.s().payments.get(a.py.id).usedBy, sale.id);
  assert.equal((await t.owner.post('/api/v1/payments/' + a.py.id + '/keep', {}, { 'x-request-id': 'keep-req-1' })).json.id, sale.id, 'a replay: the same ticket');
  assert.equal((await t.owner.post('/api/v1/payments/' + a.py.id + '/keep', {})).status, 409, 'kept already');
  assert.equal((await t.owner.post('/api/v1/payments/' + a.py.id + '/refund', {})).status, 409, 'kept: not refunded too');
  t.fake.log.length = 0;
  const back = await t.owner.post('/api/v1/payments/' + b.py.id + '/refund', {});
  assert.equal(back.status, 200, back.text);
  assert.equal(t.fake.log.filter((x) => x.path === '/refunds').length, 1);
  assert.equal(t.s().payments.get(b.py.id).status, 'refunded');
  assert.equal((await t.owner.post('/api/v1/payments/' + b.py.id + '/keep', {})).status, 409, 'refunded: not kept too');
  assert.ok(!(await t.owner.get('/api/v1/payments/online')).json.todo.some((x) => x.kind === 'unused'), 'both handled');
  // a barber neither keeps nor refunds
  const barber = [...t.s().staff.values()].find((x) => x.role === 'barber');
  assert.equal(capsOf(barber, t.s().settings).has('sale.refund'), false);
});

test('a dispute status that ends it without a win or loss closes it; hooks run only when something was written', async () => {
  const t = await production();
  const { py } = await paidDeposit(t);
  const { DISPUTE_HOOKS } = await import('../../server/payments/handlers.js');
  const calls = [];
  DISPUTE_HOOKS.push({ kind: 'deposit', run: async (r, ev, p, written) => { calls.push(written); } });
  try {
    const dis = (type, status) => ({ type, data: { object: { id: 'du_2', payment_intent: 'pi_dep', amount: py.amount, reason: 'general', status, evidence_details: { due_by: 0 } } } });
    await hook(t, dis('charge.dispute.created', 'warning_needs_response'));
    await hook(t, dis('charge.dispute.updated', 'warning_needs_response'));
    assert.equal(t.s().disputes.get('du_2').status, 'open');
    await hook(t, dis('charge.dispute.closed', 'prevented'));
    assert.equal(t.s().disputes.get('du_2').status, 'warning_closed');
    await hook(t, dis('charge.dispute.closed', 'prevented'));
    assert.deepEqual(calls, [{ disputed: true, closed: false }, { disputed: false, closed: true }], 'twice: opened, closed; never for a repeat');
  } finally { DISPUTE_HOOKS.length = 0; }
});

test('every « à traiter » line leads to a sale the server accepts: a deposit still to cash in on its ticket, a QR on a free sale', async () => {
  const t = await production();
  const a = await paidDeposit(t, { start: 600, pi: 'pi_a' });
  await t.rt.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 5000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.rt.engine.run(paymentSucceeded, { id: 'py_qr', amount: 5000, chargeRef: 'pi_qr' }, { actor: { t: 'provider', id: 'stripe' }, caps: new Set() });
  // the visit's day went by without a ticket (the barber never cashed it in), and the QR was never put on one
  t.clock.now = at(addDays(DAY, 3), 10);
  const todo = (await t.owner.get('/api/v1/payments/online')).json.todo.filter((x) => x.kind === 'unused');
  const dep = todo.find((x) => x.paymentId === a.py.id), qr = todo.find((x) => x.paymentId === 'py_qr');
  assert.deepEqual({ st: dep.apptStatus, appt: dep.apptId }, { st: 'booked', appt: a.appt.id }, 'Online.tsx sends it to /caisse?rdv=');
  assert.equal(qr.apptId, null, 'Online.tsx sends it to /caisse?vente=1&paiement=');
  const s1 = await t.owner.post('/api/v1/sales', { apptId: a.appt.id, lines: [{ kind: 'service', ref: t.ids.tr, staffId: t.ids.ali }], payments: [{ method: 'deposit', amount: a.py.amount, ref: a.py.id }, { method: 'card', amount: 5000 - a.py.amount }] });
  assert.equal(s1.status, 200, s1.text);
  const s2 = await t.owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: t.ids.tr, staffId: t.ids.ali }], payments: [{ method: 'online', amount: 5000, ref: 'py_qr' }] });
  assert.equal(s2.status, 200, s2.text);
  assert.ok(!(await t.owner.get('/api/v1/payments/online')).json.todo.length, 'nothing left');
});
