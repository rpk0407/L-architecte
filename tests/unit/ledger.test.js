// CPT-03 · The books the accountant imports: a Z's tickets as one balanced sales entry (HT per account, VAT per rate,
// tips per barber, each method), deposits taxed when paid and taken back when used, credit notes, gift cards as the till
// books them, Stripe's payouts with their fees and self-assessed VAT, breakage, the VAT of the month, month-end
// balances, the FEC-layout file and its checks, the routes and who may read them, and the CSV that no longer runs a
// formula in Excel. Amounts are written in euros in the expectations, for readability.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { salon, DAY, at } from '../helpers.js';
import * as S from '../../server/commands/sales.js';
import { addService, updateProduct, updateService } from '../../server/commands/catalog.js';
import { createAppointment } from '../../server/commands/agenda.js';
import { createPayment, paymentSucceeded, paymentEnded, payoutRecorded, paymentRefundedOutside } from '../../server/commands/payments.js';
import { updateSettings } from '../../server/commands/shop.js';
import { ledger, vatReturn, fecText, csvText, checkFec, accountOf, comptaOf, spread, openDays, openWords, FEC_FIELDS, JOURNALS } from '../../server/domain/ledger.js';
import { giftcardRoll, packsAt, depositsHeld, stripeBalance } from '../../server/domain/balances.js';
import { csv } from '../../server/lib/csv.js';
import compta from '../../server/settings/compta.js';
import { buildDemoJournal, DEMO } from '../../server/domain/seed.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { createEngine } from '../../server/core/engine.js';
import { addDays, monthEnd } from '../../shared/dates.js';
import { testRuntime, browser } from '../api/client.js';

const card = (amount) => [{ method: 'card', amount }];
const sell = (t, input) => t.engine.run(S.checkout, input, t.asOwner());
const PROVIDER = { actor: { t: 'provider', id: 'stripe' }, caps: new Set() };
const SYS = { actor: { t: 'system', id: 'test' }, caps: new Set(['sale.create']) };
const eu = (c) => (c / 100).toFixed(2).replace('.', ',');
/** an entry's lines as « D 511500 30,00 », sorted (the order of lines is not what is tested) */
const view = (e) => e.lines.map((l) => (l.debit ? 'D ' : 'C ') + l.account + ' ' + eu(l.debit || l.credit)).sort();
const balanced = (e) => e.lines.reduce((t, l) => t + l.debit - l.credit, 0) === 0;
const one = (entries, journal, date) => {
  const list = entries.filter((e) => e.journal === journal && (!date || e.date === date));
  assert.equal(list.length, 1, journal + ' ' + (date || '') + ': ' + list.length + ' entries');
  return list[0];
};
/** the day sealed, after closing time (the salon of the helper closes at 18:30) */
async function close(t, day) {
  t.clock.now = at(day, 19);
  if (t.engine.state.drawer) await t.engine.run(S.closeDrawer, { counts: {}, note: 'Compté au test' }, t.asOwner());
  return t.engine.run(S.closeDay, {}, t.asOwner());
}
async function service(t, name, price, vat) {
  return (await t.engine.run(addService, { name, category: 'Coupes', price, dur: 30, ...(vat != null ? { vat } : {}) }, t.asOwner())).id;
}

test('a cut and its tip by card: one sales entry for the Z, numbered as the Z, balanced', async () => {
  const t = await salon({ hour: 11 });
  const cut = await service(t, 'Coupe 25', 2500);
  await sell(t, { lines: [{ kind: 'service', ref: cut, staffId: t.ids.Ali }], tip: { amount: 500, staffId: t.ids.Ali }, payments: card(3000) });
  const z = await close(t, DAY);
  const { entries, warnings } = ledger(t.engine.state, { from: DAY, to: DAY });
  const ve = one(entries, 'VE');
  assert.deepEqual(view(ve), ['C 445710 4,17', 'C 467200 5,00', 'C 706000 20,83', 'D 511500 30,00'].sort());
  assert.equal(ve.num, z.number);
  assert.equal(ve.piece, 'Z0001');
  assert.equal(ve.date, DAY);
  assert.equal(ve.valid, t.engine.state.closures.get(DAY).at);
  const tip = ve.lines.find((l) => l.account === '467200');
  assert.equal(tip.aux, 'POURB-' + t.ids.Ali);
  assert.match(tip.auxLabel, /Ali/);
  assert.equal(ve.lines.find((l) => l.account === '445710').rate, 2000);
  assert.ok(balanced(ve));
  assert.deepEqual(warnings, []);
  // the FEC line of it: '20,83', dates YYYYMMDD
  assert.ok(fecText(entries).includes('|706000|Prestations de services|||Z0001|20261103|'));
  assert.ok(fecText(entries).includes('|0,00|20,83|'));
});

