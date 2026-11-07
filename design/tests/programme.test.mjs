// The programme’s own integrity: the roster, the registry of trials, the clocks, the questions, the generated atlas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PERSONAS, allScenes } from '../personas/index.mjs';
import { validateRoster, validatePersona, TRIALS, EVIDENCE } from '../personas/schema.mjs';
import { MOMENTS } from '../programme/moments.mjs';
import { TENSIONS } from '../programme/tensions.mjs';
import { CLOCKS, DEVICES, NETWORKS } from '../instruments/lib/surface.mjs';
import { STREET, GIFT, TRAINING, EXIT } from '../personas/questions.mjs';
import { writeAtlas } from '../personas/atlas.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

test('the roster is valid: weights add up to 1 per side, ids and scenes are unique', () => {
  assert.deepEqual(validateRoster(PERSONAS), []);
  assert.equal(PERSONAS.filter((p) => p.kind === 'client').length, 10);
  assert.equal(PERSONAS.filter((p) => p.kind === 'staff').length, 3);
});

test('the validator rejects what it should', () => {
  const p = structuredClone(PERSONAS[0]);
  assert.ok(validatePersona({ ...p, weight: 2 }).length);
  assert.ok(validatePersona({ ...p, scenes: [{ ...p.scenes[0], clock: 'never' }] }).length);
  assert.ok(validatePersona({ ...p, scenes: [{ ...p.scenes[0], trials: ['nope'] }] }).length);
  assert.ok(validatePersona({ ...p, evidence: [{ claim: 'x', cls: 'V', validate: 'y' }] }).length, 'a vendor claim must cite its URL');
  assert.ok(validatePersona({ ...p, evidence: [{ claim: 'x', cls: 'O', validate: 'y' }] }).length, 'an observed claim must say where');
  assert.ok(validatePersona({ ...p, moments: ['M99'] }).length);
});

test('every persona has at least one hypothesis-grade claim honestly labelled, and every vendor claim cites its source', () => {
  for (const p of PERSONAS) for (const e of p.evidence) { assert.ok(e.cls in EVIDENCE); if (e.cls === 'V') assert.match(e.source, /^https:\/\//); }
});

test('the registry of trials matches the files, and every scene names real trials', () => {
  const files = readdirSync(join(ROOT, 'design/instruments/trials')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, '')).sort();
  assert.deepEqual(files, [...TRIALS].sort());
  for (const s of allScenes()) for (const t of s.trials) assert.ok(TRIALS.includes(t), `${s.id} → ${t}`);
});

test('every trial is exercised by at least one persona scene, or is page-driven', async () => {
  const driven = new Set(allScenes().flatMap((s) => s.trials));
  for (const t of TRIALS) {
    const meta = (await import(`../instruments/trials/${t}.mjs`)).meta;
    assert.equal(meta.id, t);
    if (meta.driver === 'scenes') assert.ok(driven.has(t), `${t} is scene-driven but no persona runs it`);
  }
});

test('moments and tensions reference real things', () => {
  const ids = new Set(MOMENTS.map((m) => m.id));
  assert.equal(ids.size, MOMENTS.length);
  for (const m of MOMENTS) for (const t of m.trials) assert.ok(TRIALS.includes(t), `${m.id} → ${t}`);
  const prefixes = new Set([...TRIALS, 'errors', 'privacy']);
  for (const t of TENSIONS) for (const id of t.checks) assert.ok(prefixes.has(id.split('.')[0]), `${t.id} → ${id}`);
  assert.equal(new Set(TENSIONS.map((t) => t.id)).size, TENSIONS.length);
});

test('tension checks name checks that a real run produced (when a run exists)', (t) => {
  const latest = join(ROOT, '.lx-data/ux/latest.json');
  if (!existsSync(latest)) return t.skip('no run on disk');
  const run = JSON.parse(readFileSync(join(JSON.parse(readFileSync(latest, 'utf8')).dir, 'run.json'), 'utf8'));
  if (run.trials.length < TRIALS.length) return t.skip('the latest run was partial');
  const made = new Set(run.checks.map((c) => c.id));
  for (const tn of TENSIONS) for (const id of tn.checks) assert.ok(made.has(id), `${tn.id} points at ${id}, which no trial produced`);
});

test('every pinned clock is the weekday and the hour its label says', () => {
  const day = { Monday: 'lundi', Tuesday: 'mardi', Wednesday: 'mercredi', Thursday: 'jeudi', Friday: 'vendredi', Saturday: 'samedi', Sunday: 'dimanche' };
  for (const [id, c] of Object.entries(CLOCKS)) {
    const d = new Date(c.iso);
    assert.ok(!Number.isNaN(d.getTime()), id);
    assert.equal(d.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }), day[c.label.split(' ')[0]], `${id}: ${c.label}`);
    const hhmm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
    assert.ok(c.label.includes(hhmm.replace(':', ':')), `${id}: ${hhmm} not in “${c.label}”`);
  }
  for (const s of allScenes()) { assert.ok(CLOCKS[s.clock] && DEVICES[s.device] && s.network in NETWORKS, s.id); }
});

test('the street questions answer on real text, and are not fooled by a city that starts like a month', () => {
  const q = Object.fromEntries(STREET.map((x) => [x.id, x]));
  assert.ok(q.soon.re.test('Prochain créneau · Aujourd’hui · 16 h') && q.soon.re.test('Voir les créneaux') === false);
  assert.ok(q.price.re.test('Réserver dès 15 €') && !q.price.re.test('Réserver'));
  assert.ok(q.open.re.test('Ouvert · jusqu’à 18 h 30 · sans rendez-vous') && !q.open.re.test('Barbier, place Pélabon.'));
  assert.ok(q.where.re.test('Barbier, place Pélabon. Marseille 13e.'));
  assert.ok(q.proof.re.test('5,0 · 316 avis Google'));
  assert.ok(q.route.re.test('Itinéraire') && q.route.re.test('https://www.google.com/maps/search/?api=1&query=x'));
  assert.ok(GIFT.length && EXIT.length && TRAINING.length);
});

test('the generated atlas is up to date with its data', () => {
  assert.deepEqual(writeAtlas({ check: true }), [], 'run `npm run ux:atlas`');
});
