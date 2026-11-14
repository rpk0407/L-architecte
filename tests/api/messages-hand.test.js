// « Mode téléphone » through the API: the choice saved in Réglages, the salon's WhatsApp number on the public site, the
// queue of the Messages screen per role, « Envoyé » recorded once, and the test e-mail of the provider in use.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** A salon tablet with someone's PIN typed. */
async function asStaff(name) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin: DEMO.pins[name] })).status, 200);
  return tab;
}
/** A booking on the public site, without deposit, with this barber: its code. */
async function bookWith(barber, first, phone) {
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  const svc = salon.services.find((s) => !s.deposit && s.slug === 'cl') || salon.services.find((s) => !s.deposit);
  const who = salon.barbers.find((b) => b.name === barber);
  const av = (await site.get(`/api/public/availability?services=${svc.id}&staff=${who.id}&from=${DAY}&days=8`)).json;
  const day = av.days.filter((d) => d.day > DAY && d.slots.length)[0];
  const r = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: who.id, day: day.day, start: day.slots[0].m, first, phone });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'booked', JSON.stringify(r.json));
  return r.json.code;
}
const mine = (q, name) => q.json.items.find((x) => x.client.name.startsWith(name));

test('Réglages saves the phone mode and the salon’s number; the site then gets the number, and only then', async () => {
  const boss = await owner();
  const site = browser(rt);
  assert.equal((await site.get('/api/public/salon')).json.whatsapp, null, 'no number, no button');
  let r = await boss.patch('/api/v1/settings', { messages: { whatsapp: { mode: 'phone', enabled: false, number: '04 91 00 00 00' } } });
  assert.equal(r.status, 400, 'a landline cannot open a WhatsApp chat');
  r = await boss.patch('/api/v1/settings', { messages: { whatsapp: { mode: 'phone', enabled: false, number: '06 12 34 56 78' } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await site.get('/api/public/salon')).json.whatsapp, '33612345678');
  const c = (await boss.get('/api/v1/messages/channels')).json;
  assert.equal(c.whatsapp.mode, 'phone');
  assert.equal(c.whatsapp.effective, 'phone');
  assert.equal(c.whatsapp.number, '06 12 34 56 78');
  assert.equal(c.metaTemplates.length, 4);
  assert.match(c.metaTemplates[0].text, /\{\{prenom\}\}/);
  // nobody but the owner changes the way messages leave
  const jk = await asStaff('JKut');
  assert.equal((await jk.patch('/api/v1/settings', { messages: { whatsapp: { mode: 'sms' } } })).status, 403);
  assert.equal((await jk.get('/api/v1/messages/channels')).status, 403);
});

test('the Messages screen: each role’s queue, the wa.me link, « Envoyé » once, a colleague’s client refused', async () => {
  await bookWith('JKut', 'Zinedine', '06 55 01 02 03');
  await bookWith('Frank', 'Youri', '07 55 04 05 06');
  assert.equal((await browser(rt).get('/api/v1/messages/hand')).status, 401);
  const boss = await owner();
  const all = await boss.get('/api/v1/messages/hand');
  assert.equal(all.status, 200, JSON.stringify(all.json));
  assert.equal(all.json.effective, 'phone');
  assert.equal(all.json.all, true);
  const z = mine(all, 'Zinedine'), y = mine(all, 'Youri');
  assert.ok(z && y, 'both confirmations wait for a person');
  assert.equal(z.kind, 'Confirmation');
  assert.equal(z.appt.barber, 'JKut');
  assert.match(z.link, /^https:\/\/wa\.me\/33655010203\?text=/);
  assert.equal(decodeURIComponent(z.link.split('?text=')[1]), z.text);
  // the menu's number, for each person
  const pulse = (await boss.get('/api/v1/pulse')).json;
  assert.equal(pulse.badges.handOn, true);
  assert.equal(pulse.badges.hand, all.json.items.length);

  // JKut: his own client's, not Frank's
  const jk = await asStaff('JKut');
  const q = await jk.get('/api/v1/messages/hand');
  assert.equal(q.json.all, false);
  assert.ok(mine(q, 'Zinedine'));
  assert.equal(mine(q, 'Youri'), undefined);
  assert.ok(q.json.items.every((x) => x.appt && x.appt.barber === 'JKut'));
  let r = await jk.post('/api/v1/messages/hand/' + y.id + '/sent');
  assert.equal(r.status, 403, JSON.stringify(r.json));
  // « Envoyé », and the same request again (a retry): recorded once
  const before = rt.engine.journal.length;
  r = await jk.post('/api/v1/messages/hand/' + z.id + '/sent', {}, { 'x-request-id': 'hand-sent-0000-0001' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { ok: true, status: 'sent' });
  r = await jk.post('/api/v1/messages/hand/' + z.id + '/sent', {}, { 'x-request-id': 'hand-sent-0000-0001' });
  assert.equal(r.status, 200);
  r = await jk.post('/api/v1/messages/hand/' + z.id + '/sent');
  assert.deepEqual(r.json, { ok: true, already: true, status: 'sent' });
  assert.equal(rt.engine.journal.slice(before).filter((e) => e.type === 'message.updated' && e.data.id === z.id).length, 1);
  const sent = rt.engine.state.messages.get(z.id);
  assert.deepEqual([sent.status, sent.via], ['sent', 'hand']);
  assert.equal(mine(await jk.get('/api/v1/messages/hand'), 'Zinedine'), undefined);
  // the desk sends for every chair
  const desk = await asStaff('Inès');
  assert.ok(mine(await desk.get('/api/v1/messages/hand'), 'Youri'));
  r = await desk.post('/api/v1/messages/hand/' + y.id + '/sent', { skip: true });
  assert.deepEqual(r.json, { ok: true, status: 'skipped' });
  assert.equal((await boss.post('/api/v1/messages/hand/msg_inconnu/sent')).status, 404);
  // the outbox says how each one ended
  const out = (await boss.get('/api/v1/messages?limit=300')).json.items;
  assert.equal(out.find((m) => m.id === z.id).via, 'hand');
  assert.equal(out.find((m) => m.id === y.id).status, 'skipped');
});

test('back to automatic sending: nothing left for a person, and « Envoyé » on a text the scheduler carries is refused', async () => {
  const boss = await owner();
  const code = await bookWith('JKut', 'Bixente', '06 55 07 08 09');
  assert.ok(code);
  const m = mine(await boss.get('/api/v1/messages/hand'), 'Bixente');
  assert.ok(m);
  assert.equal((await boss.patch('/api/v1/settings', { messages: { whatsapp: { mode: 'sms', enabled: false } } })).status, 200);
  const q = (await boss.get('/api/v1/messages/hand')).json;
  assert.equal(q.items.length, 0);
  const r = await boss.post('/api/v1/messages/hand/' + m.id + '/sent');
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'automatic');
  assert.equal((await boss.get('/api/v1/pulse')).json.badges.handOn, false);
});

test('a real salon without any provider: the phone mode stands in; the test e-mail goes through the provider in use', async () => {
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'tok-0123456789', PUBLIC_URL: 'https://barberlarchitecte.com' };
  const prod = await createRuntime({ env, store: memoryStore(), clock: () => clock.now });
  const o = browser(prod);
  assert.equal((await o.post('/api/setup', { token: 'tok-0123456789', name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013' })).status, 200);
  const c = (await o.get('/api/v1/messages/channels')).json;
  assert.equal(c.whatsapp.mode, 'sms');
  assert.equal(c.whatsapp.effective, 'phone', 'nothing plugged: by hand, from tomorrow morning');
  assert.equal(c.whatsapp.configured, false);
  assert.deepEqual([c.email.provider, c.email.configured], [null, false]);
  assert.equal((await o.get('/api/v1/pulse')).json.badges.handOn, true);
  let r = await o.post('/api/v1/messages/channels/test-email');
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'not_configured');
  // the salon's mailbox plugged (a stand-in for the SMTP provider): one mail to the owner's own address
  const sent = [];
  prod.email = { name: 'smtp', async send(mail) { sent.push(mail); return { ref: '<abc@salon.test>' }; } };
  r = await o.post('/api/v1/messages/channels/test-email');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.simulated, r.json.provider, r.json.ref], [false, 'smtp', '<abc@salon.test>']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'patron@larchitecte.test');
  assert.match(sent[0].text, /partent bien par la boîte du salon/);
  assert.doesNotMatch(r.text, /patron@larchitecte\.test/, 'the address is masked in the answer');
  // a refusal is told with the server's words
  prod.email = { name: 'smtp', async send() { throw new Error('Identifiant ou mot de passe refusé par le serveur d’e-mail : vérifie SMTP_USER (l’adresse complète) et SMTP_PASS'); } };
  r = await o.post('/api/v1/messages/channels/test-email');
  assert.equal(r.status, 502);
  assert.match(r.json.error.message, /^Refusé : Identifiant ou mot de passe refusé/);
});
