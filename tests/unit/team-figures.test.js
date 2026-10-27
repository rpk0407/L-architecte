// TEAM-03: barber figures you can defend. Chiffre réalisé (what a barber performed: refunds deducted on their own day,
// carnet and membership cuts credited to whoever cuts), the commission on TTC or HT, goals per barber, the monthly
// statement and the payroll CSV, the same number on the agenda, in Mes chiffres and in the statement.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../../server/core/engine.js';
import { memoryStore } from '../../server/store/memory.js';
import { CAPS, capsOf } from '../../server/domain/permissions.js';
import { initialize } from '../../server/commands/setup.js';
import { addStaff } from '../../server/commands/team.js';
import { addService, addProduct, adjustStock } from '../../server/commands/catalog.js';
import { addClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import * as S from '../../server/commands/sales.js';
import * as A from '../../server/commands/agenda.js';
import { report, goalOf, refundByStaff, carnetCutValue } from '../../server/domain/insights.js';
import { staffStatement, PROVISIONAL } from '../../server/domain/statement.js';
import { payRulesOf } from '../../server/settings/team.js';
import { settingsSchema } from '../../server/settings/index.js';
import { ticketTotals } from '../../shared/money.js';
import { gapWords } from '../../shared/figures.js';
import { at, rejects } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { addDays, localParts } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const FULL = [[540, 1110]], SHORT = [[540, 920]];
const week = (iv) => ({ 2: iv, 3: iv, 4: iv, 5: iv, 6: iv });

/** Four chairs (JKut and Frank full days, Le Soldat and Esteban shorter: 30/30/20/20 % of the chair minutes) and a desk. */
async function shop({ day = DAY, hour = 10 } = {}) {
  const clock = { now: at(day, hour) };
  const engine = createEngine(memoryStore(), { clock: () => clock.now, syncEveryMs: 0 });
  const sys = { actor: { t: 'system', id: 'test' }, caps: new Set(Object.keys(CAPS)) };
  const init = await engine.run(initialize, { mode: 'production', owner: { name: 'Patron', email: 'patron@test.fr' } }, sys);
  const owner = () => engine.state.staff.get(init.ownerId);
  const asOwner = () => ({ actor: { t: 'staff', id: init.ownerId }, staff: owner(), caps: capsOf(owner(), engine.state.settings) });
  const ids = { owner: init.ownerId };
  for (const [name, iv] of [['JKut', FULL], ['Frank', FULL], ['Le Soldat', SHORT], ['Esteban', SHORT]]) ids[name] = (await engine.run(addStaff, { name, role: 'barber', schedule: week(iv), commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.desk = (await engine.run(addStaff, { name: 'Inès', role: 'desk' }, asOwner())).id;
  ids.cut = (await engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2400, dur: 30 }, asOwner())).id;
  ids.pack = (await engine.run(addService, { name: 'Carnet 5 coupes', category: 'Carnets', price: 8000, dur: 30, pack: { credits: 5, days: 365 } }, asOwner())).id;
  ids.wax = (await engine.run(addProduct, { name: 'Cire', price: 600, cost: 200 }, asOwner())).id;
  await engine.run(adjustStock, { id: ids.wax, delta: 20, reason: 'Stock initial' }, asOwner());
  for (const [k, first, phone] of [['karim', 'Karim', '06 11 22 33 01'], ['yanis', 'Yanis', '06 11 22 33 02'], ['ali', 'Ali', '06 11 22 33 03'], ['sami', 'Sami', '06 11 22 33 04'], ['nour', 'Nour', '06 11 22 33 05']]) ids[k] = (await engine.run(addClient, { first, last: 'Test', phone }, asOwner())).id;
  const as = (id) => { const st = engine.state.staff.get(id); return { actor: { t: 'staff', id }, staff: st, caps: capsOf(st, engine.state.settings) }; };
  const set = (patch) => engine.run(updateSettings, patch, asOwner());
  const q = (from = DAY, to = from, staffId = null) => ({ from, to, staffId, today: localDay(clock), now: clock.now });
  return { engine, clock, ids, sys, asOwner, as, set, q, s: () => engine.state };
}
const localDay = (clock) => localParts(clock.now).day;
const rowOf = (rep, id) => rep.staff.find((x) => x.id === id);
const raw = { run(s, input, ctx) { for (const [type, data, pii] of input.events) ctx.emit(type, data, pii); return { ok: true }; } };

/** A ticket written by hand, as the till would (lines with their nets): for line fields of other packages (FID-02 reward). */
async function handSale(t, { lines, payments, tip = null, cashierId = null, clientId = null }) {
  const totals = ticketTotals(lines, 0, tip ? tip.amount : 0);
  const s = t.s();
  const id = 'sa_hand' + (s.saleSeq + 1);
  const { nets, ...rest } = totals;
  await t.engine.run(raw, { events: [['sale.completed', { id, number: s.saleSeq + 1, day: localDay(t.clock), cashierId, apptId: null, clientId, lines: lines.map((l, i) => ({ ...l, net: nets[i] })), discount: null, tip, totals: rest, payments, note: '' }]] }, t.sys);
  return id;
}
const card = (amount) => [{ method: 'card', amount }];

test('commission base: 24 € TTC at 20 % VAT and 40 % → 9,60 € on TTC, 8,00 € on HT', async () => {
  const t = await shop();
  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Frank }], payments: card(2400) }, t.asOwner());
  let row = rowOf(report(t.s(), t.q()), t.ids.Frank);
  assert.equal(row.revenue, 2400);
  assert.equal(row.revenueHT, 2000);
  assert.equal(row.commission, 960);
  assert.equal(row.base, 'ttc');
  await t.set({ team: { commissionBase: 'ht' } });
  row = rowOf(report(t.s(), t.q()), t.ids.Frank);
  assert.equal(row.commission, 800, 'on the price before VAT');
  assert.equal(row.revenue, 2400, 'the base changes the commission, not the figure');
  assert.equal(payRulesOf(t.s().settings).base, 'ht');
  // the rules are settings like the others: validated, defaults kept by an old journal
  assert.deepEqual(settingsSchema.parse({ team: { cutCredit: 'seller', memberCredit: 'list', rewardCredit: 'net' } }, ''), { team: { cutCredit: 'seller', memberCredit: 'list', rewardCredit: 'net' } });
  assert.throws(() => settingsSchema.parse({ team: { commissionBase: 'brut' } }, ''), { message: 'team.commissionBase : valeur non permise' });
  assert.deepEqual(payRulesOf({ team: {} }), { base: 'ttc', cutCredit: 'performer', memberCredit: 'split', rewardCredit: 'list' });
});

