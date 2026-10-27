// The database down: reads served from memory for 10 minutes (marked stale), writes refused before anything happens,
// then 503 for everything. PIN sessions end on the server after 10 idle minutes. A request replayed on another
// instance gets the first answer, rebuilt from its events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, resetRuntime } from '../../server/http/runtime.js';
import { handle } from '../../server/http/app.js';
import { createEngine } from '../../server/core/engine.js';
import { addService } from '../../server/commands/catalog.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { memoryStore } from '../../server/store/memory.js';
import { browser } from '../api/client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { STORE_DOWN, STORE_LOST } from '../../server/core/engine.js';
import { replayAnswer } from '../../server/core/replay.js';

const MIN = 60000;

// the engine says once per outage that the store is gone: expected here, kept out of the test output (and counted)
const log = console.error, warn = console.warn;
/** @type {string[]} */
const logged = [];
console.error = (...a) => { const m = String(a[0]); if (/^\[lx\] (store|tick|boot|scheduler|pg)/.test(m)) logged.push(m + ' ' + String(a[1] ?? '')); else log(...a); };
console.warn = (...a) => { const m = String(a[0]); if (/^\[lx\] (store|boot)/.test(m)) logged.push(m); else warn(...a); };

/**
 * A memory store that can stop answering, for reads, writes, erasures, or all. lost: the next append is kept but
 * answered with an error (the database died between its commit and its answer); dies: a failed append takes reads down.
 */
function flakyStore() {
  const inner = memoryStore();
  const down = { read: false, append: false, redact: false, lost: false, dies: false };
  const calls = { read: 0, redact: 0 };
  const gone = () => Object.assign(new Error('connect ETIMEDOUT 10.0.0.5:5432'), { code: 'ETIMEDOUT' });
  return {
    down, calls, inner,
    store: {
      ...inner,
      async read(after) { calls.read++; if (down.read) throw gone(); return inner.read(after); },
      async append(list, ep) {
        if (down.append) { if (down.dies) down.read = true; throw gone(); }
        if (down.lost) { down.lost = false; await inner.append(list, ep); throw gone(); }
        return inner.append(list, ep);
      },
      async redact(match) { calls.redact++; if (down.redact) throw gone(); return inner.redact(match); }
    }
  };
}

async function salon(store = flakyStore()) {
  const clock = { now: at('2026-11-03', 10, 0) };
  const rt = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store: store.store });
  return { rt, clock, ...store };
}
async function owner(rt) {
  const b = browser(rt);
  const r = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return b;
}
async function cardSale(b) {
  const boot = await b.get('/api/v1/bootstrap');
  const sv = boot.json.services.find((x) => x.active && x.price > 0);
  return { lines: [{ kind: 'service', ref: sv.id }], payments: [{ method: 'card', amount: sv.price }] };
}
const rid = (n) => 'deadbeef-0000-4000-8000-' + String(n).padStart(12, '0');

test('store down: reads from memory marked stale, writes refused with nothing written, 503 after 10 minutes', async () => {
  const { rt, clock, down } = await salon();
  const b = await owner(rt);
  const body = await cardSale(b);
  const fresh = await b.get('/api/public/salon');
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get('x-lx-stale'), null);

  down.read = true;
  const len = rt.engine.journal.length;
  clock.now += 2 * MIN;
  const pub = await b.get('/api/public/salon');
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.headers.get('x-lx-stale'), '1');
  assert.equal(pub.headers.get('cache-control'), 'no-store', 'no edge cache keeps a stale answer');
  assert.deepEqual({ ...pub.json, now: 0 }, { ...fresh.json, now: 0 }, 'the projection the instance holds');
  const ag = await b.get('/api/v1/agenda?day=2026-11-03');
  assert.equal(ag.status, 200);
  assert.equal(ag.headers.get('x-lx-stale'), '1', 'the Comptoir reads too, and shows the banner');

  const sale = await b.post('/api/v1/sales', body, { 'x-request-id': rid(1) });
  assert.equal(sale.status, 503);
  assert.equal(sale.json.error.code, 'store_down');
  assert.equal(sale.json.error.message, STORE_DOWN);
  const booking = await browser(rt).post('/api/public/holds', { serviceIds: [body.lines[0].ref], day: '2026-11-04', start: 600, staffId: 'any' });
  assert.equal(booking.status, 503);
  assert.equal(booking.json.error.message, 'Le salon ne répond pas. Réessaie dans un instant.', 'a client has no ticket to note on paper');
  assert.equal(rt.engine.journal.length, len, 'nothing written');

  // signing in and out only sets a cookie: a salon tablet still opens during the outage
  const other = browser(rt);
  const login = await other.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(login.headers.get('x-lx-stale'), '1');

  clock.now += 9 * MIN; // 11 minutes since the last read that reached the store
  const late = await b.get('/api/public/salon');
  assert.equal(late.status, 503, 'too old to be served');
  assert.equal(late.json.error.code, 'store_down');
  assert.equal(late.json.error.message, 'Le salon ne répond pas. Réessaie dans un instant.', 'what the site shows');
  assert.equal((await b.get('/api/v1/agenda?day=2026-11-03')).status, 503);

  // back: fresh answers, and the ticket goes through once
  down.read = false;
  const back = await b.get('/api/public/salon');
  assert.equal(back.status, 200);
  assert.equal(back.headers.get('x-lx-stale'), null);
  const ok = await b.post('/api/v1/sales', body, { 'x-request-id': rid(1) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(rt.engine.journal.filter((e) => e.type === 'sale.completed' && e.data.id === ok.json.id).length, 1);
});

