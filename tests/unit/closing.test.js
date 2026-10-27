import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { tick } from '../../server/commands/system.js';
import { REGISTRY, missedZ } from '../../server/commands/tick-steps.js';
import { freeSlots, walkinEstimate } from '../../server/domain/availability.js';
import { dayTotals, drawerExpected, zFigures } from '../../server/domain/cash.js';
import { addDays, localParts } from '../../shared/dates.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { DENOMS } from '../../shared/money.js';

const SYSTEM = { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() };
const book = (t, staff, start, day = DAY) => t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids[staff], day, start }, t.asOwner());
const cardSale = (t) => t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
const slotsToday = (t) => freeSlots(t.engine.state, { day: DAY, dur: 30, serviceIds: [t.ids.cut], staffId: 'any', now: t.clock.now, local: localParts(t.clock.now), online: true });

test('a Z at 15:35 with 7 clients still due is refused, unless the owner closes early on purpose', async () => {
  const t = await salon();
  for (const [staff, start] of [['Ali', 960], ['Ali', 1020], ['Ali', 1080], ['Ben', 960], ['Ben', 990], ['Ben', 1050], ['Ben', 1080]]) await book(t, staff, start);
  const done = await book(t, 'Ali', 600);
  await t.engine.run(S.checkout, { apptId: done.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  t.clock.now = at(DAY, 15, 35);
  assert.ok(slotsToday(t).length > 0, 'online booking still open before the Z');
  const e = await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'too_early');
  assert.equal(e.status, 409);
  assert.equal(e.extra.remaining.length, 7);
  assert.deepEqual(e.extra.remaining[0], { name: 'Yanis M.', start: 960, staff: 'Ali' });
  assert.equal(e.message.replace(/\u00a0/g, ' '), 'Il reste 7 rendez-vous aujourd’hui (le dernier à 18 h). Après la clôture, plus aucun encaissement aujourd’hui.');
  assert.equal(t.engine.state.closures.size, 0);
  await rejects(t.engine.run(S.closeDay, { early: 'yes' }, t.asOwner()), 'too_early');
  await rejects(t.engine.run(S.closeDay, { early: true }, t.asStaff('Ali')), 'forbidden');

  const z = await t.engine.run(S.closeDay, { early: true }, t.asOwner());
  assert.equal(z.number, 1);
  const sealed = t.engine.state.closures.get(DAY);
  assert.equal(sealed.early, true);
  assert.equal(sealed.late, undefined);
  assert.deepEqual(slotsToday(t), [], 'an early Z closes online booking for the rest of the day');
  assert.equal(walkinEstimate(t.engine.state, t.clock.now, localParts(t.clock.now)).minutes, null, 'no walk-in wait offered either');
  const tomorrow = freeSlots(t.engine.state, { day: addDays(DAY, 1), dur: 30, serviceIds: [t.ids.cut], staffId: 'any', now: t.clock.now, local: localParts(t.clock.now), online: true });
  assert.ok(tomorrow.length > 0, 'only the sealed day is affected');
  assert.equal(t.engine.verify().ok, true);
});

test('before closing time the Z waits even with nobody left; after closing time and nothing due, it just closes', async () => {
  const t = await salon();
  await cardSale(t);
  const a = await book(t, 'Ben', 1050);
  t.clock.now = at(DAY, 17, 40);
  await t.engine.run(A.setStatus, { id: a.id, status: 'in_chair' }, t.asOwner());
  let e = await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'too_early');
  assert.equal(e.extra.remaining.length, 1, 'someone in the chair still has to pay');
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  e = await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'too_early');
  assert.deepEqual(e.extra.remaining, []);
  assert.equal(e.extra.closesAt, 1110);
  assert.match(e.message, /ouvert jusqu’à 18\u00a0h\u00a030/);
  t.clock.now = at(DAY, 18, 31);
  const z = await t.engine.run(S.closeDay, {}, t.asOwner());
  assert.equal(z.early, false);
  assert.equal(t.engine.state.closures.get(DAY).early, undefined);
  await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'closed');
});

