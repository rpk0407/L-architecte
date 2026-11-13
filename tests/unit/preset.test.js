// The preset « L’Architecte »: the real salon put in place in one confirmed step (server/presets/architecte.js,
// commands/setup.js, http/routes-preset.js). What it creates, that a second run changes nothing, that it never
// overwrites the owner's own choices, who may run it, that the old site's names map to it without a choice, and the
// first code of a brand-new barber. No client of the real salon appears here: the bookings below are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { instantOf, localParts, weekday } from '../../shared/dates.js';
import { capsOf } from '../../server/domain/permissions.js';
import { DEVICE_COOKIE } from '../../server/auth/session.js';
import { freeSlots, staffIntervals } from '../../server/domain/availability.js';
import { ARCHITECTE } from '../../server/presets/architecte.js';
import { presetPlan, applyPreset, PRESET_PARTS } from '../../server/commands/setup.js';
import { addService } from '../../server/commands/catalog.js';
import { addStaff, updateStaff } from '../../server/commands/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { salon, rejects } from '../helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';

const TUE = '2026-11-17';
const OWNER = { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' };

/** An empty production salon whose owner has just created his account, on Tuesday 17 November 2026 at 10:00. */
async function fresh({ owner = OWNER, day = TUE } = {}) {
  const clock = { now: instantOf(day, 600) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const b = browser(rt);
  assert.equal((await b.post('/api/setup', owner)).status, 200);
  return { rt, b, clock, s: () => rt.engine.state };
}
/** Another browser on the same salon device (the tablet the owner registered), nobody signed in. */
function tabletOf(rt, b) {
  const t = browser(rt);
  assert.ok(b.jar.has(DEVICE_COOKIE));
  t.jar.set(DEVICE_COOKIE, b.jar.get(DEVICE_COOKIE));
  return t;
}
const byName = (s, name) => [...s.staff.values()].find((x) => x.name === name);
const bySlug = (s, slug) => [...s.services.values()].find((x) => x.slug === slug);
const hm = (h, m = 0) => h * 60 + m;

test('the plan: four barbers, twelve services, the hours and the rules, and reading it writes nothing', async () => {
  const { rt, b, s } = await fresh();
  const v = s().version;
  const r = await b.get('/api/v1/preset');
  assert.equal(r.status, 200);
  const p = r.json;
  assert.equal(p.name, 'L’Architecte');
  assert.deepEqual(p.team.map((t) => [t.name, t.status]), [['JKut', 'create'], ['Soldat', 'create'], ['Frank', 'create'], ['Esteban', 'create']]);
  assert.equal(p.services.length, 12);
  assert.ok(p.services.every((x) => x.status === 'create'));
  assert.equal(p.hours.status, 'set');
  // the rules that differ from the Comptoir's own defaults: 5 min of notice, 24 h to cancel; the two others are already so
  assert.deepEqual(p.rules.map((x) => [x.key, x.status]), [['stepMin', 'same'], ['minNoticeMin', 'set'], ['maxDaysAhead', 'same'], ['cancelUntilHours', 'set']]);
  assert.deepEqual(p.count, { hours: 1, rules: 2, services: 12, team: 4, absences: 2 });
  assert.ok(p.notes.length >= 4);
  assert.equal(s().version, v, 'a read');
  assert.equal(rt.engine.journal.length, v);
});

test('applied: the real week of each barber, the twelve services at their price and length, the salon’s hours and rules', async () => {
  const { rt, b, s } = await fresh();
  const v0 = rt.engine.journal.length;
  const r = await b.post('/api/v1/preset/apply', {});
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.json.done, written: 0 }, { hours: 1, rules: 2, services: 12, team: 4, absences: 2, written: 0 });
  assert.equal(r.json.plan.todo, 0);

  // the salon: Tuesday to Saturday 8 h 30 – 18 h 30, closed Sunday and Monday
  const st = s().settings;
  for (const d of [2, 3, 4, 5, 6]) assert.deepEqual(st.hours[d], [[hm(8, 30), hm(18, 30)]]);
  assert.deepEqual([st.hours[0], st.hours[1]], [[], []]);
  assert.deepEqual([st.booking.stepMin, st.booking.minNoticeMin, st.booking.maxDaysAhead, st.booking.cancelUntilHours], [30, 5, 90, 24]);

  // the four barbers, in the old site's order, each with a chair, on the site, at 0 % until the owner says otherwise
  const team = [...s().staff.values()].filter((x) => x.role === 'barber').sort((x, y) => x.order - y.order);
  assert.deepEqual(team.map((x) => x.name), ['JKut', 'Soldat', 'Frank', 'Esteban']);
  for (const x of team) assert.deepEqual([x.chair, x.bookable, x.active, x.services, x.commission, !!x.hasPin], [true, true, true, 'all', { service: 0, product: 0 }, false]);
  const wk = (name) => byName(s(), name).schedule;
  const lunch = [[hm(9, 30), hm(13)], [hm(14), hm(18)]];
  for (const name of ['JKut', 'Esteban']) {
    for (const d of [2, 3, 4, 5, 6]) assert.deepEqual(wk(name)[d], lunch, name + ' ' + d);
    assert.deepEqual([wk(name)[0], wk(name)[1]], [[], []], name + ' rests on Sunday and Monday');
  }
  assert.deepEqual([2, 3, 4, 5, 6].map((d) => wk('Frank')[d]), [[[hm(9), hm(16, 30)]], [[hm(9), hm(13)]], [[hm(9), hm(16, 30)]], [[hm(9), hm(16, 30)]], [[hm(9), hm(16, 30)]]]);
  assert.deepEqual([2, 3, 4, 5, 6].map((d) => wk('Soldat')[d]), [[[hm(9, 30), hm(15, 30)]], [[hm(9, 30), hm(18)]], [[hm(9, 30), hm(15, 30)]], [[hm(9, 30), hm(15, 30)]], [[hm(9), hm(18)]]]);
  assert.deepEqual([wk('Frank')[1], wk('Soldat')[1], wk('Frank')[0], wk('Soldat')[0]], [[], [], [], []]);

  // the twelve services: clean names, the price of the old title, the real length
  const menu = [...s().services.values()].sort((x, y) => x.order - y.order).map((x) => [x.name, x.price / 100, x.dur]);
  assert.deepEqual(menu, [
    ['Coupe classique', 20, 30], ['Coupe + contour de barbe', 25, 30], ['Coupe + taille de barbe', 30, 30], ['Taille de barbe', 18, 30], ['Entretien barbe', 15, 30], ['Cover barbe', 15, 30],
    ['Transformation', 50, 60], ['Décoloration', 60, 60], ['Coloration', 30, 60], ['Silver', 100, 60], ['Carnet 5 coupes', 80, 30], ['Coupe + coloration', 35, 30]
  ]);
  for (const x of s().services.values()) {
    assert.ok(!/formule|€|\d+\s*eur/i.test(x.name), x.name);
    assert.equal(x.active, true);
    const old = ARCHITECTE.services.find((o) => o.slug === x.slug).wp;
    assert.equal(Number(/(\d+)\s*€/.exec(old)[1]) * 100, x.price, 'the price in the old title: ' + old);
  }
  assert.deepEqual([...new Set([...s().services.values()].map((x) => x.category))], ['Coupes', 'Barbe', 'Changer de tête', 'Carnet']);
  // the carnet is sold at the salon and pays a coupe classique; the old site's draft is kept at the salon only
  assert.deepEqual(bySlug(s(), 'ab').pack, { credits: 5, days: 70, serviceIds: [bySlug(s(), 'cl').id] });
  assert.deepEqual([...s().services.values()].filter((x) => x.online === false).map((x) => x.name), ['Carnet 5 coupes', 'Coupe + coloration']);
  assert.deepEqual([bySlug(s(), 'de').from, bySlug(s(), 'co').from, bySlug(s(), 'cl').from], [true, true, false]);

  // everything went through the normal commands: their usual events and no other, each signed by the owner
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const mine = rt.engine.journal.slice(v0);
  assert.deepEqual([...new Set(mine.map((e) => e.type))].sort(), ['service.added', 'settings.updated', 'staff.added', 'timeoff.added']);
  assert.ok(mine.every((e) => e.actor.t === 'staff' && e.actor.id === owner.id));
  assert.equal(mine.length, r.json.done.written);
});

