// @ts-check
// Read models computed from the projection: client stats, reports, commissions, goals.
// Results are cached per journal version, so a dashboard refresh costs nothing until something changes.
import { diffDays, dayRange, weekday, addDays, weekStart, monthStart, monthEnd, instantOf, localParts } from '../../shared/dates.js';
import { staffIntervals, shopIntervals } from './availability.js';
import { refundParts } from './cash.js';
import { payRulesOf } from '../settings/team.js';

/** @typedef {import('../core/state.js').State} State */

const cache = new WeakMap();
function memo(s, key, fn) {
  let c = cache.get(s);
  if (!c || c.version !== s.version) { c = { version: s.version, m: new Map() }; cache.set(s, c); }
  if (!c.m.has(key)) c.m.set(key, fn());
  return c.m.get(key);
}

function mode(counts) {
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}
function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

/**
 * Per-client figures: visits, rhythm, spend, absences, next appointment.
 * @param {State} s
 * @param {string} today
 */
export function clientStats(s, today, now) {
  return memo(s, 'clients|' + today, () => {
    /** @type {Map<string, any>} */
    const out = new Map();
    const get = (id) => {
      let x = out.get(id);
      if (!x) { x = { visits: 0, days: [], spend: 0, noShows: 0, cancels: 0, late: 0, svc: new Map(), staff: new Map(), next: null, firstDay: null, lastDay: null }; out.set(id, x); }
      return x;
    };
    for (const a of s.appts.values()) {
      if (!a.clientId) continue;
      const x = get(a.clientId);
      if (a.status === 'done') {
        x.visits++; x.days.push(a.day);
        // a visit from the old site has no ticket here: its price is what the client paid then
        if (a.legacy && !a.saleId) x.spend += a.price || 0;
        for (const sv of a.services) x.svc.set(sv.id, (x.svc.get(sv.id) || 0) + 1);
        x.staff.set(a.staffId, (x.staff.get(a.staffId) || 0) + 1);
      } else if (a.status === 'no_show') x.noShows++;
      else if (a.status === 'cancelled') { if (a.cancel && a.cancel.by === 'client') x.cancels++; }
      else if (a.day >= today && (!x.next || a.day < x.next.day || (a.day === x.next.day && a.start < x.next.start))) x.next = { id: a.id, day: a.day, start: a.start, staffId: a.staffId };
    }
    for (const sale of s.sales.values()) {
      if (!sale.clientId) continue;
      const x = get(sale.clientId);
      x.spend += sale.totals.revenue - sale.refunded;
      if (!sale.apptId && sale.lines.some((l) => l.kind === 'service')) { x.visits++; x.days.push(sale.day); }
    }
    for (const [id, x] of out) {
      x.days.sort();
      x.firstDay = x.days[0] || null;
      x.lastDay = x.days[x.days.length - 1] || null;
      const gaps = [];
      for (let i = Math.max(1, x.days.length - 6); i < x.days.length; i++) { const g = diffDays(x.days[i - 1], x.days[i]); if (g >= 5) gaps.push(g); }
      x.cadence = median(gaps);
      x.sinceLast = x.lastDay ? diffDays(x.lastDay, today) : null;
      x.avgTicket = x.visits ? Math.round(x.spend / x.visits) : 0;
      x.favService = mode(x.svc);
      x.favStaff = mode(x.staff);
      const rhythm = x.cadence || 28;
      x.dueIn = x.lastDay ? rhythm - /** @type {number} */ (x.sinceLast) : null;
      x.overdue = !x.next && x.sinceLast != null && x.sinceLast > rhythm + 3 && x.sinceLast < 180;
      x.risk = x.noShows >= 2 || (x.noShows >= 1 && x.visits < 3);
      // a regular: four cuts or more, coming back at a steady pace
      x.loyal = x.visits >= 6 || (x.visits >= 4 && !!x.cadence && x.cadence <= 35);
      x.isNew = x.visits <= 1;
      delete x.svc; delete x.staff; delete x.days;
      out.set(id, x);
    }
    return out;
  });
}

/** Capacity in minutes of every chair over a set of days. */
function capacity(s, days, staffIds) {
  let m = 0;
  for (const d of days) for (const id of staffIds) for (const [a, b] of staffIntervals(s, id, d)) m += b - a;
  return m;
}

