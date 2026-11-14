// @ts-check
// FEATURE C · « Le client est là ? ». At the start of a booking, and again 10 minutes later while nothing happened, the
// barber of that booking is asked on his phone whether the client came: « Il est là » (arrived), « Pas encore » (asked
// again 10 minutes after the answer), « Absent » (the usual no-show, refused before the start as everywhere).
// Computed on read from the journal and the clock (the pulse, the agenda, Mon espace): no scheduler, no stored prompt, so
// two instances can never ask twice, and an answer is just a journaled command. Off per salon: settings.team.arrivalAsk.
import { localParts } from '../../shared/dates.js';

/** « Pas encore »: asked again this many minutes later; and the second ask when nothing was answered */
export const ASK_AGAIN = 10;
/** never asked after the end of the booking (at least half an hour after its start) */
const MIN_WINDOW = 30;
const WAITING = new Set(['booked', 'pending']);

/** @param {any} s */
export const arrivalOn = (s) => !(s.settings && s.settings.team && s.settings.team.arrivalAsk === false);

/**
 * Where the question stands for one booking at `now`, or null when it does not apply (off, not today, not started, the
 * client already came or was marked absent, the booking is over).
 * ask: the minute of the question on screen (a new one each time it is asked again); later: the minute of the last
 * « Pas encore »; due: the question is on screen now (false while a « Pas encore » waits its 10 minutes).
 * @param {any} s @param {any} a @param {number} now
 * @returns {{ ask: number, due: boolean, later: number | null } | null}
 */
export function arrivalOf(s, a, now) {
  if (!a || !arrivalOn(s) || !WAITING.has(a.status)) return null;
  const L = localParts(now);
  if (a.day !== L.day || L.min < a.start) return null;
  const end = a.start + Math.max(a.dur || 0, MIN_WINDOW);
  if (L.min >= end) return null;
  const later = a.arrivalLater && a.arrivalLater.day === a.day ? a.arrivalLater.min : null;
  const ask = later != null ? later + ASK_AGAIN : L.min >= a.start + ASK_AGAIN ? a.start + ASK_AGAIN : a.start;
  return { ask, due: L.min >= ask && ask < end, later };
}

/** « Karim B. » */
const nameOf = (s, a) => {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return c && !c.erased ? (c.first + ' ' + (c.last ? c.last.charAt(0) + '.' : '')).trim() : a.name || 'Client';
};

/**
 * The questions on screen for this person: his own bookings only, never a colleague's client.
 * @param {any} s @param {any} me @param {number} now
 */
export function arrivalsFor(s, me, now) {
  if (!me || !me.chair || !arrivalOn(s)) return [];
  const day = localParts(now).day;
  const out = [];
  for (const id of s.apptsByDay.get(day) || []) {
    const a = s.appts.get(id);
    if (!a || a.staffId !== me.id) continue;
    const q = arrivalOf(s, a, now);
    if (q && q.due) out.push({ id: a.id, name: nameOf(s, a), start: a.start, services: a.services.map((x) => x.name), ask: q.ask, again: q.ask > a.start });
  }
  return out.sort((x, y) => x.start - y.start);
}
