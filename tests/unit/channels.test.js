// MSG-02 · The salon's own phone (SMS Gateway for Android) and WhatsApp (Brevo), with SMS as the fallback: the requests
// each provider gets, the webhook of the phone (STOP, replies, delivery reports), the route each text takes and records,
// the pacing of the phone, the settings of the WhatsApp templates, and the Canal d'envoi API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { addClient } from '../../server/commands/clients.js';
import { sendRebook } from '../../server/commands/messages.js';
import { updateSettings } from '../../server/commands/shop.js';
import * as S from '../../server/commands/sales.js';
import { gatewaySms, gatewayStop, parseSmsWebhook, webhookKey, GATEWAY_URL, GATEWAY_STOP } from '../../server/messaging/sms.js';
import { brevoWhatsapp, waNumber, BREVO_WHATSAPP_URL } from '../../server/messaging/whatsapp.js';
import { dispatch } from '../../server/http/scheduler.js';
import { createRuntime, readConfig } from '../../server/http/runtime.js';
import { handle } from '../../server/http/app.js';
import { memoryStore } from '../../server/store/memory.js';
import { browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';

const LATER = addDays(DAY, 2);
/** A fetch that answers `status` with `json`, and remembers each call. */
function fakeFetch(status, json) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(json), { status }); };
  return Object.assign(f, { calls });
}
const fakeSms = (name = 'brevo', extra = {}) => { const sent = []; return { name, sent, ...extra, async send(to, body, o) { sent.push({ to, body, o }); return { ref: name + '-' + sent.length }; } }; };
const fakeWa = (fail = '') => { const sent = []; return { name: 'whatsapp', sent, async send(to, msg) { sent.push({ to, msg }); if (fail) throw new Error('WhatsApp : ' + fail); return { ref: 'wa-' + sent.length }; } }; };
const rtOf = (t, x = {}) => ({ engine: t.engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '' }, origin: 'https://salon.test', ...x });
const msgs = (t, tpl) => [...t.engine.state.messages.values()].filter((m) => !tpl || m.template === tpl);
const WA = { enabled: true, templates: { confirmation: { id: 12, params: ['prenom', 'date', 'heure', 'barbier', 'lien'] }, reminder: { id: 13, params: ['heure', 'barbier'] } } };
const book = (t, x = {}) => t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 600, first: 'karim', last: 'Benali', phone: '0611223344', ...x }, t.asClient);

test('the salon phone: Basic auth, the text and the number as SMS Gateway expects them, its id as the reference', async () => {
  const f = fakeFetch(202, { id: 'Pq3x9', state: 'Pending', recipients: [{ phoneNumber: '+33612345678', state: 'Pending' }] });
  const sms = gatewaySms({ username: 'ABCDEF', password: 'pw-1313', fetchImpl: f });
  assert.equal(sms.name, 'gateway');
  assert.deepEqual(await sms.send('+33612345678', 'Salut Karim'), { ref: 'Pq3x9' });
  assert.equal(f.calls[0].url, GATEWAY_URL + '/messages');
  assert.equal(f.calls[0].url, 'https://api.sms-gate.app/3rdparty/v1/messages');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.authorization, 'Basic ' + Buffer.from('ABCDEF:pw-1313').toString('base64'));
  assert.deepEqual(f.calls[0].body, { textMessage: { text: 'Salut Karim' }, phoneNumbers: ['+33612345678'] });
  // a private server of the app, its own address
  const own = fakeFetch(202, { id: 'x' });
  await gatewaySms({ url: 'https://sms.salon.fr/api/3rdparty/v1/', username: 'u', password: 'p', fetchImpl: own }).send('+33612345678', 'x');
  assert.equal(own.calls[0].url, 'https://sms.salon.fr/api/3rdparty/v1/messages');
  // the errors, in words the owner can act on
  await assert.rejects(gatewaySms({ username: 'u', password: 'bad', fetchImpl: fakeFetch(401, { message: 'Unauthorized' }) }).send('+33612345678', 'x'), /Téléphone du salon : identifiants refusés/);
  await assert.rejects(gatewaySms({ username: 'u', password: 'p', fetchImpl: fakeFetch(400, { message: 'invalid phone number' }) }).send('+33612345678', 'x'), /Téléphone du salon : invalid phone number/);
  await assert.rejects(gatewaySms({ username: 'u', password: 'p', fetchImpl: fakeFetch(429, {}) }).send('+33612345678', 'x'), /trop de SMS/);
});

