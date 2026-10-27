// SMS consent and STOP, quiet hours, the countries texted, honest follow-up figures, and a sealed day taking no booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, updateClient } from '../../server/commands/clients.js';
import { sendRebook, smsOptOut } from '../../server/commands/messages.js';
import { updateSettings } from '../../server/commands/shop.js';
import { afterQuiet, phoneAllowed, queueMessage } from '../../server/domain/messages.js';
import { attribution } from '../../server/domain/attribution.js';
import { brevoSms, parseSmsWebhook, webhookKey, webhookUrl } from '../../server/messaging/sms.js';
import { createRuntime } from '../../server/http/runtime.js';
import { handle } from '../../server/http/app.js';
import { TEMPLATE_FLAGS } from '../../server/core/templates.js';
import { tick } from '../../server/commands/system.js';
import { setCredentials } from '../../server/commands/team.js';
import { hashSecret } from '../../server/auth/password.js';
import { dispatch } from '../../server/http/scheduler.js';
import { CGV_TEXT } from '../../server/settings/shop.js';
import { withStop, frHoliday } from '../../shared/sms.js';
import { browser } from '../api/client.js';

const SAT = '2026-11-07', MON = '2026-11-09';
const QUIET = { from: 1200, to: 480, sunday: true };

/** A past visit, checked out, so the client has a rhythm and a "since last". */
let slot = 0;
async function visit(t, clientId, day) {
  const keep = t.clock.now;
  t.clock.now = at(day, 10);
  const a = await t.engine.run(A.createAppointment, { clientId, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start: 600 + 30 * (slot++ % 6) }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  t.clock.now = keep;
  return a;
}
async function client(t, first, phone, marketing) {
  return (await t.engine.run(addClient, { first, phone, marketing }, t.asOwner())).id;
}
const messages = (t, tpl) => [...t.engine.state.messages.values()].filter((m) => !tpl || m.template === tpl);

test('no consent, no follow-up text; with consent the text ends with the STOP mention', async () => {
  const t = await salon();
  const a = await client(t, 'Karim', '0611111111', false), b = await client(t, 'Sami', '0622222222', false);
  for (const id of [a, b]) await visit(t, id, addDays(DAY, -40));
  assert.deepEqual(await t.engine.run(sendRebook, { clientIds: [a, b] }, t.asOwner()), { sent: 0, skipped: 2, ids: [] });
  assert.equal(messages(t, 'rebook').length, 0);

  for (const id of [a, b]) await t.engine.run(updateClient, { id, patch: { marketing: true } }, t.asOwner());
  const r = await t.engine.run(sendRebook, { clientIds: [a, b] }, t.asOwner());
  assert.deepEqual(r, { sent: 2, skipped: 0, ids: [a, b] });
  for (const m of messages(t, 'rebook')) {
    assert.ok(m.body.endsWith(' STOP au 36173'), m.body);
    assert.equal(m.marketing, true, 'flagged for the provider');
    assert.match(m.body, /déjà 40 jours/);
  }
  // the owner's own text gets it too, once
  const c = await client(t, 'Nabil', '0633333333', true);
  await visit(t, c, addDays(DAY, -35));
  await t.engine.run(sendRebook, { clientIds: [c], text: 'Salut {prenom}, on se revoit ? {lien} STOP au 36173' }, t.asOwner());
  const own = messages(t, 'rebook').find((m) => m.cid === c);
  assert.equal(own.body.match(/STOP/g).length, 1);
  assert.equal(TEMPLATE_FLAGS.rebook.marketing, true);
});

test('the STOP mention is skipped only when the text already holds it', () => {
  const stop = ' STOP au 36173';
  assert.equal(withStop('On se revoit ? stop au 36173', stop), 'On se revoit ? stop au 36173', 'any case');
  // a STOP that is not the opt-out still gets the mention
  assert.equal(withStop('STOP aux cheveux longs ! https://x', stop), 'STOP aux cheveux longs ! https://x STOP au 36173');
  assert.equal(withStop('Salut', ''), 'Salut');
});

test('a follow-up held by the night does not leave once the client said STOP or the salon switched the offers off', async () => {
  const t = await salon();
  const karim = await client(t, 'Karim', '0611111111', true), sami = await client(t, 'Sami', '0622222222', true), nabil = await client(t, 'Nabil', '0633333333', true);
  for (const id of [karim, sami, nabil]) await visit(t, id, addDays(DAY, -40));
  t.clock.now = at(SAT, 21);
  assert.equal((await t.engine.run(sendRebook, { clientIds: [karim, sami, nabil] }, t.asOwner())).sent, 3);
  const msg = (cid) => messages(t, 'rebook').find((m) => m.cid === cid);
  assert.equal(msg(karim).dueAt, at(MON, 8));
  // Sunday: Karim answers STOP to another text; the waiting offer is closed at once
  t.clock.now = at('2026-11-08', 11);
  await t.engine.run(smsOptOut, { phone: '+33611111111' }, t.sys);
  assert.equal(msg(karim).status, 'skipped');
  assert.equal(msg(karim).error, 'Désinscrit des bons plans');
  // Sami asks at the counter; the owner switches the offers off on the file
  await t.engine.run(updateClient, { id: sami, patch: { marketing: false } }, t.asOwner());
  assert.equal(msg(sami).status, 'queued');
  // Monday 08:05: only Nabil's text reaches the provider
  t.clock.now = at(MON, 8, 5);
  const sent = [];
  const rt = { engine: t.engine, sms: { name: 'fake', send: async (to, body, o) => { sent.push({ to, body, o }); return { ref: 'x' }; } }, cfg: { cronSecret: '' }, origin: 'https://x' };
  await dispatch(rt);
  assert.deepEqual(sent.map((x) => x.to), ['+33633333333']);
  assert.equal(sent[0].o.marketing, true);
  assert.equal(msg(sami).status, 'skipped');
  assert.equal(msg(sami).error, 'Désinscrit des bons plans');
  assert.equal(msg(nabil).status, 'sent');
  assert.equal(t.engine.verify().ok, true);
});

test('GET /api/v1/relances: only clients who agreed are listed, the others are counted, and the figures are in clients', async () => {
  const t = await salon();
  const yes = await client(t, 'Karim', '0611111111', true), no = await client(t, 'Sami', '0622222222', false);
  for (const id of [yes, no]) await visit(t, id, addDays(DAY, -40));
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: 'patron@test.fr', password: 'Patron-1313!', remember: true })).status, 200);
  const r = (await b.get('/api/v1/relances')).json;
  assert.deepEqual(r.items.map((c) => c.id), [yes]);
  assert.equal(r.excludedNoConsent, 1);
  assert.deepEqual(r.stats, { sent: 0, clientsBack: 0, revenueBack: 0, rate: 0 });
  assert.equal(r.stop, ' STOP au 36173');
  // the badge counts the same people as the list
  const pulse = (await b.get('/api/v1/pulse')).json;
  assert.equal(pulse.badges.relances, 1);
  // sent at night: the row says when it leaves, and the figures wait for it to leave
  t.clock.now = at(DAY, 22);
  const sendRes = await b.post('/api/v1/relances/send', { clientIds: [yes, no] });
  assert.equal(sendRes.json.sent, 1, JSON.stringify(sendRes.json));
  const night = (await b.get('/api/v1/relances')).json;
  assert.equal(night.items[0].lastDue, at(addDays(DAY, 1), 8));
  assert.equal(night.stats.sent, 0);
  // the next morning it left, and Karim booked: one client back out of one
  t.clock.now = at(addDays(DAY, 1), 9);
  await dispatch({ engine: rt.engine, sms: { name: 'fake', send: async () => ({ ref: 'x' }) }, cfg: { cronSecret: '' }, origin: 'https://x' });
  await rt.engine.run(A.createAppointment, { clientId: yes, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 600 }, t.asOwner());
  const after = (await b.get('/api/v1/relances')).json;
  assert.deepEqual(after.stats, { sent: 1, clientsBack: 1, revenueBack: 2000, rate: 100 });
  assert.equal(after.items[0]?.lastDue ?? null, null);
  assert.deepEqual((await b.get('/api/v1/messages/webhook')).json, { url: null, marketing: ['rebook'] });
});

