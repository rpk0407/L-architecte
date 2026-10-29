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
  init(s) { s.bascule = { frozenAt: 0, switchedAt: 0, forced: null, ticks: {}, sinceAt: 0, history: [] }; },
  on: {
    // each moment counts once: a replayed or repeated event keeps the first. `sinceAt` is the first freeze ever: the list of what
    // changed here since then stays whole through a rolled-back switch and a second try
    'bascule.frozen': (s, e, d) => {
      if (s.bascule.frozenAt) return;
      s.bascule.frozenAt = (d && d.at) || e.at;
      if (!s.bascule.sinceAt) s.bascule.sinceAt = s.bascule.frozenAt;
    },
    // the owner takes the switch back (the return plan): freeze, final sync and switch are all to do again, the sends are held again
    // (cutoverHold reads switchedAt), what was ticked after the switch is not true any more, the history keeps what was undone
    'bascule.rolledback': (s, e, d) => {
      const B = s.bascule;
      B.history.push({ at: (d && d.at) || e.at, reason: String((d && d.reason) || ''), frozenAt: B.frozenAt, switchedAt: B.switchedAt, forced: !!B.forced });
      if (!B.sinceAt) B.sinceAt = B.frozenAt || B.switchedAt;
      B.frozenAt = 0; B.switchedAt = 0; B.forced = null;
      for (const k of ['reminders-off', 'app-password', 'licences', 'ancien-removed']) delete B.ticks[k];
    },
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

/** A bookings export or the XML of the plugin, with something in it. */
const isBookings = (f) => (f.kind === 'bookings' || f.kind === 'wxr') && f.rows > 0;
/** Did this run read an export of the bookings? A run of gift cards only, or of an empty file, carries nothing of what changed on the old site. @param {any} r */
export const holdsBookings = (r) => (r.files || []).some(isBookings);
/**
 * What a run's bookings export says about itself: how many bookings, when the file was made (its own date: the browser's File.lastModified,
 * 0 when unknown) and the newest booking it holds (the old site's creation time).
 * @param {any} r
 */
export function exportOf(r) {
  const fs = (r.files || []).filter(isBookings);
  const csv = fs.filter((f) => f.kind === 'bookings');
  return { rows: (csv.length ? csv : fs).reduce((t, f) => t + f.rows, 0), at: Math.max(0, ...fs.map((f) => f.at || 0)), newest: Math.max(0, ...fs.map((f) => f.newest || 0)) };
}
/** An export made more than this long before the freeze cannot hold what changed after it. */
export const STALE_EXPORT_MS = 10 * 60000;

/**
 * The latest run finished after the freeze that read an export of the bookings: the final sync, or null. A run made of
 * gift cards, or of nothing, is not one.
 * @param {any} s
 */
export function finalSync(s) {
  const frozen = s.bascule && s.bascule.frozenAt;
  if (!frozen || !s.imports) return null;
  let best = null;
  for (const r of s.imports.runs.values()) if (r.finishedAt > frozen && !r.undoneAt && holdsBookings(r) && (!best || r.finishedAt > best.finishedAt)) best = r;
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