test('a mixed ticket with a discount: the HT and VAT of each rate split over services and products as the ticket printed', async () => {
  const t = await salon({ hour: 11 });
  const cut = await service(t, 'Coupe 25', 2500);
  const a = await sell(t, { lines: [{ kind: 'service', ref: cut }, { kind: 'product', ref: t.ids.oil }], discount: { amount: 400, reason: 'Fidélité' }, payments: card(3600) });
  // the same at two rates: the oil at 5,5 %
  await t.engine.run(updateProduct, { id: t.ids.oil, patch: { vat: 550 } }, t.asOwner());
  const b = await sell(t, { lines: [{ kind: 'service', ref: cut }, { kind: 'product', ref: t.ids.oil }], discount: { amount: 400, reason: 'Fidélité' }, payments: card(3600) });
  await close(t, DAY);
  const ve = one(ledger(t.engine.state, { from: DAY, to: DAY }).entries, 'VE');
  const S0 = t.engine.state;
  const rows = new Map();
  for (const id of [a.id, b.id]) for (const r of S0.sales.get(id).totals.vat) { const x = rows.get(r.rate) || { base: 0, tax: 0 }; x.base += r.base; x.tax += r.tax; rows.set(r.rate, x); }
  for (const [rate, r] of rows) {
    const ht = ve.lines.filter((l) => !l.vat && l.rate === rate).reduce((t, l) => t + l.credit, 0);
    const vat = ve.lines.filter((l) => l.vat && l.rate === rate).reduce((t, l) => t + l.credit, 0);
    assert.equal(ht, r.base, 'HT at ' + rate);
    assert.equal(vat, r.tax, 'VAT at ' + rate);
  }
  // the first ticket alone: 25 + 15 − 4 at 20 %, the base spread by the lines' net
  assert.deepEqual(S0.sales.get(a.id).totals.vat, [{ rate: 2000, base: 3000, tax: 600 }]);
  assert.deepEqual(spread(3000, [2250, 1350]), [1875, 1125]);
  assert.equal(ve.lines.find((l) => l.account === '707000' && l.rate === 2000).credit, 1125);
  assert.ok(ve.lines.some((l) => l.account === '445713' && l.credit > 0), 'the 5,5 % VAT has its account');
  assert.ok(balanced(ve));
});

test('gift cards as the till books them: owed at TTC when sold, VAT only on what they pay for', async () => {
  const t = await salon({ hour: 10 });
  await t.engine.run(S.openDrawer, { float: 0 }, t.asOwner());
  const g = await sell(t, { lines: [{ kind: 'giftcard', unit: 5000 }], payments: [{ method: 'cash', amount: 5000 }] });
  const code = g.giftcards[0].code;
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'giftcard', amount: 3000, ref: code }] });
  await close(t, DAY);
  const ve = one(ledger(t.engine.state, { from: DAY, to: DAY }).entries, 'VE');
  assert.deepEqual(view(ve), ['D 530000 50,00', 'C 419110 50,00', 'D 419110 30,00', 'C 706000 25,00', 'C 445710 5,00'].sort());
  // VAT at sale (single-purpose voucher) is CPT-06's, with the till: the setting refuses it until then
  assert.equal(comptaOf(t.engine.state).giftcards, 'multiple');
  assert.throws(() => compta.schema.parse({ giftcards: 'unique' }, 'compta'), /valeur non permise/);
});

