// @ts-check
// Objectifs: the salon's monthly revenue target, shown in Rapports, and each barber's (TEAM-03).
//   staff        staff id → his monthly target in cents, or null for automatic: the salon's target × his share of the
//                month's open chair minutes, rounded to 10 € (goalOf, server/domain/insights.js). A key per barber, so a
//                patch of one keeps the others (settings merge per key).
//   showBarbers  a barber sees his own goal in Mes chiffres (never the salon's in euros)
import { bool, opt, nullable, obj, money, record } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'goals',
  defaults: () => ({ monthCents: 2400000, staff: /** @type {Record<string, number|null>} */ ({}), showBarbers: true }),
  schema: obj({ monthCents: opt(money(100000000)), staff: opt(record(/^[A-Za-z0-9_:-]{1,64}$/, nullable(money(100000000)), { max: 40 })), showBarbers: opt(bool()) })
});
