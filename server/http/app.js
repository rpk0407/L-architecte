// @ts-check
// The single HTTP entry point. Every request goes through the same steps:
// route → same-origin check → body → session → capability → handler → cookies.
import { router, json, errorResponse, readJson, parseCookies, clientIp, sameOrigin, HttpError, cookie } from './kit.js';
import { runtime } from './runtime.js';
import { readSession, liveSession, signLink, signSession, SESSION_COOKIE, DEVICE_COOKIE, HOUR } from '../auth/session.js';
import { capsOf } from '../domain/permissions.js';
import { sha256 } from '../lib/util.js';
import { localParts } from '../../shared/dates.js';
import { publicRoutes } from './routes-public.js';
import { authRoutes } from './routes-auth.js';
import { staffRoutes } from './routes-staff.js';
import { adminRoutes } from './routes-admin.js';
import { importRoutes } from './routes-import.js';
import { uploadRoutes, readCapped } from './routes-uploads.js';
import { clientRoutes } from './routes-client.js';
import { healthRoutes } from './routes-health.js';

// A REGISTRY: one line per route file
const app = router();
publicRoutes(app);
authRoutes(app);
staffRoutes(app);
adminRoutes(app);
importRoutes(app);
uploadRoutes(app);
clientRoutes(app);
healthRoutes(app);

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * A binary body (a photo), refused past `max` bytes before it is read when the length is announced, and while reading
 * when it is not, so a large upload never sits in memory whole.
 * @param {Request} req @param {number} max
 */
async function readBytes(req, max) {
  const tooLarge = () => new HttpError(413, 'too_large', 'Fichier trop lourd : ' + Math.round(max / 1048576) + ' Mo au plus.');
  if (Number(req.headers.get('content-length') || 0) > max) throw tooLarge();
  const b = await readCapped(req.body, max);
  if (!b) throw tooLarge();
  return b;
}

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
  try {
    if (MUTATING.has(req.method) && opt2.csrf !== false && !sameOrigin(req, url)) throw new HttpError(403, 'origin', 'Requête refusée (origine).');
    const rt = opt.runtime || (await runtime());
    const engine = rt.engine;
    await engine.sync();
    const s = engine.state;
    if (!rt.origin) rt.origin = url.origin;
    const origin = rt.cfg.publicUrl || url.origin;
    const now = engine.clock();
    const cookies = parseCookies(req);
    const ip = clientIp(req);

    let raw = '';
    let body = {};
    /** @type {Uint8Array|null} */
    let bytes = null;
    if (opt2.raw) raw = await req.text();
    else if (!opt2.bytes) body = await readJson(req);

    // the session, checked against the live state (a revoked person or device is out at once)
    let me = null, device = null, session = null;
    const devToken = cookies[DEVICE_COOKIE];
    if (devToken) { const did = s.deviceByHash.get(sha256(devToken)); const d = did ? s.devices.get(did) : null; if (d && !d.revoked) device = d; }
    const p = readSession(rt.secret, cookies[SESSION_COOKIE], now);
    if (p) {
      const live = liveSession(s, p, devToken);
      if (live) { me = live.staff; session = p; if (!device && live.device) device = live.device; }
    }
    if (!me && cookies[SESSION_COOKIE]) setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: rt.cfg.secureCookies }));
    const caps = me ? capsOf(me, s.settings) : new Set();
    const needsAuth = opt2.auth !== false && pathname.startsWith('/api/v1/');
    if (needsAuth && !me) throw new HttpError(401, 'signed_out', 'Session expirée. Reconnecte-toi.');
    if (opt2.cap && !caps.has(opt2.cap)) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès à cette page.');
    // a photo is read only once the session and the right are checked: nobody else gets 3 MB into memory
    if (opt2.bytes) bytes = await readBytes(req, opt2.bytes);

    const meta = {
      linkFor: (a) => origin + '/r/' + signLink(rt.secret, 'appt', a.code),
      siteUrl: origin + '/',
      offerLink: (wid) => origin + '/?offre=' + encodeURIComponent(signLink(rt.secret, 'offer', wid)),
      receiptLink: (sale) => origin + '/recu/' + signLink(rt.secret, 'receipt', String(sale.number)),
      ip
    };
    const requestId = req.headers.get('x-request-id') || undefined;
    if (requestId && !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(400, 'invalid', 'Identifiant de requête invalide.');
    // one key per command: a handler that runs two commands must not get the first one's cached
    // answer for the second; a retried request replays the same sequence, so it stays idempotent.
    // ':' is refused in x-request-id, so a derived key can never equal an id a client sends
    let n = 0;
    const r = {
      req, url, params, query: url.searchParams, body, raw, bytes, ip, rt, me, caps, device, session, setCookies, meta, origin,
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

    const out = await route.fn(r);
    const res = out instanceof Response ? out : json(out ?? { ok: true });
    for (const c of setCookies) res.headers.append('set-cookie', c);
    return res;
  } catch (e) {
    const res = errorResponse(e);
    for (const c of setCookies) res.headers.append('set-cookie', c);
    return res;
  }
}