test('the store failing while writing: 503 that says it may be saved, and the retry counts once', async () => {
  const { rt, down } = await salon();
  const b = await owner(rt);
  const body = await cardSale(b);
  const before = rt.engine.state.saleSeq;
  down.append = true;
  const r1 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(2) });
  assert.equal(r1.status, 503);
  assert.equal(r1.json.error.code, 'store_down');
  assert.equal(r1.json.error.message, STORE_LOST);
  down.append = false;
  const r2 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(2) });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  const r3 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(2) });
  assert.equal(r3.json.id, r2.json.id);
  assert.equal(rt.engine.state.saleSeq, before + 1);
});

test('a cold start that cannot reach the store answers 503, and recovers on the next request', async () => {
  const { store, down } = flakyStore();
  const clock = { now: at('2026-11-03', 10, 0) };
  const seeded = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store });
  assert.ok(seeded.engine.state.version > 0);
  down.read = true;
  await assert.rejects(createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store }));
  // the same through the handler: a fresh engine that never read the store has nothing to serve
  const { createEngine } = await import('../../server/core/engine.js');
  const cold = { ...seeded, engine: createEngine(store, { clock: () => clock.now, syncEveryMs: 0 }) };
  const r = await browser(cold).get('/api/public/salon');
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'store_down');
  down.read = false;
  assert.equal((await browser(cold).get('/api/public/salon')).status, 200);
});

test('a PIN session idle for 11 minutes is refused with pin_idle; each request slides it; a password session is unaffected', async () => {
  const { rt, clock } = await salon();
  const tablet = await owner(rt);
  assert.equal((await tablet.post('/api/auth/device', { name: 'Comptoir' })).status, 200);
  await tablet.post('/api/auth/logout');
  const st = await tablet.get('/api/auth/state');
  const jkut = st.json.team.find((x) => x.name === 'JKut');
  const pin = await tablet.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut || '2468' });
  assert.equal(pin.status, 200, JSON.stringify(pin.json));
  const pwd = await owner(rt);

  // used every few minutes: it slides, re-signed at most once a minute
  for (let i = 0; i < 4; i++) {
    clock.now += 8 * MIN;
    const r = await tablet.get('/api/v1/pulse');
    assert.equal(r.status, 200, 'minute ' + (i + 1) * 8 + ': ' + JSON.stringify(r.json));
    assert.ok(r.headers.getSetCookie().some((c) => c.startsWith('lx_s=') && !/max-age=0/i.test(c)), 'the session is re-issued');
  }
  clock.now += 20000;
  const soon = await tablet.get('/api/v1/pulse');
  assert.equal(soon.status, 200);
  assert.equal(soon.headers.getSetCookie().length, 0, 'not re-signed twice within a minute');

  clock.now += 11 * MIN;
  const idle = await tablet.get('/api/v1/pulse');
  assert.equal(idle.status, 401);
  assert.equal(idle.json.error.code, 'pin_idle');
  assert.ok(idle.headers.getSetCookie().some((c) => c.startsWith('lx_s=;') || /lx_s=.*max-age=0/i.test(c)), 'the cookie is cleared');
  assert.equal((await tablet.get('/api/v1/bootstrap')).json.error.code, 'signed_out', 'gone for good: the code pad again');
  // the device stays a salon device: the code opens it again
  assert.equal((await tablet.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut || '2468' })).status, 200);

  // the owner's password session, idle for 43 minutes, is still there
  const r = await pwd.get('/api/v1/bootstrap');
  assert.equal(r.status, 200, JSON.stringify(r.json));
});

