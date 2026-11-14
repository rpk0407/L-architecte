// Holidays and leave, rule by rule (DO-05 and what readiness added): who may ask, who decides, when the slots close,
// and that no client is ever left on a chair nobody will sit behind: a weekly day off, a closure of the salon, a
// barber who leaves. On the helper salon (Ali and Ben, Tuesday 3 November 2026, 10:00): Ali works Tuesday to Saturday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY } from '../helpers.js';
import { browser } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { DEVICE_COOKIE } from '../../server/auth/session.js';
import { localParts, instantOf, addDays } from '../../shared/dates.js';
import { freeSlots, staffIntervals } from '../../server/domain/availability.js';
import { addClient } from '../../server/commands/clients.js';
import { createAppointment } from '../../server/commands/agenda.js';
import { addClosure, removeClosure, closureConflicts } from '../../server/commands/shop.js';
import { reportPlan, absenceFor, reportAppointments } from '../../server/commands/report.js';
import {
  addTimeOff, approveTimeOff, refuseTimeOff, removeTimeOff, updateStaff, archiveStaff, strandedAppts, timeoffConflicts, handoverPlan, applyHandover, DEPARTURE
} from '../../server/commands/team.js';

const S = (t) => t.engine.state;
const o = (t) => ({ now: t.clock.now, local: localParts(t.clock.now) });
const WED = '2026-11-04', THU = '2026-11-05', NEXT_TUE = '2026-11-10', NEXT_THU = '2026-11-12';
const slots = (t, name, day) => freeSlots(S(t), { day, dur: 30, serviceIds: [t.ids.cut], staffId: t.ids[name], now: t.clock.now, local: localParts(t.clock.now), online: true, step: 30 }).map((x) => x.m);

async function shop() {
  const t = await salon();
  let n = 0;
  const book = async (day, start, staff = 'Ali') => {
    const cid = (await t.engine.run(addClient, { first: 'Client' + ++n, last: 'Essai', phone: '06 10 00 00 ' + String(10 + n) }, t.asOwner())).id;
    return (await t.engine.run(createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids[staff], day, start }, t.asOwner())).id;
  };
  const withLink = (a) => ({ ...a, meta: { linkFor: (x) => 'https://x/r/' + x.code } });
  return { t, book, owner: () => withLink(t.asOwner()), ali: () => withLink(t.asStaff('Ali')), ben: () => withLink(t.asStaff('Ben')) };
}

test('a barber asks for his leave: it blocks nothing until the owner accepts, then his slots leave the site at once', async () => {
  const { t, owner, ali } = await shop();
  const before = slots(t, 'Ali', THU);
  assert.ok(before.length > 10);
  const r = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: THU, to: THU, reason: 'Congés' }, ali());
  assert.equal(r.requested, true);
  assert.equal(S(t).timeoff.size, 0);
  assert.equal(S(t).timeoffRequests.get(r.id).status, 'pending');
  assert.deepEqual(slots(t, 'Ali', THU), before, 'a request takes no slot away');
  // a client books in the meantime: nothing stops him
  await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: THU, start: 600 }, owner());

  const ok = await t.engine.run(approveTimeOff, { id: r.id }, owner());
  assert.equal(ok.id, r.id);
  assert.deepEqual(slots(t, 'Ali', THU), [], 'accepted: nothing left to book that day');
  assert.deepEqual(staffIntervals(S(t), t.ids.Ali, THU), []);
  assert.ok(slots(t, 'Ben', THU).length > 10, 'his colleague is still offered');
  assert.equal(S(t).timeoffRequests.size, 0);
  // the client booked meanwhile is not cancelled: he is on the absence's plan, to be replaced
  const plan = handoverPlan(S(t), S(t).timeoff.get(r.id), o(t));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].same.staffId, t.ids.Ben);
  assert.equal([...S(t).appts.values()].filter((a) => a.status === 'cancelled').length, 0);
  // a second tap on « Valider » writes nothing
  const v = S(t).version;
  await t.engine.run(approveTimeOff, { id: r.id }, owner());
  assert.equal(S(t).version, v);
});

