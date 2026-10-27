// Going live on the domain without code edits: vercel.json stays deployable, and the build's indexing switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { CASES } from '../../shared/redirects.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

// the top-level keys of https://openapi.vercel.sh/vercel.json this project may use
const KEYS = new Set(['$schema', 'framework', 'installCommand', 'buildCommand', 'outputDirectory', 'cleanUrls', 'trailingSlash', 'regions', 'functions', 'redirects', 'rewrites', 'headers', 'crons']);
const COND = new Set(['query', 'header', 'cookie', 'host']);

test('vercel.json only uses keys and rule shapes Vercel accepts', () => {
  for (const k of Object.keys(cfg)) assert.ok(KEYS.has(k), 'unknown key ' + k);
  assert.equal(cfg.trailingSlash, false);
  assert.equal(cfg.cleanUrls, true);
  const conds = (r) => [...(r.has || []), ...(r.missing || [])];
  for (const r of [...cfg.redirects, ...cfg.rewrites, ...cfg.headers]) {
    assert.equal(typeof r.source, 'string');
    assert.ok(r.source.startsWith('/') && r.source.length <= 4096, r.source);
    for (const c of conds(r)) {
      assert.ok(COND.has(c.type), r.source + ': has type ' + c.type);
      assert.ok(c.type === 'host' ? typeof c.value === 'string' : typeof c.key === 'string', r.source + ': condition without key');
    }
  }
  for (const r of cfg.redirects) {
    assert.deepEqual(Object.keys(r).filter((k) => !['source', 'destination', 'permanent', 'statusCode', 'has', 'missing'].includes(k)), [], r.source);
    assert.equal(typeof r.destination, 'string');
    assert.ok(typeof r.permanent === 'boolean' || [301, 302, 303, 307, 308].includes(r.statusCode), r.source + ': permanent or statusCode');
    // trailingSlash:false strips the slash before any redirect runs, so a source ending with one never matches
    assert.ok(r.source === '/' || !r.source.endsWith('/'), r.source + ' ends with a slash');
  }
  for (const r of cfg.rewrites) assert.equal(typeof r.destination, 'string');
  for (const r of cfg.headers) for (const x of r.headers) assert.ok(typeof x.key === 'string' && typeof x.value === 'string');
  // sources are unique (a duplicate would silently never run)
  const ids = cfg.redirects.map((r) => r.source + JSON.stringify(r.has || []));
  assert.equal(new Set(ids).size, ids.length);
});

test('/ is the site, the demo page is at /demo, and only private areas carry noindex', () => {
  assert.deepEqual(cfg.rewrites[0], { source: '/', destination: '/site' });
  // with cleanUrls Vercel serves x.html only at /x: a rewrite to a '.html' destination is a 404 there
  for (const r of cfg.rewrites) assert.doesNotMatch(r.destination, /\.html(\?|$)/, r.source + ' → ' + r.destination);
  assert.ok(!existsSync(join(ROOT, 'public', 'index.html')), 'public/index.html would shadow the site at /');
  for (const f of ['site.html', 'demo.html', 'ancien-lien.html', '404.html', 'sitemap.xml']) assert.ok(existsSync(join(ROOT, 'public', f)), f);
  const robots = cfg.headers.filter((r) => r.headers.some((x) => x.key === 'X-Robots-Tag'));
  // whole first segment only: /robots.txt, /rdv or a future /realisations stay indexable
  const areas = '(comptoir|r|recu|paiement|cadeau|abo|client|api|demo|ancien-lien|avis)';
  assert.deepEqual(robots.map((r) => r.source), ['/' + areas, '/' + areas + '/(.*)']);
});

test('old e-mail links go to /ancien-lien and the old booking page id cannot loop', () => {
  for (const key of ['sln-api', 'sln_customer_login', 'sln_reschedule_booking', 'sln_booking_id', 'sln_step_page']) {
    const r = cfg.redirects.find((x) => x.source === '/' && x.has && x.has[0].key === key);
    assert.ok(r, key);
    assert.equal(r.destination, '/ancien-lien');
    assert.equal(r.permanent, false);
  }
  // Vercel passes the query on: /?page_id=2 → /?reserver&page_id=2 must not match again
  const p = cfg.redirects.find((x) => x.has && x.has[0].key === 'page_id');
  assert.equal(p.destination, '/?reserver');
  assert.ok(p.missing.some((m) => m.key === 'reserver'));
});