test('refunds reach the barbers: pro rata without lines, by line with them, on their own day, and the rows add up', async () => {
  const t = await shop({ day: '2026-10-30', hour: 11 });
  // Frank's 24 € cut and JKut's 6 € wax on one 30 € ticket
  const sold = await t.engine.run(S.checkout, { clientId: t.ids.karim, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Frank }, { kind: 'product', ref: t.ids.wax, staffId: t.ids.JKut }], payments: card(3000) }, t.asOwner());
  const two = await t.engine.run(S.checkout, { clientId: t.ids.yanis, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Frank }], payments: card(2400) }, t.asOwner());
  const oct = () => report(t.s(), { from: '2026-10-01', to: '2026-10-31', staffId: null, today: localDay(t.clock), now: t.clock.now });
  assert.equal(rowOf(oct(), t.ids.Frank).revenue, 4800);
  // a few days later, in November: 10 € back without lines, then the whole cut of the second ticket
  t.clock.now = at(DAY, 11);
  const r1 = await t.engine.run(S.refund, { saleId: sold.id, amount: 1000, method: 'card', reason: 'Geste' }, t.asOwner());
  assert.deepEqual([...refundByStaff(t.s(), t.s().refunds.get(r1.id))].sort(), [[t.ids.Frank, 800], [t.ids.JKut, 200]].sort());
  const r2 = await t.engine.run(S.refund, { saleId: two.id, amount: 2400, method: 'card', reason: 'Retour', lines: [{ i: 0, qty: 1 }] }, t.asOwner());
  assert.deepEqual([...refundByStaff(t.s(), t.s().refunds.get(r2.id))], [[t.ids.Frank, 2400]]);

  // October keeps what was done in October; the refunds fall on their day, in November
  assert.equal(rowOf(oct(), t.ids.Frank).revenue, 4800);
  const nov = report(t.s(), t.q('2026-11-01', DAY));
  const f = rowOf(nov, t.ids.Frank), j = rowOf(nov, t.ids.JKut);
  assert.equal(f.revenue, -3200, 'Frank: −8 € and −24 €');
  assert.equal(f.refunds, 3200);
  assert.equal(f.refundCount, 2);
  assert.equal(j.revenue, -200, 'JKut: −2 €');
  assert.equal(f.commission, Math.round((-3200 * 4000) / 10000), 'the commission follows the refund');
  assert.equal(j.commission, Math.round((-200 * 1000) / 10000), 'at the product rate');
  // the barbers' rows add up to the shop's performed, and the gap explains Encaissé
  for (const rep of [oct(), nov, report(t.s(), t.q('2026-10-01', DAY))]) {
    assert.equal(rep.staff.reduce((s, x) => s + x.revenue, 0), rep.performed);
    assert.equal(rep.revenue, rep.performed + rep.gap.prepaidSold - rep.gap.prepaidUsed - rep.gap.rewards + rep.gap.unassigned);
  }
  assert.equal(nov.revenue, -3400, 'Encaissé: the shop’s figure is unchanged (the Z)');
  // one barber's report says the same thing as his row
  const own = report(t.s(), t.q('2026-11-01', DAY, t.ids.Frank));
  assert.equal(own.revenue, -3200);
  assert.equal(own.refunds, 3200);
});

