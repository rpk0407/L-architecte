// FEATURE D: a barber cashes his own client on his phone; the cash he takes stays with him until he hands it to the drawer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY } from '../helpers.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { updateSettings } from '../../server/commands/shop.js';
import { drawerExpected, heldCash, dayTotals } from '../../server/domain/cash.js';
import { tillDay, tillMonth } from '../../server/domain/till.js';
import { capsOf } from '../../server/domain/permissions.js';

const appt = (t, staff = 'Ali', start = 600) => t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids[staff], day: DAY, start }, t.asOwner());
const sale = (a, t, pay, extra = {}) => ({ apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: pay, phone: true, ...extra });

test('a barber cashes his own appointment on his phone, never a colleague’s', async () => {
  const t = await salon();
  const mine = await appt(t, 'Ali', 600), other = await appt(t, 'Ben', 600);
  assert.ok(t.asStaff('Ali').caps.has('sale.phone'));
  await rejects(t.engine.run(S.checkout, sale(other, t, [{ method: 'card', amount: 2000 }]), t.asStaff('Ali')), 'own');
  const r = await t.engine.run(S.checkout, sale(mine, t, [{ method: 'card', amount: 2000 }]), t.asStaff('Ali'));
  assert.equal(t.engine.state.sales.get(r.id).cashierId, t.ids.Ali);
  // the owner (who also cuts) is not held to his own chair
  const r2 = await t.engine.run(S.checkout, sale(other, t, [{ method: 'card', amount: 2000 }]), t.asOwner());
  assert.ok(r2.id);
});

test('the owner switches phone checkout off, or cash on the phone only', async () => {
  const t = await salon();
  const a = await appt(t);
  await t.engine.run(updateSettings, { team: { barberPhone: false } }, t.asOwner());
  assert.equal(t.asStaff('Ali').caps.has('sale.phone'), false);
  await rejects(t.engine.run(S.checkout, sale(a, t, [{ method: 'card', amount: 2000 }]), t.asStaff('Ali')), 'forbidden');
  await t.engine.run(updateSettings, { team: { barberPhone: true, barberPhoneCash: false } }, t.asOwner());
  await rejects(t.engine.run(S.checkout, sale(a, t, [{ method: 'cash', amount: 2000 }]), t.asStaff('Ali')), 'cash');
  // no « Encaisser » at all: no phone either
  await t.engine.run(updateSettings, { team: { barberCheckout: false, barberPhoneCash: true } }, t.asOwner());
  assert.equal(capsOf(t.engine.state.staff.get(t.ids.Ali), t.engine.state.settings).has('sale.phone'), false);
});

test('cash taken on the phone is the barber’s to hand over, never in the drawer’s count', async () => {
  const t = await salon();
  const a = await appt(t);
  // the drawer is closed: a barber's pocket does not need it
  const r = await t.engine.run(S.checkout, sale(a, t, [{ method: 'cash', amount: 2300, given: 5000 }], { tip: { amount: 300, staffId: t.ids.Ali } }), t.asStaff('Ali'));
  assert.equal(r.change, 2700);
  // the tip is paid in cash too: 2 300 in his pocket
  assert.equal(r.totals.due, 2300);
  await rejects(t.engine.run(S.checkout, { ...sale(a, t, [{ method: 'cash', amount: 2300 }]), phone: true }, t.asStaff('Ali')), 'paid');
  const s = t.engine.state;
  assert.equal(heldCash(s).get(t.ids.Ali), 2300);
  assert.equal(dayTotals(s, DAY).byMethod.cash, 2300);
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  assert.equal(drawerExpected(s, s.drawer), 10000);
  await rejects(t.engine.run(S.moveDrawer, { amount: 5000, reason: 'Espèces remises par Ali', staffId: t.ids.Ali }, t.asOwner()), 'invalid');
  await t.engine.run(S.moveDrawer, { amount: 2300, reason: 'Espèces remises par Ali', staffId: t.ids.Ali }, t.asOwner());
  assert.equal(heldCash(s).get(t.ids.Ali), undefined);
  assert.equal(drawerExpected(s, s.drawer), 12300);
  // at the shared till, without the phone flag, cash still needs the drawer (unchanged)
  const b = await appt(t, 'Ben', 660);
  await t.engine.run(S.closeDrawer, { counts: { 10000: 1, 2000: 1, 200: 1, 100: 1 } }, t.asOwner());
  await rejects(t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'cash', amount: 2000 }] }, t.asStaff('Ben')), 'drawer_closed');
  assert.equal(t.engine.verify().ok, true);
});

test('the Caisse home and the month read the same figures as the Z', async () => {
  const t = await salon({ hour: 12 });
  const a = await appt(t, 'Ali', 600), b = await appt(t, 'Ben', 630);
  await t.engine.run(S.checkout, sale(a, t, [{ method: 'cash', amount: 2000 }]), t.asStaff('Ali'));
  const day = tillDay(t.engine.state, DAY, 720);
  // Ben's client finished at 11:00, not paid: on the list with who and how long ago
  assert.deepEqual(day.toPay.map((x) => [x.id, x.staffId, x.waited]), [[b.id, t.ids.Ben, 60]]);
  assert.equal(day.takings, 2000);
  assert.deepEqual(day.methods, [{ method: 'cash', amount: 2000 }]);
  assert.equal(day.staff[0].id, t.ids.Ali);
  assert.equal(day.staff[0].cash, 2000);
  assert.deepEqual(day.held, [{ id: t.ids.Ali, name: 'Ali', amount: 2000 }]);
  const m = tillMonth(t.engine.state, DAY.slice(0, 7), DAY, t.clock.now);
  assert.equal(m.takings, 2000);
  const ali = m.staff.find((x) => x.id === t.ids.Ali);
  assert.equal(ali.performed, 2000);
  assert.equal(ali.commission, 800);
});
