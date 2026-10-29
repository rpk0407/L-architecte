// @ts-check
// The journal: every change to the shop is an immutable event, chained to the previous one by a SHA-256 hash.
// Editing or deleting any past event breaks the chain from that point on, and `verifyChain` says where.
//
// Personal data sits in a separate `pii` field. The chain covers only a hash of it (`ph`), so a client's
// data can be erased (GDPR) without breaking the proof that the books were not tampered with.
// The hash is salted: seal() puts a random nonce (`_n`) inside every pii object before hashing, so the `ph` of an erased
// (or exported) event cannot be tried against guesses (a French mobile number has few possibilities). The nonce goes with
// the pii when it is erased; the reducers never see it (state.js).
import { randomBytes } from 'node:crypto';
import { canonical, sha256 } from '../lib/util.js';

export const GENESIS = '0'.repeat(64);

/**
 * @typedef {{ t: 'staff'|'client'|'system'|'provider', id: string, n?: string, dev?: string }} Actor
 * @typedef {{ v: number, id: string, at: number, type: string, actor: Actor, data: any, pii?: any, ph?: string|null, p: string, h: string }} JEvent
 * @typedef {{ id?: string, type: string, data: any, pii?: any }} Draft
 */

/** The key of the nonce inside a pii object. */
export const NONCE = '_n';

export function piiHash(pii) {
  return pii == null ? null : sha256(canonical(pii));
}

function bodyOf(e) {
  return canonical({ v: e.v, id: e.id, at: e.at, type: e.type, actor: e.actor, data: e.data, ph: e.ph ?? null });
}

/** The pii with its nonce inside (an event sealed before the nonce existed still verifies: verifyChain hashes whatever pii holds). */
function salted(pii, nonce) {
  if (typeof pii !== 'object' || Array.isArray(pii)) throw new Error('pii must be an object');
  return { ...pii, [NONCE]: nonce };
}

/**
 * Turn drafts into chained events that follow `head`.
 * @param {Draft[]} drafts
 * @param {{ version: number, hash: string }} head
 * @param {{ at: number, actor: Actor, id: (i: number) => string, nonce?: (i: number) => string }} meta nonce: 16 hex digits per
 *   event with personal data (random unless a test fixes it)
 * @returns {JEvent[]}
 */
export function seal(drafts, head, meta) {
  const out = [];
  let prev = head.hash, v = head.version;
  drafts.forEach((d, i) => {
    v += 1;
    /** @type {JEvent} */
    const e = { v, id: d.id || meta.id(i), at: meta.at, type: d.type, actor: meta.actor, data: d.data ?? {}, p: prev, h: '' };
    if (d.pii != null) { e.pii = salted(d.pii, meta.nonce ? meta.nonce(i) : randomBytes(8).toString('hex')); e.ph = piiHash(e.pii); } else e.ph = null;
    e.h = sha256(prev + '\n' + bodyOf(e));
    prev = e.h;
    out.push(e);
  });
  return out;
}

/**
 * Re-compute every hash. Events whose personal data was erased still verify: only the pii hash is chained.
 * @param {JEvent[]} events
 */
export function verifyChain(events) {
  let prev = GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.v !== i + 1) return { ok: false, count: events.length, brokenAt: i + 1, reason: 'Numérotation interrompue' };
    if (e.p !== prev) return { ok: false, count: events.length, brokenAt: e.v, reason: 'Lien rompu avec l’entrée précédente' };
    if (e.pii != null && piiHash(e.pii) !== e.ph) return { ok: false, count: events.length, brokenAt: e.v, reason: 'Données personnelles modifiées' };
    if (sha256(prev + '\n' + bodyOf(e)) !== e.h) return { ok: false, count: events.length, brokenAt: e.v, reason: 'Contenu modifié' };
    prev = e.h;
  }
  return { ok: true, count: events.length, head: prev };
}

/** The pii as the reducers read it: the nonce is not data. */
export function piiOf(pii) {
  if (!pii || !(NONCE in pii)) return pii || {};
  const { [NONCE]: _n, ...rest } = pii;
  return rest;
}

/** An event as it may leave the server in an export: no personal data, no secrets. */
export function publicEvent(e) {
  const { pii, ...rest } = e;
  return rest;
}