test('carnet cuts count for whoever cuts, at the price paid per cut; « pour qui vend » keeps today’s numbers', async () => {
  const t = await shop();
  // the desk sells a carnet of 5 for 80 €, Esteban does two cuts with it
  const sold = await t.engine.run(S.checkout, { clientId: t.ids.karim, lines: [{ kind: 'pack', ref: t.ids.pack }], payments: card(8000) }, t.as(t.ids.desk));
  const pk = [...t.s().packs.values()][0];
  assert.equal(t.s().sales.get(sold.id).lines[0].staffId, t.ids.desk, 'the carnet line is the seller’s');
  assert.deepEqual(carnetCutValue(t.s(), pk), { value: 1600, estimated: false });
  for (const start of [600, 660]) {
    const a = await t.engine.run(A.createAppointment, { clientId: t.ids.karim, serviceIds: [t.ids.cut], staffId: t.ids.Esteban, day: DAY, start }, t.asOwner());
    await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk.id }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner());
  }
  let rep = report(t.s(), t.q());
  let e = rowOf(rep, t.ids.Esteban);
  assert.equal(e.revenue, 3200, 'Esteban: 2 × 16 €');
  assert.deepEqual(e.cutsCarnet, { n: 2, value: 3200, estimated: 0 });
  assert.equal(e.commission, 1280, 'commission on 32 €');
  assert.equal(rowOf(rep, t.ids.desk), undefined, 'the desk: nothing (the carnet is money for later)');
  assert.equal(rep.gap.prepaidSold, 8000);
  assert.equal(rep.gap.prepaidUsed, 3200);
  assert.equal(rep.revenue, 8000, 'Encaissé: the carnet, on the day it was paid');
  assert.equal(rep.performed, 3200);

  await t.set({ team: { cutCredit: 'seller' } });
  rep = report(t.s(), t.q());
  e = rowOf(rep, t.ids.Esteban);
  const desk = rowOf(rep, t.ids.desk);
  assert.equal(desk.revenue, 8000, 'the desk: the whole carnet, as before');
  assert.equal(desk.commission, Math.round((8000 * t.s().staff.get(t.ids.desk).commission.service) / 10000), 'commissioned to whoever rang it up');
  assert.equal(e.revenue, 0, 'Esteban: the cuts count, worth nothing to him');
  assert.equal(e.cutsCarnet.n, 2);
  assert.equal(rep.gap.prepaidSold, 0);
  assert.equal(rep.gap.prepaidUsed, 0);
  assert.equal(rep.staff.reduce((s, x) => s + x.revenue, 0), rep.performed);
});