test('a deposit: VAT on the day it is paid (BQ), taken back by the ticket that uses it (VE), and the month’s VAT follows', async () => {
  const t = await salon({ day: '2026-10-28', hour: 10 });
  const a = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.beard], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(createPayment, { id: 'py_dep', kind: 'deposit', amount: 1000, provider: 'simulated', providerRef: 'sim_dep', apptId: a.id }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_dep', amount: 1000 }, PROVIDER);
  const oct = ledger(t.engine.state, { from: '2026-10-01', to: '2026-10-31' });
  const bq = one(oct.entries, 'BQ', '2026-10-28');
  assert.deepEqual(view(bq), ['D 467100 10,00', 'C 419100 8,33', 'C 445710 1,67'].sort());
  assert.equal(bq.num, 1);
  assert.deepEqual(depositsHeld(t.engine.state, '2026-10-28'), { day: '2026-10-28', count: 1, amount: 1000 });
  assert.equal(stripeBalance(t.engine.state, '2026-10-31'), 1000);

  t.clock.now = at(DAY, 11);
  await sell(t, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'deposit', amount: 1000, ref: 'py_dep' }, { method: 'card', amount: 2000 }] });
  await close(t, DAY);
  const nov = ledger(t.engine.state, { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(nov.warnings, []);
  const ve = one(nov.entries, 'VE');
  assert.deepEqual(view(ve), ['D 419100 8,33', 'D 445710 1,67', 'D 511500 20,00', 'C 706000 25,00', 'C 445710 5,00'].sort());
  assert.equal(nov.entries.filter((e) => e.journal === 'BQ').length, 0, 'the deposit is in October’s bank entry only');
  assert.equal(depositsHeld(t.engine.state, DAY).amount, 0);

  const vo = vatReturn(t.engine.state, '2026-10');
  assert.deepEqual(vo.rows, [{ rate: 2000, base: 833, tax: 167 }]);
  assert.deepEqual(vo.adjustments.deposits, { base: 833, tax: 167 });
  assert.equal(vo.label, 'TVA à déclarer (aide à la CA3, à valider par ton comptable)');
  const vn = vatReturn(t.engine.state, '2026-11');
  assert.deepEqual(vn.rows, [{ rate: 2000, base: 2500 - 833, tax: 500 - 167 }]);
  assert.deepEqual(vn.adjustments.deposits, { base: -833, tax: -167 });
  assert.deepEqual(vn.ticketsVat, [{ rate: 2000, base: 2500, tax: 500 }], 'the Z figure, for comparison');

  // on the debits option a deposit carries no VAT, whatever depositVat says
  await t.engine.run(updateSettings, { compta: { servicesVat: 'debits' } }, t.asOwner());
  assert.deepEqual(view(one(ledger(t.engine.state, { from: '2026-10-01', to: '2026-10-31' }).entries, 'BQ')), ['C 419100 10,00', 'D 467100 10,00']);
  assert.deepEqual(vatReturn(t.engine.state, '2026-11').rows, [{ rate: 2000, base: 2500, tax: 500 }]);
});

test('a deposit keeps the VAT rate it was paid at: a later catalogue edit changes neither October’s file nor what November gives back', async () => {
  const t = await salon({ day: '2026-10-28', hour: 10 });
  const a = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.beard], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(createPayment, { id: 'py_dep', kind: 'deposit', amount: 1000, provider: 'simulated', providerRef: 'sim_dep', apptId: a.id }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_dep', amount: 1000 }, PROVIDER);
  assert.equal(t.engine.state.payments.get('py_dep').vat, 2000, 'frozen on the payment when the money arrived');
  const octBefore = view(one(ledger(t.engine.state, { from: '2026-10-01', to: '2026-10-31' }).entries, 'BQ'));
  const vatBefore = vatReturn(t.engine.state, '2026-10');
  // the beard goes to 10 % after October was sent
  await t.engine.run(updateService, { id: t.ids.beard, patch: { vat: 1000 } }, t.asOwner());
  assert.deepEqual(view(one(ledger(t.engine.state, { from: '2026-10-01', to: '2026-10-31' }).entries, 'BQ')), octBefore);
  assert.deepEqual(octBefore, ['D 467100 10,00', 'C 419100 8,33', 'C 445710 1,67'].sort());
  assert.deepEqual(vatReturn(t.engine.state, '2026-10'), vatBefore);
  // November's ticket (the beard now at 10 %) takes back exactly what October booked: 419100 and 445710 back to zero
  t.clock.now = at(DAY, 11);
  await sell(t, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'deposit', amount: 1000, ref: 'py_dep' }, { method: 'card', amount: 2000 }] });
  await close(t, DAY);
  const all = ledger(t.engine.state, { from: '2026-10-01', to: '2026-11-30' }).entries;
  const sum = (acct) => all.reduce((s0, e) => s0 + e.lines.filter((l) => l.account === acct && l.src === 'deposit').reduce((x, l) => x + l.debit - l.credit, 0), 0);
  assert.equal(sum('419100'), 0);
  assert.equal(sum('445710'), 0);
  assert.equal(sum('445712'), 0);
  // replayed, the same rate
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  assert.equal(other.state.payments.get('py_dep').vat, 2000);
});

test('a part of an unused deposit given back is booked the day it was given back, not the day it was paid', async () => {
  const t = await salon({ day: '2026-10-28', hour: 10 });
  const a = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.beard], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(createPayment, { id: 'py_dep', kind: 'deposit', amount: 1000, provider: 'simulated', providerRef: 'sim_dep', apptId: a.id }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_dep', amount: 1000 }, PROVIDER);
  t.clock.now = at('2026-10-29', 10);
  await t.engine.run(paymentEnded, { id: 'py_dep', status: 'refunded', amount: 400, reason: 'Geste' }, PROVIDER);
  const { entries, warnings } = ledger(t.engine.state, { from: '2026-10-01', to: '2026-10-31' });
  const back = one(entries.filter((e) => /remboursé/.test(e.label)), 'BQ');
  assert.equal(back.date, '2026-10-29');
  assert.deepEqual(view(back), ['C 467100 4,00', 'D 419100 3,33', 'D 445710 0,67'].sort());
  assert.deepEqual(warnings, []);
  assert.equal(depositsHeld(t.engine.state, '2026-10-28').amount, 1000);
  assert.equal(depositsHeld(t.engine.state, '2026-10-29').amount, 600);
});

