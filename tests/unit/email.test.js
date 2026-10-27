// The e-mail channel (WP-02): the client's confirmation with the calendar file, cancellations, the owner's alerts,
// the evening summary with the Z and its seal, Monday's report, delivery through Brevo, and mail waiting for a provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { addDays, localParts } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { eraseClient, updateClient } from '../../server/commands/clients.js';
import { createEngine } from '../../server/core/engine.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { REGISTRY } from '../../server/commands/tick-steps.js';
import { eveningDigest } from '../../server/commands/steps/digest.js';
import { createPayment, paymentSucceeded } from '../../server/commands/payments.js';
import { dispatch, maybeTick } from '../../server/http/scheduler.js';
import { createRuntime, readConfig } from '../../server/http/runtime.js';
import { brevoEmail, mailHtml, parseFrom } from '../../server/messaging/email.js';
import { buildIcs, fold } from '../../server/lib/ics.js';
import { memoryStore } from '../../server/store/memory.js';
import { browser } from '../api/client.js';

/** Erase a file the way the route does: its bookings to come are cancelled (and texted) first, then the file goes. */
async function eraseFully(engine, id, ctx) {
  for (let i = 0; i < 3; i++) if ((await engine.run(eraseClient, { id, cancelUpcoming: true }, ctx)).erased) return;
  throw new Error('not erased');
}

const SYSTEM = { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() };
const LATER = addDays(DAY, 2); // a Thursday
const MON = '2026-11-09';
const msgs = (t, f = () => true) => [...t.engine.state.messages.values()].filter(f);
const ics = (m) => m.mail.attachments[0].content;
/** A Brevo that answers, and remembers what it was sent. */
function fakeFetch(ref = 'brevo-1') {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ messageId: '<' + ref + '@smtp-relay>' }), { status: 201 }); };
  return Object.assign(f, { calls });
}
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 's' + sent.length }; } }; };
const rtOf = (t, email, sms = fakeSms()) => ({ engine: t.engine, sms, email, cfg: { cronSecret: '' }, origin: 'https://salon.test' });
const bookKarim = (t, x = {}) => t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 600, first: 'karim', last: 'Benali', phone: '0611223344', email: 'Karim.B@exemple.fr', ...x }, t.asClient);

test('a booking with an e-mail queues one SMS and one e-mail with the calendar file; Brevo receives it', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  const mine = msgs(t, (m) => m.apptId === r.id);
  assert.deepEqual(mine.map((m) => m.channel).sort(), ['email', 'sms'], 'one of each for the client');
  const mail = mine.find((m) => m.channel === 'email');
  assert.equal(mail.template, 'confirmation');
  assert.equal(mail.to, 'karim.b@exemple.fr');
  assert.equal(mail.toMasked, 'k•••@e•••.fr');
  assert.match(mail.mail.subject, /^Rendez-vous confirmé : jeudi 5 novembre à 10\sh/);
  assert.match(mail.body, /^Bonjour Karim,/);
  assert.match(mail.body, /Gérer mon rendez-vous \(déplacer ou annuler\) : https:\/\/x\/r\/LA/);
  assert.equal(mail.dueAt, mail.at, 'no quiet hours for transactional mail');
  const file = mail.mail.attachments[0];
  assert.equal(file.name, 'rendez-vous.ics');
  assert.match(file.type, /^text\/calendar/);
  assert.match(file.content, /\r\nDTSTART;TZID=Europe\/Paris:20261105T100000\r\n/);
  assert.match(file.content, /\r\nDTEND;TZID=Europe\/Paris:20261105T103000\r\n/);
  assert.match(file.content, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Paris/);
  assert.match(file.content, /LOCATION:Barber L’Architecte\\, 16\\, place Pélabon\\, 13013 Marseille/);
  assert.match(file.content, /UID:ap_\w+@larchitecte/);
  assert.match(file.content, /METHOD:PUBLISH/);

  // the chain holds no address, no subject, no file: all of it is pii
  const ev = t.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === mail.id);
  assert.doesNotMatch(JSON.stringify(ev.data), /exemple\.fr|Karim|VCALENDAR/i);
  assert.equal(ev.pii.to, 'karim.b@exemple.fr');

  // delivery: the payload Brevo's transactional API expects
  const f = fakeFetch();
  const rt = rtOf(t, brevoEmail({ apiKey: 'xkeysib-1', from: 'rdv@barberlarchitecte.com', replyTo: 'larchitectebarber@gmail.com', fetchImpl: f }));
  await dispatch(rt);
  assert.equal(f.calls.length, 2, 'the client and the owner');
  const call = f.calls.find((c) => c.body.to[0].email === 'karim.b@exemple.fr');
  assert.equal(call.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['api-key'], 'xkeysib-1');
  assert.deepEqual(call.body.sender, { email: 'rdv@barberlarchitecte.com', name: 'Barber L’Architecte' });
  assert.deepEqual(call.body.replyTo, { email: 'larchitectebarber@gmail.com' });
  assert.equal(call.body.subject, mail.mail.subject);
  assert.equal(call.body.textContent, mail.body);
  assert.match(call.body.htmlContent, /<a href="https:\/\/x\/r\/LA[^"]*"[^>]*>Gérer mon rendez-vous<\/a>/);
  assert.equal(call.body.attachment[0].name, 'rendez-vous.ics');
  assert.match(Buffer.from(call.body.attachment[0].content, 'base64').toString('utf8'), /DTSTART;TZID=Europe\/Paris:20261105T100000/);
  assert.deepEqual(call.body.tags, ['confirmation']);
  const sent = t.engine.state.messages.get(mail.id);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.providerRef, '<brevo-1@smtp-relay>');
  assert.equal(rt.sms.sent.length, 1, 'the SMS left by its own channel');
  assert.equal(t.engine.verify().ok, true);
});

