// @ts-check
// Passwords and PINs are stored as scrypt hashes: "scrypt$N$r$p$salt$hash".
import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 32768, R = 8, P = 1, LEN = 32;
const MAXMEM = 96 * 1024 * 1024;

/** @returns {Promise<string>} */
export function hashSecret(plain) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scrypt(String(plain).normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

/** Synchronous variant, only for seeding the demo. */
export function hashSecretSync(plain) {
  const salt = randomBytes(16);
  const key = scryptSync(String(plain).normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** @returns {Promise<boolean>} */
export function verifySecret(plain, stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(String(stored || ''));
  if (!m) return Promise.resolve(false);
  const n = +m[1], r = +m[2], p = +m[3];
  if (n > 1 << 17 || r > 16 || p > 4) return Promise.resolve(false);
  const salt = Buffer.from(m[4], 'base64'), want = Buffer.from(m[5], 'base64');
  return new Promise((resolve) => {
    scrypt(String(plain).normalize('NFKC'), salt, want.length, { N: n, r, p, maxmem: MAXMEM }, (err, key) => {
      resolve(!err && key.length === want.length && timingSafeEqual(key, want));
    });
  });
}

/** Burn the same time as a real check, so "unknown user" and "wrong password" look alike. */
let dummy = '';
export async function verifyDummy(plain) {
  if (!dummy) dummy = await hashSecret('not-a-real-password');
  await verifySecret(plain, dummy);
  return false;
}

/** Rules for an owner password: long enough, not trivially guessable. */
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 10) return 'Au moins 10 caractères.';
  if (s.length > 200) return '200 caractères maximum.';
  if (/^(.)\1+$/.test(s) || /^(0123456789|1234567890|azertyuiop|motdepasse|password)/i.test(s)) return 'Trop facile à deviner.';
  return null;
}
export function pinProblem(pin) {
  const s = String(pin || '');
  if (!/^\d{4,6}$/.test(s)) return 'Le code fait 4 à 6 chiffres.';
  if (/^(\d)\1+$/.test(s)) return 'Évite les codes comme 0000 ou 1111.';
  return null;
}