test('the site offers the real week at once: JKut from 9 h 30 with his lunch break, nobody on Monday, Frank until 13 h on Wednesday', async () => {
  const { rt, b, s, clock } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  const slots = (name, day) => freeSlots(s(), { day, dur: 30, serviceIds: [bySlug(s(), 'cl').id], staffId: byName(s(), name).id, now: clock.now, local: localParts(clock.now), online: true, step: 30 }).map((x) => x.m);
  const wed = '2026-11-18', mon = '2026-11-23', sat = '2026-11-21';
  const jk = slots('JKut', wed);
  assert.equal(jk[0], hm(9, 30));
  assert.ok(!jk.includes(hm(13)) && !jk.includes(hm(13, 30)) && jk.includes(hm(12, 30)) && jk.includes(hm(14)));
  assert.equal(jk[jk.length - 1], hm(17, 30));
  assert.deepEqual([slots('Frank', wed)[0], slots('Frank', wed).at(-1)], [hm(9), hm(12, 30)]);
  assert.deepEqual([slots('Soldat', sat)[0], slots('Soldat', sat).at(-1)], [hm(9), hm(17, 30)]);
  for (const name of ['JKut', 'Soldat', 'Frank', 'Esteban']) assert.deepEqual(slots(name, mon), [], name + ' on a Monday');
  assert.equal(weekday(mon), 1);
  // Esteban is away on the 17th and 18th, as the old site said: nothing to book with him, back on Thursday
  assert.deepEqual(slots('Esteban', wed), []);
  assert.ok(slots('Esteban', '2026-11-19').length > 0);
  assert.deepEqual(staffIntervals(s(), byName(s(), 'Esteban').id, '2026-12-10'), []);
  // and the public endpoint agrees
  const pub = await browser(rt).get('/api/public/availability?from=' + wed + '&days=1&services=' + bySlug(s(), 'cl').id + '&staff=' + byName(s(), 'JKut').id);
  assert.equal(pub.status, 200);
  assert.deepEqual([pub.json.days[0].slots[0].m, pub.json.days[0].slots.some((x) => x.m === hm(13))], [hm(9, 30), false]);
  // a service kept « au salon seulement » is never offered there
  assert.equal((await browser(rt).get('/api/public/availability?from=' + wed + '&days=1&services=' + bySlug(s(), 'cco').id)).status, 404);
});

