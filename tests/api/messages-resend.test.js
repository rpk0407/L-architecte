// « Renvoyer » through the API: the appointment sheet's « Renvoyer la confirmation par e-mail », the outbox's and the
// Messages screen's « Renvoyer » on one message; the copy leaves by the normal dispatch, three a day, own clients only.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { messageResult } from '../../server/commands/messages.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
const SYS = { actor: /** @type {const} */ ({ t: 'system', id: 'test' }), caps: new Set() };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function asStaff(name) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin: DEMO.pins[name] })).status, 200);
  return tab;
}
/** A booking on the public site with this barber: the appointment's id. */
async function bookWith(barber, first, phone, email) {
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  const svc = salon.services.find((s) => !s.deposit && s.slug === 'cl') || salon.services.find((s) => !s.deposit);
  const who = salon.barbers.find((b) => b.name === barber);
  const av = (await site.get(`/api/public/availability?services=${svc.id}&staff=${who.id}&from=${DAY}&days=8`)).json;
  const day = av.days.filter((d) => d.day > DAY && d.slots.length)[0];
  const r = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: who.id, day: day.day, start: day.slots[0].m, first, phone, ...(email ? { email } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return [...rt.engine.state.appts.values()].find((a) => a.code === r.json.code).id;
}

test('the appointment sheet: « Renvoyer la confirmation par e-mail » sends a fresh copy, three a day; off without an address', async () => {
  const id = await bookWith('JKut', 'Zinedine', '06 55 01 02 03', 'zizou@exemple.fr');
  const lone = await bookWith('JKut', 'Youri', '07 55 04 05 06');
  const boss = await owner();
  assert.equal((await browser(rt).post('/api/v1/appointments/' + id + '/resend-confirmation', {})).status, 401);
  assert.equal((await boss.get('/api/v1/appointments/' + id)).json.confirmMail, 'ok');
  assert.equal((await boss.get('/api/v1/appointments/' + lone)).json.confirmMail, 'no_email');
  assert.equal((await boss.post('/api/v1/appointments/' + lone + '/resend-confirmation', {})).status, 409);
  const before = rt.engine.state.messages.size;
  const r = await boss.post('/api/v1/appointments/' + id + '/resend-confirmation', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.to, /^z•••@/);
  assert.equal(r.json.status, 'simulated', 'the demo sends nothing: the normal dispatch took it at once');
  assert.equal(rt.engine.state.messages.size, before + 1, 'one new message');
  const m = rt.engine.state.messages.get(r.json.id);
  assert.equal(m.channel, 'email');
  assert.equal(m.template, 'confirmation');
  assert.equal(m.resendOf, 'conf:' + id);
  // a colleague's appointment: refused; his own: allowed
  const frank = await asStaff('Frank');
  assert.ok([403, 404].includes((await frank.post('/api/v1/appointments/' + id + '/resend-confirmation', {})).status));
  const jk = await asStaff('JKut');
  assert.equal((await jk.post('/api/v1/appointments/' + id + '/resend-confirmation', {})).status, 200);
  assert.equal((await boss.post('/api/v1/appointments/' + id + '/resend-confirmation', {})).status, 200);
  const fourth = await boss.post('/api/v1/appointments/' + id + '/resend-confirmation', {});
  assert.equal(fourth.status, 429);
  assert.match(JSON.stringify(fourth.json), /3 fois aujourd’hui/);
  // the sheet lists them, each e-mail that left with its « Renvoyer »
  const sheet = (await boss.get('/api/v1/appointments/' + id)).json;
  assert.ok(sheet.messages.filter((x) => x.channel === 'email' && x.resend).length >= 3);
});

test('the outbox and the Messages screen: « Renvoyer » on an e-mail that left and on a message that failed', async () => {
  const id = await bookWith('Frank', 'Bixente', '06 55 09 09 09', 'bixente@exemple.fr');
  const boss = await owner();
  const conf = [...rt.engine.state.messages.values()].find((m) => m.apptId === id && m.channel === 'email' && m.template === 'confirmation');
  assert.ok(conf, 'the confirmation e-mail of the booking');
  // made to fail, as a provider would: it shows under « Pas partis » on the Messages screen, to whoever may send it
  await rt.engine.run(messageResult, { id: conf.id, status: 'failed', error: 'Boîte pleine' }, SYS);
  const row = (await boss.get('/api/v1/messages?limit=300')).json.items.find((x) => x.id === conf.id);
  assert.equal(row.resend, true);
  const hand = (await boss.get('/api/v1/messages/hand')).json;
  const line = hand.failed.find((x) => x.id === conf.id);
  assert.ok(line, JSON.stringify(hand.failed));
  assert.equal(line.client.name.startsWith('Bixente'), true);
  assert.equal(line.error, 'Boîte pleine');
  const jk = await asStaff('JKut');
  assert.equal((await jk.get('/api/v1/messages/hand')).json.failed.some((x) => x.id === conf.id), false, 'not a colleague’s client');
  assert.equal((await jk.post('/api/v1/messages/' + conf.id + '/resend', {})).status, 403);
  const frank = await asStaff('Frank');
  const r = await frank.post('/api/v1/messages/' + conf.id + '/resend', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.notEqual(r.json.id, conf.id);
  assert.equal(r.json.status, 'simulated');
  assert.equal((await boss.get('/api/v1/messages/hand')).json.failed.some((x) => x.id === conf.id), false, 'sent again: no longer « pas parti »');
  // the copy that left can be sent again from the outbox
  assert.equal((await boss.get('/api/v1/messages?limit=300')).json.items.find((x) => x.id === r.json.id).resend, true);
  assert.equal((await boss.post('/api/v1/messages/msg_nope/resend', {})).status, 404);
});
