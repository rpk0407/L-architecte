// Exceptional openings (WP-06): 'ouverts exceptionnellement les lundis 21 & 28 décembre'. The salon opens a day it is
// usually closed, the barbers who don't work that weekday take its hours, a closure the same day still wins, time off
// still counts. The site reads the openings, the barbers' public away notes and a live status that is never stale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { freeSlots, shopIntervals, staffIntervals } from '../../server/domain/availability.js';
import { report, openDays } from '../../server/domain/insights.js';
import { createAppointment } from '../../server/commands/agenda.js';
import { localParts } from '../../shared/dates.js';
import { updateSettings, addClosure } from '../../server/commands/shop.js';
import { addTimeOff, updateStaff } from '../../server/commands/team.js';
import { openings } from '../../server/settings/hours.js';
import { parse } from '../../server/lib/validate.js';

const MON = '2026-12-21', MON2 = '2026-12-28';
const DEC = [{ day: MON, intervals: [[540, 1110]], label: 'Lundis de décembre' }, { day: MON2, intervals: [[540, 1110]], label: 'Lundis de décembre' }];
// a Tuesday the week before: both Mondays are well inside the booking horizon
const open = () => salon({ day: '2026-12-15', hour: 10 });
const q = (t, extra = {}) => ({ day: MON, dur: 30, serviceIds: [t.ids.cut], staffId: 'any', now: t.clock.now, local: localParts(t.clock.now), ...extra });
const starts = (t, extra) => freeSlots(t.engine.state, q(t, extra)).map((x) => x.m);

test('a Monday opening gives slots to the barbers whose Monday is empty', async () => {
  const t = await open();
  assert.equal(starts(t).length, 0, 'closed on Mondays, as usual');
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  assert.deepEqual(shopIntervals(t.engine.state, MON), [[540, 1110]]);
  for (const name of ['Ali', 'Ben']) {
    const m = starts(t, { staffId: t.ids[name] });
    assert.equal(m[0], 540, name + ' from 9 h');
    assert.equal(m.at(-1), 1080, name + ' until the last start before 18 h 30');
    assert.equal(m.length, 19);
  }
  assert.equal(starts(t, { day: MON2 }).length, 19, 'the 28th too');
  assert.equal(starts(t, { day: '2026-12-14' }).length, 0, 'the other Mondays stay closed');
  // the usual week is untouched: the opening beats it only on its own day
  assert.deepEqual(shopIntervals(t.engine.state, '2026-12-22'), [[540, 1110]]);
});

test('a closure on the same day wins over the opening', async () => {
  const t = await open();
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  await t.engine.run(addClosure, { from: '2026-12-21', to: '2026-12-21', label: 'Inventaire' }, t.asOwner());
  assert.deepEqual(shopIntervals(t.engine.state, MON), []);
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ali, MON), []);
  assert.equal(starts(t).length, 0);
  assert.equal(starts(t, { day: MON2 }).length, 19, 'the other opening still stands');
});

test('a barber with time off that day has no slot; the other one keeps his', async () => {
  const t = await open();
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: '2026-12-19', to: '2026-12-23', reason: 'Congés' }, t.asOwner());
  assert.equal(starts(t, { staffId: t.ids.Ali }).length, 0);
  assert.equal(starts(t, { staffId: t.ids.Ben }).length, 19);
  assert.ok(freeSlots(t.engine.state, q(t)).every((x) => x.staffId === t.ids.Ben), '"any" only offers Ben');
  // a few hours off: the rest of the opening stays bookable
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: MON, to: MON, startMin: 540, endMin: 720 }, t.asOwner());
  assert.equal(starts(t, { staffId: t.ids.Ben })[0], 720);
});

test('an opening for some barbers only; a barber who works that weekday keeps his own hours', async () => {
  const t = await open();
  await t.engine.run(updateSettings, { openings: [{ day: MON, intervals: [[600, 780], [840, 1080]], label: 'Noël', staff: [t.ids.Ali] }] }, t.asOwner());
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ali, MON), [[600, 780], [840, 1080]], 'the break too');
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ben, MON), [], 'Ben is not on this one');
  await t.engine.run(updateStaff, { id: t.ids.Ben, patch: { schedule: { ...t.engine.state.staff.get(t.ids.Ben).schedule, 1: [[480, 720]] } } }, t.asOwner());
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ben, MON), [[600, 720]], 'his Monday, inside the salon’s hours');
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ben, MON2), [], 'and nothing on a Monday the salon is closed');
});

