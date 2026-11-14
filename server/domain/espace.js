// @ts-check
// « Mon espace » (TEAM-04): a barber's home, in one read. His next client with what is known of the cut, his day, his
// gaps, his figures toward his goal. Everything is computed on the server from what this person may see: his own
// appointments, his own figures, the salon in percent, never a colleague's money, a client's number or a colleague's
// client. Cards that depend on a module another package adds (walk-in turn, the late notice, a favourite barber) read it
// behind a guard, so nothing here needs them. Memoised per (journal version, person, day), for the current minute.
import { addDays, dayParts, diffDays, keyOf, localParts, monthStart, weekStart } from '../../shared/dates.js';
import { busyIntervals, intersect, occupies, staffIntervals, subtract } from './availability.js';
import { clientStats, goalOf, report } from './insights.js';
import { cutNotesOf } from '../projections/cutnotes.js';
import { reviewStats } from '../projections/reviews.js';
import { accountOf } from '../projections/accounts.js';
import { memberCards } from '../http/views.js';
import { fileIds } from '../commands/clients.js';
import { teamViewOf } from '../settings/team.js';
import * as availability from './availability.js';
import { rankOf, rankWords } from './formule.js';

/** a gap shorter than this is no room for a cut */
export const MIN_GAP = 20;
/** a birthday this close shows on the client's card and in « Anniversaires » */
export const BIRTHDAY_DAYS = 7;
const OPEN = new Set(['pending', 'booked', 'arrived', 'in_chair']);
const NOTE_DAYS = 14;
const KEEP_ALL = 20;

// On `version`, not `dataVersion` (core/state.js NO_FIGURES): his gaps and « libre jusqu’à » read the live holds
// (busyIntervals), « Avis » reads the review requests and their clicks (reviewStats: s.messages, s.reviewClicks). His
// figures and the clients' statistics come from insights.js, memoised on dataVersion: only the rest is put together again.
const cache = new WeakMap();
/** @template T @param {any} s @param {string} key @param {() => T} fn @returns {T} */
function memo(s, key, minute, fn) {
  let c = cache.get(s);
  if (!c || c.version !== s.version) { c = { version: s.version, m: new Map() }; cache.set(s, c); }
  // one entry per (person, day, caps), the current minute only: a quiet journal does not pile up a view per minute
  const hit = c.m.get(key);
  if (hit && hit.minute === minute) return hit.value;
  const value = fn();
  if (c.m.size >= 500) c.m.clear();
  c.m.set(key, { minute, value });
  return value;
}

