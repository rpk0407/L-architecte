// @ts-check
// The books the accountant imports (CPT-03): balanced entries per journal, in cents, as pure functions of the state.
//   VE  one entry per sealed Z, rebuilt from the day's tickets and credit notes, then checked against the Z
//   BQ  Stripe: money paid online and still unused at the end of its day (a customer advance, VAT due on collection),
//       given back outside a ticket, and each payout with its fees (VAT self-assessed: Stripe bills from Ireland)
//   OD  a gift card that expires with money left (breakage)
// Gift cards are booked as the till books them (multi-purpose: 0 % at sale, VAT when used), so tickets, Z, entries and
// the VAT return agree; VAT at sale is CPT-06's, with the till. Nothing here is posted to the journal: the files are
// recomputed from the state each time, and numbered so that a month exported again keeps its numbers (VE = the Z
// number; BQ and OD in the order the facts were recorded, over all time). No client name reaches an entry.
// No import of the engine or the state here.
import { vatSplit, isRevenue, fmtEur } from '../../shared/money.js';
import { localParts, addDays, monthEnd, instantOf, dayLong } from '../../shared/dates.js';
import { ACCOUNT_ROLES, DEFAULT_ACCOUNTS } from '../../shared/accounts.js';
import { refundParts, zFigures, closureNo, ticketNo, refundNo, hadTill } from './cash.js';
import { outsideOpen } from '../projections/payments.js';
import { csv } from '../lib/csv.js';
import compta from '../settings/compta.js';

/** The label of the VAT figure, wherever it is shown. */
export const VAT_LABEL = 'TVA à déclarer (aide à la CA3, à valider par ton comptable)';
export const REVERSE_LABEL = 'Services reçus d’un prestataire UE (Stripe)';
/** The 18 fields of the FEC layout (art. A47 A-1 LPF), in order. */
export const FEC_FIELDS = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const JOURNAL_LIB = { sales: 'Ventes', cash: 'Caisse', bank: 'Banque Stripe', misc: 'Opérations diverses' };
/** Online payments that move money: all but a card guarantee (an imprint, no money). */
const moves = (py) => py.kind !== 'guarantee';
const KIND_WORDS = { deposit: 'Acompte en ligne', qr: 'Paiement en ligne (QR)', giftcard: 'Carte cadeau en ligne', membership: 'Abonnement en ligne', link: 'Paiement par lien' };
const LINE_ROLE = { service: 'revenue.service', product: 'revenue.product', pack: 'revenue.pack', membership: 'revenue.membership', fee: 'revenue.fee' };
const METHOD_ROLE = { card: 'method.card', cash: 'method.cash', giftcard: 'giftcards', ancien: 'method.ancien' };
const VAT_RATES = new Set([2000, 1000, 550, 210]);

/* ---------------- the chart of accounts ---------------- */

/** settings.compta, every key present (a journal from before CPT-03 has the defaults). */
export function comptaOf(s) {
  const d = compta.defaults();
  const c = (s && s.settings && s.settings.compta) || {};
  return { ...d, ...c, accounts: { ...d.accounts, ...(c.accounts || {}) }, journals: { ...d.journals, ...(c.journals || {}) } };
}
/** The number a role posts to: the owner's, else the default, else the waiting account. */
export function accountOf(cfg, role) {
  const a = (cfg && cfg.accounts) || {};
  return a[role] || DEFAULT_ACCOUNTS[role] || a.waiting || DEFAULT_ACCOUNTS.waiting;
}
/** One label per number (CompteLib): the role that owns it, before a role that only shares it by default (alias). */
export function accountLabel(cfg, num) {
  const own = ACCOUNT_ROLES.find((x) => !x.alias && accountOf(cfg, x.role) === num) || ACCOUNT_ROLES.find((x) => accountOf(cfg, x.role) === num);
  return own ? own.label : 'Compte ' + num;
}
const roleLabel = (role) => (ACCOUNT_ROLES.find((x) => x.role === role) || { label: role }).label;

/* ---------------- small helpers ---------------- */

const dayOf = (ms) => localParts(ms).day;
const eu = (c) => fmtEur(c, { decimals: true });
const ddmmyyyy = (day) => day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4);
const pct = (rate) => String(rate / 100).replace('.', ',') + ' %';

/**
 * `total` cents over `weights`, in proportion, the cents rounding leaves going to the largest remainders (then the
 * first): deterministic, and the parts add up to the total exactly.
 * @param {number} total @param {number[]} weights @returns {number[]}
 */
