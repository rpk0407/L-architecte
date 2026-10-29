import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, verifyChain, piiHash, piiOf, publicEvent, GENESIS } from '../../server/core/journal.js';
import { canonical, sha256 } from '../../server/lib/util.js';

const actor = { t: 'staff', id: 'st_1' };
function chain(n) {
  const drafts = Array.from({ length: n }, (_, i) => ({ type: 'sale.completed', data: { number: i + 1, total: 2000 + i }, pii: i % 2 ? { first: 'Yanis' } : undefined }));
  let i = 0;
  return seal(drafts, { version: 0, hash: GENESIS }, { at: 1, actor, id: () => 'ev' + i++ });
}

test('a sealed journal verifies', () => {
  const ev = chain(5);
  const r = verifyChain(ev);
  assert.equal(r.ok, true);
  assert.equal(r.count, 5);
  assert.equal(r.head, ev[4].h);
});

test('editing an amount breaks the chain at that entry', () => {
  const ev = chain(5);
  ev[2].data.total = 1;
  const r = verifyChain(ev);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 3);
});

test('deleting an entry is detected', () => {
  const ev = chain(5);
  ev.splice(1, 1);
  assert.equal(verifyChain(ev).ok, false);
});

test('changing personal data is detected, erasing it is not a break', () => {
  const ev = chain(4);
  ev[1].pii.first = 'Karim';
  assert.equal(verifyChain(ev).ok, false);
  const ev2 = chain(4);
  delete ev2[1].pii;
  assert.equal(verifyChain(ev2).ok, true, 'GDPR erasure keeps the books provable');
});

test('appending continues from the head', () => {
  const ev = chain(3);
  const more = seal([{ type: 'x', data: {} }], { version: 3, hash: ev[2].h }, { at: 2, actor, id: () => 'ev9' });
  assert.equal(verifyChain(ev.concat(more)).ok, true);
});

/* ---- the pii hash is salted (W18): an erased or exported event's `ph` cannot be tried against guesses ---- */

test('the same personal data sealed twice gives two different hashes, and the nonce is inside the pii', () => {
  const draft = () => ({ type: 'client.updated', data: { id: 'cl_1', cid: 'cl_1' }, pii: { phone: '+33612345678' } });
  const [a] = seal([draft()], { version: 0, hash: GENESIS }, { at: 1, actor, id: () => 'ev1' });
  const [b] = seal([draft()], { version: 0, hash: GENESIS }, { at: 1, actor, id: () => 'ev1' });
  assert.notEqual(a.ph, b.ph);
  assert.match(a.pii._n, /^[0-9a-f]{16}$/);
  assert.equal(a.ph, piiHash(a.pii), 'the hash covers the nonce');
  assert.deepEqual(piiOf(a.pii), { phone: '+33612345678' }, 'the reducers read the data without it');
  assert.equal(piiOf(undefined) && Object.keys(piiOf(undefined)).length, 0);
  assert.equal(verifyChain([a]).ok, true);
  // a draft's own object is not touched
  const d = draft(); seal([d], { version: 0, hash: GENESIS }, { at: 1, actor, id: () => 'e' });
  assert.deepEqual(d.pii, { phone: '+33612345678' });
});

test('after an erasure the kept hash cannot be brute-forced: the guess of a phone number no longer matches', () => {
  const phone = '+33612345678';
  const ev = seal([{ type: 'client.updated', data: { id: 'cl_1', cid: 'cl_1' }, pii: { phone } }, { type: 'x', data: {} }], { version: 0, hash: GENESIS }, { at: 1, actor, id: (i) => 'ev' + i });
  const kept = ev[0].ph;
  delete ev[0].pii;
  assert.equal(verifyChain(ev).ok, true, 'the books stay provable once the personal data is gone');
  assert.notEqual(sha256(canonical({ phone })), kept, 'the unsalted guess matches nothing');
  assert.equal(ev[0].ph, kept);
  // the downloadable journal carries no pii and no nonce
  assert.ok(!JSON.stringify(ev.map(publicEvent)).includes('_n'));
});

test('an event sealed before the nonce existed still verifies, and its pii is read as is', () => {
  const pii = { phone: '+33612345678' };
  const e = { v: 1, id: 'ev0', at: 1, type: 'client.updated', actor, data: { id: 'cl_1' }, pii, ph: sha256(canonical(pii)), p: GENESIS, h: '' };
  e.h = sha256(GENESIS + '\n' + canonical({ v: e.v, id: e.id, at: e.at, type: e.type, actor: e.actor, data: e.data, ph: e.ph }));
  assert.equal(verifyChain([e]).ok, true);
  assert.deepEqual(piiOf(e.pii), pii);
  const more = seal([{ type: 'y', data: {}, pii: { first: 'Yanis' } }], { version: 1, hash: e.h }, { at: 2, actor, id: () => 'ev1' });
  assert.equal(verifyChain([e, ...more]).ok, true, 'salted events follow unsalted ones');
  more[0].pii.first = 'Karim';
  assert.equal(verifyChain([e, ...more]).ok, false);
  // changing or dropping the nonce alone is a change of the data
  const [x] = seal([{ type: 'y', data: {}, pii: { first: 'Yanis' } }], { version: 0, hash: GENESIS }, { at: 2, actor, id: () => 'ev1' });
  x.pii._n = '0'.repeat(16);
  assert.equal(verifyChain([x]).ok, false);
});

test('a test can fix the nonce, and a fixed one gives the same events twice', () => {
  const run = () => seal([{ type: 'a', data: {}, pii: { first: 'Yanis' } }], { version: 0, hash: GENESIS }, { at: 1, actor, id: () => 'ev1', nonce: () => 'abcdef0123456789' });
  assert.deepEqual(run(), run());
});