test('running it twice changes nothing: not one event more', async () => {
  const { rt, b, s } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  const v = s().version, n = rt.engine.journal.length;
  const again = await b.post('/api/v1/preset/apply', {});
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.done, { hours: 0, rules: 0, services: 0, team: 0, absences: 0, written: 0 });
  assert.equal(s().version, v);
  assert.equal(rt.engine.journal.length, n);
  assert.equal([...s().staff.values()].filter((x) => x.role === 'barber').length, 4);
  assert.equal(s().services.size, 12);
  assert.equal(s().timeoff.size, 2);
  // a third, part by part
  for (const part of PRESET_PARTS) assert.equal((await b.post('/api/v1/preset/apply', { parts: [part] })).json.done.written, 0, part);
  assert.equal(rt.engine.journal.length, n);
  assert.equal((await b.post('/api/v1/preset/apply', { parts: ['clients'] })).status, 400);
});

test('it creates, it never overwrites: the owner’s own hours, a service he made, a barber he changed stay his', async () => {
  const t = await salon({ day: TUE });
  const as = t.asOwner();
  // his own choices before the preset: other hours, 2 h of notice, a « Coupe classique » at 22 €, JKut already there on Mondays
  const own = { 0: [], 1: [[600, 1080]], 2: [[600, 1080]], 3: [[600, 1080]], 4: [[600, 1080]], 5: [[600, 1080]], 6: [] };
  await t.engine.run(updateSettings, { hours: own, booking: { minNoticeMin: 120 } }, as);
  const mine = (await t.engine.run(addService, { name: 'coupe classique', category: 'Coupes', price: 2200, dur: 45 }, as)).id;
  const jk = (await t.engine.run(addStaff, { name: 'jkut', role: 'barber', schedule: { 1: [[600, 1080]] }, commission: { service: 5000, product: 0 } }, as)).id;

  const plan = presetPlan(t.engine.state, ARCHITECTE, { today: TUE });
  assert.equal(plan.hours.status, 'kept');
  assert.deepEqual(plan.rules.filter((r) => r.status !== 'same').map((r) => [r.key, r.status]), [['minNoticeMin', 'kept'], ['cancelUntilHours', 'set']]);
  // the helper salon already has slug « cl » (its « Coupe ») and the hand-made service has the name
  assert.equal(plan.services.find((x) => x.slug === 'cl').status, 'exists');
  assert.deepEqual(plan.team.map((x) => x.status), ['exists', 'create', 'create', 'create']);

  const done = await applyPreset(t.engine, ARCHITECTE, {}, as);
  assert.deepEqual([done.hours, done.rules, done.team], [0, 1, 3]);
  const s = t.engine.state;
  assert.deepEqual(s.settings.hours, own);
  assert.deepEqual([s.settings.booking.minNoticeMin, s.settings.booking.cancelUntilHours], [120, 24]);
  assert.deepEqual([s.services.get(mine).price, s.services.get(mine).dur], [2200, 45]);
  assert.equal([...s.services.values()].filter((x) => /coupe classique/i.test(x.name)).length, 1);
  assert.deepEqual([s.staff.get(jk).schedule, s.staff.get(jk).commission], [{ 1: [[600, 1080]] }, { service: 5000, product: 0 }]);
  assert.equal([...s.staff.values()].filter((x) => /^jkut$/i.test(x.name)).length, 1);
  // a barber archived since is not brought back
  const v = s.version;
  assert.equal((await applyPreset(t.engine, ARCHITECTE, {}, as)).written, 0);
  assert.equal(t.engine.state.version, v);
});

