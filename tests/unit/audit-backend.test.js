// What the back-office audit (docs/audit-backoffice/03-logique-backend.md, 04-performance.md §7) found and what now
// holds: the deposit's page on the salon's clock, a booking rolled back when the provider is down, holds capped per
// visitor, the minimum notice across midnight, no « absent » ahead of time, no gift card turned into cash, an erasure
// that reaches the waiting list, and availability never served stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import { browser, testRuntime } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { maybeTick } from '../../server/http/scheduler.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { addClient, eraseClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import * as A from '../../server/commands/agenda.js';
import { freeSlots, minStartFor } from '../../server/domain/availability.js';
import { verifyChain } from '../../server/core/journal.js';
import { addDays, localParts } from '../../shared/dates.js';

const LATER = addDays(DAY, 1);
const STRIPE = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_1' };
const rq = () => ({ 'x-request-id': 'rq-' + Math.random().toString(36).slice(2, 12) });

/** A real salon set up through the setup screen: Ali, the Transformation at 50 € (a deposit with Stripe), a 20 € cut. */
async function production({ env = {}, now = at(DAY, 10) } = {}) {
  const clock = { now };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', ...env }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  const setup = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) });
  const all = [[540, 1110]];
  const week = { 0: all, 1: all, 2: all, 3: all, 4: all, 5: all, 6: all };
  const ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  const tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  const cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, asOwner())).id;
  return { rt, clock, owner, asOwner, ids: { ali, tr, cut } };
}
const stripeUp = () => { let n = 0; return stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_1', fetchImpl: async () => new Response(JSON.stringify({ id: 'cs_' + ++n, url: 'https://checkout.stripe.com/c/' + n })) }); };
const stripeDown = () => stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_1', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'api down', type: 'api_error' } }), { status: 503 }) });

/* ---------------- (1) the deposit's checkout page lapses on the salon's clock ---------------- */

for (const [label, shift] of /** @type {const} */ ([['two weeks behind the real date', -14], ['two weeks ahead of it', 14]])) {
  test('with Stripe, the deposit page is recorded on the salon’s clock, ' + label, async () => {
    // whatever today is, the salon's clock is two weeks away from it: nothing here can pass by a coincidence of dates
    const { rt, clock, ids } = await production({ env: STRIPE, now: at(addDays(localParts(Date.now()).day, shift), 10) });
    rt.pay = stripeUp();
    const site = browser(rt);
    // the first day the salon opens after its today, whatever weekday that is
    const open = (await site.get(`/api/public/availability?services=${ids.tr}&staff=${ids.ali}&from=${addDays(localParts(clock.now).day, 1)}&days=7`)).json.days.find((d) => d.slots.length);
    const b = await site.post('/api/public/bookings', { serviceIds: [ids.tr], staffId: ids.ali, day: open.day, start: open.slots[0].m, first: 'Alain', phone: '0611111111' });
    assert.equal(b.status, 201, JSON.stringify(b.json));
    const p = rt.engine.state.payments.get(b.json.payment.id);
    const life = (p.exp - clock.now) / 60000;
    assert.ok(life > 31 && life < 33, 'the page lives 32 minutes from the salon’s now, not from the real date: ' + life.toFixed(1) + ' min');

    // still open a minute before the hold ends: the same page; past it, no new page that would outlive the booking
    clock.now += 29 * 60000;
    const same = await site.post('/api/public/bookings/' + b.json.token + '/pay', {});
    assert.deepEqual([same.status, same.json.url], [200, p.url]);
    clock.now += 2.5 * 60000;
    const late = await site.post('/api/public/bookings/' + b.json.token + '/pay', {});
    assert.deepEqual([late.status, late.json.error.code], [409, 'late']);
  });
}

test('the demo with its clock set ahead (LX_FAKE_NOW): the deposit survives a tick and is paid on the test page', async () => {
  const clock = { now: Date.now() + 14 * 86400000 };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  const info = (await site.get('/api/public/salon')).json;
  const sv = info.services.find((x) => x.price >= 5000) || info.services.sort((a, b) => b.price - a.price)[0];
  let booked = null;
  for (let d = 1; d < 10 && !booked; d++) {
    const day = addDays(info.today, d);
    const av = (await site.get(`/api/public/availability?services=${sv.id}&from=${day}&days=1`)).json.days[0];
    if (!av || !av.slots.length) continue;
    const r = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day, start: av.slots[0].m, first: 'Démo', phone: '0612121212' });
    if (r.status === 201) booked = r.json;
  }
  assert.ok(booked && booked.payment, 'a booking with a deposit: ' + JSON.stringify(booked));
  const life = (rt.engine.state.payments.get(booked.payment.id).exp - clock.now) / 60000;
  assert.ok(life > 30 && life < 32, 'the test page lives 31 minutes on the demo’s clock: ' + life.toFixed(1) + ' min');
  assert.ok((await site.get('/api/public/payments/' + booked.payment.id)).json.exp > clock.now, 'the page does not read as lapsed');
  await maybeTick(rt, {}, { force: true });
  assert.equal(rt.engine.state.payments.get(booked.payment.id).status, 'pending', 'not expired by the first tick');
  const pay = await site.post('/api/public/payments/' + booked.payment.id + '/simulate', {});
  assert.deepEqual([pay.status, pay.json.status], [200, 'paid']);
  assert.equal(rt.engine.state.appts.get(rt.engine.state.apptByCode.get(booked.code)).status, 'booked');
});

