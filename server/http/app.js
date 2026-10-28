// @ts-check
// The single HTTP entry point. Every request goes through the same steps:
// route → same-origin check → body → session → capability → handler → cookies.
import { router, json, errorResponse, readJson, parseCookies, clientIp, sameOrigin, HttpError, cookie } from './kit.js';
import { runtime } from './runtime.js';
import { readSession, liveSession, signLink, signSession, pinIdle, touchSession, SESSION_COOKIE, DEVICE_COOKIE, HOUR } from '../auth/session.js';
import { STORE_DOWN, STORE_LOST, STALE_MAX } from '../core/engine.js';
import { capsOf } from '../domain/permissions.js';
import { sha256 } from '../lib/util.js';
import { localParts } from '../../shared/dates.js';
import { publicRoutes } from './routes-public.js';
import { authRoutes } from './routes-auth.js';
import { staffRoutes } from './routes-staff.js';
import { adminRoutes } from './routes-admin.js';
import { importRoutes } from './routes-import.js';
import { clientRoutes } from './routes-client.js';
import { healthRoutes } from './routes-health.js';
import { inquiryRoutes } from './routes-inquiries.js';
import { giftshopRoutes } from './routes-giftshop.js';
import { channelRoutes } from './routes-channels.js';
import { reviewRoutes } from './routes-reviews.js';
import { fiscalRoutes } from './routes-fiscal.js';
import { paymentRoutes } from './routes-payments.js';
import { teamMeRoutes } from './routes-team-me.js';
import { membershipRoutes } from './routes-membership.js';
import { loyaltyRoutes } from './routes-loyalty.js';
import { meRoutes } from './routes-me.js';
import { moiRoutes } from './routes-moi.js';
import { meLoyaltyRoutes } from './routes-me-loyalty.js';
import { basculeRoutes } from './routes-bascule.js';
import { meMembershipRoutes } from './routes-me-membership.js';

// A REGISTRY: one line per route file
const app = router();
publicRoutes(app);
authRoutes(app);
// before staffRoutes: /api/v1/payments/online must not be read as GET /api/v1/payments/:id
paymentRoutes(app);
staffRoutes(app);
adminRoutes(app);
importRoutes(app);
clientRoutes(app);
healthRoutes(app);
inquiryRoutes(app);
giftshopRoutes(app);
channelRoutes(app);
reviewRoutes(app);
fiscalRoutes(app);
teamMeRoutes(app);
membershipRoutes(app);
loyaltyRoutes(app);
meRoutes(app);
moiRoutes(app);
meLoyaltyRoutes(app);
basculeRoutes(app);
meMembershipRoutes(app);

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const READ_DOWN = 'La base de données ne répond pas. Réessaie dans un instant.';
/** the site and the client pages: a client has no ticket to note on paper */
const CLIENT_DOWN = 'Le salon ne répond pas. Réessaie dans un instant.';

/**
 * Catch up with the store. When it does not answer, this instance still holds a valid projection: reads are served
 * from it for STALE_MAX (the answer says x-lx-stale); writes are refused once the session is known (staleWrite).
 * @returns {Promise<boolean>} whether the answer comes from memory
 */
async function syncOrStale(engine) {
  try { await engine.sync(); return false; } catch { /* logged once by the engine */ }
  if (!engine.lastSyncOk || engine.clock() - engine.lastSyncOk > STALE_MAX) throw new HttpError(503, 'store_down', READ_DOWN);
  return true;
}

/**
 * A write while the store is down is refused before anything happens (no SMS, no payment started for a booking that
 * cannot be saved), except the retry of a write this instance already made: it gets its first answer (core/engine.js),
 * and one whose append failed midway is not told that nothing was saved. Signing in and out only sets a cookie, so a
 * salon tablet still locks and opens; a command such a route runs still fails on its own.
 */
function staleWrite(engine, method, pathname, me, requestId) {
  if (!MUTATING.has(method) || pathname.startsWith('/api/auth/')) return;
  const known = me && requestId ? engine.knows({ t: 'staff', id: me.id }, requestId) : '';
  if (known === 'answered') return;
  throw new HttpError(503, 'store_down', known === 'unsure' ? STORE_LOST : STORE_DOWN);
}

/** A cold start that cannot reach the store: told once per outage, with its stack, not once per request. */
let bootDown = false;

/**
 * @param {Request} req
 * @param {{ runtime?: any }} [opt]
 */