test('no orphan Stripe money: a payment used the day it is paid goes through the ticket, an unused one waits in 419100', async () => {
  const t = await salon({ hour: 10 });
  await t.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 3000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_qr', amount: 3000, chargeRef: 'pi_qr' }, PROVIDER);
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'online', amount: 3000, ref: 'py_qr' }] });
  await t.engine.run(createPayment, { id: 'py_qr2', kind: 'qr', amount: 2000, provider: 'stripe', providerRef: 'cs_qr2', label: 'QR' }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_qr2', amount: 2000, chargeRef: 'pi_qr2' }, PROVIDER);
  await close(t, DAY);
  const { entries, warnings } = ledger(t.engine.state, { from: DAY, to: DAY });
  assert.ok(view(one(entries, 'VE')).includes('D 467100 30,00'), 'used the same day: the ticket debits Stripe');
  const bq = one(entries, 'BQ');
  assert.deepEqual(view(bq), ['D 467100 20,00', 'C 419100 16,67', 'C 445710 3,33'].sort());
  assert.equal(bq.piece, 'py_qr2');
  assert.ok(warnings.includes('Virements Stripe non suivis : branche les webhooks (Réglages › Paiements)'));
});

test('a credit note in cash: the cut and its VAT come back, the drawer gives the money', async () => {
  const t = await salon({ hour: 11 });
  const cut = await service(t, 'Coupe 25', 2500);
  const sale = await sell(t, { lines: [{ kind: 'service', ref: cut }], payments: card(2500) });
  await close(t, DAY);
  const next = addDays(DAY, 1);
  t.clock.now = at(next, 10);
  await t.engine.run(S.openDrawer, { float: 5000 }, t.asOwner());
  await t.engine.run(S.refund, { saleId: sale.id, amount: 2500, method: 'cash', reason: 'Client mécontent' }, t.asOwner());
  await close(t, next);
  const { entries, warnings } = ledger(t.engine.state, { from: next, to: next });
  assert.deepEqual(view(one(entries, 'VE')), ['D 706000 20,83', 'D 445710 4,17', 'C 530000 25,00'].sort());
  assert.deepEqual(warnings, []);
  assert.deepEqual(vatReturn(t.engine.state, '2026-11').rows, [], 'refunded within the month: nothing due');
  // by line: the product alone comes back, on its own account
  const day3 = addDays(DAY, 2);
  t.clock.now = at(day3, 10);
  await t.engine.run(S.openDrawer, { float: 5000 }, t.asOwner());
  const mixed = await sell(t, { lines: [{ kind: 'service', ref: cut }, { kind: 'product', ref: t.ids.oil }], payments: [{ method: 'cash', amount: 4000 }] });
  await t.engine.run(S.refund, { saleId: mixed.id, amount: 1500, method: 'cash', reason: 'Produit rendu', lines: [{ i: 1, qty: 1 }] }, t.asOwner());
  await close(t, day3);
  const ve3 = one(ledger(t.engine.state, { from: day3, to: day3 }).entries, 'VE');
  const back = ve3.lines.filter((l) => l.debit && l.label.startsWith('Avoirs'));
  assert.deepEqual(back.map((l) => l.account + ' ' + eu(l.debit)).sort(), ['445710 2,50', '707000 12,50']);
  assert.ok(balanced(ve3));
});

test('given back at Stripe without a credit note: the waiting account holds it until the avoir « hors caisse » clears it', async () => {
  const t = await salon({ hour: 10 });
  await t.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 3000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_qr', amount: 3000, chargeRef: 'pi_qr' }, PROVIDER);
  const sale = await sell(t, { lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'online', amount: 3000, ref: 'py_qr' }] });
  await t.engine.run(paymentRefundedOutside, { id: 'py_qr', total: 3000 }, PROVIDER);
  let L = ledger(t.engine.state, { from: DAY, to: DAY });
  const bq = L.entries.find((e) => e.journal === 'BQ');
  assert.deepEqual(view(bq), ['C 467100 30,00', 'D 471000 30,00']);
  assert.ok(L.warnings.includes('T000001 : remboursé chez Stripe sans avoir'), L.warnings.join(' | '));
  await t.engine.run(S.refund, { saleId: sale.id, amount: 3000, method: 'online', reason: 'Remboursé chez Stripe', providerRef: 'outside' }, t.asOwner());
  await close(t, DAY);
  L = ledger(t.engine.state, { from: DAY, to: DAY });
  assert.ok(!L.warnings.some((w) => /sans avoir/.test(w)), 'the avoir is written');
  const ve = one(L.entries, 'VE');
  assert.ok(view(ve).includes('C 471000 30,00'), view(ve).join(', '));
  const sum = (acct) => L.entries.flatMap((e) => e.lines).filter((l) => l.account === acct).reduce((t, l) => t + l.debit - l.credit, 0);
  assert.equal(sum('471000'), 0, 'the waiting account is cleared');
  assert.equal(sum('467100'), 0, 'Stripe: 30 in, 30 back');
});

