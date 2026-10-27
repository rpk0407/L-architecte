// FID-01: the order texts leave in (what the client asked for first, offers last), dispatchNow, the Brevo fallback when the
// salon's phone refuses a service text, the fillers, a contract's acknowledgement retried until sent, one daily cap for
// every « send me a link », and the health card's view of the salon's phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { addClient } from '../../server/commands/clients.js';
import { TEMPLATE_FLAGS } from '../../server/core/templates.js';
import { queueMessage, FILLERS } from '../../server/domain/messages.js';
import { linkSendsToday, LINK_PER_DAY, LINK_TEMPLATES } from '../../server/domain/linkcap.js';
import { lookupAppointments } from '../../server/commands/lookup.js';
import { dispatch, dispatchNow, sendRank, staleReason } from '../../server/http/scheduler.js';
import { createRuntime, readConfig } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { browser } from '../api/client.js';
import { setCredentials } from '../../server/commands/team.js';
import { hashSecret } from '../../server/auth/password.js';

const ORIGIN = 'https://salon.test';
const fakeSms = (name = 'brevo', o = {}) => {
  const sent = [];
  // fail: the provider answered with a refusal (an HTTP status, as messaging/sms.js throws it); timeout: no answer in time
  return { name, sent, ...o, async send(to, body, opts) {
    sent.push({ to, body, opts });
    if (o.timeout) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (o.fail) throw Object.assign(new Error(o.fail), { status: o.status || 500 });
    return { ref: name + '-' + sent.length };
  } };
};
const rtOf = (t, x = {}) => ({ engine: t.engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN, sleep: async () => {}, ...x });
/** queueMessage as a command (the way every command calls it) */
const q = (t, m) => t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, m) }) }, {}, { ...t.sys, meta: { siteUrl: ORIGIN + '/' } });
/** a template the next waves add (AC-01's code, PAY-02's acknowledgements), registered for the test only */
function withFlags(flags, fn) {
  const before = Object.fromEntries(Object.keys(flags).map((k) => [k, TEMPLATE_FLAGS[k]]));
  Object.assign(TEMPLATE_FLAGS, flags);
  return fn().finally(() => { for (const [k, v] of Object.entries(before)) { if (v === undefined) delete TEMPLATE_FLAGS[k]; else TEMPLATE_FLAGS[k] = v; } });
}
async function clients(t, n, marketing = true) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await t.engine.run(addClient, { first: 'C' + i, phone: '06222222' + String(10 + i), marketing }, t.asOwner())).id);
  return ids;
}

test('ten offers queued, then a sign-in code: the code is in the first batch, and leaves first', () => withFlags({ otp: { requested: true } }, async () => {
  const t = await salon();
  const ids = await clients(t, 10);
  for (const [i, cid] of ids.entries()) await q(t, { key: 'rb' + i, template: 'rebook', to: '+3362222221' + i, cid, vars: { prenom: 'C' }, text: 'Salut {prenom}, on se revoit ? https://x' });
  t.clock.now += 60000;
  const code = await q(t, { key: 'otp1', template: 'otp', to: '+33611111111', cid: t.ids.yanis, vars: {}, text: 'L’Architecte : ton code 000000' });
  // a reminder and a review request in between: service before relation before marketing
  const svc = await q(t, { key: 'svc1', template: 'reminder', to: '+33612345678', cid: t.ids.yanis, vars: {} });
  const all = [...t.engine.state.messages.values()].filter((m) => m.status === 'queued');
  assert.deepEqual(all.map(sendRank).sort(), [0, 1, ...Array(10).fill(3)]);
  // the salon's phone: five texts a dispatch
  const phone = fakeSms('gateway', { perRun: 5 });
  await dispatch(rtOf(t, { sms: phone }));
  assert.equal(phone.sent.length, 5);
  assert.equal(phone.sent[0].to, '+33611111111', 'the code first');
  assert.equal(phone.sent[1].to, '+33612345678', 'then the reminder');
  assert.equal(t.engine.state.messages.get(code.id).status, 'sent');
  assert.equal(t.engine.state.messages.get(svc.id).status, 'sent');
  // the claim batch itself, with room for one: the code
  const u = await salon();
  const more = await clients(u, 10);
  for (const [i, cid] of more.entries()) await q(u, { key: 'rb' + i, template: 'rebook', to: '+3362222221' + i, cid, vars: {}, text: 'Salut, on se revoit ? https://x' });
  u.clock.now += 60000;
  const c2 = await q(u, { key: 'otp1', template: 'otp', to: '+33611111111', cid: u.ids.yanis, vars: {}, text: 'code' });
  await dispatch(rtOf(u, { sms: fakeSms() }), 1);
  const claimed = u.engine.journal.filter((e) => e.type === 'message.updated' && e.data.patch.status === 'claimed');
  assert.deepEqual(claimed.map((e) => e.data.id), [c2.id]);
}));

