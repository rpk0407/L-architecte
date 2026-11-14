// The owner's dashboard audit (docs/audit-backoffice/01-dashboard-gerant.md), its measured cases as tests: Tuesday 10
// November at 7:30 with 5 open days finished against October's first 8; one « à ce rythme » for Pilotage and Rapports;
// the morning's briefing and the coming days; the definitions written once (clients, basket, margin, no-show cost, money
// received); an archived barber who rewrites no past month.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at } from '../helpers.js';
import { ticketTotals } from '../../shared/money.js';
import { HOW, gapWords } from '../../shared/figures.js';
import { cockpit, compareOf, periodOf } from '../../server/domain/cockpit.js';
import { report, goalOf, goalShares, openDays, noShowLoss, chairIntervals, PACE_MIN } from '../../server/domain/insights.js';
import { staffIntervals } from '../../server/domain/availability.js';
import { dayTotals } from '../../server/domain/cash.js';
import { updateSettings } from '../../server/commands/shop.js';
import { archiveStaff } from '../../server/commands/team.js';
import * as S from '../../server/commands/sales.js';
import * as A from '../../server/commands/agenda.js';
import { dayRange, localParts } from '../../shared/dates.js';

const TUE = '2026-11-10';
const raw = { run(s, input, ctx) { for (const [type, data, pii] of input.events) ctx.emit(type, data, pii); return { ok: true }; } };
const S_ = (t) => t.engine.state;

/** A ticket written as the till would, on the clock's day. */
async function sale(t, { lines, payments, clientId = null }) {
  const s = S_(t);
  const { nets, ...totals } = ticketTotals(lines, 0, 0);
  const id = 'sa_hand' + (s.saleSeq + 1);
  await t.engine.run(raw, { events: [['sale.completed', { id, number: s.saleSeq + 1, day: localParts(t.clock.now).day, cashierId: null, apptId: null, clientId, lines: lines.map((l, i) => ({ ...l, net: nets[i] })), discount: null, tip: null, totals, payments, note: '' }]] }, t.sys);
  return id;
}
const cut = (t, cents) => ({ kind: 'service', ref: t.ids.cut, name: 'Coupe', qty: 1, unit: cents, discount: 0, staffId: t.ids.Ali, vat: 2000 });
const month = (t) => ({ kind: 'membership', ref: 'essentiel', name: 'Abonnement', qty: 1, unit: 8000, discount: 0, staffId: null, vat: 2000, memberId: 'mb_1', period: { start: TUE, end: '2026-12-10' } });
const card = (amount) => [{ method: 'card', amount }];
const q = (t, range, day = TUE) => ({ range, day, today: localParts(t.clock.now).day, now: t.clock.now });

/**
 * The audit's instance A: October's first eight open days at 867 €, November's five at 874,60 € (4 373 €), and on
 * Tuesday the 10th at 7:30, before the doors open, two months of membership charged (160 €): 4 533 € on the month.
 */
async function morning() {
  const t = await salon({ day: '2026-10-01', hour: 9 });
  await t.engine.run(updateSettings, { goals: { monthCents: 2400000 } }, t.asOwner());
  for (const d of dayRange('2026-10-01', '2026-10-10')) {
    if (!openDays(S_(t), d, d)) continue;
    t.clock.now = at(d, 17);
    await sale(t, { lines: [cut(t, 86700)], payments: card(86700) });
  }
  for (const d of dayRange('2026-11-03', '2026-11-07')) {
    t.clock.now = at(d, 17);
    await sale(t, { lines: [cut(t, 87460)], payments: card(87460) });
  }
  t.clock.now = at(TUE, 7, 30);
  for (const c of [t.ids.yanis, t.ids.yanis]) await sale(t, { lines: [month(t)], payments: [{ method: 'online', amount: 8000 }], clientId: c });
  return t;
}