export function spread(total, weights) {
  if (!weights.length) return [];
  const sign = total < 0 ? -1 : 1, t = Math.abs(total);
  const W = weights.reduce((a, b) => a + b, 0);
  if (!W) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (t * w) / W);
  const out = exact.map((x) => Math.floor(x));
  let rest = t - out.reduce((a, b) => a + b, 0);
  for (const i of exact.map((_, k) => k).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || a - b)) { if (rest <= 0) break; out[i] += 1; rest -= 1; }
  return out.map((x) => sign * x);
}

/**
 * The lines of one entry as they are added: one line per (group, role, aux, rate, kind), in cents, debit positive.
 * Groups keep a day's sales, its credit notes, the deposits and gift cards it uses apart, as the accountant reads them.
 */
function lines(L, warn = L.warn) {
  /** @type {Map<string, { group: string, role: string, amount: number, aux?: string, auxLabel?: string, rate?: number, vat?: boolean, base: number, src?: string, note?: string }>} */
  const m = new Map();
  const put = (group, role, amount, o = {}) => {
    if (!amount && !o.base) return;
    const k = [group, role, o.aux || '', o.rate ?? '', o.vat ? 'v' : ''].join('|');
    const x = m.get(k) || { group, role, ...o, amount: 0, base: 0 };
    x.amount += amount; x.base += o.vat ? o.base || 0 : 0;
    m.set(k, x);
  };
  return {
    /** a role, debit when amount > 0 */
    add: (group, role, amount, o = {}) => put(group, role, amount, o),
    /** an HT line taxed at `rate` (its base for the VAT return) */
    ht: (group, role, amount, rate, o = {}) => put(group, role, amount, { ...o, rate }),
    /** a VAT line: the rate's account (the waiting account, warned, for a rate the chart does not have) */
    tax: (group, rate, amount, base, o = {}) => {
      if (!VAT_RATES.has(rate)) warn('TVA à ' + pct(rate) + ' sans compte : passée au compte d’attente');
      put(group, VAT_RATES.has(rate) ? 'vat.' + rate : 'waiting', amount, { ...o, rate, vat: true, base: Math.sign(amount) * Math.abs(base) });
    },
    list: () => [...m.values()]
  };
}

/** One entry from its accumulated lines: debits first, each line its account's number and label. */
function entryOf(L, journal, head, acc) {
  const out = [];
  for (const x of acc.list()) {
    if (!x.amount) continue;
    const account = accountOf(L.cfg, x.role);
    /** @type {any} */
    const l = { account, accountLabel: accountLabel(L.cfg, account), label: (x.note ? x.note + ' · ' : '') + roleLabel(x.role), debit: x.amount > 0 ? x.amount : 0, credit: x.amount < 0 ? -x.amount : 0 };
    if (x.aux) { l.aux = x.aux; l.auxLabel = x.auxLabel || ''; }
    if (x.rate != null) l.rate = x.rate;
    if (x.vat) { l.vat = true; l.base = Math.abs(x.base); }
    if (x.src) l.src = x.src;
    out.push(l);
  }
  // debits first; then sales, their VAT, the rest (as an accountant reads a sales entry)
  const rank = (l) => (/^7/.test(l.account) ? 0 : l.vat ? 1 : 2);
  out.forEach((l, i) => { l.i = i; });
  out.sort((a, b) => (b.debit ? 1 : 0) - (a.debit ? 1 : 0) || rank(a) - rank(b) || a.i - b.i);
  for (const l of out) delete l.i;
  return { journal: L.cfg.journals[journal] || journal, journalLib: JOURNAL_LIB[journal] || journal, kind: journal, ...head, lines: out };
}

/* ---------------- online payments: when they are a customer advance ---------------- */

const paidDay = (py) => dayOf(py.paidAt);
/** A paid online payment still unused at the end of the day it was paid: in 419100 until a ticket uses it. */
function isAdvance(s, py) {
  if (!py || !py.paidAt || !moves(py)) return false;
  const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
  return !(sale && sale.day === paidDay(py));
}
/**
 * The VAT an advance carries, at collection (CGI 269-2-c): the booked service's rate for a deposit, the plan's for a
 * membership, none for a gift card (multi-purpose), the default rate otherwise. The same split books it in BQ and takes
 * it back in VE when a ticket uses it, so 419100 and the VAT accounts come back to zero.
 */
