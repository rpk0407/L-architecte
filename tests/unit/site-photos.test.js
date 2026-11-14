// The team's portraits on the site (the owner's wish of 14 November 2026): the preset sets each one's photo through
// setPhoto, only on someone who has none; « Photo visible sur le site » belongs to each photo (on when the owner or the
// preset sets it, off when a barber sets his own until he says so); the public route serves the image of a bookable,
// active barber who shows it, and nothing else; /api/public/salon gives its address. Also the channel the site names
// for the confirmation and the reminder (SMS or WhatsApp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, ORIGIN } from '../api/client.js';
import { handle } from '../../server/http/app.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { instantOf } from '../../shared/dates.js';
import { DEVICE_COOKIE } from '../../server/auth/session.js';
import { ARCHITECTE } from '../../server/presets/architecte.js';
import { presetPhoto } from '../../server/commands/setup.js';
import { PHOTO_MAX, setPhoto } from '../../server/commands/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { capsOf } from '../../server/domain/permissions.js';

const OWNER = { token: 'pose-13', name: 'Frank R.', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' };

/** A production salon on Tuesday 17 November 2026, its owner signed in; the preset applied unless told otherwise. */
async function fresh({ apply = true } = {}) {
  const clock = { now: instantOf('2026-11-17', 600) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const b = browser(rt);
  assert.equal((await b.post('/api/setup', OWNER)).status, 200);
  if (apply) assert.equal((await b.post('/api/v1/preset/apply', {})).status, 200);
  const s = () => rt.engine.state;
  const byName = (n) => [...s().staff.values()].find((x) => x.name === n);
  const owner = () => [...s().staff.values()].find((x) => x.role === 'owner');
  return { rt, b, s, byName, owner, clock };
}
/** The barber signed in on the salon's tablet with the code the preset's « Donner un code » gave him. */
async function asBarber(rt, b, name) {
  const codes = (await b.post('/api/v1/preset/codes', {})).json.codes;
  if (!b.jar.has(DEVICE_COOKIE)) assert.equal((await b.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  const t = browser(rt);
  t.jar.set(DEVICE_COOKIE, b.jar.get(DEVICE_COOKIE));
  const c = codes.find((x) => x.name === name);
  assert.ok(c, name + ' has a code');
  assert.equal((await t.post('/api/auth/pin', { staffId: c.id, pin: c.pin })).status, 200);
  return t;
}
const pub = async (rt) => (await browser(rt).get('/api/public/salon')).json;
const webp = (n) => 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 1), Buffer.from('WEBP'), Buffer.alloc(n - 12, 3)]).toString('base64');

test('the portraits fit what setPhoto takes: WebP, at most 24 KB, one per person of the preset', async () => {
  assert.deepEqual(ARCHITECTE.staff.map((x) => x.name), ['JKut', 'Le Soldat', 'Frank', 'Esteban', 'Aland']);
  for (const x of ARCHITECTE.staff) {
    const d = await presetPhoto(x.photo);
    assert.match(d, /^data:image\/webp;base64,/, x.name);
    const bytes = Buffer.from(d.split(',')[1], 'base64');
    assert.ok(bytes.length <= PHOTO_MAX && bytes.length > 4000, x.name + ': ' + bytes.length + ' bytes');
    assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
  }
  assert.equal(await presetPhoto(new URL('./equipe/personne.webp', import.meta.url)), '', 'a missing file is skipped');
  assert.equal(await presetPhoto(undefined), '');
});

test('applied: each one has his portrait in the Comptoir, shown on the site; Aland (not online) is not on the site', async () => {
  const { rt, b, s, byName, owner } = await fresh();
  assert.equal(s().staffPhotos.size, 5);
  for (const st of [owner(), byName('JKut'), byName('Le Soldat'), byName('Esteban'), byName('Aland')]) {
    assert.ok(st.photoV > 0, st.name);
    assert.equal(st.photoSite, true, st.name + ': set by the owner through the preset, so shown on the site');
  }
  // the Comptoir's views carry the version and the switch (Équipe, the agenda's columns, Mon espace)
  const team = (await b.get('/api/v1/staff')).json.items;
  for (const x of team) assert.deepEqual([typeof x.photo, x.photoSite], ['number', true], x.name);
  const img = await b.get('/api/v1/staff/' + byName('JKut').id + '/photo?v=' + byName('JKut').photoV);
  assert.deepEqual([img.status, img.headers.get('content-type')], [200, 'image/webp']);
  const ag = (await b.get('/api/v1/agenda?day=2026-11-18')).json;
  assert.ok(ag.lanes.every((l) => l.photo > 0), 'the agenda’s columns have the photo');

  // the site: the address of each bookable barber's photo, under its version; nothing else about it
  const site = await pub(rt);
  assert.deepEqual(site.barbers.map((x) => x.name), ['Frank R.', 'JKut', 'Le Soldat', 'Esteban']);
  for (const x of site.barbers) {
    const st = s().staff.get(x.id);
    assert.equal(x.photo, '/api/public/barbers/' + st.id + '/photo?v=' + st.photoV, x.name);
    assert.equal(x.photoSite, undefined);
    for (const k of ['email', 'schedule', 'commission', 'hasPin', 'services']) assert.equal(x[k], undefined, k);
  }
  // the image itself, for anyone, with no cookie
  const r = await browser(rt).get(site.barbers[1].photo);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/webp');
  assert.equal(r.headers.get('cache-control'), 'private, max-age=86400');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!r.headers.get('set-cookie'));
  const raw = Buffer.from(await (await handle(new Request(ORIGIN + site.barbers[1].photo), { runtime: rt })).arrayBuffer());
  assert.equal(raw.toString('latin1', 8, 12), 'WEBP');
  assert.equal('data:image/webp;base64,' + raw.toString('base64'), s().staffPhotos.get(byName('JKut').id).data, 'the very bytes, nothing added');
  // another version, someone unknown, Aland (not online), the owner's own route: 404
  const jk = byName('JKut');
  assert.equal((await browser(rt).get('/api/public/barbers/' + jk.id + '/photo?v=1')).status, 404);
  assert.equal((await browser(rt).get('/api/public/barbers/st_nobody/photo')).status, 404);
  assert.equal((await browser(rt).get('/api/public/barbers/' + byName('Aland').id + '/photo?v=' + byName('Aland').photoV)).status, 404);
  assert.equal((await browser(rt).get('/api/v1/staff/' + jk.id + '/photo?v=' + jk.photoV)).status, 401, 'the Comptoir’s route stays private');
});

