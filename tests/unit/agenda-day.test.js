// The phone agenda's display rules (web/src/comptoir/pages/agenda/day.ts): the hours drawn, why a stretch is not
// bookable, the free stretches that read « Libre 30 min », the load of a day on the week strip, and the swipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawnRange, offZones, freeGaps, slotAt, loadOf, loadWords, byHour, swipeAxis, swipeEnd, PAUSE_MAX, FREE_MIN } from '../../web/src/comptoir/pages/agenda/day.ts';

const ap = (start, dur, extra = {}) => ({ start, dur, ...extra });

test('the hours drawn: the chairs’ working hours on whole hours, stretched to what is booked outside them', () => {
  assert.deepEqual(drawnRange([[[540, 780], [810, 1110]], [[570, 1110]]], []), [540, 1140]);
  assert.deepEqual(drawnRange([[[540, 1110]]], [ap(1110, 45)]), [540, 1200], 'a late appointment is drawn');
  assert.deepEqual(drawnRange([[[540, 1110]]], [ap(500, 30)]), [480, 1140], 'an early one too');
  assert.deepEqual(drawnRange([[]], []), [540, 1140], 'a closed day keeps the usual frame');
});

test('not bookable, and why: closed before and after, a pause inside, away for a long stretch or a whole day', () => {
  assert.deepEqual(offZones([[540, 780], [810, 1110]], 540, 1140), [{ a: 780, b: 810, kind: 'pause' }, { a: 1110, b: 1140, kind: 'ferme' }]);
  assert.deepEqual(offZones([[570, 1110]], 540, 1140), [{ a: 540, b: 570, kind: 'ferme' }, { a: 1110, b: 1140, kind: 'ferme' }]);
  // half a day off (an absence posted for the afternoon's start) is not a pause
  assert.equal(offZones([[540, 720], [720 + PAUSE_MAX + 15, 1110]], 540, 1110)[0].kind, 'absent');
  assert.equal(offZones([[540, 720], [720 + PAUSE_MAX, 1110]], 540, 1110)[0].kind, 'pause');
  assert.deepEqual(offZones([], 540, 1140, true), [{ a: 540, b: 1140, kind: 'absent' }], 'no hour while the salon is open: away');
  assert.deepEqual(offZones([], 540, 1140, false), [{ a: 540, b: 1140, kind: 'ferme' }], 'no hour on a closed day: closed');
  assert.deepEqual(offZones([[540, 1140]], 540, 1140), []);
});

test('free stretches: working hours minus appointments, blocks and held slots, from now on, a quarter of an hour and more', () => {
  const work = [[540, 780], [810, 1110]];
  assert.deepEqual(freeGaps(work, []), [[540, 780], [810, 1110]], 'a day with no appointment is free from end to end');
  assert.deepEqual(freeGaps(work, [ap(540, 30), ap(600, 45), ap(750, 60)]), [[570, 600], [645, 750], [810, 1110]], 'an appointment across the pause takes both sides');
  assert.deepEqual(freeGaps(work, [ap(540, 30), ap(580, 20)]).slice(0, 1), [[600, 780]], 'ten minutes between two clients are not offered');
  assert.equal(FREE_MIN, 15);
  // today: the morning already gone is not offered
  assert.deepEqual(freeGaps(work, [ap(930, 30)], 910), [[910, 930], [960, 1110]]);
  assert.deepEqual(freeGaps(work, [], Infinity), [], 'a day gone by offers nothing');
  assert.deepEqual(freeGaps([], [ap(600, 30)]), [], 'a barber away has nothing free');
  // two clients at once (a forced booking) do not make the stretch negative
  assert.deepEqual(freeGaps([[900, 1020]], [ap(960, 30), ap(960, 30)]), [[900, 960], [990, 1020]]);
});

test('a touch in a free stretch books at the quarter touched, inside the stretch', () => {
  assert.equal(slotAt([900, 1020], 947), 945);
  assert.equal(slotAt([910, 1020], 911), 910, 'the start of the stretch when it is not on a quarter');
  assert.equal(slotAt([900, 1020], 1019), 1005, 'never the last minutes');
  assert.equal(slotAt([900, 915], 914), 900);
  assert.equal(slotAt([900, 910], 905), 900);
});

test('the week strip: how full a day is, in a figure and in words', () => {
  assert.equal(loadOf([{ minutes: 300, cap: 570 }, { minutes: 270, cap: 570 }]), 0.5);
  assert.equal(loadOf([{ minutes: 700, cap: 570 }]), 1, 'never more than full');
  assert.equal(loadOf([{ minutes: 0, cap: 0 }]), null);
  assert.equal(loadOf([]), null);
  assert.equal(loadWords(null), 'fermé');
  assert.equal(loadWords(0.69), 'rempli à 69 %');
  assert.equal(loadWords(1), 'complet');
});

test('the list: hour by hour, in order', () => {
  const g = byHour([{ id: 'c', start: 615 }, { id: 'a', start: 540 }, { id: 'b', start: 570 }, { id: 'd', start: 900 }]);
  assert.deepEqual(g.map((x) => [x.hour, x.items.map((i) => i.id).join('')]), [[9, 'ab'], [10, 'c'], [15, 'd']]);
  assert.deepEqual(byHour([]), []);
});

test('the swipe: sideways is a day, up and down is the page; far enough or fast enough', () => {
  assert.equal(swipeAxis(4, 3), null, 'not yet decided');
  assert.equal(swipeAxis(30, 6), 'x');
  assert.equal(swipeAxis(12, 40), 'y');
  assert.equal(swipeAxis(20, 18), 'y', 'a diagonal is the scroll, never a day');
  assert.equal(swipeEnd(-130, 400, 390), -1, 'to the left: next');
  assert.equal(swipeEnd(130, 400, 390), 1, 'to the right: previous');
  assert.equal(swipeEnd(-50, 600, 390), 0, 'a short slow move changes nothing');
  assert.equal(swipeEnd(-50, 80, 390), -1, 'a flick does');
  assert.equal(swipeEnd(20, 20, 390), 0, 'a tap that slipped is not a swipe');
});
