// @ts-check
// AC-01 · Espace client: signing in with a code by SMS (/api/public/account/*), the signed-in client's own reads and
// session (/api/me/*), and what the salon sees and does of an account (/api/v1/*). Guest booking is not touched: an
// account is never needed to book, move, cancel or pay.
// The sign-in never says whether a number is known: the same words, the same status, about the same time (the work runs
// after the answer, as /api/public/lookup does, routes-client.js).
import { HttpError, guard, limited, failureGuard } from './kit.js';
import { checkLink, signLink } from '../auth/session.js';
import { normPhone, maskPhone } from '../lib/util.js';
import { LINK_IP_PER_HOUR, LINK_PER_DAY, linkIpKey, linkPhoneKey } from '../domain/linkcap.js';
import { otpCode } from '../domain/otp.js';
import { meHome, meHistory, shownIdentity } from '../domain/me.js';
import { accountOf } from '../projections/accounts.js';
import { accountsOn } from '../settings/accounts.js';
import { isDay } from '../../shared/dates.js';
import { fileIds } from '../commands/clients.js';
import { DEMO_PURGE_MS, sendCode, verifyCode, burnCodes, revokeAccount, closeAccount, detachPhone, personaOf, personaSignIn, rootFile } from '../commands/accounts.js';
import { readMe, requireMe, runAs, runSigningIn, isPersona, setClientCookie, clearClientCookie } from './me-kit.js';
import { isDemo } from './routes-public.js';
import * as sched from './scheduler.js';
import { waitUntil } from '@vercel/functions';

export const START_MESSAGE = 'Si ce numéro est connu du salon, tu reçois un code par SMS.';
const BAD_CODE = 'Code incorrect ou expiré. Redemande-en un.';
// the file's guard lasts 10 min, the device's an hour: one sentence true for both
const TOO_MANY = 'Trop d’essais. Réessaie un peu plus tard ou appelle le salon.';
const DISABLED = 'L’espace client n’est pas encore ouvert.';
const HOUR = 3600000, DAY = 86400000;
/** How long the salon's « acc » invite stays good (AC-02: signLink(secret, 'acc', cid + '~' + exp36)). */
export const ACC_TTL_MS = 48 * HOUR;

/**
 * The answer's floors (a known number writes and an unknown one does not: the time says nothing). verify writes a miss
 * against a live code before it answers, so its floor is as high as start's (a slow store's append stays under it).
 * Tests shorten them. later: where the work after the answer runs (waitUntil on Vercel); settled() awaits it (tests).
 */
export const ACCOUNT_TIMING = { minMs: 450, jitterMs: 200, verifyMs: 450 };
const inflight = new Set();
function later(p) {
  const q = p.catch((e) => console.error('[lx] account', e && e.message)).finally(() => inflight.delete(q));
  inflight.add(q);
  waitUntil(q);
}
/** The background work of the sign-in routes, done (tests). */
export const settled = () => Promise.all([...inflight]);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
/** Commands of the sign-in routes: the client actor, and the code of a message derived here (the command stays pure). */
const signingIn = (r) => runSigningIn(r, { otpCode: (msgId) => otpCode(r.rt.secret, msgId) });

/** The text leaves now, not at the next tick: the client waits for it, phone in hand. */
async function sendNow(r, msgId) {
  if (typeof sched.dispatchNow === 'function') await sched.dispatchNow(r.rt, [msgId]);
  else await sched.maybeTick(r.rt, r.meta, { force: true });
}

function needOn(r) { if (!accountsOn(r.s)) throw new HttpError(409, 'disabled', DISABLED); }

/**
 * What a « Garde ton espace » link opens, or null: a booking's /r/ token (the file of that booking), or the salon's « acc »
 * invite (cid~expiry in base 36, dead after ACC_TTL_MS). Both prove the phone the link was sent to, nothing more.
 * @returns {{ apptId: string, a: any, cid: string } | null}
 */
function linkTarget(r, token) {
  const t = String(token || '').slice(0, 120);
  const code = checkLink(r.rt.secret, 'appt', t);
  const id = code ? r.s.apptByCode.get(code) : null;
  const a = id ? r.s.appts.get(id) : null;
  if (a) return { apptId: a.id, a, cid: a.clientId || '' };
  const acc = checkLink(r.rt.secret, 'acc', t);
  const m = acc ? /^([^~]+)~([0-9a-z]{1,12})$/.exec(acc) : null;
  return m && parseInt(m[2], 36) > r.now ? { apptId: '', a: null, cid: m[1] } : null;
}
/** The sign-in commands' input for a link: by its booking, or by its file. */
const linkInput = (t) => (!t ? {} : t.apptId ? { apptId: t.apptId } : { cid: t.cid });