/* ---------------- what a barber performed (TEAM-03) ----------------
 * Chiffre réalisé: the net of the service, product and fee lines he performed (never a gift card, a carnet or a month of
 * membership: money received for later), plus the value of the carnet and membership cuts he did, less his share of the
 * refunds, each on its own day. The shop's "Encaissé" (revenue, VAT, methods, Z) is the cash and legal figure and does not
 * move: `performed` and `gap` explain the difference. A management figure only, it never feeds the books. */

const htOf = (ttc, vat) => (vat ? Math.round((ttc * 10000) / (10000 + vat)) : ttc);

/**
 * What one cut taken on a carnet is worth to whoever cuts: the carnet's line on its ticket ÷ its cuts (80 € ÷ 5 = 16 €).
 * A carnet taken over from the old site has no ticket here: the catalogue carnet's price ÷ its cuts, flagged estimated.
 * @returns {{ value: number, estimated: boolean }}
 */
export function carnetCutValue(s, pk) {
  if (!pk) return { value: 0, estimated: true };
  const sale = pk.saleId ? s.sales.get(pk.saleId) : null;
  const line = sale ? sale.lines.find((l) => l.kind === 'pack' && l.packId === pk.id) : null;
  // a cancelled carnet keeps its cuts (total = used): the cuts it was sold with are the used plus those cancelled
  const credits = pk.voided ? pk.used + pk.voided.left : pk.total;
  if (line) return { value: Math.round(line.net / Math.max(1, credits)), estimated: false };
  const sv = pk.serviceId ? s.services.get(pk.serviceId) : null;
  if (sv && sv.pack && sv.pack.credits) return { value: Math.round(sv.price / sv.pack.credits), estimated: true };
  const cov = (pk.serviceIds || []).map((x) => s.services.get(x)).find(Boolean);
  return { value: cov ? cov.price : 0, estimated: true };
}

/**
 * What a ticket line credits to the person it names, under the salon's rules; null when it is nobody's (a gift card, a
 * month of membership, a carnet's sale under 'performer'). kind: the line's place in a barber's figures; cls: the rate
 * its commission takes (null: none, a fee); extra: what it adds to the money taken (a cut's value, a free loyalty cut).
 * @param {any} s @param {ReturnType<typeof payRulesOf>} rules @param {any} l
 */
function lineCredit(s, rules, l) {
  if (l.kind === 'giftcard' || l.kind === 'membership') return null;
  if (l.kind === 'pack') return rules.cutCredit === 'seller' ? { kind: 'pack', cls: 'service', value: l.net, extra: 0, estimated: false } : null;
  if (l.kind === 'product') return { kind: 'product', cls: 'product', value: l.net, extra: 0, estimated: false };
  if (l.kind === 'fee') return { kind: 'fee', cls: null, value: l.net, extra: 0, estimated: false };
  if (l.packId) {
    // 'seller': as before, the cut counts but is worth nothing to whoever does it
    const c = rules.cutCredit === 'seller' ? { value: 0, estimated: false } : carnetCutValue(s, s.packs.get(l.packId));
    const v = c.value * (l.qty || 1);
    return { kind: 'carnet', cls: 'service', value: l.net + v, extra: v, estimated: c.estimated && v > 0 };
  }
  if (l.memberId) {
    // PAY-02's credit is the month's price ÷ its cuts; 'list' the price on the card; 'zero' nothing
    const v = rules.memberCredit === 'zero' ? 0 : rules.memberCredit === 'list' ? l.listPrice ?? l.credit ?? 0 : l.credit ?? 0;
    return { kind: 'member', cls: 'service', value: l.net + v, extra: v, estimated: false };
  }
  // FID-02: a loyalty reward is a discount the salon gives, so the barber earns as if it were paid ('list')
  const reward = l.reward && rules.rewardCredit === 'list' ? Math.max(0, l.reward.amount || 0) : 0;
  return { kind: 'service', cls: 'service', value: l.net + reward, extra: reward, estimated: false, reward };
}

/**
 * A credit note line by line: { i, staffId, kind, vat, amount } for the ticket lines it gives back. With lines, each goes
 * to its line; without, it is spread over the ticket's lines pro rata of their net (largest remainder, so the parts add
 * up). A gift card paid back is a debt settled, never revenue: it is left out.
 * @param {any} s @param {any} refund
 */