function advanceVat(L, py, amount) {
  if (!L.depositVat) return { rate: 0, tax: 0 };
  const s = L.s;
  const P = s.settings.payments || {};
  let rate = P.vat ?? 2000;
  if (py.kind === 'giftcard') rate = 0;
  else if (py.kind === 'deposit') {
    const a = py.apptId ? s.appts.get(py.apptId) : null;
    const sv = a && a.services && a.services[0] ? s.services.get(a.services[0].id) : null;
    if (sv && sv.vat != null) rate = sv.vat;
  } else if (py.kind === 'membership') {
    const m = s.members && py.memberId ? s.members.get(py.memberId) : null;
    if (m && m.vat != null) rate = m.vat;
  }
  return { rate, tax: rate ? vatSplit(amount, rate).tax : 0 };
}

/**
 * What the provider gave back of a payment beyond our own records of it (refundOnline, the till's credit notes made
 * through the provider): a refund from its dashboard. The credit notes written afterwards as « remboursé hors caisse »
 * (providerRef 'outside') are the records of it, not more money out, so they are not counted here.
 */
function outsideOf(s, py) {
  const P = Math.min(py.amount, py.providerRefunded || 0);
  if (!P) return 0;
  const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
  let credited = 0;
  if (sale) {
    let rest = 0;
    for (const id of sale.refundIds || []) { const rf = s.refunds.get(id); if (rf && rf.providerRef !== 'outside') rest += refundParts(rf).filter((p) => p.method === 'online').reduce((t, p) => t + p.amount, 0); }
    for (const p of sale.payments || []) {
      if (!p.paymentId) continue;
      const take = Math.min(rest, (s.payments.get(p.paymentId) || p).amount);
      if (p.paymentId === py.id) { credited = take; break; }
      rest -= take;
    }
  }
  return Math.max(0, P - (py.refunded || 0) - credited);
}
/** Of a credit note's online part, what clears the waiting account (the provider's refund already booked there, BQ). */
function outsideCleared(L, rf, online) {
  if (rf.providerRef !== 'outside' || !online) return 0;
  const s = L.s, sale = s.sales.get(rf.saleId);
  if (!sale) return 0;
  // the sale's outside refunds, consumed by its « hors caisse » credit notes in their order
  let budget = (sale.payments || []).filter((p) => p.paymentId).reduce((t, p) => { const py = s.payments.get(p.paymentId); return t + (py ? outsideOf(s, py) : 0); }, 0);
  for (const id of [...(sale.refundIds || [])].sort((a, b) => ((s.refunds.get(a) || {}).number || 0) - ((s.refunds.get(b) || {}).number || 0))) {
    const r = s.refunds.get(id);
    if (!r || r.providerRef !== 'outside') continue;
    const part = refundParts(r).filter((p) => p.method === 'online').reduce((t, p) => t + p.amount, 0);
    const take = Math.min(budget, part);
    if (r.id === rf.id) return take;
    budget -= take;
  }
  return 0;
}

/* ---------------- VE: the day's tickets, one entry per Z ---------------- */