test('refused: nothing ever closed; and part of a day closes those hours only', async () => {
  const { t, owner, ali } = await shop();
  const before = slots(t, 'Ali', THU);
  const r = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: THU, to: THU }, ali());
  await t.engine.run(refuseTimeOff, { id: r.id }, owner());
  assert.deepEqual(slots(t, 'Ali', THU), before);
  assert.equal(S(t).timeoffRequests.get(r.id).status, 'refused');
  await rejects(t.engine.run(approveTimeOff, { id: r.id }, owner()), 'decided');
  // the owner posts two hours off for Ben on Wednesday morning: 10:00 to 12:00 go, the rest stays
  const w = slots(t, 'Ben', WED);
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: WED, to: WED, startMin: 600, endMin: 720, reason: 'Rendez-vous perso' }, owner());
  const after = slots(t, 'Ben', WED);
  assert.deepEqual(w.filter((m) => !after.includes(m)), [600, 630, 660, 690]);
  assert.ok(after.includes(570) && after.includes(720));
  // hours need one day, an end after the start, and an absence holds in a year
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: WED, to: THU, startMin: 600, endMin: 720 }, owner()), 'invalid');
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: WED, to: WED, startMin: 720, endMin: 600 }, owner()), 'invalid');
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: THU, to: WED }, owner()), 'invalid');
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: WED, to: addDays(WED, 400) }, owner()), 'invalid');
});

test('rights, in the commands: a barber asks for himself only, decides nothing, and touches nobody else’s leave', async () => {
  const { t, owner, ali, ben } = await shop();
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: THU, to: THU }, ali()), 'forbidden');
  const mine = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: THU, to: THU }, ali());
  await rejects(t.engine.run(approveTimeOff, { id: mine.id }, ali()), 'forbidden');
  await rejects(t.engine.run(approveTimeOff, { id: mine.id }, ben()), 'forbidden');
  await rejects(t.engine.run(refuseTimeOff, { id: mine.id }, ben()), 'forbidden');
  await rejects(t.engine.run(removeTimeOff, { id: mine.id }, ben()), 'forbidden');
  // he may withdraw his own request; the owner's posted absence is not Ben's to remove, but it is the barber's own
  await t.engine.run(removeTimeOff, { id: mine.id }, ali());
  assert.equal(S(t).timeoffRequests.size, 0);
  const posted = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: WED, to: WED }, owner());
  assert.equal(posted.requested, undefined);
  await rejects(t.engine.run(removeTimeOff, { id: posted.id }, ben()), 'forbidden');
  // closing the salon, changing a week, letting someone go: never a barber
  await rejects(t.engine.run(addClosure, { from: THU, to: THU, label: 'Pont' }, ali()), 'forbidden');
  await rejects(t.engine.run(updateStaff, { id: t.ids.Ali, patch: { schedule: { 2: [] } } }, ali()), 'forbidden');
  await rejects(t.engine.run(archiveStaff, { id: t.ids.Ben }, ali()), 'forbidden');
  // and the handover plan is applied by whoever manages the team, through its route (below); a barber cannot move a colleague's client
  const a = (await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: THU, start: 600 }, owner())).id;
  await rejects(t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: [{ apptId: a, staffId: t.ids.Ben, start: 600 }] }, ben()), 'forbidden');
});

test('a weekly day off: the appointments already taken on that weekday are counted, never dropped, and go through the report', async () => {
  const { t, book, owner } = await shop();
  const a1 = await book(THU, 600), a2 = await book(NEXT_THU, 840), tue = await book(NEXT_TUE, 600);
  assert.deepEqual(strandedAppts(S(t), t.ids.Ali, o(t)), []);
  const week = { ...S(t).staff.get(t.ids.Ali).schedule, 4: [] };
  const r = await t.engine.run(updateStaff, { id: t.ids.Ali, patch: { schedule: week } }, owner());
  assert.equal(r.stranded, 2);
  assert.deepEqual(strandedAppts(S(t), t.ids.Ali, o(t)).map((a) => a.id), [a1, a2]);
  // nothing moved or cancelled by itself, and the site stops offering his Thursdays at once
  assert.deepEqual([a1, a2, tue].map((id) => S(t).appts.get(id).status), ['booked', 'booked', 'booked']);
  assert.deepEqual(slots(t, 'Ali', THU), []);
  assert.deepEqual(slots(t, 'Ali', addDays(NEXT_THU, 7)), []);
  assert.ok(slots(t, 'Ali', NEXT_TUE).length > 0);
  // the report of that day proposes his colleague at the same time; once applied nobody is stranded on it
  const plan = reportPlan(S(t), absenceFor(S(t), { staffId: t.ids.Ali, day: THU }, o(t)), o(t));
  assert.deepEqual(plan.map((x) => [x.a.id, x.kind, x.to.staffId, x.to.start]), [[a1, 'same', t.ids.Ben, 600]]);
  const done = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: [{ apptId: a1, staffId: t.ids.Ben, start: 600 }] }, owner());
  assert.equal(done.moved.length, 1);
  assert.deepEqual(strandedAppts(S(t), t.ids.Ali, o(t)).map((a) => a.id), [a2]);
  // shorter days count too: Tuesday now ends at 10:00, the 10:00 appointment no longer fits
  const short = await t.engine.run(updateStaff, { id: t.ids.Ali, patch: { schedule: { ...week, 2: [[540, 600]] } } }, owner());
  assert.equal(short.stranded, 2);
  // an appointment inside a posted absence belongs to that absence's plan, not to this list
  await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: NEXT_THU, to: NEXT_THU }, owner());
  assert.deepEqual(strandedAppts(S(t), t.ids.Ali, o(t)).map((a) => a.id), [tue]);
  // a patch that touches neither the week nor the chair says nothing about it
  assert.deepEqual(await t.engine.run(updateStaff, { id: t.ids.Ali, patch: { bio: 'Dégradés' } }, owner()), { ok: true });
  // the chair taken away: everything still booked with him is outside
  assert.equal((await t.engine.run(updateStaff, { id: t.ids.Ben, patch: { chair: false, bookable: false } }, owner())).stranded, 1);
});

