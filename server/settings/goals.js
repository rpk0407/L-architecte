// @ts-check
// Objectifs: the monthly revenue target shown in Rapports.
import { opt, obj, money } from '../lib/validate.js';

export default /** @type {const} */ ({
  key: 'goals',
  defaults: () => ({ monthCents: 2400000 }),
  schema: obj({ monthCents: opt(money(100000000)) })
});
