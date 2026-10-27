// The encrypted backup and the way back: the whole journal (personal data and credentials included) sealed with
// BACKUP_KEY, kept 30 days + 12 months in Blob, restored only into an empty salon with SETUP_TOKEN.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createEngine } from '../../server/core/engine.js';
import { memoryStore } from '../../server/store/memory.js';
import { blobBackups, fakeBlobSdk } from '../../server/store/blob.js';
import { createRuntime } from '../../server/http/runtime.js';
import { maybeTick } from '../../server/http/scheduler.js';
import { buildDemoJournal } from '../../server/domain/seed.js';
import { sealBackup, openBackup, restoreBackup, retention, backupKey, nightlyBackup, makeBackup, backupStatus, freshBackup, salonOf, KEEP_DAILY, KEEP_MONTHLY } from '../../server/core/backup.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addClient, eraseClient } from '../../server/commands/clients.js';
import { browser } from '../api/client.js';
import { at, rejects } from '../helpers.js';
import { addDays } from '../../shared/dates.js';

const KEY_B64 = randomBytes(32).toString('base64');
const KEY = backupKey(KEY_B64);
const SECRET = 'test-secret-0123456789';
const names = (s) => [...s.clients.values()].map((c) => c.id + ' ' + c.first + ' ' + c.last).sort();

/* ---------------- the file ---------------- */

let demo;
before(async () => {
  demo = createEngine(memoryStore(), { syncEveryMs: 0 });
  await demo.adopt(await buildDemoJournal(at('2026-10-27', 15, 10)));
});

test('the demo journal round-trips through encryption, personal data and credentials included', () => {
  const file = sealBackup(demo.journal, KEY, { at: at('2026-10-28', 3, 2), shop: 'L’Architecte' });
  const env = JSON.parse(file);
  assert.deepEqual(Object.keys(env).sort(), ['at', 'count', 'data', 'head', 'iv', 'salon', 'tag', 'v']);
  assert.equal(env.v, 1);
  assert.equal(env.salon, demo.journal[0].h, 'which salon, in clear and authenticated');
  assert.equal(env.count, demo.journal.length);
  assert.equal(env.head, demo.state.head);
  const someone = [...demo.state.clients.values()].find((c) => c.phone);
  assert.ok(someone);
  assert.ok(!file.includes(someone.first) && !file.includes(someone.phone), 'nothing readable without the key');

  const back = openBackup(file, KEY);
  assert.equal(back.events.length, demo.journal.length);
  assert.deepEqual(back.events, JSON.parse(JSON.stringify(demo.journal)), 'as a durable store keeps them');
  assert.ok(back.events.some((e) => e.pii && e.pii.pwd), 'the owner’s password hash travels with it');
});

test('a wrong key, a changed header or a file that is not a backup throws', async () => {
  const file = sealBackup(demo.journal.slice(0, 50), KEY, { at: 1 });
  assert.throws(() => openBackup(file, randomBytes(32)), (e) => e.code === 'backup_key');
  const env = JSON.parse(file);
  assert.throws(() => openBackup(JSON.stringify({ ...env, at: 2 }), KEY), (e) => e.code === 'backup_key', 'the clear fields are authenticated');
  assert.throws(() => openBackup('{"hello":1}', KEY), (e) => e.code === 'backup_file');
  assert.throws(() => backupKey(''), (e) => e.code === 'backup_key' && /BACKUP_KEY n’est pas défini/.test(e.message));
  assert.throws(() => backupKey(randomBytes(16).toString('base64')), (e) => e.code === 'backup_key' && /32 octets/.test(e.message));
  assert.equal(backupKey(randomBytes(32).toString('base64url')).length, 32, 'base64url works too');
});