test('the owner hears of each online booking and cancellation; moves update the same calendar event', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  const alert = t.engine.state.messages.get('msg_obk_' + r.id);
  assert.equal(alert.channel, 'email');
  assert.equal(alert.to, 'patron@test.fr', 'the owner account’s e-mail by default');
  assert.equal(alert.mail.subject, 'Nouveau rendez-vous : Karim, jeu. 05/11 10\u00a0h avec Ali (Coupe)');
  assert.equal(alert.apptId, null, 'not one of the client’s messages');

  // a move: a new confirmation, the same UID, a higher SEQUENCE; the owner is not told
  t.clock.now = at(DAY, 11);
  await t.engine.run(A.moveByClient, { id: r.id, day: LATER, start: 690 }, t.asClient);
  const moved = t.engine.state.messages.get('msg_mconf_' + r.id + '_1');
  assert.match(moved.mail.subject, /^Rendez-vous déplacé : jeudi 5 novembre à 11\sh\s30/);
  assert.match(ics(moved), /SEQUENCE:1/);
  assert.equal(ics(moved).match(/UID:.*/)[0], ics(t.engine.state.messages.get('msg_mconf_' + r.id + '_0')).match(/UID:.*/)[0]);
  assert.equal(msgs(t, (m) => m.template === 'owner_booking').length, 1);

  // the client cancels: their copy removes the event, the owner is told with the reason
  await t.engine.run(A.cancelByClient, { id: r.id, reason: 'Empêchement' }, t.asClient);
  const cx = t.engine.state.messages.get('msg_mcx_' + r.id);
  assert.match(cx.body, /Ton annulation est bien prise en compte/);
  assert.match(ics(cx), /METHOD:CANCEL/);
  assert.match(ics(cx), /STATUS:CANCELLED/);
  assert.match(ics(cx), /SEQUENCE:2/);
  const ocx = t.engine.state.messages.get('msg_ocx_' + r.id);
  assert.equal(ocx.mail.subject, 'Annulation : Karim, jeu. 05/11 11\u00a0h\u00a030 avec Ali (Coupe)');
  assert.match(ocx.body, /« Empêchement »/);

  // the salon cancels with notice: SMS and e-mail
  const b = await bookKarim(t, { start: 900 });
  await t.engine.run(A.cancelAppointment, { id: b.id, notify: true }, t.asOwner());
  assert.deepEqual(msgs(t, (m) => m.apptId === b.id && m.template === 'cancelled').map((m) => m.channel).sort(), ['email', 'sms']);
  assert.match(t.engine.state.messages.get('msg_mcx_' + b.id).body, /est annulé par le salon/);
  assert.equal(t.engine.state.messages.get('msg_ocx_' + b.id), undefined, 'a cancellation by the salon is not an alert');
});

test('the toggles: no client e-mail when switched off, no alert when the owner said so, another address when set', async () => {
  const t = await salon();
  await rejects(t.engine.run(updateSettings, { notify: { to: 'pas-une-adresse' } }, t.asOwner()), 'invalid');
  await rejects(t.engine.run(updateSettings, { notify: { evening: '25:00' } }, t.asOwner()), 'invalid');
  await t.engine.run(updateSettings, { messages: { email: false }, notify: { newBooking: false } }, t.asOwner());
  const r = await bookKarim(t);
  assert.deepEqual(msgs(t).map((m) => m.channel), ['sms']);
  await t.engine.run(updateSettings, { messages: { email: true }, notify: { newBooking: true, to: 'Alertes@Salon.fr' } }, t.asOwner());
  const b = await bookKarim(t, { start: 660 });
  assert.equal(t.engine.state.messages.get('msg_obk_' + b.id).to, 'alertes@salon.fr');
  // a client without an e-mail gets the SMS only
  const c = await bookKarim(t, { start: 720, first: 'Sami', phone: '0622334455', email: undefined });
  assert.deepEqual(msgs(t, (m) => m.apptId === c.id).map((m) => m.channel), ['sms']);
  assert.ok(r.id);
});

test('a deposit booking: the client’s e-mail and the owner’s alert wait for the payment', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { deposits: { mode: 'all', percent: 30 } }, t.asOwner());
  const r = await bookKarim(t, { serviceIds: [t.ids.color] });
  assert.equal(r.status, 'pending');
  assert.deepEqual(msgs(t, (m) => m.channel === 'email'), []);
  await t.engine.run(createPayment, { id: 'py_1', kind: 'deposit', amount: r.deposit, apptId: r.id, provider: 'simulated' }, SYSTEM);
  await t.engine.run(paymentSucceeded, { id: 'py_1', amount: r.deposit }, { ...SYSTEM, meta: t.asClient.meta });
  const mail = t.engine.state.messages.get('msg_mconf_' + r.id + '_0');
  assert.match(mail.body, /acompte de 18,00\s€ réglé/);
  assert.match(t.engine.state.messages.get('msg_obk_' + r.id).body, /acompte de 18,00\s€ réglé/);
});

