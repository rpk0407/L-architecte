// WP3 · the « home » read (server/domain/home.js): the moment, the sentence, the day (appointments, next, chairs) and
// the cards to deal with, scoped by role and rights. The amendment: every role gets it; a barber gets his own chair,
// his own appointments, no amount of the salon and no card of the owner. `chairs` is checked against the agenda's own
// rules (domain/availability.js freeSlots and isFree), never against a copy of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at } from '../helpers.js';
import { home, RELANCES_MIN, MAX_APPTS, MAX_TAKE, MAX_FACTS, MAX_PREVIEW, CARD_IDS, GROUPS, LATE_MIN } from '../../server/domain/home.js';
import { rebookable, relances } from '../../server/domain/rebook.js';
import { freeSlots, isFree } from '../../server/domain/availability.js';
import { cockpit } from '../../server/domain/cockpit.js';
import { clientStats } from '../../server/domain/insights.js';
import { capsOf } from '../../server/domain/permissions.js';
import { localParts } from '../../shared/dates.js';
import { addStaff, addTimeOff, setPrefs } from '../../server/commands/team.js';
import { addClient } from '../../server/commands/clients.js';
import { createAppointment, setStatus, addBlock, holdSlot } from '../../server/commands/agenda.js';
import { checkout, closeDay } from '../../server/commands/sales.js';
import { closePeriod } from '../../server/commands/fiscal.js';
import { adjustStock } from '../../server/commands/catalog.js';
import { receiveInquiry } from '../../server/commands/inquiries.js';
import { updateSettings, addClosure } from '../../server/commands/shop.js';
import { HOMES, HOME_DAYS } from '../../server/projections/staffprefs.js';

