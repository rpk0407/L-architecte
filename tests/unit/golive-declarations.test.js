// Go-live audit · « la partie déclaration ». Three weeks of random till activity from a seeded generator (so a failure
// replays), across a month end: tickets at the four French VAT rates, line and ticket discounts, tips, mixed payments,
// gift cards sold, spent and cancelled, deposits paid one day and used the next (or refunded, or kept), credit notes by
// amount, by line, split, on a sealed day. Then the figures are recomputed from the JOURNAL EVENTS alone, independently
// of the code that builds the Z, and compared to the cent with: each sealed Z, the month closure, the accountant's
// entries (balanced, importable), the VAT of the month, and the CSV files as they are downloaded.
// The rules it holds true are those documented in docs/mise-en-ligne.md (« Ce que disent les chiffres »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService, addProduct, adjustStock } from '../../server/commands/catalog.js';
import * as S from '../../server/commands/sales.js';
import * as A from '../../server/commands/agenda.js';
import { createPayment, paymentSucceeded, paymentEnded } from '../../server/commands/payments.js';
import { closePeriod } from '../../server/commands/fiscal.js';
import { zFigures } from '../../server/domain/cash.js';
import { ledger, vatReturn, fecText, csvText, checkFec, FEC_FIELDS } from '../../server/domain/ledger.js';
import { vatSplit, DENOMS } from '../../shared/money.js';
import { browser, ORIGIN } from '../api/client.js';
import { handle } from '../../server/http/app.js';
import { at } from '../helpers.js';
import { addDays, weekday, localParts } from '../../shared/dates.js';

/** mulberry32: a small seeded generator, the same sequence on every machine. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FR_RATES = [2000, 1000, 550, 210];

async function fiscalSalon(startDay) {
  const clock = { now: at(startDay, 8, 30) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const web = browser(rt);
  assert.equal((await web.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const owner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings), meta: {} });
  const run = (cmd, input, ctx = owner()) => rt.engine.run(cmd, input, ctx);
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = { staff: [], services: [], products: [] };
  for (const name of ['Ali', 'Ben']) ids.staff.push((await run(addStaff, { name, role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } })).id);
  const svc = async (x) => { const id = (await run(addService, x)).id; ids.services.push({ id, ...x }); return id; };
  await svc({ name: 'Coupe', category: 'Coupes', price: 2000, dur: 30 });
  await svc({ name: 'Coupe + barbe', category: 'Coupes', price: 3000, dur: 30 });
  await svc({ name: 'Couleur', category: 'Couleur', price: 6000, dur: 60, from: true });
  ids.deposit = ids.services[2];
  // the four French rates, on odd prices: every rounding the till can meet
  for (const [name, price, vat] of [['Huile', 1500, 2000], ['Peigne', 790, 2000], ['Livre de coupe', 1290, 550], ['Boisson', 250, 1000], ['Magazine', 190, 210]]) {
    const id = (await run(addProduct, { name, price, cost: 100, vat })).id;
    await run(adjustStock, { id, delta: 5000, reason: 'Stock initial' });
    ids.products.push({ id, price, vat });
  }
  /** a session lasts hours, the tests move the clock by weeks: sign in again before reading a file */
  const login = async () => assert.equal((await web.post('/api/auth/login', { email: 'gerant@salon.test', password: 'Architecte13!' })).status, 200);
  /** A file as the browser saves it: the bytes, decoded without dropping the BOM (Response.text() would). */
  const download = async (path) => {
    const res = await handle(new Request(ORIGIN + path, { headers: { cookie: [...web.jar].map(([k, v]) => k + '=' + v).join('; '), 'sec-fetch-site': 'same-origin', 'x-real-ip': web.ip } }), { runtime: rt });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(bytes);
    let json = null;
    try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: res.status, headers: res.headers, bytes, text, json };
  };
  return { rt, clock, web, ids, run, owner, login, download, s: () => rt.engine.state };
}

