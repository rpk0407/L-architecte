// « Reporter ses rendez-vous » (server/commands/report.js): a barber is away, his booked clients are moved in one
// action. What is pinned: the plan follows the booking's own availability (a colleague's break, an exceptional closure,
// a colleague who does not do the service, a slot held on the site), the apply re-checks every slot (one taken in
// between is reported, never double-booked, the others move), a retried request writes nothing, each moved client is
// texted once and nobody else, a deposit stays on its appointment, « Annuler » puts back what it can, rights per role.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import { addStaff, updateStaff, addTimeOff } from '../../server/commands/team.js';
import { addClient, updateClient } from '../../server/commands/clients.js';
import { addClosure } from '../../server/commands/shop.js';
import { capsOf } from '../../server/domain/permissions.js';
import { isFree } from '../../server/domain/availability.js';
import { absenceFor, reportPlan, reportAppointments, undoReport, REPORT_UNDO_MS, UNDONE } from '../../server/commands/report.js';
import { localParts } from '../../shared/dates.js';

const raw = { run(s, input, ctx) { for (const [type, data, pii] of input.events) ctx.emit(type, data, pii); return { ok: true }; } };
const S = (t) => t.engine.state;
const o = (t) => ({ now: t.clock.now, local: localParts(t.clock.now) });
const WED = '2026-11-04';

/**
 * Tuesday 10:00. Ali is away from now. His day: Yanis 11:00 (coupe), Bilal 14:00 (coupe), Chris 16:00 (décoloration),
 * Driss 17:00 (coupe). Ben (9–13, 13:30–18:30) does not do the décoloration, has a break at 14:00 and a slot held by
 * the site at 17:00.
 */
async function sickDay() {
  const t = await salon();
  const who = async (first, phone) => (await t.engine.run(addClient, { first, last: 'Test', phone }, t.asOwner())).id;
  const c = { yanis: t.ids.yanis, bilal: await who('Bilal', '06 11 11 11 11'), chris: await who('Chris', '06 22 22 22 22'), driss: await who('Driss', '06 33 33 33 33') };
  const book = async (clientId, start, svc = 'cut', staff = 'Ali', day = DAY) => (await t.engine.run(A.createAppointment, { clientId, serviceIds: [t.ids[svc]], staffId: t.ids[staff], day, start }, t.asOwner())).id;
  const a = { yanis: await book(c.yanis, 660), bilal: await book(c.bilal, 840), chris: await book(c.chris, 960, 'color'), driss: await book(c.driss, 1020) };
  await t.engine.run(updateStaff, { id: t.ids.Ben, patch: { services: [t.ids.cut, t.ids.beard] } }, t.asOwner());
  await t.engine.run(A.addBlock, { staffId: t.ids.Ben, day: DAY, start: 840, dur: 30, label: 'Pause' }, t.asOwner());
  await t.engine.run(raw, { events: [['appt.held', { id: 'ho_site', staffId: t.ids.Ben, day: DAY, start: 1020, dur: 30, serviceIds: [t.ids.cut], exp: t.clock.now + 600000, by: 'client' }]] }, t.sys);
  const role = async (name, r) => {
    const id = (await t.engine.run(addStaff, { name, role: r }, t.asOwner())).id;
    return () => { const st = S(t).staff.get(id); return { actor: { t: 'staff', id }, staff: st, caps: capsOf(st, S(t).settings), meta: { linkFor: (x) => 'https://x/r/' + x.code } }; };
  };
  const desk = await role('Inès', 'desk'), manager = await role('Mona', 'manager');
  const plan = () => reportPlan(S(t), absenceFor(S(t), { staffId: t.ids.Ali }, o(t)), o(t));
  const moves = (rows) => rows.filter((r) => r.to).map((r) => ({ apptId: r.a.id, staffId: r.to.staffId, start: r.to.start }));
  const texts = () => [...S(t).messages.values()].filter((m) => m.template === 'reassign' || m.template === 'reassignAt');
  return { t, c, a, book, desk, manager, plan, moves, texts };
}