const TUE = '2026-11-03', SUN = '2026-11-08';
/** fmtTime and fmtDur write a narrow no-break space inside an hour */
const NB = /[\u00a0\u202f]/g;
const WEEK = { 2: [[540, 780], [810, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };

/** the read, for the owner or for a named member of the fixture */
const view = (t, name) => home(t.engine.state, name ? t.engine.state.staff.get(t.ids[name]) : t.engine.state.staff.get(t.ownerId), t.clock.now);
const card = (v, id) => v.cards.find((c) => c.id === id);
const go = (t, day, h, m = 0) => { t.clock.now = at(day, h, m); };
async function person(t, name, role, extra = {}) {
  t.ids[name] = (await t.engine.run(addStaff, { name, role, ...extra }, t.asOwner())).id;
  return t.ids[name];
}
async function book(t, staff, start, { clientId, client, serviceId, day = TUE } = {}) {
  return (await t.engine.run(createAppointment, { staffId: t.ids[staff], day, start, serviceIds: [serviceId || t.ids.cut], ...(client ? { client } : { clientId: clientId || t.ids.yanis }) }, t.asOwner())).id;
}
const prefs = (t, name, p) => t.engine.run(setPrefs, { staffId: name ? t.ids[name] : t.ownerId, prefs: p }, name ? t.asStaff(name) : t.asOwner());
/** every key named `amount`, and every fact in euros, anywhere in the answer */
function money(v) {
  const out = [];
  JSON.stringify(v, (k, x) => { if (k === 'amount' || (x && typeof x === 'object' && x.unit === 'eur')) out.push(k); return x; });
  return out;
}

/* ---------------- the moment and the sentence ---------------- */

test('moment: four clocks, the sentence in three facts at most, money only with report.shop', async () => {
  const t = await salon({ day: TUE, hour: 7 });
  await book(t, 'Ali', 600);
  const want = [[TUE, 7, 40, 'avant'], [TUE, 15, 10, 'pendant'], [TUE, 19, 30, 'apres'], [SUN, 10, 0, 'ferme']];
  for (const [day, h, m, moment] of want) {
    go(t, day, h, m);
    const v = view(t), b = view(t, 'Ali');
    assert.equal(v.moment, moment, day + ' ' + h + ':' + m);
    assert.equal(b.moment, moment, 'the moment is the salon’s, the same for everyone');
    assert.equal(v.asOf, t.clock.now);
    assert.ok(v.line.label && v.line.facts.length <= MAX_FACTS && b.line.facts.length <= MAX_FACTS);
    assert.ok(v.line.facts.some((f) => f.unit === 'eur'), 'the owner reads the salon’s money at ' + moment);
    assert.deepEqual(money(b), [], 'a barber reads no amount at ' + moment);
  }
  go(t, TUE, 7, 40);
  const v = view(t), c = cockpit(t.engine.state, { range: 'day', day: TUE, today: TUE, now: t.clock.now });
  assert.match(v.line.label, /^Mardi 3 novembre · ouverture à 9 h$/);
  // every number of the sentence is the cockpit's
  assert.deepEqual(v.line.facts.map((f) => [f.k, f.v]), [['rdv', c.today.count], ['prevus', c.today.planned], ['libres', c.today.freeMin]]);
  assert.equal(c.today.count, 1);
});

test('finDeMois: the last three open days of the month and the first five of the next', async () => {
  const t = await salon({ day: TUE, hour: 10 });
  const is = (day) => { go(t, day, 10); return view(t).finDeMois; };
  assert.equal(is('2026-11-03'), true);
  assert.equal(is('2026-11-05'), true);
  assert.equal(is('2026-11-06'), false);
  assert.equal(is('2026-11-25'), false);
  // November 2026 ends on a closed Monday: its last three open days are Thursday 26, Friday 27 and Saturday 28
  assert.equal(is('2026-11-26'), true);
  assert.equal(is('2026-11-28'), true);
  assert.equal(is('2026-11-29'), true, 'a closed day inside the window');
});

/* ---------------- the day: appointments, next, chairs ---------------- */

/** `chairs` against the agenda's own rules: the free minutes from isFree, the services from freeSlots (the /slots read). */
function consistent(t, v, label) {
  const s = t.engine.state, now = t.clock.now, L = localParts(now);
  const services = [...s.services.values()].filter((x) => x.active && !x.pack).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const c of v.day.chairs) {
    let free = 0;
    while (L.min + free < 1440 && !s.closures.has(L.day) && isFree(s, c.staffId, L.day, L.min + free, 1, { now })) free++;
    assert.equal(c.freeMin, free, label + ' · ' + c.name + ' freeMin');
    assert.equal(c.state === 'libre', free > 0, label + ' · ' + c.name + ' state ' + c.state);
    const fits = services.filter((sv) => freeSlots(s, { day: L.day, dur: sv.dur + (sv.buffer || 0), serviceIds: [sv.id], staffId: c.staffId, now, local: L, online: false, step: 1 }).some((x) => x.m === L.min));
    assert.deepEqual(c.canTake.map((x) => x.serviceId), fits.slice(0, MAX_TAKE).map((x) => x.id), label + ' · ' + c.name + ' canTake');
    for (const x of c.canTake) assert.equal(x.short, s.services.get(x.serviceId).short || s.services.get(x.serviceId).name);
    if (c.state === 'libre') assert.equal(c.until, L.min + free);
  }
}

test('chairs: the same answer as the agenda’s availability at fixed clocks (break, closed day, after closing, hold, block, absence)', async () => {
  const t = await salon({ day: TUE, hour: 8 });
  const s = () => t.engine.state;
  await book(t, 'Ali', 600);                                             // Ali 10:00-10:30
  await book(t, 'Ben', 900, { serviceId: t.ids.color, client: { first: 'Zinedine', last: 'Zidane', phone: '06 99 88 77 66' } }); // Ben 15:00-16:00
  await t.engine.run(addBlock, { staffId: t.ids.Ben, day: TUE, start: 660, dur: 30, label: 'Formation' }, t.asOwner()); // Ben 11:00-11:30
  const chair = (v, name) => v.day.chairs.find((c) => c.name === name);

  go(t, TUE, 8, 0);
  let v = view(t);
  consistent(t, v, '08:00');
  assert.deepEqual(v.day.chairs.map((c) => [c.name, c.state, c.until, c.freeMin, c.canTake.length]), [['Ali', 'ferme', 540, 0, 0], ['Ben', 'ferme', 540, 0, 0]]);

  go(t, TUE, 9, 40);
  v = view(t);
  consistent(t, v, '09:40');
  assert.deepEqual([chair(v, 'Ali').state, chair(v, 'Ali').freeMin, chair(v, 'Ali').until], ['libre', 20, 600]);
  assert.deepEqual(chair(v, 'Ali').canTake, [], '20 minutes before his next client: no 30-minute cut fits');
  assert.equal(chair(v, 'Ben').freeMin, 80, 'free until his block at 11:00');
  assert.equal(chair(v, 'Ben').canTake.length, MAX_TAKE);

  go(t, TUE, 10, 10);
  v = view(t);
  consistent(t, v, '10:10');
  assert.deepEqual([chair(v, 'Ali').state, chair(v, 'Ali').until], ['occupe', 630]);

  go(t, TUE, 11, 5);
  v = view(t);
  consistent(t, v, '11:05');
  assert.deepEqual([chair(v, 'Ben').state, chair(v, 'Ben').until], ['occupe', 690], 'a block posed in the agenda is busy time');

  // Tuesday's break in the fixture: 13:00 to 13:30
  go(t, TUE, 13, 10);
  v = view(t);
  consistent(t, v, '13:10 (break)');
  assert.deepEqual(v.day.chairs.map((c) => [c.state, c.until, c.freeMin]), [['absent', 810, 0], ['absent', 810, 0]]);

  // a slot held on the site takes the time away here too, as in the agenda
  go(t, TUE, 14, 0);
  assert.equal(chair(view(t), 'Ali').freeMin, 1110 - 840);
  await t.engine.run(holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: TUE, start: 870 }, { ...t.asOwner() });
  go(t, TUE, 14, 1);
  v = view(t);
  consistent(t, v, '14:01 (hold)');
  assert.equal(chair(v, 'Ali').freeMin, 29, 'free until the held slot at 14:30');
  assert.deepEqual(chair(v, 'Ali').canTake, []);

  go(t, TUE, 15, 10);
  v = view(t);
  consistent(t, v, '15:10');
  assert.deepEqual([chair(v, 'Ben').state, chair(v, 'Ben').until, chair(v, 'Ben').freeMin], ['occupe', 960, 0]);

  go(t, TUE, 19, 30);
  v = view(t);
  consistent(t, v, '19:30 (after closing)');
  assert.deepEqual(v.day.chairs.map((c) => [c.state, c.until, c.freeMin, c.canTake]), [['ferme', null, 0, []], ['ferme', null, 0, []]]);

  go(t, SUN, 11, 0);
  v = view(t);
  consistent(t, v, 'Sunday (closed)');
  assert.deepEqual(v.day.chairs.map((c) => [c.state, c.until]), [['ferme', null], ['ferme', null]]);
  assert.deepEqual(v.day.appts, []);
  assert.equal(v.day.next, null);

  // an exceptional closure, and an absence on an open day
  await t.engine.run(addClosure, { from: '2026-11-11', to: '2026-11-11', label: 'Armistice' }, t.asOwner());
  go(t, '2026-11-11', 11, 0);
  v = view(t);
  consistent(t, v, 'closure');
  assert.equal(v.moment, 'ferme');
  assert.ok(v.day.chairs.every((c) => c.state === 'ferme'));
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: '2026-11-12', to: '2026-11-12', reason: 'Congé' }, t.asOwner());
  go(t, '2026-11-12', 11, 0);
  v = view(t);
  consistent(t, v, 'time off');
  assert.deepEqual([chair(v, 'Ben').state, chair(v, 'Ben').until, chair(v, 'Ali').state], ['absent', null, 'libre']);
  assert.ok(s().timeoff.size === 1);
});

