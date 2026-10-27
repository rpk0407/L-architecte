// The legal pages' fields (mentions légales, confidentialité, CGV) and the booking horizon matching WordPress.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { defaultSettings } from '../../server/settings/index.js';
import { CGV_TEXT, cgvVersionOf } from '../../server/settings/shop.js';
import { readFile } from 'node:fs/promises';

const clock = { now: at('2026-11-03', 10) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
let n = 0;
const rid = () => ({ 'x-request-id': 'legal-test-' + ++n });

test('defaults: the old site’s horizon, an EI hosted at Vercel with its data at Neon in the EU, a dated CGV', () => {
  const s = defaultSettings();
  assert.equal(s.booking.maxDaysAhead, 90);
  assert.equal(s.shop.legalForm, 'Entrepreneur individuel');
  assert.deepEqual(s.shop.host, { name: 'Vercel Inc.', address: '440 N Barranca Ave #4133, Covina, CA 91723, USA', phone: '+1 559 288 7060' });
  assert.equal(s.shop.dataHost, 'Neon (Union européenne)');
  assert.deepEqual(s.shop.mediator, { name: '', url: '' });
  assert.match(s.shop.cgvVersion, /^\d{4}-\d{2}-\d{2}$/);
  for (const k of ['registration', 'ape', 'publicationDirector']) assert.equal(s.shop[k], '', k);
});

test('PATCH /api/v1/settings takes the legal fields, and the site reads them from /api/public/salon', async () => {
  const b = await owner();
  const legal = {
    legalName: 'Frank Mariani EI', siret: '512 923 475 00028', ape: '9602A', legalForm: 'Entrepreneur individuel',
    registration: 'RNE 512 923 475', publicationDirector: 'Frank Mariani', phone: '06 12 34 56 78',
    mediator: { name: 'CM2C', url: 'https://www.cm2c.net' }, cgvVersion: '2026-11-03'
  };
  const r = await b.patch('/api/v1/settings', { shop: legal }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const pub = (await browser(rt).get('/api/public/salon')).json;
  for (const [k, v] of Object.entries(legal)) assert.deepEqual(pub.shop[k], v, k);
  assert.equal(pub.shop.host.name, 'Vercel Inc.', 'the defaults stay next to what was saved');
  assert.equal(pub.booking.maxDaysAhead, 90);
  assert.equal(pub.booking.cancelUntilHours, 12);

  // one nested field at a time: the rest of the object is kept
  assert.equal((await b.patch('/api/v1/settings', { shop: { mediator: { url: 'https://www.cm2c.net/declarer' } } }, rid())).status, 200);
  assert.deepEqual(rt.engine.state.settings.shop.mediator, { name: 'CM2C', url: 'https://www.cm2c.net/declarer' });
  // the owner can clear an optional link and the SIRET
  assert.equal((await b.patch('/api/v1/settings', { shop: { mediator: { url: '' }, siret: '' } }, rid())).status, 200);
  assert.equal(rt.engine.state.settings.shop.mediator.url, '');
  assert.equal(rt.engine.state.settings.shop.siret, '');
  assert.equal((await b.patch('/api/v1/settings', { shop: { siret: '51292347500028' } }, rid())).status, 200, 'digits without spaces');
});

test('bad legal fields are refused with a 400 that names the field, and nothing is saved', async () => {
  const b = await owner();
  const before = JSON.stringify(rt.engine.state.settings.shop);
  const bad = [
    [{ siret: '512 923 475' }, 'shop.siret : 14 chiffres attendus'],
    [{ siret: '512923475000289' }, 'shop.siret : 14 chiffres attendus'],
    [{ siret: '512-923-475-00028' }, 'shop.siret : format invalide'],
    [{ ape: '96A' }, 'shop.ape : format invalide'],
    [{ registration: 'x'.repeat(61) }, 'shop.registration : 60 caractères maximum'],
    [{ mediator: { url: 'http://mediateur.fr' } }, 'shop.mediator.url : format invalide'],
    [{ mediator: 'CM2C' }, 'shop.mediator : objet attendu'],
    [{ cgvVersion: '27/10/2026' }, 'shop.cgvVersion : date AAAA-MM-JJ attendue']
  ];
  for (const [shop, msg] of bad) {
    const r = await b.patch('/api/v1/settings', { shop }, rid());
    assert.equal(r.status, 400, JSON.stringify(shop));
    assert.equal(r.json.error.message, msg);
  }
  assert.equal(JSON.stringify(rt.engine.state.settings.shop), before);
  assert.equal((await b.patch('/api/v1/settings', { shop: { ape: '96.02a' } }, rid())).status, 200, 'the dotted form and lower case are fine');
});

test('only the owner changes them', async () => {
  assert.equal((await browser(rt).patch('/api/v1/settings', { shop: { legalName: 'Moi' } }, rid())).status, 401);
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette' }, rid())).status, 200);
  await tab.post('/api/auth/logout', {}, rid());
  const jkut = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === 'JKut');
  assert.equal((await tab.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut }, rid())).status, 200);
  assert.equal((await tab.patch('/api/v1/settings', { shop: { legalName: 'Moi' } }, rid())).status, 403);
  assert.notEqual(rt.engine.state.settings.shop.legalName, 'Moi');
});

