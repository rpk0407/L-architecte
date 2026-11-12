// @ts-check
// « Reporter ses rendez-vous »: a barber is away (the desk closed the rest of his day from the Agenda, or the owner
// posted an absence in Équipe) and his booked clients are moved in one guided action instead of one by one.
//
// - reportPlan: for each appointment still on his chair, the best option, computed by the handover plan
//   (commands/team.js) on the booking's own availability rules (domain/availability.js: hours, closures, breaks, other
//   appointments, slots held on the site, who does the service): the same time with another barber, else the nearest
//   free time that day with anyone, else nothing: « à rappeler », and nothing moves by itself.
// - reportAppointments: ONE command for the whole plan. Each appointment is all or nothing: its slot is checked again
//   here, against the state of now and against the other lines of the plan; a slot taken meanwhile is reported in
//   `failed` and its appointment stays where it was, the others move. The right is the one of a single move (needChair).
//   A retried request (same x-request-id) gets its first answer and writes nothing (the engine).
// - the client of each moved appointment gets the existing text of a move, through the queue, under its deterministic
//   key (another barber: reassign / reassignAt, as the owner's plan; the same barber later: confirmation), held
//   REPORT_UNDO_MS so that « Annuler » can still take it back. Nobody is texted for an appointment left where it is.
// - undoReport: each appointment goes back to its slot if nothing took it meanwhile and its text has not left; the
//   others are named. The text still held is closed, never sent.
// Only existing events: appt.moved, message.queued, message.updated, and block.added / block.removed for the time an
// appointment leaves on a day closed from the Agenda (it must not be offered on the site again). A deposit, a carnet or a membership hangs on the
// appointment and the client: a move touches none of them.
import { fail } from '../core/engine.js';
import { int, obj, arr, day, id, parse } from '../lib/validate.js';
import { isFree, busyIntervals, canDo } from '../domain/availability.js';
import { queueMessage, apptVars, messageId } from '../domain/messages.js';
import { fmtTime } from '../../shared/dates.js';
import { getStaff, needChair } from './common.js';
import { handoverPlan, textable, dayWords, whoAt } from './team.js';

/** How long « Annuler » stays possible: the texts of a report wait that long before they leave. */
export const REPORT_UNDO_MS = 60000;
/** What a text closed by « Annuler » says in the outbox (and how a second report of the same move finds it). */
export const UNDONE = 'Report annulé';
const OPEN = new Set(['pending', 'booked', 'arrived']);
/** The label of the blocks that close an absent barber's day from the Agenda (« Absent aujourd’hui »). */
export const AWAY_LABEL = 'Absent';
/** That chair's « Absent » blocks of a day: its day was closed around the appointments it still had. */
const awayBlocks = (s, staffId, d) => [...(s.blocksByDay.get(d) || [])].map((bid) => s.blocks.get(bid)).filter((b) => b && b.staffId === staffId && b.label === AWAY_LABEL);

/**
 * The absence a report is about: one posted in Équipe, or the rest of a day closed from the Agenda (from now when it is
 * today), which exists nowhere but in this request.
 * @param {any} s @param {{ timeoffId?: string, staffId?: string, day?: string }} q @param {{ local: { day: string, min: number } }} o
 */
export function absenceFor(s, q, o) {
  if (q.timeoffId) {
    const t = s.timeoff.get(q.timeoffId);
    if (!t) fail(404, 'not_found', 'Absence introuvable.');
    return t;
  }
  const st = getStaff(s, q.staffId || '');
  const d = q.day || o.local.day;
  if (d < o.local.day) fail(400, 'invalid', 'Cette journée est passée.');
  return { staffId: st.id, from: d, to: d, startMin: d === o.local.day ? o.local.min : 0, endMin: 1440 };
}

/**
 * The plan: one row per appointment the absence lands on, in time order. `to`: where it would go (null: à rappeler),
 * `options`: what the person may pick instead. No default overlaps another one.
 * @param {any} s @param {any} t @param {{ now: number, local: { day: string, min: number } }} o
 * @returns {{ a: any, kind: 'same'|'nearest'|'call', to: { staffId: string, day: string, start: number } | null, options: { staffId: string, day: string, start: number }[] }[]}
 */
export function reportPlan(s, t, o) {
  return handoverPlan(s, t, { ...o, nearestMax: Infinity }).map(({ a, same, nearest }) => {
    // a sealed day (Z done) takes no appointment, as for a booking
    const options = s.closures.has(a.day) ? [] : /** @type {any[]} */ ([same, nearest].filter(Boolean));
    return { a, kind: !options.length ? 'call' : same ? 'same' : 'nearest', to: options[0] || null, options };
  });
}

