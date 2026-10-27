// @ts-check
// "Mon rendez-vous" without an account: a client gives a phone number, the salon texts the links of their next
// appointments to that number, and only to it. Whoever typed the number learns nothing: the answer is the same either way.
import { normPhone } from '../lib/util.js';
import { queueMessage, apptVars, whenWords } from '../domain/messages.js';
import { occupies } from '../domain/availability.js';
import { startsAt } from '../domain/policy.js';

/** Texts a number can receive per day, kept in the journal (the HTTP limit lives in one instance's memory). */
export const LOOKUP_PER_DAY = 3;
/** Links in one text: the next appointment and the one after it. */
export const LOOKUP_LINKS = 2;

/** The client's appointments still to come, soonest first: booked, or pending while their deposit can still be paid. */
export function upcomingOf(s, clientId, now) {
  return [...s.appts.values()]
    .filter((a) => a.clientId === clientId && !a.legacy && (a.status === 'booked' || a.status === 'pending') && occupies(a, now, s) && startsAt(a) > now)
    .sort((a, b) => startsAt(a) - startsAt(b));
}

export const lookupAppointments = {
  run(s, input, ctx) {
    const phone = normPhone(String((input && input.phone) || ''));
    const cid = phone ? s.clientByPhone.get(phone) : null;
    let c = cid ? s.clients.get(cid) : null;
    if (c && c.mergedInto) c = s.clients.get(c.mergedInto) || null;
    // an erased client has no number left; a merged file's old number is not the client's number any more: only the
    // number on file ever receives the links
    if (!c || c.erased || c.phone !== phone) return { sent: false };
    const list = upcomingOf(s, c.id, ctx.now).slice(0, LOOKUP_LINKS);
    if (!list.length) return { sent: false };
    // the n-th text of the day has its own id: two servers answering at once never send the same one twice, and a 4th never leaves
    let n = 0;
    const key = (i) => 'lookup_' + c.id + '_' + ctx.local.day + '_' + i;
    while (n < LOOKUP_PER_DAY && s.messages.has('msg_' + key(n))) n++;
    if (n >= LOOKUP_PER_DAY) return { sent: false };
    const linkFor = ctx.meta && ctx.meta.linkFor;
    const [a, b] = list;
    const next = b ? whenWords(b.day, b.start) : null;
    const vars = { ...apptVars(s, a, linkFor), suite: next ? ' Puis ' + next.date + ' à ' + next.heure + ' : ' + (linkFor ? linkFor(b) : '') : '' };
    // asked for by the person holding the phone, now: a service text, sent even to a client who turned reminders off
    const id = queueMessage(s, ctx, { key: key(n), template: 'lookup', to: c.phone, cid: c.id, apptId: a.id, vars });
    return { sent: !!id, links: list.length };
  }
};
