// @ts-check
// Client files. Identity is the phone number: a client booking online with a known number lands on their file.
// Also what the law asks of them: erasure that closes what is still open, duplicates merged, the retention period.
import { fail } from '../core/engine.js';
import { str, bool, int, opt, obj, arr, id, parse } from '../lib/validate.js';
import { createHmac } from 'node:crypto';
import { normPhone, isEmail, capFirst } from '../lib/util.js';
import { localParts } from '../../shared/dates.js';
import { RETENTION_YEARS, retentionCutoff } from '../../shared/retention.js';
import { queueMessage, apptVars } from '../domain/messages.js';
import { mailCancellation } from '../domain/mails.js';
import { TRUSTED } from '../domain/policy.js';
import { getClient } from './common.js';
import { isLive, graceOf, statusOf, periodAt } from '../domain/membership.js';
import { referralEventIds } from '../domain/loyalty.js';
import { loyaltyAfterMerge } from './loyalty.js';

const fields = {
  first: opt(str({ min: 1, max: 40 })), last: opt(str({ max: 40 })), phone: opt(str({ max: 24 })), email: opt(str({ max: 120, lower: true })),
  notes: opt(str({ max: 1000 })), tech: opt(str({ max: 500 })), birthday: opt(str({ max: 5, pattern: /^(\d{2}-\d{2})?$/ })),
  tags: opt(arr(str({ min: 1, max: 24 }), { max: 8 })), sms: opt(bool()), marketing: opt(bool())
};
const addSchema = obj(fields);
const patchSchema = obj(fields);

/** Validate and normalise identity fields; returns the pii part and the plain part. */
export function clientParts(x) {
  const pii = {};
  if (x.first !== undefined) pii.first = capFirst(x.first);
  if (x.last !== undefined) pii.last = capFirst(x.last);
  if (x.phone !== undefined) {
    const p = x.phone ? normPhone(x.phone) : '';
    if (x.phone && !p) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    pii.phone = p;
  }
  if (x.email !== undefined) {
    if (x.email && !isEmail(x.email)) fail(400, 'invalid', 'E-mail invalide.');
    pii.email = x.email;
  }
  for (const k of ['notes', 'tech', 'birthday']) if (x[k] !== undefined) pii[k] = x[k];
  const plain = {};
  for (const k of ['tags', 'sms', 'marketing']) if (x[k] !== undefined) plain[k] = x[k];
  return { pii, plain };
}

/** Emit a new client, or return the existing one with that phone. Used by bookings too. */
export function upsertClient(s, ctx, x, source) {
  const { pii, plain } = clientParts(x);
  if (pii.phone) {
    const existing = s.clientByPhone.get(pii.phone);
    if (existing) return { id: getClient(s, existing).id, created: false };
  }
  if (!pii.first) fail(400, 'invalid', 'Le prénom est obligatoire.');
  const cid = ctx.id('cl');
  ctx.emit('client.added', { id: cid, cid, source, sms: plain.sms !== false, marketing: !!plain.marketing, tags: plain.tags || [] }, pii);
  return { id: cid, created: true };
}

export const addClient = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const x = parse(addSchema, input);
    // a new file born trusted would skip the deposit as surely as one marked later (updateClient)
    if ((x.tags || []).includes(TRUSTED)) ctx.need('agenda.edit');
    const { pii } = clientParts(x);
    if (pii.phone && s.clientByPhone.has(pii.phone)) fail(409, 'exists', 'Un client a déjà ce numéro.', { id: s.clientByPhone.get(pii.phone) });
    return upsertClient(s, ctx, x, 'salon');
  }
};

export const updateClient = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    const c = getClient(s, input.id);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    const x = parse(patchSchema, input.patch || {});
    const { pii, plain } = clientParts(x);
    // sparing a client the deposit asked of those who missed is a money decision: who edits every booking takes it
    if (plain.tags && plain.tags.includes(TRUSTED) !== (c.tags || []).includes(TRUSTED)) ctx.need('agenda.edit');
    if (pii.phone && pii.phone !== c.phone && s.clientByPhone.has(pii.phone)) fail(409, 'exists', 'Un autre client a déjà ce numéro.', { id: s.clientByPhone.get(pii.phone) });
    if (!Object.keys(pii).length && !Object.keys(plain).length) return { ok: true };
    // consent given or withdrawn at the counter: the file says so, and since when ("oui (salon, 12/10/2026)")
    if (plain.marketing !== undefined && plain.marketing !== !!c.marketing) Object.assign(plain, { marketingSrc: 'salon', marketingAt: ctx.now });
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: plain, fields: Object.keys(pii) }, Object.keys(pii).length ? pii : undefined);
    return { ok: true };
  }
};

