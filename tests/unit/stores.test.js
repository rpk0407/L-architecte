// The storage contract, checked on every store. Postgres runs when TEST_DATABASE_URL is set (npm run test:pg).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryStore } from '../../server/store/memory.js';
import { fileStore } from '../../server/store/file.js';
import { blobStore, fakeBlobSdk } from '../../server/store/blob.js';
import { seal, verifyChain, GENESIS } from '../../server/core/journal.js';
import { createEngine } from '../../server/core/engine.js';
import { salon } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import { setPhoto, archiveStaff } from '../../server/commands/team.js';

const actor = { t: 'staff', id: 'st_1' };
function events(from, n, prev = GENESIS) {
  let i = 0;
  return seal(Array.from({ length: n }, (_, k) => ({ type: 'x.y', data: { k: from + k, cid: k % 3 === 0 ? 'cl_a' : 'cl_b' }, pii: { name: 'Karim ' + k } })), { version: from - 1, hash: prev }, { at: 1, actor, id: () => 'ev' + from + '_' + i++ });
}

/** factories return two handles on the same backend, as two servers would have */
const backends = {
  memory: () => { const s = memoryStore(); return [s, s]; },
  file: () => { const p = join(mkdtempSync(join(tmpdir(), 'lx-')), 'j.jsonl'); return [fileStore(p), null]; },
  blob: () => { const sdk = fakeBlobSdk(); return [blobStore({ sdk, prefix: 't' }), blobStore({ sdk, prefix: 't' })]; }
};
if (process.env.TEST_DATABASE_URL) {
  const { postgresStore } = await import('../../server/store/postgres.js');
  const pg = (await import('pg')).default;
  let n = 0;
  backends.postgres = () => {
    // a fresh schema per test, so tests stay independent
    const schema = 'lx_t' + process.pid + '_' + n++;
    const opts = { connectionString: process.env.TEST_DATABASE_URL, options: '-c search_path=' + schema };
    const setup = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const ready = setup.query('create schema if not exists ' + schema).finally(() => setup.end());
    const mk = () => { const s = postgresStore({ pool: new pg.Pool({ ...opts, max: 3 }) }); const read = s.read; s.read = async (a) => { await ready; return read(a); }; const ap = s.append; s.append = async (l, e) => { await ready; return ap(l, e); }; return s; };
    return [mk(), mk()];
  };
}

for (const [name, make] of Object.entries(backends)) {
  describe('store: ' + name, () => {
    test('appends in order and reads from any version', async () => {
      const [s] = make();
      const r0 = await s.read(0);
      assert.equal(r0.events.length, 0);
      const ev = events(1, 3);
      assert.equal((await s.append(ev, r0.epoch)).ok, true);
      assert.equal((await s.read(0)).events.length, 3);
      assert.deepEqual((await s.read(2)).events.map((e) => e.v), [3]);
      assert.equal(verifyChain((await s.read(0)).events).ok, true);
    });

    test('refuses an append that does not follow, or comes from an old epoch', async () => {
      const [s] = make();
      const { epoch } = await s.read(0);
      await s.append(events(1, 2), epoch);
      assert.equal((await s.append(events(5, 1), epoch)).ok, false);
      assert.equal((await s.append(events(3, 1), 'other-epoch')).ok, false);
    });

    test('two servers appending the same version: one wins', async (t) => {
      const [a, b] = make();
      if (!b) return t.skip('single-process store');
      const { epoch } = await a.read(0);
      await b.read(0);
      const res = await Promise.all([a.append(events(1, 1), epoch), b.append(events(1, 2), epoch)]);
      assert.equal(res.filter((x) => x.ok).length, 1);
      const after = await b.read(0);
      assert.ok(after.events.length === 1 || after.events.length === 2);
    });

    test('large histories are stored and read back intact', async () => {
      const [s, other] = make();
      const { epoch } = await s.read(0);
      const big = events(1, 2350);
      assert.equal((await s.append(big, epoch)).ok, true);
      const more = events(2351, 40, big[big.length - 1].h);
      assert.equal((await s.append(more, epoch)).ok, true);
      const back = (await (other || s).read(0)).events;
      assert.equal(back.length, 2390);
      assert.equal(verifyChain(back).ok, true);
    });

    test('erasure removes personal data for good, the chain still verifies', async () => {
      const [s, other] = make();
      const { epoch } = await s.read(0);
      await s.append(events(1, 9), epoch);
      const n = await s.redact((e) => e.data.cid === 'cl_a');
      assert.equal(n, 3);
      const back = (await (other || s).read(0)).events;
      assert.equal(back.filter((e) => e.pii).length, 6);
      assert.equal(verifyChain(back).ok, true);
    });

    test('a staff photo replaced, removed or archived leaves no earlier copy in the store (TEAM-02)', async () => {
      const [a, b] = make();
      const fx = await salon({ store: a });
      const pic = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 3)]).toString('base64');
      const kept = async () => (await (b || a).read(0)).events.filter((e) => e.type === 'staff.photo' && e.pii);
      await fx.engine.run(setPhoto, { staffId: fx.ids.Ali, data: pic(900) }, fx.asStaff('Ali'));
      await fx.engine.run(setPhoto, { staffId: fx.ids.Ali, data: pic(1200) }, fx.asStaff('Ali'));
      await fx.engine.run(setPhoto, { staffId: fx.ids.Ben, data: pic(800) }, fx.asStaff('Ben'));
      assert.deepEqual((await kept()).map((e) => [e.data.id, e.pii.photo]), [[fx.ids.Ali, pic(1200)], [fx.ids.Ben, pic(800)]]);
      // another server reads the newest photo only
      const other = createEngine(b || a, { clock: () => fx.clock.now, syncEveryMs: 0 });
      await other.sync(true);
      assert.equal(other.state.staffPhotos.get(fx.ids.Ali).data, pic(1200));
      await fx.engine.run(setPhoto, { staffId: fx.ids.Ali, data: '' }, fx.asStaff('Ali'));
      await fx.engine.run(archiveStaff, { id: fx.ids.Ben }, fx.asOwner());
      assert.equal((await kept()).length, 0);
      const back = (await (b || a).read(0)).events;
      assert.equal(verifyChain(back).ok, true);
    });

    test('reset starts a new epoch; secrets are created once', async () => {
      const [s, other] = make();
      const { epoch } = await s.read(0);
      await s.append(events(1, 2), epoch);
      const next = await s.reset();
      assert.notEqual(next, epoch);
      assert.equal((await s.read(0)).events.length, 0);
      assert.equal((await s.append(events(1, 1), epoch)).ok, false);
      const k1 = await s.secret('session', () => 'first');
      const k2 = await (other || s).secret('session', () => 'second');
      assert.equal(k1, 'first');
      assert.equal(k2, 'first');
    });

    test('an engine on each server: still no double booking', async (t) => {
      const [a, b] = make();
      if (!b) return t.skip('single-process store');
      const fx = await salon({ store: a, hour: 9 });
      const other = createEngine(b, { clock: () => fx.clock.now, syncEveryMs: 0 });
      await other.sync(true);
      const input = (first, phone) => ({ serviceIds: [fx.ids.cut], staffId: fx.ids.Ali, day: '2026-11-03', start: 900, first, phone });
      const res = await Promise.allSettled([fx.engine.run(A.bookOnline, input('Adam', '0600000001'), fx.asClient), other.run(A.bookOnline, input('Enzo', '0600000002'), fx.asClient)]);
      assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
      await other.sync(true);
      assert.equal(other.verify().ok, true);
    });
  });
}