test('a carnet taken over from the old site: its cut is worth the catalogue carnet ÷ its cuts, flagged as estimated', async () => {
  const t = await shop();
  await t.engine.run(raw, { events: [['pack.sold', { id: 'pk_old', clientId: t.ids.yanis, cid: t.ids.yanis, name: 'Carnet 5 coupes', total: 3, serviceIds: [], expires: '2027-06-01', serviceId: t.ids.pack, legacy: true }]] }, t.sys);
  await t.engine.run(S.checkout, { clientId: t.ids.yanis, lines: [{ kind: 'service', ref: t.ids.cut, packId: 'pk_old', staffId: t.ids.JKut }], payments: [{ method: 'card', amount: 0 }] }, t.asOwner());
  const j = rowOf(report(t.s(), t.q()), t.ids.JKut);
  assert.equal(j.revenue, 1600, '80 € ÷ 5');
  assert.deepEqual(j.cutsCarnet, { n: 1, value: 1600, estimated: 1600 });
  const st = staffStatement(t.s(), t.ids.JKut, '2026-11', DAY, t.clock.now);
  assert.equal(st.cuts.carnet.estimated, 1600);
  assert.ok(st.warnings.some((w) => /estimée/.test(w) && /ancien site/.test(w)));
});

test('a member’s cut counts at its share of the month; the membership line is nobody’s', async () => {
  const t = await shop();
  // PAY-02's lines: the month on a system ticket (staffId null), the cut at 0 € with its credit
  await handSale(t, { lines: [{ kind: 'membership', ref: 'essentiel', name: 'Abonnement Essentiel', qty: 1, unit: 3400, discount: 0, staffId: null, vat: 2000, memberId: 'mb_1', period: { start: DAY, end: '2026-12-03' } }], payments: [{ method: 'online', amount: 3400 }], clientId: t.ids.sami });
  await handSale(t, { lines: [{ kind: 'service', ref: t.ids.cut, name: 'Coupe · Abonnement · coupe 1/2', qty: 1, unit: 0, discount: 0, staffId: t.ids.Frank, vat: 2000, packId: null, listPrice: 2400, memberId: 'mb_1', credit: 1700 }], payments: card(0), clientId: t.ids.sami });
  let rep = report(t.s(), t.q());
  const f = rowOf(rep, t.ids.Frank);
  assert.equal(f.revenue, 1700);
  assert.deepEqual(f.cutsMember, { n: 1, value: 1700 });
  assert.equal(f.commission, 680);
  assert.ok(rep.staff.every((x) => x.id === t.ids.Frank || x.revenue === 0), 'the membership line in nobody’s row');
  assert.equal(rep.gap.prepaidSold, 3400);
  assert.equal(rep.gap.prepaidUsed, 1700);
  await t.set({ team: { memberCredit: 'list' } });
  assert.equal(rowOf(report(t.s(), t.q()), t.ids.Frank).revenue, 2400, 'the price on the card');
  await t.set({ team: { memberCredit: 'zero' } });
  assert.equal(rowOf(report(t.s(), t.q()), t.ids.Frank).revenue, 0);
});