/** Three weeks at the till. Every choice comes from `r`; nothing reads the Z or the totals to decide. */
async function trade(x, days, r) {
  const { run, ids, clock } = x;
  const pick = (list) => list[Math.floor(r() * list.length)];
  const CLIENT = { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { payLive: true, payProvider: 'stripe', linkFor: (a) => 'https://salon.test/r/' + a.code } };
  const STRIPE = { actor: { t: 'provider', id: 'stripe' }, caps: new Set(), meta: {} };
  const SYS = { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']), meta: {} };
  /** deposits paid and waiting for their day: day → [{ apptId, pid, fate }] */
  const due = new Map();
  let pn = 0, phone = 0;
  const dueOf = async (body) => { try { await run(S.checkout, { ...body, payments: [{ method: 'card', amount: 999999 }] }); } catch (e) { if (e.code === 'unbalanced') return e.extra.due; throw e; } throw new Error('a ticket of 9 999,99 €'); };

  for (const [di, day] of days.entries()) {
    clock.now = at(day, 9, 0);
    await run(S.openDrawer, { float: 10000 });

    // deposits for the next trading day: booked and paid today (a customer advance at the end of today)
    const next = days[di + 1];
    if (next) {
      const list = [];
      for (const [k, staffId] of ids.staff.entries()) {
        phone++;
        const b = await run(A.bookOnline, { serviceIds: [ids.deposit.id], staffId, day: next, start: 600 + 120 * k, first: 'Client' + phone, phone: '06' + String(10000000 + phone) }, CLIENT);
        assert.equal(b.deposit, 1800);
        const pid = 'py_t' + (++pn);
        await run(createPayment, { id: pid, kind: 'deposit', amount: b.deposit, provider: 'stripe', providerRef: 'cs_' + pn, apptId: b.id }, SYS);
        await run(paymentSucceeded, { providerRef: 'cs_' + pn, amount: b.deposit, chargeRef: 'pi_' + pn }, STRIPE);
        const f = r();
        list.push({ apptId: b.id, pid, fate: f < 0.6 ? 'used' : f < 0.8 ? 'cancelled' : 'noshow' });
      }
      due.set(next, list);
    }

    const n = 10 + Math.floor(r() * 12);
    for (let i = 0; i < n; i++) {
      clock.now += (3 + Math.floor(r() * 12)) * 60000;
      const lines = [];
      const nl = 1 + Math.floor(r() * 3);
      for (let j = 0; j < nl; j++) {
        const staffId = pick(ids.staff);
        let l, full;
        if (r() < 0.55) {
          const sv = pick(ids.services);
          const unit = sv.from ? sv.price + 500 * Math.floor(r() * 7) : sv.price;
          l = { kind: 'service', ref: sv.id, staffId, ...(sv.from ? { unit } : {}) }; full = unit;
        } else {
          const p = pick(ids.products);
          const qty = 1 + Math.floor(r() * 3);
          l = { kind: 'product', ref: p.id, qty, staffId }; full = p.price * qty;
        }
        if (r() < 0.2) l.discount = Math.floor(r() * full * 0.5);
        lines.push(l);
      }
      const gift = r() < 0.08;
      if (gift) lines.push({ kind: 'giftcard', unit: 1000 + 500 * Math.floor(r() * 19) });
      const body = { lines };
      if (r() < 0.2) body.discount = { amount: 1 + Math.floor(r() * 900), reason: 'Fidélité' };
      if (r() < 0.3) body.tip = { amount: 50 + Math.floor(r() * 450), staffId: pick(ids.staff) };
      const dueC = await dueOf(body);
      const pays = [];
      let rest = dueC;
      const card = [...x.s().giftcards.values()].find((g) => g.status === 'active' && g.balance > 0);
      if (!gift && card && rest > 1 && r() < 0.3) {
        const amt = Math.min(card.balance, 1 + Math.floor(r() * rest));
        // the till never holds the code after the sale: the generator keeps those it issued
        pays.push({ method: 'giftcard', amount: amt, ref: x.codes.get(card.id) });
        rest -= amt;
      }
      const how = r();
      if (rest > 0) {
        if (how < 0.4) pays.push({ method: 'card', amount: rest });
        else if (how < 0.65) pays.push({ method: 'cash', amount: rest, given: Math.ceil(rest / 500) * 500 });
        else if (rest > 1) { const c = 1 + Math.floor(r() * (rest - 1)); pays.push({ method: 'cash', amount: c, given: c }, { method: 'card', amount: rest - c }); }
        else pays.push({ method: 'card', amount: rest });
      }
      if (!pays.length) pays.push({ method: 'card', amount: 0 });
      const res = await run(S.checkout, { ...body, payments: pays });
      for (const g of res.giftcards) x.codes.set(g.id, g.code);
    }

    // yesterday's deposits: used on their ticket (the rest by card, cash or both), cancelled in time and refunded, or
    // kept after a no-show (« Acompte conservé », as POST /api/v1/payments/:id/keep rings it up)
    clock.now = Math.max(clock.now, at(day, 15, 0));
    for (const d of due.get(day) || []) {
      const a = x.s().appts.get(d.apptId);
      if (d.fate === 'cancelled') {
        await run(A.cancelAppointment, { id: a.id, reason: 'Empêchement' });
        await run(paymentEnded, { id: d.pid, status: 'refunded', reason: 'Annulé par le salon' }, STRIPE);
      } else if (d.fate === 'noshow') {
        await run(A.setStatus, { id: a.id, status: 'no_show' });
        await run(S.checkout, { clientId: a.clientId, lines: [{ kind: 'fee', name: 'Acompte conservé · absence', unit: 1800 }], payments: [{ method: 'online', amount: 1800, ref: d.pid }] });
      } else {
        const rest = a.price - 1800;
        const c = r() < 0.5 ? 0 : 1 + Math.floor(r() * (rest - 1));
        const pays = [{ method: 'deposit', amount: 1800, ref: d.pid }, ...(c ? [{ method: 'cash', amount: c, given: c }] : []), { method: 'card', amount: rest - c }];
        await run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: ids.deposit.id }], payments: pays });
      }
    }

    // credit notes, on today's tickets and on tickets of sealed days
    const k = 2 + Math.floor(r() * 4);
    for (let i = 0; i < k; i++) {
      const sales = [...x.s().sales.values()].filter((v) => !v.payments.some((p) => p.method === 'giftcard'));
      const sale = pick(sales);
      const plan = S.refundPlan(x.s(), sale);
      const kind = r();
      const giftLine = plan.lines.find((l) => l.kind === 'giftcard' && l.left > 0);
      if (giftLine && kind < 0.5) {
        // an unused card cancelled: its whole value, out of revenue and VAT
        await run(S.refund, { saleId: sale.id, amount: giftLine.value, method: 'card', reason: 'Carte annulée', lines: [{ i: giftLine.i, qty: 1 }] });
        continue;
      }
      if (plan.free <= 0) continue;
      const deposit = sale.payments.find((p) => p.method === 'deposit' || p.method === 'online');
      if (deposit && r() < 0.5) {
        const back = (sale.refundIds || []).map((id) => x.s().refunds.get(id)).filter((f) => f.method === 'online').reduce((t, f) => t + f.amount, 0);
        const amount = Math.min(plan.free, deposit.amount - back, 1 + Math.floor(r() * deposit.amount));
        if (amount > 0) await run(S.refund, { saleId: sale.id, amount, method: 'online', reason: 'Remboursé en ligne', providerRef: 're_' + sale.number + '_' + i });
        continue;
      }
      const line = plan.lines.find((l) => (l.kind === 'service' || l.kind === 'product') && l.left > 0 && l.value > 0);
      if (line && kind < 0.75) {
        // by line: the server says what one unit of it is still worth
        // (refused when a credit note without lines already took more of the ticket than the line leaves: skipped)
        const method = r() < 0.5 ? 'card' : 'cash';
        for (let amount = 999999, tries = 0; amount > 0 && tries < 3; tries++) {
          try { await run(S.refund, { saleId: sale.id, amount, method, reason: 'Ligne rendue', lines: [{ i: line.i, qty: 1 }] }); break; }
          catch (e) { if (e.code === 'refunded') break; if (!e.extra || !(e.extra.max < amount)) throw e; amount = e.extra.max; }
        }
        continue;
      }
      const amount = 1 + Math.floor(r() * plan.free);
      if (amount > 1 && r() < 0.3) { const c = 1 + Math.floor(r() * (amount - 1)); await run(S.refund, { saleId: sale.id, amount, method: 'card', reason: 'Geste commercial', split: [{ method: 'card', amount: amount - c }, { method: 'cash', amount: c }] }); }
      else await run(S.refund, { saleId: sale.id, amount, method: r() < 0.5 ? 'card' : 'cash', reason: 'Geste commercial' });
    }

    // the count finds every cent, then the Z
    const d = (await x.web.get('/api/v1/drawer')).json;
    let left = d.open.expected;
    const counts = {};
    for (const c of DENOMS) { const q = Math.floor(left / c); if (q) { counts[c] = q; left -= q * c; } }
    const count = await run(S.closeDrawer, { counts });
    assert.equal(count.diff, 0);
    clock.now = at(day, 19, 30);
    await run(S.closeDay, {});
  }
}

