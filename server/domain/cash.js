// @ts-check
// Cash and daily totals, computed the same way for the drawer count, the Z closure and the reports.
import { DAYS_FR, dayParts, dayLong, diffDays } from '../../shared/dates.js';

/**
 * A credit note's money out, by method (one method, or card and cash in the proportion of the payment), each part
 * with its share of revenue: a cancelled gift card (liability) is a debt paid back, out of revenue and VAT.
 * @returns {{ method: string, amount: number, revenue: number }[]}
 */
export function refundParts(r) {
  const parts = r.parts && r.parts.length ? r.parts : [{ method: r.method, amount: r.amount }];
  const revenue = r.amount - (r.liability || 0);
  let rest = revenue;
  return parts.map((p, i) => {
    const v = i === parts.length - 1 ? rest : Math.round((p.amount * revenue) / (r.amount || 1));
    rest -= v;
    return { method: p.method, amount: p.amount, revenue: v };
  });
}

/** Cash the drawer should hold right now (or at closing). */
export function drawerExpected(s, drawer) {
  let cash = drawer.float;
  for (const m of drawer.moves || []) cash += m.amount;
  for (const x of s.sales.values()) {
    if (x.at < drawer.openedAt) continue;
    for (const p of x.payments) if (p.method === 'cash' && p.drawerId === drawer.id) cash += p.amount;
  }
  for (const r of s.refunds.values()) if (r.drawerId === drawer.id) for (const p of refundParts(r)) if (p.method === 'cash') cash -= p.amount;
  return cash;
}

/** Order in which payment methods are listed on the screen, the Z ticket and the CSV. */
export const METHODS = ['card', 'cash', 'online', 'deposit', 'giftcard'];
/** Settled without money coming in that day: a gift card bought earlier, a deposit paid at booking. */
export const PREPAID = new Set(['deposit', 'giftcard']);

/**
 * Everything that happened at the till on one day, in the Z layout (screen, print, CSV) and under the
 * older names a sealed Z keeps (revenue, net, byMethod…). See zFigures for the identities.
 */
