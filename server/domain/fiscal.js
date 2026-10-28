// @ts-check
// Month and year closures and their signatures (CPT-01a), as pure functions of the state. BOFiP (BOI-TVA-DECLA-30-10-30
// §170) asks for daily, monthly and annual closures, each with the period's grand total and the perpetual total. The day
// is the Z (commands/sales.js closeDay); a month is the sum of its Z, closed once every day of it with till activity has
// its Z; a year is the sum of its months. Each closure is then signed (commands/steps/fiscal.js): the signature covers a
// digest of the record and the journal hash the closure was sealed on, so neither can change without it showing.
// The projection is projections/fiscal.js; no import of the engine or the state here.
import { canonical, sha256 } from '../lib/util.js';
import { verifySig, kidOf } from '../core/signer.js';
import { closureNo, missedZ, zFigures } from './cash.js';
import { DAYS_FR, MONTHS_FR, addDays, dayParts, monthEnd } from '../../shared/dates.js';

export const monthNo = (n) => 'M' + String(n).padStart(4, '0');
export const yearNo = (n) => 'Y' + String(n).padStart(4, '0');
/** A closure older than this is signed only as backlog, in the tick a new key first appears (the anti-rewrite rule). */
export const SIGN_WINDOW = 36 * 3600000;
/** The demo writes its own past (a server woken after days closes them backdated): nothing real to protect, all is signed. */
export const signsAll = (s) => s.mode === 'demo';

export const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const monthOf = (day) => day.slice(0, 7);
export function addMonths(m, n) {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
}
export const monthBounds = (m) => ({ from: m + '-01', to: monthEnd(m + '-01') });
const dayAfter = (day) => addDays(day, 1);
/** 'octobre', or 'décembre 2025' outside the year of `today`. */
export function monthWords(m, today = '') {
  const name = MONTHS_FR[Number(m.slice(5, 7)) - 1];
  return today && today.slice(0, 4) !== m.slice(0, 4) ? name + ' ' + m.slice(0, 4) : name;
}
/** « d’octobre », « de septembre ». */
export const ofMonth = (m, today = '') => (/^[aeiouyéèh]/i.test(monthWords(m)) ? 'd’' : 'de ') + monthWords(m, today);
/** 'samedi 31', as the till's warnings say a day. */
const dayAndDate = (day) => { const p = dayParts(day); return DAYS_FR[p.wd] + ' ' + p.d; };

/** The fiscal year a month belongs to, named after the calendar year it ends in ('2026' for 2026-10 when it ends in December). */
export function fiscalYearOf(month, yearEndMonth = 12) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return String(m > yearEndMonth ? y + 1 : y);
}
/** First and last day of that fiscal year. */
export function fiscalYearBounds(year, yearEndMonth = 12) {
  const last = year + '-' + String(yearEndMonth).padStart(2, '0');
  return { from: addMonths(last, -11) + '-01', to: monthBounds(last).to, first: addMonths(last, -11), last };
}
/** The month the fiscal year ends (settings fiscal.yearEndMonth), December when unset. */
export const yearEndOf = (s) => { const v = Number(s.settings.fiscal && s.settings.fiscal.yearEndMonth); return v >= 1 && v <= 12 ? v : 12; };

/** The Z, oldest first. */
const zList = (s) => [...s.closures.values()].sort((a, b) => a.number - b.number);
/** The first month: the month of the first Z. Null before any Z. */
export function firstMonth(s) {
  let first = '';
  for (const d of s.closures.keys()) if (!first || d < first) first = d;
  return first ? monthOf(first) : null;
}
/** The month the next closure is for: the one after the last closed, without gaps, or the first month. */
export function nextMonth(s) {
  const last = s.monthSeq ? s.periods.get(monthNo(s.monthSeq)) : null;
  return last ? addMonths(last.period, 1) : firstMonth(s);
}
/** The first day of the month with till activity and no Z yet (counted or not), or null. */
export function waitingDay(s, month, today) {
  const { close, uncounted } = missedZ(s, today);
  return [...close, ...uncounted].sort().find((d) => monthOf(d) === month) || null;
}