export function refundShares(s, refund) {
  const sale = s.sales.get(refund.saleId);
  if (!sale) return [];
  const one = (i, amount) => { const l = sale.lines[i] || {}; return { i, staffId: l.staffId || null, kind: l.kind || 'fee', vat: l.vat || 0, amount }; };
  if (refund.lines && refund.lines.length) return refund.lines.filter((x) => x.kind !== 'giftcard' && x.amount > 0).map((x) => one(x.i, x.amount));
  const money = refund.amount - (refund.liability || 0);
  if (money <= 0) return [];
  // a carnet's value goes back only through its line (sales.js refundPlan): a refund without lines is the rest's
  let pool = sale.lines.map((l, i) => i).filter((i) => sale.lines[i].kind !== 'giftcard' && sale.lines[i].kind !== 'pack' && sale.lines[i].net > 0);
  if (!pool.length) pool = sale.lines.map((l, i) => i).filter((i) => sale.lines[i].kind !== 'giftcard' && sale.lines[i].net > 0);
  if (!pool.length) return [{ i: -1, staffId: null, kind: 'fee', vat: 0, amount: money }];
  const base = pool.reduce((t, i) => t + sale.lines[i].net, 0);
  const parts = pool.map((i) => { const exact = (money * sale.lines[i].net) / base; return { i, v: Math.floor(exact), r: exact - Math.floor(exact) }; });
  let left = money - parts.reduce((t, p) => t + p.v, 0);
  for (const p of [...parts].sort((a, b) => b.r - a.r || a.i - b.i)) { if (left <= 0) break; p.v++; left--; }
  return parts.filter((p) => p.v > 0).map((p) => one(p.i, p.v));
}

/**
 * Each barber's share of a credit note (staff id → cents), under the salon's rules: a carnet's line given back is its
 * seller's only when the carnet counts for whoever sells it ('seller'); otherwise it is prepaid money, nobody's.
 * @param {any} s @param {any} refund
 * @returns {Map<string, number>}
 */
export function refundByStaff(s, refund) {
  const rules = payRulesOf(s.settings);
  const sale = s.sales.get(refund.saleId);
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const sh of refundShares(s, refund)) {
    const l = sale && sale.lines[sh.i];
    if (!l || !sh.staffId || !lineCredit(s, rules, l)) continue;
    out.set(sh.staffId, (out.get(sh.staffId) || 0) + sh.amount);
  }
  return out;
}

const blankRow = (st) => ({
  id: st.id, name: st.name, color: st.color, chair: !!st.chair, revenue: 0, revenueHT: 0, serviceRevenue: 0, productRevenue: 0, services: 0,
  base: { service: { ttc: 0, ht: 0 }, product: { ttc: 0, ht: 0 } },
  paid: { services: { n: 0, net: 0 }, products: { n: 0, net: 0 }, fees: { n: 0, net: 0 }, packs: { n: 0, net: 0 } },
  cutsCarnet: { n: 0, value: 0, estimated: 0 }, cutsMember: { n: 0, value: 0 }, rewards: { n: 0, value: 0 },
  tips: 0, tipsCard: 0, tipsCash: 0, discounts: 0, refunds: 0, refundIds: new Set(), tickets: new Set(), clients: new Set(),
  done: 0, noShows: 0, booked: 0, minutes: 0, rebooked: 0, walkins: 0, walkinOverrides: 0, newClients: new Set(), newToMe: new Set(),
  pastMin: 0, capMin: 0, returned: { base: 0, back: 0, mine: 0 }, days: new Map()
});

/**
 * Every person's figures over a period, the shop's `performed` and the gap to Encaissé. Shared by the shop report and
 * every one-barber report (Mes chiffres, the agenda's day, the statement), so they always say the same number.
 * Memoised by (journal version, range, today) and, for a range that reaches today, the five minutes of `now` (the
 * capacity "up to now").
 * @param {State} s
 * @param {{ from: string, to: string, today: string, now: number }} q
 */
