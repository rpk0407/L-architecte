// @ts-check
// Le site: its texts (the `site` settings, server/settings/site.js) and its photos. A photo arrives as the raw image
// (the Comptoir has already resized it to 1600 px), is stored once under its SHA-256 in Vercel Blob and is shown
// through /api/public/media/<sha>.<ext>. The old WordPress site's media library can be copied over in one go, as
// long as the old site still answers (before the domain switch, or at ancien.barberlarchitecte.com).
//
// Owner and managers, like the catalogue (`catalog`): a manager has no `settings`, and the site is shop content.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HttpError, guard, json } from './kit.js';
import { siteOf, TOKENS, TOKEN_SOURCE, TOKEN_LIKE_SOURCE, LIMITS, hoursText, closedText } from '../settings/site.js';
import { updateSite } from '../commands/site.js';
import { str, opt, obj, arr, int, parse } from '../lib/validate.js';
import { serviceView } from './views.js';

export const MAX_PHOTO = 3 * 1024 * 1024;
const TYPES = /** @type {const} */ ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const NAME = /^[a-f0-9]{64}\.(jpg|png|webp)$/;

/** What the bytes really are, whatever the header says: JPEG, PNG or WebP, nothing else (no SVG: it can carry script). */
export function sniff(/** @type {Uint8Array} */ b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  return null;
}

/**
 * Where photos live: Vercel Blob when the salon has it; otherwise next to the journal file (development, a salon on its
 * own server) or in memory (a demo). A real salon with neither (on Vercel, or Postgres on a server) gets none: its
 * files would vanish at the next restart while the site still points at them. Tests set rt.media themselves.
 * @returns {Promise<{ putPublic: (name: string, bytes: Uint8Array, type: string) => Promise<any>, getPublic: (name: string) => Promise<{ stream: any, type: string, size: number|null }|null> } | null>}
 */
export async function mediaOf(/** @type {any} */ rt) {
  if (rt.media !== undefined) return rt.media;
  const cfg = rt.cfg;
  if (cfg.blob) { const { blobMedia } = await import('../store/blob.js'); rt.media = blobMedia(); }
  else if (cfg.dataFile) {
    const dir = join(dirname(cfg.dataFile), 'media');
    rt.media = {
      async putPublic(name, bytes) { await mkdir(dir, { recursive: true }); await writeFile(join(dir, name), bytes); return { pathname: name }; },
      async getPublic(name) { try { const b = await readFile(join(dir, name)); return { stream: b, type: MIME[name.split('.').pop() || ''] || '', size: b.length }; } catch { return null; } }
    };
  } else if (cfg.mode === 'production') rt.media = null;
  else {
    const files = new Map();
    rt.media = {
      async putPublic(name, bytes, type) { files.set(name, { bytes, type }); return { pathname: name }; },
      async getPublic(name) { const f = files.get(name); return f ? { stream: f.bytes, type: f.type, size: f.bytes.byteLength } : null; }
    };
  }
  return rt.media;
}

/** Store a checked image; the same photo twice is the same file. @returns {Promise<{ url: string, name: string, size: number, type: string }>} */
async function store(rt, /** @type {Uint8Array} */ bytes, /** @type {string} */ ext) {
  const media = await mediaOf(rt);
  if (!media) throw new HttpError(503, 'no_storage', 'Les photos ont besoin d’un stockage durable : un stockage Vercel Blob (BLOB_READ_WRITE_TOKEN), ou LX_DATA_FILE sur un serveur à toi. Ajoute-le puis redémarre.');
  const name = createHash('sha256').update(bytes).digest('hex') + '.' + ext;
  await media.putPublic(name, bytes, MIME[ext]);
  return { url: '/api/public/media/' + name, name, size: bytes.byteLength, type: MIME[ext] };
}

/* ---------------- the old WordPress site ---------------- */

