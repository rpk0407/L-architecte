// The salon's health (routes-health.js): owner only, the facts Réglages › Mise en route ticks, and the test SMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { journalFacts } from '../../server/http/routes-health.js';
import { readConfig } from '../../server/http/runtime.js';

const DAY = '2026-11-03'; // a Tuesday

async function owner(rt) {
  const b = browser(rt);
  const r = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return b;
}

test('health: a barber is refused, the owner gets every field', async () => {
  const clock = { now: at(DAY, 10, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const b = await owner(rt);
  await b.post('/api/auth/device', { name: 'Tablette' });
  await b.post('/api/auth/logout');
  const st = await b.get('/api/auth/state');
  const jkut = st.json.team.find((x) => x.name === 'JKut');
  assert.equal((await b.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut })).status, 200);
  assert.equal((await b.get('/api/v1/health')).status, 403);
  assert.equal((await b.post('/api/v1/health/test-sms', { phone: '0612345678' })).status, 403);

  const o = await owner(rt);
  const h = await o.get('/api/v1/health');
  assert.equal(h.status, 200, JSON.stringify(h.json));
  for (const k of ['tick', 'stripe', 'sms', 'email', 'backup', 'integrity', 'publicUrl', 'indexable', 'setup']) assert.ok(k in h.json, k + ' is missing');
  assert.deepEqual(Object.keys(h.json.tick).sort(), ['ageMs', 'at', 'cron', 'cronAgeMs', 'cronAt', 'lastLate', 'late24h', 'lateMs', 'okMs', 'open', 'overdue']);
  assert.ok('lastWebhook' in h.json.stripe);
  for (const ch of ['sms', 'email']) for (const k of ['provider', 'failed24h', 'queuedNoProvider']) assert.ok(k in h.json[ch], ch + '.' + k);
  assert.ok('at' in h.json.backup && 'problem' in h.json.backup);
  assert.equal(h.json.integrity.ok, true);
  assert.equal(h.json.integrity.count, rt.engine.journal.length);
  assert.equal(h.json.integrity.events, rt.engine.journal.length);
  assert.equal(h.json.indexable, false, 'LX_INDEX unset: nothing indexed');
  assert.equal(h.json.tick.open, true, 'a Tuesday at 10:00 is open');
  // the demo salon: four chairs with a PIN, a menu on the site, a tablet just enrolled
  assert.equal(h.json.setup.team.chairs.length, 4);
  assert.ok(h.json.setup.team.chairs.every((c) => c.pin));
  assert.ok(h.json.setup.services.online >= 10);
  assert.ok(h.json.setup.devices >= 1);
  // the scheduler ran with that pulse: its time is on the salon's clock
  await o.get('/api/v1/pulse');
  await rt.ticking;
  const h2 = await o.get('/api/v1/health');
  assert.ok(h2.json.tick.ageMs != null && h2.json.tick.ageMs < 60000);
  assert.ok(Math.abs(h2.json.tick.at - clock.now) < 60000);
});

test('test SMS: simulated in the demo, three an hour, the fourth refused', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 11, 0) });
  const o = await owner(rt);
  assert.equal((await o.post('/api/v1/health/test-sms', {})).json.error.code, 'no_phone', 'the demo salon has no phone of its own');
  assert.equal((await o.post('/api/v1/health/test-sms', { phone: '12' })).status, 400);
  assert.equal((await o.post('/api/v1/health/test-sms', { phone: '+1 202 555 0100' })).json.error.code, 'country');
  assert.equal((await o.post('/api/v1/health/test-sms', { phone: '04 91 00 00 00' })).json.error.code, 'not_mobile', 'a landline, or anyone else’s number abroad: no');
  const v0 = rt.engine.state.version;
  for (let i = 0; i < 3; i++) {
    const r = await o.post('/api/v1/health/test-sms', { phone: '06 12 34 56 78' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.simulated, true);
    assert.equal(r.json.to, '06 •• •• •• 78');
    assert.doesNotMatch(r.json.body, /[’«»]/, 'plain GSM characters: one SMS, not a Unicode one');
  }
  const fourth = await o.post('/api/v1/health/test-sms', { phone: '06 12 34 56 78' });
  assert.equal(fourth.status, 429);
  assert.equal(rt.engine.state.version, v0, 'a test SMS changes nothing in the journal');
});