/** @param {any} L @param {string} day @param {any} z the Z, or null for a day still open (provisional) */
function salesDay(L, day, z) {
  const s = L.s;
  const acc = lines(L);
  const piece = z ? closureNo(z.number) : 'PROV-' + day.replace(/-/g, '');
  const warnHere = (w) => L.warn(piece + ' : ' + w);
  const tally = { net: 0, vat: new Map(), pay: /** @type {Record<string, number>} */ ({}) };
  const vatTally = (rate, tax) => tally.vat.set(rate, (tally.vat.get(rate) || 0) + tax);
  const payTally = (m, v) => { tally.pay[m] = (tally.pay[m] || 0) + v; };
  const roleOfKind = (kind) => {
    if (LINE_ROLE[kind]) return LINE_ROLE[kind];
    warnHere('ligne « ' + kind + ' » comptée en prestations');
    return 'revenue.service';
  };
  const sales = (s.salesByDay.get(day) || []).map((id) => s.sales.get(id)).filter(Boolean).sort((a, b) => a.number - b.number);
  for (const x of sales) {
    tally.net += x.totals.revenue;
    const ls = x.lines || [];
    for (const row of x.totals.vat || []) {
      // the row's base over its rate's revenue lines, by their net: the HT the ticket printed, account by account
      const idx = ls.map((l, i) => i).filter((i) => isRevenue(ls[i].kind) && (ls[i].vat || 0) === row.rate && ls[i].net > 0);
      const parts = spread(row.base, idx.map((i) => ls[i].net));
      idx.forEach((i, k) => acc.ht('sale', roleOfKind(ls[i].kind), -parts[k], row.rate));
      if (row.tax) acc.tax('sale', row.rate, -row.tax, row.base);
      vatTally(row.rate, row.tax);
    }
    for (const l of ls) if (l.kind === 'giftcard' && l.net > 0) acc.add('sale', 'giftcards', -l.net);
    if (x.tip && x.tip.amount) acc.add('sale', 'tips', -x.tip.amount, { aux: 'POURB-' + x.tip.staffId, auxLabel: 'Pourboires ' + ((s.staff.get(x.tip.staffId) || {}).name || '') });
    for (const p of x.payments || []) {
      payTally(p.method, p.amount);
      if (p.method === 'online' || p.method === 'deposit') {
        const py = p.paymentId ? s.payments.get(p.paymentId) : null;
        if (py && isAdvance(s, py)) {
          // paid on an earlier day: the advance (and its VAT) booked then is taken back
          const v = advanceVat(L, py, p.amount);
          acc.ht('deposit', 'deposits', p.amount - v.tax, v.rate || undefined, { note: 'Acomptes utilisés', src: 'deposit' });
          if (v.tax) acc.tax('deposit', v.rate, v.tax, p.amount - v.tax, { note: 'Acomptes utilisés', src: 'deposit' });
        } else acc.add('sale', 'method.online', p.amount);
      } else if (p.method === 'giftcard') acc.add('redeem', 'giftcards', p.amount, { note: 'Cartes cadeaux utilisées' });
      else if (METHOD_ROLE[p.method]) acc.add('sale', METHOD_ROLE[p.method], p.amount);
      else { warnHere('paiement « ' + p.method + ' » au compte d’attente'); acc.add('sale', 'waiting', p.amount); }
    }
  }
  for (const r of L.refundsByDay.get(day) || []) {
    const sale = s.sales.get(r.saleId);
    tally.net -= r.amount - (r.liability || 0);
    for (const row of r.vat || []) {
      // the lines given back at that rate, or the ticket's own lines when refunded by amount
      const own = r.lines && r.lines.length ? r.lines.filter((l) => l.kind !== 'giftcard' && (l.vat || 0) === row.rate && l.amount > 0).map((l) => ({ kind: l.kind, w: l.amount })) : [];
      const from = own.length ? own : ((sale && sale.lines) || []).filter((l) => isRevenue(l.kind) && (l.vat || 0) === row.rate && l.net > 0).map((l) => ({ kind: l.kind, w: l.net }));
      const list = from.length ? from : [{ kind: 'service', w: 1 }];
      const parts = spread(row.base, list.map((o) => o.w));
      list.forEach((o, k) => acc.ht('refund', roleOfKind(o.kind), parts[k], row.rate, { note: 'Avoirs' }));
      if (row.tax) acc.tax('refund', row.rate, row.tax, row.base, { note: 'Avoirs' });
      vatTally(row.rate, -row.tax);
    }
    if (r.liability) acc.add('refund', 'giftcards', r.liability, { note: 'Avoirs' });
    const deposit = sale && !sale.payments.some((p) => p.method === 'online') && sale.payments.some((p) => p.method === 'deposit');
    for (const part of refundParts(r)) {
      // the Z's own rule (domain/cash.js dayTotals): an online refund off a deposit leaves the deposit's line
      payTally(part.method === 'online' && deposit ? 'deposit' : part.method, -part.amount);
      if (part.method === 'online') {
        const cleared = outsideCleared(L, r, part.amount);
        if (cleared) acc.add('refund', 'waiting', -cleared, { note: 'Avoirs' });
        if (part.amount - cleared) acc.add('refund', 'method.online', -(part.amount - cleared), { note: 'Avoirs' });
      } else if (METHOD_ROLE[part.method]) acc.add('refund', METHOD_ROLE[part.method], -part.amount, { note: 'Avoirs' });
      else { warnHere('remboursement « ' + part.method + ' » au compte d’attente'); acc.add('refund', 'waiting', -part.amount, { note: 'Avoirs' }); }
    }
  }
  if (z) {
    // the entry against the sealed Z: the same net, VAT per rate and money per method, or the owner is told
    const f = zFigures(z);
    let gap = Math.abs(tally.net - f.netTtc);
    const rates = new Set([...tally.vat.keys(), ...f.vatNet.map((v) => v.rate)]);
    for (const rate of rates) gap = Math.max(gap, Math.abs((tally.vat.get(rate) || 0) - ((f.vatNet.find((v) => v.rate === rate) || { tax: 0 }).tax)));
    for (const m of new Set([...Object.keys(tally.pay), ...Object.keys(f.paymentsNet)])) gap = Math.max(gap, Math.abs((tally.pay[m] || 0) - (f.paymentsNet[m] || 0)));
    if (gap) L.warn(piece + ' : les tickets ne retombent pas sur le Z (écart ' + eu(gap) + ')');
  }
  const head = { num: z ? z.number : null, date: day, piece, pieceDate: day, label: (z ? piece + ' · ventes' : 'Ventes provisoires') + ' du ' + ddmmyyyy(day), valid: z ? z.at : null, provisional: !z };
  return entryOf(L, 'sales', head, acc);
}

