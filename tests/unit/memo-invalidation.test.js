// WP2 · Mémos : n'invalider que ce qui change les chiffres.
// The reads memoised « per journal version » (domain/insights.js, domain/loyalty.js) follow `dataVersion`: a counter that
// stands still for the event types of NO_FIGURES (core/state.js), which change no figure. A stale figure is worse than a
// slow one, so this file checks both sides: the memo survives what it may survive, and every memoised read still equals
// a from-scratch recomputation after each exempt event of the whole demo journal. The reads that do depend on such
// events (Pilotage's free time reads the holds; a barber's space reads holds, messages and review clicks) must show them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, DAY, at } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { emptyState, evolve, NO_FIGURES } from '../../server/core/state.js';
import { EXTENSIONS } from '../../server/core/extensions.js';
import { buildDemoJournal, DEMO } from '../../server/domain/seed.js';
import { report, clientStats, goalOf, goalShares } from '../../server/domain/insights.js';
import { cockpit } from '../../server/domain/cockpit.js';
import { espaceView } from '../../server/domain/espace.js';
import { programStats, liability, cardOf, filesOf } from '../../server/domain/loyalty.js';
import { capsOf } from '../../server/domain/permissions.js';
import { createAppointment, holdSlot, releaseHold } from '../../server/commands/agenda.js';
import { checkout } from '../../server/commands/sales.js';
import { addDays, instantOf, localParts, monthStart, weekStart } from '../../shared/dates.js';

/** The list this file was written against: adding a type to NO_FIGURES must come with its proof here. */
const EXEMPT = ['appt.held', 'hold.released', 'message.queued', 'message.updated', 'prefs.set', 'review.clicked', 'phone.linkIssued', 'phone.pinMissed', 'phone.pinCleared', 'phone.locked'];

/** A synthetic stored event, as the engine would hand it to evolve (the chain is not read by the projection). */
const ev = (s, type, data, atMs) => ({ v: s.version + 1, id: 'syn_' + (s.version + 1), at: atMs, type, actor: { t: 'system', id: 'test' }, data, ph: null, p: s.head, h: 'syn' + (s.version + 1) });

test('the exempt list is the one that was proven, in one place, and nothing else handles those types', () => {
  assert.deepEqual([...NO_FIGURES].sort(), [...EXEMPT].sort());
  // an extension that starts folding one of these types could write a figure: it must be looked at before it is trusted
  const handlers = Object.fromEntries(EXEMPT.map((t) => [t, EXTENSIONS.filter((x) => Object.hasOwn(x.on, t)).length]));
  assert.deepEqual(handlers, {
    'appt.held': 0, 'hold.released': 0, 'message.queued': 0, 'message.updated': 0,
    'prefs.set': 1, 'review.clicked': 1, 'phone.linkIssued': 1, 'phone.pinMissed': 1, 'phone.pinCleared': 1, 'phone.locked': 1
  });
});

test('dataVersion: still for an exempt event, forward for any other, known or not, and for a version moved by hand', () => {
  const s = emptyState();
  assert.equal(s.dataVersion, 0);
  evolve(s, ev(s, 'shop.initialized', { mode: 'production' }, 1000));
  assert.deepEqual([s.version, s.dataVersion], [1, 1]);
  for (const type of EXEMPT) {
    const before = s.dataVersion, v = s.version;
    evolve(s, ev(s, type, { id: 'x_' + type, staffId: 'st_x', prefs: {}, patch: {} }, 2000));
    assert.equal(s.version, v + 1, type + ': the journal version always moves');
    assert.equal(s.dataVersion, before, type + ' must not move dataVersion');
  }
  const before = s.dataVersion;
  evolve(s, ev(s, 'sale.somethingNew', {}, 3000));
  assert.equal(s.dataVersion, before + 1, 'a type nobody knows yet moves it');
  evolve(s, ev(s, 'constructor', {}, 3000));
  assert.equal(s.dataVersion, before + 2, 'even one named like an inherited key');
  // tests (and only tests) change the projection by hand and then move `version` so the reads forget: they still do
  s.version++;
  assert.equal(s.dataVersion, before + 3);
});