test('P0-1 · Tuesday 7:30: the month compares 5 finished open days with October’s first 5, not ten calendar days (5 open) with ten (8 open)', async () => {
  const t = await morning();
  const s = S_(t);
  assert.equal(openDays(s, '2026-11-01', '2026-11-09'), 5);
  assert.equal(openDays(s, '2026-10-01', '2026-10-10'), 8);
  const c = cockpit(s, q(t, 'month'));
  assert.equal(c.kpis.cashed.value, 453300);
  // before: 4 533 € against 6 936 € (1 to 10 October), −35 % in red
  const old = report(s, { from: '2026-10-01', to: '2026-10-10', staffId: null, today: TUE, now: t.clock.now }).revenue;
  assert.equal(old, 693600);
  assert.equal(Math.round(((453300 - old) / old) * 100), -35);
  // now: 4 373 € over 5 finished open days against 4 335 € over October's first 5: +1 %
  assert.deepEqual(c.range.compare.cur, { from: '2026-11-01', to: '2026-11-09' });
  assert.deepEqual(c.range.compare.prev, { from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual([c.range.compare.curDays, c.range.compare.prevDays], [5, 5]);
  assert.equal(c.kpis.cmp.cashed, 437300);
  assert.equal(c.kpis.prev.cashed, 433500);
  assert.ok(c.kpis.cmp.cashed > c.kpis.prev.cashed, 'the salon does better: no red arrow');
  assert.equal(c.range.compare.soft, false);
  assert.equal(c.range.compare.words, '5 jours ouverts terminés ce mois-ci, comparés aux 5 premiers jours ouverts d’octobre');
  // every tile's delta reads the same two sides
  assert.equal(c.kpis.prev.fill, report(s, { from: '2026-10-01', to: '2026-10-07', staffId: null, today: TUE, now: t.clock.now }).occupancy);
});

test('P0-1 · no arrow before the salon has opened: the week (Monday closed) and the day compare nothing at 7:30', async () => {
  const t = await morning();
  const s = S_(t);
  const week = cockpit(s, q(t, 'week'));
  assert.equal(week.kpis.cashed.value, 16000);
  assert.equal(week.kpis.prev, null, 'before: 160 € against 899 €, −82 % in red');
  assert.equal(week.kpis.cmp, null);
  assert.match(week.range.compare.words, /^pas encore de jour ouvert terminé cette semaine/);
  const day = cockpit(s, q(t, 'day'));
  assert.equal(day.kpis.prev, null);
  assert.match(day.range.compare.words, /n’a pas encore ouvert/);
  // once open, the day is a part against a whole: shown, without alarm colours
  t.clock.now = at(TUE, 11);
  const open = cockpit(s, q(t, 'day'));
  assert.equal(open.range.compare.soft, true);
  assert.deepEqual(open.range.compare.prev, { from: '2026-11-03', to: '2026-11-03' });
  assert.equal(open.kpis.prev.cashed, 87460);
  // the week still has no finished open day at 11:00; after closing (18:30) Tuesday counts, against last Tuesday alone
  assert.equal(cockpit(s, q(t, 'week')).kpis.prev, null);
  t.clock.now = at(TUE, 19);
  const eve = cockpit(s, q(t, 'week'));
  assert.deepEqual(eve.range.compare.cur, { from: '2026-11-09', to: TUE });
  assert.deepEqual(eve.range.compare.prev, { from: '2026-11-02', to: '2026-11-03' });
  assert.deepEqual([eve.range.compare.curDays, eve.range.compare.prevDays], [1, 1]);
  assert.equal(eve.range.compare.words, '1 jour ouvert terminé cette semaine, comparé au premier jour ouvert de la semaine dernière');
  // a period over: whole against whole, with the open days of each in words
  const oct = compareOf(s, periodOf('month', '2026-10-15', TUE), TUE, 19 * 60);
  assert.deepEqual(oct.prev, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual([oct.curDays, oct.prevDays], [23, 22]);
  assert.equal(oct.words, 'mois entier comparé au mois de septembre entier (23 jours ouverts contre 22)');
});

test('P0-2 · one « à ce rythme » for Pilotage and Rapports: today counts for the part of the day already past', async () => {
  const t = await morning();
  const s = S_(t);
  // before: Pilotage 4 533 ÷ 6 open days × 20 = 15 110 €, Rapports 4 533 ÷ 10 days × 30 = 13 599 €
  assert.equal(Math.round((453300 / 6) * 20 / 100) * 100, 1511000);
  assert.equal(Math.round((453300 / 10) * 30 / 100) * 100, 1359900);
  // now, for both: 5 open days finished, today not begun, 20 open days in November: 4 533 ÷ 5 × 20 = 18 132 €
  const g = goalOf(s, null, TUE, t.clock.now);
  assert.deepEqual(g.pace, { elapsed: 5, total: 20 });
  assert.equal(g.projection, 1813200);
  assert.equal(g.expected, 0.25);
  assert.equal(cockpit(s, q(t, 'month')).kpis.cashed.goal.projection, g.projection, 'Pilotage reads goalOf’s line');
  assert.equal(cockpit(s, q(t, 'day')).kpis.cashed.goal.projection, g.projection);
  // half of the opening hours gone (9:00 to 18:30, at 13:45): five days and a half
  const noon = goalOf(s, null, TUE, at(TUE, 13, 45));
  assert.equal(noon.pace.elapsed, 5.5);
  assert.equal(noon.projection, Math.round((453300 / 5.5) * 20 / 100) * 100);
  // after closing the day is whole; the default (no instant) reads the day as over
  assert.equal(goalOf(s, null, TUE, at(TUE, 19)).pace.elapsed, 6);
  assert.equal(goalOf(s, null, TUE).pace.elapsed, 6);
  // a month over has no projection, and no line before PACE_MIN open days
  assert.equal(goalOf(s, null, '2026-10-31').projection, null);
  assert.equal(PACE_MIN, 2);
  assert.equal(goalOf(s, null, '2026-11-03', at('2026-11-03', 19)).projection, null);
  // a barber's own goal runs on his own days
  const ali = goalOf(s, t.ids.Ali, TUE, t.clock.now);
  assert.deepEqual(ali.pace, { elapsed: 5, total: 20 });
  assert.equal(ali.projection, Math.round((ali.done / 5) * 20 / 100) * 100);
});

test('P1-5 · a month of membership charged is no client, no served ticket and no basket; it is shown apart', async () => {
  const t = await morning();
  const s = S_(t);
  const day = report(s, { from: TUE, to: TUE, staffId: null, today: TUE, now: t.clock.now });
  // before: 2 clients, panier moyen 80 €
  assert.equal(day.revenue, 16000);
  assert.equal(day.tickets, 2);
  assert.deepEqual([day.served, day.clients, day.newClients, day.avgTicket, day.prepaidSold], [0, 0, 0, 0, 16000]);
  const c = cockpit(s, q(t, 'day'));
  assert.deepEqual(c.kpis.clients, { total: 0, new: 0, returning: 0 });
  assert.equal(c.kpis.avgTicket, 0);
  assert.equal(c.kpis.cashed.prepaidSold, 16000);
  // the month: five served tickets (no client file: one client each), their basket without the 160 € of memberships
  const m = report(s, { from: '2026-11-01', to: TUE, staffId: null, today: TUE, now: t.clock.now });
  assert.deepEqual([m.tickets, m.served, m.clients, m.avgTicket], [7, 5, 5, 87460]);
  // a carnet sold alone is prepaid too; a cut and a product on one ticket are one client and one basket
  t.clock.now = at(TUE, 10);
  await sale(t, { lines: [{ kind: 'pack', ref: t.ids.pack, name: 'Carnet', qty: 1, unit: 8000, discount: 0, staffId: t.ids.Ali, vat: 2000 }], payments: card(8000), clientId: t.ids.yanis });
  const both = await sale(t, { lines: [cut(t, 2000), { kind: 'product', ref: t.ids.oil, name: 'Huile', qty: 1, unit: 1500, discount: 0, staffId: t.ids.Ali, vat: 2000, cost: 600 }], payments: card(3500), clientId: t.ids.yanis });
  let d = report(s, { from: TUE, to: TUE, staffId: null, today: TUE, now: t.clock.now });
  assert.deepEqual([d.tickets, d.served, d.clients, d.avgTicket, d.prepaidSold], [4, 1, 1, 3500, 24000]);
  // a refund on a ticket of the period comes off its basket
  await t.engine.run(S.refund, { saleId: both, amount: 1500, method: 'card', reason: 'Retour', lines: [{ i: 1, qty: 1 }] }, t.asOwner());
  d = report(s, { from: TUE, to: TUE, staffId: null, today: TUE, now: t.clock.now });
  assert.equal(d.avgTicket, 2000);
});

test('P1-6 · product margin on the price before VAT: 7 oils at 15 € TTC bought 6 € make 45,50 €, not 63 €', async () => {
  const t = await salon({ day: TUE, hour: 10 });
  const s = S_(t);
  const id = await sale(t, { lines: [{ kind: 'product', ref: t.ids.oil, name: 'Huile', qty: 7, unit: 1500, discount: 0, staffId: t.ids.Ali, vat: 2000, cost: 600 }], payments: card(10500) });
  const read = () => report(s, { from: TUE, to: TUE, staffId: null, today: TUE, now: t.clock.now }).products[0];
  assert.equal(7 * 1500 - 7 * 600, 6300, 'before: on the TTC');
  assert.deepEqual([read().count, read().revenue, read().margin], [7, 10500, 4550]);
  // one given back: its sale and its margin come off (12,50 − 6 = 6,50 €)
  await t.engine.run(S.refund, { saleId: id, amount: 1500, method: 'card', reason: 'Retour', lines: [{ i: 0, qty: 1 }] }, t.asOwner());
  assert.deepEqual([read().revenue, read().margin], [9000, 3900]);
  assert.match(HOW.margin, /HT/);
});

test('P1-7 · one cost of a no-show: the price less the deposit kept (50 € with 15 € kept: 35 €), on Pilotage and Rapports', async () => {
  assert.equal(noShowLoss({ price: 5000, deposit: { amount: 1500, paid: 1500 } }), 3500);
  assert.equal(noShowLoss({ price: 5000, deposit: null }), 5000);
  assert.equal(noShowLoss({ price: 5000, deposit: { amount: 1500, paid: 0 } }), 5000, 'a deposit asked and never paid keeps nothing');
  assert.equal(noShowLoss({ price: 2000, deposit: { amount: 3000, paid: 3000 } }), 0);
  const t = await salon({ day: TUE, hour: 8 });
  const s = S_(t);
  const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.color], staffId: t.ids.Ali, day: TUE, start: 540 }, t.asOwner());
  t.clock.now = at(TUE, 11);
  await t.engine.run(A.setStatus, { id: a.id, status: 'no_show' }, t.asOwner());
  const appt = s.appts.get(a.id);
  appt.price = 5000; appt.deposit = { amount: 1500, paid: 1500, paymentId: null }; s.version++;
  // before: Pilotage said 0 € (any deposit erased the loss), Rapports « absences × panier moyen »
  assert.equal(cockpit(s, q(t, 'day')).kpis.noShows.lost, 3500);
  assert.equal(report(s, { from: TUE, to: TUE, staffId: null, today: TUE, now: t.clock.now }).noShowLost, 3500);
});