test('a request replayed on an instance that never saw it gets the first answer, rebuilt from its events', async () => {
  const { store } = flakyStore();
  const clock = { now: at('2026-11-03', 10, 0) };
  const env = { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' };
  const a = await createRuntime({ env, clock: () => clock.now, store });
  const b = await createRuntime({ env, clock: () => clock.now, store }); // another instance, or the same after a restart
  const onA = await owner(a);
  const onB = browser(b);
  for (const [k, v] of onA.jar) onB.jar.set(k, v);

  const staff = { name: 'Nino', role: 'barber', pin: '3579' };
  const s1 = await onA.post('/api/v1/staff', staff, { 'x-request-id': rid(10) });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  const s2 = await onB.post('/api/v1/staff', staff, { 'x-request-id': rid(10) });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  assert.equal(s2.json.id, s1.json.id, 'POST /api/v1/staff answers with the same id');
  assert.equal([...b.engine.state.staff.values()].filter((x) => x.name === 'Nino').length, 1);

  const body = await cardSale(onA);
  const t1 = await onA.post('/api/v1/sales', body, { 'x-request-id': rid(11) });
  assert.equal(t1.status, 200, JSON.stringify(t1.json));
  const t2 = await onB.post('/api/v1/sales', body, { 'x-request-id': rid(11) });
  assert.equal(t2.status, 200, JSON.stringify(t2.json));
  for (const k of ['id', 'number', 'change']) assert.deepEqual(t2.json[k], t1.json[k], k);
  assert.equal(t2.json.totals.due, t1.json.totals.due);
  assert.deepEqual(t2.json.giftcards, []);
  assert.equal(b.engine.journal.filter((e) => e.type === 'sale.completed' && e.data.id === t1.json.id).length, 1, 'nothing written twice');
  assert.equal(b.engine.state.saleSeq, t1.json.number);

  const day = '2026-11-05';
  // a new client on the way: the file is written first, the answer is still the booking's
  const ap = { client: { first: 'Karim', phone: '06 12 34 56 78' }, serviceIds: [body.lines[0].ref], staffId: [...a.engine.state.staff.values()].find((x) => x.active && x.chair).id, day, start: 9 * 60, sms: false, source: 'phone', force: true };
  const p1 = await onA.post('/api/v1/appointments', ap, { 'x-request-id': rid(12) });
  assert.equal(p1.status, 200, JSON.stringify(p1.json));
  const p2 = await onB.post('/api/v1/appointments', ap, { 'x-request-id': rid(12) });
  assert.equal(p2.json.id, p1.json.id);
  assert.equal(p2.json.code, p1.json.code);
  assert.equal(b.engine.journal.filter((e) => e.type === 'appt.booked' && e.data.id === p1.json.id).length, 1);
});

test('the rebuilt answers: a booking that opens a file answers with the booking, a batch of bookings with no single one', () => {
  const ev = (type, data) => ({ type, data });
  const booked = replayAnswer(/** @type {any} */ ([ev('client.added', { id: 'cl_1' }), ev('appt.booked', { id: 'ap_1', code: 'LA-7K2P', status: 'pending', staffId: 'st_1', price: 2500, deposit: { amount: 1000 } })]));
  assert.deepEqual({ ...booked, events: undefined }, { id: 'ap_1', code: 'LA-7K2P', status: 'pending', staffId: 'st_1', deposit: 1000, price: 2500, duplicate: true, events: undefined });
  const walkin = replayAnswer(/** @type {any} */ ([ev('client.added', { id: 'cl_2' }), ev('queue.added', { id: 'qu_1' })]));
  assert.equal(walkin.id, 'qu_1');
  assert.equal(replayAnswer(/** @type {any} */ ([ev('client.added', { id: 'cl_3' })])).created, true);
  const batch = replayAnswer(/** @type {any} */ ([ev('appt.booked', { id: 'ap_2' }), ev('appt.booked', { id: 'ap_3' })]));
  assert.equal(batch.code, undefined);
  assert.equal(batch.duplicate, true);
  assert.equal(batch.events.length, 2, 'the events, for the routes that read them back');
  assert.deepEqual(replayAnswer(/** @type {any} */ ([ev('client.merged', { from: 'cl_4', into: 'cl_5' })])).id, 'cl_5');
});

test('a retry while the store is down: the answer this instance already gave, and no "nothing saved" for a write it is unsure of', async () => {
  const { rt, down } = await salon();
  const b = await owner(rt);
  const body = await cardSale(b);
  const before = rt.engine.state.saleSeq;

  // recorded, the answer lost on the way, then the database goes: the retry is the same ticket, not a refusal
  const t1 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(20) });
  assert.equal(t1.status, 200, JSON.stringify(t1.json));
  down.read = true; down.append = true;
  const t2 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(20) });
  assert.equal(t2.status, 200, JSON.stringify(t2.json));
  assert.equal(t2.json.id, t1.json.id);
  assert.equal(t2.headers.get('x-lx-stale'), '1');

  // kept by the database, which died before answering: the retry while it is down is not told nothing was saved
  down.read = false; down.append = false; down.lost = true;
  logged.length = 0;
  const l1 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(21) });
  assert.equal(l1.status, 503);
  assert.equal(l1.json.error.message, STORE_LOST);
  assert.ok(logged.some((m) => m.startsWith('[lx] store append failed: connect ETIMEDOUT')), 'a write that fails is in the logs: ' + logged.join(' | '));
  down.read = true; down.append = true;
  const l2 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(21) });
  assert.equal(l2.status, 503);
  assert.equal(l2.json.error.message, STORE_LOST, 'the same message as the first try, never "rien n’est enregistré"');
  const fresh = await b.post('/api/v1/sales', body, { 'x-request-id': rid(22) });
  assert.equal(fresh.json.error.message, STORE_DOWN, 'a new ticket: nothing was written, paper');

  // back: the retry finds the ticket the database kept, and counts it once
  down.read = false; down.append = false;
  const l3 = await b.post('/api/v1/sales', body, { 'x-request-id': rid(21) });
  assert.equal(l3.status, 200, JSON.stringify(l3.json));
  assert.equal(l3.json.duplicate, true);
  assert.equal(rt.engine.state.saleSeq, before + 2);
  assert.equal(rt.engine.journal.filter((e) => e.type === 'sale.completed').length, (await rt.engine.store.read(0)).events.filter((e) => e.type === 'sale.completed').length);
});

