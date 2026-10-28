// The client space explains itself (INDEX › User requirements, 2026-10-27 evening): every step of AC-03a's guide points
// at a part its screens really mark with data-guide, in two short sentences at most, talking to the client with « tu ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import steps from '../../web/src/moi/guide/steps/AC-03a.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const tsx = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tsx(dir + '/' + e.name) : e.name.endsWith('.tsx') ? [dir + '/' + e.name] : []);
// the screens of this package: /moi, the /r/ page's line, the site's done step
const SOURCES = [...tsx('web/src/moi'), 'web/src/client/main.tsx', 'public/site.html'];
// data-guide="x" in markup, or guide="x" handed to the kit's Sheet and AvRow, which write it as data-guide
const marked = new Set(SOURCES.flatMap((f) => [...read(f).matchAll(/\b(?:data-)?guide="([\w.-]+)"/g)].map((m) => m[1])));
const ROLES = new Set(['owner', 'manager', 'desk', 'barber', 'client']);

test('every step points at a part its screen marks', () => {
  assert.ok(Array.isArray(steps) && steps.length >= 10);
  assert.match(read('web/src/moi/kit.tsx'), /data-guide=\{guide\}/);
  for (const s of steps) assert.ok(s.target && marked.has(s.target), s.id + ': no data-guide="' + s.target + '" in ' + SOURCES.length + ' files');
});

test('each step is short, in French with « tu », and says who sees it', () => {
  const ids = new Set();
  for (const s of steps) {
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id);
    ids.add(s.id);
    assert.match(s.page, /^\//, s.id);
    assert.ok(s.title.trim().length > 0 && s.title.length <= 60, s.id + ' title');
    // two short sentences at most
    const sentences = s.body.split(/(?<=[.!?…])\s+(?=[«A-ZÀ-Ý])/).filter(Boolean);
    assert.ok(sentences.length <= 2, s.id + ': ' + sentences.length + ' sentences');
    assert.ok(s.body.length <= 200, s.id + ' body too long');
    // « rendez-vous » is not a « vous »
    assert.doesNotMatch(s.body, /(?<![-\p{L}])(vous|votre|vos)(?!\p{L})/iu, s.id + ' says « vous »');
    assert.ok(s.roles && s.roles.length && s.roles.every((r) => ROLES.has(r)), s.id + ' roles');
  }
});