/* ---------------- (2) the provider down right after the booking is written ---------------- */

test('Stripe down while booking: a clear retryable answer, no ghost booking on the slot, and the retry goes through', async () => {
  const { rt, ids } = await production({ env: STRIPE });
  rt.pay = stripeDown();
  const site = browser(rt), other = browser(rt);
  const body = { serviceIds: [ids.tr], staffId: ids.ali, day: LATER, start: 600, first: 'Léon', phone: '0611223344' };
  const slots = async () => (await other.get(`/api/public/availability?services=${ids.tr}&staff=${ids.ali}&from=${LATER}&days=1`)).json.days[0].slots.map((x) => x.m);

  const r1 = await site.post('/api/public/bookings', body);
  assert.equal(r1.status, 503, JSON.stringify(r1.json));
  assert.equal(r1.json.error.code, 'pay_unavailable');
  assert.equal(r1.json.error.extra.retry, true);
  assert.match(r1.json.error.message, /réessaie/i);
  const s = rt.engine.state;
  assert.deepEqual([...s.appts.values()].map((a) => a.status), ['cancelled'], 'the unpaid booking is taken back at once');
  assert.equal([...s.appts.values()][0].cancel.by, 'system');
  assert.equal([...s.messages.values()].length, 0, 'nobody is told of a booking that never was');
  assert.equal((await slots()).includes(600), true, 'the slot is offered to everyone again');

  rt.pay = stripeUp();
  const r2 = await site.post('/api/public/bookings', body);
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  assert.equal(r2.json.status, 'pending');
  assert.match(r2.json.payment.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal((await slots()).includes(600), false);
  assert.equal(verifyChain(rt.engine.journal).ok, true);
});

/* ---------------- (3) holds per visitor ---------------- */

test('one visitor cannot empty a day with holds: three at most, the oldest given back', async () => {
  const { rt, ids } = await production();
  const visitor = browser(rt, { ip: '203.0.113.9' }), other = browser(rt, { ip: '198.51.100.7' });
  const slots = async (b) => (await b.get(`/api/public/availability?services=${ids.cut}&from=${LATER}&days=1`)).json.days[0].slots;
  const before = (await slots(other)).length;
  assert.ok(before >= 12, 'a full day to take: ' + before);
  const got = [];
  for (let i = 0; i < 24; i++) {
    const free = await slots(visitor);
    if (!free.length) break;
    const r = await visitor.post('/api/public/holds', { serviceIds: [ids.cut], staffId: free[0].s, day: LATER, start: free[0].m });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    got.push(r.json.holdId);
  }
  const live = [...rt.engine.state.holds.values()].filter((h) => h.exp > rt.engine.clock());
  assert.equal(live.length, 3, 'three holds at most for one visitor');
  assert.deepEqual(live.map((h) => h.id).sort(), got.slice(-3).sort(), 'the latest ones: he keeps what he is looking at');
  assert.equal((await slots(other)).length, before - 3, 'everyone else still sees the day');
  assert.ok(live.every((h) => !JSON.stringify(h).includes('203.0.113.9')), 'the address itself is never written to the journal');

  // someone else is not counted with him
  const mine = (await slots(other))[0];
  const h = await other.post('/api/public/holds', { serviceIds: [ids.cut], staffId: mine.s, day: LATER, start: mine.m });
  assert.equal(h.status, 200);
  assert.equal([...rt.engine.state.holds.values()].length, 4);
});

test('a client who changes his mind a few times keeps a valid hold and books with the last one', async () => {
  const { rt, ids } = await production();
  const site = browser(rt, { ip: '203.0.113.10' });
  let last = null;
  // the site replaces its hold; a tab that forgot to (no replace) is not refused either
  for (const [i, start] of [600, 630, 660, 690, 720, 750].entries()) {
    const r = await site.post('/api/public/holds', { serviceIds: [ids.cut], staffId: ids.ali, day: LATER, start, ...(last && i % 2 ? { replace: last.holdId } : {}) });
    assert.equal(r.status, 200, 'change ' + i + ': ' + JSON.stringify(r.json));
    last = r.json;
  }
  assert.ok(rt.engine.state.holds.has(last.holdId));
  const b = await site.post('/api/public/bookings', { holdId: last.holdId, serviceIds: [ids.cut], staffId: ids.ali, day: LATER, start: 750, first: 'Paul', phone: '0611111111' });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.equal(b.json.status, 'booked');
});

test('a hold of the waiting list or of the team is never counted against a visitor', async () => {
  const t = await salon({ hour: 10 });
  const ctx = { ...t.asClient, meta: { ...t.asClient.meta, visitor: 'v1' } };
  for (const start of [600, 630, 660, 690]) await t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start }, t.asClient);
  assert.equal(t.engine.state.holds.size, 4, 'no visitor named (a command run outside the site): no cap');
  for (const start of [720, 750, 780, 810]) await t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start }, ctx);
  assert.equal(t.engine.state.holds.size, 7, 'the visitor’s own fourth hold gave back his first, nobody else’s');
  assert.deepEqual([...t.engine.state.holds.values()].filter((h) => h.vk === 'v1').map((h) => h.start), [750, 780, 810]);
});

