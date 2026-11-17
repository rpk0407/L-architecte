// « Ta coupe en photo »: the frame's layout (square 1080, story 1080 × 1920), the crop that covers the photo's window,
// the file's name; and the promise that the photo never leaves the browser (no upload, no storage, no gallery).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FRAME_SIZE, frameLayout, coverCrop, frameFileName, LOGO_SRC } from '../../web/src/lib/photoframe.ts';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('two formats, the photo above a band with the logo, the name and the city, nothing out of the frame', () => {
  assert.deepEqual(FRAME_SIZE, { square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } });
  for (const f of ['square', 'story']) {
    const L = frameLayout(f);
    const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= L.w && r.y + r.h <= L.h;
    assert.ok(inside(L.photo) && inside(L.logo), f);
    assert.ok(L.photo.y + L.photo.h <= L.logo.y, 'the logo sits under the photo');
    assert.ok(L.text.x > L.logo.x + L.logo.w && L.text.max > 300, 'the name beside the logo, with room');
    assert.ok(L.text.city < L.h - 20 && L.text.name > L.photo.y + L.photo.h);
    assert.ok(L.photo.h / L.h > 0.7, 'the photo is the picture');
  }
});

test('the photo covers its window, centred, whatever its shape', () => {
  assert.deepEqual(coverCrop(4000, 3000, { w: 1000, h: 1000 }), { x: 500, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(coverCrop(3000, 4000, { w: 1000, h: 1000 }), { x: 0, y: 500, w: 3000, h: 3000 });
  const c = coverCrop(3000, 4000, frameLayout('story').photo);
  assert.ok(Math.abs(c.w / c.h - frameLayout('story').photo.w / frameLayout('story').photo.h) < 1e-9);
  assert.deepEqual(coverCrop(0, 0, { w: 10, h: 10 }), { x: 0, y: 0, w: 0, h: 0 });
  assert.equal(frameFileName('2026-11-17', 'square'), 'larchitecte-coupe-2026-11-17-carre.jpg');
  assert.equal(frameFileName('2026-11-17', 'story'), 'larchitecte-coupe-2026-11-17-story.jpg');
});

test('made in the browser only: no upload, no storage, no gallery; the logos exist; the page allows nothing more than it did', () => {
  for (const src of Object.values(LOGO_SRC)) assert.ok(existsSync(new URL('../../public' + src, import.meta.url)), src);
  for (const f of ['web/src/lib/photoframe.ts', 'web/src/client/photo.tsx', 'web/src/moi/cards/Photo.tsx']) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/\bfetch\(|\bapi\.(get|post|put|patch|delete)|XMLHttpRequest|sendBeacon|FormData|localStorage|sessionStorage|indexedDB|WebSocket/.test(code), f + ' sends or stores the photo');
  }
  const ui = read('web/src/client/photo.tsx');
  for (const w of ['Ta coupe en photo', 'Partager', 'Enregistrer', 'Carré', 'Story', 'rien n’est envoyé au salon', 'accept="image/*"', 'createImageBitmap']) assert.ok(ui.includes(w), w);
  // shown on the page of a visit that is done, and in the client space
  assert.match(read('web/src/client/main.tsx'), /b\.status === 'done' \? <PhotoFrame/);
  assert.ok(read('web/src/moi/cards/Photo.tsx').includes('PhotoFrame'));
  // the pages' policy: images from the site, data: and blob: (already there for the previews), scripts and connections from the site only
  const csp = JSON.parse(read('vercel.json')).headers.flatMap((h) => h.headers.map((x) => ({ source: h.source, ...x }))).find((x) => x.key === 'Content-Security-Policy' && /\|r\|/.test(x.source) && /moi/.test(x.source));
  assert.ok(csp, 'the /r and /moi pages have their policy');
  assert.match(csp.value, /img-src 'self' data: blob:;/);
  assert.match(csp.value, /script-src 'self';/);
  assert.match(csp.value, /connect-src 'self';/);
  assert.ok(!/\*|unsafe-eval|https?:\/\/(?!checkout\.stripe\.com)/.test(csp.value), csp.value);
});
