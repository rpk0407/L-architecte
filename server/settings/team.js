// @ts-check
// Équipe et accès: what barbers may do beyond their own chair (the server turns these into capabilities).
// timeoffApproval (DO-05): an absence a barber posts for himself waits for the owner (timeoff.requested) instead of
// closing his slots at once.
// TEAM-01: teamView is what a barber sees of colleagues ('off' nothing, 'salon' the salon's progress in %, 'named' each
// barber's figures without commissions or tips: report.team); barberRebook gives barbers client.rebook (off in production,
// on in the demo); personalPhones and staffCalendar are read by TEAM-02. barberSeeRevenue is the old switch: it stays in
// the schema so old patches validate, and a journal that has it without a teamView reads as 'named' (teamViewOf).
// TEAM-03: every commission rule lives here (Équipe › Rémunération), read through payRulesOf: commissionBase 'ttc'|'ht'
// (the price the rate applies to), cutCredit 'performer'|'seller' (a carnet's cut counts for whoever cuts, at the price
// paid per cut, or the whole carnet for whoever sold it), memberCredit 'split'|'zero'|'list' (a member's cut at its share
// of the month, nothing, or its list price), rewardCredit 'list'|'net' (a free loyalty cut as if paid, or what was paid).
import { int, bool, opt, obj, oneOf } from '../lib/validate.js';

const VIEWS = /** @type {const} */ (['off', 'salon', 'named']);
const BASES = /** @type {const} */ (['ttc', 'ht']);
const CUTS = /** @type {const} */ (['performer', 'seller']);
const MEMBER = /** @type {const} */ (['split', 'zero', 'list']);
const REWARD = /** @type {const} */ (['list', 'net']);
const shape = obj({
  barberCheckout: opt(bool()), barberAllAgenda: opt(bool()), barberMaxDiscountPct: opt(int({ min: 0, max: 50 })), barberSeeRevenue: opt(bool()), timeoffApproval: opt(bool()),
  teamView: opt(oneOf(VIEWS)), barberRebook: opt(bool()), personalPhones: opt(bool()), staffCalendar: opt(bool()),
  commissionBase: opt(oneOf(BASES)), cutCredit: opt(oneOf(CUTS)), memberCredit: opt(oneOf(MEMBER)), rewardCredit: opt(oneOf(REWARD))
});

export default /** @type {const} */ ({
  key: 'team',
  defaults: () => ({ barberCheckout: true, barberAllAgenda: true, barberMaxDiscountPct: 10, barberSeeRevenue: false, timeoffApproval: true, teamView: /** @type {'off'|'salon'|'named'} */ ('salon'), barberRebook: false, personalPhones: true, staffCalendar: true,
    commissionBase: /** @type {'ttc'|'ht'} */ ('ttc'), cutCredit: /** @type {'performer'|'seller'} */ ('performer'), memberCredit: /** @type {'split'|'zero'|'list'} */ ('split'), rewardCredit: /** @type {'list'|'net'} */ ('list') }),
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

/**
 * How the figures credit a barber (TEAM-03), each rule at its default when an old journal never wrote it.
 * @param {any} settings
 * @returns {{ base: 'ttc'|'ht', cutCredit: 'performer'|'seller', memberCredit: 'split'|'zero'|'list', rewardCredit: 'list'|'net' }}
 */
export function payRulesOf(settings) {
  const t = (settings && settings.team) || {};
  return {
    base: t.commissionBase === 'ht' ? 'ht' : 'ttc',
    cutCredit: t.cutCredit === 'seller' ? 'seller' : 'performer',
    memberCredit: MEMBER.includes(t.memberCredit) ? t.memberCredit : 'split',
    rewardCredit: t.rewardCredit === 'net' ? 'net' : 'list'
  };
}