test('nobody seen in the last week gets "déjà 0 jours"', async () => {
  const t = await salon();
  const a = await client(t, 'Karim', '0611111111', true), never = await client(t, 'Sami', '0622222222', true);
  await visit(t, a, addDays(DAY, -3));
  assert.deepEqual(await t.engine.run(sendRebook, { clientIds: [a, never] }, t.asOwner()), { sent: 0, skipped: 2, ids: [] });
});

test('a marketing text never leaves without consent, whoever queues it', async () => {
  const t = await salon();
  const r = await t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'x', template: 'rebook', to: '+33612345678', cid: t.ids.yanis, vars: {} }) }) }, {}, t.sys);
  assert.equal(r.id, null);
  assert.equal(messages(t).length, 0);
});

test('quiet hours: reviews, follow-ups and waiting-list offers wait for the morning, service texts do not', async () => {
  assert.equal(afterQuiet(QUIET, at(DAY, 0, 38)), at(DAY, 8), '00:38 → 08:00 the same day');
  assert.equal(afterQuiet(QUIET, at(SAT, 21)), at(MON, 8), 'Saturday 21:00 → Monday 08:00');
  assert.equal(afterQuiet(QUIET, at('2026-11-08', 14)), at(MON, 8), 'Sunday afternoon → Monday 08:00');
  assert.equal(afterQuiet(QUIET, at(DAY, 19, 59)), at(DAY, 19, 59));
  assert.equal(afterQuiet(QUIET, at(DAY, 20)), at(addDays(DAY, 1), 8));
  assert.equal(afterQuiet({ from: 0, to: 0, sunday: false }, at('2026-11-08', 23)), at('2026-11-08', 23), 'no quiet hours');
  // public holidays too, when asked (the default): 11 November, Easter Monday, Ascension
  assert.equal(afterQuiet({ ...QUIET, holidays: true }, at('2026-11-10', 21)), at('2026-11-12', 8), 'Tuesday night → past Wednesday 11 November');
  assert.equal(afterQuiet(QUIET, at('2026-11-11', 10)), at('2026-11-11', 10), 'holidays off: 11 November is a day like another');
  assert.ok(frHoliday('2026-04-06') && frHoliday('2026-05-14') && frHoliday('2026-05-25') && frHoliday('2026-12-25'));
  assert.ok(!frHoliday('2026-11-03') && !frHoliday('2026-04-05'));

  const t = await salon();
  const a = await client(t, 'Karim', '0611111111', true);
  await visit(t, a, addDays(DAY, -40));
  t.clock.now = at(DAY, 0, 38);
  await t.engine.run(sendRebook, { clientIds: [a] }, t.asOwner());
  assert.equal(messages(t, 'rebook')[0].dueAt, at(DAY, 8));
  t.clock.now = at(SAT, 21);
  await t.engine.run(sendRebook, { clientIds: [a] }, t.asOwner());
  assert.equal(messages(t, 'rebook').find((m) => m.at === at(SAT, 21)).dueAt, at(MON, 8));

  // a confirmation at 23:00 leaves at once
  t.clock.now = at(DAY, 23);
  const late = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  const conf = messages(t, 'confirmation').find((m) => m.apptId === late.id);
  assert.equal(conf.dueAt, at(DAY, 23));
  assert.equal(conf.status, 'queued');

  // the owner can move or switch off the quiet hours
  await t.engine.run(updateSettings, { messages: { quiet: { from: 1260, to: 540, sunday: false } } }, t.asOwner());
  assert.equal(afterQuiet(t.engine.state.settings.messages.quiet, at(DAY, 20, 30)), at(DAY, 20, 30));
  await rejects(t.engine.run(updateSettings, { messages: { stopSuffix: 'Désinscription au 36173' } }, t.asOwner()), 'invalid');
});