/* ---------------- (4) the minimum notice across midnight ---------------- */

test('a 24 h minimum notice holds after midnight: at 23:00, nothing tomorrow morning, the day after is open', async () => {
  const t = await salon({ hour: 23 });
  await t.engine.run(updateSettings, { booking: { minNoticeMin: 1440 } }, t.asOwner());
  const s = t.engine.state, L = localParts(t.clock.now);
  const slots = (day) => freeSlots(s, { day, dur: 30, serviceIds: [t.ids.cut], staffId: 'any', now: t.clock.now, local: L }).map((x) => x.m);
  assert.deepEqual(slots(LATER), [], 'tomorrow is all within 24 h (the salon closes at 18:30)');
  assert.equal(slots(addDays(DAY, 2))[0], 540, 'the day after from 9:00');
  await rejects(t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: LATER, start: 540, first: 'Paul', phone: '0611111111' }, t.asClient), 'taken');

  // 12 h of notice at 23:00: tomorrow from 11:00 on
  await t.engine.run(updateSettings, { booking: { minNoticeMin: 720 } }, t.asOwner());
  assert.equal(slots(LATER)[0], 660);
  assert.equal(minStartFor(s, LATER, L), 660);
  // a short notice changes nothing for the days ahead, and the team's own agenda is never held by it
  await t.engine.run(updateSettings, { booking: { minNoticeMin: 30 } }, t.asOwner());
  assert.equal(minStartFor(s, LATER, L), 0);
  assert.equal(minStartFor(s, DAY, L), 23 * 60 + 30);
  assert.equal(minStartFor(s, LATER, L, { online: false }), 0);
  assert.equal(minStartFor(s, DAY, L, { online: false }), 23 * 60);
});

/* ---------------- (5) no « absent » before the appointment ---------------- */

test('an appointment to come cannot be marked absent; one that started can', async () => {
  const t = await salon({ hour: 10 });
  const future = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 600 }, t.asOwner());
  await rejects(t.engine.run(A.setStatus, { id: future.id, status: 'no_show' }, t.asStaff('Ali')), 'early');
  await rejects(t.engine.run(A.setStatus, { id: future.id, status: 'no_show' }, t.asOwner()), 'early');
  assert.equal(t.engine.state.appts.get(future.id).status, 'booked');
  const today = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 11 * 60 }, t.asOwner());
  await rejects(t.engine.run(A.setStatus, { id: today.id, status: 'no_show' }, t.asStaff('Ali')), 'early');
  t.clock.now = at(DAY, 11, 10);
  assert.deepEqual(await t.engine.run(A.setStatus, { id: today.id, status: 'no_show' }, t.asStaff('Ali')), { ok: true });
  // the next day, yesterday's forgotten one too
  t.clock.now = at(LATER, 9);
  const old = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 15 * 60, force: true }, t.asOwner());
  assert.deepEqual(await t.engine.run(A.setStatus, { id: old.id, status: 'no_show' }, t.asOwner()), { ok: true });
});

