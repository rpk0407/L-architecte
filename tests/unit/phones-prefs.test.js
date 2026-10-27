// TEAM-02: the Comptoir in each barber's pocket. A 10-minute, single-use link enrolls his own phone; on it only his
// code opens, about once a day (12 h idle instead of 10 min); he or the owner removes it. His prefs are his alone and
// never reload everyone's boot; his photo lives in pii (erasable) and is checked for what it claims to be; his agenda
// reaches his phone's calendar without a number, a note, a price, or (unless he asks) a name.
import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { salon, at, rejects } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { createRuntime } from '../../server/http/runtime.js';
import { signLink } from '../../server/auth/session.js';
import { setPrefs, setPhoto, archiveStaff, issuePhoneLink, addStaff, setCredentials } from '../../server/commands/team.js';
import { hashSecret } from '../../server/auth/password.js';
import { capsOf } from '../../server/domain/permissions.js';
import { limited } from '../../server/http/kit.js';
import { linkIpKey, LINK_IP_PER_HOUR } from '../../server/domain/linkcap.js';
import { addClient } from '../../server/commands/clients.js';
import { createAppointment, cancelAppointment } from '../../server/commands/agenda.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { prefsDefaults, PHONE_MISSES } from '../../server/projections/staffprefs.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
const MIN = 60000, HOUR = 60 * MIN;
let rt, ids;
before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
});

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** someone on a salon tablet, by PIN */
async function onTablet(name) {
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  const r = await b.post('/api/auth/pin', { staffId: ids[name], pin: DEMO.pins[name] });
  assert.equal(r.status, 200, r.text);
  return b;
}
const tokenOf = (url) => decodeURIComponent(url.split('/comptoir/lier/')[1]);
async function link(from, name) {
  const r = await from.post('/api/v1/staff/' + ids[name] + '/phone-link');
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.url, /^https:\/\/salon\.test\/comptoir\/lier\//);
  assert.equal(r.json.exp, clock.now + 10 * MIN);
  return tokenOf(r.json.url);
}
/** a new phone that follows the link and types its code */
async function phoneOf(token, name) {
  const p = browser(rt);
  const peek = await p.get('/api/auth/link/' + encodeURIComponent(token));
  assert.equal(peek.status, 200, peek.text);
  assert.equal(peek.json.staff.name, name);
  const r = await p.post('/api/auth/link', { token, name: 'iPhone de ' + name });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.staff, { id: ids[name], name });
  return p;
}
const lastDevice = () => [...rt.engine.state.devices.values()].at(-1);
const setTeam = async (team) => assert.equal((await (await owner()).patch('/api/v1/settings', { team })).status, 200);

test('a phone link enrolls a personal device, once, for 10 minutes, and only when the salon allows it', async () => {
  const jk = await onTablet('JKut');
  const token = await link(jk, 'JKut');
  const phone = await phoneOf(token, 'JKut');
  assert.ok(phone.jar.get('lx_d'), 'the device cookie is set');
  const d = lastDevice();
  assert.equal(d.personal, true);
  assert.equal(d.staffId, ids.JKut);
  assert.equal(d.name, 'iPhone de JKut');
  // the device event names its owner and the link; its actor is the person himself, so the feed tells the owner
  const ev = rt.engine.journal.at(-1);
  assert.equal(ev.type, 'device.enrolled');
  assert.equal(ev.actor.id, ids.JKut);
  const feed = (await (await owner()).get('/api/v1/feed')).json.items;
  assert.ok(feed.some((f) => f.title === 'JKut a lié un téléphone (iPhone de JKut)' && f.staffId === null), 'the owner hears of it');
  const franks = (await (await onTablet('Frank')).get('/api/v1/feed')).json.items;
  assert.ok(!franks.some((f) => f.kind === 'phone'), 'a colleague does not');

  // the same link again: used
  const again = await browser(rt).post('/api/auth/link', { token });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.message, 'Ce lien a déjà servi. Demande-en un nouveau.');
  assert.equal((await browser(rt).get('/api/auth/link/' + encodeURIComponent(token))).status, 409);
  // a fresh one, after 10 minutes: expired
  const late = await link(jk, 'JKut');
  clock.now += 10 * MIN + 1000;
  const r = await browser(rt).post('/api/auth/link', { token: late });
  assert.equal(r.status, 410);
  assert.equal(r.json.error.message, 'Ce lien a expiré.');
  // a forged or altered one
  assert.equal((await browser(rt).post('/api/auth/link', { token: late.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })).status, 404);
  assert.equal((await browser(rt).post('/api/auth/link', { token: 'st_x~zz~pl_x.abc' })).status, 404);

  // someone else's phone link: the owner's (team) or his own, nobody else's
  const fr = await onTablet('Frank');
  assert.equal((await fr.post('/api/v1/staff/' + ids.JKut + '/phone-link')).status, 403);
  assert.equal((await (await owner()).post('/api/v1/staff/' + ids.Frank + '/phone-link')).status, 200);
  // the salon turned linked phones off (his tablet session went idle meanwhile: his code again)
  const jk2 = await onTablet('JKut');
  await setTeam({ personalPhones: false });
  const off = await jk2.post('/api/v1/staff/' + ids.JKut + '/phone-link');
  assert.equal(off.status, 403);
  assert.equal(off.json.error.code, 'phones_off');
  await setTeam({ personalPhones: true });
});

