// @ts-check
// Staff sessions and signed links. Sessions are HMAC-signed, short-lived cookies; the server can
// revoke them all for a person (password change, departure) or a device (lost tablet) at once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rand62, sha256 } from '../lib/util.js';

export const SESSION_COOKIE = 'lx_s';
export const DEVICE_COOKIE = 'lx_d';
export const HOUR = 3600000;

/** @param {string} secret @param {string} data */
function mac(secret, data) { return createHmac('sha256', secret).update(data).digest('base64url'); }
function eq(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

/**
 * @typedef {{ sid: string, uid: string, did?: string|null, kind: 'pwd'|'pin', iat: number, exp: number }} SessionPayload
 */

/** @param {string} secret @param {Omit<SessionPayload, 'sid'>} p */
export function signSession(secret, p) {
  const payload = Buffer.from(JSON.stringify({ sid: rand62(16), ...p })).toString('base64url');
  return payload + '.' + mac(secret, 'session:' + payload);
}

/** @returns {SessionPayload|null} */
export function readSession(secret, token, now) {
  if (!token || token.length > 1024) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  if (!eq(sig, mac(secret, 'session:' + payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp <= now || typeof p.uid !== 'string') return null;
    return p;
  } catch { return null; }
}

/**
 * Is this signed session still good against the current state?
 * @returns {{ staff: any, device: any } | null}
 */
export function liveSession(s, p, deviceToken) {
  const staff = s.staff.get(p.uid);
  if (!staff || !staff.active) return null;
  if (staff.revokedAt && p.iat <= staff.revokedAt) return null;
  let device = null;
  if (p.did) {
    device = s.devices.get(p.did);
    if (!device || device.revoked) return null;
    // a PIN session only lives on the device it was opened on
    if (p.kind === 'pin' && (!deviceToken || s.deviceByHash.get(sha256(deviceToken)) !== p.did)) return null;
  }
  return { staff, device };
}

/* ---------------- signed links: manage my appointment, receipts, waitlist offers ---------------- */

export function linkSig(secret, kind, id) { return mac(secret, 'link:' + kind + ':' + id).slice(0, 22); }

/** "LA-7K2P.x9fT3…" for an appointment code */
export function signLink(secret, kind, id) { return id + '.' + linkSig(secret, kind, id); }

/** Returns the id when the link is genuine. */
export function checkLink(secret, kind, token) {
  const s = String(token || '');
  const i = s.lastIndexOf('.');
  if (i < 1 || s.length > 120) return null;
  const id = s.slice(0, i), sig = s.slice(i + 1);
  return eq(sig, linkSig(secret, kind, id)) ? id : null;
}
