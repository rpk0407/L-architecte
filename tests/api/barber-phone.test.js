// FEATURE C · the barber's phone over HTTP, on the demo salon: « Mon planning » (today and the next 13 days, his column
// only) and « Le client est là ? » (asked at the start, again at +10 min, « Pas encore » asks again 10 min later,
// « Absent » refused before the start, idempotent answers, his own clients only, the desk sees it on the agenda, off in
// Réglages). server/domain/arrival.js, server/commands/arrival.js, server/domain/espace.js planningView.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import { DEMO } from '../../server/domain/seed.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 9, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });
const S = () => rt.engine.state;
const setTime = (h, m) => { clock.now = at(DAY, h, m); };
/** the clock moves on with the phones awake (a PIN session locks after 10 minutes without a request) */
let awake = [];
async function walk(h, m) {
  const to = at(DAY, h, m);
  while (clock.now < to) { clock.now = Math.min(to, clock.now + 5 * 60000); for (const b of awake) await b.get('/api/v1/pulse'); }
}

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
async function book(desk, staffId, first, start) {
  const cut = [...S().services.values()].find((x) => x.slug === 'cl').id;
  const r = await desk.post('/api/v1/appointments', { client: { first, phone: '06 55 01 ' + String(start % 100).padStart(2, '0') + ' ' + String(Math.floor(start / 60)).padStart(2, '0') }, serviceIds: [cut], staffId, day: DAY, start, force: true });
  assert.equal(r.status, 200, r.text);
  return r.json.id || [...S().apptsByDay.get(DAY)].map((id) => S().appts.get(id)).find((a) => a.staffId === staffId && a.start === start && a.status !== 'cancelled').id;
}
const asks = async (b) => { const r = await b.get('/api/v1/pulse'); assert.equal(r.status, 200, r.text); return r.json.arrivals; };

test('« Le client est là ? »: at the start, again at +10, « Pas encore » +10 after, his own clients only, idempotent, the desk sees it', async () => {
  setTime(9, 0);
  const id = await book(await asStaff('Inès'), [...S().staff.values()].find((x) => x.name === 'JKut').id, 'Octave', 21 * 60); // far from the demo's own bookings
  setTime(20, 50);
  const desk = await asStaff('Inès'), jkut = await asStaff('JKut'), aland = await asStaff('Esteban');
  awake = [desk, jkut, aland];
  assert.ok(!(await asks(jkut)).some((x) => x.id === id), 'not asked before the start');
  // « Absent » before the start: refused, as everywhere
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'absent' })).status, 409);
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'later' })).status, 409);
  await walk(21, 0);
  let q = (await asks(jkut)).find((x) => x.id === id);
  assert.ok(q, 'asked at the start');
  assert.equal(q.name, 'Octave');
  assert.equal(q.ask, 21 * 60);
  assert.equal(q.again, false);
  // a colleague is never asked about JKut's client
  assert.ok(!(await asks(aland)).some((x) => x.id === id), 'Esteban is not asked');
  assert.equal((await aland.post('/api/v1/appointments/' + id + '/arrival', { answer: 'here' })).status, 403, 'nor may he answer');
  // the desk sees the question on the agenda
  let row = (await desk.get('/api/v1/agenda?day=' + DAY)).json.appts.find((x) => x.id === id);
  assert.deepEqual(row.arrival, { ask: 21 * 60, due: true, later: null });
  // nothing answered: asked again at +10
  await walk(21, 10);
  q = (await asks(jkut)).find((x) => x.id === id);
  assert.equal(q.ask, 21 * 60 + 10);
  assert.equal(q.again, true);
  // « Pas encore »: gone for 10 minutes, retried with the same request id writes nothing
  await walk(21, 12);
  const len = rt.engine.journal.length;
  const h = { 'x-request-id': 'arrival-later-1' };
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'later' }, h)).status, 200);
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'later' }, h)).status, 200);
  assert.equal(rt.engine.journal.length, len + 1, 'one event for the retried answer');
  assert.ok(!(await asks(jkut)).some((x) => x.id === id), 'not asked while « Pas encore » waits');
  row = (await desk.get('/api/v1/agenda?day=' + DAY)).json.appts.find((x) => x.id === id);
  assert.deepEqual(row.arrival, { ask: 21 * 60 + 22, due: false, later: 21 * 60 + 12 });
  await walk(21, 22);
  assert.equal((await asks(jkut)).find((x) => x.id === id).ask, 21 * 60 + 22, 'asked again 10 minutes after « Pas encore »');
  // « Il est là »: arrived; a second tap (or the desk answering too) is not an error and writes nothing
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'here' })).status, 200);
  assert.equal(S().appts.get(id).status, 'arrived');
  const len2 = rt.engine.journal.length;
  assert.equal((await desk.post('/api/v1/appointments/' + id + '/arrival', { answer: 'here' })).status, 200);
  assert.equal(rt.engine.journal.length, len2);
  assert.ok(!(await asks(jkut)).some((x) => x.id === id), 'no question once he is there');
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'maybe' })).status, 400);
  assert.equal((await browser(rt).post('/api/v1/appointments/' + id + '/arrival', { answer: 'here' })).status, 401);
});