test('a loyalty reward (FID-02 line field): the barber earns as if paid with « list », on what was paid with « net »', async () => {
  const t = await shop();
  // a 25 € cut offered by the stamp card: a line discount the system validated, net 0
  await handSale(t, { lines: [{ kind: 'service', ref: t.ids.cut, name: 'Coupe · fidélité', qty: 1, unit: 2500, discount: 2500, staffId: t.ids.JKut, vat: 2000, packId: null, reward: { id: 'lrw_1', amount: 2500 } }], payments: card(0), clientId: t.ids.nour, cashierId: t.ids.JKut });
  let rep = report(t.s(), t.q());
  let j = rowOf(rep, t.ids.JKut);
  assert.equal(j.revenue, 2500);
  assert.deepEqual(j.rewards, { n: 1, value: 2500 });
  assert.equal(j.discounts, 0, 'a reward is no discount of his');
  assert.equal(rep.revenue, 0, 'Encaissé 0');
  assert.equal(rep.gap.rewards, 2500);
  assert.match(gapWords(rep), /remises fidélité 25,00\s€/);
  await t.set({ team: { rewardCredit: 'net' } });
  rep = report(t.s(), t.q());
  j = rowOf(rep, t.ids.JKut);
  assert.equal(j.revenue, 0);
  assert.equal(rep.gap.rewards, 0);
});

test('tips split by the ticket’s cash share, discounts given, walk-ins, first visits', async () => {
  const t = await shop();
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  // 25 € of lines + 5 € tip, paid 20 € card + 10 € cash
  const lines = [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Frank }, { kind: 'product', ref: t.ids.wax, staffId: t.ids.Frank }];
  await t.engine.run(S.checkout, { clientId: t.ids.karim, lines, discount: { amount: 500, reason: 'Fidélité' }, tip: { amount: 500, staffId: t.ids.Frank }, payments: [{ method: 'card', amount: 2000 }, { method: 'cash', amount: 1000, given: 1000 }] }, t.asOwner());
  // JKut rings up his own cut with a 2 € discount
  await t.engine.run(S.checkout, { clientId: t.ids.nour, lines: [{ kind: 'service', ref: t.ids.cut }], discount: { amount: 200, reason: 'Fidélité' }, payments: card(2200) }, t.as(t.ids.JKut));
  let rep = report(t.s(), t.q());
  const f = rowOf(rep, t.ids.Frank);
  assert.equal(f.tips, 500);
  assert.equal(f.tipsCash, 167);
  assert.equal(f.tipsCard, 333, 'the rounding keeps the total');
  assert.equal(rowOf(rep, t.ids.JKut).discounts, 200, 'the cashier’s discount');
  assert.equal(f.discounts, 0);

  // a walk-in seated with Le Soldat, done; Karim's first visit with Esteban after one with Frank
  const w = await t.engine.run(A.addWalkin, { name: 'Passant', serviceId: t.ids.cut, staffId: t.ids['Le Soldat'] }, t.asOwner()).catch(() => null);
  if (w) {
    await t.engine.run(A.updateWalkin, { id: w.id, action: 'seat', staffId: t.ids['Le Soldat'] }, t.asOwner());
    const ap = [...t.s().appts.values()].find((a) => a.source === 'walkin');
    await t.engine.run(S.checkout, { apptId: ap.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2400) }, t.asOwner());
  }
  const a1 = await t.engine.run(A.createAppointment, { clientId: t.ids.ali, serviceIds: [t.ids.cut], staffId: t.ids.Frank, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: a1.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2400) }, t.asOwner());
  t.clock.now = at('2026-11-04', 10);
  const a2 = await t.engine.run(A.createAppointment, { clientId: t.ids.ali, serviceIds: [t.ids.cut], staffId: t.ids.Esteban, day: '2026-11-04', start: 660 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: a2.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2400) }, t.asOwner());
  rep = report(t.s(), { from: DAY, to: '2026-11-04', staffId: null, today: '2026-11-04', now: t.clock.now });
  assert.equal(rowOf(rep, t.ids.Frank).newClients, 1, 'Ali’s first visit at the salon');
  assert.equal(rowOf(rep, t.ids.Esteban).newClients, 0);
  assert.equal(rowOf(rep, t.ids.Esteban).newToMe, 1, 'known to the salon, first time with him');
  assert.ok(w, 'the walk-in queue works in this salon');
  assert.equal(rowOf(rep, t.ids['Le Soldat']).walkins, 1);
  assert.equal(rowOf(rep, t.ids['Le Soldat']).walkinOverrides, 0, 'no rotation yet (DO-06)');
  // the chair's time: yesterday all of it, today up to now (10:00, the salon opens at 9:00)
  const e = rowOf(rep, t.ids.Esteban);
  assert.equal(e.capMin, 380 + 60);
  assert.equal(e.idleMin, 380 + 60, 'his 11:00 cut is still to come');
  assert.equal(e.perHour, Math.round((2400 * 60) / 440));
});