test('dispatchNow sends those messages at once, past the phone’s per-dispatch cap, through the same claim', async () => {
  const t = await salon();
  const ids = await clients(t, 7);
  for (const [i, cid] of ids.entries()) await q(t, { key: 'rm' + i, template: 'reminder', to: '+3362222221' + i, cid, vars: {} });
  const phone = fakeSms('gateway', { perRun: 5 });
  const rt = rtOf(t, { sms: phone });
  const picked = ['msg_rm6', 'msg_rm5', 'msg_rm4', 'msg_rm3', 'msg_rm2', 'msg_rm1'];
  assert.equal(await dispatchNow(rt, picked), 6);
  assert.equal(phone.sent.length, 6, 'not held to five');
  assert.equal(t.engine.state.messages.get('msg_rm0').status, 'queued', 'only those');
  // already sent: nothing twice
  assert.equal(await dispatchNow(rt, picked), 0);
  assert.equal(await dispatchNow(rt, []), 0);
  assert.equal(phone.sent.length, 6);
});

test('the salon’s phone refuses: a service text goes once by Brevo (via fallback), an offer does not', async () => {
  const t = await salon();
  const [a, b] = await clients(t, 2);
  await q(t, { key: 'rm', template: 'reminder', to: '+33622222210', cid: a, vars: {} });
  await q(t, { key: 'rb', template: 'rebook', to: '+33622222211', cid: b, vars: {}, text: 'Salut, on se revoit ? https://x' });
  const phone = fakeSms('gateway', { perRun: 5, fail: 'Téléphone du salon : identifiants refusés (SMSGATE_USERNAME, SMSGATE_PASSWORD)' });
  const brevo = fakeSms('brevo');
  await dispatch(rtOf(t, { sms: phone, smsFallback: brevo }));
  const rm = t.engine.state.messages.get('msg_rm'), rb = t.engine.state.messages.get('msg_rb');
  assert.equal(rm.status, 'sent');
  assert.equal(rm.via, 'fallback');
  assert.equal(rm.providerRef, 'brevo-1');
  assert.match(rm.fallback, /identifiants refusés/);
  assert.equal(rb.status, 'failed', 'an offer leaves from the salon’s number or not at all');
  assert.deepEqual(brevo.sent.map((x) => x.to), ['+33622222210']);
  assert.equal(brevo.sent[0].opts.marketing, false);
  // without Brevo configured: failed, as before
  const u = await salon();
  await q(u, { key: 'rm', template: 'reminder', to: '+33612345678', cid: u.ids.yanis, vars: {} });
  await dispatch(rtOf(u, { sms: fakeSms('gateway', { fail: 'Téléphone du salon : erreur 500' }) }));
  assert.equal(u.engine.state.messages.get('msg_rm').status, 'failed');
  // the runtime builds the fallback only for the salon's phone with Brevo's key there
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p' };
  assert.equal((await createRuntime({ env, store: memoryStore() })).smsFallback, null);
  assert.equal((await createRuntime({ env: { ...env, BREVO_API_KEY: 'k' }, store: memoryStore() })).smsFallback.name, 'brevo');
  assert.equal((await createRuntime({ env: { ...env, SMS_PROVIDER: 'brevo', BREVO_API_KEY: 'k' }, store: memoryStore() })).smsFallback, null);
  assert.ok(readConfig({ ...env, BREVO_API_KEY: 'k' }).smsRoutes.brevo);
});

