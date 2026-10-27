// @ts-check
// When can someone sit in a chair. Everything here is pure: state in, intervals out.
// Intervals are [start, end) in minutes after local midnight.
import { weekday, diffDays } from '../../shared/dates.js';
import { payDeadline } from './policy.js';

/** @typedef {import('../core/state.js').State} State */
/** @typedef {[number, number]} Iv */

/** @param {Iv[]} a @param {Iv[]} b */
export function intersect(a, b) {
  const out = /** @type {Iv[]} */ ([]);
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const s = Math.max(a0, b0), e = Math.min(a1, b1);
    if (e > s) out.push([s, e]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}
/** @param {Iv[]} a @param {Iv[]} cut */
export function subtract(a, cut) {
  let cur = a.map((x) => /** @type {Iv} */ ([x[0], x[1]]));
  for (const [c0, c1] of cut) {
    const next = /** @type {Iv[]} */ ([]);
    for (const [s, e] of cur) {
      if (c1 <= s || c0 >= e) { next.push([s, e]); continue; }
      if (c0 > s) next.push([s, c0]);
      if (c1 < e) next.push([c1, e]);
    }
    cur = next;
  }
  return cur;
}

/**
 * Time off not decided yet (DO-05: a barber's own request waits for the owner) or turned down: it takes no slot away
 * and the site says nothing of it.
 */
export const UNDECIDED = new Set(['requested', 'pending', 'refused', 'rejected']);

/** The exceptional opening of that day, if any (one per day: settings/hours.js). */
export function openingOn(s, day) {
  return (s.settings.openings || []).find((o) => o.day === day) || null;
}

/** Shop opening hours for a day: a closure beats an exceptional opening, which beats the usual week. */
export function shopIntervals(s, day) {
  if (s.settings.closures.some((c) => day >= c.from && day <= c.to)) return [];
  const op = openingOn(s, day);
  return ((op && op.intervals) || s.settings.hours[weekday(day)] || []).map((x) => /** @type {Iv} */ ([x[0], x[1]]));
}

/**
 * When a staff member works that day: their week template ∩ shop hours − time off. On an exceptional opening, a
 * barber it names works the opening's hours (a longer Saturday before Christmas); on a day the salon is usually
 * closed, 'all' gives them to every barber whose template is empty that weekday. Anyone else keeps his own hours,
 * inside the opening's: on a usual day, 'all' only changes the salon's hours (an early close on the 24th).
 */
export function staffIntervals(s, staffId, day) {
  const st = s.staff.get(staffId);
  if (!st || !st.active || !st.chair) return [];
  const wd = weekday(day);
  let tpl = (st.schedule && st.schedule[wd]) || [];
  const op = openingOn(s, day);
  const named = !!op && Array.isArray(op.staff) && op.staff.includes(staffId);
  if (op && (named || (!tpl.length && !Array.isArray(op.staff) && !(s.settings.hours[wd] || []).length))) tpl = op.intervals;
  let iv = intersect(shopIntervals(s, day), tpl);
  for (const t of s.timeoff.values()) {
    if (t.staffId !== staffId || day < t.from || day > t.to || UNDECIDED.has(t.status)) continue;
    if (t.startMin == null || t.from !== t.to) return [];
    iv = subtract(iv, [[t.startMin, t.endMin]]);
  }
  return iv;
}

export function canDo(st, serviceIds) {
  if (!st || st.services === 'all' || !st.services) return true;
  return serviceIds.every((id) => st.services.includes(id));
}

/** Appointment that still occupies its time. */
export function occupies(a, now, s) {
  if (a.status === 'cancelled' || a.status === 'no_show') return false;
  if (a.status === 'pending') return payDeadline(s, a) > now;
  return true;
}

/**
 * Busy intervals of one chair on one day.
 * @param {State} s
 * @param {{ now: number, ignoreHold?: string|null, ignoreAppt?: string|null }} o
 */
export function busyIntervals(s, staffId, day, o) {
  const out = /** @type {Iv[]} */ ([]);
  for (const id of s.apptsByDay.get(day) || []) {
    const a = s.appts.get(id);
    if (a && a.staffId === staffId && a.id !== o.ignoreAppt && occupies(a, o.now, s)) out.push([a.start, a.start + a.dur]);
  }
  for (const id of s.blocksByDay.get(day) || []) {
    const b = s.blocks.get(id);
    if (b && b.staffId === staffId) out.push([b.start, b.start + b.dur]);
  }
  for (const h of s.holds.values()) {
    if (h.staffId === staffId && h.day === day && h.exp > o.now && h.id !== o.ignoreHold) out.push([h.start, h.start + h.dur]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Is [start, start+dur) inside working time and clear of everything else? */
export function isFree(s, staffId, day, start, dur, o) {
  const end = start + dur;
  if (!staffIntervals(s, staffId, day).some(([a, b]) => start >= a && end <= b)) return false;
  return !busyIntervals(s, staffId, day, o).some(([a, b]) => a < end && start < b);
}

export function bookedMinutes(s, staffId, day, now) {
  let m = 0;
  for (const id of s.apptsByDay.get(day) || []) {
    const a = s.appts.get(id);
    if (a && a.staffId === staffId && occupies(a, now, s)) m += a.dur;
  }
  return m;
}

/** Staff who can take this booking, in display order. */
export function eligibleStaff(s, serviceIds, { online = false } = {}) {
  return [...s.staff.values()]
    .filter((st) => st.active && st.chair && (!online || st.bookable) && canDo(st, serviceIds))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** The earliest start a client may book online on `day`. Infinity when the day is out of range. */
export function minStartFor(s, day, local, { online = true } = {}) {
  const ahead = diffDays(local.day, day);
  if (ahead < 0) return Infinity;
  if (online && ahead > s.settings.booking.maxDaysAhead) return Infinity;
  if (ahead > 0) return 0;
  return online ? local.min + s.settings.booking.minNoticeMin : local.min;
}

/**
 * Free starts on one day.
 * @param {State} s
 * @param {{ day: string, dur: number, serviceIds: string[], staffId: string, now: number, local: { day: string, min: number }, online?: boolean, ignoreHold?: string|null, ignoreAppt?: string|null, step?: number }} q
 * @returns {{ m: number, staffId: string }[]}
 */
export function freeSlots(s, q) {
  const step = q.step || s.settings.booking.stepMin;
  const online = q.online !== false;
  if (online && !s.settings.booking.enabled) return [];
  // a sealed day (Z done, even early) takes nobody else: nothing could be paid
  if (s.closures.has(q.day)) return [];
  const minStart = minStartFor(s, q.day, q.local, { online });
  if (minStart === Infinity) return [];
  const pool = q.staffId && q.staffId !== 'any'
    ? eligibleStaff(s, q.serviceIds, { online }).filter((x) => x.id === q.staffId)
    : eligibleStaff(s, q.serviceIds, { online });
  if (!pool.length) return [];
  const o = { now: q.now, ignoreHold: q.ignoreHold || null, ignoreAppt: q.ignoreAppt || null };
  const per = pool.map((st) => ({ st, work: staffIntervals(s, st.id, q.day), busy: busyIntervals(s, st.id, q.day, o), load: bookedMinutes(s, st.id, q.day, q.now) }));
  const out = [];
  const shop = shopIntervals(s, q.day);
  if (!shop.length) return [];
  const first = Math.min(...shop.map((x) => x[0])), last = Math.max(...shop.map((x) => x[1]));
  for (let m = first; m + q.dur <= last; m += step) {
    if (m < minStart) continue;
    const end = m + q.dur;
    let best = null;
    for (const p of per) {
      if (!p.work.some(([a, b]) => m >= a && end <= b)) continue;
      if (p.busy.some(([a, b]) => a < end && m < b)) continue;
      if (!best || p.load < best.load) best = p;
    }
    if (best) out.push({ m, staffId: best.st.id });
  }
  return out;
}

/**
 * Estimated wait for someone walking in now, after the people already queued.
 * @returns {{ minutes: number|null, queued: number }}
 */
export function walkinEstimate(s, now, local, dur = 30) {
  const day = local.day;
  if (s.closures.has(day)) return { minutes: null, queued: 0 };
  const staff = eligibleStaff(s, []).filter((st) => staffIntervals(s, st.id, day).length);
  const start = Math.ceil(local.min / 5) * 5;
  if (!staff.length) return { minutes: null, queued: 0 };
  const extra = new Map(staff.map((st) => [st.id, /** @type {Iv[]} */ ([])]));
  const earliest = (ids, d) => {
    let best = null;
    for (const id of ids) {
      const work = staffIntervals(s, id, day);
      const busy = busyIntervals(s, id, day, { now }).concat(extra.get(id) || []);
      for (let t = start; t + d <= 1440; t += 5) {
        if (!work.some(([a, b]) => t >= a && t + d <= b)) { if (work.every(([, b]) => t >= b)) break; continue; }
        if (busy.some(([a, b]) => a < t + d && t < b)) continue;
        if (!best || t < best.t) best = { id, t };
        break;
      }
    }
    return best;
  };
  const waiting = [...s.queue.values()].filter((q) => q.status === 'waiting' || q.status === 'called').sort((a, b) => a.at - b.at);
  for (const q of waiting) {
    const sv = s.services.get(q.serviceId);
    const d = sv ? sv.dur : 30;
    const ids = q.staffId && q.staffId !== 'any' ? [q.staffId] : staff.map((x) => x.id);
    const b = earliest(ids.filter((id) => extra.has(id)), d);
    if (b) /** @type {Iv[]} */ (extra.get(b.id)).push([b.t, b.t + d]);
  }
  const mine = earliest(staff.map((x) => x.id), dur);
  return { minutes: mine ? Math.max(0, mine.t - local.min) : null, queued: waiting.length };
}