function teamRows(s, q) {
  const live = q.to >= q.today;
  return memo(s, 'team|' + q.from + '|' + q.to + '|' + q.today + '|' + (live ? Math.floor(q.now / 300000) : ''), () => {
    const rules = payRulesOf(s.settings);
    const days = dayRange(q.from, q.to);
    const inRange = (d) => d >= q.from && d <= q.to;
    /** @type {Map<string, any>} */
    const rows = new Map();
    for (const st of s.staff.values()) if (st.chair) rows.set(st.id, blankRow(st));
    const row = (id) => {
      if (!id) return null;
      let x = rows.get(id);
      if (!x) { const st = s.staff.get(id); if (!st) return null; x = blankRow(st); rows.set(id, x); }
      return x;
    };
    const dayOf = (x, d) => { let v = x.days.get(d); if (!v) { v = { day: d, revenue: 0, tickets: 0, tips: 0 }; x.days.set(d, v); } return v; };
    const gap = { prepaidSold: 0, prepaidUsed: 0, rewards: 0, unassigned: 0 };
    // discounts are counted on the rows the figures already have: ringing up alone (the desk) makes no row
    /** @type {Map<string, number>} */
    const discounts = new Map();
    for (const d of days) for (const sid of s.salesByDay.get(d) || []) {
      const x = s.sales.get(sid);
      if (!x) continue;
      const seen = new Set();
      for (const l of x.lines) {
        const c = lineCredit(s, rules, l);
        const st = c ? row(l.staffId) : null;
        if (!c || !st) {
          // nobody's: a carnet or a month sold is prepaid money; anything else rung up without a barber stays the salon's
          if (l.kind === 'giftcard') continue;
          if (l.kind === 'pack' || l.kind === 'membership') gap.prepaidSold += l.net; else gap.unassigned += l.net;
          continue;
        }
        const h = htOf(c.value, l.vat || 0);
        st.revenue += c.value; st.revenueHT += h;
        if (c.cls) { st.base[c.cls].ttc += c.value; st.base[c.cls].ht += h; }
        if (c.kind === 'service' || c.kind === 'carnet' || c.kind === 'member' || c.kind === 'pack') st.services += l.qty;
        if (c.kind === 'carnet') { st.cutsCarnet.n += l.qty; st.cutsCarnet.value += c.extra; if (c.estimated) st.cutsCarnet.estimated += c.extra; gap.prepaidUsed += c.extra; }
        else if (c.kind === 'member') { st.cutsMember.n += l.qty; st.cutsMember.value += c.extra; gap.prepaidUsed += c.extra; }
        else if (c.kind === 'pack') { st.paid.packs.n += l.qty; st.paid.packs.net += l.net; }
        else { const k = c.kind === 'service' ? 'services' : c.kind === 'product' ? 'products' : 'fees'; st.paid[k].n += l.qty; st.paid[k].net += l.net; }
        if (c.reward) { st.rewards.n++; st.rewards.value += c.reward; gap.rewards += c.reward; }
        dayOf(st, d).revenue += c.value;
        st.tickets.add(x.id); if (x.clientId) st.clients.add(x.clientId);
        if (!seen.has(st.id)) { seen.add(st.id); dayOf(st, d).tickets++; }
      }
      if (x.tip && x.tip.amount) {
        const st = row(x.tip.staffId);
        if (st) {
          // the tip leaves the way the ticket was paid: its cash share in cash (an estimate; the rest by card or online)
          const paid = x.payments.reduce((t, p) => t + p.amount, 0);
          const cash = paid ? Math.round((x.tip.amount * x.payments.filter((p) => p.method === 'cash').reduce((t, p) => t + p.amount, 0)) / paid) : 0;
          st.tips += x.tip.amount; st.tipsCash += cash; st.tipsCard += x.tip.amount - cash;
          dayOf(st, d).tips += x.tip.amount;
          if (!seen.has(st.id)) { seen.add(st.id); dayOf(st, d).tickets++; st.tickets.add(x.id); }
        }
      }
      // what the cashier gave: line and ticket discounts, a loyalty reward (validated by the system) left out
      const given = (x.totals.discount || 0) - x.lines.reduce((t, l) => t + (l.reward ? l.reward.amount || 0 : 0), 0);
      if (given > 0 && x.cashierId) discounts.set(x.cashierId, (discounts.get(x.cashierId) || 0) + given);
    }
    for (const r of s.refunds.values()) {
      if (!inRange(r.day)) continue;
      const sale = s.sales.get(r.saleId);
      for (const sh of refundShares(s, r)) {
        const l = sale && sale.lines[sh.i];
        const c = l ? lineCredit(s, rules, l) : null;
        const st = c ? row(l.staffId) : null;
        if (!c || !st) { if (sh.kind === 'pack' || sh.kind === 'membership') gap.prepaidSold -= sh.amount; else gap.unassigned -= sh.amount; continue; }
        const h = htOf(sh.amount, sh.vat);
        st.revenue -= sh.amount; st.revenueHT -= h; st.refunds += sh.amount; st.refundIds.add(r.id);
        if (c.cls) { st.base[c.cls].ttc -= sh.amount; st.base[c.cls].ht -= h; }
        dayOf(st, r.day).revenue -= sh.amount;
      }
    }

    for (const [id, v] of discounts) { const st = rows.get(id); if (st) st.discounts += v; }
    // appointments: visits, absences, walk-ins, first visits, the chair's time
    /** @type {Map<string, any[]>} */
    const byClient = new Map();
    for (const b of s.appts.values()) { if (!b.clientId || b.status !== 'done') continue; let l = byClient.get(b.clientId); if (!l) { l = []; byClient.set(b.clientId, l); } l.push(b); }
    const stats = clientStats(s, q.today, q.now);
    const nowMin = localParts(Number.isFinite(q.now) ? q.now : instantOf(q.today, 1439)).min;
    // minutes of [start, end) already past: a day before today all of it, today up to now
    const past = (d, a, b) => (d < q.today ? b - a : d === q.today ? Math.max(0, Math.min(b, nowMin) - a) : 0);
    for (const d of days) for (const aid of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(aid);
      // history taken over from the old site took no chair time here: it stays out of the team's figures
      if (!a || a.legacy || a.status === 'cancelled') continue;
      const st = row(a.staffId);
      if (!st) continue;
      if (a.status === 'no_show') { st.noShows++; continue; }
      st.booked++; st.minutes += a.dur; st.pastMin += past(d, a.start, a.start + a.dur);
      if (a.status !== 'done') continue;
      st.done++;
      if (a.source === 'walkin') { st.walkins++; if (a.override) st.walkinOverrides++; }
      // rebooked: the same client booked again within 15 minutes of this visit's checkout
      const sale = a.saleId ? s.sales.get(a.saleId) : null;
      if (sale && a.clientId && rebookedAt(s, a, sale)) st.rebooked++;
      if (!a.clientId) continue;
      const cs = stats.get(a.clientId);
      const before = (byClient.get(a.clientId) || []).filter((b) => b.id !== a.id && (b.day < a.day || (b.day === a.day && b.start < a.start)));
      if (cs && cs.firstDay === a.day && !before.length) st.newClients.add(a.clientId);
      else if (before.length && !before.some((b) => b.staffId === a.staffId)) st.newToMe.add(a.clientId);
    }
    // came back within 60 days: his done visits 60 to 150 days before the end of the period (or today)
    const ref = q.to < q.today ? q.to : q.today;
    for (const d of dayRange(addDays(ref, -150), addDays(ref, -60))) for (const aid of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(aid);
      // a visit taken over from the old site was not his here: it stays out, as in every team figure
      if (!a || a.legacy || a.status !== 'done' || !a.clientId) continue;
      const st = rows.get(a.staffId);
      if (!st) continue;
      const later = (byClient.get(a.clientId) || []).filter((b) => b.day > a.day && b.day <= addDays(a.day, 60));
      st.returned.base++;
      if (later.length) st.returned.back++;
      if (later.some((b) => b.staffId === a.staffId)) st.returned.mine++;
    }
    const out = [];
    for (const x of rows.values()) {
      const st = s.staff.get(x.id);
      let cap = 0, pastCap = 0;
      if (st && st.chair) for (const d of days) for (const [a, b] of staffIntervals(s, x.id, d)) { cap += b - a; pastCap += past(d, a, b); }
      // someone with no chair shows only when something is his (a carnet sold under 'seller', a tip, a refund)
      if (!x.chair && !x.revenue && !x.tips && !x.refunds && !x.tickets.size) continue;
      const com = st && st.commission ? st.commission : { service: 0, product: 0 };
      const b = rules.base === 'ht' ? 'ht' : 'ttc';
      out.push({
        id: x.id, name: x.name, color: x.color, chair: x.chair, revenue: x.revenue, revenueHT: x.revenueHT,
        serviceRevenue: x.base.service.ttc, productRevenue: x.base.product.ttc, services: x.services,
        tips: x.tips, tipsCard: x.tipsCard, tipsCash: x.tipsCash, tickets: x.tickets.size, clients: x.clients.size, avgTicket: x.tickets.size ? Math.round(x.revenue / x.tickets.size) : 0,
        done: x.done, noShows: x.noShows, occupancy: cap ? Math.min(1, x.minutes / cap) : 0, rebookRate: x.done ? x.rebooked / x.done : 0,
        commission: Math.round((x.base.service[b] * com.service) / 10000 + (x.base.product[b] * com.product) / 10000), rates: com, base: rules.base,
        walkins: x.walkins, walkinOverrides: x.walkinOverrides, newClients: x.newClients.size, newToMe: x.newToMe.size, discounts: x.discounts,
        refunds: x.refunds, refundCount: x.refundIds.size, cutsCarnet: x.cutsCarnet, cutsMember: x.cutsMember, rewards: x.rewards, paid: x.paid,
        capMin: pastCap, idleMin: Math.max(0, pastCap - x.pastMin), perHour: pastCap ? Math.round((x.revenue * 60) / pastCap) : 0,
        returned60: x.returned.base ? x.returned.back / x.returned.base : 0, returned60Mine: x.returned.base ? x.returned.mine / x.returned.base : 0, returned60Base: x.returned.base,
        days: x.days
      });
    }
    out.sort((a, b) => b.revenue - a.revenue);
    return { rows: out, gap, performed: out.reduce((t, x) => t + x.revenue, 0), rules };
  });
}