/** Sum of closure totals (the zFigures of each Z, or the totals of each month): one shape for a month and a year. */
export function sumTotals(list) {
  const t = { grossTtc: 0, refundsTotal: 0, netTtc: 0, htNet: 0, vatNet: /** @type {{ rate: number, base: number, tax: number }[]} */ ([]), paymentsNet: /** @type {Record<string, number>} */ ({}), refundsByMethod: /** @type {Record<string, number>} */ ({}), takings: 0, prepaid: 0, tips: 0, giftcardsSold: 0, giftcardsRefunded: 0 };
  const vat = new Map();
  for (const x of list) {
    for (const k of /** @type {const} */ (['grossTtc', 'refundsTotal', 'netTtc', 'htNet', 'takings', 'prepaid', 'tips', 'giftcardsSold', 'giftcardsRefunded'])) t[k] += x[k] || 0;
    for (const [m, v] of Object.entries(x.paymentsNet || {})) t.paymentsNet[m] = (t.paymentsNet[m] || 0) + v;
    for (const [m, v] of Object.entries(x.refundsByMethod || {})) t.refundsByMethod[m] = (t.refundsByMethod[m] || 0) + v;
    for (const r of x.vatNet || []) { const v = vat.get(r.rate) || { rate: r.rate, base: 0, tax: 0 }; v.base += r.base; v.tax += r.tax; vat.set(r.rate, v); }
  }
  t.vatNet = [...vat.values()].sort((a, b) => b.rate - a.rate);
  return t;
}
const span = (nums) => { const n = nums.filter((x) => x != null).sort((a, b) => a - b); return { count: n.length, first: n[0] ?? null, last: n[n.length - 1] ?? null }; };

/**
 * The perpetual totals before this month: the previous month's closure; for the next month to close, the last one closed
 * (zero before the first, and for a month before the first closed).
 */
function perpetualBefore(s, month) {
  const prev = s.periodByKey.get('M:' + addMonths(month, -1));
  if (prev) return prev.perpetual;
  const last = s.monthSeq ? s.periods.get(monthNo(s.monthSeq)) : null;
  return last && last.period < month ? last.perpetual : { net: 0, gross: 0, refunds: 0 };
}

/**
 * A month as its closure records it: its Z, tickets and credit notes, the sum of its Z and the perpetual totals after
 * it. perpetual.net is the last Z's grand total (the previous month's when it had no Z). For a month already closed, read
 * its closure (s.periodByKey 'M:YYYY-MM'), which is what was signed; this gives the same figures from the Z.
 */
export function monthTotals(s, month) {
  const zs = zList(s).filter((z) => monthOf(z.day) === month);
  const totals = sumTotals(zs.map((z) => zFigures(z)));
  const credits = [...s.refunds.values()].filter((r) => monthOf(r.day) === month).map((r) => r.number);
  const prev = perpetualBefore(s, month);
  // a Z keeps its first and last ticket numbers, not the list: the month spans from the lowest to the highest
  const firsts = span(zs.map((z) => z.first)), lasts = span(zs.map((z) => z.last));
  const tickets = { count: zs.reduce((t, z) => t + (z.tickets || 0), 0), first: firsts.first, last: lasts.last };
  return {
    ...monthBounds(month), z: span(zs.map((z) => z.number)), tickets, credits: span(credits), totals,
    perpetual: { net: zs.length ? zs[zs.length - 1].grandTotal : prev.net, gross: prev.gross + totals.grossTtc, refunds: prev.refunds + totals.refundsTotal }
  };
}

/**
 * A year closed with month (not yet in the state): every month closed since the previous year closure, summed. The first
 * year starts with its fiscal year; a later one the day after the previous year, so a fiscal.yearEndMonth changed during
 * a year makes that year shorter or longer, never leaves a month out of every year.
 */
export function yearTotals(s, month, monthRecord) {
  const yem = yearEndOf(s);
  const b = fiscalYearBounds(fiscalYearOf(month, yem), yem);
  const prevYear = s.yearSeq ? s.periods.get(yearNo(s.yearSeq)) : null;
  const months = [...s.periods.values()].filter((p) => p.kind === 'month' && (!prevYear || p.from > prevYear.to)).concat([monthRecord]);
  const from = prevYear ? dayAfter(prevYear.to) : months[0].from < b.from ? months[0].from : b.from;
  return { from, to: monthRecord.to, months: span(months.map((m) => m.number)), totals: sumTotals(months.map((m) => m.totals)), perpetual: monthRecord.perpetual };
}

/**
 * The month the tick may close today, and the day it waits on if a Z is missing: the next month to close, once it is over.
 * @returns {{ month: string, waiting: string|null } | null}
 */
export function closableMonth(s, today) {
  const m = nextMonth(s);
  if (!m || m >= monthOf(today)) return null;
  return { month: m, waiting: waitingDay(s, m, today) };
}
/** What the tick says while a month waits: « Le mois d’octobre attend le Z du samedi 31. » */
export const waitingWords = (c, today) => `Le mois ${ofMonth(c.month, today)} attend le Z du ${dayAndDate(/** @type {string} */ (c.waiting))}.`;