test('a sign-in code’s failure keeps fixed words, never the provider’s (it may echo the code)', () => withFlags({ otp: { requested: true } }, async () => {
  const t = await salon();
  await q(t, { key: 'otp', template: 'otp', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Ton code : 482913' });
  await dispatch(rtOf(t, { sms: fakeSms('brevo', { fail: 'Invalid content « Ton code : 482913 »' }) }));
  const m = t.engine.state.messages.get('msg_otp');
  assert.equal(m.status, 'failed');
  assert.doesNotMatch(m.error, /482913/);
  assert.match(m.error, /détail masqué/);
}));

test('the phone refuses a sign-in code and Brevo sends it: the code is nowhere in the journal, nor the phone’s words', () => withFlags({ otp: { requested: true } }, async () => {
  const t = await salon();
  await q(t, { key: 'otp', template: 'otp', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Ton code : 482913' });
  const phone = fakeSms('gateway', { fail: 'Téléphone du salon : bad text Ton code : 482913', status: 400 }), brevo = fakeSms('brevo');
  await dispatch(rtOf(t, { sms: phone, smsFallback: brevo }));
  const m = t.engine.state.messages.get('msg_otp');
  assert.equal(m.status, 'sent');
  assert.equal(m.via, 'fallback');
  assert.match(m.fallback, /détail masqué/);
  assert.equal(brevo.sent.length, 1);
  // the chained data and the actor: never the code (its body lives in pii, erasable)
  assert.doesNotMatch(JSON.stringify(t.engine.journal.map((e) => ({ type: e.type, data: e.data, actor: e.actor }))), /482913/);
}));

test('the phone does not answer in time: no second send by Brevo (its server may have taken it), the outbox says so', async () => {
  const t = await salon();
  await q(t, { key: 'rm', template: 'reminder', to: '+33612345678', cid: t.ids.yanis, vars: {} });
  const phone = fakeSms('gateway', { timeout: true }), brevo = fakeSms('brevo');
  await dispatch(rtOf(t, { sms: phone, smsFallback: brevo }));
  const m = t.engine.state.messages.get('msg_rm');
  assert.equal(m.status, 'failed');
  assert.match(m.error, /pas de réponse à temps/);
  assert.equal(brevo.sent.length, 0, 'never twice');
  // the phone's server cannot be reached at all: nothing left, Brevo takes it
  const u = await salon();
  await q(u, { key: 'rm', template: 'reminder', to: '+33612345678', cid: u.ids.yanis, vars: {} });
  const down = { name: 'gateway', async send() { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } };
  const b2 = fakeSms('brevo');
  await dispatch(rtOf(u, { sms: down, smsFallback: b2 }));
  assert.equal(u.engine.state.messages.get('msg_rm').via, 'fallback');
  assert.equal(b2.sent.length, 1);
});

test('erasing a client behind a backlog: his cancellation text leaves at once, past the phone’s cap', async () => {
  const t = await salon({ hour: 9 });
  const cid = (await t.engine.run(addClient, { first: 'Karim', phone: '0611223344' }, t.asOwner())).id;
  await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  // eight receipts to someone else, older, waiting for the phone (5 a dispatch)
  for (let i = 0; i < 8; i++) await q(t, { key: 'rc' + i, template: 'receipt', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Ton ticket ' + i });
  t.clock.now += 60000;
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  rt.sms = fakeSms('gateway', { perRun: 5 });
  rt.sleep = async () => {};
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: 'patron@test.fr', password: 'Patron-1313!', remember: true })).status, 200);
  const r = await b.post('/api/v1/clients/' + cid + '/erase', { cancelUpcoming: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.texted, 1);
  assert.equal(r.json.unsent, 0);
  assert.ok(rt.sms.sent.some((x) => x.to === '+33611223344' && /annul/.test(x.body)), 'told before his number went');
});

test('FILLERS give the words as the text leaves, by SMS and by e-mail; an unknown template keeps its body', () => withFlags({ otp: { requested: true } }, async () => {
  const t = await salon();
  FILLERS.otp = (m) => 'Code ' + m.id.slice(-3);
  try {
    await q(t, { key: 'otp123', template: 'otp', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'placeholder' });
    await q(t, { key: 'rm', template: 'reminder', to: '+33622222210', vars: {}, text: 'Rappel tel quel' });
    await q(t, { key: 'mail', channel: 'email', template: 'otp', to: 'yanis@exemple.fr', cid: t.ids.yanis, vars: {}, subject: 'Ton code', text: 'placeholder' });
    const sms = fakeSms(), mails = [];
    await dispatch(rtOf(t, { sms, email: { name: 'brevo', async send(x) { mails.push(x); return { ref: 'e1' }; } } }));
    assert.deepEqual(sms.sent.map((x) => x.body).sort(), ['Code 123', 'Rappel tel quel']);
    assert.equal(mails[0].text, 'Code ail');
  } finally { delete FILLERS.otp; }
}));

test('a contract’s acknowledgement (legal) is never expired and is tried again until it leaves', () => withFlags({ memberWelcome: { legal: true } }, async () => {
  const t = await salon();
  await q(t, { key: 'mw', template: 'memberWelcome', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Bienvenue dans ton abonnement' });
  const failing = fakeSms('brevo', { fail: 'Brevo 503' });
  await dispatch(rtOf(t, { sms: failing }));
  let m = t.engine.state.messages.get('msg_mw');
  assert.equal(m.status, 'queued', 'back in the queue');
  assert.equal(m.error, 'Brevo 503');
  assert.ok(m.dueAt > t.clock.now, 'a little later');
  await dispatch(rtOf(t, { sms: failing }));
  assert.equal(failing.sent.length, 1, 'not before its new time');
  // two days later (no provider worked meanwhile): still owed, not « trop tard »
  t.clock.now += 2 * 86400000;
  assert.equal(staleReason(t.engine.state, m, t.clock.now), '');
  const ok = fakeSms();
  await dispatch(rtOf(t, { sms: ok }));
  m = t.engine.state.messages.get('msg_mw');
  assert.equal(m.status, 'sent');
  assert.equal(m.tries, 2);
  // a plain service text that old is dropped, as before
  await q(t, { key: 'rm', template: 'reminder', to: '+33612345678', cid: t.ids.yanis, vars: {} });
  assert.match(staleReason(t.engine.state, t.engine.state.messages.get('msg_rm'), t.clock.now + 7 * 3600000), /Trop tard/);
}));

test('one cap for every « send me a link »: three pages, one number, one day, three texts in all', async () => {
  const t = await salon();
  const ctx = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { linkFor: (a) => ORIGIN + '/r/' + a.code } };
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, t.asOwner());
  assert.deepEqual([...LINK_TEMPLATES], ['lookup', 'otp', 'memberLink', 'mlogin', 'accesInvite']);
  // a sign-in code (AC-01) and a membership link (PAY-03), the way those pages queue them
  await q(t, { key: 'otp_a', template: 'otp', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'code' });
  assert.equal(linkSendsToday(t.engine.state, t.ids.yanis, DAY), 1);
  assert.equal((await t.engine.run(lookupAppointments, { phone: '0612345678' }, ctx)).sent, true, '/mon-rendez-vous');
  await q(t, { key: 'ml_a', template: 'memberLink', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'lien' });
  assert.equal(linkSendsToday(t.engine.state, t.ids.yanis, DAY), LINK_PER_DAY);
  assert.equal((await t.engine.run(lookupAppointments, { phone: '0612345678' }, ctx)).sent, false, 'the fourth, from any page, does not leave');
  const links = [...t.engine.state.messages.values()].filter((m) => LINK_TEMPLATES.includes(m.template));
  assert.equal(links.length, 3);
  // other texts do not count, other days start again
  assert.equal(linkSendsToday(t.engine.state, t.ids.yanis, addDays(DAY, 1)), 0);
  t.clock.now = at(addDays(DAY, 1), 9);
  assert.equal((await t.engine.run(lookupAppointments, { phone: '0612345678' }, ctx)).sent, true);
});

test('the health card: the oldest code waiting, the phone’s last text, a cron too seldom for it', async () => {
  const clock = { now: at(DAY, 10) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'tok-0123456789', CRON_SECRET: 'cron-0123456789', SMS_PROVIDER: 'gateway', SMSGATE_USERNAME: 'u', SMSGATE_PASSWORD: 'p', BREVO_API_KEY: 'k' };
  const rt = await createRuntime({ env, store: memoryStore(), clock: () => clock.now });
  const o = browser(rt);
  assert.equal((await o.post('/api/setup', { token: 'tok-0123456789', name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013' })).status, 200);
  const cron = () => o.get('/api/cron/tick', { authorization: 'Bearer cron-0123456789' });
  rt.sms = fakeSms('gateway', { perRun: 5 });
  rt.smsFallback = fakeSms('brevo');
  let h = (await o.get('/api/v1/health')).json;
  assert.equal(h.sms.provider, 'gateway');
  assert.equal(h.sms.fallback, true);
  assert.equal(h.sms.cronSlow, false, 'no cron call seen yet: nothing to say');
  assert.equal(h.sms.requestedWaitMs, null);
  // a lookup text waiting 5 minutes (nothing dispatched it)
  const c = [...rt.engine.state.clients.values()][0];
  const id = (await rt.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'lk', template: 'lookup', to: '+33612345678', cid: c ? c.id : null, vars: {}, text: 'Ton lien' }) }) }, {}, { actor: { t: 'system', id: 'test' }, caps: new Set() })).id;
  assert.ok(id);
  clock.now += 5 * 60000;
  h = (await o.get('/api/v1/health')).json;
  assert.equal(h.sms.requestedWaitMs, 5 * 60000);
  // two cron calls 5 minutes apart (real time: the machine's clock)
  await cron();
  rt.lastCron -= 5 * 60000;
  await cron();
  h = (await o.get('/api/v1/health')).json;
  assert.equal(h.sms.cronSlow, true);
  assert.equal(h.sms.requestedWaitMs, null, 'the cron sent it');
  assert.equal(h.sms.lastSentAt, clock.now);
  await cron();
  assert.equal((await o.get('/api/v1/health')).json.sms.cronSlow, false, 'every minute: fine');
});