/** Runs the real postbuild script on a copy of the public pages. */
function build(env, pages = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lx-postbuild-'));
  for (const f of ['site.html', 'demo.html', '404.html', 'ancien-lien.html', 'robots.txt', 'sitemap.xml']) copyFileSync(join(ROOT, 'public', f), join(dir, f));
  for (const [f, html] of Object.entries(pages)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), html); }
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'postbuild.mjs'), '--dir', dir], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const read = (f) => readFileSync(join(dir, f), 'utf8');
  const res = { out, site: read('site.html'), robots: read('robots.txt'), demo: read('demo.html'), lost: read('404.html'), sitemap: read('sitemap.xml') };
  rmSync(dir, { recursive: true, force: true });
  return res;
}
const robotsMeta = /<meta\s+name="robots"/i;

test('without LX_INDEX the build stays hidden from search engines', () => {
  const b = build({});
  assert.match(b.site, robotsMeta);
  assert.equal((b.site.match(/<meta\s+name="robots"/gi) || []).length, 1);
  assert.equal(b.robots, 'User-agent: *\nDisallow: /\n');
  assert.match(b.site, /<link rel="canonical" href="https:\/\/barberlarchitecte\.com\/">\n<\/head>/);
});

test('LX_INDEX=1 opens the public site and keeps the private areas out', () => {
  const b = build({ LX_INDEX: '1' });
  assert.doesNotMatch(b.site, robotsMeta);
  assert.equal(b.robots, 'User-agent: *\nAllow: /api/public/salon\nAllow: /api/public/live\nDisallow: /comptoir\nDisallow: /r/\nDisallow: /recu/\nDisallow: /paiement/\nDisallow: /abo/\nDisallow: /api/\nDisallow: /demo\nSitemap: https://barberlarchitecte.com/sitemap.xml\n');
  // the demo page, the old-link page and the 404 are never indexed
  assert.match(b.demo, robotsMeta);
  assert.match(b.lost, robotsMeta);
  assert.match(b.out, /indexing ON/);
});

test('PUBLIC_URL sets the canonical and sitemap address', () => {
  const b = build({ LX_INDEX: '1', PUBLIC_URL: 'https://www.barberlarchitecte.fr/' }, { 'formations.html': '<!doctype html><title>Formations</title>' });
  assert.match(b.site, /<link rel="canonical" href="https:\/\/www\.barberlarchitecte\.fr\/">/);
  assert.equal((b.site.match(/rel="canonical"/g) || []).length, 1);
  assert.match(b.robots, /Sitemap: https:\/\/www\.barberlarchitecte\.fr\/sitemap\.xml/);
  assert.match(b.sitemap, /<loc>https:\/\/www\.barberlarchitecte\.fr\/formations<\/loc>/);
  assert.doesNotMatch(b.sitemap, /barberlarchitecte\.com/);
  // not a URL → the default address
  assert.match(build({ PUBLIC_URL: 'javascript:alert(1)' }).site, /href="https:\/\/barberlarchitecte\.com\/"/);
});

test('the postbuild helpers are idempotent', async () => {
  const { applyRobots, applyCanonical } = await import('../../scripts/postbuild.mjs');
  const html = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>x</title>\n</head>\n</html>';
  const once = applyCanonical(applyRobots(html, false), 'https://a.fr/');
  assert.equal(applyCanonical(applyRobots(once, false), 'https://a.fr/'), once);
  assert.equal(applyRobots(once, true), applyCanonical(html, 'https://a.fr/'));
});