test('restoring into an empty memory store gives the same head and the same client names', async () => {
  const file = sealBackup(demo.journal, KEY, { at: 1 });
  const fresh = createEngine(memoryStore(), { syncEveryMs: 0 });
  const res = await restoreBackup(fresh, file, KEY);
  assert.equal(res.version, demo.state.version);
  assert.equal(fresh.state.head, demo.state.head);
  assert.deepEqual(names(fresh.state), names(demo.state));
  assert.ok(names(fresh.state).length > 400);
  assert.equal(fresh.verify().ok, true);
  assert.equal(fresh.state.creds.size, demo.state.creds.size, 'everyone signs in as before');
  // a demo backup never installs a real salon, and a salon is never restored twice
  await rejects(restoreBackup(createEngine(memoryStore(), { syncEveryMs: 0 }), file, KEY, { mode: 'production' }), 'backup_demo');
  await rejects(restoreBackup(fresh, file, KEY), 'initialized');
});

test('a journal edited before sealing is refused at restore', async () => {
  const events = structuredClone(demo.journal.slice(0, 200));
  const sale = events.find((e) => e.type === 'sale.completed') || events[150];
  sale.data = { ...sale.data, tampered: true };
  const file = sealBackup(events, KEY, { at: 1 });
  const e = await rejects(restoreBackup(createEngine(memoryStore(), { syncEveryMs: 0 }), file, KEY), 'backup_broken');
  assert.match(e.message, /opération n° \d+/);
});

test('retention keeps 30 daily and 12 monthly copies of 400 dates', () => {
  const last = '2026-10-26';
  const days = Array.from({ length: 400 }, (_, i) => addDays(last, -i));
  const { keep, drop } = retention(days);
  assert.equal(keep.length + drop.length, 400);
  const daily = days.slice(0, KEEP_DAILY);
  for (const d of daily) assert.ok(keep.includes(d), 'kept: ' + d);
  const firsts = days.filter((d) => d.endsWith('-01')).slice(0, KEEP_MONTHLY);
  assert.equal(firsts.length, 12);
  assert.equal(firsts[11], '2025-11-01');
  for (const d of firsts) assert.ok(keep.includes(d), 'kept: ' + d);
  assert.equal(keep.length, new Set([...daily, ...firsts]).size, 'nothing else');
  assert.equal(keep.length, 41, '2026-10-01 is both a daily and a monthly copy');
  assert.ok(drop.includes('2025-10-01') && drop.includes('2026-09-26'));
  // a month whose 1st was missed keeps its first backup
  const gappy = retention(['2026-10-26', '2026-08-03', '2026-08-02', '2026-07-15']);
  assert.deepEqual(gappy.drop, []);
});

/* ---------------- on a real salon ---------------- */

const DAY = '2026-11-03';

/** A production salon installed through the setup screen, with backups in a (fake) Blob store. */
async function salon({ env = {}, sdk = fakeBlobSdk(), clock = { now: at(DAY, 10) }, setup = true, blob = true } = {}) {
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13', BACKUP_KEY: KEY_B64, ...env }, clock: () => clock.now, store: memoryStore() });
  rt.backups = blob ? blobBackups({ sdk }) : null;
  const owner = browser(rt);
  if (setup) {
    const r = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
    const as = { actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) };
    for (const [first, last, phone] of [['Yanis', 'Martin', '0612345678'], ['Inès', 'Haddad', '0698765432']]) await rt.engine.run(addClient, { first, last, phone }, as);
  }
  return { rt, owner, sdk, clock };
}
const tok = (t = 'pose-13') => ({ 'x-setup-token': t });
/** the backup's journal, then one shop.restored line saying where it came from */
function restoredFrom(rt, head, from) {
  const j = rt.engine.journal;
  assert.equal(j[j.length - 2].h, head, 'the backup’s journal, unchanged');
  const last = j[j.length - 1];
  assert.equal(last.type, 'shop.restored');
  assert.equal(last.data.from, from);
  assert.equal(last.data.head, head);
  assert.equal(rt.engine.verify().ok, true);
}

