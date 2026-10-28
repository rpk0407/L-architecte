// @ts-check
// FID-01 · One cap for every « send me a link »: the texts a client asks for with nothing but a number or an address
// (the links of /mon-rendez-vous, a sign-in code, a link to his membership or his space, an access invite). Whoever types
// a number can make the salon text it: together they stay at LINK_PER_DAY a day per file, whichever page asked, and the
// pages share one limit per device. Each route checks both before it queues (routes-client.js for lookup; AC-01, PAY-03
// and AC-05 for theirs).
import { localParts } from '../../shared/dates.js';

/** The templates that count: one file, one day, LINK_PER_DAY of them together. */
export const LINK_TEMPLATES = /** @type {const} */ (['lookup', 'otp', 'memberLink', 'mlogin', 'accesInvite']);
const LINKS = new Set(/** @type {readonly string[]} */ (LINK_TEMPLATES));
export const LINK_PER_DAY = 3;
/** Asks per device (IP) an hour, every such page together: guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR) */
export const LINK_IP_PER_HOUR = 10;
export const linkIpKey = (ip) => 'link|' + ip;
/** The same in one instance's memory per number (before anything is written): limited(linkPhoneKey(phone), LINK_PER_DAY, DAY) */
export const linkPhoneKey = (phone) => 'linkn|' + phone;

/**
 * The link texts this file was queued on the salon's day `day` (whatever became of them: a text that failed was still
 * asked for). Read from the journal's messages, so every server instance counts the same.
 * @param {any} s @param {string} cid @param {string} day
 */
export function linkSendsToday(s, cid, day) {
  let n = 0;
  for (const m of s.messages.values()) if (m.cid === cid && LINKS.has(m.template) && localParts(m.at).day === day) n++;
  return n;
}

/** May this file be sent one more link today? */
export const linkAllowed = (s, cid, day) => linkSendsToday(s, cid, day) < LINK_PER_DAY;
