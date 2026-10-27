// Production safety: what a real salon must never do by accident. Fake deposits, SMS lost without a
// provider, Stripe and configuration traps, a client's name in the chained (unerasable) actor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../server/http/app.js';
import { createRuntime, readConfig, resetRuntime } from '../../server/http/runtime.js';
import { maybeTick, staleReason } from '../../server/http/scheduler.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { createPayment, paymentSucceeded } from '../../server/commands/payments.js';
import { browser, testRuntime, ORIGIN } from '../api/client.js';
import { at } from '../helpers.js';
import { addDays, instantOf } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const LATER = addDays(DAY, 1);
const SECRET = 'test-secret-0123456789';

/** A real salon, freshly installed through the setup screen, with one barber and the Transformation at 50 €. */
async function production({ env = {}, hour = 10 } = {}) {
  const clock = { now: at(DAY, hour) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13', ...env }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  const setup = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) });
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  const tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  const cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, asOwner())).id;
  return { rt, clock, owner, asOwner, ids: { ali, tr, cut } };
}

async function book(site, serviceId, { day = LATER, start = 600, first = 'Léon', phone = '0611223344', staffId = 'any' } = {}) {
  const r = await site.post('/api/public/bookings', { serviceIds: [serviceId], staffId, day, start, first, phone });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json;
}

/* ---------------- (1) no fake deposit in production ---------------- */

test('production on the simulated provider: no deposit, booked at once, the test checkout is closed', async () => {
  const { rt, owner, ids } = await production();
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  assert.deepEqual(salon.payments, { provider: 'simulated', live: false });
  assert.equal(salon.sms, false, 'no SMS provider in production');
  assert.equal(salon.deposits.mode, 'none', 'the site announces no deposit it would not take');
  assert.equal(salon.services.find((x) => x.slug === 'tr').deposit, 0);

  const res = await book(site, ids.tr);
  assert.equal(res.status, 'booked');
  assert.equal(res.deposit, 0);
  assert.equal(res.payment, null);
  const a = rt.engine.state.appts.get(rt.engine.state.apptByCode.get(res.code));
  assert.equal(a.deposit, null);
  assert.equal([...rt.engine.state.payments.values()].length, 0, 'no checkout created');

  // even a payment that exists (made before the switch) cannot be "paid" on the test page
  await rt.engine.run(createPayment, { id: 'py_old', kind: 'deposit', amount: 1500, provider: 'simulated', providerRef: 'sim_py_old', apptId: a.id, label: 'Acompte' }, { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']) });
  const sim = await site.post('/api/public/payments/py_old/simulate', { outcome: 'paid' });
  assert.equal(sim.status, 404);
  assert.equal(rt.engine.state.payments.get('py_old').status, 'pending');

  // nor at the till: a QR code needs Stripe
  const qr = await owner.post('/api/v1/payments/qr', { amount: 2000, label: 'Salon' });
  assert.equal(qr.status, 409);
  assert.equal(qr.json.error.code, 'no_provider');
});

test('in the demo, the deposit and the test checkout still work', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  assert.deepEqual(salon.payments, { provider: 'simulated', live: true });
  assert.equal(salon.sms, true);
  const tr = salon.services.find((x) => x.slug === 'tr');
  const av = await site.get(`/api/public/availability?services=${tr.id}&staff=any&from=${DAY}&days=5`);
  const day = av.json.days.find((d) => d.slots.length);
  const res = await book(site, tr.id, { day: day.day, start: day.slots[0].m, first: 'Sacha', phone: '0677889912' });
  assert.equal(res.status, 'pending');
  assert.equal(res.deposit, 1500);
  const pid = res.payment.url.split('/').pop();
  const sim = await site.post('/api/public/payments/' + pid + '/simulate', { outcome: 'paid' });
  assert.equal(sim.status, 200);
  assert.equal(sim.json.status, 'paid');
  assert.equal((await site.get('/api/public/bookings/' + res.token)).json.status, 'booked');
});

/* ---------------- (2) Stripe traps ---------------- */

test('a Stripe key without its webhook secret is a warning, and payments stay simulated', async () => {
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_live_abc' }, store: memoryStore() });
  assert.equal(rt.pay.name, 'simulated');
  assert.ok(rt.warnings.includes('Clé Stripe présente mais STRIPE_WEBHOOK_SECRET manquant : paiements simulés'), rt.warnings.join(' | '));
  assert.ok(!rt.warnings.includes('Stripe en mode test : aucun vrai paiement'));
});

test('Stripe test keys in production are a warning; live keys are not', async () => {
  const test1 = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1' }, store: memoryStore() });
  assert.equal(test1.pay.name, 'stripe');
  assert.ok(test1.warnings.includes('Stripe en mode test : aucun vrai paiement'), test1.warnings.join(' | '));
  const live = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_WEBHOOK_SECRET: 'whsec_1' }, store: memoryStore() });
  assert.deepEqual(live.warnings.filter((w) => /Stripe/.test(w)), []);
});

