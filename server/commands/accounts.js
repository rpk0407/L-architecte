// @ts-check
// Espace client (AC-01): the client file IS the client; an account is a verified sign-in attached to it, opened by
// proving the phone with a 6-digit code by SMS. No password, no sign-up form: a file is born from a first booking (or at
// the salon), so a sign-in never texts a number the salon does not already know (no SMS pumping, nothing to enumerate).
// The actor is chained and can never be erased: { t: 'client', id: 'moi', n: '' }, never a name or a number. A client's
// command takes its file from ctx.meta.me (the session, http/me-kit.js runAs), never from the body.
import { fail } from '../core/engine.js';
import { timingSafeEqual } from 'node:crypto';
import { normPhone, maskPhone, isEmail } from '../lib/util.js';
import { localParts, diffDays } from '../../shared/dates.js';
import { queueMessage, messageId } from '../domain/messages.js';
import { linkAllowed } from '../domain/linkcap.js';
import { OTP_TEXT, OTP_PER_DAY, OTP_TRIES, otpKey, liveCodes, missesOf } from '../domain/otp.js';
import { accountOf, accountPastOf } from '../projections/accounts.js';
import { accountsOn } from '../settings/accounts.js';
import { clientStats } from '../domain/insights.js';
import { fileIds } from './clients.js';
import { getClient } from './common.js';
import { upcomingOf } from './lookup.js';

export const CLIENT_ACTOR = /** @type {const} */ ({ t: 'client', id: 'moi', n: '' });
/** Wrong first names before the account opens anyway, fenced (the third one opens it). */
export const NAME_TRIES = 3;
/** The demo's visitors' own files (created through the site) are erased this long after (commands/steps/demo-purge.js). */
export const DEMO_PURGE_MS = 2 * 3600000;