test('the owner catches up a forgotten day; nothing to close, or an open drawer, is refused', async () => {
  const t = await salon();
  await cardSale(t);
  const tomorrow = addDays(DAY, 1);
  t.clock.now = at(tomorrow, 9, 30);
  await rejects(t.engine.run(S.closeDay, { day: DAY }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(S.closeDay, { day: addDays(DAY, -1) }, t.asOwner()), 'nothing');
  const z = await t.engine.run(S.closeDay, { day: DAY, at: 1 }, t.asOwner());
  assert.equal(z.late, true);
  const sealed = t.engine.state.closures.get(DAY);
  assert.equal(sealed.late, true);
  assert.equal(sealed.auto, undefined, 'done by a person, not by the scheduler');
  assert.equal(sealed.at, t.clock.now, 'a person cannot back-date a Z');
  assert.equal(sealed.net, 2000);
  assert.equal(t.engine.state.closures.has(tomorrow), false, 'today stays open');

  const u = await salon();
  await u.engine.run(S.openDrawer, { float: 10000 }, u.asOwner());
  await cardSale(u);
  u.clock.now = at(tomorrow, 9, 30);
  await rejects(u.engine.run(S.closeDay, { day: DAY }, u.asOwner()), 'drawer_open');
});

test('just after midnight the tick makes the Z nobody made; an uncounted drawer gets a warning instead', async () => {
  const t = await salon();
  await cardSale(t);
  const next = addDays(DAY, 1);
  t.clock.now = at(next, 0, 3);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(t.engine.state.closures.size, 0, 'not before 00:05');
  t.clock.now = at(next, 0, 6);
  const r = await t.engine.run(tick, {}, SYSTEM);
  const z = t.engine.state.closures.get(DAY);
  assert.ok(z, 'a Z exists for the forgotten day');
  assert.equal(z.late, true);
  assert.equal(z.auto, true);
  assert.equal(z.by, 'scheduler');
  assert.equal(z.net, 2000);
  assert.deepEqual(r.warnings, []);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(t.engine.state.closures.size, 1, 'once only');
  assert.equal(t.engine.verify().ok, true);

  // the drawer of that day was never counted: no Z, a warning for the owner
  const u = await salon();
  await u.engine.run(S.openDrawer, { float: 10000 }, u.asOwner());
  await u.engine.run(S.checkout, { lines: [{ kind: 'service', ref: u.ids.cut }], payments: [{ method: 'cash', amount: 2000 }] }, u.asOwner());
  u.clock.now = at(next, 0, 6);
  const w = await u.engine.run(tick, {}, SYSTEM);
  assert.equal(u.engine.state.closures.size, 0);
  assert.equal(w.warnings.length, 1);
  assert.match(w.warnings[0], /^La caisse de mardi n’est pas comptée/);
  assert.deepEqual(missedZ(u.engine.state, next), { close: [], uncounted: [DAY] });
  // counted the next morning: the following tick closes the day
  u.clock.now = at(next, 9, 0);
  await u.engine.run(S.closeDrawer, { counts: { 10000: 1, 2000: 1 } }, u.asOwner());
  await u.engine.run(tick, {}, SYSTEM);
  assert.equal(u.engine.state.closures.get(DAY).late, true);
});

test('several forgotten days are closed one per tick, oldest first; a failing step costs only itself', async () => {
  const t = await salon();
  await cardSale(t);
  const d2 = addDays(DAY, 1);
  t.clock.now = at(d2, 11);
  await cardSale(t);
  await cardSale(t);
  t.clock.now = at(addDays(DAY, 2), 0, 10);
  await t.engine.run(tick, {}, SYSTEM);
  await t.engine.run(tick, {}, SYSTEM);
  const a = t.engine.state.closures.get(DAY), b = t.engine.state.closures.get(d2);
  assert.deepEqual([a.number, b.number], [1, 2]);
  assert.deepEqual([a.grandTotal, b.grandTotal], [2000, 6000]);

  const u = await salon();
  await cardSale(u);
  u.clock.now = at(addDays(DAY, 1), 0, 10);
  REGISTRY.unshift({ name: 'broken', run(s, ctx) { ctx.emit('queue.updated', { id: 'x', patch: {} }); throw new Error('boom'); } });
  const err = console.error;
  console.error = () => {};
  try {
    const r = await u.engine.run(tick, {}, SYSTEM);
    assert.deepEqual(r.failed, ['broken']);
  } finally { REGISTRY.shift(); console.error = err; }
  assert.ok(u.engine.state.closures.get(DAY), 'the next step still ran');
  assert.ok(!u.engine.journal.some((e) => e.type === 'queue.updated'), 'the broken step left nothing behind');
});

test('Z figures: one layout where HT + VAT = net and cash net of refunds = what the drawer should hold', async () => {
  const t = await salon();
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  const cash = await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }, { kind: 'product', ref: t.ids.oil }], tip: { amount: 200, staffId: t.ids.Ali }, payments: [{ method: 'cash', amount: 3700, given: 5000 }] }, t.asOwner());
  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'card', amount: 3000 }] }, t.asOwner());
  await t.engine.run(S.checkout, { lines: [{ kind: 'giftcard', unit: 4000 }], payments: [{ method: 'card', amount: 4000 }] }, t.asOwner());
  await t.engine.run(S.refund, { saleId: cash.id, amount: 1500, method: 'cash', reason: 'Huile retournée' }, t.asOwner());
  const expected = drawerExpected(t.engine.state, t.engine.state.drawer);
  const d = dayTotals(t.engine.state, DAY);
  assert.equal(d.grossTtc, 6500);
  assert.equal(d.refundsTotal, 1500);
  assert.deepEqual(d.refundsByMethod, { cash: 1500 });
  assert.equal(d.netTtc, 5000);
  assert.equal(d.htNet + d.vatNet.reduce((s, v) => s + v.tax, 0), d.netTtc);
  assert.equal(d.paymentsNet.cash, expected - 10000);
  assert.equal(d.paymentsNet.cash, 2200);
  assert.equal(d.paymentsNet.card, 7000);
  assert.equal(d.tips, 200);
  assert.equal(d.giftcardsSold, 4000);

  await t.engine.run(S.closeDrawer, { counts: { 10000: 1, 2000: 1, 200: 1 } }, t.asOwner());
  t.clock.now = at(DAY, 18, 35);
  await t.engine.run(S.closeDay, {}, t.asOwner());
  const z = t.engine.state.closures.get(DAY);
  const f = zFigures(z);
  assert.equal(f.htNet + f.vatNet.reduce((s, v) => s + v.tax, 0), f.netTtc);
  assert.equal(f.grossTtc - f.refundsTotal, f.netTtc);
  assert.equal(f.paymentsNet.cash, expected - 10000);
  assert.equal(f.paidTotal, f.netTtc + f.tips + f.giftcardsSold);
  assert.equal(f.takings + f.prepaid, f.paidTotal);
  assert.equal(f.prepaid, 0, 'no gift card used, no deposit');
  // the sealed record holds each figure once: the layout is derived on reading
  for (const k of ['grossTtc', 'refundsTotal', 'netTtc', 'htNet', 'vatNet', 'giftcardsSold', 'refundCount', 'refundsByMethod', 'paidTotal']) assert.equal(k in z, false, k + ' is not stored in the Z');
  assert.ok(z.paymentsNet);

  // a Z sealed before paymentsNet existed reads the same
  const { paymentsNet, ...legacy } = z;
  assert.deepEqual(zFigures(legacy), f);
});

