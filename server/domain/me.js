// @ts-check
// AC-01 · What a signed-in client sees of himself (/moi): his next appointments with their /r/ links, his rhythm, what he
// holds (carnets, gift cards), his history with receipts. Read from the file and every file merged into it (ids); a
// fenced account (a number that may have changed hands, commands/accounts.js) shows nothing from before historyFrom.
// The shapes are the contract of web/src/moi/types.ts (Me, MeHistory). Other areas never extend /api/me/home: they add
// their own /api/me/<area> route file.
import { localParts } from '../../shared/dates.js';
import { occupies } from './availability.js';
import { startsAt } from './policy.js';
import { clientStats } from './insights.js';
import { rhythmOf, statsOfDays } from './rhythm.js';

/** A booked appointment can be announced late from 2 h before its start to 15 min after (AC-04's « J’ai du retard »). */
const LATE_BEFORE = 2 * 3600000, LATE_AFTER = 15 * 60000;
const dayOfMs = (ms) => localParts(ms).day;

/**
 * @typedef {{ now: number, today: string, tokenFor: (a: any) => string, origin: string, receiptFor?: (sale: any) => string, demo?: boolean }} MeCtx
 */

const staffOf = (s, id) => { const st = id ? s.staff.get(id) : null; return st ? { id: st.id, name: st.name, initials: st.initials || '', color: st.color || '' } : null; };
/** From the fence's day on (inclusive): what a fenced account may show. */
const after = (account, day) => !account || !account.fenced || !account.historyFrom || day >= account.historyFrom;

/** The bookings to come of these files, soonest first: booked, or pending while their deposit can still be paid. */
export function upcomingOfFiles(s, ids, now, account = null) {
  const set = new Set(ids);
  return [...s.appts.values()]
    .filter((a) => set.has(a.clientId) && !a.legacy && (a.status === 'booked' || a.status === 'pending') && occupies(a, now, s) && startsAt(a) > now && after(account, dayOfMs(a.createdAt)))
    .sort((a, b) => startsAt(a) - startsAt(b));
}

function upcomingView(s, a, ctx) {
  const pay = a.deposit && a.deposit.paymentId ? s.payments.get(a.deposit.paymentId) : [...s.payments.values()].find((p) => p.apptId === a.id && p.kind === 'deposit' && p.status === 'pending');
  const token = ctx.tokenFor(a);
  const start = startsAt(a);
  const changeUntil = start - s.settings.booking.cancelUntilHours * 3600000;
  return {
    id: a.id, code: a.code, token, manage: ctx.origin + '/r/' + token, day: a.day, start: a.start, dur: a.dur, status: a.status,
    services: a.services.map((x) => ({ id: x.id, name: x.name, price: x.price })), price: a.price,
    staff: staffOf(s, a.staffId), anyStaff: !!a.anyStaff,
    deposit: a.deposit ? { amount: a.deposit.amount, paid: a.deposit.paid || 0, url: pay && pay.status === 'pending' ? pay.url || null : null } : null,
    canChange: ctx.now < changeUntil, changeUntil,
    lateOk: a.status === 'booked' && ctx.now >= start - LATE_BEFORE && ctx.now <= start + LATE_AFTER
  };
}

/** The visit days of these files from the fence on (a done visit, or a ticket with a service and no booking), as clientStats counts them. */
function visitDays(s, ids, account) {
  const set = new Set(ids);
  const days = [];
  for (const a of s.appts.values()) if (set.has(a.clientId) && a.status === 'done' && after(account, a.day)) days.push(a.day);
  for (const x of s.sales.values()) if (set.has(x.clientId) && !x.apptId && x.lines.some((l) => l.kind === 'service') && after(account, x.day)) days.push(x.day);
  return days;
}

/** The services of the last done visit still bookable online, and its barber if he still takes bookings; null without one. */
function usualOf(s, ids, account) {
  const set = new Set(ids);
  let last = null;
  for (const a of s.appts.values()) if (set.has(a.clientId) && a.status === 'done' && after(account, a.day) && (!last || a.day > last.day || (a.day === last.day && a.start > last.start))) last = a;
  if (!last) return null;
  const serviceIds = last.services.map((x) => x.id).filter((id) => { const sv = s.services.get(id); return sv && sv.active && sv.online !== false; });
  if (!serviceIds.length) return null;
  const st = s.staff.get(last.staffId);
  return { serviceIds, staffId: st && st.active && st.bookable ? st.id : null };
}

/**
 * GET /api/me/home.
 * @param {any} s @param {any} c the file (root) @param {string[]} ids it and the files merged into it
 * @param {any} account accountOf(s, ids) @param {MeCtx} ctx
 */
