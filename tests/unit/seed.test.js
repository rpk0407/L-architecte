import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoJournal } from '../../server/domain/seed.js';
import { verifyChain } from '../../server/core/journal.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { dayTotals } from '../../server/domain/cash.js';
import { at } from '../helpers.js';

test('the demo salon is built by the real rules and its books verify', async () => {
  const now = at('2026-11-06', 15, 10); // a Friday afternoon
  const journal = await buildDemoJournal(now, { weeks: 2, ahead: 5 });
  assert.equal(verifyChain(journal).ok, true);
  const s = emptyState();
  for (const e of journal) evolve(s, e);
  assert.equal(s.mode, 'demo');
  assert.equal(s.staff.size, 5);
  assert.ok(s.sales.size > 150, 'two weeks of tickets');
  for (const [day, z] of s.closures) {
    const t = dayTotals(s, day);
    assert.equal(z.net, t.net, 'each Z matches the tickets of its day');
  }
  const today = [...(s.apptsByDay.get('2026-11-06') || [])].map((id) => s.appts.get(id));
  assert.ok(today.some((a) => a.status === 'done') && today.some((a) => a.status === 'booked'), 'today is half done');
  assert.ok(s.drawer, 'today’s drawer is open');
  const neg = [...s.products.values()].filter((p) => p.stock < 0);
  assert.equal(neg.length, 0, 'stock never negative');
});
