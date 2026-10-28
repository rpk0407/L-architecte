import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  const r = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return b;
}
async function salonDevice() {
  const b = await owner();
  const r = await b.post('/api/auth/device', { name: 'Tablette comptoir' });
  assert.equal(r.status, 200);
  await b.post('/api/auth/logout');
  return b;
}

test('sign-in: demo hints, wrong password, right password, session cookie', async () => {
  const b = browser(rt);
  const st = await b.get('/api/auth/state');
  assert.equal(st.json.mode, 'demo');
  assert.equal(st.json.me, null);
  const bad = await b.post('/api/auth/login', { email: DEMO.email, password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.message, 'E-mail ou mot de passe incorrect.');
  const unknown = await b.post('/api/auth/login', { email: 'x@y.fr', password: 'nope' });
  assert.equal(unknown.json.error.message, bad.json.error.message, 'no hint about which accounts exist');
  const ok = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(ok.status, 200);
  assert.ok(b.jar.has('lx_s'));
  const boot = await b.get('/api/v1/bootstrap');
  assert.equal(boot.json.me.role, 'owner');
  assert.equal(boot.json.staff.length, 6);
});

test('every staff route needs a session; changes need our own origin', async () => {
  const anon = browser(rt);
  assert.equal((await anon.get('/api/v1/agenda')).status, 401);
  const b = await owner();
  const evil = await b.post('/api/v1/blocks', { staffId: 'x', day: DAY, start: 600 }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(evil.status, 403);
  assert.equal(evil.json.error.code, 'origin');
  const form = await b.raw('POST', '/api/v1/blocks', 'staffId=x', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415, 'only JSON bodies');
});

test('PIN codes sent all at once count while they are checked: five answers, then « trop d’essais »', async () => {
  const tab = await salonDevice();
  const frank = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === 'Frank');
  const codes = Array.from({ length: 12 }, (_, i) => String(1000 + i));
  const res = await Promise.all(codes.map((pin) => tab.post('/api/auth/pin', { staffId: frank.id, pin })));
  const st = res.map((x) => x.status);
  assert.equal(st.filter((s) => s === 401).length, 5, st.join(' '));
  assert.equal(st.filter((s) => s === 429).length, 7, st.join(' '));
  // the right code too waits now: the five wrong ones are on the clock
  assert.equal((await tab.post('/api/auth/pin', { staffId: frank.id, pin: DEMO.pins.Frank })).status, 429);
});

test('the salon tablet: PIN sign-in, barbers see their scope only', async () => {
  const tab = await salonDevice();
  const st = await tab.get('/api/auth/state');
  assert.equal(st.json.device.name, 'Tablette comptoir');
  const jkut = st.json.team.find((x) => x.name === 'JKut');
  assert.ok(jkut);
  assert.equal((await tab.post('/api/auth/pin', { staffId: jkut.id, pin: '0000' })).status, 401);
  const ok = await tab.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut });
  assert.equal(ok.status, 200);
  assert.ok(!ok.json.me.caps.includes('settings'));
  assert.equal((await tab.get('/api/v1/settings')).status, 403);
  assert.equal((await tab.get('/api/v1/export?kind=clients')).status, 403);
  const ag = await tab.get('/api/v1/agenda?day=' + DAY);
  assert.equal(ag.status, 200);
  assert.equal(ag.json.lanes.length, 4);
  assert.equal(ag.json.kpis.scope, 'own');
  const someClient = ag.json.appts.find((a) => a.client && a.client.hasPhone);
  assert.match(someClient.client.phone, /••/, 'barbers see masked phone numbers');
  const rep = await tab.get('/api/v1/reports');
  assert.equal(rep.json.scope, 'own');
});