/** Booked again within 15 minutes of this visit's checkout (one index per journal version). */
function rebookedAt(s, a, sale) {
  const list = memo(s, 'createdByClient', () => {
    /** @type {Map<string, any[]>} */
    const m = new Map();
    for (const b of s.appts.values()) { if (!b.clientId) continue; let l = m.get(b.clientId); if (!l) { l = []; m.set(b.clientId, l); } l.push(b); }
    return m;
  }).get(a.clientId) || [];
  return list.some((b) => b.id !== a.id && b.createdAt >= sale.at - 60000 && b.createdAt <= sale.at + 15 * 60000 && b.day > a.day);
}

/**
 * Report for a period. `staffId` limits it to one person (a barber's own figures): its totals are then his Chiffre
 * réalisé (teamRows), not the money taken.
 * @param {State} s
 * @param {{ from: string, to: string, staffId?: string|null, today: string, now: number }} q
 */
export function report(s, q) {
  return memo(s, 'report|' + q.from + '|' + q.to + '|' + (q.staffId || '') + '|' + q.today + '|' + (q.to >= q.today ? Math.floor(q.now / 300000) : ''), () => {
    const days = dayRange(q.from, q.to);
    const inRange = (d) => d >= q.from && d <= q.to;
    const one = q.staffId || null;
    const team = teamRows(s, q);
    const mine = one ? team.rows.find((x) => x.id === one) || null : null;
    /** @type {Map<string, any>} */
    const byDay = new Map(days.map((d) => [d, { day: d, revenue: 0, tickets: 0, clients: 0, tips: 0 }]));
    const byService = new Map(), byCategory = new Map(), byProduct = new Map();
    /** @type {Record<string, number>} */
    const methods = {};
    let revenue = 0, revenueHT = 0, vatTax = 0, tips = 0, tickets = 0, refunds = 0, liability = 0, productRevenue = 0;
    const clients = new Set();
    for (const d of days) for (const sid of s.salesByDay.get(d) || []) {
      const x = s.sales.get(sid);
      if (!x) continue;
      const lines = one ? x.lines.filter((l) => l.staffId === one) : x.lines;
      if (one && !lines.length && !(x.tip && x.tip.staffId === one)) continue;
      liability += lines.filter((l) => l.kind === 'giftcard').reduce((t, l) => t + l.net, 0);
      if (x.clientId) clients.add(x.clientId);
      if (!one) {
        revenue += x.totals.revenue; tips += x.totals.tip; tickets++;
        revenueHT += x.totals.revenueHT; vatTax += x.totals.vat.reduce((t, r) => t + r.tax, 0);
        const bd = byDay.get(d); bd.revenue += x.totals.revenue; bd.tickets++; bd.tips += x.totals.tip;
        for (const p of x.payments) methods[p.method] = (methods[p.method] || 0) + p.amount;
      }
      for (const l of lines) {
        if (l.kind === 'service' || l.kind === 'pack') {
          const k = l.ref; const sv = s.services.get(k);
          const e = byService.get(k) || { id: k, name: sv ? sv.name : l.name, count: 0, revenue: 0 };
          e.count += l.qty; e.revenue += l.net; byService.set(k, e);
          const cat = (sv && sv.category) || l.category || 'Autre';
          byCategory.set(cat, (byCategory.get(cat) || 0) + l.net);
        } else if (l.kind === 'product') {
          const e = byProduct.get(l.ref) || { id: l.ref, name: l.name, count: 0, revenue: 0, margin: 0 };
          e.count += l.qty; e.revenue += l.net; e.margin += l.net - (l.cost || 0) * l.qty; byProduct.set(l.ref, e);
          if (!one) productRevenue += l.net;
        }
        // a membership's month (PAY-02): the salon's, no barber's row
        else if (l.kind === 'membership') byCategory.set('Abonnements', (byCategory.get('Abonnements') || 0) + l.net);
      }
    }
    if (one) {
      // one person: what he performed, refunds deducted on their own day, cut values in (teamRows)
      const m = mine;
      revenue = m ? m.revenue : 0; revenueHT = m ? m.revenueHT : 0; vatTax = revenue - revenueHT; tips = m ? m.tips : 0;
      tickets = m ? m.tickets : 0; refunds = m ? m.refunds : 0; productRevenue = m ? m.productRevenue : 0;
      if (m) for (const v of m.days.values()) { const bd = byDay.get(v.day); if (bd) { bd.revenue += v.revenue; bd.tickets += v.tickets; bd.tips += v.tips; } }
    } else {
      for (const r of s.refunds.values()) {
        if (!inRange(r.day)) continue;
        // a cancelled gift card paid back (liability) never was revenue: only the rest comes off, by method as the Z does
        const back = r.amount - (r.liability || 0);
        refunds += back; revenue -= back;
        const bd = byDay.get(r.day); if (bd) bd.revenue -= back;
        for (const row of r.vat || []) { revenueHT -= row.base; vatTax -= row.tax; }
        for (const p of refundParts(r)) if (p.revenue) methods['refund_' + p.method] = (methods['refund_' + p.method] || 0) + p.revenue;
      }
    }
    // appointments: sources, absences, occupancy
    const sources = { site: 0, phone: 0, walkin: 0, salon: 0 };
    let done = 0, noShows = 0, cancelled = 0, lateCancels = 0, bookedMin = 0, newClients = 0;
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const d of days) for (const aid of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(aid);
      // history taken over from the old site took no chair time here: it stays out of occupancy and the team's figures
      if (!a || a.legacy || (one && a.staffId !== one)) continue;
      if (a.status === 'cancelled') { cancelled++; if (a.cancel && a.cancel.by === 'client') lateCancels++; continue; }
      // upcoming bookings taken over from the old site were booked online there
      const src = a.source === 'import' ? 'site' : a.source;
      sources[src] = (sources[src] || 0) + 1;
      if (a.status === 'no_show') { noShows++; continue; }
      bookedMin += a.dur;
      if (a.status === 'done') done++;
      const wd = weekday(d);
      for (let m = a.start; m < a.start + a.dur; m += 30) { const h = Math.floor(m / 60); if (h < 24) heat[wd][h] += 30; }
    }
    if (one) newClients = mine ? mine.newClients : 0;
    else { const stats = clientStats(s, q.today, q.now); for (const c of clients) { const st = stats.get(c); if (st && st.firstDay && inRange(st.firstDay)) newClients++; } }
    const ids = one ? [one] : [...s.staff.values()].filter((x) => x.chair && x.active).map((x) => x.id);
    const cap = capacity(s, days, ids);
    // heatmap as occupancy ratio: booked minutes / chairs open in that hour
    const heatCap = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const d of days) {
      const wd = weekday(d);
      for (const id of ids) for (const [a, b] of staffIntervals(s, id, d)) for (let m = a; m < b; m += 30) { const h = Math.floor(m / 60); heatCap[wd][h] += 30; }
    }
    const heatmap = heat.map((row, wd) => row.map((v, h) => (heatCap[wd][h] ? Math.min(1, v / heatCap[wd][h]) : null)));
    const staffRows = team.rows.filter((x) => (one ? x.id === one : true)).map(({ days: _d, ...x }) => x);
    return {
      from: q.from, to: q.to, days: days.length,
      revenue, revenueHT, vat: vatTax, tips, tickets, avgTicket: tickets ? Math.round(revenue / tickets) : 0, refunds, liability, productRevenue,
      clients: clients.size, newClients, done, noShows, cancelled, lateCancels,
      noShowRate: done + noShows ? noShows / (done + noShows) : 0,
      occupancy: cap ? Math.min(1, bookedMin / cap) : 0,
      series: [...byDay.values()], staff: staffRows,
      services: [...byService.values()].sort((a, b) => b.revenue - a.revenue),
      categories: [...byCategory.entries()].map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue),
      products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
      methods, sources, heatmap,
      // the shop: what the team performed against what came in, and why they differ
      ...(one ? {} : { performed: team.performed, gap: { ...team.gap } })
    };
  });
}

