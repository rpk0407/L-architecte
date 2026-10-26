// @ts-check
// Cash and daily totals, computed the same way for the drawer count, the Z closure and the reports.

/** Cash the drawer should hold right now (or at closing). */
export function drawerExpected(s, drawer) {
  let cash = drawer.float;
  for (const m of drawer.moves || []) cash += m.amount;
  for (const x of s.sales.values()) {
    if (x.at < drawer.openedAt) continue;
    for (const p of x.payments) if (p.method === 'cash' && p.drawerId === drawer.id) cash += p.amount;
  }
  for (const r of s.refunds.values()) if (r.method === 'cash' && r.drawerId === drawer.id) cash -= r.amount;
  return cash;
}

/** Everything that happened at the till on one day. */
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
  let refunded = 0;
  /** @type {Record<string, number>} */
  const refundByMethod = {};
  for (const r of refunds) {
    refunded += r.amount;
    refundByMethod[r.method] = (refundByMethod[r.method] || 0) + r.amount;
    for (const row of r.vat || []) { const v = vat.get(row.rate) || { rate: row.rate, base: 0, tax: 0 }; v.base -= row.base; v.tax -= row.tax; vat.set(row.rate, v); }
    revenueHT -= (r.vat || []).reduce((t, row) => t + row.base, 0);
  }
  const numbers = sales.map((x) => x.number).sort((a, b) => a - b);
  return {
    day, tickets: sales.length, first: numbers[0] || null, last: numbers[numbers.length - 1] || null,
    revenue, revenueHT, net: revenue - refunded, tips, liability, refunded, refunds: refunds.length, refundByMethod,
    byMethod, vat: [...vat.values()].sort((a, b) => b.rate - a.rate), services, products
  };
}

export const METHOD_LABEL = { card: 'Carte (TPE)', cash: 'Espèces', online: 'Paiement en ligne', giftcard: 'Carte cadeau', deposit: 'Acompte en ligne' };
export const ticketNo = (n) => 'T' + String(n).padStart(6, '0');
export const refundNo = (n) => 'A' + String(n).padStart(6, '0');
export const closureNo = (n) => 'Z' + String(n).padStart(4, '0');