test('over HTTP: early Z from the Comptoir, the site stops booking, the CSV and the feed follow', async () => {
  const day = DAY;
  const clock = { now: at(day, 15, 35) };
  const rt = await testRuntime({ clock: () => clock.now });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const sv = [...rt.engine.state.services.values()].find((x) => x.active && x.online !== false && !x.pack && x.dur === 30);
  const avail = () => b.get('/api/public/availability?from=' + day + '&days=1&services=' + sv.id);
  // count the drawer to the cent
  const dr = await b.get('/api/v1/drawer');
  assert.ok(dr.json.remaining.length > 0, 'the closing screen knows who is still due');
  assert.equal(dr.json.closesAt, 1110);
  let left = dr.json.open.expected;
  const counts = {};
  for (const c of DENOMS) { const n = Math.min(10000, Math.floor(left / c)); if (n) { counts[c] = n; left -= n * c; } }
  assert.equal((await b.post('/api/v1/drawer/close', { counts })).status, 200);
  assert.ok((await avail()).json.days[0].slots.length > 0);

  const no = await b.post('/api/v1/closures', {});
  assert.equal(no.status, 409);
  assert.equal(no.json.error.code, 'too_early');
  assert.equal(no.json.error.extra.remaining.length, dr.json.remaining.length);
  const yes = await b.post('/api/v1/closures', { early: true });
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  assert.deepEqual((await avail()).json.days[0].slots, []);
  const after = await b.get('/api/v1/drawer');
  assert.equal(after.json.closure.early, true);
  assert.equal(after.json.closure.htNet + after.json.closure.vatNet.reduce((s, v) => s + v.tax, 0), after.json.closure.netTtc);

  const csv = await b.get('/api/v1/export?kind=vat&from=' + day + '&to=' + day);
  const [head, row] = csv.text.replace(/^﻿/, '').trim().split('\r\n');
  const cols = head.split(';');
  assert.deepEqual(cols.slice(0, 11), ['Clôture', 'Jour', 'Type', 'Tickets', 'Premier', 'Dernier', 'CA TTC brut', 'Remboursements', 'CA TTC net', 'CA HT net', 'TVA nette']);
  const cell = row.split(';');
  assert.equal(cell[2], 'en avance');
  assert.ok(cols.includes('Encaissé carte (TPE)'), 'acronyms keep their capitals');
  assert.ok(cols.includes('TVA 20 %'), 'the shop’s VAT rate always has its column');
  for (const k of ['CA TTC brut', 'CA TTC net', 'CA HT net', 'Total des règlements', 'dont carte, espèces, en ligne']) assert.match(cell[cols.indexOf(k)], /^-?\d+,\d{2}$/, k + ' always has two decimals');

  const items = (await b.get('/api/v1/feed')).json.items;
  assert.ok(items.some((x) => x.kind === 'closure' && /^Journée clôturée/.test(x.title)));
});