test('the owner who cuts too: his account of the setup screen gets his chair and his week, not a second « Frank »', async () => {
  const { b, s } = await fresh({ owner: { ...OWNER, name: 'Frank' } });
  const plan = (await b.get('/api/v1/preset')).json;
  assert.deepEqual(plan.team.map((x) => [x.name, x.status]), [['JKut', 'create'], ['Soldat', 'create'], ['Frank', 'chair'], ['Esteban', 'create']]);
  await b.post('/api/v1/preset/apply', {});
  const franks = [...s().staff.values()].filter((x) => x.name === 'Frank');
  assert.equal(franks.length, 1);
  assert.deepEqual([franks[0].role, franks[0].chair, franks[0].bookable, franks[0].schedule[3]], ['owner', true, true, [[540, 780]]]);
  assert.equal((await b.get('/api/v1/preset')).json.todo, 0);
});

test('only the owner: a barber and a manager are refused, and a right missing mid-way leaves nothing half-done', async () => {
  const { rt, b, s } = await fresh();
  // signed out
  assert.equal((await browser(rt).get('/api/v1/preset')).status, 401);
  assert.equal((await browser(rt).post('/api/v1/preset/apply', {})).status, 401);
  // a manager and a barber of the salon, signed in on the tablet with their codes
  const mk = async (name, role, pin) => (await b.post('/api/v1/staff', { name, role, pin })).json.id;
  const mgr = await mk('Inès', 'manager', '4826');
  const bar = await mk('Nolan', 'barber', '7391');
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  for (const [id, pin] of [[mgr, '4826'], [bar, '7391']]) {
    const tab = tabletOf(rt, b);
    assert.equal((await tab.post('/api/auth/pin', { staffId: id, pin })).status, 200);
    assert.equal((await tab.get('/api/v1/preset')).status, 403);
    assert.equal((await tab.post('/api/v1/preset/apply', {})).status, 403);
  }
  // the commands themselves check: with a manager's rights (team, catalog, no settings) the hours are refused, and
  // the services and barbers queued before them in the same batch are not written either
  const manager = s().staff.get(mgr);
  const asMgr = { actor: { t: 'staff', id: mgr }, staff: manager, caps: capsOf(manager, s().settings) };
  const v = s().version;
  await rejects(applyPreset(rt.engine, ARCHITECTE, {}, asMgr), 'forbidden');
  const barber = s().staff.get(bar);
  await rejects(applyPreset(rt.engine, ARCHITECTE, { parts: ['services', 'team'] }, { actor: { t: 'staff', id: bar }, staff: barber, caps: capsOf(barber, s().settings) }), 'forbidden');
  assert.equal(s().version, v);
  assert.equal(s().services.size, 0);
  assert.equal([...s().staff.values()].length, 3);
});