/** « Karim B. » */
const nameOf = (c) => (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim();
const clientOf = (s, a) => (a.clientId ? s.clients.get(a.clientId) || null : null);
const nameOfAppt = (s, a) => { const c = clientOf(s, a); return c ? nameOf(c) : a.name || 'Client'; };

/**
 * In how many days a 'dd-mm' birthday falls (0 today, at most `within`), or null. A 29 February is kept on the 28th in
 * the years that have none.
 * @param {string} birthday @param {string} day @param {number} [within]
 * @returns {{ inDays: number, day: string } | null}
 */
export function birthdayIn(birthday, day, within = BIRTHDAY_DAYS) {
  const m = /^(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return null;
  const dd = +m[1], mm = +m[2];
  const y = dayParts(day).y;
  for (const year of [y, y + 1]) {
    // 31 April, 30 February: not a day; 29 February of a common year: the 28th
    const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    if (mm < 1 || mm > 12 || dd < 1 || (dd > last && !(mm === 2 && dd === 29))) continue;
    const at = keyOf(year, mm, Math.min(dd, last));
    const n = diffDays(day, at);
    if (n >= 0 && n <= within) return { inDays: n, day: at };
  }
  return null;
}

/** The late notice a client sent (AC-04), whatever its shape, as the little the card shows; null without one. */
function lateNoticeOf(s, a) {
  const n = (s.lateNotices && s.lateNotices.get && s.lateNotices.get(a.id)) || a.lateNotice || null;
  if (!n || typeof n !== 'object') return null;
  const min = Number(n.min ?? n.minutes);
  return { min: Number.isFinite(min) && min > 0 ? min : null, at: Number.isFinite(Number(n.at)) ? Number(n.at) : null };
}

/** Who a walk-in would go to (DO-06 walkinTurn), or null when that module is not there. */
function turnOf(s, day, serviceId) {
  const f = /** @type {any} */ (availability).walkinTurn;
  if (typeof f !== 'function') return null;
  try {
    const t = f(s, day, serviceId);
    return t && typeof t === 'object' ? t.staffId || t.id || null : t || null;
  } catch { return null; }
}

/** Is the first walk-in waiting for him? He asked for him, else DO-06's rotation says; null when nobody waits or the rotation is not there. */
function mineNext(s, me, day, first) {
  if (!first) return null;
  if (first.staffId === me.id) return true;
  const turn = turnOf(s, day, first.serviceId);
  return turn === null ? null : turn === me.id;
}

/**
 * What the Comptoir knows of the client about to sit down: how often he came, with whom, what was done last time.
 * @param {any} s @param {any} me @param {any} a his appointment @param {Map<string, any>} stats @param {number} now
 */
function clientView(s, me, a, stats, now) {
  const c = clientOf(s, a);
  if (!c || c.erased) return null;
  const st = stats.get(c.id) || {};
  const ids = fileIds(s, c);
  const set = new Set(ids);
  /** @type {any} */
  let last = null, withMe = 0;
  for (const b of s.appts.values()) {
    if (!set.has(b.clientId) || b.status !== 'done') continue;
    if (b.staffId === me.id) withMe++;
    if (!last || b.day > last.day || (b.day === last.day && b.start > last.start)) last = b;
  }
  const member = memberCards(s, c.id, now, false).find((x) => x.status !== 'pending');
  const pack = member ? null : [...s.packs.values()].find((k) => set.has(k.clientId) && k.used < k.total && k.expires >= localParts(now).day);
  const acc = accountOf(s, ids);
  const bday = birthdayIn(c.birthday, localParts(now).day);
  return {
    id: c.id, name: nameOf(c), visits: st.visits || 0, withMe, firstVisit: !(st.visits > 0),
    // d'habitude avec toi: he did most of the cuts, and there are enough of them to say so
    usual: st.favStaff === me.id && (st.visits || 0) >= 2,
    lastCut: last ? { day: last.day, staffName: (s.staff.get(last.staffId) || {}).name || '', services: last.services.map((x) => x.name) } : null,
    cadence: st.cadence || null, birthdaySoon: bday, noShows: st.noShows || 0,
    member: member ? { kind: 'member', label: member.plan, used: member.used, of: member.of, ...(member.rhythm ? { rhythm: member.rhythm, perWeek: member.perWeek, missed: member.missed, week: member.week } : {}) } : pack ? { kind: 'carnet', label: pack.name, used: pack.used, of: pack.total } : null,
    prefersMe: !!(acc && acc.prefs && acc.prefs.staffId === me.id)
  };
}

/** Who a note is shown under: the barber of the cut, and the writer when it was not him (the desk, the owner). */
export const noteWho = (s, x) => ({ staff: (s.staff.get(x.staffId) || {}).name || '', ...(x.by !== x.staffId ? { by: (s.staff.get(x.by) || {}).name || '' } : {}) });

/** The last three notes any barber left on this client's file before this visit, with who and when. */
function notesView(s, me, c, apptId, n = 3) {
  const ids = fileIds(s, c);
  return cutNotesOf(s, ids, KEEP_ALL).filter((x) => x.apptId !== apptId).slice(0, n).map((x) => ({ id: x.id, apptId: x.apptId, day: x.day, ...noteWho(s, x), mine: x.by === me.id, text: x.text, edited: x.prev.length > 0 }));
}

/** [start, end) pairs where he is free from `from` on: his work minus bookings, blocks, live holds. */
function gapsOf(s, me, day, from, now, appts) {
  let busy = busyIntervals(s, me.id, day, { now });
  // a client still in the chair after the end of his slot: busy until he is done
  for (const a of appts) if (a.status === 'in_chair' && a.start + a.dur < from) busy = busy.concat([[a.start, from]]);
  const free = subtract(intersect(staffIntervals(s, me.id, day), [[from, 1440]]), busy);
  return free.filter(([a, b]) => b - a >= MIN_GAP).map(([a, b]) => ({ start: a, end: b, dur: b - a }));
}

/** Where he stands right now: at the chair, free until…, or not working. */
function nowOf(s, me, day, min, now, appts) {
  const work = staffIntervals(s, me.id, day);
  const chair = appts.find((a) => a.status === 'in_chair');
  if (chair) return { min, status: 'busy', phase: 'chair', with: nameOfAppt(s, chair), until: Math.max(min, chair.start + chair.dur) };
  const inWork = work.find(([a, b]) => min >= a && min < b);
  if (!inWork) {
    const next = work.find(([a]) => a > min);
    const kind = !work.length ? 'none' : next ? (work.some(([, b]) => b <= min) ? 'break' : 'before') : 'after';
    return { min, status: 'off', kind, until: next ? next[0] : null };
  }
  const block = [...(s.blocksByDay.get(day) || [])].map((id) => s.blocks.get(id)).find((b) => b && b.staffId === me.id && b.start <= min && min < b.start + b.dur);
  if (block) return { min, status: 'busy', phase: 'block', label: block.label || '', until: block.start + block.dur };
  // a booking whose time has come: the client is there or expected, the chair is not free
  const due = appts.find((a) => OPEN.has(a.status) && occupies(a, now, s) && a.start <= min && min < a.start + a.dur);
  if (due) return { min, status: 'busy', phase: due.status === 'arrived' ? 'arrived' : 'expected', with: nameOfAppt(s, due), until: due.start + due.dur };
  const rest = subtract([[min, inWork[1]]], busyIntervals(s, me.id, day, { now }));
  const cur = rest.find(([a]) => a === min);
  return { min, status: 'free', until: cur ? cur[1] : min };
}

/** The six figures of one period, his own (TEAM-03's rows: Chiffre réalisé, refunds out, carnet and membership cuts in). */
function figuresOf(s, me, from, to, today, now) {
  const r = report(s, { from, to, staffId: me.id, today, now });
  const x = r.staff[0];
  return {
    from, to, performed: r.revenue, commission: x ? x.commission : 0, tips: r.tips, done: r.done, fill: r.occupancy, avgTicket: r.avgTicket, rebookRate: x ? x.rebookRate : 0
  };
}

/**
 * @param {any} s @param {any} me the signed-in chair @param {Set<string>} caps
 * @param {{ day: string, now: number }} q
 */
export function espaceView(s, me, caps, q) {
  const local = localParts(q.now);
  return memo(s, ['espace', me.id, q.day, [...caps].filter((c) => c.startsWith('report.') || c === 'agenda.all').sort().join(',')].join('|'), Math.floor(q.now / 60000), () => build(s, me, caps, q.day, q.now, local));
}

function build(s, me, caps, day, now, local) {
  const today = local.day;
  const isToday = day === today;
  const stats = clientStats(s, today, now);
  const all = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.staffId === me.id && a.status !== 'cancelled').sort((a, b) => a.start - b.start);
  // the clock the day is read at: now for today, the start of a coming day, the end of a past one
  const min = isToday ? local.min : day > today ? 0 : 1440;
  const late = (a) => (isToday && (a.status === 'booked' || a.status === 'pending') && min > a.start ? min - a.start : 0);
  const noted = (a) => !!(s.cutNoteOf && s.cutNoteOf.get(a.id));
  const queue = [...s.queue.values()].filter((x) => (x.status === 'waiting' || x.status === 'called') && now - x.at < 12 * 3600000 && (x.staffId === 'any' || x.staffId === me.id)).sort((a, b) => a.at - b.at);

  const list = all.map((a) => {
    const c = clientOf(s, a);
    const st = c ? stats.get(c.id) : null;
    return {
      id: a.id, start: a.start, dur: a.dur, name: nameOfAppt(s, a), clientId: c && !c.erased ? c.id : null, services: a.services.map((x) => x.name), status: a.status, late: late(a),
      firstVisit: !!c && !(st && st.visits > 0), paid: !!a.saleId, noted: noted(a), serie: rankWords(rankOf(s, a.id)),
      // done without a note from him: « + note » (a booking without a file has nowhere to keep one)
      needsNote: a.status === 'done' && !!c && !c.erased && !noted(a) && diffDays(a.day, today) <= NOTE_DAYS
    };
  });

  const nextAppt = isToday || day > today ? all.find((a) => OPEN.has(a.status) && occupies(a, now, s)) : null;
  let next = null;
  if (nextAppt) {
    const c = clientOf(s, nextAppt);
    const known = !!c && !c.erased;
    const mine = known && noted(nextAppt) ? cutNotesOf(s, fileIds(s, c), KEEP_ALL).find((x) => x.apptId === nextAppt.id) : null;
    next = {
      id: nextAppt.id, start: nextAppt.start, dur: nextAppt.dur, name: nameOfAppt(s, nextAppt), services: nextAppt.services.map((x) => x.name), status: nextAppt.status,
      late: late(nextAppt), paid: !!nextAppt.saleId, serie: rankWords(rankOf(s, nextAppt.id)), note: known ? c.notes || '' : '', tech: known ? c.tech || '' : '',
      client: clientView(s, me, nextAppt, stats, now),
      cutNotes: known ? notesView(s, me, c, nextAppt.id) : [],
      // the note already written for this very visit, to correct it
      myNote: mine ? mine.text : null,
      canNote: known && nextAppt.status === 'in_chair',
      lateNotice: lateNoticeOf(s, nextAppt)
    };
  }

  // the salon's progress, in percent: for a barber what TEAM-01 lets him see ('off' hides it), for the shop's holders always
  /** @type {any} */
  let salon = null;
  const shop = caps.has('report.shop');
  if (shop || teamViewOf(s.settings) !== 'off') {
    const m = report(s, { from: monthStart(today), to: today, staffId: null, today, now });
    const target = s.settings.goals.monthCents;
    salon = { goalPct: target > 0 ? Math.round((m.revenue / target) * 100) : null, fill: m.occupancy };
    if (!shop && caps.has('report.team')) {
      salon.team = m.staff.filter((x) => s.staff.get(x.id)?.active && s.staff.get(x.id)?.chair)
        .map((x) => ({ id: x.id, name: x.name, color: x.color, revenue: x.revenue, done: x.done, occupancy: x.occupancy, rebookRate: x.rebookRate, noShows: x.noShows, avgTicket: x.avgTicket }));
    }
  }

  // his figures: his own Chiffre réalisé, never a colleague's; his goal unless the owner keeps goals to himself
  let figures = null;
  if (caps.has('report.own') || shop) {
    const showGoal = shop || /** @type {any} */ (s.settings.goals).showBarbers !== false;
    figures = {
      day: figuresOf(s, me, today, today, today, now), week: figuresOf(s, me, weekStart(today), today, today, now), month: figuresOf(s, me, monthStart(today), today, today, now),
      goal: showGoal ? goalOf(s, me.id, today, now) : null
    };
  }

  // the regulars of his chair with a birthday coming: by the barber they come to most (a favourite barber's list comes with FID-05)
  const birthdays = [];
  for (const c of s.clients.values()) {
    if (c.erased || c.mergedInto || !c.birthday) continue;
    const st = stats.get(c.id);
    if (!st || st.favStaff !== me.id || !(st.visits >= 2)) continue;
    const b = birthdayIn(c.birthday, today);
    if (b) birthdays.push({ id: c.id, name: nameOf(c), inDays: b.inDays, day: b.day });
  }
  birthdays.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name, 'fr'));

  const rv = reviewStats(s, monthStart(today), today, me.id);
  const timeoff = [...s.timeoff.values()].filter((t) => t.staffId === me.id && t.to >= today).sort((a, b) => a.from.localeCompare(b.from));
  const asked = [...s.timeoffRequests.values()].filter((t) => t.staffId === me.id && t.status === 'pending' && t.to >= today).sort((a, b) => a.from.localeCompare(b.from));

  return {
    day, today, now: isToday ? nowOf(s, me, day, local.min, now, all) : null,
    next, list,
    gaps: gapsOf(s, me, day, Math.ceil(min / 5) * 5, now, all),
    walkins: isToday ? { waiting: queue.length, mineNext: mineNext(s, me, day, queue[0]) } : { waiting: 0, mineNext: null },
    figures,
    birthdays: birthdays.slice(0, 6),
    reviews: rv.on ? { sent: rv.sent, opened: rv.opened } : null,
    absences: { next: timeoff[0] ? { id: timeoff[0].id, from: timeoff[0].from, to: timeoff[0].to } : null, pending: asked.map((t) => ({ id: t.id, from: t.from, to: t.to })) },
    salon
  };
}

