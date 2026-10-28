// Runs after `vite build` on dist/: the one switch between "hidden from search engines" and "indexed",
// plus the canonical address, so going live on the domain needs an environment variable and no code edit.
//
//   npm run build               nothing is indexed: every public page keeps (or gets) a robots noindex meta, robots.txt disallows all
//   LX_INDEX=1 npm run build    the public pages are indexable; robots.txt keeps the Comptoir, client links and the API out
//   PUBLIC_URL=https://…        the canonical and sitemap address (default https://barberlarchitecte.com)
//
// It also copies the site's fonts (Instrument Sans and Serif, from @fontsource) into <dir>/fonts: site.html loads them
// from the salon's own domain, so no visitor's address reaches Google Fonts.
//
// Options: --dir <build output> (default dist). Also importable: postbuild({ dir, env }).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const DEFAULT_URL = 'https://barberlarchitecte.com';
// pages that must never be indexed, whatever the switch says (they carry their own robots meta)
const PRIVATE = new Set(['demo.html', 'ancien-lien.html', '404.html']);
const ROBOTS_META = /[ \t]*<meta\s+name=["']robots["'][^>]*>[ \t]*\r?\n?/gi;
const CANONICAL = /[ \t]*<link\s+rel=["']canonical["'][^>]*>[ \t]*\r?\n?/gi;
const OPEN_PATHS = ['/comptoir', '/r/', '/recu/', '/paiement/', '/abo/', '/api/', '/demo', '/moi'];
// the site renders its catalogue, prices and barbers from these: a crawler that cannot fetch them indexes the fallback
// (the memberships' answer: the « Abonnement & carnet » block and its FAQ answer; $ so no member's own link is ever allowed)
const API_READS = ['/api/public/salon', '/api/public/live', '/api/public/memberships$'];

/** The faces site.html declares (@font-face src: /fonts/<file>), Latin only like the Comptoir's. */
export const FONTS = [
  ['instrument-sans', 'instrument-sans-latin-400-normal.woff2'], ['instrument-sans', 'instrument-sans-latin-500-normal.woff2'],
  ['instrument-sans', 'instrument-sans-latin-600-normal.woff2'], ['instrument-sans', 'instrument-sans-latin-700-normal.woff2'],
  ['instrument-serif', 'instrument-serif-latin-400-normal.woff2'], ['instrument-serif', 'instrument-serif-latin-400-italic.woff2']
];
/** Where a font file sits in node_modules. */
export function fontSource(pkg, file) {
  return join(dirname(createRequire(import.meta.url).resolve('@fontsource/' + pkg + '/package.json')), 'files', file);
}
/** @param {string} dir */
export function copyFonts(dir) {
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  for (const [pkg, file] of FONTS) copyFileSync(fontSource(pkg, file), join(dir, 'fonts', file));
  return FONTS.length;
}

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The public address, without a trailing slash: PUBLIC_URL when it is an http(s) URL. */
export function siteUrl(env = process.env) {
  const u = String(env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/i.test(u) ? u : DEFAULT_URL;
}

/** @param {string} html @param {boolean} index */
export function applyRobots(html, index) {
  const clean = html.replace(ROBOTS_META, '');
  if (index) return clean;
  const tag = '<meta name="robots" content="noindex, nofollow">\n';
  const m = /<meta\s+charset=[^>]*>[ \t]*\r?\n?/i.exec(clean) || /<head[^>]*>[ \t]*\r?\n?/i.exec(clean);
  return m ? clean.slice(0, m.index + m[0].length) + (m[0].endsWith('\n') ? '' : '\n') + tag + clean.slice(m.index + m[0].length) : tag + clean;
}

/** @param {string} html @param {string} href */
export function applyCanonical(html, href) {
  const clean = html.replace(CANONICAL, '');
  const i = clean.search(/<\/head>/i);
  const tag = '<link rel="canonical" href="' + attr(href) + '">\n';
  return i < 0 ? clean : clean.slice(0, i) + tag + clean.slice(i);
}

/** @param {boolean} index @param {string} base */
export function robotsTxt(index, base) {
  if (!index) return 'User-agent: *\nDisallow: /\n';
  return 'User-agent: *\n' + API_READS.map((p) => 'Allow: ' + p + '\n').join('') + OPEN_PATHS.map((p) => 'Disallow: ' + p + '\n').join('') + 'Sitemap: ' + base + '/sitemap.xml\n';
}

/**
 * The sitemap without the pages this build does not have yet (a later package adds /formations.html, …),
 * so search engines are never sent to a 404. A loc is kept when it is / or when <path>.html or <path>/index.html exists.
 * @param {string} xml @param {string} dir
 */
export function sitemap(xml, dir) {
  return xml.replace(/[ \t]*<url>[\s\S]*?<\/url>[ \t]*\r?\n?/g, (block) => {
    const m = /<loc>\s*https?:\/\/[^/<\s]+(\/[^<\s]*)?\s*<\/loc>/.exec(block);
    const path = decodeURIComponent((m && m[1]) || '/').replace(/\/+$/, '');
    if (!path) return block;
    if (path.includes('..')) return '';
    return existsSync(join(dir, path + '.html')) || existsSync(join(dir, path, 'index.html')) ? block : '';
  });
}

/** @param {{ dir?: string, env?: Record<string, string|undefined> }} [opt] */
export function postbuild(opt = {}) {
  const env = opt.env || process.env;
  const dir = resolve(opt.dir || 'dist');
  const index = env.LX_INDEX === '1';
  const base = siteUrl(env);
  if (!existsSync(join(dir, 'site.html'))) throw new Error('postbuild: ' + join(dir, 'site.html') + ' is missing (run vite build first)');
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html') && !PRIVATE.has(f));
  for (const f of pages) {
    const p = join(dir, f);
    let html = applyRobots(readFileSync(p, 'utf8'), index);
    if (f === 'site.html') html = applyCanonical(html, base + '/');
    writeFileSync(p, html);
  }
  writeFileSync(join(dir, 'robots.txt'), robotsTxt(index, base));
  const fonts = copyFonts(dir);
  const sm = join(dir, 'sitemap.xml');
  let listed = 0;
  if (existsSync(sm)) {
    const xml = sitemap(readFileSync(sm, 'utf8'), dir).replaceAll(DEFAULT_URL, base);
    listed = (xml.match(/<url>/g) || []).length;
    writeFileSync(sm, xml);
  }
  return { index, base, pages, listed, fonts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--dir');
  const root = resolve(new URL('..', import.meta.url).pathname);
  try {
    const r = postbuild({ dir: i > 0 ? process.argv[i + 1] : join(root, 'dist') });
    console.log('postbuild: ' + (r.index ? 'indexing ON (LX_INDEX=1)' : 'indexing off (set LX_INDEX=1 at go-live)') + ' · ' + r.pages.length + ' public page(s) · ' + r.listed + ' sitemap page(s) · ' + r.fonts + ' font(s) · canonical ' + r.base + '/');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