/** The text of a move, queued once under its key and held for the undo. True when one will leave. */
function tell(s, ctx, was, a, absent) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  let m;
  if (a.staffId === was.staffId) {
    // his own barber at another time: the confirmation of a move (commands/agenda.js), under its key
    if (!s.settings.messages.confirmation || !a.sms || !c || !c.phone) return false;
    m = { key: 'conf_' + a.id + '_' + (a.moves || 0), template: 'confirmation', vars: apptVars(s, a, ctx.meta.linkFor) };
  } else {
    // another barber: the handover's text (sendHandover), keyed by where the client now sits
    if (!textable(s, was)) return false;
    const moved = was.start !== a.start;
    m = { key: 'ra_' + a.id + '_' + a.staffId + '_' + a.day + '_' + a.start, template: moved ? 'reassignAt' : 'reassign', vars: { ...apptVars(s, a, ctx.meta.linkFor), absent: absent.name, date: dayWords(a.day), ...(moved ? { avant: fmtTime(was.start) } : {}) } };
  }
  const dueAt = ctx.now + REPORT_UNDO_MS;
  // the same move, reported again after an « Annuler »: its text was closed unsent, it is opened again (never a second one)
  const old = s.messages.get(messageId(m.key));
  if (old && old.status === 'skipped' && old.error === UNDONE) { ctx.emit('message.updated', { id: old.id, patch: { status: 'queued', error: '', dueAt } }); return true; }
  return !!queueMessage(s, ctx, { ...m, to: c.phone, cid: c.id, apptId: a.id, dueAt });
}

const slot = () => obj({ staffId: id(), day: day(), start: int({ min: 0, max: 1439 }) });
const applySchema = obj({ staffId: id(), moves: arr(obj({ apptId: id(), staffId: id(), start: int({ min: 0, max: 1439 }) }), { min: 1, max: 300 }) });
/** two lines of one request on the same chair at the same time */
const clash = (claimed, sid, d, start, end) => claimed.some((c) => c.staffId === sid && c.day === d && c.start < end && start < c.end);

export const reportAppointments = {
  run(s, input, ctx) {
    const x = parse(applySchema, input);
    const absent = getStaff(s, x.staffId);
    if (new Set(x.moves.map((m) => m.apptId)).size !== x.moves.length) fail(400, 'invalid', 'Chaque rendez-vous ne peut avoir qu’une solution.');
    const moved = [], failed = [], claimed = [];
    for (const m of x.moves) {
      const a = s.appts.get(m.apptId);
      const no = (code, message) => { failed.push({ apptId: m.apptId, code, message }); };
      if (!a) { no('not_found', 'Rendez-vous introuvable.'); continue; }
      // the right of a single move, on the chair it leaves and on the one it takes
      needChair(ctx, a.staffId);
      needChair(ctx, m.staffId);
      const who = whoAt(s, a);
      const st = s.staff.get(m.staffId);
      const end = m.start + a.dur;
      // a plan sent again under another request id: already where it asks, nothing to write (no `from`: nothing to undo)
      if (a.staffId === m.staffId && a.start === m.start && a.staffId !== absent.id) { moved.push({ apptId: a.id, from: null, to: { staffId: a.staffId, day: a.day, start: a.start }, texted: false }); continue; }
      if (!OPEN.has(a.status)) { no('closed', who + ' : ce rendez-vous ne peut plus être déplacé.'); continue; }
      if (a.staffId !== absent.id) { no('moved', who + ' n’est plus chez ' + absent.name + '.'); continue; }
      if (!st || !st.active || !st.chair) { no('no_chair', (st ? st.name : 'Ce barbier') + ' ne prend pas de rendez-vous.'); continue; }
      if (m.staffId === a.staffId && m.start === a.start) { no('same', who + ' est déjà à cette heure.'); continue; }
      if (!canDo(st, a.services.map((v) => v.id))) { no('service', st.name + ' ne fait pas la prestation de ' + who + '.'); continue; }
      if (s.closures.has(a.day)) { no('day_closed', 'Cette journée est clôturée : ' + who + ' reste à rappeler.'); continue; }
      if (a.day === ctx.local.day && end <= ctx.local.min) { no('past', fmtTime(m.start) + ' est déjà passé pour ' + who + '.'); continue; }
      if (!isFree(s, m.staffId, a.day, m.start, a.dur, { now: ctx.now, ignoreAppt: a.id }) || clash(claimed, m.staffId, a.day, m.start, end)) { no('taken', fmtTime(m.start) + ' chez ' + st.name + ' n’est plus libre pour ' + who + '.'); continue; }
      claimed.push({ staffId: m.staffId, day: a.day, start: m.start, end });
      const from = { staffId: a.staffId, day: a.day, start: a.start }, to = { staffId: m.staffId, day: a.day, start: m.start };
      ctx.emit('appt.moved', { id: a.id, ...to, from: { day: from.day, start: from.start, staffId: from.staffId }, cid: a.clientId || undefined });
      // his day was closed around this appointment: the time it leaves closes too, or the site would offer it again
      if (to.staffId !== from.staffId && awayBlocks(s, from.staffId, from.day).length) ctx.emit('block.added', { id: ctx.id('bl'), staffId: from.staffId, day: from.day, start: from.start, dur: a.dur, label: AWAY_LABEL });
      const texted = tell(s, ctx, a, { ...a, ...to, moves: (a.moves || 0) + 1 }, absent);
      moved.push({ apptId: a.id, from, to, texted });
    }
    return { moved, failed, texted: moved.filter((r) => r.texted).length, undoMs: REPORT_UNDO_MS };
  },
  /** the first answer, rebuilt from its events on another instance: what moved (a line refused then wrote nothing) */
  replay(events) {
    const told = (aid) => events.some((e) => (e.type === 'message.queued' && e.data.apptId === aid) || (e.type === 'message.updated' && String(e.data.id).includes('_' + aid + '_')));
    const moved = events.filter((e) => e.type === 'appt.moved').map((e) => ({ apptId: e.data.id, from: { staffId: e.data.from.staffId, day: e.data.from.day, start: e.data.from.start }, to: { staffId: e.data.staffId, day: e.data.day, start: e.data.start }, texted: told(e.data.id) }));
    return { moved, failed: [], texted: moved.filter((r) => r.texted).length, undoMs: REPORT_UNDO_MS };
  }
};

