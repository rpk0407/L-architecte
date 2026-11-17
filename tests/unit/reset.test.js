// « Mot de passe oublié »: a signed link goes to the account's own address, lives 30 minutes, works once, and a newer one
// replaces it. Using it sets the password, ends every session of that person and signs this browser in. The answer to an
// ask never tells an account from a stranger, and a prestataire's key cannot ask.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { testRuntime, browser } from '../api/client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { signLink } from '../../server/auth/session.js';

const clock = { now: at('2026-11-17', 10, 0) };
const MIN = 60000;
let rt, ownerId, sent;
before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  ownerId = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner').id;
  sent = [];
  rt.email = { name: 'test', send: async (m) => { sent.push(m); return { ref: 'x' }; } };
});
const tokenOf = () => { const l = rt.engine.state.pwdResets.get(ownerId); return signLink(rt.secret, 'pwd', l.staffId + '~' + l.exp.toString(36) + '~' + l.id); };
const NEW = 'Un-Nouveau-Mot-De-Passe-2026';
let ip = 10;
const fresh = () => browser(rt, { ip: '10.9.0.' + (ip++) });

test('an address nobody has here: the same answer, nothing sent, nothing written', async () => {
  const v = rt.engine.state.version;
  const r = await fresh().post('/api/auth/forgot', { email: 'inconnu@exemple.fr' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true, minutes: 30 });
  assert.equal(sent.length, 0);
  assert.equal(rt.engine.state.version, v);
  assert.equal((await fresh().post('/api/auth/forgot', { email: 'pas un e-mail' })).status, 400);
});

test('the owner asks: one e-mail to his own address, with a link that opens the form', async () => {
  const r = await fresh().post('/api/auth/forgot', { email: DEMO.email.toUpperCase() });
  assert.deepEqual(r.json, { ok: true, minutes: 30 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, DEMO.email);
  const token = tokenOf();
  assert.ok(sent[0].text.includes('/comptoir/mot-de-passe/' + token), 'the link is in the e-mail');
  // the journal keeps the nonce, never the signed link
  const ev = (await rt.engine.store.read(0)).events.filter((e) => e.type === 'pwd.resetIssued').at(-1);
  assert.ok(ev && !JSON.stringify(ev).includes(token.split('.').pop()));
  const peek = await fresh().get('/api/auth/reset/' + encodeURIComponent(token));
  assert.equal(peek.status, 200, peek.text);
  assert.equal(peek.json.staff.name, rt.engine.state.staff.get(ownerId).name);
  // asking again at once sends nothing more
  await fresh().post('/api/auth/forgot', { email: DEMO.email });
  assert.equal(sent.length, 1);
});

test('a link nobody signed, or cut short, opens nothing', async () => {
  const token = tokenOf();
  assert.equal((await fresh().get('/api/auth/reset/' + encodeURIComponent(token.slice(0, -2) + 'zz'))).status, 404);
  assert.equal((await fresh().post('/api/auth/reset', { token: 'st_x~zz~pr_x.abc', password: NEW })).status, 404);
  assert.equal((await fresh().post('/api/auth/reset', { token, password: 'court' })).status, 400);
});

test('the new password: every other session ends, this browser is in, the link is spent', async () => {
  const elsewhere = fresh();
  assert.equal((await elsewhere.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await elsewhere.get('/api/v1/bootstrap')).status, 200);
  clock.now += MIN;
  const token = tokenOf();
  const b = fresh();
  const r = await b.post('/api/auth/reset', { token, password: NEW });
  assert.equal(r.status, 200, r.text);
  assert.equal((await b.get('/api/v1/bootstrap')).status, 200, 'signed in by the reset');
  assert.equal((await elsewhere.get('/api/v1/bootstrap')).status, 401, 'the session opened before is closed');
  assert.equal((await fresh().post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 401, 'the old password is dead');
  assert.equal((await fresh().post('/api/auth/login', { email: DEMO.email, password: NEW })).status, 200);
  assert.equal((await fresh().post('/api/auth/reset', { token, password: NEW + '!' })).status, 409, 'once');
  assert.equal((await fresh().get('/api/auth/reset/' + encodeURIComponent(token))).status, 409);
});

test('thirty minutes, and a newer link replaces the older one', async () => {
  clock.now += 5 * MIN;
  await fresh().post('/api/auth/forgot', { email: DEMO.email });
  const first = tokenOf();
  clock.now += 3 * MIN;
  await fresh().post('/api/auth/forgot', { email: DEMO.email });
  const second = tokenOf();
  assert.notEqual(first, second);
  assert.equal((await fresh().get('/api/auth/reset/' + encodeURIComponent(first))).status, 404, 'replaced');
  assert.equal((await fresh().get('/api/auth/reset/' + encodeURIComponent(second))).status, 200);
  clock.now += 31 * MIN;
  assert.equal((await fresh().get('/api/auth/reset/' + encodeURIComponent(second))).status, 410);
  assert.equal((await fresh().post('/api/auth/reset', { token: second, password: NEW + '2' })).status, 410);
  assert.equal((await fresh().post('/api/auth/login', { email: DEMO.email, password: NEW })).status, 200, 'nothing changed');
});

test('a prestataire’s key cannot ask for a link nor use one', async () => {
  const o = fresh();
  assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: NEW })).status, 200);
  const key = randomBytes(32).toString('hex');
  assert.equal((await o.post('/api/v1/support', { demande: createHash('sha256').update(key).digest('hex'), password: NEW })).status, 200);
  const h = { authorization: 'Bearer lxa_' + key };
  const n = sent.length;
  assert.equal((await fresh().post('/api/auth/forgot', { email: DEMO.email }, h)).status, 403);
  assert.equal((await fresh().post('/api/auth/reset', { token: 'x', password: NEW }, h)).status, 403);
  assert.equal(sent.length, n);
});
