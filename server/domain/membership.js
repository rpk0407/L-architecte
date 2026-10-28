// @ts-check
// The monthly membership, read from the state: what a member's month covers, where he stands, what he is owed back.
// Pure: no clock, no I/O. The records are s.members (projections/memberships.js), the commands commands/memberships.js.
//
// One rule makes pause, dunning, late and out-of-order webhooks safe: the benefit exists only inside a PAID period
// (member.renewed). Periods are salon days, [start, end): the end day is the next period's first one. Around the
// renewal there are two tolerances, both counted in the period being collected:
//   - the renewal day itself, while nothing has failed: the provider charges that day and its webhook may come late;
//   - after a failed renewal (member.pastDue), graceDays (settings.membership, 7 by default) while the provider retries.
// The grace is the salon's: periodAt, statusOf and isLive take it (no default, so a screen and the till never disagree);
// statusIn, periodIn and liveIn read it from the state, the entry points for the routes and the screens (PAY-03/04/05).
//
// PAY-07: a plan may count by the week (rhythm 'week', shared/membership-words.js). 'lost' is the calendar week's rule
// here (cover, why 'week'); 'month' and 'free' ride on the derived cuts and minDays. A member from before reads 'month'.
import { addDays, dayParts, keyOf, localParts, MONTHS_FR, pad2 } from '../../shared/dates.js';
import { rhythmOf, perWeekOf, weekRule, weekOf, labelWords } from '../../shared/membership-words.js';

export const GRACE_DAYS = 7;
/** What a covered cut of an illimité plan is worth when the cuts are counted: four a month. */
export const UNLIMITED_SHARE = 4;

/** @typedef {'pending'|'active'|'grace'|'unpaid'|'paused'|'ending'|'ended'} MemberStatus 'paused' is reserved (no pause in v1). */

/** A salon day from a day or an instant. @param {string|number} at */
export const dayOf = (at) => (typeof at === 'string' ? at : localParts(at).day);