test('no waiting-list offer at night: 30 minutes to answer a text that leaves at 8:00 would be none', async () => {
  const t = await salon();
  const tomorrow = addDays(DAY, 1);
  await t.engine.run(A.addWait, { day: tomorrow, staffId: 'any', serviceId: t.ids.cut, first: 'Rayan', phone: '0639981201' }, t.asClient);
  t.clock.now = at(DAY, 21);
  await t.engine.run(tick, {}, t.sys);
  assert.equal([...t.engine.state.waitlist.values()][0].status, 'waiting');
  assert.equal(messages(t, 'waitlist').length, 0);
  t.clock.now = at(tomorrow, 8, 5);
  await t.engine.run(tick, {}, t.sys);
  assert.equal([...t.engine.state.waitlist.values()][0].status, 'offered');
  assert.equal(messages(t, 'waitlist')[0].dueAt, t.clock.now);
});

test('a number outside the allowed countries is recorded as not sent', async () => {
  const t = await salon();
  const uk = await client(t, 'Oliver', '+447700900123', true);
  const r = await t.engine.run(A.createAppointment, { clientId: uk, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 900 }, t.asOwner());
  const m = messages(t, 'confirmation').find((x) => x.apptId === r.id);
  assert.equal(m.status, 'skipped');
  assert.equal(m.error, 'Numéro étranger non autorisé');
  assert.ok(phoneAllowed('+33612345678', t.engine.state.settings.messages.countries));
  assert.ok(phoneAllowed('+262692123456', t.engine.state.settings.messages.countries), 'La Réunion');
  assert.ok(!phoneAllowed('+447700900123', t.engine.state.settings.messages.countries));
  // +269 is the Comoros, not Mayotte (+262 269 / 639, covered by +262)
  assert.ok(!phoneAllowed('+2693212345', t.engine.state.settings.messages.countries));
  assert.ok(phoneAllowed('+262639123456', t.engine.state.settings.messages.countries), 'Mayotte');
  // a French client is unaffected
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 900 }, t.asOwner());
  assert.equal(messages(t, 'confirmation').find((x) => x.cid === t.ids.yanis).status, 'queued');
});

