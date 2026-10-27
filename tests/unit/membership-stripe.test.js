// Memberships billed by Stripe (PAY-03): the Billing adapter over a recorded fake network, webhooks that cannot
// desynchronise (re-read from Stripe, out of order, twice), dunning and the end for want of payment, the portal's
// cancellation, the member's own page under a link that expires, the 14-day withdrawal with its refund and credit
// note, « send me my link » and the cancellation without it, disputes, the Comptoir's routes, and the demo's test page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { stripeProvider, cardLabel } from '../../server/payments/stripe.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff, setCredentials } from '../../server/commands/team.js';
import { hashSecret } from '../../server/auth/password.js';
import { addService } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { checkout } from '../../server/commands/sales.js';
import { statusIn, addMonths, cover } from '../../server/domain/membership.js';
import { readMemberToken, memberToken, MEMBER_TEXT_TTL } from '../../server/auth/member-token.js';
import { membershipRoutes, LOOKUP_PHONE, LOOKUP_EMAIL, EXPIRED, SOON, ALREADY, START_DAYS } from '../../server/http/routes-membership.js';
import { router, errorResponse } from '../../server/http/kit.js';
import { refundNo } from '../../server/domain/cash.js';
import { browser, testRuntime } from '../api/client.js';
import { instantOf, addDays, localParts } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const at = (day, h = 10, m = 0) => instantOf(day, h * 60 + m);
const sec = (ms) => Math.floor(ms / 1000);
const SECRET = 'test-secret-0123456789';
const WH = 'whsec_billing';
const ORIGIN = 'https://salon.test';

/**
 * Stripe over a fake network: every call logged (method, path, query, body, idempotency key), and a small Stripe behind
 * it: prices by lookup key, checkout sessions, subscriptions (updated, deleted), invoices (voided), refunds replayed by
 * their key, portal sessions. The tests put subscriptions and invoices in `state` as Stripe would have them.
 */
function fakeStripe(now) {
  const log = [];
  let n = 0;
  const state = { prices: [], sessions: new Map(), subs: new Map(), invoices: new Map(), refunds: [], byKey: new Map() };
  const ok = (x) => new Response(JSON.stringify(x), { status: 200 });
  const no = (msg, status = 404) => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: msg } }), { status });
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const idem = init.headers['idempotency-key'] || null;
    log.push({ method: init.method, path, query: Object.fromEntries(u.searchParams), body, idem });
    const seg = path.split('/').filter(Boolean);
    if (idem && state.byKey.has(idem)) return ok(state.byKey.get(idem));
    const keep = (x) => { if (idem) state.byKey.set(idem, x); return ok(x); };
    if (init.method === 'GET' && path === '/prices') return ok({ data: state.prices.filter((p) => p.lookup_key === u.searchParams.get('lookup_keys[]') && p.active) });
    if (init.method === 'POST' && path === '/prices') { const p = { id: 'price_' + ++n, lookup_key: body.lookup_key, unit_amount: Number(body.unit_amount), active: true }; state.prices.push(p); return keep(p); }
    if (init.method === 'POST' && path === '/checkout/sessions') { const x = { id: 'cs_' + ++n, url: 'https://checkout.stripe.com/c/pay/cs_' + n, body }; state.sessions.set(x.id, x); return keep(x); }
    if (init.method === 'GET' && seg[0] === 'checkout') { const x = state.sessions.get(seg[2]); return x ? ok({ id: x.id, subscription: x.subscription || null, payment_intent: null }) : no('No such session'); }
    if (seg[0] === 'subscriptions') {
      const x = state.subs.get(seg[1]);
      if (!x) return no('No such subscription');
      if (init.method === 'GET') return ok(x);
      if (init.method === 'DELETE') { if (x.status === 'canceled') return no('already canceled', 400); x.status = 'canceled'; x.cancellation_details = { reason: 'cancellation_requested' }; return ok(x); }
      if (body.cancel_at_period_end) x.cancel_at_period_end = body.cancel_at_period_end === 'true';
      if (body['pause_collection[behavior]']) x.pause_collection = { behavior: body['pause_collection[behavior]'] };
      if (body.pause_collection === '') x.pause_collection = null;
      return ok(x);
    }
    if (init.method === 'GET' && path === '/invoices') return ok({ data: [...state.invoices.values()].filter((i) => i.parent.subscription_details.subscription === u.searchParams.get('subscription') && i.status === u.searchParams.get('status')) });
    if (seg[0] === 'invoices') {
      const x = state.invoices.get(seg[1]);
      if (!x) return no('No such invoice');
      if (init.method === 'POST' && seg[2] === 'void') { x.status = 'void'; return ok(x); }
      return ok(x);
    }
    if (init.method === 'POST' && path === '/refunds') { const rf = { id: 're_' + ++n, status: 'succeeded', amount: Number(body.amount), payment_intent: body.payment_intent, metadata: body['metadata[lx]'] ? { lx: body['metadata[lx]'] } : {}, created: sec(now()) }; state.refunds.push(rf); return keep(rf); }
    if (init.method === 'GET' && path === '/refunds') return ok({ data: state.refunds.filter((x) => x.payment_intent === u.searchParams.get('payment_intent')), has_more: false });
    if (init.method === 'POST' && path === '/billing_portal/sessions') return ok({ id: 'bps_' + ++n, url: 'https://billing.stripe.com/p/session/bps_' + n });
    return no('No such route');
  };
  /** a subscription as Stripe holds it, for this member */
  const sub = (id, memberId, o = {}) => {
    const x = { id, status: 'active', metadata: { lx: memberId }, customer: 'cus_' + id.slice(4), cancel_at_period_end: false, cancel_at: null, pause_collection: null, cancellation_details: { reason: null },
      default_payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242' } }, items: { data: [{ current_period_end: o.periodEnd || 0 }] }, latest_invoice: null, ...o.raw };
    state.subs.set(id, x);
    return x;
  };
  /** an invoice of that subscription: paid by its PaymentIntent, or still open after attempt n */
  const invoice = (id, subId, o) => {
    const x = { id, status: o.status || 'paid', amount_paid: o.status === 'open' ? 0 : o.amount, amount_due: o.amount, parent: { subscription_details: { subscription: subId } },
      lines: { data: [{ period: { start: sec(o.start), end: sec(o.end) } }] }, payments: { data: o.pi ? [{ status: o.status === 'open' ? 'open' : 'paid', payment: { type: 'payment_intent', payment_intent: o.pi } }] : [] },
      hosted_invoice_url: 'https://invoice.stripe.com/i/' + id, attempt_count: o.attempt || 0, next_payment_attempt: o.nextAt ? sec(o.nextAt) : null };
    state.invoices.set(id, x);
    const s = state.subs.get(subId);
    if (s) { s.latest_invoice = id; s.items.data[0].current_period_end = sec(o.end); }
    return x;
  };
  const calls = (method, path) => log.filter((x) => x.method === method && (typeof path === 'string' ? x.path === path : path.test(x.path)));
  return { log, state, fetchImpl, sub, invoice, calls };
}
const sign = (body, secret, t = sec(Date.now())) => 't=' + t + ',v1=' + createHmac('sha256', secret).update(t + '.' + body).digest('hex');