test('the plan follows the booking’s availability: same time with a free colleague, else the nearest free time, else à rappeler', async () => {
  const { t, a, plan } = await sickDay();
  const rows = plan();
  assert.deepEqual(rows.map((r) => r.a.id), [a.yanis, a.bilal, a.chris, a.driss], 'his remaining appointments, in time order');
  const by = Object.fromEntries(rows.map((r) => [r.a.id, r]));
  // Ben is free at 11:00 and does the coupe
  assert.equal(by[a.yanis].kind, 'same');
  assert.deepEqual(by[a.yanis].to, { staffId: t.ids.Ben, day: DAY, start: 660 });
  // Ben's break is in the way at 14:00: the nearest free time, never on the break
  assert.equal(by[a.bilal].kind, 'nearest');
  assert.deepEqual(by[a.bilal].to, { staffId: t.ids.Ben, day: DAY, start: 810 });
  // nobody else does the décoloration: nothing is proposed, nothing moves by itself
  assert.equal(by[a.chris].kind, 'call');
  assert.equal(by[a.chris].to, null);
  assert.deepEqual(by[a.chris].options, []);
  // a slot held on the site at 17:00 is not given away
  assert.equal(by[a.driss].kind, 'nearest');
  assert.deepEqual(by[a.driss].to, { staffId: t.ids.Ben, day: DAY, start: 990 });
  // every proposal is a slot the booking rules call free, never on the absent barber, and no two overlap
  for (const r of rows.filter((x) => x.to)) {
    assert.notEqual(r.to.staffId, t.ids.Ali);
    assert.ok(isFree(S(t), r.to.staffId, r.to.day, r.to.start, r.a.dur, { now: t.clock.now }), 'free: ' + r.to.start);
  }
  // an appointment already over, or of another chair, is not in the plan
  t.clock.now = at(DAY, 11, 45);
  assert.deepEqual(plan().map((r) => r.a.id), [a.bilal, a.chris, a.driss]);
});

test('the plan on a posted absence: a day the salon closes exceptionally leaves the client à rappeler; two clients never get the same chair', async () => {
  const { t, c, a, book } = await sickDay();
  const wed = await book(c.yanis, 600, 'cut', 'Ali', WED);
  // two of Ali's clients at the same time on Thursday: only one can take Ben's chair at that time
  const THU = '2026-11-05';
  const one = await book(c.bilal, 600, 'cut', 'Ali', THU);
  await t.engine.run(A.createAppointment, { clientId: c.driss, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: THU, start: 600, force: true }, t.asOwner());
  await t.engine.run(addClosure, { from: WED, to: WED, label: 'Travaux' }, t.asOwner());
  const off = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: THU, reason: 'Maladie' }, t.asOwner());
  const rows = reportPlan(S(t), absenceFor(S(t), { timeoffId: off.id }, o(t)), o(t));
  assert.equal(rows.length, 7, 'every day the absence covers');
  const w = rows.find((r) => r.a.id === wed);
  assert.equal(w.kind, 'call', 'closed that day: nowhere to put him');
  const thu = rows.filter((r) => r.a.day === THU);
  assert.equal(thu.length, 2);
  assert.ok(thu.every((r) => r.to && r.to.staffId === t.ids.Ben));
  assert.notEqual(thu[0].to.start, thu[1].to.start);
  assert.ok(thu.some((r) => r.a.id === one || r.to.start !== 600));
  assert.ok(rows.find((r) => r.a.id === a.yanis).to, 'today still planned');
  // a day in the past, an unknown absence
  assert.throws(() => absenceFor(S(t), { staffId: t.ids.Ali, day: '2026-11-02' }, o(t)), /passée/);
  assert.throws(() => absenceFor(S(t), { timeoffId: 'to_none' }, o(t)), /introuvable/);
});

