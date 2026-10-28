// GUIDE-03 · The site explains itself to a first-time visitor: every step of public/guide.js's tour is written on a
// part of site.html that exists, in two short sentences at most; the booking sheet's first-booking helpers; the
// « Comment ça marche » lines of the three small pages; and no inline script added (the CSP is script-src 'self').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { salon } from '../helpers.js';
import { browser } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { updateSettings } from '../../server/commands/shop.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const site = read('public/site.html');
const unq = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const FID = 'Carte fidélité'; // its title and body come from the salon's loyalty switch ({{fidTitle}}, {{fidBody}})
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
      const body = attr('data-guide-body' + sfx);
      out.push({ mark: attr('data-guide'), n: Number(attr('data-guide-n' + sfx)), title: title === '{{fidTitle}}' ? FID : title, body: body === '{{fidBody}}' ? 'Chaque coupe payée remplit ta carte, dans ton espace. À la 10ᵉ coupe, ta récompense t’attend.' : body });
    }
  }
  return out;
}

test('the site has the steps of the first-visit tour, each on a marked part, by order', () => {
  const s = steps().sort((a, b) => a.n - b.n);
  assert.deepEqual(s.map((x) => x.title), ['Réserver', 'Sans compte', 'Mon espace', 'Abonnement', FID, 'Carte cadeau', 'Mon rendez-vous', 'Contact']);
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
  for (const t of ['Choisis ta prestation', 'Un barbier, ou “Sans préférence”', 'Choisis ton créneau', 'Pour ta confirmation par SMS']) assert.ok(site.includes(t), t);
  assert.ok(/n: 'Sans préférence'/.test(site), 'the helper quotes the option\'s real label');
  assert.ok(/!b\.moving && !me && !v\.noMenu && !bookedBefore\(\)/.test(site), 'and only when there is something to choose');
  assert.ok(/<p class="bk-h">\{\{bkHelp\}\}<\/p>/.test(site), 'the helper sits under the title');
  assert.ok(/markBooked\(\);/.test(site), 'a made booking is remembered');
  // storage can be off: both accessors are guarded
  assert.ok(/function bookedBefore\(\) \{ try \{/.test(site) && /function markBooked\(\) \{ try \{/.test(site));
});

test('no inline script is added: the guide is a file, the CSP stays script-src \'self\'', () => {
  const inline = [...site.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((a) => !/\ssrc=/.test(a));
  for (const a of inline) assert.match(a, /type="(application\/ld\+json|text\/x-dc)"/, 'an inline script: ' + a);
  assert.ok(/<script src="\/guide\.js" defer><\/script>/.test(site));
  assert.ok(!/<link[^>]*guide\.css/.test(site), 'guide.css is not render-blocking: guide.js adds it when it first shows something');
  const js = read('public/guide.js');
  assert.ok(!/\beval\(|new Function|innerHTML|document\.write/.test(js), 'text goes in through textContent');
  assert.ok(!/(?:^|[^\w])fetch\(|XMLHttpRequest|sendBeacon/.test(js), 'the guide never calls out: no tracking');
  const vj = JSON.parse(read('vercel.json'));
  for (const f of ['/guide.js', '/guide.css']) assert.ok(vj.headers.some((h) => h.source === f && h.headers.some((x) => x.key === 'Cache-Control' && /max-age=3600/.test(x.value))), f + ' is cached an hour like support.js');
});

test('the invitation and the replay: once, quiet without storage, « Comment ça marche ? » in every footer', () => {
  const js = read('public/guide.js');
  assert.ok(js.includes('Première visite ?') && js.includes('Je te montre en 30 s') && js.includes("'Voir'"));
  assert.ok(/if \(!keep\(SEEN, '1'\)\) return;/.test(js), 'no storage: no bubble');
  assert.ok(/function stored\(k\) \{ try/.test(js) && /function keep\(k, v\) \{ try/.test(js));
  assert.ok(js.includes('prefers-reduced-motion') && js.includes("still() || far ? 'instant' : 'smooth'"), 'reduced motion scrolls at once');
  assert.ok(/<a href="\/\?visite" data-guide-replay>Comment ça marche&nbsp;\?<\/a>/.test(site));
  assert.ok(read('public/pages.js').includes("['/?visite', 'Comment ça marche'"), 'the small pages link back to it');
  const css = read('public/guide.css');
  assert.ok(/prefers-reduced-motion:reduce\)\{[^}]*animation:none/.test(css) && /\.gd-spot,\.gd-card/.test(css), 'still under reduced motion');
});

test('the lookup, gift card and cancellation pages open with a short « Comment ça marche » line', () => {
  for (const f of ['mon-rendez-vous', 'carte-cadeau', 'resilier']) {
    const h = read('public/' + f + '.html');
    const m = /<p class="how"><b>Comment ça marche<\/b>((?:<span(?: id="[\w-]+")?>[^<]+<\/span>){3})<\/p>/.exec(h);
    assert.ok(m, f + ' has its three steps');
  }
  assert.ok(/\.how\{/.test(read('public/pages.css')));
});

test('the guide waits for the page, not for the raw template; the stylesheet and the late parts', () => {
  const js = read('public/guide.js');
  assert.ok(/closest\('x-dc'\)/.test(js), 'the raw template (<x-dc>) is not the page');
  assert.ok(/c > 0 && same >= /.test(js), 'a replay never settles on an empty list');
  assert.ok(/body\.indexOf\('\{\{'\)/.test(js), 'a body not rendered yet is skipped too');
  assert.ok(/refresh\(\)/.test(js), 'parts that arrive late join at the next step');
  assert.ok(/link'\)/.test(js) && /\.css/.test(js), 'guide.js adds its stylesheet itself');
  const css = read('public/guide.css');
  assert.ok(/@media \(min-width:1000px\)\{\.gd-bub\{/.test(css), 'the bubble moves with the site\'s own breakpoint (the CTA goes right at 1000 px)');
  assert.ok(!/min-width:900px/.test(css));
});

test('the typography of the step texts: no space before « : » or « ? » that may break a line', () => {
  for (const m of site.matchAll(/data-guide-body[-\d]*="([^"]*)"/g)) assert.ok(!/\w [:?]/.test(m[1]), 'a plain space before : or ? in ' + m[1]);
  assert.ok(!/\d(e|er) coupe/.test(site), 'the ordinal uses « ᵉ »');
});

test('the loyalty step follows the salon: the account answer carries loyalty { on, goal } and the page promises nothing otherwise', async () => {
  assert.ok(/fidTitle: [^\n]*loyalty\.on \? 'Carte fidélité' : ''/.test(site) && /goal\) \|\| 9\) \+ 1\)/.test(site), 'title and number come from the answer');
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const b = browser(rt);
  assert.deepEqual((await b.get('/api/public/account')).json.loyalty, { on: false, goal: 9 }, 'off until the owner launches it');
  await t.engine.run(updateSettings, { loyalty: { enabled: true, goal: 7 } }, t.asOwner());
  await rt.engine.sync(true);
  assert.deepEqual((await b.get('/api/public/account')).json.loyalty, { on: true, goal: 7 });
  await t.engine.run(updateSettings, { accounts: { enabled: false } }, t.asOwner());
  await rt.engine.sync(true);
  assert.equal((await b.get('/api/public/account')).json.loyalty, undefined, 'a closed space says nothing about it');
});