test('a journal builder that does not balance gets the waiting account and a warning, the file stays importable', async () => {
  const t = await salon();
  const odd = () => [{ journal: 'OD', kind: 'misc', date: DAY, piece: 'X1', pieceDate: DAY, label: 'Test', valid: at(DAY, 9), lines: [{ account: '512000', label: 'Banque', debit: 1000, credit: 0 }] }];
  JOURNALS.push(odd);
  try {
    const { entries, warnings } = ledger(t.engine.state, { from: DAY, to: DAY });
    const e = entries.find((x) => x.piece === 'X1');
    assert.deepEqual(view(e), ['C 471000 10,00', 'D 512000 10,00']);
    assert.ok(warnings.some((w) => /X1 : écriture déséquilibrée de 10,00\s€/.test(w)), warnings.join(' | '));
    assert.equal(e.num, 1, 'numbered with its journal');
    assert.ok(checkFec(fecText(entries)).ok);
  } finally { JOURNALS.splice(JOURNALS.indexOf(odd), 1); }
});

test('a Z the tickets do not add up to is said, to the cent', async () => {
  const t = await salon({ hour: 11 });
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2000) });
  await close(t, DAY);
  const copy = structuredClone(t.engine.state);
  copy.closures.get(DAY).net += 2;
  const { warnings } = ledger(copy, { from: DAY, to: DAY });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Z0001 : les tickets ne retombent pas sur le Z \(écart 0,02\s€\)$/);
  assert.deepEqual(ledger(t.engine.state, { from: DAY, to: DAY }).warnings, []);
});

test('a payout: the bank gets the net, Stripe its fee (VAT self-assessed), the unknown lines wait in 471000', async () => {
  const t = await salon({ hour: 10 });
  await t.engine.run(createPayment, { id: 'py_qr', kind: 'qr', amount: 30000, provider: 'stripe', providerRef: 'cs_qr', label: 'QR' }, SYS);
  await t.engine.run(paymentSucceeded, { id: 'py_qr', amount: 30000, chargeRef: 'pi_qr' }, PROVIDER);
  await t.engine.run(payoutRecorded, { id: 'po_1', amount: 29390, arrival: at(DAY, 9), items: [{ pid: 'py_qr', type: 'charge', amount: 30000, fee: 610, net: 29390 }] }, PROVIDER);
  const { entries, warnings } = ledger(t.engine.state, { from: DAY, to: DAY });
  const po = entries.find((e) => e.journal === 'BQ' && e.piece === 'po_1');
  assert.deepEqual(view(po), ['D 512000 293,90', 'D 627800 6,10', 'C 467100 300,00', 'D 445662 1,22', 'C 445200 1,22'].sort());
  assert.ok(!warnings.some((w) => /Virements Stripe non suivis/.test(w)), 'payouts are followed');
  const v = vatReturn(t.engine.state, '2026-11');
  assert.deepEqual({ base: v.autoliquidation.base, tax: v.autoliquidation.tax }, { base: 610, tax: 122 });
  assert.equal(v.autoliquidation.label, 'Services reçus d’un prestataire UE (Stripe)');

  // a line the salon does not know (a charge of the old site): its money waits, the owner is told
  await t.engine.run(payoutRecorded, { id: 'po_2', amount: 4850, arrival: at(DAY, 9), items: [{ type: 'charge', amount: 5000, fee: 150, net: 4850 }] }, PROVIDER);
  const L2 = ledger(t.engine.state, { from: DAY, to: DAY });
  const po2 = L2.entries.find((e) => e.piece === 'po_2');
  assert.ok(view(po2).includes('C 471000 50,00'), view(po2).join(', '));
  assert.ok(view(po2).includes('D 627800 1,50'));
  assert.ok(balanced(po2));
  assert.ok(L2.warnings.some((w) => w.startsWith('Opération Stripe inconnue (ancien site ?)')));
  // without the reverse charge, no self-assessed VAT
  await t.engine.run(updateSettings, { compta: { feesReverseCharge: false } }, t.asOwner());
  assert.ok(!ledger(t.engine.state, { from: DAY, to: DAY }).entries.some((e) => e.lines.some((l) => l.account === '445662')));
  // each BQ number once, continuous in the order recorded
  const nums = ledger(t.engine.state, { from: DAY, to: DAY }).entries.filter((e) => e.journal === 'BQ').map((e) => e.num).sort((a, b) => a - b);
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
});

