// @ts-check
// FEATURE C · the answer to « Le client est là ? » (domain/arrival.js). « Il est là » and « Absent » are the usual status
// changes (setStatus: same rules, an absence refused before the start); « Pas encore » writes when it was said on the
// booking, so the question comes back 10 minutes later on every phone and instance. Each answer is idempotent: a second
// tap, a retry or a colleague who answered first changes nothing and is not an error.
import { fail } from '../core/engine.js';
import { id, obj, oneOf, parse } from '../lib/validate.js';
import { getAppt, needChair } from './common.js';
import { setStatus } from './agenda.js';

const schema = obj({ id: id(), answer: oneOf(/** @type {const} */ (['here', 'later', 'absent'])) });
const CAME = new Set(['arrived', 'in_chair', 'done']);

export const answerArrival = {
  run(s, input, ctx) {
    const x = parse(schema, input);
    const a = getAppt(s, x.id);
    needChair(ctx, a.staffId);
    if (a.status === 'cancelled') fail(409, 'closed', 'Ce rendez-vous est annulé.');
    if (x.answer === 'here') {
      if (CAME.has(a.status)) return { ok: true, status: a.status };
      setStatus.run(s, { id: a.id, status: 'arrived' }, ctx);
      return { ok: true, status: 'arrived' };
    }
    if (x.answer === 'absent') {
      if (a.status === 'no_show') return { ok: true, status: a.status };
      setStatus.run(s, { id: a.id, status: 'no_show' }, ctx);
      return { ok: true, status: 'no_show' };
    }
    // « Pas encore »: only for a booking of today that has started and where the client is still awaited
    if (a.status !== 'booked' && a.status !== 'pending') return { ok: true, status: a.status };
    if (a.day !== ctx.local.day || a.start > ctx.local.min) fail(409, 'early', 'Le rendez-vous n’a pas encore commencé.');
    const prev = a.arrivalLater;
    if (prev && prev.day === a.day && prev.min === ctx.local.min) return { ok: true, status: a.status };
    ctx.emit('appt.updated', { id: a.id, patch: { arrivalLater: { day: a.day, min: ctx.local.min, by: (ctx.staff && ctx.staff.id) || null } }, cid: a.clientId || undefined });
    return { ok: true, status: a.status };
  }
};