test('chairs: a client still in the chair after his slot keeps the chair busy; a sealed day takes nobody', async () => {
  const t = await salon({ day: TUE, hour: 10 });
  const id = await book(t, 'Ali', 600);
  await t.engine.run(setStatus, { id, status: 'arrived' }, t.asOwner());
  await t.engine.run(setStatus, { id, status: 'in_chair' }, t.asOwner());
  go(t, TUE, 10, 40);
  let ali = view(t).day.chairs.find((c) => c.name === 'Ali');
  assert.deepEqual([ali.state, ali.until, ali.freeMin, ali.canTake], ['occupe', null, 0, []]);
  assert.equal(view(t).day.appts[0].status, 'in_chair');
  await t.engine.run(checkout, { apptId: id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  go(t, TUE, 10, 41);
  ali = view(t).day.chairs.find((c) => c.name === 'Ali');
  assert.equal(ali.state, 'libre');
  await t.engine.run(closeDay, { early: true }, t.asOwner());
  go(t, TUE, 10, 42);
  const v = view(t);
  consistent(t, v, 'sealed day');
  assert.ok(v.day.chairs.every((c) => c.state === 'ferme' && !c.canTake.length), 'after the Z nothing could be paid: nobody is taken');
});

test('day: today from now on, next first, twelve at most and the rest counted', async () => {
  const t = await salon({ day: TUE, hour: 8 });
  const starts = [];
  for (let m = 540; m < 780; m += 30) { starts.push(m); await book(t, 'Ali', m, { client: { first: 'Client' + m, last: 'Test', phone: '06 00 00 ' + String(m).slice(0, 2) + ' ' + String(m).padStart(4, '0').slice(2) } }); }
  for (let m = 540; m < 780; m += 30) await book(t, 'Ben', m, { client: { first: 'Autre' + m, last: 'Test', phone: '06 11 11 ' + String(m).slice(0, 2) + ' ' + String(m).padStart(4, '0').slice(2) } });
  go(t, TUE, 8, 30);
  let v = view(t);
  assert.equal(v.day.appts.length, MAX_APPTS);
  assert.equal(v.day.more, 16 - MAX_APPTS);
  assert.deepEqual(v.day.appts.map((a) => a.start), [...v.day.appts.map((a) => a.start)].sort((a, b) => a - b), 'next first');
  assert.deepEqual(Object.keys(v.day.appts[0]).sort(), ['client', 'dur', 'id', 'services', 'staffId', 'start', 'status']);
  assert.equal(v.day.appts[0].client, 'Client540 T.', 'first name and initial, as the agenda shows it');
  assert.equal(v.day.appts[0].services, 'Coupe');
  assert.deepEqual(v.day.next, v.day.appts[0]);
  // the count is the cockpit's « still to come » (commands/sales.js remainingAppts)
  const c = cockpit(t.engine.state, { range: 'day', day: TUE, today: TUE, now: t.clock.now });
  assert.equal(v.day.appts.length + v.day.more, c.cash.remaining);
  go(t, TUE, 12, 40);
  v = view(t);
  assert.equal(v.day.appts.length + v.day.more, cockpit(t.engine.state, { range: 'day', day: TUE, today: TUE, now: t.clock.now }).cash.remaining);
  assert.deepEqual(v.day.appts.map((a) => a.start), [750, 750], 'a slot that is over is no longer « to come »');
  // a barber's first fact says what it counts: his whole day, and how many are still to come (the list under it)
  const b = view(t, 'Ali');
  assert.equal(b.day.appts.length, 1);
  assert.deepEqual(b.line.facts[0], { k: 'rdv', label: 'rendez-vous aujourd’hui · 1 à venir', v: 8 });
  go(t, TUE, 8, 30);
  assert.deepEqual(view(t, 'Ali').line.facts[0], { k: 'rdv', label: 'rendez-vous aujourd’hui · 8 à venir', v: 8 });
  go(t, TUE, 19, 30);
  assert.deepEqual(view(t, 'Ali').line.facts[0], { k: 'rdv', label: 'rendez-vous aujourd’hui', v: 8 });
});

/* ---------------- privacy, role by role ---------------- */

test('privacy: a barber gets his own chair, his own appointments, no amount of the salon, no card of the owner', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await person(t, 'Lea', 'desk');
  await book(t, 'Ali', 600);
  await book(t, 'Ali', 900);
  await book(t, 'Ben', 630, { client: { first: 'Zinedine', last: 'Zidane', phone: '06 99 88 77 66' } });
  await book(t, 'Ben', 930, { client: { first: 'Thierry', last: 'Henry', phone: '06 99 88 77 55' } });
  // what an owner's Accueil would fill with cards
  await t.engine.run(adjustStock, { id: t.ids.oil, delta: -9, reason: 'Casse' }, t.asOwner());
  await t.engine.run(receiveInquiry, { kind: 'contact', first: 'Karim', phone: '06 12 12 12 12', message: 'Bonjour, vous prenez les enfants ?' }, t.asClient);
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: '2026-11-20', to: '2026-11-21', reason: 'Mariage' }, t.asStaff('Ben'));
  go(t, TUE, 10, 45); // Ali's 10:00 is over and unpaid, Ben's 10:30 is running

  const owner = view(t), ali = view(t, 'Ali'), lea = view(t, 'Lea');
  // the owner: everything
  assert.deepEqual(owner.day.chairs.map((c) => c.name), ['Ali', 'Ben']);
  assert.equal(owner.day.scope, 'salon');
  assert.ok(owner.day.appts.some((a) => a.client === 'Zinedine Z.'));
  assert.ok(money(owner).length > 0);
  assert.ok(['absence-demande', 'demandes', 'stock', 'encaisser'].every((id) => card(owner, id)), owner.cards.map((c) => c.id).join());

  // the barber: 200 in the route, and here only what is his
  assert.equal(ali.day.scope, 'moi');
  assert.equal(ali.day.canSwitch, false);
  assert.deepEqual(ali.day.chairs.map((c) => c.staffId), [t.ids.Ali], 'his only chair');
  assert.ok(ali.day.appts.length > 0 && ali.day.appts.every((a) => a.staffId === t.ids.Ali), 'his only appointments');
  assert.equal(ali.day.next.staffId, t.ids.Ali);
  const text = JSON.stringify(ali);
  for (const w of ['Zinedine', 'Thierry', 'Karim', 'Ben', t.ids.Ben, 'Mariage', 'Huile']) assert.ok(!text.includes(w), 'nothing of « ' + w + ' » reaches Ali');
  assert.deepEqual(money(ali), [], 'no amount, no fact in euros');
  assert.deepEqual(ali.cards.map((c) => c.id).sort(), ['encaisser', 'prochain'], 'his own « à encaisser », his next client, nothing else');
  assert.equal(card(ali, 'encaisser').count, 1);
  assert.equal(card(owner, 'encaisser').count, 1);
  assert.equal(card(owner, 'encaisser').amount, 2000);
  assert.ok(ali.cards.every((c) => c.why && c.title && c.action.label));
  // even with « voir l’agenda de tous » (on by default), a barber's Accueil stays his own
  assert.ok(capsOf(t.engine.state.staff.get(t.ids.Ali), t.engine.state.settings).has('agenda.all'));
  // Ben's 10:30 is not Ali's to cash, and his own unpaid one is not Ben's
  const ben = view(t, 'Ben');
  assert.ok(!card(ben, 'encaisser'));
  assert.ok(!JSON.stringify(ben).includes('Yanis'));
  assert.deepEqual(ben.day.chairs.map((c) => c.staffId), [t.ids.Ben]);

  // the front desk: the whole salon's day, the cards of its rights, never the money
  assert.deepEqual(lea.day.chairs.map((c) => c.name), ['Ali', 'Ben']);
  assert.ok(lea.day.appts.some((a) => a.client === 'Zinedine Z.') && lea.day.appts.some((a) => a.staffId === t.ids.Ali));
  assert.deepEqual(money(lea), []);
  assert.ok(card(lea, 'demandes') && card(lea, 'encaisser'));
  for (const id of ['z', 'absence-demande', 'orphelins', 'stock', 'purge', 'comptable', 'objectif', 'semaine']) assert.ok(!card(lea, id), 'the desk has no right for « ' + id + ' »');
});