test('Stripe checkout pages outlive the booking’s wait by a minute, never less than 31 minutes', async () => {
  const bodies = [];
  const p = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec', fetchImpl: async (url, init) => { bodies.push(new URLSearchParams(init.body)); return new Response(JSON.stringify({ id: 'cs_' + bodies.length, url: 'https://checkout.stripe.com/x' })); } });
  const now = Math.floor(Date.now() / 1000);
  const short = await p.createCheckout({ id: 'py_1', amount: 1500, label: 'Acompte', successUrl: 'https://x/ok', cancelUrl: 'https://x/ko', payMin: 15 });
  const long = await p.createCheckout({ id: 'py_2', amount: 1500, label: 'Acompte', successUrl: 'https://x/ok', cancelUrl: 'https://x/ko', payMin: 45 });
  const minutes = (b) => Math.round((Number(b.get('expires_at')) - now) / 60);
  assert.equal(minutes(bodies[0]), 31);
  assert.equal(minutes(bodies[1]), 46);
  assert.equal(Math.round((long.exp / 1000 - now) / 60), 46);
  assert.ok(short.exp > Date.now());
});

test('with Stripe, an unpaid booking holds its slot for 31 minutes even when the salon says 15', async () => {
  const { rt, clock, ids } = await production({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_1' } });
  let n = 0;
  rt.pay = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_1', fetchImpl: async () => new Response(JSON.stringify({ id: 'cs_' + ++n, url: 'https://checkout.stripe.com/c/' + n })) });
  const site = browser(rt);
  assert.equal(rt.engine.state.settings.booking.pendingPayMin, 15);
  const salon = (await site.get('/api/public/salon')).json;
  assert.equal(salon.booking.pendingPayMin, 31);
  assert.deepEqual(salon.payments, { provider: 'stripe', live: true });
  const res = await book(site, ids.tr, { staffId: ids.ali });
  assert.equal(res.status, 'pending');
  assert.equal(res.deposit, 1500);
  assert.match(res.payment.url, /checkout\.stripe\.com/);
  const id = rt.engine.state.apptByCode.get(res.code);
  assert.equal(rt.engine.state.appts.get(id).deposit.until, clock.now + 31 * 60000);
  const free = async () => (await site.get(`/api/public/availability?services=${ids.tr}&staff=${ids.ali}&from=${LATER}&days=1`)).json.days[0].slots.some((x) => x.m === 600);

  clock.now += 20 * 60000;
  await maybeTick(rt, {}, { force: true });
  assert.equal(rt.engine.state.appts.get(id).status, 'pending', 'still waiting at minute 20');
  assert.equal(await free(), false, 'and the slot is still taken');

  clock.now += 12 * 60000;
  await maybeTick(rt, {}, { force: true });
  assert.equal(rt.engine.state.appts.get(id).status, 'cancelled');
  assert.equal(await free(), true);
});

test('with Stripe, a deposit paid after the hold ended is refunded if the slot went to someone else, kept if it is still free', async () => {
  const { rt, clock, ids } = await production({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_1' } });
  let n = 0;
  const refunds = [];
  rt.pay = { ...stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_1', fetchImpl: async () => new Response(JSON.stringify({ id: 'cs_' + ++n, url: 'https://checkout.stripe.com/c/' + n })) }), refund: async (ref, amount) => { refunds.push({ ref, amount }); return { ref: 're_' + refunds.length }; } };
  const A = browser(rt), B = browser(rt);
  const PROVIDER = { actor: { t: 'provider', id: 'stripe' }, caps: new Set() };
  const s = rt.engine.state;
  const a = await book(A, ids.tr, { staffId: ids.ali, start: 600, first: 'Alain', phone: '0611111111' });
  const c = await book(A, ids.tr, { staffId: ids.ali, start: 720, first: 'Chloé', phone: '0633333333' });
  const aid = s.apptByCode.get(a.code), cid = s.apptByCode.get(c.code);

  clock.now += 31.5 * 60000; // past the hold, before any tick: the slot already reads free
  // a fresh checkout page would outlive the hold: refused
  const again = await A.post('/api/public/bookings/' + a.token + '/pay', {});
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'late');
  const b = await book(B, ids.tr, { staffId: ids.ali, start: 600, first: 'Bruno', phone: '0622222222' });
  assert.equal(b.status, 'pending', 'someone else took 10:00');

  const pa = [...s.payments.values()].find((p) => p.apptId === aid);
  const late = await rt.engine.run(paymentSucceeded, { providerRef: pa.providerRef, amount: pa.amount }, PROVIDER);
  assert.deepEqual(late, { ok: true, late: true }, 'not confirmed over Bruno');
  assert.equal(s.appts.get(aid).status, 'cancelled');
  assert.equal(s.appts.get(aid).cancel.reason, 'Acompte réglé trop tard');
  const at10 = [...s.appts.values()].filter((x) => x.day === LATER && x.start === 600 && ['booked', 'pending'].includes(x.status));
  assert.equal(at10.length, 1);

  // nobody took 12:00: a late payment still confirms it
  const pc = [...s.payments.values()].find((p) => p.apptId === cid);
  const ok = await rt.engine.run(paymentSucceeded, { providerRef: pc.providerRef, amount: pc.amount }, PROVIDER);
  assert.deepEqual(ok, { ok: true });
  assert.equal(s.appts.get(cid).status, 'booked');
});

/* ---------------- (3) no SMS lost without a provider ---------------- */

test('production without an SMS provider: texts wait; once one is plugged in, stale ones expire and fresh ones leave', async () => {
  const { rt, clock, ids } = await production();
  const site = browser(rt);
  const first = await book(site, ids.cut, { start: 600 });
  assert.equal(first.status, 'booked');
  const msgs = () => [...rt.engine.state.messages.values()];
  const old = msgs().find((m) => m.template === 'confirmation');
  assert.ok(old, 'a confirmation is queued');
  await maybeTick(rt, {}, { force: true });
  assert.equal(rt.engine.state.messages.get(old.id).status, 'queued', 'not claimed, not "simulated"');

  clock.now += 7 * 3600000; // 17:00, the provider is finally set up
  const fresh = await book(site, ids.cut, { start: 660, first: 'Malik', phone: '0655443322' });
  const sent = [];
  rt.sms = { name: 'brevo', send: async (to, body) => { sent.push({ to, body }); return { ref: 'sms_' + sent.length }; } };
  await maybeTick(rt, {}, { force: true });
  const late = rt.engine.state.messages.get(old.id);
  assert.equal(late.status, 'expired');
  assert.match(late.error, /6 h/);
  const freshMsg = msgs().find((m) => m.template === 'confirmation' && m.apptId === rt.engine.state.apptByCode.get(fresh.code));
  assert.equal(freshMsg.status, 'sent');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Malik/);
  assert.equal(sent[0].to, '+33655443322');
});

test('production: a text queued before its appointment does not leave once the appointment has started', async () => {
  const { rt, clock, ids } = await production();
  const site = browser(rt);
  const res = await book(site, ids.cut, { day: DAY, start: 720 }); // today at 12:00, booked at 10:00
  const s = rt.engine.state;
  const conf = [...s.messages.values()].find((m) => m.template === 'confirmation');
  clock.now = at(DAY, 12) + 5 * 60000; // 12:05: barely two hours later, but the client is already in the chair
  const sent = [];
  rt.sms = { name: 'brevo', send: async (to, body) => { sent.push({ to, body }); return { ref: 'sms_' + sent.length }; } };
  await maybeTick(rt, {}, { force: true });
  assert.equal(s.messages.get(conf.id).status, 'expired');
  assert.match(s.messages.get(conf.id).error, /rendez-vous est passé/);
  assert.equal(sent.length, 0);
  // a text queued after the visit (thanks, review) is about the past on purpose: it still leaves
  const a = s.appts.get(s.apptByCode.get(res.code));
  const after = { id: 'm_rv', apptId: a.id, at: clock.now, dueAt: clock.now };
  assert.equal(staleReason(s, after, clock.now + 60000), '');
  assert.equal(staleReason(s, { ...after, at: instantOf(DAY, 700) }, clock.now), 'Trop tard : le rendez-vous est passé');
});

/* ---------------- (4) configuration ---------------- */

test('production without SESSION_SECRET answers every API route with 503', async () => {
  await assert.rejects(createRuntime({ env: { LX_MODE: 'production' }, store: memoryStore() }), (e) => e.status === 503 && e.message === 'Configuration incomplète : SESSION_SECRET');
  const saved = { LX_MODE: process.env.LX_MODE, SESSION_SECRET: process.env.SESSION_SECRET };
  process.env.LX_MODE = 'production';
  delete process.env.SESSION_SECRET;
  resetRuntime();
  try {
    for (const path of ['/api/public/salon', '/api/auth/state', '/api/v1/bootstrap']) {
      const res = await handle(new Request(ORIGIN + path, { headers: { origin: ORIGIN } }));
      assert.equal(res.status, 503, path);
      assert.equal((await res.json()).error.message, 'Configuration incomplète : SESSION_SECRET');
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    resetRuntime();
  }
  // the demo still generates and stores its own key
  const demo = await createRuntime({ env: {}, store: memoryStore() });
  assert.ok(demo.secret);
});

test('plain-http cookies: honoured locally, ignored by a production deployment on Vercel', () => {
  assert.equal(readConfig({ LX_INSECURE_COOKIES: '1' }).secureCookies, false);
  assert.equal(readConfig({ LX_MODE: 'production', LX_INSECURE_COOKIES: '1' }).secureCookies, false, 'local production tests');
  assert.equal(readConfig({ LX_MODE: 'production', LX_INSECURE_COOKIES: '1', VERCEL: '1' }).secureCookies, true);
  assert.equal(readConfig({ LX_INSECURE_COOKIES: '1', VERCEL: '1' }).secureCookies, false, 'a demo preview may still use it');
  assert.equal(readConfig({ LX_MODE: 'production', VERCEL: '1' }).secureCookies, true);
});

test('a SETUP_TOKEN left after the setup is a warning', async () => {
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13' }, store: memoryStore() });
  const W = 'SETUP_TOKEN est toujours défini : supprime-le puis redéploie';
  assert.ok(!rt.warnings.includes(W), 'needed before the setup');
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!' })).status, 200);
  assert.ok(rt.warnings.includes(W));
  const sys = await owner.get('/api/v1/system');
  assert.ok(sys.json.warnings.includes(W));
  const clean = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET }, store: rt.store });
  assert.ok(!clean.warnings.includes(W));
});

/* ---------------- (5) personal data never in the chain ---------------- */

test('an erased client leaves neither their first name nor their cancel reason in the journal or its export', async () => {
  const { rt, owner, ids } = await production();
  const site = browser(rt);
  const REASON = 'Mon fils est malade ce jour-là';
  const res = await book(site, ids.cut, { first: 'Yanis', phone: '0612345678' });
  const cx = await site.post('/api/public/bookings/' + res.token + '/cancel', { reason: REASON });
  assert.equal(cx.status, 200, JSON.stringify(cx.json));
  const s = rt.engine.state;
  const a = s.appts.get(s.apptByCode.get(res.code));
  assert.equal(a.status, 'cancelled');
  assert.equal(a.cancel.reason, REASON, 'the salon still reads the reason');
  for (const e of rt.engine.journal) {
    if (e.actor.t === 'client') assert.equal(e.actor.n, '', 'no name in the chained actor');
    assert.ok(!JSON.stringify({ ...e, pii: undefined }).includes('Yanis'), 'the name only travels as pii (' + e.type + ')');
    assert.ok(!JSON.stringify(e.data).includes(REASON), 'the reason only travels as pii');
  }
  assert.ok(JSON.stringify(rt.engine.journal).includes(REASON), 'kept next to the event until the erasure');

  const er = await owner.post('/api/v1/clients/' + a.clientId + '/erase', {});
  assert.equal(er.status, 200, JSON.stringify(er.json));
  const all = JSON.stringify(rt.engine.journal);
  assert.ok(!all.includes('Yanis'));
  assert.ok(!all.includes(REASON));
  assert.equal(s.appts.get(a.id).cancel.reason, '');
  const exp = await owner.get('/api/v1/export?kind=journal');
  assert.equal(exp.status, 200);
  assert.ok(!exp.text.includes('Yanis'));
  assert.ok(!exp.text.includes(REASON));
  assert.equal((await owner.get('/api/v1/integrity')).json.ok, true, 'and the chain still verifies');
});
