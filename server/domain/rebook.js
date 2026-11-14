// @ts-check
// Who can get a follow-up text (a « relance »). One definition for the Relances page, the Clients segment, the badge of
// the pulse and the Accueil's card (domain/home.js): moved here from http/routes-staff.js, word for word.
import { clientStats } from './insights.js';
import { messageId } from './messages.js';

/**
 * Can this client get a follow-up text? Agreed to the offers, takes SMS, and not seen in the last week. With `s` and `day`
 * (the salon's local day): and not already texted today (one offer a day, the send's own key), so a relance sent leaves
 * the badge, the Accueil's card and the Relances list at once instead of staying counted until he books.
 */
export function rebookable(c, st, s, day) {
  return !c.erased && !c.mergedInto && c.sms && !!c.phone && c.marketing && st.sinceLast != null && st.sinceLast >= 7
    && !(s && day && s.messages.has(messageId('rebook_' + c.id + '_' + day)));
}

/**
 * The regulars past their rhythm who can be texted now, as the badge counts them (routes-staff.js badges): overdue in
 * clientStats and rebookable. Each with his figures (`st.avgTicket` = spend ÷ visits, the estimate of what a visit brings).
 * @param {any} s @param {string} today @param {number} now
 * @returns {{ c: any, st: any }[]}
 */
export function relances(s, today, now) {
  const out = [];
  for (const [id, st] of clientStats(s, today, now)) { const c = st.overdue && s.clients.get(id); if (c && rebookable(c, st, s, today)) out.push({ c, st }); }
  return out;
}