test('erasing the client blanks their e-mails, the owner’s alert about them included', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  const cid = t.engine.state.appts.get(r.id).clientId;
  await eraseFully(t.engine, cid, t.asOwner());
  for (const id of ['msg_mconf_' + r.id + '_0', 'msg_obk_' + r.id]) {
    const m = t.engine.state.messages.get(id);
    assert.equal(m.to, '');
    assert.equal(m.body, '');
    assert.equal(m.mail, null);
  }
  const stored = (await t.store.read(0)).events.filter((e) => e.type === 'message.queued' && e.data.channel === 'email');
  assert.ok(stored.length >= 2);
  for (const e of stored) assert.equal(e.pii, undefined, 'the store forgot the address and the text');
  // the scheduler then has nothing to send
  const f = fakeFetch();
  await dispatch(rtOf(t, brevoEmail({ apiKey: 'k', from: 'rdv@x.fr', fetchImpl: f })));
  assert.equal(f.calls.length, 0);
  assert.equal(t.engine.state.messages.get('msg_obk_' + r.id).error, 'Adresse effacée');
  assert.equal(t.engine.verify().ok, true);
});

/* ---------------- the owner's summaries ---------------- */

async function dayAtTheTill(t) {
  const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.beard], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'card', amount: 3000 }] }, t.asOwner());
  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  // tomorrow: one booking, the rest of both chairs free
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 1), start: 600, sms: false }, t.asOwner());
}

test('at 20:00 the tick queues one evening summary with the Z and its seal; never twice', async () => {
  const t = await salon();
  await dayAtTheTill(t);
  t.clock.now = at(DAY, 18, 40);
  await t.engine.run(S.closeDay, {}, t.asOwner());
  const z = t.engine.state.closures.get(DAY);
  t.clock.now = at(DAY, 19, 59);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(t.engine.state.messages.get('msg_digest_' + DAY), undefined, 'not before the time');
  t.clock.now = at(DAY, 20, 0);
  await t.engine.run(tick, {}, { ...SYSTEM, meta: { siteUrl: 'https://salon.test/', backup: { at: at(DAY, 3, 2), off: '' } } });
  const d = t.engine.state.messages.get('msg_digest_' + DAY);
  assert.equal(d.channel, 'email');
  assert.equal(d.template, 'digest');
  assert.equal(d.to, 'patron@test.fr');
  assert.match(d.mail.subject, /^Ta journée du mardi 3 novembre : 50\s€ · demain 1 rendez-vous$/);
  const seal = z.seal.slice(0, 8);
  assert.ok(d.body.includes('· Z' + String(z.number).padStart(4, '0') + ' · 50,00\u00a0€ · sceau ' + seal + '…'), d.body);
  assert.match(d.body, /Chiffre d’affaires : 50,00\s€ \(2 tickets\)/);
  assert.match(d.body, /Demain, mercredi 4 novembre\n· 1 rendez-vous\n· 37 demi-heures libres \(Ali 19, Ben 18\)/);
  assert.match(d.body, /Envois : aucun échec aujourd’hui\n/);
  assert.match(d.body, /Sauvegarde : dernière mardi 3 novembre à 3\sh\s02/);
  assert.match(d.body, /Le Comptoir : https:\/\/salon\.test\/comptoir/);
  t.clock.now = at(DAY, 20, 30);
  await t.engine.run(tick, {}, SYSTEM);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(msgs(t, (m) => m.template === 'digest').length, 1, 'deterministic key: one a day');
  assert.ok(REGISTRY.some((x) => x.name === 'digest'));
});

test('the evening summary by SMS too; a Z not done yet says so; a day with nothing to tell sends nothing', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { notify: { phone: '06 98 76 54 32', evening: '19:30' } }, t.asOwner());
  t.clock.now = at(DAY, 19, 45);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(msgs(t, (m) => m.template === 'digest').length, 0, 'no till, no Z, nothing tomorrow');
  await dayAtTheTill(t);
  await t.engine.run(tick, {}, SYSTEM);
  const mail = t.engine.state.messages.get('msg_digest_' + DAY);
  assert.match(mail.body, /· Z du jour pas encore fait\n/);
  const sms = t.engine.state.messages.get('msg_digestsms_' + DAY);
  assert.equal(sms.channel, 'sms');
  assert.equal(sms.to, '+33698765432');
  assert.equal(sms.body, "L'Architecte : aujourd'hui 50 €, Z pas encore fait. Demain 1 rdv, 37 demi-heures libres.");
  assert.equal(sms.dueAt, sms.at, 'the owner’s own text is not held by the quiet hours');
  // switched off: nothing the next evening
  await t.engine.run(updateSettings, { notify: { evening: '' } }, t.asOwner());
  t.clock.now = at(addDays(DAY, 1), 21);
  await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(msgs(t, (m) => m.template === 'digest').length, 2);
});