test('days off known on the old site: posted once from today on, never for days already past', async () => {
  const late = await fresh({ day: '2026-12-10' });
  const plan = (await late.b.get('/api/v1/preset')).json;
  assert.deepEqual(plan.absences.map((a) => [a.from, a.to, a.status]), [['2026-12-10', '2026-11-14', 'past'], ['2026-12-10', '2026-11-18', 'past'], ['2026-12-10', '2026-12-12', 'create']]);
  await late.b.post('/api/v1/preset/apply', {});
  const off = [...late.s().timeoff.values()];
  assert.deepEqual(off.map((t) => [late.s().staff.get(t.staffId).name, t.from, t.to]), [['Esteban', '2026-12-10', '2026-12-12']]);
  assert.equal((await late.b.post('/api/v1/preset/apply', {})).json.done.absences, 0);
  // after the last of them, nothing
  const after = await fresh({ day: '2027-01-05' });
  await after.b.post('/api/v1/preset/apply', {});
  assert.equal(after.s().timeoff.size, 0);
  // without the team, no day off is posted for nobody
  const only = await fresh();
  assert.equal((await only.b.post('/api/v1/preset/apply', { parts: ['absences'] })).json.done.absences, 0);
});

/* ---------------- the old site's names map to the preset on their own ---------------- */

const TITLES = [
  'Formule Coupe Classique 20€', 'Formule Coupe + Contour Barbe 25€', 'Formule Coupe + Taille de Barbe 30€', 'Formule Taille de Barbe 18€',
  'Formule Entretien Barbe 15€', 'Formule Cover Barbe 15€', 'Formule Transformation  50€', 'Formule Décoloration  60€', 'Formule Coloration 30€',
  'Formule Silver 100€', 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées', 'Formule Coupe et coloration 35€'
];
const BARBERS = ['JKut', 'Soldat', 'Frank', 'Esteban'];
const PACK = 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées';

/** An export as the old site writes it, with one invented booking to come per service, the barbers in turn. */
function exportOf(titles) {
  const head = '﻿Réservations,de,à\n,"01 Jan 2026","31 Déc 2026"\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT","Adresse du client",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT,"REMISE APPLIQUÉE","MONTANT TOTAL"\n';
  const rows = titles.map((t, i) => [9000 + i, '"' + (20 + (i % 5)) + ' Nov 2026 ' + (10 + (i % 6)) + ':00"', '"10 Nov 2026 09:00"', 'Client', 'Essai' + i, 'client' + i + '@exemple.fr', '06000000' + String(10 + i), '', '"' + t + '"', BARBERS[i % 4], '', '"' + /(\d+)\s*€/.exec(t)[1] + ' €"', '"Payer plus tard"', '', ''].join(','));
  return head + rows.join('\n') + '\n';
}

