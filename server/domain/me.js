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
import { bookerOf, guestFirst, notifyOptions, viaOf } from './notify.js';

/** A booked appointment can be announced late from 2 h before its start to 15 min after (AC-04's « J’ai du retard »). */
const LATE_BEFORE = 2 * 3600000, LATE_AFTER = 15 * 60000;
const dayOfMs = (ms) => localParts(ms).day;

/**
 * @typedef {{ now: number, today: string, tokenFor: (a: any) => string, origin: string, receiptFor?: (sale: any) => string, demo?: boolean }} MeCtx
 */

/**
 * What the space may say of the file's holder. Unnamed (the first name was not given at the opening: maybe the new holder
 * of a recycled number): nothing, not even the name he could not give. Fenced: the first name he gave, not the last name
 * nor the birthday of a file that may be someone else's.
 * @param {any} c @param {any} account
 */
export function shownIdentity(c, account) {
  const named = !account || account.named !== false;
  const fenced = !!(account && account.fenced);
  return { first: named ? c.first || '' : '', last: named && !fenced ? c.last || '' : '', birthday: named && !fenced ? c.birthday || '' : '' };
}

const staffOf = (s, id) => { const st = id ? s.staff.get(id) : null; return st ? { id: st.id, name: st.name, initials: st.initials || '', color: st.color || '' } : null; };
/** From the fence's day on (inclusive): what a fenced account may show. */
const after = (account, day) => !account || !account.fenced || !account.historyFrom || day >= account.historyFrom;

/** The bookings to come of these files, soonest first: booked, or pending while their deposit can still be paid. */
export function upcomingOfFiles(s, ids, now, account = null) {
  const set = new Set(ids);
  return [...s.appts.values()]
    // FEATURE B: the bookings he made for someone else (a child, a friend) are his to follow too
    .filter((a) => (set.has(a.clientId) || set.has(bookerOf(a, s) || '')) && !a.legacy && (a.status === 'booked' || a.status === 'pending') && occupies(a, now, s) && startsAt(a) > now && after(account, dayOfMs(a.createdAt)))
    .sort((a, b) => startsAt(a) - startsAt(b));
}

/** The first name of the person a booking is for, when someone else booked it for him; '' otherwise. */
const forWhom = (s, a) => guestFirst(s, a);

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
    lateOk: a.status === 'booked' && ctx.now >= start - LATE_BEFORE && ctx.now <= start + LATE_AFTER,
    // FEATURE B: « préviens-moi si un créneau se libère plus tôt », and for whom when he booked it for someone else
    earlier: !!a.earlier, forFirst: forWhom(s, a)
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
  const who = shownIdentity(c, account);
  return {
    ...who, since: account ? account.since : 0, fenced, historyFrom: fenced ? account.historyFrom : null,
    // the switches stay usable; when the previous holder said yes to offers is his, not shown to an unnamed space
    consent: { sms: c.sms !== false, marketing: !!c.marketing, marketingAt: account && account.named === false ? null : c.marketingAt || null },
    // FEATURE B: how the salon reaches him (reminders, « un créneau s'est libéré »), among the ways it can
    notify: { via: viaOf(s, c), options: notifyOptions(s, c) },
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

/* ---------------- FEATURE B · « Ce qui manque » and the payments ---------------- */

const DAY_MS = 86400000;
/** A carnet or a gift card that ends within this many days is said in « Ce qui manque ». */
export const SOON_DAYS = 30;
const daysTo = (today, day) => Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / DAY_MS);

/**
 * GET /api/me/todo: what needs the client's attention, most urgent first, and his payments (memberships charged,
 * deposits paid or given back), newest first. `member` is the membership as the member page reads it (memberView), or null.
 * Each item: { id, tone: 'warn' | 'info', title, text, action?: { kind: 'link' | 'card' | 'membership', label, href? } }.
 * @param {any} s @param {string[]} ids @param {any} account @param {MeCtx} ctx @param {any} member
 */
