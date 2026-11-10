// Two appointments forced on the same chair at the same time are drawn side by side (audit 02 · A1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOverlaps, overlapping } from '../../web/src/comptoir/pages/agenda/overlap.ts';

const ap = (id, start, dur) => ({ id, start, dur });

test('an appointment alone keeps the whole column', () => {
  const m = layoutOverlaps([ap('a', 600, 30), ap('b', 630, 30)]);
  assert.deepEqual(m.get('a'), { col: 0, cols: 1, clash: [] });
  assert.deepEqual(m.get('b'), { col: 0, cols: 1, clash: [] }, 'back to back is not an overlap');
});

test('a double booking: two halves, the earlier on the left, each naming the other', () => {
  const m = layoutOverlaps([ap('doublon', 990, 30), ap('jordan', 990, 45)]);
  assert.deepEqual(m.get('jordan'), { col: 0, cols: 2, clash: ['doublon'] }, 'same start: the longer one first');
  assert.deepEqual(m.get('doublon'), { col: 1, cols: 2, clash: ['jordan'] });
});

test('a partial overlap shares the width too, and only real neighbours are named', () => {
  // samir 15:15–15:45, gabriel 15:30–16:00, leo 15:45–16:15: samir and leo never meet but share gabriel
  const m = layoutOverlaps([ap('leo', 945, 30), ap('samir', 915, 30), ap('gabriel', 930, 30)]);
  assert.equal(m.get('samir').cols, 2);
  assert.deepEqual([m.get('samir').col, m.get('gabriel').col, m.get('leo').col], [0, 1, 0], 'leo takes back the left share once samir is done');
  assert.deepEqual(m.get('samir').clash, ['gabriel']);
  assert.deepEqual(m.get('gabriel').clash.sort(), ['leo', 'samir']);
  assert.deepEqual(m.get('leo').clash, ['gabriel']);
});

test('three at once: three shares; the rest of the day is untouched', () => {
  const m = layoutOverlaps([ap('a', 600, 60), ap('b', 600, 60), ap('c', 615, 30), ap('later', 700, 30)]);
  assert.deepEqual(['a', 'b', 'c'].map((id) => m.get(id).cols), [3, 3, 3]);
  assert.equal(new Set(['a', 'b', 'c'].map((id) => m.get(id).col)).size, 3, 'no two on the same share');
  assert.deepEqual(m.get('later'), { col: 0, cols: 1, clash: [] });
});

test('before forcing: who already sits on that slot, in time order', () => {
  const day = [ap('matin', 540, 30), ap('jordan', 990, 30), ap('apres', 1020, 30)];
  assert.deepEqual(overlapping(day, 990, 30).map((x) => x.id), ['jordan']);
  assert.deepEqual(overlapping(day, 1005, 30).map((x) => x.id), ['jordan', 'apres']);
  assert.deepEqual(overlapping(day, 600, 30), []);
});
