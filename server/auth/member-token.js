// @ts-check
// A member's own page (PAY-03): a signed link that cancels a membership or changes its card must not live for ever.
// The expiry rides inside the signed id (mb_…~<expiry in base 36>), so a link cannot be stretched without breaking its
// signature; the plain signed links of auth/session.js stay as they are for the appointments.
import { signLink, checkLink } from './session.js';

export const MEMBER_LINK = 'mbr';
/** a link in a text the salon sends (welcome, failed payment, acknowledgements) */
export const MEMBER_TEXT_TTL = 7 * 86400000;
/** a link asked for from /resilier (lookup): it reaches whoever holds the phone or the mailbox now */
export const MEMBER_ASK_TTL = 3600000;

/** @param {string} secret @param {string} memberId @param {number} exp the instant it stops working (ms) */
export function memberToken(secret, memberId, exp) {
  return signLink(secret, MEMBER_LINK, memberId + '~' + Math.floor(exp).toString(36));
}

/**
 * The member a link names, or why not: 'invalid' (not ours, altered) or 'expired' (genuine, too old).
 * @param {string} secret @param {string} token @param {number} now
 * @returns {{ id: string, exp: number } | { error: 'invalid'|'expired' }}
 */
export function readMemberToken(secret, token, now) {
  const v = checkLink(secret, MEMBER_LINK, token);
  const i = v ? v.lastIndexOf('~') : -1;
  if (!v || i < 1) return { error: 'invalid' };
  const exp = parseInt(v.slice(i + 1), 36);
  if (!Number.isFinite(exp)) return { error: 'invalid' };
  if (exp <= now) return { error: 'expired' };
  return { id: v.slice(0, i), exp };
}