test('came back within 60 days: 4 visits 90 days ago, 3 clients back → 0,75', async () => {
  const t = await shop();
  const old = addDays(DAY, -90);
  const clients = ['karim', 'yanis', 'ali', 'sami'];
  const events = [];
  clients.forEach((k, i) => events.push(['appt.booked', { id: 'ap_old' + i, code: 'OLD' + i, clientId: t.ids[k], cid: t.ids[k], staffId: t.ids.JKut, day: old, start: 600 + i * 30, dur: 30, services: [{ id: t.ids.cut, name: 'Coupe', price: 2400, dur: 30 }], price: 2400, source: 'phone', status: 'done' }]));
  // three come back within 60 days: two with JKut, one with Frank; Sami comes back after 75 days
  [['karim', 31, 'JKut'], ['yanis', 45, 'JKut'], ['ali', 59, 'Frank'], ['sami', 75, 'JKut']].forEach(([k, n, who], i) => events.push(['appt.booked', { id: 'ap_back' + i, code: 'BCK' + i, clientId: t.ids[k], cid: t.ids[k], staffId: t.ids[who], day: addDays(old, n), start: 600, dur: 30, services: [{ id: t.ids.cut, name: 'Coupe', price: 2400, dur: 30 }], price: 2400, source: 'phone', status: 'done' }]));
  await t.engine.run(raw, { events }, t.sys);
  const j = rowOf(report(t.s(), t.q('2026-11-01', DAY)), t.ids.JKut);
  assert.equal(j.returned60Base, 4);
  assert.equal(j.returned60, 0.75);
  assert.equal(j.returned60Mine, 0.5, 'two of the four came back with him');
});

test('goals: automatic by the chair minutes, a typed one wins, what is left per open day and the week', async () => {
  const t = await shop();
  await t.set({ goals: { monthCents: 2400000 } });
  const g = (who) => goalOf(t.s(), t.ids[who], DAY, t.clock.now);
  assert.deepEqual(['JKut', 'Frank', 'Le Soldat', 'Esteban'].map((x) => g(x).target), [720000, 720000, 480000, 480000]);
  assert.ok(g('JKut').auto);
  await t.set({ goals: { staff: { [t.ids.Frank]: 500000 } } });
  assert.equal(g('Frank').target, 500000);
  assert.equal(g('Frank').auto, false);
  assert.equal(g('JKut').target, 720000, 'the others stay automatic');
  // back to automatic
  await t.set({ goals: { staff: { [t.ids.Frank]: null } } });
  assert.equal(g('Frank').target, 720000);

  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.JKut }], payments: card(2400) }, t.asOwner());
  const j = g('JKut');
  assert.equal(j.done, 2400);
  // November 2026 from Tuesday the 3rd: Tuesday to Saturday, four weeks, today included
  assert.equal(j.openDaysLeft, 20);
  assert.equal(j.perDay, Math.ceil((720000 - 2400) / 20 / 100) * 100);
  assert.deepEqual([j.week.from, j.week.to, j.week.target, j.week.done], ['2026-11-02', '2026-11-08', 180000, 2400]);
  const shopGoal = goalOf(t.s(), null, DAY, t.clock.now);
  assert.equal(shopGoal.target, 2400000);
  assert.equal(shopGoal.done, 2400, 'the salon’s on Encaissé');
});

