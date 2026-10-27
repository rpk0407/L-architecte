// The Caisse's « caisse de gestion » sheet links to the fiscal note in docs/security.md by its anchor, and the docs link
// to it too: renaming the heading would break those links without a sound, so the anchors are checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(resolve(ROOT, f), 'utf8');
/** GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen. @param {string} h */
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
/** @param {string} f */
const anchors = (f) => new Set([...read(f).matchAll(/^#{1,6} (.+)$/gm)].map(([, h]) => slug(h)));

test('the Caisse links to a heading docs/security.md has', () => {
  const m = read('web/src/comptoir/pages/Caisse.tsx').match(/FISCAL_NOTE = '[^']*\/docs\/security\.md#([\w-]+)'/);
  assert.ok(m, 'Caisse.tsx no longer links to docs/security.md');
  assert.equal(m[1], 'fiscal-note-france');
  assert.ok(anchors('docs/security.md').has(m[1]), 'docs/security.md has no heading for #' + m[1]);
});

test('the docs link to anchors that exist', () => {
  for (const f of ['README.md', 'docs/operations.md', 'docs/roadmap.md', 'docs/security.md', 'docs/architecture.md']) {
    for (const [, file, id] of read(f).matchAll(/\]\(((?:\.\.\/)?(?:docs\/)?[\w-]+\.md)?#([\w-]+)\)/g)) {
      const target = !file ? f : file.startsWith('../') ? file.slice(3) : f.startsWith('docs/') && !file.startsWith('docs/') ? 'docs/' + file : file;
      assert.ok(anchors(target).has(id), f + ' links to ' + target + '#' + id + ', which is no heading there');
    }
  }
});

test('the fiscal note offers no attestation: only an accredited body certifies a till', () => {
  const s = read('docs/security.md');
  assert.doesNotMatch(s, /attestation/i);
  assert.match(s, /accredited body/);
});