test('on his phone: his face alone, his code alone, once a day; a salon tablet still locks after 10 minutes', async () => {
  const jk = await onTablet('JKut');
  const phone = await phoneOf(await link(jk, 'JKut'), 'JKut');
  const st = await phone.get('/api/auth/state');
  assert.deepEqual(st.json.team.map((x) => x.name), ['JKut']);
  assert.equal(st.json.device.personal, true);
  const frank = await phone.post('/api/auth/pin', { staffId: ids.Frank, pin: DEMO.pins.Frank });
  assert.equal(frank.status, 403);
  assert.equal(frank.json.error.code, 'not_yours');
  const ok = await phone.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.me.device.personal, true);
  assert.equal(ok.json.me.prefs.notify, 'mine', 'a barber’s default: his own clients');

  const tablet = await onTablet('Frank');
  // 3 hours in his pocket, not a request: still signed in
  clock.now += 3 * HOUR;
  assert.equal((await phone.get('/api/v1/bootstrap')).status, 200);
  // the tablet's session went idle long ago
  const t = await tablet.get('/api/v1/bootstrap');
  assert.equal(t.status, 401);
  assert.equal(t.json.error.code, 'pin_idle');
  // 13 hours: his code again
  clock.now += 13 * HOUR;
  const idle = await phone.get('/api/v1/bootstrap');
  assert.equal(idle.status, 401);
  assert.equal(idle.json.error.code, 'pin_idle');
  assert.match(idle.json.error.message, /12 h/);

  // a salon tablet: refused 11 minutes after its last request
  const tab2 = await onTablet('Esteban');
  clock.now += 9 * MIN;
  assert.equal((await tab2.get('/api/v1/bootstrap')).status, 200);
  clock.now += 11 * MIN;
  assert.equal((await tab2.get('/api/v1/bootstrap')).status, 401);
});