test('the owner backs up now, sees it listed, downloads it; nobody else can', async () => {
  const { rt, owner, sdk } = await salon();
  const anon = browser(rt);
  assert.equal((await anon.get('/api/v1/backups')).status, 401);
  assert.equal((await anon.post('/api/v1/backups/now')).status, 401);

  const now = await owner.post('/api/v1/backups/now');
  assert.equal(now.status, 200, JSON.stringify(now.json));
  assert.equal(now.json.item.name, DAY + '.json.gz.enc');
  assert.equal(now.json.item.count, rt.engine.journal.length);
  assert.ok(sdk.files.has('backups/' + DAY + '.json.gz.enc'), 'a private file in Blob');

  const list = await owner.get('/api/v1/backups');
  assert.equal(list.status, 200);
  assert.equal(list.json.blob, true);
  assert.equal(list.json.key, true);
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.last.count, rt.engine.journal.length);
  assert.equal(list.json.last.at, at(DAY, 10));

  const dl = await owner.get('/api/v1/backups/latest');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition') || '', /larchitecte-sauvegarde-2026-11-03\.json\.gz\.enc/);
  assert.equal(openBackup(dl.text, KEY).head, now.json.item.head);
});

test('without Blob the download is sealed on the spot; without BACKUP_KEY everything says why', async () => {
  const { rt, owner } = await salon({ blob: false });
  const dl = await owner.get('/api/v1/backups/latest');
  assert.equal(dl.status, 200);
  assert.equal(openBackup(dl.text, KEY).head, rt.engine.state.head);
  const now = await owner.post('/api/v1/backups/now');
  assert.equal(now.status, 409);
  assert.match(now.json.error.message, /BLOB_READ_WRITE_TOKEN/);

  const nokey = await salon({ env: { BACKUP_KEY: '' } });
  const st = await nokey.owner.get('/api/v1/backups');
  assert.equal(st.json.key, false);
  assert.match(st.json.keyProblem, /BACKUP_KEY/);
  const r = await nokey.owner.post('/api/v1/backups/now');
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, 'backup_key');
});

test('a new installation lists the Blob backups and restores one; the owner signs in as before', async () => {
  const src = await salon();
  assert.equal((await src.owner.post('/api/v1/backups/now')).status, 200);
  const head = src.rt.engine.state.head;

  // a new deployment pointed at the same Blob store: empty journal, the setup screen
  const dst = await salon({ sdk: src.sdk, setup: false });
  const b = browser(dst.rt);
  assert.equal((await b.get('/api/auth/state')).json.needsSetup, true);
  const list = await b.get('/api/setup/backups', tok());
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].count, src.rt.engine.journal.length);
  assert.equal(list.json.items[0].at, at(DAY, 10));

  const res = await b.post('/api/setup/restore', { name: list.json.items[0].name }, tok());
  assert.equal(res.status, 200, JSON.stringify(res.json));
  restoredFrom(dst.rt, head, DAY + '.json.gz.enc');
  assert.deepEqual(names(dst.rt.engine.state), names(src.rt.engine.state));
  const login = await b.post('/api/auth/login', { email: 'gerant@salon.test', password: 'Architecte13!' });
  assert.equal(login.status, 200, 'the old password works');
  const log = (await b.get('/api/v1/audit?type=shop.restored')).json.items;
  assert.equal(log[0].label, 'Salon restauré');
  assert.match(log[0].summary, /depuis 2026-11-03\.json\.gz\.enc · \d+ opérations/);
});

