// GUIDE-01a: the guided tours. Every step of every steps file (Comptoir and /moi) points at a part its screens mark,
// ids are unique, bodies stay short; the order is a day at the salon; a barber's tour never shows what he cannot open;
// and where each person stands in the Comptoir's tour is his own prefs.tour, checked by the server.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { capsOf } from '../../server/domain/permissions.js';
import { prefsDefaults } from '../../server/projections/staffprefs.js';
import { COMPTOIR_PLACES, MOI_PLACES, TOUR_V, collect, plan, placeOf, matchPath, pageSteps, resumeAt, firstName, welcomeOf } from '../../web/src/ui/tour/order.ts';
import { SECTION_CAP, OPEN_SECTIONS } from '../../web/src/comptoir/pages/reglages/caps.ts';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const files = (dir, ext) => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(dir + '/' + e.name, ext) : e.name.endsWith(ext) ? [dir + '/' + e.name] : []));
/** data-guide="x", guide="x" (a kit frame's prop), and the names inside data-guide={cond ? 'x' : undefined} */
function marks(sources) {
  const out = new Set();
  for (const f of sources) {
    const src = read(f);
    for (const m of src.matchAll(/\b(?:data-)?guide="([\w.-]+)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/\bdata-guide=\{([^}]*)\}/g)) for (const q of m[1].matchAll(/'([\w.-]+)'/g)) out.add(q[1]);
  }
  return out;
}
async function load(dir) {
  const mods = {};
  for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.ts'))) mods[f] = await import(pathToFileURL(join(ROOT, dir, f)).href);
  return mods;
}

let COMPTOIR, MOI;
before(async () => {
  COMPTOIR = collect(await load('web/src/comptoir/guide/steps'));
  MOI = collect(await load('web/src/moi/guide/steps'));
});

test('every step of every steps file points at a part its screens mark', () => {
  const comptoir = marks(files('web/src/comptoir', '.tsx'));
  const moi = marks([...files('web/src/moi', '.tsx'), ...files('web/src/client', '.tsx'), ...files('public', '.html')]);
  assert.ok(COMPTOIR.length >= 60 && MOI.length >= 20, COMPTOIR.length + ' / ' + MOI.length + ' steps read');
  for (const s of COMPTOIR) if (s.target) assert.ok(comptoir.has(s.target), s.id + ': no data-guide="' + s.target + '" in web/src/comptoir');
  for (const s of MOI) if (s.target) assert.ok(moi.has(s.target), s.id + ': no data-guide="' + s.target + '" in the client screens');
  // this package's own steps all have a part, and every part it marked has its step
  const mine = collect({ a: { default: COMPTOIR.filter((s) => s.id && read('web/src/comptoir/guide/steps/GUIDE-01a.ts').includes("id: '" + s.id + "'")) } });
  assert.ok(mine.length >= 40 && mine.every((s) => s.target), 'GUIDE-01a steps: ' + mine.length);
  const targets = new Set(COMPTOIR.map((s) => s.target));
  for (const t of ['mer-head', 'mer-replay', 'mer-list', 'mer-features', 'ag-board', 'ag-week', 'cs-tabs', 'tk-methods', 'tk-validate', 'sales-list', 'cl-z', 'cl-months', 'cl-segs', 'file-head', 'file-history']) assert.ok(targets.has(t) && comptoir.has(t), t);
});

test('ids are unique, bodies are two short sentences at most, in « tu », with known roles', () => {
  const ROLES = new Set(['owner', 'manager', 'desk', 'barber', 'client']);
  for (const [name, list] of [['comptoir', COMPTOIR], ['moi', MOI]]) {
    const ids = new Set();
    for (const s of list) {
      assert.ok(!ids.has(s.id), name + ': duplicate step id ' + s.id);
      ids.add(s.id);
      assert.match(s.page, /^\//, s.id);
      assert.ok(s.title.trim() && s.title.length <= 60, s.id + ' title');
      const sentences = s.body.split(/(?<=[.!?…])\s+(?=[«A-ZÀ-Ý])/).filter(Boolean);
      assert.ok(sentences.length <= 2, s.id + ': ' + sentences.length + ' sentences');
      assert.ok(s.body.length <= 200, s.id + ': body too long (' + s.body.length + ')');
      assert.doesNotMatch(s.body, /(?<![-\p{L}])(vous|votre|vos)(?!\p{L})/iu, s.id + ' says « vous »');
      assert.ok(!s.roles || s.roles.every((r) => ROLES.has(r)), s.id + ' roles');
    }
  }
});

/* ---------------- who can open what: the shell's own rules, read from App.tsx ---------------- */

const APP = read('web/src/comptoir/App.tsx');
const ROUTE_CAP = Object.fromEntries([...APP.slice(APP.indexOf('const ROUTES'), APP.indexOf('};', APP.indexOf('const ROUTES'))).matchAll(/^\s+(\w+): \{ C: \w+, title: '[^']*'(?:, cap: '([^']+)')?/gm)].map((m) => [m[1], m[2] || null]));
const NAV = APP.slice(APP.indexOf('function useNav'), APP.indexOf('function Shell')).split('\n').filter((l) => /page: '\w+'/.test(l)).map((l) => ({ page: l.match(/page: '(\w+)'/)[1], cap: (l.match(/cap: '([^']+)'/) || [])[1] || null }));
/** App.tsx useCanOpen, for one person */
function opener(caps, chair) {
  const can = (c) => caps.has(c);
  const nav = NAV.filter((x) => (!x.cap || can(x.cap)) && !(x.page === 'rapports' && !chair && !can('report.shop')) && !(x.page === 'espace' && !chair));
  return (path) => {
    const [page = 'agenda', id] = path.split('?')[0].replace(/^\/comptoir/, '').split('/').filter(Boolean);
    if (!Object.hasOwn(ROUTE_CAP, page) || !nav.some((x) => x.page === page)) return false;
    const need = page === 'reglages' && id && !id.startsWith(':') ? (OPEN_SECTIONS.includes(id) ? null : SECTION_CAP[id] || null) : ROUTE_CAP[page];
    return !need || can(need);
  };
}

let rt, ids;
before(async () => {
  rt = await testRuntime();
  ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
});
const staffNamed = (n) => rt.engine.state.staff.get(ids[n]);
const planFor = (st) => plan(COMPTOIR, { places: COMPTOIR_PLACES, role: st.role, canOpen: opener(capsOf(st, rt.engine.state.settings), !!st.chair) });

test('the role filter: a barber never gets a step on a page he cannot open, nor one written for others', () => {
  assert.ok(ROUTE_CAP.caisse === 'sale.create' && NAV.length >= 8, 'App.tsx rules are read');
  const barber = staffNamed('JKut');
  const mine = planFor(barber);
  assert.ok(mine.length > 0, 'a barber has a tour');
  for (const s of mine) {
    assert.ok(!s.roles || s.roles.includes('barber'), s.id + ' is not for a barber');
    assert.doesNotMatch(s.place, /^\/comptoir\/(reglages\/(?!compte)|equipe|catalogue|relances|caisse\/cloture)/, s.id + ' on ' + s.place);
  }
  for (const id of ['mer.head', 'cloture.z', 'cloture.months', 'clients.abonnes-kpis', 'caisse.online']) assert.ok(!mine.some((s) => s.id === id), id + ' reaches a barber');
  // with the till opened to barbers, the Caisse joins his tour (Encaisser and the ticket), never the closing
  const withTill = plan(COMPTOIR, { places: COMPTOIR_PLACES, role: 'barber', canOpen: opener(capsOf(barber, { ...rt.engine.state.settings, team: { ...rt.engine.state.settings.team, barberCheckout: true } }), true) });
  assert.ok(withTill.some((s) => s.id === 'caisse.validate') && !withTill.some((s) => s.place === '/comptoir/caisse/cloture'));
  // the desk: Agenda, Caisse with its drawer, Clients; no Mise en route, no Z figures of the owner
  const desk = planFor(staffNamed('Inès'));
  assert.ok(desk.some((s) => s.id === 'cloture.drawer') && !desk.some((s) => s.id === 'cloture.z' || s.id === 'mer.head'));
  assert.ok(desk.every((s) => !s.roles || s.roles.includes('desk')));
});

test('the owner’s tour follows a day at the salon: Mise en route, Agenda, Caisse, Clients, then the rest, Réglages last', () => {
  const owner = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const all = planFor(owner);
  assert.equal(all[0].id, 'mer.head', 'it starts with Mise en route');
  const pages = [...new Set(all.map((s) => s.place.split('?')[0].replace(/^\/comptoir\//, '').split('/')[0]))];
  const order = ['reglages', 'pilotage', 'espace', 'agenda', 'caisse', 'clients', 'relances', 'rapports', 'equipe', 'catalogue'];
  // Mise en route first, Réglages' other sections last: the page ranks never go back
  const ranks = all.map((s) => placeOf(s, COMPTOIR_PLACES).rank);
  assert.ok(ranks.every((r, i) => !i || r >= ranks[i - 1]), 'places in order');
  const seen = pages.filter((p) => p !== 'reglages');
  assert.deepEqual(seen, order.filter((p) => seen.includes(p)), 'the pages in the spec’s order: ' + pages.join(' › '));
  assert.ok(all.at(-1).place.startsWith('/comptoir/reglages/'), 'Réglages last');
  // inside a place, `order` first; the Caisse: Encaisser, the ticket, Ventes du jour, Caisse & clôture
  const caisse = [...new Set(all.filter((s) => s.place.startsWith('/comptoir/caisse')).map((s) => s.place))];
  assert.deepEqual(caisse, ['/comptoir/caisse', '/comptoir/caisse?rdv=:rdv', '/comptoir/caisse/ventes', '/comptoir/caisse/cloture']);
  const agenda = all.filter((s) => s.place === '/comptoir/agenda').map((s) => s.order ?? 100);
  assert.deepEqual(agenda, [...agenda].sort((a, b) => a - b));
  // a part that only lives in a view of its page is shown there: the file, the ticket, the Abonnés segment, the week
  const at = (id) => all.find((s) => s.id === id).place;
  assert.equal(at('clients.file-chips'), '/comptoir/clients/:id');
  assert.equal(at('clients.notes-coupe'), '/comptoir/clients/:id');
  assert.equal(at('caisse.reward'), '/comptoir/caisse?rdv=:rdv');
  assert.equal(at('clients.abonnes-list'), '/comptoir/clients?segment=abonnes');
  assert.equal(at('agenda.week'), '/comptoir/agenda?vue=semaine');
  // the page's « ? » replays that page's places only
  assert.ok(pageSteps(all, '/comptoir/caisse').every((s) => s.place.startsWith('/comptoir/caisse') && !s.place.startsWith('/comptoir/caisse/')));
  assert.ok(pageSteps(all, '/comptoir/clients/cl_42').every((s) => s.place === '/comptoir/clients/:id'));
  assert.equal(resumeAt(all, 'caisse.free'), all.findIndex((s) => s.id === 'caisse.free'));
  assert.equal(resumeAt(all, 'gone'), 0);
});

test('places: listed order, unlisted pages after their parent, and /moi keeps its signed-in steps', () => {
  assert.deepEqual(COMPTOIR_PLACES.slice(0, 4).map((p) => p.path), ['/comptoir/reglages/mise-en-route', '/comptoir/pilotage', '/comptoir/espace', '/comptoir/agenda']);
  assert.ok(matchPath('/comptoir/clients/:id', '/comptoir/clients/abc') && !matchPath('/comptoir/clients/:id', '/comptoir/clients'));
  assert.ok(matchPath('/comptoir/caisse?rdv=:rdv', '/comptoir/caisse'));
  // a Réglages section the list does not know plays after the listed ones, a Caisse tab after the Caisse's
  const P = COMPTOIR_PLACES;
  const last = (pre) => Math.max(...P.map((p, i) => (p.path.split('?')[0] === pre || p.path.startsWith(pre + '/') ? i : -1)));
  assert.equal(placeOf({ id: 'x', page: '/comptoir/reglages/nouveau', title: 'x', body: 'x' }, P).rank, last('/comptoir/reglages') + 0.5);
  assert.equal(placeOf({ id: 'x', page: '/comptoir/caisse/autre', title: 'x', body: 'x' }, P).rank, last('/comptoir/caisse') + 0.5);
  assert.equal(placeOf({ id: 'x', page: '/ailleurs', title: 'x', body: 'x' }, P).rank, P.length);
  const moi = plan(MOI, { places: MOI_PLACES, role: 'client', keep: (s) => /^\/moi(\/|$)/.test(s.page) && !(s.target || '').startsWith('moi.signin') });
  assert.ok(moi.length >= 10 && moi.every((s) => s.place.startsWith('/moi') && !s.target.startsWith('moi.signin')));
  assert.deepEqual([...new Set(moi.map((s) => s.place))], ['/moi', '/moi/historique', '/moi/profil']);
  // a staff role never gets the client's steps
  assert.equal(plan(MOI, { places: MOI_PLACES, role: 'owner' }).length, 0);
  assert.equal(firstName('Le Soldat'), 'Le Soldat');
  assert.equal(firstName('JKut'), 'JKut');
  assert.match(welcomeOf('barber', 'Frank', 12).title, /^Bienvenue dans ton Comptoir, Frank\. On fait le tour/);
  assert.match(welcomeOf('owner', '', 82).line, /82 étapes, environ 14 min\.$/);
});

/* ---------------- prefs.tour: his own, checked, stored ---------------- */

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function onTablet(name) {
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  const r = await b.post('/api/auth/pin', { staffId: ids[name], pin: DEMO.pins[name] });
  assert.equal(r.status, 200, r.text);
  return b;
}

test('prefs.tour: validated, stored for the person only, written once', async () => {
  const o = await owner();
  const me0 = (await o.get('/api/v1/bootstrap')).json.me;
  assert.deepEqual(me0.prefs.tour, { v: 0, at: '', done: false }, 'never seen: the welcome shows');
  assert.deepEqual(prefsDefaults('barber').tour, { v: 0, at: '', done: false });
  const r = await o.patch('/api/v1/prefs', { tour: { v: TOUR_V, at: 'caisse.free', done: false } });
  assert.equal(r.status, 200, r.text);
  const ev = rt.engine.journal.at(-1);
  assert.equal(ev.type, 'prefs.set');
  assert.deepEqual(ev.data, { staffId: me0.id, prefs: { tour: { v: TOUR_V, at: 'caisse.free', done: false } } });
  assert.deepEqual((await o.get('/api/v1/bootstrap')).json.me.prefs.tour, { v: TOUR_V, at: 'caisse.free', done: false });
  // the same again writes nothing
  const n = rt.engine.state.version;
  assert.equal((await o.patch('/api/v1/prefs', { tour: { v: TOUR_V, at: 'caisse.free', done: false } })).status, 200);
  assert.equal(rt.engine.state.version, n);
  // malformed: refused whole
  for (const tour of [{ v: -1, at: '', done: false }, { v: 1, at: '<b>', done: false }, { v: 1, at: '', done: 'yes' }, { v: 1, done: true }, { v: 1, at: 'x'.repeat(81), done: false }]) {
    assert.equal((await o.patch('/api/v1/prefs', { tour })).status, 400, JSON.stringify(tour));
  }
  // someone else's tour is untouched by the owner's, and his own is his
  const jk = await onTablet('JKut');
  assert.deepEqual((await jk.get('/api/v1/bootstrap')).json.me.prefs.tour, { v: 0, at: '', done: false });
  assert.equal((await jk.patch('/api/v1/prefs', { tour: { v: TOUR_V, at: '', done: true } })).status, 200);
  assert.deepEqual((await jk.get('/api/v1/bootstrap')).json.me.prefs.tour, { v: TOUR_V, at: '', done: true });
  assert.deepEqual((await o.get('/api/v1/bootstrap')).json.me.prefs.tour, { v: TOUR_V, at: 'caisse.free', done: false });
});