export const mergeClients = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    if (!ctx.can('agenda.edit')) fail(403, 'forbidden', 'La fusion de fiches est réservée à l’accueil et au gérant.');
    const from = getClient(s, input.from), into = getClient(s, input.into);
    if (from.id === into.id) fail(400, 'invalid', 'Ce sont déjà les mêmes fiches.');
    if (from.erased || into.erased) fail(409, 'erased', 'Une fiche effacée ne se fusionne pas.');
    // what the kept file holds is the owner's choice from now on: an import no longer follows the old site over it (judge), it only lists
    const fill = { ...mergedFill(from, into) };
    const forget = { ...(into.wpPhone ? { wpPhone: '' } : {}), ...(into.wpEmail ? { wpEmail: '' } : {}) };
    // FID-02: the cards both files' stamps complete become rewards now; a file that opted out keeps the person out
    loyaltyAfterMerge(s, ctx, from, into);
    const off = from.loyaltyOff && !into.loyaltyOff ? { loyaltyOff: true } : {};
    ctx.emit('client.merged', { from: from.id, into: into.id });
    if (Object.keys(fill).length || Object.keys(forget).length || off.loyaltyOff) ctx.emit('client.updated', { id: into.id, cid: into.id, patch: off, fields: Object.keys(fill) }, Object.keys(fill).length || Object.keys(forget).length ? { ...fill, ...forget } : undefined);
    return { id: into.id };
  }
};
/** What the kept file takes from the other one: only what it lacks; the notes of both. The Comptoir's preview shows the same. */
export function mergedFill(from, into) {
  const fill = {};
  for (const k of ['last', 'phone', 'email', 'tech', 'birthday']) if (!into[k] && from[k]) fill[k] = from[k];
  if (from.notes) fill.notes = [into.notes, from.notes].filter(Boolean).join('\n');
  return fill;
}

const distinctSchema = obj({ a: id(), b: id() });
/** Two files the duplicate finder pairs, that are in fact two people (two Yanis Benali): never suggested again. */
export const markDistinct = {
  run(s, input, ctx) {
    ctx.need('client.edit');
    // the other side of a merge decision: the same people as merging (and as the 'Doublons probables' segment)
    if (!ctx.can('agenda.edit')) fail(403, 'forbidden', 'Les doublons sont réservés à l’accueil et au gérant.');
    const x = parse(distinctSchema, input);
    const a = getClient(s, x.a), b = getClient(s, x.b);
    if (a.id === b.id) fail(400, 'invalid', 'Ce sont déjà les mêmes fiches.');
    for (const [x, y] of [[a, b], [b, a]]) {
      const list = x.distinct || [];
      if (!list.includes(y.id)) ctx.emit('client.updated', { id: x.id, cid: x.id, patch: { distinct: [...list, y.id].slice(-50) }, fields: [] });
    }
    return { ok: true };
  }
};

/* ---------------- duplicates ---------------- */

const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const live = (s) => [...s.clients.values()].filter((c) => !c.mergedInto && !c.erased);
// the read models here are recomputed only when the journal moved (the list asks for them on every search)
const cache = new WeakMap();
function memo(s, key, fn) {
  let c = cache.get(s);
  if (!c || c.v !== s.version) { c = { v: s.version, m: new Map() }; cache.set(s, c); }
  if (!c.m.has(key)) c.m.set(key, fn());
  return c.m.get(key);
}
/** @returns {Map<string, string[]>} file id → the files merged straight into it */
const mergedKids = (s) => memo(s, 'kids', () => {
  const m = new Map();
  for (const x of s.clients.values()) if (x.mergedInto) { const l = m.get(x.mergedInto); if (l) l.push(x.id); else m.set(x.mergedInto, [x.id]); }
  return m;
});

/**
 * Files that are probably the same person: same first and last name, same e-mail, or the same last 8 digits
 * (06 12 34 56 78 typed once as +33, once as 0033 or with a foreign prefix). Pairs the owner marked distinct are left out.
 * @returns {{ a: string, b: string, why: ('name'|'email'|'phone')[] }[]} strongest first (phone, e-mail, then name)
 */
