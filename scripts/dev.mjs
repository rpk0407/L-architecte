// Local server that behaves like the Vercel deployment: it reads vercel.json (redirects, headers,
// clean URLs, rewrites) and runs the same API handler. Used for development and end-to-end tests.
//
//   npm run dev               API + static files from public/ (pair with `npm run dev:web` for the app)
//   npm start                 the built site from dist/ (run `npm run build` first)
//   options: --port 3000 --memory (no file persistence) --dist
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PORT = Number(opt('port', process.env.PORT || 3000));
const STATIC = join(ROOT, flag('dist') ? 'dist' : 'public');
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
      re += m[2] ? '(?<' + m[1] + '>.*)' : '(?<' + m[1] + '>[^/]+)';
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
const redirects = rules(cfg.redirects), rewrites = rules(cfg.rewrites), headerRules = rules(cfg.headers);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function findFile(pathname) {
  const p = decodeURIComponent(pathname);
  if (p.includes('..')) return null;
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
    for (const r of redirects) { const m = r.re.exec(url.pathname); if (m) { res.writeHead(r.permanent ? 308 : 307, { location: substitute(r.destination, m) }); return res.end(); } }
    const extra = {};
    for (const r of headerRules) if (r.re.test(url.pathname)) for (const h of r.headers) extra[h.key.toLowerCase()] = h.value;
    let file = url.pathname.startsWith('/api/') ? null : findFile(url.pathname);
    if (!file) {
      for (const r of rewrites) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const dest = new URL(substitute(r.destination, m), url);
        for (const [k, v] of url.searchParams) if (!dest.searchParams.has(k)) dest.searchParams.set(k, v);
        if (dest.pathname.startsWith('/api/')) return await serveApi(req, res, dest, extra);
        file = findFile(dest.pathname);
        break;
      }
    }
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...extra }); return res.end('Introuvable'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...extra });
    res.end(readFileSync(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Erreur');
  }
});
const storeLabel = process.env.DATABASE_URL ? 'postgres' : process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : process.env.LX_DATA_FILE ? 'file ' + process.env.LX_DATA_FILE.replace(ROOT + '/', '') : 'memory';
server.listen(PORT, () => console.log(`L’Architecte · http://localhost:${PORT}  (static: ${STATIC.replace(ROOT + '/', '')}, data: ${storeLabel})`));
