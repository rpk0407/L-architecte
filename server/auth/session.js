// @ts-check
// Staff sessions and signed links. Sessions are HMAC-signed, short-lived cookies; the server can
// revoke them all for a person (password change, departure) or a device (lost tablet) at once.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rand62, sha256 } from '../lib/util.js';

export const SESSION_COOKIE = 'lx_s';
export const DEVICE_COOKIE = 'lx_d';
export const HOUR = 3600000;
/** a PIN session (a shared salon device) ends after this long without a request, whatever the screen does */
export const PIN_IDLE = 10 * 60000;
/** how often a PIN session's lastSeen is re-signed: often enough to slide, rarely enough to stay cheap */
const PIN_TOUCH = 60000;

/** @param {string} secret @param {string} data */
function mac(secret, data) { return createHmac('sha256', secret).update(data).digest('base64url'); }
function eq(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

/**
 * seen: a PIN session's last request (signed with it, so the server alone decides when it went idle)
 * @typedef {{ sid: string, uid: string, did?: string|null, kind: 'pwd'|'pin', iat: number, exp: number, seen?: number }} SessionPayload
 */

/** @param {string} secret @param {Omit<SessionPayload, 'sid'> & { sid?: string }} p */
export function signSession(secret, p) {
  const full = { sid: rand62(16), ...p };
  if (full.kind === 'pin' && full.seen == null) full.seen = full.iat;
  const payload = Buffer.from(JSON.stringify(full)).toString('base64url');
  return payload + '.' + mac(secret, 'session:' + payload);
}

/** A PIN session nobody used for PIN_IDLE: refused, whatever its expiry says. A password session never idles out. */
export function pinIdle(p, now) {
  return p.kind === 'pin' && now - (p.seen ?? p.iat) > PIN_IDLE;
}

/** The same PIN session seen now, when the last re-issue is a minute old; null when it is fresher. */
export function touchSession(secret, p, now) {
  if (p.kind !== 'pin' || now - (p.seen ?? p.iat) < PIN_TOUCH) return null;
  return signSession(secret, { ...p, seen: now });
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