test('after a hold: report() and clientStats() are the same objects; Pilotage shows the slot taken', async () => {
  const t = await salon();
  const S = () => t.engine.state;
  const q = () => ({ from: DAY, to: DAY, staffId: null, today: DAY, now: t.clock.now });
  const a = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());

  const r1 = report(S(), q()), c1 = clientStats(S(), DAY, t.clock.now), g1 = goalShares(S(), DAY);
  const l1 = liability(S(), DAY), p1 = programStats(S(), { from: DAY, to: DAY }), f1 = filesOf(S(), t.ids.yanis);
  const ck1 = cockpit(S(), { range: 'day', day: DAY, today: DAY, now: t.clock.now });
  const me = S().staff.get(t.ids.Ali);
  const e1 = espaceView(S(), me, capsOf(me, S().settings), { day: DAY, now: t.clock.now });
  assert.equal(r1.revenue, 2000);

  const v0 = S().version, d0 = S().dataVersion;
  const h = await t.engine.run(holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 900 }, t.asClient);
  assert.equal(S().version, v0 + 1);
  assert.equal(S().dataVersion, d0);
  assert.ok(S().holds.has(h.holdId));
  assert.equal(report(S(), q()), r1, 'report: identity after a hold');
  assert.equal(clientStats(S(), DAY, t.clock.now), c1, 'clientStats: identity after a hold');
  assert.equal(goalShares(S(), DAY), g1);
  assert.equal(liability(S(), DAY), l1);
  assert.equal(programStats(S(), { from: DAY, to: DAY }), p1);
  assert.equal(filesOf(S(), t.ids.yanis), f1);

  // the reads that count the holds are not allowed to keep the old answer
  const ck2 = cockpit(S(), { range: 'day', day: DAY, today: DAY, now: t.clock.now });
  const free = (ck) => ck.today.chairs.find((x) => x.id === t.ids.Ali).freeMin;
  assert.equal(free(ck2), free(ck1) - 30, 'the held half hour is no longer free to sell in Pilotage');
  assert.equal(ck2.kpis.cashed.value, 2000);
  const e2 = espaceView(S(), me, capsOf(me, S().settings), { day: DAY, now: t.clock.now });
  const gapMin = (e) => e.gaps.reduce((n, g) => n + g.dur, 0);
  assert.equal(gapMin(e2), gapMin(e1) - 30, 'nor in the barber’s own gaps');

  await t.engine.run(releaseHold, { id: h.holdId }, t.asClient);
  assert.equal(S().dataVersion, d0);
  assert.equal(report(S(), q()), r1, 'report: identity after the hold is released');
  assert.equal(free(cockpit(S(), { range: 'day', day: DAY, today: DAY, now: t.clock.now })), free(ck1), 'and the slot is free again');
});