test('Brevo gets the marketing type for promotional texts only, and the webhook address', async () => {
  const calls = [];
  const sms = brevoSms({ apiKey: 'k', sender: 'LArchitecte', fetchImpl: async (url, o) => { calls.push(JSON.parse(o.body)); return new Response(JSON.stringify({ messageId: 7 }), { status: 201 }); } });
  await sms.send('+33612345678', 'Salut', { marketing: true, webhookUrl: 'https://x/api/sms/webhook?k=abc' });
  await sms.send('+33612345678', 'Confirmé');
  assert.equal(calls[0].type, 'marketing');
  // Brevo's field is webUrl ("webhook called for each event related to the message")
  assert.equal(calls[0].webUrl, 'https://x/api/sms/webhook?k=abc');
  assert.equal('webhookUrl' in calls[0], false);
  assert.equal(calls[0].recipient, '33612345678');
  assert.equal(calls[1].type, 'transactional');
  assert.equal(calls[1].webUrl, undefined);
  assert.equal(webhookUrl('https://salon.fr/', ''), '', 'no CRON_SECRET, no webhook');
  assert.match(webhookUrl('https://salon.fr/', 'cron'), /^https:\/\/salon\.fr\/api\/sms\/webhook\?k=[\w-]{32}$/);
});

test('webhook payloads: Brevo unsubscribe, a STOP reply, Twilio inbound, and what is not a STOP', () => {
  const one = (raw, type = 'application/json') => parseSmsWebhook(typeof raw === 'string' ? raw : JSON.stringify(raw), type)[0];
  assert.deepEqual(one({ to: '33612345678', msg_status: 'unsubscribed', messageId: 1 }), { stop: true, phones: ['+33612345678'] });
  assert.equal(one({ to: '33612345678', msg_status: 'replied', reply: ' Stop svp' }).stop, true);
  assert.deepEqual(one('From=%2B33612345678&To=%2B33700000000&Body=STOP', 'application/x-www-form-urlencoded'), { stop: true, phones: ['+33612345678', '+33700000000'] });
  assert.equal(one({ to: '33612345678', msg_status: 'delivered' }).stop, false);
  assert.equal(one({ to: '33612345678', msg_status: 'replied', reply: 'Je serai en retard, pas de stop' }).stop, false);
  // a delivery report carries the salon's own text, which ends with the STOP mention: not a reply
  assert.equal(one({ to: '33612345678', msg_status: 'delivered', content: 'Salut Karim ! STOP au 36173' }).stop, false);
  // a number blacklisted at Brevo (it texted Brevo's STOP number) is an opt-out too
  assert.equal(one({ to: '33612345678', msg_status: 'bl' }).stop, true);
  assert.equal(one({ to: '33612345678', event: 'blacklisted' }).stop, true);
  // several events in one post: each one is read
  const many = parseSmsWebhook(JSON.stringify([{ to: '33611111111', msg_status: 'delivered' }, { to: '33622222222', msg_status: 'unsubscribed' }]), 'application/json');
  assert.deepEqual(many.map((e) => e.stop), [false, true]);
  assert.deepEqual(many[1].phones, ['+33622222222']);
  assert.deepEqual(parseSmsWebhook('{not json', 'application/json'), [{ stop: false, phones: [] }]);
});