/* ---------------- goals (TEAM-03) ---------------- */

/**
 * Each active chair's share of the month's open chair minutes (staff id → 0..1), for the automatic goals.
 * @param {State} s @param {string} day any day of the month
 */
export function goalShares(s, day) {
  return memo(s, 'shares|' + day.slice(0, 7), () => {
    const md = dayRange(monthStart(day), monthEnd(day));
    const ids = [...s.staff.values()].filter((x) => x.chair && x.active).map((x) => x.id);
    const caps = new Map(ids.map((id) => [id, capacity(s, md, [id])]));
    const all = [...caps.values()].reduce((t, v) => t + v, 0);
    return new Map(ids.map((id) => [id, all ? /** @type {number} */ (caps.get(id)) / all : 0]));
  });
}
/** The automatic goal: the salon's target × his share of the chair minutes, rounded to 10 €. */
export const autoGoal = (monthCents, share) => Math.round((monthCents * share) / 1000) * 1000;

/**
 * Where a month's goal stands on a day: the salon's (staffId null, measured on Encaissé) or a barber's (typed in
 * Objectifs, or automatic; measured on his Chiffre réalisé). perDay: what is left ÷ the open days left, today included
 * (its takings are already in done), rounded up to the euro. week: the week of that day within the month, its target
 * pro rata of the chair minutes. `now` (optional) is the instant the figures stop at; the end of `day` by default.
 * @param {State} s @param {string|null} staffId @param {string} day @param {number} [now]
 */