test('a gift card that expires with money left: breakage the day after its last valid day, at TTC', async () => {
  const t = await salon({ hour: 10 });
  const g = await sell(t, { lines: [{ kind: 'giftcard', unit: 2000 }], payments: card(2000) });
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 800, ref: g.giftcards[0].code }, { method: 'card', amount: 1200 }] });
  const exp = g.giftcards[0].expires;
  const range = { from: exp.slice(0, 7) + '-01', to: monthEnd(exp) };
  assert.equal(ledger(t.engine.state, { ...range, today: exp }).entries.filter((e) => e.journal === 'OD').length, 0, 'still valid on its last day');
  const od = one(ledger(t.engine.state, { ...range, today: addDays(exp, 1) }).entries, 'OD');
  assert.deepEqual(view(od), ['D 419110 12,00', 'C 758000 12,00'].sort());
  assert.equal(od.date, exp);
  assert.equal(od.num, 1);
  const roll = giftcardRoll(t.engine.state, range.from, range.to);
  assert.equal(roll.expired, 1200);
  assert.equal(roll.closing, 0);
});

test('a carnet’s cuts left are worth what was paid per cut', async () => {
  const t = await salon({ hour: 10 });
  const sale = await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  const pk = [...t.engine.state.packs.values()].find((k) => k.saleId === sale.id);
  t.clock.now = at(DAY, 15);
  await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk.id }], payments: [{ method: 'card', amount: 0 }] });
  assert.deepEqual(packsAt(t.engine.state, DAY), { day: DAY, open: 1, cutsLeft: 3, value: 3 * 1600, valueHT: 4000, legacy: { open: 0, cutsLeft: 0 } });
  assert.equal(packsAt(t.engine.state, addDays(DAY, -1)).open, 0, 'not sold yet');
  assert.equal(packsAt(t.engine.state, addDays(DAY, 400)).open, 0, 'expired');
});

test('the chart of accounts: defaults, the owner’s numbers, an unknown role on the waiting account; the accountant stays out of the chain', async () => {
  const t = await salon();
  const cfg = comptaOf(t.engine.state);
  assert.equal(accountOf(cfg, 'revenue.service'), '706000');
  assert.equal(accountOf(cfg, 'method.ancien'), '419100');
  assert.equal(accountOf(cfg, 'vat.intracomDue'), '445200');
  assert.equal(accountOf(cfg, 'partner'), '455000');
  assert.equal(accountOf(cfg, 'nope'), '471000');
  await t.engine.run(updateSettings, { compta: { accounts: { 'method.card': '511' }, accountant: { name: 'Mme Durand', firm: 'Cabinet Durand', email: 'durand@cabinet.fr' } } }, t.asOwner());
  const S0 = t.engine.state;
  assert.equal(accountOf(comptaOf(S0), 'method.card'), '511');
  assert.equal(accountOf(comptaOf(S0), 'method.cash'), '530000', 'the other numbers kept');
  assert.deepEqual(S0.settings.compta.accountant, { name: 'Mme Durand', firm: 'Cabinet Durand', email: 'durand@cabinet.fr' });
  const ev = (await t.store.read()).events.filter((e) => e.type === 'settings.updated').at(-1);
  assert.ok(!JSON.stringify(ev.data).includes('durand'), 'no name or e-mail in the chained data');
  assert.equal(ev.pii.compta.accountant.email, 'durand@cabinet.fr');
  // replayed, the same settings
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  assert.deepEqual(other.state.settings.compta, S0.settings.compta);
  // Mise en route › Nouveautés
  assert.deepEqual(compta.golive.state(S0), { on: false, blocker: 'régime TVA à confirmer avec ton comptable' });
  assert.equal(compta.golive.label, 'Comptabilité');
  assert.equal(compta.golive.to, 'compta', 'Nouveautés opens Réglages › Comptabilité');
  // two journals with one code would merge their entries in the accountant's software: refused, against the codes set
  await assert.rejects(t.engine.run(updateSettings, { compta: { journals: { bank: 'VE' } } }, t.asOwner()), /Deux journaux ne peuvent pas avoir le même code \(VE\)/);
  await t.engine.run(updateSettings, { compta: { journals: { sales: 'VT', bank: 'VE' } } }, t.asOwner());
  assert.deepEqual(comptaOf(t.engine.state).journals, { sales: 'VT', cash: 'CA', bank: 'VE', misc: 'OD' });
  assert.equal(JOURNALS.length, 3);
});