/** A visitor's own booking that created its file just now, in the demo: the one case the demo hands back the code. */
function freshVisitorFile(r, a) {
  const c = a.clientId ? r.s.clients.get(a.clientId) : null;
  return !!c && !c.mergedInto && c.source === 'site' && !c.demo && c.createdAt === a.createdAt && r.now - c.createdAt < DEMO_PURGE_MS;
}

const fileOf = (r) => {
  const c = rootFile(r.s, r.params.id);
  if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
  return c;
};

function accountView(account) {
  if (!account) return { has: false };
  return { has: true, since: account.since, lastAt: account.lastAt, count: account.count, fenced: account.fenced, historyFrom: account.historyFrom, named: account.named, prefs: account.prefs || { staffId: null }, eraseAt: account.eraseAt || 0 };
}

export function meRoutes(app) {
  /* ---------------- signing in ---------------- */

  // what the site and /moi show: the entry points hide when the space is closed
  app.get('/api/public/account', (r) => {
    const me = accountsOn(r.s) ? readMe(r) : null;
    return { enabled: accountsOn(r.s), signedIn: !!me, ...(me ? { first: shownIdentity(me.c, me.account).first } : {}), demo: isDemo(r) };
  });

  app.post('/api/public/account/start', async (r) => {
    needOn(r);
    // one limit per device for every « send me a link » page, then the number's own (domain/linkcap.js)
    guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const phone = normPhone(String((r.body && r.body.phone) || '').slice(0, 32));
    if (!phone) throw new HttpError(400, 'invalid', 'Vérifie ton numéro.');
    const answer = wait(ACCOUNT_TIMING.minMs + Math.random() * ACCOUNT_TIMING.jitterMs);
    // the demo hands the persona's code back (it is shown on the page); any other number gets the same answer, no code
    const persona = isDemo(r) ? personaOf(r.s, r.now) : null;
    const forPersona = !!persona && persona.phone === phone;
    const work = async () => {
      const res = await signingIn(r)(sendCode, { phone });
      if (res.sent && res.msgId) await sendNow(r, res.msgId);
      return res;
    };
    let demoCode = null;
    // the persona's code is shown to every visitor (texts simulated): no per-number cap, its live code is shared
    if (forPersona) { const res = await work().catch(() => ({})); if (res.msgId) demoCode = otpCode(r.rt.secret, res.msgId); }
    // past 3 asks a day the number gets nothing more, and the asker is not told (a 429 would say the number was tried)
    else if (!limited(linkPhoneKey(phone), LINK_PER_DAY, DAY)) later(work());
    await answer;
    return { ok: true, message: START_MESSAGE, ...(demoCode ? { demoCode } : {}) };
  });

  // after a guest booking (« Garde ton espace »), or the salon's invite (« Envoyer le lien de son espace », AC-02): the
  // link's holder knows the booking or got the link on that number, so the answer may say where
  app.post('/api/public/account/keep', async (r) => {
    needOn(r);
    guard(linkIpKey(r.ip), LINK_IP_PER_HOUR, HOUR, 'Trop de demandes depuis cet appareil. Réessaie dans une heure ou appelle le salon.');
    const t = linkTarget(r, r.body && r.body.token);
    const c = t && t.cid ? rootFile(r.s, t.cid) : null;
    if (!t || !c || c.erased || !c.phone) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
    let demoCode = null;
    if (!limited(linkPhoneKey(c.phone), LINK_PER_DAY, DAY)) {
      const res = await signingIn(r)(sendCode, linkInput(t));
      if (res.sent && res.msgId) await sendNow(r, res.msgId).catch((e) => console.error('[lx] account keep', e && e.message));
      if (res.msgId && isDemo(r) && t.a && freshVisitorFile(r, t.a)) demoCode = otpCode(r.rt.secret, res.msgId);
    }
    return { ok: true, sentTo: maskPhone(c.phone), ...(demoCode ? { demoCode } : {}) };
  });

  app.post('/api/public/account/verify', async (r) => {
    needOn(r);
    const b = r.body || {};
    const answer = wait(ACCOUNT_TIMING.verifyMs + Math.random() * ACCOUNT_TIMING.jitterMs);
    const ipGuard = failureGuard('acvi|' + r.ip, 20, HOUR, TOO_MANY);
    const t = b.token ? linkTarget(r, b.token) : null;
    /** @type {{ phone?: string, apptId?: string, cid?: string }} */
    const input = b.token ? linkInput(t) : { phone: normPhone(String(b.phone || '').slice(0, 32)) };
    // the guard keys on the file, not on the string typed: +33 6…, 06… and 0033 6… are one number and share it
    const cid = t ? t.cid : input.phone ? r.s.clientByPhone.get(input.phone) : null;
    const root = cid ? rootFile(r.s, cid) : null;
    const key = 'acv|' + (root ? root.id : input.phone || String(b.token || '').slice(0, 120));
    const fileGuard = failureGuard(key, 5, 10 * 60000, TOO_MANY);
    const res = await signingIn(r)(verifyCode, { ...input, code: b.code, ...(b.first != null ? { first: String(b.first).slice(0, 40) } : {}) });
    await answer;
    // an attempt counts while it is checked (kit.js failureGuard): a right code or a question frees its place
    if (res.ok || res.ask) { ipGuard.done(); fileGuard.done(); }
    if (res.ok) {
      // the demo's persona, however it signed in: its cookie stays the showcase's even if the persona changes since
      setClientCookie(r, { cid: res.cid, phone: rootFile(r.s, res.cid).phone, ...(res.persona && isDemo(r) ? { demo: true } : {}) });
      return { ok: true, first: res.first };
    }
    // the right code at a first opening: one more question, the code still good
    if (res.ask) return { ok: false, ask: res.ask, ...(res.wrong ? { message: 'Ce n’est pas le prénom de la fiche. Réessaie.' } : { message: 'Ton prénom ?' }) };
    ipGuard.fail(); fileGuard.fail();
    // the 5th wrong code in this instance kills every live code of that file, everywhere
    let burst = false;
    try { failureGuard(key, 5, 10 * 60000).done(); } catch { burst = true; }
    if (burst && root) later(signingIn(r)(burnCodes, { cid: root.id }));
    throw new HttpError(400, 'bad_code', BAD_CODE);
  });

  // the demo (texts simulated): sign in as the demo's client, no code
  app.post('/api/public/account/demo', async (r) => {
    if (!isDemo(r)) throw new HttpError(404, 'not_found', 'Indisponible.');
    guard('acdemo|' + r.ip, 30, HOUR);
    const res = await signingIn(r)(personaSignIn, {});
    const c = rootFile(r.s, res.cid);
    setClientCookie(r, { cid: res.cid, phone: c.phone, demo: true });
    return { ok: true, first: res.first };
  });

  /* ---------------- the signed-in client ---------------- */

  app.get('/api/me', (r) => {
    const me = requireMe(r);
    const a = me.account;
    const who = shownIdentity(me.c, a);
    return { first: who.first, last: who.last, phone: maskPhone(me.c.phone), since: a.since, fenced: !!a.fenced, historyFrom: a.fenced ? a.historyFrom : null, named: !!a.named, demo: isPersona(me) };
  });

  app.get('/api/me/home', (r) => {
    const me = requireMe(r);
    const origin = r.origin;
    return meHome(r.s, me.c, me.ids, me.account, { now: r.now, today: r.local.day, origin, tokenFor: (a) => signLink(r.rt.secret, 'appt', a.code), receiptFor: r.meta.receiptLink, demo: isPersona(me) });
  });

  app.get('/api/me/history', (r) => {
    const me = requireMe(r);
    const before = r.query.get('before');
    return meHistory(r.s, me.ids, { before: before && isDay(before) ? before : null, account: me.account, receiptFor: r.meta.receiptLink });
  });

  app.post('/api/me/signout', (r) => { clearClientCookie(r); return { ok: true }; });

  app.post('/api/me/signout-all', async (r) => {
    const me = requireMe(r);
    if (!isPersona(me)) await runAs(r, me)(revokeAccount, {});
    clearClientCookie(r);
    return { ok: true };
  });

  app.post('/api/me/close', async (r) => {
    const me = requireMe(r);
    if (!isPersona(me)) await runAs(r, me)(closeAccount, {});
    clearClientCookie(r);
    return { ok: true };
  });

  /* ---------------- the salon ---------------- */

  app.get('/api/v1/clients/:id/account', (r) => {
    const c = fileOf(r);
    return accountView(accountOf(r.s, fileIds(r.s, c)));
  }, { cap: 'client.view' });

  app.post('/api/v1/clients/:id/account/revoke', (r) => r.run(revokeAccount, { cid: fileOf(r).id }), { cap: 'client.edit' });

  app.post('/api/v1/clients/:id/detach-phone', (r) => r.run(detachPhone, { id: fileOf(r).id }), { cap: 'agenda.edit' });

  // TEAM's cockpit: how many clients have a space, how many came back to it this month, how many opened one
  app.get('/api/v1/accounts/stats', (r) => {
    const s = r.s, since = r.now - 30 * DAY;
    let accounts = 0, active30 = 0, opened30 = 0;
    for (const row of s.accounts.values()) {
      const c = s.clients.get(row.cid);
      if (!c || c.erased) continue;
      accounts++;
      if (row.lastAt >= since) active30++;
      if (row.since >= since) opened30++;
    }
    return { accounts, active30, opened30 };
  }, { cap: 'report.shop' });
}
