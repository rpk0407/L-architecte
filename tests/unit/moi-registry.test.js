// /moi's folder registries (AC-03a, INDEX › Shared contracts): a card file dropped in web/src/moi/cards/ shows on its
// tab with no other edit, and a « Mes avantages » row dropped in web/src/moi/avantages/ joins the one card, in order.
// The folders are read by Vite's import.meta.glob; here the same sorting runs on a fixture glob.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cardsOf, avantagesOf, TABS } from '../../web/src/moi/registry.ts';
import { safeNext, tabOf, PATHS } from '../../web/src/moi/paths.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const C = () => null;
const card = (id, tab, order) => ({ meta: { id, tab, order }, default: C });

// what import.meta.glob('./cards/*.tsx', { eager: true }) hands over: path → module
const glob = { './cards/Next.tsx': card('next', 'home', 10), './cards/Avantages.tsx': card('avantages', 'home', 30), './cards/History.tsx': card('history', 'history', 10), './cards/Session.tsx': card('session', 'profile', 100) };

test('a card file dropped in the folder shows on its tab, in its order, with nothing else edited', () => {
  const before = cardsOf(glob);
  assert.deepEqual(before.home.map((m) => m.meta.id), ['next', 'avantages']);
  // AC-04's rebook (home 20) and AC-02's profile (profile 10) arrive as files
  const after = cardsOf({ ...glob, './cards/Rebook.tsx': card('rebook', 'home', 20), './cards/Profile.tsx': card('profile', 'profile', 10), './cards/Test.tsx': card('test', 'history', 5) });
  assert.deepEqual(after.home.map((m) => m.meta.id), ['next', 'rebook', 'avantages']);
  assert.deepEqual(after.history.map((m) => m.meta.id), ['test', 'history']);
  assert.deepEqual(after.profile.map((m) => m.meta.id), ['profile', 'session']);
  // a memo component is a component; a file without a usable meta is left out rather than breaking the space
  const memo = { $$typeof: Symbol.for('react.memo'), type: C };
  const odd = cardsOf({ './cards/Memo.tsx': { meta: { id: 'memo', tab: 'home', order: 1 }, default: memo }, './cards/NoMeta.tsx': { default: C }, './cards/BadTab.tsx': card('x', 'nowhere', 1), './cards/NoOrder.tsx': { meta: { id: 'y', tab: 'home' }, default: C }, './cards/util.tsx': { helper: 1 } });
  assert.deepEqual(odd.home.map((m) => m.meta.id), ['memo']);
  assert.deepEqual(TABS, ['home', 'history', 'profile']);
});

test('« Mes avantages » rows come in the shared order: membership, carnet, loyalty, gift card', () => {
  const row = (id, order) => ({ meta: { id, order }, default: C });
  const rows = avantagesOf({ '../avantages/GiftCard.tsx': row('giftcard', 40), '../avantages/Carnet.tsx': row('carnet', 20), '../avantages/Loyalty.tsx': row('loyalty', 30), '../avantages/Membership.tsx': row('membership', 10), '../avantages/x.tsx': {} });
  assert.deepEqual(rows.map((m) => m.meta.id), ['membership', 'carnet', 'loyalty', 'giftcard']);
});

test('the registries read whole folders, and every file in them is a card or a row', () => {
  assert.match(read('web/src/moi/registry.ts'), /import\.meta\.glob\('\.\/cards\/\*\.tsx', \{ eager: true \}\)/);
  assert.match(read('web/src/moi/cards/Avantages.tsx'), /import\.meta\.glob\('\.\.\/avantages\/\*\.tsx', \{ eager: true \}\)/);
  const metas = { 'Next.tsx': ['next', 'home', 10], 'History.tsx': ['history', 'history', 10], 'Avantages.tsx': ['avantages', 'home', 30], 'Session.tsx': ['session', 'profile', 100] };
  // other areas' files (AC-02, FID-03, AC-03b…) only need the two exports; this package's own are checked to the letter
  const has = (src, f) => { assert.match(src, /export const meta\b/, f + ' has no meta'); assert.match(src, /export default\b/, f + ' has no default export'); };
  for (const f of readdirSync(join(ROOT, 'web/src/moi/cards'))) {
    const src = read('web/src/moi/cards/' + f);
    has(src, f);
    if (!metas[f]) continue;
    const m = /export const meta = \{ id: '([\w-]+)', tab: '(home|history|profile)' as const, order: (\d+) \}/.exec(src);
    assert.deepEqual(m && [m[1], m[2], Number(m[3])], metas[f], f);
  }
  const rows = { 'Carnet.tsx': ['carnet', 20], 'GiftCard.tsx': ['giftcard', 40] };
  for (const f of readdirSync(join(ROOT, 'web/src/moi/avantages'))) {
    const src = read('web/src/moi/avantages/' + f);
    has(src, f);
    if (!rows[f]) continue;
    const m = /export const meta = \{ id: '([\w-]+)', order: (\d+) \}/.exec(src);
    assert.deepEqual(m && [m[1], Number(m[2])], rows[f], f);
  }
  // a carnet is never called « abonnement » on the client's screen
  assert.match(read('web/src/moi/avantages/Carnet.tsx'), /\/abonnement\/i\.test\(k\.name\)/);
});

test('?next= only ever leads to a page of /moi on this site', () => {
  const o = 'https://barberlarchitecte.com';
  assert.equal(safeNext('/moi/profil', o), '/moi/profil');
  assert.equal(safeNext('/moi/abonnement?resilier=1#x', o), '/moi/abonnement?resilier=1#x');
  assert.equal(safeNext('/moi', o), '/moi');
  for (const bad of ['https://evil.example/moi', '//evil.example/moi', '/\\evil.example/moi', '/moine', '/comptoir', '/moi/../comptoir', 'javascript:alert(1)', '', null, undefined]) assert.equal(safeNext(bad, o), null, String(bad));
  assert.equal(tabOf('/moi'), 'home');
  assert.equal(tabOf('/moi/historique'), 'history');
  assert.equal(tabOf('/moi/profil'), 'profile');
  assert.equal(tabOf('/moi/profilx'), 'home');
  assert.deepEqual(PATHS, { home: '/moi', history: '/moi/historique', profile: '/moi/profil' });
});