/** The days of the range with a Z (and, provisional, those with till activity and none yet). */
export function salesJournal(L) {
  const s = L.s;
  const days = new Set([...s.closures.keys()]);
  if (L.provisional) { for (const d of s.salesByDay.keys()) days.add(d); for (const d of L.refundsByDay.keys()) days.add(d); }
  const out = [];
  for (const day of [...days].filter((d) => d >= L.from && d <= L.to).sort()) {
    const z = s.closures.get(day) || null;
    if (!z && !hadTill(s, day)) continue;
    out.push(salesDay(L, day, z));
  }
  return out;
}

/* ---------------- BQ: Stripe ---------------- */

/** All of time: the ledger numbers them in the order they were recorded, then keeps the range. */
export function bankJournal(L) {
  const s = L.s;
  const out = [];
  // the warnings of an entry are told only when the entry is in the range asked (ledger)
  const entry = (head, fill) => {
    const warnings = [];
    const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
    const acc = lines(L, warn);
    fill(acc, warn);
    out.push({ ...entryOf(L, 'bank', head, acc), warnings });
  };
  const advanceLines = (acc, py, amount, sign, note) => {
    const v = advanceVat(L, py, amount);
    acc.add('a', 'method.online', sign * amount, { note });
    acc.ht('a', 'deposits', -sign * (amount - v.tax), v.rate || undefined, { note, src: 'deposit' });
    if (v.tax) acc.tax('a', v.rate, -sign * v.tax, amount - v.tax, { note, src: 'deposit' });
  };
  for (const py of s.payments.values()) {
    if (!moves(py) || !py.paidAt) continue;
    const what = KIND_WORDS[py.kind] || 'Paiement en ligne';
    const sale = py.usedBy ? s.sales.get(py.usedBy) : null;
    if (isAdvance(s, py)) {
      const day = paidDay(py);
      entry({ date: day, piece: py.id, pieceDate: day, label: what + ' reçu', valid: py.paidAt }, (acc) => advanceLines(acc, py, py.amount, 1, 'Reçu'));
    }
    // given back with refundOnline: off a ticket, the advance goes back; on a ticket, money left without a credit note
    if (py.refunded > 0) {
      const at = py.endedAt || py.paidAt;
      const day = dayOf(at);
      if (!sale) {
        entry({ date: day, piece: py.id, pieceDate: day, label: what + ' remboursé', valid: at }, (acc, warn) => {
          if (!py.endedAt) warn(py.id + ' : remboursement partiel daté du jour du paiement');
          advanceLines(acc, py, py.refunded, -1, 'Remboursé');
        });
      } else {
        entry({ date: day, piece: py.id, pieceDate: day, label: what + ' remboursé sans avoir', valid: at }, (acc, warn) => {
          warn(ticketNo(sale.number) + ' : remboursé chez Stripe sans avoir');
          acc.add('w', 'waiting', py.refunded); acc.add('w', 'method.online', -py.refunded);
        });
      }
    }
    // given back at the provider (its dashboard): the same, dated when the provider said so (payment.refundedOutside)
    const outside = outsideOf(s, py);
    if (outside > 0) {
      const at = py.outsideAt || py.endedAt || py.paidAt;
      const day = dayOf(at);
      if (!sale) entry({ date: day, piece: py.id, pieceDate: day, label: what + ' remboursé chez Stripe', valid: at }, (acc) => advanceLines(acc, py, outside, -1, 'Remboursé'));
      else {
        entry({ date: day, piece: py.id, pieceDate: day, label: what + ' remboursé chez Stripe', valid: at }, (acc, warn) => {
          // until the owner writes the credit note « remboursé hors caisse », which clears the waiting account
          if (outsideOpen(s, py) > 0) warn(ticketNo(sale.number) + ' : remboursé chez Stripe sans avoir');
          acc.add('w', 'waiting', outside); acc.add('w', 'method.online', -outside);
        });
      }
    }
  }
  const payouts = s.payouts ? [...s.payouts.values()] : [];
  for (const po of payouts) {
    const day = dayOf(po.arrival || po.at);
    entry({ date: day, piece: String(po.id).slice(0, 40), pieceDate: day, label: 'Virement Stripe', valid: po.at || po.arrival }, (acc, warn) => {
      if (po.truncated) warn('Virement Stripe du ' + ddmmyyyy(day) + ' : toutes ses opérations n’ont pas été lues');
      acc.add('p', 'bank', po.amount);
      let fee = 0, losses = 0, unknown = 0;
      for (const it of po.items || []) {
        fee += it.fee || 0;
        if (it.type === 'dispute' || it.type === 'adjustment') losses += it.amount;
        else if (!it.pid) unknown += it.amount;
      }
      if (fee) acc.add('p', 'fees', fee);
      // a chargeback (or Stripe's adjustment) is money taken back; a dispute won comes back the same way
      if (losses) acc.add('p', 'disputes', -losses);
      if (unknown) { warn('Opération Stripe inconnue (ancien site ?) : ' + eu(unknown) + ' au compte d’attente'); acc.add('p', 'waiting', -unknown); }
      // what left Stripe for the bank: the rest of the entry, so it always balances
      acc.add('p', 'method.online', -(po.amount + fee - losses - unknown));
      if (L.cfg.feesReverseCharge && fee) {
        const tax = Math.round((fee * 2000) / 10000);
        acc.add('r', 'vat.intracomDeductible', tax, { rate: 2000, vat: true, base: fee, src: 'reverse' });
        acc.add('r', 'vat.intracomDue', -tax, { rate: 2000, vat: true, base: -fee, src: 'reverse' });
      }
    });
  }
  return out;
}

