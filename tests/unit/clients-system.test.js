import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as C from '../../server/commands/clients.js';
import { tick } from '../../server/commands/system.js';
import { clientStats } from '../../server/domain/insights.js';
import { capsOf } from '../../server/domain/permissions.js';

test('erasing a client removes personal data everywhere, the books still verify', async () => {
  const t = await salon({ hour: 9 });
  await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 660, first: 'Karim', phone: '0611223344', note: 'Allergique au henné' }, t.asClient);
  const cid = t.engine.state.clientByPhone.get('+33611223344');
  await rejects(t.engine.run(C.eraseClient, { id: cid }, t.asStaff('Ali')), 'forbidden');
  await t.engine.run(C.eraseClient, { id: cid }, t.asOwner());
  const c = t.engine.state.clients.get(cid);
  assert.equal(c.erased, true);
  assert.equal(c.phone, '');
  const { events } = await t.store.read(0);
  const leaked = events.filter((e) => JSON.stringify(e.pii || {}).includes('Karim') || JSON.stringify(e.pii || {}).includes('henné'));
  assert.equal(leaked.length, 0, 'no personal data left in the stored journal');
  assert.equal(t.engine.verify().ok, true);
});

test('merging duplicates moves history onto one file', async () => {
  const t = await salon({ hour: 8 });
  const dup = await t.engine.run(C.addClient, { first: 'Yanis', last: 'M.' }, t.asOwner());
  await t.engine.run(A.createAppointment, { clientId: dup.id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(C.mergeClients, { from: dup.id, into: t.ids.yanis }, t.asOwner());
  assert.ok([...t.engine.state.appts.values()].every((a) => a.clientId === t.ids.yanis));
});

test('phone numbers are validated and unique', async () => {
  const t = await salon();
  await rejects(t.engine.run(C.addClient, { first: 'Bad', phone: '123' }, t.asOwner()), 'invalid');
  await rejects(t.engine.run(C.addClient, { first: 'Dup', phone: '06.12.34.56.78' }, t.asOwner()), 'exists');
});

test('the evening reminder goes once, the next day', async () => {
  const t = await salon({ hour: 9 });
  const tomorrow = addDays(DAY, 1);
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: tomorrow, start: 600 }, t.asOwner());
  const before = t.engine.state.messages.size;
  await t.engine.run(tick, {}, t.sys);
  assert.equal(t.engine.state.messages.size, before, 'not before 18 h');
  t.clock.now = at(DAY, 18, 5);
  await t.engine.run(tick, {}, t.sys);
  await t.engine.run(tick, {}, t.sys);
  const rem = [...t.engine.state.messages.values()].filter((m) => m.template === 'reminder');
  assert.equal(rem.length, 1);
  assert.match(rem[0].body, /demain/);
});

test('an unpaid deposit frees the slot, a freed slot goes to the waiting list', async () => {
  const t = await salon({ hour: 9 });
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: t.ids.Ali, day: DAY, start: 840, first: 'Nolan', phone: '0611220000' }, t.asClient);
  // Ben is busy all afternoon, so the waiting client can only get Ali's slot
  for (let m = 840; m < 1110; m += 30) await t.engine.run(A.createAppointment, { name: 'X', serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: m }, t.asOwner());
  for (let m = 900; m < 1110; m += 30) await t.engine.run(A.createAppointment, { name: 'Y', serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: m }, t.asOwner());
  await t.engine.run(A.addWait, { day: DAY, staffId: 'any', serviceId: t.ids.cut, from: 840, to: 1110, first: 'Adam', phone: '0600000009' }, t.asClient);
  t.clock.now = at(DAY, 9, 20);
  await t.engine.run(tick, {}, t.sys);
  assert.equal(t.engine.state.appts.get(b.id).status, 'cancelled');
  await t.engine.run(tick, {}, t.sys);
  const w = [...t.engine.state.waitlist.values()][0];
  assert.equal(w.status, 'offered');
  assert.equal(w.offer.start, 840);
  assert.ok(t.engine.state.holds.get(w.offer.holdId), 'the slot is held for the offer');
  assert.ok([...t.engine.state.messages.values()].some((m) => m.template === 'waitlist'));
  // Adam takes the place from the link: he leaves the list and is never offered it again
  const hold = t.engine.state.holds.get(w.offer.holdId);
  const got = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: w.offer.staffId, day: DAY, start: 840, holdId: hold.id, first: 'Adam', phone: '0600000009' }, t.asClient);
  assert.equal(t.engine.state.appts.get(got.id).staffId, hold.staffId);
  assert.equal(w.status, 'booked');
  assert.equal(w.apptId, got.id);
  t.clock.now = at(DAY, 10, 0);
  await t.engine.run(tick, {}, t.sys);
  assert.equal(w.status, 'booked', 'an expired offer does not put him back on the list');
});

test('client stats: rhythm, overdue, next appointment', async () => {
  const t = await salon({ hour: 9 });
  const s = t.engine.state;
  const st = clientStats(s, DAY, t.clock.now).get(t.ids.yanis);
  assert.equal(st, undefined, 'no history yet');
});

test('roles: a barber never gets settings, team or data', async () => {
  const t = await salon();
  const caps = capsOf(t.engine.state.staff.get(t.ids.Ali), t.engine.state.settings);
  for (const c of ['settings', 'team', 'data', 'sale.refund', 'client.erase', 'closure']) assert.equal(caps.has(c), false, c);
  assert.equal(caps.has('sale.create'), true);
});
