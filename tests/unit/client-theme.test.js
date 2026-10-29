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
test('client space: no focus ring takes the control’s own text colour', () => {
  const dirs = ['web/src/moi', 'web/src/client'];
  const files = dirs.flatMap((d) => readdirSync(join(ROOT, d), { recursive: true }).filter((f) => String(f).endsWith('.css')).map((f) => join(d, String(f))));
  assert.ok(files.length >= 4, 'the stylesheets of the client space are found');
  const bad = [];
  for (const f of files) {
    for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^}]*)\}/g)) {
      if (/outline[^;]*currentcolor/i.test(m[2])) bad.push(f + ': ' + m[1].trim());
    }
  }
  assert.deepEqual(bad, []);
});
