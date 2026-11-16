// The preset « L’Architecte »: the real salon put in place in one confirmed step (server/presets/architecte.js,
// commands/setup.js, http/routes-preset.js). What it creates, that a second run changes nothing, that it never
// overwrites the owner's own choices, who may run it, that the old site's names map to it without a choice, and the
// first code of a brand-new barber. Frank is the gérant: his chair goes to the owner's own account, whatever its name.
// Each one gets his portrait. The hours are the owner's own (16 November 2026): the hour he gives as the end is the start
// of the last cut. Aland, the apprentice, works his full week during the zone B holidays and has his CFA days posted as
// absences on school weeks. The salon closes at Christmas and the New Year and opens two Mondays, worked like a Tuesday.
// A salon that applied the earlier version is offered the new hours; hours changed by hand are kept. No client of the
// real salon appears here: the bookings below are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { instantOf, localParts, weekday, addDays } from '../../shared/dates.js';
import { capsOf } from '../../server/domain/permissions.js';
import { DEVICE_COOKIE } from '../../server/auth/session.js';
import { freeSlots, staffIntervals } from '../../server/domain/availability.js';
import { ARCHITECTE } from '../../server/presets/architecte.js';
import { ZONE_B, schoolDay, schoolYearOf } from '../../server/presets/vacances-zone-b.js';
import { createAppointment } from '../../server/commands/agenda.js';
import { hoursText } from '../../server/settings/hours.js';
import { presetPlan, applyPreset, PRESET_PARTS } from '../../server/commands/setup.js';
import { addService } from '../../server/commands/catalog.js';
import { addStaff, updateStaff, removeTimeOff } from '../../server/commands/team.js';
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
/** Frank's chair: the owner's own account (named « Gérant » in most tests here) */
const frankOf = (s) => [...s.staff.values()].find((x) => x.role === 'owner');
const TEAM = ['JKut', 'Le Soldat', 'Frank', 'Esteban', 'Aland'];
const bySlug = (s, slug) => [...s.services.values()].find((x) => x.slug === slug);
const hm = (h, m = 0) => h * 60 + m;
/** the owner's rights, for a command run straight on the engine */
const asOwnerOf = (s) => { const owner = frankOf(s); return { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s.settings) }; };
/** the starts the site offers one barber on one day, for a service of `dur` minutes */
const slotsOf = (t, name, day, dur = 30) => {
  const s = t.s(), st = name === 'Frank' ? frankOf(s) : byName(s, name);
  return freeSlots(s, { day, dur, serviceIds: [bySlug(s, dur === 60 ? 'tr' : 'cl').id], staffId: st.id, now: t.clock.now, local: localParts(t.clock.now), online: true, step: 30 }).map((x) => x.m);
};
const ends = (m) => [m[0], m.at(-1)];
/** the 54 CFA days from 17 November 2026 to the summer: 27 Wednesdays from noon, 27 Thursdays */
const CFA = 54;
/** the preset as it was before 16 November 2026: the old site's hours, Aland without a week and off the site, no CFA, no special day */
const BEFORE = {
  ...ARCHITECTE, hours: ARCHITECTE.hoursWas[0], hoursWas: [], school: undefined, closures: [], openings: [],
  staff: ARCHITECTE.staff.map(({ was, ...x }) => (was ? { ...x, schedule: was[0].schedule, ...(was[0].online === false ? { online: false } : {}) } : x))
};