/* ---------------- (6) a gift card is never turned into cash at the till ---------------- */

test('a ticket paid with a gift card is not refunded in cash or by card; only what was paid in money goes back', async () => {
  const { rt, owner, ids } = await production();
  const post = (path, body) => owner.post(path, body, rq());
  const sold = await post('/api/v1/sales', { lines: [{ kind: 'giftcard', unit: 5000 }], payments: [{ method: 'card', amount: 5000 }] });
  assert.equal(sold.status, 200, JSON.stringify(sold.json));
  const g = sold.json.giftcards[0];
  const balance = () => rt.engine.state.giftcards.get(g.id).balance;

  const all = await post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'giftcard', amount: 2000, ref: g.code }] });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  for (const method of ['cash', 'card']) {
    const r = await post('/api/v1/sales/' + all.json.id + '/refund', { amount: 2000, method, reason: 'pas content' });
    assert.equal(r.status, 409, method + ': ' + JSON.stringify(r.json));
    assert.equal(r.json.error.code, 'giftcard_paid');
    assert.match(r.json.error.message, /carte cadeau/);
  }
  assert.equal(rt.engine.state.refunds.size, 0, 'no credit note, no money out of the drawer');
  assert.equal(balance(), 3000);

  // a mixed ticket: 15 € on the card, 5 € by bank card. The 5 € go back, not a cent more
  const mixed = await post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'giftcard', amount: 1500, ref: g.code }, { method: 'card', amount: 500 }] });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.json));
  const over = await post('/api/v1/sales/' + mixed.json.id + '/refund', { amount: 600, method: 'card', reason: 'pas content' });
  assert.deepEqual([over.status, over.json.error.code], [409, 'giftcard_paid']);
  const ok = await post('/api/v1/sales/' + mixed.json.id + '/refund', { amount: 500, method: 'card', reason: 'pas content' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const more = await post('/api/v1/sales/' + mixed.json.id + '/refund', { amount: 100, method: 'card', reason: 'pas content' });
  assert.deepEqual([more.status, more.json.error.code], [409, 'giftcard_paid']);
  assert.equal(rt.engine.state.refunds.size, 1);

  // a ticket paid in money is refunded as before, and a replayed refund gets its first answer
  const plain = await post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'card', amount: 2000 }] });
  const h = rq();
  const first = await owner.post('/api/v1/sales/' + plain.json.id + '/refund', { amount: 2000, method: 'card', reason: 'pas content' }, h);
  const again = await owner.post('/api/v1/sales/' + plain.json.id + '/refund', { amount: 2000, method: 'card', reason: 'pas content' }, h);
  assert.deepEqual([first.status, again.status], [200, 200]);
  assert.deepEqual(again.json, first.json);
  assert.equal(rt.engine.state.refunds.size, 2);
});

/* ---------------- (7) erasure reaches what was typed before the file existed ---------------- */

