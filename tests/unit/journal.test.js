import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, verifyChain, GENESIS } from '../../server/core/journal.js';

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