test('the list: one per day, sorted, hours in order, defaults filled in; replacing it is idempotent', async () => {
  const got = parse(openings.schema, [{ day: MON2, intervals: [[840, 1110], [540, 780]] }, { day: MON, intervals: [[540, 1110]], label: ' Fêtes ', staff: ['abc'] }]);
  assert.deepEqual(got, [
    { id: 'op-' + MON, day: MON, intervals: [[540, 1110]], label: 'Fêtes', staff: ['abc'] },
    { id: 'op-' + MON2, day: MON2, intervals: [[540, 780], [840, 1110]], label: 'Ouverture exceptionnelle', staff: 'all' }
  ]);
  assert.deepEqual(parse(openings.schema, []), []);
  const bad = [
    [[{ day: MON, intervals: [] }], 'au moins une plage horaire'],
    [[{ day: MON, intervals: [[600, 540]] }], 'la fin doit être après le début'],
    [[{ day: MON, intervals: [[540, 800], [780, 1110]] }], 'des plages se chevauchent'],
    [[{ day: MON, intervals: [[540, 1110]] }, { day: MON, intervals: [[600, 700]] }], 'une seule ouverture par jour'],
    [[{ day: '21/12/2026', intervals: [[540, 1110]] }], 'date AAAA-MM-JJ attendue'],
    [[{ day: MON, intervals: [[540, 1110]], staff: 'some' }], 'liste attendue']
  ];
  for (const [input, msg] of bad) assert.throws(() => parse(openings.schema, input), (e) => e.status === 400 && e.message.includes(msg), msg);

  const t = await open();
  await rejects(t.engine.run(updateSettings, { openings: bad[2][0] }, t.asOwner()), 'invalid');
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  const once = structuredClone(t.engine.state.settings.openings);
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  assert.deepEqual(t.engine.state.settings.openings, once, 'the same list twice: the same openings');
  assert.deepEqual(once.map((o) => o.day), [MON, MON2]);
  await t.engine.run(updateSettings, { openings: [DEC[1]] }, t.asOwner());
  assert.deepEqual(t.engine.state.settings.openings.map((o) => o.day), [MON2], 'removing one is sending the list without it');
  await rejects(t.engine.run(updateSettings, { openings: DEC }, t.asStaff('Ali')), 'forbidden');
});

test('an opening on a usual day: the team keeps its hours, those it names work the opening’s', async () => {
  const t = await open();
  const TUE = '2026-12-22', SAT = '2026-12-19';
  // Ben is off on Tuesdays: an early close on a Tuesday must not bring him in
  await t.engine.run(updateStaff, { id: t.ids.Ben, patch: { schedule: { ...t.engine.state.staff.get(t.ids.Ben).schedule, 2: [] } } }, t.asOwner());
  await t.engine.run(updateSettings, { openings: [{ day: SAT, intervals: [[480, 1200]], label: 'Avant Noël', staff: [t.ids.Ben] }, { day: TUE, intervals: [[540, 840]], label: 'Fêtes' }] }, t.asOwner());
  assert.deepEqual(shopIntervals(t.engine.state, TUE), [[540, 840]]);
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ali, TUE), [[540, 780], [810, 840]], 'his Tuesday, cut at 14 h');
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ben, TUE), [], 'still off');
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ben, SAT), [[480, 1200]], 'named: the longer Saturday');
  assert.deepEqual(staffIntervals(t.engine.state, t.ids.Ali, SAT), [[540, 1110]], 'not named: his own Saturday');
});

test('time off that is only requested takes no slot away', async () => {
  const t = await open();
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  const before = starts(t, { staffId: t.ids.Ali });
  // as DO-05 records a barber's own request, waiting for the owner
  await t.engine.run({ run(s, input, ctx) { ctx.emit('timeoff.added', { id: ctx.id('to'), staffId: t.ids.Ali, from: MON, to: MON, reason: 'Perso', status: 'requested' }); return { ok: true }; } }, {}, t.sys);
  assert.equal([...t.engine.state.timeoff.values()].length, 1);
  assert.deepEqual(starts(t, { staffId: t.ids.Ali }), before);
  assert.equal(staffIntervals(t.engine.state, t.ids.Ali, '2026-12-23').length, 1, 'nor on a usual day');
});