const undoSchema = obj({ moves: arr(obj({ apptId: id(), from: slot(), to: slot() }), { min: 1, max: 300 }) });
export const undoReport = {
  run(s, input, ctx) {
    const x = parse(undoSchema, input);
    const restored = [], failed = [], claimed = [];
    for (const m of x.moves) {
      const a = s.appts.get(m.apptId);
      const no = (code, message) => { failed.push({ apptId: m.apptId, code, message }); };
      if (!a) { no('not_found', 'Rendez-vous introuvable.'); continue; }
      needChair(ctx, a.staffId);
      needChair(ctx, m.from.staffId);
      const who = whoAt(s, a);
      const back = s.staff.get(m.from.staffId);
      // already back (a second tap, a request sent twice): nothing to do, and it is not a failure
      if (a.staffId === m.from.staffId && a.day === m.from.day && a.start === m.from.start) { restored.push({ apptId: a.id }); continue; }
      if (!OPEN.has(a.status) || a.staffId !== m.to.staffId || a.day !== m.to.day || a.start !== m.to.start) { no('moved', who + ' a changé depuis : laissé tel quel.'); continue; }
      // the texts of the report: still held, they are closed; one that left already told the client, so he stays
      const texts = [...s.messages.values()].filter((t) => t.apptId === a.id && (t.id === messageId('ra_' + a.id + '_' + a.staffId + '_' + a.day + '_' + a.start) || t.id === messageId('conf_' + a.id + '_' + (a.moves || 0))));
      if (texts.some((t) => t.status !== 'queued' && !(t.status === 'skipped' && t.error === UNDONE))) { no('texted', who + ' a déjà reçu son SMS : déplace-le à la main et préviens-le.'); continue; }
      const end = m.from.start + a.dur;
      // his old slot: free of any other appointment, break or hold (his barber's absence does not count: he was there,
      // and the block the report put in his place goes away with it)
      const fill = awayBlocks(s, m.from.staffId, m.from.day).find((b) => b.start === m.from.start && b.dur === a.dur);
      const busy = busyIntervals(s, m.from.staffId, m.from.day, { now: ctx.now, ignoreAppt: a.id });
      if (fill) busy.splice(busy.findIndex(([b0, b1]) => b0 === fill.start && b1 === fill.start + fill.dur), 1);
      if (!back || s.closures.has(m.from.day) || clash(claimed, m.from.staffId, m.from.day, m.from.start, end) || busy.some(([b0, b1]) => b0 < end && m.from.start < b1)) {
        no('taken', fmtTime(m.from.start) + ' chez ' + (back ? back.name : 'son barbier') + ' a été pris entre-temps : ' + who + ' reste où il est.'); continue;
      }
      claimed.push({ staffId: m.from.staffId, day: m.from.day, start: m.from.start, end });
      ctx.emit('appt.moved', { id: a.id, day: m.from.day, start: m.from.start, staffId: m.from.staffId, from: { day: a.day, start: a.start, staffId: a.staffId }, cid: a.clientId || undefined });
      if (fill) ctx.emit('block.removed', { id: fill.id });
      for (const t of texts) if (t.status === 'queued') ctx.emit('message.updated', { id: t.id, patch: { status: 'skipped', error: UNDONE } });
      restored.push({ apptId: a.id });
    }
    return { restored, failed };
  },
  replay(events) { return { restored: events.filter((e) => e.type === 'appt.moved').map((e) => ({ apptId: e.data.id })), failed: [] }; }
};