test('failed texts and a missing backup are in the summary', async () => {
  const t = await salon();
  await dayAtTheTill(t);
  const failing = { name: 'brevo', async send() { throw new Error('Crédit SMS épuisé'); } };
  await bookKarim(t, { email: undefined, day: addDays(DAY, 1) });
  await dispatch(rtOf(t, null, failing));
  t.clock.now = at(DAY, 20, 5);
  const ctx = { now: t.clock.now, local: localParts(t.clock.now), meta: { backup: { at: 0, off: '' }, providers: { sms: true, email: true } } };
  const d = eveningDigest(t.engine.state, ctx);
  assert.match(d.text, /Envois : 2 SMS en échec aujourd’hui, le détail dans Relances › Messages envoyés/);
  assert.match(d.text, /Sauvegarde : aucune pour l’instant/);
  assert.match(d.sms, / 2 SMS en échec\.$/);
});

test('Monday 08:00: last week’s report, once', async () => {
  const t = await salon();
  await dayAtTheTill(t);
  const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 900 }, t.asOwner());
  t.clock.now = at(DAY, 15, 10);
  await t.engine.run(A.setStatus, { id: a.id, status: 'no_show' }, t.asOwner());
  t.clock.now = at(MON, 7, 59);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(t.engine.state.messages.get('msg_weekly_' + MON), undefined);
  t.clock.now = at(MON, 8, 0);
  await t.engine.run(tick, {}, { ...SYSTEM, meta: { siteUrl: 'https://salon.test/' } });
  const w = t.engine.state.messages.get('msg_weekly_' + MON);
  assert.equal(w.channel, 'email');
  assert.equal(w.mail.subject, 'Ta semaine du 2 nov. au 8 nov. : 50 €');
  assert.match(w.body, /La semaine du lundi 2 novembre au dimanche 8 novembre :/);
  assert.match(w.body, /Chiffre d’affaires : 50,00\s€\n/);
  assert.match(w.body, /Visites : 1, dont 1 nouveau client\n/);
  assert.match(w.body, /Absences : 1 \(50\s%\)/);
  assert.match(w.body, /Meilleur barbier : Ali, 30,00\s€/);
  assert.match(w.body, /Top prestations : (Coupe \+ barbe \(1\), Coupe \(1\)|Coupe \(1\), Coupe \+ barbe \(1\))/);
  assert.match(w.body, /Le détail : https:\/\/salon\.test\/comptoir\/rapports/);
  t.clock.now = at(MON, 9, 0);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(msgs(t, (m) => m.template === 'weekly').length, 1);
  // a Tuesday is no Monday
  t.clock.now = at(addDays(MON, 1), 9, 0);
  await t.engine.run(tick, {}, SYSTEM);
  assert.equal(msgs(t, (m) => m.template === 'weekly').length, 1);
});

/* ---------------- providers ---------------- */

const SECRET = 'test-secret-0123456789';
async function production(env) {
  const clock = { now: at(DAY, 10) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13', ...env }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  const setup = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  return { rt, clock, owner };
}

test('production without EMAIL_FROM: e-mails stay queued, the warning says so, the SMS still leave', async () => {
  const { rt } = await production({ SMS_PROVIDER: 'brevo', BREVO_API_KEY: 'xkeysib-1' });
  assert.equal(rt.cfg.email, null);
  assert.equal(rt.email, null);
  assert.ok(rt.warnings.some((w) => w.startsWith('Aucun fournisseur e-mail')), rt.warnings.join(' | '));
  rt.sms = fakeSms();
  // an owner alert and a summary are e-mails like any other
  await rt.engine.run({ run(s, input, ctx) { ctx.emit('message.queued', { id: 'msg_x', channel: 'email', template: 'digest', cid: null, apptId: null, dueAt: ctx.now, toMasked: 'g•••@salon.test' }, { to: 'gerant@salon.test', body: 'Bonsoir', mail: { subject: 'Ta journée' } }); ctx.emit('message.queued', { id: 'msg_y', channel: 'sms', template: 'digest', cid: null, apptId: null, dueAt: ctx.now, toMasked: '06' }, { to: '+33611223344', body: 'Salut' }); } }, {}, SYSTEM);
  await dispatch(rt);
  assert.equal(rt.engine.state.messages.get('msg_x').status, 'queued', 'waits for a provider, never marked simulé');
  assert.equal(rt.engine.state.messages.get('msg_y').status, 'sent');
  const boot = await (await production({})).owner.get('/api/v1/bootstrap');
  assert.equal(boot.json.providers.email, null);

  // with the sender set, Brevo is the provider and the warning is gone
  const ok = await production({ BREVO_API_KEY: 'xkeysib-1', EMAIL_FROM: 'Barber L’Architecte <rdv@barberlarchitecte.com>', EMAIL_REPLY_TO: 'larchitectebarber@gmail.com' });
  assert.deepEqual(ok.rt.cfg.email, { kind: 'brevo', apiKey: 'xkeysib-1', from: 'rdv@barberlarchitecte.com', fromName: 'Barber L’Architecte', replyTo: 'larchitectebarber@gmail.com' });
  assert.equal(ok.rt.email.name, 'brevo');
  assert.ok(!ok.rt.warnings.some((w) => /fournisseur e-mail/.test(w)));
  assert.equal((await ok.owner.get('/api/v1/bootstrap')).json.providers.email, 'brevo');
  assert.ok(readConfig({ BREVO_API_KEY: 'k', EMAIL_FROM: 'pas une adresse' }).emailFromInvalid);
});

test('the demo marks e-mails simulé', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  await t.engine.run({ run(s, input, ctx) { ctx.emit('shop.initialized', { mode: 'demo' }); } }, {}, SYSTEM);
  await dispatch(rtOf(t, null, null));
  assert.equal(t.engine.state.messages.get('msg_mconf_' + r.id + '_0').status, 'simulated');
});

