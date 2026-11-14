// « Le client est là ? » on the desk's agenda: a « Pas encore » less than 10 minutes before the booking's end is not
// announced as asked again, since the question never comes back after the end (server/domain/arrival.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalOf } from '../../server/domain/arrival.js';
import { readFileSync } from 'node:fs';
import { at } from '../helpers.js';

const DAY = '2026-11-03';
const s = { settings: { team: {} } };
const appt = (later) => ({ status: 'booked', day: DAY, start: 600, dur: 30, ...(later != null ? { arrivalLater: { day: DAY, min: later } } : {}) });

test('a « Pas encore » with time left: asked again 10 minutes later, and the agenda says when', () => {
  const q = arrivalOf(s, appt(605), at(DAY, 10, 7));
  assert.deepEqual(q, { ask: 615, due: false, later: 605, again: true });
});

test('a « Pas encore » 5 minutes before the end: no « redemandé à » the question will never keep', () => {
  const q = arrivalOf(s, appt(625), at(DAY, 10, 26));
  assert.deepEqual(q, { ask: 635, due: false, later: 625, again: false });
  // the agenda's words (Arrival.tsx arrivalWords, a React file Node cannot import) leave out « redemandé à » then
  const src = readFileSync(new URL('../../web/src/comptoir/pages/espace/Arrival.tsx', import.meta.url), 'utf8');
  assert.match(src, /q\.due \? ', redemandé' : q\.again === false \? '' : ', redemandé à ' \+ time\(q\.ask\)/);
});
