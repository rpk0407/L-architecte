// @ts-check
// FEATURE B · How the salon reaches a client, and what one contact may see without an account.
// - notify: the client's own choice of channel for his reminders and for « un créneau s'est libéré plus tôt », kept on his
//   file (client.updated patch { notify }): 'sms' (the salon's current way: SMS, or WhatsApp when the salon sends by
//   WhatsApp, automatic or by hand), 'whatsapp' (WhatsApp even while the salon sends SMS: the hand queue), 'email'.
//   A choice that is no longer possible (the e-mail removed, WhatsApp switched off) reads as 'sms'.
// - earlier: « Préviens-moi si un créneau se libère plus tôt » on a booking (appt.updated patch { earlier: true }); the
//   tick's step (commands/steps/earlier.js) reads it when a cancellation frees an earlier slot with the same barber.
// - contact: every booking still to come that a phone holds, its own and those it booked for someone else (a child, a
//   friend): the person's file is a.clientId, the one who booked is read by bookerOf below.
import { isEmail } from '../lib/util.js';
import { waMode, salonWhatsapp } from '../settings/messages.js';
import { occupies } from './availability.js';
import { startsAt } from './policy.js';

export const NOTIFY_VIA = /** @type {const} */ (['sms', 'whatsapp', 'email']);

/** The ways this salon can reach this file now, in the order the page offers them. */
export function notifyOptions(s, c) {
  const M = s.settings.messages || {};
  const out = [];
  // to a phone: when the salon sends by WhatsApp (automatic or by hand) that is its one way, so only « WhatsApp » is
  // offered (an « SMS » chip would change nothing); when it sends SMS, WhatsApp too if it has a number a person sends from
  if (c && c.phone && waMode(M) !== 'sms') out.push('whatsapp');
  else if (c && c.phone) { out.push('sms'); if (salonWhatsapp(M)) out.push('whatsapp'); }
  if (c && isEmail(c.email) && M.email !== false) out.push('email');
  return out;
}

/** The channel this file asked for, if the salon can still use it; else the salon's way to his phone (or 'email' without a phone). */
export function viaOf(s, c) {
  const opts = notifyOptions(s, c);
  if (c && opts.includes(c.notify)) return c.notify;
  return opts[0] || 'sms';
}

/**
 * Who booked this appointment when it was made for someone else (the site's « pour quelqu'un d'autre », commands/agenda.js):
 * a.ext.guest { kind: 'other', by } for a guest with his own number (his own file), { kind: 'child', cid } for a child
 * (the child's file, whose ext.parent is the booker); a guest without a number stays on the booker's file. null when the
 * person booked for himself.
 * @param {any} a @param {any} [s]
 */
export function bookerOf(a, s) {
  const g = a && a.ext && a.ext.guest;
  let b = g && g.by ? g.by : null;
  if (!b && g && g.kind === 'child' && s) { const c = s.clients.get(a.clientId); b = c && c.ext && c.ext.parent ? c.ext.parent : null; }
  if (!b) b = a && (a.bookerId || a.bookedBy || (a.booker && (a.booker.cid || a.booker.id)));
  return b && b !== a.clientId ? String(b) : null;
}

/** The first name of the person a booking is for when someone else booked it (a child, a friend); '' for his own. */
export function guestFirst(s, a) {
  const g = a && a.ext && a.ext.guest;
  if (!g && !bookerOf(a, s)) return '';
  const c = a.clientId && bookerOf(a, s) ? s.clients.get(a.clientId) : null;
  if (c && !c.erased && c.first) return c.first;
  return String(a.name || '').split(' ')[0] || (g ? 'un proche' : '');
}

/** Is this booking still to come (booked, or pending while its deposit can be paid)? */
export const comingAppt = (s, a, now) => !a.legacy && (a.status === 'booked' || a.status === 'pending') && occupies(a, now, s) && startsAt(a) > now;

/**
 * The bookings to come of a contact: those of his files (ids: the file and the ones merged into it) and those he booked
 * for someone else, soonest first.
 * @param {any} s @param {string[]} ids @param {number} now
 */
export function contactAppts(s, ids, now) {
  const set = new Set(ids);
  return [...s.appts.values()]
    .filter((a) => (set.has(a.clientId) || set.has(bookerOf(a, s) || '')) && comingAppt(s, a, now))
    .sort((a, b) => startsAt(a) - startsAt(b));
}

/** May this contact act on this booking (his own, or one he booked for someone else)? */
export function contactOwns(ids, a, s) {
  const set = new Set(ids);
  return !!a && (set.has(a.clientId) || set.has(bookerOf(a, s) || ''));
}

/**
 * The file this booking's texts go to, and so whose link it is: the person's own file when it has a phone (he booked for
 * himself, or a friend booked him with his own number: he got his own confirmation), else the one who booked (a child,
 * who has no phone). A friend's link never opens the bookings of the one who booked him.
 */
export const contactCidOf = (a, s) => {
  const own = a && a.clientId && s ? s.clients.get(a.clientId) : null;
  if (own && own.phone) return a.clientId;
  return bookerOf(a, s) || (a && a.clientId) || null;
};

/**
 * « pour Léo » in a list of this contact's bookings (ids: his files): '' for his own, the person's first name for a place
 * he booked for someone else (a child or a friend without a number sit on his own file; a friend with a number on his).
 */
export const forFirstIn = (s, ids, a) => {
  const g = a && a.ext && a.ext.guest;
  if (new Set(ids).has(a.clientId)) return g && !g.by ? guestFirst(s, a) : '';
  return guestFirst(s, a);
};