test('he removes his phone: its session ends at the next request; the owner can remove it too', async () => {
  const jk = await onTablet('JKut');
  const phone = await phoneOf(await link(jk, 'JKut'), 'JKut');
  assert.equal((await phone.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  const list = await phone.get('/api/v1/staff/' + ids.JKut + '/phones');
  const mine = list.json.items.find((x) => x.current);
  assert.ok(mine, 'the phone sees itself in the list');
  // a colleague cannot list or remove it
  const fr = await onTablet('Frank');
  assert.equal((await fr.get('/api/v1/staff/' + ids.JKut + '/phones')).status, 403);
  assert.equal((await fr.del('/api/v1/staff/' + ids.JKut + '/phones/' + mine.id)).status, 403);
  assert.equal((await phone.del('/api/v1/staff/' + ids.JKut + '/phones/' + mine.id)).status, 200);
  assert.equal((await phone.get('/api/v1/bootstrap')).status, 401);
  assert.equal(rt.engine.state.devices.get(mine.id).revoked, true);

  // the owner removes another one from the salon post
  const p2 = await phoneOf(await link(jk, 'JKut'), 'JKut');
  assert.equal((await p2.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  const did = lastDevice().id;
  assert.equal((await (await owner()).del('/api/v1/staff/' + ids.JKut + '/phones/' + did)).status, 200);
  assert.equal((await p2.get('/api/v1/bootstrap')).status, 401);
  // personal phones turned off: his phone no longer opens
  const p3 = await phoneOf(await link(jk, 'JKut'), 'JKut');
  assert.equal((await p3.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  await setTeam({ personalPhones: false });
  assert.equal((await p3.get('/api/v1/bootstrap')).status, 401);
  await setTeam({ personalPhones: true });
});

test('prefs: one’s own only, never a reload for the others, unknown keys dropped, bounded lists', async () => {
  const jk = await onTablet('JKut');
  const v0 = rt.engine.state.cfgVersion;
  const r = await jk.patch('/api/v1/prefs', { home: 'agenda', notify: 'all', buzz: false, cards: ['prochain', 'journee'], hidden: ['avis'], blur: 'on', calName: true, cal: 999, shoeSize: 44 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.prefs.home, 'agenda');
  assert.equal(r.json.prefs.cal, 0, 'the calendar generation is the calendar route’s');
  const ev = rt.engine.journal.at(-1);
  assert.equal(ev.type, 'prefs.set');
  assert.ok(!('shoeSize' in ev.data.prefs) && !('cal' in ev.data.prefs));
  assert.equal(rt.engine.state.cfgVersion, v0, 'prefs.set does not reload anyone’s boot');
  assert.deepEqual((await jk.get('/api/v1/bootstrap')).json.me.prefs, { ...prefsDefaults('barber'), home: 'agenda', notify: 'all', buzz: false, cards: ['prochain', 'journee'], hidden: ['avis'], blur: 'on', calName: true });
  // the same again writes nothing
  const n = rt.engine.state.version;
  await jk.patch('/api/v1/prefs', { home: 'agenda' });
  assert.equal(rt.engine.state.version, n);
  const big = await jk.patch('/api/v1/prefs', { cards: Array.from({ length: 21 }, (_, i) => 'c' + i) });
  assert.equal(big.status, 400);
  assert.equal((await jk.patch('/api/v1/prefs', { home: 'cockpit' })).status, 400);
  // someone else's: refused, whatever his rights
  const o = rt.engine.state.staff.get(ids.Gérant) || [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = { actor: { t: 'staff', id: o.id }, staff: o, caps: new Set(['team', 'settings']) };
  await rejects(rt.engine.run(setPrefs, { staffId: ids.JKut, prefs: { home: 'espace' } }, asOwner), 'forbidden');
  // the owner and the desk hear about the whole salon by default
  assert.equal(prefsDefaults('owner').notify, 'all');
  assert.equal(prefsDefaults('desk').notify, 'all');
});

/** a JPEG of `n` bytes (its magic number, then filler) as the browser would send it */
const jpeg = (n) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 7)]).toString('base64');
const png = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 1)]).toString('base64');

test('photo: checked, served to the team, in pii only, and gone for good when replaced or removed', async () => {
  const jk = await onTablet('JKut');
  const v0 = rt.engine.state.cfgVersion;
  assert.equal((await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: jpeg(30 * 1024) })).status, 400, '30 KB is too heavy');
  assert.equal((await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: png })).status, 400, 'a PNG renamed as JPEG');
  assert.equal((await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  // a colleague's photo: the owner's (team) only
  assert.equal((await jk.post('/api/v1/staff/' + ids.Frank + '/photo', { data: jpeg(3000) })).status, 403);

  const up = await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: jpeg(3000) });
  assert.equal(up.status, 200, up.text);
  const v = up.json.photo;
  const ev = rt.engine.journal.at(-1);
  assert.equal(ev.type, 'staff.photo');
  assert.deepEqual(ev.data, { id: ids.JKut, v }, 'the chain holds the version only');
  assert.equal(ev.pii.photo, jpeg(3000));
  assert.ok(rt.engine.state.cfgVersion > v0, 'staff.photo refreshes everyone’s faces');
  // staffView carries the version
  const boot = (await (await onTablet('Frank')).get('/api/v1/bootstrap')).json;
  assert.equal(boot.staff.find((x) => x.id === ids.JKut).photo, v);
  // any colleague reads it, cacheable for good under its version
  const fr = await onTablet('Frank');
  const img = await fr.get('/api/v1/staff/' + ids.JKut + '/photo?v=' + v);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal((await fr.get('/api/v1/staff/' + ids.JKut + '/photo?v=1')).status, 404, 'an old version');
  // the sign-in faces: a salon device only, no session needed
  const tablet = await owner();
  await tablet.post('/api/auth/device', { name: 'Poste 2' });
  await tablet.post('/api/auth/logout');
  assert.equal((await tablet.get('/api/auth/photo/' + ids.JKut + '?v=' + v)).status, 200);
  assert.equal((await browser(rt).get('/api/auth/photo/' + ids.JKut + '?v=' + v)).status, 404, 'a stranger’s browser');
  assert.equal((await browser(rt).get('/api/v1/staff/' + ids.JKut + '/photo?v=' + v)).status, 401);

  // replaced: the first copy leaves the journal (memory and store)
  const up2 = await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: jpeg(4000) });
  assert.equal(up2.status, 200);
  const photos = () => rt.engine.journal.filter((e) => e.type === 'staff.photo' && e.data.id === ids.JKut);
  assert.equal(photos().filter((e) => e.pii).length, 1);
  assert.equal((await rt.store.read(0)).events.filter((e) => e.type === 'staff.photo' && e.pii).length, 1);
  assert.equal(rt.engine.verify().ok, true);
  // removed: none left, and GET says so
  assert.equal((await jk.post('/api/v1/staff/' + ids.JKut + '/photo', { data: '' })).status, 200);
  assert.equal(photos().filter((e) => e.pii).length, 0);
  assert.equal((await fr.get('/api/v1/staff/' + ids.JKut + '/photo')).status, 404);
  assert.equal(rt.engine.verify().ok, true);
  // a replay of the redacted journal gives the same state
  const s = emptyState();
  for (const e of (await rt.store.read(0)).events) evolve(s, e);
  assert.equal(s.staffPhotos.has(ids.JKut), false);
  assert.equal(s.staff.get(ids.JKut).photoV, 0);
});