/** 31 January + 1 month = 28 (or 29) February: the day of the month, as far as that month goes. */
export function addMonths(day, n) {
  const p = dayParts(day);
  const t = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(t / 12), m = (t % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return keyOf(y, m, Math.min(p.d, last));
}

/** The grace a salon gives (settings.membership.graceDays). @param {any} s */
export const graceOf = (s) => { const g = s && s.settings && s.settings.membership ? s.settings.membership.graceDays : undefined; return Number.isInteger(g) ? g : GRACE_DAYS; };

/** Where the n-th period ends (n from 0), counted from the first one's start like a provider's billing anchor. */
export function periodEndAt(m, n) {
  const anchor = m.periods && m.periods.length ? m.periods[0].start : null;
  return anchor ? addMonths(anchor, n + 1) : null;
}

/**
 * The period that covers this day: a paid one ({ paid: true }), or the one being collected while the renewal is on its
 * way ({ renewing }) or failed within the grace ({ grace, until }: the first day without it). null: nothing covers it.
 * @param {any} m @param {string|number} at @param {number} grace the salon's (graceOf(s))
 * @returns {null | { start: string, end: string, paid: boolean, renewing?: boolean, grace?: boolean, until?: string, invoice?: string }}
 */
export function periodAt(m, at, grace) {
  const day = dayOf(at);
  const periods = m.periods || [];
  // ended by an event or past its cancellation: a period paid beyond it covers nothing (refunded, or the owner stopped it)
  if (m.ended || m.withdrawn || (m.cancel && m.cancel.effective <= day)) return null;
  // a month disputed by the bank (PAY-03): nothing is covered while the dispute is open, nor once it is lost
  if (disputeHeld(m)) return null;
  const paid = periods.find((p) => p.start <= day && day < p.end);
  if (paid) return { start: paid.start, end: paid.end, paid: true, invoice: paid.invoice };
  if (!m.activatedAt || !periods.length) return null;
  const last = periods[periods.length - 1];
  if (day < last.end) return null;
  const next = { start: last.end, end: periodEndAt(m, periods.length) || addMonths(last.end, 1), paid: false };
  if (m.pastDue) {
    const until = addDays(last.end, grace);
    return day < until ? { ...next, grace: true, until } : null;
  }
  return day === last.end ? { ...next, renewing: true } : null;
}

/** A chargeback open or lost on one of its months: billing held at the provider, no cut covered. @param {any} m */
export const disputeHeld = (m) => (m.disputes || []).some((x) => x.status === 'open' || x.status === 'lost');

/** Pending past its checkout's expiry: abandoned (derived, no event). @param {any} m @param {string|number} at */
export function abandoned(m, at) {
  if (m.activatedAt || m.ended) return false;
  return typeof at === 'number' ? !!m.exp && m.exp < at : !!m.exp && localParts(m.exp).day < at;
}

/**
 * Where a member stands on a day. 'pending': checkout not paid yet; 'ending': cancelled, still covered until the
 * effective day; 'grace': a renewal failed, cuts still included; 'unpaid': nothing covers today but the contract runs.
 * @param {any} m @param {string|number} at @param {number} grace the salon's (graceOf(s)) @returns {MemberStatus}
 */
export function statusOf(m, at, grace) {
  if (m.ended || m.withdrawn) return 'ended';
  if (!m.activatedAt) return abandoned(m, at) ? 'ended' : 'pending';
  const day = dayOf(at);
  if (m.cancel && m.cancel.effective <= day) return 'ended';
  const p = periodAt(m, day, grace);
  if (p && p.grace) return 'grace';
  if (p) return m.cancel ? 'ending' : 'active';
  return 'unpaid';
}
/** Why it ended, or '' while it runs. @param {any} m @param {string|number} at */
export function endReason(m, at) {
  if (m.withdrawn) return 'withdrawn';
  if (m.ended) return m.ended.reason || 'cancelled';
  if (!m.activatedAt) return abandoned(m, at) ? 'abandoned' : '';
  return m.cancel && m.cancel.effective <= dayOf(at) ? 'cancelled' : '';
}
/** A contract that runs: paid once, not ended. @param {any} m @param {string|number} at @param {number} grace */
export const isLive = (m, at, grace) => { const st = statusOf(m, at, grace); return st !== 'pending' && st !== 'ended'; };
/** The same, with the salon's grace read from the state. @param {any} s @param {any} m @param {string|number} at */
export const statusIn = (s, m, at) => statusOf(m, at, graceOf(s));
/** @param {any} s @param {any} m @param {string|number} at */
export const periodIn = (s, m, at) => periodAt(m, at, graceOf(s));
/** @param {any} s @param {any} m @param {string|number} at */
export const liveIn = (s, m, at) => isLive(m, at, graceOf(s));

const ddmm = (day) => { const p = dayParts(day); return pad2(p.d) + '/' + pad2(p.m); };

/** The weeks a year has, for what a weekly plan's cut is worth: a month is 12/52 of a year. */
const WEEKS_A_YEAR = 52;
/**
 * What one covered cut is worth: the barber's commission base (team.memberCredit) and the withdrawal's measure. A weekly
 * plan: a month's price over the cuts of its weeks (80 € for one a week: 18,46 €); a monthly one: over its cuts, or four.
 */
export function cutValue(m) {
  if (rhythmOf(m) === 'week') return Math.round((m.price * 12) / (WEEKS_A_YEAR * perWeekOf(m)));
  return Math.round(m.price / (m.cuts || UNLIMITED_SHARE));
}

/**
 * The till's line (shared/membership-words.js labelWords): « Abonnement · coupe 2/2 (26/09–25/10) », « Abonnement
 * illimité (03/11–02/12) », « Abonnement · semaine du 03/11 (1/1) ».
 * @param {any} m @param {number} used @param {{ start?: string, end?: string, week?: { start: string } | null }} [period]
 */
export const label = (m, used, period = {}) => labelWords(m, used, period);

/** The covered cuts of a member from one day to another ([from, to)). @param {any} m @param {string} from @param {string} to */
const usesBetween = (m, from, to) => (m.uses || []).filter((u) => u.day >= from && u.day < to).length;

/**
 * The weeks of the billing period that covers this day, Monday to Sunday (the first and the last may reach outside it:
 * a week is the salon's, whatever day the month started), each with whether he had a covered cut in it and whether it
 * has begun. [] when nothing covers the day. FID-04 reads it for its idle member.
 * @param {any} s @param {any} m @param {string|number} at
 * @returns {{ start: string, end: string, came: boolean, cuts: number, future: boolean }[]}
 */
export function weeksOf(s, m, at) {
  const day = dayOf(at);
  const p = periodAt(m, day, graceOf(s));
  if (!p) return [];
  const out = [];
  for (let w = weekOf(p.start).start; w < p.end && out.length < 7; w = addDays(w, 7)) {
    const n = usesBetween(m, w, addDays(w, 7));
    out.push({ start: w, end: addDays(w, 6), came: n > 0, cuts: n, future: w > day });
  }
  return out;
}

/** The covered cuts of the calendar week of a day, and how many it allows. @param {any} m @param {string} day */
export function weekUse(m, day) {
  const w = weekOf(day);
  return { start: w.start, end: w.end, used: usesBetween(m, w.start, w.next), of: perWeekOf(m) || 0 };
}

/**
 * May this member's plan pay for that service on that day? pending: covered cuts of this member already on the ticket
 * being rung up (not in the state yet).
 * @param {any} s @param {any} m @param {string} serviceId
 * @param {{ at?: number, day?: string, pending?: number }} [o]
 * A weekly plan (PAY-07) says its calendar week (week: Monday, Sunday); 'lost' counts the cuts of that week (used, of =
 * perWeek: the bookings to come are policy.js's) and refuses why 'week', the next Monday as next.
 * @returns {{ ok: boolean, why?: 'ended'|'paused'|'unpaid'|'service'|'quota'|'soon'|'week', used: number, of: number, until: string|null, next?: string, start?: string, end?: string, week?: { start: string, end: string } }}
 */
export function cover(s, m, serviceId, o = {}) {
  const day = o.day || dayOf(o.at ?? 0);
  const grace = graceOf(s);
  const pending = o.pending || 0;
  const st = statusOf(m, day, grace);
  const lost = weekRule(m);
  const no = (why, extra = {}) => ({ ok: false, why, used: 0, of: lost ? perWeekOf(m) : m.cuts, until: null, ...extra });
  if (st === 'ended') return no('ended');
  if (st === 'paused') return no('paused');
  const p = periodAt(m, day, grace);
  if (!p) return no('unpaid');
  const until = addDays(p.grace && p.until ? p.until : p.end, -1);
  const wk = rhythmOf(m) === 'week' ? weekOf(day) : null;
  // 'lost': the calendar week's cuts, wherever its month began; otherwise the billing month's
  const used = (lost && wk ? usesBetween(m, wk.start, wk.next) : (m.uses || []).filter((u) => u.periodStart === p.start).length) + pending;
  const base = { used, of: lost ? perWeekOf(m) : m.cuts, until, start: p.start, end: p.end, ...(wk ? { week: { start: wk.start, end: wk.end } } : {}) };
  if (!(m.serviceIds || []).includes(serviceId)) return { ok: false, why: 'service', ...base };
  if (lost && wk && used >= base.of) return { ok: false, why: 'week', ...base, next: wk.next };
  if (m.cuts && used >= m.cuts) return { ok: false, why: 'quota', ...base, next: p.end };
  if (m.minDays) {
    const last = pending ? day : (m.uses || []).reduce((x, u) => (u.day > x ? u.day : x), '');
    const next = last ? addDays(last, m.minDays) : '';
    if (next && day < next) return { ok: false, why: 'soon', ...base, next };
  }
  return { ok: true, ...base };
}

/** The till's words for a refusal (409), « Coupe déjà prise ce mois-ci (2/2) ». @param {any} c @param {string} [service] */
export function coverWords(c, service = '') {
  switch (c.why) {
    case 'quota': return 'Coupe déjà prise ce mois-ci (' + c.used + '/' + c.of + ')';
    case 'week': return (c.of > 1 ? 'Coupes de la semaine déjà prises' : 'Coupe de la semaine déjà prise') + ' (' + Math.min(c.used, c.of) + '/' + c.of + ')' + (c.next ? ' · prochaine lundi ' + ddmm(c.next) : '');
    case 'soon': return 'Prochaine coupe incluse le ' + ddmm(c.next);
    case 'unpaid': return 'Paiement de l’abonnement en attente';
    case 'paused': return 'Abonnement en pause';
    case 'service': return 'L’abonnement ne couvre pas « ' + service + ' »';
    case 'ended': return 'Cet abonnement est terminé';
    default: return '';
  }
}

/** "2 décembre": dates in the members' texts (GSM alphabet, no weekday). */
export const dateWords = (day) => { const p = dayParts(day); return (p.d === 1 ? '1er' : String(p.d)) + ' ' + MONTHS_FR[p.m - 1]; };

/**
 * Monthly recurring revenue on a day: what the members who will renew pay a month (active or in grace). Cancelled ones
 * still covered ('ending') are out: they pay nothing more.
 * @param {any} s @param {string|number} at
 */
export function mrr(s, at) {
  const grace = graceOf(s);
  let total = 0;
  for (const m of (s.members ? s.members.values() : [])) { const st = statusOf(m, at, grace); if (st === 'active' || st === 'grace') total += m.price; }
  return total;
}

/**
 * The 14-day withdrawal: the first payment less the cuts already taken at their value (Code de la consommation
 * L221-25, a service started on request during the period is paid for what was done). Never below 0.
 * @param {any} m @param {string|number} [at]
 */
export function withdrawRefund(m, at) {
  const first = m.periods && m.periods.length ? m.periods[0].amount : 0;
  const day = at == null ? null : dayOf(at);
  const used = (m.uses || []).filter((u) => day == null || u.day <= day).length;
  return Math.max(0, first - used * cutValue(m));
}
/** Withdrawal is open for 14 days from the contract (its first payment). @param {any} m @param {string|number} at */
export const canWithdraw = (m, at) => !!m.activatedAt && !m.ended && !m.withdrawn && dayOf(at) <= addDays(localParts(m.activatedAt).day, 14);

/** A file through its merges: the one kept. @param {any} s @param {string|null|undefined} cid */
export function rootOf(s, cid) {
  let c = cid ? s.clients.get(cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return c ? c.id : cid || null;
}

// one index per journal version: client lists ask for every file's members
const cache = new WeakMap();
/** Every member of a file and of the files merged into it, newest first. @param {any} s @param {string} clientId @returns {any[]} */
export function membersOf(s, clientId) {
  if (!s.members || !s.members.size) return [];
  let c = cache.get(s);
  if (!c || c.v !== s.version) {
    /** @type {Map<string, any[]>} */
    const by = new Map();
    for (const m of s.members.values()) { const k = rootOf(s, m.cid); const l = by.get(k); if (l) l.push(m); else by.set(k, [m]); }
    for (const l of by.values()) l.sort((a, b) => b.createdAt - a.createdAt);
    c = { v: s.version, by };
    cache.set(s, c);
  }
  return c.by.get(rootOf(s, clientId)) || [];
}
/**
 * The file's membership: the one that runs (paid, not ended by an event), else the newest still waiting for its
 * checkout, else null. Follows merged files.
 * @param {any} s @param {string} clientId
 */
export function memberOf(s, clientId) {
  const list = membersOf(s, clientId);
  return list.find((m) => m.activatedAt && !m.ended && !m.withdrawn) || list.find((m) => !m.activatedAt && !m.ended) || null;
}
