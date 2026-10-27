// The till keeps the price the client booked at (or today's when lower), and a barber credits only his own work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { updateService } from '../../server/commands/catalog.js';
import { addStaff } from '../../server/commands/team.js';
import { eraseClient } from '../../server/commands/clients.js';

const book = (t, { staff = 'Ali', start = 600, svc = ['cut'] } = {}) =>
  t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: svc.map((x) => t.ids[x]), staffId: t.ids[staff], day: DAY, start }, t.asOwner());
const raise = (t, svc, price) => t.engine.run(updateService, { id: t.ids[svc], patch: { price } }, t.asOwner());
const card = (amount) => [{ method: 'card', amount }];

test('booked at 20 €, the price goes up to 22 €: the booked client still pays 20 €, a new sale 22 €', async () => {
  const t = await salon();
  const a = await book(t);
  await raise(t, 'cut', 2200);
  // a barber, no unit sent: the line takes the appointment's stored price
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2000) }, t.asStaff('Ali'));
  const sale = t.engine.state.sales.get(r.id);
  assert.equal(sale.lines[0].unit, 2000);
  assert.equal(r.totals.due, 2000);
  // a walk-in sale with no appointment is at today's price
  const w = await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2200) }, t.asStaff('Ali'));
  assert.equal(t.engine.state.sales.get(w.id).lines[0].unit, 2200);
  await rejects(t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2000) }, t.asStaff('Ali')), 'unbalanced');
});

test('the price went up: a barber charges the booked price, not today’s; the owner chooses', async () => {
  const t = await salon();
  const a = await book(t, { svc: ['cut', 'beard'] });
  await raise(t, 'cut', 2200);
  await raise(t, 'beard', 3300);
  // neither today's higher price nor anything in between
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2200 }, { kind: 'service', ref: t.ids.beard }], payments: card(5200) }, t.asStaff('Ali')), 'price');
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2100 }, { kind: 'service', ref: t.ids.beard }], payments: card(5100) }, t.asStaff('Ali')), 'price');
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2000 }, { kind: 'service', ref: t.ids.beard }], payments: card(5000) }, t.asStaff('Ali'));
  assert.deepEqual(t.engine.state.sales.get(r.id).lines.map((l) => l.unit), [2000, 3000]);
  const b = await book(t, { start: 660 });
  const o = await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2200 }], payments: card(2200) }, t.asOwner());
  assert.equal(o.totals.due, 2200);
});

test('the price went down: the booked client pays the new, lower price', async () => {
  const t = await salon();
  const a = await book(t);
  await raise(t, 'cut', 1800);
  // the old price is refused to a barber, and no unit means the lower one
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2000 }], payments: card(2000) }, t.asStaff('Ali')), 'price');
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(1800) }, t.asStaff('Ali'));
  assert.equal(t.engine.state.sales.get(r.id).lines[0].unit, 1800);
  // the owner may still keep the booked price
  const b = await book(t, { start: 660 });
  const o = await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2000 }], payments: card(2000) }, t.asOwner());
  assert.equal(o.totals.due, 2000);
});

test('lines in any order: the booked price goes to the line that sent it', async () => {
  const t = await salon();
  const a = await book(t);
  await raise(t, 'cut', 2200);
  // today's price first, the booked one second: the extra cut is the walk-in, the booked one keeps 20 €
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 2200 }, { kind: 'service', ref: t.ids.cut, unit: 2000 }], payments: card(4200) }, t.asStaff('Ali'));
  assert.deepEqual(t.engine.state.sales.get(r.id).lines.map((l) => l.unit), [2200, 2000]);
});

test('the booked price covers the booked services only, once each', async () => {
  const t = await salon();
  const a = await book(t);
  await raise(t, 'cut', 2200);
  // a second cut added on the ticket (a brother in the next chair) is at today's price
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }, { kind: 'service', ref: t.ids.cut }], payments: card(4200) }, t.asStaff('Ali'));
  assert.deepEqual(t.engine.state.sales.get(r.id).lines.map((l) => l.unit), [2000, 2200]);
});

test('“dès” services: the barber can go up from the booked price', async () => {
  const t = await salon();
  const a = await book(t, { svc: ['color'] });
  await raise(t, 'color', 6500);
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.color, unit: 6200 }], payments: card(6200) }, t.asStaff('Ali'));
  assert.equal(r.totals.due, 6200);
});

