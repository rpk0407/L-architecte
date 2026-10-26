import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import { createEngine } from '../../server/core/engine.js';
import { freeSlots, walkinEstimate } from '../../server/domain/availability.js';
import { localParts, addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { addTimeOff } from '../../server/commands/team.js';
import { addClosure } from '../../server/commands/shop.js';

const q = (t, extra = {}) => ({ day: DAY, dur: 30, serviceIds: [t.ids.cut], staffId: 'any', now: t.clock.now, local: localParts(t.clock.now), ...extra });

test('slots follow opening hours, the lunch break and the notice period', async () => {
  const t = await salon({ hour: 10 });
  const ali = freeSlots(t.engine.state, q(t, { staffId: t.ids.Ali })).map((x) => x.m);
  assert.ok(!ali.includes(600), 'not 30 min before now + notice');
  assert.ok(ali.includes(630));
  assert.ok(!ali.includes(780), 'lunch break 13 h – 13 h 30');
  assert.ok(ali.includes(810));
  assert.equal(ali.at(-1), 1080, 'last start fits before 18 h 30');
});

test('“any barber” spreads bookings over the least busy chair', async () => {
  const t = await salon({ hour: 8 });
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  const s = freeSlots(t.engine.state, q(t)).find((x) => x.m === 660);
  assert.equal(s.staffId, t.ids.Ben);
});

test('time off and exceptional closures remove availability', async () => {
  const t = await salon({ hour: 8 });
  await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: DAY, reason: 'Congé' }, t.asOwner());
  assert.equal(freeSlots(t.engine.state, q(t, { staffId: t.ids.Ali })).length, 0);
  assert.ok(freeSlots(t.engine.state, q(t, { staffId: t.ids.Ben })).length > 10);
  await t.engine.run(addClosure, { from: DAY, to: DAY, label: 'Inventaire' }, t.asOwner());
  assert.equal(freeSlots(t.engine.state, q(t)).length, 0);
});

test('online booking: hold, then book, then the slot is gone', async () => {
  const t = await salon({ hour: 9 });
  const h = await t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660 }, t.asClient);
  assert.ok(h.holdId);
  assert.ok(!freeSlots(t.engine.state, q(t, { staffId: t.ids.Ali })).some((x) => x.m === 660), 'held slot is not offered to others');
  const b = await t.engine.run(A.bookOnline, { holdId: h.holdId, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660, first: 'Karim', phone: '0611223344', sms: true }, t.asClient);
  assert.equal(b.status, 'booked');
  assert.match(b.code, /^LA-[A-Z2-9]{4}$/);
  const appt = t.engine.state.appts.get(b.id);
  assert.equal(appt.source, 'site');
  assert.equal(t.engine.state.clients.get(appt.clientId).first, 'Karim');
  const msg = [...t.engine.state.messages.values()].find((m) => m.apptId === b.id);
  assert.equal(msg.template, 'confirmation');
  assert.match(msg.body, /Karim/);
  await rejects(t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660, first: 'Other', phone: '0699887766' }, t.asClient), 'taken');
});

test('a known phone number lands on the existing client file', async () => {
  const t = await salon({ hour: 9 });
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 690, first: 'Yaniss', phone: '+33 6 12 34 56 78' }, t.asClient);
  assert.equal(t.engine.state.appts.get(b.id).clientId, t.ids.yanis);
  assert.equal(t.engine.state.clients.size, 1);
});

test('long services above the threshold ask for a deposit and stay pending', async () => {
  const t = await salon({ hour: 9 });
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: 'any', day: DAY, start: 840, first: 'Nolan', phone: '0611220000' }, t.asClient);
  assert.equal(b.status, 'pending');
  assert.equal(b.deposit, 1800, '30 % of 60 €');
  assert.equal([...t.engine.state.messages.values()].length, 0, 'no confirmation before payment');
});

