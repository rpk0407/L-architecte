// @ts-check
// What the salon does on its own, checked about once a minute: unpaid bookings expire, reminders and
// review requests are queued, a freed slot is offered to the waiting list. Then the registered steps
// (tick-steps.js) run, such as the Z of a day nobody closed.
// Every message has a deterministic id, so running this twice (two servers, a retry) sends nothing twice.
import { addDays, instantOf } from '../../shared/dates.js';
import { freeSlots } from '../domain/availability.js';
import { queueMessage, apptVars, whenWords, afterQuiet, messageId, fileOf } from '../domain/messages.js';
import { mailReminder, mailConfirmation } from '../domain/mails.js';
import { payDeadline, startsAt } from '../domain/policy.js';
import { isEmail } from '../lib/util.js';
import { runSteps } from './tick-steps.js';
import { contactCidOf, forFirstIn } from '../domain/notify.js';

/** A reminder's words; to the parent of a child's booking: « Bonjour Sonia », « avec JKut pour Léo » (FEATURE B). */
function remVars(s, a, c, linkFor) {
  const v = apptVars(s, a, linkFor);
  const pour = forFirstIn(s, [c.id], a);
  return pour ? { ...v, prenom: c.first || v.prenom, barbier: v.barbier + ' pour ' + pour } : v;
}
import { queueReviews } from './reviews.js';

const OFFER_MIN = 30;
const DAY_MS = 24 * 3600000;
/** The 2-hours reminder of a booking that missed the evening one: taken at least 4 h before, sent at least 30 min before. */
export const LATE_MIN_AGE = 4 * 3600000;
export const LATE_MIN_LEAD = 30;
/** The texts about one appointment that an e-mail can stand in for when the SMS failed for good. */
const SMS_TO_MAIL = new Set(['confirmation', 'reminder', 'reminder2h']);