test('the outbox API gives each message its channel and, for the owner, an e-mail’s subject', async () => {
  const { rt, owner, clock } = await production({ BREVO_API_KEY: 'k', EMAIL_FROM: 'rdv@barberlarchitecte.com' });
  await rt.engine.run({ run(s, input, ctx) { ctx.emit('message.queued', { id: 'msg_x', channel: 'email', template: 'weekly', cid: null, apptId: null, dueAt: ctx.now, toMasked: 'g•••@salon.test' }, { to: 'gerant@salon.test', body: 'Bonjour', mail: { subject: 'Ta semaine' } }); } }, {}, SYSTEM);
  clock.now += 1000;
  const out = await owner.get('/api/v1/messages');
  assert.equal(out.status, 200);
  const m = out.json.items.find((x) => x.id === 'msg_x');
  assert.equal(m.channel, 'email');
  assert.equal(m.subject, 'Ta semaine');
  assert.equal(m.to, 'g•••@salon.test');
  assert.equal(out.json.emailProvider, 'brevo');
});

test('the scheduler brings the last backup into the evening summary', async () => {
  const { rt, clock } = await production({});
  rt.backups = { listBackups: async () => [{ name: '2026-11-03.json.gz.enc', day: DAY, at: at(DAY, 3, 4), count: 1, head: '', salon: '' }] };
  // a booking tomorrow, so the evening has something to tell
  await rt.engine.run({ run(s, input, ctx) { ctx.emit('appt.booked', { id: 'ap_t', code: 'LA-T', clientId: null, staffId: 'st_x', day: addDays(DAY, 1), start: 600, dur: 30, services: [{ id: 'x', name: 'Coupe' }], price: 2000, source: 'salon', status: 'booked' }); } }, {}, SYSTEM);
  clock.now = at(DAY, 20, 1);
  await maybeTick(rt, { siteUrl: 'https://salon.test/' }, { force: true });
  const d = rt.engine.state.messages.get('msg_digest_' + DAY);
  assert.ok(d, 'queued by the real tick');
  assert.equal(d.to, 'gerant@salon.test');
  assert.match(d.body, /Sauvegarde : dernière mardi 3 novembre à 3\sh\s04/);
  assert.match(d.body, /Envois : aucun échec aujourd’hui/);
});

/* ---------------- the pieces ---------------- */

test('the calendar file: escaped text, folded lines, summer time with the same wall clock', () => {
  const f = buildIcs({ uid: 'ap_1@larchitecte', day: '2026-07-14', start: 600, dur: 45, stamp: Date.UTC(2026, 6, 1, 8, 0, 0), summary: 'Coupe; barbe, soin', description: 'Ligne 1\nLigne 2 avec un texte assez long pour dépasser soixante-quinze octets à coup sûr, accents compris éàü', location: 'X' });
  assert.match(f, /DTSTAMP:20260701T080000Z\r\n/);
  assert.match(f, /DTSTART;TZID=Europe\/Paris:20260714T100000\r\nDTEND;TZID=Europe\/Paris:20260714T104500\r\n/);
  assert.match(f, /SUMMARY:Coupe\\; barbe\\, soin\r\n/);
  assert.match(f, /DESCRIPTION:Ligne 1\\nLigne 2/);
  for (const line of f.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(f.replace(/\r\n /g, '').match(/DESCRIPTION:.*/)[0].endsWith('éàü'), true, 'unfolded, the text is whole');
  assert.ok(f.endsWith('END:VCALENDAR\r\n'));
  assert.equal(fold('é'.repeat(50)).split('\r\n ').every((l) => Buffer.byteLength(l) <= 75), true);
});

test('the HTML is built from the text, escaped, with the button instead of the bare address', () => {
  const h = mailHtml('Bonjour <Karim>,\n\nGérer : https://salon.test/r/abc\nAutre https://salon.test/x\nTapé par un client : https://evil.example/x', { cta: { label: 'Gérer mon rendez-vous', url: 'https://salon.test/r/abc' }, links: ['https://salon.test/x'], brand: 'Barber' });
  assert.match(h, /Bonjour &lt;Karim&gt;,/);
  assert.doesNotMatch(h, /Gérer : /);
  assert.match(h, /<a href="https:\/\/salon\.test\/r\/abc"[^>]*>Gérer mon rendez-vous<\/a>/);
  assert.match(h, /<a href="https:\/\/salon\.test\/x"/);
  // only the addresses the server wrote are links: one a client typed stays text
  assert.doesNotMatch(h, /href="https:\/\/evil/);
  assert.match(h, /Tapé par un client : https:\/\/evil\.example\/x/);
  assert.deepEqual(parseFrom('rdv@barberlarchitecte.com'), { email: 'rdv@barberlarchitecte.com', name: '' });
  assert.deepEqual(parseFrom('"L’Architecte" <RDV@x.fr>'), { email: 'rdv@x.fr', name: 'L’Architecte' });
  assert.equal(parseFrom('nope'), null);
});

test('Brevo refusing a mail marks it failed with its reason', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  const f = async () => new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 });
  await dispatch(rtOf(t, brevoEmail({ apiKey: 'bad', from: 'rdv@x.fr', fetchImpl: f })));
  const m = t.engine.state.messages.get('msg_mconf_' + r.id + '_0');
  assert.equal(m.status, 'failed');
  assert.equal(m.error, 'Clé Brevo refusée : vérifie BREVO_API_KEY', 'in French, with what to check');
});