/** A public https address that is not this machine, the cloud's metadata service or a private network. */
const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^192\.0\.[02]\./, /^198\.1[89]\./, /^198\.51\.100\./, /^203\.0\.113\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];
/** the IPv4 address an IPv6 one carries (mapped ::ffff:, NAT64 64:ff9b::, 6to4 2002:), in dotted or hex form */
function embeddedV4(/** @type {string} */ x) {
  const m = /^(?:::ffff:(?:0:)?|64:ff9b::|::)(.+)$/.exec(x) || null;
  const tail = m ? m[1] : /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/.exec(x) ? x.split(':').slice(1, 3).join(':') : null;
  if (!tail) return null;
  if (isIP(tail) === 4) return tail;
  const h = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!h) return null;
  const a = parseInt(h[1], 16), b = parseInt(h[2], 16);
  return [a >> 8, a & 255, b >> 8, b & 255].join('.');
}
export function privateIp(/** @type {string} */ ip) {
  if (isIP(ip) === 4) return PRIVATE_V4.some((r) => r.test(ip));
  const x = ip.toLowerCase();
  const v4 = embeddedV4(x);
  if (v4) return PRIVATE_V4.some((r) => r.test(v4));
  // unspecified, loopback, unique local, link-local, multicast, documentation, and anything not global unicast
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || /^2001:db8:/.test(x) || !/^[23]/.test(x);
}
async function checkHost(rt, /** @type {URL} */ u) {
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new HttpError(400, 'invalid', 'Une adresse https:// publique est attendue.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || /^(localhost|.*\.(local|localhost|internal|lan))$/i.test(host) || !host.includes('.')) throw new HttpError(400, 'invalid', 'Une adresse https:// publique est attendue.');
  const resolve = rt.resolveHost || (async (/** @type {string} */ h) => (await lookup(h, { all: true })).map((a) => a.address));
  let ips = [];
  try { ips = await resolve(host); } catch { throw new HttpError(502, 'unreachable', 'L’ancien site ne répond pas (' + host + ').'); }
  if (!ips.length || ips.some(privateIp)) throw new HttpError(400, 'invalid', 'Une adresse https:// publique est attendue.');
}
/** a response not read: its body is let go at once, so the connection does not stay open */
const drop = (/** @type {Response} */ res) => { try { res.body?.cancel().catch(() => {}); } catch { /* already used */ } };
/**
 * fetch with a deadline, following at most 3 redirects, each one checked like the first address (and by `allow`).
 * The address is resolved twice (here, then by fetch): a DNS answer that changes in between is the gap left; the
 * route is the owner's and the managers' alone, and runs on Vercel where the private ranges hold nothing of the salon's.
 * @param {any} rt @param {string} url @param {number} ms @param {(u: URL) => boolean} [allow]
 */
async function safeFetch(rt, url, ms, allow) {
  const f = rt.fetch || fetch;
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (allow && !allow(u)) throw new HttpError(400, 'invalid', 'Cette photo est hébergée ailleurs que sur l’ancien site.');
    await checkHost(rt, u);
    const res = await f(u.href, { redirect: 'manual', signal: AbortSignal.timeout(ms), headers: { accept: '*/*', 'user-agent': 'LArchitecte-Comptoir/1 (reprise du site)' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { drop(res); u = new URL(/** @type {string} */ (res.headers.get('location')), u); continue; }
    return res;
  }
  throw new HttpError(502, 'unreachable', 'L’ancien site redirige trop de fois.');
}
/** A stream read whole up to `max` bytes; null past it (it stops reading there: nothing larger sits in memory). */
export async function readCapped(/** @type {ReadableStream<Uint8Array>|null|undefined} */ body, /** @type {number} */ max) {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}
async function bodyUpTo(/** @type {Response} */ res, max) {
  if (Number(res.headers.get('content-length') || 0) > max) { drop(res); return null; }
  return readCapped(res.body, max);
}
const text = (/** @type {any} */ html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#\d+;|&\w+;/g, '').replace(/\s+/g, ' ').trim();
/** the old site's own host, or its CDN: an image list never sends the server elsewhere */
const sameSite = (/** @type {URL} */ a, /** @type {URL} */ b) => { const root = (h) => h.split('.').slice(-2).join('.'); return root(a.hostname) === root(b.hostname) || /(^|\.)wp\.com$/.test(b.hostname); };
/** the largest version up to 1600 px wide, as the Comptoir would have resized it; the original otherwise */
function bestSize(/** @type {any} */ m) {
  const sizes = Object.values((m.media_details && m.media_details.sizes) || {}).filter((x) => x && x.source_url && x.width);
  const fit = sizes.filter((x) => x.width <= 1600).sort((a, b) => b.width - a.width)[0];
  const w = m.media_details && m.media_details.width;
  return fit && (!w || w > 1600) ? { url: fit.source_url, width: fit.width, height: fit.height } : { url: m.source_url, width: w || null, height: (m.media_details && m.media_details.height) || null };
}

const wpSchema = obj({ base: str({ min: 8, max: 200 }), skip: opt(arr(int({ min: 1, max: 999999999 }), { max: 500 })) });

/** Copy the old site's images (up to 100, the WordPress API's page) into the salon's storage, within the request's time. */
async function wordpressMedia(rt, input) {
  // a function has 30 s: every fetch ends by `end`, no copy starts in the last 4 s, the Comptoir asks again for the rest
  const end = Date.now() + 22000;
  const left = (/** @type {number} */ cap) => Math.max(1000, Math.min(cap, end - Date.now()));
  const x = parse(wpSchema, input);
  let base;
  try { base = new URL(/^https?:\/\//i.test(x.base) ? x.base : 'https://' + x.base); } catch { throw new HttpError(400, 'invalid', 'Adresse invalide.'); }
  if (base.protocol === 'http:') base.protocol = 'https:';
  const root = base.origin + base.pathname.replace(/\/+$/, '');
  const res = await safeFetch(rt, root + '/wp-json/wp/v2/media?per_page=100&media_type=image', left(12000)).catch((e) => { if (e instanceof HttpError) throw e; throw new HttpError(502, 'unreachable', 'L’ancien site ne répond pas : vérifie l’adresse (avant la bascule du domaine, ou ancien.barberlarchitecte.com).'); });
  if (!res.ok) { drop(res); throw new HttpError(502, 'unreachable', 'L’ancien site répond ' + res.status + ' : sa médiathèque n’est pas accessible à cette adresse.'); }
  const raw = await bodyUpTo(res, 4 * 1024 * 1024);
  /** @type {any[]} */
  let list;
  try { list = JSON.parse(new TextDecoder().decode(raw || new Uint8Array())); } catch { list = /** @type {any} */ (null); }
  if (!Array.isArray(list)) throw new HttpError(502, 'unreachable', 'Ce n’est pas un site WordPress (pas de médiathèque à cette adresse).');
  const skip = new Set(x.skip || []);
  const todo = list.filter((m) => m && typeof m.id === 'number' && /^image\/(jpeg|png|webp)$/.test(m.mime_type || '') && m.source_url && !skip.has(m.id));
  const items = [];
  let failed = 0;
  let i = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() < end - 4000) {
      const m = todo[i++];
      try {
        const best = bestSize(m);
        const u = new URL(best.url, root + '/');
        if (!sameSite(base, u)) { failed++; continue; }
        // a redirect may not send the copy elsewhere either
        const r = await safeFetch(rt, u.href, left(8000), (h) => sameSite(base, h));
        if (!r.ok) drop(r);
        const b = r.ok ? await bodyUpTo(r, MAX_PHOTO) : null;
        const ext = b ? sniff(b) : null;
        if (!b || !ext) { failed++; continue; }
        const saved = await store(rt, b, ext);
        items.push({ wp: m.id, url: saved.url, alt: text(m.alt_text).slice(0, 160), caption: text(m.caption && m.caption.rendered).slice(0, 60), title: text(m.title && m.title.rendered).slice(0, 60), width: best.width, height: best.height, size: saved.size });
      } catch (e) { if (e instanceof HttpError && e.code === 'no_storage') throw e; failed++; }
    }
  };
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));
  return { items, total: list.length, failed, left: todo.length - i };
}

export function uploadRoutes(app) {
  /* the content */
  app.get('/api/v1/site', (r) => {
    const s = r.s;
    const services = [...s.services.values()].filter((x) => x.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView);
    return { site: siteOf(s.settings), defaults: siteOf({ shop: s.settings.shop }), tokens: TOKENS, tokenPattern: TOKEN_SOURCE, tokenLike: TOKEN_LIKE_SOURCE, limits: LIMITS, services, hours: s.settings.hours, shop: { address: s.settings.shop.address, zip: s.settings.shop.zip, city: s.settings.shop.city }, hoursText: hoursText(s.settings.hours), closedText: closedText(s.settings.hours) };
  }, { cap: 'catalog' });
  app.patch('/api/v1/site', (r) => r.run(updateSite, r.body), { cap: 'catalog' });

  /* a photo: the raw image in the body, its type in content-type */
  app.post('/api/v1/uploads', async (r) => {
    guard('upload|' + r.me.id, 60, 3600000, 'Beaucoup de photos d’un coup : patiente un peu.');
    const ct = String(r.req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const want = Object.hasOwn(TYPES, ct) ? TYPES[/** @type {keyof typeof TYPES} */ (ct)] : null;
    const got = r.bytes ? sniff(r.bytes) : null;
    if (!want || !got) throw new HttpError(415, 'type', 'Une photo JPEG, PNG ou WebP est attendue.');
    if (want !== got) throw new HttpError(415, 'type', 'Le fichier n’est pas ce qu’il annonce (' + ct + ').');
    return json(await store(r.rt, /** @type {Uint8Array} */ (r.bytes), got), 201);
  }, { cap: 'catalog', bytes: MAX_PHOTO });

  app.post('/api/v1/uploads/wordpress', async (r) => {
    guard('wpmedia|' + r.me.id, 20, 3600000, 'Patiente un peu avant de relancer la récupération.');
    return wordpressMedia(r.rt, r.body);
  }, { cap: 'catalog' });

  /* what the site and the Comptoir show: a file never changes under its name, so browsers and Vercel's CDN keep it a year.
     Indexable, unlike the rest of /api (the function's header wins over vercel.json's): they are the site's photos. */
  app.get('/api/public/media/:name', async (r) => {
    const name = r.params.name;
    const media = NAME.test(name) ? await mediaOf(r.rt) : null;
    const f = media ? await media.getPublic(name) : null;
    if (!f) throw new HttpError(404, 'not_found', 'Photo introuvable.');
    return new Response(f.stream, { status: 200, headers: {
      'content-type': MIME[/** @type {'jpg'} */ (name.split('.').pop())], 'cache-control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'x-robots-tag': 'all',
      'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin',
      ...(f.size != null ? { 'content-length': String(f.size) } : {})
    } });
  });
}