test('archiving a member removes his photo with him', async () => {
  const fx = await salon();
  await fx.engine.run(setPhoto, { staffId: fx.ids.Ali, data: jpeg(2000) }, fx.asStaff('Ali'));
  assert.equal(fx.engine.state.staffPhotos.has(fx.ids.Ali), true);
  await fx.engine.run(archiveStaff, { id: fx.ids.Ali }, fx.asOwner());
  assert.equal(fx.engine.state.staffPhotos.has(fx.ids.Ali), false);
  assert.equal((await fx.store.read(0)).events.filter((e) => e.type === 'staff.photo' && e.pii).length, 0);
  assert.equal(fx.engine.verify().ok, true);
});

test('calendar: his appointments, cancellations marked, no number, note, price or name; a new link cuts the old', async () => {
  const fx = await salon({ hour: 9 });
  const secret = 'cal-secret-0123456789abcdef';
  const crt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: secret }, clock: () => fx.clock.now, store: fx.store });
  const ali = fx.ids.Ali;
  const c = await fx.engine.run(addClient, { first: 'Karim', last: 'Bensaïd', phone: '06 98 76 54 32', notes: 'Allergique au parfum', tech: 'Dégradé à blanc, 0,5 sur les côtés' }, fx.asOwner());
  const book = async (day, start, staffId = ali) => (await fx.engine.run(createAppointment, { clientId: c.id, serviceIds: [fx.ids.beard], staffId, day, start }, fx.asOwner())).id;
  await book('2026-11-04', 600);
  await book('2026-11-05', 660);
  const gone = await book('2026-11-06', 720);
  await fx.engine.run(cancelAppointment, { id: gone }, fx.asOwner());
  await book('2026-11-04', 600, fx.ids.Ben); // another chair
  await book('2027-02-02', 600); // beyond 45 days

  const asAli = () => fx.asStaff('Ali');
  await fx.engine.run(setPrefs, { staffId: ali, prefs: { cal: 1 } }, asAli());
  const b = browser(crt);
  const url = (gen) => '/api/cal/team/' + signLink(crt.secret, 'teamcal', ali + '~' + gen) + '.ics';
  const r = await b.get(url(1));
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('content-type'), /^text\/calendar/);
  const body = r.text;
  assert.equal(body.split('BEGIN:VEVENT').length - 1, 3);
  assert.equal(body.split('STATUS:CANCELLED').length - 1, 1);
  assert.match(body, /SUMMARY:Coupe \+ barbe · 1re visite/);
  // the next one counts the bookings ahead of it (on any chair), not only the visits already done
  assert.match(body, /SUMMARY:Coupe \+ barbe · 3e visite/);
  assert.ok(!/DESCRIPTION:[^\r]*visite/.test(body), 'the visit is said once, in the summary');
  assert.match(body, /BEGIN:VTIMEZONE/);
  for (const bad of ['0698765432', '06 98', '98 76 54 32', '5432', '+33', 'Allergique', 'Dégradé', 'Karim', 'Bensa', '€', '30,00', '/r/', 'http']) assert.ok(!body.includes(bad), 'the feed shows ' + bad);
  for (const line of body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'folded: ' + line);

  // the first name, when he asks for it: never the surname or its initial
  await fx.engine.run(setPrefs, { staffId: ali, prefs: { calName: true } }, asAli());
  const named = (await b.get(url(1))).text;
  assert.match(named, /SUMMARY:Karim · Coupe \+ barbe · 1re visite/);
  assert.ok(!named.includes('Bensa') && !/Karim B\b/.test(named));

  // a new link: the old one answers 404
  await fx.engine.run(setPrefs, { staffId: ali, prefs: { cal: 2 } }, asAli());
  assert.equal((await b.get(url(1))).status, 404);
  assert.equal((await b.get(url(2))).status, 200);
  // an old generation never comes back, a forged token never opens
  await rejects(fx.engine.run(setPrefs, { staffId: ali, prefs: { cal: 1 } }, asAli()), 'stale');
  assert.equal((await b.get(url(2).replace(/\.ics$/, 'x.ics'))).status, 404);
  // the salon turned the feeds off
  const o = fx.engine.state.staff.get(fx.ownerId);
  const { updateSettings } = await import('../../server/commands/shop.js');
  await fx.engine.run(updateSettings, { team: { staffCalendar: false } }, fx.asOwner());
  assert.equal((await b.get(url(2))).status, 404);
  await fx.engine.run(updateSettings, { team: { staffCalendar: true } }, fx.asOwner());
  // off: no feed
  await fx.engine.run(setPrefs, { staffId: ali, prefs: { cal: 0 } }, asAli());
  assert.equal((await b.get(url(2))).status, 404);
  assert.ok(o);
});