test('a SIRET pasted from a Kbis PDF (non-breaking or narrow spaces) is taken, and the host keeps a name', async () => {
  const b = await owner();
  const r = await b.patch('/api/v1/settings', { shop: { siret: '512 923 475 00028' } }, rid());
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(rt.engine.state.settings.shop.siret, '512 923 475 00028');
  const h = await b.patch('/api/v1/settings', { shop: { host: { name: ' ' } } }, rid());
  assert.equal(h.status, 400);
  assert.equal(h.json.error.message, 'shop.host.name : obligatoire');
  assert.equal(rt.engine.state.settings.shop.host.name, 'Vercel Inc.');
});

test('the CGV version is dated by the server when the deposit or cancellation rules change, and never goes back', async () => {
  // a week on: sign in again on each new day
  clock.now = at('2026-11-10', 10);
  let b = await owner();
  const v = () => rt.engine.state.settings.shop.cgvVersion;
  const start = v();
  // a real day, not after today
  for (const [cgvVersion, msg] of [['2026-02-30', 'shop.cgvVersion : date AAAA-MM-JJ attendue'], ['2026-11-11', 'shop.cgvVersion : pas après aujourd’hui']]) {
    const r = await b.patch('/api/v1/settings', { shop: { cgvVersion } }, rid());
    assert.equal(r.status, 400, cgvVersion);
    assert.equal(r.json.error.message, msg);
  }
  // the same rules sent again (a whole section saved): no new version
  const s0 = rt.engine.state.settings;
  assert.equal((await b.patch('/api/v1/settings', { booking: { ...s0.booking }, deposits: { ...s0.deposits } }, rid())).status, 200);
  assert.equal(v(), start);
  // a new cancellation delay, without any version from the screen: dated today on the server's clock
  assert.equal((await b.patch('/api/v1/settings', { booking: { cancelUntilHours: 24 } }, rid())).status, 200);
  assert.equal(v(), '2026-11-10');
  // a screen loaded earlier resends the whole shop with its old version: the rest is saved, the version stays
  clock.now = at('2026-11-12', 10);
  b = await owner();
  assert.equal((await b.patch('/api/v1/settings', { shop: { email: 'contact@larchitecte.fr', cgvVersion: '2026-10-27' } }, rid())).status, 200);
  assert.equal(rt.engine.state.settings.shop.email, 'contact@larchitecte.fr');
  assert.equal(v(), '2026-11-10');
  // a deposit change dates it again; the public answer carries it
  assert.equal((await b.patch('/api/v1/settings', { deposits: { percent: 40 } }, rid())).status, 200);
  assert.equal(v(), '2026-11-12');
  assert.equal((await browser(rt).get('/api/public/salon')).json.shop.cgvVersion, '2026-11-12');
  // a bump by hand is still possible, forward only
  clock.now = at('2026-11-14', 10);
  b = await owner();
  assert.equal((await b.patch('/api/v1/settings', { shop: { cgvVersion: '2026-11-14' } }, rid())).status, 200);
  assert.equal(v(), '2026-11-14');
});

test('the CGV page declares the text date the server knows (CGV_TEXT), and the version in force is the newer of the two', async () => {
  const html = await readFile(new URL('../../public/cgv.html', import.meta.url), 'utf8');
  assert.equal(/data-cgv-text="(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1], CGV_TEXT, 'bump both together');
  assert.equal(cgvVersionOf({ cgvVersion: '2026-01-01' }), CGV_TEXT);
  assert.equal(cgvVersionOf({ cgvVersion: '2099-01-01' }), '2099-01-01');
  assert.equal(cgvVersionOf({}), CGV_TEXT);
});
