// A ticket in progress survives leaving the till and the tablet's lock (audit 02 · A2): per device, per person, per
// ticket, for the day, without ever writing a gift card's code down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDraft, draftKey, draftsOf, keptPays, loadDraft, saveDraft } from '../../web/src/comptoir/pages/caisse/draft.ts';

function fakeStore() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const DAY = '2026-10-27';
const draft = (over = {}) => ({ day: DAY, at: 1, rid: 'rid-1', lines: [{ kind: 'service', ref: 'sv_cl', unit: 3000 }], disc: null, tip: { amount: 200, staffId: 'st_jk' }, pays: [{ method: 'card', amount: 3200, label: 'Carte · terminal' }], clientId: null, ...over });

test('one draft per person and per ticket', () => {
  assert.notEqual(draftKey('st_ines', 'ap_1'), draftKey('st_jkut', 'ap_1'));
  assert.notEqual(draftKey('st_ines', 'ap_1'), draftKey('st_ines', 'ap_2'));
  assert.equal(draftKey('st_ines', null), draftKey('st_ines', ''), 'a sale without appointment has one slot');
});

test('saved, read back after the lock with its lines, tip, payments and request key', () => {
  const s = fakeStore(), k = draftKey('st_ines', 'ap_1');
  assert.equal(saveDraft(s, k, draft()), true);
  const d = loadDraft(s, k, DAY);
  assert.equal(d.rid, 'rid-1', 'the same idempotency key: a retried validation is the same sale');
  assert.deepEqual(d.lines, [{ kind: 'service', ref: 'sv_cl', unit: 3000 }]);
  assert.deepEqual(d.tip, { amount: 200, staffId: 'st_jk' });
  assert.deepEqual(d.pays, [{ method: 'card', amount: 3200, label: 'Carte · terminal' }]);
  assert.equal(loadDraft(s, draftKey('st_jkut', 'ap_1'), DAY), null, 'a colleague on the same tablet does not get it');
});

test('a gift card code is never written down; the deposit comes back from the server, not from the draft', () => {
  const s = fakeStore(), k = draftKey('st_ines', 'ap_1');
  const pays = [{ method: 'deposit', amount: 1500, ref: 'pay_1' }, { method: 'giftcard', amount: 1000, ref: 'CADEAU-SECRET-1234' }, { method: 'cash', amount: 500, given: 1000 }, { method: 'online', amount: 200, ref: 'pay_qr' }];
  assert.deepEqual(keptPays(pays), { pays: [pays[2], pays[3]], giftDropped: true });
  saveDraft(s, k, draft({ pays }));
  assert.ok(![...s.m.values()].some((v) => v.includes('CADEAU-SECRET-1234')), 'no code in the store');
  const d = loadDraft(s, k, DAY);
  assert.deepEqual(d.pays.map((p) => p.method), ['cash', 'online']);
  assert.equal(d.giftDropped, true, 'the till says the card must be passed again');
});

test('yesterday’s draft, or one that cannot be read, is thrown away', () => {
  const s = fakeStore(), k = draftKey('st_ines', 'free');
  saveDraft(s, k, draft());
  assert.equal(loadDraft(s, k, '2026-10-28'), null);
  assert.equal(s.m.size, 0, 'and removed');
  s.setItem(k, '{not json');
  assert.equal(loadDraft(s, k, DAY), null);
  assert.equal(s.m.size, 0);
  s.setItem(k, JSON.stringify({ v: 1, day: DAY, lines: 'x', pays: [], rid: 'r' }));
  assert.equal(loadDraft(s, k, DAY), null);
});

test('cleared on validation or explicit discard; the list of tickets in progress follows', () => {
  const s = fakeStore();
  s.setItem('lx-theme', '"dark"');
  saveDraft(s, draftKey('st_ines', 'ap_1'), draft());
  saveDraft(s, draftKey('st_ines', null), draft());
  saveDraft(s, draftKey('st_jkut', 'ap_9'), draft());
  saveDraft(s, draftKey('st_ines', 'ap_old'), draft({ day: '2026-10-26' }));
  assert.deepEqual([...draftsOf(s, 'st_ines', DAY)].sort(), ['ap_1', 'free']);
  clearDraft(s, draftKey('st_ines', 'ap_1'));
  assert.deepEqual([...draftsOf(s, 'st_ines', DAY)], ['free']);
  assert.equal(s.getItem('lx-theme'), '"dark"', 'nothing else in the store is touched');
});

test('no store (private mode): nothing breaks, nothing is kept', () => {
  assert.equal(saveDraft(null, 'k', draft()), false);
  assert.equal(loadDraft(null, 'k', DAY), null);
  assert.deepEqual([...draftsOf(null, 'st', DAY)], []);
  const full = { ...fakeStore(), setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.equal(saveDraft(full, 'k', draft()), false);
});