/* ---------------- OD: what a gift card left when it expired ---------------- */

export function miscJournal(L) {
  const out = [];
  for (const g of L.s.giftcards.values()) {
    // valid through its expiry day: the money left is the salon's the day after, once that day is over
    if (g.status !== 'active' || !(g.balance > 0) || !g.expires || g.expires >= L.today) continue;
    const acc = lines(L);
    acc.add('e', 'giftcards', g.balance);
    acc.add('e', 'breakage', -g.balance);
    out.push(entryOf(L, 'misc', { date: g.expires, piece: g.id, pieceDate: g.expires, label: 'Carte cadeau •••• ' + (g.last4 || '') + ' expirée' + (g.legacy ? ' (ancien site)' : ''), valid: instantOf(addDays(g.expires, 1), 0) }, acc));
  }
  return out;
}

/**
 * A REGISTRY: one line per journal builder. A builder (L) → entries; one that leaves `num` out returns its entries of
 * all time, and the ledger numbers them in the order they were recorded (valid) before keeping the range.
 * CPT-04 adds its cash book here.
 */
export const JOURNALS = [
  salesJournal,
  bankJournal,
  miscJournal
];

/**
 * The entries of a range, numbered, balanced (a builder's gap goes to the waiting account, with a warning: the file
 * stays importable and the owner sees it).
 * @param {any} s
 * @param {{ from: string, to: string, today?: string, provisional?: boolean }} opt today: a later fact is not final
 *   yet (a gift card valid until today has not expired); provisional: days without a Z are served from their tickets
 * @returns {{ entries: any[], warnings: string[] }}
 */