test('the STOP webhook takes the client off the offers, found by phone; a wrong key changes nothing', async () => {
  const t = await salon();
  await t.engine.run(updateClient, { id: t.ids.yanis, patch: { marketing: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', CRON_SECRET: 'cron-1313' }, store: t.store, clock: () => t.clock.now });
  // Brevo calls from its own servers: no Origin, no cookie
  const post = (k, body, type = 'application/json') => handle(new Request('https://salon.test/api/sms/webhook?k=' + k, { method: 'POST', headers: { 'content-type': type }, body }), { runtime: rt });
  const brevo = JSON.stringify({ to: '33612345678', msg_status: 'replied', reply: 'STOP' });
  assert.equal((await post('wrong', brevo)).status, 401);
  assert.equal(rt.engine.state.clients.get(t.ids.yanis).marketing, true);
  const res = await post(webhookKey('cron-1313'), brevo);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true, optedOut: true });
  const c = rt.engine.state.clients.get(t.ids.yanis);
  assert.equal(c.marketing, false);
  assert.equal(c.marketingSrc, 'stop');
  assert.equal(c.sms, true, 'confirmations and reminders go on');
  // the same STOP twice records nothing more; an unknown number is answered politely
  const v = rt.engine.state.version;
  await post(webhookKey('cron-1313'), 'From=%2B33612345678&Body=STOP', 'application/x-www-form-urlencoded');
  assert.equal(rt.engine.state.version, v);
  assert.deepEqual(await (await post(webhookKey('cron-1313'), JSON.stringify({ to: '33699999999', msg_status: 'unsubscribed' }))).json(), { received: true, unknown: true });
  // without CRON_SECRET there is no webhook at all
  const bare = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  assert.equal((await handle(new Request('https://salon.test/api/sms/webhook?k=', { method: 'POST', body: brevo }), { runtime: bare })).status, 404);
  assert.equal(rt.engine.verify().ok, true);
});

test('a STOP is recorded on the client file directly too (idempotent)', async () => {
  const t = await salon();
  const r1 = await t.engine.run(smsOptOut, { phone: '06 12 34 56 78' }, t.sys);
  assert.deepEqual(r1, { ok: true, found: true });
  const v = t.engine.state.version;
  await t.engine.run(smsOptOut, { phone: '+33612345678' }, t.sys);
  assert.equal(t.engine.state.version, v);
});

test('attribution counts clients, not appointments, within 21 days, never above 100 %', async () => {
  const t = await salon();
  const a = await client(t, 'Karim', '0611111111', true), b = await client(t, 'Sami', '0622222222', true);
  for (const id of [a, b]) await visit(t, id, addDays(DAY, -40));
  await t.engine.run(sendRebook, { clientIds: [a, b] }, t.asOwner());
  // Karim books twice after the text; Sami books once, then cancels
  t.clock.now = at(DAY, 11);
  await t.engine.run(A.createAppointment, { clientId: a, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, t.asOwner());
  await t.engine.run(A.createAppointment, { clientId: a, serviceIds: [t.ids.beard], staffId: t.ids.Ali, day: addDays(DAY, 9), start: 600 }, t.asOwner());
  const sb = await t.engine.run(A.createAppointment, { clientId: b, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 3), start: 600 }, t.asOwner());
  await t.engine.run(A.cancelAppointment, { id: sb.id }, t.asOwner());
  const r = attribution(t.engine.state, { now: t.clock.now, templates: ['rebook'] }).rebook;
  // Karim's two bookings make one client back (the old figure counted 2 of 2 texts: 100 %, or more)
  assert.deepEqual(r, { sent: 2, clientsBack: 1, revenueBack: 5000, rate: 50 });
  assert.ok(r.rate <= 100);
  // a booking more than 21 days after the text is not the text's doing
  t.clock.now = at(addDays(DAY, 25), 10);
  await t.engine.run(A.createAppointment, { clientId: b, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 30), start: 600 }, t.asOwner());
  assert.equal(attribution(t.engine.state, { now: t.clock.now, templates: ['rebook'] }).rebook.clientsBack, 1);
  assert.deepEqual(attribution(t.engine.state, { now: t.clock.now, templates: ['review'] }).review, { sent: 0, clientsBack: 0, revenueBack: 0, rate: 0 });
});

