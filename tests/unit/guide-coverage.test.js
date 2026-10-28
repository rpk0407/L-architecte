// GUIDE-01b · The Comptoir's guide steps cover every page and every Réglages section, point at parts that exist, and
// never send someone to a page their rights keep shut. Reads every steps file of web/src/comptoir/guide/steps, so the
// files of the other packages are held to the rules about ids, pages and rights; the copy rules are this package's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { capsOf } from '../../server/domain/permissions.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(d + '/' + f) : [d + '/' + f]));

const STEPS_DIR = 'web/src/comptoir/guide/steps';
const files = readdirSync(join(ROOT, STEPS_DIR)).filter((f) => f.endsWith('.ts')).sort();
const all = [];
for (const f of files) for (const s of (await import(join(ROOT, STEPS_DIR, f))).default) all.push({ ...s, file: f });
const mine = all.filter((s) => s.file === 'GUIDE-01b.ts');

// the pages (App.tsx ROUTES) with the capability each needs, and the Réglages sections (Reglages.tsx) with theirs (caps.ts)
const app = read('web/src/comptoir/App.tsx');
const ROUTES = Object.fromEntries([...app.matchAll(/^\s{2}(\w+): \{ C: \w+, title: '[^']*'(?:, cap: '([^']+)')?/gm)].map((m) => [m[1], m[2] || null]));
const SECTIONS = [...read('web/src/comptoir/pages/Reglages.tsx').matchAll(/\{ id: '([\w-]+)', label:/g)].map((m) => m[1]);
const caps = read('web/src/comptoir/pages/reglages/caps.ts');
const SECTION_CAP = Object.fromEntries([...caps.slice(caps.indexOf('SECTION_CAP'), caps.indexOf('};')).matchAll(/^\s+'?([\w-]+)'?: '(\w+)'/gm)].map((m) => [m[1], m[2]]));
const OPEN_SECTIONS = ['compte'];

// owned by GUIDE-01a (the tour's own package: it launches from there and writes the steps of the daily pages)
const OTHER_PACKAGE = { pages: new Set(['agenda']), sections: new Set(['mise-en-route']) };

test('the page and section tables of this test are read from the sources (a renamed table fails here, not silently)', () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), ['agenda', 'caisse', 'catalogue', 'clients', 'equipe', 'espace', 'rapports', 'relances', 'reglages'].sort());
  assert.ok(SECTIONS.length >= 15 && SECTIONS.includes('compte') && SECTIONS.includes('journal'));
  assert.equal(SECTION_CAP.journal, 'audit');
  assert.equal(SECTION_CAP.wordpress, 'settings');
});

const parts = (page) => page.replace(/^\/comptoir\/?/, '').split('/').filter(Boolean);

test('every Comptoir page and every Réglages section has at least one step', () => {
  for (const page of Object.keys(ROUTES)) {
    if (OTHER_PACKAGE.pages.has(page)) continue;
    assert.ok(all.some((s) => parts(s.page)[0] === page), 'page ' + page + ' has no step');
  }
  for (const id of SECTIONS) {
    if (OTHER_PACKAGE.sections.has(id)) continue;
    assert.ok(all.some((s) => s.page === '/comptoir/reglages/' + id), 'Réglages › ' + id + ' has no step');
  }
});

test('no duplicate id across all the steps files, and every step is well formed', () => {
  const ids = new Set();
  for (const s of all) {
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id + ' (' + s.file + ')');
    ids.add(s.id);
    assert.ok(s.id && s.page && s.title && s.body, s.id);
    assert.match(s.page, /^\/comptoir(\/|$)/, s.id);
    assert.ok(Object.hasOwn(ROUTES, parts(s.page)[0] || 'x') || parts(s.page).length === 0, s.id + ': unknown page ' + s.page);
  }
  assert.ok(mine.length >= 60);
});

