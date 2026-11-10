// Back-office audit, « envois » : a text never leaves twice when two instances dispatch at once or a result write loses
// a race (F5); « c'est noté » never leaves while the deposit is unpaid (F10); the reminder by e-mail, the 2-hours
// reminder of a booking that missed the evening one, the e-mail that stands in for a refused SMS; the owner's alerts
// during the day; the month's entries to the accountant (« Lui envoyer le pack chaque mois »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { salon, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { updateClient } from '../../server/commands/clients.js';
import { createEngine } from '../../server/core/engine.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { closePeriod } from '../../server/commands/fiscal.js';
import { createPayment, paymentSucceeded } from '../../server/commands/payments.js';
import { startImportRun } from '../../server/commands/import.js';
import { freezeWordpress, markSwitched } from '../../server/commands/bascule.js';
import { tombKeyOf } from '../../server/commands/clients.js';
import { queueMessage } from '../../server/domain/messages.js';
import { cutoverHold } from '../../server/projections/bascule.js';
import { dispatch } from '../../server/http/scheduler.js';
import { alertWarnings, smsFailing, silence } from '../../server/commands/steps/alerts.js';
import { packDue } from '../../server/commands/steps/compta-pack.js';
import { checkFec } from '../../server/domain/ledger.js';
import messagesSettings from '../../server/settings/messages.js';
import notifySettings from '../../server/settings/notify.js';

const ORIGIN = 'https://salon.test';
const SYSTEM = { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() };
const HOUR = 3600000;
const TOMORROW = addDays(DAY, 1);
const fakeSms = (o = {}) => {
  const sent = [];
  return { name: 'brevo', sent, ...o, async send(to, body) {
    sent.push({ to, body });
    if (o.fail) throw Object.assign(new Error(o.fail), { status: 402 });
    return { ref: 'b-' + sent.length };
  } };
};
const fakeMail = () => { const sent = []; return { name: 'brevo', sent, async send(mail) { sent.push(mail); return { ref: 'm-' + sent.length }; } }; };
const rtOf = (engine, x = {}) => ({ engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN, sleep: async () => {}, ...x });
const q = (t, m) => t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, m) }) }, {}, { ...t.sys, meta: { siteUrl: ORIGIN + '/' } });
const META = { siteUrl: ORIGIN + '/', linkFor: (a) => ORIGIN + '/r/' + a.code };
const runTick = (t, meta = {}) => t.engine.run(tick, {}, { ...SYSTEM, meta: { ...META, ...meta } });
const msgs = (t, f = () => true) => [...t.engine.state.messages.values()].filter(f);
const of = (t, id) => msgs(t, (m) => m.apptId === id).map((m) => m.channel + ':' + m.template).sort();
const settings = (t, patch) => t.engine.run(updateSettings, patch, t.asOwner());
const book = (t, x = {}) => t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: TOMORROW, start: 600, first: 'Karim', phone: '0611223344', email: 'karim@exemple.fr', sms: true, ...x }, t.asClient);
const HEALTH = { health: { providers: { sms: true, email: true }, backup: null } };

/* ---------------- F5 · never twice ---------------- */