test('after sale.completed: a new object and the totals up to date', async () => {
  const t = await salon();
  const S = () => t.engine.state;
  const q = () => ({ from: DAY, to: DAY, staffId: null, today: DAY, now: t.clock.now });
  const r1 = report(S(), q()), c1 = clientStats(S(), DAY, t.clock.now);
  const ck1 = cockpit(S(), { range: 'day', day: DAY, today: DAY, now: t.clock.now });
  assert.equal(r1.revenue, 0);
  // a hold in between changes nothing to what follows
  await t.engine.run(holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 900 }, t.asClient);
  assert.equal(report(S(), q()), r1);
  const d0 = S().dataVersion;
  const sale = await t.engine.run(checkout, { clientId: t.ids.yanis, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  assert.ok(S().dataVersion > d0);
  const r2 = report(S(), q()), c2 = clientStats(S(), DAY, t.clock.now);
  assert.notEqual(r2, r1, 'report: a new object after a sale');
  assert.notEqual(c2, c1, 'clientStats: a new object after a sale');
  assert.equal(r2.revenue, 2000);
  assert.equal(r2.tickets, 1);
  assert.equal(r2.staff.find((x) => x.id === t.ids.Ali).revenue, 2000);
  assert.equal(c2.get(t.ids.yanis).spend, 2000);
  assert.equal(c2.get(t.ids.yanis).visits, 1);
  assert.equal(c1.get(t.ids.yanis), undefined, 'the old map was not written over');
  const ck2 = cockpit(S(), { range: 'day', day: DAY, today: DAY, now: t.clock.now });
  assert.notEqual(ck2, ck1);
  assert.equal(ck2.kpis.cashed.value, 2000);
  assert.ok(S().sales.has(sale.id));
});

test('after message.queued: /api/v1/relances shows the planned follow-up, while the figures keep their memo', async () => {
  // 21:30 on a Tuesday: the quiet hours hold the text until 8:00, so the screen must say « relance prévue »
  const clock = { now: instantOf('2026-11-03', 21 * 60 + 30) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = () => rt.engine.state;
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const first = await b.get('/api/v1/relances');
  assert.equal(first.status, 200, first.text);
  const pick = first.json.items.find((x) => !x.lastText && s().clients.get(x.id).marketing);
  assert.ok(pick, 'the demo has a client to follow up who accepts the offers');
  const today = localParts(clock.now).day;
  const stats = clientStats(s(), today, clock.now);
  const rep = report(s(), { from: monthStart(today), to: today, staffId: null, today, now: clock.now });
  const v0 = s().version, d0 = s().dataVersion;

  const sent = await b.post('/api/v1/relances/send', { clientIds: [pick.id] });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.json.sent, 1);
  const written = rt.engine.journal.slice(v0).map((e) => e.type);
  assert.ok(written.includes('message.queued'));
  const quiet = written.every((x) => NO_FIGURES.has(x));

  const after = await b.get('/api/v1/relances');
  const row = after.json.items.find((x) => x.id === pick.id);
  assert.ok(row, 'still listed');
  assert.ok(row.lastText >= clock.now - 1000, 'the text just queued is on his line');
  assert.ok(row.lastDue > clock.now, 'held by the quiet hours: « relance prévue »');
  const msg = [...s().messages.values()].find((m) => m.template === 'rebook' && m.cid === pick.id && m.at === row.lastText);
  assert.equal(msg.status, 'queued');
  assert.equal(row.lastDue, msg.dueAt);
  // once it may leave, the campaign's own figures count it (attribution reads the messages at each request, by design)
  const sentBefore = after.json.stats.sent;
  clock.now = msg.dueAt + 60000;
  const later = await b.get('/api/v1/relances');
  assert.equal(later.json.stats.sent, sentBefore + 1, 'attribution sees the text as soon as it may leave');
  clock.now = instantOf('2026-11-03', 21 * 60 + 30);

  if (quiet) {
    assert.equal(s().dataVersion, d0, 'only messages were written: the figures did not move');
    assert.equal(clientStats(s(), today, clock.now), stats);
    assert.equal(report(s(), { from: monthStart(today), to: today, staffId: null, today, now: clock.now }), rep);
  } else {
    // the consent notice (client.informed) went with it: a real change, the memo is dropped
    assert.ok(s().dataVersion > d0);
  }
  assert.deepEqual(written.filter((x) => !NO_FIGURES.has(x) && x !== 'client.informed'), [], 'a relance writes messages (and at most the notice)');
});

/* ---------------- the proof by replay ----------------
 * The demo journal is folded event by event. Before an exempt event the memoised reads are warmed; after it, each must
 * (1) still be the same object where it follows dataVersion, and (2) equal what a projection that never memoised
 * anything gives: a shallow copy of the state is a new key for every WeakMap cache, over the very same maps. */

/** Every memoised read of the four modules, at one instant. Strict: the reads whose memo must survive an exempt event. */
function reads(s, now, sample) {
  const today = localParts(now).day;
  const q = (from, to, staffId = null) => ({ from, to, staffId, today, now });
  const chairs = [...s.staff.values()].filter((x) => x.chair);
  const strict = {
    month: report(s, q(monthStart(today), today)),
    week: report(s, q(weekStart(today), today)),
    past: report(s, q(addDays(today, -37), addDays(today, -7))),
    day: report(s, q(today, today)),
    clients: clientStats(s, today, now),
    shares: goalShares(s, today),
    liability: liability(s, today),
    program: programStats(s, { from: addDays(today, -30), to: today })
  };
  chairs.forEach((st, i) => { strict['own' + i] = report(s, q(monthStart(today), today, st.id)); });
  sample.forEach((cid, i) => { strict['card' + i] = cardOf(s, cid, today); strict['files' + i] = filesOf(s, cid); });
  const loose = { goal: goalOf(s, null, today, now), goals: chairs.map((st) => goalOf(s, st.id, today, now)) };
  for (const range of /** @type {const} */ (['day', 'week', 'month'])) loose['cockpit:' + range] = cockpit(s, { range, day: today, today, now });
  chairs.forEach((st, i) => { loose['espace' + i] = espaceView(s, st, capsOf(st, s.settings), { day: today, now }); });
  return { strict, loose };
}

test('replay of the demo: after every exempt event, each memoised read equals a from-scratch recomputation', async () => {
  const nowReal = at('2026-11-10', 15, 20);
  const journal = [...await buildDemoJournal(nowReal)];
  const s = emptyState();
  // the types the seed never writes, folded at the end as the engine would (same shapes as the commands emit)
  const tail = (s0) => {
    const st = [...s0.staff.values()].find((x) => x.chair), dev = 'dev_test';
    const hold = { id: 'ho_test', staffId: st.id, day: localParts(nowReal).day, start: 17 * 60, dur: 30, serviceIds: [], exp: nowReal + 5 * 60000, by: 'client' };
    const msg = [...s0.messages.values()].find((m) => m.template === 'review' && m.apptId && !s0.reviewClicks.has(m.id));
    return [
      ['appt.held', hold], ['hold.released', { id: hold.id }], ['appt.held', { ...hold, id: 'ho_test2', start: 16 * 60 }],
      ['prefs.set', { staffId: st.id, prefs: { home: 'agenda', cal: 3 } }], ['prefs.set', { staffId: st.id, prefs: { cal: 0 } }],
      ['phone.linkIssued', { id: 'nonce_test', staffId: st.id, exp: nowReal + 600000 }],
      ['phone.pinMissed', { id: dev }], ['phone.pinCleared', { id: dev }], ['phone.pinMissed', { id: dev }], ['phone.locked', { id: dev, staffId: st.id, name: 'Téléphone' }],
      ...(msg ? [['review.clicked', { id: msg.id }]] : []),
      ['message.queued', { id: 'msg_test', template: 'rebook', channel: 'sms', cid: [...s0.clients.keys()][0], dueAt: nowReal + 3600000 }],
      ['message.updated', { id: 'msg_test', patch: { status: 'sent', sentAt: nowReal } }]
    ];
  };

  /** exempt type → how many times it was checked */
  const checked = new Map(EXEMPT.map((t) => [t, 0]));
  const seen = new Map();
  // each type is checked at its first occurrences and then thinned out: the whole journal would take minutes
  const due = (type) => { const n = (seen.get(type) || 0) + 1; seen.set(type, n); return n <= 12 || n % 50 === 0; };
  let sample = [];
  const check = (e) => {
    if (!sample.length || e.v % 500 === 0) sample = [...s.sales.values()].filter((x) => x.clientId).slice(-3).map((x) => x.clientId);
    const now = e.at;
    const before = reads(s, now, sample);
    const d0 = s.dataVersion;
    evolve(s, e);
    assert.equal(s.dataVersion, d0, e.type + ' at v' + e.v + ' moved dataVersion');
    const after = reads(s, now, sample);
    // a projection with no memo at all: a new object over the same maps
    const fresh = reads({ ...s }, now, sample);
    for (const k of Object.keys(before.strict)) {
      assert.equal(after.strict[k], before.strict[k], `${k}: the memo should survive ${e.type} (v${e.v})`);
      assert.deepStrictEqual(after.strict[k], fresh.strict[k], `${k}: stale after ${e.type} (v${e.v})`);
    }
    for (const k of Object.keys(after.loose)) assert.deepStrictEqual(after.loose[k], fresh.loose[k], `${k}: stale after ${e.type} (v${e.v})`);
    checked.set(e.type, checked.get(e.type) + 1);
  };
  for (const e of journal) {
    if (NO_FIGURES.has(e.type) && s.staff.size && due(e.type)) check(e); else evolve(s, e);
  }
  for (const [type, data] of tail(s)) check(ev(s, type, data, nowReal));
  for (const [type, n] of checked) assert.ok(n > 0, type + ' was never exercised');

  // and the other way round: a figure event right after the exempt ones is seen by every read
  const now = nowReal, today = localParts(now).day;
  const m1 = report(s, { from: monthStart(today), to: today, staffId: null, today, now });
  const st = [...s.staff.values()].find((x) => x.chair);
  evolve(s, ev(s, 'staff.updated', { id: st.id, patch: { name: 'Renommé' } }, now));
  const m2 = report(s, { from: monthStart(today), to: today, staffId: null, today, now });
  assert.notEqual(m2, m1);
  assert.equal(m2.staff.find((x) => x.id === st.id).name, 'Renommé');
  assert.deepStrictEqual(m2, report({ ...s }, { from: monthStart(today), to: today, staffId: null, today, now }));
});
