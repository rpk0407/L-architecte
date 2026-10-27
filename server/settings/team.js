// @ts-check
// Équipe et accès: what barbers may do beyond their own chair (the server turns these into capabilities).
// timeoffApproval (DO-05): an absence a barber posts for himself waits for the owner (timeoff.requested) instead of
// closing his slots at once.
// TEAM-01: teamView is what a barber sees of colleagues ('off' nothing, 'salon' the salon's progress in %, 'named' each
// barber's figures without commissions or tips: report.team); barberRebook gives barbers client.rebook (off in production,
// on in the demo); personalPhones and staffCalendar are read by TEAM-02. barberSeeRevenue is the old switch: it stays in
// the schema so old patches validate, and a journal that has it without a teamView reads as 'named' (teamViewOf).
import { int, bool, opt, obj, oneOf } from '../lib/validate.js';

const VIEWS = /** @type {const} */ (['off', 'salon', 'named']);
const shape = obj({
  barberCheckout: opt(bool()), barberAllAgenda: opt(bool()), barberMaxDiscountPct: opt(int({ min: 0, max: 50 })), barberSeeRevenue: opt(bool()), timeoffApproval: opt(bool()),
  teamView: opt(oneOf(VIEWS)), barberRebook: opt(bool()), personalPhones: opt(bool()), staffCalendar: opt(bool())
});

export default /** @type {const} */ ({
  key: 'team',
  defaults: () => ({ barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false, timeoffApproval: true, teamView: /** @type {'off'|'salon'|'named'} */ ('salon'), barberRebook: false, personalPhones: true, staffCalendar: true }),
  // a chosen teamView retires the old switch in the same patch, so the legacy rule never overrides an explicit choice
  schema: /** @type {typeof shape} */ ({ parse(x, p) { const v = shape.parse(x, p); if (v.teamView !== undefined) v.barberSeeRevenue = false; return v; } })
});

/**
 * What barbers see of their colleagues. The defaults always carry teamView, so "no teamView" in an old journal shows as
 * barberSeeRevenue still true: no patch with a teamView ever came (each one clears it).
 * @param {any} settings
 * @returns {'off'|'salon'|'named'}
 */
export function teamViewOf(settings) {
  const t = (settings && settings.team) || {};
  if (t.barberSeeRevenue === true) return 'named';
  return VIEWS.includes(t.teamView) ? t.teamView : 'salon';
}
