// One instance, several requests at once: writes go one after the other, a committed write is always answered as one,
// and nothing sealed on a projection the store does not hold can enter the journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, DAY } from '../helpers.js';
import { createEngine } from '../../server/core/engine.js';
import { memoryStore } from '../../server/store/memory.js';
import { verifyChain } from '../../server/core/journal.js';
import * as A from '../../server/commands/agenda.js';
import { claimMessage } from '../../server/commands/messages.js';
import { addDays } from '../../shared/dates.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYSTEM = { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() };
const WEB = { actor: { t: 'client', id: 'web' }, caps: new Set() };

test('20 holds at the same moment on one instance: 20 answers, 20 appends, a valid chain', async () => {
  const inner = memoryStore();
  let appends = 0, refused = 0;
  // a store over a network: the append travels, then its acknowledgement does
  const store = { ...inner, async append(list, ep) { appends++; await sleep(2); const r = await inner.append(list, ep); await sleep(2); if (!r.ok) refused++; return r; } };
  const t = await salon({ store });
  appends = 0; refused = 0;
  const v0 = t.engine.state.version;
  const day = addDays(DAY, 1); // a Wednesday: both chairs open 9 h to 18 h 30
  const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
    t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: i % 2 ? t.ids.Ali : t.ids.Ben, day, start: 540 + 30 * (i >> 1) }, WEB)));
  const failed = res.filter((x) => x.status === 'rejected').map((x) => x.reason.code || x.reason.message);
  assert.deepEqual(failed, []);
  const stored = (await inner.read(v0)).events.filter((e) => e.type === 'appt.held');
  assert.equal(stored.length, 20);
  assert.equal(appends, 20, 'one append per write');
  assert.equal(refused, 0);
  assert.equal(verifyChain((await inner.read(0)).events).ok, true);
  assert.equal(t.engine.verify().ok, true);
  assert.equal(t.engine.state.version, (await inner.read(0)).events.length);
});

test('two instances still race on the store: the same slot is held once, each instance queues its own writes', async () => {
  const store = memoryStore();
  const t = await salon({ store });
  const B = createEngine(store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await B.sync(true);
  const day = addDays(DAY, 1);
  const hold = (e, start) => e.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start }, WEB);
  const res = await Promise.allSettled([hold(t.engine, 600), hold(B, 600), hold(t.engine, 660), hold(B, 720), hold(t.engine, 780), hold(B, 780)]);
  assert.deepEqual(res.map((x) => x.status === 'fulfilled').filter(Boolean).length, 4);
  for (const x of res) if (x.status === 'rejected') assert.equal(x.reason.code, 'taken');
  const all = (await store.read(0)).events;
  assert.equal(verifyChain(all).ok, true);
  assert.equal(all.filter((e) => e.type === 'appt.held').length, 4);
});

test('a read that catches up between a commit and its acknowledgement: the write is answered, and its retry writes nothing', async () => {
  const inner = memoryStore();
  // the store commits at once and acknowledges 20 ms later, as a database over a network does
  const store = { ...inner, async append(list, ep) { const r = await inner.append(list, ep); await sleep(20); return r; } };
  const t = await salon({ store });
  const before = t.engine.state.version;
  const input = { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660 };
  const write = t.engine.run(A.createAppointment, input, { ...t.asOwner(), requestId: 'req-12345678' });
  await sleep(5);
  await t.engine.sync(true); // any other request on the instance (the Comptoir's pulse, a GET) catching up
  assert.ok(t.engine.state.version > before, 'the read applied the committed events first');
  const first = await write;
  assert.ok(first.id);
  const mine = (await inner.read(before)).events;
  assert.equal(mine.filter((e) => e.type === 'appt.booked').length, 1);
  assert.equal(t.engine.state.version, before + mine.length);
  assert.equal(t.engine.verify().ok, true);
  // the till's retry (same x-request-id) gets the same answer and no second booking
  const again = await t.engine.run(A.createAppointment, input, { ...t.asOwner(), requestId: 'req-12345678' });
  assert.equal(again.id, first.id);
  assert.equal((await inner.read(before)).events.length, mine.length);
  // without a request id too, the answer is the booking, not an error
  const input2 = { ...input, start: 720 };
  const w2 = t.engine.run(A.createAppointment, input2, t.asOwner());
  await sleep(5);
  await t.engine.sync(true);
  assert.ok((await w2).id);
  assert.equal(verifyChain((await inner.read(0)).events).ok, true);
});

test('a read that carries a write this instance applied meanwhile: nothing is read again from the start', async () => {
  const inner = memoryStore();
  let full = 0, lag = 0;
  // the read sees the store at once and its answer travels; the append commits at once and its acknowledgement travels less
  const store = {
    ...inner,
    async read(after) { if (after === 0) full++; const r = await inner.read(after); if (lag) await sleep(lag); return r; },
    async append(list, ep) { const r = await inner.append(list, ep); if (lag) await sleep(lag / 2); return r; }
  };
  const t = await salon({ store });
  const v0 = t.engine.state.version;
  full = 0; lag = 20;
  const write = t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, WEB);
  await sleep(25);                       // the write's own read is back, its event is committed, not yet acknowledged
  const reading = t.engine.sync(true);   // this read holds the event; the acknowledgement arrives first
  await write;
  assert.equal(t.engine.state.version, v0 + 1);
  await reading;
  assert.equal(full, 0, 'no full re-read of the journal');
  assert.equal(t.engine.state.version, v0 + 1);
  assert.equal(t.engine.verify().ok, true);
});

test('a batch that loses the race and a write queued behind it on the same instance: the chain holds', async () => {
  const inner = memoryStore();
  const t = await salon({ store: inner });           // instance A
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  const msg = [...t.engine.state.messages.values()].find((m) => m.status === 'queued');
  assert.ok(msg);
  // instance B: its append of the message claim travels 30 ms (a network), everything else is immediate
  let slow = true;
  const storeB = { ...inner, async append(list, ep) { if (slow && list[0].type === 'message.updated') { slow = false; await sleep(30); } return inner.append(list, ep); } };
  const B = createEngine(storeB, { clock: () => t.clock.now, syncEveryMs: 1500 });
  await B.sync(true);
  // both instances claim the same text at the same moment (the scheduler's dispatch on two instances)
  const claimB = B.batch((step) => { step(claimMessage, { id: msg.id }, SYSTEM); });
  await sleep(5);
  await t.engine.batch((step) => { step(claimMessage, { id: msg.id }, SYSTEM); });   // A wins: 1 event at N+1
  // meanwhile a client holds a slot through instance B, whose projection holds its own, unstored, claim
  const hold = await B.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: 'any', day: addDays(DAY, 2), start: 600 }, WEB).then(() => 'ok', (e) => 'error: ' + e.message);
  assert.equal(await claimB, -1);
  assert.equal(hold, 'ok');
  const stored = (await inner.read(0)).events;
  assert.deepEqual(verifyChain(stored).ok, true, JSON.stringify(verifyChain(stored)));
  assert.equal(stored.filter((e) => e.type === 'appt.held').length, 1);
  const C = createEngine(inner, { clock: () => t.clock.now });
  await C.sync(true);
  assert.equal(C.verify().ok, true);
  await B.sync(true);
  assert.equal(B.state.head, C.state.head);
});