test('restore is refused when the salon is not empty, or SETUP_TOKEN is missing or wrong', async () => {
  const src = await salon();
  await src.owner.post('/api/v1/backups/now');
  const file = (await src.owner.get('/api/v1/backups/latest')).text;
  const name = DAY + '.json.gz.enc';

  // version > 0: the salon that made it, whatever the token
  const busy = browser(src.rt);
  for (const [path, body] of [['/api/setup/restore', { name }], ['/api/setup/restore/commit', { n: 1 }]]) {
    const r = await busy.post(path, body, tok());
    assert.equal(r.status, 409, path);
    assert.equal(r.json.error.code, 'initialized');
  }
  assert.equal((await busy.get('/api/setup/backups', tok())).status, 409);
  assert.equal((await busy.raw('POST', '/api/setup/restore/chunk?i=0&n=1', file, { ...tok(), 'content-type': 'text/plain' })).status, 409);

  // empty salon, wrong token or none
  const empty = await salon({ sdk: src.sdk, setup: false });
  const b = browser(empty.rt);
  for (const h of [tok('nope'), {}]) {
    assert.equal((await b.get('/api/setup/backups', h)).status, 403);
    const r = await b.post('/api/setup/restore', { name }, h);
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'bad_token');
    assert.equal((await b.raw('POST', '/api/setup/restore/chunk?i=0&n=1', file, { ...h, 'content-type': 'text/plain' })).status, 403);
  }
  assert.equal(empty.rt.engine.state.version, 0, 'nothing restored');

  // an installation without SETUP_TOKEN cannot restore at all
  const open = await salon({ sdk: src.sdk, setup: false, env: { SETUP_TOKEN: '' } });
  const r = await browser(open.rt).post('/api/setup/restore', { name }, tok(''));
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'no_token');
  assert.equal(open.rt.engine.state.version, 0);

  // the right token but no BACKUP_KEY: an explicit error, before any upload
  const nokey = await salon({ sdk: src.sdk, setup: false, env: { BACKUP_KEY: '' } });
  const nb = browser(nokey.rt);
  const k1 = await nb.post('/api/setup/restore', { name }, tok());
  assert.equal(k1.status, 503);
  assert.match(k1.json.error.message, /BACKUP_KEY/);
  assert.equal((await nb.raw('POST', '/api/setup/restore/chunk?i=0&n=1', file, { ...tok(), 'content-type': 'text/plain' })).json.error.code, 'backup_key');
  assert.equal((await nb.get('/api/setup/backups', tok())).json.key, false, 'the listing says so too');
});

test('an uploaded file restores in parts, staged in Blob or, without it, in memory', async () => {
  const src = await salon();
  const file = (await src.owner.get('/api/v1/backups/latest')).text;
  const size = Math.ceil(file.length / 3);
  const parts = [0, 1, 2].map((i) => file.slice(i * size, (i + 1) * size));
  for (const blob of [true, false]) {
    const dst = await salon({ setup: false, blob });
    const b = browser(dst.rt);
    const send = (i, body = parts[i]) => b.raw('POST', `/api/setup/restore/chunk?i=${i}&n=3`, body, { ...tok(), 'content-type': 'text/plain' });
    for (const i of [0, 1]) assert.equal((await send(i)).status, 200);
    const early = await b.post('/api/setup/restore/commit', { n: 3 }, tok());
    assert.equal(early.status, 409, 'a part is missing');
    assert.equal(early.json.error.code, 'backup_parts');
    for (const i of [0, 1, 2]) assert.equal((await send(i)).status, 200, 'sent again from the start');
    const done = await b.post('/api/setup/restore/commit', { n: 3 }, tok());
    assert.equal(done.status, 200, JSON.stringify(done.json));
    restoredFrom(dst.rt, src.rt.engine.state.head, 'fichier');
    assert.deepEqual(names(dst.rt.engine.state), names(src.rt.engine.state));
    if (blob) assert.equal([...dst.sdk.files.keys()].filter((k) => k.includes('/staging/')).length, 0, 'staging cleaned up');
  }
  // a file encrypted with another key: refused, nothing installed
  const other = await salon({ setup: false, env: { BACKUP_KEY: randomBytes(32).toString('base64') } });
  const ob = browser(other.rt);
  assert.equal((await ob.raw('POST', '/api/setup/restore/chunk?i=0&n=1', file, { ...tok(), 'content-type': 'text/plain' })).status, 200);
  const bad = await ob.post('/api/setup/restore/commit', { n: 1 }, tok());
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error.code, 'backup_key');
  assert.equal(other.rt.engine.state.version, 0);
});