test('apply: a slot taken in between is reported and not double-booked, the others move; a retried request writes nothing', async () => {
  const { t, c, a, book, desk, plan, moves } = await sickDay();
  const rows = plan();
  // between the preview and the tap, someone books Ben at 11:00
  const thief = await book(c.chris, 660, 'cut', 'Ben');
  const n = t.engine.journal.length;
  const res = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: moves(rows) }, { ...desk(), requestId: 'report-0001' });
  assert.deepEqual(res.moved.map((m) => m.apptId), [a.bilal, a.driss]);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].apptId, a.yanis);
  assert.equal(res.failed[0].code, 'taken');
  assert.match(res.failed[0].message, /11\sh chez Ben n’est plus libre pour Yanis/);
  const s = S(t);
  assert.equal(s.appts.get(a.yanis).staffId, t.ids.Ali, 'left where it was');
  assert.equal(s.appts.get(a.yanis).start, 660);
  assert.deepEqual([...s.apptsByDay.get(DAY)].map((id) => s.appts.get(id)).filter((x) => x.staffId === t.ids.Ben && x.start < 690 && x.start + x.dur > 660).map((x) => x.id), [thief], 'one client in that chair at 11:00');
  assert.deepEqual([s.appts.get(a.bilal).staffId, s.appts.get(a.bilal).start], [t.ids.Ben, 810]);
  assert.deepEqual([s.appts.get(a.driss).staffId, s.appts.get(a.driss).start], [t.ids.Ben, 990]);
  // one append; only moves and texts, in the events that already exist
  const ev = t.engine.journal.slice(n);
  assert.deepEqual([...new Set(ev.map((e) => e.type))].sort(), ['appt.moved', 'message.queued']);
  assert.equal(ev.filter((e) => e.type === 'appt.moved').length, 2);
  assert.equal(new Set(ev.map((e) => e.at)).size, 1);
  // the same request again: the first answer, nothing written, nobody texted again
  const len = t.engine.journal.length;
  const again = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: moves(rows) }, { ...desk(), requestId: 'report-0001' });
  assert.deepEqual(again, res);
  assert.equal(t.engine.journal.length, len);
  // the same plan under another id (a second tap): already where it asks, nothing written either
  const tap = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: moves(rows).filter((m) => m.apptId !== a.yanis) }, { ...desk(), requestId: 'report-0002' });
  assert.equal(tap.moved.length, 2);
  assert.equal(tap.texted, 0);
  assert.equal(t.engine.journal.length, len);
  // two lines of one plan on the same chair at the same time: the second is refused, not stacked
  const two = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: [{ apptId: a.yanis, staffId: t.ids.Ben, start: 900 }, { apptId: a.chris, staffId: t.ids.Ben, start: 900 }] }, desk());
  assert.deepEqual(two.moved.map((m) => m.apptId), [a.yanis]);
  assert.equal(two.failed[0].code, 'service', 'and Ben does not do the décoloration anyway');
  await rejects(t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: [{ apptId: a.chris, staffId: t.ids.Ben, start: 900 }, { apptId: a.chris, staffId: t.ids.Ben, start: 930 }] }, desk()), 'invalid');
});

test('texts: one per moved client, under its key, held for the undo; none for a client left à rappeler or who takes no SMS; the deposit stays', async () => {
  const { t, c, a, desk, plan, moves, texts } = await sickDay();
  // Driss takes no service text; Bilal paid a deposit
  await t.engine.run(updateClient, { id: c.driss, patch: { sms: false } }, t.asOwner());
  const deposit = { amount: 1000, paid: 1000, paymentId: 'py_1' };
  await t.engine.run(raw, { events: [['appt.updated', { id: a.bilal, patch: { deposit } }]] }, t.sys);
  const before = JSON.stringify({ packs: [...S(t).packs.values()], members: S(t).members ? [...S(t).members.values()] : [] });
  const res = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: moves(plan()) }, { ...desk(), requestId: 'report-0003' });
  assert.equal(res.moved.length, 3);
  assert.equal(res.texted, 2);
  const out = texts();
  assert.deepEqual(out.map((m) => m.apptId).sort(), [a.yanis, a.bilal].sort(), 'Yanis and Bilal; not Driss (no SMS), not Chris (à rappeler)');
  const y = out.find((m) => m.apptId === a.yanis), b = out.find((m) => m.apptId === a.bilal);
  // the existing texts of a handover, under their deterministic key
  assert.equal(y.id, 'msg_ra_' + a.yanis + '_' + t.ids.Ben + '_' + DAY + '_660');
  assert.equal(y.template, 'reassign');
  assert.match(y.body, /Ali est absent mardi 3, Ben te prend à 11\sh/);
  assert.equal(b.template, 'reassignAt');
  assert.match(b.body, /Ben te prend à 13\sh\s30 au lieu de 14\sh/);
  for (const m of out) { assert.equal(m.status, 'queued'); assert.equal(m.dueAt, t.clock.now + REPORT_UNDO_MS); assert.equal(m.channel, 'sms'); }
  assert.deepEqual([...S(t).messages.values()].filter((m) => m.apptId === a.chris && m.channel === 'sms').map((m) => m.template), ['confirmation'], 'nothing to the client left à rappeler but the confirmation of his booking');
  // the deposit is the appointment's, a carnet or a membership the client's: untouched
  assert.deepEqual(S(t).appts.get(a.bilal).deposit, deposit);
  assert.equal(JSON.stringify({ packs: [...S(t).packs.values()], members: S(t).members ? [...S(t).members.values()] : [] }), before);
  // the plan asked again later leaves only the client to call, and texts nobody twice
  const left = plan();
  assert.deepEqual(left.map((r) => [r.a.id, r.kind]), [[a.chris, 'call']]);
  assert.equal(texts().length, 2);
});