test('F5 · two instances dispatch the same text at once: it leaves once', async () => {
  const t = await salon();
  const b = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await b.sync(true);
  await q(t, { key: 'conf1', template: 'confirmation', to: '+33611223344', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await b.sync(true);
  const sa = fakeSms(), sb = fakeSms();
  await Promise.all([dispatch(rtOf(t.engine, { sms: sa })), dispatch(rtOf(b, { sms: sb }))]);
  assert.equal(sa.sent.length + sb.sent.length, 1, 'one of the two claims was written: only that instance sends');
  await t.engine.sync(true);
  assert.equal(t.engine.state.messages.get('msg_conf1').status, 'sent');
});

test('F5 · the write of the results loses a race: it is tried again, and the text does not leave a second time', async () => {
  const t = await salon();
  await q(t, { key: 'conf1', template: 'confirmation', to: '+33611223344', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  const sms = fakeSms();
  // the store refuses the first write that carries an outcome (another instance wrote in between)
  const append = t.store.append.bind(t.store);
  let refused = 0;
  t.store.append = async (events, ...rest) => {
    if (!refused && events.some((e) => e.type === 'message.updated' && e.data.patch.status === 'sent')) { refused++; return { ok: false }; }
    return append(events, ...rest);
  };
  await dispatch(rtOf(t.engine, { sms }));
  assert.equal(refused, 1);
  assert.equal(sms.sent.length, 1);
  assert.equal(t.engine.state.messages.get('msg_conf1').status, 'sent', 'written at the second try');
  // six minutes later the tick finds no stale claim to release, and nothing leaves again
  t.clock.now += 6 * 60000;
  await runTick(t);
  await dispatch(rtOf(t.engine, { sms }));
  assert.equal(sms.sent.length, 1);
});

test('F5 · a store that refuses every write of the results: the outcome waits in memory and the text is not taken again', async () => {
  const t = await salon();
  await q(t, { key: 'conf1', template: 'confirmation', to: '+33611223344', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  const sms = fakeSms();
  const append = t.store.append.bind(t.store);
  let down = true;
  t.store.append = async (events, ...rest) => (down && events.some((e) => e.type === 'message.updated' && e.data.patch.status === 'sent') ? { ok: false } : append(events, ...rest));
  const rt = rtOf(t.engine, { sms });
  await dispatch(rt);
  assert.equal(sms.sent.length, 1);
  assert.equal(t.engine.state.messages.get('msg_conf1').status, 'claimed');
  // the claim is released after five minutes: this instance still knows the provider has it
  t.clock.now += 6 * 60000;
  await runTick(t);
  assert.equal(t.engine.state.messages.get('msg_conf1').status, 'queued');
  await dispatch(rt);
  assert.equal(sms.sent.length, 1, 'not sent a second time');
  down = false;
  await dispatch(rt);
  assert.equal(sms.sent.length, 1);
  assert.equal(t.engine.state.messages.get('msg_conf1').status, 'sent');
});

/* ---------------- F10 · « c'est noté » ---------------- */

test('F10 · a booking waiting for its deposit, moved by the client: no « c’est noté » until the deposit is paid', async () => {
  const t = await salon();
  const r = await book(t, { serviceIds: [t.ids.color], start: 840 });
  assert.equal(r.status, 'pending');
  assert.deepEqual(of(t, r.id), [], 'nothing at booking: the deposit is not paid');
  await t.engine.run(A.moveByClient, { id: r.id, day: TOMORROW, start: 900 }, t.asClient);
  assert.equal(t.engine.state.appts.get(r.id).status, 'pending');
  assert.deepEqual(of(t, r.id), [], 'moved, still unpaid: no confirmation by SMS nor by e-mail');
  await t.engine.run(createPayment, { id: 'py_1', kind: 'deposit', amount: r.deposit, apptId: r.id, provider: 'simulated' }, SYSTEM);
  await t.engine.run(paymentSucceeded, { id: 'py_1', amount: r.deposit }, { ...SYSTEM, meta: t.asClient.meta });
  assert.deepEqual(of(t, r.id), ['email:confirmation', 'sms:confirmation'], 'paid: the confirmation leaves, with the new time');
  assert.match(msgs(t, (m) => m.apptId === r.id && m.channel === 'sms')[0].body, /c'est noté Karim ! .* 15 h/);
  // a booking without a deposit keeps its confirmation, and a move of it tells the new time
  const free = await book(t, { phone: '0611223355', email: '', start: 600 });
  assert.equal(free.status, 'booked');
  assert.deepEqual(of(t, free.id), ['sms:confirmation']);
});

/* ---------------- reminders ---------------- */

test('the settings: the reminder by e-mail is off until the owner decides, the day alerts are on', () => {
  assert.equal(messagesSettings.defaults().reminderEmail, false);
  assert.equal(messagesSettings.defaults().reminder2h, false);
  assert.equal(notifySettings.defaults().alerts, true);
});

test('the reminder by e-mail: nothing while it is off; on, at the hour of the SMS reminder, with the manage link, once', async () => {
  const t = await salon({ hour: 9 });
  const r = await book(t);
  // a client without an address, and one who gave only an address (texts switched off on his file)
  const noMail = await book(t, { phone: '0611223355', email: '', start: 660, first: 'Nadir' });
  t.clock.now = at(DAY, 18, 1);
  await runTick(t);
  assert.deepEqual(of(t, r.id), ['email:confirmation', 'sms:confirmation', 'sms:reminder'], 'off by default: the SMS reminder alone, as before');

  const u = await salon({ hour: 9 });
  await settings(u, { messages: { reminderEmail: true } });
  const k = await book(u);
  const n = await book(u, { phone: '0611223355', email: '', start: 660, first: 'Nadir' });
  const quiet = await book(u, { phone: '0611223366', email: 'sam@exemple.fr', start: 720, first: 'Sam' });
  await u.engine.run(updateClient, { id: u.engine.state.appts.get(quiet.id).clientId, patch: { sms: false } }, u.asOwner());
  u.clock.now = at(DAY, 17, 59);
  await runTick(u);
  assert.equal(msgs(u, (m) => m.template === 'reminder').length, 0, 'not before the hour');
  u.clock.now = at(DAY, 18, 1);
  await runTick(u);
  await runTick(u);
  assert.deepEqual(of(u, k.id), ['email:confirmation', 'email:reminder', 'sms:confirmation', 'sms:reminder']);
  assert.deepEqual(of(u, n.id), ['sms:confirmation', 'sms:reminder'], 'no address, no e-mail');
  assert.deepEqual(of(u, quiet.id).filter((x) => /reminder/.test(x)), ['email:reminder'], 'texts off on the file: the e-mail still reminds him');
  const mail = u.engine.state.messages.get('msg_mrem_' + k.id + '_' + TOMORROW);
  assert.equal(mail.to, 'karim@exemple.fr');
  assert.match(mail.mail.subject, /^Rappel : demain à 10\sh avec Ali/);
  assert.match(mail.body, /^Bonjour Karim,/);
  assert.match(mail.body, /Déplace ou annule ici : https:\/\/salon\.test\/r\/LA/);
  assert.equal(mail.mail.cta.label, 'Gérer mon rendez-vous');
  // an erased or cancelled booking gets none; the chain holds no address
  const ev = u.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === mail.id);
  assert.doesNotMatch(JSON.stringify(ev.data), /exemple\.fr|Karim/);
  void noMail;
});

test('a booking taken after the reminder’s hour gets the 2-hours reminder though that option is off; not in the quiet hours, not twice', async () => {
  const t = await salon({ hour: 19 });
  // 19:00 the evening before, for 10:00 the next day
  const late = await book(t);
  t.clock.now = at(DAY, 19, 30);
  await runTick(t);
  assert.equal(msgs(t, (m) => /^reminder/.test(m.template)).length, 0, 'the evening reminder skips a booking taken after its hour');
  t.clock.now = at(TOMORROW, 7, 58);
  await runTick(t);
  assert.equal(msgs(t, (m) => m.template === 'reminder2h').length, 0, 'more than two hours ahead');
  t.clock.now = at(TOMORROW, 8, 0);
  await runTick(t);
  await runTick(t);
  const rem = msgs(t, (m) => m.template === 'reminder2h');
  assert.equal(rem.length, 1);
  assert.equal(rem[0].id, 'msg_rem2_' + late.id + '_' + TOMORROW);
  assert.match(rem[0].body, /on t'attend à 10 h avec Ali/);
  assert.equal(t.engine.state.settings.messages.reminder2h, false);

  // a booking that had its evening reminder gets no second one while the option is off
  const u = await salon({ hour: 9 });
  const early = await book(u);
  u.clock.now = at(DAY, 18, 1);
  await runTick(u);
  u.clock.now = at(TOMORROW, 8, 30);
  await runTick(u);
  assert.deepEqual(of(u, early.id).filter((x) => /reminder/.test(x)), ['sms:reminder']);

  // taken less than 4 h before its time: the confirmation just left, no reminder on top
  const v = await salon({ hour: 9 });
  const soon = await book(v, { day: DAY, start: 720 });
  v.clock.now = at(DAY, 10, 30);
  await runTick(v);
  assert.deepEqual(of(v, soon.id).filter((x) => /reminder/.test(x)), []);

  // an early appointment: the reminder waits for the end of the quiet hours (8 h), then leaves if 30 minutes remain
  const w = await salon({ hour: 19 });
  await settings(w, { messages: { reminderEmail: true } });
  const dawn = await book(w, { start: 540 });
  w.clock.now = at(TOMORROW, 7, 30);
  await runTick(w);
  assert.deepEqual(of(w, dawn.id).filter((x) => /reminder/.test(x)), [], 'quiet hours: nothing at 7:30');
  w.clock.now = at(TOMORROW, 8, 0);
  await runTick(w);
  assert.deepEqual(of(w, dawn.id).filter((x) => /reminder/.test(x)), ['email:reminder2h', 'sms:reminder2h'], 'by e-mail too when the reminder by e-mail is on');
  assert.match(w.engine.state.messages.get('msg_mrem2_' + dawn.id + '_' + TOMORROW).mail.subject, /^Rappel : aujourd’hui à 9\sh/);
});

test('an SMS the provider refuses: the reminder goes once by e-mail to a client who gave an address; never with the e-mails off', async () => {
  const t = await salon({ hour: 9 });
  const r = await book(t);
  const n = await book(t, { phone: '0611223355', email: '', start: 660, first: 'Nadir' });
  const mail = fakeMail();
  const rt = rtOf(t.engine, { sms: fakeSms(), email: mail });
  await dispatch(rt);
  t.clock.now = at(DAY, 18, 1);
  await runTick(t);
  // the provider is out of credit when the reminders leave
  rt.sms = fakeSms({ fail: 'Brevo : crédit épuisé' });
  await dispatch(rt);
  assert.equal(t.engine.state.messages.get('msg_rem_' + r.id + '_' + TOMORROW).status, 'failed');
  t.clock.now += 60000;
  await runTick(t);
  await runTick(t);
  assert.deepEqual(of(t, r.id).filter((x) => /reminder/.test(x)), ['email:reminder', 'sms:reminder']);
  assert.deepEqual(of(t, n.id).filter((x) => /reminder/.test(x)), ['sms:reminder'], 'no address: nothing to fall back on');
  await dispatch(rt);
  const sent = mail.sent.filter((m) => /^Rappel/.test(m.subject));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'karim@exemple.fr');
  assert.match(sent[0].text, /Déplace ou annule ici : https:\/\/salon\.test\/r\//);
  // a failed confirmation: the client already has its e-mail (same key), nothing more leaves
  const u = await salon({ hour: 9 });
  const urt = rtOf(u.engine, { sms: fakeSms({ fail: 'Brevo : crédit épuisé' }), email: fakeMail() });
  const k = await book(u);
  await dispatch(urt);
  u.clock.now += 60000;
  await runTick(u);
  assert.deepEqual(of(u, k.id), ['email:confirmation', 'sms:confirmation']);
  // e-mails to clients off: the confirmation's SMS fails and no e-mail stands in for it
  const v = await salon({ hour: 9 });
  await settings(v, { messages: { email: false } });
  const vrt = rtOf(v.engine, { sms: fakeSms({ fail: 'Brevo : crédit épuisé' }), email: fakeMail() });
  const kv = await book(v);
  await dispatch(vrt);
  v.clock.now += 60000;
  await runTick(v);
  assert.deepEqual(of(v, kv.id), ['sms:confirmation']);
  // e-mails on, the confirmation's mail was never queued (the address came later): the fallback sends it
  await settings(v, { messages: { email: true } });
  v.clock.now += 60000;
  await runTick(v);
  assert.deepEqual(of(v, kv.id), ['email:confirmation', 'sms:confirmation']);
});

test('before the switch the reminders by e-mail wait like every text to a client', async () => {
  const t = await salon({ hour: 9 });
  await settings(t, { messages: { reminderEmail: true } });
  const r = await book(t);
  await t.engine.run(startImportRun, { source: 'files', files: [], window: [], map: { services: {}, staff: {} }, totals: { bookings: 0, clients: 0, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 } }, t.asOwner());
  assert.equal(cutoverHold(t.engine.state), true);
  t.clock.now = at(DAY, 18, 1);
  await runTick(t);
  const mail = fakeMail(), sms = fakeSms();
  await dispatch(rtOf(t.engine, { sms, email: mail }));
  assert.equal(sms.sent.length + mail.sent.length, 0);
  assert.equal(t.engine.state.messages.get('msg_mrem_' + r.id + '_' + TOMORROW).status, 'queued');
});

/* ---------------- the owner's alerts ---------------- */

test('three texts refused in a row: one alert to the owner, by e-mail and in the Comptoir, however many fail after', async () => {
  const t = await salon({ hour: 9 });
  const mail = fakeMail();
  const rt = rtOf(t.engine, { sms: fakeSms({ fail: 'Brevo : crédit épuisé' }), email: mail });
  for (let i = 0; i < 2; i++) await q(t, { key: 'c' + i, template: 'confirmation', to: '+3361122330' + i, cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await dispatch(rt);
  await runTick(t, HEALTH);
  assert.deepEqual(alertWarnings(t.engine.state, DAY), [], 'two failures are not a breakdown yet');
  for (let i = 2; i < 8; i++) await q(t, { key: 'c' + i, template: 'confirmation', to: '+3361122330' + i, cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await dispatch(rt);
  assert.equal(smsFailing(t.engine.state, at(DAY, 0)).n, 8);
  await runTick(t, HEALTH);
  await runTick(t, HEALTH);
  t.clock.now += HOUR;
  await runTick(t, HEALTH);
  const alerts = msgs(t, (m) => m.template === 'owner_alert');
  assert.equal(alerts.length, 1, 'one alert for the incident, not one per failure nor per tick');
  assert.equal(alerts[0].to, 'patron@test.fr');
  assert.match(alerts[0].mail.subject, /^Alerte : les SMS ne partent plus/);
  assert.match(alerts[0].body, /Les 8 derniers SMS du salon ont échoué \(« Brevo : crédit épuisé »\)/);
  assert.equal(alertWarnings(t.engine.state, DAY).length, 1);
  assert.match(alertWarnings(t.engine.state, DAY)[0], /^Les SMS ne partent plus/);
  await dispatch(rt);
  assert.equal(mail.sent.filter((m) => /^Alerte/.test(m.subject)).length, 1);
  // the day after, still broken: one more, and no line left of yesterday's
  t.clock.now = at(TOMORROW, 9);
  await runTick(t, HEALTH);
  assert.equal(msgs(t, (m) => m.template === 'owner_alert').length, 1, 'no failure today yet: nothing new');
  // a text that leaves closes the incident
  const ok = await salon({ hour: 9 });
  const okRt = rtOf(ok.engine, { sms: fakeSms({ fail: 'x' }) });
  for (let i = 0; i < 3; i++) await q(ok, { key: 'c' + i, template: 'confirmation', to: '+3361122330' + i, cid: ok.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await dispatch(okRt);
  ok.clock.now += 60000;
  await q(ok, { key: 'c9', template: 'confirmation', to: '+33611223309', cid: ok.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await dispatch(rtOf(ok.engine, { sms: fakeSms() }));
  assert.equal(smsFailing(ok.engine.state, at(DAY, 0)), null);
  // switched off, or run by hand without the scheduler's facts: nothing
  const off = await salon({ hour: 9 });
  await settings(off, { notify: { alerts: false } });
  for (let i = 0; i < 3; i++) await q(off, { key: 'c' + i, template: 'confirmation', to: '+3361122330' + i, cid: off.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  await dispatch(rtOf(off.engine, { sms: fakeSms({ fail: 'x' }) }));
  await runTick(off, HEALTH);
  assert.equal(msgs(off, (m) => m.template === 'owner_alert').length, 0);
});

test('a scheduler that stayed silent, a backup too old: one alert each; a backlog being drained or a held text is not silence', async () => {
  const t = await salon({ hour: 9 });
  await q(t, { key: 'c1', template: 'confirmation', to: '+33611223301', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  t.clock.now += 20 * 60000;
  await runTick(t, HEALTH);
  assert.equal(msgs(t, (m) => m.template === 'owner_alert').length, 0, 'twenty minutes: not yet');
  t.clock.now += 25 * 60000;
  assert.equal(silence(t.engine.state, t.clock.now, at(DAY, 0), { sms: true, email: true }), 45 * 60000);
  assert.equal(silence(t.engine.state, t.clock.now, at(DAY, 0), { sms: false, email: true }), 0, 'no provider: waiting, not silence');
  await runTick(t, HEALTH);
  await runTick(t, HEALTH);
  let alerts = msgs(t, (m) => m.template === 'owner_alert');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].mail.subject, /^Alerte : le planificateur est resté muet 45 min/);
  assert.match(alertWarnings(t.engine.state, DAY)[0], /^Le planificateur est resté muet/);
  // the backup: 37 h old
  await runTick(t, { health: { providers: { sms: true, email: true }, backup: { at: t.clock.now - 37 * HOUR, off: '', error: 'Stockage Blob indisponible' } } });
  await runTick(t, { health: { providers: { sms: true, email: true }, backup: { at: t.clock.now - 37 * HOUR, off: '', error: '' } } });
  alerts = msgs(t, (m) => m.template === 'owner_alert');
  assert.equal(alerts.length, 2);
  assert.match(alerts[1].mail.subject, /^Alerte : pas de sauvegarde depuis plus de 36 h/);
  assert.match(alerts[1].body, /Stockage Blob indisponible/);
  assert.equal(alertWarnings(t.engine.state, DAY).length, 2);

  // a relance of 30 texts due together, dispatched ten at a time: the last ones wait, the scheduler is not silent
  const u = await salon({ hour: 9 });
  for (let i = 0; i < 30; i++) await q(u, { key: 'c' + i, template: 'confirmation', to: '+336112233' + String(10 + i), cid: u.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  const rt = rtOf(u.engine, { sms: fakeSms() });
  await dispatch(rt);
  u.clock.now += 40 * 60000;
  await runTick(u, HEALTH);
  assert.equal(msgs(u, (m) => m.template === 'owner_alert').length, 0);
  // a backup 30 h old, a demo, a salon before its switch: nothing
  await runTick(u, { health: { providers: { sms: true, email: true }, backup: { at: u.clock.now - 30 * HOUR, off: '', error: '' } } });
  assert.equal(msgs(u, (m) => m.template === 'owner_alert').length, 0);
});

/* ---------------- the accountant's pack ---------------- */

const SERVER = join(import.meta.dirname, '..', '..', 'server');
function sources(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? sources(p) : p.endsWith('.js') ? [p] : []; });
}

test('compta.autoSend is read by a tick step; compta.ereporting by nothing, and no screen offers it', () => {
  const reads = (word) => sources(SERVER).filter((p) => !p.endsWith(join('settings', 'compta.js')) && new RegExp('\\b' + word + '\\b').test(readFileSync(p, 'utf8'))).map((p) => p.slice(SERVER.length + 1));
  assert.deepEqual(reads('autoSend'), [join('commands', 'steps', 'compta-pack.js')]);
  assert.deepEqual(reads('ereporting'), [], 'a setting kept for later: the day code reads it, the screen may offer it');
  const screen = readFileSync(join(SERVER, '..', 'web', 'src', 'comptoir', 'pages', 'reglages', 'sections', 'Compta.tsx'), 'utf8');
  assert.doesNotMatch(screen, /ereporting/);
  assert.match(screen, /Lui envoyer le pack chaque mois/);
});

/** October at the till (two days, each with its Z), closed on 1 November. */
async function october() {
  const t = await salon({ day: '2026-10-27', hour: 8 });
  for (const day of ['2026-10-27', '2026-10-30']) {
    t.clock.now = at(day, 9, 30);
    await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
    t.clock.now = at(day, 11);
    await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
    t.clock.now = at(day, 18, 40);
    await t.engine.run(S.closeDrawer, { counts: { 5000: 2 } }, t.asOwner());
    t.clock.now = at(day, 18, 45);
    await t.engine.run(S.closeDay, { day }, t.asOwner());
  }
  return t;
}
const accountant = (t, x = {}) => settings(t, { compta: { accountant: { name: 'Mme Roux', firm: 'Cabinet Roux', email: 'compta@cabinet-roux.fr' }, ...x } });
const packs = (t) => msgs(t, (m) => m.template === 'compta_pack');

test('« Lui envoyer le pack chaque mois » : the closed month’s entries leave once, with both files built as the mail leaves', async () => {
  const t = await october();
  await accountant(t);
  t.clock.now = at('2026-10-31', 20);
  await runTick(t);
  assert.equal(packs(t).length, 0, 'the month is not over');
  t.clock.now = at('2026-11-01', 5, 10);
  await runTick(t);
  assert.ok(t.engine.state.periodByKey.has('M:2026-10'), 'closed by the tick');
  await runTick(t);
  await runTick(t);
  assert.equal(packs(t).length, 1);
  const m = packs(t)[0];
  assert.equal(m.id, 'msg_pack_2026-10');
  assert.equal(m.to, 'compta@cabinet-roux.fr');
  assert.match(m.mail.subject, /^Écritures de octobre 2026 · /);
  assert.match(m.body, /^Bonjour Mme Roux,/);
  assert.match(m.body, /· 20 % : base 33,34\s€, TVA 6,66\s€/);
  assert.equal(m.mail.attachments, undefined, 'the files are not copied into the journal');
  const ev = t.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === m.id);
  assert.doesNotMatch(JSON.stringify(ev), /706|JournalCode/);
  const mail = fakeMail();
  await dispatch(rtOf(t.engine, { email: mail }));
  assert.equal(mail.sent.length, 1);
  const files = mail.sent[0].attachments;
  assert.deepEqual(files.map((f) => f.name), ['ecritures-2026-10.txt', 'ecritures-2026-10.csv']);
  assert.equal(checkFec(files[0].content).ok, true);
  assert.doesNotMatch(files[0].content + files[1].content, /Yanis|Martin/, 'no client name in the files');
  // December: nothing again for October, however long the mail waited
  t.clock.now = at('2026-11-20', 10);
  await runTick(t);
  assert.equal(packs(t).length, 1);
});

test('the pack: not without the option or an address, not for an old month, never before the switch nor for a month closed before it; it waits for a provider', async () => {
  const off = await october();
  await accountant(off, { autoSend: false });
  off.clock.now = at('2026-11-01', 5, 10);
  await runTick(off); await runTick(off);
  assert.equal(packs(off).length, 0, 'switched off');
  // switched on mid-November: October still goes; switched on in January: it does not
  await accountant(off, { autoSend: true });
  off.clock.now = at('2026-11-15', 10);
  await runTick(off);
  assert.equal(packs(off).length, 1);

  const none = await october();
  none.clock.now = at('2026-11-01', 5, 10);
  await runTick(none); await runTick(none);
  assert.equal(packs(none).length, 0, 'no address');
  await accountant(none);
  none.clock.now = at('2026-12-02', 10);
  assert.equal(packDue(none.engine.state, { now: none.clock.now, local: { day: '2026-12-02' } }), null, 'November is not closed, October is not last month');

  // before the switch: held; the month closed before the switch is the old site's, it never leaves
  const held = await october();
  await accountant(held);
  await held.engine.run(startImportRun, { source: 'files', files: [], window: [], map: { services: {}, staff: {} }, totals: { bookings: 0, clients: 0, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 } }, held.asOwner());
  held.clock.now = at('2026-11-01', 5, 10);
  await runTick(held); await runTick(held);
  assert.ok(held.engine.state.periodByKey.has('M:2026-10'));
  assert.equal(packs(held).length, 0, 'held: nothing is even queued');
  const owner = { ...held.asOwner(), meta: { tombKey: tombKeyOf('test-secret-0123456789') } };
  held.clock.now = at('2026-11-02', 9);
  await held.engine.run(freezeWordpress, {}, owner);
  await held.engine.run(markSwitched, { force: true, reason: 'Test' }, owner);
  held.clock.now = at('2026-11-02', 10);
  await runTick(held);
  assert.equal(packs(held).length, 0, 'closed before the switch');

  // no e-mail provider for a day: the pack is not « trop tard », it leaves when one is there
  const wait = await october();
  await accountant(wait);
  wait.clock.now = at('2026-11-01', 5, 10);
  await runTick(wait); await runTick(wait);
  wait.clock.now = at('2026-11-02', 9);
  const mail = fakeMail();
  await dispatch(rtOf(wait.engine, { email: mail, sms: fakeSms() }));
  assert.equal(mail.sent.length, 1);
  assert.equal(packs(wait)[0].status, 'sent');
});