export function meHome(s, c, ids, account, ctx) {
  const set = new Set(ids);
  const fenced = !!(account && account.fenced);
  const stats = fenced ? statsOfDays(visitDays(s, ids, account)) : clientStats(s, ctx.today, ctx.now).get(c.id);
  const carnets = [...s.packs.values()]
    .filter((k) => set.has(k.clientId) && !k.voided && k.used < k.total && k.expires >= ctx.today && after(account, dayOfMs(k.soldAt)))
    .sort((a, b) => a.expires.localeCompare(b.expires))
    .map((k) => ({ id: k.id, name: k.name, left: k.total - k.used, total: k.total, expires: k.expires }));
  const giftcards = [...s.giftcards.values()]
    .filter((g) => set.has(g.cid) && g.status === 'active' && g.balance > 0 && g.expires >= ctx.today && after(account, dayOfMs(g.issuedAt)))
    .map((g) => ({ id: g.id, last4: g.last4, balance: g.balance, expires: g.expires }));
  const team = [...s.staff.values()].filter((x) => x.active && x.chair && x.bookable).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffOf(s, x.id));
  const sh = s.settings.shop;
  const prefStaff = account && account.prefs && account.prefs.staffId;
  return {
    first: c.first, last: c.last, birthday: c.birthday || '', since: account ? account.since : 0, fenced, historyFrom: fenced ? account.historyFrom : null,
    consent: { sms: c.sms !== false, marketing: !!c.marketing, marketingAt: c.marketingAt || null },
    prefs: { staffId: prefStaff && s.staff.get(prefStaff) && s.staff.get(prefStaff).active ? prefStaff : null },
    rhythm: rhythmOf(stats),
    usual: usualOf(s, ids, account),
    upcoming: upcomingOfFiles(s, ids, ctx.now, account).map((a) => upcomingView(s, a, ctx)),
    wallet: { carnets, giftcards },
    team,
    shop: { name: sh.name, address: [sh.address, [sh.zip, sh.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), phone: sh.phone, mapsUrl: sh.mapsUrl },
    demo: !!ctx.demo
  };
}

const PAST = new Set(['done', 'no_show', 'cancelled']);
const minuteOf = (ms) => localParts(ms).min;

/**
 * GET /api/me/history: visits, missed and cancelled bookings, and tickets without a booking (a walk-in), newest first,
 * `limit` at a time before the day `before` (a page never cuts a day in two, so the next one starts cleanly). A visit with
 * a ticket carries its receipt link, minted on read (no SMS).
 * @param {any} s @param {string[]} ids @param {{ before?: string|null, limit?: number, account?: any, receiptFor?: (sale: any) => string }} [o]
 */
export function meHistory(s, ids, o = {}) {
  const set = new Set(ids);
  const limit = Math.max(1, Math.min(50, o.limit || 20));
  const account = o.account || null;
  const keep = (day) => after(account, day) && (!o.before || day < o.before);
  const receipt = (x) => (x && o.receiptFor ? o.receiptFor(x) : null);
  /** @type {any[]} */
  const items = [];
  for (const a of s.appts.values()) {
    if (!set.has(a.clientId) || !PAST.has(a.status) || !keep(a.day)) continue;
    const sale = a.saleId ? s.sales.get(a.saleId) : null;
    items.push({
      day: a.day, start: a.start, services: a.services.map((x) => ({ id: x.id, name: x.name, price: x.price })), staff: staffOf(s, a.staffId),
      price: sale ? sale.totals.due : a.price, paid: sale ? sale.totals.due - (sale.refunded || 0) - (sale.refundedLiability || 0) : 0,
      status: a.status, receipt: a.status === 'done' ? receipt(sale) : null
    });
  }
  for (const x of s.sales.values()) {
    if (!set.has(x.clientId) || x.apptId || !keep(x.day)) continue;
    const lines = x.lines.filter((l) => l.kind === 'service' || l.kind === 'product');
    items.push({
      day: x.day, start: minuteOf(x.at), services: lines.map((l) => ({ id: l.ref || '', name: l.name, price: l.net })),
      staff: staffOf(s, (x.lines.find((l) => l.staffId) || {}).staffId), price: x.totals.due, paid: x.totals.due - (x.refunded || 0) - (x.refundedLiability || 0),
      status: 'done', receipt: receipt(x)
    });
  }
  items.sort((a, b) => b.day.localeCompare(a.day) || b.start - a.start);
  let end = Math.min(limit, items.length);
  while (end < items.length && items[end].day === items[end - 1].day) end++;
  return { items: items.slice(0, end), more: end < items.length };
}