test('« Absent » answers with the usual no-show; the owner turns the question off in Réglages', async () => {
  setTime(9, 0);
  const id = await book(await asStaff('Inès'), [...S().staff.values()].find((x) => x.name === 'JKut').id, 'Marius', 22 * 60);
  setTime(22, 5);
  const desk = await asStaff('Inès'), jkut = await asStaff('JKut'), o = await owner();
  assert.ok((await asks(jkut)).some((x) => x.id === id));
  // off: no question anywhere, the agenda says nothing either
  assert.equal((await o.patch('/api/v1/settings', { team: { arrivalAsk: false } })).status, 200);
  assert.deepEqual(await asks(jkut), []);
  assert.equal((await desk.get('/api/v1/agenda?day=' + DAY)).json.appts.find((x) => x.id === id).arrival, undefined);
  // a barber cannot turn it back on
  assert.equal((await jkut.patch('/api/v1/settings', { team: { arrivalAsk: true } })).status, 403);
  assert.equal((await o.patch('/api/v1/settings', { team: { arrivalAsk: true } })).status, 200);
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'absent' })).status, 200);
  assert.equal(S().appts.get(id).status, 'no_show');
  assert.equal((await jkut.post('/api/v1/appointments/' + id + '/arrival', { answer: 'absent' })).status, 200, 'twice is not an error');
  assert.ok(!(await asks(jkut)).some((x) => x.id === id));
});

test('« Mon planning »: his own column, 14 days ahead, gaps, breaks, total; past days read-only; no chair, no planning', async () => {
  setTime(10, 0);
  const jkut = await asStaff('JKut'), desk = await asStaff('Inès');
  const p = await jkut.get('/api/v1/espace/planning');
  assert.equal(p.status, 200, p.text);
  const v = p.json;
  assert.equal(v.day, DAY);
  assert.equal(v.readOnly, false);
  assert.equal(v.strip.length, 14);
  assert.equal(v.strip[0].day, DAY);
  assert.equal(v.strip[13].day, addDays(DAY, 13));
  const mine = [...S().apptsByDay.get(DAY)].map((id) => S().appts.get(id)).filter((a) => a.staffId === jkut.id && a.status !== 'cancelled');
  assert.equal(v.rows.length, mine.length, 'his own bookings, all of them');
  assert.ok(v.rows.every((r) => mine.some((a) => a.id === r.id)), 'nobody else’s');
  assert.equal(v.total.count, v.rows.filter((r) => r.status !== 'no_show').length);
  assert.equal(v.strip[0].count, v.total.count);
  assert.ok(v.gaps.every((g) => g.start >= 600 && g.end - g.start >= 20), 'gaps from now on');
  assert.ok(Array.isArray(v.breaks) && Array.isArray(v.work));
  // the next days: same shape; the strip's limit is enforced
  const next = (await jkut.get('/api/v1/espace/planning?day=' + addDays(DAY, 13))).json;
  assert.equal(next.day, addDays(DAY, 13));
  assert.equal((await jkut.get('/api/v1/espace/planning?day=' + addDays(DAY, 14))).status, 400);
  // a past day: read-only
  assert.equal((await jkut.get('/api/v1/espace/planning?day=' + addDays(DAY, -1))).json.readOnly, true);
  // the desk has no chair
  assert.equal((await desk.get('/api/v1/espace/planning')).status, 409);
  assert.equal((await browser(rt).get('/api/v1/espace/planning')).status, 401);
});
