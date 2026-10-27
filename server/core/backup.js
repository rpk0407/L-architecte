// @ts-check
// The salon's real backup: the whole journal with its personal data and credentials, enough to rebuild the
// salon on a new installation (the fiscal archive, publicEvent, has neither). So it is always encrypted:
// gzip, then AES-256-GCM with BACKUP_KEY (32 bytes, base64), a key that never lives next to the data.
// File: JSON { v: 1, at, count, head, salon, iv, tag, data }; the clear fields are authenticated with the data
// (AAD), so a listing can show them without the key and nobody can change them unnoticed. `salon` is the hash of
// the journal's first event: it tells this salon's files from those of another deployment sharing the Blob store.
// Only a production salon writes backups: a demo or a preview never overwrites the real ones.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { GENESIS, verifyChain } from './journal.js';
import { fail, erasedMatch } from './engine.js';
import { canonical } from '../lib/util.js';
import { localParts } from '../../shared/dates.js';
import { blobBackups } from '../store/blob.js';

/** @typedef {import('./journal.js').JEvent} JEvent */
/** @typedef {{ name: string, day: string, at: number, count: number|null, head: string|null, salon: string|null, size: number|null }} BackupItem */

export const KEEP_DAILY = 30;
export const KEEP_MONTHLY = 12;
/** a backup older than this is shown in red: the nightly one did not happen */
export const STALE_MS = 36 * 3600000;
/** nightly: after 03:00 Paris, when the last one is more than 20 h old */
export const DUE_FROM_MIN = 180;
export const EVERY_MS = 20 * 3600000;
/** after a failure (Blob down), try again at most every 15 minutes */
const RETRY_MS = 15 * 60000;

export const backupName = (/** @type {string} */ day) => day + '.json.gz.enc';

/** The 32-byte key from BACKUP_KEY (base64 or base64url), or an explicit error. */
export function backupKey(b64) {
  if (!b64) fail(503, 'backup_key', 'BACKUP_KEY n’est pas définie : sans cette clé, aucune sauvegarde ne peut être chiffrée ni ouverte. Ton prestataire la crée dans Vercel (exactement 43 lettres et chiffres), puis redéploie.');
  const k = Buffer.from(String(b64).trim(), 'base64');
  if (k.length !== 32) fail(503, 'backup_key', 'BACKUP_KEY n’a pas le bon format (32 octets en base64, soit 43 lettres et chiffres) : ton prestataire la recrée dans Vercel, puis redéploie.');
  return k;
}
/** @returns {string} what is wrong with the key, or '' */
export function keyProblem(b64) {
  try { backupKey(b64); return ''; } catch (e) { return String(e && e.message); }
}

const aad = (h) => Buffer.from(canonical({ v: 1, at: h.at, count: h.count, head: h.head, salon: h.salon || '' }));

/** Which salon a journal is: the hash of its first event (shop.initialized), the same before and after a restore. */
export const salonOf = (/** @type {JEvent[]} */ events) => (events[0] && events[0].h) || '';

/**
 * Personal data of erased clients never travels, even when the events come from a memory that missed the
 * erasure: the same match as the engine's. The chain still verifies, since only the pii hash is chained.
 * @param {JEvent[]} events @returns {JEvent[]}
 */
export function scrubErased(events) {
  const matches = events.filter((e) => e.type === 'client.erased').map(erasedMatch);
  if (!matches.length) return events;
  return events.map((e) => {
    if (e.pii == null || !matches.some((m) => m(e))) return e;
    const { pii, ...rest } = e;
    return rest;
  });
}

/**
 * @param {JEvent[]} events the full journal, pii included
 * @param {Buffer} key
 * @param {{ at: number, shop?: string }} o
 */