test('the scheduler writes one backup a night, after 03:00 Paris, and prunes old ones', async () => {
  const clock = { now: at(DAY, 2, 30) };
  const { rt, sdk } = await salon({ clock });
  const files = () => [...sdk.files.keys()].filter((k) => /\.json\.gz\.enc$/.test(k)).sort();
  // 45 old nightly files, as if the salon had been running for a while
  const old = Array.from({ length: 45 }, (_, i) => addDays(DAY, -1 - i));
  for (const d of old) sdk.files.set('backups/' + d + '.json.gz.enc', { body: '{}', etag: '"x"', at: new Date(at(d, 3, 1)) });
  sdk.files.set('backups/index.json', { body: JSON.stringify({ items: { [addDays(DAY, -1) + '.json.gz.enc']: { at: at(addDays(DAY, -1), 3, 1), count: 3, head: 'h' } } }), etag: '"i"', at: new Date() });

  assert.equal(await nightlyBackup(rt), null, 'not before 03:00');
  clock.now = at(DAY, 3, 5);
  await maybeTick(rt, {}, { force: true });
  assert.ok(files().includes('backups/' + DAY + '.json.gz.enc'), 'tonight’s file');
  const kept = files();
  assert.ok(kept.length <= KEEP_DAILY + KEEP_MONTHLY);
  assert.equal(kept.length, 32, '30 days, plus the first backups of October and September');
  assert.ok(kept.includes('backups/2026-10-01.json.gz.enc') && kept.includes('backups/2026-09-19.json.gz.enc'));

  clock.now = at(DAY, 9, 0);
  rt.backupState = null; // another instance: it lists Blob and sees tonight’s backup
  assert.equal(await nightlyBackup(rt), null, 'once a night');
  clock.now = at(addDays(DAY, 1), 3, 1);
  const next = await nightlyBackup(rt);
  assert.equal(next && next.day, addDays(DAY, 1));
});

test('a failing Blob store is reported and retried later, the tick goes on', async () => {
  const clock = { now: at(DAY, 4, 0) };
  const sdk = fakeBlobSdk();
  const { rt, owner } = await salon({ sdk, clock });
  const put = sdk.put;
  sdk.put = async () => { throw new Error('Blob indisponible'); };
  const err = console.error;
  console.error = () => {};
  try { assert.equal(await nightlyBackup(rt), null); } finally { console.error = err; }
  const st = await owner.get('/api/v1/backups');
  assert.match(st.json.error, /Blob indisponible/);
  sdk.put = put;
  assert.equal(await nightlyBackup(rt), null, 'not again within 15 minutes');
  clock.now += 16 * 60000;
  assert.ok(await nightlyBackup(rt));
  assert.equal((await owner.get('/api/v1/backups')).json.error, '');
});

test('the activity log shows a client’s own cancellation reason, kept in pii', async () => {
  const { rt, owner } = await salon();
  const e = rt.engine;
  const a = [...e.state.staff.values()].find((x) => x.role === 'owner');
  // an event as the site writes it since GL-05: the reason next to the event, not in the chained data
  const cid = [...e.state.clients.keys()][0];
  await e.run({ run: (_s, _i, ctx) => ctx.emit('appt.cancelled', { id: 'ap_x', by: 'client', cid }, { reason: 'Malade' }) }, {}, { actor: { t: 'client', id: 'web' } });
  await e.run({ run: (_s, _i, ctx) => ctx.emit('appt.cancelled', { id: 'ap_y', by: 'salon', reason: 'Fermeture', cid }) }, {}, { actor: { t: 'staff', id: a.id } });
  const log = (await owner.get('/api/v1/audit?type=appt.cancelled')).json.items;
  assert.equal(log[0].summary, 'par le salon · Fermeture');
  assert.equal(log[1].summary, 'par le client · Malade');
});

/* ---------------- round 1: what the reviews found ---------------- */