test('homeDay: someone with a chair and the salon’s rights chooses « salon » (default) or « moi »', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await person(t, 'Mia', 'manager', { chair: true, schedule: WEEK });
  await book(t, 'Ali', 600);
  await book(t, 'Mia', 660, { client: { first: 'Thierry', last: 'Henry', phone: '06 99 88 77 55' } });
  let v = view(t, 'Mia');
  assert.deepEqual([v.day.scope, v.day.canSwitch, v.day.chairs.length, v.day.appts.length], ['salon', true, 3, 2]);
  await prefs(t, 'Mia', { homeDay: 'moi' });
  v = view(t, 'Mia');
  assert.deepEqual([v.day.scope, v.day.canSwitch], ['moi', true]);
  assert.deepEqual(v.day.chairs.map((c) => c.staffId), [t.ids.Mia]);
  assert.deepEqual(v.day.appts.map((a) => a.client), ['Thierry H.']);
  assert.ok(card(v, 'prochain'), 'her next client, as a barber');
  assert.ok(v.line.facts.some((f) => f.unit === 'eur'), 'the sentence stays the salon’s: she keeps report.shop');
  // the owner of the fixture has no chair: nothing to switch, and « moi » changes nothing
  assert.equal(view(t).day.canSwitch, false);
  await prefs(t, null, { homeDay: 'moi' });
  assert.equal(view(t).day.scope, 'salon');
  assert.deepEqual(HOME_DAYS, ['salon', 'moi']);
  assert.ok(HOMES.includes('accueil'));
});