test('erasing a file also takes the person off the waiting list, the walk-in queue and the offers, chain intact', async () => {
  const t = await salon({ hour: 10 });
  const s = () => t.engine.state;
  const NUM = '+33699887766';
  // a stranger joins the waiting list twice (no file yet), is offered a place (a hold, a text), walks in once, then books
  await t.engine.run(updateSettings, { booking: { waitlist: true } }, t.asOwner());
  const full = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 600 }, t.asOwner());
  const w1 = await t.engine.run(A.addWait, { day: LATER, staffId: t.ids.Ali, serviceId: t.ids.cut, from: 600, to: 630, first: 'Karim', phone: '06 99 88 77 66' }, t.asClient);
  const w2 = await t.engine.run(A.addWait, { day: addDays(DAY, 3), staffId: 'any', serviceId: t.ids.cut, first: 'Karim', phone: '06 99 88 77 66' }, t.asClient);
  const other = await t.engine.run(A.addWait, { day: LATER, staffId: 'any', serviceId: t.ids.cut, first: 'Nadia', phone: '06 55 44 33 22' }, t.asClient);
  const q = await t.engine.run(A.addWalkin, { name: 'Karim B.', phone: '06 99 88 77 66', serviceId: t.ids.cut, staffId: 'any' }, t.asOwner());
  await t.engine.run(A.cancelAppointment, { id: full.id }, t.asOwner());
  await t.engine.run(tick, {}, t.sys);
  const offered = s().waitlist.get(w1.id);
  assert.equal(offered.status, 'offered', 'the freed place is offered to him');
  const holdId = offered.offer.holdId;
  assert.ok(s().holds.has(holdId));
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: addDays(DAY, 2), start: 600, first: 'Karim', phone: '0699887766', sms: false }, t.asClient);
  const cid = s().appts.get(b.id).clientId;
  assert.equal(s().waitlist.get(w1.id).clientId, null, 'typed before the file existed: no file on the entry');

  let r = await t.engine.run(eraseClient, { id: cid, cancelUpcoming: true }, { ...t.asOwner(), meta: {} });
  if (!r.erased) {
    for (const id of r.texts) Object.assign(s().messages.get(id), { status: 'sent' });
    r = await t.engine.run(eraseClient, { id: cid, cancelUpcoming: true }, { ...t.asOwner(), meta: {} });
  }
  assert.equal(r.erased, true);
  assert.equal(s().clients.get(cid).erased, true);
  for (const id of [w1.id, w2.id]) assert.deepEqual([s().waitlist.get(id).first, s().waitlist.get(id).phone, s().waitlist.get(id).status], ['', '', 'removed']);
  assert.equal(s().holds.has(holdId), false, 'the place kept for him is given back');
  assert.deepEqual([s().queue.get(q.id).name, s().queue.get(q.id).phone], ['Passage', '']);
  assert.ok([...s().messages.values()].every((m) => m.to !== NUM), 'no text keeps his number');
  assert.deepEqual([s().waitlist.get(other.id).first, s().waitlist.get(other.id).phone], ['Nadia', '+33655443322'], 'nobody else is touched');
  assert.notEqual(s().waitlist.get(other.id).status, 'removed');

  // the store: no event keeps the number or the name, and the chain still verifies (pii sits beside the events)
  const stored = (await t.store.read(0)).events;
  const left = stored.filter((e) => e.pii && /699887766|6 99 88 77 66|Karim/.test(JSON.stringify(e.pii)));
  assert.deepEqual(left.map((e) => e.type), []);
  assert.ok(stored.some((e) => e.pii && JSON.stringify(e.pii).includes('Nadia')));
  assert.equal(verifyChain(stored).ok, true);
  assert.equal(verifyChain(t.engine.journal).ok, true);
});

/* ---------------- (8) availability is never served stale ---------------- */

test('availability: a short shared cache without stale-while-revalidate, and none at all with fresh= (after a 409)', async () => {
  const { rt, ids } = await production();
  const site = browser(rt);
  const base = `/api/public/availability?services=${ids.cut}&from=${LATER}&days=1`;
  const cc = async (path) => (await site.get(path)).headers.get('cache-control');
  const plain = await cc(base);
  assert.doesNotMatch(plain, /stale-while-revalidate/);
  assert.match(plain, /^public, max-age=0, s-maxage=[2-5]$/);
  assert.equal(await cc(base + '&fresh=' + rt.engine.clock()), 'no-store');
  assert.equal(await cc(base + '&fresh'), 'no-store');
  assert.equal(await cc(base + '&hold=ho_x'), 'no-store');
  // the salon's page (names, hours, prices) keeps its cache
  assert.equal(await cc('/api/public/salon'), 'public, max-age=0, s-maxage=20, stale-while-revalidate=60');

  // the case it is for: a slot shown free is taken meanwhile; the answer after the 409 shows it gone
  const a = await site.post('/api/public/bookings', { serviceIds: [ids.cut], staffId: ids.ali, day: LATER, start: 600, first: 'Alain', phone: '0611111111' });
  assert.equal(a.status, 201);
  const b = await browser(rt).post('/api/public/bookings', { serviceIds: [ids.cut], staffId: ids.ali, day: LATER, start: 600, first: 'Bruno', phone: '0622222222' });
  assert.deepEqual([b.status, b.json.error.code], [409, 'taken']);
  const after = await site.get(base + '&fresh=1');
  assert.equal(after.headers.get('cache-control'), 'no-store');
  assert.equal(after.json.days[0].slots.some((x) => x.m === 600), false);
});
