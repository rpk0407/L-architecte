// Le site: the texts, FAQ, banner, reviews, links and photos the owner edits in the Comptoir, the tokens of the FAQ,
// the hours in words, the photo uploads (Blob mocked) and the copy of the old WordPress media library.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser, ORIGIN } from '../api/client.js';
import { handle } from '../../server/http/app.js';
import { at, salon, rejects } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { capsOf } from '../../server/domain/permissions.js';
import site, { siteSchema, siteOf, resolveTokens, hoursText, closedText, publicSite, announceOn, TOKENS, LIMITS } from '../../server/settings/site.js';
import { updateSite } from '../../server/commands/site.js';
import { blobMedia, fakeBlobSdk } from '../../server/store/blob.js';
import { sniff, privateIp, MAX_PHOTO } from '../../server/http/routes-uploads.js';
import { parse } from '../../server/lib/validate.js';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { optionalRoutes } from '../../server/http/app.js';
import { router } from '../../server/http/kit.js';

const sp = (s) => String(s).replace(/[  ]/g, ' ');
const clock = { now: at('2026-11-03', 10) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

let n = 0;
const rid = () => ({ 'x-request-id': 'site-test-' + ++n });
async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function barber() {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette' }, rid())).status, 200);
  await tab.post('/api/auth/logout', {}, rid());
  const jkut = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === 'JKut');
  assert.equal((await tab.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut }, rid())).status, 200);
  return tab;
}
/** A raw image body, with the browser's session, the way the Comptoir sends it. */
async function upload(b, bytes, type, headers = {}) {
  const h = new Headers({ origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'x-real-ip': b.ip, 'content-type': type, ...rid(), ...headers });
  h.set('cookie', [...b.jar].map(([k, v]) => k + '=' + v).join('; '));
  const res = await handle(new Request(ORIGIN + '/api/v1/uploads', { method: 'POST', headers: h, body: bytes }), { runtime: rt });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const PNG = () => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); b[40] = 7; return b; };
const JPG = (seed = 1) => { const b = new Uint8Array(64); b.set([0xff, 0xd8, 0xff, 0xe0]); b[50] = seed; return b; };

/* ---------------- the schema ---------------- */