test('a photo already there is his: the preset never replaces it, and a second run sets nothing', async () => {
  const { rt, b, s, byName, owner } = await fresh({ apply: false });
  // the owner's own photo before the preset
  const mine = webp(3000);
  assert.equal((await b.post('/api/v1/staff/' + owner().id + '/photo', { data: mine })).status, 200);
  const plan = (await b.get('/api/v1/preset')).json;
  assert.deepEqual(plan.team.map((t) => [t.name, t.photo]), [['JKut', 'create'], ['Le Soldat', 'create'], ['Frank', 'exists'], ['Esteban', 'create'], ['Aland', 'create']]);
  assert.equal(plan.count.photos, 4);
  const r = await b.post('/api/v1/preset/apply', {});
  assert.equal(r.json.done.photos, 4);
  assert.equal(s().staffPhotos.get(owner().id).data, mine);
  // the photos alone, again: nothing to do
  const n = rt.engine.journal.length;
  assert.deepEqual((await b.post('/api/v1/preset/apply', { parts: ['photos'] })).json.done.photos, 0);
  assert.equal(rt.engine.journal.length, n);
  assert.ok(byName('JKut').photoV);
});

test('the photos part on its own: an older salon gets the portraits without anything else being touched', async () => {
  const { b, s } = await fresh({ apply: false });
  // the team first (as an earlier version of the preset did), then the photos alone
  assert.equal((await b.post('/api/v1/preset/apply', { parts: ['team'] })).json.done.photos, 0);
  assert.equal(s().staffPhotos.size, 0);
  const r = await b.post('/api/v1/preset/apply', { parts: ['photos'] });
  assert.deepEqual([r.json.done.photos, r.json.done.services, r.json.done.hours], [5, 0, 0]);
  assert.equal(s().services.size, 0);
});

