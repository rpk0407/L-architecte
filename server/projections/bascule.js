// @ts-check
// Jour J, as the Comptoir records it (Réglages › Reprendre WordPress › Jour J): when WordPress was frozen, when the owner
// opened the sends (the switch), and the steps ticked by hand. Events carry no personal data: a date, an item, and the
// owner's reason when he forces the switch. `cutoverHold` is the one guard that keeps client texts from leaving before
// the switch (http/scheduler.js dispatch): WordPress still sends its own reminders, and the new salon's links would open
// a site that is not live. Registered in core/extensions.js; the commands are in commands/bascule.js, the checks in
// http/routes-bascule.js. No import of the engine or the state here.
import { TEMPLATE_FLAGS } from '../core/templates.js';

/** The steps only the owner can tick (WordPress and IONOS are outside the Comptoir). */
export const ITEMS = /** @type {const} */ (['reminders-off', 'cold-backup', 'app-password', 'ancien-noindex', 'licences', 'ancien-removed']);

/** @type {import('../core/extensions.js').Extension} */
export const basculeExtension = {
  init(s) { s.bascule = { frozenAt: 0, switchedAt: 0, forced: null, ticks: {} }; },
  on: {
    // each moment counts once: a replayed or repeated event keeps the first
    'bascule.frozen': (s, e, d) => { if (!s.bascule.frozenAt) s.bascule.frozenAt = (d && d.at) || e.at; },
    'bascule.switched': (s, e, d) => {
      if (s.bascule.switchedAt) return;
      s.bascule.switchedAt = (d && d.at) || e.at;
      if (d && d.force) s.bascule.forced = { reason: String(d.reason || '') };
    },
    'bascule.ticked': (s, e, d) => { if (d.done) s.bascule.ticks[d.item] = e.at; else delete s.bascule.ticks[d.item]; }
  }
};

/**
 * Is the new salon still waiting for the switch? A production salon that took over a WordPress run and has not opened its
 * sends. The demo never waits, nor does a salon that imported nothing (it has no old site to double texts with).
 * @param {any} s
 */
export const cutoverHold = (s) => s.mode === 'production' && !!s.imports && s.imports.runs.size > 0 && !(s.bascule && s.bascule.switchedAt);

/**
 * What the hold keeps back: a text to a client. Never what the client asked for himself (a sign-in code, a link), a
 * contract's acknowledgement (core/templates.js `requested`, `legal`), nor the owner's own (tests, summaries: no file).
 * @param {{ cid?: string|null, owner?: boolean, template: string }} m
 */
export function heldByCutover(m) {
  const f = TEMPLATE_FLAGS[m.template] || {};
  return !!m.cid && !m.owner && !f.requested && !f.legal;
}
/** @param {any} s @param {{ cid?: string|null, owner?: boolean, template: string }} m */
export const cutoverHeld = (s, m) => cutoverHold(s) && heldByCutover(m);

/** The latest run finished after the freeze: the final sync, or null. @param {any} s */
export function finalSync(s) {
  const frozen = s.bascule && s.bascule.frozenAt;
  if (!frozen || !s.imports) return null;
  let best = null;
  for (const r of s.imports.runs.values()) if (r.finishedAt > frozen && !r.undoneAt && (!best || r.finishedAt > best.finishedAt)) best = r;
  return best;
}

/**
 * Bookings the final sync brought that the old site took after the freeze: online booking was not cut when it was made.
 * Only the latest run after the freeze counts: a clean sync after the booking was really switched off clears it.
 * createdAt is the old site's own clock when the export has one; without it the state falls back on the import's time,
 * at or after the run's start.
 * @param {any} s
 */
export function lateBookings(s) {
  const frozen = s.bascule && s.bascule.frozenAt;
  const run = finalSync(s);
  if (!frozen || !run) return 0;
  let n = 0;
  for (const a of s.appts.values()) if (a.source === 'import' && a.ext && a.ext.run === run.id && a.createdAt > frozen && a.createdAt < run.startedAt) n++;
  return n;
}