test('a client erased on another instance is in neither the backup nor a restore of it', async () => {
  const store = memoryStore();
  const A = createEngine(store, { syncEveryMs: 0 });
  const B = createEngine(store, { syncEveryMs: 0 });
  // copies: the engines' memories must not share objects with the demo's
  const stale = structuredClone(demo.journal.slice(0, 400));
  await A.adopt(structuredClone(stale));
  await B.sync(true);
  const c = [...B.state.clients.values()].find((x) => x.phone);
  assert.ok(c);
  const phone = '"' + c.phone + '"';
  assert.ok(JSON.stringify(B.journal).includes(phone), 'B holds the phone in memory');
  await A.run(eraseClient, { id: c.id }, { actor: { t: 'staff', id: 'st_owner' }, caps: new Set(['client.erase']) });
  await B.sync(true);
  for (const j of [A.journal, B.journal, (await store.read(0)).events]) assert.ok(!JSON.stringify(j).includes(phone));
  // even a journal that missed the erasure in memory (as B's did before) is cleaned when sealed, and when restored
  const erased = (await store.read(0)).events.slice(400);
  assert.ok(JSON.stringify(stale).includes(phone));
  const sealed = sealBackup([...stale, ...erased], KEY, { at: 1 });
  const back = openBackup(sealed, KEY);
  assert.ok(!JSON.stringify(back.events).includes(phone), 'not in the backup');
  assert.equal(back.salon, salonOf(A.journal));
  const fresh = createEngine(memoryStore(), { syncEveryMs: 0 });
  await restoreBackup(fresh, sealed, KEY);
  assert.ok(!JSON.stringify((await fresh.store.read(0)).events).includes(phone), 'not in the restored store');
  assert.equal(fresh.verify().ok, true, 'the chain still verifies: only the pii hash is chained');
  assert.equal(fresh.state.head, A.state.head);
});

test('a demo sharing the Blob store never writes, reads or hands out the real salon’s backups', async () => {
  const sdk = fakeBlobSdk();
  const clock = { now: at(DAY, 3, 1) };
  const demoRt = await createRuntime({ env: { BACKUP_KEY: KEY_B64 }, clock: () => clock.now, store: memoryStore() });
  demoRt.backups = blobBackups({ sdk });
  assert.equal(await nightlyBackup(demoRt), null);
  await rejects(makeBackup(demoRt), 'backup_off');
  assert.equal(sdk.files.size, 0, 'nothing written');
  const prod = await salon({ sdk, clock });
  const mine = await nightlyBackup(prod.rt);
  assert.ok(mine && mine.salon === salonOf(prod.rt.engine.journal));
  // the demo's card and download know nothing of it
  const ds = await backupStatus(demoRt);
  assert.equal(ds.items.length, 0);
  assert.match(ds.off, /démo/);
  const df = await freshBackup(demoRt);
  assert.notEqual(df.head, mine.head);
  // a file from another salon in the same store (index stamped): ignored by this one
  const other = { at: at(DAY, 3, 30), count: 9, head: 'x'.repeat(64), salon: 'y'.repeat(64) };
  await prod.rt.backups.putBackup(addDays(DAY, 1) + '.json.gz.enc', '{}', other);
  const st = await backupStatus(prod.rt);
  assert.equal(st.last.name, DAY + '.json.gz.enc');
  assert.deepEqual(st.items.map((x) => x.name), [DAY + '.json.gz.enc']);
  // a Vercel preview, even in production mode, writes nothing either
  prod.rt.cfg.vercelEnv = 'preview';
  await rejects(makeBackup(prod.rt), 'backup_off');
  prod.rt.cfg.vercelEnv = 'production';
  assert.ok(await makeBackup(prod.rt));
});

test('an error seen by one instance clears once another one has backed up since', async () => {
  const sdk = fakeBlobSdk();
  const clock = { now: at(DAY, 3, 5) };
  const A = await salon({ sdk, clock });
  const put = sdk.put;
  sdk.put = async () => { throw new Error('Blob indisponible'); };
  const err = console.error;
  console.error = () => {};
  try { assert.equal(await nightlyBackup(A.rt), null); } finally { console.error = err; }
  assert.match((await backupStatus(A.rt)).error, /Blob indisponible/);
  sdk.put = put;
  clock.now += 5 * 60000;
  // instance B (same store, same salon) makes tonight's backup
  const B = { ...A.rt, backupState: null };
  assert.ok(await makeBackup(B));
  assert.equal((await backupStatus(A.rt)).error, '', 'A sees the fresher backup and drops its old error');
  clock.now += 20 * 60000;
  assert.equal(await nightlyBackup(A.rt), null, 'and does not make another');
  assert.equal(A.rt.backupState.error, '');
});