/** The day's figures from the events alone: what was sold and at which rate, what was given back, how it was paid. */
function fromJournal(journal) {
  const days = new Map();
  const of = (day) => { if (!days.has(day)) days.set(day, { gross: 0, sold: 0, tips: 0, back: 0, cards: 0, cardsBack: 0, ttc: new Map(), pay: {}, tickets: 0, rows: 0 }); return days.get(day); };
  const saleDay = new Map(), salePays = new Map();
  for (const e of journal) {
    const d = e.data;
    if (e.type === 'sale.completed') {
      const o = of(d.day);
      saleDay.set(d.id, d.day); salePays.set(d.id, d.payments);
      o.tickets++;
      const rates = new Set();
      for (const l of d.lines) {
        if (l.kind === 'giftcard') { o.cards += l.net; continue; }
        o.gross += l.net;
        o.ttc.set(l.vat || 0, (o.ttc.get(l.vat || 0) || 0) + l.net);
        rates.add(l.vat || 0);
      }
      o.rows += rates.size;
      if (d.tip) o.tips += d.tip.amount;
      for (const p of d.payments) o.pay[p.method] = (o.pay[p.method] || 0) + p.amount;
    } else if (e.type === 'sale.refunded') {
      const o = of(d.day);
      o.back += d.amount - (d.liability || 0);
      o.cardsBack += d.liability || 0;
      for (const v of d.vat || []) o.ttc.set(v.rate, (o.ttc.get(v.rate) || 0) - v.base - v.tax);
      o.rows += (d.vat || []).length;
      const pays = salePays.get(d.saleId) || [];
      const offDeposit = !pays.some((p) => p.method === 'online') && pays.some((p) => p.method === 'deposit');
      for (const p of d.parts || [{ method: d.method, amount: d.amount }]) { const m = p.method === 'online' && offDeposit ? 'deposit' : p.method; o.pay[m] = (o.pay[m] || 0) - p.amount; }
    }
  }
  return days;
}
const sum = (o) => Object.values(o).reduce((t, v) => t + v, 0);
/** A French CSV as Excel reads it: BOM, « ; », CRLF. → rows of cells */
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xfeff, 'starts with a BOM: Excel reads the accents');
  assert.ok(!/[^\r]\n/.test(text), 'CRLF line ends only');
  return text.slice(1).split('\r\n').filter((l) => l !== '').map((l) => l.split(';'));
}
const cents = (v) => { assert.match(v, /^-?\d+,\d{2}$/, 'a decimal comma, two decimals, no thousands separator: « ' + v + ' »'); return Math.round(Number(v.replace(',', '.')) * 100); };

