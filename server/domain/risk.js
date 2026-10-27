// @ts-check
// Deposits by history (Réglages › Réservation riskBased): who already missed. Apart from policy.js on purpose:
// policy.js stays free of read models (insights.js → availability.js → policy.js would close a module cycle).
import { clientStats } from './insights.js';
import { TRUSTED } from './policy.js';

/**
 * Has this client already missed (insights.js risk: two absences, or one before their third visit), so that the
 * salon's riskBased rule asks them a deposit whatever the price? Never for a file the salon marked as trusted.
 * @param {any} s @param {string|null|undefined} clientId @param {string} today
 */
export function riskDeposit(s, clientId, today) {
  if (!clientId || !s.settings.deposits || !s.settings.deposits.riskBased) return false;
  const c = s.clients.get(clientId);
  if (!c || c.erased || (c.tags || []).includes(TRUSTED)) return false;
  const st = clientStats(s, today).get(clientId);
  return !!(st && st.risk);
}