test('the salon phone’s webhook: a STOP, a plain reply, the older payload, delivery reports, and what is nothing', () => {
  const one = (b) => parseSmsWebhook(JSON.stringify(b), 'application/json')[0];
  const received = (message, from = '+33612345678', extra = {}) => ({ deviceId: 'dev1', event: 'sms:received', id: 'evt-1', webhookId: 'wh1', payload: { messageId: 'm1', message, sender: from, recipient: '+33700000000', simNumber: 1, receivedAt: '2026-11-03T10:00:00.000+01:00', ...extra } });
  assert.deepEqual(one(received('STOP')), { stop: true, phones: ['+33612345678'] });
  assert.equal(one(received('  arrête svp')).stop, true);
  // any other answer is handed on, for the owner to read
  assert.deepEqual(one(received('Je serai en retard de 10 min')), { stop: false, phones: ['+33612345678'], reply: { text: 'Je serai en retard de 10 min', phone: '+33612345678', ref: 'evt-1' } });
  // before v1.30 the app wrote phoneNumber, sometimes in the national format
  assert.deepEqual(one({ event: 'sms:received', id: 'e2', payload: { messageId: 'm2', message: 'Stop', phoneNumber: '0612345678' } }).phones, ['0612345678']);
  // the salon's own text, reported back: never read as a STOP (it ends with the STOP mention)
  assert.deepEqual(one({ event: 'sms:delivered', id: 'e3', payload: { messageId: 'Pq3x9', recipient: '+33612345678', deliveredAt: 'x' } }), { stop: false, phones: ['+33612345678'], report: { ref: 'Pq3x9', status: 'delivered', error: '' } });
  assert.deepEqual(one({ event: 'sms:failed', id: 'e4', payload: { messageId: 'Pq3x9', recipient: '+33612345678', reason: 'RESULT_ERROR_NO_SERVICE' } }).report, { ref: 'Pq3x9', status: 'failed', error: 'RESULT_ERROR_NO_SERVICE' });
  assert.deepEqual(one({ event: 'system:ping', id: 'e5', payload: { health: {} } }), { stop: false, phones: [] });
  assert.deepEqual(one({ event: 'sms:sent', id: 'e6', payload: { messageId: 'Pq3x9', recipient: '+33612345678' } }), { stop: false, phones: [] });
  // an empty text, or a text from a name (a bank's code): nothing to record
  assert.equal(one(received('   ')).reply, undefined);
  assert.equal(one(received('Votre code : 1234', 'MaBanque')).reply, undefined);
});

test('the STOP mention from the salon’s phone names the salon’s number, once', () => {
  assert.equal(gatewayStop('Salut Karim, on s’y remet ? https://x STOP au 36173', ' STOP au 36173'), 'Salut Karim, on s’y remet ? https://x ' + GATEWAY_STOP);
  assert.equal(gatewayStop('Salut Karim https://x', ' STOP au 36173'), 'Salut Karim https://x ' + GATEWAY_STOP);
  assert.equal(gatewayStop('Salut, STOP : réponds STOP', ' STOP au 36173'), 'Salut, STOP : réponds STOP');
});

test('WhatsApp through Brevo: the sender and the client without +, the template, its variables in order', async () => {
  assert.equal(waNumber('+33 6 12 34 56 78'), '33612345678');
  assert.equal(waNumber('06 12 34 56 78'), '33612345678');
  assert.equal(waNumber('12'), '');
  const f = fakeFetch(201, { messageId: '23befbae-1505' });
  const wa = brevoWhatsapp({ apiKey: 'xkeysib-1', senderNumber: '+33491000000', fetchImpl: f });
  const r = await wa.send('+33612345678', { templateId: 12, params: [['prenom', 'Karim'], ['date', 'Jeudi 5 nov.'], ['heure', '10 h']] });
  assert.deepEqual(r, { ref: '23befbae-1505' });
  assert.equal(f.calls[0].url, BREVO_WHATSAPP_URL);
  assert.equal(f.calls[0].url, 'https://api.brevo.com/v3/whatsapp/sendMessage');
  assert.equal(f.calls[0].init.headers['api-key'], 'xkeysib-1');
  const b = f.calls[0].body;
  assert.equal(b.senderNumber, '33491000000');
  assert.deepEqual(b.contactNumbers, ['33612345678']);
  assert.equal(b.templateId, 12);
  // by position and by name, in the template's order
  assert.deepEqual(Object.entries(b.params), [['1', 'Karim'], ['2', 'Jeudi 5 nov.'], ['3', '10 h'], ['prenom', 'Karim'], ['date', 'Jeudi 5 nov.'], ['heure', '10 h']]);
  await assert.rejects(brevoWhatsapp({ apiKey: 'k', senderNumber: '+33491000000', fetchImpl: fakeFetch(400, { code: 'invalid_parameter', message: 'Template not approved' }) }).send('+33612345678', { templateId: 1, params: [] }), /WhatsApp : Template not approved/);
  // a template without variables sends no params at all
  const g = fakeFetch(201, { messageId: 'x' });
  await brevoWhatsapp({ apiKey: 'k', senderNumber: '+33491000000', fetchImpl: g }).send('+33612345678', { templateId: 1, params: [] });
  assert.equal('params' in g.calls[0].body, false);
});

