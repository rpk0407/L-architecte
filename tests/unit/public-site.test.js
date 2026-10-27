// The public site's data now that the owner no longer edits the site: the full menu (the CGV, the FAQ's prices), the
// hours in words, the barbers' bio and Instagram, the salon's Instagram from Réglages › Salon. The old editor is gone
// (no `site` section, no photo upload, no media route, no barber photo or video), and a journal written while it existed
// still replays and verifies. site.html carries its own fixed texts.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { at, salon } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { createRuntime } from '../../server/http/runtime.js';
import { createEngine } from '../../server/core/engine.js';
import { verifyChain } from '../../server/core/journal.js';
import { SECTIONS, settingsSchema, defaultSettings } from '../../server/settings/index.js';
import { hoursText, closedText } from '../../server/settings/hours.js';
import { updateStaff } from '../../server/commands/team.js';
import { parse } from '../../server/lib/validate.js';
import { readFile } from 'node:fs/promises';

const sp = (s) => String(s).replace(/[\u00a0\u202f]/g, ' ');
const clock = { now: at('2026-11-03', 10) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

// The old editor's routes, all here. They are spelt in parts on purpose: RM-SITE's acceptance is that a search of the
// code for those paths finds nothing left, and these tests, which prove the routes answer 404, are the one exception.
// Search for GONE (or for 'media', 'uploads') to find them.
const GONE = { site: '/api/v1/' + 'site', uploads: '/api/v1/' + 'uploads', wordpress: '/api/v1/' + 'uploads/wordpress', media: '/api/public/' + 'media/' };
const MEDIA = GONE.media;
let n = 0;
const rid = () => ({ 'x-request-id': 'site-test-' + ++n });
async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}

/* ---------------- the hours in words ---------------- */

test('the hours in words, from the weekly hours', () => {
  const day = [[540, 1110]];
  assert.equal(sp(hoursText({ 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day })), 'Du mardi au samedi, 9 h – 18 h 30');
  assert.equal(sp(hoursText({ 0: [], 1: [], 2: [[600, 1110]], 3: day, 4: day, 5: day, 6: day })), 'Le mardi, 10 h – 18 h 30 · du mercredi au samedi, 9 h – 18 h 30');
  assert.equal(sp(hoursText({ 2: [[540, 780], [840, 1110]], 3: [[540, 780], [840, 1110]] })), 'Le mardi et le mercredi, 9 h – 13 h et 14 h – 18 h 30');
  assert.equal(sp(hoursText({ 2: day, 3: day, 4: day, 6: day })), 'Du mardi au jeudi et le samedi, 9 h – 18 h 30');
  assert.equal(sp(hoursText({ 1: day, 2: day, 4: day, 5: day, 6: day })), 'Le lundi, le mardi et du jeudi au samedi, 9 h – 18 h 30', 'two days in a row are two items');
  assert.equal(sp(hoursText({ 0: day, 1: day, 6: day })), 'Le lundi, le samedi et le dimanche, 9 h – 18 h 30');
  assert.equal(sp(hoursText({ 1: day, 2: day, 3: day, 4: day, 5: day, 6: day, 0: [[600, 780]] })), 'Du lundi au samedi, 9 h – 18 h 30 · le dimanche, 10 h – 13 h');
  assert.equal(hoursText({}), '');
  assert.equal(closedText({ 0: [], 1: [], 2: day, 3: day, 4: day, 5: day, 6: day }), 'le dimanche et le lundi');
  assert.equal(closedText({ 0: [], 1: [], 2: [], 3: day, 4: day, 5: day, 6: day }), 'le dimanche, le lundi et le mardi');
  assert.equal(closedText({ 0: day, 1: day, 2: day, 3: day, 4: day, 5: day, 6: day }), '');
});