export function sealBackup(events, key, o) {
  events = scrubErased(events);
  const h = { v: 1, at: o.at, count: events.length, head: events.length ? events[events.length - 1].h : GENESIS, salon: salonOf(events) };
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(h));
  const data = Buffer.concat([c.update(gzipSync(JSON.stringify({ shop: o.shop || '', at: o.at, events }))), c.final()]);
  return JSON.stringify({ ...h, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

/**
 * Decrypt a backup file. A wrong key and a damaged file fail the same way: GCM cannot tell them apart.
 * @param {string} text @param {Buffer} key
 * @returns {{ at: number, count: number, head: string, salon: string, shop: string, events: JEvent[] }}
 */
export function openBackup(text, key) {
  let f = null;
  try { f = JSON.parse(text); } catch { /* not JSON */ }
  if (!f || f.v !== 1 || typeof f.iv !== 'string' || typeof f.tag !== 'string' || typeof f.data !== 'string' || !Number.isInteger(f.count)) {
    fail(422, 'backup_file', 'Ce fichier n’est pas une sauvegarde du Comptoir (fichier .json.gz.enc attendu).');
  }
  /** @type {Buffer} */
  let plain = Buffer.alloc(0);
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'), { authTagLength: 16 });
    d.setAAD(aad(f));
    d.setAuthTag(Buffer.from(f.tag, 'base64'));
    plain = gunzipSync(Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]));
  } catch {
    fail(422, 'backup_key', 'Impossible d’ouvrir la sauvegarde : la clé BACKUP_KEY n’est pas celle qui l’a chiffrée, ou le fichier est abîmé.');
  }
  const p = JSON.parse(plain.toString('utf8'));
  const events = Array.isArray(p.events) ? p.events : [];
  if (events.length !== f.count || (events.length ? events[events.length - 1].h : GENESIS) !== f.head) fail(422, 'backup_file', 'Sauvegarde incomplète.');
  return { at: f.at, count: f.count, head: f.head, salon: f.salon || '', shop: p.shop || '', events };
}

/**
 * Install a salon from a backup: decrypt, verify the whole chain, then adopt it into the empty store.
 * With `from`, one shop.restored event follows, so the journal itself says when and from what it was rebuilt.
 * @param {import('./engine.js').Engine} engine @param {string} text @param {Buffer} key
 * @param {{ mode?: string, from?: string }} [o]
 */
export async function restoreBackup(engine, text, key, o = {}) {
  const b = openBackup(text, key);
  b.events = scrubErased(b.events);
  const chk = verifyChain(b.events);
  if (!chk.ok) fail(422, 'backup_broken', 'Sauvegarde refusée : ' + String(chk.reason).toLowerCase() + ' à l’opération n° ' + chk.brokenAt + '.');
  const first = b.events[0];
  if (!first || first.type !== 'shop.initialized') fail(422, 'backup_file', 'Cette sauvegarde ne contient pas de salon.');
  if (o.mode === 'production' && first.data.mode !== 'production') fail(422, 'backup_demo', 'Cette sauvegarde vient de la démo : elle ne peut pas installer le salon.');
  if (!(await engine.adopt(b.events))) fail(409, 'initialized', 'Le salon est déjà configuré.');
  const head = engine.state.head;
  if (o.from) {
    const trace = { from: o.from, at: b.at, count: b.count, head: b.head };
    await engine.run({ run: (_s, _i, ctx) => ctx.emit('shop.restored', trace) }, {}, { actor: { t: 'system', id: 'restore', n: 'Restauration' }, caps: new Set() });
  }
  return { ok: true, version: engine.state.version, head, at: b.at };
}

/**
 * Which backups to keep: the 30 most recent days, and the first backup of each of the 12 most recent months.
 * @param {string[]} days YYYY-MM-DD
 */
export function retention(days) {
  const sorted = [...new Set(days)].sort().reverse();
  const keep = new Set(sorted.slice(0, KEEP_DAILY));
  /** month → its earliest backup; months in newest-first order */
  const firsts = new Map();
  for (const d of sorted) firsts.set(d.slice(0, 7), d);
  for (const d of [...firsts.values()].slice(0, KEEP_MONTHLY)) keep.add(d);
  return { keep: sorted.filter((d) => keep.has(d)), drop: sorted.filter((d) => !keep.has(d)) };
}

/* ---------------- on a runtime ---------------- */

/** The Blob helpers for backups, or null without BLOB_READ_WRITE_TOKEN. Tests set rt.backups themselves. */
export function backupsOf(rt) {
  if (rt.backups === undefined) rt.backups = rt.cfg.blob ? blobBackups() : null;
  return /** @type {import('../store/blob.js').BlobBackups|null} */ (rt.backups);
}
/** What this instance knows of the last backup, so the scheduler does not list Blob every minute. */
export function backupState(rt) {
  if (!rt.backupState) rt.backupState = { last: /** @type {BackupItem|null} */ (null), tried: 0, error: '', failedAt: 0 };
  return rt.backupState;
}
/** Why this deployment writes no backup ('' when it does): a demo, or a Vercel preview, never touches the real ones. */
export function backupOff(rt) {
  if (rt.cfg.mode !== 'production' || rt.engine.state.mode !== 'production') return 'En démo, rien n’est sauvegardé.';
  if (rt.cfg.vercelEnv && rt.cfg.vercelEnv !== 'production') return 'Déploiement de prévisualisation : il n’écrit aucune sauvegarde, pour ne jamais remplacer celles du salon.';
  return '';
}
/** This salon's backups, newest first; a file the index lost (no salon known) counts as ours. */
export const ownBackups = (/** @type {BackupItem[]} */ items, salon) => items.filter((x) => !x.salon || x.salon === salon);
const failed = (st, err, now) => { st.error = String(err && err.message || err); st.failedAt = now; };
/** A Blob failure as a clear error for the Comptoir (one already explicit, like a missing key, goes as is). */
const blobFail = (err) => {
  if (err && err.status) throw err;
  const m = String(err && err.message || err);
  fail(503, 'backup_blob', 'Stockage Blob indisponible : ' + m + (/access|public|private/i.test(m) ? '. Le stockage Blob doit être créé en accès privé (Private).' : '. Réessaie dans quelques minutes.'));
};