test('the FEC layout: 18 fields, balanced entries, checked before it is served; the CSV the same for Excel', async () => {
  const t = await salon({ hour: 11 });
  const cut = await service(t, 'Coupe 25', 2500);
  await sell(t, { lines: [{ kind: 'service', ref: cut, staffId: t.ids.Ali }], tip: { amount: 500, staffId: t.ids.Ali }, payments: card(3000) });
  await close(t, DAY);
  const { entries } = ledger(t.engine.state, { from: DAY, to: DAY });
  const text = fecText(entries);
  const rows = text.split('\r\n');
  assert.equal(rows[0], FEC_FIELDS.join('|'));
  assert.equal(rows.at(-1), '', 'CRLF after the last line');
  assert.notEqual(text.charCodeAt(0), 0xfeff, 'no BOM');
  for (const r of rows.slice(1, -1)) {
    const f = r.split('|');
    assert.equal(f.length, 18, r);
    assert.match(f[3], /^\d{8}$/); assert.match(f[9], /^\d{8}$/); assert.match(f[15], /^\d{8}$/);
    assert.equal(f[13] + f[14] + f[16] + f[17], '', 'EcritureLet, DateLet, Montantdevise and Idevise are empty');
  }
  assert.deepEqual(checkFec(text), { ok: true, errors: [] });
  // what the check catches
  assert.ok(!checkFec(text.replace('|30,00|0,00|', '|30,01|0,00|')).ok);
  assert.ok(checkFec(text.replace('|30,00|0,00|', '|30,01|0,00|')).errors.some((e) => /déséquilibrée/.test(e)));
  assert.ok(!checkFec('﻿' + text).ok);
  assert.ok(!checkFec(text.replace('|20261103|', '|20261303|')).ok);
  assert.ok(!checkFec(text.replace(/\|\|\r\n/, '|\r\n')).ok, '17 fields');
  const c = csvText(entries);
  assert.equal(c.charCodeAt(0), 0xfeff);
  assert.equal(c.split('\r\n')[0], '﻿' + FEC_FIELDS.join(';'));
  assert.ok(c.includes(';20,83;'));
});

test('safe CSV: a formula never runs in Excel, an amount stays a number, a line break is quoted', () => {
  assert.equal(csv([['=SUM(A1)']], { bom: false }), "'=SUM(A1)\r\n");
  assert.equal(csv([['-12,50', '+A1', '@x', '\tTab']], { bom: false }), "-12,50;'+A1;'@x;'\tTab\r\n");
  // a foreign phone number in a client export stays as typed (routes-bascule.js uses the same writer)
  assert.equal(csv([['+41 79 123 45 67', '+41791234567', '+41 79 cmd']], { bom: false }), "+41 79 123 45 67;+41791234567;'+41 79 cmd\r\n");
  assert.equal(csv([['a\rb']], { bom: false }), '"a\rb"\r\n');
  assert.equal(csv([['un;deux', 'il a dit "oui"']], { bom: false }), '"un;deux";"il a dit ""oui"""\r\n');
  assert.equal(csv([[-5, 20, null]]), '﻿-5;20;\r\n', 'numbers are not text');
  assert.equal(csv([['a', 'b']], { sep: '|', bom: false }), 'a|b\r\n');
});

/* ---------------- the demo seed and the routes ---------------- */

const NOW = at('2026-11-03', 10);
let demo;
before(async () => {
  const s = emptyState();
  for (const e of await buildDemoJournal(NOW)) evolve(s, e);
  demo = s;
});

test('demo seed: every entry of the last full month balances, no Z mismatch, the VAT equals the Z’s', () => {
  const { entries, warnings } = ledger(demo, { from: '2026-10-01', to: '2026-10-31', today: '2026-11-03' });
  assert.ok(entries.filter((e) => e.journal === 'VE').length >= 20, 'a Z for every open day');
  for (const e of entries) assert.ok(balanced(e), e.journal + ' ' + e.piece);
  assert.deepEqual(warnings.filter((w) => /ne retombent pas/.test(w)), []);
  assert.deepEqual(openDays(demo, '2026-10', '2026-11-03'), []);
  assert.deepEqual(checkFec(fecText(entries)), { ok: true, errors: [] });
  const v = vatReturn(demo, '2026-10', { today: '2026-11-03' });
  assert.equal(v.adjustments.deposits.tax, 0, 'no deposits in the demo month');
  assert.deepEqual(v.rows.map((r) => ({ ...r })), v.ticketsVat.map((r) => ({ ...r })), 'rows = the month’s Z vatNet');
  // nothing in any file names a client
  const text = fecText(entries);
  for (const c of [...demo.clients.values()].slice(0, 200)) if (c.last && c.last.length > 3) assert.ok(!text.includes(c.first + ' ' + c.last), c.first + ' ' + c.last);
});

