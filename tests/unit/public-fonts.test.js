// Every page serves its fonts from the salon's own domain (/fonts, copied by scripts/postbuild.mjs): no visitor's
// address reaches Google. Only the Comptoir's and client pages have a CSP (font-src 'self', vercel.json); the public
// pages have none, so this test is what guards them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { FONTS } from '../../scripts/postbuild.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.json', '.webmanifest', '.svg', '.txt', '.xml']);
/** @param {string} dir @returns {string[]} */
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : files(join(dir, e.name))) : TEXT.has(extname(e.name)) ? [join(dir, e.name)] : []);
const PUBLIC = files(join(ROOT, 'public'));
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => f.slice(ROOT.length + 1);

test('no file in public/ (nor the Comptoir and client pages) asks Google Fonts', () => {
  assert.ok(PUBLIC.some((f) => f.endsWith('site.html')), 'public/ was not scanned');
  for (const f of [...PUBLIC, ...files(join(ROOT, 'web'))]) assert.doesNotMatch(read(f), /fonts\.(googleapis|gstatic)\.com/, rel(f) + ' still loads Google Fonts');
});

test('every /fonts/ file a page names is one the build copies, and every page with the site fonts declares them', () => {
  const known = new Set(FONTS.map(([, file]) => file));
  const css = read(join(ROOT, 'public', 'pages.css'));
  let checked = 0;
  for (const f of PUBLIC) {
    const s = read(f);
    for (const [, file] of s.matchAll(/\/fonts\/([\w.-]+)/g)) assert.ok(known.has(file), rel(f) + ' names /fonts/' + file + ', which postbuild does not copy');
    // a page uses the site fonts by naming them, or by linking pages.css which does; a stylesheet that names them declares them
    const links = /\.html$/.test(f) && s.includes('href="/pages.css"');
    if (!links && !(/\.(html|css)$/.test(f) && /Instrument (Sans|Serif)/.test(s))) continue;
    const faces = s.includes('@font-face') ? s : links ? css : '';
    for (const file of known) assert.ok(faces.includes('/fonts/' + file), rel(f) + ' does not declare /fonts/' + file);
    checked++;
  }
  assert.ok(PUBLIC.some((f) => f.endsWith('pages.css')) && checked > 5, 'the pages were not checked');
});