test('over HTTP: the scheduler’s Z shows up in the feed, an uncounted drawer in the owner’s warnings', async () => {
  const day = DAY;
  const clock = { now: at(day, 18, 40) };
  const rt = await testRuntime({ clock: () => clock.now });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const next = addDays(day, 1);
  clock.now = at(next, 0, 6);
  await rt.engine.run(tick, {}, SYSTEM);
  assert.equal(rt.engine.state.closures.has(day), false, 'the demo drawer is still open');
  const boot = await b.get('/api/v1/bootstrap');
  assert.ok(boot.json.warnings.some((w) => w.startsWith('La caisse de mardi n’est pas comptée')), JSON.stringify(boot.json.warnings));
  assert.equal((await b.get('/api/v1/drawer')).json.warnings.length, 1);
  // no pulse yet: it would start the demo's own background work in the middle of the test
  const v = boot.json.version;
  // counted in the morning, closed by the next tick
  clock.now = at(next, 8, 50);
  const dr = await b.get('/api/v1/drawer');
  let left = dr.json.open.expected;
  const counts = {};
  for (const c of DENOMS) { const n = Math.min(10000, Math.floor(left / c)); if (n) { counts[c] = n; left -= n * c; } }
  assert.equal((await b.post('/api/v1/drawer/close', { counts })).status, 200);
  // the demo's own clients of that day are still in the chair: the day is left to demoTick, which checks them out first
  assert.deepEqual((await rt.engine.run(tick, {}, SYSTEM)).failed, []);
  assert.equal(rt.engine.state.closures.has(day), false, 'auto-z leaves a demo day with clients still due');
  const due = [...rt.engine.state.apptsByDay.get(day)].map((id) => rt.engine.state.appts.get(id)).filter((a) => ['booked', 'arrived', 'in_chair'].includes(a.status));
  assert.ok(due.length > 0);
  for (const a of due) {
    if (a.status !== 'booked') assert.equal((await b.post('/api/v1/appointments/' + a.id + '/status', { status: 'booked' })).status, 200);
    assert.equal((await b.post('/api/v1/appointments/' + a.id + '/status', { status: 'no_show' })).status, 200);
  }
  await rt.engine.run(tick, {}, SYSTEM);
  assert.equal(rt.engine.state.closures.get(day).auto, true);
  const pulse = await b.get('/api/v1/pulse?since=' + v);
  assert.ok(pulse.json.feed.some((x) => x.title === 'Z du mardi 3 fait automatiquement'), JSON.stringify(pulse.json.feed.map((x) => x.title)));
  const feed = (await b.get('/api/v1/feed')).json.items;
  assert.ok(feed.some((x) => x.title === 'Z du mardi 3 fait automatiquement'));
  assert.deepEqual((await b.get('/api/v1/bootstrap')).json.warnings.filter((w) => w.startsWith('La caisse')), []);
});