test('the plan: four barbers and the owner’s chair, twelve services, the hours and the rules, and reading it writes nothing', async () => {
  const { rt, b, s } = await fresh();
  const v = s().version;
  const r = await b.get('/api/v1/preset');
  assert.equal(r.status, 200);
  const p = r.json;
  assert.equal(p.name, 'L’Architecte');
  assert.deepEqual(p.team.map((t) => [t.name, t.status]), [['JKut', 'create'], ['Le Soldat', 'create'], ['Frank', 'chair'], ['Esteban', 'create'], ['Aland', 'create']]);
  // Frank's line is the owner's account, and the plan says so first, in plain words
  const frank = p.team.find((t) => t.name === 'Frank');
  assert.deepEqual([frank.owner, frank.account, frank.id], [true, 'Gérant', frankOf(s()).id]);
  assert.equal(p.notes[0], 'Frank est le gérant : ton compte « Gérant » reçoit son fauteuil, sa semaine, sa couleur et ses initiales. Aucun second compte « Frank » n’est créé.');
  // Aland: his hours are known now, so he is online like the others, and the owner is told how his school weeks work
  const aland = p.team.find((t) => t.name === 'Aland');
  assert.deepEqual([aland.online, aland.schedule[4], aland.wp], [true, [[hm(9, 30), hm(13)], [hm(14), hm(18)]], '']);
  assert.ok(p.notes.some((n) => /^Aland est en alternance/.test(n)), 'a plain note about Aland');
  assert.ok(!p.notes.some((n) => /horaires ne sont pas connus|8 h 30 à 18 h 30/.test(n)));
  // the owner's rule is said in his words; nothing is left for him to decide about the two Mondays
  assert.ok(p.notes.some((n) => n.includes('la dernière coupe commence à 17 h 30')));
  assert.ok(!p.notes.some((n) => /lundi/i.test(n)));
  // the salon: Tuesday to Saturday 9 h – 18 h
  assert.equal(hoursText(p.hours.to).replace(/\s/g, ' '), 'Du mardi au samedi, 9 h – 18 h');
  // Christmas and the New Year closed, the two Mondays open like a Tuesday
  assert.deepEqual(p.closures.map((c) => [c.from, c.to, c.status]), [['2026-12-25', '2026-12-26', 'create'], ['2027-01-01', '2027-01-02', 'create']]);
  assert.deepEqual(p.openings.map((x) => [x.day, x.intervals, x.staff, x.like, x.status]), [['2026-12-21', [[hm(9), hm(18)]], 'all', 2, 'create'], ['2026-12-28', [[hm(9), hm(18)]], 'all', 2, 'create']]);
  // Aland's CFA days: from tomorrow's Wednesday to the last Thursday of the school year, zone B, with its source
  assert.deepEqual([p.school.staff, p.school.reason, p.school.zone, p.school.year, p.school.from, p.school.until, p.school.days.length, p.school.todo, p.school.unconfirmed], ['Aland', 'CFA', 'B', '2026-2027', '2026-11-18', '2027-07-01', CFA, CFA, false]);
  assert.match(p.school.source, /^https:\/\/www\.service-public\.gouv\.fr\//);
  assert.deepEqual(p.school.holidays.map((h) => [h.name, h.from, h.to]), [['Noël', '2026-12-20', '2027-01-03'], ['Hiver', '2027-02-21', '2027-03-07'], ['Printemps', '2027-04-18', '2027-05-02']]);
  assert.deepEqual(p.stranded, { count: 0, by: [] });
  assert.deepEqual(p.team.map((t) => t.photo), ['create', 'create', 'create', 'create', 'create']);
  assert.equal(p.services.length, 12);
  assert.ok(p.services.every((x) => x.status === 'create'));
  assert.equal(p.hours.status, 'set');
  // the rules that differ from the Comptoir's own defaults: 5 min of notice, 24 h to cancel; the two others are already so
  assert.deepEqual(p.rules.map((x) => [x.key, x.status]), [['stepMin', 'same'], ['minNoticeMin', 'set'], ['maxDaysAhead', 'same'], ['cancelUntilHours', 'set']]);
  assert.deepEqual(p.count, { hours: 1, rules: 2, closures: 2, openings: 2, services: 12, updates: 0, team: 5, schedules: 0, absences: 2, cfa: CFA, photos: 5 });
  assert.ok(p.notes.length >= 6);
  for (const n of p.notes) assert.ok(!n.includes('—'), 'no em dash: ' + n);
  assert.equal(s().version, v, 'a read');
  assert.equal(rt.engine.journal.length, v);
});

test('applied: the real week of each barber, the twelve services at their price and length, the salon’s hours and rules', async () => {
  const { rt, b, s } = await fresh();
  const v0 = rt.engine.journal.length;
  const r = await b.post('/api/v1/preset/apply', {});
  assert.equal(r.status, 200);
  assert.deepEqual({ ...r.json.done, written: 0 }, { hours: 1, rules: 2, closures: 2, openings: 2, services: 12, updates: 0, team: 5, schedules: 0, absences: 2, cfa: CFA, photos: 5, written: 0 });
  assert.equal(r.json.plan.todo, 0);

  // the salon: Tuesday to Saturday 9 h – 18 h (what the team really works), closed Sunday and Monday
  const st = s().settings;
  for (const d of [2, 3, 4, 5, 6]) assert.deepEqual(st.hours[d], [[hm(9), hm(18)]]);
  assert.equal((await browser(rt).get('/api/public/salon')).json.hoursText.replace(/\s/g, ' '), 'Du mardi au samedi, 9 h – 18 h', 'the site says the hours it reads, not the old ones');
  assert.deepEqual(st.closures.map((c) => [c.from, c.to, c.label]), [['2026-12-25', '2026-12-26', 'Noël'], ['2027-01-01', '2027-01-02', 'Jour de l’An']]);
  assert.deepEqual(st.openings.map((x) => [x.day, x.intervals, x.staff, x.like]), [['2026-12-21', [[hm(9), hm(18)]], 'all', 2], ['2026-12-28', [[hm(9), hm(18)]], 'all', 2]]);
  assert.deepEqual([st.hours[0], st.hours[1]], [[], []]);
  assert.deepEqual([st.booking.stepMin, st.booking.minNoticeMin, st.booking.maxDaysAhead, st.booking.cancelUntilHours], [30, 5, 90, 24]);

  // the barbers, in the old site's order, each with a chair, on the site, at 0 % until the owner says otherwise; Aland
  // last, online like the others now that his hours are known
  const team = [...s().staff.values()].filter((x) => x.role === 'barber').sort((x, y) => x.order - y.order);
  assert.deepEqual(team.map((x) => x.name), ['JKut', 'Le Soldat', 'Esteban', 'Aland']);
  for (const x of team) assert.deepEqual([x.chair, x.bookable, x.active, x.services, x.commission, !!x.hasPin], [true, true, true, 'all', { service: 0, product: 0 }, false], x.name);
  // Frank is the owner's account: his chair, week, colour and initials, still the owner, nobody else called Frank
  const fr = frankOf(s());
  assert.deepEqual([fr.name, fr.role, fr.chair, fr.bookable, fr.color, fr.initials, fr.services], ['Gérant', 'owner', true, true, '#F5B544', 'FR', 'all']);
  assert.equal(byName(s(), 'Frank'), undefined);
  const wk = (name) => (name === 'Frank' ? frankOf(s()) : byName(s(), name)).schedule;
  const lunch = [[hm(9, 30), hm(13)], [hm(14), hm(18)]];
  // an interval ends one cut (30 min) after the last start the owner gave: 17 h 30 is 18 h here, 16 h 30 is 17 h
  for (const name of ['JKut', 'Esteban', 'Aland']) {
    for (const d of [2, 3, 4, 5, 6]) assert.deepEqual(wk(name)[d], lunch, name + ' ' + d);
    assert.deepEqual([wk(name)[0], wk(name)[1]], [[], []], name + ' rests on Sunday and Monday');
  }
  assert.deepEqual([2, 3, 4, 5, 6].map((d) => wk('Frank')[d]), [[[hm(9), hm(17)]], [[hm(9), hm(13, 30)]], [[hm(9), hm(17)]], [[hm(9), hm(17)]], [[hm(9), hm(17)]]]);
  assert.deepEqual([2, 3, 4, 5, 6].map((d) => wk('Le Soldat')[d]), [[[hm(9, 30), hm(15, 30)]], [[hm(9, 30), hm(18)]], [[hm(9, 30), hm(15, 30)]], [[hm(9, 30), hm(15, 30)]], [[hm(9, 30), hm(18)]]]);
  // Aland's school weeks: one absence « CFA » per day, Wednesday from noon and Thursday whole, none in the holidays
  const cfa = [...s().timeoff.values()].filter((t) => t.reason === 'CFA');
  assert.equal(cfa.length, CFA);
  assert.ok(cfa.every((t) => t.staffId === byName(s(), 'Aland').id && t.from === t.to && schoolDay(t.from) === 'school'));
  assert.ok(cfa.every((t) => (weekday(t.from) === 3 ? t.startMin === hm(12) && t.endMin === hm(18) : weekday(t.from) === 4 && t.startMin == null)));
  assert.deepEqual([cfa.filter((t) => weekday(t.from) === 3).length, cfa.filter((t) => weekday(t.from) === 4).length], [27, 27]);
  assert.deepEqual(['2026-12-23', '2026-12-24', '2026-12-30', '2026-12-31', '2027-02-24', '2027-03-04', '2027-04-22', '2027-07-07'].filter((d) => cfa.some((t) => t.from === d)), []);
  assert.deepEqual(['2026-11-18', '2026-11-19', '2026-12-17', '2027-01-06', '2027-03-10', '2027-05-05', '2027-07-01'].filter((d) => !cfa.some((t) => t.from === d)), []);
  assert.deepEqual([wk('Frank')[1], wk('Le Soldat')[1], wk('Frank')[0], wk('Le Soldat')[0]], [[], [], [], []]);

  // the twelve services: clean names, the price of the old title, the real length
  const menu = [...s().services.values()].sort((x, y) => x.order - y.order).map((x) => [x.name, x.price / 100, x.dur]);
  assert.deepEqual(menu, [
    ['Coupe classique', 20, 30], ['Coupe + contour de barbe', 25, 30], ['Coupe + taille de barbe', 30, 30], ['Taille de barbe', 18, 30], ['Entretien barbe', 15, 30], ['Cover barbe', 15, 30],
    ['Transformation', 50, 60], ['Décoloration', 60, 60], ['Coloration', 30, 60], ['Silver', 100, 60], ['Formule Entretien 5 semaines', 80, 30], ['Coupe + coloration', 35, 30]
  ]);
  for (const x of s().services.values()) {
    // no « Formule … 20€ » of the old titles; the one formule is the owner's own name for his five weeks of upkeep
    assert.ok(!/€|\d+\s*eur/i.test(x.name) && (x.slug === 'ab' || !/formule/i.test(x.name)), x.name);
    assert.equal(x.active, true);
    const old = ARCHITECTE.services.find((o) => o.slug === x.slug).wp;
    assert.equal(Number(/(\d+)\s*€/.exec(old)[1]) * 100, x.price, 'the price in the old title: ' + old);
  }
  assert.deepEqual([...new Set([...s().services.values()].map((x) => x.category))], ['Coupes', 'Barbe', 'Changer de tête', 'Formule']);
  // the carnet pays a coupe classique, one a week for five weeks from the first date (a missed week is lost), and is sold
  // on the site; the old site's draft is kept at the salon only
  assert.deepEqual(bySlug(s(), 'ab').pack, { credits: 5, days: 35, serviceIds: [bySlug(s(), 'cl').id, bySlug(s(), 'cc').id], withIds: [bySlug(s(), 'eb').id], weekly: true, missed: 'lost' });
  assert.deepEqual(bySlug(s(), 'ab').includes, ['Shampooing', 'Coupe', 'Coiffage', 'Entretien de barbe']);
  assert.deepEqual([...s().services.values()].filter((x) => x.online === false).map((x) => x.name), ['Coupe + coloration']);
  assert.deepEqual([bySlug(s(), 'de').from, bySlug(s(), 'co').from, bySlug(s(), 'cl').from], [true, true, false]);

  // everything went through the normal commands: their usual events and no other, each signed by the owner
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const mine = rt.engine.journal.slice(v0);
  assert.deepEqual([...new Set(mine.map((e) => e.type))].sort(), ['service.added', 'settings.updated', 'staff.added', 'staff.photo', 'staff.updated', 'timeoff.added']);
  assert.ok(mine.every((e) => e.actor.t === 'staff' && e.actor.id === owner.id));
  assert.equal(mine.length, r.json.done.written);
});

test('the site offers the real week at once: each barber’s first and last cut are the hours the owner gave, nothing during lunch, nobody on Monday', async () => {
  const t = await fresh();
  const { rt, b, s } = t;
  await b.post('/api/v1/preset/apply', {});
  const slots = (name, day, dur) => slotsOf(t, name, day, dur);
  const wed = '2026-11-18', thu = '2026-11-19', fri = '2026-11-20', sat = '2026-11-21', mon = '2026-11-23';
  // JKut, 9 h 30 – 17 h 30, lunch 13 h – 14 h: the first cut opens at 9 h 30, the last at 17 h 30, nothing starts in between
  // 13 h and 14 h (the last of the morning is 12 h 30, done at 13 h)
  for (const day of [wed, thu, fri, sat]) {
    const jk = slots('JKut', day);
    assert.deepEqual(ends(jk), [hm(9, 30), hm(17, 30)], day);
    assert.deepEqual(jk.filter((m) => m >= hm(12, 30) && m <= hm(14)), [hm(12, 30), hm(14)], 'nothing between 13 h and 14 h on ' + day);
    assert.equal(jk.length, 15, '7 before lunch, 8 after');
  }
  // an hour-long service starts 30 minutes earlier at the latest, and must end before lunch
  const hour = slots('JKut', thu, 60);
  assert.deepEqual([hour[0], hour.at(-1), hour.includes(hm(12)), hour.includes(hm(12, 30)), hour.includes(hm(13))], [hm(9, 30), hm(17), true, false, false]);
  // Esteban: the same week (he is away on the 17th and 18th, as the old site said, and back on Thursday)
  assert.deepEqual(slots('Esteban', wed), []);
  assert.deepEqual(ends(slots('Esteban', thu)), [hm(9, 30), hm(17, 30)]);
  assert.ok(!slots('Esteban', thu).some((m) => m >= hm(13) && m < hm(14)));
  assert.deepEqual(staffIntervals(s(), byName(s(), 'Esteban').id, '2026-12-10'), []);
  // Frank, non-stop: 9 h – 16 h 30, and 9 h – 13 h on Wednesday
  for (const day of [thu, fri, sat]) assert.deepEqual(ends(slots('Frank', day)), [hm(9), hm(16, 30)], 'Frank ' + day);
  assert.deepEqual(ends(slots('Frank', wed)), [hm(9), hm(13)]);
  assert.ok(slots('Frank', thu).includes(hm(13)) && slots('Frank', thu).includes(hm(13, 30)), 'no break');
  // Le Soldat, non-stop: 9 h 30 – 15 h on Tuesday, Thursday, Friday; 9 h 30 – 17 h 30 on Wednesday and Saturday
  for (const day of [thu, fri, '2026-11-24']) assert.deepEqual(ends(slots('Le Soldat', day)), [hm(9, 30), hm(15)], 'Le Soldat ' + day);
  for (const day of [wed, sat]) assert.deepEqual(ends(slots('Le Soldat', day)), [hm(9, 30), hm(17, 30)], 'Le Soldat ' + day);
  assert.ok(slots('Le Soldat', sat).includes(hm(13, 30)), 'no break');
  for (const name of TEAM) assert.deepEqual(slots(name, mon), [], name + ' on a Monday');
  assert.equal(weekday(mon), 1);
  // everyone is on the site, Aland too
  const site = (await browser(rt).get('/api/public/salon')).json;
  assert.deepEqual(site.barbers.map((x) => x.name), ['Gérant', 'JKut', 'Le Soldat', 'Esteban', 'Aland']);
  // and the public endpoint agrees
  const pub = await browser(rt).get('/api/public/availability?from=' + wed + '&days=1&services=' + bySlug(s(), 'cl').id + '&staff=' + byName(s(), 'JKut').id);
  assert.equal(pub.status, 200);
  assert.deepEqual([pub.json.days[0].slots[0].m, pub.json.days[0].slots.at(-1).m, pub.json.days[0].slots.some((x) => x.m === hm(13))], [hm(9, 30), hm(17, 30), false]);
  // a service kept « au salon seulement » is never offered there
  assert.equal((await browser(rt).get('/api/public/availability?from=' + wed + '&days=1&services=' + bySlug(s(), 'cco').id)).status, 404);
});

test('Aland, the apprentice: at the CFA on school weeks (Wednesday from noon, Thursday), his full week during the zone B holidays, by himself', async () => {
  const t = await fresh();
  await t.b.post('/api/v1/preset/apply', {});
  const slots = (day) => slotsOf(t, 'Aland', day);
  const full = [hm(9, 30), hm(17, 30)];
  // a school week: Tuesday, Friday, Saturday 9 h 30 – 17 h 30 with his hour's break; Wednesday 9 h 30 – 11 h 30; Thursday at the CFA
  for (const day of ['2026-11-24', '2026-11-20', '2026-11-21']) {
    assert.deepEqual(ends(slots(day)), full, day);
    assert.ok(!slots(day).some((m) => m >= hm(13) && m < hm(14)), 'his break on ' + day);
  }
  assert.deepEqual(slots('2026-11-18'), [hm(9, 30), hm(10), hm(10, 30), hm(11), hm(11, 30)], 'a school Wednesday: the morning only');
  assert.deepEqual(slots('2026-11-19'), [], 'a school Thursday: CFA');
  assert.deepEqual([slots('2026-12-16').at(-1), slots('2026-12-17')], [hm(11, 30), []], 'the last school week before Christmas');
  // the Christmas holidays (zone B: after class on Saturday 19 December, back on Monday 4 January): the full week, Thursday included
  assert.deepEqual(ends(slots('2026-12-23')), full, 'a holiday Wednesday, afternoon included');
  assert.ok(slots('2026-12-23').includes(hm(15)));
  assert.deepEqual(ends(slots('2026-12-24')), full, 'a holiday Thursday: he is at the salon');
  assert.deepEqual(ends(slots('2026-12-31')), full);
  // back to school: Wednesday 6 January from noon, Thursday 7
  assert.deepEqual([slots('2027-01-06').at(-1), slots('2027-01-07')], [hm(11, 30), []]);
  // the absences are the owner's to see and to remove: one he removes frees the day, and the next run posts it again
  const s = t.s(), aland = byName(s, 'Aland').id;
  const thu = [...s.timeoff.values()].find((x) => x.staffId === aland && x.from === '2026-11-26');
  assert.deepEqual([thu.reason, thu.to, thu.startMin], ['CFA', '2026-11-26', undefined]);
});

test('Christmas and the New Year: open on Monday 21 and 28 December like a Tuesday, closed on the 25th, 26th, 1st and 2nd, back on Tuesday 5 January', async () => {
  const t = await fresh();
  const { rt, b, s } = t;
  await b.post('/api/v1/preset/apply', {});
  // the two Mondays: each barber his Tuesday hours, break and early leave included; Aland is on holiday from school
  const tuesday = { JKut: [hm(9, 30), hm(17, 30)], Esteban: [hm(9, 30), hm(17, 30)], Aland: [hm(9, 30), hm(17, 30)], 'Le Soldat': [hm(9, 30), hm(15)], Frank: [hm(9), hm(16, 30)] };
  for (const mon of ['2026-12-21', '2026-12-28']) {
    assert.equal(weekday(mon), 1);
    for (const name of TEAM) {
      const m = slotsOf(t, name, mon);
      assert.deepEqual(ends(m), tuesday[name], name + ' on ' + mon);
      assert.deepEqual(m, slotsOf(t, name, addDays(mon, 1)), name + ': ' + mon + ' is worked like the Tuesday after');
      assert.equal(m.some((x) => x >= hm(13) && x < hm(14)), name === 'Frank' || name === 'Le Soldat', name + ': lunch on ' + mon);
    }
  }
  // an ordinary Monday stays closed
  for (const name of TEAM) assert.deepEqual(slotsOf(t, name, '2026-12-14'), [], name);
  // closed: 25 and 26 December, 1 and 2 January; open on the 22nd, 23rd, 24th, 29th, 30th, 31st; back on Tuesday 5 January
  for (const day of ['2026-12-25', '2026-12-26', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']) for (const name of TEAM) assert.deepEqual(slotsOf(t, name, day), [], name + ' on ' + day);
  for (const day of ['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-05']) assert.ok(slotsOf(t, 'JKut', day).length > 0, 'open on ' + day);
  // the public site: the same slots, and the days said in its notices
  const pub = await browser(rt).get('/api/public/availability?from=2026-12-21&days=1&services=' + bySlug(s(), 'cl').id + '&staff=' + byName(s(), 'Le Soldat').id);
  assert.deepEqual([pub.json.days[0].slots[0].m, pub.json.days[0].slots.at(-1).m], [hm(9, 30), hm(15)]);
  const shut = await browser(rt).get('/api/public/availability?from=2026-12-25&days=2&services=' + bySlug(s(), 'cl').id);
  assert.deepEqual(shut.json.days.map((d) => d.slots.length), [0, 0]);
  const site = (await browser(rt).get('/api/public/salon')).json;
  assert.deepEqual([site.openings.map((x) => x.day), site.closures.map((c) => c.from)], [['2026-12-21', '2026-12-28'], ['2026-12-25', '2027-01-01']]);
  // « comme un mardi » for the barbers an opening names only: they work their Tuesday hours, the others stay home
  const named = [...s().settings.openings.map(({ id: _id, ...o }) => o), { day: '2026-12-14', intervals: [[hm(9), hm(18)]], label: 'Lundi de décembre', staff: [byName(s(), 'JKut').id, byName(s(), 'Le Soldat').id], like: 2 }];
  await rt.engine.run(updateSettings, { openings: named }, asOwnerOf(s()));
  assert.deepEqual(['JKut', 'Le Soldat', 'Frank', 'Esteban', 'Aland'].map((n) => ends(slotsOf(t, n, '2026-12-14'))), [[hm(9, 30), hm(17, 30)], [hm(9, 30), hm(15)], [undefined, undefined], [undefined, undefined], [undefined, undefined]]);
  assert.ok(!slotsOf(t, 'JKut', '2026-12-14').includes(hm(13)), 'his lunch break too');
  assert.equal((await b.patch('/api/v1/settings', { openings: [{ day: '2026-12-14', intervals: [[hm(9), hm(18)]], like: 7 }] })).status, 400, 'a weekday is 0 to 6');
  // an opening the owner already made for that Monday is his: the preset leaves it
  const mine = await fresh();
  await mine.rt.engine.run(updateSettings, { openings: [{ day: '2026-12-21', intervals: [[600, 900]], label: 'Mon lundi' }] }, asOwnerOf(mine.s()));
  const plan = (await mine.b.get('/api/v1/preset')).json;
  assert.deepEqual(plan.openings.map((x) => x.status), ['exists', 'create']);
  await mine.b.post('/api/v1/preset/apply', {});
  assert.deepEqual(mine.s().settings.openings.map((x) => [x.day, x.intervals, x.label, x.like]), [['2026-12-21', [[600, 900]], 'Mon lundi', undefined], ['2026-12-28', [[hm(9), hm(18)]], 'Ouverture exceptionnelle', 2]]);
});

test('the zone B holidays are the official ones (service-public.gouv.fr, read on 16 November 2026), and a year nobody published is not guessed', async () => {
  assert.deepEqual([ZONE_B.zone, ZONE_B.academie, ZONE_B.source, ZONE_B.read], ['B', 'Aix-Marseille', 'https://www.service-public.gouv.fr/particuliers/vosdroits/F31952', '2026-11-16']);
  assert.deepEqual(ZONE_B.years.map((y) => [y.id, y.start, y.end, ...y.holidays.map((h) => h.name + ' ' + h.after + ' ' + h.back)]), [
    ['2026-2027', '2026-09-01', '2027-07-03', 'Toussaint 2026-10-17 2026-11-02', 'Noël 2026-12-19 2027-01-04', 'Hiver 2027-02-20 2027-03-08', 'Printemps 2027-04-17 2027-05-03'],
    ['2027-2028', '2027-09-02', '2028-07-04', 'Toussaint 2027-10-23 2027-11-08', 'Noël 2027-12-18 2028-01-03', 'Hiver 2028-02-05 2028-02-21', 'Printemps 2028-04-08 2028-04-24']
  ]);
  // every holiday starts after class on a Saturday and ends on a Monday morning
  for (const y of ZONE_B.years) for (const h of y.holidays) assert.deepEqual([weekday(h.after), weekday(h.back)], [6, 1], y.id + ' ' + h.name);
  // the day class ends is a school day, the next one a holiday, the day class resumes a school day
  assert.deepEqual(['2026-12-19', '2026-12-20', '2027-01-03', '2027-01-04', '2027-02-20', '2027-03-07', '2027-03-08', '2027-07-03'].map((d) => schoolDay(d)), ['school', 'holiday', 'holiday', 'school', 'school', 'holiday', 'school', 'school']);
  // the summer belongs to the year that follows it; after the last year known, nothing is known
  assert.deepEqual([schoolDay('2027-07-04'), schoolDay('2027-09-01'), schoolDay('2027-09-02'), schoolDay('2028-07-04'), schoolDay('2028-07-05'), schoolDay('2028-09-04')], ['holiday', 'holiday', 'school', 'school', null, null]);
  assert.deepEqual([schoolYearOf('2026-11-17').id, schoolYearOf('2027-07-10').id, schoolYearOf('2028-07-05')], ['2026-2027', '2027-2028', null]);

  // a run after the summer starts posts the next school year: from the first Wednesday after 2 September 2027
  const next = await fresh({ day: '2027-08-24' });
  const plan = (await next.b.get('/api/v1/preset')).json;
  assert.deepEqual([plan.school.year, plan.school.from, plan.school.until, plan.school.unconfirmed], ['2027-2028', '2027-09-02', '2028-06-29', false]);
  assert.ok(plan.school.days.every((d) => schoolDay(d.day) === 'school' && [3, 4].includes(weekday(d.day))));
  assert.ok(!plan.school.days.some((d) => d.day < '2027-09-02'), 'nothing during the summer: he works his full week');
  // once the calendar ends, the plan says so in the owner's words and posts nothing
  const far = await fresh({ day: '2028-09-05' });
  const unknown = (await far.b.get('/api/v1/preset')).json;
  assert.deepEqual([unknown.school.unconfirmed, unknown.school.days.length, unknown.count.cfa], [true, 0, 0]);
  assert.ok(unknown.notes.some((n) => /^Vacances scolaires non confirmées .* : à vérifier\./.test(n)), unknown.notes.join(' | '));
  for (const n of unknown.notes) assert.ok(!n.includes('—'));
});

test('running it twice changes nothing: not one event more', async () => {
  const { rt, b, s } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  const v = s().version, n = rt.engine.journal.length;
  const again = await b.post('/api/v1/preset/apply', {});
  assert.equal(again.status, 200);
  assert.deepEqual(again.json.done, { hours: 0, rules: 0, closures: 0, openings: 0, services: 0, updates: 0, team: 0, schedules: 0, absences: 0, cfa: 0, photos: 0, written: 0 });
  assert.equal(s().version, v);
  assert.equal(rt.engine.journal.length, n);
  assert.equal([...s().staff.values()].filter((x) => x.role === 'barber').length, 4);
  assert.equal([...s().staff.values()].length, 5, 'the owner (Frank’s chair) and four barbers');
  assert.equal(s().staffPhotos.size, 5);
  assert.equal(s().services.size, 12);
  assert.equal(s().timeoff.size, 2 + CFA);
  assert.deepEqual([s().settings.closures.length, s().settings.openings.length], [2, 2]);
  // a third, part by part
  for (const part of PRESET_PARTS) assert.equal((await b.post('/api/v1/preset/apply', { parts: [part] })).json.done.written, 0, part);
  assert.equal(rt.engine.journal.length, n);
  assert.equal((await b.post('/api/v1/preset/apply', { parts: ['clients'] })).status, 400);
  // weeks later, the CFA days already posted are not posted twice, and those behind us are nobody's business
  const t2 = await fresh();
  await t2.b.post('/api/v1/preset/apply', {});
  t2.clock.now = instantOf('2027-03-09', 600);
  // (the owner's session of November is over by then: the plan and the commands are read straight from the engine)
  const as = asOwnerOf(t2.s()), aland = byName(t2.s(), 'Aland').id;
  const planNow = () => presetPlan(t2.s(), ARCHITECTE, { today: '2027-03-09' });
  const later = planNow();
  assert.deepEqual([later.todo, later.school.from, later.school.days.every((d) => d.status === 'exists')], [0, '2027-03-10', true]);
  assert.equal((await applyPreset(t2.rt.engine, ARCHITECTE, {}, as)).written, 0);
  // a CFA day the owner removed is offered again (the plan says which), and posted once
  const off = (day) => [...t2.s().timeoff.values()].filter((x) => x.staffId === aland && x.from === day);
  await t2.rt.engine.run(removeTimeOff, { id: off('2027-03-11')[0].id }, as);
  assert.deepEqual(planNow().school.days.filter((d) => d.status === 'create').map((d) => d.day), ['2027-03-11']);
  assert.equal((await applyPreset(t2.rt.engine, ARCHITECTE, {}, as)).cfa, 1);
  assert.equal(off('2027-03-11').length, 1);
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
  // the helper's owner (« Patron », no chair yet) takes Frank's chair
  assert.deepEqual(plan.team.map((x) => x.status), ['exists', 'create', 'chair', 'create', 'create']);
  assert.equal(plan.team[2].account, 'Patron');
  // JKut's week is the owner's own: said as kept, with the week he has
  assert.deepEqual([plan.team[0].hours, plan.team[0].now[1], plan.count.schedules], ['kept', [[600, 1080]], 0]);

  const done = await applyPreset(t.engine, ARCHITECTE, {}, as);
  assert.deepEqual([done.hours, done.rules, done.team], [0, 1, 4]);
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

test('the owner who cuts too: his account of the setup screen gets his chair, week, colour and initials, not a second « Frank »', async () => {
  // whatever first name he typed at setup: Frank, Frank R., or another
  for (const name of ['Frank', 'Frank R.', 'Le patron']) {
    const { b, s } = await fresh({ owner: { ...OWNER, name } });
    const plan = (await b.get('/api/v1/preset')).json;
    assert.deepEqual(plan.team.map((x) => [x.name, x.status]), [['JKut', 'create'], ['Le Soldat', 'create'], ['Frank', 'chair'], ['Esteban', 'create'], ['Aland', 'create']], name);
    const line = plan.team[2];
    assert.deepEqual([line.owner, line.account], [true, name === 'Frank' ? '' : name]);
    assert.equal(plan.notes[0], 'Frank est le gérant : ' + (name === 'Frank' ? 'ton compte' : 'ton compte « ' + name + ' »') + ' reçoit son fauteuil, sa semaine, sa couleur et ses initiales. Aucun second compte « Frank » n’est créé.');
    await b.post('/api/v1/preset/apply', {});
    const all = [...s().staff.values()];
    assert.equal(all.filter((x) => /frank/i.test(x.name)).length, name.startsWith('Frank') ? 1 : 0, name);
    const owner = all.find((x) => x.role === 'owner');
    assert.deepEqual([owner.name, owner.chair, owner.bookable, owner.schedule[3], owner.color, owner.initials], [name, true, true, [[540, 810]], '#F5B544', 'FR'], name);
    assert.equal(all.length, 5, name + ': the owner and four barbers');
    const after = (await b.get('/api/v1/preset')).json;
    assert.equal(after.todo, 0, name);
    // once in place, the plan still knows whose chair it is, and stops saying it will give it
    assert.deepEqual([after.team[2].status, after.team[2].owner], ['exists', true]);
    assert.ok(!after.notes[0].startsWith('Frank est le gérant'));
  }
});

test('a « Frank » already in the team (an earlier run) stays Frank: the owner is not given his chair', async () => {
  const t = await salon({ day: TUE });
  const as = t.asOwner();
  const frank = (await t.engine.run(addStaff, { name: 'Frank', role: 'barber', schedule: {} }, as)).id;
  const plan = presetPlan(t.engine.state, ARCHITECTE, { today: TUE });
  const line = plan.team.find((x) => x.name === 'Frank');
  assert.deepEqual([line.id, line.owner, line.status], [frank, false, 'exists']);
  assert.deepEqual(plan.staffAliases, {});
  await applyPreset(t.engine, ARCHITECTE, {}, as);
  assert.equal(t.engine.state.staff.get(t.ownerId).chair, false, 'the owner keeps no chair he did not ask for');
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
  assert.equal(s().staffPhotos.size, 0);
});

test('days off known on the old site: posted once from today on, never for days already past', async () => {
  const late = await fresh({ day: '2026-12-10' });
  const plan = (await late.b.get('/api/v1/preset')).json;
  // the old site's days off of 13 and 14 November are gone from the preset: they were past before the salon opened
  assert.deepEqual(ARCHITECTE.absences.map((a) => [a.staff, a.from, a.to]), [['Esteban', '2026-11-17', '2026-11-18'], ['Esteban', '2026-12-08', '2026-12-12']]);
  assert.deepEqual(plan.absences.map((a) => [a.from, a.to, a.status]), [['2026-12-10', '2026-11-18', 'past'], ['2026-12-10', '2026-12-12', 'create']]);
  await late.b.post('/api/v1/preset/apply', {});
  const off = [...late.s().timeoff.values()].filter((t) => t.reason !== 'CFA');
  assert.deepEqual(off.map((t) => [late.s().staff.get(t.staffId).name, t.from, t.to]), [['Esteban', '2026-12-10', '2026-12-12']]);
  assert.equal((await late.b.post('/api/v1/preset/apply', {})).json.done.absences, 0);
  // after the last of them, nothing
  const after = await fresh({ day: '2027-01-05' });
  await after.b.post('/api/v1/preset/apply', {});
  assert.equal([...after.s().timeoff.values()].filter((t) => t.reason !== 'CFA').length, 0);
  // the days the salon was closed are behind too: no closure, no opening posted for the past
  assert.deepEqual([after.s().settings.closures, after.s().settings.openings], [[], []]);
  // without the team, no day off is posted for nobody
  const only = await fresh();
  const none = (await only.b.post('/api/v1/preset/apply', { parts: ['absences'] })).json.done;
  assert.deepEqual([none.absences, none.cfa, none.written], [0, 0, 0]);
});

/* ---------------- the old site's names map to the preset on their own ---------------- */

const TITLES = [
  'Formule Coupe Classique 20€', 'Formule Coupe + Contour Barbe 25€', 'Formule Coupe + Taille de Barbe 30€', 'Formule Taille de Barbe 18€',
  'Formule Entretien Barbe 15€', 'Formule Cover Barbe 15€', 'Formule Transformation  50€', 'Formule Décoloration  60€', 'Formule Coloration 30€',
  'Formule Silver 100€', 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées', 'Formule Coupe et coloration 35€'
];
// the old site's names: Aland was never on it (no booking of his to map)
const BARBERS = ['JKut', 'Soldat', 'Frank', 'Esteban'];
const PACK = 'Formule Abonnement  80€ 5 rdv sur 5 semaines d’affilées';

/** An export as the old site writes it, with one invented booking to come per service, the barbers in turn. */
function exportOf(titles) {
  const head = '﻿Réservations,de,à\n,"01 Jan 2026","31 Déc 2026"\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT","Adresse du client",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT,"REMISE APPLIQUÉE","MONTANT TOTAL"\n';
  const rows = titles.map((t, i) => [9000 + i, '"' + (20 + (i % 5)) + ' Nov 2026 ' + (10 + (i % 6)) + ':00"', '"10 Nov 2026 09:00"', 'Client', 'Essai' + i, 'client' + i + '@exemple.fr', '06000000' + String(10 + i), '', '"' + t + '"', BARBERS[i % 4], '', '"' + /(\d+)\s*€/.exec(t)[1] + ' €"', '"Payer plus tard"', '', ''].join(','));
  return head + rows.join('\n') + '\n';
}

test('the 12 old service titles and the 4 barber names map to the preset with no manual step, Frank to the owner’s account', async () => {
  const { b, s, clock } = await fresh();
  await b.post('/api/v1/preset/apply', {});
  assert.deepEqual(ARCHITECTE.services.map((x) => x.wp), TITLES);
  assert.deepEqual(ARCHITECTE.staff.filter((x) => x.wp).map((x) => x.wp), BARBERS);
  assert.deepEqual(ARCHITECTE.staff.filter((x) => !x.wp).map((x) => x.name), ['Aland']);

  const p = W.readFiles([{ name: 'bookings-2026.csv', text: exportOf(TITLES) }], TUE);
  assert.equal(p.bookings.length, 12);
  // the wizard reads a title with its spaces tidied (« Transformation  50€ » has two on the old site)
  const tidy = (t) => t.replace(/\s+/g, ' ');
  assert.deepEqual(W.names(p).services.map(([n]) => n).sort(), TITLES.map(tidy).sort());
  assert.deepEqual(W.names(p).staff.map(([n]) => n).sort(), [...BARBERS].sort());
  const boot = (await b.get('/api/v1/bootstrap')).json;
  const id = (slug) => bySlug(s(), slug).id;

  // the barbers, exactly as the wizard asks (Réglages › Reprendre WordPress: the active chairs, the preset's staffAliases
  // as first guesses). Frank's chair is the owner's account, called « Gérant » here: no name can find it, the alias does
  const chairs = boot.staff.filter((x) => x.active && x.chair);
  const owner = frankOf(s());
  const { staffAliases } = (await b.get('/api/v1/preset')).json;
  assert.deepEqual(staffAliases, { Frank: owner.id });
  assert.equal(W.suggestStaff(p, chairs, clock.now).map.Frank, '', 'by name alone, Frank (bookings to come) would be asked');
  const staff = W.suggestStaff(p, chairs, clock.now, staffAliases);
  assert.deepEqual(staff.guessed, []);
  const chairOf = (n) => (n === 'Frank' ? owner : n === 'Soldat' ? byName(s(), 'Le Soldat') : byName(s(), n)).id;
  for (const n of BARBERS) assert.equal(staff.map[n], chairOf(n), n);
  assert.ok(!Object.values(staff.map).includes(byName(s(), 'Aland').id), 'Aland has no old booking');

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
  // the owner holds Frank's chair and already has his code
  assert.deepEqual((await tablet().get('/api/auth/state')).json.team.map((x) => x.name), ['Gérant']);
  for (const pin of ['', '0000', '1313']) assert.equal((await tablet().post('/api/auth/pin', { staffId: jk, pin })).status, 401);
  assert.equal((await b.post('/api/v1/staff/' + jk + '/phone-link', {})).json.error.code, 'no_pin');
  assert.deepEqual((await b.get('/api/v1/preset')).json.noCode.map((x) => x.name), ['JKut', 'Le Soldat', 'Esteban', 'Aland']);

  // one tap: four codes, four digits, no easy one, all different, never written in clear in the journal
  const r = await b.post('/api/v1/preset/codes', {});
  assert.equal(r.status, 200);
  const codes = r.json.codes;
  assert.deepEqual(codes.map((c) => c.name), ['JKut', 'Le Soldat', 'Esteban', 'Aland']);
  for (const c of codes) assert.match(c.pin, /^\d{4}$/);
  assert.equal(new Set(codes.map((c) => c.pin)).size, 4);
  for (const c of codes) assert.ok(!JSON.stringify(rt.engine.journal).includes('"' + c.pin + '"'));
  assert.ok([...s().staff.values()].filter((x) => x.role === 'barber').every((x) => x.hasPin));

  // now each one is on the tablet and enters with his own code, into his own space, with a barber's rights only
  assert.deepEqual((await tablet().get('/api/auth/state')).json.team.map((x) => x.name), ['Gérant', 'JKut', 'Le Soldat', 'Esteban', 'Aland']);
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
  const frank = frankOf(s());
  await rt.engine.run(updateStaff, { id: frank.id, patch: { schedule: { ...frank.schedule, 3: [] } } }, as);
  assert.equal((await b.post('/api/v1/preset/apply', {})).json.done.written, 0);
  assert.deepEqual(frankOf(s()).schedule[3], []);
});

test('a salon that applied the earlier preset is offered the new hours, before and after; hours changed by hand since are kept; nobody is moved', async () => {
  const t = await fresh();
  const { rt, b, s } = t;
  const as = asOwnerOf(s());
  // the salon as the preset of 14 November put it in place: 8 h 30 – 18 h 30, Frank until 16 h 30, Aland without a week
  await applyPreset(rt.engine, BEFORE, {}, as);
  assert.deepEqual([s().settings.hours[2], frankOf(s()).schedule[2], byName(s(), 'Le Soldat').schedule[6], byName(s(), 'Aland').bookable, s().timeoff.size], [[[hm(8, 30), hm(18, 30)]], [[hm(9), hm(16, 30)]], [[hm(9), hm(18)]], false, 2]);
  // since then the owner changed Frank's Wednesday by hand, and two clients booked: Le Soldat on Saturday at 9 h (he
  // will start at 9 h 30), JKut on Saturday 26 December (the salon will be closed)
  const hand = { ...frankOf(s()).schedule, 3: [[hm(10), hm(12)]] };
  await rt.engine.run(updateStaff, { id: frankOf(s()).id, patch: { schedule: hand } }, as);
  const cut = bySlug(s(), 'cl').id;
  const a1 = (await rt.engine.run(createAppointment, { serviceIds: [cut], staffId: byName(s(), 'Le Soldat').id, day: '2026-11-21', start: hm(9), name: 'Client Essai' }, as)).id;
  const a2 = (await rt.engine.run(createAppointment, { serviceIds: [cut], staffId: byName(s(), 'JKut').id, day: '2026-12-26', start: hm(10), name: 'Client Essai' }, as)).id;

  const v = s().version;
  const p = (await b.get('/api/v1/preset')).json;
  assert.equal(s().version, v, 'reading the plan writes nothing');
  // the salon's hours: the earlier preset's, so today's replace them, and the plan shows both
  assert.deepEqual([p.hours.status, p.hours.was, p.hours.now[2], p.hours.to[2]], ['set', true, [[hm(8, 30), hm(18, 30)]], [[hm(9), hm(18)]]]);
  // barber by barber: JKut and Esteban already have these hours; Le Soldat and Aland still have the earlier preset's
  // (before and after are shown); Frank's week was changed by hand, it is kept
  assert.deepEqual(p.team.map((x) => [x.name, x.status, x.hours]), [['JKut', 'exists', null], ['Le Soldat', 'exists', 'update'], ['Frank', 'exists', 'kept'], ['Esteban', 'exists', null], ['Aland', 'exists', 'update']]);
  const soldat = p.team[1], aland = p.team[4];
  assert.deepEqual([soldat.now[6], soldat.schedule[6], soldat.goOnline], [[[hm(9), hm(18)]], [[hm(9, 30), hm(18)]], false]);
  assert.deepEqual([Object.values(aland.now).flat(), aland.schedule[2], aland.goOnline], [[], [[hm(9, 30), hm(13)], [hm(14), hm(18)]], true]);
  assert.deepEqual(p.team[2].now[3], [[hm(10), hm(12)]]);
  assert.deepEqual(p.count, { hours: 1, rules: 0, closures: 2, openings: 2, services: 0, updates: 0, team: 0, schedules: 2, absences: 0, cfa: CFA, photos: 0 });
  // the two bookings the new hours leave outside are counted, by barber, and said in plain words
  assert.deepEqual(p.stranded, { count: 2, by: [{ name: 'JKut', id: byName(s(), 'JKut').id, count: 1 }, { name: 'Le Soldat', id: byName(s(), 'Le Soldat').id, count: 1 }] });
  assert.ok(p.notes.some((n) => n.startsWith('2 rendez-vous déjà pris tombent en dehors de ces horaires (JKut : 1, Le Soldat : 1). Aucun n’est déplacé')), p.notes.join(' | '));
  for (const n of p.notes) assert.ok(!n.includes('—'));

  // nothing changes until he confirms; then exactly that
  const r = await b.post('/api/v1/preset/apply', {});
  assert.deepEqual({ ...r.json.done, written: 0 }, { hours: 1, rules: 0, closures: 2, openings: 2, services: 0, updates: 0, team: 0, schedules: 2, absences: 0, cfa: CFA, photos: 0, written: 0 });
  assert.deepEqual(s().settings.hours[2], [[hm(9), hm(18)]]);
  assert.deepEqual(byName(s(), 'Le Soldat').schedule[6], [[hm(9, 30), hm(18)]]);
  assert.deepEqual([byName(s(), 'Aland').schedule[5], byName(s(), 'Aland').bookable], [[[hm(9, 30), hm(13)], [hm(14), hm(18)]], true]);
  assert.deepEqual(frankOf(s()).schedule, hand, 'the week he changed by hand is still his, the other days too');
  assert.deepEqual(ends(slotsOf(t, 'Frank', '2026-11-19')), [hm(9), hm(16)], 'so Frank keeps the earlier last cut until he changes it himself');
  // the two appointments are where they were, untouched
  for (const [id, day, start] of [[a1, '2026-11-21', hm(9)], [a2, '2026-12-26', hm(10)]]) assert.deepEqual([s().appts.get(id).day, s().appts.get(id).start, s().appts.get(id).status], [day, start, 'booked']);
  // the plan still counts them once applied, and nothing else is left to do; a second run writes nothing
  const after = r.json.plan;
  assert.deepEqual([after.todo, after.stranded.count, after.team[2].hours, after.team[1].hours, after.hours.status], [0, 2, 'kept', null, 'same']);
  assert.equal((await b.post('/api/v1/preset/apply', {})).json.done.written, 0);
  // the team alone (a manager's part) updates the weeks and nothing else
  const t3 = await fresh();
  await applyPreset(t3.rt.engine, BEFORE, {}, asOwnerOf(t3.s()));
  const d3 = (await t3.b.post('/api/v1/preset/apply', { parts: ['team'] })).json.done;
  assert.deepEqual([d3.schedules, d3.hours, d3.cfa, d3.closures], [3, 0, 0, 0]);
  assert.deepEqual(frankOf(t3.s()).schedule[3], [[hm(9), hm(13, 30)]], 'Frank’s untouched week follows');
});
