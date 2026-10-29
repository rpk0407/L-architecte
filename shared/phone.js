// @ts-check
// Phone numbers typed on the old WordPress site, read the same way by the import wizard (its preview) and the
// server (which decides): one module, so the two can never disagree.

/** Country codes texts are sent to without a second look (France, overseas, neighbours). Any other explicit +CC number is kept as written, not texted blindly. */
export const PHONE_PREFIXES = ['33', '32', '41', '352', '377', '262', '269', '590', '594', '596', '687', '689', '34', '39', '44', '49', '351', '212', '213', '216'];

/**
 * A phone number from the old site, where the country code sits apart (_sln_booking_sms_prefix) and the
 * number is often typed without its 0 ('612345678'). E.164, or null when it needs a human look.
 * An explicit +CC / 00CC number of 8 to 15 digits is read as it is, whatever the country (Dakar, Beirut, Istanbul…);
 * a French number keeps its strict shape. The prefix field accepts any 1 to 3 digit code.
 * @param {any} raw @param {any} [prefix]
 * @returns {string|null}
 */
export function normPhoneImport(raw, prefix) {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  // a « + » before the first digit ('tel: +221 …' too), or the 00 of the international call prefix
  const intl = /^[^\d+]*\+/.test(s) || d.startsWith('00');
  if (d.startsWith('00')) d = d.slice(2);
  const p = String(prefix || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!intl && /^\d{1,3}$/.test(p) && p !== '33') {
    // already written with the code ('221771234567' with prefix 221): not the code twice
    if (d.startsWith(p) && /^[1-9]\d{7,11}$/.test(d.slice(p.length))) return '+' + d;
    d = d.replace(/^0/, '');
    return /^\d{6,12}$/.test(d) ? '+' + p + d : null;
  }
  if (/^330\d{9}$/.test(d)) return '+33' + d.slice(3); // "+33 (0)6 …"
  if (/^33\d{9}$/.test(d)) return '+33' + d.slice(2);
  if (!intl && /^[67]\d{8}$/.test(d)) return '+33' + d;
  if (!intl && /^0[1-9]\d{8}$/.test(d)) return '+33' + d.slice(1);
  // any other country: 8 to 15 digits, no leading 0; a +33 with the wrong number of digits stays unreadable
  if (intl && !d.startsWith('33') && /^[1-9]\d{7,14}$/.test(d)) return '+' + d;
  return null;
}