export function goalOf(s, staffId, day, now = instantOf(day, 1439)) {
  const G = /** @type {any} */ (s.settings.goals || {});
  const ms = monthStart(day), me = monthEnd(day);
  const typed = staffId && G.staff && typeof G.staff[staffId] === 'number' ? G.staff[staffId] : null;
  const target = !staffId ? G.monthCents || 0 : typed != null ? typed : autoGoal(G.monthCents || 0, goalShares(s, day).get(staffId) || 0);
  const q = (from) => ({ from, to: day, staffId, today: day, now });
  const doneOf = (from) => (staffId ? (teamRows(s, q(from)).rows.find((x) => x.id === staffId) || { revenue: 0 }).revenue : report(s, q(from)).revenue);
  const done = doneOf(ms);
  const open = (d) => (staffId ? staffIntervals(s, staffId, d) : shopIntervals(s, d)).length > 0;
  const openDaysLeft = dayRange(day, me).filter(open).length;
  const left = Math.max(0, target - done);
  const ws = weekStart(day) < ms ? ms : weekStart(day);
  const we = addDays(weekStart(day), 6) > me ? me : addDays(weekStart(day), 6);
  const ids = staffId ? [staffId] : [...s.staff.values()].filter((x) => x.chair && x.active).map((x) => x.id);
  const monthCap = capacity(s, dayRange(ms, me), ids);
  const weekCap = capacity(s, dayRange(ws, we), ids);
  return {
    staffId, month: day.slice(0, 7), target, auto: !!staffId && typed == null, done, pct: target ? done / target : 0,
    perDay: openDaysLeft ? Math.ceil(left / openDaysLeft / 100) * 100 : 0, openDaysLeft,
    week: { from: ws, to: we, target: monthCap ? Math.round((target * weekCap) / monthCap / 100) * 100 : 0, done: doneOf(ws) }
  };
}

/** The same period just before, for "+12 % vs la semaine dernière". */
export function previousPeriod(from, to) {
  const n = diffDays(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Open days in a range (for averages per opening day). */
export function openDays(s, from, to) { return dayRange(from, to).filter((d) => shopIntervals(s, d).length).length; }