test('the past openings sent back with the list keep the reports of those days', async () => {
  const t = await open();
  await t.engine.run(updateSettings, { openings: DEC }, t.asOwner());
  for (const start of [540, 600, 660, 720]) await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: MON, start }, t.asOwner());
  t.clock.now = at('2027-01-05', 10);
  const week = { from: MON, to: '2026-12-27', today: '2027-01-05', now: t.clock.now };
  const sum = () => { const r = report(t.engine.state, week); return { occ: r.occupancy, ali: r.staff.find((x) => x.name === 'Ali').occupancy, open: openDays(t.engine.state, week.from, week.to) }; };
  const was = sum();
  assert.equal(was.open, 6, 'the Monday, then Tuesday to Saturday');
  assert.ok(was.ali > 0);
  // what Réglages › Horaires sends in January: every opening (past ones too) plus the new one
  await t.engine.run(updateSettings, { openings: [...t.engine.state.settings.openings, { day: '2027-01-11', intervals: [[540, 1110]], label: 'Soldes', staff: 'all' }] }, t.asOwner());
  assert.deepEqual(sum(), was);
  assert.equal(staffIntervals(t.engine.state, t.ids.Ali, MON).length, 1);
});

/* ---------------- what the site reads ---------------- */

const clock = { now: at('2026-12-15', 10) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });
let n = 0;
const rid = () => ({ 'x-request-id': 'openings-test-' + ++n });
async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
const staffNamed = (name) => [...rt.engine.state.staff.values()].find((x) => x.name === name);
/** Time off as DO-05 writes it, with its public note (not in this branch's addTimeOff yet). */
const timeOff = (t) => rt.engine.run({ run(s, input, ctx) { ctx.emit('timeoff.added', { id: ctx.id('to'), reason: 'Congés', ...t }); return { ok: true }; } }, {}, { actor: { t: 'system', id: 'test' }, caps: new Set() });

test('/api/public/salon: the openings to come and the barbers away with a public note', async () => {
  const b = await owner();
  const res = await b.patch('/api/v1/settings', { openings: [{ day: '2026-12-14', intervals: [[540, 1110]] }, ...DEC, { day: '2027-01-04', intervals: [[600, 1080]], label: 'Soldes' }] }, rid());
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal((await b.post('/api/v1/settings/closures', { from: '2027-01-04', to: '2027-01-04', label: 'Inventaire' }, rid())).status, 200);
  const jkut = staffNamed('JKut'), frank = staffNamed('Frank'), soldat = staffNamed('Le Soldat');
  await timeOff({ staffId: jkut.id, from: '2026-12-12', to: '2026-12-16', publicNote: 'JKut revient le 17 décembre' });
  await timeOff({ staffId: frank.id, from: '2026-12-14', to: '2026-12-15', publicNote: true });
  await timeOff({ staffId: frank.id, from: '2026-12-16', to: '2026-12-17' });
  await timeOff({ staffId: soldat.id, from: '2026-12-15', to: '2026-12-18', publicNote: 'Ne doit pas sortir', status: 'requested' });

  const pub = browser(rt);
  const sal = await pub.get('/api/public/salon');
  assert.equal(sal.status, 200);
  assert.deepEqual(sal.json.openings, DEC.map((o) => ({ day: o.day, intervals: o.intervals, label: o.label })), 'past ones and one under a closure are left out');
  const away = Object.fromEntries(sal.json.barbers.map((x) => [x.name, x.away]));
  assert.deepEqual(away.JKut, { until: '2026-12-16', back: '2026-12-17', note: 'JKut revient le 17 décembre' });
  // two absences back to back read as one, and the note says when he really is back (his Friday)
  assert.deepEqual(away.Frank, { until: '2026-12-17', back: '2026-12-18', note: 'Frank revient le vendredi 18 décembre' });
  assert.equal(away['Le Soldat'], null, 'a request not approved yet says nothing');
  assert.equal(away.Esteban, null);
  assert.ok(!JSON.stringify(sal.json).includes('Congés'), 'the reason of an absence stays private');
  // one nobody can be booked on (an unknown or archived barber) is not announced
  const nobody = await b.patch('/api/v1/settings', { openings: [...DEC, { day: '2027-01-11', intervals: [[540, 1110]], staff: ['nobody'] }] }, rid());
  assert.equal(nobody.status, 200);
  assert.deepEqual((await pub.get('/api/public/salon')).json.openings.map((o) => o.day), DEC.map((o) => o.day));

  // the site books that Monday
  const svc = sal.json.services[0].id;
  const av = await pub.get('/api/public/availability?from=2026-12-21&days=1&services=' + svc);
  assert.equal(av.json.days[0].open, true);
  assert.ok(av.json.days[0].slots.length > 0);
});

test('/api/public/live is never served stale: no stale-while-revalidate', async () => {
  const live = await browser(rt).get('/api/public/live');
  assert.equal(live.status, 200);
  assert.match(live.headers.get('cache-control'), /max-age=0/);
  assert.doesNotMatch(live.headers.get('cache-control'), /stale-while-revalidate/);
});
