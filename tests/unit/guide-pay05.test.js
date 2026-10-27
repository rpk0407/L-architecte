// The guided tour's steps for the abonnement in the Comptoir (PAY-05): data only, and every step points at a part that exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(d + '/' + f) : [d + '/' + f]));

/** the steps, read from the data file without a TypeScript build: objects between the array brackets */
function steps() {
  const src = read('web/src/comptoir/guide/steps/PAY-05.ts');
  const body = src.slice(src.indexOf('const steps'));
  return [...body.matchAll(/\{ id: '([^']+)', page: '([^']+)', target: '([^']+)'(?:, roles: \[([^\]]*)\])?, title: '((?:[^'\\]|\\.)*)', body: '((?:[^'\\]|\\.)*)'(?:, order: (\d+))? \}/g)]
    .map((m) => ({ id: m[1], page: m[2], target: m[3], roles: m[4], title: m[5], body: m[6] }));
}

test('every step of PAY-05 is well formed and points at a data-guide that exists in the sources', () => {
  const list = steps();
  const declared = (read('web/src/comptoir/guide/steps/PAY-05.ts').match(/\{ id: '/g) || []).length;
  assert.equal(list.length, declared, 'every step line is read by this test');
  assert.ok(list.length >= 10);
  const code = walk('web/src/comptoir').filter((f) => /\.tsx$/.test(f)).map(read).join('\n');
  assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'unique ids');
  for (const x of list) {
    assert.match(x.page, /^\/comptoir/, x.id);
    // written as data-guide="…", in an expression, or as the `guide` prop of Fold (which sets it)
    assert.ok(new RegExp('(data-guide|guide)=(\\{[^}]*\'' + x.target + '\'[^}]*\\}|"' + x.target + '")').test(code), x.id + ': no data-guide="' + x.target + '" in the Comptoir sources');
    // two short sentences at most, in French with « tu »
    const sentences = x.body.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, x.id + ': ' + sentences.length + ' sentences');
    assert.ok(!/\b(vous|votre|vos)\b/i.test(x.body), x.id + ': vouvoiement');
    assert.ok(x.title.length >= 3 && x.title.length <= 40, x.id);
  }
});
