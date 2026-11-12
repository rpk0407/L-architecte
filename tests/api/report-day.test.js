// « Reporter ses rendez-vous » over HTTP, on the demo salon: the front desk closes a barber's day, reads who is left
// to call, gets the plan, applies it once (a retried request writes nothing) and takes it back; a barber gets 403 on
// each route (server/commands/report.js, routes-admin.js, tests/unit/report-day.test.js for the rules themselves).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function asStaff(name) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin: DEMO.pins[name] })).status, 200);
  return Object.assign(tab, { id: who.id });
}

test('the desk reports a sick barber’s day: who is left to call, the plan, one apply, the undo; a barber is refused', async () => {
  const desk = await asStaff('Inès'), barber = await asStaff('JKut');
  const S = () => rt.engine.state;
  const frank = [...S().staff.values()].find((x) => x.name === 'Frank').id;
  // Frank has clients this afternoon (two booked here, so the test does not lean on the seed's day)
  const cut = [...S().services.values()].find((x) => x.slug === 'cl').id;
  for (const [first, start] of [['Marius', 15 * 60], ['Octave', 16 * 60]]) {
    const r = await desk.post('/api/v1/appointments', { client: { first, phone: '06 55 00 ' + (start / 60) + ' 01' }, serviceIds: [cut], staffId: frank, day: DAY, start, force: true });
    assert.equal(r.status, 200, r.text);
  }
  // nothing to call while he is there
  assert.deepEqual((await desk.get('/api/v1/agenda?day=' + DAY)).json.toCall, []);
  // « Absent aujourd'hui »: the rest of his day is closed (an existing right of the desk)
  assert.equal((await desk.post('/api/v1/blocks', { staffId: frank, day: DAY, start: 600, end: 1440, label: 'Absent' })).status, 200);
  const call = (await desk.get('/api/v1/agenda?day=' + DAY)).json.toCall;
  assert.equal(call.length, 1);
  assert.equal(call[0].staffId, frank);
  const mine = [...S().apptsByDay.get(DAY)].map((id) => S().appts.get(id)).filter((a) => a.staffId === frank && ['pending', 'booked', 'arrived'].includes(a.status) && a.start + a.dur > 600);
  assert.equal(call[0].rows.length, mine.length);
  assert.ok(call[0].rows.every((r) => /^\d\d( \d\d){4}$/.test(r.phone) || r.phone === ''), 'the desk reads the numbers it calls');
  // a barber does not see the list and is refused on every route
  assert.equal((await barber.get('/api/v1/agenda?day=' + DAY)).json.toCall.length, 0);
  const len = rt.engine.journal.length;
  for (const [path, body] of [['/api/v1/agenda/report/preview', { staffId: frank, day: DAY }], ['/api/v1/agenda/report', { staffId: frank, moves: [{ apptId: mine[0].id, staffId: barber.id, start: 900 }] }], ['/api/v1/agenda/report/undo', { moves: [{ apptId: mine[0].id, from: { staffId: frank, day: DAY, start: 900 }, to: { staffId: barber.id, day: DAY, start: 900 } }] }]]) {
    const r = await barber.post(path, body);
    assert.equal(r.status, 403, path + ' → ' + r.text);
  }
  assert.equal(rt.engine.journal.length, len);
  assert.equal((await browser(rt).post('/api/v1/agenda/report/preview', { staffId: frank })).status, 401);

  // the plan: every row is his, each with a proposal or « à rappeler »
  const plan = (await desk.post('/api/v1/agenda/report/preview', { staffId: frank, day: DAY })).json;
  assert.equal(plan.count, mine.length);
  assert.ok(plan.rows.every((r) => r.staffId === frank && (r.to ? r.to.staffId !== frank && r.kind !== 'call' : r.kind === 'call')));
  const moves = plan.rows.filter((r) => r.to).map((r) => ({ apptId: r.id, staffId: r.to.staffId, start: r.to.start }));
  assert.ok(moves.length >= 2, 'the two booked above at least: ' + JSON.stringify(plan.rows.map((r) => r.kind)));
  // applied once, whatever the network does
  const rid = 'c0ffee00-0000-4000-8000-000000000001';
  const res = await desk.post('/api/v1/agenda/report', { staffId: frank, moves }, { 'x-request-id': rid });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.moved.length + res.json.failed.length, moves.length);
  assert.equal(res.json.failed.length, 0, JSON.stringify(res.json.failed));
  const after = rt.engine.journal.length;
  const again = await desk.post('/api/v1/agenda/report', { staffId: frank, moves }, { 'x-request-id': rid });
  assert.deepEqual(again.json.moved, res.json.moved);
  assert.equal(rt.engine.journal.length, after, 'the retry writes nothing');
  for (const m of res.json.moved) assert.equal(S().appts.get(m.apptId).staffId, m.to.staffId);
  // the time each one left is closed like the rest of his day: the site does not offer it again
  const { isFree } = await import('../../server/domain/availability.js');
  for (const m of res.json.moved) assert.equal(isFree(S(), frank, DAY, m.from.start, 30, { now: clock.now }), false, 'still closed at ' + m.from.start);
  const blocks = () => [...S().blocksByDay.get(DAY)].map((id) => S().blocks.get(id)).filter((b) => b.staffId === frank).length;
  const closed = blocks();
  // the list to call now holds only those left with him
  const left = (await desk.get('/api/v1/agenda?day=' + DAY)).json.toCall;
  assert.equal(left.length ? left[0].rows.length : 0, mine.length - res.json.moved.length);
  // « Annuler »: everyone back, the held texts closed
  const undo = await desk.post('/api/v1/agenda/report/undo', { moves: res.json.moved });
  assert.equal(undo.status, 200, undo.text);
  assert.equal(undo.json.restored.length, res.json.moved.length);
  assert.equal(blocks(), closed - res.json.moved.length, 'the blocks put in their place are gone');
  for (const m of res.json.moved) assert.deepEqual([S().appts.get(m.apptId).staffId, S().appts.get(m.apptId).start], [frank, m.from.start]);
  assert.ok(![...S().messages.values()].some((m) => (m.template === 'reassign' || m.template === 'reassignAt') && m.status === 'queued'));
});