test('online moves carried over by the WordPress re-import do not count against the client’s three', async () => {
  const t = await salon();
  const r = await bookKarim(t, { email: undefined });
  // what server/commands/import.js does for a move made on the old site
  const importMove = (start) => t.engine.run({ run(s, input, ctx) {
    const a = s.appts.get(r.id);
    ctx.emit('appt.moved', { id: a.id, day: a.day, start, staffId: a.staffId, from: { day: a.day, start: a.start, staffId: a.staffId }, by: 'import' });
    ctx.emit('appt.updated', { id: a.id, patch: { ext: { ...(a.ext || {}), moves: a.moves + 1 } } });
  } }, {}, SYSTEM);
  for (const start of [630, 660, 690]) await importMove(start);
  assert.equal(t.engine.state.appts.get(r.id).moves, 3);
  for (const start of [720, 750, 780]) await t.engine.run(A.moveByClient, { id: r.id, day: LATER, start }, t.asClient);
  assert.equal(t.engine.state.appts.get(r.id).moves, 6);
  await rejects(t.engine.run(A.moveByClient, { id: r.id, day: LATER, start: 810 }, t.asClient), 'too_many');
  // without the old site, three moves are still the limit
  const b = await bookKarim(t, { email: undefined, start: 900, first: 'Sami', phone: '0622334455' });
  for (const start of [930, 960, 990]) await t.engine.run(A.moveByClient, { id: b.id, day: LATER, start }, t.asClient);
  await rejects(t.engine.run(A.moveByClient, { id: b.id, day: LATER, start: 1020 }, t.asClient), 'too_many');
});

/* ---------------- review fixes ---------------- */

test('a client’s number with a stranger’s e-mail: the stranger gets this booking only, never the file’s name nor its later mails', async () => {
  const t = await salon();
  // Yanis is on file with his number and no e-mail; someone books online with that number and their own address
  const r = await bookKarim(t, { first: 'zed', last: '', phone: '06 12 34 56 78', email: 'stranger@evil.fr' });
  assert.equal(t.engine.state.appts.get(r.id).clientId, t.ids.yanis, 'the phone finds the file, as before');
  const first = t.engine.state.messages.get('msg_mconf_' + r.id + '_0');
  assert.equal(first.to, 'stranger@evil.fr', 'this booking’s mail goes where it was asked');
  assert.match(first.body, /^Bonjour Zed,/);
  assert.doesNotMatch(first.body + first.mail.subject, /Yanis|Martin/);
  assert.equal(t.engine.state.clients.get(t.ids.yanis).email, '', 'the typed address never lands on the file');
  // the salon books and moves Yanis at the counter: nothing goes to the stranger
  const c = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: LATER, start: 600 }, { ...t.asOwner(), meta: { linkFor: (a) => 'https://x/r/' + a.code } });
  await t.engine.run(A.moveAppointment, { id: c.id, day: LATER, start: 660, notify: true }, { ...t.asOwner(), meta: { linkFor: (a) => 'https://x/r/' + a.code } });
  await t.engine.run(A.cancelAppointment, { id: c.id, notify: true }, t.asOwner());
  assert.deepEqual(msgs(t, (m) => m.to === 'stranger@evil.fr').map((m) => m.id), [first.id]);
  // the file's own address, set by the salon, gets the file's name
  await t.engine.run(updateClient, { id: t.ids.yanis, patch: { email: 'yanis@exemple.fr' } }, t.asOwner());
  const d = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: LATER, start: 720 }, t.asOwner());
  assert.match(t.engine.state.messages.get('msg_mconf_' + d.id + '_0').body, /^Bonjour Yanis,/);
  assert.equal(t.engine.state.messages.get('msg_mconf_' + d.id + '_0').to, 'yanis@exemple.fr');
  // a web address cannot pass for a first name
  await rejects(bookKarim(t, { first: 'https://evil.example/x', phone: '0699887766', start: 780 }), 'invalid');
});