export const tick = {
  run(s, input, ctx) {
    const M = s.settings.messages;
    const L = ctx.local;
    const tomorrow = addDays(L.day, 1);
    let n = 0;
    const cap = 60; // bounded work per run
    const quiet = afterQuiet(M.quiet, ctx.now) > ctx.now;

    for (const a of s.appts.values()) {
      if (n >= cap) break;
      // 1. a booking waiting for its deposit frees the slot when the time is up
      if (a.status === 'pending' && payDeadline(s, a) < ctx.now) {
        ctx.emit('appt.cancelled', { id: a.id, by: 'system', reason: 'Acompte non réglé', cid: a.clientId || undefined }); n++; continue;
      }
      if (a.demo && !input.demoMessages) continue;
      // FEATURE B: a child's booking reminds the parent who booked it (the child's file has no phone), domain/notify.js
      const own = a.clientId ? s.clients.get(a.clientId) : null;
      const c = own && !own.phone && contactCidOf(a, s) !== a.clientId ? fileOf(s, contactCidOf(a, s)) : own;
      if (!c || c.erased || a.status !== 'booked') continue;
      // by text: the file takes them and so does this booking; by e-mail: the owner switched it on and the client gave an address
      // FEATURE B: a client who chose the e-mail (domain/notify.js) gets his reminders by e-mail instead of a text
      const wantsMail = c.notify === 'email' && isEmail(c.email) && M.email !== false;
      const text = !!c.phone && !!c.sms && !!a.sms && !wantsMail;
      const mail = ((!!M.reminder && !!M.reminderEmail) || wantsMail) && isEmail(c.email);
      if (!text && !mail) continue;
      const toMail = (soon) => mailReminder(s, ctx, a, { to: c.email, first: c.first, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '', soon, today: L.day });
      // 2. the evening before
      if (M.reminder && a.day === tomorrow && L.min >= M.reminderHour * 60) {
        const createdToday = a.createdAt > instantOf(L.day, M.reminderHour * 60);
        if (!createdToday && text && queueMessage(s, ctx, { key: 'rem_' + a.id + '_' + a.day, template: 'reminder', to: c.phone, cid: c.id, apptId: a.id, vars: remVars(s, a, c, ctx.meta.linkFor) })) n++;
        if (!createdToday && mail && toMail(false)) n++;
      }
      // 3. two hours before: for everyone when the owner switched it on, and always for a booking that got no reminder the
      // evening before (taken after the reminder's hour, or the same day), unless it was taken less than 4 h before its
      // time. That one may leave later than 2 h before, never during the quiet hours and never less than 30 min before
      const lead = a.day === L.day ? a.start - L.min : -1;
      const all = !!M.reminder2h && lead <= 120 && lead > 60;
      const missed = !!M.reminder && lead <= 120 && lead >= LATE_MIN_LEAD && !quiet && startsAt(a) - a.createdAt >= LATE_MIN_AGE
        && !s.messages.has(messageId('rem_' + a.id + '_' + a.day)) && !s.messages.has(messageId('mrem_' + a.id + '_' + a.day));
      if ((all || missed) && text && queueMessage(s, ctx, { key: 'rem2_' + a.id + '_' + a.day, template: 'reminder2h', to: c.phone, cid: c.id, apptId: a.id, vars: remVars(s, a, c, ctx.meta.linkFor) })) n++;
      if (missed && mail && toMail(true)) n++;
    }
    // 3b. a confirmation or a reminder whose SMS failed for good (the provider refused it: nothing is tried again) goes
    // once by e-mail to a client who gave an address, when the salon's e-mails to clients are on. The keys are those of
    // the e-mails above and of the confirmation's own mail: a client who already has it gets nothing more
    if (M.email !== false) {
      for (const m of s.messages.values()) {
        if (n >= cap) break;
        if (m.status !== 'failed' || m.channel === 'email' || !m.apptId || !SMS_TO_MAIL.has(m.template) || ctx.now - (m.sentAt || m.at) > DAY_MS) continue;
        const a = s.appts.get(m.apptId);
        if (!a || a.status !== 'booked' || startsAt(a) <= ctx.now || (a.demo && !input.demoMessages)) continue;
        const c = fileOf(s, a.clientId);
        if (!c || c.erased || !isEmail(c.email)) continue;
        const o = { to: c.email, first: c.first, link: ctx.meta.linkFor ? ctx.meta.linkFor(a) : '', today: L.day };
        if (m.template === 'confirmation' ? mailConfirmation(s, ctx, a, o) : mailReminder(s, ctx, a, { ...o, soon: m.template === 'reminder2h' })) n++;
      }
    }
    // 4. thanks + review: once the visit is done and paid, after the delay and out of the quiet hours (a visit finished at
    // 19:30 is asked the next morning), once per client per quarter, by text or else by e-mail; the same request for every
    // client, never only the happy ones (commands/reviews.js says why)
    if (n < cap) n += queueReviews(s, ctx, { demo: !!input.demoMessages, cap: cap - n }).length;

    // 5. the waiting list gets a freed slot first; no new offer during quiet hours: a 30-minute offer texted in the morning would be gone
    if (s.settings.booking.waitlist && M.waitlist) {
      for (const w of s.waitlist.values()) {
        if (n >= cap) break;
        if (w.status === 'offered' && w.offer && w.offer.exp < ctx.now) { ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'waiting', offer: null } }); n++; continue; }
        if (w.status !== 'waiting' || w.day < L.day || quiet) continue;
        const sv = s.services.get(w.serviceId);
        if (!sv) continue;
        const slot = freeSlots(s, { day: w.day, dur: sv.dur + (sv.buffer || 0), serviceIds: [sv.id], staffId: w.staffId, now: ctx.now, local: L, online: true })
          .find((x) => x.m >= w.from && x.m + sv.dur <= w.to);
        if (!slot) continue;
        const hid = ctx.id('ho');
        const exp = ctx.now + OFFER_MIN * 60000;
        ctx.emit('appt.held', { id: hid, staffId: slot.staffId, day: w.day, start: slot.m, dur: sv.dur + (sv.buffer || 0), serviceIds: [sv.id], exp, by: 'waitlist' });
        ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'offered', offer: { holdId: hid, staffId: slot.staffId, start: slot.m, exp, at: ctx.now } } });
        const st = s.staff.get(slot.staffId);
        const vars = { prenom: w.first, ...whenWords(w.day, slot.m), barbier: st ? st.name : '', lien: ctx.meta.offerLink ? ctx.meta.offerLink(w.id) : '' };
        queueMessage(s, ctx, { key: 'wl_' + w.id + '_' + slot.m + '_' + w.day, template: 'waitlist', to: w.phone, cid: w.clientId, vars });
        n++;
      }
    }

    // 6. online payments nobody completed
    for (const py of s.payments.values()) {
      if (n >= cap) break;
      if (py.status === 'pending' && py.exp < ctx.now) { ctx.emit('payment.expired', { id: py.id, reason: 'Délai dépassé' }); n++; }
    }
    // 7. a sender that died mid-way: its claim is released after five minutes
    for (const m of s.messages.values()) {
      if (m.status === 'claimed' && m.claimedAt && ctx.now - m.claimedAt > 5 * 60000) ctx.emit('message.updated', { id: m.id, patch: { status: 'queued' } });
    }
    // 8. walk-ins called more than 20 minutes ago and never seated
    for (const q of s.queue.values()) {
      if (q.status === 'called' && q.calledAt && ctx.now - q.calledAt > 20 * 60000) ctx.emit('queue.updated', { id: q.id, patch: { status: 'left', auto: true } });
      else if (q.status === 'waiting' && ctx.now - q.at > 4 * 3600000) ctx.emit('queue.updated', { id: q.id, patch: { status: 'left', auto: true } });
    }
    // 9. the registered steps (a forgotten Z…)
    const steps = runSteps(s, ctx);
    return { queued: n, warnings: steps.warnings, failed: steps.failed };
  }
};
