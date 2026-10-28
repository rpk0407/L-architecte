// AC-02 · The screens this package adds explain themselves: every step of its guide files points at a part that carries
// that data-guide in the source, and every part it marks has its step. Steps are data (web/src/lib/guide.ts GuideStep):
// a part's name as the screen shows it, what it does and when to use it in two short sentences at most, French with « tu ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
/** The default export of a steps file, read as data (the types are erased, the file is a plain literal). */
const steps = (p) => new Function(read(p).replace(/^import type .*$/m, '').replace(/const steps: GuideStep\[\] =/, 'const steps =').replace('export default steps;', 'return steps;'))();

const SOURCES = {
  comptoir: ['web/src/comptoir/pages/clients/AccountCard.tsx', 'web/src/comptoir/pages/reglages/sections/EspaceClient.tsx'],
  moi: ['web/src/moi/cards/Profile.tsx', 'web/src/moi/cards/Session.tsx']
};
const FILES = { comptoir: 'web/src/comptoir/guide/steps/AC-02.ts', moi: 'web/src/moi/guide/steps/AC-02.ts' };
const ROLES = new Set(['owner', 'manager', 'desk', 'barber', 'client']);
/** data-guide="x" in the markup, or on a component given a guide prop (Section guide="x") */
const marked = (files) => new Set(files.flatMap((f) => [...read(f).matchAll(/(?:data-guide|guide)=(?:"([a-z][a-z0-9-]*)"|\{'([a-z][a-z0-9-]*)'\})/g)].map((m) => m[1] || m[2])));

for (const area of ['comptoir', 'moi']) {
  test(`${area}: every step points at a part of the screen, every part has its step, and each step says little`, () => {
    const list = steps(FILES[area]);
    const parts = marked(SOURCES[area]);
    assert.ok(list.length >= 4);
    assert.deepEqual(new Set(list.map((x) => x.target)), parts, 'one step per marked part, no step for a part that is not there');
    assert.equal(new Set(list.map((x) => x.id)).size, list.length, 'ids are unique');
    for (const st of list) {
      assert.match(st.id, /^[a-z]+\.[a-z-]+$/, st.id);
      assert.ok(st.page.startsWith(area === 'moi' ? '/moi' : '/comptoir/'), st.page);
      assert.ok(st.title.length > 2 && st.title.length <= 60, st.title);
      assert.ok(st.body.length <= 220, 'short: ' + st.id);
      assert.ok((st.body.match(/[.!?](?=\s|$)/g) || []).length <= 2, 'two sentences at most: ' + st.id);
      assert.match(st.body, /\b(tu|ton|ta|tes|te|toi|son|sa|ses|lui|il)\b|^[A-ZÉ][a-zéèê]+/, st.id);
      assert.doesNotMatch(st.body, /(?<![-\p{L}])(vous|votre|vos)(?!\p{L})/iu, 'with « tu », not « vous »: ' + st.id);
      for (const r of st.roles || []) assert.ok(ROLES.has(r), st.id + ' role ' + r);
    }
  });
}

test('the parts that only some roles see say so', () => {
  const list = steps(FILES.comptoir);
  assert.deepEqual(list.find((x) => x.id === 'clients.account-detach').roles, ['owner', 'manager', 'desk']);
  assert.deepEqual(list.find((x) => x.id === 'reglages.espace-client').roles, ['owner']);
  assert.ok(steps(FILES.moi).every((x) => x.roles && x.roles.join() === 'client'));
});