test('the 12 old service titles and the 4 barber names map to the preset with no manual step', async () => {
  const { b, s, clock } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  assert.deepEqual(ARCHITECTE.services.map((x) => x.wp), TITLES);
  assert.deepEqual(ARCHITECTE.staff.map((x) => x.wp), BARBERS);

  const p = W.readFiles([{ name: 'bookings-2026.csv', text: exportOf(TITLES) }], TUE);
  assert.equal(p.bookings.length, 12);
  // the wizard reads a title with its spaces tidied (« Transformation  50€ » has two on the old site)
  const tidy = (t) => t.replace(/\s+/g, ' ');
  assert.deepEqual(W.names(p).services.map(([n]) => n).sort(), TITLES.map(tidy).sort());
  assert.deepEqual(W.names(p).staff.map(([n]) => n).sort(), [...BARBERS].sort());
  const boot = (await b.get('/api/v1/bootstrap')).json;
  const id = (slug) => bySlug(s(), slug).id;

  // the barbers, exactly as the wizard asks (Réglages › Reprendre WordPress: the active chairs)
  const chairs = boot.staff.filter((x) => x.active && x.chair);
  const staff = W.suggestStaff(p, chairs, clock.now);
  assert.deepEqual(staff.guessed, []);
  for (const n of BARBERS) assert.equal(staff.map[n], byName(s(), n).id, n);

  // the services, exactly as the wizard asks: the active services that are not a carnet (an appointment is never a
  // carnet). Every booking here is still to come, the case where the wizard would otherwise stop and ask.
  const wizard = boot.services.filter((x) => x.active && !x.pack);
  const sv = W.suggestServices(p, wizard, clock.now);
  assert.deepEqual(sv.guessed, [], 'clear matches, no near spelling');
  const want = Object.fromEntries(ARCHITECTE.services.map((x) => [x.wp, id(x.slug)]));
  for (const t of TITLES.filter((x) => x !== PACK)) assert.equal(sv.map[tidy(t)], want[t], t);
  assert.equal(Object.values(sv.map).filter((x) => x === W.LEGACY).length, 0);

  // the carnet: an appointment is never a carnet, the wizard keeps carnets out of its list, so no name can match the
  // old « Abonnement ». Left alone it is the one title the owner would be asked about while it has a booking to come:
  assert.equal(sv.map[tidy(PACK)], '');
  // the preset says where it goes (the visit is a coupe classique), in the wizard's own words: the title as the wizard
  // reads it, the id of the service. Given as the choices already made (`kept`), the twelve map and nothing is asked.
  const { aliases } = (await b.get('/api/v1/preset')).json;
  assert.deepEqual(aliases, { [tidy(PACK)]: id('cl') });
  const all = W.suggestServices(p, wizard, clock.now, aliases);
  for (const t of TITLES) assert.ok(all.map[tidy(t)] && all.map[tidy(t)] !== W.LEGACY && s().services.has(all.map[tidy(t)]), t);
  assert.equal(new Set(Object.values(all.map)).size, 11, 'eleven services for twelve titles: the carnet’s visits are coupes classiques');
  // and no title is pulled to the wrong service: each one's clear best match among every service is its own
  const keys = (x) => [x.name, x.short || '', x.slug || ''];
  for (const t of TITLES.filter((x) => x !== PACK)) for (const title of [t, tidy(t)]) assert.equal(W.bestMatch(title, boot.services, keys), want[t], t);
  assert.equal(W.bestMatch(PACK, boot.services, keys), '');
  const past = W.readFiles([{ name: 'bookings-2026.csv', text: exportOf([PACK]).replace('20 Nov 2026', '20 Oct 2026') }], TUE);
  assert.equal(W.suggestServices(past, wizard, clock.now).map[tidy(PACK)], W.LEGACY, 'history alone needs no choice');
});

