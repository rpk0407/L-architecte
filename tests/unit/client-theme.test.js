// The client space's two themes (web/src/client/client.css): the small text reads at 4.5:1, a field's border and a switch's track at 3:1,
// in the light values and in the dark ones, against every surface they sit on. Read from the CSS itself, so a token that drifts fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const css = readFileSync(join(ROOT, 'web/src/client/client.css'), 'utf8');

/** the tokens of a block: --name: value; */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(/:root \{([\s\S]*?)\n\}/.exec(css)[1]);
const darkOnly = tokens(/@media screen and \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/.exec(css)[1]);
const dark = { ...light, ...darkOnly };

const rgb = (v) => {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { c: [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), a: 1 };
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return { c: [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16)), a: 1 };
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map((x) => Number(x)); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; }
  throw new Error('not a colour: ' + v);
};
const over = (fg, bg) => rgb(fg).c.map((x, i) => x * rgb(fg).a + bg[i] * (1 - rgb(fg).a));
const lum = (c) => { const l = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test('client space, ' + name + ': text reads at 4.5:1 on every surface it sits on', () => {
    const paper = rgb(t.paper).c, card = rgb(t.card).c, field = rgb(t.field).c;
    const surfaces = { paper, card, field };
    const need = (fg, bg, min, what) => { const r = ratio(over(fg, bg), bg); assert.ok(r >= min, what + ' is ' + r.toFixed(2) + ':1, under ' + min); };
    for (const [sn, bg] of Object.entries(surfaces)) {
      for (const k of ['ink', 'ink2', 'ink3', 'err', 'ok', 'warn']) need(t[k], bg, 4.5, k + ' on ' + sn);
    }
    // text on a tinted wash (a pill, a note): the tint over the paper and over the card
    for (const [sn, bg] of [['paper', paper], ['card', card]]) {
      const okBg = over(t['ok-bg'], bg), warnBg = over(t['warn-bg'], bg), tint = over(t.tint, bg);
      need(t.ok, okBg, 4.5, 'ok on ok-bg over ' + sn);
      need(t.warn, warnBg, 4.5, 'warn on warn-bg over ' + sn);
      need(t.ink2, tint, 4.5, 'ink2 on a tint over ' + sn);
      need(t.err, over('rgba(235, 70, 57, .09)', bg), 4.5, 'err on a red wash over ' + sn);
    }
    // dark ink on the brand red, and on the red tint of a stamp chip
    need(t['on-red'], rgb(t.red).c, 4.5, 'text on red');
    // the ticket: its three levels of text on its ink
    const tk = rgb(t['tk-bg']).c;
    for (const k of ['tk', 'tk-1', 'tk-2', 'tk-3']) need(t[k], tk, 4.5, k + ' on the ticket');
    // white (or dark) knob and text on a solid green / amber
    need(t['on-ok'], rgb(t.ok).c, 4.5, 'on-ok on ok');
  });
  test('client space, ' + name + ': a field’s border and a switch’s track are 3:1 against what is around them', () => {
    const edge = rgb(t.edge).c;
    for (const k of ['paper', 'card', 'field']) assert.ok(ratio(edge, rgb(t[k]).c) >= 3, 'edge on ' + k + ' is ' + ratio(edge, rgb(t[k]).c).toFixed(2));
    // and the focus ring: the ink on the paper, the card and the field, and on the ticket (ink in both themes) the ticket's own light
    for (const k of ['paper', 'card', 'field']) assert.ok(ratio(rgb(t.ink).c, rgb(t[k]).c) >= 3, 'the ring (ink) on ' + k);
    assert.ok(ratio(rgb(t.tk).c, rgb(t['tk-bg']).c) >= 3, 'the ring (tk) on the ticket');
  });
}

// The ring is a token of the theme, never the control's own text colour: on the brand red, on the skip link and on an ink-filled chip that
// colour is the one of what lies behind the ring (1:1, no ring at all). The pages' real rings are measured in tests/e2e/demo/moi.mjs.
const cssOf = (dirs) => dirs.flatMap((d) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => String(f).endsWith('.css')).map((f) => join(d, String(f))));
const rules = (src) => [...src.matchAll(/([^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] }));

test('client space: no focus ring takes the control’s own text colour', () => {
  const files = cssOf(['web/src/moi', 'web/src/client']);
  assert.ok(files.length >= 4, 'the stylesheets of the client space are found');
  const bad = [];
  for (const f of files) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
      if (/outline[^;]*currentcolor/i.test(m[2])) bad.push(f + ': ' + m[1].trim());
    }
  }
  assert.deepEqual(bad, []);
});