test('a fresh production salon: unticked steps, texts waiting for a provider, the test SMS through the provider', async () => {
  const clock = { now: at(DAY, 10, 0) };
  const rt = await testRuntime({ clock: () => clock.now, env: { LX_MODE: 'production', SETUP_TOKEN: 'tok-0123456789', PUBLIC_URL: 'https://barberlarchitecte.com' } });
  const o = browser(rt);
  const su = await o.post('/api/setup', { token: 'tok-0123456789', name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013' });
  assert.equal(su.status, 200, JSON.stringify(su.json));
  let h = (await o.get('/api/v1/health')).json;
  assert.equal(h.mode, 'production');
  assert.deepEqual(h.setup.team.chairs, [], 'the owner is not a chair');
  assert.equal(h.setup.services.online, 0);
  assert.equal(h.setup.devices, 0);
  assert.ok(h.setup.legal.missing.includes('SIRET'));
  assert.ok(h.setup.hours.holidays.includes('2026-11-11'), 'Armistice falls on an open Wednesday');
  assert.equal(h.sms.provider, null);
  assert.equal(h.backup.configured, false, 'no BACKUP_KEY, no Blob: a step to do');
  assert.doesNotMatch(h.backup.problem, /openssl/, 'the owner reads it: no terminal command');
  assert.equal(h.stripe.provider, 'simulated');
  assert.equal(h.publicUrl, 'https://barberlarchitecte.com');
  assert.equal(h.publicUrlCustom, true);
  assert.equal(h.setup.import.clients, 0);
  assert.equal(h.setup.siteBooking, null);
  assert.equal((await o.post('/api/v1/health/test-sms', { phone: '0612345678' })).json.error.code, 'no_provider');

  // a chair with a PIN, a service, a closure: the steps tick
  const st = await o.post('/api/v1/staff', { name: 'JKut', role: 'barber', pin: '2468' });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const sv = await o.post('/api/v1/services', { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30 });
  assert.equal(sv.status, 200, JSON.stringify(sv.json));
  await o.post('/api/v1/settings/closures', { from: '2026-11-11', to: '2026-11-11', label: 'Armistice' });
  h = (await o.get('/api/v1/health')).json;
  assert.deepEqual(h.setup.team.chairs.map((c) => [c.name, c.pin]), [['JKut', true]]);
  assert.equal(h.setup.services.online, 1);
  assert.ok(!h.setup.hours.holidays.includes('2026-11-11'));

  // a client books on the site: the booking counts as the end-to-end test, its confirmation waits for a provider
  const site = browser(rt);
  const av = await site.get(`/api/public/availability?services=${sv.json.id}&staff=any&from=${DAY}&days=3`);
  const day = av.json.days.find((d) => d.slots.length);
  const book = await site.post('/api/public/bookings', { serviceIds: [sv.json.id], staffId: 'any', day: day.day, start: day.slots[day.slots.length - 1].m, first: 'Léon', phone: '06 77 88 99 00', sms: true });
  assert.equal(book.status, 201, JSON.stringify(book.json));
  h = (await o.get('/api/v1/health')).json;
  assert.equal(h.setup.siteBooking, clock.now);
  assert.ok(h.sms.queuedNoProvider >= 1, 'the confirmation waits in the outbox');
  assert.equal(h.tick.overdue, 0, 'nothing is overdue without a provider: there is nobody to send it');
  assert.equal(h.tick.late24h, 0);

  // a provider: the test goes to the phone typed, or to the salon's
  const sent = [];
  rt.sms = { name: 'brevo', async send(to, body) { sent.push({ to, body }); return { ref: 'm1' }; } };
  await o.patch('/api/v1/settings', { shop: { phone: '06 11 22 33 44' } });
  const r = await o.post('/api/v1/health/test-sms', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.simulated, false);
  assert.equal(sent[0].to, '+33611223344');
  assert.match(sent[0].body, /https:\/\/barberlarchitecte\.com\//);
  rt.sms = { name: 'brevo', async send() { throw new Error('Crédit épuisé'); } };
  const fail = await o.post('/api/v1/health/test-sms', { phone: '0699887766' });
  assert.equal(fail.status, 502);
  assert.match(fail.json.error.message, /Crédit épuisé/);
  // the go-live backlog: queued before the provider's first attempt, it is no sign of a dead scheduler
  clock.now += 2 * 3600000;
  h = (await o.get('/api/v1/health')).json;
  assert.equal(h.tick.overdue, 0);
  assert.equal(h.sms.queuedNoProvider, 0);
});

/** A production salon with a provider that has already sent texts, and a menu to book. */
async function liveSalon(clock, env = {}) {
  const rt = await testRuntime({ clock: () => clock.now, env: { LX_MODE: 'production', SETUP_TOKEN: 'tok-0123456789', CRON_SECRET: 'cron-0123456789', ...env } });
  const o = browser(rt);
  assert.equal((await o.post('/api/setup', { token: 'tok-0123456789', name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013' })).status, 200);
  await o.post('/api/v1/staff', { name: 'JKut', role: 'barber', pin: '2468' });
  const sv = (await o.post('/api/v1/services', { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30 })).json;
  const sent = [];
  rt.sms = { name: 'brevo', async send(to, body) { sent.push({ to, body }); return { ref: 'm' + sent.length }; } };
  let n = 0;
  /** a client books online (each from their own phone, the day's last slot) while no tick runs: the last one was a few seconds ago */
  const book = async () => {
    const site = browser(rt);
    rt.lastTick = Date.now();
    const av = await site.get(`/api/public/availability?services=${sv.id}&staff=any&from=${DAY}&days=6`);
    const day = av.json.days.find((d) => d.slots.length);
    n++;
    const r = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day: day.day, start: day.slots[day.slots.length - 1].m, first: 'Léon', phone: '06 77 88 ' + (10 + n) + ' 00', sms: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  };
  /** the owner's Comptoir polls: its pulse ticks, and dispatches what is due */
  const pulse = async () => { rt.lastTick = 0; await o.get('/api/v1/pulse'); await rt.ticking; };
  return { rt, o, book, pulse, sent };
}

test('a dead cron shows while the Comptoir polls: texts that waited with no dispatch, from the messages themselves', async () => {
  const clock = { now: at(DAY, 10, 0) };
  const { rt, o, book, pulse, sent } = await liveSalon(clock);
  await book();
  await pulse();
  assert.equal(sent.length, 1, 'the confirmation left at once');
  let h = (await o.get('/api/v1/health')).json;
  assert.equal(h.tick.late24h, 0);
  assert.equal(h.tick.cronAt, null, 'no cron call seen yet');
  assert.equal(h.tick.cron, true, 'the secret is set');

  // nobody visits for two hours and no cron calls: a confirmation waits
  clock.now = at(DAY, 12, 0);
  await book();
  clock.now = at(DAY, 12, 45);
  h = (await o.get('/api/v1/health')).json;
  assert.equal(h.tick.overdue, 1, 'due 45 minutes ago, nothing has dispatched since');
  // the owner opens the Comptoir: its pulse sends it, and the tick looks fresh, but the delay stays on record
  clock.now = at(DAY, 14, 0);
  await pulse();
  assert.equal(sent.length, 2);
  h = (await o.get('/api/v1/health')).json;
  assert.ok(h.tick.ageMs < 60000, 'this instance just ticked');
  assert.equal(h.tick.overdue, 0);
  assert.equal(h.tick.late24h, 1, 'sent two hours late: the step stays red although the Comptoir polls');
  assert.equal(h.tick.lastLate.dueAt, at(DAY, 12, 0));
  assert.equal(h.tick.lastLate.ms, 2 * 3600000);
  // a day later it has aged out
  clock.now = at(DAY, 12, 0) + 25 * 3600000;
  assert.equal((await o.get('/api/v1/health')).json.tick.late24h, 0);

  // the cron calls: seen, on the salon's clock
  const anon = browser(rt);
  assert.equal((await anon.get('/api/cron/tick', { authorization: 'Bearer nope' })).status, 401);
  assert.equal((await o.get('/api/v1/health')).json.tick.cronAt, null, 'a refused call is not the cron');
  assert.equal((await anon.get('/api/cron/tick', { authorization: 'Bearer cron-0123456789' })).status, 200);
  h = (await o.get('/api/v1/health')).json;
  assert.ok(h.tick.cronAgeMs != null && h.tick.cronAgeMs < 60000);
  assert.ok(Math.abs(h.tick.cronAt - clock.now) < 60000);
});

test('a relance draining ten texts a tick is not late', async () => {
  const clock = { now: at(DAY, 10, 0) };
  const { rt, o, book, pulse } = await liveSalon(clock);
  await book();
  await pulse();
  // twelve texts due at once and a dispatch every 20 minutes: ten leave, then the last two 40 minutes late, yet
  // dispatches ran all along
  clock.now = at(DAY, 15, 0);
  for (let i = 0; i < 12; i++) await book();
  for (let i = 0; i < 2; i++) { clock.now += 20 * 60000; await pulse(); }
  const left = [...rt.engine.state.messages.values()].filter((m) => m.status === 'sent' && m.dueAt === at(DAY, 15, 0));
  assert.equal(left.length, 12);
  assert.ok(left.some((m) => m.claimedAt - m.dueAt === 40 * 60000), 'the last ones waited for the second dispatch');
  const h = (await o.get('/api/v1/health')).json;
  assert.equal(h.tick.late24h, 0);
  assert.equal(h.tick.overdue, 0);
});

test('LX_INDEX is read once with the configuration', async () => {
  for (const [v, want] of [['1', true], ['0', false], ['', false]]) assert.equal(readConfig({ LX_INDEX: v }).index, want, 'LX_INDEX=' + v);
  assert.equal(readConfig({}).index, false);
  // unset is the first test's salon; set, the owner sees it open
  const rt = await testRuntime({ clock: () => at(DAY, 10, 0), env: { LX_INDEX: '1' } });
  assert.equal((await (await owner(rt)).get('/api/v1/health')).json.indexable, true);
});

test('the last Stripe webhook: what the webhook route writes, not our own refunds', () => {
  const ev = (v, type, at, actor = { t: 'provider', id: 'stripe' }) => ({ v, h: 'h' + v, p: 'h' + (v - 1), type, at, actor, data: { id: 'pay_1' } });
  const journal = [
    ev(1, 'payment.created', 1000, { t: 'system', id: 'payments' }),
    ev(2, 'payment.succeeded', 2000),
    ev(3, 'payment.refunded', 3000),
    ev(4, 'payment.expired', 4000, { t: 'provider', id: 'simulated' })
  ];
  const rt = { engine: { journal } };
  assert.equal(journalFacts(rt).stripe, 2000, 'the refund is ours, the simulated checkout is not Stripe');
  journal.push(ev(5, 'payment.failed', 5000));
  assert.equal(journalFacts(rt).stripe, 5000);
});