test('« Annuler »: each appointment goes back if its slot is still free, its held text is closed; the others are named', async () => {
  const { t, c, a, book, desk, plan, moves, texts } = await sickDay();
  const res = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: moves(plan()) }, desk());
  assert.equal(res.moved.length, 3);
  // meanwhile Bilal's old slot (Ali, 14:00) is given to someone else
  await book(c.chris, 840, 'cut', 'Ali');
  const n = t.engine.journal.length;
  const undo = await t.engine.run(undoReport, { moves: res.moved }, { ...desk(), requestId: 'undo-0001' });
  assert.deepEqual(undo.restored.map((x) => x.apptId), [a.yanis, a.driss]);
  assert.equal(undo.failed.length, 1);
  assert.equal(undo.failed[0].apptId, a.bilal);
  assert.match(undo.failed[0].message, /14\sh chez Ali a été pris entre-temps : Bilal/);
  const s = S(t);
  assert.deepEqual([s.appts.get(a.yanis).staffId, s.appts.get(a.yanis).start], [t.ids.Ali, 660]);
  assert.deepEqual([s.appts.get(a.driss).staffId, s.appts.get(a.driss).start], [t.ids.Ali, 1020]);
  assert.deepEqual([s.appts.get(a.bilal).staffId, s.appts.get(a.bilal).start], [t.ids.Ben, 810], 'stays with Ben');
  // Yanis's text never leaves; Bilal, who stays moved, keeps his
  const y = texts().find((m) => m.apptId === a.yanis), b = texts().find((m) => m.apptId === a.bilal);
  assert.deepEqual([y.status, y.error], ['skipped', UNDONE]);
  assert.equal(b.status, 'queued');
  assert.deepEqual([...new Set(t.engine.journal.slice(n).map((e) => e.type))].sort(), ['appt.moved', 'message.updated']);
  // a second tap on « Annuler », or its retry: nothing more
  const len = t.engine.journal.length;
  assert.deepEqual(await t.engine.run(undoReport, { moves: res.moved }, { ...desk(), requestId: 'undo-0001' }), undo);
  const twice = await t.engine.run(undoReport, { moves: res.moved.filter((m) => m.apptId !== a.bilal) }, desk());
  assert.equal(twice.restored.length, 2);
  assert.equal(t.engine.journal.length, len);
  // reported again: the same text is opened again, never a second one
  const redo = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: [{ apptId: a.yanis, staffId: t.ids.Ben, start: 660 }] }, desk());
  assert.equal(redo.texted, 1);
  assert.equal(texts().filter((m) => m.apptId === a.yanis).length, 1);
  assert.equal(texts().find((m) => m.apptId === a.yanis).status, 'queued');
  assert.equal(t.engine.journal.filter((e) => e.type === 'message.queued' && e.data.id === y.id).length, 1);
  // once the text has left, the client knows: « Annuler » leaves him where he was told
  await t.engine.run(raw, { events: [['message.updated', { id: y.id, patch: { status: 'sent' } }]] }, t.sys);
  const late = await t.engine.run(undoReport, { moves: redo.moved }, desk());
  assert.equal(late.restored.length, 0);
  assert.equal(late.failed[0].code, 'texted');
  assert.equal(S(t).appts.get(a.yanis).staffId, t.ids.Ben);
});

test('rights: whoever may move any chair’s appointment (owner, manager, front desk); never a barber, even the absent one', async () => {
  const { t, a, desk, manager, plan, moves } = await sickDay();
  const one = [moves(plan())[0]];
  const n = t.engine.journal.length;
  for (const who of ['Ben', 'Ali']) {
    const e = await rejects(t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: one }, t.asStaff(who)), 'forbidden');
    assert.equal(e.status, 403);
    await rejects(t.engine.run(undoReport, { moves: [{ apptId: a.yanis, from: { staffId: t.ids.Ben, day: DAY, start: 660 }, to: { staffId: t.ids.Ali, day: DAY, start: 660 } }] }, t.asStaff(who)), 'forbidden');
  }
  assert.equal(t.engine.journal.length, n, 'a refusal writes nothing');
  for (const who of [desk(), manager(), t.asOwner()]) {
    const res = await t.engine.run(reportAppointments, { staffId: t.ids.Ali, moves: one }, who);
    assert.equal(res.moved.length, 1);
    const back = await t.engine.run(undoReport, { moves: res.moved.filter((m) => m.from) }, who);
    assert.equal(back.restored.length, 1);
  }
});