/* ---------------- the cards, one by one ---------------- */

test('card z: a past day without its Z blocks; it cannot be hidden; nobody without « closure » gets it', async () => {
  const t = await salon({ day: '2026-10-31', hour: 11 }); // a Saturday
  assert.ok(!card(view(t), 'z'));
  await t.engine.run(checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  go(t, '2026-10-31', 15);
  assert.ok(!card(view(t), 'z'), 'the day is running: its Z is not due yet');
  go(t, '2026-10-31', 19, 0);
  let z = card(view(t), 'z');
  assert.ok(z, 'the day is over and its Z is not done');
  assert.equal(z.action.to, '/caisse/cloture');
  go(t, TUE, 10);
  z = card(view(t), 'z');
  assert.deepEqual([z.group, z.count, z.canHide, z.action.kind], ['bloque', 1, false, 'go']);
  assert.match(z.title, /samedi/);
  assert.equal(view(t).cards[0].id, 'z', 'what blocks comes first');
  await prefs(t, null, { homeHidden: ['z'] });
  assert.ok(card(view(t), 'z'), 'hidden in prefs, still there: it engages the salon');
  assert.ok(!card(view(t, 'Ali'), 'z'));
  assert.ok(!view(t).quiet.includes('caisse'));
});

test('chairs: a busy chair names the client who is there (to open his appointment), never for a pause or a free chair', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  const id = await book(t, 'Ali', 600);
  go(t, TUE, 9, 50);
  let ali = view(t).day.chairs.find((c) => c.name === 'Ali');
  assert.deepEqual([ali.state, ali.now], ['libre', null], 'free: nobody');
  // expected and his slot running: he is the one the chair waits for
  go(t, TUE, 10, 2);
  ali = view(t).day.chairs.find((c) => c.name === 'Ali');
  assert.equal(ali.state, 'occupe');
  assert.deepEqual([ali.now.id, ali.now.client, ali.now.status], [id, 'Yanis M.', 'booked']);
  await t.engine.run(setStatus, { id, status: 'arrived' }, t.asOwner());
  await t.engine.run(setStatus, { id, status: 'in_chair' }, t.asOwner());
  // still in the chair after his slot: the chair stays busy, with him
  go(t, TUE, 10, 50);
  ali = view(t).day.chairs.find((c) => c.name === 'Ali');
  assert.deepEqual([ali.state, ali.until, ali.now.id, ali.now.status], ['occupe', null, id, 'in_chair']);
  // his own chair for a barber, with the same words; a colleague's chair is not in his answer at all
  assert.equal(view(t, 'Ali').day.chairs[0].now.id, id);
  assert.ok(view(t, 'Ben').day.chairs.every((c) => c.staffId === t.ids.Ben && c.now === null));
  // a pause (a block) keeps the chair busy with nobody on it
  const u = await salon({ day: TUE, hour: 10 });
  await u.engine.run(addBlock, { staffId: u.ids.Ali, day: TUE, start: 600, dur: 30, label: 'Pause' }, u.asOwner());
  go(u, TUE, 10, 5);
  const paused = view(u).day.chairs.find((c) => c.name === 'Ali');
  assert.deepEqual([paused.state, paused.until, paused.now], ['occupe', 630, null]);
});

test('late: a client booked and not there five minutes after his hour is counted late, on his row and in one card', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  const a = await book(t, 'Ali', 600);
  const b = await book(t, 'Ben', 600, { client: { first: 'Thierry', last: 'Henry', phone: '06 99 88 77 55' } });
  go(t, TUE, 10, LATE_MIN - 1);
  assert.ok(!card(view(t), 'retard'), 'four minutes: not yet');
  assert.ok(view(t).day.appts.every((x) => !('late' in x)));
  go(t, TUE, 10, 12);
  let v = view(t);
  let c = card(v, 'retard');
  assert.deepEqual([c.group, c.count, c.title, c.action.kind, c.action.to, c.canHide], ['attend', 2, '2 clients en retard', 'go', '/agenda?rdv=' + a, true]);
  assert.deepEqual(c.preview.map((x) => x.text.replace(NB, ' ')), ['Yanis M. · 10 h · Ali', 'Thierry H. · 10 h · Ben']);
  assert.deepEqual(v.day.appts.map((x) => x.late), [12, 12]);
  assert.equal(v.day.next.late, 12, 'the next client is the one who is late');
  assert.equal(c.amount, undefined);
  // one arrives: he is no longer late, the other one is named
  await t.engine.run(setStatus, { id: a, status: 'arrived' }, t.asOwner());
  go(t, TUE, 10, 13);
  v = view(t);
  c = card(v, 'retard');
  assert.equal(c.title.replace(NB, ' '), 'Thierry H. en retard de 13 min');
  assert.deepEqual([c.count, c.action.label, c.action.to], [1, 'Ouvrir', '/agenda?rdv=' + b]);
  assert.ok(!('late' in v.day.appts.find((x) => x.id === a)));
  // each barber his own: Ali has nobody late any more, Ben has his client (no barber's name on his own card)
  assert.ok(!card(view(t, 'Ali'), 'retard'));
  assert.deepEqual(card(view(t, 'Ben'), 'retard').preview.map((x) => x.text.replace(NB, ' ')), ['Thierry H. · 10 h']);
  // once his slot is over he is not « à venir » any more: the card goes (the agenda still marks him absent or not)
  go(t, TUE, 10, 45);
  assert.ok(!card(view(t), 'retard'));
});

