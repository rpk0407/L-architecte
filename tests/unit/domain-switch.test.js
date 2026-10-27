// Going live on the domain without code edits: vercel.json stays deployable, and the build's indexing switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync, existsSync } from 'node:fs';
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
  const areas = '(comptoir|r|recu|paiement|client|api|demo|ancien-lien)';
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
  assert.equal(b.robots, 'User-agent: *\nAllow: /api/public/salon\nAllow: /api/public/live\nAllow: /api/public/media/\nDisallow: /comptoir\nDisallow: /r/\nDisallow: /recu/\nDisallow: /paiement/\nDisallow: /api/\nDisallow: /demo\nSitemap: https://barberlarchitecte.com/sitemap.xml\n');
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
  assert.deepEqual(locs, ['/', '/formations', '/carte-cadeau', '/mentions-legales', '/confidentialite', '/cgv']);
});

test('the built sitemap only lists pages the build has', () => {
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://barberlarchitecte.com', ''));
  assert.deepEqual(locs(build({}).sitemap), ['/']);
  const b = build({ LX_INDEX: '1' }, { 'formations.html': '<!doctype html><title>F</title>', 'cgv/index.html': '<!doctype html><title>CGV</title>' });
  assert.deepEqual(locs(b.sitemap), ['/', '/formations', '/cgv']);
  assert.match(b.sitemap, /^<\?xml[\s\S]*<urlset[^>]*>\n  <url><loc>https:\/\/barberlarchitecte\.com\/<\/loc>[\s\S]*<\/urlset>\n?$/);
});
