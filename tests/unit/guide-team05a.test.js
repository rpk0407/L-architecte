// TEAM-05a: the steps the tour has for Pilotage point at parts that are marked in the source (and every mark has its step),
// ids are unique, each explanation stays short, in « tu »; and the tiles folder keeps its contract (meta + default component).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(d + '/' + f) : [d + '/' + f]));
const steps = (await import(join(ROOT, 'web/src/comptoir/guide/steps/TEAM-05a.ts').replace(/\.ts$/, '.ts'))).default;
const SOURCES = [...walk('web/src/comptoir/pages/pilotage'), 'web/src/comptoir/pages/Pilotage.tsx'].filter((f) => f.endsWith('.tsx'));

test('every step of Pilotage points at a data-guide mark of its sources, and every mark has its step', () => {
  assert.ok(steps.length >= 12);
  const marks = new Set(SOURCES.flatMap((f) => [...read(f).matchAll(/(?:data-guide|\bguide)="([^"]+)"/g)].map((m) => m[1])));
  const ids = new Set();
  for (const s of steps) {
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id);
    ids.add(s.id);
    assert.equal(s.page, '/comptoir/pilotage');
    assert.deepEqual(s.roles, ['owner', 'manager'], s.id + ': Pilotage is report.shop, the owner’s and the managers’');
    assert.ok(s.target && marks.has(s.target), s.id + ': no data-guide="' + s.target + '" in the source');
    assert.ok(s.body.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, s.id + ': two short sentences at most');
    assert.ok(!/(?<!-)\b(vous|votre|vos)\b/i.test(s.title + ' ' + s.body), s.id + ': « tu », not « vous »');
    assert.ok(s.title.length >= 3 && s.title.length <= 40, s.id);
  }
  for (const m of marks) assert.ok(steps.some((s) => s.target === m), 'data-guide="' + m + '" has no step');
});

test('the tiles folder: every file exports its meta (a unique id, the capability it needs) and a component that fetches its own route', () => {
  const files = walk('web/src/comptoir/pages/pilotage/tiles').filter((f) => f.endsWith('.tsx'));
  // a new area drops its file here (Loyalty, Compta…): the built-in three must be there, any other must keep the contract below
  for (const n of ['Accounts.tsx', 'Members.tsx', 'Reviews.tsx']) assert.ok(files.some((f) => f.endsWith('/' + n)), n + ' is missing');
  const ids = new Set();
  for (const f of files) {
    const src = read(f);
    const id = /export const meta: PilotageTileMeta = \{ id: '([\w-]+)'(?:, cap: '([\w.]+)')? \}/.exec(src);
    assert.ok(id, f + ': export const meta = { id, cap? }');
    assert.ok(!ids.has(id[1]), 'duplicate tile id ' + id[1]);
    ids.add(id[1]);
    assert.equal(id[2], 'report.shop', f + ': the cockpit is report.shop');
    assert.match(src, /export default function/, f);
    assert.match(src, /useQuery<[^>]+>\('\/api\/v1\/[\w/]+'/, f + ': it fetches its own route');
    // a refusal or a missing route leaves no frame: it renders nothing without data
    assert.match(src, /if \(!(?:q\.data|s)\b.*\) return null/, f + ': nothing while there is no answer');
  }
});
