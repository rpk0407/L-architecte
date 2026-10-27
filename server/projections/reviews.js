// @ts-check
// Google reviews, as the projection folds them: which review requests had their link opened (review.clicked, from
// GET /avis/:token, server/http/routes-reviews.js). The request itself is an ordinary message (template 'review') in
// s.messages; a click names only that message's id, so it holds no personal data and an erasure has nothing to blank here.
// Registered in core/extensions.js; the commands are in commands/reviews.js. No import of the engine or the state here.
// reviewStats (Rapports › Avis Google) is here too (FID-01), so domain modules read it without importing a route.
import { localParts } from '../../shared/dates.js';

/** @type {import('../core/extensions.js').Extension} */
export const reviewsExtension = {
  init(s) { s.reviewClicks = new Map(); },
  on: {
    // the first opening counts; the command never writes a second one, and a replayed journal keeps the first anyway
    'review.clicked': (s, e, d) => { if (d && d.id && !s.reviewClicks.has(d.id)) s.reviewClicks.set(d.id, e.at); }
  }
};

/** When this request's link was first opened, or 0. */
export const clickedAt = (s, msgId) => (s.reviewClicks && s.reviewClicks.get(msgId)) || 0;

/** A message that really left: sent, or in the demo simulated (in production a simulated text never reached anyone). */
export const left = (s, m) => m.status === 'sent' || (s.mode === 'demo' && m.status === 'simulated');
export const FAILED = new Set(['failed', 'skipped', 'expired']);

/**
 * The review requests of a period (by the day they left), how many had their link opened, by barber. Only requests about a
 * visit count: the owner's tests have none.
 * @param {any} s @param {string} from @param {string} to @param {string|null} [staffId]
 */
export function reviewStats(s, from, to, staffId = null) {
  /** @type {Map<string, { sent: number, opened: number }>} */
  const by = new Map();
  let sent = 0, opened = 0, waiting = 0, failed = 0;
  for (const m of s.messages.values()) {
    if (m.template !== 'review' || !m.apptId) continue;
    const a = s.appts.get(m.apptId);
    if (staffId && (!a || a.staffId !== staffId)) continue;
    const day = localParts(m.sentAt || m.dueAt || m.at).day;
    if (day < from || day > to) continue;
    if (m.status === 'queued' || m.status === 'claimed') { waiting++; continue; }
    if (FAILED.has(m.status) || !left(s, m)) { failed++; continue; }
    const open = clickedAt(s, m.id) ? 1 : 0;
    sent++; opened += open;
    const k = a ? a.staffId : '';
    const row = by.get(k) || { sent: 0, opened: 0 };
    row.sent++; row.opened += open;
    by.set(k, row);
  }
  const staff = [...by.entries()].map(([id, x]) => {
    const st = s.staff.get(id);
    return { id, name: st ? st.name : 'Sans barbier', color: st ? st.color || '' : '', sent: x.sent, opened: x.opened, rate: x.sent ? x.opened / x.sent : 0 };
  }).sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  return { from, to, sent, opened, rate: sent ? opened / sent : 0, waiting, failed, staff, on: !!s.settings.messages.review, link: !!s.settings.shop.reviewUrl };
}
