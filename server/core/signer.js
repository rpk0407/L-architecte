// @ts-check
// The key that signs the closures (CPT-01a): Ed25519 from node:crypto, no dependency. The hash chain proves the journal
// was not edited by someone who could not recompute it; a signature with a key kept outside the database proves the
// closures were not rewritten by someone who could. So the key belongs in LX_SIGN_KEY (32 random bytes, base64), set in
// Vercel: without it a key is generated once and kept with the data (source 'store', a warning in Réglages › Données), which
// signs but proves less. The demo signs with a fixed, public key (source 'demo'), LX_SIGN_KEY or not: nothing in it is real.
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify } from 'node:crypto';

/** The DER header that wraps a raw 32-byte Ed25519 seed as a PKCS#8 private key. */
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

/** The demo's seed: fixed, so the seeded journal and every demo instance sign with the same key. */
const DEMO_SEED = createHash('sha256').update('Barber L’Architecte · démo · clé de signature').digest();

/**
 * @typedef {{ kid: string, publicKey: string, source: 'env'|'store'|'demo', sign: (buf: Buffer|string) => string }} Signer
 */

/** The 32-byte seed in a base64 (or base64url) string, or null when it is not exactly that. @param {string} text */
export function seedOf(text) {
  const t = String(text || '').trim();
  if (!/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(t)) return null;
  const buf = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf.length === 32 ? buf : null;
}

/** First 16 hex characters of the SHA-256 of the raw public key: names a key without showing it. @param {string} pem */
export function kidOf(pem) {
  const der = createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der.subarray(der.length - 32)).digest('hex').slice(0, 16);
}

/** @param {Buffer} seed @param {Signer['source']} source @returns {Signer} */
export function signerFrom(seed, source) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = /** @type {string} */ (createPublicKey(key).export({ type: 'spki', format: 'pem' }));
  return Object.freeze({
    kid: kidOf(publicKey), publicKey, source,
    sign: (buf) => edSign(null, Buffer.isBuffer(buf) ? buf : Buffer.from(buf), key).toString('base64url')
  });
}

/** Whether sig (base64url) is this public key's signature of buf. Never throws: a malformed key or signature is false. */
export function verifySig(pem, buf, sig) {
  try { return edVerify(null, Buffer.isBuffer(buf) ? buf : Buffer.from(buf), createPublicKey(pem), Buffer.from(String(sig), 'base64url')); }
  catch { return false; }
}

export const demoSigner = () => signerFrom(DEMO_SEED, 'demo');

/**
 * The runtime's signer: the demo's fixed key in the demo, whatever LX_SIGN_KEY says (its seeded journal is signed with
 * it, and a real key would make the demo look ready for production); otherwise LX_SIGN_KEY when it is a valid seed, or
 * one generated once and kept with the data. `warning` is what the owner's warnings say about it ('' when nothing).
 * @param {{ LX_SIGN_KEY?: string }} env @param {{ secret: (name: string, make: () => string) => Promise<string> }} store @param {string} mode 'demo' or 'production'
 * @returns {Promise<{ signer: Signer, warning: string }>}
 */
export async function makeSigner(env, store, mode) {
  if (mode === 'demo') return { signer: demoSigner(), warning: '' };
  const given = env.LX_SIGN_KEY ? seedOf(env.LX_SIGN_KEY) : null;
  if (given) return { signer: signerFrom(given, 'env'), warning: '' };
  const bad = env.LX_SIGN_KEY ? 'LX_SIGN_KEY n’est pas une clé de 32 octets en base64 : la clé gardée avec les données signe à sa place. ' : '';
  const stored = seedOf(await store.secret('sign', () => randomBytes(32).toString('base64')));
  if (!stored) throw new Error('stored signing key is not a 32-byte seed');
  return {
    signer: signerFrom(stored, 'store'),
    warning: bad || 'LX_SIGN_KEY n’est pas définie : la clé de signature est gardée avec les données. Ton prestataire la crée (32 octets en base64), puis redéploie.'
  };
}
