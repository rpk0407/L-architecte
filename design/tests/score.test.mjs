// Scoring, the jury view, the persona view and the ratchet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOf, axisScores, jury, personaScores, severity, AXES, BLEND } from '../instruments/lib/score.mjs';
import { snapshot, compare } from '../instruments/lib/ratchet.mjs';

const c = (id, status, weight = 2, extra = {}) => ({ id, trial: id.split('.')[0], axis: 'usability', title: id, weight, status, personas: [], ...extra });

test('Awwwards’ published weights are 40, 30, 20, 10, and craft is a separate track', () => {
  assert.deepEqual([AXES.design.weight, AXES.usability.weight, AXES.creativity.weight, AXES.content.weight], [0.4, 0.3, 0.2, 0.1]);
  assert.equal(AXES.craft.weight, null);
  assert.ok(Math.abs(0.4 + 0.3 + 0.2 + 0.1 - 1) < 1e-9, 'they add up to 100%');
});

test('scoreOf weighs by each check’s weight, counts a warning as half and ignores info', () => {
  assert.equal(scoreOf([c('a.x', 'pass', 1), c('a.y', 'fail', 1)]).score, 5);
  assert.equal(scoreOf([c('a.x', 'pass', 3), c('a.y', 'warn', 1)]).score, 8.75);
  assert.equal(scoreOf([c('a.x', 'info', 5)]).score, null, 'nothing measured is not a zero');
  assert.equal(scoreOf([c('a.x', 'pass', 2), c('a.y', 'info', 5)]).score, 10);
});

test('instruments cannot score what only a judge can: design, creativity and content wait for the panel', () => {
  const inst = axisScores([c('a.x', 'pass'), c('a.y', 'pass', 2, { axis: 'design' })]);
  const j = jury(inst, null);
  assert.equal(j.axes.design.final, null);
  assert.equal(j.axes.usability.final, 10);
  assert.equal(j.partial, true);
  assert.equal(j.total, 10, 'a partial total is the usability score alone…');
  assert.deepEqual(j.covers, ['Usabilité'], '…and says so');
});

test('with the panel, a total over all four axes is the 40/30/20/10 weighting, and instruments blend with the panel where both speak', () => {
  const inst = axisScores([c('a.x', 'pass')]);
  const panel = { axes: { design: { score: 8 }, usability: { score: 5 }, creativity: { score: 9 }, content: { score: 7 } } };
  const j = jury(inst, panel);
  const usability = 10 * BLEND.usability.instruments + 5 * BLEND.usability.panel;
  assert.equal(j.axes.usability.final, +usability.toFixed(2));
  assert.equal(j.partial, false);
  assert.equal(j.total, +((0.4 * 8 + 0.3 * usability + 0.2 * 9 + 0.1 * 7)).toFixed(2));
});

test('the persona view weighs each persona by who they are', () => {
  const personas = [{ id: 'a', kind: 'client', weight: 0.75 }, { id: 'b', kind: 'client', weight: 0.25 }];
  const ps = personaScores([c('x.1', 'pass', 2, { personas: ['a'] }), c('x.2', 'fail', 2, { personas: ['b'] })], personas);
  assert.equal(ps.byPersona.a.score, 10); assert.equal(ps.byPersona.b.score, 0);
  assert.equal(ps.clients, 7.5);
});

test('severity follows status and weight', () => {
  assert.equal(severity(c('a', 'fail', 4)), 'blocker'); assert.equal(severity(c('a', 'fail', 3)), 'major'); assert.equal(severity(c('a', 'fail', 1)), 'minor');
  assert.equal(severity(c('a', 'warn', 3)), 'minor'); assert.equal(severity(c('a', 'warn', 2)), 'note'); assert.equal(severity(c('a', 'pass', 5)), null);
});

const run = (checks, trials = ['a']) => ({ build: 't', date: '2026-01-01', checks, trials: trials.map((id) => ({ id })) });
const pers = { byPersona: { p: { score: 8 } } };

test('the ratchet fails on a regression, never on what was already wrong', () => {
  const base = snapshot(run([c('a.good', 'pass', 3), c('a.meh', 'warn', 2), c('a.bad', 'fail', 2)]), { usability: { score: 5 } }, pers);
  const same = compare(base, run([c('a.good', 'pass', 3), c('a.meh', 'warn', 2), c('a.bad', 'fail', 2)]), { usability: { score: 5 } }, pers);
  assert.equal(same.ok, true);
  const worse = compare(base, run([c('a.good', 'fail', 3), c('a.meh', 'warn', 2), c('a.bad', 'fail', 2)]), { usability: { score: 5 } }, pers);
  assert.equal(worse.ok, false); assert.equal(worse.regressions[0].id, 'a.good');
  const better = compare(base, run([c('a.good', 'pass', 3), c('a.meh', 'pass', 2), c('a.bad', 'fail', 2)]), { usability: { score: 5 } }, pers);
  assert.equal(better.ok, true); assert.equal(better.improvements[0].id, 'a.meh');
});

test('a pass that becomes a warning only breaks the gate when it carries weight', () => {
  const base = snapshot(run([c('a.light', 'pass', 1), c('a.heavy', 'pass', 3)]), {}, pers);
  assert.equal(compare(base, run([c('a.light', 'warn', 1), c('a.heavy', 'pass', 3)]), {}, pers).ok, true);
  assert.equal(compare(base, run([c('a.light', 'pass', 1), c('a.heavy', 'warn', 3)]), {}, pers).ok, false);
});

test('new findings are reported; only a new serious failure breaks the gate; info is invisible to it', () => {
  const base = snapshot(run([c('a.x', 'pass')]), {}, pers);
  const r1 = compare(base, run([c('a.x', 'pass'), c('a.new', 'fail', 2), c('a.fyi', 'info', 5)]), {}, pers);
  assert.equal(r1.ok, true); assert.equal(r1.newFindings.length, 1);
  const r2 = compare(base, run([c('a.x', 'pass'), c('a.new', 'fail', 4)]), {}, pers);
  assert.equal(r2.ok, false); assert.equal(r2.newBlockers.length, 1);
});

test('axis and persona scores may not fall by more than their tolerance', () => {
  const base = snapshot(run([c('a.x', 'pass')]), { usability: { score: 8 } }, { byPersona: { p: { score: 8 } } });
  assert.equal(compare(base, run([c('a.x', 'pass')]), { usability: { score: 7.8 } }, { byPersona: { p: { score: 7.8 } } }).ok, true);
  assert.equal(compare(base, run([c('a.x', 'pass')]), { usability: { score: 7.5 } }, { byPersona: { p: { score: 8 } } }).ok, false);
  assert.equal(compare(base, run([c('a.x', 'pass')]), { usability: { score: 8 } }, { byPersona: { p: { score: 7.3 } } }).ok, false);
});