test('closing the salon: the days leave the site at once, the appointments already taken are counted by day and barber, closing twice is once', async () => {
  const { t, book, owner } = await shop();
  await book(THU, 600); await book(THU, 660); await book(THU, 600, 'Ben'); await book(NEXT_THU, 600);
  const r = await t.engine.run(addClosure, { from: THU, to: THU, label: 'Armistice' }, owner());
  assert.equal(r.conflicts, 3);
  assert.deepEqual(slots(t, 'Ali', THU), []);
  assert.deepEqual(slots(t, 'Ben', THU), []);
  assert.deepEqual(closureConflicts(S(t), { from: THU, to: THU }, o(t)).map((x) => [x.day, x.staffId === t.ids.Ali ? 'Ali' : 'Ben', x.count]), [[THU, 'Ali', 2], [THU, 'Ben', 1]]);
  assert.equal([...S(t).appts.values()].filter((a) => a.status === 'cancelled').length, 0, 'closing cancels nobody');
  // the same day again (a second tap on the public holiday): no second closure
  const v = S(t).version;
  const again = await t.engine.run(addClosure, { from: THU, to: THU, label: 'Armistice' }, owner());
  assert.deepEqual([again.id, again.conflicts, S(t).version, S(t).settings.closures.length], [r.id, 3, v, 1]);
  // the report of a closed day finds no place that day: each client is « à rappeler », nobody is moved blindly
  const plan = reportPlan(S(t), absenceFor(S(t), { staffId: t.ids.Ali, day: THU }, o(t)), o(t));
  assert.deepEqual(plan.map((x) => x.kind), ['call', 'call']);
  // reopened: the slots come back
  await t.engine.run(removeClosure, { id: r.id }, owner());
  assert.ok(slots(t, 'Ben', THU).length > 0);
  await rejects(t.engine.run(addClosure, { from: THU, to: WED, label: 'x' }, owner()), 'invalid');
});

test('a barber leaves with clients still booked: his departure is posted as an absence that covers them, and they go through the plan', async () => {
  const { t, book, owner } = await shop();
  const a1 = await book(WED, 600), a2 = await book(NEXT_THU, 840);
  const base = owner();
  const r = await t.engine.run(archiveStaff, { id: t.ids.Ali }, base);
  assert.equal(r.conflicts, 2);
  const off = S(t).timeoff.get(r.absence);
  assert.deepEqual([off.staffId, off.from, off.to, off.reason, off.departure], [t.ids.Ali, DAY, NEXT_THU, DEPARTURE, true]);
  assert.equal(S(t).staff.get(t.ids.Ali).active, false);
  // gone from the site at once, his clients still booked and all on the plan
  assert.deepEqual(slots(t, 'Ali', THU), []);
  assert.deepEqual([a1, a2].map((id) => S(t).appts.get(id).status), ['booked', 'booked']);
  assert.deepEqual(timeoffConflicts(S(t), off, o(t)).map((a) => a.id), [a1, a2]);
  const plan = handoverPlan(S(t), off, o(t));
  assert.deepEqual(plan.map((x) => [x.a.id, x.choice, x.same && x.same.staffId]), [[a1, 'same', t.ids.Ben], [a2, 'same', t.ids.Ben]]);
  // his absence cannot be removed while a client is still at his name
  const e = await rejects(t.engine.run(removeTimeOff, { id: off.id }, base), 'has_appts');
  assert.equal(e.extra.count, 2);
  // the plan applied: both clients are with Ben, told, and the absence can go
  const res = await applyHandover(t.engine, off, { moves: plan.map((x) => ({ apptId: x.a.id, staffId: x.same.staffId, start: x.same.start })) }, base);
  assert.equal(res.moved, 2);
  assert.deepEqual([a1, a2].map((id) => S(t).appts.get(id).staffId), [t.ids.Ben, t.ids.Ben]);
  assert.equal(timeoffConflicts(S(t), off, o(t)).length, 0);
  await t.engine.run(removeTimeOff, { id: off.id }, base);
  // no leave for someone who is no longer in the team
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: THU, to: THU }, base), 'not_found');
});