/* ---------------- signatures ---------------- */

/**
 * The fields a signature covers, as day.closed and period.closed emit them (plus their resolved time). Fixed for good: a
 * field a later package adds to s.closures or s.periods stays out of the digest, so the closures signed so far still
 * verify. A new field of the event itself is covered by the chain, not by the signature, until a new list is versioned.
 */
const Z_FIELDS = ['id', 'number', 'day', 'tickets', 'first', 'last', 'revenue', 'revenueHT', 'net', 'tips', 'liability', 'refunded', 'refunds', 'refundByMethod', 'byMethod', 'vat', 'services', 'products', 'paymentsNet', 'liabilityRefunded', 'grandTotal', 'early', 'late', 'auto', 'at'];
const PERIOD_FIELDS = ['id', 'kind', 'period', 'number', 'from', 'to', 'z', 'tickets', 'credits', 'months', 'totals', 'perpetual', 'at'];
/** @param {any} o @param {string[]} keys */
const pick = (o, keys) => { /** @type {Record<string, any>} */ const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };

/** A Z as a closure: its kind, the record as it was emitted (its time resolved), its id (`of`), the hash it was sealed on. */
function zClosure(z) {
  return { kind: /** @type {'z'|'month'|'year'} */ ('z'), ref: closureNo(z.number), of: z.id || 'Z:' + z.day, seal: z.seal, at: z.at, by: z.by, record: pick(z, Z_FIELDS) };
}
function periodClosure(p) {
  return { kind: /** @type {'z'|'month'|'year'} */ (p.kind), ref: p.ref, of: p.id, seal: p.seal, at: p.at, by: p.by, record: pick(p, PERIOD_FIELDS) };
}
/** @typedef {ReturnType<typeof zClosure>} Closure */

/** A closure by its reference (Z0012, M0003, Y0001), or null. @returns {Closure|null} */
export function closureOf(s, ref) {
  if (typeof ref !== 'string') return null;
  if (/^Z\d+$/.test(ref)) {
    const n = Number(ref.slice(1));
    for (const z of s.closures.values()) if (z.number === n) return zClosure(z);
    return null;
  }
  const p = s.periods && s.periods.get(ref);
  return p ? periodClosure(p) : null;
}
/** Every closure: the Z in order, then the months, then the years. @returns {Closure[]} */
export function allClosures(s) {
  const periods = [...(s.periods ? s.periods.values() : [])].sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === 'month' ? -1 : 1));
  return [...zList(s).map(zClosure), ...periods.map(periodClosure)];
}

/** What a signature covers: { ref, kind, of, seal, digest }, digest = sha256 of the canonical record. @param {Closure} c */
export const payloadOf = (c) => ({ ref: c.ref, kind: c.kind, of: c.of, seal: c.seal, digest: sha256(canonical(c.record)) });

/** The payload a closure's signature covers, from the state as it is now; null for an unknown reference. */
export function signedPayload(s, ref) {
  const c = closureOf(s, ref);
  return c ? payloadOf(c) : null;
}

/**
 * Whether this closure carries a valid signature by that public key, for the record as the state holds it now.
 * @returns {{ ok: boolean, why?: 'unknown'|'unsigned'|'key'|'digest'|'signature' }}
 */
export function verifySeal(s, ref, publicKeyPem) {
  const p = signedPayload(s, ref);
  if (!p) return { ok: false, why: 'unknown' };
  const sg = s.signatures && s.signatures.get(ref);
  if (!sg) return { ok: false, why: 'unsigned' };
  let kid = '';
  try { kid = kidOf(publicKeyPem); } catch { /* not a key */ }
  if (kid !== sg.kid) return { ok: false, why: 'key' };
  if (p.digest !== sg.digest || p.of !== sg.of) return { ok: false, why: 'digest' };
  return verifySig(publicKeyPem, canonical(p), sg.sig) ? { ok: true } : { ok: false, why: 'signature' };
}

/**
 * 'signed', 'late' (signed as backlog when a new key appeared), 'pending' (younger than the window, the next tick signs
 * it) or 'unsigned' (it will not be: listed as « non signée »).
 */
export function signatureState(s, ref, now) {
  const sg = s.signatures && s.signatures.get(ref);
  if (sg) return sg.late ? 'late' : 'signed';
  const c = closureOf(s, ref);
  return c && (signsAll(s) || now - c.at < SIGN_WINDOW) ? 'pending' : 'unsigned';
}
/** The closures with no signature, in order (CPT-02's « non signée » list). */
export const unsignedRefs = (s) => allClosures(s).filter((c) => !(s.signatures && s.signatures.has(c.ref))).map((c) => c.ref);