test('Z numbers follow the calendar: a forgotten day is sealed before the day after it', async () => {
  const t = await salon();
  // Monday: the drawer is opened, a sale, and nobody counts it
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'cash', amount: 2000 }] }, t.asOwner());
  const d2 = addDays(DAY, 1);
  t.clock.now = at(d2, 11);
  await cardSale(t);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(t.engine.state.closures.size, 0, 'the open drawer holds both days back');
  assert.deepEqual(missedZ(t.engine.state, d2), { close: [], uncounted: [DAY] });
  // Tuesday evening the drawer is counted: Tuesday's Z waits for Monday's
  t.clock.now = at(d2, 18, 40);
  await t.engine.run(S.closeDrawer, { counts: { 10000: 1, 2000: 1 } }, t.asOwner());
  const e = await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'missed');
  assert.equal(e.status, 409);
  assert.deepEqual(e.extra.missed, [DAY]);
  await t.engine.run(S.closeDay, { day: DAY }, t.asOwner());
  await t.engine.run(S.closeDay, {}, t.asOwner());
  const a = t.engine.state.closures.get(DAY), b = t.engine.state.closures.get(d2);
  assert.deepEqual([a.number, b.number], [1, 2]);
  assert.deepEqual([a.grandTotal, b.grandTotal], [2000, 4000]);

  // two forgotten days: the later one cannot be caught up first
  const u = await salon();
  await cardSale(u);
  u.clock.now = at(d2, 11);
  await cardSale(u);
  u.clock.now = at(addDays(DAY, 2), 9);
  const m = await rejects(u.engine.run(S.closeDay, { day: d2 }, u.asOwner()), 'missed');
  assert.deepEqual(m.extra.missed, [DAY]);
  await rejects(u.engine.run(S.closeDay, { early: true }, u.asOwner()), 'missed');
});

test('one warning per open drawer, however many days it spans; a day with only a refund still gets its Z', async () => {
  const t = await salon();
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  await cardSale(t);
  const d2 = addDays(DAY, 1), d3 = addDays(DAY, 2);
  t.clock.now = at(d2, 11);
  await cardSale(t);
  t.clock.now = at(d3, 0, 10);
  const r = await t.engine.run(tick, {}, SYSTEM);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^La caisse de mardi n’est pas comptée\. Compte-la\u202f: les journées en attente seront clôturées/);

  // a refund on a day with no ticket: that day's Z carries it, and so does the grand total
  const u = await salon();
  const sale = await cardSale(u);
  u.clock.now = at(DAY, 18, 35);
  await u.engine.run(S.closeDay, {}, u.asOwner());
  u.clock.now = at(d2, 10);
  await u.engine.run(S.refund, { saleId: sale.id, amount: 500, method: 'card', reason: 'Geste commercial' }, u.asOwner());
  assert.deepEqual(missedZ(u.engine.state, d3).close, [d2]);
  u.clock.now = at(d3, 0, 10);
  await u.engine.run(tick, {}, SYSTEM);
  const z = u.engine.state.closures.get(d2);
  assert.ok(z, 'the refund day is closed');
  assert.equal(z.tickets, 0);
  assert.equal(z.net, -500);
  assert.equal(z.grandTotal, 1500);
});

test('after closing time, clients still to pay hold the Z back but it is not an early Z; a no-show nobody marked does not', async () => {
  const t = await salon();
  await cardSale(t);
  const gone = await book(t, 'Ali', 600);
  const a = await book(t, 'Ben', 1050);
  t.clock.now = at(DAY, 18, 0);
  await t.engine.run(A.setStatus, { id: a.id, status: 'in_chair' }, t.asOwner());
  t.clock.now = at(DAY, 18, 45);
  const e = await rejects(t.engine.run(S.closeDay, {}, t.asOwner()), 'too_early');
  assert.equal(e.extra.open, false);
  assert.deepEqual(e.extra.remaining.map((x) => x.start), [1050], 'the 10:00 booking nobody seated is not "still to come"');
  assert.equal(e.message, 'Il reste 1 client à encaisser. Après la clôture, plus aucun encaissement aujourd’hui.');
  assert.equal(t.engine.state.appts.get(gone.id).status, 'booked');
  const z = await t.engine.run(S.closeDay, { early: true }, t.asOwner());
  assert.equal(z.early, false);
  assert.equal(t.engine.state.closures.get(DAY).early, undefined, 'the shop really was closed: not flagged early');
});