export function meTodo(s, ids, account, ctx, member) {
  const set = new Set(ids);
  const today = ctx.today;
  /** @type {any[]} */
  const items = [];
  // 1. a booking that waits for its deposit
  for (const a of upcomingOfFiles(s, ids, ctx.now, account)) {
    if (a.status !== 'pending' || !a.deposit || (a.deposit.paid || 0) >= a.deposit.amount) continue;
    items.push({ id: 'dep_' + a.code, tone: 'warn', title: 'Acompte à régler', amount: a.deposit.amount, day: a.day, start: a.start, action: { kind: 'link', label: 'Régler l’acompte', href: '/r/' + ctx.tokenFor(a) } });
  }
  // 2. the membership: a payment refused first, then the cuts left, the end, the next charge
  if (member && member.status !== 'ended') {
    const m = member;
    if (m.pastDue) items.push({ id: 'mb_pastdue', tone: 'warn', title: 'Paiement de l’abonnement refusé', amount: m.plan.price, bank: !!m.pastDue.action, action: m.actions && m.actions.card ? { kind: 'card', label: m.pastDue.action ? 'Valider le paiement' : 'Mettre ma carte à jour' } : { kind: 'membership', label: 'Voir mon abonnement' } });
    const left = Math.max(0, (m.of || 0) - (m.used || 0));
    if (m.period && m.period.paid && left > 0 && !m.week) {
      const d = daysTo(today, m.period.last);
      items.push({ id: 'mb_left', tone: d <= 7 ? 'warn' : 'info', title: left > 1 ? left + ' coupes incluses à utiliser' : '1 coupe incluse à utiliser', until: m.period.last, action: { kind: 'link', label: 'Réserver ma coupe', href: '/?reserver' } });
    }
    if (m.cancel) items.push({ id: 'mb_cancel', tone: 'info', title: 'Abonnement résilié', until: m.cancel.last });
    else if (m.next) items.push({ id: 'mb_next', tone: 'info', title: 'Prochain prélèvement', amount: m.next.amount, day: m.next.day, card: m.card || '' });
  }
  // 3. carnet cuts and gift card balances that end soon
  for (const k of s.packs.values()) {
    if (!set.has(k.clientId) || k.voided || k.used >= k.total || k.expires < today || daysTo(today, k.expires) > SOON_DAYS || !after(account, dayOfMs(k.soldAt))) continue;
    items.push({ id: 'pk_' + k.id, tone: 'warn', title: 'Carnet bientôt expiré', left: k.total - k.used, until: k.expires, action: { kind: 'link', label: 'Réserver une coupe', href: '/?reserver' } });
  }
  for (const g of s.giftcards.values()) {
    if (!set.has(g.cid) || g.status !== 'active' || g.balance <= 0 || g.expires < today || daysTo(today, g.expires) > SOON_DAYS || !after(account, dayOfMs(g.issuedAt))) continue;
    items.push({ id: 'gc_' + g.id, tone: 'info', title: 'Carte cadeau bientôt expirée', amount: g.balance, until: g.expires, last4: g.last4 });
  }
  const rank = (x) => (x.tone === 'warn' ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b));

  // the payments: each membership month charged, each deposit paid (and what came back)
  /** @type {{ at: number, kind: 'membership' | 'deposit' | 'refund', label: string, amount: number }[]} */
  const payments = [];
  for (const m of s.members ? s.members.values() : []) {
    if (!set.has(m.cid)) continue;
    for (const p of m.periods || []) if (p.amount > 0 && after(account, dayOfMs(p.at))) payments.push({ at: p.at, kind: 'membership', label: 'Abonnement ' + m.name, amount: p.amount });
  }
  const mineAppts = new Set([...s.appts.values()].filter((a) => set.has(a.clientId) || set.has(bookerOf(a, s) || '')).map((a) => a.id));
  for (const py of s.payments.values()) {
    if (py.kind !== 'deposit' || !mineAppts.has(py.apptId) || !py.paidAt || !after(account, dayOfMs(py.paidAt))) continue;
    payments.push({ at: py.paidAt, kind: 'deposit', label: 'Acompte en ligne', amount: py.amount });
    for (const rf of py.refunds || []) payments.push({ at: rf.at, kind: 'refund', label: 'Acompte remboursé', amount: rf.amount });
  }
  payments.sort((a, b) => b.at - a.at);
  return { items, payments: payments.slice(0, 24) };
}