test('leaving with nobody booked posts nothing; coming back takes the departure away', async () => {
  const { t, book, owner } = await shop();
  const quiet = await t.engine.run(archiveStaff, { id: t.ids.Ben }, owner());
  assert.deepEqual([quiet.absence, quiet.conflicts, S(t).timeoff.size], [null, 0, 0]);
  await book(WED, 600);
  const r = await t.engine.run(archiveStaff, { id: t.ids.Ali }, owner());
  assert.equal(S(t).timeoff.size, 1);
  // a second tap: still one absence
  await t.engine.run(archiveStaff, { id: t.ids.Ali }, owner());
  assert.equal(S(t).timeoff.size, 1);
  await t.engine.run(archiveStaff, { id: t.ids.Ali, restore: true }, owner());
  assert.equal(S(t).timeoff.has(r.absence), false);
  assert.equal(S(t).staff.get(t.ids.Ali).active, true);
  assert.ok(slots(t, 'Ali', THU).length > 0);
  assert.deepEqual(strandedAppts(S(t), t.ids.Ali, o(t)), []);
});

/* ---------------- the same rules through the routes ---------------- */

async function live() {
  const clock = { now: instantOf('2026-11-17', 600) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  await owner.post('/api/v1/preset/apply', {});
  const codes = (await owner.post('/api/v1/preset/codes', {})).json.codes;
  assert.equal((await owner.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  const s = () => rt.engine.state;
  const id = (name) => [...s().staff.values()].find((x) => x.name === name).id;
  const as = async (name) => {
    const tab = browser(rt);
    tab.jar.set(DEVICE_COOKIE, owner.jar.get(DEVICE_COOKIE));
    assert.equal((await tab.post('/api/auth/pin', { staffId: id(name), pin: codes.find((c) => c.name === name).pin })).status, 200);
    return tab;
  };
  const cut = [...s().services.values()].find((x) => x.slug === 'cl').id;
  const book = async (name, day, start) => {
    const r = await owner.post('/api/v1/appointments', { name: 'Client Essai', phone: '06 10 00 00 ' + String(10 + s().appts.size), serviceIds: [cut], staffId: id(name), day, start });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json.id;
  };
  return { rt, owner, s, id, as, book, cut };
}

test('through the routes, on the real salon: JKut asks from his phone, the owner accepts in one call and is sent to the plan; every other route is refused to a barber', async () => {
  const { owner, s, id, as, book, cut, rt } = await live();
  const day = '2026-11-26'; // a Thursday
  const a = await book('JKut', day, 600);
  const jk = await as('JKut'), est = await as('Esteban');
  const avail = async () => (await browser(rt).get('/api/public/availability?from=' + day + '&days=1&services=' + cut + '&staff=' + id('JKut'))).json.days[0].slots.length;
  const open = await avail();
  assert.ok(open > 5);

  const ask = await jk.post('/api/v1/timeoff', { staffId: id('JKut'), from: day, to: day, reason: 'Congés' });
  assert.deepEqual([ask.status, ask.json.requested, ask.json.conflicts], [200, true, 1]);
  assert.equal(await avail(), open, 'the site still offers him');
  // he sees it waiting; the owner sees it on his Accueil and in Équipe; a colleague sees nothing of it
  assert.deepEqual((await jk.get('/api/v1/timeoff/mine')).json.requests.map((q) => q.status), ['pending']);
  assert.deepEqual((await owner.get('/api/v1/staff')).json.requests.map((q) => [q.staffId, q.conflicts]), [[id('JKut'), 1]]);
  assert.ok((await owner.get('/api/v1/home')).json.cards.some((c) => c.id === 'absence-demande'));
  assert.deepEqual((await est.get('/api/v1/timeoff/mine')).json.requests, []);
  // a barber decides nothing, for himself or a colleague, and reads nobody else's plan
  for (const tab of [jk, est]) {
    assert.equal((await tab.post('/api/v1/timeoff/' + ask.json.id + '/approve')).status, 403);
    assert.equal((await tab.post('/api/v1/timeoff/' + ask.json.id + '/refuse')).status, 403);
    assert.equal((await tab.post('/api/v1/timeoff/' + ask.json.id + '/reassign', { moves: [] })).status, 403);
    assert.equal((await tab.post('/api/v1/settings/closures', { from: day, to: day, label: 'Pont' })).status, 403);
    assert.equal((await tab.get('/api/v1/settings/closures/conflicts')).status, 403);
    assert.equal((await tab.post('/api/v1/staff/' + id('Le Soldat') + '/archive', {})).status, 403);
  }
  assert.equal((await est.post('/api/v1/timeoff', { staffId: id('JKut'), from: day, to: day })).status, 403);
  assert.equal((await est.post('/api/v1/timeoff/preview', { id: ask.json.id })).status, 404);
  assert.equal((await est.del('/api/v1/timeoff/' + ask.json.id)).status, 403);
  assert.equal((await est.get('/api/v1/staff/' + id('JKut') + '/stranded')).status, 403);
  assert.equal((await est.get('/api/v1/staff/' + id('Esteban') + '/stranded')).status, 200);

  // one call: accepted, the site stops offering him, and the answer says a client is to be replaced (the screen opens the plan)
  const yes = await owner.post('/api/v1/timeoff/' + ask.json.id + '/approve');
  assert.deepEqual([yes.status, yes.json.conflicts], [200, 1]);
  assert.equal(await avail(), 0);
  const plan = (await owner.post('/api/v1/timeoff/preview', { id: ask.json.id })).json;
  assert.deepEqual(plan.rows.map((r) => [r.id, r.choice]), [[a, 'same']]);
  assert.equal(s().appts.get(a).status, 'booked');
  const done = await owner.post('/api/v1/timeoff/' + ask.json.id + '/reassign', { moves: [{ apptId: a, staffId: plan.rows[0].same.staffId, start: plan.rows[0].same.start }] });
  assert.deepEqual([done.status, done.json.moved, done.json.left], [200, 1, 0]);
  assert.notEqual(s().appts.get(a).staffId, id('JKut'));
});

test('through the routes: a weekly day off and a closure say what they leave behind; a barber who leaves is followed by his clients’ plan', async () => {
  const { owner, s, id, book } = await live();
  const thu = '2026-11-26', sat = '2026-11-28';
  await book('Le Soldat', thu, 600); await book('Le Soldat', sat, 600); const fr = await book('Esteban', sat, 600);
  // Le Soldat no longer works on Thursdays
  const wk = { ...s().staff.get(id('Le Soldat')).schedule, 4: [] };
  const p = await owner.patch('/api/v1/staff/' + id('Le Soldat'), { schedule: wk });
  assert.deepEqual([p.status, p.json.stranded], [200, 1]);
  assert.deepEqual((await owner.get('/api/v1/staff/' + id('Le Soldat') + '/stranded')).json, { count: 1, days: [{ day: thu, count: 1 }] });
  // the salon closes that Saturday
  const c = await owner.post('/api/v1/settings/closures', { from: sat, to: sat, label: 'Travaux' });
  assert.deepEqual([c.status, c.json.conflicts], [200, 2]);
  const cf = (await owner.get('/api/v1/settings/closures/conflicts')).json.items;
  assert.deepEqual(cf.map((x) => [x.id, x.count, x.days.map((d) => d.count)]), [[c.json.id, 2, [1, 1]]]);
  await owner.del('/api/v1/settings/closures/' + c.json.id);
  assert.deepEqual((await owner.get('/api/v1/settings/closures/conflicts')).json.items, []);
  // Esteban leaves: his Saturday client is on the plan of his departure, nowhere lost
  const out = await owner.post('/api/v1/staff/' + id('Esteban') + '/archive', {});
  assert.deepEqual([out.status, out.json.conflicts, !!out.json.absence], [200, 1, true]);
  const team = (await owner.get('/api/v1/staff')).json;
  assert.deepEqual(team.timeoff.filter((x) => x.id === out.json.absence).map((x) => [x.reason, x.conflicts]), [['Départ', 1]]);
  const plan = (await owner.post('/api/v1/timeoff/preview', { id: out.json.absence })).json;
  assert.deepEqual(plan.rows.map((r) => r.id), [fr]);
  assert.equal((await owner.del('/api/v1/timeoff/' + out.json.absence)).status, 409);
});