export function findDuplicates(s) { return memo(s, 'dups', () => duplicates(s)); }
function duplicates(s) {
  /** @type {Map<string, string[]>} */
  const keys = new Map();
  const add = (k, cid) => { const l = keys.get(k); if (l) l.push(cid); else keys.set(k, [cid]); };
  for (const c of live(s)) {
    if (c.last && fold(c.first)) add('name|' + fold(c.first) + '|' + fold(c.last), c.id);
    if (c.email) add('email|' + c.email.toLowerCase(), c.id);
    const d = String(c.phone || '').replace(/\D/g, '');
    if (d.length >= 8) add('phone|' + d.slice(-8), c.id);
  }
  /** @type {Map<string, { a: string, b: string, why: Set<string> }>} */
  const pairs = new Map();
  for (const [k, list] of keys) {
    // a key shared by a crowd (one e-mail for a whole family) says nothing about any two of them
    if (list.length < 2 || list.length > 6) continue;
    const why = k.slice(0, k.indexOf('|'));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]].sort();
      if ((s.clients.get(a).distinct || []).includes(b)) continue;
      const p = pairs.get(a + '|' + b) || { a, b, why: new Set() };
      p.why.add(why);
      pairs.set(a + '|' + b, p);
    }
  }
  const rank = (p) => (p.why.has('phone') ? 4 : 0) + (p.why.has('email') ? 2 : 0) + (p.why.has('name') ? 1 : 0);
  return [...pairs.values()].sort((x, y) => rank(y) - rank(x)).map((p) => ({ a: p.a, b: p.b, why: /** @type {any} */ (['phone', 'email', 'name'].filter((w) => p.why.has(w))) }));
}

/* ---------------- erasure ---------------- */

// A trace of an erased file that names nobody, so an import of the old site never brings the person back: an HMAC of
// its number and e-mail under the salon's own key. A plain hash would not do: the chain keeps it for good, and every
// French mobile can be hashed in minutes. The key is derived from the session secret (SESSION_SECRET in production,
// which a restore reuses; the store's generated one otherwise), handed in by the routes as ctx.meta.tombKey.
// Without a key (a command run outside a route) no tombstone is written and none is matched.
/** @param {string} secret @returns {string} */
export const tombKeyOf = (secret) => createHmac('sha256', String(secret)).update('lx-erased-tombs-v1').digest('base64url');
/** @param {string} key @param {string} v */
export const tombOf = (key, v) => createHmac('sha256', key).update(String(v).trim().toLowerCase()).digest('hex').slice(0, 32);
/**
 * The tombstone a phone (normalised) or an e-mail matches, or null.
 * @returns {{ why: 'request'|'retention', at: number } | null} why: erased at their request, or after 3 years; at: when
 */
export function erasedTomb(s, key, phone, email) {
  const t = s.erasedTombs;
  if (!key || !t || !t.size) return null;
  return (phone && t.get(tombOf(key, phone))) || (email && t.get(tombOf(key, email))) || null;
}

/** The file and every file merged into it, at any depth. @returns {string[]} */
export function fileIds(s, c) {
  const kids = mergedKids(s);
  const ids = [c.id];
  for (let i = 0; i < ids.length; i++) for (const k of kids.get(ids[i]) || []) if (!ids.includes(k)) ids.push(k);
  return ids;
}
const tombsOfFiles = (s, ids, key) => (key ? [...new Set(ids.flatMap((cid) => { const x = s.clients.get(cid); return x ? [x.phone, x.email].filter(Boolean).map((v) => tombOf(key, v)) : []; }))] : []);

const OPEN = new Set(['pending', 'booked', 'arrived', 'in_chair']);
/**
 * What is still running on a file: bookings to come, a monthly membership (PAY-02), carnet cuts left, gift card balance. Erasure lists them
 * first, so no "Client effacé" stays booked in the agenda without anyone being told. A booking of earlier today that
 * nobody closed counts too (it would stay "à encaisser" under no name); passed: its slot is over, no text for it.
 */
export function openItems(s, c, local) {
  const ids = new Set(fileIds(s, c));
  const appts = [...s.appts.values()].filter((a) => ids.has(a.clientId) && OPEN.has(a.status) && a.day >= local.day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start)
    .map((a) => ({ id: a.id, day: a.day, start: a.start, staffId: a.staffId, services: a.services.map((x) => x.name), deposit: a.deposit && a.deposit.paid ? a.deposit.paid : 0, passed: a.day === local.day && a.start + a.dur <= local.min }));
  const packs = [...s.packs.values()].filter((k) => ids.has(k.clientId) && k.used < k.total && k.expires >= local.day).map((k) => ({ id: k.id, name: k.name, left: k.total - k.used, expires: k.expires }));
  // a contract still running: the owner cancels it first (« Résilier tout de suite »), erasure never ends it on its own
  const grace = graceOf(s);
  const memberships = s.members ? [...s.members.values()].filter((m) => ids.has(m.cid) && isLive(m, local.day, grace)).map((m) => {
    const p = periodAt(m, local.day, grace);
    return { id: m.id, plan: m.name, status: statusOf(m, local.day, grace), until: p ? p.end : null };
  }) : [];
  const giftcards = [...s.giftcards.values()].filter((g) => ids.has(g.cid) && g.status === 'active' && g.balance > 0 && g.expires >= local.day).map((g) => ({ id: g.id, last4: g.last4, balance: g.balance, expires: g.expires }));
  // email: the cancellation mail (METHOD:CANCEL) leaves too, so the Comptoir names both channels before erasing
  return { appts, memberships, packs, giftcards, sms: !!(c.phone && c.sms), email: !!(c.email && isEmail(c.email) && s.settings.messages.email) };
}