export function dayTotals(s, day) {
  const sales = (s.salesByDay.get(day) || []).map((id) => s.sales.get(id)).filter(Boolean);
  const refunds = [...s.refunds.values()].filter((r) => r.day === day);
  /** @type {Record<string, number>} */
  const byMethod = {};
  /** @type {Map<number, { rate: number, base: number, tax: number }>} */
  const vat = new Map();
  let revenue = 0, revenueHT = 0, tips = 0, liability = 0, services = 0, products = 0;
  for (const x of sales) {
    revenue += x.totals.revenue; revenueHT += x.totals.revenueHT; tips += x.totals.tip; liability += x.totals.liability;
    for (const r of x.totals.vat) { const v = vat.get(r.rate) || { rate: r.rate, base: 0, tax: 0 }; v.base += r.base; v.tax += r.tax; vat.set(r.rate, v); }
    for (const p of x.payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    for (const l of x.lines) { if (l.kind === 'service') services += l.qty; if (l.kind === 'product') products += l.qty; }
  }
  let refunded = 0, liabilityRefunded = 0;
  /** @type {Record<string, number>} */
  const refundByMethod = {};
  /** @type {Record<string, number>} */
  const paymentsNet = { ...byMethod };
  for (const r of refunds) {
    // "Remboursements" is revenue given back; a cancelled gift card only leaves the payments and the cards sold
    refunded += r.amount - (r.liability || 0);
    liabilityRefunded += r.liability || 0;
    const sale = s.sales.get(r.saleId);
    for (const part of refundParts(r)) {
      if (part.revenue) refundByMethod[part.method] = (refundByMethod[part.method] || 0) + part.revenue;
      // an online refund goes back the way the money came: the online payment, or the deposit
      const m = part.method === 'online' && sale && !sale.payments.some((p) => p.method === 'online') && sale.payments.some((p) => p.method === 'deposit') ? 'deposit' : part.method;
      paymentsNet[m] = (paymentsNet[m] || 0) - part.amount;
    }
    for (const row of r.vat || []) { const v = vat.get(row.rate) || { rate: row.rate, base: 0, tax: 0 }; v.base -= row.base; v.tax -= row.tax; vat.set(row.rate, v); }
    revenueHT -= (r.vat || []).reduce((t, row) => t + row.base, 0);
  }
  const numbers = sales.map((x) => x.number).sort((a, b) => a - b);
  const record = {
    day, tickets: sales.length, first: numbers[0] || null, last: numbers[numbers.length - 1] || null,
    revenue, revenueHT, net: revenue - refunded, tips, liability, refunded, refunds: refunds.length, refundByMethod,
    byMethod, vat: [...vat.values()].sort((a, b) => b.rate - a.rate), services, products, paymentsNet, ...(liabilityRefunded ? { liabilityRefunded } : {})
  };
  return { ...record, ...zFigures(record), refundCount: refunds.length };
}

/**
 * What a Z event stores: the figures under the names Z events always had, plus paymentsNet (which cannot
 * be rebuilt later: an online refund may come off a deposit). The Z layout is derived on reading (zFigures),
 * so the sealed record holds each figure once.
 */
export function zRecord(t) {
  const { day, tickets, first, last, revenue, revenueHT, net, tips, liability, refunded, refunds, refundByMethod, byMethod, vat, services, products, paymentsNet, liabilityRefunded } = t;
  return { day, tickets, first, last, revenue, revenueHT, net, tips, liability, refunded, refunds, refundByMethod, byMethod, vat, services, products, paymentsNet, ...(liabilityRefunded ? { liabilityRefunded } : {}) };
}

/**
 * The Z layout for any closure, including those sealed before paymentsNet existed:
 * grossTtc − refundsTotal = netTtc = htNet + Σ vatNet.tax; paidTotal = Σ paymentsNet = netTtc + tips + giftcardsSold
 * (the cards sold net of those cancelled and paid back, giftcardsRefunded);
 * paidTotal = takings (card, cash, online) + prepaid (gift cards used, deposits): only takings is money in that day.
 */
export function zFigures(z) {
  const paymentsNet = z.paymentsNet || Object.fromEntries(Object.keys({ ...z.byMethod, ...z.refundByMethod }).map((m) => [m, ((z.byMethod || {})[m] || 0) - ((z.refundByMethod || {})[m] || 0)]));
  const sum = (keep) => Object.entries(paymentsNet).filter(([m]) => keep(m)).reduce((t, [, v]) => t + v, 0);
  return {
    grossTtc: z.revenue, refundsTotal: z.refunded, refundsByMethod: z.refundByMethod || {},
    netTtc: z.net, htNet: z.revenueHT, vatNet: z.vat || [], paymentsNet,
    paidTotal: sum(() => true), takings: sum((m) => !PREPAID.has(m)), prepaid: sum((m) => PREPAID.has(m)), tips: z.tips || 0,
    giftcardsSold: (z.liability || 0) - (z.liabilityRefunded || 0), giftcardsRefunded: z.liabilityRefunded || 0
  };
}

/**
 * Past days with till activity (tickets or refunds) and no Z, oldest first: those that can be closed now,
 * and those the open drawer still covers (a drawer is counted before its days are sealed).
 */
export function missedZ(s, today) {
  const days = new Set();
  for (const [d, ids] of s.salesByDay) if (ids.length) days.add(d);
  for (const r of s.refunds.values()) days.add(r.day);
  const due = [...days].filter((d) => d < today && !s.closures.has(d)).sort();
  const open = (d) => !!s.drawer && s.drawer.day <= d;
  return { close: due.filter((d) => !open(d)), uncounted: due.filter(open) };
}
/** "samedi" within the week, "samedi 3 octobre" further back. */
export function dayWords(day, today) { return diffDays(day, today) <= 6 ? DAYS_FR[dayParts(day).wd] : dayLong(day); }
/** Whether a day had anything at the till: a day with nothing has no Z to catch up. */
export const hadTill = (s, day) => !!(s.salesByDay.get(day) || []).length || [...s.refunds.values()].some((r) => r.day === day);

export const METHOD_LABEL = { card: 'Carte (TPE)', cash: 'Espèces', online: 'Paiement en ligne', giftcard: 'Carte cadeau', deposit: 'Acompte en ligne' };
export const ticketNo = (n) => 'T' + String(n).padStart(6, '0');
export const refundNo = (n) => 'A' + String(n).padStart(6, '0');
export const closureNo = (n) => 'Z' + String(n).padStart(4, '0');