test('ten wrong codes in a row remove the phone, whatever restarts in between; the right code resets the count', async () => {
  // the PIN route's own limits count in real time (5 failures per 5 minutes): the fake Date lets the test outlast them
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const jk = await onTablet('JKut');
    const phone = await phoneOf(await link(jk, 'JKut'), 'JKut');
    assert.equal((await phone.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
    const did = lastDevice().id;
    const wrong = () => phone.post('/api/auth/pin', { staffId: ids.JKut, pin: '0007' });
    const misses = async (n) => { for (let i = 0; i < n; i++) { if (i && i % 5 === 0) mock.timers.tick(5 * MIN + 1000); assert.equal((await wrong()).status, 401); } mock.timers.tick(5 * MIN + 1000); };
    // nine, then the right code: the count starts again
    await misses(9);
    assert.equal(rt.engine.state.phoneMisses.get(did), 9);
    assert.equal((await phone.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
    assert.equal(rt.engine.state.phoneMisses.has(did), false);
    // the count lives in the journal: a fresh instance (a cold start) reads the same
    await misses(PHONE_MISSES - 1);
    const cold = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store: rt.store });
    await cold.engine.sync(true);
    assert.equal(cold.engine.state.phoneMisses.get(did), PHONE_MISSES - 1);
    // the tenth: removed, its open session ends at the next request
    const last = await wrong();
    assert.equal(last.status, 403);
    assert.equal(last.json.error.code, 'phone_locked');
    assert.equal(rt.engine.state.devices.get(did).revoked, true);
    assert.equal((await phone.get('/api/v1/bootstrap')).status, 401);
    const st = await phone.get('/api/auth/state');
    assert.equal(st.json.device, null);
    assert.equal(st.json.phoneRemoved, true, 'the phone says it was removed');
    const pin = await phone.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut });
    assert.equal(pin.status, 403);
    assert.equal(pin.json.error.code, 'phone_removed');
    assert.equal(pin.json.error.message, 'Ce téléphone a été retiré. Demande un nouveau QR code.');
    // the owner and JKut hear of it
    const feed = (await (await owner()).get('/api/v1/feed')).json.items;
    assert.ok(feed.some((f) => f.title === 'Téléphone de JKut retiré après 10 codes faux (iPhone de JKut)'), 'the owner is told');
    // a salon tablet counts nothing in the journal
    const tablet = await onTablet('Frank');
    const n = rt.engine.state.version;
    assert.equal((await tablet.post('/api/auth/pin', { staffId: ids.Frank, pin: '0007' })).status, 401);
    assert.equal(rt.engine.state.version, n);
  } finally { mock.timers.reset(); }
});

