// The guided tour's steps of PAY-07 (the weekly rule in Réglages, the weeks on the Abonnés board, the member's week):
// data only, and every step points at a part that exists in the screens' sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(d + '/' + f) : [d + '/' + f]));

/** the steps of a data file, read without a TypeScript build: each object literal of the array */
function steps(file) {
  const body = read(file).slice(read(file).indexOf('const steps'));
  const list = [...body.matchAll(/\{ id: '([^']+)', page: '([^']+)', target: '([^']+)'(?:, roles: \[([^\]]*)\])?(?:, order: (\d+))?, title: '((?:[^'\\]|\\.)*)', body: '((?:[^'\\]|\\.)*)'(?:, order: (\d+))? \}/g)]
    .map((m) => ({ id: m[1], page: m[2], target: m[3], roles: m[4], title: m[6], body: m[7] }));
  assert.equal(list.length, (body.match(/\{ id: '/g) || []).length, file + ': every step line is read by this test');
  return list;
}

for (const [file, dirs, page] of [
  ['web/src/comptoir/guide/steps/PAY-07.ts', ['web/src/comptoir'], /^\/comptoir/],
  ['web/src/moi/guide/steps/PAY-07.ts', ['web/src/moi', 'web/src/client'], /^\/(moi|abo)/]
]) {
  test(file + ': well formed, in French with « tu », and every target is a data-guide of the screens', () => {
    const list = steps(file);
    assert.ok(list.length >= 3);
    const code = dirs.flatMap(walk).filter((f) => /\.tsx$/.test(f)).map(read).join('\n');
    assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'unique ids');
    for (const x of list) {
      assert.match(x.page, page, x.id);
      assert.ok(new RegExp('(data-guide|guide)=(\\{[^}]*\'' + x.target + '\'[^}]*\\}|"' + x.target + '")').test(code), x.id + ': no data-guide="' + x.target + '" in ' + dirs.join(', '));
      const sentences = x.body.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length <= 2, x.id + ': ' + sentences.length + ' sentences');
      assert.ok(!/\b(vous|votre|vos)\b/i.test(x.body), x.id + ': vouvoiement');
      assert.ok(x.title.length >= 3 && x.title.length <= 40, x.id);
    }
  });
}

test('the comptoir steps cover the parts the spec names: the rule cards, the preview, the week dots, the chip, the two figures', () => {
  const targets = new Set(steps('web/src/comptoir/guide/steps/PAY-07.ts').map((x) => x.target));
  for (const t of ['abo-missed', 'abo-offer-line', 'members-weeks', 'members-notyet', 'members-presence', 'members-missed']) assert.ok(targets.has(t), t);
});
