import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { paymentSucceeded, createPayment } from '../../server/commands/payments.js';
import { updateSettings } from '../../server/commands/shop.js';
import { dayTotals } from '../../server/domain/cash.js';

async function apptFor(t, staff = 'Ali', start = 600, svc = 'cut') {
  return t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids[svc]], staffId: t.ids[staff], day: DAY, start }, t.asOwner());
}

test('card checkout closes the appointment and numbers the ticket', async () => {
  const t = await salon();
  const a = await apptFor(t);
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  assert.equal(r.number, 1);
  assert.equal(t.engine.state.appts.get(a.id).status, 'done');
  const sale = t.engine.state.sales.get(r.id);
  assert.equal(sale.lines[0].staffId, t.ids.Ali, 'the performer gets the line, for commissions');
  assert.deepEqual(sale.totals.vat, [{ rate: 2000, base: 1667, tax: 333 }]);
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner()), 'paid');
  const b = await apptFor(t, 'Ben');
  const r2 = await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  assert.equal(r2.number, 2);
});

test('payments must match the total exactly', async () => {
  const t = await salon();
  const a = await apptFor(t);
  const e = await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 1900 }] }, t.asOwner()), 'unbalanced');
  assert.equal(e.extra.due, 2000);
});

test('cash needs an open drawer, gives change, and the count finds every cent', async () => {
  const t = await salon();
  const a = await apptFor(t);
  const line = [{ kind: 'service', ref: t.ids.cut }, { kind: 'product', ref: t.ids.oil }];
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: line, payments: [{ method: 'cash', amount: 3500, given: 5000 }] }, t.asOwner()), 'drawer_closed');
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: line, tip: { amount: 200, staffId: t.ids.Ali }, payments: [{ method: 'cash', amount: 3700, given: 5000 }] }, t.asOwner());
  assert.equal(r.change, 1300);
  assert.equal(t.engine.state.products.get(t.ids.oil).stock, 9, 'stock follows sales');
  await t.engine.run(S.moveDrawer, { amount: -2000, reason: 'Dépôt banque' }, t.asOwner());
  const e = await rejects(t.engine.run(S.closeDrawer, { counts: { 5000: 1, 2000: 1 } }, t.asOwner()), 'note');
  assert.equal(e.extra.expected, 11700);
  const ok = await t.engine.run(S.closeDrawer, { counts: { 5000: 2, 1000: 1, 500: 1, 200: 1 } }, t.asOwner());
  assert.equal(ok.diff, 0);
});

test('barbers are capped on discounts and need a reason', async () => {
  const t = await salon();
  const a = await apptFor(t, 'Ali', 600, 'beard');
  const base = { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }] };
  await rejects(t.engine.run(S.checkout, { ...base, discount: { amount: 600, reason: 'Ami' }, payments: [{ method: 'card', amount: 2400 }] }, t.asStaff('Ali')), 'discount');
  await rejects(t.engine.run(S.checkout, { ...base, discount: { amount: 300 }, payments: [{ method: 'card', amount: 2700 }] }, t.asStaff('Ali')), 'invalid');
  const r = await t.engine.run(S.checkout, { ...base, discount: { amount: 300, reason: 'Fidélité' }, payments: [{ method: 'card', amount: 2700 }] }, t.asStaff('Ali'));
  assert.equal(r.totals.revenue, 2700);
});

test('fixed prices cannot be edited at the till, “dès” prices can go up', async () => {
  const t = await salon();
  const a = await apptFor(t);
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, unit: 1000 }], payments: [{ method: 'card', amount: 1000 }] }, t.asStaff('Ali')), 'price');
  const b = await apptFor(t, 'Ben', 600, 'color');
  const r = await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.color, unit: 7500 }], payments: [{ method: 'card', amount: 7500 }] }, t.asStaff('Ben'));
  assert.equal(r.totals.revenue, 7500);
});

test('gift card: sold as a liability, spent as a payment, never overspent', async () => {
  const t = await salon();
  const sold = await t.engine.run(S.checkout, { lines: [{ kind: 'giftcard', unit: 3000, recipient: 'Pour Adam' }], payments: [{ method: 'card', amount: 3000 }] }, t.asOwner());
  const code = sold.giftcards[0].code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(t.engine.state.sales.get(sold.id).totals.revenue, 0);
  const a = await apptFor(t, 'Ali', 600, 'beard');
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'giftcard', amount: 3000, ref: 'NOPE-NOPE-NOPE' }] }, t.asOwner()), 'giftcard');
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'giftcard', amount: 2000, ref: code.toLowerCase() }, { method: 'card', amount: 1000 }] }, t.asOwner());
  const g = [...t.engine.state.giftcards.values()][0];
  assert.equal(g.balance, 1000);
  const b = await apptFor(t, 'Ben');
  await rejects(t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 2000, ref: code }] }, t.asOwner()), 'giftcard');
});