test('« Photo visible sur le site »: a barber hides his own in his space, the owner any in Équipe; hidden means gone from the site', async () => {
  const { rt, b, byName, owner } = await fresh();
  const jk = byName('JKut'), ls = byName('Le Soldat');
  const me = await asBarber(rt, b, 'JKut');
  // his own: off, and the site no longer has it, address and image
  const url = (await pub(rt)).barbers.find((x) => x.name === 'JKut').photo;
  assert.deepEqual((await me.post('/api/v1/staff/' + jk.id + '/photo/site', { on: false })).json, { photoSite: false });
  assert.equal((await pub(rt)).barbers.find((x) => x.name === 'JKut').photo, undefined);
  assert.equal((await browser(rt).get(url)).status, 404);
  assert.equal((await me.get('/api/v1/bootstrap')).json.me.photoSite, false);
  // still his photo in the Comptoir
  assert.equal((await me.get('/api/v1/staff/' + jk.id + '/photo?v=' + jk.photoV)).status, 200);
  // a colleague's: not his to change
  assert.equal((await me.post('/api/v1/staff/' + ls.id + '/photo/site', { on: false })).status, 403);
  // and back on, by himself
  assert.equal((await me.post('/api/v1/staff/' + jk.id + '/photo/site', { on: true })).status, 200);
  assert.equal((await browser(rt).get((await pub(rt)).barbers.find((x) => x.name === 'JKut').photo)).status, 200);
  // the owner, for a colleague and for himself
  assert.equal((await b.post('/api/v1/staff/' + ls.id + '/photo/site', { on: false })).status, 200);
  assert.equal((await b.post('/api/v1/staff/' + owner().id + '/photo/site', { on: false })).status, 200);
  assert.deepEqual((await pub(rt)).barbers.filter((x) => x.photo).map((x) => x.name), ['JKut', 'Esteban']);
  // nothing written when nothing changes
  const n = rt.engine.journal.length;
  assert.equal((await b.post('/api/v1/staff/' + ls.id + '/photo/site', { on: false })).status, 200);
  assert.equal(rt.engine.journal.length, n);
  // no photo, nothing to show
  assert.equal((await b.post('/api/v1/staff/' + jk.id + '/photo', { data: '' })).status, 200);
  assert.equal((await b.post('/api/v1/staff/' + jk.id + '/photo/site', { on: true })).json.error.code, 'no_photo');
});

test('a photo a barber sets himself stays off the site until he says so; one the owner sets is on', async () => {
  const { rt, b, s, byName } = await fresh();
  const jk = byName('JKut');
  const me = await asBarber(rt, b, 'JKut');
  const up = await me.post('/api/v1/staff/' + jk.id + '/photo', { data: webp(2500) });
  assert.deepEqual([up.status, up.json.photoSite], [200, false]);
  assert.equal(rt.engine.journal.at(-1).data.site, undefined, 'the chain says nothing when it is off');
  assert.equal((await pub(rt)).barbers.find((x) => x.name === 'JKut').photo, undefined);
  await me.post('/api/v1/staff/' + jk.id + '/photo/site', { on: true });
  assert.ok((await pub(rt)).barbers.find((x) => x.name === 'JKut').photo);
  // the owner sets a new one: shown
  const up2 = await b.post('/api/v1/staff/' + jk.id + '/photo', { data: webp(2600) });
  assert.equal(up2.json.photoSite, true);
  assert.equal(rt.engine.journal.at(-1).data.site, true);
  assert.equal(s().staff.get(jk.id).photoSite, true);
  // his own again, through the command itself: a staff.photo without `site` (as every one written before the switch) reads « off »
  const as = { actor: { t: 'staff', id: jk.id }, staff: s().staff.get(jk.id), caps: capsOf(s().staff.get(jk.id), s().settings) };
  await rt.engine.run(setPhoto, { staffId: jk.id, data: webp(2700) }, as);
  assert.equal(rt.engine.journal.at(-1).data.site, undefined);
  assert.equal(s().staff.get(jk.id).photoSite, false);
});

