// TEAM-04: every step the tour has for Mon espace points at a part that is marked in the source, ids are unique, and each
// explanation stays short (two sentences at most).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
function walk(dir, out = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = dir + '/' + f;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

/** The steps file is data in TypeScript: read its object literals rather than load it. */
function steps() {
  const src = read('web/src/comptoir/guide/steps/TEAM-04.ts');
  return [...src.matchAll(/\{ id: '([^']+)', page: ([^,]+), (?:target: '([^']+)', )?(?:roles: [^,]+, )?(?:order: \d+, )?title: '([^']+)', body: '((?:[^'\\]|\\.)*)'/g)]
    .map((m) => ({ id: m[1], page: m[2], target: m[3] || null, title: m[4], body: m[5].replace(/\\'/g, "'") }));
}

test('every step of Mon espace points at a data-guide mark in the source', () => {
  const list = steps();
  assert.ok(list.length >= 11, 'the steps are read: ' + list.length);
  const marked = new Set();
  for (const f of [...walk('web/src/comptoir/pages/espace'), 'web/src/comptoir/pages/Espace.tsx', 'web/src/comptoir/pages/Clients.tsx']) {
    // data-guide="espace.prochain" on an element, or guide="espace.prochain" as the card frame's prop
    for (const m of read(f).matchAll(/\bguide="([^"]+)"/g)) marked.add(m[1]);
  }
  const ids = new Set();
  for (const s of list) {
    assert.ok(!ids.has(s.id), 'duplicate step id ' + s.id);
    ids.add(s.id);
    if (s.target) assert.ok(marked.has(s.target), s.id + ': no data-guide="' + s.target + '" in the source');
    assert.ok(s.title && s.body, s.id + ' has a title and a body');
    assert.ok(s.body.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, s.id + ': two short sentences at most');
  }
  // no mark without its step: what the page marks, the tour explains
  for (const t of marked) assert.ok(list.some((s) => s.target === t), 'data-guide="' + t + '" has no step');
});
