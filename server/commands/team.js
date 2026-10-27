// @ts-check
// The team: profiles, roles, working hours, time off (and the handover of its clients), credentials and shop devices.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, day, oneOf, id, week, either, parse } from '../lib/validate.js';
import { isEmail as isEmailLike } from '../lib/util.js';
import { getStaff, getAppt, checkIntervals, COLORS } from './common.js';
import { addDays, diffDays, dayParts, fmtTime, DAYS_FR } from '../../shared/dates.js';
import { isFree, eligibleStaff, staffIntervals, bookedMinutes, occupies } from '../domain/availability.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { clientMayChange } from '../domain/policy.js';
import { moveAppointment, cancelAppointment } from './agenda.js';

const roles = /** @type {const} */ (['owner', 'manager', 'desk', 'barber']);
const staffShape = {
  name: str({ min: 2, max: 40 }), role: oneOf(roles), color: opt(str({ pattern: /^#[0-9A-Fa-f]{6}$/, max: 7 })), initials: opt(str({ min: 1, max: 3 })),
  bookable: opt(bool()), chair: opt(bool()), services: opt(either([oneOf(/** @type {const} */ (['all'])), arr(id(), { max: 80 })])),
  schedule: opt(week()), commission: opt(obj({ service: int({ min: 0, max: 10000 }), product: int({ min: 0, max: 10000 }) })),
  bio: opt(str({ max: 280 })), instagram: opt(str({ max: 120 })), order: opt(int({ min: 0, max: 99 })), email: opt(str({ max: 120, lower: true }))
};
const addSchema = obj(staffShape);
const patchSchema = obj(Object.fromEntries(Object.entries(staffShape).map(([k, v]) => [k, /** @type {any} */ (opt(v))])));

function initialsOf(name) {
  const w = name.replace(/^(le|la|les|l’|l')\s+/i, '').split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}
function checkSchedule(sc) { if (sc) for (const k of Object.keys(sc)) checkIntervals(sc[k], 'horaires'); }
function owners(s) { return [...s.staff.values()].filter((x) => x.active && x.role === 'owner'); }

export const addStaff = {
  run(s, input, ctx) {
    ctx.need('team');
    const x = parse(addSchema, input);
    if (x.role === 'owner' && ctx.staff?.role !== 'owner') fail(403, 'forbidden', 'Seul le gérant peut nommer un autre gérant.');
    if (x.email && !isEmailLike(x.email)) fail(400, 'invalid', 'E-mail invalide.');
    if (x.email && [...s.staff.values()].some((o) => o.email === x.email)) fail(409, 'exists', 'Cet e-mail est déjà utilisé par un membre de l’équipe.');
    checkSchedule(x.schedule);
    const sid = ctx.id('st');
    const { email, ...rest } = x;
    const staff = {
      color: COLORS[s.staff.size % COLORS.length], initials: initialsOf(x.name), bookable: x.role === 'barber', chair: x.role === 'barber' || x.role === 'owner',
      services: 'all', schedule: { ...s.settings.hours }, commission: { service: 4000, product: 1000 }, order: s.staff.size, ...rest
    };
    ctx.emit('staff.added', { id: sid, staff }, email ? { email } : undefined);
    return { id: sid };
  }
};

export const updateStaff = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    const self = ctx.staff && ctx.staff.id === st.id;
    const patch = parse(patchSchema, input.patch || {});
    const selfOnly = ['bio', 'instagram', 'color'];
    if (!ctx.can('team') && !(self && Object.keys(patch).every((k) => selfOnly.includes(k)))) fail(403, 'forbidden', 'Seul le gérant modifie l’équipe.');
    if ((patch.role === 'owner' || st.role === 'owner') && ctx.staff?.role !== 'owner' && patch.role !== undefined) fail(403, 'forbidden', 'Seul le gérant change ce rôle.');
    if (st.role === 'owner' && patch.role && patch.role !== 'owner' && owners(s).length <= 1) fail(409, 'last_owner', 'Il faut au moins un gérant.');
    if (patch.email && !isEmailLike(patch.email)) fail(400, 'invalid', 'E-mail invalide.');
    checkSchedule(patch.schedule);
    const { email, ...rest } = patch;
    if (!Object.keys(rest).length && email === undefined) return { ok: true };
    ctx.emit('staff.updated', { id: st.id, patch: rest }, email !== undefined ? { email } : undefined);
    return { ok: true };
  }
};

export const archiveStaff = {
  run(s, input, ctx) {
    ctx.need('team');
    const st = getStaff(s, input.id);
    if (ctx.staff && ctx.staff.id === st.id) fail(409, 'self', 'Tu ne peux pas désactiver ton propre compte.');
    if (st.role === 'owner' && owners(s).length <= 1) fail(409, 'last_owner', 'Il faut au moins un gérant.');
    ctx.emit(input.restore ? 'staff.restored' : 'staff.archived', { id: st.id });
    return { ok: true };
  }
};

/** Password and PIN arrive already hashed (scrypt runs outside the decision, see server/auth). */
const hashPattern = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;
export const setCredentials = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    const self = ctx.staff && ctx.staff.id === st.id;
    if (!self && !ctx.can('team')) fail(403, 'forbidden', 'Seul le gérant peut changer les accès de l’équipe.');
    if (!self && st.role === 'owner' && ctx.staff?.role !== 'owner') fail(403, 'forbidden', 'Seul le gérant change ses propres accès.');
    const pii = {};
    if (input.pwdHash !== undefined) { if (input.pwdHash !== '' && !hashPattern.test(input.pwdHash)) fail(400, 'invalid', 'Mot de passe invalide.'); pii.pwd = input.pwdHash || ''; }
    if (input.pinHash !== undefined) { if (input.pinHash !== '' && !hashPattern.test(input.pinHash)) fail(400, 'invalid', 'Code invalide.'); pii.pin = input.pinHash || ''; }
    if (!Object.keys(pii).length) return { ok: true };
    // a new password signs out every session of that person, except on a PIN-only change
    ctx.emit('staff.credentials', { id: st.id, revoke: input.pwdHash !== undefined && !self }, pii);
    return { ok: true };
  }
};

export const revokeSessions = {
  run(s, input, ctx) {
    const st = getStaff(s, input.id);
    if (!(ctx.staff && ctx.staff.id === st.id) && !ctx.can('team')) fail(403, 'forbidden', 'Action réservée au gérant.');
    ctx.emit('staff.revoked', { id: st.id });
    return { ok: true };
  }
};

/* ---------------- time off: posted, asked for and approved, and the clients it moves ---------------- */

// publicNote: what the site may say while the barber is away ('JKut revient le 12 novembre'), read by routes-public (WP-06)
const timeoffSchema = obj({
  staffId: id(), from: day(), to: day(), startMin: opt(int({ min: 0, max: 1440 })), endMin: opt(int({ min: 0, max: 1440 })),
  reason: opt(str({ max: 60 })), publicNote: opt(str({ max: 80 }))
});
const TIMEOFF_FIELDS = /** @type {const} */ (['id', 'staffId', 'from', 'to', 'startMin', 'endMin', 'reason', 'publicNote']);
/** The time off itself, without what the projection adds (at, by, status). */
const timeoffOf = (t) => Object.fromEntries(TIMEOFF_FIELDS.filter((k) => t[k] !== undefined && t[k] !== '').map((k) => [k, t[k]]));

/** A valid absence (dates in order, hours on one day only), from a post or a preview. */
export function parseTimeOff(input) {
  const t = parse(timeoffSchema, input);
  if (t.to < t.from) fail(400, 'invalid', 'La date de fin doit suivre la date de début.');
  if (diffDays(t.from, t.to) > 366) fail(400, 'invalid', 'Une absence tient sur un an au plus.');
  if ((t.startMin == null) !== (t.endMin == null)) fail(400, 'invalid', 'Heure de début et de fin attendues.');
  if (t.startMin != null && (t.from !== t.to || /** @type {number} */ (t.endMin) <= t.startMin)) fail(400, 'invalid', 'Une absence de quelques heures tient sur une seule journée.');
  return t;
}

export const addTimeOff = {
  run(s, input, ctx) {
    const t = parseTimeOff(input);
    getStaff(s, t.staffId);
    const self = ctx.staff && ctx.staff.id === t.staffId;
    if (!ctx.can('team') && !self) fail(403, 'forbidden', 'Seul le gérant pose les absences de l’équipe.');
    const tid = ctx.id('to');
    const x = timeoffOf({ ...t, id: tid, reason: t.reason || 'Absence' });
    // a barber's own absence waits for the owner when the salon asks for it: his slots stay open until then
    if (!ctx.can('team') && s.settings.team.timeoffApproval !== false) {
      ctx.emit('timeoff.requested', x);
      return { id: tid, requested: true };
    }
    ctx.emit('timeoff.added', x);
    return { id: tid };
  }
};
/** The owner says yes: the request becomes the absence (same id), and its slots close now. */
export const approveTimeOff = {
  run(s, input, ctx) {
    ctx.need('team');
    // a second tap, or a retried request: already approved
    if (s.timeoff.has(input.id)) return { id: input.id, ok: true };
    const q = s.timeoffRequests.get(input.id);
    if (!q) fail(404, 'not_found', 'Demande introuvable.');
    if (q.status !== 'pending') fail(409, 'decided', 'Cette demande a déjà été refusée.');
    ctx.emit('timeoff.added', { ...timeoffOf(q), request: { by: q.by, at: q.at } });
    return { id: q.id, ok: true };
  }
};
export const refuseTimeOff = {
  run(s, input, ctx) {
    ctx.need('team');
    const q = s.timeoffRequests.get(input.id);
    if (!q) { if (s.timeoff.has(input.id)) fail(409, 'decided', 'Cette absence a déjà été validée.'); fail(404, 'not_found', 'Demande introuvable.'); }
    if (q.status === 'refused') return { ok: true };
    ctx.emit('timeoff.refused', { id: q.id, staffId: q.staffId });
    return { ok: true };
  }
};
export const removeTimeOff = {
  run(s, input, ctx) {
    const t = s.timeoff.get(input.id);
    // a request is withdrawn by the barber who made it (or put away once refused), or dropped by the owner
    const q = t ? null : s.timeoffRequests.get(input.id);
    if (!t && !q) fail(404, 'not_found', 'Absence introuvable.');
    const staffId = (t || q).staffId;
    if (!ctx.can('team') && !(ctx.staff && ctx.staff.id === staffId)) fail(403, 'forbidden', 'Action réservée au gérant.');
    // a withdrawn request leaves the state: its event says whose it was and what it said, for the feed
    if (t) ctx.emit('timeoff.removed', { id: input.id });
    else ctx.emit('timeoff.withdrawn', { id: q.id, staffId, from: q.from, to: q.to, ...(q.startMin != null ? { startMin: q.startMin, endMin: q.endMin } : {}), was: q.status });
    return { ok: true };
  }
};

const OPEN = new Set(['pending', 'booked', 'arrived']);
/** The state as if this absence were posted: a preview asks before it exists. */
function withAbsence(s, t) {
  if (s.timeoff.has(t.id)) return s;
  return { ...s, timeoff: new Map(s.timeoff).set(t.id || '_preview', { ...t, id: t.id || '_preview' }) };
}
/** "jeudi 29": the day in the texts and the feed. */
export function dayWords(day) { const p = dayParts(day); return DAYS_FR[p.wd] + ' ' + p.d; }
/** "jeudi 29", "du jeudi 29 au samedi 31", "jeudi 29 de 10 h à 12 h". */
export function rangeWords(t) {
  if (t.from !== t.to) return 'du ' + dayWords(t.from) + ' au ' + dayWords(t.to);
  return dayWords(t.from) + (t.startMin != null ? ' de ' + fmtTime(t.startMin) + ' à ' + fmtTime(t.endMin) : '');
}

/**
 * The appointments an absence lands on: the barber's, still to come, inside the days (and hours) he is away.
 * @param {any} s @param {{ staffId: string, from: string, to: string, startMin?: number, endMin?: number }} t
 * @param {{ now: number, local: { day: string, min: number } }} o
 */
export function timeoffConflicts(s, t, o) {
  const out = [];
  for (let d = t.from < o.local.day ? o.local.day : t.from; d <= t.to; d = addDays(d, 1)) {
    for (const id of s.apptsByDay.get(d) || []) {
      const a = s.appts.get(id);
      if (!a || a.staffId !== t.staffId || !OPEN.has(a.status) || !occupies(a, o.now, s)) continue;
      if (d === o.local.day && a.start + a.dur <= o.local.min) continue;
      if (t.startMin != null && !(a.start < /** @type {number} */ (t.endMin) && a.start + a.dur > t.startMin)) continue;
      out.push(a);
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
}

/** How far the nearest free time may be from the booked one and still be the default (texted without asking the client):
 *  beyond it, the time is only offered, and the default is to ask (or call) the client. To confirm with the owner. */
export const NEAREST_MAX_MIN = 90;

/**
 * The handover plan: for each appointment the absence lands on, the same time with another barber who does the
 * service and is free (least loaded first), the nearest free time that day (anyone, the absent barber outside his
 * hours off included), or nothing: ask the client (call him when it is too late for him to change online).
 * Defaults never overlap each other, and no alternative overlaps another row's default (two alternatives picked by
 * hand may: the sheet and applyHandover check that). Pure: state in, plan out.
 * @param {any} s @param {any} t the absence (posted, or about to be) @param {{ now: number, local: { day: string, min: number } }} o
 * @returns {{ a: any, same: { staffId: string, day: string, start: number } | null, nearest: { staffId: string, day: string, start: number } | null, choice: 'same'|'nearest'|'ask', online: boolean }[]}
 */
export function handoverPlan(s, t, o) {
  const h = withAbsence(s, t);
  /** @type {{ apptId: string, staffId: string, day: string, start: number, end: number }[]} */
  const claimed = [];
  const load = (sid, day) => bookedMinutes(h, sid, day, o.now) + claimed.filter((c) => c.staffId === sid && c.day === day).reduce((n, c) => n + c.end - c.start, 0);
  // free for this appointment, its own proposal aside (an alternative is what it gets instead of its default)
  const free = (a, sid, m) => isFree(h, sid, a.day, m, a.dur, { now: o.now, ignoreAppt: a.id }) && !claimed.some((c) => c.apptId !== a.id && c.staffId === sid && c.day === a.day && c.start < m + a.dur && m < c.end);
  const poolOf = (a) => eligibleStaff(h, a.services.map((x) => x.id)).map((st) => ({ st, load: load(st.id, a.day) })).sort((x, y) => x.load - y.load || (x.st.order ?? 99) - (y.st.order ?? 99));
  const nearestFor = (a) => {
    let nearest = null, best = Infinity;
    const earliest = a.day === o.local.day ? o.local.min : 0;
    for (const p of poolOf(a)) {
      for (const [w0, w1] of staffIntervals(h, p.st.id, a.day)) {
        for (let m = Math.ceil(Math.max(w0, earliest) / 15) * 15; m + a.dur <= w1; m += 15) {
          const dist = Math.abs(m - a.start);
          // the same time is the first proposal; pool is least loaded first, so a tie keeps the lighter chair
          if (m === a.start || dist >= best || !free(a, p.st.id, m)) continue;
          best = dist; nearest = { staffId: p.st.id, day: a.day, start: m };
        }
      }
    }
    return nearest;
  };
  const near = (a, x) => !!x && Math.abs(x.start - a.start) <= NEAREST_MAX_MIN;
  // first pass, in time order: each default takes its chair
  const rows = timeoffConflicts(h, t, o).map((a) => {
    const other = poolOf(a).find((p) => p.st.id !== t.staffId && free(a, p.st.id, a.start));
    const same = other ? { staffId: other.st.id, day: a.day, start: a.start } : null;
    const nearest = same ? null : nearestFor(a);
    /** @type {'same'|'nearest'|'ask'} */
    const choice = same ? 'same' : near(a, nearest) ? 'nearest' : 'ask';
    const pick = choice === 'same' ? same : choice === 'nearest' ? nearest : null;
    if (pick) claimed.push({ apptId: a.id, staffId: pick.staffId, day: pick.day, start: pick.start, end: pick.start + a.dur });
    return { a, same, nearest, choice, online: clientMayChange(h, a, o.now) };
  });
  // second pass: an alternative is sought against every default, so picking it never takes a later row's chair
  for (const r of rows) if (r.choice !== 'nearest') r.nearest = nearestFor(r.a);
  return rows;
}

/** Can this appointment's client be told? As for a cancellation by the salon: the client takes texts (an appointment
 *  booked without its SMS confirmation still hears that its barber is away). */
export function textable(s, a) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return !!(c && !c.erased && c.phone && c.sms !== false);
}
const rescheduleKey = (a) => 'rs_' + a.id + '_' + a.day + '_' + a.start;
/** Was this client already asked to pick a new time for that slot? */
export const askedToReschedule = (s, a) => s.messages.has('msg_' + rescheduleKey(a));

/** The reassign text, after moveAppointment gave the client to another barber: {avant} the time he had booked, when
 *  it changed (reassignAt says so, or he may turn up at his old time). */
export const sendHandover = {
  run(s, input, ctx) {
    ctx.need('agenda.edit');
    const a = getAppt(s, input.apptId);
    const absent = getStaff(s, input.absentId);
    if (!textable(s, a)) return { queued: false };
    const c = s.clients.get(a.clientId);
    const moved = input.was != null && input.was !== a.start;
    const vars = { ...apptVars(s, a, ctx.meta.linkFor), absent: absent.name, date: dayWords(a.day), ...(moved ? { avant: fmtTime(input.was) } : {}) };
    // keyed by where the client now sits: a retried plan finds it queued, a later change texts again
    return { queued: !!queueMessage(s, ctx, { key: 'ra_' + a.id + '_' + a.staffId + '_' + a.day + '_' + a.start, template: moved ? 'reassignAt' : 'reassign', to: c.phone, cid: c.id, apptId: a.id, vars }) };
  }
};
/** 'Ask the client': the appointment stays where it is, the client gets a link to choose another time. Not when it
 *  is too late for him to change online (the link would refuse him): the salon calls him, and nothing is sent. */
export const askReschedule = {
  run(s, input, ctx) {
    ctx.need('agenda.edit');
    const a = getAppt(s, input.apptId);
    if (!OPEN.has(a.status)) fail(409, 'closed', 'Ce rendez-vous est clos.');
    if (!textable(s, a) || !clientMayChange(s, a, ctx.now)) return { queued: false };
    const c = s.clients.get(a.clientId);
    const vars = { ...apptVars(s, a, ctx.meta.linkFor), date: dayWords(a.day) };
    if (!vars.prenom) vars.prenom = 'Bonjour';
    return { queued: !!queueMessage(s, ctx, { key: rescheduleKey(a), template: 'reschedule', to: c.phone, cid: c.id, apptId: a.id, vars }) };
  }
};

const planSchema = obj({
  moves: opt(arr(obj({ apptId: id(), staffId: id(), start: int({ min: 0, max: 1439 }) }), { max: 300 })),
  ask: opt(arr(id(), { max: 300 })), cancel: opt(arr(id(), { max: 300 }))
});
/** Who the owner reads in a refusal: the first name and the time, never the phone. */
const firstOf = (s, a) => { const c = a.clientId ? s.clients.get(a.clientId) : null; return (c && !c.erased && c.first) || (a.name || '').split(' ')[0] || 'Client'; };
const whoAt = (s, a) => firstOf(s, a) + ' (' + dayWords(a.day) + ' ' + fmtTime(a.start) + ')';

/** Two moves of the plan on the same chair at the same time (two alternatives picked by hand): said before anything runs. */
function planClash(s, moves) {
  const iv = [];
  for (const m of moves) {
    const a = s.appts.get(m.apptId);
    if (!a) continue;
    const y = { m, a, end: m.start + a.dur };
    const x = iv.find((p) => p.m.staffId === m.staffId && p.a.day === a.day && p.m.start < y.end && m.start < p.end);
    if (x) {
      const st = s.staff.get(m.staffId);
      const at = x.m.start === m.start ? ' deux fois à ' + fmtTime(m.start) + ',' : ' à ' + fmtTime(x.m.start) + ' et ' + fmtTime(m.start);
      fail(409, 'clash', 'Ton plan donne ' + (st ? st.name : 'ce barbier') + at + ' à ' + firstOf(s, x.a) + ' et ' + firstOf(s, a) + '. Change l’un des deux.', { apptId: a.id, other: x.a.id });
    }
    iv.push(y);
  }
}

/**
 * Apply the owner's handover plan for an absence: the moves, the texts and the cancellations in one atomic append
 * (engine.batch), each step seeing the ones before it, so two clients are never given the same chair. Any step
 * refused (a slot taken since the preview) and nothing is written. A retried request finds its moves done and its
 * texts queued: it writes nothing twice.
 * @param {any} engine @param {any} t the absence @param {any} input @param {{ actor: any, staff?: any, caps?: Set<string>, meta?: any }} base
 */
export async function applyHandover(engine, t, input, base) {
  const x = parse(planSchema, input || {});
  const moves = x.moves || [], ask = x.ask || [], cancel = x.cancel || [];
  const all = [...moves.map((m) => m.apptId), ...ask, ...cancel];
  if (new Set(all).size !== all.length) fail(400, 'invalid', 'Chaque rendez-vous ne peut avoir qu’une solution.');
  planClash(engine.state, moves);
  for (let attempt = 0; attempt < 4; attempt++) {
    // toCall: 'ask' with no text sent (no SMS possible, or too late to change online): the salon phones them
    const res = { moved: 0, asked: 0, toCall: 0, cancelled: 0, texted: 0, deposits: /** @type {any[]} */ ([]) };
    let v0 = 0;
    const n = await engine.batch((step) => {
      const s = engine.state;
      v0 = s.version;
      const absent = getStaff(s, t.staffId);
      const mine = (aid) => {
        const a = getAppt(s, aid);
        if (a.staffId !== t.staffId) fail(409, 'moved', whoAt(s, a) + ' n’est plus chez ' + absent.name + '.', { apptId: a.id });
        return a;
      };
      for (const m of moves) {
        const a0 = getAppt(s, m.apptId);
        if (a0.staffId === m.staffId && a0.start === m.start) { res.moved++; continue; } // done by the first try
        const a = mine(m.apptId);
        const chair = m.staffId === a.staffId, was = a.start; // a is the state's own: the move changes it
        try { step(moveAppointment, { id: a.id, day: a.day, start: m.start, staffId: m.staffId, notify: chair }, base); }
        catch (e) {
          const st = s.staff.get(m.staffId);
          if (e && e.code === 'taken') fail(409, 'taken', fmtTime(m.start) + ' chez ' + (st ? st.name : 'ce barbier') + ' n’est plus libre pour ' + whoAt(s, a) + '.', { apptId: a.id });
          throw e;
        }
        res.moved++;
        // the same barber at another time gets the usual confirmation (moveAppointment); another barber, the reassign text
        if (!chair) step(sendHandover, { apptId: a.id, absentId: t.staffId, was }, base);
      }
      for (const aid of ask) {
        const a = mine(aid);
        const r = step(askReschedule, { apptId: a.id }, base);
        // a retried plan finds the text already queued: still asked
        if ((r && r.queued) || askedToReschedule(s, a)) res.asked++; else res.toCall++;
      }
      for (const aid of cancel) {
        const a0 = getAppt(s, aid);
        if (a0.status === 'cancelled') {
          res.cancelled++;
          // cancelled by a first try whose refund failed or never came back: the route tries it again
          if (a0.staffId === t.staffId && a0.deposit && a0.deposit.paid && a0.deposit.paymentId) res.deposits.push(a0.deposit);
          continue;
        }
        const a = mine(aid);
        const r = step(cancelAppointment, { id: a.id, reason: absent.name + ' absent', notify: true }, base);
        res.cancelled++;
        if (r && r.deposit && r.deposit.paymentId) res.deposits.push(r.deposit);
      }
    });
    if (n === -1) continue;
    // what really left: the texts this batch queued (a number abroad is recorded as not sent)
    const ev = engine.journal.filter((e) => e.v > v0 && e.v <= v0 + n);
    const skipped = new Set(ev.filter((e) => e.type === 'message.updated' && e.data.patch && e.data.patch.status === 'skipped').map((e) => e.data.id));
    res.texted = ev.filter((e) => e.type === 'message.queued' && e.data.channel === 'sms' && !skipped.has(e.data.id)).length;
    return res;
  }
  fail(503, 'busy', 'Le salon reçoit beaucoup de demandes en même temps. Réessaie dans un instant.');
}

export const enrollDevice = {
  run(s, input, ctx) {
    if (!input.demo) ctx.need('devices');
    const name = parse(str({ min: 1, max: 40 }), input.name || 'Poste du salon');
    if (!/^[a-f0-9]{64}$/.test(input.tokenHash)) fail(400, 'invalid', 'Jeton invalide.');
    const did = ctx.id('dv');
    ctx.emit('device.enrolled', { id: did, name, tokenHash: input.tokenHash });
    return { id: did };
  }
};
export const revokeDevice = {
  run(s, input, ctx) {
    ctx.need('devices');
    const d = s.devices.get(input.id);
    if (!d || d.revoked) fail(404, 'not_found', 'Appareil introuvable.');
    ctx.emit('device.revoked', { id: d.id });
    return { ok: true };
  }
};