export function ledger(s, { from, to, today = '9999-12-31', provisional = false }) {
  const cfg = comptaOf(s);
  const warnings = [];
  const refundsByDay = new Map();
  for (const r of s.refunds.values()) { const l = refundsByDay.get(r.day) || []; l.push(r); refundsByDay.set(r.day, l); }
  for (const l of refundsByDay.values()) l.sort((a, b) => a.number - b.number);
  const L = {
    s, cfg, from, to, today, provisional, refundsByDay,
    // VAT on services is due on collection (CGI 269-2-c); on the debits option a deposit carries none
    depositVat: cfg.depositVat !== false && cfg.servicesVat !== 'debits',
    warn: (w) => { if (!warnings.includes(w)) warnings.push(w); }
  };
  const all = [];
  for (const build of JOURNALS) {
    const got = build(L);
    // continuous numbering per journal, in the order the facts were recorded
    const unnumbered = got.filter((e) => e.num === undefined).sort((a, b) => (a.valid || 0) - (b.valid || 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.piece < b.piece ? -1 : a.piece > b.piece ? 1 : 0));
    unnumbered.forEach((e, i) => { e.num = i + 1; });
    for (const e of got) {
      const w = e.warnings;
      delete e.warnings;
      if (e.date < from || e.date > to) continue;
      for (const x of w || []) L.warn(x);
      all.push(e);
    }
  }
  for (const e of all) {
    const d = e.lines.reduce((t, l) => t + l.debit - l.credit, 0);
    if (d) {
      const account = accountOf(cfg, 'waiting');
      e.lines.push({ account, accountLabel: accountLabel(cfg, account), label: roleLabel('waiting'), debit: d < 0 ? -d : 0, credit: d > 0 ? d : 0 });
      L.warn(e.journal + ' ' + e.piece + ' : écriture déséquilibrée de ' + eu(Math.abs(d)) + ', écart au compte d’attente');
    }
  }
  if (s.payouts && !s.payouts.size && [...s.payments.values()].some((py) => py.provider === 'stripe' && py.paidAt && moves(py) && paidDay(py) >= from && paidDay(py) <= to)) {
    L.warn('Virements Stripe non suivis : branche les webhooks (Réglages › Paiements)');
  }
  if (cfg.regime === 'franchise' && all.some((e) => e.lines.some((l) => l.vat && !l.src))) L.warn('Franchise en base : tes tarifs portent encore de la TVA (Catalogue, Réglages › Paiements)');
  const order = ['sales', 'cash', 'bank', 'misc'];
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || order.indexOf(a.kind) - order.indexOf(b.kind) || (a.num || 0) - (b.num || 0));
  return { entries: all, warnings };
}

/* ---------------- the VAT of a month ---------------- */

/**
 * VAT due for a month, from the VAT lines of every journal (credit − debit) and their HT counterparts' base: the
 * tickets' VAT, plus a deposit's on the day it was paid, less the same when a ticket uses it. ticketsVat is the Z's
 * figure, for comparison. autoliquidation: the VAT on Stripe's fees, due and deductible at once.
 * @param {any} s @param {string} month 'YYYY-MM' @param {{ today?: string, provisional?: boolean }} [opt]
 */
export function vatReturn(s, month, { today, provisional = true } = {}) {
  const from = month + '-01', to = monthEnd(from);
  const { entries, warnings } = ledger(s, { from, to, today, provisional });
  /** @type {Map<number, { rate: number, base: number, tax: number }>} */
  const rows = new Map();
  const row = (rate) => { let r = rows.get(rate); if (!r) { r = { rate, base: 0, tax: 0 }; rows.set(rate, r); } return r; };
  const deposits = { base: 0, tax: 0 }, autoliquidation = { label: REVERSE_LABEL, base: 0, tax: 0 };
  for (const e of entries) for (const l of e.lines) {
    if (l.rate == null) continue;
    const v = l.credit - l.debit;
    if (l.src === 'reverse') { if (l.credit) { autoliquidation.base += l.base; autoliquidation.tax += l.credit; } continue; }
    if (l.vat) { row(l.rate).tax += v; if (l.src === 'deposit') deposits.tax += v; }
    else { row(l.rate).base += v; if (l.src === 'deposit') deposits.base += v; }
  }
  /** @type {Map<number, { rate: number, base: number, tax: number }>} */
  const z = new Map();
  for (const c of s.closures.values()) {
    if (c.day < from || c.day > to) continue;
    for (const v of zFigures(c).vatNet) { const r = z.get(v.rate) || { rate: v.rate, base: 0, tax: 0 }; r.base += v.base; r.tax += v.tax; z.set(v.rate, r); }
  }
  const byRate = (a, b) => b.rate - a.rate;
  return {
    month, label: VAT_LABEL,
    rows: [...rows.values()].filter((r) => r.base || r.tax).sort(byRate),
    tax: [...rows.values()].reduce((t, r) => t + r.tax, 0),
    adjustments: { deposits, giftcards: { base: 0, tax: 0 } },
    autoliquidation,
    ticketsVat: [...z.values()].filter((r) => r.base || r.tax).sort(byRate),
    warnings
  };
}

