// @ts-check
// Small, dependency-free helpers shared by the whole server.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random base62 string of `n` characters (uniform: rejection sampling). */
export function rand62(n) {
  let out = '';
  while (out.length < n) {
    const buf = randomBytes(n * 2);
    for (let i = 0; i < buf.length && out.length < n; i++) {
      if (buf[i] < 248) out += B62[buf[i] % 62];
    }
  }
  return out;
}

/** Time-sortable id: prefix + base36 time + 8 random chars. */
export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + rand62(8);
}

/** 32 random bytes, base64url. Used for secrets handed to a browser (links, devices). */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** JSON with sorted keys, so the same object always hashes the same way. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Human code for an appointment: LA-XXXX, no ambiguous characters. */
export function humanCode(prefix = 'LA') {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(4);
  let s = '';
  for (let i = 0; i < 4; i++) s += A[buf[i] % A.length];
  return prefix + '-' + s;
}

/** Gift card code: 3 groups of 4, ~60 bits. */
export function giftCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) { s += A[buf[i] % A.length]; if (i === 3 || i === 7) s += '-'; }
  return s;
}

export function normGiftCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** French phone to E.164 (+33…). Returns '' when it is not a plausible number. */
export function normPhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+33')) d = '0' + d.slice(3);
  if (d.startsWith('+')) return /^\+\d{8,15}$/.test(d) ? d : '';
  if (/^0[1-9]\d{8}$/.test(d)) return '+33' + d.slice(1);
  return '';
}

/** A French landline or VoIP number (+33 1 to 5, or 9): no text can reach it. */
export function isLandline(e164) { return /^\+33[1-59]\d{8}$/.test(String(e164 || '')); }

// the old WordPress site's numbers: shared with the import wizard's preview
export { PHONE_PREFIXES, normPhoneImport } from '../../shared/phone.js';

/** "+33612345678" → "06 12 34 56 78" */
export function fmtPhone(e164) {
  if (!e164) return '';
  if (e164.startsWith('+33') && e164.length === 12) return ('0' + e164.slice(3)).replace(/(\d{2})(?=\d)/g, '$1 ');
  return e164;
}

/** "+33612345678" → "06 •• •• •• 78" */
export function maskPhone(e164) {
  const f = fmtPhone(e164);
  if (!f) return '';
  return f.slice(0, 2) + ' •• •• •• ' + f.slice(-2);
}

/** With domain, "karim.b@exemple.fr" → "k•••@e•••.fr": what a chained event may keep (a personal domain names someone too). */
export function maskEmail(e, { domain = false } = {}) {
  const m = String(e || '').match(/^(.)(.*)(@.*)$/);
  if (!m) return '';
  if (!domain) return m[1] + '•••' + m[3];
  const d = /^@(.)[^@]*?(\.[^.@]+)?$/.exec(m[3]);
  return m[1] + '•••@' + (d ? d[1] + '•••' + (d[2] || '') : '•••');
}

export { isEmail } from '../../shared/email.js';

export function capFirst(t) {
  t = String(t || '').trim().replace(/\s+/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** Seeded PRNG (Park–Miller), for the demo data only. */
export function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
