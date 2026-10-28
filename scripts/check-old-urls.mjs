// Every address the old WordPress site lists, tried on the new domain: none may end on a 404 or a server error.
//   node scripts/check-old-urls.mjs https://ancien.barberlarchitecte.com https://barberlarchitecte.com
//   node scripts/check-old-urls.mjs https://ancien.barberlarchitecte.com/wp-sitemap.xml barberlarchitecte.com
// The first argument is the old site (its sitemap is found at /wp-sitemap.xml, /sitemap_index.xml or /sitemap.xml) or one
// of its sitemaps; the second the new domain. It walks the sitemap index and the sub-sitemaps, adds the pages, posts and
// categories of the REST API when that is public, asks each path on the new domain without following redirects blindly
// (at most 2 hops, on the same domain) and prints the table. Read only: GET requests. Complements check-redirects.mjs,
// which tries our own list of old addresses (shared/redirects.js); this one starts from the old site's list.
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 15000;
const HOPS = 2;
const SITEMAPS = ['/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml'];
const REST = ['pages', 'posts', 'categories'];

/** The <loc> of a sitemap or a sitemap index, in order. @param {string} xml */
export function locs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}
/** A sitemap index lists sitemaps (.xml), a urlset lists pages. @param {string} xml */
export const isIndex = (xml) => /<sitemapindex[\s>]/.test(String(xml));

/** The path (with its query) an address has on the new domain; WordPress ends addresses with a slash, so does this one. @param {string} u */
export function pathOf(u) {
  const x = new URL(u);
  return x.pathname + x.search;
}

/**
 * Where a path ends up on the new domain.
 * @param {string} origin @param {string} path @param {typeof fetch} get
 * @returns {Promise<{ path: string, hops: { status: number, to: string }[], status: number, final: string, problem: string }>}
 */
export async function follow(origin, path, get = fetch) {
  const hops = [];
  let url = origin + path;
  for (let i = 0; ; i++) {
    let r;
    try { r = await get(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (err) {
      return { path, hops, status: 0, final: url.slice(origin.length), problem: String((err && err.message) || err) };
    }
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      const next = new URL(loc, url);
      hops.push({ status: r.status, to: next.origin === origin ? next.pathname + next.search + next.hash : next.href });
      // a redirect to another site is the end of what we can check (a payment page, a social network)
      if (next.origin !== origin) return { path, hops, status: r.status, final: next.href, problem: '' };
      if (i >= HOPS) return { path, hops, status: r.status, final: next.pathname + next.search, problem: 'plus de ' + HOPS + ' redirections' };
      url = next.origin + next.pathname + next.search;
      continue;
    }
    const final = url.slice(origin.length);
    return { path, hops, status: r.status, final, problem: r.status === 404 || r.status >= 500 || r.status === 0 ? 'HTTP ' + r.status : '' };
  }
}

/** Every address the old site lists. @param {string} start @param {typeof fetch} get @returns {Promise<{ paths: string[], notes: string[] }>} */
export async function listOldUrls(start, get = fetch) {
  const notes = [];
  const text = async (u) => {
    const r = await get(u, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/xml,text/xml,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  };
  /** @type {string[]} */
  const sitemaps = /\.xml(\?|$)/.test(start) ? [start] : SITEMAPS.map((p) => new URL(p, start).href);
  let root = '';
  for (const u of sitemaps) {
    try { root = await text(u); sitemaps.length = 0; sitemaps.push(u); break; } catch (err) { notes.push(u + ' : ' + String((err && err.message) || err)); }
  }
  if (!root) throw new Error('Aucun plan de site trouvé :\n' + notes.join('\n'));
  const paths = new Set();
  // the sub-sitemaps are read from the site we were pointed at, whatever address the index writes (WordPress lists its
  // home URL, which is the new domain once the settings still say so)
  const site = new URL(sitemaps[0]);
  const walk = async (xml, depth) => {
    for (const u of locs(xml)) {
      if (isIndex(xml) && depth < 2 && /\.xml(\?|$)/.test(u)) {
        try { await walk(await text(site.origin + pathOf(u)), depth + 1); } catch (err) { notes.push(u + ' : ' + String((err && err.message) || err)); }
      } else if (!/\.(xsl|xml)(\?|$)/.test(u)) paths.add(pathOf(u));
    }
  };
  await walk(root, 0);
  // the REST API says what the sitemap leaves out (only what is public: drafts are never there)
  for (const kind of REST) {
    try {
      for (let page = 1; page <= 20; page++) {
        const r = await get(site.origin + '/wp-json/wp/v2/' + kind + '?per_page=100&_fields=link&page=' + page, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) break;
        const list = await r.json();
        for (const x of list) if (x && typeof x.link === 'string') paths.add(pathOf(x.link));
        if (list.length < 100) break;
      }
    } catch { /* the API is closed: the sitemap is the list */ }
  }
  return { paths: [...paths], notes };
}

async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to || !/^https?:\/\//.test(from)) {
    console.error('Usage : node scripts/check-old-urls.mjs <ancien site ou son plan de site> <nouveau domaine>\n  ex. node scripts/check-old-urls.mjs https://ancien.barberlarchitecte.com https://barberlarchitecte.com');
    process.exit(2);
  }
  const origin = new URL(/^https?:\/\//.test(to) ? to : 'https://' + to).origin;
  const { paths, notes } = await listOldUrls(from);
  for (const n of notes) console.error('(ignoré) ' + n);
  /** @type {Awaited<ReturnType<typeof follow>>[]} */
  const rows = [];
  const left = [...paths];
  await Promise.all(Array.from({ length: 6 }, async () => { for (let p = left.shift(); p !== undefined; p = left.shift()) rows.push(await follow(origin, p)); }));
  rows.sort((a, b) => (a.path < b.path ? -1 : 1));
  const w = Math.min(70, Math.max(...rows.map((r) => r.path.length)));
  for (const r of rows) {
    const via = r.hops.map((h) => h.status + ' ' + h.to).join(' → ');
    console.log((r.problem ? '✗ ' : '✓ ') + r.path.padEnd(w) + '  ' + (via ? via + ' → ' : '') + (r.status || '—') + (r.problem ? '  (' + r.problem + ')' : ''));
  }
  const bad = rows.filter((r) => r.problem);
  console.log('\n' + (rows.length - bad.length) + ' adresses sur ' + rows.length + ' arrivent quelque part sur ' + origin + '.');
  if (bad.length) { console.error(bad.length + ' adresse(s) à corriger :\n' + bad.map((r) => r.path + ' (' + r.problem + ')').join('\n')); process.exit(1); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch((err) => { console.error(String((err && err.message) || err)); process.exit(1); });