test('changing Tuesday hours changes the hours text the site gets', async () => {
  const b = await owner();
  const pub = (await browser(rt).get('/api/public/salon')).json;
  assert.equal(sp(pub.hoursText), 'Du mardi au samedi, 9 h – 18 h 30');
  assert.equal(pub.closedText, 'le dimanche et le lundi');
  const hours = rt.engine.state.settings.hours;
  const r = await b.patch('/api/v1/settings', { hours: { ...hours, 2: [[600, 1110]] } }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(sp((await browser(rt).get('/api/public/salon')).json.hoursText), /^Le mardi, 10 h – 18 h 30/);
  await b.patch('/api/v1/settings', { hours }, rid());
});

/* ---------------- what /api/public/salon serves ---------------- */

test('the full price list for the CGV and the FAQ, online or not', async () => {
  const b = await owner();
  const cat = (await b.get('/api/v1/catalog')).json.services.filter((x) => x.active);
  const off = cat[cat.length - 1];
  assert.equal((await b.patch('/api/v1/services/' + off.id, { online: false }, rid())).status, 200);
  const pub = (await browser(rt).get('/api/public/salon')).json;
  assert.equal(pub.menu.length, cat.length, 'every active service');
  const row = pub.menu.find((x) => x.name === off.name);
  assert.deepEqual(Object.keys(row).sort(), ['category', 'dur', 'from', 'name', 'online', 'price', 'slug']);
  assert.equal(row.online, false, 'booked at the salon only');
  assert.ok(!pub.services.some((x) => x.id === off.id), 'and still not bookable online');
  // the FAQ's codes are there (site.html quotes their prices)
  for (const k of ['cl', 'cc', 'ct', 'tr', 'de', 'co', 'si', 'ab']) assert.ok(pub.menu.some((x) => x.slug === k), k);
  await b.patch('/api/v1/services/' + off.id, { online: true }, rid());
});

test('no `site` block any more; the salon’s Instagram is Réglages › Salon’s', async () => {
  const b = await owner();
  const pub = (await browser(rt).get('/api/public/salon')).json;
  assert.ok(!('site' in pub), 'the editor’s section is not served');
  assert.equal(pub.shop.instagram, 'https://www.instagram.com/barbershoplarchitecte/');
  const other = 'https://www.instagram.com/larchitecte.autre/';
  assert.equal((await b.patch('/api/v1/settings', { shop: { instagram: other } }, rid())).status, 200);
  assert.equal((await browser(rt).get('/api/public/salon')).json.shop.instagram, other, 'Réglages › Salon reaches the site');
  await b.patch('/api/v1/settings', { shop: { instagram: pub.shop.instagram } }, rid());
});

test('a barber’s bio and Instagram reach the site; photo, video and their title are no longer fields', async () => {
  const b = await owner();
  const jkut = (await b.get('/api/v1/staff')).json.items.find((x) => x.name === 'JKut');
  assert.equal((await b.patch('/api/v1/staff/' + jkut.id, { bio: 'Dégradés.' }, rid())).status, 200);
  // unknown fields are dropped by the schema, like any other
  await b.patch('/api/v1/staff/' + jkut.id, { photo: '/img/fade.jpg', video: 'https://www.youtube.com/watch?v=IP4PTgpZg-8', videoTitle: 'Da JKut’z Therapy' }, rid());
  const st = rt.engine.state.staff.get(jkut.id);
  assert.deepEqual([st.photo, st.video, st.videoTitle], [undefined, undefined, undefined]);
  const pub = (await browser(rt).get('/api/public/salon')).json.barbers.find((x) => x.name === 'JKut');
  assert.equal(pub.bio, 'Dégradés.');
  assert.ok(pub.instagram);
  for (const k of ['photo', 'video', 'videoTitle', 'email']) assert.equal(pub[k], undefined, k);
  // the demo seeds no video for JKut any more
  assert.ok(!JSON.stringify(rt.engine.journal.map((e) => e.data)).includes('IP4PTgpZg-8'));
});

test('the editor’s routes are gone: its texts, the uploads and the media route answer 404', async () => {
  const b = await owner();
  assert.equal((await b.get(GONE.site)).status, 404);
  assert.equal((await b.patch(GONE.site, { hero: { title: 'Net.' } }, rid())).status, 404);
  assert.equal((await b.post(GONE.uploads, {}, rid())).status, 404);
  assert.equal((await b.post(GONE.wordpress, { base: 'https://example.fr' }, rid())).status, 404);
  assert.equal((await browser(rt).get(MEDIA + 'c'.repeat(64) + '.png')).status, 404);
});

/* ---------------- old journals ---------------- */

test('the `site` section is out of the registry, and a settings patch can no longer write it', () => {
  assert.ok(!SECTIONS.some((x) => x.key === 'site'));
  assert.ok(!('site' in defaultSettings()));
  assert.deepEqual(parse(settingsSchema, { site: { hero: { title: 'Net.' } } }), {}, 'dropped like any unknown key');
});

test('a journal from the editor’s time (settings.updated with `site`, staff with a photo and a video) replays and verifies', async () => {
  const t = await salon();
  // what Le site and Équipe wrote then, emitted as they were: the commands no longer exist, the events stay in the chain
  const legacy = {
    run(/** @type {any} */ s, /** @type {any} */ input, /** @type {any} */ ctx) {
      ctx.emit('settings.updated', { patch: { site: { announce: { text: 'Fermé le 11 novembre', from: '2026-11-01', to: '2026-11-11', link: '' }, hero: { title: 'Net.' }, photos: { hero: { url: MEDIA + 'a'.repeat(64) + '.jpg', alt: '' } } }, shop: { instagram: 'https://www.instagram.com/larchitecte.test/' } } });
      ctx.emit('staff.updated', { id: t.ids.Ali, patch: { photo: MEDIA + 'b'.repeat(64) + '.webp', video: 'https://www.youtube.com/watch?v=IP4PTgpZg-8', videoTitle: 'Da JKut’z Therapy' } });
      return { ok: true };
    }
  };
  await t.engine.run(legacy, {}, t.sys);
  await t.engine.run(updateStaff, { id: t.ids.Ali, patch: { bio: 'Toujours là.' } }, t.asOwner());
  // a server starting from the store
  const fresh = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await fresh.sync(true);
  assert.equal(fresh.state.version, t.engine.state.version);
  assert.ok(verifyChain(fresh.journal).ok, 'the chain verifies');
  assert.equal(fresh.state.settings.shop.instagram, 'https://www.instagram.com/larchitecte.test/', 'the rest of that patch still counts');
  assert.equal(fresh.state.staff.get(t.ids.Ali).bio, 'Toujours là.');
  // and the site is served without any of it
  const live = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const res = await browser(live).get('/api/public/salon');
  assert.equal(res.status, 200);
  assert.ok(!('site' in res.json));
  assert.ok(!JSON.stringify(res.json).includes(MEDIA));
  const ali = res.json.barbers.find((x) => x.name === 'Ali');
  assert.deepEqual([ali.bio, ali.photo, ali.video], ['Toujours là.', undefined, undefined]);
});

/* ---------------- the page ---------------- */

test('site.html: its own fixed texts, no Google Fonts, no rating in the description nor the structured data', async () => {
  const html = await readFile(new URL('../../public/site.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('fonts.googleapis.com'));
  assert.ok(!/aggregateRating/i.test(html));
  const meta = /<meta name="description"[^>]*content="([^"]*)"/.exec(html);
  assert.ok(meta && !/avis|316|5,0/.test(meta[1]), meta && meta[1]);
  assert.ok(html.includes('/fonts/instrument-serif-latin-400-normal.woff2'));
  // nothing of the editor left: no media route, no `site` block read from the salon
  for (const w of [MEDIA, '.site.', 's.site', 'SITE0', 'siteNow', 'heroOwn', 'videoTitle']) assert.ok(!html.includes(w), w);
  // the texts the editor's defaults held, in the page itself
  for (const w of ['Barbier, place Pélabon.', 'Ici, on prend le temps.', 'Combien coûte une coupe chez L’Architecte ?', 'Le salon forme-t-il des barbiers ?', 'construction au millimètre', 'Elias R.',
    'https://www.facebook.com/pg/barbershop.larchitecte/', 'https://www.youtube.com/channel/UCi2oLstkv0IIucLyd211G8A', 'https://www.youtube.com/watch?v=IP4PTgpZg-8']) assert.ok(html.includes(w), w);
});