test('cards encaisser and prochain: counts from toPayAppts, each barber his own', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await book(t, 'Ali', 600);
  await book(t, 'Ben', 660, { client: { first: 'Thierry', last: 'Henry', phone: '06 99 88 77 55' } });
  assert.ok(!card(view(t), 'encaisser'));
  assert.ok(view(t).quiet.includes('caisse'));
  const p = card(view(t, 'Ali'), 'prochain');
  assert.deepEqual([p.group, p.count, p.action.kind, p.action.to], ['attend', 1, 'go', '/espace']);
  assert.match(p.title, /^Yanis M\. à 10 h$/);
  assert.ok(!card(view(t), 'prochain'), 'no chair, no next client of one’s own');
  go(t, TUE, 10, 35);
  const e = card(view(t), 'encaisser');
  assert.deepEqual([e.group, e.count, e.amount, e.action.to, e.canHide], ['bloque', 1, 2000, '/caisse', true]);
  assert.deepEqual(e.preview.map((x) => x.text), ['Yanis M. · Coupe']);
  assert.ok(!card(view(t, 'Ali'), 'prochain'), 'nobody else today');
  // without the right to cash, the card is not computed for him
  await t.engine.run(updateSettings, { team: { barberCheckout: false } }, t.asOwner());
  assert.ok(!card(view(t, 'Ali'), 'encaisser'));
  assert.ok(card(view(t), 'encaisser'));
});

test('cards absence-demande and orphelins: a request waits for the owner, clients wait for another barber', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await book(t, 'Ben', 600, { day: '2026-11-20' });
  assert.ok(!card(view(t), 'absence-demande') && !card(view(t), 'orphelins'));
  assert.ok(view(t).quiet.includes('équipe'));
  const q = await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: '2026-11-20', to: '2026-11-21', reason: 'Mariage' }, t.asStaff('Ben'));
  assert.equal(q.requested, true);
  let v = view(t);
  const a = card(v, 'absence-demande');
  assert.deepEqual([a.group, a.count, a.canHide, a.action.kind, a.action.ref], ['attend', 1, false, 'sheet', q.id]);
  assert.match(a.title, /^Ben demande du vendredi 20 au samedi 21$/);
  assert.match(a.preview[0].text, /1 client à replacer/);
  assert.ok(!card(v, 'orphelins'), 'not decided yet: nobody to replace');
  await prefs(t, null, { homeHidden: ['absence-demande'] });
  assert.ok(card(view(t), 'absence-demande'));
  assert.ok(!card(view(t, 'Ben'), 'absence-demande') && !card(view(t, 'Ali'), 'absence-demande'));
  // posed by the owner over a booked day: the booked client is to be replaced
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: '2026-11-20', to: '2026-11-20', reason: 'Formation' }, t.asOwner());
  v = view(t);
  const o = card(v, 'orphelins');
  assert.deepEqual([o.group, o.count, o.action.kind], ['attend', 1, 'sheet']);
  assert.ok(o.action.ref && t.engine.state.timeoff.has(o.action.ref));
  assert.ok(!v.quiet.includes('équipe'));
});

test('card demandes: the unread requests of the inbox, for whoever answers them', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await person(t, 'Lea', 'desk');
  assert.ok(!card(view(t), 'demandes'));
  assert.ok(view(t).quiet.includes('messages'));
  await t.engine.run(receiveInquiry, { kind: 'contact', first: 'Karim', phone: '06 12 12 12 12', message: 'Bonjour, vous prenez les enfants ?' }, t.asClient);
  const d = card(view(t), 'demandes');
  assert.deepEqual([d.group, d.count, d.action.kind, d.action.to], ['attend', 1, 'go', '/relances/demandes']);
  assert.match(d.preview[0].text, /Karim/);
  assert.equal(card(view(t, 'Lea'), 'demandes').count, 1);
  assert.ok(!card(view(t, 'Ali'), 'demandes'));
});