test('a batch whose append throws is undone: memory never runs ahead of the store, and the next write goes through', async () => {
  const { rt, down, inner } = await salon();
  const e = rt.engine;
  const v = e.state.version;
  const owner_ = { actor: { t: 'system', id: 'test', n: 'test' }, caps: new Set(['catalog']) };
  const sv = (name) => ({ name, price: 1000, dur: 30, category: [...e.state.services.values()][0].category });
  down.append = true;
  await assert.rejects(e.batch((step) => { step(addService, sv('Fantôme'), owner_); }), (x) => x.status === 503 && x.code === 'store_down');
  assert.equal(e.state.version, v, 'undone');
  assert.ok(![...e.state.services.values()].some((x) => x.name === 'Fantôme'));
  assert.equal((await inner.read(0)).events.length, v);
  down.append = false;
  const r = await e.run(addService, sv('Vrai'), owner_);
  assert.ok(r.id);
  assert.equal(e.state.version, v + 1);

  // the batch fails and so does the re-read: an empty projection is never served, stale or not
  down.append = true; down.dies = true;
  await assert.rejects(e.batch((step) => { step(addService, sv('Fantôme'), owner_); }));
  const pub = await browser(rt).get('/api/public/salon');
  assert.equal(pub.status, 503, JSON.stringify(pub.json).slice(0, 200));
  down.append = false; down.read = false;
  const back = await browser(rt).get('/api/public/salon');
  assert.equal(back.status, 200);
  assert.equal(e.state.version, v + 1);
});