test('the WhatsApp mapping is checked: positive ids, the server’s own variable names, null takes one out', async () => {
  const t = await salon();
  const set = (whatsapp) => t.engine.run(updateSettings, { messages: { whatsapp } }, t.asOwner());
  await set(WA);
  assert.deepEqual(t.engine.state.settings.messages.whatsapp, WA);
  for (const bad of [{ id: 0, params: [] }, { id: -3, params: [] }, { id: 1.5, params: [] }, { id: 'abc', params: [] }, { id: 4, params: ['nom'] }, { id: 4, params: ['prenom', '{lien}'] }, { id: 4 }]) {
    await assert.rejects(set({ templates: { review: bad } }), (e) => e.status === 400, JSON.stringify(bad));
  }
  await assert.rejects(set({ templates: { inconnu: { id: 4, params: [] } } }), (e) => e.status === 400, 'only texts the server sends');
  await set({ templates: { reminder: null } });
  assert.equal(t.engine.state.settings.messages.whatsapp.templates.reminder, null);
  assert.deepEqual(t.engine.state.settings.messages.whatsapp.templates.confirmation, WA.templates.confirmation, 'the others stay');
  await set({ enabled: false });
  assert.equal(t.engine.state.settings.messages.whatsapp.enabled, false);
  assert.equal(t.engine.verify().ok, true);
});

test('WhatsApp on: a mapped text goes by WhatsApp with its variables in order, and the outbox says so', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { messages: { whatsapp: WA } }, t.asOwner());
  await book(t);
  const [m] = msgs(t, 'confirmation');
  // the variables travel with the text, in pii: out of the chained data
  const ev = t.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === m.id);
  assert.equal('wa' in ev.data, false);
  assert.equal(JSON.stringify(ev.data).includes('Karim'), false);
  const sms = fakeSms(), wa = fakeWa();
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  assert.equal(sms.sent.length, 0, 'no SMS on top');
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].to, '+33611223344');
  assert.equal(wa.sent[0].msg.templateId, 12);
  assert.deepEqual(wa.sent[0].msg.params.map(([k]) => k), ['prenom', 'date', 'heure', 'barbier', 'lien']);
  assert.deepEqual(wa.sent[0].msg.params.slice(0, 4).map(([, v]) => v), ['Karim', 'Jeu. 5 nov.', '10 h', 'Ali']);
  assert.match(wa.sent[0].msg.params[4][1], /^https:\/\/x\/r\//);
  const after = t.engine.state.messages.get(m.id);
  assert.equal(after.status, 'sent');
  assert.equal(after.via, 'whatsapp');
  assert.equal(after.providerRef, 'wa-1');
  assert.equal(t.engine.verify().ok, true);
});

