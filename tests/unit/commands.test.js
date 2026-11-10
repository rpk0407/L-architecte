// WP7 · La barre de commande: one table, the right capability on every entry, the words that find a section, and a
// barber who sees nothing of the owner's. Reads web/src/comptoir/commands.ts, the file Palette.tsx shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, SECTION_IDS, allowed, search, score, norm, pushRecent, recentEntries, RECENTS_MAX } from '../../web/src/comptoir/commands.ts';
import { SECTION_CAP, OPEN_SECTIONS, sectionCap } from '../../web/src/comptoir/pages/reglages/caps.ts';
import { navShows } from '../../web/src/comptoir/access.ts';
import { capsOf } from '../../server/domain/permissions.js';

const RULES = { SECTION_CAP, OPEN_SECTIONS, sectionCap, navShows };
const ENTRIES = buildEntries(RULES);
const who = (role, settings = {}) => { const caps = capsOf({ role, active: true }, settings); return { can: (c) => caps.has(c), caps }; };
const forRole = (role, chair = true, settings = {}) => { const p = who(role, settings); return allowed(RULES, ENTRIES, p.can, chair); };
const ids = (l) => l.map((e) => e.id);
const calls = () => { const log = []; return { log, ctx: { go: (to) => log.push(['go', to]), toggleMask: () => log.push(['mask']), toggleTheme: () => log.push(['theme']), tour: () => log.push(['tour']) } }; };

test('ids are unique and every entry has plain French words', () => {
  assert.equal(new Set(ENTRIES.map((e) => e.id)).size, ENTRIES.length);
  for (const e of ENTRIES) { assert.ok(e.label.length > 2 && e.icon && typeof e.run === 'function', e.id); assert.ok(Array.isArray(e.mots), e.id); }
});

test('the commands of 3.7 are all there', () => {
  const labels = ENTRIES.filter((e) => e.group === 'Actions').map((e) => norm(e.label)).join('|');
  for (const w of ['absence', 'relancer les habitues', 'faire le z', 'objectif', 'exports du mois', 'nouveau rendez-vous', 'vente libre', 'montants', 'theme', 'revoir la visite']) assert.ok(labels.includes(w), w);
});

test('every Réglages section is there once, with the capability of caps.ts', () => {
  const sections = ENTRIES.filter((e) => e.group === 'Réglages');
  assert.equal(sections.length, 16);
  assert.deepEqual([...SECTION_IDS].sort(), [...Object.keys(SECTION_CAP), ...OPEN_SECTIONS].sort());
  assert.equal(ENTRIES.filter((e) => e.group === 'Pages' && e.page === 'reglages').length, 1);
  for (const id of SECTION_IDS) {
    const e = sections.find((x) => x.id === 's-' + id);
    assert.ok(e, id);
    assert.equal(e.cap, sectionCap(id), id);
    const c = calls(); e.run(c.ctx); assert.deepEqual(c.log, [['go', '/reglages/' + id]]);
  }
});

test('each command has a capability that matches the page it opens', () => {
  const need = { absence: 'agenda.own', relancer: 'marketing', z: 'closure', objectif: sectionCap('objectifs'), exports: 'report.shop', sale: 'sale.create', new: 'agenda.own', walk: 'agenda.own' };
  for (const [id, cap] of Object.entries(need)) assert.equal(ENTRIES.find((e) => e.id === id).cap, cap, id);
  for (const id of ['mask', 'theme', 'tour']) assert.equal(ENTRIES.find((e) => e.id === id).cap, undefined, id);
  const dest = (e) => { const c = calls(); e.run(c.ctx); return c.log[0]?.[1]; };
  // whoever is offered a command can open the page it goes to (menu rule, page capability, section capability)
  const pageOf = Object.fromEntries(ENTRIES.filter((e) => e.page).map((e) => [e.page, e]));
  for (const role of ['owner', 'manager', 'desk', 'barber']) {
    const p = who(role);
    for (const e of allowed(RULES, ENTRIES, p.can, true).filter((x) => x.group === 'Actions')) {
      const to = dest(e); if (!to) continue;
      const [page, sub] = to.split('?')[0].split('/').filter(Boolean);
      const pe = pageOf[page || 'agenda'];
      assert.ok(pe && allowed(RULES, ENTRIES, p.can, true).includes(pe), `${role}: ${e.id} opens ${to}`);
      if (page === 'reglages' && sub) assert.ok(!sectionCap(sub) || p.can(sectionCap(sub)), `${role}: ${e.id} section ${sub}`);
    }
  }
  // Réglages: a command that opens a section asks the section's right
  assert.equal(ENTRIES.find((e) => e.id === 'objectif').cap, SECTION_CAP.objectifs);
});

