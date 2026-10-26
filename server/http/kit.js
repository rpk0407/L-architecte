// @ts-check
// HTTP plumbing on the Web standard Request/Response: routing, bodies, cookies, errors, limits.
import { DomainError } from '../core/engine.js';
import { InvalidInput } from '../lib/validate.js';

export const MAX_BODY = 64 * 1024;

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-resource-policy': 'same-origin'
};

/** @param {any} data @param {number} [status] @param {Record<string, string>} [headers] */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(e) {
  if (e instanceof DomainError || e instanceof HttpError || e instanceof InvalidInput || (e && e.expose)) {
    return json({ error: { code: e.code, message: e.message, ...(e.extra ? { extra: e.extra } : {}) } }, e.status || 400);
  }
  console.error('[lx] unexpected', e && e.stack ? e.stack : e);
  return json({ error: { code: 'server', message: 'Une erreur est survenue. Réessaie dans un instant.' } }, 500);
}

/** Parse a JSON body, refusing anything large or not JSON. */
export async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large', 'Requête trop volumineuse.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'too_large', 'Requête trop volumineuse.');
  if (!text) return {};
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'json', 'JSON attendu.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'json', 'JSON invalide.'); }
}

export function parseCookies(req) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

/**
 * @param {string} name @param {string} value
 * @param {{ maxAge?: number, secure?: boolean, sameSite?: 'Strict'|'Lax', path?: string }} o
 */
export function cookie(name, value, o = {}) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=' + (o.path || '/'), 'HttpOnly', 'SameSite=' + (o.sameSite || 'Strict')];
  if (o.secure !== false) parts.push('Secure');
  if (o.maxAge != null) parts.push('Max-Age=' + Math.floor(o.maxAge));
  return parts.join('; ');
}

export function clientIp(req) {
  return String(req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim().slice(0, 64);
}

/**
 * Requests that change something must come from our own pages. A cross-site form or script
 * cannot forge a same-origin JSON request, and our cookies are SameSite=Strict on top.
 */
export function sameOrigin(req, url) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) {
    const fwd = req.headers.get('x-forwarded-host');
    if (!fwd || origin !== url.protocol + '//' + fwd) return false;
  }
  return true;
}

/* ---------------- rate limiting (per instance, sliding window) ---------------- */

const windows = new Map();
/** @returns {boolean} true when over the limit */
export function limited(key, max, perMs) {
  const now = Date.now();
  let list = windows.get(key);
  if (!list) { list = []; windows.set(key, list); }
  while (list.length && list[0] <= now - perMs) list.shift();
  if (list.length >= max) return true;
  list.push(now);
  if (windows.size > 5000) for (const [k, v] of windows) { if (!v.length || v[v.length - 1] <= now - 3600000) windows.delete(k); }
  return false;
}
export function guard(key, max, perMs, message = 'Trop de tentatives. Patiente un instant.') {
  if (limited(key, max, perMs)) throw new HttpError(429, 'slow_down', message);
}
/** Like guard, but only failures count: call `fail()` when the attempt was wrong. */
export function failureGuard(key, max, perMs, message) {
  const now = Date.now();
  const list = (windows.get(key) || []).filter((t) => t > now - perMs);
  windows.set(key, list);
  if (list.length >= max) throw new HttpError(429, 'slow_down', message);
  return { fail() { list.push(Date.now()); } };
}

/* ---------------- routing ---------------- */

/**
 * @typedef {{ method: string, parts: string[], fn: (r: any) => Promise<Response|any>|Response|any, opt: any }} Route
 */
export function router() {
  /** @type {Route[]} */
  const routes = [];
  const add = (method, path, fn, opt = {}) => { routes.push({ method, parts: path.split('/').filter(Boolean), fn, opt }); };
  return {
    get: (p, fn, o) => add('GET', p, fn, o),
    post: (p, fn, o) => add('POST', p, fn, o),
    patch: (p, fn, o) => add('PATCH', p, fn, o),
    del: (p, fn, o) => add('DELETE', p, fn, o),
    /** @returns {{ route: Route, params: Record<string, string> } | { allowed: string[] } | null} */
    match(method, pathname) {
      const segs = pathname.split('/').filter(Boolean);
      const allowed = [];
      for (const r of routes) {
        if (r.parts.length !== segs.length) continue;
        /** @type {Record<string, string>} */
        const params = {};
        let ok = true;
        for (let i = 0; i < segs.length; i++) {
          const p = r.parts[i];
          if (p.startsWith(':')) { try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch { ok = false; break; } }
          else if (p !== segs[i]) { ok = false; break; }
        }
        if (!ok) continue;
        if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { route: r, params };
        allowed.push(r.method);
      }
      return allowed.length ? { allowed } : null;
    }
  };
}