const eraseSchema = obj({ id: id(), cancelUpcoming: opt(bool()) });
/**
 * Erase a file (GDPR). Anything still open is refused (409, the list in extra.open) unless cancelUpcoming: the owner
 * saw the list and closes it all, the bookings cancelled with a text, the cuts and balance given up.
 * When a cancellation is texted or mailed, this write cancels and queues the messages (their ids in texts) and returns
 * erased: false: the erasure is the next run, once they have left (queued in the same write, a text would lose its
 * number with the file, a mail its address).
 */
export const eraseClient = {
  run(s, input, ctx) {
    ctx.need('client.erase');
    const x = parse(eraseSchema, input);
    const c = getClient(s, x.id);
    if (c.erased) return { ok: true, erased: true };
    const open = openItems(s, c, ctx.local);
    if (open.memberships.length) fail(409, 'member', 'Cette fiche a un abonnement en cours : résilie-le d’abord.', { open });
    if ((open.appts.length || open.packs.length || open.giftcards.length) && !x.cancelUpcoming) fail(409, 'open', 'Cette fiche a encore ' + openWords(open) + '.', { open });
    const ids = fileIds(s, c);
    const texts = [];
    for (const o of open.appts) {
      const a = s.appts.get(o.id);
      const unpaid = a.status === 'pending';
      ctx.emit('appt.cancelled', { id: a.id, by: 'salon', reason: 'Fiche effacée à la demande du client', cid: a.clientId || undefined });
      const m = open.sms && !o.passed ? queueMessage(s, ctx, { key: 'cx_' + a.id, template: 'cancelled', to: c.phone, cid: c.id, apptId: a.id, vars: { ...apptVars(s, a), lien: ctx.meta.siteUrl || '' } }) : null;
      if (m) texts.push(m);
      // the calendar file (METHOD:CANCEL) takes it out of the client's agenda, and must leave while the address exists;
      // a booking still waiting for its deposit was never sent one
      const mail = !o.passed && !unpaid && c.email ? mailCancellation(s, ctx, a, { to: c.email, first: c.first, by: 'salon' }) : null;
      if (mail) texts.push(mail);
    }
    const done = { ok: true, cancelled: open.appts.map((a) => a.id), deposits: open.appts.filter((a) => a.deposit).map((a) => s.appts.get(a.id).deposit.paymentId).filter(Boolean) };
    if (texts.length) return { ...done, erased: false, texts };
    // nobody to offer a freed slot to any more
    const idSet = new Set(ids);
    for (const w of s.waitlist.values()) if (idSet.has(w.clientId) && (w.status === 'waiting' || w.status === 'offered')) {
      ctx.emit('waitlist.updated', { id: w.id, patch: { status: 'removed' } });
      if (w.offer && w.offer.holdId && s.holds.has(w.offer.holdId)) ctx.emit('hold.released', { id: w.offer.holdId });
    }
    // a referral names the other person too (FID-02): its events are dropped by id, whichever side is erased
    const linked = referralEventIds(s, ids);
    ctx.emit('client.erased', { id: c.id, cid: c.id, ids, tombs: tombsOfFiles(s, ids, ctx.meta.tombKey), ...(linked.length ? { drop: linked } : {}) });
    return { ...done, erased: true, texts };
  }
};
function openWords(open) {
  const w = [];
  if (open.appts.length) w.push(open.appts.length + ' rendez-vous à venir');
  if (open.memberships && open.memberships.length) w.push('un abonnement en cours');
  if (open.packs.length) w.push(open.packs.length > 1 ? open.packs.length + ' carnets en cours' : 'un carnet en cours');
  if (open.giftcards.length) w.push(open.giftcards.length > 1 ? open.giftcards.length + ' cartes cadeaux avec du solde' : 'une carte cadeau avec du solde');
  return w.join(', ');
}

