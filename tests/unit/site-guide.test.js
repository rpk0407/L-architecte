// GUIDE-03 · The site explains itself to a first-time visitor: every step of public/guide.js's tour is written on a
// part of site.html that exists, in two short sentences at most; the booking sheet's first-booking helpers; the
// « Comment ça marche » lines of the three small pages; and no inline script added (the CSP is script-src 'self').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const site = read('public/site.html');
const unq = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const sentences = (t) => unq(t).split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);

/** Every step written on the page: { mark, n, title, body } (the marks carry data-guide, data-guide-title[-2|-3], …). */
function steps() {
  const out = [];
  for (const m of site.matchAll(/<[a-z][^>]*\sdata-guide-title=[^>]*>/g)) {
    const tag = m[0];
    const attr = (k) => { const r = new RegExp('\\s' + k + '="([^"]*)"').exec(tag); return r ? r[1] : null; };
    for (const sfx of ['', '-2', '-3']) {
      const title = attr('data-guide-title' + sfx);
      if (title == null) continue;
      out.push({ mark: attr('data-guide'), n: Number(attr('data-guide-n' + sfx)), title, body: attr('data-guide-body' + sfx) });
    }
  }
  return out;
}

test('the site has the steps of the first-visit tour, each on a marked part, by order', () => {
  const s = steps().sort((a, b) => a.n - b.n);
  assert.deepEqual(s.map((x) => x.title), ['Réserver', 'Sans compte', 'Mon espace', 'Abonnement', 'Carte fidélité', 'Carte cadeau', 'Mon rendez-vous', 'Contact']);
  for (const x of s) {
    assert.ok(x.mark && /^[\w.-]+$/.test(x.mark), 'a step needs the data-guide of its part: ' + x.title);
    assert.ok(Number.isFinite(x.n) && x.n > 0, 'a step needs its order: ' + x.title);
    assert.ok(x.title.length <= 30 && x.body, x.title);
  }
  assert.equal(new Set(s.map((x) => x.n)).size, s.length, 'each step has its own place in the order');
  // a part is one element: its steps share it, ids are never reused by two parts
  for (const x of s) assert.equal(site.split('data-guide="' + x.mark + '"').length - 1, 1, x.mark + ' marks one part');
});

test('every step body is two sentences at most, in French with « tu »', () => {
  for (const x of steps()) {
    if (/\{\{/.test(x.body)) continue; // the membership's words are the salon's own: checked below
    assert.ok(sentences(x.body).length <= 2, x.title + ': ' + x.body);
    assert.ok(!/(?<![-\w])(vous|votre|vos)(?![-\w])/i.test(x.body), x.title);
  }
});

test('the membership step quotes the salon\'s plan, in two sentences, or says the idea when there are several', () => {
  const line = /const one = [^\n]*\n\s*v\.aboGuide = [^\n]*/.exec(site);
  assert.ok(line, 'the page computes aboGuide');
  const run = (plans) => {
    const ctx = { v: { aboOn: true }, m: { plans }, num: (x) => String(x), NB: ' ' };
    vm.runInNewContext('(function(){' + line[0] + '})()', ctx);
    return ctx.v.aboGuide;
  };
  const one = run([{ price: 8000, words: '1 coupe par semaine · Coupe classique · semaine manquée : perdue' }]);
  assert.match(one, /^80 € par mois : 1 coupe par semaine\./);
  assert.ok(/3 clics/.test(one) && sentences(one).length === 2, one);
  const many = run([{ price: 3400, words: 'a' }, { price: 8000, words: 'b' }]);
  assert.ok(sentences(many).length === 2 && /3 clics/.test(many), many);
});

test('the booking sheet helps on the first booking only, one line per step', () => {
  for (const t of ['Choisis ta prestation', 'Choisis ton barbier ou “Peu importe”', 'Choisis ton créneau', 'Tes coordonnées : on t’envoie la confirmation par SMS']) assert.ok(site.includes(t), t);
  assert.ok(/<p class="bk-h">\{\{bkHelp\}\}<\/p>/.test(site), 'the helper sits under the title');
  assert.ok(/!b\.moving && !me && !bookedBefore\(\)/.test(site), 'only for a first booking');
  assert.ok(/markBooked\(\);/.test(site), 'a made booking is remembered');
  // storage can be off: both accessors are guarded
  assert.ok(/function bookedBefore\(\) \{ try \{/.test(site) && /function markBooked\(\) \{ try \{/.test(site));
});

test('no inline script is added: the guide is a file, the CSP stays script-src \'self\'', () => {
  const inline = [...site.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => !/\ssrc=/.test(a));
  for (const a of inline) assert.match(a, /type="(application\/ld\+json|text\/x-dc)"/, 'an inline script: ' + a);
  assert.ok(/<script src="\/guide\.js" defer><\/script>/.test(site) && /<link rel="stylesheet" href="\/guide\.css">/.test(site));
  const js = read('public/guide.js');
  assert.ok(!/\beval\(|new Function|innerHTML|document\.write/.test(js), 'text goes in through textContent');
  assert.ok(!/(?:^|[^\w])fetch\(|XMLHttpRequest|sendBeacon/.test(js), 'the guide never calls out: no tracking');
  assert.ok(!read('vercel.json').includes('guide'), 'vercel.json is untouched');
});

test('the invitation and the replay: once, quiet without storage, « Comment ça marche ? » in every footer', () => {
  const js = read('public/guide.js');
  assert.ok(js.includes('Première visite ?') && js.includes('Je te montre en 30 s') && js.includes("'Voir'"));
  assert.ok(/if \(!keep\(SEEN, '1'\)\) return;/.test(js), 'no storage: no bubble');
  assert.ok(/function stored\(k\) \{ try/.test(js) && /function keep\(k, v\) \{ try/.test(js));
  assert.ok(js.includes('prefers-reduced-motion') && js.includes("'auto' : 'smooth'"), 'reduced motion scrolls at once');
  assert.ok(/<a href="\/\?visite" data-guide-replay>Comment ça marche&nbsp;\?<\/a>/.test(site));
  assert.ok(read('public/pages.js').includes("['/?visite', 'Comment ça marche'"), 'the small pages link back to it');
  const css = read('public/guide.css');
  assert.ok(/prefers-reduced-motion:reduce\)\{[^}]*animation:none/.test(css) && /\.gd-spot,\.gd-card/.test(css), 'still under reduced motion');
});

test('the lookup, gift card and cancellation pages open with a short « Comment ça marche » line', () => {
  for (const f of ['mon-rendez-vous', 'carte-cadeau', 'resilier']) {
    const h = read('public/' + f + '.html');
    const m = /<p class="how"><b>Comment ça marche<\/b>((?:<span>[^<]+<\/span>){3})<\/p>/.exec(h);
    assert.ok(m, f + ' has its three steps');
  }
  assert.ok(/\.how\{/.test(read('public/pages.css')));
});