test('WhatsApp refuses: the same dispatch sends it by SMS, once, and records why; a second dispatch sends nothing', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { messages: { whatsapp: WA } }, t.asOwner());
  await book(t);
  const sms = fakeSms(), wa = fakeWa('Template not approved');
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  assert.equal(wa.sent.length, 1);
  assert.equal(sms.sent.length, 1);
  assert.match(sms.sent[0].body, /c'est noté Karim/);
  const [m] = msgs(t, 'confirmation');
  assert.equal(m.status, 'sent');
  assert.equal(m.via, 'sms');
  assert.equal(m.fallback, 'WhatsApp : Template not approved');
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  assert.equal(wa.sent.length + sms.sent.length, 2, 'never twice');
  // WhatsApp refusing and no SMS route behind it: failed, with WhatsApp's reason
  const u = await salon();
  await u.engine.run(updateSettings, { messages: { whatsapp: WA } }, u.asOwner());
  await book(u);
  await dispatch(rtOf(u, { whatsapp: fakeWa('Number not on WhatsApp') }));
  const [n] = msgs(u, 'confirmation');
  assert.equal(n.status, 'failed');
  assert.equal(n.via, 'whatsapp');
  assert.equal(n.error, 'WhatsApp : Number not on WhatsApp');
});

test('by SMS: a text without a WhatsApp template, the salon’s own words, a missing variable, WhatsApp switched off', async () => {
  const t = await salon();
  // an offer cannot be mapped at all (FID-01: WhatsApp carries service texts only)
  await assert.rejects(t.engine.run(updateSettings, { messages: { whatsapp: { ...WA, templates: { ...WA.templates, rebook: { id: 20, params: ['prenom', 'jours', 'lien'] } } } } }, t.asOwner()), (e) => e.status === 400);
  await t.engine.run(updateSettings, { messages: { whatsapp: WA } }, t.asOwner());
  // the 'cancelled' text has no mapping
  const a = await book(t);
  await t.engine.run(A.cancelAppointment, { id: a.id, reason: 'Fermeture', notify: true }, t.asOwner());
  // a relance typed by the owner cannot ride on a fixed template
  const c = (await t.engine.run(addClient, { first: 'Sami', phone: '0622222222', marketing: true }, t.asOwner())).id;
  t.clock.now = at(addDays(DAY, -40), 10);
  const v = await t.engine.run(A.createAppointment, { clientId: c, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -40), start: 600 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: v.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  t.clock.now = at(DAY, 10);
  await t.engine.run(sendRebook, { clientIds: [c], text: 'Salut {prenom}, une coupe cette semaine ? {lien}' }, t.asOwner());
  // the confirmation of a booking made at the counter has no link: {lien} would be empty on WhatsApp
  const d = (await t.engine.run(addClient, { first: 'Nabil', phone: '0633333333' }, t.asOwner())).id;
  await t.engine.run(A.createAppointment, { clientId: d, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: LATER, start: 660 }, t.asOwner());
  const sms = fakeSms(), wa = fakeWa();
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  const by = (tpl, cid) => msgs(t, tpl).find((m) => !cid || m.cid === cid);
  assert.equal(by('cancelled').via, 'sms');
  assert.equal(by('cancelled').fallback, undefined, 'no template: not a fallback');
  assert.equal(by('rebook').via, 'sms');
  assert.match(by('rebook').body, /une coupe cette semaine/);
  assert.equal(by('confirmation', d).via, 'sms');
  assert.equal(by('confirmation', d).fallback, 'WhatsApp : {lien} manque pour ce message');
  // Karim's confirmation (link and all) went by WhatsApp: the only one
  assert.deepEqual(wa.sent.map((x) => x.msg.templateId), [12]);
  // switched off: what waits goes by SMS
  const u = await salon();
  await u.engine.run(updateSettings, { messages: { whatsapp: WA } }, u.asOwner());
  await book(u);
  await u.engine.run(updateSettings, { messages: { whatsapp: { enabled: false } } }, u.asOwner());
  const sms2 = fakeSms(), wa2 = fakeWa();
  await dispatch(rtOf(u, { sms: sms2, whatsapp: wa2 }));
  assert.equal(wa2.sent.length, 0);
  assert.equal(msgs(u, 'confirmation')[0].via, 'sms');
});

test('without WhatsApp settings, nothing changes: SMS as before, and a demo outbox shows the way it would have gone', async () => {
  const t = await salon();
  await book(t);
  const sms = fakeSms();
  await dispatch(rtOf(t, { sms, whatsapp: fakeWa() }));
  assert.equal(sms.sent.length, 1);
  assert.equal(msgs(t, 'confirmation')[0].via, 'sms');
  assert.equal('wa' in msgs(t, 'confirmation')[0], false, 'no variables kept when WhatsApp is off');
  // the demo: nothing leaves
  const demo = await createRuntime({ env: {}, store: memoryStore(), clock: () => at(DAY, 10) });
  await demo.engine.run(updateSettings, { messages: { whatsapp: WA } }, { actor: { t: 'system', id: 'test' }, caps: new Set(['settings']) });
  const st = demo.engine.state;
  const staff = [...st.staff.values()].find((x) => x.active && x.chair);
  const svc = [...st.services.values()].find((x) => x.active && x.online !== false && !x.pack);
  await demo.engine.run(A.bookOnline, { serviceIds: [svc.id], staffId: staff.id, day: addDays(DAY, 63), start: 600, first: 'Karim', last: 'B', phone: '0611223344' }, { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { linkFor: (a) => 'https://x/r/' + a.code } });
  assert.equal(demo.whatsapp, null);
  await dispatch(demo, 1000);
  const m = [...demo.engine.state.messages.values()].find((x) => x.template === 'confirmation' && x.to === '+33611223344');
  assert.equal(m.status, 'simulated');
  assert.equal(m.via, 'whatsapp');
});

test('the salon phone takes five texts a dispatch, one every 3 s, and the offers carry its STOP mention', async () => {
  const t = await salon();
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push((await t.engine.run(addClient, { first: 'C' + i, phone: '06111111' + String(10 + i), marketing: true }, t.asOwner())).id);
  t.clock.now = at(addDays(DAY, -28), 10);
  for (const [i, c] of ids.entries()) {
    const v = await t.engine.run(A.createAppointment, { clientId: c, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -28), start: 540 + 30 * i }, t.asOwner());
    await t.engine.run(S.checkout, { apptId: v.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  }
  t.clock.now = at(DAY, 10);
  assert.equal((await t.engine.run(sendRebook, { clientIds: ids }, t.asOwner())).sent, 7);
  const sent = [];
  const phone = gatewaySms({ username: 'u', password: 'p', fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 'g' + sent.length }), { status: 202 }); } });
  const waits = [];
  const rt = rtOf(t, { sms: phone, sleep: async (ms) => { waits.push(ms); } });
  // (the confirmations of those past visits are long stale: closed on the way, they cost the phone nothing)
  await dispatch(rt);
  assert.equal(sent.length, 5);
  assert.equal(waits.length, 4, 'a pause between two texts, none before the first');
  assert.ok(waits.every((ms) => ms > 2900 && ms <= 3000), JSON.stringify(waits));
  for (const b of sent) {
    assert.ok(b.textMessage.text.endsWith(' STOP : réponds STOP'), b.textMessage.text);
    assert.doesNotMatch(b.textMessage.text, /36173/);
  }
  assert.equal(msgs(t, 'rebook').filter((m) => m.status === 'queued').length, 2, 'the rest wait for the next tick');
  await dispatch(rt);
  assert.equal(sent.length, 7);
  assert.equal(msgs(t, 'rebook').filter((m) => m.status === 'sent' && m.via === 'sms').length, 7);
});