/* ---------------- retention: 3 years after the last visit, as /confidentialite promises ---------------- */

// the rule itself is shared with the WordPress import's preview (shared/retention.js)
export { RETENTION_YEARS, retentionCutoff };
const dayOf = (ms) => localParts(ms).day;

/**
 * Files with nothing since the cutoff: no visit, booking, ticket or waiting list, no membership, carnet or card still
 * running, and created before it.
 */
export function inactiveClients(s, today) { return memo(s, 'inactive|' + today, () => inactive(s, today)); }
function inactive(s, today) {
  const cut = retentionCutoff(today);
  /** @type {Map<string, string>} */
  const last = new Map();
  const bump = (cid, day) => { if (cid && day && !((last.get(cid) || '') >= day)) last.set(cid, day); };
  for (const a of s.appts.values()) bump(a.clientId, a.day);
  for (const x of s.sales.values()) bump(x.clientId, x.day);
  for (const w of s.waitlist.values()) bump(w.clientId, w.day);
  for (const k of s.packs.values()) if (k.used < k.total) bump(k.clientId, k.expires);
  // a membership that runs is a contract in force, whatever the visits
  if (s.members) for (const m of s.members.values()) if (isLive(m, today, graceOf(s))) bump(m.cid, today);
  for (const g of s.giftcards.values()) if (g.status === 'active' && g.balance > 0) bump(g.cid, g.expires);
  return live(s).filter((c) => fileIds(s, c).every((cid) => (last.get(cid) || '') < cut) && dayOf(c.createdAt) < cut);
}

/**
 * Personal data older than the cutoff outside the files being anonymised: a typed discount reason on any old ticket
 * (a regular's too: the reason is about that day, not the file), and, without a file, a name on a booking or a
 * walk-in, a waiting-list entry, a gift card's names, a text. By the ids their events carry (erasedMatch's drop).
 */
export function staleAnonymous(s, today) { return memo(s, 'stale|' + today, () => stale(s, today)); }
function stale(s, today) {
  const cut = retentionCutoff(today);
  const out = [];
  for (const x of s.sales.values()) if (x.day < cut && x.discountNote) out.push(x.id);
  for (const a of s.appts.values()) if (!a.clientId && a.day < cut && (a.name || a.note || (a.cancel && a.cancel.by === 'client' && a.cancel.reason))) out.push(a.id);
  for (const q of s.queue.values()) if (!q.clientId && dayOf(q.at) < cut && (q.phone || q.name !== 'Passage')) out.push(q.id);
  for (const w of s.waitlist.values()) if (!w.clientId && w.day < cut && (w.first || w.phone)) out.push(w.id);
  for (const g of s.giftcards.values()) if (!g.cid && g.expires < cut && (g.buyer || g.recipient)) out.push(g.id);
  for (const m of s.messages.values()) if (!m.cid && dayOf(m.at) < cut && (m.to || m.body)) out.push(m.id);
  return out;
}

// one write stays small (a few dozen KB): a larger backlog takes a few runs, the route loops
const PURGE_FILES = 300, PURGE_OTHER = 1000;
const purgeSchema = obj({ expect: int({ min: 0, max: 1000000 }) });
/**
 * Anonymise the files past the retention period, and the personal data of old tickets and bookings without one.
 * expect: the count the owner confirmed ("Anonymiser ces 14 fiches"); if someone came back since, nothing happens.
 */
export const purgeRetention = {
  run(s, input, ctx) {
    ctx.need('client.erase');
    const x = parse(purgeSchema, input);
    const files = inactiveClients(s, ctx.local.day);
    if (files.length !== x.expect) fail(409, 'changed', 'La liste a changé entre-temps (' + files.length + ' fiche' + (files.length > 1 ? 's' : '') + '). Vérifie-la avant d’anonymiser.', { count: files.length });
    const batch = files.slice(0, PURGE_FILES);
    const ids = batch.flatMap((c) => fileIds(s, c));
    const others = staleAnonymous(s, ctx.local.day);
    const drop = others.slice(0, PURGE_OTHER);
    if (!ids.length && !drop.length) return { erased: 0, other: 0, left: 0, more: false };
    // files: how many were anonymised, for the activity log and a retried request (ids also holds the merged-away ones)
    ctx.emit('client.erased', { ids, tombs: tombsOfFiles(s, ids, ctx.meta.tombKey), drop: [...drop, ...referralEventIds(s, ids)], retention: true, files: batch.length, before: retentionCutoff(ctx.local.day) });
    const left = files.length - batch.length;
    return { erased: batch.length, other: drop.length, left, more: left > 0 || others.length > drop.length };
  }
};