test('demo seed: the gift card roll adds up, month by month', () => {
  for (const [from, to] of [['2026-08-01', '2026-08-31'], ['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-03']]) {
    const r = giftcardRoll(demo, from, to);
    assert.equal(r.opening + r.issued - r.redeemed - r.cancelled - r.expired, r.closing, from);
    assert.ok(r.closing >= 0);
  }
  const all = giftcardRoll(demo, '2000-01-01', '2026-11-03');
  assert.equal(all.opening, 0);
  const live = [...demo.giftcards.values()].filter((g) => g.status === 'active' && g.expires >= '2026-11-03').reduce((t, g) => t + g.balance, 0);
  assert.equal(all.closing, live, 'the closing balance is what the active cards hold');
  assert.ok(all.issued > 0);
  const p = packsAt(demo, '2026-10-31');
  assert.ok(p.open > 0 && p.value > 0);
});

test('the routes: the file of a closed month, 409 while a day has no Z (or the provisional CSV), and never for a barber', async () => {
  const clock = { now: NOW };
  const rt = await testRuntime({ clock: () => clock.now });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const fec = await b.get('/api/v1/compta/entries?month=2026-10&format=fec');
  assert.equal(fec.status, 200, fec.text.slice(0, 300));
  assert.match(fec.headers.get('content-disposition'), /filename="ecritures-2026-10\.txt"/);
  assert.match(fec.headers.get('content-type'), /^text\/plain; charset=utf-8/);
  assert.ok(!fec.text.startsWith('﻿'));
  assert.equal(fec.text.split('\r\n')[0], FEC_FIELDS.join('|'));
  assert.ok(checkFec(fec.text).ok);
  assert.match(fec.text, /\|\d+,\d{2}\|\d+,\d{2}\|/);
  const c = await b.get('/api/v1/compta/entries?month=2026-10&format=csv');
  assert.equal(c.status, 200);
  assert.match(c.headers.get('content-disposition'), /ecritures-2026-10\.csv/);
  const open = await b.get('/api/v1/compta/entries?month=2026-11&format=fec');
  assert.equal(open.status, 409);
  assert.equal(open.json.error.code, 'open');
  // today: the month is not over yet; a past day without its Z is one missing
  assert.equal(open.json.error.message, 'Novembre n’est pas terminé (Z du mardi 3 novembre à faire).');
  assert.equal(openWords('2026-11-02', '2026-11-03'), 'Il manque le Z du lundi 2 novembre');
  const prov = await b.get('/api/v1/compta/entries?month=2026-11&format=csv&provisional=1');
  assert.equal(prov.status, 200);
  assert.match(prov.headers.get('content-disposition'), /ecritures-2026-11-provisoire\.csv/);
  assert.equal(prov.headers.get('x-lx-period'), 'provisoire');
  // each open day its own entry number, so no software merges two days
  assert.match(prov.text, /;VE-PROV-20261103;/);
  assert.equal((await b.get('/api/v1/compta/entries?month=2026-11&format=fec&provisional=1')).status, 400);
  assert.equal((await b.get('/api/v1/compta/entries?month=2026-13')).status, 400);
  const vat = await b.get('/api/v1/compta/vat?month=2026-10');
  assert.equal(vat.status, 200);
  assert.equal(vat.json.label, 'TVA à déclarer (aide à la CA3, à valider par ton comptable)');
  assert.ok(vat.json.rows.length >= 1);
  const vcsv = await b.get('/api/v1/compta/vat?month=2026-10&csv=1');
  assert.match(vcsv.headers.get('content-disposition'), /tva-2026-10\.csv/);
  const tot = vcsv.text.split('\r\n').find((l) => l.startsWith('Total;'));
  assert.match(tot, /^Total;\d+,\d{2};\d+,\d{2}$/, 'the total has its base');
  assert.ok(vcsv.text.includes('\r\n20;'), 'a rate as a number under « Taux (%) »');
  const bal = await b.get('/api/v1/compta/balances?day=2026-10-31');
  assert.equal(bal.status, 200);
  assert.deepEqual(Object.keys(bal.json), ['day', 'giftcards', 'packs', 'deposits', 'stripe', 'payouts']);
  assert.equal(bal.json.giftcards.opening + bal.json.giftcards.issued - bal.json.giftcards.redeemed - bal.json.giftcards.cancelled - bal.json.giftcards.expired, bal.json.giftcards.closing);

  // a barber, on the salon tablet
  const ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
  const tab = browser(rt);
  assert.equal((await tab.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await tab.post('/api/auth/logout');
  assert.equal((await tab.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  for (const p of ['/api/v1/compta/entries?month=2026-10&format=fec', '/api/v1/compta/vat?month=2026-10', '/api/v1/compta/balances']) assert.equal((await tab.get(p)).status, 403, p);
});