/* ---------------- the files ---------------- */

/** 2083 → '20,83' (no thousands separator, as the FEC asks). */
const amount = (c) => (c / 100).toFixed(2).replace('.', ',');
const ymd = (day) => (day || '').replace(/-/g, '');
/** A text field never carries the separator or a line break. */
const txt = (v) => String(v ?? '').replace(/[|\r\n\t]+/g, ' ').trim();

/** The 18 fields of each line, entry by entry. */
export function fecRows(entries) {
  const rows = [];
  for (const e of entries) {
    const lib = e.journalLib || e.journal;
    const num = e.num == null ? e.journal + '-PROV' : e.journal + String(e.num).padStart(6, '0');
    const valid = e.valid ? ymd(dayOf(e.valid)) : ymd(e.date);
    for (const l of e.lines) {
      rows.push([e.journal, lib, num, ymd(e.date), l.account, l.accountLabel || l.account, l.aux || '', l.auxLabel || '', e.piece, ymd(e.pieceDate || e.date),
        (e.label + ' · ' + l.label).slice(0, 120), amount(l.debit), amount(l.credit), '', '', valid, '', ''].map(txt));
    }
  }
  return rows;
}
/** The import file: pipe-separated, UTF-8 without BOM, CRLF, the 18 names first. */
export function fecText(entries) {
  return [FEC_FIELDS, ...fecRows(entries)].map((r) => r.join('|')).join('\r\n') + '\r\n';
}

/** The same columns for Excel and the tools that prefer CSV: ';', a BOM, the decimal comma. */
export function csvText(entries) {
  return csv([FEC_FIELDS, ...fecRows(entries)]);
}

/**
 * The checks an import file passes before it is served: the header, 18 fields per line, valid dates and amounts, and
 * every entry (journal and number) balanced to the cent.
 * @param {string} text @returns {{ ok: boolean, errors: string[] }}
 */
export function checkFec(text) {
  const errors = [];
  const err = (m) => { if (errors.length < 20) errors.push(m); };
  if (text.charCodeAt(0) === 0xfeff) err('le fichier commence par un BOM');
  const lines = text.split('\r\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.some((l) => l.includes('\n'))) err('fin de ligne autre que CRLF');
  if (lines[0] !== FEC_FIELDS.join('|')) err('en-tête différent des 18 champs');
  const dateOk = (d) => /^\d{8}$/.test(d) && !Number.isNaN(Date.parse(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T12:00:00Z')) && new Date(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T12:00:00Z').toISOString().slice(0, 10).replace(/-/g, '') === d;
  /** @type {Map<string, number>} */
  const sums = new Map();
  lines.slice(1).forEach((l, i) => {
    const f = l.split('|');
    const n = i + 2;
    if (f.length !== 18) { err('ligne ' + n + ' : ' + f.length + ' champs au lieu de 18'); return; }
    for (const k of [3, 9, 15]) if (!dateOk(f[k])) err('ligne ' + n + ' : date ' + FEC_FIELDS[k] + ' invalide (' + f[k] + ')');
    for (const k of [11, 12]) if (!/^\d+,\d{2}$/.test(f[k])) err('ligne ' + n + ' : montant ' + FEC_FIELDS[k] + ' invalide (' + f[k] + ')');
    if (!f[0] || !f[2] || !f[4]) err('ligne ' + n + ' : journal, numéro ou compte vide');
    const cents = (v) => Math.round(Number(v.replace(',', '.')) * 100);
    const key = f[0] + '|' + f[2];
    sums.set(key, (sums.get(key) || 0) + cents(f[11]) - cents(f[12]));
  });
  for (const [k, v] of sums) if (v) err('écriture ' + k.replace('|', ' ') + ' déséquilibrée de ' + amount(Math.abs(v)));
  return { ok: !errors.length, errors };
}

/**
 * The days of a month that keep its file from being final: those still to come or not over, and past days with till
 * activity and no Z yet.
 * @param {any} s @param {string} month @param {string} today
 */
export function openDays(s, month, today) {
  const out = [];
  for (let d = month + '-01'; d.slice(0, 7) === month; d = addDays(d, 1)) {
    if (d > today || (d === today && !s.closures.has(d)) || (d < today && hadTill(s, d) && !s.closures.has(d))) out.push(d);
  }
  return out;
}
/** « Il manque le Z du mardi 3 novembre » */
export const openWords = (day) => 'Il manque le Z du ' + dayLong(day);
