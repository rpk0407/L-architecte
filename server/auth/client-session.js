// @ts-check
// AC-01 · The client's session: one cookie, lx_c, that keeps a phone signed in to its space. Independent of the staff's
// lx_s (another name, another domain-separated signature: 'client:' here, 'session:' there), so neither can pass for
// the other. SameSite=Lax, not Strict: /moi opened from an SMS or a mail arrives signed in; writes stay protected by the
// same-origin check every POST goes through (http/kit.js sameOrigin).
// The cookie names the file and a tag of the phone it was opened with; every request checks it against the live state
// (liveClient): a file erased or merged into one with another number, a phone changed or detached by the salon,
// « Déconnecter tous mes appareils » and « Supprimer mon espace » end it at once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rand62 } from '../lib/util.js';
import { accountOf } from '../projections/accounts.js';

export const CLIENT_COOKIE = 'lx_c';
const DAY = 86400000;
/** re-issued (sliding) once a week, never on every request */
export const CLIENT_SLIDE = 7 * DAY;

/**
 * cid: the file signed in on (merges are followed at each request); ph: phoneTag of its number then; demo: the demo's
 * persona (its writes are simulated, http/me-kit.js isPersona)
 * @typedef {{ sid: string, cid: string, ph: string, iat: number, exp: number, demo?: boolean }} ClientPayload
 */

/** @param {string} secret @param {string} data */
const mac = (secret, data) => createHmac('sha256', String(secret)).update(data).digest('base64url');
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** 16 characters that say which number a session was opened with, and nothing about it. */
export const phoneTag = (secret, phone) => mac(secret, 'client-phone:' + String(phone || '')).slice(0, 16);

/** @param {string} secret @param {Omit<ClientPayload, 'sid'> & { sid?: string }} p */
export function signClient(secret, p) {
  const payload = Buffer.from(JSON.stringify({ sid: rand62(16), ...p })).toString('base64url');
  return payload + '.' + mac(secret, 'client:' + payload);
}

/** @returns {ClientPayload|null} a genuine, unexpired cookie (not yet checked against the state) */
export function readClient(secret, token, now) {
  if (!token || token.length > 1024) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  if (!eq(sig, mac(secret, 'client:' + payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp <= now || typeof p.iat !== 'number' || typeof p.cid !== 'string' || typeof p.ph !== 'string') return null;
    return p;
  } catch { return null; }
}

/**
 * Is this session still good against the current state? The file (through its merges, at most 20), not erased, with the
 * same number as at sign-in, an open account on it or a file merged into it, and nothing revoked since the cookie.
 * @param {(c: any) => string[]} idsOf the file and every file merged into it (commands/clients.js fileIds)
 * @returns {{ c: any, cid: string, ids: string[], account: any } | null}
 */
export function liveClient(s, secret, p, idsOf) {
  let c = s.clients.get(p.cid);
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto);
  if (!c || c.mergedInto || c.erased || !c.phone) return null;
  if (!eq(phoneTag(secret, c.phone), p.ph)) return null;
  const ids = idsOf(c);
  const account = accountOf(s, ids);
  if (!account || p.iat <= account.revokedAt) return null;
  return { c, cid: c.id, ids, account };
}