/** A real salon (production, a live key over the fake network), a barber, a classic cut at 20 €, memberships on. */
async function salon({ key = 'sk_live_x', day = DAY } = {}) {
  const clock = { now: at(day) };
  const env = { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13', STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WH };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const fake = fakeStripe(() => clock.now);
  rt.pay = stripeProvider({ secretKey: key, webhookSecret: WH, fetchImpl: fake.fetchImpl });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: rt.engine.state.staff.get(boss.id), caps: capsOf(rt.engine.state.staff.get(boss.id), rt.engine.state.settings), meta: { siteUrl: ORIGIN + '/' } });
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week }, asOwner())).id;
  await rt.engine.run(setCredentials, { id: ali, pinHash: await hashSecret('2468') }, asOwner());
  const cut = (await rt.engine.run(addService, { name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, asOwner())).id;
  await rt.engine.run(updateSettings, { membership: { enabled: true, plans: [{ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [cut] }] } }, asOwner());
  const go = (d, h = 10, m = 0) => { clock.now = at(d, h, m); };
  return { rt, clock, go, fake, owner, asOwner, ids: { ali, cut, owner: boss.id }, s: () => rt.engine.state };
}
const hook = (t, type, object) => {
  const body = JSON.stringify({ id: 'evt_' + Math.random().toString(36).slice(2), type, data: { object } });
  return browser(t.rt).raw('POST', '/api/pay/stripe/webhook', body, { 'stripe-signature': sign(body, WH), 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
};
let phones = 0;
const nextPhone = () => '06 ' + String(20000000 + ++phones * 7919).slice(-8).replace(/(\d{2})(?=\d)/g, '$1 ');
/** subscribe from the site: the member pending behind its checkout */
async function subscribe(t, o = {}) {
  const res = await browser(t.rt).post('/api/public/memberships', { planId: 'essentiel', first: o.first || 'Karim', phone: o.phone || nextPhone(), email: o.email || 'karim@exemple.fr', startNow: o.startNow !== false, cgv: '2026-10-27' });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const cs = [...t.fake.state.sessions.values()].pop();
  return { ...res.json, cs, id: cs.body.client_reference_id };
}
/** subscribe, then Stripe's first invoice paid: the period runs a month from today */
async function member(t, o = {}) {
  const m = await subscribe(t, o);
  const subId = 'sub_' + m.id.slice(3);
  const start = t.clock.now, end = at(addMonths(localParts(start).day, 1));
  t.fake.sub(subId, m.id, { periodEnd: sec(end) });
  t.fake.invoice('in_' + m.id.slice(3) + '_1', subId, { amount: 3400, start, end, pi: 'pi_' + m.id.slice(3) + '_1' });
  assert.equal((await hook(t, 'invoice.paid', { id: 'in_' + m.id.slice(3) + '_1', parent: { subscription_details: { subscription: subId } } })).status, 200);
  return { ...m, subId, pi: 'pi_' + m.id.slice(3) + '_1', member: () => t.s().members.get(m.id), token: memberToken(SECRET, m.id, t.clock.now + MEMBER_TEXT_TTL) };
}
/** The personal-data rule (pii-invariant.test.js) on these flows: pii only under a file, or an owner's mail about nobody;
 *  no number, no e-mail, no processor customer or subscription in the chained data. */
function chainClean(journal) {
  const bad = [];
  for (const e of journal) {
    if (e.pii != null && !(e.data && e.data.cid) && !(e.type === 'message.queued' && !e.data.apptId) && !e.type.startsWith('staff.') && e.type !== 'settings.updated') bad.push(e.type + ': pii without cid');
    const d = JSON.stringify(e.data || {});
    if (/(?:\+33|\b0)[67]\d{8}|@exemple\.fr|"cus_|"sub_/.test(d)) bad.push(e.type + ': ' + d.slice(0, 80));
  }
  assert.deepEqual(bad, []);
}
const texts = (s, template, cid) => [...s.messages.values()].filter((x) => x.template === template && x.channel !== 'email' && (!cid || x.cid === cid));
const mails = (s, pred) => [...s.messages.values()].filter((x) => x.channel === 'email' && pred(x));

test('the Price is found by its lookup key or created once; a start not asked for now waits 14 days; card only without SEPA', async () => {
  const t = await salon();
  const a = await subscribe(t, { startNow: false });
  // no Price yet: looked up, created once with its key, the checkout bills it
  assert.equal(t.fake.calls('GET', '/prices')[0].query['lookup_keys[]'], 'lx_essentiel_3400');
  const created = t.fake.calls('POST', '/prices');
  assert.equal(created.length, 1);
  assert.deepEqual([created[0].body.lookup_key, created[0].body.unit_amount, created[0].body['recurring[interval]'], created[0].body.currency, created[0].idem], ['lx_essentiel_3400', '3400', 'month', 'eur', 'lx-price-essentiel-3400']);
  const co = t.fake.calls('POST', '/checkout/sessions')[0];
  assert.equal(co.idem, 'lx-sub-' + a.id);
  assert.deepEqual([co.body.mode, co.body['line_items[0][price]'], co.body.client_reference_id, co.body['subscription_data[metadata][lx]'], co.body.customer_email, co.body.locale], ['subscription', created[0].body.lookup_key && t.fake.state.prices[0].id, a.id, a.id, 'karim@exemple.fr', 'fr']);
  // the day after the 14 days of withdrawal, before the salon opens; never Stripe's « trial » days
  assert.equal(Number(co.body['subscription_data[trial_end]']), sec(instantOf(addDays(DAY, START_DAYS), 6 * 60)));
  assert.equal(co.body['subscription_data[trial_period_days]'], undefined);
  assert.equal(co.body['payment_method_types[0]'], 'card');
  assert.equal(co.body['payment_method_types[1]'], undefined, 'no SEPA in v1');
  assert.ok(Number(co.body.expires_at) - sec(Date.now()) >= 31 * 60 - 5);
  assert.match(a.page, /^https:\/\/salon\.test\/abo\/mb_/);
  assert.equal(a.url, 'https://checkout.stripe.com/c/pay/' + a.cs.id);
  // the consent is in the chain: the CGV version shown, the start asked or not, and when
  const ev = t.rt.engine.journal.find((e) => e.type === 'member.created' && e.data.id === a.id);
  assert.deepEqual([ev.data.cgv, ev.data.startNow, ev.data.channel, ev.data.providerRef], ['2026-10-27', false, 'online', a.cs.id]);
  assert.ok(ev.data.exp > instantOf(addDays(DAY, START_DAYS), 0), 'a start in 14 days is not abandoned when the page closes');
  // a second client: the Price is the same, nothing created again
  const b = await subscribe(t);
  assert.equal(t.fake.calls('POST', '/prices').length, 1);
  const co2 = t.fake.calls('POST', '/checkout/sessions')[1];
  assert.equal(co2.body['subscription_data[trial_end]'], undefined, 'started now: charged now');
  assert.equal(co2.body['line_items[0][price]'], co.body['line_items[0][price]']);
  assert.ok(b.id !== a.id);

  // the deferred start's checkout done: the contract's confirmation by e-mail now, nothing paid, still pending
  const startAt = instantOf(addDays(DAY, START_DAYS), 6 * 60);
  t.fake.sub('sub_late', a.id, { raw: { status: 'trialing', trial_end: sec(startAt) } });
  t.fake.state.sessions.get(a.cs.id).subscription = 'sub_late';
  await hook(t, 'checkout.session.completed', { id: a.cs.id, mode: 'subscription', subscription: 'sub_late', customer: 'cus_late', payment_status: 'no_payment_required' });
  await hook(t, 'customer.subscription.updated', { id: 'sub_late' });
  const conf = mails(t.s(), (x) => x.id === 'msg_msched_' + a.id);
  assert.equal(conf.length, 1);
  assert.match(conf[0].mail.subject, /commence le 17 novembre/);
  assert.ok(!/essai/i.test(conf[0].body), 'never « essai »');
  assert.equal(statusIn(t.s(), t.s().members.get(a.id), addDays(DAY, 5)), 'pending');
  // called off before it began, from his page: Stripe's subscription deleted now, the acknowledgement by e-mail
  t.go(addDays(DAY, 3));
  const tok = memberToken(SECRET, a.id, t.clock.now + 3600000);
  const off = await browser(t.rt).post('/api/public/memberships/' + tok + '/cancel', {});
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal(off.json.cancelled.ended, true);
  assert.equal(t.fake.calls('DELETE', '/subscriptions/sub_late').length, 1, 'found through its checkout: no payment named it yet');
  assert.equal(mails(t.s(), (x) => x.id === 'msg_mschx_' + a.id).length, 1);
  // a checkout left to lapse: its member ends, abandoned
  await hook(t, 'checkout.session.expired', { id: b.cs.id, mode: 'subscription' });
  assert.equal(t.s().members.get(b.id).ended.reason, 'abandoned');

  // another instance (a cold start): the Price exists at Stripe, it is found by its key and reused
  const other = fakeStripe(() => t.clock.now);
  other.state.prices.push({ id: 'price_old', lookup_key: 'lx_essentiel_3400', unit_amount: 3400, active: true });
  t.rt.pay = stripeProvider({ secretKey: 'sk_live_x', webhookSecret: WH, fetchImpl: other.fetchImpl });
  t.fake = other;
  await subscribe(t);
  assert.equal(other.calls('POST', '/prices').length, 0);
  assert.equal(other.calls('POST', '/checkout/sessions')[0].body['line_items[0][price]'], 'price_old');
});

test('webhooks in the wrong order or twice: one activation, one ticket, the member page in the welcome', async () => {
  const t = await salon();
  const a = await subscribe(t, { first: 'Karim' });
  const subId = 'sub_x1', end = at(addMonths(DAY, 1));
  t.fake.sub(subId, a.id, { periodEnd: sec(end) });
  t.fake.invoice('in_x1', subId, { amount: 3400, start: t.clock.now, end, pi: 'pi_x1' });
  // invoice.paid first: our records know no subscription yet, its metadata names the member
  const notice = { id: 'in_x1', parent: { subscription_details: { subscription: subId } } };
  assert.deepEqual((await hook(t, 'invoice.paid', notice)).json, { received: true });
  // then the checkout's completion, then the same invoice again
  assert.equal((await hook(t, 'checkout.session.completed', { id: a.cs.id, mode: 'subscription', subscription: subId, customer: 'cus_x1', payment_status: 'paid' })).status, 200);
  assert.equal((await hook(t, 'invoice.paid', notice)).status, 200);
  const s = t.s();
  const m = s.members.get(a.id);
  assert.equal(t.rt.engine.journal.filter((e) => e.type === 'member.activated' && e.data.id === a.id).length, 1);
  const tickets = [...s.sales.values()].filter((x) => x.lines.some((l) => l.kind === 'membership' && l.memberId === a.id));
  assert.equal(tickets.length, 1);
  assert.deepEqual([statusIn(s, m, DAY), m.periods.length, m.subscription, m.card, s.payments.get(m.periods[0].paymentId).chargeRef], ['active', 1, subId, 'Visa •• 4242', 'pi_x1']);
  assert.equal(s.memberByRef.get(subId), a.id, 'found by its subscription from now on');
  // every notice was re-read from Stripe before anything was written
  assert.ok(t.fake.calls('GET', '/invoices/in_x1').length >= 2 && t.fake.calls('GET', '/subscriptions/' + subId).length >= 3);
  // the welcome links the member's page, signed for 7 days
  const welcome = texts(s, 'memberWelcome', m.cid)[0];
  const token = welcome.body.match(/\/abo\/(\S+)/)[1];
  const read = readMemberToken(SECRET, token, t.clock.now);
  assert.equal(read.id, a.id);
  assert.ok(read.exp - t.clock.now > 6.9 * 86400000 && read.exp - t.clock.now <= 7 * 86400000);
  // the processor's references are not in the chain
  for (const e of t.rt.engine.journal.filter((x) => x.type.startsWith('member.'))) {
    assert.ok(!/cus_|sub_x1|4242|karim/i.test(JSON.stringify(e.data)), e.type + ' keeps the person and the card in pii');
    assert.ok(e.data.cid, e.type + ' names its file');
  }
  // a notice of an invoice that is not a membership's, or of a subscription we do not know: answered, nothing written
  const v = s.version;
  t.fake.sub('sub_alien', 'mb_unknown', {});
  t.fake.invoice('in_alien', 'sub_alien', { amount: 999, start: t.clock.now, end, pi: 'pi_alien' });
  assert.deepEqual((await hook(t, 'invoice.paid', { id: 'in_alien' })).json, { received: true, ignored: 'unknown' });
  assert.deepEqual((await hook(t, 'invoice.created', { id: 'in_new' })).json, { received: true });
  assert.equal(t.s().version, v);
});

test('a refused renewal: grace and one text; paid later, active again; Stripe gives up, ended unpaid with its text', async () => {
  const t = await salon();
  const a = await member(t);
  const cid = a.member().cid;
  // the renewal day: Stripe's first try fails, it will try again in 3 days
  const renew = addMonths(DAY, 1);
  t.go(renew, 7);
  const next = at(addMonths(renew, 1));
  t.fake.invoice('in_r2', a.subId, { status: 'open', amount: 3400, start: at(renew), end: next, pi: 'pi_r2', attempt: 1, nextAt: at(addDays(renew, 3)) });
  const failed = { id: 'in_r2', parent: { subscription_details: { subscription: a.subId } }, attempt_count: 1 };
  await hook(t, 'invoice.payment_failed', failed);
  await hook(t, 'invoice.payment_failed', failed);
  assert.equal(statusIn(t.s(), a.member(), renew), 'grace');
  assert.equal(texts(t.s(), 'memberFailed', cid).length, 1, 'one text per invoice');
  assert.match(texts(t.s(), 'memberFailed', cid)[0].body, /\/abo\//, 'his own page to fix the card');
  assert.ok(cover(t.s(), a.member(), t.ids.cut, { day: addDays(renew, 2) }).ok, 'cuts still included during the grace');
  // the second try passes
  t.go(addDays(renew, 3), 7);
  Object.assign(t.fake.state.invoices.get('in_r2'), { status: 'paid', amount_paid: 3400, attempt_count: 2 });
  t.fake.state.invoices.get('in_r2').payments.data[0].status = 'paid';
  await hook(t, 'invoice.paid', { id: 'in_r2', parent: { subscription_details: { subscription: a.subId } } });
  assert.equal(statusIn(t.s(), a.member(), addDays(renew, 3)), 'active');
  assert.equal(a.member().periods.length, 2);
  assert.equal(a.member().pastDue, null);

  // the next month fails for good: Smart Retries end in a cancellation
  const third = addMonths(DAY, 2);
  t.go(third, 7);
  t.fake.invoice('in_r3', a.subId, { status: 'open', amount: 3400, start: at(third), end: at(addMonths(third, 1)), pi: 'pi_r3', attempt: 1, nextAt: at(addDays(third, 3)) });
  await hook(t, 'invoice.payment_failed', { id: 'in_r3', parent: { subscription_details: { subscription: a.subId } } });
  t.go(addDays(third, 14), 7);
  Object.assign(t.fake.state.subs.get(a.subId), { status: 'canceled', cancellation_details: { reason: 'payment_failed' } });
  await hook(t, 'customer.subscription.deleted', { id: a.subId });
  const m = a.member();
  assert.deepEqual([m.ended && m.ended.reason, statusIn(t.s(), m, addDays(third, 14))], ['unpaid', 'ended']);
  assert.equal(texts(t.s(), 'memberEnded', cid).length, 1);
  assert.equal(mails(t.s(), (x) => x.to === 'gerant@salon.test' && /faute de paiement/.test(x.mail.subject)).length, 1, 'the owner is told');
});

test('a cancellation made in Stripe’s portal: recorded by the provider, acknowledged by SMS and e-mail', async () => {
  const t = await salon();
  const a = await member(t, { email: 'nour@exemple.fr', first: 'Nour' });
  t.go(addDays(DAY, 9), 15);
  Object.assign(t.fake.state.subs.get(a.subId), { cancel_at_period_end: true });
  await hook(t, 'customer.subscription.updated', { id: a.subId });
  await hook(t, 'customer.subscription.updated', { id: a.subId });
  const m = a.member();
  assert.deepEqual([m.cancel.by, m.cancel.channel, m.cancel.effective, m.cancel.verified !== false], ['provider', 'stripe', addMonths(DAY, 1), true]);
  assert.equal(texts(t.s(), 'memberCancelled', m.cid).length, 1);
  const ack = mails(t.s(), (x) => x.to === 'nour@exemple.fr' && x.template === 'memberCancelled');
  assert.equal(ack.length, 1);
  assert.match(ack[0].body, /bien reçu ta résiliation le 12 novembre à 15\sh\./);
  assert.equal(statusIn(t.s(), m, addDays(DAY, 20)), 'ending');
});

test('the member page: cancel on the 10th stops at Stripe at the period end; an expired link says so', async () => {
  const t = await salon();
  const a = await member(t);
  const c = browser(t.rt);
  const view = (await c.get('/api/public/memberships/' + a.token)).json;
  assert.deepEqual([view.status, view.used, view.of, view.next.day, view.next.amount, view.card, view.withdraw.refund, view.actions.cancel, view.actions.card], ['active', 0, 2, addMonths(DAY, 1), 3400, 'Visa •• 4242', 3400, true, true]);
  assert.ok(!JSON.stringify(view).match(/\+33|exemple\.fr|cus_|sub_/), 'no number, no e-mail, no processor id on the page');
  // the 10th day of the month paid: a fresh link (the one of the welcome lasts 7 days)
  t.go(addDays(DAY, 9), 11);
  const token = memberToken(SECRET, a.id, t.clock.now + MEMBER_TEXT_TTL);
  const res = await c.post('/api/public/memberships/' + token + '/cancel', { reason: 'Je déménage' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.cancelled.effective, res.json.cancelled.last, res.json.cancelled.ended], [addMonths(DAY, 1), addDays(addMonths(DAY, 1), -1), false]);
  const call = t.fake.calls('POST', '/subscriptions/' + a.subId).pop();
  assert.equal(call.body.cancel_at_period_end, 'true');
  assert.equal(t.fake.calls('DELETE', /subscriptions/).length, 0);
  const m = a.member();
  assert.deepEqual([m.cancel.by, m.cancel.channel], ['client', 'site']);
  // Stripe's own notice of it then changes nothing
  Object.assign(t.fake.state.subs.get(a.subId), { cancel_at_period_end: true });
  const v = t.s().version;
  await hook(t, 'customer.subscription.updated', { id: a.subId });
  assert.equal(t.s().version, v);
  // a second tap: the same answer
  assert.equal((await c.post('/api/public/memberships/' + token + '/cancel', {})).status, 200);
  assert.equal(texts(t.s(), 'memberCancelled', m.cid).length, 1);

  // the card: Stripe's portal on the payment-method flow, back to the member's page
  const card = await c.post('/api/public/memberships/' + token + '/card', {});
  assert.match(card.json.url, /^https:\/\/billing\.stripe\.com\//);
  const portal = t.fake.calls('POST', '/billing_portal/sessions')[0];
  assert.deepEqual([portal.body.customer, portal.body['flow_data[type]']], [m.customer, 'payment_method_update']);
  assert.match(portal.body.return_url, /\/abo\//);

  // the welcome's link, seven days on, is dead and says so; an altered one is not ours
  const old = a.token;
  const gone = await c.get('/api/public/memberships/' + old);
  assert.deepEqual([gone.status, gone.json.error.message], [410, EXPIRED]);
  assert.equal((await c.post('/api/public/memberships/' + old + '/cancel', {})).status, 410);
  assert.equal((await c.get('/api/public/memberships/' + token.slice(0, -2) + 'xx')).status, 404);
  assert.equal((await c.get('/api/public/memberships/' + a.id + '~zzzzzz.' + 'a'.repeat(22))).status, 404, 'a stretched expiry breaks the signature');
});

test('withdrawal on day 5 with one cut taken: 17 € back on the first payment, credit note A…, subscription deleted, ended', async () => {
  const t = await salon();
  const a = await member(t);
  const m0 = a.member();
  // one covered cut at the till
  t.go(addDays(DAY, 2), 11);
  await t.rt.engine.run(checkout, { clientId: m0.cid, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: a.id }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner());
  t.go(addDays(DAY, 4), 16);
  const c = browser(t.rt);
  assert.equal((await c.get('/api/public/memberships/' + a.token)).json.withdraw.refund, 1700);
  const res = await c.post('/api/public/memberships/' + a.token + '/withdraw', {});
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.withdrawn.refund, res.json.withdrawn.refunded, res.json.member.status], [1700, true, 'ended']);
  const rf = t.fake.calls('POST', '/refunds');
  assert.equal(rf.length, 1);
  assert.deepEqual([rf[0].body.payment_intent, rf[0].body.amount], [a.pi, '1700']);
  assert.equal(t.fake.calls('DELETE', '/subscriptions/' + a.subId).length, 1);
  const s = t.s();
  const m = a.member();
  assert.deepEqual([m.withdrawn.refund, m.ended.reason], [1700, 'withdrawn']);
  const sale = s.sales.get(m.periods[0].saleId);
  assert.equal(sale.refundIds.length, 1);
  const note = s.refunds.get(sale.refundIds[0]);
  assert.match(refundNo(note.number), /^A\d+$/);
  assert.deepEqual([note.amount, note.method, note.providerRef], [1700, 'online', rf[0] && t.fake.state.refunds[0].id]);
  assert.equal(texts(s, 'memberWithdrawn', m.cid).length, 1);
  // a second tap gives the same answer and moves no money again
  const again = await c.post('/api/public/memberships/' + a.token + '/withdraw', {});
  assert.equal(again.status, 200);
  assert.equal(t.fake.state.refunds.length, 1);
  assert.equal(t.s().sales.get(m.periods[0].saleId).refundIds.length, 1);
  // Stripe's notices of the deletion and of its own refund change nothing more
  const v = t.s().version;
  await hook(t, 'customer.subscription.deleted', { id: a.subId });
  assert.equal(t.s().version, v);
  chainClean(t.rt.engine.journal);
});

/** The two « no account » routes on their own router, with the request the way app.js builds it (lookup.test.js). */
async function asks(t) {
  const app = router();
  const pending = [];
  membershipRoutes(app, { minMs: 0, jitterMs: 0, later: (p) => { pending.push(p); } });
  let n = 0;
  return async (path, body) => {
    const m = /** @type {any} */ (app.match('POST', path));
    const ip = '10.9.' + (++n % 250) + '.1';
    const r = {
      rt: t.rt, body, ip, params: {}, origin: ORIGIN, meta: { siteUrl: ORIGIN + '/', ip },
      get s() { return t.rt.engine.state; }, get now() { return t.rt.engine.clock(); }, get local() { return localParts(t.rt.engine.clock()); }
    };
    let out;
    try { out = { status: 200, json: await m.route.fn(r) }; } catch (e) { const res = errorResponse(e); out = { status: res.status, json: await res.json() }; }
    await Promise.all(pending.splice(0));
    return out;
  };
}

test('« send me my link »: the same answer for a known and an unknown number; both channels; nothing past the third', async () => {
  const t = await salon();
  const phone = nextPhone();
  const a = await member(t, { phone, email: 'sami@exemple.fr', first: 'Sami' });
  const cid = a.member().cid;
  const post = await asks(t);
  const known = await post('/api/public/memberships/lookup', { phone });
  const unknown = await post('/api/public/memberships/lookup', { phone: nextPhone() });
  assert.deepEqual(known, unknown);
  assert.deepEqual(known.json, { ok: true, message: LOOKUP_PHONE });
  const sms = texts(t.s(), 'memberLink', cid);
  assert.equal(sms.length, 1);
  const link = sms[0].body.match(/\/abo\/(\S+)/)[1];
  const read = readMemberToken(SECRET, link, t.clock.now);
  assert.ok(read.exp - t.clock.now <= 3600000, 'valid one hour');
  assert.equal(mails(t.s(), (x) => x.template === 'memberLinkMail' && x.to === 'sami@exemple.fr').length, 1, 'and by e-mail to the address on file');
  // by e-mail: the same, to both channels
  const byMail = await post('/api/public/memberships/lookup', { email: 'SAMI@exemple.fr' });
  assert.deepEqual(byMail.json, { ok: true, message: LOOKUP_EMAIL });
  assert.deepEqual(await post('/api/public/memberships/lookup', { email: 'personne@exemple.fr' }), byMail);
  assert.equal(texts(t.s(), 'memberLink', cid).length, 2);
  await post('/api/public/memberships/lookup', { phone });
  assert.equal(texts(t.s(), 'memberLink', cid).length, 3);
  // the fourth ask of the day: the same answer, nothing sent
  const fourth = await post('/api/public/memberships/lookup', { phone });
  assert.deepEqual(fourth, known);
  assert.equal(texts(t.s(), 'memberLink', cid).length, 3);
  assert.equal((await post('/api/public/memberships/lookup', {})).status, 400);
});

test('no phone, no mailbox: a matching first name and e-mail records an unverified cancellation the salon confirms', async () => {
  const t = await salon();
  const a = await member(t, { first: 'Éloïse', email: 'eloise@exemple.fr' });
  const post = await asks(t);
  t.go(addDays(DAY, 6), 14, 5);
  const hit = await post('/api/public/memberships/cancel-request', { first: 'eloise', email: 'Eloise@exemple.fr', replyTo: 'nouvelle@exemple.fr' });
  const miss = await post('/api/public/memberships/cancel-request', { first: 'Bob', email: 'bob@exemple.fr' });
  assert.equal(hit.status, 200);
  assert.deepEqual(Object.keys(hit.json), Object.keys(miss.json));
  assert.equal(hit.json.message, miss.json.message, 'the same answer');
  assert.match(hit.json.message, /reçue le 09\/11 à 14\sh\s05/);
  const m = a.member();
  assert.deepEqual([m.cancel.verified, m.cancel.channel, m.cancel.by, m.cancel.effective], [false, 'site', 'client', addMonths(DAY, 1)]);
  const ev = t.rt.engine.journal.find((e) => e.type === 'member.cancelRequested' && e.data.id === a.id);
  assert.equal(ev.data.verified, false);
  // the acknowledgement to the address on file and to the one to answer, the owner's « à confirmer », once
  assert.equal(mails(t.s(), (x) => x.template === 'memberCancelled' && x.to === 'eloise@exemple.fr').length, 1);
  assert.equal(mails(t.s(), (x) => x.template === 'memberCancelled' && x.to === 'nouvelle@exemple.fr').length, 1);
  const owner = mails(t.s(), (x) => x.to === 'gerant@salon.test');
  assert.equal(owner.filter((x) => /^Résiliation à confirmer · Éloïse/.test(x.mail.subject)).length, 1);
  assert.equal(owner.filter((x) => /^Résiliation d’abonnement/.test(x.mail.subject)).length, 0, 'one mail to the owner, not two');
  // no match: the owner gets what was typed, nothing names a file
  const odd = owner.find((x) => /sans abonnement trouvé/.test(x.mail.subject));
  assert.ok(odd && /bob@exemple\.fr/.test(odd.body) && !odd.cid);
  // Stripe was not told yet: the salon confirms it from the Comptoir, then Stripe stops at the period end
  assert.equal(t.fake.calls('POST', '/subscriptions/' + a.subId).length, 0);
  const conf = await t.owner.post('/api/v1/memberships/' + a.id + '/cancel', {});
  assert.equal(conf.status, 200, JSON.stringify(conf.json));
  assert.equal(conf.json.confirmed, true);
  assert.equal(t.fake.calls('POST', '/subscriptions/' + a.subId).pop().body.cancel_at_period_end, 'true');
  assert.equal(a.member().cancel.verified, undefined, 'confirmed');
  chainClean(t.rt.engine.journal);
});

test('money no contract covers is sent back: a renewal after a cancellation Stripe never heard of', async () => {
  const t = await salon();
  const a = await member(t, { first: 'Inès', email: 'ines@exemple.fr' });
  const post = await asks(t);
  await post('/api/public/memberships/cancel-request', { first: 'Ines', email: 'ines@exemple.fr' });
  // nobody confirmed it: Stripe charges the next month all the same
  const renew = addMonths(DAY, 1);
  t.go(renew, 7);
  t.fake.invoice('in_o2', a.subId, { amount: 3400, start: at(renew), end: at(addMonths(renew, 1)), pi: 'pi_o2' });
  const res = await hook(t, 'invoice.paid', { id: 'in_o2' });
  assert.deepEqual(res.json, { received: true, ignored: 'sent_back' });
  const rf = t.fake.calls('POST', '/refunds');
  assert.deepEqual([rf.length, rf[0].body.payment_intent, rf[0].body.amount, rf[0].idem], [1, 'pi_o2', '3400', 'lx-rf-orphan-in_o2']);
  assert.equal(t.fake.calls('DELETE', '/subscriptions/' + a.subId).length, 1);
  assert.equal(a.member().periods.length, 1, 'no ticket for it');
  assert.equal(mails(t.s(), (x) => x.to === 'gerant@salon.test' && /Paiement d’abonnement rendu/.test(x.mail.subject)).length, 1);
  // the notice again: refunded once
  await hook(t, 'invoice.paid', { id: 'in_o2' });
  assert.equal(t.fake.state.refunds.length, 1);
});

test('a disputed month: Stripe holds the billing, no cut covered, the owner asked; lost, the credit note asked; won, billing back', async () => {
  const t = await salon();
  const a = await member(t, { first: 'Yanis' });
  const dispute = (status, extra = {}) => ({ id: 'du_1', amount: 3400, reason: 'fraudulent', status, payment_intent: a.pi, evidence_details: { due_by: sec(at(addDays(DAY, 12))) }, ...extra });
  t.go(addDays(DAY, 3));
  assert.equal((await hook(t, 'charge.dispute.created', dispute('needs_response'))).status, 200);
  const hold = t.fake.calls('POST', '/subscriptions/' + a.subId).pop();
  assert.equal(hold.body['pause_collection[behavior]'], 'void', 'the invoices to come are voided: the next month is not charged');
  const m = a.member();
  assert.equal(statusIn(t.s(), m, addDays(DAY, 3)), 'unpaid');
  // the till refuses the cut the membership would have covered
  await assert.rejects(t.rt.engine.run(checkout, { clientId: m.cid, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: a.id }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner()), (e) => e.status === 409);
  const asked = mails(t.s(), (x) => x.to === 'gerant@salon.test' && /Litige sur l’abonnement de Yanis : résilier \?/.test(x.mail.subject));
  assert.equal(asked.length, 1);
  assert.match(asked[0].body, /avant le 15\/11/);
  // updated, then lost: the owner makes the credit note of that month, the contract stays held
  await hook(t, 'charge.dispute.updated', dispute('under_review'));
  await hook(t, 'charge.dispute.closed', dispute('lost'));
  const lost = mails(t.s(), (x) => x.to === 'gerant@salon.test' && /fais l’avoir du mois contesté/.test(x.mail.subject));
  assert.equal(lost.length, 1);
  assert.match(lost[0].body, /\/comptoir\/caisse\/ventes\?jour=2026-11-03&ticket=/);
  assert.equal(statusIn(t.s(), a.member(), addDays(DAY, 5)), 'unpaid');
  assert.equal(t.fake.calls('POST', '/subscriptions/' + a.subId).filter((x) => x.body.pause_collection === '').length, 0);

  // another member's dispute won: billing goes on and the cuts are covered again
  const b = await member(t, { first: 'Adam' });
  const d2 = { id: 'du_2', amount: 3400, reason: 'general', payment_intent: b.pi, evidence_details: { due_by: 0 } };
  await hook(t, 'charge.dispute.created', { ...d2, status: 'needs_response' });
  assert.equal(statusIn(t.s(), b.member(), addDays(DAY, 3)), 'unpaid');
  await hook(t, 'charge.dispute.closed', { ...d2, status: 'won' });
  assert.equal(t.fake.calls('POST', '/subscriptions/' + b.subId).filter((x) => x.body.pause_collection === '').length, 1);
  assert.equal(statusIn(t.s(), b.member(), addDays(DAY, 3)), 'active');
  chainClean(t.rt.engine.journal);
});

test('a dispute on another payment and a refund made in Stripe’s dashboard each e-mail the owner once', async () => {
  const t = await salon();
  const a = await member(t, { first: 'Lina' });
  // a refund made in the dashboard on the month's payment: recorded outside, the owner told to make the credit note
  await hook(t, 'charge.refunded', { id: 'ch_1', payment_intent: a.pi, amount_refunded: 1000, refunds: { data: [{ id: 're_dash' }] } });
  await hook(t, 'charge.refunded', { id: 'ch_1', payment_intent: a.pi, amount_refunded: 1000, refunds: { data: [{ id: 're_dash' }] } });
  const out = mails(t.s(), (x) => x.to === 'gerant@salon.test' && /Remboursé chez Stripe sans avoir/.test(x.mail.subject));
  assert.equal(out.length, 1);
  assert.match(out[0].body, /10\s€ rendus/);
});

test('the Comptoir: the list (a barber sees no payment in trouble), the owner’s figures, an offer by SMS, the card link', async () => {
  const t = await salon();
  const a = await member(t, { first: 'Karim' });
  await member(t, { first: 'Nour' });
  const renew = addMonths(DAY, 1);
  t.go(renew, 9);
  t.fake.invoice('in_l2', a.subId, { status: 'open', amount: 3400, start: at(renew), end: at(addMonths(renew, 1)), pi: 'pi_l2', attempt: 1 });
  await hook(t, 'invoice.payment_failed', { id: 'in_l2' });
  const list = await t.owner.get('/api/v1/memberships');
  assert.equal(list.status, 200);
  const row = list.json.members.find((x) => x.id === a.id);
  assert.deepEqual([row.status, row.first, row.plan, row.of, !!row.pastDueSince, row.card], ['grace', 'Karim', 'Essentiel', 2, true, 'Visa •• 4242']);
  assert.equal(list.json.mrr, 6800);
  const sum = await t.owner.get('/api/v1/memberships/summary');
  assert.deepEqual([sum.json.live, sum.json.active, sum.json.grace, sum.json.troubled, sum.json.mrr, sum.json.days30.joined], [2, 1, 1, 1, 6800, 2]);
  // a barber with the client files: the badge and the cuts, never a payment in trouble, never the figures
  assert.equal((await t.owner.post('/api/auth/device', { name: 'Poste 1' })).status, 200);
  const ali = browser(t.rt);
  ali.jar.set('lx_d', t.owner.jar.get('lx_d'));
  assert.equal((await ali.post('/api/auth/pin', { staffId: t.ids.ali, pin: '2468' })).status, 200);
  const seen = (await ali.get('/api/v1/memberships')).json.members.find((x) => x.id === a.id);
  assert.deepEqual([seen.status, seen.pastDueSince, seen.card, seen.disputed], ['active', null, '', false]);
  assert.equal((await ali.get('/api/v1/memberships/summary')).status, 403);
  assert.equal((await ali.post('/api/v1/memberships/' + a.id + '/cancel', {})).status, 403);
  // an offer from the counter: a checkout for the file (channel salon), texted as our short link, 24 hours
  const cl = (await t.owner.post('/api/v1/clients', { first: 'Omar', phone: nextPhone() })).json;
  const offer = await t.owner.post('/api/v1/memberships/offer', { clientId: cl.id, planId: 'essentiel', send: 'sms' }, { 'x-request-id': 'offer-req-0001' });
  assert.equal(offer.status, 200, JSON.stringify(offer.json));
  assert.match(offer.json.link, /\/api\/public\/memberships\/mb_.+\/pay$/);
  const sms = texts(t.s(), 'memberOffer', cl.id);
  assert.equal(sms.length, 1);
  assert.ok(sms[0].body.includes(offer.json.link));
  assert.equal(t.s().members.get(offer.json.id).channel, 'salon');
  const co = t.fake.calls('POST', '/checkout/sessions').pop();
  assert.ok(Number(co.body.expires_at) - sec(Date.now()) > 23 * 3600);
  // the short link goes on to Stripe's page
  const go = await browser(t.rt).get(offer.json.link.replace(ORIGIN, ''));
  assert.deepEqual([go.status, go.headers.get('location')], [302, offer.json.url]);
  // the same request again: the same checkout, the same text
  const again = await t.owner.post('/api/v1/memberships/offer', { clientId: cl.id, planId: 'essentiel', send: 'sms' }, { 'x-request-id': 'offer-req-0001' });
  assert.equal(again.json.id, offer.json.id);
  assert.equal(texts(t.s(), 'memberOffer', cl.id).length, 1);
  // the card link: his own page, which opens Stripe's
  const card = await t.owner.post('/api/v1/memberships/' + a.id + '/card-link', {});
  assert.equal(card.status, 200);
  assert.match(texts(t.s(), 'memberCard', a.member().cid)[0].body, /\/abo\/\S+\?carte/);
  // re-read Stripe now: the failed invoice paid since, without its notice
  Object.assign(t.fake.state.invoices.get('in_l2'), { status: 'paid', amount_paid: 3400 });
  const sync = await t.owner.post('/api/v1/memberships/' + a.id + '/sync', {});
  assert.equal(sync.status, 200);
  assert.equal(sync.json.member.status, 'active');
  assert.equal(a.member().periods.length, 2);
  chainClean(t.rt.engine.journal);
});

test('the owner cancels today with the unused days paid back on the month’s ticket', async () => {
  const t = await salon();
  const a = await member(t);
  t.go(addDays(DAY, 14), 12);
  const res = await t.owner.post('/api/v1/memberships/' + a.id + '/cancel', { now: true, refund: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.ended, true);
  // a period of 30 days (3 Nov – 2 Dec), 15 used counting today: 15 left of 30, half the month
  assert.deepEqual([res.json.refunded.amount, res.json.refunded.ok], [1700, true]);
  assert.equal(t.fake.calls('DELETE', '/subscriptions/' + a.subId).length, 1);
  const sale = t.s().sales.get(a.member().periods[0].saleId);
  assert.equal(t.s().refunds.get(sale.refundIds[0]).amount, 1700);
  assert.equal(t.fake.calls('POST', '/refunds')[0].body.payment_intent, a.pi);
});

test('a production salon with a Stripe test key: no membership is sold (moneyMode test)', async () => {
  const t = await salon({ key: 'sk_test_x' });
  const res = await browser(t.rt).post('/api/public/memberships', { planId: 'essentiel', first: 'Karim', phone: nextPhone(), email: 'k@exemple.fr', startNow: true });
  assert.deepEqual([res.status, res.json.error.code, res.json.error.message], [409, 'soon', SOON]);
  assert.equal(t.fake.calls('POST', '/checkout/sessions').length, 0);
  assert.equal((await browser(t.rt).get('/api/public/memberships')).json.live, false);
  // a live key: a number that already has a running membership gets its link instead of a second contract
  const live = await salon();
  const phone = nextPhone();
  const a = await member(live, { phone });
  const twice = await browser(live.rt).post('/api/public/memberships', { planId: 'essentiel', first: 'Karim', phone, email: 'k@exemple.fr', startNow: true });
  assert.deepEqual([twice.status, twice.json.error.code, twice.json.error.message], [409, 'already', ALREADY]);
  assert.equal(texts(live.s(), 'memberLink', a.member().cid).length, 1);
});

test('the demo: subscribe, the test page shows the plan, its confirmation pays the first month on a ticket', async () => {
  const clock = { now: instantOf('2026-11-24', 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  const plans = await site.get('/api/public/memberships');
  assert.equal(plans.json.live, true);
  assert.deepEqual(plans.json.plans.map((p) => p.words), ['2 coupes par mois · Coupe classique', '1 coupe tous les 7 jours · Coupe classique, Coupe + contour de barbe']);
  const res = await site.post('/api/public/memberships', { planId: 'essentiel', first: 'Démo', phone: '06 00 00 12 34', email: 'demo+12@exemple.fr', startNow: true, cgv: '2026-10-27' });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const id = res.json.url.split('/paiement/')[1];
  const page = (await site.get('/api/public/payments/' + id)).json;
  assert.match(page.label, /^Abonnement Essentiel · 34\s€\/mois$/);
  assert.deepEqual([page.amount, page.status, page.kind], [3400, 'pending', 'membership']);
  assert.deepEqual((await site.post('/api/public/payments/' + id + '/simulate', { outcome: 'ok' })).json, { status: 'paid' });
  const m = rt.engine.state.members.get(id);
  assert.equal(statusIn(rt.engine.state, m, '2026-11-24'), 'active');
  const sale = rt.engine.state.sales.get(m.periods[0].saleId);
  assert.deepEqual(sale.lines.map((l) => [l.kind, l.net]), [['membership', 3400]]);
  assert.equal(m.periods[0].invoice, 'sim_' + id + '_0', 'the numbering the demo’s billing goes on with');
  assert.equal((await site.get('/api/public/payments/' + id)).json.status, 'paid');
  assert.equal((await site.post('/api/public/payments/' + id + '/simulate', { outcome: 'ok' })).status, 409);
  // « Changer de carte » in the demo: the test page says the card is up to date
  const token = memberToken(SECRET, id, clock.now + 3600000);
  const card = await site.post('/api/public/memberships/' + token + '/card', {});
  assert.match(card.json.url, new RegExp('/paiement/' + id + '\\?carte$'));
  // a checkout left: cancelled on the test page, the member ends unpaid
  const left = await site.post('/api/public/memberships', { planId: 'illimite', first: 'Démo', phone: '06 00 00 12 35', email: 'demo+13@exemple.fr', startNow: true });
  const lid = left.json.url.split('/paiement/')[1];
  assert.deepEqual((await site.post('/api/public/payments/' + lid + '/simulate', { outcome: 'cancel' })).json, { status: 'failed' });
  assert.equal(rt.engine.state.members.get(lid).ended.reason, 'abandoned');
});

test('the adapter reads a card or a mandate in four digits, and maps the billing notices to our words', () => {
  assert.equal(cardLabel({ card: { brand: 'visa', last4: '4242' } }), 'Visa •• 4242');
  assert.equal(cardLabel({ card: { brand: 'visa', display_brand: 'cartes_bancaires', last4: '0005' } }), 'CB •• 0005');
  assert.equal(cardLabel({ sepa_debit: { last4: '1234' } }), 'SEPA •• 1234');
  assert.equal(cardLabel(null), '');
  const p = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: WH, fetchImpl: async () => new Response('{}') });
  const parse = (type, object) => { const body = JSON.stringify({ type, data: { object } }); return p.parseWebhook(body, sign(body, WH)); };
  assert.deepEqual(parse('checkout.session.completed', { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', payment_status: 'paid' }), { kind: 'sub.started', ref: 'cs_1', subscription: 'sub_1', customer: 'cus_1' });
  assert.deepEqual(parse('invoice.paid', { id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } }), { kind: 'invoice.paid', ref: 'in_1', invoice: 'in_1', subscription: 'sub_1' });
  assert.deepEqual(parse('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1', attempt_count: 2, next_payment_attempt: 1800000000 }), { kind: 'invoice.failed', ref: 'in_1', invoice: 'in_1', subscription: 'sub_1', attempt: 2, nextAt: 1800000000000 });
  assert.deepEqual(parse('invoice.payment_action_required', { id: 'in_1', subscription: 'sub_1', hosted_invoice_url: 'https://invoice.stripe.com/i/x' }), { kind: 'invoice.action', ref: 'in_1', invoice: 'in_1', subscription: 'sub_1', url: 'https://invoice.stripe.com/i/x' });
  for (const k of ['updated', 'deleted', 'paused', 'resumed']) assert.deepEqual(parse('customer.subscription.' + k, { id: 'sub_1' }), { kind: 'sub.changed', ref: 'sub_1', subscription: 'sub_1' });
  assert.equal(parse('invoice.created', { id: 'in_2' }), null, 'answered at once: Stripe holds the invoice while invoice.created fails');
  assert.equal(parse('checkout.session.completed', { id: 'cs_2', mode: 'payment', payment_status: 'paid', amount_total: 100, payment_intent: 'pi_2' }).kind, 'paid', 'a deposit stays a payment');
  assert.deepEqual([p.caps.billing, p.caps.portal], [true, true]);
});
