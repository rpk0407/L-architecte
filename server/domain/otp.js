// @ts-check
// AC-01 · Sign-in codes that are never stored. The challenge IS the queued text (message.queued, template 'otp'): its
// body holds the placeholder {code}, and the six digits are derived from the server's secret and the message's id
// (otpCode), filled in only as the text leaves (FILLERS, domain/messages.js). So the outbox, an export and the journal only
// ever show {code}, there is no challenge event nor hash to leak, and every instance computes the same code.
// A code lives OTP_TTL, works once (s.otpUsed: account.signedIn and account.codeBurned add to it) and dies after
// OTP_TRIES wrong tries counted in the journal (account.codeMissed), whichever instance counted them.
// Importing this module registers the filler: commands/accounts.js does, so does every route file that queues a code.
import { createHmac } from 'node:crypto';
import { FILLERS } from './messages.js';

/** The text's fixed words: not in TEMPLATES, so the owner cannot break it (an edited text without {code} sends no code). */
export const OTP_TEXT = "L'Architecte : {code} est ton code pour ouvrir ton espace (10 min). Ne le donne à personne.";
export const OTP_TTL = 10 * 60000;
/** Codes per file per day (ids msg_otp_<cid>_<day>_<n>), within the shared cap of every « send me a link » (domain/linkcap.js). */
export const OTP_PER_DAY = 3;
/** Wrong tries a code survives, counted across instances (account.codeMissed). */
export const OTP_TRIES = 5;
const GONE = new Set(['failed', 'skipped', 'expired']);

/** The message key of the n-th code of a file on a day. */
export const otpKey = (cid, day, n) => 'otp_' + cid + '_' + day + '_' + n;

/** The six digits of a code: the first 4 bytes of HMAC-SHA256(secret, 'otp:' + msgId) as an unsigned integer, mod 10⁶. */
export function otpCode(secret, msgId) {
  const h = createHmac('sha256', String(secret)).update('otp:' + msgId).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

/** What a code text says when it leaves after its code died (no SMS route for a while, an outage): no dead digits. */
export const OTP_LATE_TEXT = "L'Architecte : ce code a expiré avant de partir. Redemande-en un si tu veux ouvrir ton espace.";

/**
 * The words the text leaves with: {code} filled, and a last line Android Chrome reads (WebOTP, `@host #code`); iOS and
 * Android keyboards offer the code anyway through autocomplete="one-time-code". A body without the placeholder (a text
 * queued by hand) leaves as it is. Past OTP_TTL (now given), the code is dead: the text says so instead.
 * @param {{ id: string, body: string, at?: number }} m @param {string} secret @param {string} host @param {number} [now]
 */
export function fillOtp(m, secret, host, now) {
  const body = String(m.body || '');
  if (!body.includes('{code}')) return body;
  if (now != null && m.at != null && now - m.at >= OTP_TTL) return OTP_LATE_TEXT;
  const code = otpCode(secret, m.id);
  return body.split('{code}').join(code) + (host ? '\n\n@' + host + ' #' + code : '');
}

/** The salon's host for the WebOTP line: the public address, else the one requests came on. */
export function otpHost(rt) {
  try { return new URL((rt.cfg && rt.cfg.publicUrl) || rt.origin).host; } catch { return ''; }
}

FILLERS.otp = (m, rt) => fillOtp(m, rt.secret, otpHost(rt), rt.engine && typeof rt.engine.clock === 'function' ? rt.engine.clock() : Date.now());

/** Wrong tries recorded against this code (projections/accounts.js). */
export const missesOf = (s, msgId) => (s.codeMisses && s.codeMisses.get(msgId)) || { n: 0, names: 0 };

/**
 * The codes of a file that may still open its space: queued on it less than OTP_TTL ago, not failed nor skipped, not
 * used nor burned, fewer than OTP_TRIES wrong tries. Oldest first.
 * @returns {any[]} the messages
 */
export function liveCodes(s, cid, now) {
  const out = [];
  for (const m of s.messages.values()) {
    if (m.template !== 'otp' || m.cid !== cid || GONE.has(m.status) || now - m.at >= OTP_TTL || now < m.at) continue;
    if ((s.otpUsed && s.otpUsed.has(m.id)) || missesOf(s, m.id).n >= OTP_TRIES) continue;
    out.push(m);
  }
  return out.sort((a, b) => a.at - b.at);
}
