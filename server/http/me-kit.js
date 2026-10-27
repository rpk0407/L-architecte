// @ts-check
// AC-01 · The client session, as every client route uses it (the contract of INDEX › Shared contracts):
//   const me = requireMe(r);                        // 401 signed_out without a live session
//   const run = runAs(r, me);                       // commands as the client: actor { t: 'client', id: 'moi', n: '' }, meta.me = { cid }
//   await run(handler, { ... });                    // the file is always ctx.meta.me.cid, never a cid from the body
//   if (isPersona(me)) return { ok: true, demo: true };   // the demo's persona changes nothing for the next visitor
// Routes never build a client ctx by hand. Client routes live under /api/me/*, sign-in under /api/public/account/*.
import { HttpError, parseCookies, cookie } from './kit.js';
import { CLIENT_COOKIE, CLIENT_SLIDE, readClient, liveClient, signClient, phoneTag } from '../auth/client-session.js';
import { fileIds } from '../commands/clients.js';
import { CLIENT_ACTOR, personaOf } from '../commands/accounts.js';
import { accountsOn } from '../settings/accounts.js';

const DAY = 86400000;
const SIGNED_OUT = 'Ton espace s’est fermé. Reconnecte-toi.';

/** How long a client stays signed in (settings.accounts.sessionDays), in ms. */
const sessionMs = (s) => ((s.settings.accounts && s.settings.accounts.sessionDays) || 180) * DAY;

/**
 * The signed-in client of this request, checked against the live state, or null. Read once per request (the result is
 * kept on r); a cookie that no longer opens anything is cleared, a week-old one is re-issued (sliding).
 * @returns {{ c: any, cid: string, ids: string[], account: any, session: import('../auth/client-session.js').ClientPayload, persona: boolean } | null}
 */
export function readMe(r) {
  if (r._me !== undefined) return r._me;
  r._me = null;
  const token = parseCookies(r.req)[CLIENT_COOKIE];
  // the owner closing the space closes every session with it (opening it again brings them back: nothing is revoked)
  if (!token || !accountsOn(r.s)) return null;
  const now = r.now;
  const p = readClient(r.rt.secret, token, now);
  const live = p ? liveClient(r.s, r.rt.secret, p, (c) => fileIds(r.s, c)) : null;
  if (!p || !live) { clearClientCookie(r); return null; }
  const demo = r.rt.cfg.mode === 'demo' && r.s.mode === 'demo';
  const persona = demo && (p.demo === true || (personaOf(r.s, now) || {}).id === live.cid);
  r._me = { ...live, session: p, persona };
  if (now - p.iat > CLIENT_SLIDE) setClientCookie(r, { cid: live.cid, phone: live.c.phone, demo: p.demo === true });
  return r._me;
}

/** The signed-in client, or 401 « Ton espace s’est fermé. Reconnecte-toi. » */
export function requireMe(r) {
  const me = readMe(r);
  if (!me) throw new HttpError(401, 'signed_out', SIGNED_OUT);
  return me;
}

/** The demo's persona: its writes answer ok without emitting, so one visitor never changes the showcase for the next. */
export const isPersona = (me) => !!(me && me.persona);

/**
 * Commands as this client. Idempotent with the request's x-request-id (already checked by app.js): 'me' + cid + ':' +
 * header for the first command, + ':' + i for the i-th, so a retried request replays the same sequence and two clients
 * never share a key; without the header, no key at all (each request writes).
 * @param {any} r @param {{ cid: string }} me
 * @returns {(handler: import('../core/engine.js').Handler, input: any) => Promise<any>}
 */
export function runAs(r, me) {
  const header = r.req.headers.get('x-request-id') || '';
  let i = 0;
  return (handler, input) => {
    const n = i++;
    const requestId = header ? 'me' + me.cid + ':' + header + (n ? ':' + n : '') : undefined;
    return r.rt.engine.run(handler, input, { actor: CLIENT_ACTOR, caps: new Set(), meta: { ...r.meta, me: { cid: me.cid } }, ...(requestId ? { requestId } : {}) });
  };
}

/**
 * Sign this phone in: lx_c for settings.accounts.sessionDays. HttpOnly, Secure, SameSite=Lax (see auth/client-session.js).
 * @param {any} r @param {{ cid: string, phone: string, demo?: boolean }} c
 */
export function setClientCookie(r, c) {
  const now = r.now, ms = sessionMs(r.s);
  const token = signClient(r.rt.secret, { cid: c.cid, ph: phoneTag(r.rt.secret, c.phone), iat: now, exp: now + ms, ...(c.demo ? { demo: true } : {}) });
  r.setCookies.push(cookie(CLIENT_COOKIE, token, { maxAge: ms / 1000, secure: r.rt.cfg.secureCookies, sameSite: 'Lax' }));
}

/** @param {any} r */
export function clearClientCookie(r) {
  r.setCookies.push(cookie(CLIENT_COOKIE, '', { maxAge: 0, secure: r.rt.cfg.secureCookies, sameSite: 'Lax' }));
}