test('an archived barber’s photo leaves the site at once, and a barber taken off the site has none there', async () => {
  const { rt, b, byName } = await fresh();
  const es = byName('Esteban');
  const url = (await pub(rt)).barbers.find((x) => x.name === 'Esteban').photo;
  assert.equal((await browser(rt).get(url)).status, 200);
  assert.equal((await b.post('/api/v1/staff/' + es.id + '/archive', {})).status, 200);
  assert.equal((await browser(rt).get(url)).status, 404);
  assert.ok(!(await pub(rt)).barbers.some((x) => x.name === 'Esteban'));
  // not bookable online (Équipe › « Réservable en ligne » off): no photo on the site either
  const ls = byName('Le Soldat');
  const lsUrl = (await pub(rt)).barbers.find((x) => x.name === 'Le Soldat').photo;
  assert.equal((await b.patch('/api/v1/staff/' + ls.id, { bookable: false })).status, 200);
  assert.equal((await browser(rt).get(lsUrl)).status, 404);
});

test('the channel the site names: SMS by default, WhatsApp once the salon’s number is set and its texts leave by WhatsApp', async () => {
  const { rt, owner } = await fresh();
  const as = () => ({ actor: { t: 'staff', id: owner().id }, staff: owner(), caps: capsOf(owner(), rt.engine.state.settings) });
  // no SMS provider here: without a WhatsApp number the site keeps saying SMS (and `sms` says whether one really leaves)
  let p = await pub(rt);
  assert.deepEqual([p.channel, p.whatsapp, p.sms], ['sms', null, false]);
  // the number, texts sent by hand from the salon's phone: WhatsApp
  await rt.engine.run(updateSettings, { messages: { whatsapp: { number: '+33612345678', mode: 'phone' } } }, as());
  p = await pub(rt);
  assert.deepEqual([p.channel, p.whatsapp], ['whatsapp', '33612345678']);
  // a number but SMS chosen, with an SMS provider plugged in: SMS
  rt.sms = { send: async () => ({ id: 'x' }) };
  await rt.engine.run(updateSettings, { messages: { whatsapp: { number: '+33612345678', mode: 'sms' } } }, as());
  assert.equal((await pub(rt)).channel, 'sms');
  rt.sms = null;
});

test('the site and the three booking pages name the salon’s channel and show only the portraits the salon gives', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  for (const f of ['public/site.html', 'public/refonte/express.js', 'public/refonte/planning.js', 'public/refonte/barbier.js']) {
    const src = read(f);
    assert.match(src, /\.channel === 'whatsapp'/, f + ' reads salon.channel');
    assert.ok(src.replace(/\\\//g, '/').includes('/api/public/barbers/'), f + ' takes the salon’s photo addresses (and nothing else)');
    assert.ok(!/confirmation par SMS|Rappel par SMS/.test(src), f + ' hard-codes SMS for the confirmation or the reminder');
  }
  // the simulations: the five real names, each with his portrait, a file that exists
  for (const f of ['express', 'planning', 'barbier']) {
    const src = read('public/refonte/' + f + '.js');
    for (const n of ['Frank', 'JKut', 'Aland', 'Esteban', 'Le Soldat']) assert.ok(src.includes("'" + n + "'"), f + ': ' + n);
  }
  for (const slug of ['frank', 'jkut', 'aland', 'esteban', 'le-soldat']) assert.ok(existsSync(new URL('../../public/img/equipe/' + slug + '.webp', import.meta.url)), slug);
  // the logo: a mark in each header, the whole roundel in each footer, the share image
  for (const f of ['public/site.html', 'public/refonte/express.html', 'public/refonte/planning.html', 'public/refonte/barbier.html']) {
    const src = read(f);
    assert.match(src, /class="wm-logo"/, f);
    assert.match(src, /class="ft-mark"/, f);
    assert.match(src, /og-larchitecte\.jpg/, f);
  }
  assert.ok(existsSync(new URL('../../public/img/og-larchitecte.jpg', import.meta.url)));
});