/** how far ahead the barber's planning reaches: today and the 13 days after */
export const PLAN_DAYS = 14;

/**
 * FEATURE C · « Mon planning »: one day of his chair, today or one of the next ones (a past day too, read-only): his
 * bookings in order, his free gaps, his breaks (between his working hours, and the blocks he or the desk put), his
 * absence, the day's total; and the strip of the 14 days from today with what each holds. His own column only.
 * readOnly: a day gone by or already sealed (Z): nothing on it moves any more.
 * @param {any} s @param {any} me @param {{ day: string, now: number }} q
 */
export function planningView(s, me, q) {
  const local = localParts(q.now);
  return memo(s, ['plan', me.id, q.day].join('|'), Math.floor(q.now / 60000), () => buildPlanning(s, me, q.day, q.now, local.day, local.min));
}

const openOf = (s, me, day) => [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.staffId === me.id && a.status !== 'cancelled');
const absenceOn = (s, me, day) => [...s.timeoff.values()].find((t) => t.staffId === me.id && day >= t.from && day <= t.to && !(t.status === 'pending' || t.status === 'refused')) || null;
const askedOn = (s, me, day) => [...s.timeoffRequests.values()].find((t) => t.staffId === me.id && t.status === 'pending' && day >= t.from && day <= t.to) || null;