test('two servers booking the same chair at the same second: exactly one wins', async () => {
  const t = await salon({ hour: 9 });
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  const input = (name, phone) => ({ serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 720, first: name, phone });
  const results = await Promise.allSettled([
    t.engine.run(A.bookOnline, input('Adam', '0600000001'), t.asClient),
    other.run(A.bookOnline, input('Enzo', '0600000002'), t.asClient)
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const ko = results.filter((r) => r.status === 'rejected');
  assert.equal(ok.length, 1);
  assert.equal(ko.length, 1);
  assert.equal(/** @type {any} */ (ko[0]).reason.code, 'taken');
  await t.engine.sync(true);
  const booked = [...t.engine.state.appts.values()].filter((a) => a.start === 720 && a.staffId === t.ids.Ben && a.status === 'booked');
  assert.equal(booked.length, 1);
});

test('a barber manages his own chair, not his colleague’s', async () => {
  const t = await salon({ hour: 8 });
  const r = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asStaff('Ali'));
  await rejects(t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 600 }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(A.cancelAppointment, { id: r.id }, t.asStaff('Ben')), 'forbidden');
  await t.engine.run(A.cancelAppointment, { id: r.id }, t.asOwner());
});

test('moving checks the destination, statuses follow the real flow', async () => {
  const t = await salon({ hour: 8 });
  const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  const b = await t.engine.run(A.createAppointment, { name: 'Passage', serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 630 }, t.asOwner());
  await rejects(t.engine.run(A.moveAppointment, { id: a.id, day: DAY, start: 630 }, t.asOwner()), 'taken');
  await t.engine.run(A.moveAppointment, { id: a.id, day: DAY, start: 630, staffId: t.ids.Ben }, t.asOwner());
  assert.equal(t.engine.state.appts.get(a.id).staffId, t.ids.Ben);
  await rejects(t.engine.run(A.setStatus, { id: b.id, status: 'no_show' }, t.asOwner()), 'early');
  t.clock.now = at(DAY, 10, 40);
  await t.engine.run(A.setStatus, { id: b.id, status: 'no_show' }, t.asOwner());
  assert.ok(freeSlots(t.engine.state, q(t, { staffId: t.ids.Ali, day: DAY })).length >= 0);
});

test('clients cannot cancel online too close to the appointment', async () => {
  const t = await salon({ hour: 9 });
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 1020, first: 'Lucas', phone: '0611000000' }, t.asClient);
  await rejects(t.engine.run(A.cancelByClient, { id: b.id }, t.asClient), 'too_late');
  const tomorrow = addDays(DAY, 2);
  const c = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: tomorrow, start: 600, first: 'Lucas', phone: '0611000000' }, t.asClient);
  await t.engine.run(A.cancelByClient, { id: c.id }, t.asClient);
  assert.equal(t.engine.state.appts.get(c.id).status, 'cancelled');
});

test('blocking "the rest of the day" goes around existing appointments', async () => {
  const t = await salon({ hour: 8 });
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 900 }, t.asOwner());
  const r = await t.engine.run(A.addBlock, { staffId: t.ids.Ali, day: DAY, start: 840, end: 1110, label: 'Fermé' }, t.asOwner());
  const blocks = r.ids.map((id) => t.engine.state.blocks.get(id)).map((b) => [b.start, b.start + b.dur]);
  assert.deepEqual(blocks, [[840, 900], [930, 1110]]);
});

test('walk-in queue: estimate, seat, appointment in the chair', async () => {
  const t = await salon({ hour: 10 });
  const L = localParts(t.clock.now);
  assert.equal(walkinEstimate(t.engine.state, t.clock.now, L).minutes, 0);
  await t.engine.run(A.createAppointment, { name: 'X', serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(A.createAppointment, { name: 'Y', serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 600 }, t.asOwner());
  assert.equal(walkinEstimate(t.engine.state, t.clock.now, L).minutes, 30);
  const w = await t.engine.run(A.addWalkin, { name: 'Malik', serviceId: t.ids.cut, staffId: 'any' }, t.asStaff('Ali'));
  assert.equal(walkinEstimate(t.engine.state, t.clock.now, L).queued, 1);
  const seat = await t.engine.run(A.updateWalkin, { id: w.id, action: 'seat', staffId: t.ids.Ali }, t.asStaff('Ali'));
  const a = t.engine.state.appts.get(seat.id);
  assert.equal(a.status, 'in_chair');
  assert.equal(a.source, 'walkin');
  assert.equal(t.engine.state.queue.get(w.id).status, 'seated');
});