test('Blob down: the card says so, « Sauvegarder maintenant » explains, the download still works', async () => {
  const { rt, owner, sdk, clock } = await salon();
  assert.equal((await owner.post('/api/v1/backups/now')).status, 200);
  const list = sdk.list, put = sdk.put, get = sdk.get;
  sdk.list = async () => { throw new Error('Blob en panne'); };
  sdk.put = async () => { throw new Error('Blob en panne'); };
  const err = console.error;
  console.error = () => {};
  try {
    const st = (await owner.get('/api/v1/backups')).json;
    assert.equal(st.unreadable, true);
    assert.equal(st.last && st.last.name, DAY + '.json.gz.enc', 'what this instance knows');
    const now = await owner.post('/api/v1/backups/now');
    assert.equal(now.status, 503);
    assert.equal(now.json.error.code, 'backup_blob');
    assert.match(now.json.error.message, /Stockage Blob indisponible : Blob en panne/);
    const dl = await owner.get('/api/v1/backups/latest');
    assert.equal(dl.status, 200, 'sealed on the spot');
    assert.equal(openBackup(dl.text, KEY).head, rt.engine.state.head);
  } finally { console.error = err; sdk.list = list; sdk.put = put; }
  // a stored file older than 36 h is not handed out: the salon as it is now
  clock.now += 40 * 3600000;
  await rt.engine.run(addClient, { first: 'Nour', last: 'Benali', phone: '0611223344' }, { actor: { t: 'staff', id: [...rt.engine.state.staff.keys()][0] }, caps: new Set(['client.edit']) });
  sdk.get = async (...a) => { throw new Error('should not read the stale file: ' + a[0]); };
  try {
    const dl = await owner.get('/api/v1/backups/latest');
    assert.equal(dl.status, 200);
    assert.equal(openBackup(dl.text, KEY).head, rt.engine.state.head);
  } finally { sdk.get = get; }
});

test('a failed index read never rewrites the index without the other backups', async () => {
  const sdk = fakeBlobSdk();
  const b = blobBackups({ sdk });
  await b.putBackup('2026-11-01.json.gz.enc', '{}', { at: 1, count: 5, head: 'h1', salon: 's' });
  const get = sdk.get;
  sdk.get = async (path, o) => { if (path.endsWith('index.json')) throw new Error('timeout'); return get(path, o); };
  await assert.rejects(b.putBackup('2026-11-02.json.gz.enc', '{}', { at: 2, count: 6, head: 'h2', salon: 's' }), /timeout/);
  sdk.get = get;
  const items = await b.listBackups();
  assert.equal(items.find((x) => x.day === '2026-11-01').count, 5, 'still indexed');
});

test('a one-part file restores in one request; on Vercel without Blob, parts are refused up front', async () => {
  const src = await salon();
  const file = (await src.owner.get('/api/v1/backups/latest')).text;
  const dst = await salon({ setup: false, blob: false });
  dst.rt.cfg.isVercel = true;
  const b = browser(dst.rt);
  const parts = await b.raw('POST', '/api/setup/restore/chunk?i=0&n=2', file.slice(0, 10), { ...tok(), 'content-type': 'text/plain' });
  assert.equal(parts.status, 409);
  assert.match(parts.json.error.message, /stockage Blob/);
  const one = await b.raw('POST', '/api/setup/restore/file', file, { ...tok(), 'content-type': 'text/plain' });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  restoredFrom(dst.rt, src.rt.engine.state.head, 'fichier');
  assert.deepEqual(names(dst.rt.engine.state), names(src.rt.engine.state));
  const again = await b.raw('POST', '/api/setup/restore/file', file, { ...tok(), 'content-type': 'text/plain' });
  assert.equal(again.status, 409, 'never twice');
});
