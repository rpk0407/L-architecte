// @ts-check
// What the salon does on its own, checked about once a minute: unpaid bookings expire, reminders and
// review requests are queued, a freed slot is offered to the waiting list. Then the registered steps
// (tick-steps.js) run, such as the Z of a day nobody closed.
// Every message has a deterministic id, so running this twice (two servers, a retry) sends nothing twice.
import { addDays, instantOf } from '../../shared/dates.js';
import { freeSlots } from '../domain/availability.js';
import { queueMessage, apptVars, whenWords, afterQuiet } from '../domain/messages.js';
import { payDeadline } from '../domain/policy.js';
import { runSteps } from './tick-steps.js';

const OFFER_MIN = 30;

export const tick = {
  run(s, input, ctx) {
    const M = s.settings.messages;
    const L = ctx.local;
    const tomorrow = addDays(L.day, 1);
    let n = 0;
    const cap = 60; // bounded work per run

    for (const a of s.appts.values()) {
      if (n >= cap) break;
      // 1. a booking waiting for its deposit frees the slot when the time is up
      if (a.status === 'pending' && payDeadline(s, a) < ctx.now) {
        ctx.emit('appt.cancelled', { id: a.id, by: 'system', reason: 'Acompte non réglé', cid: a.clientId || undefined }); n++; continue;
      }
      if (a.demo && !input.demoMessages) continue;
      const c = a.clientId ? s.clients.get(a.clientId) : null;
      if (!c || !c.phone || !c.sms || c.erased) continue;
      // 2. the evening before
      if (M.reminder && a.status === 'booked' && a.day === tomorrow && L.min >= M.reminderHour * 60 && a.sms) {
        const createdToday = a.createdAt > instantOf(L.day, M.reminderHour * 60);
        if (!createdToday && queueMessage(s, ctx, { key: 'rem_' + a.id + '_' + a.day, template: 'reminder', to: c.phone, cid: c.id, apptId: a.id, vars: apptVars(s, a, ctx.meta.linkFor) })) n++;
      }
      // 3. two hours before (long services)
      if (M.reminder2h && a.status === 'booked' && a.day === L.day && a.start - L.min <= 120 && a.start - L.min > 60 && a.sms) {
        if (queueMessage(s, ctx, { key: 'rem2_' + a.id + '_' + a.day, template: 'reminder2h', to: c.phone, cid: c.id, apptId: a.id, vars: apptVars(s, a, ctx.meta.linkFor) })) n++;
      }
      // 4. thanks + review, once per client per quarter
      if (M.review && a.status === 'done' && a.day === L.day && a.statusAt.done && ctx.now - a.statusAt.done >= M.reviewDelayMin * 60000) {
        const q = L.day.slice(0, 5) + Math.ceil(+L.day.slice(5, 7) / 3);
        if (queueMessage(s, ctx, { key: 'rev_' + c.id + '_' + q, template: 'review', to: c.phone, cid: c.id, apptId: a.id, vars: apptVars(s, a) })) n++;
      }
    }

    // 5. the waiting list gets a freed slot first; no new offer during quiet hours: a 30-minute offer texted in the morning would be gone
    const quiet = afterQuiet(M.quiet, ctx.now) > ctx.now;
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