test('the schema: 140 characters of banner at most, 12 questions at most, https links only', () => {
  assert.deepEqual(parse(siteSchema, { announce: { text: 'x'.repeat(140) } }).announce, { text: 'x'.repeat(140) });
  assert.throws(() => parse(siteSchema, { announce: { text: 'x'.repeat(141) } }), /announce\.text : 140 caractères maximum/);
  const q = (i) => ({ q: 'Question ' + i + ' ?', a: 'Réponse ' + i + '.' });
  assert.equal(parse(siteSchema, { faq: Array.from({ length: 12 }, (_, i) => q(i)) }).faq.length, 12);
  assert.throws(() => parse(siteSchema, { faq: Array.from({ length: 13 }, (_, i) => q(i)) }), /faq : de 0 à 12 éléments/);
  assert.throws(() => parse(siteSchema, { links: { instagram: 'http://www.instagram.com/x' } }), /links\.instagram : format invalide/);
  assert.throws(() => parse(siteSchema, { links: { facebook: 'javascript:alert(1)' } }), /links\.facebook : format invalide/);
  assert.deepEqual(parse(siteSchema, { links: { youtube: '' } }).links, { youtube: '' }, 'empty hides the link');
  assert.throws(() => parse(siteSchema, { announce: { link: 'http://x.fr' } }), /announce\.link/);
  assert.equal(parse(siteSchema, { announce: { link: '/cgv' } }).announce.link, '/cgv', 'a page of the site is fine');
  for (const link of ['//evil.example/x', 'https://', '/\\evil.example']) assert.throws(() => parse(siteSchema, { announce: { link } }), /announce\.link/, link);
  assert.throws(() => parse(siteSchema, { faq: [{ q: 'Où ?', a: 'Ici.', link: '//evil.example' }] }), /faq\[0\]\.link/);
  assert.throws(() => parse(siteSchema, { announce: { from: '2026-11-12', to: '2026-11-11' } }), /announce\.to : l’annonce doit finir après son début/, 'whichever path saves it');
  assert.throws(() => parse(siteSchema, { photos: { hero: { url: 'javascript:alert(1)' } } }), /photos\.hero\.url/);
  assert.throws(() => parse(siteSchema, { photos: { hero: { url: 'http://x.fr/a.jpg' } } }), /photos\.hero\.url/);
  assert.throws(() => parse(siteSchema, { photos: { hero: { url: 'https://x.fr/a.jpg' } } }), /photos\.hero\.url/, 'no other host: uploads and the old site cover it');
  assert.equal(parse(siteSchema, { photos: { hero: { url: '/api/public/media/' + 'a'.repeat(64) + '.webp' } } }).photos.hero.url.length, 87);
  assert.equal(parse(siteSchema, { photos: { salon: null } }).photos.salon, null, 'the salon photo can be removed');
  assert.throws(() => parse(siteSchema, { photos: { work: Array.from({ length: LIMITS.work + 1 }, () => ({ url: '/img/fade.jpg' })) } }), /photos\.work : de 0 à 8/);
  assert.equal(parse(siteSchema, { reviews: { rating: '4,9' } }).reviews.rating, 4.9, 'typed with a comma');
  assert.throws(() => parse(siteSchema, { reviews: { rating: 5.5 } }), /reviews\.rating/);
  assert.throws(() => parse(siteSchema, { reviews: { rating: 4.85 } }), /reviews\.rating/);
  assert.throws(() => parse(siteSchema, { reviews: { quotes: [1, 2, 3, 4].map(() => ({ text: 'Top' })) } }), /reviews\.quotes : de 0 à 3/);
  assert.throws(() => parse(siteSchema, { announce: { from: '2026-02-30' } }), /announce\.from/);
  assert.equal(site.key, 'site', 'a section for the settings registry (wired by WP-02)');
  assert.equal(site.schema, siteSchema);
});

test('the defaults are what site.html said, and siteOf works without the registry knowing the section', () => {
  const d = site.defaults();
  assert.equal(d.hero.title, 'Frais.');
  assert.equal(d.faq.length, 8);
  assert.deepEqual([d.reviews.rating, d.reviews.count], [5, 316]);
  assert.equal(d.photos.work.length, 3);
  assert.equal(d.announce.text, '', 'no banner until the owner writes one');
  assert.deepEqual(siteOf({}), d);
  assert.deepEqual(siteOf({ site: { hero: { title: 'Net.' } } }).hero, { title: 'Net.', sub: d.hero.sub }, 'a patch over the defaults');
  assert.equal(siteOf({ site: { photos: { salon: null } } }).photos.salon, null);
  assert.equal(siteOf({ site: { faq: [] } }).faq.length, 0, 'lists are replaced, not merged');
  assert.ok(d.faq.every((f) => parse(siteSchema, { faq: [f] })), 'the defaults pass their own schema');
  parse(siteSchema, d);
});

/* ---------------- tokens and hours ---------------- */