export async function handle(req, opt = {}) {
  let url;
  try { url = new URL(req.url); } catch { return json({ error: { code: 'bad_url', message: 'URL invalide.' } }, 400); }
  // rewrites from vercel.json pass the original path in ?route=
  const routed = url.searchParams.get('route');
  const pathname = routed != null ? '/api/' + routed.replace(/^\/+/, '') : url.pathname;
  if (routed != null) url.searchParams.delete('route');

  const m = app.match(req.method, pathname);
  if (!m) return json({ error: { code: 'not_found', message: 'Introuvable.' } }, 404);
  if ('allowed' in m) return json({ error: { code: 'method', message: 'Méthode non permise.' } }, 405, { allow: m.allowed.join(', ') });
  const { route, params } = m;
  const opt2 = route.opt || {};

  /** @type {string[]} */
  const setCookies = [];
  let stale = false;
  /** @param {Response} res */
  const finish = (res) => {
    for (const c of setCookies) res.headers.append('set-cookie', c);
    // read from memory while the store is down: the Comptoir shows it, and no cache keeps it
    if (stale) { res.headers.set('x-lx-stale', '1'); res.headers.set('cache-control', 'no-store'); }
    return res;
  };
  try {
    if (MUTATING.has(req.method) && opt2.csrf !== false && !sameOrigin(req, url)) throw new HttpError(403, 'origin', 'Requête refusée (origine).');
    let rt;
    try { rt = opt.runtime || (await runtime()); }
    catch (e) {
      // a cold start that cannot reach the store has nothing to serve: 503, which the site shows as "ne répond pas"
      if (e && /** @type {any} */ (e).expose) throw e;
      if (!bootDown) console.error('[lx] boot', e && /** @type {any} */ (e).stack ? /** @type {any} */ (e).stack : e);
      bootDown = true;
      throw new HttpError(503, 'store_down', READ_DOWN);
    }
    if (bootDown && !opt.runtime) { bootDown = false; console.warn('[lx] boot ok again'); }
    const engine = rt.engine;
    stale = await syncOrStale(engine);
    const s = engine.state;
    if (!rt.origin) rt.origin = url.origin;
    const origin = rt.cfg.publicUrl || url.origin;
    const now = engine.clock();
    const cookies = parseCookies(req);
    const ip = clientIp(req);

    let raw = '';
    let body = {};
    if (opt2.raw) raw = await req.text();
    else body = await readJson(req);

    // the session, checked against the live state (a revoked person or device is out at once)
    let me = null, device = null, session = null;
    const devToken = cookies[DEVICE_COOKIE];
    if (devToken) { const did = s.deviceByHash.get(sha256(devToken)); const d = did ? s.devices.get(did) : null; if (d && !d.revoked) device = d; }
    const p = readSession(rt.secret, cookies[SESSION_COOKIE], now);
    // a PIN session left alone ends on the server too, even if the tablet's own lock never ran (closed tab, crash)
    const idle = !!p && pinIdle(p, now);
    if (p && !idle) {
      const live = liveSession(s, p, devToken);
      if (live) { me = live.staff; session = p; if (!device && live.device) device = live.device; }
    }
    if (!me && cookies[SESSION_COOKIE]) setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: rt.cfg.secureCookies }));
    const caps = me ? capsOf(me, s.settings) : new Set();
    const needsAuth = opt2.auth !== false && pathname.startsWith('/api/v1/');
    if (needsAuth && !me) throw idle ? new HttpError(401, 'pin_idle', p && p.ph ? 'Téléphone verrouillé après 12 h sans activité. Saisis ton code.' : 'Poste verrouillé après 10 minutes sans activité. Saisis ton code.') : new HttpError(401, 'signed_out', 'Session expirée. Reconnecte-toi.');
    if (opt2.cap && !caps.has(opt2.cap)) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès à cette page.');
    if (stale) staleWrite(engine, req.method, pathname, me, req.headers.get('x-request-id') || undefined);

    const meta = {
      linkFor: (a) => origin + '/r/' + signLink(rt.secret, 'appt', a.code),
      siteUrl: origin + '/',
      offerLink: (wid) => origin + '/?offre=' + encodeURIComponent(signLink(rt.secret, 'offer', wid)),
      receiptLink: (sale) => origin + '/recu/' + signLink(rt.secret, 'receipt', String(sale.number)),
      // the review request's tracked link: records the opening, then on to Google (routes-reviews.js)
      reviewLink: (msgId) => origin + '/avis/' + signLink(rt.secret, 'review', msgId),
      ip
    };
    const requestId = req.headers.get('x-request-id') || undefined;
    if (requestId && !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(400, 'invalid', 'Identifiant de requête invalide.');
    // one key per command: a handler that runs two commands must not get the first one's cached
    // answer for the second; a retried request replays the same sequence, so it stays idempotent.
    // ':' is refused in x-request-id, so a derived key can never equal an id a client sends
    let n = 0;
    const r = {
      req, url, params, query: url.searchParams, body, raw, ip, rt, me, caps, device, session, setCookies, meta, origin,
      get s() { return rt.engine.state; },
      get now() { return rt.engine.clock(); },
      get local() { return localParts(rt.engine.clock()); },
      run: (handler, input) => {
        const i = n++;
        return engine.run(handler, input, {
          actor: { t: 'staff', id: me.id, n: me.name, ...(device ? { dev: device.id } : {}) }, staff: me, caps, meta,
          requestId: requestId && i ? requestId + ':' + i : requestId
        });
      }
    };

    // keep active staff signed in: re-issue a session that is more than an hour old
    if (session && session.kind === 'pwd' && now - session.iat > HOUR && session.exp - now < 11 * HOUR) {
      const exp = Math.max(session.exp, now + 12 * HOUR);
      setCookies.push(cookie(SESSION_COOKIE, signSession(rt.secret, { uid: me.id, did: session.did || null, kind: session.kind, iat: now, exp }), { maxAge: (exp - now) / 1000, secure: rt.cfg.secureCookies }));
    }
    // a PIN session slides with every request (the Comptoir's pulse too: the tablet's own lock handles an untouched
    // screen), re-signed at most once a minute; its expiry stays (12 hours, 30 days on a linked phone)
    const touched = session ? touchSession(rt.secret, session, now) : null;
    if (touched && session) setCookies.push(cookie(SESSION_COOKIE, touched, { maxAge: (session.exp - now) / 1000, secure: rt.cfg.secureCookies }));

    const out = await route.fn(r);
    return finish(out instanceof Response ? out : json(out ?? { ok: true }));
  } catch (e) {
    const forStaff = pathname.startsWith('/api/v1/') || pathname.startsWith('/api/auth/');
    return finish(errorResponse(e && e.code === 'store_down' && !forStaff ? new HttpError(503, 'store_down', CLIENT_DOWN) : e));
  }
}
