// Local server that behaves like the Vercel deployment: it reads vercel.json (redirects and their has/missing
// conditions, headers, clean URLs, trailing slash, rewrites), serves 404.html for unknown pages and runs the same
// API handler. Used for development and end-to-end tests.
//
//   npm run dev               API + static files from public/ (pair with `npm run dev:web` for the app)
//   npm start                 the built site from dist/ (run `npm run build` first)
//   options: --port 3000 --memory (no file persistence) --dist, or --static <dir> (any build output)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { FONTS, fontSource } from './postbuild.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(opt('port', process.env.PORT || 3000));
const STATIC = opt('static', null) ? resolve(opt('static')) : join(ROOT, flag('dist') ? 'dist' : 'public');
if (!flag('memory') && !process.env.LX_DATA_FILE && !process.env.DATABASE_URL && !process.env.BLOB_READ_WRITE_TOKEN) process.env.LX_DATA_FILE = join(ROOT, '.lx-data', 'journal.jsonl');
if (!process.env.PUBLIC_URL) process.env.PUBLIC_URL = 'http://localhost:' + PORT;

const { handle } = await import('../server/http/app.js');
const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

function toRegex(source) {
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ':') {
      const m = /^:([A-Za-z_]\w*)(\*)?/.exec(source.slice(i));
      // '/:path*' also matches the bare prefix, as path-to-regexp does on Vercel ('/wp-admin' and '/wp-admin/x')
      if (m[2] && re.endsWith('/')) re = re.slice(0, -1) + '(?:/(?<' + m[1] + '>.*))?';
      else re += m[2] ? '(?<' + m[1] + '>.*)' : '(?<' + m[1] + '>[^/]+)';
      i += m[0].length - 1;
    } else if (ch === '(') {
      const end = source.indexOf(')', i);
      re += source.slice(i, end + 1);
      i = end;
    } else re += ch.replace(/[.+?^${}|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function substitute(dest, m) {
  let out = dest;
  for (const [k, v] of Object.entries(m.groups || {})) out = out.replaceAll(':' + k + '*', v ?? '').replaceAll(':' + k, v ?? '');
  m.slice(1).forEach((v, i) => { out = out.replaceAll('$' + (i + 1), v ?? ''); });
  return out;
}
const rules = (list) => (list || []).map((r) => ({ ...r, re: toRegex(r.source) }));
const cookieOf = (req, k) => { for (const c of String(req.headers.cookie || '').split(';')) { const i = c.indexOf('='); if (i > 0 && c.slice(0, i).trim() === k) return decodeURIComponent(c.slice(i + 1).trim()); } return null; };
/** One `has`/`missing` condition: its named groups when it holds, null otherwise (value is a regex, as on Vercel). */
function condition(c, req, url) {
  const v = c.type === 'query' ? url.searchParams.get(c.key) : c.type === 'header' ? req.headers[String(c.key).toLowerCase()] : c.type === 'cookie' ? cookieOf(req, c.key) : c.type === 'host' ? url.hostname : null;
  if (v == null) return null;
  if (c.value == null) return {};
  const m = new RegExp('^(?:' + c.value + ')$').exec(String(v));
  return m ? { ...m.groups } : null;
}
/** The rule's match (path groups plus `has` groups), or null. */
function match(r, req, url) {
  const m = r.re.exec(url.pathname);
  if (!m) return null;
  for (const c of r.has || []) { const g = condition(c, req, url); if (!g) return null; m.groups = { ...m.groups, ...g }; }
  for (const c of r.missing || []) if (condition(c, req, url)) return null;
  return m;
}
/** Vercel passes the request's query on to a redirect's destination (keys the destination sets win). */
function withQuery(dest, url) {
  const h = dest.indexOf('#'), hash = h >= 0 ? dest.slice(h) : '', base = h >= 0 ? dest.slice(0, h) : dest;
  const q = base.indexOf('?'), own = new URLSearchParams(q >= 0 ? base.slice(q + 1) : '');
  const key = (kv) => { try { return decodeURIComponent(kv.split('=')[0].replace(/\+/g, ' ')); } catch { return kv; } };
  const extra = url.search.slice(1).split('&').filter((kv) => kv && !own.has(key(kv)));
  return extra.length ? base + (q >= 0 ? '&' : '?') + extra.join('&') + hash : dest;
}
const redirects = rules(cfg.redirects), rewrites = rules(cfg.rewrites), headerRules = rules(cfg.headers);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function findFile(pathname) {
  const p = decodeURIComponent(pathname);
  if (p.includes('..')) return null;
  // the site's fonts: dist/ has them from postbuild, public/ takes them from node_modules
  const font = p.startsWith('/fonts/') && !existsSync(join(STATIC, p)) ? FONTS.find(([, f]) => '/fonts/' + f === p) : null;
  if (font) return fontSource(font[0], font[1]);
  const tries = [p, cfg.cleanUrls ? p + '.html' : null, join(p, 'index.html')].filter(Boolean);
  for (const t of tries) { const f = join(STATIC, t); if (f.startsWith(STATIC) && existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

async function serveApi(req, res, url, extraHeaders) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  headers.set('x-real-ip', req.socket.remoteAddress || 'local');
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req);
  const request = new Request(url, { method: req.method, headers, body, duplex: 'half' });
  const response = await handle(request);
  const out = { ...extraHeaders };
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost:' + PORT));
    // Vercel order: trailing slash and .html first, then vercel.json redirects, then files, then rewrites
    const clean = url.pathname.length > 1 && cfg.trailingSlash === false && url.pathname.endsWith('/') ? url.pathname.replace(/\/+$/, '') || '/'
      : cfg.cleanUrls && /\.html$/.test(url.pathname) ? url.pathname.replace(/(\/index)?\.html$/, '') || '/' : null;
    if (clean) { res.writeHead(308, { location: clean + url.search }); return res.end(); }
    for (const r of redirects) { const m = match(r, req, url); if (m) { res.writeHead(r.statusCode || (r.permanent ? 308 : 307), { location: withQuery(substitute(r.destination, m), url) }); return res.end(); } }
    const extra = {};
    for (const r of headerRules) if (match(r, req, url)) for (const h of r.headers) extra[h.key.toLowerCase()] = h.value;
    let file = url.pathname.startsWith('/api/') ? null : findFile(url.pathname);
    if (!file) {
      for (const r of rewrites) {
        const m = match(r, req, url);
        if (!m) continue;
        const dest = new URL(substitute(r.destination, m), url);
        for (const [k, v] of url.searchParams) if (!dest.searchParams.has(k)) dest.searchParams.set(k, v);
        if (dest.pathname.startsWith('/api/')) return await serveApi(req, res, dest, extra);
        // with cleanUrls Vercel serves site.html only at /site, so a rewrite to '/site.html' is a 404 there: same here
        file = cfg.cleanUrls && /\.html$/.test(dest.pathname) ? null : findFile(dest.pathname);
        break;
      }
    }
    if (!file) {
      const page = join(STATIC, '404.html');
      if (existsSync(page)) { res.writeHead(404, { 'content-type': TYPES['.html'], ...extra }); return res.end(readFileSync(page)); }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...extra }); return res.end('Introuvable');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...extra });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Erreur');
  }
});
const storeLabel = process.env.DATABASE_URL ? 'postgres' : process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : process.env.LX_DATA_FILE ? 'file ' + process.env.LX_DATA_FILE.replace(ROOT + '/', '') : 'memory';
server.listen(PORT, () => console.log(`L’Architecte · http://localhost:${PORT}  (static: ${STATIC.startsWith(ROOT) ? STATIC.replace(ROOT + '/', '') : STATIC}, data: ${storeLabel})`));