const DAYS = [];
for (let d = '2026-10-20'; d <= '2026-11-07'; d = addDays(d, 1)) if (weekday(d) >= 2) DAYS.push(d); // Tuesday to Saturday

for (const seed of [20261113, 7, 424242]) {
  test('three weeks of random till activity add up to the cent everywhere (seed ' + seed + ')', async () => {
    const x = await fiscalSalon(DAYS[0]);
    x.codes = new Map();
    await trade(x, DAYS, rng(seed));
    const s = x.s();
    const J = fromJournal(x.rt.engine.journal);
    assert.equal(x.rt.engine.verify().ok, true);
    assert.ok(s.sales.size > 150 && s.refunds.size > 30, s.sales.size + ' tickets, ' + s.refunds.size + ' credit notes');

    // every ticket: per rate, HT = TTC / (1 + rate) rounded to the cent, VAT = TTC − HT; French rates only
    for (const sale of s.sales.values()) {
      for (const v of sale.totals.vat) {
        assert.ok(FR_RATES.includes(v.rate) || v.rate === 0, 'rate ' + v.rate);
        assert.equal(v.base, vatSplit(v.base + v.tax, v.rate).base);
        assert.ok(Number.isInteger(v.base) && Number.isInteger(v.tax));
      }
      assert.equal(sale.totals.revenue, sale.totals.revenueHT + sale.totals.vat.reduce((t, v) => t + v.tax, 0));
      assert.equal(sale.payments.reduce((t, p) => t + p.amount, 0), sale.totals.revenue + sale.totals.liability + sale.totals.tip, 'paid = sold + gift cards + tip');
    }

    // every Z against the events
    let grand = 0;
    for (const day of DAYS) {
      const z = s.closures.get(day);
      assert.ok(z, 'a Z for ' + day);
      const f = zFigures(z), o = J.get(day);
      assert.equal(f.grossTtc, o.gross, day + ' gross');
      assert.equal(f.refundsTotal, o.back, day + ' refunds');
      assert.equal(f.netTtc, o.gross - o.back, day + ' net');
      assert.equal(f.tips, o.tips, day + ' tips are counted apart, never in revenue');
      assert.equal(f.giftcardsSold, o.cards - o.cardsBack, day + ' gift cards sold');
      // VAT by rate: base + VAT is the TTC sold at that rate, less what was given back at that rate
      let ttc = 0, tax = 0;
      for (const v of f.vatNet) {
        assert.equal(v.base + v.tax, o.ttc.get(v.rate) || 0, day + ' TTC at ' + v.rate);
        ttc += v.base + v.tax; tax += v.tax;
        // and never further from the exact fraction than the rounding of its tickets allows
        assert.ok(Math.abs(v.tax - ((v.base + v.tax) * v.rate) / (10000 + v.rate)) <= 0.5 * o.rows + 1e-6);
      }
      for (const [rate, v] of o.ttc) assert.ok(!v || f.vatNet.some((q) => q.rate === rate), day + ' rate ' + rate + ' is on the Z');
      assert.equal(ttc, f.netTtc, day + ' the rates add up to the net TTC');
      assert.equal(f.htNet, f.netTtc - tax, day + ' HT = TTC − VAT');
      // by payment method, net of what was given back
      for (const m of new Set([...Object.keys(o.pay), ...Object.keys(f.paymentsNet)])) assert.equal(f.paymentsNet[m] || 0, o.pay[m] || 0, day + ' ' + m);
      assert.equal(f.paidTotal, f.netTtc + f.tips + f.giftcardsSold, day + ' sum of the payment methods = the till total');
      assert.equal(f.takings + f.prepaid, f.paidTotal);
      assert.equal(f.prepaid, (f.paymentsNet.giftcard || 0) + (f.paymentsNet.deposit || 0));
      // the drawer: float + cash in − cash out, counted without a gap
      const dr = [...s.drawers.values()].find((q) => q.day === day);
      assert.equal(dr.counted - dr.float, f.paymentsNet.cash || 0, day + ' cash');
      grand += f.netTtc;
      assert.equal(z.grandTotal, grand, day + ' perpetual total');
      assert.equal(z.tickets, o.tickets);
    }

    // the month closes on the sum of its Z, after its last day only
    await assert.rejects(x.run(closePeriod, { month: '2026-11' }), { code: 'not_over' });
    x.clock.now = at('2026-11-09', 10);
    const oct = await x.run(closePeriod, { month: '2026-10' });
    const P = x.s().periodByKey.get('M:2026-10');
    const octDays = DAYS.filter((d) => d.startsWith('2026-10'));
    const zs = octDays.map((d) => zFigures(s.closures.get(d)));
    const add = (k) => zs.reduce((t, f) => t + f[k], 0);
    assert.equal(oct.net, add('netTtc'));
    for (const k of ['grossTtc', 'refundsTotal', 'netTtc', 'htNet', 'tips', 'giftcardsSold', 'takings', 'prepaid']) assert.equal(P.totals[k], add(k), 'month ' + k);
    for (const v of P.totals.vatNet) assert.equal(v.tax, zs.reduce((t, f) => t + ((f.vatNet.find((q) => q.rate === v.rate) || { tax: 0 }).tax), 0));
    assert.equal(P.totals.netTtc, P.totals.htNet + P.totals.vatNet.reduce((t, v) => t + v.tax, 0), 'month TTC − HT = VAT, to the cent');
    assert.equal(sum(P.totals.paymentsNet), P.totals.netTtc + P.totals.tips + P.totals.giftcardsSold);
    assert.equal(P.perpetual.net, s.closures.get(octDays[octDays.length - 1]).grandTotal);
    assert.equal(P.tickets.count, octDays.reduce((t, d) => t + J.get(d).tickets, 0));
    assert.equal(P.from, '2026-10-01');
    assert.equal(P.to, '2026-10-31');

    // the accountant's entries for October: balanced, importable, and the same figures again
    const L = ledger(x.s(), { from: '2026-10-01', to: '2026-10-31', today: '2026-11-09' });
    const trouble = L.warnings.filter((w) => !/Virements Stripe non suivis/.test(w));
    assert.deepEqual(trouble, [], 'no Z mismatch, no unbalanced entry, nothing on the waiting account');
    for (const e of L.entries) assert.equal(e.lines.reduce((t, l) => t + l.debit - l.credit, 0), 0, e.piece + ' balanced');
    assert.equal(checkFec(fecText(L.entries)).ok, true);
    const acc = (re, keep = () => true) => L.entries.reduce((t, e) => t + e.lines.filter((l) => re.test(l.account) && keep(l)).reduce((u, l) => u + l.credit - l.debit, 0), 0);
    assert.equal(acc(/^70/), P.totals.htNet, 'class 7 = the month’s HT');
    assert.equal(acc(/^4457/, (l) => l.src !== 'deposit'), P.totals.vatNet.reduce((t, v) => t + v.tax, 0), 'VAT collected on tickets = the Z’s VAT');
    assert.equal(-acc(/^530/), P.totals.paymentsNet.cash || 0, 'cash');
    assert.equal(-acc(/^5115/), P.totals.paymentsNet.card || 0, 'card terminal');
    assert.equal(acc(/^41911/), P.totals.giftcardsSold - (P.totals.paymentsNet.giftcard || 0), 'gift cards: owed when sold, cleared when spent');
    assert.equal(acc(/^4672/), P.totals.tips, 'tips: owed to the team, never revenue');

    // the VAT of each month: the tickets' VAT, plus the deposits collected and not yet used (VAT on collection), which
    // the month that uses them takes back: over the two months every deposit is declared exactly once
    const v10 = vatReturn(x.s(), '2026-10', { today: '2026-11-09' }), v11 = vatReturn(x.s(), '2026-11', { today: '2026-11-09' });
    for (const v of [v10, v11]) {
      assert.equal(v.tax, v.ticketsVat.reduce((t, q) => t + q.tax, 0) + v.adjustments.deposits.tax);
      for (const row of v.rows) assert.ok(FR_RATES.includes(row.rate) || row.rate === 0);
    }
    assert.equal(v10.ticketsVat.reduce((t, q) => t + q.tax, 0), P.totals.vatNet.reduce((t, q) => t + q.tax, 0));
    // deposits paid on 31 October for 3 November: 2 × 18 € collected in October, 3 € of VAT each
    assert.equal(v10.adjustments.deposits.tax, 2 * vatSplit(1800, 2000).tax);
    assert.equal(v10.adjustments.deposits.tax + v11.adjustments.deposits.tax, 0, 'nothing is declared twice, nothing is lost');

    // the files as downloaded (owner's session): French Excel opens them, and they say the same
    await x.login();
    const csvZ = await x.download('/api/v1/export?kind=vat&from=2026-10-01&to=2026-10-31');
    assert.equal(csvZ.status, 200);
    assert.match(csvZ.headers.get('content-type'), /text\/csv; charset=utf-8/);
    const rows = parseCsv(csvZ.text);
    const head = rows[0], col = (name) => { const i = head.indexOf(name); assert.ok(i >= 0, 'column ' + name); return i; };
    assert.equal(rows.length - 1, octDays.length);
    const total = (name) => rows.slice(1).reduce((t, rw) => t + cents(rw[col(name)]), 0);
    assert.equal(total('CA TTC net'), P.totals.netTtc);
    assert.equal(total('CA HT net'), P.totals.htNet);
    assert.equal(total('TVA nette'), P.totals.netTtc - P.totals.htNet);
    assert.equal(total('TVA 20 %') + total('TVA 10 %') + total('TVA 5,5 %') + total('TVA 2,1 %'), total('TVA nette'));
    assert.equal(total('Total des règlements'), total('CA TTC net') + total('Pourboires') + total('Cartes cadeaux vendues'));
    assert.equal(total('Encaissé carte (TPE)') + total('Encaissé espèces') + total('Encaissé paiement en ligne') + total('Réglé par acompte en ligne') + total('Réglé par acompte de l’ancien site') + total('Réglé par carte cadeau'), total('Total des règlements'), 'the payment methods add up to the till total');
    assert.equal(total('dont carte, espèces, en ligne') + total('dont carte cadeau et acompte'), total('Total des règlements'));
    assert.equal(total('Encaissé espèces'), P.totals.paymentsNet.cash || 0);
    for (const rw of rows.slice(1)) assert.match(rw[col('Jour')], /^2026-10-\d\d$/);

    const csvSales = parseCsv((await x.download('/api/v1/export?kind=sales&from=2026-10-01&to=2026-10-31')).text);
    const net = csvSales[0].indexOf('Net TTC'), typ = csvSales[0].indexOf('Type');
    const soldRows = csvSales.slice(1).reduce((t, rw) => t + cents(rw[net]), 0);
    assert.equal(soldRows, P.totals.netTtc + P.totals.giftcardsSold, 'the detailed sales add up to the Z: revenue net of credit notes, plus the gift cards sold');
    assert.ok(csvSales.slice(1).every((rw) => ['service', 'product', 'giftcard', 'fee', 'pack'].includes(rw[typ]) || /^avoir/.test(rw[typ])));

    const fec = await x.download('/api/v1/compta/entries?month=2026-10&format=fec');
    assert.equal(fec.status, 200, fec.text.slice(0, 200));
    assert.equal(fec.headers.get('x-lx-period'), 'definitif');
    assert.notEqual(fec.text.charCodeAt(0), 0xfeff, 'the import file has no BOM');
    assert.equal(fec.text.split('\r\n')[0], FEC_FIELDS.join('|'));
    assert.equal(fec.text, fecText(L.entries));
    const ecr = await x.download('/api/v1/compta/entries?month=2026-10&format=csv');
    assert.equal(ecr.text, csvText(L.entries));
    const ecrRows = parseCsv(ecr.text);
    assert.equal(ecrRows.slice(1).reduce((t, rw) => t + cents(rw[11]) - cents(rw[12]), 0), 0, 'debits = credits');
    const tva = parseCsv((await x.download('/api/v1/compta/vat?month=2026-10&csv=1')).text);
    assert.match(tva[0][0], /à valider par ton comptable/);
    assert.equal(tva[1][2], 'définitif');
    assert.equal(cents(tva.find((rw) => rw[0] === 'Total')[2]), v10.tax);
    assert.ok(tva.some((rw) => rw[0] === '5,5'), 'a rate reads 5,5 and never 5.5 (a date in French Excel)');
    // November is not over: its file is refused in words, the provisional CSV is there
    const nov = await x.download('/api/v1/compta/entries?month=2026-11&format=fec');
    assert.equal(nov.status, 409);
    assert.match(nov.json.error.message, /Novembre n’est pas terminé/);
    assert.equal((await x.download('/api/v1/compta/entries?month=2026-11&format=csv&provisional=1')).headers.get('x-lx-period'), 'provisoire');
  });
}

