// @ts-check
// Phone numbers typed on the old WordPress site, read the same way by the import wizard (its preview) and the
// server (which decides): one module, so the two can never disagree.

/** Country codes a WordPress number may carry (France, overseas, neighbours): kept as they are. */
export const PHONE_PREFIXES = ['33', '32', '41', '352', '377', '262', '269', '590', '594', '596', '687', '689', '34', '39', '44', '49', '351', '212', '213', '216'];

/**
 * A phone number from the old site, where the country code sits apart (_sln_booking_sms_prefix) and the
 * number is often typed without its 0 ('612345678'). E.164, or null when it needs a human look.
 * @param {any} raw @param {any} [prefix]
 * @returns {string|null}
 */
export function normPhoneImport(raw, prefix) {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  const intl = s.startsWith('+') || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);
  const p = String(prefix || '').replace(/\D/g, '');
  if (!intl && p && p !== '33' && PHONE_PREFIXES.includes(p)) { d = d.replace(/^0/, ''); return /^\d{6,12}$/.test(d) ? '+' + p + d : null; }
  if (/^330\d{9}$/.test(d)) return '+33' + d.slice(3); // "+33 (0)6 …"
  if (/^33\d{9}$/.test(d)) return '+33' + d.slice(2);
  if (!intl && /^[67]\d{8}$/.test(d)) return '+33' + d;
  if (!intl && /^0[1-9]\d{8}$/.test(d)) return '+33' + d.slice(1);
  if (intl) for (const k of PHONE_PREFIXES) if (k !== '33' && d.startsWith(k) && /^\d{6,12}$/.test(d.slice(k.length))) return '+' + d;
  return null;
}