test('an erasure the store fails to apply is applied after its next read, and after a restart too', async () => {
  const { rt, down, inner, store, calls } = await salon();
  const b = await owner(rt);
  const withPii = (list, id) => list.filter((x) => x.pii != null && (x.data.cid === id || (x.type.startsWith('client.') && x.data.id === id)));
  const cid = [...rt.engine.state.clients.values()].find((c) => !c.erased && withPii(rt.engine.journal, c.id).length).id;
  down.redact = true;
  const r = await b.post('/api/v1/clients/' + cid + '/erase', { cancelUpcoming: true });
  assert.equal(r.status, 200, 'the erasure is written: ' + JSON.stringify(r.json));
  assert.equal(withPii(rt.engine.journal, cid).length, 0, 'memory forgot at once');
  assert.ok(withPii((await inner.read(0)).events, cid).length > 0, 'the store did not');
  assert.ok(logged.some((m) => m.startsWith('[lx] store redact failed')));

  // a fresh instance (a restart) reads personal data whose erasure is in the store: it queues the redaction itself
  const clock = { now: rt.engine.clock() };
  const cold = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store });
  assert.equal(withPii(cold.engine.journal, cid).length, 0, 'the restarted memory forgot too');
  down.redact = false;
  await rt.engine.sync(true);
  assert.equal(withPii((await inner.read(0)).events, cid).length, 0, 'the store forgot after the next read');
  const n = calls.redact;
  await cold.engine.sync(true);
  assert.equal(calls.redact, n + 1, 'the restarted instance asked too (nothing left to remove, no harm)');
  await rt.engine.sync(true);
  assert.equal(calls.redact, n + 1, 'once done, not asked again');
});

test('while the store is down a request does not wait for it each time: one try every few seconds', async () => {
  const { store, down, calls } = flakyStore();
  const e = createEngine(store, { syncEveryMs: 50 }); // retries every 100 ms
  await e.sync();
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  down.read = true;
  logged.length = 0;
  await wait(60);
  await assert.rejects(e.sync());
  const n = calls.read;
  await assert.rejects(e.sync());
  await assert.rejects(e.sync());
  assert.equal(calls.read, n, 'answered from the last failure, without asking the store');
  await wait(110);
  await assert.rejects(e.sync());
  assert.equal(calls.read, n + 1, 'tried again');
  assert.equal(logged.filter((m) => m.startsWith('[lx] store unreachable')).length, 1, 'told once per outage');
  down.read = false;
  await wait(110);
  await e.sync();
  assert.ok(logged.includes('[lx] store reachable again'));
});

test('a cold start that cannot build its runtime: 503 through the real handler, logged once per outage', async () => {
  const saved = { ...process.env };
  // a data file that is a folder: the store cannot be opened, like a database that does not answer at boot
  process.env.LX_DATA_FILE = mkdtempSync(join(tmpdir(), 'lx-boot-'));
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL; delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.LX_MODE;
  process.env.SESSION_SECRET = 'test-secret-0123456789';
  resetRuntime();
  logged.length = 0;
  try {
    for (let i = 0; i < 3; i++) {
      const r = await handle(new Request('http://localhost/api/public/salon'));
      assert.equal(r.status, 503);
      const j = await r.json();
      assert.equal(j.error.code, 'store_down');
      assert.equal(j.error.message, 'Le salon ne répond pas. Réessaie dans un instant.');
      const staff = await handle(new Request('http://localhost/api/v1/pulse'));
      assert.equal((await staff.json()).error.message, 'La base de données ne répond pas. Réessaie dans un instant.');
    }
    assert.equal(logged.filter((m) => m.startsWith('[lx] boot')).length, 1, 'one stack, not one per request');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    resetRuntime();
  }
});

test('Postgres: the pool survives an idle connection the database dropped, and limits a stuck statement on the database side', async () => {
  const Real = pg.Pool;
  /** @type {any[]} */
  const made = [];
  // @ts-ignore a pool that records itself, so the test reaches the one the store made
  pg.Pool = class extends Real { constructor(c) { super(c); made.push(this); } };
  try {
    const { postgresStore } = await import('../../server/store/postgres.js');
    postgresStore({ url: 'postgres://lx:lx@127.0.0.1:1/lx' });
    const pool = made[0];
    assert.ok(pool);
    logged.length = 0;
    pool.emit('error', new Error('terminating connection due to administrator command'));
    assert.ok(logged.some((m) => m.startsWith('[lx] pg idle client: terminating connection')), 'told, not thrown');
    assert.equal(pool.options.statement_timeout, 10000, 'the database aborts a stuck statement, and its transaction with it');
    assert.equal(pool.options.keepAlive, true);
    // a pool passed in belongs to the caller, who listens to it
    const own = new Real({ connectionString: 'postgres://lx:lx@127.0.0.1:1/lx' });
    postgresStore({ pool: own });
    assert.equal(own.listenerCount('error'), 0);
    await pool.end(); await own.end();
  } finally { pg.Pool = Real; }
});
