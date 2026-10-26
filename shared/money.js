// @ts-check
// Money is always integer cents, prices are always TTC (VAT included), VAT rates are basis points (2000 = 20 %).
// The same ticket arithmetic runs in the till (live totals) and on the server (the figure that is recorded).

/**
 * @typedef {'service'|'product'|'giftcard'|'pack'|'fee'} LineKind
 * @typedef {{ kind: LineKind, ref?: string, name: string, qty: number, unit: number, discount?: number, staffId?: string, vat: number, packId?: string }} Line
 * @typedef {{ rate: number, base: number, tax: number }} VatRow
 * @typedef {{ gross: number, discount: number, total: number, tip: number, due: number, revenue: number, revenueHT: number, liability: number, vat: VatRow[], nets: number[] }} Totals
 */

/** Split a TTC amount into HT base and VAT. */
export function vatSplit(ttc, rateBp) {
  if (!rateBp) return { base: ttc, tax: 0 };
  const base = Math.round((ttc * 10000) / (10000 + rateBp));
  return { base, tax: ttc - base };
}

/** Lines that count as turnover. A gift card sold is a debt to the holder, not revenue (VAT is due when it is spent). */
export function isRevenue(kind) { return kind !== 'giftcard'; }

/**
 * Totals of a ticket. The ticket-level discount is spread over the revenue lines pro rata,
 * so each VAT rate is charged on what was really paid.
 * @param {Line[]} lines
 * @param {number} [discount] ticket-level discount in cents
 * @param {number} [tip] tip in cents, outside VAT and outside revenue
 * @returns {Totals}
 */
export function ticketTotals(lines, discount = 0, tip = 0) {
  const nets = lines.map((l) => Math.max(0, Math.round(l.unit * l.qty) - Math.round(l.discount || 0)));
  const idx = lines.map((l, i) => (isRevenue(l.kind) ? i : -1)).filter((i) => i >= 0 && nets[i] > 0);
  const base = idx.reduce((t, i) => t + nets[i], 0);
  const disc = Math.max(0, Math.min(Math.round(discount || 0), base));
  let left = disc;
  idx.forEach((i, k) => {
    const share = k === idx.length - 1 ? left : Math.round((disc * nets[i]) / base);
    nets[i] -= share;
    left -= share;
  });
  const gross = lines.reduce((t, l) => t + Math.round(l.unit * l.qty), 0);
  const lineDisc = lines.reduce((t, l) => t + Math.min(Math.round(l.unit * l.qty), Math.round(l.discount || 0)), 0);
  /** @type {Map<number, number>} */
  const byRate = new Map();
  let revenue = 0, liability = 0;
  lines.forEach((l, i) => {
    if (isRevenue(l.kind)) { revenue += nets[i]; byRate.set(l.vat || 0, (byRate.get(l.vat || 0) || 0) + nets[i]); }
    else liability += nets[i];
  });
  const vat = [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, ttc]) => ({ rate, ...vatSplit(ttc, rate) }));
  const total = revenue + liability;
  const t = Math.max(0, Math.round(tip || 0));
  return { gross, discount: lineDisc + disc, total, tip: t, due: total + t, revenue, revenueHT: vat.reduce((s, r) => s + r.base, 0), liability, vat, nets };
}

const NB = ' ', NNB = ' ';
/** 2000 → "20 €", 2050 → "20,50 €", 124050 → "1 240,50 €" */
export function fmtEur(cents, opts = {}) {
  const neg = cents < 0;
  const c = Math.abs(Math.round(cents));
  const e = Math.floor(c / 100), r = c % 100;
  const int = String(e).replace(/\B(?=(\d{3})+(?!\d))/g, NNB);
  const dec = r || opts.decimals ? ',' + String(r).padStart(2, '0') : '';
  return (neg ? '−' : '') + int + dec + NB + '€';
}

/** "20,50" / "20.5" / "20" → 2050. Returns null when not a number. */
export function parseEur(s) {
  const t = String(s ?? '').replace(/\s|€/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** Euro notes and coins, for counting the drawer. */
export const DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