test('the sitemap lists the public pages', () => {
  const xml = readFileSync(join(ROOT, 'public', 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://barberlarchitecte.com', ''));
  assert.deepEqual(locs, ['/', '/formations', '/contact', '/carte-cadeau', '/mentions-legales', '/confidentialite', '/cgv']);
});

test('the built sitemap only lists pages the build has', () => {
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://barberlarchitecte.com', ''));
  assert.deepEqual(locs(build({}).sitemap), ['/']);
  const b = build({ LX_INDEX: '1' }, { 'formations.html': '<!doctype html><title>F</title>', 'cgv/index.html': '<!doctype html><title>CGV</title>' });
  assert.deepEqual(locs(b.sitemap), ['/', '/formations', '/cgv']);
  assert.match(b.sitemap, /^<\?xml[\s\S]*<urlset[^>]*>\n  <url><loc>https:\/\/barberlarchitecte\.com\/<\/loc>[\s\S]*<\/urlset>\n?$/);
});

/* ---- WP-10 · every address the old site listed lands somewhere ---- */

/** A vercel.json `source` as a regular expression, with the semantics scripts/dev.mjs gives it (and path-to-regexp on Vercel):
 *  `:name` one segment, `:name*` the rest (the bare prefix too), `(a|b)` a group, `:rest*` right after a literal is the rest of the segment. */
function sourceRe(source) {
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ':') {
      const m = /^:([A-Za-z_]\w*)(\*)?/.exec(source.slice(i));
      if (m[2] && re.endsWith('/')) re = re.slice(0, -1) + '(?:/.*)?'; else re += m[2] ? '.*' : '[^/]+';
      i += m[0].length - 1;
    } else if (ch === '(') { const end = source.indexOf(')', i); re += source.slice(i, end + 1); i = end; }
    else re += ch.replace(/[.+?^${}|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
/** The first redirect that takes this path (query conditions ignored: the paths here carry none). */
const ruleOf = (path) => cfg.redirects.find((r) => !r.has && sourceRe(r.source).test(path));
const destOf = (path) => { const r = ruleOf(path); return r && { status: r.permanent ? 308 : 307, to: r.destination }; };

test('the sub-sitemaps and the stylesheet the live index lists, and the WordPress archives, are redirected', () => {
  for (const p of ['/wp-sitemap-posts-page-1.xml', '/wp-sitemap-index.xsl', '/wp-sitemap.xsl', '/wp-sitemap-taxonomies-category-1.xml']) assert.deepEqual(destOf(p), { status: 308, to: '/sitemap.xml' }, p);
  for (const p of ['/author/admin', '/author/admin/page/2', '/tag/redken', '/tag/redken/feed', '/page/2', '/page/2/feed', '/brews-redken/feed']) assert.deepEqual(destOf(p), { status: 308, to: '/' }, p);
  // the old rules still answer first, and nothing the app serves is taken by a new one
  assert.equal(destOf('/wp-sitemap.xml').to, '/sitemap.xml');
  assert.equal(destOf('/comments/feed').to, '/');
  for (const p of ['/', '/sitemap.xml', '/comptoir/caisse', '/comptoir/reglages/wordpress', '/r/abc.def', '/recu/abc.def', '/paiement/abc', '/api/v1/feed', '/api/public/salon', '/mon-rendez-vous',
    '/formations', '/carte-cadeau', '/page', '/pages', '/authors', '/tags', '/wp-sitemaps', '/assets/index.js']) assert.equal(ruleOf(p), undefined, p + ' must not be redirected');
});

test('every <loc> of the old site’s sitemaps (index and sub-sitemaps) lands somewhere, none on a 404', () => {
  const dir = join(ROOT, 'tests', 'fixtures', 'wp-sitemaps');
  const files = readdirSync(dir).filter((f) => f.endsWith('.xml'));
  assert.ok(files.length >= 7, 'the index and the six sub-sitemaps');
  const cases = new Set(CASES.map((c) => c[0]));
  let n = 0;
  for (const f of files) {
    for (const [, loc] of readFileSync(join(dir, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
      n++;
      const u = new URL(loc);
      // WordPress ends its addresses with a slash, which Vercel strips before any rule runs
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
      const page = path === '/' || existsSync(join(ROOT, 'public', path.slice(1) + '.html'));
      assert.ok(page || cases.has(path) || ruleOf(path), f + ': ' + loc + ' lands nowhere');
    }
  }
  assert.ok(n >= 53, 'the 47 addresses and the sub-sitemaps of the index: ' + n);
});

test('every case of shared/redirects.js names a rule of vercel.json and the status that rule gives', () => {
  const byRule = new Map(cfg.redirects.map((r) => [r.source + (r.has ? '?' + r.has[0].key : ''), r]));
  const used = new Set();
  for (const [from, status, , id] of CASES) {
    if (id === 'trailing') continue;
    const r = id === 'posts' ? cfg.redirects.find((x) => x.source.startsWith('/(message-exceptionnel|')) : byRule.get(id);
    assert.ok(r, from + ': no rule ' + id);
    assert.equal(r.permanent ? 308 : 307, status, from);
    used.add(r);
  }
  assert.equal(used.size, cfg.redirects.length, 'a rule without a case would never be tried on the live domain');
});

test('scripts/check-old-urls.mjs lists the old site’s addresses from its sitemaps, and flags an address that ends on a 404', async () => {
  const { listOldUrls, follow, locs, pathOf } = await import('../../scripts/check-old-urls.mjs');
  const dir = join(ROOT, 'tests', 'fixtures', 'wp-sitemaps');
  const seen = [];
  const old = async (url) => {
    seen.push(String(url));
    const p = new URL(url).pathname;
    const f = p === '/wp-sitemap.xml' ? 'wp-sitemap.xml' : /^\/wp-sitemap-(.+)\.xml$/.test(p) ? 'sm_' + p.slice('/wp-sitemap-'.length, -4) + '.xml' : '';
    return f && existsSync(join(dir, f)) ? new Response(readFileSync(join(dir, f), 'utf8'), { status: 200 }) : new Response('', { status: 404 });
  };
  // the old site as a bare address: its sitemap is found, the sub-sitemaps read from that same site, the REST API tried and closed
  const { paths, notes } = await listOldUrls('https://ancien.barberlarchitecte.com', old);
  assert.equal(seen[0], 'https://ancien.barberlarchitecte.com/wp-sitemap.xml');
  assert.ok(seen.includes('https://ancien.barberlarchitecte.com/wp-sitemap-posts-page-1.xml'), 'the index is followed on the site given, not on the address it writes');
  assert.equal(paths.length, 47, 'the 47 addresses of the six sub-sitemaps');
  assert.ok(paths.includes('/brews-redken/') && paths.includes('/sln_attendant/jkut/') && paths.includes('/'));
  assert.deepEqual(notes, [], 'nothing was missing');
  assert.deepEqual(locs('<a><loc>https://x.fr/a?b=1&amp;c=2</loc></a>'), ['https://x.fr/a?b=1&c=2']);
  assert.equal(pathOf('https://x.fr/a/?b=1'), '/a/?b=1');

  const origin = 'https://neuf.fr';
  const site = (script) => async (url) => {
    const r = script[String(url).slice(origin.length)];
    if (r instanceof Error) throw r;
    return r ? new Response(null, { status: r[0], headers: r[1] ? { location: r[1] } : {} }) : new Response('', { status: 404 });
  };
  const get = site({ '/ok': [200], '/a/': [308, '/a'], '/a': [308, '/?reserver'], '/?reserver': [200], '/x': [308, '/y'], '/y': [308, '/z'], '/z': [308, '/w'], '/w': [200],
    '/ext': [308, 'https://www.instagram.com/x'], '/err': [500], '/boom': new Error('ECONNRESET') });
  assert.deepEqual((await follow(origin, '/ok', get)).problem, '');
  const chain = await follow(origin, '/a/', get);
  assert.deepEqual([chain.problem, chain.status, chain.hops.length], ['', 200, 2], 'two hops are allowed');
  assert.match((await follow(origin, '/x', get)).problem, /plus de 2 redirections/);
  assert.equal((await follow(origin, '/ext', get)).problem, '', 'another site is the end of what can be checked');
  assert.equal((await follow(origin, '/nope', get)).problem, 'HTTP 404');
  assert.equal((await follow(origin, '/err', get)).problem, 'HTTP 500');
  assert.match((await follow(origin, '/boom', get)).problem, /ECONNRESET/);
});
