// One request id, several commands: each command gets its own key, and a retried request
// replays the same answers without writing anything twice.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const clock = { now: at('2026-11-03', 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner(on = rt) {
  const b = browser(on);
  const r = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return b;
}
const rid = (n) => 'a11ce000-0000-4000-8000-' + String(n).padStart(12, '0');

test('a new member with a PIN: the PIN is stored and works on a salon device', async () => {
  const b = await owner();
  const before = rt.engine.journal.length;
  const r = await b.post('/api/v1/staff', { name: 'Nino', role: 'barber', pin: '2468' }, { 'x-request-id': rid(1) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const st = (await b.get('/api/v1/staff')).json.items.find((x) => x.id === r.json.id);
  assert.equal(st.hasPin, true, 'the member card shows the PIN as set right away');
  const added = rt.engine.journal.slice(before);
  assert.deepEqual(added.map((e) => e.type), ['staff.added', 'staff.credentials']);
  assert.ok(added.every((e) => e.data.id === r.json.id));

  assert.equal((await b.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  await b.post('/api/auth/logout');
  const pin = await b.post('/api/auth/pin', { staffId: r.json.id, pin: '2468' });
  assert.equal(pin.status, 200, JSON.stringify(pin.json));
  assert.equal(pin.json.me.id, r.json.id);
});

test('the same request replayed returns the same member and writes nothing', async () => {
  const b = await owner();
  const body = { name: 'Rayan', role: 'barber', pin: '3579' };
  const r1 = await b.post('/api/v1/staff', body, { 'x-request-id': rid(2) });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const len = rt.engine.journal.length;
  const r2 = await b.post('/api/v1/staff', body, { 'x-request-id': rid(2) });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal(r2.json.id, r1.json.id);
  assert.equal(rt.engine.journal.length, len, 'no new events');
  assert.equal((await b.get('/api/v1/staff')).json.items.filter((x) => x.name === 'Rayan').length, 1);
});

test('a weak PIN is refused before anyone is added', async () => {
  const b = await owner();
  const len = rt.engine.journal.length;
  const r = await b.post('/api/v1/staff', { name: 'Faible', role: 'barber', pin: '1234' }, { 'x-request-id': rid(4) });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(rt.engine.journal.length, len, 'no member without a PIN');
  assert.equal((await b.get('/api/v1/staff')).json.items.some((x) => x.name === 'Faible'), false);
});

test('a client id cannot collide with the key of a second command', async () => {
  const b = await owner();
  assert.equal((await b.post('/api/v1/staff', { name: 'Ilyes', role: 'barber', pin: '2580' }, { 'x-request-id': rid(5) })).status, 200);
  // the 2nd command above ran under '<id>:1'; '<id>-1' is a different request and must really run
  const len = rt.engine.journal.length;
  const r = await b.post('/api/v1/staff', { name: 'Autre', role: 'barber' }, { 'x-request-id': rid(5) + '-1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.id);
  assert.equal(rt.engine.journal.length, len + 1);
  assert.equal((await b.post('/api/v1/staff', { name: 'Autre' }, { 'x-request-id': rid(5) + ':1' })).status, 400, 'the derived form is refused');
});

test('a new password signs out the other sessions, not this one', async () => {
  // own runtime: changing the demo password must not break the tests that sign in with it
  const c = { now: at('2026-11-03', 10, 0) };
  const own = await testRuntime({ clock: () => c.now });
  const a = await owner(own);
  const other = await owner(own);
  assert.equal((await other.get('/api/v1/bootstrap')).status, 200);
  // sessions are revoked by issue time: one started in the same millisecond would outlive the revocation
  c.now += 60000;
  const r = await a.post('/api/auth/password', { current: DEMO.password, next: 'Nouveau-Fauteuil-13' }, { 'x-request-id': rid(3) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await other.get('/api/v1/bootstrap')).status, 401, 'the other session is signed out');
  assert.equal((await a.get('/api/v1/bootstrap')).status, 200, 'this browser stays signed in');
});