test('“Confirmer par SMS” off at the counter stops the text, not the e-mail with the calendar file', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  const cid = t.engine.state.appts.get(r.id).clientId;
  const c = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: LATER, start: 720, sms: false }, t.asOwner());
  assert.deepEqual(msgs(t, (m) => m.apptId === c.id).map((m) => m.channel), ['email']);
});

test('a booking waiting for its deposit: no calendar file on a move nor on a cancellation, the confirmation once paid', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { deposits: { mode: 'all', percent: 30 } }, t.asOwner());
  const r = await bookKarim(t, { serviceIds: [t.ids.color] });
  t.clock.now = at(DAY, 10, 5);
  await t.engine.run(A.moveByClient, { id: r.id, day: LATER, start: 720 }, t.asClient);
  assert.deepEqual(msgs(t, (m) => m.channel === 'email'), [], 'nothing before the deposit');
  await t.engine.run(createPayment, { id: 'py_1', kind: 'deposit', amount: r.deposit, apptId: r.id, provider: 'simulated' }, SYSTEM);
  await t.engine.run(paymentSucceeded, { id: 'py_1', amount: r.deposit }, { ...SYSTEM, meta: t.asClient.meta });
  const mail = t.engine.state.messages.get('msg_mconf_' + r.id + '_1');
  assert.match(mail.body, /acompte de 18,00\s€ réglé/, 'the paid confirmation, at the new time');
  assert.match(mail.mail.subject, /12\sh/);
  // another one, cancelled before paying: no "annulation" for an event never sent
  const b = await bookKarim(t, { serviceIds: [t.ids.color], start: 900 });
  await t.engine.run(A.cancelByClient, { id: b.id }, t.asClient);
  assert.equal(t.engine.state.messages.get('msg_mcx_' + b.id), undefined);
  assert.equal(t.engine.state.messages.get('msg_ocx_' + b.id), undefined);
});

test('the owner’s address and mobile stay out of the chain; a number that cannot get a text is refused', async () => {
  const t = await salon();
  await rejects(t.engine.run(updateSettings, { notify: { phone: '12' } }, t.asOwner()), 'invalid');
  await rejects(t.engine.run(updateSettings, { notify: { evening: '08:00' } }, t.asOwner()), 'invalid');
  await t.engine.run(updateSettings, { notify: { to: 'Patron@Salon.FR', phone: '06 98 76 54 32', evening: '21:00' } }, t.asOwner());
  const ev = t.engine.journal.filter((e) => e.type === 'settings.updated').at(-1);
  assert.doesNotMatch(JSON.stringify(ev.data), /salon\.fr|98 76/i);
  assert.deepEqual(ev.data.patch, { notify: { evening: '21:00' } });
  assert.deepEqual(ev.pii, { notify: { to: 'patron@salon.fr', phone: '06 98 76 54 32' } });
  const N = t.engine.state.settings.notify;
  assert.equal(N.to, 'patron@salon.fr');
  assert.equal(N.phone, '06 98 76 54 32');
  assert.equal(N.evening, '21:00');
  // the address alone, cleared: still pii, and the projection follows
  await t.engine.run(updateSettings, { notify: { to: '' } }, t.asOwner());
  const ev2 = t.engine.journal.filter((e) => e.type === 'settings.updated').at(-1);
  assert.deepEqual(ev2.data.patch, {});
  assert.equal(t.engine.state.settings.notify.to, '');
  assert.equal(t.engine.state.settings.notify.phone, '06 98 76 54 32');
  // replayed from the store, the same settings
  const again = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await again.sync(true);
  assert.deepEqual(again.state.settings.notify, t.engine.state.settings.notify);
  assert.equal(t.engine.verify().ok, true);
});

test('the summary counts failed e-mails too, and no “waiting” in the demo or for texts held by the quiet hours', async () => {
  const t = await salon();
  await dayAtTheTill(t);
  await bookKarim(t, { day: addDays(DAY, 1) });
  const refused = brevoEmail({ apiKey: 'bad', from: 'rdv@x.fr', fetchImpl: async () => new Response('{}', { status: 401 }) });
  await dispatch(rtOf(t, refused, fakeSms()));
  t.clock.now = at(DAY, 20, 5);
  const ctx = (providers) => ({ now: t.clock.now, local: localParts(t.clock.now), meta: { providers } });
  const d = eveningDigest(t.engine.state, ctx({ sms: true, email: true }));
  assert.match(d.text, /Envois : 2 e-mails en échec aujourd’hui/);
  assert.match(d.sms, / 2 e-mails en échec\.$/, 'the SMS says it, since the mail may not arrive');
  // production without an SMS provider: one due text waits, one held until the morning does not count
  await t.engine.run({ run(s, input, c) {
    c.emit('message.queued', { id: 'msg_w1', channel: 'sms', template: 'reminder', cid: null, apptId: null, dueAt: c.now - 1, toMasked: '06' }, { to: '+33611223344', body: 'x' });
    c.emit('message.queued', { id: 'msg_w2', channel: 'sms', template: 'review', cid: null, apptId: null, dueAt: c.now + 12 * 3600000, toMasked: '06' }, { to: '+33611223344', body: 'x' });
  } }, {}, SYSTEM);
  assert.match(eveningDigest(t.engine.state, ctx({ sms: false, email: true })).text, / ; 1 SMS en attente d’un fournisseur$/);
  await t.engine.run({ run(s, input, c) { c.emit('shop.initialized', { mode: 'demo' }); } }, {}, SYSTEM);
  assert.doesNotMatch(eveningDigest(t.engine.state, ctx({ sms: false, email: false })).text, /en attente/, 'the demo simulates them');
});

