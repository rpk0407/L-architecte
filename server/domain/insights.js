// @ts-check
// Read models computed from the projection: client stats, reports, commissions.
// Results are cached per journal version, so a dashboard refresh costs nothing until something changes.
import { diffDays, dayRange, weekday, addDays } from '../../shared/dates.js';
import { staffIntervals, shopIntervals } from './availability.js';

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

/**
 * Report for a period. `staffId` limits it to one chair (a barber's own figures).
 * @param {State} s
 * @param {{ from: string, to: string, staffId?: string|null, today: string, now: number }} q
 */
export function report(s, q) {
  return memo(s, 'report|' + q.from + '|' + q.to + '|' + (q.staffId || '') + '|' + q.today, () => {
    const days = dayRange(q.from, q.to);
    const inRange = (d) => d >= q.from && d <= q.to;
    const one = q.staffId || null;
    const staff = [...s.staff.values()].filter((x) => x.chair);
    /** @type {Map<string, any>} */
    const byDay = new Map(days.map((d) => [d, { day: d, revenue: 0, tickets: 0, clients: 0, tips: 0 }]));
    /** @type {Map<string, any>} */
    const byStaff = new Map(staff.map((x) => [x.id, { id: x.id, name: x.name, color: x.color, revenue: 0, services: 0, serviceRevenue: 0, productRevenue: 0, tips: 0, tickets: new Set(), clients: new Set(), done: 0, noShows: 0, booked: 0, minutes: 0, rebooked: 0 }]));
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
      const rev = lines.filter((l) => l.kind !== 'giftcard').reduce((t, l) => t + l.net, 0);
      const ratio = x.totals.revenue ? rev / x.totals.revenue : 0;
      const tip = x.tip && (!one || x.tip.staffId === one) ? x.tip.amount : 0;
      revenue += rev; tips += tip; tickets++;
      revenueHT += Math.round(x.totals.revenueHT * ratio);
      vatTax += Math.round(x.totals.vat.reduce((t, r) => t + r.tax, 0) * ratio);
      liability += lines.filter((l) => l.kind === 'giftcard').reduce((t, l) => t + l.net, 0);
      if (x.clientId) clients.add(x.clientId);
      const bd = byDay.get(d); bd.revenue += rev; bd.tickets++; bd.tips += tip;
      if (!one) for (const p of x.payments) methods[p.method] = (methods[p.method] || 0) + p.amount;
      for (const l of lines) {
        const st = byStaff.get(l.staffId);
        if (l.kind === 'service' || l.kind === 'pack') {
          const k = l.ref; const sv = s.services.get(k);
          const e = byService.get(k) || { id: k, name: sv ? sv.name : l.name, count: 0, revenue: 0 };
          e.count += l.qty; e.revenue += l.net; byService.set(k, e);
          const cat = (sv && sv.category) || l.category || 'Autre';
          byCategory.set(cat, (byCategory.get(cat) || 0) + l.net);
          if (st) { st.services += l.qty; st.serviceRevenue += l.net; st.revenue += l.net; }
        } else if (l.kind === 'product') {
          const e = byProduct.get(l.ref) || { id: l.ref, name: l.name, count: 0, revenue: 0, margin: 0 };
          e.count += l.qty; e.revenue += l.net; e.margin += l.net - (l.cost || 0) * l.qty; byProduct.set(l.ref, e);
          productRevenue += l.net;
          if (st) { st.productRevenue += l.net; st.revenue += l.net; }
        } else if (l.kind === 'fee' && st) st.revenue += l.net;
        if (st) { st.tickets.add(x.id); if (x.clientId) st.clients.add(x.clientId); }
      }
      if (x.tip) { const st = byStaff.get(x.tip.staffId); if (st && (!one || x.tip.staffId === one)) st.tips += x.tip.amount; }
    }
    for (const r of s.refunds.values()) {
      if (!inRange(r.day) || one) continue;
      refunds += r.amount; revenue -= r.amount;
      const bd = byDay.get(r.day); if (bd) bd.revenue -= r.amount;
      for (const row of r.vat || []) { revenueHT -= row.base; vatTax -= row.tax; }
      methods['refund_' + r.method] = (methods['refund_' + r.method] || 0) + r.amount;
    }
    // appointments: sources, absences, occupancy, rebooking
    const sources = { site: 0, phone: 0, walkin: 0, salon: 0 };
    let done = 0, noShows = 0, cancelled = 0, lateCancels = 0, bookedMin = 0, newClients = 0;
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    /** @type {Map<string, any[]>} */
    const byClient = new Map();
    for (const b of s.appts.values()) { if (!b.clientId) continue; let l = byClient.get(b.clientId); if (!l) { l = []; byClient.set(b.clientId, l); } l.push(b); }
    for (const d of days) for (const aid of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(aid);
      // history taken over from the old site took no chair time here: it stays out of occupancy and the team's figures
      if (!a || a.legacy || (one && a.staffId !== one)) continue;
      if (a.status === 'cancelled') { cancelled++; if (a.cancel && a.cancel.by === 'client') lateCancels++; continue; }
      // upcoming bookings taken over from the old site were booked online there
      const src = a.source === 'import' ? 'site' : a.source;
      sources[src] = (sources[src] || 0) + 1;
      if (a.status === 'no_show') { noShows++; const st = byStaff.get(a.staffId); if (st) st.noShows++; continue; }
      bookedMin += a.dur;
      const st = byStaff.get(a.staffId);
      if (st) { st.booked++; st.minutes += a.dur; }
      if (a.status === 'done') {
        done++; if (st) st.done++;
        // rebooked: the same client booked again within 15 minutes of this visit's checkout
        const sale = a.saleId ? s.sales.get(a.saleId) : null;
        if (sale && a.clientId) {
          const again = (byClient.get(a.clientId) || []).some((b) => b.clientId === a.clientId && b.id !== a.id && b.createdAt >= sale.at - 60000 && b.createdAt <= sale.at + 15 * 60000 && b.day > a.day);
          if (again && st) st.rebooked++;
        }
      }
      const wd = weekday(d);
      for (let m = a.start; m < a.start + a.dur; m += 30) { const h = Math.floor(m / 60); if (h < 24) heat[wd][h] += 30; }
    }
    const stats = clientStats(s, q.today, q.now);
    for (const c of clients) { const st = stats.get(c); if (st && st.firstDay && inRange(st.firstDay)) newClients++; }
    const ids = one ? [one] : staff.filter((x) => x.active).map((x) => x.id);
    const cap = capacity(s, days, ids);
    // heatmap as occupancy ratio: booked minutes / chairs open in that hour
    const heatCap = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const d of days) {
      const wd = weekday(d);
      for (const id of ids) for (const [a, b] of staffIntervals(s, id, d)) for (let m = a; m < b; m += 30) { const h = Math.floor(m / 60); heatCap[wd][h] += 30; }
    }
    const heatmap = heat.map((row, wd) => row.map((v, h) => (heatCap[wd][h] ? Math.min(1, v / heatCap[wd][h]) : null)));
    const staffRows = [...byStaff.values()].filter((x) => !one || x.id === one).map((x) => {
      const st = s.staff.get(x.id);
      const com = st && st.commission ? st.commission : { service: 0, product: 0 };
      const capMin = capacity(s, days, [x.id]);
      return {
        id: x.id, name: x.name, color: x.color, revenue: x.revenue, serviceRevenue: x.serviceRevenue, productRevenue: x.productRevenue,
        services: x.services, tips: x.tips, tickets: x.tickets.size, clients: x.clients.size, avgTicket: x.tickets.size ? Math.round(x.revenue / x.tickets.size) : 0,
        done: x.done, noShows: x.noShows, occupancy: capMin ? Math.min(1, x.minutes / capMin) : 0, rebookRate: x.done ? x.rebooked / x.done : 0,
        commission: Math.round((x.serviceRevenue * com.service) / 10000 + (x.productRevenue * com.product) / 10000), rates: com
      };
    }).sort((a, b) => b.revenue - a.revenue);
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
      methods, sources, heatmap
    };
  });
}

/** The same period just before, for "+12 % vs la semaine dernière". */
export function previousPeriod(from, to) {
  const n = diffDays(from, to) + 1;
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

/** Open days in a range (for averages per opening day). */
export function openDays(s, from, to) { return dayRange(from, to).filter((d) => shopIntervals(s, d).length).length; }