test('P1-8 · « Chiffre d’affaires » is the revenue; « Entré en caisse » is the money that came in, as the Z counts it', async () => {
  const t = await salon({ day: TUE, hour: 10 });
  const s = S_(t);
  // a 30 € cut settled 20 € by a deposit paid last week and 10 € by card: 30 € of revenue, 10 € in the till today
  await sale(t, { lines: [cut(t, 3000)], payments: [{ method: 'deposit', amount: 2000 }, { method: 'card', amount: 1000 }] });
  const c = cockpit(s, q(t, 'day'));
  assert.equal(c.kpis.cashed.value, 3000);
  assert.equal(c.kpis.cashed.takings, 1000);
  assert.equal(c.kpis.cashed.takings, dayTotals(s, TUE).takings, 'the Z’s own figure');
  assert.equal(c.kpis.cashed.valueHT, 2500);
  // the word « Encaissé » is kept for money received: the gap sentence names the revenue
  assert.match(gapWords({ revenue: 3000, performed: 3000, gap: { prepaidSold: 0, prepaidUsed: 0, rewards: 0, unassigned: 0 } }), /Chiffre d’affaires/);
  assert.ok(!/Encaissé/.test(gapWords({ revenue: 3000, performed: 3000, gap: { prepaidSold: 0, prepaidUsed: 0, rewards: 0, unassigned: 0 } })));
});

