// /moi is hosted like the other client pages (AC-03a): its own Vite entry, every /moi/<tab> served by the one page,
// never indexed, the strict CSP (the app is the bundle: no inline script), out of robots.txt; and the public pages stop
// promising « Pas de cookie » now that signing in to the space sets one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { robotsTxt } from '../../scripts/postbuild.mjs';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const cfg = JSON.parse(read('vercel.json'));

/** A vercel.json source as Vercel matches it (the subset this project uses: literals, (a|b) groups, (.*), :name, :name*). */
function matches(source, path) {
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ':') {
      const m = /^:([A-Za-z_]\w*)(\*)?/.exec(source.slice(i));
      if (m[2] && re.endsWith('/')) re = re.slice(0, -1) + '(?:/.*)?';
      else re += m[2] ? '.*' : '[^/]+';
      i += m[0].length - 1;
    } else if (ch === '(') { const end = source.indexOf(')', i); re += source.slice(i, end + 1); i = end; }
    else re += ch.replace(/[.+?^${}|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$').test(path);
}
const headersOf = (path) => Object.fromEntries(cfg.headers.filter((r) => matches(r.source, path)).flatMap((r) => r.headers.map((h) => [h.key, h.value])));
const rewriteOf = (path) => { const r = cfg.rewrites.find((x) => matches(x.source, path)); return r ? r.destination : null; };

test('every /moi/<tab> is served by the /moi page, /moi itself by its own index', () => {
  for (const p of ['/moi/historique', '/moi/profil', '/moi/x', '/moi/abonnement/resilier']) assert.equal(rewriteOf(p), '/moi', p);
  // /moi is the built moi/index.html (Vite input), found before any rewrite
  assert.match(read('web/vite.config.ts'), /moi: here\('moi\/index\.html'\)/);
  const html = read('web/moi/index.html');
  assert.match(html, /<script type="module" src="\/src\/moi\/main\.tsx"><\/script>/);
  assert.match(html, /<title>Mon espace · L’Architecte<\/title>/);
  // the browser's bar follows the phone like the signed-out frame does (the signed-in space puts the light one first, web/src/moi/lit.ts)
  assert.match(html, /<meta name="theme-color" content="#ECE8E0" media="\(prefers-color-scheme: light\)">/);
  assert.match(html, /<meta name="theme-color" content="#0F0E0D" media="\(prefers-color-scheme: dark\)">/);
  // AC-03b adds the manifest and the touch icon with its files
  assert.doesNotMatch(html, /rel="manifest"|apple-touch-icon/);
});

test('/moi is never indexed and carries the strict CSP, like /r/', () => {
  const html = read('web/moi/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  for (const p of ['/moi', '/moi/historique', '/moi/profil']) {
    const h = headersOf(p);
    assert.equal(h['X-Robots-Tag'], 'noindex, nofollow', p);
    assert.equal(h['Content-Security-Policy'], headersOf('/r/abc')['Content-Security-Policy'], p);
    assert.match(h['Content-Security-Policy'], /script-src 'self';/);
    assert.doesNotMatch(h['Content-Security-Policy'], /script-src[^;]*unsafe/);
    assert.equal(h['X-Frame-Options'], 'DENY', p);
  }
  // no inline script in the page: the CSP would block it
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  // the public pages next to it stay indexable
  assert.equal(headersOf('/mon-rendez-vous')['X-Robots-Tag'], undefined);
  assert.equal(headersOf('/mon-rendez-vous')['Content-Security-Policy'], undefined);
});

test('robots.txt keeps /moi out once the site is indexed', () => {
  assert.match(robotsTxt(true, 'https://barberlarchitecte.com'), /^Disallow: \/moi$/m);
  assert.equal(robotsTxt(false, 'https://barberlarchitecte.com'), 'User-agent: *\nDisallow: /\n');
});

test('the public pages no longer say « Pas de cookie »', () => {
  const pub = readdirSync(join(ROOT, 'public')).filter((f) => ['.html', '.js'].includes(extname(f)));
  assert.ok(pub.includes('confidentialite.html') && pub.includes('pages.js'));
  for (const f of pub) assert.doesNotMatch(read('public/' + f), /Pas de cookie/i, f);
  const conf = read('public/confidentialite.html');
  // the cookie the space sets is named, with how long it lasts (the salon's setting, its default said) and how to remove it
  assert.match(conf, /un seul cookie te garde connecté sur ce téléphone \(le temps choisi par le salon, 180 jours par défaut/);
  assert.match(read('server/settings/accounts.js'), /defaults: \(\) => \(\{ enabled: false, sessionDays: 180,/);
  assert.match(conf, /<h2 id="t-space">Ton espace<\/h2>/);
  // closed in production until the salon opens it: the page does not promise it as there today
  assert.match(conf, /Quand le salon l’ouvre, et seulement si tu le veux, tu ouvres ton espace/);
  assert.match(read('public/pages.js'), /Pas de pistage, pas de mesure d’audience\./);
});

const r_ = () => read('web/src/client/main.tsx');

test('the site, /r/ and /mon-rendez-vous lead to the space, only while the salon has it open', () => {
  const site = read('public/site.html');
  // the card sits right under the ticket (and the deposit's block), before the text preview: never below the fold of the sheet
  assert.match(site, /<sc-if value="\{\{espaceNew\}\}"[^>]*><div class="card espace" data-guide="site.espace"><h3>Garde tout au même endroit<\/h3><p>\{\{espaceText\}\}<\/p><a class="btn" href="\{\{espaceUrl\}\}">Ouvrir mon espace<\/a><small>Facultatif&nbsp;: ton rendez-vous est déjà confirmé\.<\/small><\/div><\/sc-if>/);
  assert.ok(site.indexOf('data-guide="site.espace"') < site.indexOf('<p class="sms-k">'), 'the card is above the text preview');
  assert.ok(site.indexOf('class="tk"') < site.indexOf('data-guide="site.espace"'), 'the card is below the ticket');
  // optional, and says how it opens (a code by SMS, no password); the loyalty card is promised only where the salon runs it
  assert.match(site, /espaceText: s\.acct && s\.acct\.loyalty && s\.acct\.loyalty\.on \? 'Ton prochain rendez-vous, tes reçus et ta carte fidélité\. Un code par SMS, pas de mot de passe\.' : 'Ton prochain rendez-vous et tes reçus\. Un code par SMS, pas de mot de passe\.'/);
  // the Sommaire and the top bar lead to it too, only while the space is open, « Salut Yanis » once signed in
  assert.match(site, /<sc-if value="\{\{espaceOn\}\}"[^>]*><a class="mn-me" href="\/moi">/);
  assert.match(site, /<sc-if value="\{\{espaceOn\}\}"[^>]*><a class="tb-me" href="\/moi" aria-label="\{\{meAria\}\}"/);
  assert.match(site, /meName: s\.acct && s\.acct\.signedIn && s\.acct\.first \? 'Salut ' \+ s\.acct\.first : 'Mon espace'/);
  assert.match(site, /<sc-if value="\{\{espaceOn\}\}"[^>]*><p class="ab-esp">Ton abonnement, ton carnet et tes coupes restantes se suivent dans <a href="\/moi">Mon espace<\/a>\.<\/p><\/sc-if>/);
  assert.match(site, /<sc-if value="\{\{espaceOn\}\}"[^>]*><li><a href="\/moi"[^>]*>Mon espace<\/a><\/li><\/sc-if>/);
  assert.match(site, /espaceUrl: '\/moi\?garder=' \+ encodeURIComponent\(/);
  // « C’est dans ton espace » only for a booking that is his (booked with another number, it is not)
  assert.match(site, /espaceIn: !!\(s\.acct && s\.acct\.enabled && s\.acct\.signedIn && s\.bk\.result && s\.ownTok === s\.bk\.result\.token\)/);
  assert.match(r_(), /setMine\(\(m\.upcoming \|\| \[\]\)\.some\(\(u\) => u\.token === token\)\)/);
  const r = read('web/src/client/main.tsx');
  assert.match(r, /if \(!acc \|\| !acc\.enabled\) return null;/);
  assert.match(r, /href=\{'\/moi\?garder=' \+ encodeURIComponent\(token\)\}>Ouvrir mon espace</);
  assert.match(r, /<h2 className="c-h2" id="c-espace-t">Ouvre ton espace<\/h2>/);
  assert.match(r, /Un code par SMS, pas de mot de passe\./);
  const mrdv = read('public/mon-rendez-vous.html');
  assert.match(mrdv, /<div id="lk-espace" class="espace" role="group" aria-labelledby="lk-et" hidden>/);
  assert.match(mrdv, /<h2 id="lk-et">Tu reviens souvent&nbsp;\?<\/h2>/);
  // the footer of every static page carries « Mon espace » once the salon has opened it (pages.js)
  assert.match(read('public/pages.js'), /function space\(a\) \{\s+if \(!a \|\| !a\.enabled\) return;/);
  assert.match(mrdv, /if \(a && a\.enabled\) document\.getElementById\('lk-espace'\)\.hidden = false;/);
});