test('GUIDE-01b: every step\'s target is a data-guide mark (or the guide prop of a frame) of the Comptoir\'s source', () => {
  const marks = new Set(walk('web/src/comptoir').filter((f) => f.endsWith('.tsx')).flatMap((f) => [...read(f).matchAll(/(?:data-guide|\bguide)="([^"]+)"/g)].map((m) => m[1])));
  for (const s of mine) {
    assert.ok(s.target, s.id + ': a step of this package points at a part');
    assert.ok(marks.has(s.target), s.id + ': no data-guide="' + s.target + '" in web/src/comptoir');
  }
});

test('GUIDE-01b: nothing is marked and left unexplained', () => {
  const targets = new Set(mine.map((s) => s.target));
  const own = ['Relances.tsx', 'Rapports.tsx', 'Equipe.tsx', 'Catalogue.tsx', 'avis/ReviewsCard.tsx', 'Reglages.tsx'].map((f) => 'web/src/comptoir/pages/' + f);
  const regl = walk('web/src/comptoir/pages/reglages').filter((f) => f.endsWith('.tsx'));
  // marks that belong to another package's steps file
  const theirs = new Set(all.filter((s) => s.file !== 'GUIDE-01b.ts').map((s) => s.target));
  for (const f of [...own, ...regl]) for (const m of read(f).matchAll(/(?:data-guide|\bguide)="([^"]+)"/g)) assert.ok(targets.has(m[1]) || theirs.has(m[1]), f + ': data-guide="' + m[1] + '" has no step');
});

test('every body is two sentences at most, with « tu », and every title is short', () => {
  for (const s of mine) {
    assert.ok(s.body.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, s.id + ': two sentences at most');
    assert.ok(!/(?<!-)\b(vous|votre|vos)\b/i.test(s.title + ' ' + s.body), s.id + ': « tu », not « vous »');
    assert.ok(s.title.length >= 3 && s.title.length <= 45, s.id + ': title length ' + s.title.length);
  }
});

// who may open a page: the capability of its route, of its Réglages section, or of the tab (Relances, Équipe, Catalogue)
function need(page) {
  const [p, a, b] = parts(page);
  if (p === 'reglages') return !a || OPEN_SECTIONS.includes(a) ? null : SECTION_CAP[a] || 'settings';
  if (p === 'relances') return a === 'attente' ? 'agenda.own' : 'marketing';
  if (p === 'equipe') return a === ':id' ? 'team' : null;
  if (p === 'catalogue') return a === 'cartes' ? 'sale.all' : null;
  return ROUTES[p] || null;
}
const STAFF = (role) => ({ id: role, role, active: true });
// the base rights (permissions.js BASE) are what a tour may count on; the owner's toggles only add or remove a few
const SETTINGS = { team: { barberCheckout: true, barberAllAgenda: true } };

test('a step is never on a page that one of its roles cannot open; a barber\'s tour stays inside his base rights', () => {
  const roles = ['owner', 'manager', 'desk', 'barber'];
  for (const s of all) {
    const c = need(s.page);
    for (const r of s.roles || roles) {
      assert.ok(roles.includes(r) || r === 'client', s.id + ': unknown role ' + r);
      if (c) assert.ok(capsOf(STAFF(r), SETTINGS).has(c), s.id + ': ' + r + ' cannot open ' + s.page + ' (needs ' + c + ')');
    }
  }
  const barber = mine.filter((s) => (s.roles || []).includes('barber'));
  assert.ok(barber.length >= 15, 'the barber has a tour');
  for (const s of barber) assert.ok(!/^\/comptoir\/reglages\/(?!compte$)/.test(s.page), s.id + ': a barber has no Réglages section but Mon compte');
  // the desk's tour: Relances, Catalogue (cartes cadeaux), Mon compte; no figures page (it has no chair)
  assert.ok(mine.some((s) => parts(s.page)[0] === 'relances' && (s.roles || []).includes('desk')));
  assert.ok(!mine.some((s) => parts(s.page)[0] === 'rapports' && (s.roles || []).includes('desk')));
});

test('the owner-only parts say so: the sections that need the settings right are the owner\'s alone', () => {
  for (const s of mine) {
    const [p, id] = parts(s.page);
    if (p === 'reglages' && id && SECTION_CAP[id] === 'settings') assert.deepEqual(s.roles, ['owner'], s.id);
  }
});