test('statement: the month in one sheet, provisional while a day has no Z, refunds named', async () => {
  const t = await shop({ day: '2026-10-27', hour: 11 });
  const sold = await t.engine.run(S.checkout, { clientId: t.ids.karim, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Frank }], payments: card(2400) }, t.asOwner());
  await t.engine.run(S.refund, { saleId: sold.id, amount: 400, method: 'card', reason: 'Geste' }, t.asOwner());
  await t.engine.run(S.refund, { saleId: sold.id, amount: 400, method: 'card', reason: 'Geste' }, t.asOwner());
  t.clock.now = at(DAY, 10);
  let st = staffStatement(t.s(), t.ids.Frank, '2026-10', DAY, t.clock.now);
  assert.equal(st.performed, 1600);
  assert.equal(st.refunds, 800);
  assert.deepEqual(st.services, { n: 1, net: 2400 });
  assert.ok(st.warnings.includes('2 remboursements déduits'));
  assert.ok(st.warnings.includes(PROVISIONAL), 'the 27th has no Z: « provisoires »');
  assert.ok(st.warnings.some((w) => /provisoires/.test(w)));
  assert.equal(st.workedDays, 23, 'Tuesday to Saturday in October 2026');
  assert.equal(st.absenceDays, 0);
  // the 27th closed: the month is final
  await t.engine.run(S.closeDay, { day: '2026-10-27' }, t.asOwner());
  st = staffStatement(t.s(), t.ids.Frank, '2026-10', DAY, t.clock.now);
  assert.equal(st.provisional, false);
  assert.ok(!st.warnings.includes(PROVISIONAL));
  // the current month is provisional by nature
  assert.ok(staffStatement(t.s(), t.ids.Frank, '2026-11', DAY, t.clock.now).provisional);
});

/* ---------------- through the API, on the demo salon ---------------- */

const clock = { now: at(DAY, 15, 10) };
let rt, ids;
before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
});
async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function onTablet(name) {
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  assert.equal((await b.post('/api/auth/pin', { staffId: ids[name], pin: DEMO.pins[name] })).status, 200);
  return b;
}

test('API: one number for one barber and one day (agenda, Mes chiffres, statement), and the demo rows add up', async () => {
  const jk = await onTablet('JKut');
  const s = rt.engine.state;
  for (const day of [DAY, '2026-10-31', '2026-10-24']) {
    const ag = (await jk.get('/api/v1/agenda?day=' + day)).json;
    assert.equal(ag.kpis.scope, 'own');
    const own = report(s, { from: day, to: day, staffId: ids.JKut, today: DAY, now: clock.now });
    assert.equal(ag.kpis.revenue, own.revenue, day);
    const rp = (await jk.get('/api/v1/reports?from=' + day + '&to=' + day)).json;
    assert.equal(rp.revenue, own.revenue);
  }
  const oct = (await jk.get('/api/v1/reports?from=2026-10-01&to=2026-10-31')).json;
  assert.ok(oct.revenue > 0);
  assert.equal(typeof oct.tips, 'number');
  assert.equal(typeof oct.rebookRate, 'number');
  assert.ok(oct.goal && oct.goal.staffId === ids.JKut, 'his own goal, for October');
  assert.equal(oct.goal.month, '2026-10');
  const st = (await jk.get('/api/v1/statements?month=2026-10')).json;
  assert.equal(st.performed, oct.revenue, 'the statement says what Mes chiffres says');
  assert.equal(st.commission, oct.staff[0].commission);
  // the demo's whole month: the rows add up and the gap explains Encaissé
  const o = await owner();
  const shopRep = (await o.get('/api/v1/reports?from=2026-10-01&to=2026-10-31')).json;
  assert.equal(shopRep.staff.reduce((t, x) => t + x.revenue, 0), shopRep.performed);
  assert.equal(shopRep.revenue, shopRep.performed + shopRep.gap.prepaidSold - shopRep.gap.prepaidUsed - shopRep.gap.rewards + shopRep.gap.unassigned);
  for (const k of ['walkins', 'newClients', 'returned60', 'cutsCarnet', 'cutsMember', 'tipsCard', 'tipsCash', 'capMin', 'idleMin', 'perHour', 'discounts', 'refunds']) assert.ok(k in shopRep.staff[0], k);
  assert.equal(shopRep.goal.month, '2026-10', 'the goal follows the chosen month');
  assert.equal(shopRep.goal.target, s.settings.goals.monthCents);
});