test('subscription: sold with the first cut, then covers the next ones', async () => {
  const t = await salon();
  await t.engine.run((await import('../../server/commands/catalog.js')).updateService, { id: t.ids.pack, patch: { pack: { credits: 5, days: 70, serviceIds: [t.ids.cut] } } }, t.asOwner());
  const a = await apptFor(t);
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: [{ method: 'card', amount: 8000 }] }, t.asOwner());
  assert.equal(r.totals.revenue, 8000, 'the pack is the revenue, the cut is covered');
  const pk = [...t.engine.state.packs.values()][0];
  assert.equal(pk.used, 1);
  const b = await apptFor(t, 'Ben', 660);
  await rejects(t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.beard, packId: pk.id }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner()), 'pack_service');
  const r2 = await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk.id }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner());
  assert.equal(r2.totals.due, 0);
  assert.equal(t.engine.state.packs.get(pk.id).used, 2);
});

test('an online deposit is deducted at the till, once', async () => {
  const t = await salon({ hour: 9 });
  const b = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: t.ids.Ali, day: DAY, start: 840, first: 'Nolan', phone: '0611220000' }, t.asClient);
  await t.engine.run(createPayment, { id: 'py_1', kind: 'deposit', amount: 1800, provider: 'simulated', providerRef: 'sim_1', apptId: b.id }, t.asClient);
  await t.engine.run(paymentSucceeded, { providerRef: 'sim_1', amount: 1800 }, { actor: { t: 'provider', id: 'simulated' } });
  assert.equal(t.engine.state.appts.get(b.id).status, 'booked', 'confirmed once paid');
  await t.engine.run(paymentSucceeded, { providerRef: 'sim_1', amount: 1800 }, { actor: { t: 'provider', id: 'simulated' } });
  const pay = [{ method: 'deposit', amount: 1800, ref: 'py_1' }, { method: 'card', amount: 4200 }];
  await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.color }], payments: pay }, t.asOwner());
  const c = await apptFor(t, 'Ben', 600);
  await rejects(t.engine.run(S.checkout, { apptId: c.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'deposit', amount: 1800, ref: 'py_1' }, { method: 'card', amount: 200 }] }, t.asOwner()), 'used');
});

test('refunds are credit notes within what was paid; Z closure seals the day', async () => {
  const t = await salon();
  const a = await apptFor(t);
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await rejects(t.engine.run(S.refund, { saleId: r.id, amount: 500, method: 'card', reason: 'Geste' }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(S.refund, { saleId: r.id, amount: 2500, method: 'card', reason: 'Trop' }, t.asOwner()), 'invalid');
  const rf = await t.engine.run(S.refund, { saleId: r.id, amount: 500, method: 'card', reason: 'Geste commercial' }, t.asOwner());
  assert.equal(rf.number, 1);
  const tot = dayTotals(t.engine.state, DAY);
  assert.equal(tot.net, 1500);
  const z = await t.engine.run(S.closeDay, {}, t.asOwner());
  assert.equal(z.number, 1);
  assert.equal(z.grandTotal, 1500);
  const b = await apptFor(t, 'Ben');
  await rejects(t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner()), 'day_closed');
  assert.equal(t.engine.verify().ok, true);
});

test('the same checkout sent twice (flaky network) records one ticket', async () => {
  const t = await salon();
  const a = await apptFor(t);
  const input = { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] };
  const ctx = { ...t.asOwner(), requestId: 'b6f0a1d2-1111-4c2e-9f00-aaaaaaaaaaaa' };
  const r1 = await t.engine.run(S.checkout, input, ctx);
  const r2 = await t.engine.run(S.checkout, input, ctx);
  assert.equal(r1.id, r2.id);
  assert.equal(t.engine.state.sales.size, 1);
});

test('the owner can stop barbers from cashing in', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { team: { barberCheckout: false } }, t.asOwner());
  const a = await apptFor(t);
  await rejects(t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asStaff('Ali')), 'forbidden');
});

test('ticket at the end of the day uses the shop clock', async () => {
  const t = await salon({ hour: 18 });
  t.clock.now = at(DAY, 18, 25);
  const a = await apptFor(t, 'Ali', 1050);
  const r = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  assert.equal(t.engine.state.sales.get(r.id).day, DAY);
});