/** The file, followed through its merges (at most 20), or null. */
export function rootFile(s, cid) {
  let c = cid ? s.clients.get(cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return c && !c.mergedInto ? c : null;
}

/**
 * The file a sign-in is about, or null: by the number (only the number on file: a merged file's old number, an erased
 * file, a number moved to another file open nothing, exactly as lookup.js), or by a booking (the token holder's).
 * @param {{ phone?: string, apptId?: string }} x
 */
export function fileForSignIn(s, x) {
  let c = null;
  if (x && x.phone) {
    const p = normPhone(String(x.phone));
    const cid = p ? s.clientByPhone.get(p) : null;
    c = rootFile(s, cid);
    if (c && c.phone !== p) return null;
  } else if (x && x.apptId) {
    const a = s.appts.get(x.apptId);
    c = a && a.clientId ? rootFile(s, a.clientId) : null;
  }
  return c && !c.erased && c.phone ? c : null;
}

/** The person who made this booking created the file with it (same instant): he typed its first name himself. */
export function createdByBooking(s, c, apptId) {
  const a = apptId ? s.appts.get(apptId) : null;
  return !!a && a.clientId === c.id && c.source === 'site' && a.source === 'site' && c.createdAt === a.createdAt;
}

const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** « Ton prénom ? »: accents, case and dashes aside, one a prefix of the other (Jean / Jean-Pierre), 3 letters at least. */
export function sameFirst(typed, onFile) {
  const a = fold(typed), b = fold(onFile);
  if (!a || !b || a.length < Math.min(3, b.length)) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** The last day this group of files shows life here: a visit or a booking passed, a ticket, the file's creation. */
export function lastActivity(s, c, ids, today) {
  const set = new Set(ids);
  let last = localParts(c.createdAt || 0).day;
  for (const a of s.appts.values()) {
    // a booking still to come proves nothing: the new holder of a number books before he looks at its history
    if (!set.has(a.clientId) || a.day > today || ['cancelled', 'no_show', 'pending'].includes(a.status)) continue;
    if (a.day > last) last = a.day;
  }
  for (const x of s.sales.values()) if (set.has(x.clientId) && x.day > last) last = x.day;
  return last;
}

/** Brought over from WordPress and never seen here since (no visit, no ticket): who holds that number now is unknown. */
export function importedUnseen(s, c, ids) {
  if (!(c.marketingSrc === 'wordpress' || c.source === 'wordpress' || (c.ext && c.ext.run))) return false;
  const set = new Set(ids);
  for (const a of s.appts.values()) if (set.has(a.clientId) && a.status === 'done' && !a.legacy && a.source !== 'import') return false;
  for (const x of s.sales.values()) if (set.has(x.clientId)) return false;
  return true;
}

/** Wrong first names typed today against this file's codes. */
function nameMissesToday(s, cid, day) {
  let n = 0;
  for (const m of s.messages.values()) if (m.template === 'otp' && m.cid === cid && localParts(m.at).day === day) n += missesOf(s, m.id).names;
  return n;
}

/** One wrong try against a live code, by its deterministic id (two instances counting the same try count it once). */
function miss(s, ctx, cid, msgId, name) {
  const before = ctx.drafts.filter((d) => d.type === 'account.codeMissed' && d.data.msgId === msgId).length;
  const k = missesOf(s, msgId).n + before + 1;
  if (k > OTP_TRIES) return;
  ctx.emit('account.codeMissed', { id: 'acm_' + msgId + '_' + k, cid, msgId, ...(name ? { name: true } : {}) });
}

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Text a sign-in code to the file's own number: { phone } (the number typed) or { apptId } (the holder of a booking's
 * link). Nothing when the space is closed, the file unknown, erased, without a number, or (by number) not that number's
 * file any more; nothing past OTP_PER_DAY codes nor past the shared cap of link texts of the day (domain/linkcap.js).
 * A service text asked for now: it ignores the file's « SMS de service » switch and leaves before anything else.
 * @returns {{ sent: boolean, cid?: string, msgId?: string }} the route never shows them
 */
export const sendCode = {
  run(s, input, ctx) {
    if (!accountsOn(s)) return { sent: false };
    const c = fileForSignIn(s, input || {});
    if (!c) return { sent: false };
    const day = ctx.local.day;
    if (!linkAllowed(s, c.id, day)) return { sent: false, cid: c.id };
    let n = 0;
    while (n < OTP_PER_DAY && s.messages.has(messageId(otpKey(c.id, day, n)))) n++;
    if (n >= OTP_PER_DAY) return { sent: false, cid: c.id };
    const id = queueMessage(s, ctx, { key: otpKey(c.id, day, n), template: 'otp', to: c.phone, cid: c.id, vars: {}, text: OTP_TEXT });
    return id ? { sent: true, cid: c.id, msgId: id } : { sent: false, cid: c.id };
  }
};

/**
 * The code typed back. Compared in constant time with every live code of the file (ctx.meta.otpCode(msgId), handed in
 * by the route: the command stays pure). Wrong: one account.codeMissed per live code, so a code dies after OTP_TRIES
 * tries whichever instance counted them. Right, at the first opening of the file's space: « Ton prénom ? » (first) unless
 * the booking being kept created the file; after NAME_TRIES wrong names it opens anyway, fenced. Fenced too: a file
 * inactive for longer than settings.accounts.fenceDays, or brought from WordPress and never seen here; then nothing from
 * before today shows in the space (historyFrom). A re-opening keeps the first fence and name.
 * @returns {{ ok: true, cid: string, first: string, iat: number, fenced: boolean } | { ok: false, ask?: 'first', wrong?: boolean }}
 */
export const verifyCode = {
  run(s, input, ctx) {
    const x = input || {};
    if (!accountsOn(s)) return { ok: false };
    const c = fileForSignIn(s, x);
    if (!c) return { ok: false };
    const derive = ctx.meta && ctx.meta.otpCode;
    const code = String(x.code == null ? '' : x.code).replace(/\s+/g, '').slice(0, 12);
    const live = liveCodes(s, c.id, ctx.now);
    let hit = null;
    // every live code is compared, found or not: the time does not say which one matched
    if (typeof derive === 'function' && /^\d{6}$/.test(code)) for (const m of live) if (same(derive(m.id), code) && !hit) hit = m;
    if (!hit) { for (const m of live) miss(s, ctx, c.id, m.id, false); return { ok: false }; }
    const ids = fileIds(s, c);
    const row = accountOf(s, ids), past = accountPastOf(s, ids);
    const today = ctx.local.day;
    const prev = row || past;
    let named, fenced, historyFrom;
    if (prev) ({ named, fenced, historyFrom } = prev);
    else {
      named = createdByBooking(s, c, x.apptId) || (x.first != null && sameFirst(x.first, c.first));
      if (!named) {
        if (x.first == null || !String(x.first).trim()) return { ok: false, ask: 'first' };
        // the code stays good for the next name; the third wrong one opens the space fenced
        if (nameMissesToday(s, c.id, today) + 1 < NAME_TRIES) { miss(s, ctx, c.id, hit.id, true); return { ok: false, ask: 'first', wrong: true }; }
      }
      const days = (s.settings.accounts && s.settings.accounts.fenceDays) || 180;
      fenced = !named || diffDays(lastActivity(s, c, ids, today), today) > days || importedUnseen(s, c, ids);
      historyFrom = fenced ? today : null;
    }
    // the account stays on the file it was first opened on (a merge since keeps it there): its revocations stay with it
    const anchor = (prev && prev.cid) || c.id;
    ctx.emit('account.signedIn', { id: anchor, cid: anchor, msgId: hit.id, fenced: !!fenced, ...(fenced && historyFrom ? { historyFrom } : {}), named: !!named, ...(prev ? {} : { opened: true }) });
    if (!prev) mailOpened(s, ctx, c);
    return { ok: true, cid: c.id, first: c.first, iat: ctx.now, fenced: !!fenced };
  }
};

/** The first opening, told to the file's e-mail: whoever had that number before learns that someone opened it. */
function mailOpened(s, ctx, c) {
  if (!s.settings.messages.email || !isEmail(c.email)) return null;
  const tel = s.settings.shop.phone;
  return queueMessage(s, ctx, {
    key: 'acctmail_' + c.id, channel: 'email', template: 'accountOpened', to: c.email, cid: c.id, vars: {},
    subject: 'Ton espace L’Architecte est ouvert',
    text: 'Ton espace vient d’être ouvert avec le numéro ' + maskPhone(c.phone) + '. Si c’est toi, rien à faire. Sinon, ' + (tel ? 'appelle le salon au ' + tel + '.' : 'préviens le salon.')
  });
}

/** The 5th wrong code in an instance kills every live code of that file, everywhere (one write per burst). */
export const burnCodes = {
  run(s, input, ctx) {
    const c = rootFile(s, input && input.cid);
    if (!c) return { burned: 0 };
    const ids = liveCodes(s, c.id, ctx.now).map((m) => m.id);
    if (!ids.length) return { burned: 0 };
    ctx.emit('account.codeBurned', { id: c.id, cid: c.id, ids });
    return { burned: ids.length };
  }
};

/** The account rows of a file and the files merged into it. */
const rowsOf = (s, c) => fileIds(s, c).filter((id) => s.accounts && s.accounts.has(id));
/** The client's own file, from the session the route vouches for (never from the body). */
function ownFile(s, ctx) {
  const cid = ctx.meta && ctx.meta.me && ctx.meta.me.cid;
  const c = cid ? rootFile(s, cid) : null;
  if (!c || c.erased) fail(401, 'signed_out', 'Ton espace s’est fermé. Reconnecte-toi.');
  return c;
}

/** « Déconnecter tous mes appareils » (the client), or the salon from the file (client.edit): every session opened before ends. */
export const revokeAccount = {
  run(s, input, ctx) {
    const salon = ctx.actor.t === 'staff';
    if (salon) ctx.need('client.edit');
    const c = salon ? getClient(s, input && input.cid) : ownFile(s, ctx);
    const rows = rowsOf(s, c);
    for (const id of rows) ctx.emit('account.revoked', { id, cid: id, by: salon ? 'salon' : 'client' });
    return { ok: true, revoked: rows.length };
  }
};

/** « Supprimer mon espace »: the account goes; the file, its bookings and its tickets stay. */
export const closeAccount = {
  run(s, input, ctx) {
    if (ctx.actor.t !== 'client') fail(403, 'forbidden', 'Seul le client supprime son espace.');
    const c = ownFile(s, ctx);
    const rows = rowsOf(s, c);
    for (const id of rows) ctx.emit('account.closed', { id, cid: id });
    return { ok: true, closed: rows.length };
  }
};

/**
 * « Numéro réattribué ? Détacher ce numéro » (agenda.edit): the number leaves the file and its space closes; the next
 * person booking with it gets a fresh file.
 */
export const detachPhone = {
  run(s, input, ctx) {
    ctx.need('agenda.edit');
    const c = getClient(s, input && input.id);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    if (!c.phone) fail(409, 'no_phone', 'Cette fiche n’a pas de numéro.');
    ctx.emit('client.updated', { id: c.id, cid: c.id, patch: { phoneDetachedAt: ctx.now }, fields: ['phone'] }, { phone: '' });
    const rows = rowsOf(s, c);
    for (const id of rows) ctx.emit('account.revoked', { id, cid: id, by: 'salon', reason: 'phone' });
    return { ok: true, revoked: rows.length };
  }
};

/* ---------------- the demo's persona ---------------- */

const personaMemo = new WeakMap();
/**
 * The demo's client a visitor signs in as (« Essayer avec un client de démo »): the seeded regular with the most done
 * visits who has a booking to come. Never a visitor's own file (those come from the site).
 * @returns {any|null}
 */
export function personaOf(s, now) {
  if (s.mode !== 'demo') return null;
  const day = localParts(now).day;
  const hit = personaMemo.get(s);
  if (hit && hit.v === s.version && hit.day === day) return hit.c;
  const stats = clientStats(s, day, now);
  let best = null, most = -1;
  for (const c of s.clients.values()) {
    if (c.erased || c.mergedInto || !c.phone || c.source === 'site') continue;
    const v = (stats.get(c.id) || {}).visits || 0;
    if (v <= most) continue;
    if (!upcomingOf(s, c.id, now).length) continue;
    best = c; most = v;
  }
  personaMemo.set(s, { v: s.version, day, c: best });
  return best;
}

/** The demo only: sign in as the persona. Its first opening is written once; every visitor after it writes nothing. */
export const personaSignIn = {
  run(s, input, ctx) {
    if (s.mode !== 'demo') fail(404, 'not_found', 'Indisponible.');
    if (!accountsOn(s)) fail(409, 'disabled', 'L’espace client n’est pas ouvert.');
    const c = personaOf(s, ctx.now);
    if (!c) fail(409, 'none', 'Aucun client de démo disponible pour l’instant.');
    const ids = fileIds(s, c);
    if (!accountOf(s, ids)) ctx.emit('account.signedIn', { id: c.id, cid: c.id, msgId: '', fenced: false, named: true, opened: true });
    return { ok: true, cid: c.id, first: c.first };
  }
};