test('a PIN only works on an enrolled salon device', async () => {
  const phone = browser(rt);
  const r = await phone.post('/api/auth/pin', { staffId: 'st_x', pin: '2468' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'no_device');
});

test('client books online: availability → hold → booking → manage link', async () => {
  const site = browser(rt);
  const salon = await site.get('/api/public/salon');
  assert.ok(salon.json.services.length >= 10);
  assert.match(salon.headers.get('cache-control'), /s-maxage/);
  const cut = salon.json.services.find((s) => s.slug === 'cl');
  const av = await site.get(`/api/public/availability?services=${cut.id}&staff=any&from=${DAY}&days=3`);
  const day = av.json.days.find((d) => d.slots.length);
  const slot = day.slots[0];
  const hold = await site.post('/api/public/holds', { serviceIds: [cut.id], staffId: 'any', day: day.day, start: slot.m });
  assert.equal(hold.status, 200, JSON.stringify(hold.json));
  const book = await site.post('/api/public/bookings', { holdId: hold.json.holdId, serviceIds: [cut.id], staffId: 'any', day: day.day, start: slot.m, first: 'Léon', phone: '06 77 88 99 00', sms: true });
  assert.equal(book.status, 201, JSON.stringify(book.json));
  assert.equal(book.json.status, 'booked');
  const mine = await site.get('/api/public/bookings/' + book.json.token);
  assert.equal(mine.json.first, 'Léon');
  assert.equal(mine.json.status, 'booked');
  const forged = await site.get('/api/public/bookings/' + book.json.code + '.AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(forged.status, 404, 'a guessed code is not enough');
  const b = await owner();
  const feed = await b.get('/api/v1/pulse?since=1');
  assert.ok(feed.json.feed.some((f) => f.title === 'Léon a réservé en ligne'));
});

test('long service: deposit, simulated checkout, confirmed, then the till deducts it', async () => {
  const site = browser(rt);
  const salon = await site.get('/api/public/salon');
  const deco = salon.json.services.find((s) => s.slug === 'de');
  const av = await site.get(`/api/public/availability?services=${deco.id}&staff=any&from=${DAY}&days=5`);
  const day = av.json.days.find((d) => d.slots.length);
  const book = await site.post('/api/public/bookings', { serviceIds: [deco.id], staffId: 'any', day: day.day, start: day.slots[0].m, first: 'Sacha', phone: '0677889911' });
  assert.equal(book.json.status, 'pending');
  assert.equal(book.json.deposit, 1800);
  const pid = book.json.payment.url.split('/').pop();
  const pay = await site.get('/api/public/payments/' + pid);
  assert.equal(pay.json.status, 'pending');
  await site.post('/api/public/payments/' + pid + '/simulate', { outcome: 'paid' });
  assert.equal((await site.get('/api/public/bookings/' + book.json.token)).json.status, 'booked');
  const b = await owner();
  const ag = await b.get('/api/v1/agenda?day=' + day.day);
  const appt = ag.json.appts.find((a) => a.code === book.json.code);
  assert.equal(appt.deposit.paid, 1800);
});

test('checkout over HTTP is idempotent and shows up everywhere', async () => {
  const b = await owner();
  await b.post('/api/v1/drawer/open', { float: 15000 });
  const ag = await b.get('/api/v1/agenda?day=' + DAY);
  const a = ag.json.appts.find((x) => ['booked', 'in_chair', 'arrived'].includes(x.status) && x.services.length === 1);
  const body = { apptId: a.id, lines: [{ kind: 'service', ref: a.services[0].id }], payments: [{ method: 'cash', amount: a.services[0].price, given: 5000 }] };
  const id = 'c0ffee00-1234-4abc-8def-000000000001';
  const r1 = await b.post('/api/v1/sales', body, { 'x-request-id': id });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  const r2 = await b.post('/api/v1/sales', body, { 'x-request-id': id });
  assert.equal(r2.json.id, r1.json.id);
  const sales = await b.get('/api/v1/sales?day=' + DAY);
  assert.equal(sales.json.items.filter((x) => x.apptId === a.id).length, 1);
  const drawer = await b.get('/api/v1/drawer');
  assert.ok(drawer.json.open.expected >= 15000 + a.services[0].price);
});

test('reports, exports and the integrity proof', async () => {
  const b = await owner();
  const rep = await b.get('/api/v1/reports?from=2026-10-01&to=2026-10-31');
  assert.equal(rep.status, 200);
  assert.ok(rep.json.revenue > 100000, 'a month of a four-chair salon');
  assert.equal(rep.json.staff.length, 4);
  assert.ok(rep.json.goal.target > 0);
  const csv = await b.get('/api/v1/export?kind=vat&from=2026-10-01&to=2026-10-31');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /Grand total perpétuel/);
  const integrity = await b.get('/api/v1/integrity');
  assert.equal(integrity.json.ok, true);
  assert.ok(integrity.json.count > 1000);
  const journal = await b.get('/api/v1/export?kind=journal');
  assert.ok(!journal.text.includes('"pii"'), 'the fiscal archive carries no personal data');
  const audit = await b.get('/api/v1/audit?limit=5');
  assert.equal(audit.json.items.length, 5);
});

test('brute force on the owner login is slowed down', async () => {
  const b = browser(rt, { ip: '10.9.9.9' });
  let last;
  for (let i = 0; i < 11; i++) last = await b.post('/api/auth/login', { email: 'someone@else.fr', password: 'x' + i });
  assert.equal(last.status, 429);
});

test('Stripe webhooks without a valid signature are refused', async () => {
  const rt2 = await testRuntime({ clock: () => clock.now, env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test' } });
  const b = browser(rt2);
  const r = await b.raw('POST', '/api/stripe/webhook', JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }), { 'stripe-signature': 't=1,v1=deadbeef', 'content-type': 'application/json', origin: 'https://stripe.com', 'sec-fetch-site': 'cross-site' });
  assert.equal(r.status, 400);
});

test('demo reset rebuilds a fresh salon (owner only)', async () => {
  const tab = await salonDevice();
  const team = (await tab.get('/api/auth/state')).json.team;
  await tab.post('/api/auth/pin', { staffId: team.find((x) => x.name === 'Frank').id, pin: DEMO.pins.Frank });
  assert.equal((await tab.post('/api/v1/demo/reset')).status, 403);
});

test('a production salon on a Stripe test key sells no membership: 409 before any call to Stripe (PAY-03)', async () => {
  const rt = await testRuntime({ env: { LX_MODE: 'production', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' } });
  const res = await browser(rt).post('/api/public/memberships', { planId: 'essentiel', first: 'Karim', phone: '06 11 22 33 44', email: 'karim@exemple.fr', startNow: true });
  assert.deepEqual([res.status, res.json.error.code], [409, 'soon']);
  assert.equal((await browser(rt).get('/api/public/memberships')).json.live, false);
});