function buildPlanning(s, me, day, now, today, nowMin) {
  const isToday = day === today;
  const appts = openOf(s, me, day).sort((a, b) => a.start - b.start);
  const work = staffIntervals(s, me.id, day);
  const min = isToday ? nowMin : day > today ? 0 : 1440;
  // breaks: the holes between his working hours, and the blocks of his column
  const breaks = [];
  const off = absenceOn(s, me, day);
  // a part-day absence cuts a hole in his hours: it reads as the absence, not as a pause
  const part = off && off.startMin != null && off.from === off.to ? [off.startMin, off.endMin] : null;
  for (let i = 1; i < work.length; i++) {
    const [start, end] = [work[i - 1][1], work[i][0]];
    breaks.push({ start, end, label: part && start < part[1] && end > part[0] ? off.reason || 'Absence' : 'Pause' });
  }
  for (const id of s.blocksByDay.get(day) || []) { const b = s.blocks.get(id); if (b && b.staffId === me.id) breaks.push({ start: b.start, end: b.start + b.dur, label: b.label || 'Bloqué' }); }
  breaks.sort((a, b) => a.start - b.start);
  const asked = askedOn(s, me, day);
  const closed = s.settings.closures.some((c) => day >= c.from && day <= c.to);
  const rows = appts.map((a) => ({
    id: a.id, start: a.start, dur: a.dur, name: nameOfAppt(s, a), services: a.services.map((x) => x.name), status: a.status, price: a.price || 0,
    paid: !!a.saleId, note: a.note || '', serie: rankWords(rankOf(s, a.id)),
    late: isToday && (a.status === 'booked' || a.status === 'pending') && min > a.start ? min - a.start : 0
  }));
  const counted = rows.filter((r) => r.status !== 'no_show');
  const total = { count: counted.length, minutes: counted.reduce((t, r) => t + r.dur, 0), cents: counted.reduce((t, r) => t + r.price, 0), work: work.reduce((t, [a, b]) => t + b - a, 0) };
  const strip = [];
  for (let i = 0; i < PLAN_DAYS; i++) {
    const d = addDays(today, i);
    const w = staffIntervals(s, me.id, d);
    strip.push({ day: d, count: openOf(s, me, d).filter((a) => a.status !== 'no_show').length, works: w.length > 0, off: !!absenceOn(s, me, d) });
  }
  return {
    day, today, readOnly: day < today || s.closures.has(day), work, breaks, rows, total,
    gaps: work.length ? gapsOf(s, me, day, Math.ceil(min / 5) * 5, now, appts) : [],
    absence: off ? { id: off.id, from: off.from, to: off.to, reason: off.reason || 'Absence', part: off.startMin != null && off.from === off.to ? { start: off.startMin, end: off.endMin } : null } : null,
    asked: asked ? { id: asked.id, from: asked.from, to: asked.to } : null,
    closed, strip
  };
}