test('API: the statement is one’s own unless one manages the team; no future month; the goal hides when the owner says so', async () => {
  const jk = await onTablet('JKut');
  let r = await jk.get('/api/v1/statements?month=2026-10&staff=' + ids.Frank);
  assert.equal(r.status, 200);
  assert.equal(r.json.staff.id, ids.JKut, 'a barber asking for Frank gets his own');
  assert.equal((await jk.get('/api/v1/statements?month=2026-12')).status, 400);
  assert.equal((await jk.get('/api/v1/statements?month=2026-13')).status, 400);
  const o = await owner();
  r = await o.get('/api/v1/statements?month=2026-10&staff=' + ids.Frank);
  assert.equal(r.json.staff.id, ids.Frank);
  assert.equal((await o.get('/api/v1/statements?month=2026-10&staff=nobody')).status, 404);
  // the owner hides the barbers' goals
  assert.equal((await o.patch('/api/v1/settings', { goals: { showBarbers: false } })).status, 200);
  assert.equal((await jk.get('/api/v1/reports')).json.goal, null);
  assert.equal((await o.patch('/api/v1/settings', { goals: { showBarbers: true } })).status, 200);
  assert.equal((await jk.get('/api/v1/reports')).json.goal.staffId, ids.JKut);
  // Objectifs: each chair's automatic goal
  const goals = (await o.get('/api/v1/goals')).json;
  assert.equal(goals.month, '2026-11');
  assert.ok(goals.staff.length >= 4 && goals.staff.every((x) => x.auto % 1000 === 0));
  assert.equal((await jk.get('/api/v1/goals')).status, 403);
});

test('API: the payroll CSV, one row per barber, on the salon’s rules; the commissions CSV states its base', async () => {
  const o = await owner();
  assert.equal((await o.patch('/api/v1/settings', { team: { commissionBase: 'ht' } })).status, 200);
  const r = await o.get('/api/v1/export?kind=payroll&month=2026-10');
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('content-disposition') || '', /paie-2026-10/);
  const rows = r.text.replace(/^﻿/, '').trim().split('\r\n').map((l) => l.split(';'));
  assert.ok(rows[0].includes('Base : HT'));
  assert.ok(rows[0].includes('Coupes de carnet : pour qui coupe'));
  assert.ok(rows[0].some((c) => /estimés/.test(c)), 'the tips split is flagged as an estimate');
  assert.deepEqual(rows[1].slice(0, 11), ['Barbier', 'Réalisé TTC', 'Réalisé HT', 'Commission', 'Pourboires carte', 'Pourboires espèces', 'Coupes carnet', 'Coupes abonnement', 'Remboursements déduits', 'Jours travaillés', 'Jours d’absence']);
  const jk = rows.find((x) => x[0] === 'JKut');
  const st = staffStatement(rt.engine.state, ids.JKut, '2026-10', DAY, clock.now);
  assert.equal(jk[1], (st.performed / 100).toFixed(2).replace('.', ','), 'euros with a comma');
  assert.equal(jk[3], (st.commission / 100).toFixed(2).replace('.', ','));
  assert.equal(rows.length - 2, [...rt.engine.state.staff.values()].filter((x) => x.chair && x.active).length);
  const c = await o.get('/api/v1/export?kind=commissions&from=2026-10-01&to=2026-10-31');
  assert.match(c.text.split('\r\n')[0], /Base : HT/);
  assert.match(c.text.split('\r\n')[1], /Réalisé TTC/);
  assert.equal((await o.get('/api/v1/export?kind=payroll&month=2027-01')).status, 400);
  const jkb = await onTablet('JKut');
  assert.equal((await jkb.get('/api/v1/export?kind=payroll&month=2026-10')).status, 403);
  assert.equal((await o.patch('/api/v1/settings', { team: { commissionBase: 'ttc' } })).status, 200);
});