test('C1, C2 · 7:30 shows what is coming: today’s appointments and expected revenue, each chair’s fill, the free time to sell, the next 7 days', async () => {
  const t = await salon({ day: TUE, hour: 7 });
  const s = S_(t);
  t.clock.now = at(TUE, 7, 30);
  const book = (staff, serviceId, day, start) => t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [serviceId], staffId: t.ids[staff], day, start }, t.asOwner());
  await book('Ali', t.ids.cut, TUE, 540);
  await book('Ben', t.ids.beard, TUE, 600);
  await book('Ali', t.ids.cut, '2026-11-11', 540);
  let c = cockpit(s, q(t, 'day'));
  // nothing is taken yet, and the screen is not made of zeros
  assert.equal(c.kpis.cashed.value, 0);
  const d = c.today;
  assert.deepEqual([d.open, d.opensAt, d.closesAt, d.started], [true, 540, 1110, false]);
  assert.deepEqual([d.count, d.planned, d.left, d.expected, d.firstAt], [2, 5000, 2, 5000, 540]);
  // on Tuesdays both work 9:00–13:00 and 13:30–18:30 (540 min each): 60 min booked
  assert.deepEqual([d.capMin, d.bookedMin, d.freeMin], [1080, 60, 1020]);
  assert.equal(d.fill, 60 / 1080);
  const [ali, ben] = d.chairs;
  assert.deepEqual([ali.name, ali.capMin, ali.bookedMin, ali.freeMin, ali.off], ['Ali', 540, 30, 510, false]);
  assert.deepEqual([ben.fill, ben.freeMin], [30 / 540, 510]);
  assert.deepEqual(ali.gap, [810, 1110], 'his longest free stretch: 13:30 to 18:30');
  // the coming days: tomorrow's one appointment, the week's free hours; Sunday and Monday are closed
  const h = c.ahead;
  assert.deepEqual([h.from, h.to, h.days.length], ['2026-11-11', '2026-11-17', 7]);
  assert.deepEqual([h.days[0].count, h.days[0].planned, h.days[0].bookedMin, h.days[0].capMin], [1, 2000, 30, 1140]);
  assert.deepEqual(h.days.map((x) => x.open), [true, true, true, true, false, false, true]);
  assert.equal(h.chairs[0].days[0], 30 / 570);
  assert.equal(h.chairs[0].days[4], null, 'a day he does not work has no fill');
  assert.equal(h.fill, 30 / h.capMin);
  assert.equal(h.freeMin, h.capMin - 30);
  // a block posed in the agenda (training) is no time to sell, and does not change the fill
  await t.engine.run(A.addBlock, { staffId: t.ids.Ben, day: TUE, start: 840, dur: 120, label: 'Formation' }, t.asOwner());
  c = cockpit(s, q(t, 'day'));
  assert.equal(c.today.chairs[1].freeMin, 390);
  assert.equal(c.today.chairs[1].fill, 30 / 540);
  // at noon only the hours still ahead are free to sell: Ali 12:00–13:00 and 13:30–18:30, the same for Ben less his two hours of training
  t.clock.now = at(TUE, 12);
  c = cockpit(s, q(t, 'day'));
  assert.deepEqual(c.today.chairs.map((x) => x.freeMin), [360, 240]);
  assert.equal(c.today.started, true);
  // the same today whatever the period shown
  assert.deepEqual(cockpit(s, q(t, 'month')).today, c.today);
  // a barber on leave today is said away, with no time to sell
  const { addTimeOff } = await import('../../server/commands/team.js');
  await t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: '2026-11-12', to: '2026-11-12', label: 'Congé' }, t.asOwner());
  assert.equal(cockpit(s, q(t, 'day')).ahead.chairs[1].days[1], null);
});

