// « Accès prestataire »: the owner accepts a request with his password; the key then opens the API as him, signed
// « Prestataire », for 24 hours, without ever reaching passwords, codes, phones or devices.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { testRuntime, browser } from '../api/client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const sha = (x) => createHash('sha256').update(x).digest('hex');
const clock = { now: at('2026-11-17', 10, 0) };
const HOUR = 3600000;
let rt;
afterEach(async () => { const o = await owner(); for (const g of (await o.get('/api/v1/support')).json.items) await o.del('/api/v1/support/' + g.id); });
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
const newKey = () => { const key = randomBytes(32).toString('hex'); return { key, demande: sha(key), auth: { authorization: 'Bearer lxa_' + key } }; };
/** a prestataire: no cookie, his key alone */
const presta = (k) => { const b = browser(rt); return { get: (p) => b.get(p, k.auth), post: (p, body) => b.post(p, body, k.auth), patch: (p, body) => b.patch(p, body, k.auth), del: (p) => b.del(p, k.auth) }; };

test('a key nobody accepted opens nothing', async () => {
  const k = newKey();
  assert.equal((await presta(k).get('/api/v1/support/me')).status, 401);
});

test('the owner accepts with his password; the key works as him, signed Prestataire', async () => {
  const o = await owner(), k = newKey();
  assert.equal((await o.post('/api/v1/support', { demande: k.demande, password: 'nope-nope-nope' })).status, 401);
  assert.equal((await presta(k).get('/api/v1/support/me')).status, 401);
  const g = await o.post('/api/v1/support', { demande: k.demande, password: DEMO.password });
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.code, (k.demande.slice(0, 4) + '-' + k.demande.slice(4, 8)).toUpperCase());
  assert.equal(g.json.exp, clock.now + 24 * HOUR);
  // the same request twice: refused
  assert.equal((await o.post('/api/v1/support', { demande: k.demande, password: DEMO.password })).status, 409);

  const p = presta(k);
  const me = await p.get('/api/v1/support/me');
  assert.equal(me.status, 200, me.text);
  assert.ok(me.json.caps.includes('settings'));
  assert.ok(!me.json.caps.includes('devices') && !me.json.caps.includes('client.erase'));
  // the Comptoir itself opens with the key (the screens the owner uses, driven for him)
  const boot = await p.get('/api/v1/bootstrap');
  assert.equal(boot.status, 200, boot.text);
  assert.equal(boot.json.me.session, 'support');
  // the preset is applied through its own route: signed Prestataire too
  const v0 = rt.engine.state.version;
  assert.equal((await p.post('/api/v1/preset/apply', { parts: ['rules'] })).status, 200);
  const evs = (await rt.engine.store.read(v0)).events;
  for (const e of evs) assert.equal(e.actor.via, g.json.id, e.type);
  // a setting changed through the key: done, and the journal says who
  const up = await p.patch('/api/v1/settings', { shop: { legalName: 'Entreprise MARIANI' } });
  assert.equal(up.status, 200, up.text);
  assert.equal(rt.engine.state.settings.shop.legalName, 'Entreprise MARIANI');
  const log = await o.get('/api/v1/audit');
  const line = log.json.items.find((x) => x.type === 'settings.updated');
  assert.match(JSON.stringify(line), /Prestataire \(accès donné par/);
});

test('what the key never opens: passwords, codes, phones, devices, another access', async () => {
  const o = await owner(), k = newKey();
  assert.equal((await o.post('/api/v1/support', { demande: k.demande, password: DEMO.password })).status, 200);
  const p = presta(k);
  const ownerId = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner').id;
  const barber = [...rt.engine.state.staff.values()].find((x) => x.role === 'barber' && x.active).id;
  assert.equal((await p.post('/api/auth/password', { current: DEMO.password, next: 'Un-nouveau-mot-de-passe-9' })).status, 403);
  assert.equal((await p.post('/api/auth/device', { name: 'x' })).status, 403);
  assert.equal((await p.post('/api/v1/staff/' + ownerId + '/password', { password: 'Un-nouveau-mot-de-passe-9' })).status, 403);
  assert.equal((await p.post('/api/v1/staff/' + barber + '/pin', { pin: '4821' })).status, 403);
  assert.equal((await p.post('/api/v1/staff/' + barber + '/phone-link', {})).status, 403);
  assert.equal((await p.post('/api/v1/preset/codes', {})).status, 403);
  assert.equal((await p.get('/api/v1/devices')).status, 403);
  assert.equal((await p.patch('/api/v1/staff/' + ownerId, { email: 'autre@exemple.fr' })).status, 403);
  assert.equal((await p.post('/api/v1/staff', { name: 'Nouveau', role: 'barber', pin: '4821' })).status, 403);
  const k2 = newKey();
  assert.equal((await p.post('/api/v1/support', { demande: k2.demande, password: DEMO.password })).status, 403);
  // the owner's password still opens his Comptoir
  await owner();
});

test('it ends by itself after 24 hours, or when the owner removes it; the prestataire may close his own', async () => {
  const o = await owner(), a = newKey(), b = newKey();
  const t0 = clock.now;
  const ga = await o.post('/api/v1/support', { demande: a.demande, password: DEMO.password });
  const gb = await o.post('/api/v1/support', { demande: b.demande, password: DEMO.password });
  assert.equal(ga.status, 200, ga.text); assert.equal(gb.status, 200, gb.text);
  const list = await o.get('/api/v1/support');
  assert.ok(list.json.items.some((x) => x.id === ga.json.id) && list.json.items.some((x) => x.id === gb.json.id));
  // his own, not the other's
  assert.equal((await presta(a).del('/api/v1/support/' + gb.json.id)).status, 403);
  assert.equal((await presta(a).del('/api/v1/support/' + ga.json.id)).status, 200);
  assert.equal((await presta(a).get('/api/v1/support/me')).status, 401);
  // the owner removes the other
  assert.equal((await o.del('/api/v1/support/' + gb.json.id)).status, 200);
  assert.equal((await presta(b).get('/api/v1/support/me')).status, 401);
  // one left to run out
  const c = newKey();
  assert.equal((await o.post('/api/v1/support', { demande: c.demande, password: DEMO.password })).status, 200);
  clock.now = t0 + 24 * HOUR + 1000;
  assert.equal((await presta(c).get('/api/v1/support/me')).status, 401);
  clock.now = t0;
});

test('a manager cannot open one', async () => {
  const st = [...rt.engine.state.staff.values()].find((x) => x.role === 'manager' && x.active);
  if (!st) return;
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  await b.post('/api/auth/logout');
  const pin = DEMO.pins[st.name];
  if (!pin) return;
  assert.equal((await b.post('/api/auth/pin', { staffId: st.id, pin })).status, 200);
  const r = await b.post('/api/v1/support', { demande: newKey().demande, password: 'x' });
  assert.equal(r.status, 403);
});