test('a barber credits a line to himself or to the appointment’s barber; another barber → 403, the owner → ok', async () => {
  const t = await salon();
  const a = await book(t);
  const line = (staffId) => [{ kind: 'service', ref: t.ids.cut, staffId }];
  const e = await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: line(t.ids.Ben), payments: card(2000) }, t.asStaff('Ali')), 'performer');
  assert.equal(e.status, 403);
  assert.equal(e.message, 'Seul le gérant peut attribuer la prestation d’un autre barbier.');
  // Ben checks out Ali's client: he may leave it to Ali, or take it himself, not give it to someone else
  const b = await book(t, { start: 660 });
  await rejects(t.engine.run(S.checkout, { apptId: b.id, lines: line(t.ownerId), payments: card(2000) }, t.asStaff('Ben')), 'performer');
  const r = await t.engine.run(S.checkout, { apptId: b.id, lines: line(t.ids.Ali), payments: card(2000) }, t.asStaff('Ben'));
  assert.equal(t.engine.state.sales.get(r.id).lines[0].staffId, t.ids.Ali);
  // a product on a free sale: only himself
  await rejects(t.engine.run(S.checkout, { lines: [{ kind: 'product', ref: t.ids.oil, staffId: t.ids.Ali }], payments: card(1500) }, t.asStaff('Ben')), 'performer');
  // the owner gives the line to anyone on the team
  const o = await t.engine.run(S.checkout, { apptId: a.id, lines: line(t.ids.Ben), payments: card(2000) }, t.asOwner());
  assert.equal(t.engine.state.sales.get(o.id).lines[0].staffId, t.ids.Ben);
  // …who must exist
  const c = await book(t, { start: 720 });
  await rejects(t.engine.run(S.checkout, { apptId: c.id, lines: line('st_nobody'), payments: card(2000) }, t.asOwner()), 'not_found');
});

test('the desk rings up for the barbers: it credits any chair; the demo back-fill too', async () => {
  const t = await salon();
  const d = await t.engine.run(addStaff, { name: 'Inès', role: 'desk' }, t.asOwner());
  t.ids.Ines = d.id;
  const r = await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: card(2000) }, t.asStaff('Ines'));
  assert.equal(t.engine.state.sales.get(r.id).lines[0].staffId, t.ids.Ali);
  const a = await book(t);
  const o = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ben }], payments: card(2000) }, t.asStaff('Ines'));
  assert.equal(t.engine.state.sales.get(o.id).lines[0].staffId, t.ids.Ben);
  const sys = await t.engine.run(S.checkout, { lines: [{ kind: 'product', ref: t.ids.oil, staffId: t.ids.Ben }], payments: card(1500) }, t.sys);
  assert.equal(t.engine.state.sales.get(sys.id).lines[0].staffId, t.ids.Ben);
});

test('a typed discount reason stays out of the chain and goes with the client’s erasure', async () => {
  const t = await salon();
  const a = await book(t);
  const base = { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(1800) };
  await rejects(t.engine.run(S.checkout, { ...base, discount: { amount: 200, reason: 'x'.repeat(41) } }, t.asStaff('Ali')), 'invalid');
  const r = await t.engine.run(S.checkout, { ...base, discount: { amount: 200, reason: 'Pote de Karim' } }, t.asStaff('Ali'));
  const ev = (await t.store.read(0)).events.find((e) => e.type === 'sale.completed' && e.data.id === r.id);
  assert.deepEqual(ev.data.discount, { amount: 200, reason: 'Autre' });
  assert.equal(ev.pii.discountReason, 'Pote de Karim');
  assert.equal(t.engine.state.sales.get(r.id).discountNote, 'Pote de Karim');
  // a preset reason is not personal: it stays in the books as it is
  const b = await book(t, { start: 660 });
  const p = await t.engine.run(S.checkout, { ...base, apptId: b.id, discount: { amount: 200, reason: 'Fidélité' } }, t.asStaff('Ali'));
  assert.equal(t.engine.state.sales.get(p.id).discount.reason, 'Fidélité');
  assert.equal(t.engine.state.sales.get(p.id).discountNote, '');
  await t.engine.run(eraseClient, { id: t.ids.yanis }, t.asOwner());
  assert.equal(t.engine.state.sales.get(r.id).discountNote, '');
  const after = (await t.store.read(0)).events.find((e) => e.type === 'sale.completed' && e.data.id === r.id);
  assert.equal(after.pii, undefined);
});