test('{prix:cl} is documented and resolved by a pure helper', () => {
  assert.ok(TOKENS.some((t) => t.t === '{prix:cl}' && /prix/.test(t.d)), 'listed for the Comptoir');
  const services = [{ id: 'sv_1', slug: 'cl', price: 2000, dur: 30, active: true }, { id: 'sv_2', slug: 'de', price: 6050, dur: 90, from: true, active: true }, { id: 'sv_3', slug: 'old', price: 1000, dur: 30, active: false }];
  const hours = { 0: [], 1: [], 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const shop = { address: '16, place Pélabon', zip: '13013', city: 'Marseille' };
  const r = resolveTokens('Coupe à {prix:cl} ({duree:cl}), déco dès {prix:de} en {duree:de}.', { services });
  assert.equal(sp(r.text), 'Coupe à 20 € (30 min), déco dès 60,50 € en 1 h 30.');
  assert.deepEqual(r.missing, []);
  const gone = resolveTokens('À {prix:old} ou {prix:xx}.', { services });
  assert.deepEqual(gone.missing, ['{prix:old}', '{prix:xx}'], 'an archived or unknown service resolves to nothing');
  assert.equal(sp(resolveTokens('{horaires}. Fermé {fermeture}. Au {adresse}.', { hours, shop }).text), 'Du mardi au samedi, 9 h – 18 h 30. Fermé le dimanche et le lundi. Au 16, place Pélabon, 13013 Marseille.');
  const typo = resolveTokens('{prix} {inconnu:cl} {prix:CL} {prix:} {prixx:cl}', { services });
  assert.equal(typo.text, ' {inconnu:cl} {prix:CL} {prix:} {prixx:cl}', 'only the documented forms are tokens');
  assert.deepEqual(typo.missing, ['{prix}', '{inconnu:cl}', '{prix:CL}', '{prix:}', '{prixx:cl}'], 'a misspelt one is missing too: it would show as typed');
  assert.deepEqual(resolveTokens('Prix (dès 20 €) : voir la carte.', { services }).missing, [], 'plain text is not a token');
  assert.equal(resolveTokens('', {}).text, '');
});

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

test('what the site gets: the banner between its dates, the FAQ resolved, an incomplete answer left out', () => {
  const settings = { hours: { 2: [[540, 1110]] }, shop: { address: '1 rue', zip: '13001', city: 'Marseille' }, site: { announce: { text: 'Fermé le 11 novembre', from: '2026-11-01', to: '2026-11-11' }, faq: [{ q: 'Prix ?', a: 'Coupe à {prix:cl}.' }, { q: 'Barbe ?', a: 'Barbe à {prix:tb}.' }] } };
  const services = [{ id: 'a', slug: 'cl', price: 2000, dur: 30, active: true }];
  const p = publicSite(settings, services, '2026-11-03');
  assert.deepEqual(p.announce, { text: 'Fermé le 11 novembre', link: '' });
  assert.equal(publicSite(settings, services, '2026-10-31').announce, null, 'not before its first day');
  assert.ok(publicSite(settings, services, '2026-11-11').announce, 'on its last day');
  assert.equal(publicSite(settings, services, '2026-11-12').announce, null, 'gone after');
  assert.deepEqual(p.faq.map((f) => sp(f.a)), ['Coupe à 20 €.'], 'no service tb: that question stays off the site');
  assert.equal(sp(p.hoursText), 'Le mardi, 9 h – 18 h 30');
  assert.equal(announceOn({ text: 'x', from: '', to: '', link: '' }, '2030-01-01'), true, 'no dates: on until removed');
  assert.equal(announceOn({ text: '', from: '', to: '', link: '' }, '2030-01-01'), false);
});

/* ---------------- the Comptoir and the public API ---------------- */

test('the owner saves the site, the public salon shows it; a barber cannot; a manager can (like the catalogue)', async () => {
  const b = await owner();
  const g = await b.get('/api/v1/site');
  assert.equal(g.status, 200);
  assert.equal(g.json.site.hero.title, 'Frais.');
  assert.ok(g.json.tokens.length >= 5 && g.json.services.length > 0);
  const r = await b.patch('/api/v1/site', { announce: { text: 'Fermé le 11 novembre', from: '2026-11-01', to: '2026-11-11' }, faq: [{ q: 'Combien ?', a: 'La coupe classique est à {prix:cl}.' }], hero: { title: 'Net.' } }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const bad = await b.patch('/api/v1/site', { announce: { text: 'x'.repeat(141) } }, rid());
  assert.equal(bad.status, 400);
  assert.equal((await b.patch('/api/v1/site', { announce: { from: '2026-11-12', to: '2026-11-11' } }, rid())).status, 400, 'ends before it starts');
  const pub = (await browser(rt).get('/api/public/salon')).json;
  assert.deepEqual(pub.site.announce, { text: 'Fermé le 11 novembre', link: '' });
  assert.equal(pub.site.hero.title, 'Net.');
  assert.equal(pub.site.hero.sub, site.defaults().hero.sub, 'the rest keeps its default');
  const cl = [...rt.engine.state.services.values()].find((x) => x.slug === 'cl' && x.active);
  assert.ok(cl, 'the demo sells the classic cut under cl');
  assert.equal(sp(pub.site.faq[0].a), 'La coupe classique est à ' + sp((cl.price / 100) + ' €') + '.');
  assert.ok(pub.site.hoursText && pub.site.reviews && pub.site.links && pub.site.photos);

  const tab = await barber();
  assert.equal((await tab.patch('/api/v1/site', { hero: { title: 'Moi.' } }, rid())).status, 403);
  assert.equal((await tab.get('/api/v1/site')).status, 403);
  assert.equal(rt.engine.state.settings.site.hero.title, 'Net.');

  const t = await salon();
  const mgr = (await t.engine.run((await import('../../server/commands/team.js')).addStaff, { name: 'Sami', role: 'manager' }, t.asOwner())).id;
  const st = t.engine.state.staff.get(mgr);
  const asMgr = { actor: { t: 'staff', id: mgr }, staff: st, caps: capsOf(st, t.engine.state.settings) };
  assert.ok(!asMgr.caps.has('settings'));
  await t.engine.run(updateSite, { house: 'On prend le temps.' }, asMgr);
  assert.equal(siteOf(t.engine.state.settings).house, 'On prend le temps.');
  await rejects(t.engine.run(updateSite, { house: 'Non.' }, t.asStaff('Ali')), 'forbidden');
});

test('changing Tuesday hours changes the hours text the site gets', async () => {
  const b = await owner();
  const before = sp((await browser(rt).get('/api/public/salon')).json.site.hoursText);
  const hours = rt.engine.state.settings.hours;
  const r = await b.patch('/api/v1/settings', { hours: { ...hours, 2: [[600, 1110]] } }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = sp((await browser(rt).get('/api/public/salon')).json.site.hoursText);
  assert.notEqual(after, before);
  assert.match(after, /^Le mardi, 10 h – 18 h 30/);
  await b.patch('/api/v1/settings', { hours }, rid());
});

test('the full price list for the CGV, online or not', async () => {
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
  await b.patch('/api/v1/services/' + off.id, { online: true }, rid());
});

test('a barber’s photo, bio, Instagram and video reach the site', async () => {
  const b = await owner();
  const jkut = (await b.get('/api/v1/staff')).json.items.find((x) => x.name === 'JKut');
  const photo = '/api/public/media/' + 'b'.repeat(64) + '.jpg';
  const r = await b.patch('/api/v1/staff/' + jkut.id, { photo, video: 'https://www.youtube.com/watch?v=IP4PTgpZg-8', videoTitle: 'Da JKut’z Therapy', bio: 'Dégradés.' }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await b.patch('/api/v1/staff/' + jkut.id, { photo: 'javascript:alert(1)' }, rid())).status, 400);
  assert.equal((await b.patch('/api/v1/staff/' + jkut.id, { video: 'http://youtube.com/x' }, rid())).status, 400);
  const pub = (await browser(rt).get('/api/public/salon')).json.barbers.find((x) => x.name === 'JKut');
  assert.deepEqual([pub.photo, pub.video, pub.videoTitle, pub.bio], [photo, 'https://www.youtube.com/watch?v=IP4PTgpZg-8', 'Da JKut’z Therapy', 'Dégradés.']);
  assert.ok(pub.instagram);
  assert.equal(pub.email, undefined, 'nothing private on the site');
  assert.equal((await b.patch('/api/v1/staff/' + jkut.id, { photo: '' }, rid())).status, 200, 'empty removes it');
});

/* ---------------- uploads ---------------- */

test('upload: a PNG gets a url served with 200; 4 MB is refused with 413; a barber or a fake image is refused', async () => {
  const sdk = fakeBlobSdk();
  rt.media = blobMedia({ sdk });
  const b = await owner();
  const r = await upload(b, PNG(), 'image/png');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.url, /^\/api\/public\/media\/[a-f0-9]{64}\.png$/);
  assert.ok(sdk.files.has('site/' + r.json.name), 'stored under site/<sha256>.png');
  assert.equal(sdk.files.get('site/' + r.json.name).access, 'public');
  const got = await handle(new Request(ORIGIN + r.json.url), { runtime: rt });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.match(got.headers.get('cache-control'), /immutable/);
  assert.match(got.headers.get('cache-control'), /s-maxage=31536000/, 'kept by Vercel’s CDN too');
  assert.equal(got.headers.get('x-robots-tag'), 'all', 'the site’s photos are indexable, unlike the rest of /api');
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), PNG());
  assert.equal((await upload(b, PNG(), 'image/png')).json.url, r.json.url, 'the same photo twice is one file');

  const big = new Uint8Array(4 * 1024 * 1024); big.set(JPG());
  assert.equal((await upload(b, big, 'image/jpeg')).status, 413, 'streamed: no length announced');
  assert.equal((await upload(b, big, 'image/jpeg', { 'content-length': String(big.byteLength) })).status, 413, 'announced');
  const limit = new Uint8Array(MAX_PHOTO); limit.set(JPG());
  assert.equal((await upload(b, limit, 'image/jpeg')).status, 201, '3 MB exactly is fine');
  assert.equal((await upload(b, new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml')).status, 415);
  assert.equal((await upload(b, new TextEncoder().encode('<html>'), 'image/png')).status, 415, 'the bytes must be an image');
  assert.equal((await upload(b, PNG(), 'image/jpeg')).status, 415, 'and what they announce');
  assert.equal((await upload(b, PNG(), 'image/png', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await upload(browser(rt), PNG(), 'image/png')).status, 401);
  assert.equal((await upload(await barber(), PNG(), 'image/png')).status, 403);
  assert.equal((await handle(new Request(ORIGIN + '/api/public/media/' + 'c'.repeat(64) + '.png'), { runtime: rt })).status, 404);
  assert.equal((await handle(new Request(ORIGIN + '/api/public/media/..%2Fhead.json'), { runtime: rt })).status, 404);
});

test('a Blob store created Private: the photo is kept private and still served', async () => {
  const sdk = fakeBlobSdk();
  sdk.privateStore = true;
  rt.media = blobMedia({ sdk });
  const r = await upload(await owner(), JPG(9), 'image/jpeg');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(sdk.files.get('site/' + r.json.name).access, 'private');
  const other = blobMedia({ sdk }); // another instance, which has not written anything yet
  assert.ok(await other.getPublic(r.json.name));
  const got = await handle(new Request(ORIGIN + r.json.url), { runtime: rt });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
});

test('a production salon without Blob nor a journal file refuses photos, with the fix in words', async () => {
  const saved = rt.media;
  const cfg = rt.cfg;
  try {
    // on Vercel, or Postgres on its own server: memory would lose them at the next restart
    for (const isVercel of [true, false]) {
      rt.media = undefined;
      rt.cfg = { ...cfg, mode: 'production', isVercel, blob: false, dataFile: '' };
      const r = await upload(await owner(), PNG(), 'image/png');
      assert.equal(r.status, 503);
      assert.match(r.json.error.message, /BLOB_READ_WRITE_TOKEN/);
      assert.match(r.json.error.message, /LX_DATA_FILE/);
    }
  } finally { rt.cfg = cfg; rt.media = saved; }
});

test('the old site’s address: private, reserved and embedded IPv4 ranges are refused', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '198.19.255.1', '192.0.0.8', '192.0.2.1', '0.0.0.0', '224.0.0.1',
    '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '2002:c0a8:101::1', '2002:7f00:1::', '2001:db8::1']) assert.equal(privateIp(ip), true, ip);
  for (const ip of ['93.184.216.34', '151.101.1.69', '2a00:1450:4007:80b::200e', '::ffff:93.184.216.34', '2002:5db8:d822::1']) assert.equal(privateIp(ip), false, ip);
});

test('the route files of other packages: wired once present, skipped while missing, loud when broken', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lx-routes-'));
  try {
    const ok = join(dir, 'routes-x.js'), broken = join(dir, 'routes-y.js'), missing = join(dir, 'routes-z.js');
    await writeFile(ok, "export function xRoutes(app) { app.get('/api/public/x', () => ({ x: 1 })); }\n");
    await writeFile(broken, "import './nowhere.js';\nexport function yRoutes() {}\n");
    const app = router();
    const u = (f) => pathToFileURL(f);
    assert.equal(await optionalRoutes(app, () => import(u(ok).href), u(ok)), true);
    assert.ok(app.match('GET', '/api/public/x'), 'a present file is registered');
    assert.equal(await optionalRoutes(app, () => import(u(missing).href), u(missing)), false, 'a missing file is skipped');
    await assert.rejects(optionalRoutes(app, () => import(u(broken).href), u(broken)), /nowhere\.js/, 'a file that is there but breaks stops the server');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the salon’s Instagram is one value: Le site writes Réglages › Salon’s, and follows it', async () => {
  const b = await owner();
  const ig = 'https://www.instagram.com/larchitecte.test/';
  assert.equal((await b.patch('/api/v1/site', { links: { instagram: ig } }, rid())).status, 200);
  assert.equal(rt.engine.state.settings.shop.instagram, ig);
  const other = 'https://www.instagram.com/larchitecte.autre/';
  assert.equal((await b.patch('/api/v1/settings', { shop: { instagram: other } }, rid())).status, 200);
  assert.equal((await browser(rt).get('/api/public/salon')).json.site.links.instagram, other, 'Réglages › Salon reaches the site');
  assert.equal((await b.get('/api/v1/site')).json.site.links.instagram, other);
  assert.equal((await b.patch('/api/v1/site', { links: { instagram: '' } }, rid())).status, 200);
  assert.equal((await browser(rt).get('/api/public/salon')).json.site.links.instagram, '', 'empty hides it');
  await b.patch('/api/v1/site', { links: { instagram: site.defaults().links.instagram } }, rid());
});

test('sniff knows JPEG, PNG and WebP only', () => {
  const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
  assert.deepEqual([sniff(JPG()), sniff(PNG()), sniff(webp), sniff(new TextEncoder().encode('GIF89a......'))], ['jpg', 'png', 'webp', null]);
});

/* ---------------- the old WordPress site ---------------- */

test('the old site’s media library is copied to the salon’s storage, never fetched from elsewhere', async () => {
  const sdk = fakeBlobSdk();
  rt.media = blobMedia({ sdk });
  const asked = [];
  const media = [
    { id: 11, mime_type: 'image/jpeg', source_url: 'https://ancien.barberlarchitecte.com/wp-content/uploads/coupe.jpg', alt_text: 'Dégradé bas', caption: { rendered: '<p>La raie</p>' }, title: { rendered: 'coupe' }, media_details: { width: 3000, height: 2000, sizes: { large: { source_url: 'https://ancien.barberlarchitecte.com/wp-content/uploads/coupe-1024.jpg', width: 1024, height: 683 }, '1536x1536': { source_url: 'https://ancien.barberlarchitecte.com/wp-content/uploads/coupe-1536.jpg', width: 1536, height: 1024 } } } },
    { id: 12, mime_type: 'image/png', source_url: 'https://evil.example/x.png', media_details: {} },
    { id: 13, mime_type: 'image/gif', source_url: 'https://ancien.barberlarchitecte.com/a.gif' },
    { id: 14, mime_type: 'image/jpeg', source_url: 'https://ancien.barberlarchitecte.com/wp-content/uploads/salon.jpg', media_details: { width: 1200, height: 800 } }
  ];
  rt.resolveHost = async (h) => (h === 'intranet.example' ? ['10.0.0.5'] : ['93.184.216.34']);
  rt.fetch = async (url) => {
    asked.push(url);
    if (url.includes('/wp-json/wp/v2/media')) return new Response(JSON.stringify(media), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith('coupe-1536.jpg')) return new Response(JPG(1));
    if (url.endsWith('salon.jpg')) return new Response(JPG(2));
    return new Response('nope', { status: 404 });
  };
  try {
    const b = await owner();
    const r = await b.post('/api/v1/uploads/wordpress', { base: 'https://ancien.barberlarchitecte.com/' }, rid());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(asked[0], 'https://ancien.barberlarchitecte.com/wp-json/wp/v2/media?per_page=100&media_type=image');
    assert.deepEqual(r.json.items.map((x) => x.wp).sort(), [11, 14]);
    const c = r.json.items.find((x) => x.wp === 11);
    assert.deepEqual([c.alt, c.caption, c.width], ['Dégradé bas', 'La raie', 1536], 'the 1536 px version, its alt text and caption');
    assert.match(c.url, /^\/api\/public\/media\/[a-f0-9]{64}\.jpg$/);
    assert.ok(sdk.files.has('site/' + c.url.split('/').pop()));
    assert.ok(!asked.some((u) => u.includes('evil.example')), 'an image hosted elsewhere is not fetched');
    assert.equal(r.json.failed, 1);
    const again = await b.post('/api/v1/uploads/wordpress', { base: 'ancien.barberlarchitecte.com', skip: [11, 14] }, rid());
    assert.equal(again.json.items.length, 0, 'what was copied is skipped');

    for (const base of ['https://127.0.0.1', 'https://localhost:3000', 'https://intranet.local', 'https://intranet.example', 'ftp://x.fr']) {
      const x = await b.post('/api/v1/uploads/wordpress', { base }, rid());
      assert.equal(x.status, 400, base + ' ' + JSON.stringify(x.json));
    }
    rt.fetch = async (url) => (url.includes('/wp-json/') ? new Response('', { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }) : new Response('x'));
    rt.resolveHost = async (h) => (h === '169.254.169.254' ? ['169.254.169.254'] : ['93.184.216.34']);
    assert.equal((await b.post('/api/v1/uploads/wordpress', { base: 'https://ancien.barberlarchitecte.com' }, rid())).status, 400, 'a redirect is checked like the first address');
    // an image whose address redirects to another host is not copied
    rt.fetch = async (url) => {
      if (url.includes('/wp-json/')) return new Response(JSON.stringify([media[3]]));
      if (url.endsWith('salon.jpg')) return new Response('', { status: 301, headers: { location: 'https://evil.example/salon.jpg' } });
      return new Response(JPG(3));
    };
    const moved = await b.post('/api/v1/uploads/wordpress', { base: 'https://ancien.barberlarchitecte.com' }, rid());
    assert.deepEqual([moved.json.items.length, moved.json.failed], [0, 1]);
    rt.fetch = async () => new Response('<html>pas WordPress</html>');
    const notWp = await b.post('/api/v1/uploads/wordpress', { base: 'https://example.fr' }, rid());
    assert.equal(notWp.status, 502);
    assert.match(notWp.json.error.message, /WordPress/);
    assert.equal((await (await barber()).post('/api/v1/uploads/wordpress', { base: 'https://example.fr' }, rid())).status, 403);
  } finally { rt.fetch = undefined; rt.resolveHost = undefined; }
});

/* ---------------- the page ---------------- */

test('site.html: no Google Fonts, no rating in the meta description nor the structured data, no hard-coded JKut links', async () => {
  const html = await readFile(new URL('../../public/site.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('fonts.googleapis.com'));
  assert.ok(!/aggregateRating/i.test(html));
  const meta = /<meta name="description"[^>]*content="([^"]*)"/.exec(html);
  assert.ok(meta && !/avis|316|5,0/.test(meta[1]), meta && meta[1]);
  assert.ok(!html.includes('instagram.com/jkut.nw'));
  assert.ok(html.includes('/fonts/instrument-serif-latin-400-normal.woff2'));
});
