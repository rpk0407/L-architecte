// WP-12 · A deposit paid on the old site is settled at the till as « Payé sur l’ancien site »: once, up to what was paid there,
// counted as prepaid (not as takings), the revenue and the VAT on the full price; the imported booking says it (paidOld).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rejects, DAY, at } from '../helpers.js';
import { importBatch } from '../../server/commands/import.js';
import * as S from '../../server/commands/sales.js';
import * as A from '../../server/commands/agenda.js';
import { dayTotals, zFigures, METHOD_LABEL } from '../../server/domain/cash.js';
import { apptView } from '../../server/http/views.js';
import { shop, owner, byWp } from '../wp-helpers.js';
import { addDays } from '../../shared/dates.js';

/** an upcoming booking of the old site, 30 € with 10 € paid there, today (so it can be checked out) */
async function imported(t, over = {}) {
  const r = { wp: 7001, day: DAY, start: 780, first: 'Nadia', last: 'Roux', phone: '06 98 76 54 32', serviceIds: [t.ids.cut], staffId: t.ids.Ali, price: 3000, paid: 1000, status: 'confirmed', ...over };
  await t.engine.run(importBatch, { appts: [r] }, owner(t));
  return byWp(t, r.wp);
}
const pay = (t, a, payments, lines = [{ kind: 'service', ref: t.ids.cut, unit: 3000 }]) => t.engine.run(S.checkout, { apptId: a.id, lines, payments }, t.asOwner());

test('an imported booking with a deposit: 30 € checked out with 10 € from the old site and 20 € by card', async () => {
  const t = await shop();
  const a = await imported(t);
  assert.equal(a.ext.paid, 1000);
  const v = apptView(t.engine.state, a, new Set(['client.contact']), new Map(), t.clock.now);
  assert.equal(v.paidOld, 1000, 'the till reads it');
  // the service is a 30 € one: set the line price to what the client booked
  const r = await pay(t, a, [{ method: 'ancien', amount: 1000 }, { method: 'card', amount: 2000 }]);
  const sale = t.engine.state.sales.get(r.id);
  assert.equal(sale.totals.revenue, 3000, 'the revenue is the full price');
  assert.deepEqual(sale.totals.vat.map((x) => x.tax), [500], 'VAT on the 30 €');
  const z = zFigures(dayTotals(t.engine.state, DAY));
  assert.equal(z.paidTotal, 3000);
  assert.equal(z.takings, 2000, 'only the card is money that came in today');
  assert.equal(z.prepaid, 1000, 'the 10 € were taken by WordPress');
  assert.equal(z.paymentsNet.ancien, 1000);
  assert.equal(METHOD_LABEL.ancien, 'Payé sur l’ancien site');
  // once the ticket exists the booking no longer offers it
  assert.equal(apptView(t.engine.state, byWp(t, 7001), new Set(), new Map(), t.clock.now).paidOld, 0);
});

test('never more than was paid there, never twice, never without a deposit', async () => {
  const t = await shop();
  const a = await imported(t);
  await rejects(pay(t, a, [{ method: 'ancien', amount: 1200 }, { method: 'card', amount: 1800 }]), 'ancien');
  await rejects(pay(t, a, [{ method: 'ancien', amount: 500 }, { method: 'ancien', amount: 500 }, { method: 'card', amount: 2000 }]), 'ancien');
  // less is fine: the rest stays with the old processor
  const r = await pay(t, a, [{ method: 'ancien', amount: 600 }, { method: 'card', amount: 2400 }]);
  assert.ok(r.number);
  // a booking made here, with no deposit from the old site: the method is refused
  const own = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 840 }, t.asOwner());
  const e = await rejects(t.engine.run(S.checkout, { apptId: own.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'ancien', amount: 1000 }, { method: 'card', amount: 1000 }] }, t.asOwner()), 'ancien');
  assert.match(e.message, /pas d’acompte de l’ancien site/);
  // and a free sale (no booking) cannot use it either
  await rejects(t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'ancien', amount: 2000 }] }, t.asOwner()), 'ancien');
  void addDays; void at;
});
