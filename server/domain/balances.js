// @ts-check
// Month-end figures the accountant asks for (CPT-03), read off the state without replaying the journal:
//   giftcardRoll   what the gift cards owe, rolled forward over a period (issued, used, cancelled, expired)
//   packsAt        the cuts still owed on carnets, valued at what was paid per cut (TTC, and HT: the deferred revenue the
//                  accountant may book at year end, Débit 706200 / Crédit 487); nothing is posted automatically
//   depositsHeld   money paid online and not yet used or given back (419100)
//   stripeBalance  what is still at Stripe (467100), from the ledger
// No import of the engine or the state here.
import { localParts } from '../../shared/dates.js';
import { vatSplit } from '../../shared/money.js';
import { ledger, comptaOf, accountOf, refundsOf } from './ledger.js';

const dayOf = (ms) => localParts(ms).day;
const saleDay = (s, id) => (id && s.sales.get(id) ? s.sales.get(id).day : null);

/**
 * One card's movements, each on the salon's day it happened: issued (or imported from the old site, or carried over
 * from the card it replaced), each use, its cancellation (or its balance moved to a new card), its expiry. The amounts
 * add up to the card's balance at any day's end.
 * @returns {{ day: string, kind: string, amount: number }[]} kind: issued, imported, transferIn, redeemed, cancelled, transferOut, expired
 */
function cardMoves(s, g) {
  const out = [];
  const issueDay = saleDay(s, g.saleId) || dayOf(g.issuedAt);
  out.push({ day: issueDay, kind: g.reissueOf ? 'transferIn' : g.legacy ? 'imported' : 'issued', amount: g.amount });
  let left = g.amount;
  for (const u of g.uses || []) { out.push({ day: saleDay(s, u.saleId) || dayOf(u.at), kind: 'redeemed', amount: -u.amount }); left -= u.amount; }
  if (g.status === 'void') {
    // cancelled with its credit note (same command, same day), or replaced by a new card that carries the balance
    if (left) out.push({ day: dayOf(g.voidedAt), kind: g.voidReason === 'reissued' || g.replacedBy ? 'transferOut' : 'cancelled', amount: -left });
  } else if (left > 0 && g.expires) out.push({ day: g.expires, kind: 'expired', amount: -left });
  return out;
}

/**
 * The gift card liability from `from` to `to` (days, inclusive): opening + issued − redeemed − cancelled − expired =
 * closing. A card replaced by a new one moves its balance, which is neither issued nor cancelled. Cards taken over from
 * the old site count in `issued` the day they were imported (`legacy.imported`), and their share of the closing
 * balance is `legacy`: the old provider's statement is the opening entry of that part.
 * @param {any} s @param {string} from @param {string} to
 */
export function giftcardRoll(s, from, to) {
  const r = { from, to, opening: 0, issued: 0, redeemed: 0, cancelled: 0, expired: 0, closing: 0, legacy: { count: 0, balance: 0, imported: 0 } };
  for (const g of s.giftcards.values()) {
    let end = 0;
    for (const m of cardMoves(s, g)) {
      if (m.day < from) { r.opening += m.amount; end += m.amount; continue; }
      if (m.day > to) continue;
      end += m.amount;
      if (m.kind === 'issued' || m.kind === 'imported') { r.issued += m.amount; if (m.kind === 'imported') r.legacy.imported += m.amount; }
      else if (m.kind === 'redeemed') r.redeemed -= m.amount;
      else if (m.kind === 'cancelled') r.cancelled -= m.amount;
      else if (m.kind === 'expired') r.expired -= m.amount;
      // a transfer in or out moves the balance between two cards of the same day: in `end`, in no flow
    }
    r.closing += end;
    if (g.legacy && end > 0) { r.legacy.count += 1; r.legacy.balance += end; }
  }
  // the identity, kept by construction: a reissue's two halves fall on the same day and cancel out
  return r;
}

/**
 * The carnets still open at the end of `day`: their cuts left and what they are worth, at the price paid per cut on the
 * carnet's own ticket line. Carnets taken over from the old site (no ticket here) count their cuts at 0 €.
 * @param {any} s @param {string} day
 */
export function packsAt(s, day) {
  // value TTC (what the clients paid), valueHT (what VE credited to 706200: the figure of a year-end deferral)
  const r = { day, open: 0, cutsLeft: 0, value: 0, valueHT: 0, legacy: { open: 0, cutsLeft: 0 } };
  for (const k of s.packs.values()) {
    const sale = k.saleId ? s.sales.get(k.saleId) : null;
    const sold = sale ? sale.day : dayOf(k.soldAt);
    if (sold > day || (k.expires && k.expires < day)) continue;
    if (k.voided && dayOf(k.voided.at) <= day) continue;
    const total = k.voided ? k.used + k.voided.left : k.total;
    // a cut given back to the carnet (pack.returned) leaves its use in the list: the returns come off the latest uses
    const back = Math.max(0, (k.uses || []).length - k.used);
    const used = Math.max(0, (k.uses || []).filter((u) => (saleDay(s, u.saleId) || dayOf(u.at)) <= day).length - back);
    const left = Math.max(0, total - used);
    if (!left) continue;
    const line = sale ? sale.lines.find((l) => l.kind === 'pack' && l.packId === k.id) : null;
    r.open += 1; r.cutsLeft += left;
    if (line && total) { const v = Math.round((left * line.net) / total); r.value += v; r.valueHT += vatSplit(v, line.vat || 0).base; }
    else { r.legacy.open += 1; r.legacy.cutsLeft += left; }
  }
  return r;
}

/**
 * Money paid online and still a customer advance at the end of `day`: not used by a ticket of that day or before, not
 * given back by then. A payment used on its own day was never one.
 * @param {any} s @param {string} day
 */
export function depositsHeld(s, day) {
  const r = { day, count: 0, amount: 0 };
  for (const py of s.payments.values()) {
    if (py.kind === 'guarantee' || !py.paidAt || dayOf(py.paidAt) > day) continue;
    const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
    if (sale && sale.day <= day) continue;
    let back = 0;
    for (const rf of refundsOf(py)) if (dayOf(rf.at) <= day) back += rf.amount;
    if (py.providerRefunded && !sale && dayOf(py.outsideAt || py.paidAt) <= day) back += Math.max(0, Math.min(py.amount, py.providerRefunded) - (py.refunded || 0));
    const held = Math.max(0, py.amount - back);
    if (held) { r.count += 1; r.amount += held; }
  }
  return r;
}

/** The first day anything was booked, for a balance taken over all time. */
function firstDay(s) {
  let d = '';
  const see = (x) => { if (x && (!d || x < d)) d = x; };
  for (const k of s.closures.keys()) see(k);
  for (const k of s.salesByDay.keys()) see(k);
  for (const py of s.payments.values()) if (py.paidAt) see(dayOf(py.paidAt));
  return d || '2000-01-01';
}

/**
 * What is still at Stripe at the end of `day`: the balance of the online account over every entry so far (the open
 * days included, from their tickets).
 * @param {any} s @param {string} day @param {{ today?: string }} [opt]
 */
export function stripeBalance(s, day, { today } = {}) {
  const account = accountOf(comptaOf(s), 'method.online');
  const { entries } = ledger(s, { from: firstDay(s), to: day, today, provisional: true });
  let v = 0;
  for (const e of entries) for (const l of e.lines) if (l.account === account) v += l.debit - l.credit;
  return v;
}