// Every control is drawn a ring of the page's own, never the browser's: on a phone in the light theme that one is thin and amber (2.2:1 on the card).
// The page, the sheets drawn outside it (the loyalty sheet and /moi's sheet are portals in the body) each say it; the ticket, ink in both themes, has its light.
test('client space: the page and each sheet drawn outside it give their controls the page’s ink as a ring', () => {
  const ring = (f, sel) => {
    const r = rules(readFileSync(join(ROOT, f), 'utf8')).find((x) => x.sel.split(',').map((y) => y.trim()).includes(sel));
    assert.ok(r, f + ' has no « ' + sel + ' » rule');
    return r.body;
  };
  for (const [f, sel] of [['web/src/client/client.css', '.c-page :focus-visible'], ['web/src/moi/avantages/loyalty.css', '.lyr-sheet :focus-visible'], ['web/src/moi/moi.css', '.m-sheet :focus-visible']]) {
    assert.match(ring(f, sel), /outline:\s*2\.5px solid var\(--ink(,[^)]*)?\)/, f + ': « ' + sel + ' » is not the page’s ink');
  }
  for (const [f, sel] of [['web/src/client/client.css', '.c-page .c-ticket :focus-visible'], ['web/src/moi/moi.css', '.m-sheet .c-ticket :focus-visible']]) {
    assert.match(ring(f, sel), /outline-color:\s*var\(--tk\)/, f + ': « ' + sel + ' » is not the ticket’s light');
  }
});

// The same on the site's own pages (the ones the client space links to, and the home): the ring is a colour of the page or of the surface it is
// drawn on, never the control's own text colour. The few controls that float over every section or a photograph carry two bands (an ink band
// inside a bone ring), so that one of them stands out from whatever is behind.
test('public pages: no focus ring takes the control’s own text colour', () => {
  const files = ['public/pages.css', 'public/guide.css', 'public/demande.css', 'public/site.html', 'public/404.html', 'public/ancien-lien.html', 'public/mon-rendez-vous.html', 'public/resilier.html', 'public/carte-cadeau.html'];
  const bad = [];
  for (const f of files) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
      if (/outline[^;]*currentcolor/i.test(m[2])) bad.push(f + ': ' + m[1].trim());
    }
  }
  assert.deepEqual(bad, []);
  const pages = rules(readFileSync(join(ROOT, 'public/pages.css'), 'utf8')).find((x) => x.sel === 'a:focus-visible,button:focus-visible');
  assert.match(pages.body, /outline:\s*2\.5px solid var\(--tx\)/, 'the static pages’ ring is the page’s ink');
  const site = readFileSync(join(ROOT, 'public/site.html'), 'utf8');
  assert.match(site, /\.lp :focus-visible\{outline:2\.5px solid var\(--ring\)/, 'the site’s ring is the surface’s');
  assert.match(site, /\.lp \.skip:focus-visible,\.lp \.ct-zoom:focus-visible\{outline-color:var\(--os\);box-shadow:0 0 0 3px var\(--encre\)\}/, 'the skip link and the photo’s pill have two bands');
  assert.match(site, /\.lp \.cta \.btn:focus-visible\{outline-color:var\(--os\);box-shadow:0 0 0 3px var\(--encre\),/, 'the bar that follows the page has two bands');
});

// A field's hint and a dimmed line are text: a token of the theme at full opacity (the browser's grey hint is 3.7:1 on the dark field, and
// ink at 55 % is 4.2:1 on the light card). The tokens themselves are held at 4.5:1 above, on the paper, the card and the field.
test('client space: a hint and a dimmed line take a token of the theme, never the browser’s grey nor an opacity', () => {
  const bySel = {};
  for (const f of cssOf(['web/src/moi', 'web/src/client'])) {
    for (const r of rules(readFileSync(join(ROOT, f), 'utf8').replace(/@media[^{]*\{/g, ''))) {
      for (const sel of r.sel.split(',').map((x) => x.trim()).filter((x) => x.includes('::placeholder'))) bySel[sel] = (bySel[sel] || '') + r.body;
    }
  }
  assert.ok(Object.keys(bySel).includes('.mp-input::placeholder') && Object.keys(bySel).includes('.ms-inp::placeholder'), 'the fields of the profile and of the sign-in have a hint rule');
  for (const [sel, body] of Object.entries(bySel)) {
    assert.match(body, /color:\s*var\(--ink[23]\)/, sel + ' takes a token of the theme');
    assert.match(body, /opacity:\s*1\b/, sel + ' is not dimmed');
  }
  const bad = [];
  for (const f of cssOf(['web/src/moi', 'web/src/client'])) {
    for (const r of rules(readFileSync(join(ROOT, f), 'utf8'))) if (/\.m-rows/.test(r.sel) && /\bopacity:/.test(r.body)) bad.push(f + ': ' + r.sel);
  }
  assert.deepEqual(bad, [], 'the lines of the history are dimmed with a colour, not an opacity');
});