test('a manager links a barber’s phone, never the owner’s; the owner links anyone’s', async () => {
  const s = rt.engine.state;
  const o = [...s.staff.values()].find((x) => x.role === 'owner' && x.active);
  const asO = { actor: { t: 'staff', id: o.id }, staff: o, caps: capsOf(o, s.settings) };
  const m = await rt.engine.run(addStaff, { name: 'Sami', role: 'manager' }, asO);
  await rt.engine.run(setCredentials, { id: m.id, pinHash: await hashSecret('4826') }, asO);
  const mgr = s.staff.get(m.id);
  const asM = { actor: { t: 'staff', id: mgr.id }, staff: mgr, caps: capsOf(mgr, s.settings) };
  await rejects(rt.engine.run(issuePhoneLink, { staffId: o.id }, asM), 'forbidden');
  assert.ok((await rt.engine.run(issuePhoneLink, { staffId: ids.JKut }, asM)).id);
  // his own, yes; the owner links the manager's
  assert.ok((await rt.engine.run(issuePhoneLink, { staffId: mgr.id }, asM)).id);
  assert.ok((await rt.engine.run(issuePhoneLink, { staffId: mgr.id }, asO)).id);
  // over HTTP the same: the manager on a salon tablet
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette 3' })).status, 200);
  await b.post('/api/auth/logout');
  assert.equal((await b.post('/api/auth/pin', { staffId: mgr.id, pin: '4826' })).status, 200);
  assert.equal((await b.post('/api/v1/staff/' + o.id + '/phone-link')).status, 403);
  assert.equal((await b.post('/api/v1/staff/' + ids.Frank + '/phone-link')).status, 200);
  await rt.engine.run(archiveStaff, { id: mgr.id }, asO);
});

test('one browser, one linked phone: linking again or « Oublier cet appareil » leaves no ghost', async () => {
  const jk = await onTablet('JKut');
  const active = (id) => [...rt.engine.state.devices.values()].filter((d) => d.personal && d.staffId === id && !d.revoked).length;
  const before = active(ids.JKut);
  const phone = await phoneOf(await link(jk, 'JKut'), 'JKut');
  const first = lastDevice().id;
  assert.equal(active(ids.JKut), before + 1);
  // the same browser scans a new QR: the old device goes with its overwritten cookie
  const again = await phone.post('/api/auth/link', { token: await link(jk, 'JKut') });
  assert.equal(again.status, 200, again.text);
  assert.equal(rt.engine.state.devices.get(first).revoked, true);
  assert.equal(active(ids.JKut), before + 1);
  // handed to Frank: JKut's phone leaves his list
  const second = lastDevice().id;
  const fr = await onTablet('Frank');
  const frBefore = active(ids.Frank);
  assert.equal((await phone.post('/api/auth/link', { token: await link(fr, 'Frank') })).status, 200);
  assert.equal(rt.engine.state.devices.get(second).revoked, true);
  assert.equal(active(ids.JKut), before);
  assert.equal(active(ids.Frank), frBefore + 1);
  // « Oublier cet appareil » on a linked phone removes it
  const third = lastDevice().id;
  assert.equal((await phone.post('/api/auth/pin', { staffId: ids.Frank, pin: DEMO.pins.Frank })).status, 200);
  assert.equal((await phone.post('/api/auth/forget-device')).status, 200);
  assert.equal(rt.engine.state.devices.get(third).revoked, true);
  assert.equal(active(ids.Frank), frBefore);
});