/* ---------------- a brand-new barber's first sign-in ---------------- */

test('a barber of the preset has no code: he is not on the tablet, no code opens his name, his phone cannot be linked; one tap gives each a code, once', async () => {
  const { rt, b, s } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  const tablet = () => tabletOf(rt, b);
  const jk = byName(s(), 'JKut').id;

  // before: only the owner is offered on the tablet, and guessing a code for JKut opens nothing
  assert.deepEqual((await tablet().get('/api/auth/state')).json.team.map((x) => x.name), ['Gérant']);
  for (const pin of ['', '0000', '1313']) assert.equal((await tablet().post('/api/auth/pin', { staffId: jk, pin })).status, 401);
  assert.equal((await b.post('/api/v1/staff/' + jk + '/phone-link', {})).json.error.code, 'no_pin');
  assert.deepEqual((await b.get('/api/v1/preset')).json.noCode.map((x) => x.name), ['JKut', 'Soldat', 'Frank', 'Esteban']);

  // one tap: four codes, four digits, no easy one, all different, never written in clear in the journal
  const r = await b.post('/api/v1/preset/codes', {});
  assert.equal(r.status, 200);
  const codes = r.json.codes;
  assert.deepEqual(codes.map((c) => c.name), ['JKut', 'Soldat', 'Frank', 'Esteban']);
  for (const c of codes) assert.match(c.pin, /^\d{4}$/);
  assert.equal(new Set(codes.map((c) => c.pin)).size, 4);
  for (const c of codes) assert.ok(!JSON.stringify(rt.engine.journal).includes('"' + c.pin + '"'));
  assert.ok([...s().staff.values()].filter((x) => x.role === 'barber').every((x) => x.hasPin));

  // now each one is on the tablet and enters with his own code, into his own space, with a barber's rights only
  assert.deepEqual((await tablet().get('/api/auth/state')).json.team.map((x) => x.name), ['Gérant', 'JKut', 'Soldat', 'Frank', 'Esteban']);
  const mine = tablet();
  assert.equal((await mine.post('/api/auth/pin', { staffId: jk, pin: codes[1].pin })).status, 401, 'Soldat’s code does not open JKut');
  assert.equal((await mine.post('/api/auth/pin', { staffId: jk, pin: codes[0].pin })).status, 200);
  const espace = await mine.get('/api/v1/espace');
  assert.equal(espace.status, 200);
  assert.equal((await mine.get('/api/v1/timeoff/mine')).status, 200);
  assert.equal((await mine.get('/api/v1/preset')).status, 403);
  assert.equal((await mine.post('/api/v1/preset/codes', {})).status, 403);
  assert.equal((await mine.get('/api/v1/staff')).status, 403);

  // a second tap gives nothing and replaces nobody's code
  const again = await b.post('/api/v1/preset/codes', {});
  assert.deepEqual(again.json.codes, []);
  assert.equal((await tablet().post('/api/auth/pin', { staffId: jk, pin: codes[0].pin })).status, 200);
  assert.deepEqual((await b.get('/api/v1/preset')).json.noCode, []);
});

test('a preset barber’s week can still be changed by the owner afterwards, and the preset leaves it alone', async () => {
  const { rt, b, s } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) };
  const frank = byName(s(), 'Frank');
  await rt.engine.run(updateStaff, { id: frank.id, patch: { schedule: { ...frank.schedule, 3: [] } } }, as);
  assert.equal((await b.post('/api/v1/preset/apply', {})).json.done.written, 0);
  assert.deepEqual(byName(s(), 'Frank').schedule[3], []);
});
