// @ts-check
// AC-01 · The demo is public: what a visitor types there (a booking with his name and number, a space opened on it) is
// erased two hours after his file was created through the site, so the next visitor never reads it and the showcase stays
// as seeded. His bookings to come are cancelled first (their slots free again), a membership he took ends, then the file
// is erased like any other (its account goes with it, projections/accounts.js). Demo salon only, at most PER_TICK files
// a tick; the seeded files (created at the salon) are never touched.
import { DEMO_PURGE_MS } from '../accounts.js';
import { fileIds } from '../clients.js';
import { endMember } from '../memberships.js';
import { isLive, graceOf } from '../../domain/membership.js';

export const PER_TICK = 20;
const OPEN = new Set(['pending', 'booked', 'arrived', 'in_chair']);
/** A file whose erasure was refused waits this long before it is tried again (this instance), so it never holds a slot. */
export const RETRY_MS = 3600000;
/** cid → when its erasure was last refused, in this instance (not state: what is emitted stays the journal's). */
const refused = new Map();

/** The visitors' files due now: created through the site, more than two hours ago, not erased or merged since, not
 *  refused within the hour. Only in the seeded demo (its showcase, demo.seeded): a demo journal nobody seeded has no
 *  visitors to forget. */
export function visitorFiles(s, now) {
  if (s.mode !== 'demo' || !s.demoDays.size) return [];
  const out = [];
  for (const c of s.clients.values()) {
    if (out.length >= PER_TICK) break;
    if (c.erased || c.mergedInto || c.demo || c.source !== 'site' || now - c.createdAt < DEMO_PURGE_MS) continue;
    if (now - (refused.get(c.id) ?? -Infinity) < RETRY_MS) continue;
    out.push(c);
  }
  return out;
}

export default {
  name: 'demo-purge',
  /** @param {any} s @param {import('../../core/engine.js').Ctx} ctx */
  run(s, ctx) {
    const files = visitorFiles(s, ctx.now);
    if (!files.length) return;
    // what this tick already cancelled (an unpaid deposit) is not cancelled twice
    const done = new Set(ctx.drafts.filter((d) => d.type === 'appt.cancelled').map((d) => d.data.id));
    const grace = graceOf(s);
    for (const c of files) {
      // one file refused (a membership that will not end) costs only its own events: the others still go
      const mark = ctx.drafts.length;
      try {
        const ids = fileIds(s, c);
        const set = new Set(ids);
        for (const a of s.appts.values()) {
          if (!set.has(a.clientId) || !OPEN.has(a.status) || done.has(a.id)) continue;
          ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: 'Démo : réservation d’un visiteur effacée', cid: a.clientId });
        }
        if (s.members) for (const m of s.members.values()) if (set.has(m.cid) && isLive(m, ctx.local.day, grace)) endMember.run(s, { id: m.id, reason: 'cancelled' }, ctx);
        for (const w of s.waitlist.values()) {
          if (!set.has(w.clientId) || (w.status !== 'waiting' && w.status !== 'offered')) continue;
          ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'removed' } });
          if (w.offer && w.offer.holdId && s.holds.has(w.offer.holdId)) ctx.emit('hold.released', { id: w.offer.holdId });
        }
        ctx.emit('client.erased', { id: c.id, cid: c.id, ids, demo: true });
      } catch (e) {
        ctx.drafts.length = mark;
        refused.set(c.id, ctx.now);
        console.error('[lx] demo-purge', c.id, e && /** @type {any} */ (e).message);
      }
    }
  }
};
