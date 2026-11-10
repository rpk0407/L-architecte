// WP5 · The Accueil's pure parts: what a card's button does (actions.ts), the usage counted on the device (usage.ts),
// how the page writes hours, facts and chairs (format.ts), the rules of the local copy (snapshot.ts), and where
// /comptoir opens (home.ts). The page itself is a view over GET /api/v1/home (tests/unit/home.test.js, tests/api/home.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stepOf, fold, MAX_CARDS, moved, hiddenAfter, blocksOf, ALL_BLOCKS, BLOCK_NAME, CARD_NAME, GROUP_LABEL, nameOf, isEstimate, shownAmount, BLOCKS_KEY } from '../../web/src/comptoir/pages/accueil/actions.ts';
import { USAGE_KEY, USAGE_DAYS, LATER_ASK, prune, readUsage, writeUsage, done, later, keep, isLater, toAsk } from '../../web/src/comptoir/pages/accueil/usage.ts';
import { hm, readAt, dayOf, factText, splitLabel, chairText, allShut, freeNow, firstTake, statusWord } from '../../web/src/comptoir/pages/accueil/format.ts';
import { SNAP_KEY, readSnap, writeSnap, clearSnap } from '../../web/src/comptoir/pages/accueil/snapshot.ts';
import { homeOf } from '../../web/src/comptoir/home.ts';
import { CARD_IDS, home } from '../../server/domain/home.js';
import { at } from '../helpers.js';
import { testRuntime } from '../api/client.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, 'utf8');
const NB = ' ';
/** a Storage that counts its writes */
const mem = (init = {}) => { const m = new Map(Object.entries(init)); const log = []; return { log, m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { log.push(['set', k]); m.set(k, String(v)); }, removeItem: (k) => { log.push(['del', k]); m.delete(k); } }; };
const broken = { getItem() { throw new Error('private mode'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('private mode'); } };
const DAY = 86400000;

/* ---------------- actions.ts ---------------- */

test('actions: go navigates, bulk navigates to its list, a sheet opens the plan or the page that holds its form', () => {
  assert.deepEqual(stepOf({ id: 'z', action: { kind: 'go', label: 'Faire le Z', to: '/caisse/cloture' } }), { kind: 'go', to: '/caisse/cloture' });
  assert.deepEqual(stepOf({ id: 'relances', action: { kind: 'bulk', label: 'Aperçu et envoi', to: '/relances' } }), { kind: 'go', to: '/relances?apercu=1' });
  assert.deepEqual(stepOf({ id: 'orphelins', action: { kind: 'sheet', label: 'Replacer', ref: 'to_1' } }), { kind: 'handover', id: 'to_1' });
  // a request still waiting is not a posted absence: it is answered in Équipe (Valider / Refuser, then the plan)
  assert.deepEqual(stepOf({ id: 'absence-demande', action: { kind: 'sheet', label: 'Voir et valider', ref: 'rq_1' } }), { kind: 'go', to: '/equipe' });
  assert.deepEqual(stepOf({ id: 'objectif', action: { kind: 'sheet', label: 'Fixer l’objectif', ref: 'objectif' } }), { kind: 'go', to: '/reglages/objectifs' });
  // an action without an address never leaves the person nowhere
  assert.deepEqual(stepOf({ id: 'stock', action: { kind: 'go', label: 'Voir' } }), { kind: 'go', to: '/agenda' });
});

test('actions: every card the server can send has a name, and every group a label', () => {
  assert.deepEqual(Object.keys(CARD_NAME).sort(), [...CARD_IDS].sort());
  for (const id of CARD_IDS) assert.ok(nameOf(id).length > 3 && nameOf(id) !== id, id);
  assert.equal(nameOf('inconnue'), 'inconnue');
  assert.deepEqual(Object.keys(GROUP_LABEL), ['bloque', 'attend', 'rapporte', 'entretien']);
  assert.ok(isEstimate('relances') && !isEstimate('encaisser'));
  assert.equal(shownAmount('relances', 42717), 42700, 'an estimate is written to the euro');
  assert.equal(shownAmount('encaisser', 10050), 10050, 'a sum of tickets is written as sent');
});

test('actions: five cards in sight, the rest folded', () => {
  assert.equal(MAX_CARDS, 5);
  const seven = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(fold(seven), { shown: [1, 2, 3, 4, 5], folded: [6, 7] });
  assert.deepEqual(fold([1, 2]), { shown: [1, 2], folded: [] });
  assert.deepEqual(fold([]), { shown: [], folded: [] });
});

test('actions: a card only changes place inside its group; hiding and showing keep the list clean', () => {
  const cards = [{ id: 'encaisser', group: 'bloque' }, { id: 'z', group: 'bloque' }, { id: 'relances', group: 'rapporte' }, { id: 'echecs', group: 'entretien' }, { id: 'stock', group: 'entretien' }];
  assert.deepEqual(moved(cards, 1, -1), ['z', 'encaisser', 'relances', 'echecs', 'stock']);
  assert.deepEqual(moved(cards, 3, 1), ['encaisser', 'z', 'relances', 'stock', 'echecs']);
  assert.equal(moved(cards, 0, -1), null, 'first card');
  assert.equal(moved(cards, 4, 1), null, 'last card');
  assert.equal(moved(cards, 1, 1), null, 'the next card is of another group: the server would put it back');
  assert.equal(moved(cards, 2, -1), null);
  assert.deepEqual(hiddenAfter(['stock'], 'purge', false), ['stock', 'purge']);
  assert.deepEqual(hiddenAfter(['stock', 'purge'], 'stock', true), ['purge']);
  assert.deepEqual(hiddenAfter(['stock'], 'stock', false), ['stock'], 'never twice');
});

test('actions: the blocks are on by default, whatever the device kept', () => {
  assert.deepEqual(blocksOf(null), ALL_BLOCKS);
  assert.deepEqual(blocksOf('x'), ALL_BLOCKS);
  assert.deepEqual(blocksOf({ fauteuils: false, autre: 1 }), { prochain: true, fauteuils: false, jour: true });
  assert.deepEqual(Object.keys(BLOCK_NAME), ['prochain', 'fauteuils', 'jour']);
  assert.equal(BLOCKS_KEY, 'lx-accueil-blocs');
});

/* ---------------- usage.ts ---------------- */

test('usage: counted per card over 30 days, on the device only', () => {
  const now = at('2026-11-10', 15, 10);
  assert.equal(USAGE_KEY, 'lx-accueil-usage');
  assert.equal(USAGE_DAYS, 30);
  let u = done({}, 'stock', now);
  u = later(u, 'stock', now + 1000, '2026-11-10');
  assert.deepEqual(u, { stock: { d: [now], l: [now + 1000], on: '2026-11-10' } });
  // « Plus tard » hides for the salon's day it was pressed on, not after
  assert.ok(isLater(u, 'stock', '2026-11-10'));
  assert.ok(!isLater(u, 'stock', '2026-11-11'));
  assert.ok(!isLater(u, 'relances', '2026-11-10'));
  // older than 30 days: gone; a stamp from the future (a clock set back) too; an emptied card is dropped
  const old = { stock: { d: [now - 31 * DAY, now - 29 * DAY], l: [now + DAY], on: '2026-10-01' }, purge: { d: [now - 40 * DAY], l: [] }, bad: { d: 'x', l: [null, 'y'] } };
  assert.deepEqual(prune(old, now), { stock: { d: [now - 29 * DAY], l: [] } });
});

test('usage: it proposes, never decides: the question comes at the fifth « Plus tard », only for a card that may be hidden', () => {
  const now = at('2026-11-10', 9, 0);
  let u = {};
  for (let i = LATER_ASK - 1; i > 0; i--) u = later(u, 'stock', now - i * DAY, '2026-11-10');   // one a day, oldest first
  const cards = [{ id: 'z', canHide: false }, { id: 'stock', canHide: true }, { id: 'relances', canHide: true }];
  assert.equal(toAsk(u, cards), null, 'four times: nothing is asked');
  u = later(u, 'stock', now, '2026-11-10');
  assert.equal(toAsk(u, cards), 'stock');
  // a card that commits the salon is never proposed, however often it is put off; a card not on screen neither
  let z = {};
  for (let i = 9; i > 0; i--) z = later(z, 'z', now - i * 1000, '2026-11-10');
  assert.equal(toAsk(z, cards), null);
  assert.equal(toAsk(u, [{ id: 'relances', canHide: true }]), null);
  // the most put off first
  let two = u;
  for (let i = 0; i < 7; i++) two = later(two, 'relances', now + i * 1000, '2026-11-10');
  assert.equal(toAsk(two, cards), 'relances');
  // « Garder »: not asked again until five more; today's « Plus tard » still holds
  const kept = keep(u, 'stock');
  assert.equal(toAsk(kept, cards), null);
  assert.ok(isLater(kept, 'stock', '2026-11-10'));
  assert.deepEqual(keep({}, 'stock'), {});
});

test('usage: read and written through the storage it is given; a private window keeps nothing and breaks nothing', () => {
  const now = at('2026-11-10', 9, 0);
  const s = mem();
  writeUsage(s, later({}, 'stock', now, '2026-11-10'));
  assert.deepEqual(s.log, [['set', USAGE_KEY]]);
  assert.deepEqual(readUsage(s, now), { stock: { d: [], l: [now], on: '2026-11-10' } });
  assert.deepEqual(readUsage(s, now + 31 * DAY), {}, 'pruned at read');
  assert.deepEqual(readUsage(mem({ [USAGE_KEY]: '[1,2]' }), now), {});
  assert.deepEqual(readUsage(mem({ [USAGE_KEY]: 'not json' }), now), {});
  assert.deepEqual(readUsage(broken, now), {});
  assert.deepEqual(readUsage(null, now), {});
  assert.doesNotThrow(() => writeUsage(broken, {}));
});

/* ---------------- format.ts ---------------- */

test('format: hours in the site\'s format, « lu à » on the salon\'s clock', () => {
  assert.equal(hm(870), '14' + NB + 'h' + NB + '30');
  assert.equal(hm(540), '9' + NB + 'h');
  assert.equal(readAt(at('2026-11-10', 15, 10)), 'lu à 15' + NB + 'h' + NB + '10');
  assert.equal(readAt(at('2026-11-10', 7, 5)), 'lu à 7' + NB + 'h' + NB + '05');
  assert.equal(dayOf(at('2026-11-10', 23, 50)), '2026-11-10');
});

test('format: a fact is written as sent (euros, minutes, percent, a count), nothing is worked out', () => {
  assert.deepEqual(factText({ k: 'prevus', label: 'prévus', v: 118800, unit: 'eur' }), { value: '1 188' + NB + '€', label: 'prévus', money: true });
  assert.deepEqual(factText({ k: 'libres', label: 'libres', v: 720, unit: 'min' }), { value: '12' + NB + 'h', label: 'libres', money: false });
  assert.deepEqual(factText({ k: 'libres', label: 'libres', v: 90, unit: 'min' }), { value: '1' + NB + 'h' + NB + '30', label: 'libres', money: false });
  assert.deepEqual(factText({ k: 'objectif', label: 'de l’objectif', v: 62, unit: 'pct' }), { value: '62' + NB + '%', label: 'de l’objectif', money: false });
  assert.deepEqual(factText({ k: 'rdv', label: 'rendez-vous', v: 44 }), { value: '44', label: 'rendez-vous', money: false });
  assert.deepEqual(splitLabel({ label: 'Mardi 10 novembre · ouverture à 9 h' }), { day: 'Mardi 10 novembre', when: 'ouverture à 9 h' });
  assert.deepEqual(splitLabel({ label: 'Dimanche 15 novembre' }), { day: 'Dimanche 15 novembre', when: '' });
});

test('format: a chair in plain words, for each state the server can send', () => {
  const t = (state, until, freeMin = 0) => chairText({ state, until, freeMin }).replaceAll(NB, ' ');
  assert.equal(t('libre', 930, 30), 'Libre 30 min, jusqu’à 15 h 30');
  assert.equal(t('libre', 1110, 150), 'Libre 2 h 30, jusqu’à 18 h 30');
  assert.equal(t('libre', null, 0), 'Libre');
  assert.equal(t('occupe', 900), 'Occupé jusqu’à 15 h');
  assert.equal(t('occupe', null), 'Occupé', 'a client still in the chair after his slot: nobody knows until when');
  assert.equal(t('absent', null), 'Absent');
  assert.equal(t('absent', 840), 'Absent, retour à 14 h');
  assert.equal(t('ferme', null), 'Fermé');
  assert.equal(t('ferme', 540), 'Fermé, ouvre à 9 h');
});

test('format: one row for a salon shut everywhere the same way; who is free; the prestation a walk-in starts on', () => {
  const shut = [{ state: 'ferme', until: 540 }, { state: 'ferme', until: 540 }];
  assert.ok(allShut(shut));
  assert.ok(!allShut([shut[0]]), 'a barber\'s single row stays his own');
  assert.ok(!allShut([{ state: 'ferme', until: 540 }, { state: 'ferme', until: 600 }]));
  assert.ok(!allShut([{ state: 'ferme', until: null }, { state: 'absent', until: null }]));
  assert.deepEqual(freeNow([{ staffId: 'a', state: 'occupe' }, { staffId: 'b', state: 'libre' }, { staffId: 'c', state: 'ferme' }]), ['b']);
  const chair = { canTake: [{ serviceId: 'sv_barbe', short: 'Barbe' }, { serviceId: 'sv_cl', short: 'Coupe' }] };
  assert.equal(firstTake(chair, 'sv_cl'), 'sv_cl', 'the usual one when he can take it');
  assert.equal(firstTake(chair, 'sv_long'), 'sv_barbe', 'else the first he can take');
  assert.equal(firstTake({ canTake: [] }, 'sv_cl'), undefined);
  assert.equal(statusWord({ status: 'booked' }), '');
  assert.equal(statusWord({ status: 'arrived' }), 'Arrivé');
  assert.equal(statusWord({ status: 'in_chair' }), 'Au fauteuil');
  assert.equal(statusWord({ status: 'pending' }), 'Acompte en attente');
});

/* ---------------- snapshot.ts ---------------- */

let rt, real;
test('snapshot: a real answer of the server is kept and read back whole', async () => {
  rt = await testRuntime({ clock: () => at('2026-11-10', 15, 10) });
  const owner = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  real = JSON.parse(JSON.stringify(home(rt.engine.state, owner, at('2026-11-10', 15, 10))));
  const s = mem();
  assert.equal(SNAP_KEY, 'lx-home');
  assert.equal(writeSnap(s, 'st_owner', real, false), true);
  assert.deepEqual(readSnap(s, 'st_owner'), real);
  assert.deepEqual(s.log, [['set', SNAP_KEY]], 'reading one\'s own copy writes nothing');
});

test('snapshot: never written on a shared salon screen, and a copy left there goes', () => {
  const s = mem();
  assert.equal(writeSnap(s, 'st_a', real, true), false);
  assert.equal(s.m.size, 0);
  assert.ok(!s.log.some(([op]) => op === 'set'), 'no write at all');
  // the device was someone's own phone, then became the salon's tablet: the old copy does not stay
  const t = mem();
  writeSnap(t, 'st_a', real, false);
  writeSnap(t, 'st_a', real, true);
  assert.equal(t.getItem(SNAP_KEY), null);
  assert.equal(readSnap(t, 'st_a'), null);
});

test('snapshot: one person\'s copy is never shown to another, and it goes at sign-out', () => {
  const s = mem();
  writeSnap(s, 'st_a', real, false);
  assert.equal(readSnap(s, 'st_b'), null);
  assert.equal(s.getItem(SNAP_KEY), null, 'someone else\'s copy is removed, not kept aside');
  writeSnap(s, 'st_a', real, false);
  clearSnap(s);
  assert.equal(readSnap(s, 'st_a'), null);
  // the shell calls home.ts forgetHome on both ways out (the menu, a session the server ended), on the same key
  const src = read('web/src/comptoir/home.ts');
  assert.match(src, /export function forgetHome\(\) \{\s*try \{ localStorage\.removeItem\('lx-home'\); \}/);
  assert.match(read('web/src/comptoir/App.tsx'), /onOut=\{\(\) => \{ forgetHome\(\);/);
  // both ways out end in the shell's onOut: the menu's « Se déconnecter » / « Verrouiller », and a 401 from the server
  const state = read('web/src/comptoir/state.tsx');
  assert.ok(/const signOut = useCallback\(async \(\) => \{.*onOutRef\.current\(\); \}/.test(state), 'signOut ends in onOut');
  assert.ok(/onSignedOut\(\(e\) => \{\s*forget\(\); onOutRef\.current\(\);/.test(state), 'a session ended by the server ends in onOut');
});

test('snapshot: an unreadable or older copy shows nothing; a private window breaks nothing', () => {
  for (const raw of ['not json', '{}', 'null', JSON.stringify({ who: 'st_a' }), JSON.stringify({ who: 'st_a', home: { asOf: 1 } }), JSON.stringify({ who: 'st_a', home: { ...real, cards: null } })]) {
    const s = mem({ [SNAP_KEY]: raw });
    assert.equal(readSnap(s, 'st_a'), null, raw.slice(0, 30));
  }
  assert.equal(readSnap(null, 'st_a'), null);
  assert.equal(readSnap(broken, 'st_a'), null);
  assert.equal(writeSnap(broken, 'st_a', real, false), false);
  assert.equal(writeSnap(null, 'st_a', real, false), false);
  assert.doesNotThrow(() => clearSnap(broken));
  assert.doesNotThrow(() => clearSnap(null));
});

test('the page asks the server once and works nothing out: one read, no clock of the device in what it shows', () => {
  const page = read('web/src/comptoir/pages/Accueil.tsx');
  assert.equal((page.match(/useQuery</g) || []).length, 1);
  assert.match(page, /useQuery<Home>\(KEY\)/);
  assert.match(page, /const KEY = '\/api\/v1\/home';/);
  for (const f of ['Accueil.tsx', 'accueil/Card.tsx', 'accueil/format.ts']) {
    const src = read('web/src/comptoir/pages/' + f);
    assert.ok(!/api\.get\(/.test(src), f + ': no read of its own');
    assert.ok(!/\.reduce\(/.test(src), f + ': no sum made in the browser');
  }
  // the device's clock only dates the usage counters, never a figure on screen
  assert.ok(!/new Date\(|Date\.now\(\)/.test(read('web/src/comptoir/pages/accueil/format.ts')));
});

/* ---------------- home.ts ---------------- */

test('home: /comptoir opens the Accueil for every role; a chosen page wins; a build without it keeps the old homes', () => {
  const all = ['accueil', 'pilotage', 'espace', 'agenda', 'caisse'];
  const me = (role, chair, home) => ({ role, chair, prefs: home ? { home } : undefined });
  for (const [role, chair] of [['owner', false], ['owner', true], ['manager', true], ['desk', false], ['barber', true]]) assert.equal(homeOf(me(role, chair), all), 'accueil', role);
  assert.equal(homeOf(me('owner', false, 'auto'), all), 'accueil');
  assert.equal(homeOf(me('owner', false, 'pilotage'), all), 'pilotage');
  assert.equal(homeOf(me('barber', true, 'espace'), all), 'espace');
  assert.equal(homeOf(me('barber', true, 'pilotage'), ['accueil', 'espace', 'agenda']), 'accueil', 'a chosen page he cannot open');
  const old = ['pilotage', 'espace', 'agenda'];
  assert.equal(homeOf(me('owner', false), old), 'pilotage');
  assert.equal(homeOf(me('barber', true), old), 'espace');
  assert.equal(homeOf(me('desk', false), old), 'agenda');
  assert.equal(homeOf(me('barber', true), ['agenda']), 'agenda');
});
