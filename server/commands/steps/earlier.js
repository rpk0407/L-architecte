// @ts-check
// FEATURE B · « Un créneau s'est libéré plus tôt », a tick step. A client who ticked « Préviens-moi si un créneau se libère
// plus tôt » on a booking (appt.earlier, commands/me.js setEarlierAlert) hears of it when a cancellation of the last
// FREED_MS frees an earlier slot with the same barber that still fits his booking (same services, same length, online
// rules). The text goes by the channel he chose (domain/notify.js viaOf): an e-mail, or the salon's current way to a phone
// (SMS, WhatsApp automatic, or the WhatsApp hand queue of messaging/hand.js). It carries his booking's link with the slot
// (?plus-tot=day.minute): the /r/ page offers to move there, through the usual move (moveByClient checks the slot again).
// Deterministic keys (booking + slot): two ticks or two servers queue it once. At most PER_DAY such texts per booking a day.
import { freeSlots } from '../../domain/availability.js';
import { queueMessage, whenWords, afterQuiet } from '../../domain/messages.js';
import { clientMayChange, startsAt } from '../../domain/policy.js';
import { viaOf, contactCidOf, forFirstIn } from '../../domain/notify.js';
import { fileIds } from '../clients.js';
import { rootFile } from '../accounts.js';
import { localParts } from '../../../shared/dates.js';

/** A cancellation older than this is not news any more (a later tick does not dig it up). */
export const FREED_MS = 30 * 60000;
/** The freed slot must start at least this long after the text leaves: time to read it and come. */
export const LEAD_MIN = 90;
export const PER_DAY = 2;
export const EARLIER_TEMPLATE = 'earlier';

/** The words of the text: the barber, the slot, and for whom when it was booked for someone else. */
export function earlierText(o) {
  return "L'Architecte : un créneau s'est libéré plus tôt avec " + o.barbier + ' : ' + o.date + ' à ' + o.heure + '. Pour y avancer le rendez-vous' + (o.pour ? ' de ' + o.pour : '') + ' : ' + o.lien;
}

export default {
  name: 'earlier',
  run(s, ctx) {
    const since = ctx.now - FREED_MS;
    /** @type {{ staffId: string, day: string, start: number, end: number }[]} */
    const freed = [];
    for (const a of s.appts.values()) if (a.status === 'cancelled' && a.cancel && a.cancel.at >= since && startsAt(a) > ctx.now) freed.push({ staffId: a.staffId, day: a.day, start: a.start, end: a.start + a.dur });
    if (!freed.length) return;
    const M = s.settings.messages;
    const due = afterQuiet(M.quiet, ctx.now);
    const dueL = localParts(due);
    for (const w of s.appts.values()) {
      if (!w.earlier || w.status !== 'booked' || w.demo || !clientMayChange(s, w, ctx.now)) continue;
      const c = rootFile(s, contactCidOf(w, s));
      if (!c || c.erased) continue;
      let sent = 0;
      for (const m of s.messages.values()) if (m.apptId === w.id && m.template === EARLIER_TEMPLATE && localParts(m.at).day === ctx.local.day) sent++;
      if (sent >= PER_DAY) continue;
      const mine = freed.filter((f) => f.staffId === w.staffId && (f.day < w.day || (f.day === w.day && f.start < w.start)));
      let pick = null;
      for (const f of mine) {
        const slot = freeSlots(s, { day: f.day, dur: w.dur, serviceIds: w.services.map((x) => x.id), staffId: w.staffId, now: ctx.now, local: ctx.local, online: true, ignoreAppt: w.id })
          .find((x) => x.m >= f.start && x.m < f.end && (f.day > dueL.day || x.m >= dueL.min + LEAD_MIN) && (f.day < w.day || x.m < w.start));
        if (slot && (!pick || f.day < pick.day || (f.day === pick.day && slot.m < pick.m))) pick = { day: f.day, m: slot.m };
      }
      if (!pick) continue;
      const st = s.staff.get(w.staffId);
      const link = ctx.meta && ctx.meta.linkFor ? ctx.meta.linkFor(w) + '?plus-tot=' + pick.day + '.' + pick.m : '';
      const vars = { barbier: st ? st.name : 'ton barbier', ...whenWords(pick.day, pick.m), pour: forFirstIn(s, fileIds(s, c), w), lien: link };
      const key = 'early_' + w.id + '_' + pick.day + '_' + pick.m;
      const via = viaOf(s, c);
      if (via === 'email') {
        queueMessage(s, ctx, { key, channel: 'email', template: EARLIER_TEMPLATE, to: c.email, cid: c.id, apptId: w.id, vars, dueAt: due,
          subject: 'Un créneau s’est libéré plus tôt', text: ['Bonjour' + (c.first ? ' ' + c.first : '') + ',', '', earlierText(vars).replace(/^L'Architecte : u/, 'U'), '', 'Premier arrivé, premier servi : si le créneau est déjà repris, ton rendez-vous ne bouge pas.', '', s.settings.shop.name].join('\n') });
      } else if (c.phone) {
        queueMessage(s, ctx, { key, template: EARLIER_TEMPLATE, text: earlierText(vars), to: c.phone, cid: c.id, apptId: w.id, vars, dueAt: due });
      }
    }
  }
};