/** The whole journal, sealed now: for a download when nothing is stored yet. */
export async function freshBackup(rt) {
  const key = backupKey(rt.cfg.backupKey);
  const e = rt.engine;
  await e.sync(true);
  // no await from here on: count and head are those of the journal being sealed
  const at = e.clock();
  return { day: localParts(at).day, at, count: e.journal.length, head: e.state.head, salon: salonOf(e.journal), body: sealBackup(e.journal, key, { at, shop: e.state.settings.shop.name }) };
}

/** Write today's backup to Blob (replacing an earlier one of the same day), then prune this salon's old ones. */
export async function makeBackup(rt) {
  const off = backupOff(rt);
  if (off) fail(409, 'backup_off', off);
  const blob = backupsOf(rt);
  if (!blob) fail(409, 'backup_blob', 'Pas de stockage pour les sauvegardes : ajoute un Blob Vercel au projet (BLOB_READ_WRITE_TOKEN). En attendant, télécharge la sauvegarde chiffrée et garde-la en lieu sûr.');
  const st = backupState(rt);
  try {
    const f = await freshBackup(rt);
    const meta = { at: f.at, count: f.count, head: f.head, salon: f.salon };
    try {
      await blob.putBackup(backupName(f.day), f.body, meta);
      const { drop } = retention(ownBackups(await blob.listBackups(), f.salon).map((x) => x.day));
      if (drop.length) await blob.deleteBackups(drop.map(backupName));
    } catch (err) { blobFail(err); }
    st.last = { name: backupName(f.day), day: f.day, ...meta, size: f.body.length };
    st.error = '';
    return st.last;
  } catch (err) {
    failed(st, err, rt.engine.clock());
    throw err;
  }
}

/** For Réglages › Données: this salon's stored backups, and whatever stands in the way of the nightly one. */
export async function backupStatus(rt) {
  const off = backupOff(rt);
  // a demo never reads the Blob store: it may be the real salon's
  const blob = off ? null : backupsOf(rt);
  const st = backupState(rt);
  const salon = salonOf(rt.engine.journal);
  /** @type {BackupItem[]} */
  let items = [];
  let error = st.error;
  let unreadable = false;
  if (blob) {
    try { items = ownBackups(await blob.listBackups(), salon); if (items[0]) st.last = items[0]; }
    catch (err) { unreadable = true; error = 'Lecture des sauvegardes impossible : ' + String(err && err.message || err); }
  }
  // another instance succeeded since this one failed: its old error no longer stands
  if (!unreadable && items[0] && st.failedAt && items[0].at > st.failedAt) error = st.error = '';
  return {
    blob: !!blob, key: !keyProblem(rt.cfg.backupKey), keyProblem: keyProblem(rt.cfg.backupKey), off,
    items, last: items[0] || (unreadable ? st.last : null), unreadable, error, staleAfterMs: STALE_MS, keep: { daily: KEEP_DAILY, monthly: KEEP_MONTHLY }
  };
}

/**
 * The nightly backup, from the scheduler: once a day after 03:00 Paris, when the last one is more than 20 h old.
 * Never throws: a failure is kept for the Comptoir and retried 15 minutes later.
 */
export async function nightlyBackup(rt) {
  const blob = backupsOf(rt);
  if (!blob || keyProblem(rt.cfg.backupKey) || backupOff(rt)) return null;
  const st = backupState(rt);
  const now = rt.engine.clock();
  if (localParts(now).min < DUE_FROM_MIN) return null;
  if (st.last && now - st.last.at < EVERY_MS) return null;
  if (st.tried && now - st.tried < RETRY_MS) return null;
  st.tried = now;
  try {
    // another instance may have made it already
    st.last = ownBackups(await blob.listBackups(), salonOf(rt.engine.journal))[0] || null;
    if (st.last && st.failedAt && st.last.at > st.failedAt) st.error = '';
    if (st.last && now - st.last.at < EVERY_MS) return null;
    return await makeBackup(rt);
  } catch (err) {
    failed(st, err, now);
    console.error('[lx] backup', err && err.stack ? err.stack : err);
    return null;
  }
}