test('« acompte » finds Réservation en ligne first; « tva » finds Comptabilité', () => {
  const owner = forRole('owner');
  assert.equal(search(owner, 'acompte')[0].id, 's-reservation');
  assert.equal(search(owner, 'tva')[0].id, 's-compta');
  assert.equal(search(owner, 'ACOMPTES')[0].id, 's-reservation');
  assert.equal(search(owner, 'equipe').some((e) => e.id === 'p-equipe'), true);
});

test('« rel » then Entrée opens Relances', () => {
  for (const role of ['owner', 'manager', 'desk']) {
    const first = search(forRole(role), 'rel')[0];
    assert.ok(first, role);
    const c = calls(); first.run(c.ctx);
    assert.deepEqual(c.log, [['go', '/relances']], role);
  }
});

test('a barber sees none of the owner\'s commands, pages or sections', () => {
  const barber = forRole('barber');
  const got = ids(barber);
  for (const id of ['relancer', 'z', 'objectif', 'exports', 'p-pilotage', 'p-relances', 's-reservation', 's-compta', 's-equipe', 's-journal', 's-appareils', 's-donnees', 'p-equipe', 'p-catalogue']) assert.ok(!got.includes(id), id);
  assert.ok(got.includes('absence') && got.includes('new') && got.includes('s-compte') && got.includes('theme'));
  assert.equal(search(barber, 'acompte').length, 0);
  assert.equal(search(barber, 'relancer').length, 0);
});

test('no entry is offered without its right, for every role', () => {
  for (const role of ['owner', 'manager', 'desk', 'barber']) {
    const p = who(role);
    for (const e of allowed(RULES, ENTRIES, p.can, true)) assert.ok(!e.cap || p.can(e.cap), role + ' ' + e.id);
  }
  assert.ok(ids(forRole('owner')).includes('s-journal'));
  assert.ok(!ids(forRole('manager')).includes('s-appareils'));
});

test('the desk (no chair) has no Mon espace and no page of zeros', () => {
  const d = ids(forRole('desk', false));
  assert.ok(!d.includes('p-espace') && !d.includes('p-rapports'));
});

test('words match without accents or capitals; every typed word must match', () => {
  assert.equal(norm('Réservation  EN ligne'), 'reservation en ligne');
  assert.equal(norm('Journal d’activité'), 'journal d activite');
  const owner = forRole('owner');
  assert.ok(score(owner.find((e) => e.id === 'z'), 'z') > 0);
  assert.equal(search(owner, 'xyzzy').length, 0);
  assert.equal(search(owner, 'objectif mois')[0].id, 'objectif');
});

test('recents: five, newest first, each once', () => {
  let r = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) r = pushRecent(r, id);
  assert.deepEqual(r, ['f', 'e', 'd', 'c', 'b']);
  assert.equal(r.length, RECENTS_MAX);
  assert.deepEqual(pushRecent(r, 'd'), ['d', 'f', 'e', 'c', 'b']);
  const owner = forRole('owner');
  assert.deepEqual(ids(recentEntries(['z', 'gone', 'new'], owner)), ['z', 'new']);
  const b = forRole('barber');
  assert.deepEqual(ids(recentEntries(['z', 'new'], b)), ['new']);
});

test('the shell commands call the shell, not an address', () => {
  for (const [id, call] of [['mask', 'mask'], ['theme', 'theme'], ['tour', 'tour']]) {
    const c = calls(); ENTRIES.find((e) => e.id === id).run(c.ctx); assert.deepEqual(c.log, [[call]]);
  }
});
