// TEAM-04: what the demo promises of Mon espace. Whoever sits down in the next three days has a note on his last cut,
// written by the barber who did it, so « La dernière fois » shows a real note at once; the notes stay few.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoJournal } from '../../server/domain/seed.js';
import { memoryStore } from '../../server/store/memory.js';
import { createEngine } from '../../server/core/engine.js';
import { addDays } from '../../shared/dates.js';
import { at } from '../helpers.js';

test('the demo gives a note on the last cut of every client booked in the next three days', async () => {
  const now = at('2026-11-03', 15, 16);
  const j = await buildDemoJournal(now);
  const e = createEngine(memoryStore(), { clock: () => now, syncEveryMs: 0 });
  await e.adopt(j);
  const s = e.state;
  const notes = j.filter((x) => x.type === 'cut.noted');
  assert.ok(notes.length > 40 && notes.length < 300, notes.length + ' notes');
  for (const n of notes) assert.equal(n.data.by, n.data.staffId, 'written by the barber who did the cut');
  let seen = 0;
  for (let i = 0; i <= 2; i++) {
    for (const id of s.apptsByDay.get(addDays('2026-11-03', i)) || []) {
      const a = s.appts.get(id);
      if (!a.clientId || a.status === 'cancelled' || a.status === 'done') continue;
      let last = null;
      for (const b of s.appts.values()) if (b.clientId === a.clientId && b.status === 'done' && (!last || b.day > last.day)) last = b;
      if (!last) continue;
      seen++;
      assert.ok(s.cutNoteOf.has(last.id), s.clients.get(a.clientId).first + ': no note on the cut of ' + last.day);
    }
  }
  assert.ok(seen > 50, 'booked clients with a previous cut: ' + seen);
});