test('the day of a ticket is the salon’s day in Paris: summer-time changes, month ends and the new year', async () => {
  const x = await fiscalSalon('2026-03-28');
  const cut = x.ids.services[0].id;
  // [instant in UTC, the salon's day, the hour the export prints]
  const CASES = [
    ['2026-03-28T22:59:30Z', '2026-03-28', '23:59'], // the last minute before the spring change day
    ['2026-03-28T23:00:30Z', '2026-03-29', '00:00'],
    ['2026-03-29T00:59:30Z', '2026-03-29', '01:59'], // 02:00 does not exist that night
    ['2026-03-29T01:00:30Z', '2026-03-29', '03:00'],
    ['2026-03-29T21:59:30Z', '2026-03-29', '23:59'], // a 23-hour day
    ['2026-03-29T22:00:30Z', '2026-03-30', '00:00'],
    ['2026-03-31T21:59:30Z', '2026-03-31', '23:59'], // month end in summer time (UTC+2)
    ['2026-03-31T22:00:30Z', '2026-04-01', '00:00'],
    ['2026-10-24T22:00:30Z', '2026-10-25', '00:00'], // the autumn change day
    ['2026-10-25T00:30:00Z', '2026-10-25', '02:30'], // 02:30, the first time
    ['2026-10-25T01:30:00Z', '2026-10-25', '02:30'], // 02:30 again, an hour later
    ['2026-10-25T22:59:30Z', '2026-10-25', '23:59'], // a 25-hour day
    ['2026-10-25T23:00:30Z', '2026-10-26', '00:00'],
    ['2026-10-31T22:59:30Z', '2026-10-31', '23:59'], // month end in winter time (UTC+1)
    ['2026-10-31T23:00:30Z', '2026-11-01', '00:00'],
    ['2026-12-31T22:59:30Z', '2026-12-31', '23:59'], // the year
    ['2026-12-31T23:00:30Z', '2027-01-01', '00:00']
  ];
  const made = [];
  for (const [iso, day, hour] of CASES) {
    x.clock.now = Date.parse(iso);
    assert.equal(localParts(x.clock.now).day, day);
    const r = await x.run(S.checkout, { lines: [{ kind: 'service', ref: cut, staffId: x.ids.staff[0] }], payments: [{ method: 'card', amount: 2000 }] });
    assert.equal(r.day, day, iso);
    made.push({ id: r.id, number: r.number, day, hour });
  }
  // each file holds exactly the tickets of its days, with the hour a clock on the salon's wall showed
  await x.login();
  const perDay = (d) => made.filter((m) => m.day === d);
  for (const [from, to] of [['2026-03-29', '2026-03-29'], ['2026-10-25', '2026-10-25'], ['2026-03-01', '2026-03-31'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'], ['2027-01-01', '2027-01-31']]) {
    const rows = parseCsv((await x.download('/api/v1/export?kind=sales&from=' + from + '&to=' + to)).text).slice(1);
    const want = made.filter((m) => m.day >= from && m.day <= to);
    assert.deepEqual(rows.map((rw) => [rw[0], rw[1], rw[2]]), want.map((m) => ['T' + String(m.number).padStart(6, '0'), m.day, m.hour]), from + ' → ' + to);
  }
  assert.equal(perDay('2026-03-29').length, 4);
  assert.equal(perDay('2026-10-25').length, 4);
  // the Z of each change day, caught up later, takes that day's tickets and no other; then the months close on them
  x.clock.now = Date.parse('2027-01-02T09:00:00Z');
  for (const d of [...new Set(made.map((m) => m.day))].filter((d) => d < '2027-01-02')) {
    const z = await x.run(S.closeDay, { day: d });
    assert.equal(z.tickets, perDay(d).length, d);
    assert.equal(z.netTtc, 2000 * perDay(d).length);
  }
  const months = { '2026-03': 7, '2026-04': 1, '2026-10': 6, '2026-11': 1, '2026-12': 1 };
  let n = 0;
  for (const m of ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
    const p = await x.run(closePeriod, { month: m });
    n += months[m] || 0;
    assert.equal(p.net, 2000 * (months[m] || 0), m);
    assert.equal(x.s().periodByKey.get('M:' + m).perpetual.net, 2000 * n, m + ' perpetual');
    if (m === '2026-12') { assert.ok(p.year, 'December closes the year'); assert.equal(x.s().periods.get(p.year.ref).totals.netTtc, 2000 * 16); }
    else assert.equal(p.year, null);
  }
});