test('P1-3 · archiving a barber rewrites neither a past month’s fill nor the others’ goals', async () => {
  const t = await salon({ day: '2026-10-06', hour: 8 });
  const s = S_(t);
  await t.engine.run(updateSettings, { goals: { monthCents: 2400000 } }, t.asOwner());
  for (const who of ['Ali', 'Ben']) await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.color], staffId: t.ids[who], day: '2026-10-06', start: who === 'Ali' ? 540 : 660 }, t.asOwner());
  const oct = () => report(s, { from: '2026-10-01', to: '2026-10-31', staffId: null, today: TUE, now: t.clock.now });
  t.clock.now = at(TUE, 10);
  const before = { fill: oct().occupancy, ben: oct().staff.find((x) => x.id === t.ids.Ben).occupancy, shares: [...goalShares(s, '2026-10-15')], ali: goalOf(s, t.ids.Ali, '2026-10-31').target };
  assert.ok(before.fill > 0 && before.ben > 0);
  await t.engine.run(archiveStaff, { id: t.ids.Ben }, t.asOwner());
  assert.equal(s.staff.get(t.ids.Ben).active, false);
  // the booking engine sees no hours for him any more; the reports keep his hours up to the day he left
  assert.deepEqual(staffIntervals(s, t.ids.Ben, '2026-10-06'), []);
  assert.deepEqual(chairIntervals(s, t.ids.Ben, '2026-10-06'), [[540, 780], [810, 1110]]);
  assert.deepEqual(chairIntervals(s, t.ids.Ben, TUE), [], 'none from the day he left');
  const after = oct();
  assert.equal(after.occupancy, before.fill, 'the salon’s October fill does not move');
  assert.equal(after.staff.find((x) => x.id === t.ids.Ben).occupancy, before.ben, 'nor his own');
  assert.deepEqual([...goalShares(s, '2026-10-15')], before.shares);
  assert.equal(goalOf(s, t.ids.Ali, '2026-10-31').target, before.ali, 'Ali’s October goal is what it was');
  // the month he left: his share stops with him; the month after, he has none and Ali carries the goal
  const nov = goalShares(s, TUE);
  assert.ok(nov.get(t.ids.Ben) > 0 && nov.get(t.ids.Ben) < nov.get(t.ids.Ali));
  assert.deepEqual([...goalShares(s, '2026-12-15').keys()], [t.ids.Ali]);
  // without the fix the active chairs alone carried October: 60 booked minutes on Ben's side stayed over Ali's hours only
  const aliOnly = dayRange('2026-10-01', '2026-10-31').reduce((m, d) => m + staffIntervals(s, t.ids.Ali, d).reduce((x, [a, b]) => x + b - a, 0), 0);
  assert.ok(120 / aliOnly > before.fill * 1.9, 'the old reading nearly doubled the fill');
});

test('every definition is written once, in plain French', () => {
  for (const k of ['revenue', 'takings', 'pace', 'compare', 'fill', 'clients', 'basket', 'noShow', 'margin', 'free', 'planned']) assert.ok(HOW[k] && HOW[k].length < 240, k);
});