test('the summary SMS says “1 demi-heure libre”; the 1st of the month is “1er”', async () => {
  const t = await salon();
  // tomorrow: only Ben works, booked all day but the last half-hour
  await t.engine.run({ run(s, input, c) {
    for (const [i, start] of [540, 600, 660, 720, 780, 840, 900, 960, 1020].entries()) c.emit('appt.booked', { id: 'ap_f' + i, code: 'LA-F' + i, clientId: null, staffId: s.staff.get(t.ids.Ben).id, day: addDays(DAY, 1), start, dur: 60, services: [{ id: 'x', name: 'Coupe' }], price: 2000, source: 'salon', status: 'booked' });
    c.emit('appt.booked', { id: 'ap_g', code: 'LA-G', clientId: null, staffId: t.ids.Ali, day: addDays(DAY, 1), start: 540, dur: 570, services: [{ id: 'x', name: 'Coupe' }], price: 2000, source: 'salon', status: 'booked' });
  } }, {}, SYSTEM);
  t.clock.now = at(DAY, 20, 5);
  const d = eveningDigest(t.engine.state, { now: t.clock.now, local: localParts(t.clock.now), meta: {} });
  assert.match(d.sms, /, 1 demi-heure libre\./);
  // Monday 2 November reports the week of Monday 26 October to Sunday 1st November
  const m = await salon({ day: '2026-10-27' });
  await m.engine.run(S.checkout, { lines: [{ kind: 'service', ref: m.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, m.asOwner());
  m.clock.now = at('2026-11-02', 9);
  await m.engine.run(tick, {}, SYSTEM);
  const w = m.engine.state.messages.get('msg_weekly_2026-11-02');
  assert.match(w.mail.subject, /^Ta semaine du 26 oct\. au 1er nov\./);
  assert.match(w.body, /au dimanche 1er novembre :/);
});

test('a backup lookup that fails or hangs says “état inconnu”, and never holds the tick', async () => {
  const { rt, clock } = await production({});
  rt.backups = { listBackups: () => new Promise(() => {}) };
  await rt.engine.run({ run(s, input, ctx) { ctx.emit('appt.booked', { id: 'ap_t', code: 'LA-T', clientId: null, staffId: 'st_x', day: addDays(DAY, 1), start: 600, dur: 30, services: [{ id: 'x', name: 'Coupe' }], price: 2000, source: 'salon', status: 'booked' }); } }, {}, SYSTEM);
  clock.now = at(DAY, 20, 1);
  const t0 = Date.now();
  await maybeTick(rt, {}, { force: true });
  assert.ok(Date.now() - t0 < 4000, 'bounded');
  assert.match(rt.engine.state.messages.get('msg_digest_' + DAY).body, /Sauvegarde : état inconnu/);
});

test('a sent mail’s calendar file leaves the memory, the journal still verifies; the client file lists no owner alert', async () => {
  const t = await salon();
  const r = await bookKarim(t);
  await dispatch(rtOf(t, brevoEmail({ apiKey: 'k', from: 'rdv@x.fr', fetchImpl: fakeFetch() })));
  const m = t.engine.state.messages.get('msg_mconf_' + r.id + '_0');
  assert.equal(m.status, 'sent');
  assert.equal(m.mail.attachments, undefined);
  assert.match(m.mail.subject, /^Rendez-vous confirmé/);
  const ev = t.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === m.id);
  assert.ok(ev.pii.mail.attachments, 'the event itself is untouched');
  assert.equal(t.engine.verify().ok, true);

  const { rt, owner, clock } = await production({});
  await rt.engine.run({ run(s, input, ctx) {
    ctx.emit('client.added', { id: 'cl_k', cid: 'cl_k', source: 'site', sms: true, marketing: false, tags: [] }, { first: 'Karim', phone: '+33611223344', email: 'k@x.fr' });
    ctx.emit('message.queued', { id: 'msg_c', channel: 'email', template: 'confirmation', cid: 'cl_k', apptId: null, dueAt: ctx.now, toMasked: 'k•••@x•••.fr' }, { to: 'k@x.fr', body: 'Bonjour', mail: { subject: 'Rendez-vous confirmé' } });
    ctx.emit('message.queued', { id: 'msg_o', channel: 'email', template: 'owner_booking', cid: 'cl_k', apptId: null, dueAt: ctx.now, toMasked: 'g•••@s•••.test' }, { to: 'gerant@salon.test', body: 'Nouveau', mail: { subject: 'Nouveau rendez-vous' } });
  } }, {}, SYSTEM);
  clock.now += 1000;
  const file = await owner.get('/api/v1/clients/cl_k');
  assert.equal(file.status, 200, JSON.stringify(file.json));
  assert.deepEqual(file.json.messages.map((x) => [x.template, x.channel]), [['confirmation', 'email']]);
});