test('linking phones never eats the clients’ « send me a link » allowance from the same wifi', async () => {
  const ip = '10.77.0.1';
  const shop = browser(rt, { ip });
  // four barbers peeking and linking from the salon's wifi (invalid links still count against the phone window)
  for (let i = 0; i < 8; i++) assert.equal((await shop.get('/api/auth/link/x' + i)).status, 404);
  // the clients' window for this address is untouched: all of its asks are left
  for (let i = 0; i < LINK_IP_PER_HOUR; i++) assert.equal(limited(linkIpKey(ip), LINK_IP_PER_HOUR, HOUR), false, 'ask ' + (i + 1));
  assert.equal(limited(linkIpKey(ip), LINK_IP_PER_HOUR, HOUR), true);
});

test('archiving a member removes his phones and cuts his calendar: reactivating him brings neither back', async () => {
  const s = rt.engine.state;
  const o = [...s.staff.values()].find((x) => x.role === 'owner' && x.active);
  const asO = { actor: { t: 'staff', id: o.id }, staff: o, caps: capsOf(o, s.settings) };
  const es = await onTablet('Esteban');
  const phone = await phoneOf(await link(es, 'Esteban'), 'Esteban');
  const did = lastDevice().id;
  const cal = await es.post('/api/v1/prefs/calendar', { on: true });
  assert.equal(cal.status, 200, cal.text);
  const feed = new URL(cal.json.https).pathname;
  assert.equal((await browser(rt).get(feed)).status, 200);
  await rt.engine.run(archiveStaff, { id: ids.Esteban }, asO);
  await rt.engine.run(archiveStaff, { id: ids.Esteban, restore: true }, asO);
  assert.equal(s.devices.get(did).revoked, true);
  assert.equal((await phone.post('/api/auth/pin', { staffId: ids.Esteban, pin: DEMO.pins.Esteban })).status, 403);
  assert.equal((await browser(rt).get(feed)).status, 404, 'the old webcal address stays dead');
  assert.equal(s.prefs.get(ids.Esteban).cal, 0);
});

test('the calendar link comes from what was stored: a retried request gets the same working address', async () => {
  const jk = await onTablet('JKut');
  const h = { 'x-request-id': 'cal-retry-0001' };
  const a = await jk.post('/api/v1/prefs/calendar', { on: true }, h);
  assert.equal(a.status, 200, a.text);
  const b = await jk.post('/api/v1/prefs/calendar', { on: true }, h);
  assert.equal(b.json.url, a.json.url);
  assert.equal((await browser(rt).get(new URL(a.json.https).pathname)).status, 200);
  // a new request: a new generation, the old address dead
  const c = await jk.post('/api/v1/prefs/calendar', { on: true });
  assert.notEqual(c.json.url, a.json.url);
  assert.equal((await browser(rt).get(new URL(a.json.https).pathname)).status, 404);
  assert.equal((await browser(rt).get(new URL(c.json.https).pathname)).status, 200);
  // the activity log names it in French
  const audit = (await (await owner()).get('/api/v1/audit')).json;
  const items = audit.items || audit.events || [];
  const link = items.find((x) => x.type === 'phone.linkIssued');
  assert.ok(link && link.label === 'Lien de téléphone créé' && /^pour /.test(link.summary), JSON.stringify(link));
  assert.ok(items.filter((x) => x.type === 'prefs.set').every((x) => x.label === 'Réglages personnels modifiés'));
});