test('card relances: there at the threshold, gone below; its count is the badge’s, its amount an estimate from clientStats', async () => {
  const t = await salon({ day: '2026-09-01', hour: 9 }); // a Tuesday, two months before
  await person(t, 'Lea', 'desk');
  const cids = [];
  for (let i = 0; i < RELANCES_MIN; i++) {
    const cid = (await t.engine.run(addClient, { first: 'Habitue' + i, last: 'Test', phone: '06 20 00 00 0' + i, marketing: true }, t.asOwner())).id;
    cids.push(cid);
    const id = await book(t, 'Ali', 600 + i * 30, { clientId: cid, day: '2026-09-01' });
    await t.engine.run(checkout, { apptId: id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  }
  await t.engine.run(closeDay, { early: true }, t.asOwner());
  go(t, TUE, 10);
  const s = t.engine.state;
  // the badge's own count (routes-staff.js badges): overdue and rebookable
  let badge = 0;
  for (const [id, st] of clientStats(s, TUE, t.clock.now)) { const c = st.overdue && s.clients.get(id); if (c && rebookable(c, st)) badge++; }
  assert.equal(badge, RELANCES_MIN);
  assert.equal(relances(s, TUE, t.clock.now).length, badge);
  const r = card(view(t), 'relances');
  assert.deepEqual([r.group, r.count, r.amount, r.action.kind, r.action.to], ['rapporte', badge, RELANCES_MIN * 2000, 'bulk', '/relances']);
  assert.equal(r.preview.length, MAX_PREVIEW);
  assert.match(r.why, new RegExp('seuil : ' + RELANCES_MIN));
  // the desk may send them and reads no estimate; a barber gets nothing
  const lea = card(view(t, 'Lea'), 'relances');
  assert.equal(lea.count, badge);
  assert.ok(!('amount' in lea));
  assert.ok(!card(view(t, 'Ali'), 'relances'));
  // hidden by the person's own choice
  await prefs(t, null, { homeHidden: ['relances'] });
  assert.ok(!card(view(t), 'relances'));
  await prefs(t, null, { homeHidden: [] });
  assert.ok(card(view(t), 'relances'));
  // one of them books again: below the threshold, no card
  await book(t, 'Ali', 600, { clientId: cids[0], day: '2026-11-04' });
  assert.equal(relances(t.engine.state, TUE, t.clock.now).length, RELANCES_MIN - 1);
  assert.ok(!card(view(t), 'relances'));
});

test('cards echecs, stock, objectif: maintenance, each behind its right', async () => {
  const t = await salon({ day: TUE, hour: 9 });
  await person(t, 'Mia', 'manager');
  let v = view(t);
  assert.ok(!card(v, 'echecs') && !card(v, 'stock') && !card(v, 'objectif'));
  assert.ok(v.quiet.includes('stock'));
  // stock: at its threshold (3 by default), not above
  await t.engine.run(adjustStock, { id: t.ids.oil, delta: -6, reason: 'Ventes' }, t.asOwner());
  assert.ok(!card(view(t), 'stock'), '4 left, threshold 3');
  await t.engine.run(adjustStock, { id: t.ids.oil, delta: -1, reason: 'Vente' }, t.asOwner());
  const st = card(view(t), 'stock');
  assert.deepEqual([st.group, st.count, st.action.to], ['entretien', 1, '/catalogue']);
  assert.match(st.preview[0].text, /^Huile/);
  assert.ok(!card(view(t, 'Ali'), 'stock'));
  assert.ok(!view(t).quiet.includes('stock'));
  // objectif: the first days of a month without a goal; « settings » is the owner's
  await t.engine.run(updateSettings, { goals: { monthCents: 0 } }, t.asOwner());
  const o = card(view(t), 'objectif');
  assert.deepEqual([o.group, o.action.kind, o.action.ref], ['entretien', 'sheet', 'objectif']);
  assert.ok(!card(view(t, 'Mia'), 'objectif'), 'a manager does not set the goal');
  go(t, '2026-11-10', 9);
  assert.ok(!card(view(t), 'objectif'), 'past the first five days');
  go(t, TUE, 9, 1);
  // echecs: a text that failed in the last 7 days
  await book(t, 'Ali', 900);
  const m = [...t.engine.state.messages.values()][0];
  assert.ok(m, 'the booking queued its confirmation');
  Object.assign(m, { status: 'failed', sentAt: t.clock.now });
  go(t, TUE, 9, 2);
  const e = card(view(t), 'echecs');
  assert.deepEqual([e.group, e.count, e.action.to], ['entretien', 1, '/relances/envoyes']);
  assert.ok(!card(view(t, 'Ali'), 'echecs'));
  go(t, '2026-11-11', 9);
  assert.ok(!card(view(t), 'echecs'), 'older than 7 days');
  // inside a group the bigger count comes first, unless the person pinned an order
  go(t, TUE, 9, 3);
  await t.engine.run(addClient, { first: 'Vieux', last: 'Client', phone: '06 30 00 00 01' }, t.asOwner());
  v = view(t);
  assert.deepEqual(v.cards.map((c) => c.id), ['echecs', 'stock', 'objectif'].filter((id) => card(v, id)));
  await prefs(t, null, { homeCards: ['objectif', 'stock'] });
  v = view(t);
  assert.deepEqual(v.cards.filter((c) => c.group === 'entretien').map((c) => c.id), ['objectif', 'stock', 'echecs']);
  await prefs(t, null, { homeHidden: ['stock'] });
  assert.deepEqual(view(t).cards.map((c) => c.id), ['objectif', 'echecs']);
});

test('card purge: files past three years, for whoever may erase', async () => {
  const t = await salon({ day: '2023-01-03', hour: 10 });
  await person(t, 'Mia', 'manager');
  go(t, TUE, 10);
  const p = card(view(t), 'purge');
  assert.deepEqual([p.group, p.count, p.action.to], ['entretien', 1, '/clients?segment=inactifs']);
  assert.ok(!card(view(t, 'Mia'), 'purge'), 'a manager has no client.erase');
  const fresh = await salon({ day: TUE, hour: 10 });
  assert.ok(!card(view(fresh), 'purge'));
});

test('card comptable: the first days of a month, once the month before is closed', async () => {
  const t = await salon({ day: '2026-10-31', hour: 11 });
  await t.engine.run(checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  go(t, '2026-10-31', 19, 0);
  await t.engine.run(closeDay, {}, t.asOwner());
  go(t, TUE, 10);
  assert.ok(!card(view(t), 'comptable'), 'October is not closed yet');
  await t.engine.run(closePeriod, { month: '2026-10' }, t.asOwner());
  const c = card(view(t), 'comptable');
  assert.deepEqual([c.group, c.action.to], ['entretien', '/reglages/compta']);
  assert.match(c.title, /octobre/);
  assert.ok(!card(view(t, 'Ali'), 'comptable'));
  go(t, '2026-11-12', 10);
  assert.ok(!card(view(t), 'comptable'));
});

test('card semaine: on a closed day, and after closing on the last open day of the week', async () => {
  const t = await salon({ day: TUE, hour: 10 });
  await person(t, 'Lea', 'desk');
  await book(t, 'Ali', 600, { day: '2026-11-10' });
  assert.ok(!card(view(t), 'semaine'));
  go(t, '2026-11-07', 15); // Saturday, the last open day
  assert.ok(!card(view(t), 'semaine'));
  go(t, '2026-11-07', 19);
  assert.ok(card(view(t), 'semaine'));
  go(t, SUN, 10);
  const w = card(view(t), 'semaine');
  const c = cockpit(t.engine.state, { range: 'day', day: SUN, today: SUN, now: t.clock.now });
  assert.deepEqual([w.group, w.count, w.amount, w.action.to], ['rapporte', c.ahead.count, c.ahead.planned, '/agenda?vue=semaine']);
  assert.equal(w.count, 1);
  assert.ok(!card(view(t, 'Lea'), 'semaine') && !card(view(t, 'Ali'), 'semaine'), 'the salon’s figures: report.shop');
});

/* ---------------- the contract ---------------- */

test('contract: shape, groups in order, a « why » on every card, one object per person and minute', async () => {
  const t = await salon({ day: '2026-10-31', hour: 11 });
  await t.engine.run(checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  go(t, TUE, 9);
  await t.engine.run(adjustStock, { id: t.ids.oil, delta: -9, reason: 'Casse' }, t.asOwner());
  await t.engine.run(receiveInquiry, { kind: 'contact', first: 'Karim', phone: '06 12 12 12 12', message: 'Bonjour, vous prenez les enfants ?' }, t.asClient);
  await book(t, 'Ali', 540);
  go(t, TUE, 9, 45);
  const v = view(t);
  assert.deepEqual(Object.keys(v).sort(), ['asOf', 'cards', 'day', 'finDeMois', 'line', 'moment', 'quiet']);
  assert.deepEqual(Object.keys(v.day).sort(), ['appts', 'canSwitch', 'chairs', 'more', 'next', 'scope']);
  assert.deepEqual(Object.keys(v.day.chairs[0]).sort(), ['canTake', 'freeMin', 'name', 'now', 'staffId', 'state', 'until']);
  assert.deepEqual(v.cards.map((c) => c.id), ['z', 'encaisser', 'demandes', 'stock']);
  const order = v.cards.map((c) => GROUPS.indexOf(c.group));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const c of v.cards) {
    assert.ok(CARD_IDS.includes(c.id));
    assert.ok(c.title && c.why && c.count >= 1 && c.preview.length <= MAX_PREVIEW && typeof c.canHide === 'boolean', c.id);
    assert.ok(['go', 'sheet', 'bulk'].includes(c.action.kind) && c.action.label);
    assert.ok(c.action.kind === 'sheet' ? c.action.ref : c.action.to, c.id + ' says where it leads');
  }
  assert.equal(view(t), v, 'memoised for the minute');
  assert.notEqual(view(t, 'Ali'), v, 'never another person’s answer');
  go(t, TUE, 9, 46);
  assert.notEqual(view(t), v);
  const w = view(t);
  await prefs(t, null, { homeHidden: ['stock'] });
  assert.notEqual(view(t), w, 'a choice of the person shows at once');
  assert.ok(!card(view(t), 'stock'));
  // nothing to deal with: an empty list, and what is fine said in words
  const quiet = await salon({ day: '2026-11-10', hour: 10 });
  const q = view(quiet);
  assert.deepEqual(q.cards, []);
  assert.deepEqual(q.quiet, ['caisse', 'équipe', 'messages', 'stock']);
  assert.deepEqual(view(quiet, 'Ali').quiet, ['caisse'], 'a barber is told only of what he may act on');
});