test('the webhook from the salon phone: STOP, an answer in Demandes (once), a delivery failure on the outbox row', async () => {
  const t = await salon();
  await t.engine.run(addClient, { first: 'Karim', phone: '0611223344', marketing: true }, t.asOwner());
  await book(t);
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', CRON_SECRET: 'cron-1313', SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p' }, store: t.store, clock: () => t.clock.now });
  assert.equal(rt.sms.name, 'gateway');
  const post = (body) => handle(new Request('https://salon.test/api/sms/webhook?k=' + webhookKey('cron-1313'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { runtime: rt });
  const received = (id, message, sender = '+33611223344') => ({ deviceId: 'd', event: 'sms:received', id, webhookId: 'w', payload: { messageId: 'm' + id, message, sender, recipient: null, simNumber: null, receivedAt: 'x' } });
  // a plain answer: the owner reads it in Relances › Demandes, on Karim's file
  let res = await post(received('ev1', 'Je serai en retard de 10 minutes, désolé'));
  assert.deepEqual(await res.json(), { received: true, replied: true });
  const s = rt.engine.state;
  const q = [...s.inquiries.values()].find((x) => x.kind === 'sms');
  assert.equal(q.message, 'Je serai en retard de 10 minutes, désolé');
  assert.equal(q.first, 'Karim');
  assert.equal(q.cid, s.clientByPhone.get('+33611223344'));
  assert.equal(q.status, 'new');
  // the words and the number are pii: not in the chained data, nor in the actor
  const ev = rt.engine.journal.find((e) => e.type === 'inquiry.received' && e.data.kind === 'sms');
  assert.doesNotMatch(JSON.stringify(ev.data) + JSON.stringify(ev.actor), /retard|611223344/);
  // the same delivery again: recorded once
  const v = s.version;
  await post(received('ev1', 'Je serai en retard de 10 minutes, désolé'));
  assert.equal(rt.engine.state.version, v);
  // a stranger's answer is kept too, without a file
  await post(received('ev2', 'C’est ouvert dimanche ?', '+33799999999'));
  const stranger = [...rt.engine.state.inquiries.values()].find((x) => x.message.startsWith('C’est ouvert'));
  assert.equal(stranger.first, 'Numéro inconnu');
  assert.equal(stranger.cid, null);
  // STOP: no more offers, nothing in Demandes
  res = await post(received('ev3', 'STOP'));
  assert.deepEqual(await res.json(), { received: true, optedOut: true });
  assert.equal(rt.engine.state.clients.get(rt.engine.state.clientByPhone.get('+33611223344')).marketing, false);
  assert.equal([...rt.engine.state.inquiries.values()].filter((x) => x.kind === 'sms').length, 2);
  // a text the phone sent, then reported failed: the outbox says so, and it is not sent again
  const m = [...rt.engine.state.messages.values()].find((x) => x.template === 'confirmation');
  rt.sms = fakeSms('gateway');
  await dispatch(rt);
  assert.equal(rt.engine.state.messages.get(m.id).status, 'sent');
  await post({ event: 'sms:delivered', id: 'ev4', payload: { messageId: 'nope', recipient: '+33611223344' } });
  assert.equal(rt.engine.state.messages.get(m.id).status, 'sent');
  await post({ event: 'sms:failed', id: 'ev5', payload: { messageId: 'gateway-1', recipient: '+33611223344', reason: 'RESULT_ERROR_NO_SERVICE' } });
  const failed = rt.engine.state.messages.get(m.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /téléphone du salon .*RESULT_ERROR_NO_SERVICE/);
  await dispatch(rt);
  assert.equal(rt.sms.sent.length, 1, 'never twice');
  // a wrong key changes nothing
  const bad = await handle(new Request('https://salon.test/api/sms/webhook?k=nope', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(received('ev6', 'Coucou')) }), { runtime: rt });
  assert.equal(bad.status, 401);
  assert.equal(rt.engine.verify().ok, true);
});