test('the site records consent with when and where, and the CGV version accepted', async () => {
  const t = await salon();
  t.engine.state.settings.shop.cgvVersion = '2026-11-03'; // the owner changed a rule after the text's own date
  const base = { serviceIds: [t.ids.cut], staffId: 'any', day: addDays(DAY, 1), first: 'Lina' };
  const yes = await t.engine.run(A.bookOnline, { ...base, start: 600, phone: '0644444444', marketing: true }, t.asClient);
  const c = t.engine.state.clients.get(t.engine.state.appts.get(yes.id).clientId);
  assert.equal(c.marketing, true);
  assert.equal(c.marketingSrc, 'site');
  assert.equal(c.marketingAt, t.clock.now);
  const ev = t.engine.journal.find((e) => e.type === 'appt.booked' && e.data.id === yes.id);
  assert.equal(ev.data.cgv, '2026-11-03');
  // unticked: nothing is assumed, and an earlier yes is not taken back
  const no = await t.engine.run(A.bookOnline, { ...base, start: 660, phone: '0655555555' }, t.asClient);
  assert.equal(t.engine.state.clients.get(t.engine.state.appts.get(no.id).clientId).marketing, false);
  await t.engine.run(A.bookOnline, { ...base, start: 720, phone: '0644444444' }, t.asClient);
  assert.equal(c.marketing, true);
  // a known client who ticks it now agrees from now on
  await t.engine.run(A.bookOnline, { ...base, start: 780, phone: '0612345678', first: 'Yanis', marketing: true }, t.asClient);
  assert.equal(t.engine.state.clients.get(t.ids.yanis).marketingSrc, 'site');
  // an older stored date: the version in force is the text's own date
  t.engine.state.settings.shop.cgvVersion = '2026-01-01';
  const plain = await t.engine.run(A.bookOnline, { ...base, start: 840, phone: '0666666666' }, t.asClient);
  assert.equal(t.engine.journal.find((e) => e.type === 'appt.booked' && e.data.id === plain.id).data.cgv, CGV_TEXT);
});

test('after an early Z the day takes no booking from anyone, and the site stops saying open', async () => {
  const t = await salon();
  t.clock.now = at(DAY, 11);
  const keep = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  const hold = await t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 900 }, t.asClient);
  const before = await t.engine.run(A.addWalkin, { name: 'Avant le Z', serviceId: t.ids.cut, staffId: 'any' }, t.asOwner());
  await t.engine.run(S.closeDay, { early: true }, t.asOwner());
  await rejects(t.engine.run(A.updateWalkin, { id: before.id, action: 'seat', staffId: t.ids.Ali }, t.asOwner()), 'day_closed');
  await rejects(t.engine.run(A.bookOnline, { holdId: hold.holdId, serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 900, first: 'Lina', phone: '0644444444' }, t.asClient), 'taken');
  await rejects(t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 960 }, t.asOwner()), 'day_closed');
  await rejects(t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 960, force: true }, t.asOwner()), 'day_closed');
  await rejects(t.engine.run(A.moveAppointment, { id: keep.id, day: DAY, start: 960 }, t.asOwner()), 'day_closed');
  await rejects(t.engine.run(A.holdSlot, { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 960 }, t.asClient), 'taken');
  // a walk-in is refused at the desk, not when the barber calls them
  await rejects(t.engine.run(A.addWalkin, { name: 'Passant', serviceId: t.ids.cut, staffId: 'any' }, t.asOwner()), 'day_closed');
  // tomorrow is untouched
  await t.engine.run(A.moveAppointment, { id: keep.id, day: addDays(DAY, 1), start: 660 }, t.asOwner());

  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const live = await (await handle(new Request('https://salon.test/api/public/live'), { runtime: rt })).json();
  assert.equal(live.open, false, '11:00 on an open Tuesday, but the Z is done');
  assert.equal(live.closedToday, true);
  // the booking sheet shows the day as closed, not "complet"
  const av = await (await handle(new Request('https://salon.test/api/public/availability?services=' + t.ids.cut + '&days=2'), { runtime: rt })).json();
  assert.deepEqual(av.days.map((d) => d.open), [false, true]);
});