test('configuration: the salon phone and WhatsApp from the environment, Brevo as before', () => {
  const g = readConfig({ SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p' });
  assert.deepEqual(g.sms, { kind: 'gateway', url: GATEWAY_URL, username: 'u', password: 'p' });
  assert.equal(readConfig({ SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u' }).sms, null, 'no password, no route');
  assert.equal(readConfig({ SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p', SMSGATE_URL: 'https://sms.salon.fr/3rdparty/v1/' }).sms.url, 'https://sms.salon.fr/3rdparty/v1');
  assert.deepEqual(readConfig({ SMS_PROVIDER: 'brevo', BREVO_API_KEY: 'k' }).sms, { kind: 'brevo', apiKey: 'k', sender: 'LArchitecte' });
  assert.equal(readConfig({ SMS_PROVIDER: 'constructor' }).sms, null);
  assert.ok(readConfig({ SMS_PROVIDER: 'orange' }).smsProviderUnknown);
  assert.deepEqual(readConfig({ BREVO_API_KEY: 'k', WHATSAPP_SENDER: '+33 4 91 00 00 00' }).whatsapp, { apiKey: 'k', senderNumber: '+33491000000' });
  assert.equal(readConfig({ WHATSAPP_SENDER: '+33491000000' }).whatsapp, null, 'Brevo’s key too');
  assert.ok(readConfig({ BREVO_API_KEY: 'k', WHATSAPP_SENDER: 'salon' }).whatsappSenderInvalid);
});

test('Canal d’envoi: the routes and what is configured, never a secret; a test per route, through that route', async () => {
  const clock = { now: at(DAY, 10) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'tok-0123456789', PUBLIC_URL: 'https://barberlarchitecte.com',
    SMS_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-SECRET-1', SMSGATE_USERNAME: 'GATEUSER', SMSGATE_PASSWORD: 'gate-SECRET-2', WHATSAPP_SENDER: '+33491000000' };
  const rt = await createRuntime({ env, store: memoryStore(), clock: () => clock.now });
  const o = browser(rt);
  assert.equal((await o.post('/api/setup', { token: 'tok-0123456789', name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013' })).status, 200);
  const c = await o.get('/api/v1/messages/channels');
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.active, 'brevo');
  assert.deepEqual(c.json.routes.map((x) => [x.key, x.configured, x.active]), [['brevo', true, true], ['gateway', true, false]]);
  assert.equal(c.json.routes[1].host, 'api.sms-gate.app');
  assert.deepEqual({ ...c.json.whatsapp }, { configured: true, live: true, enabled: false, sender: '04 91 00 00 00', senderInvalid: false });
  assert.equal(c.json.templates.find((x) => x.key === 'review').category, 'sms', 'a review request leaves by SMS only (FID-01)');
  assert.equal(c.json.templates.find((x) => x.key === 'rebook').category, 'sms');
  assert.equal(c.json.templates.find((x) => x.key === 'confirmation').category, 'utility');
  assert.deepEqual(c.json.templates.find((x) => x.key === 'confirmation').vars, ['prenom', 'date', 'heure', 'barbier', 'lien']);
  assert.ok(c.json.vars.includes('prestation'));
  assert.doesNotMatch(c.text, /SECRET|GATEUSER|xkeysib/, 'no key, password or username in the answer');
  // the test of a route not in use yet goes through that route; the one in use through the provider
  const phone = fakeSms('gateway'), brevo = fakeSms('brevo'), wa = fakeWa();
  rt.smsRoute = (k) => ({ gateway: phone, brevo })[k] || null;
  rt.whatsapp = wa;
  let r = await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '06 12 34 56 78' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.simulated, false);
  assert.equal(r.json.to, '06 •• •• •• 78');
  assert.deepEqual(phone.sent.map((x) => x.to), ['+33612345678']);
  assert.match(phone.sent[0].body, /par le téléphone du salon/);
  assert.equal(brevo.sent.length, 0);
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'twilio', phone: '0612345678' })).json.error.code, 'not_configured');
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'pigeon', phone: '0612345678' })).status, 400);
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '04 91 00 00 00' })).json.error.code, 'not_mobile');
  // WhatsApp needs an approved template first
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'whatsapp', phone: '0612345678' })).json.error.code, 'no_template');
  assert.equal((await o.patch('/api/v1/settings', { messages: { whatsapp: { templates: { reminder: { id: 13, params: ['heure', 'barbier'] } } } } })).status, 200);
  r = await o.post('/api/v1/messages/channels/test', { route: 'whatsapp', phone: '0612345678' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.template, 'reminder');
  assert.equal(wa.sent[0].msg.templateId, 13);
  assert.deepEqual(wa.sent[0].msg.params.map(([k, v]) => [k, v.replace(/\s/g, ' ')]), [['heure', '10 h'], ['barbier', 'ton barbier']]);
  assert.equal((await o.get('/api/v1/messages/channels')).json.templates.find((x) => x.key === 'reminder').mapped, true);
  // a refusal is told as such
  rt.smsRoute = () => ({ name: 'gateway', send: async () => { throw new Error('Téléphone du salon : identifiants refusés'); } });
  r = await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '0612345678' });
  assert.equal(r.status, 502);
  assert.match(r.json.error.message, /identifiants refusés/);
  // three tests an hour per route
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '0612345678' })).status, 502);
  assert.equal((await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '0612345678' })).status, 429);
  // the health card names the route and the last failure
  const h = (await o.get('/api/v1/health')).json;
  assert.equal(h.sms.provider, 'brevo');
  assert.equal(h.sms.whatsapp, false);
  assert.equal(h.sms.lastFailure, null);
});

test('Canal d’envoi in the demo: owner only, tests simulated, nothing configured', async () => {
  const rt = await createRuntime({ env: { SESSION_SECRET: 'test-secret-0123456789' }, store: memoryStore(), clock: () => at(DAY, 11) });
  const o = browser(rt);
  assert.equal((await o.get('/api/v1/messages/channels')).status, 401);
  assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const c = (await o.get('/api/v1/messages/channels')).json;
  assert.equal(c.mode, 'demo');
  assert.equal(c.active, null);
  const r = await o.post('/api/v1/messages/channels/test', { route: 'gateway', phone: '0612345678' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.simulated, true);
});
