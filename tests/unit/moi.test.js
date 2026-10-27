// AC-02 · What a signed-in client changes of himself (/moi › Profil) and the salon's invite to the space: his name and
// birthday, his two consents with their proof, his favourite barber, a copy of his data by e-mail, a request to erase his
// file, and the staff link that opens his space. The reads (home, history) are tests/unit/me-home.test.js.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { browser, testRuntime } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, mergeClients } from '../../server/commands/clients.js';
import { archiveStaff } from '../../server/commands/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { createRuntime } from '../../server/http/runtime.js';
import { router } from '../../server/http/kit.js';
import { capsOf } from '../../server/domain/permissions.js';
import { DEMO } from '../../server/domain/seed.js';
import { otpCode } from '../../server/domain/otp.js';
import { neverInformed } from '../../server/projections/informed.js';
import { accountsExtension, accountOf } from '../../server/projections/accounts.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { moiRoutes } from '../../server/http/routes-moi.js';
import { CLIENT_ACTOR, personaOf } from '../../server/commands/accounts.js';
import { SALON_ONLY } from '../../server/commands/me.js';
import { fileIds } from '../../server/commands/clients.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const DEMO_SAYS = { ok: true, demo: true, message: 'Démo : rien n’est changé' };
let numbers = 0;
const events = (rt, type) => rt.engine.journal.filter((e) => e.type === type);
const messages = (rt, template) => [...rt.engine.state.messages.values()].filter((m) => m.template === template);

/** A production salon with the space open, its HTTP runtime on the same store, and helpers to make signed-in clients. */
async function setup() {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const file = async (o = {}) => {
    const phone = '06' + String(30000000 + ++numbers * 7919).slice(-8);
    const id = (await t.engine.run(addClient, { first: 'Yanis', last: 'Martin', phone, ...o }, t.asOwner())).id;
    return { id, phone };
  };
  const signIn = async (who, first = 'Yanis') => {
    const b = browser(rt);
    await rt.engine.sync(true);
    assert.equal((await b.post('/api/public/account/start', { phone: who.phone })).status, 200);
    await settled();
    const m = messages(rt, 'otp').filter((x) => x.cid === who.id).at(-1);
    const r = await b.post('/api/public/account/verify', { phone: who.phone, code: otpCode(rt.secret, m.id), first });
    assert.equal(r.status, 200, r.text);
    return b;
  };
  const me = async (o = {}) => { const who = await file(o); return { ...who, b: await signIn(who, o.first || 'Yanis') }; };
  return { t, rt, file, signIn, me };
}

test('every new /api/me route is closed without the client cookie, and a staff session alone opens none', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const staff = browser(rt);
  assert.equal((await staff.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  for (const b of [browser(rt), staff]) {
    for (const [m, p] of [['GET', '/api/me/profile'], ['PATCH', '/api/me/profile'], ['PATCH', '/api/me/consent'], ['PATCH', '/api/me/prefs'], ['POST', '/api/me/export'], ['POST', '/api/me/erase-request']]) {
      const r = await b.raw(m, p, m === 'GET' ? undefined : {});
      assert.equal(r.status, 401, m + ' ' + p);
      assert.equal(r.json.error.code, 'signed_out');
    }
  }
  // the salon's invite: the file's right, and a session
  const app = router();
  moiRoutes(app);
  assert.equal(/** @type {any} */ (app.match('POST', '/api/v1/clients/x/account/invite')).route.opt.cap, 'client.edit');
  assert.equal((await browser(rt).post('/api/v1/clients/x/account/invite')).status, 401);
});

test('consent: the offers keep their proof (when, from where), reminders stop at once, a repeat writes nothing', async () => {
  const { t, rt, me } = await setup();
  const y = await me();
  const read = () => rt.engine.state.clients.get(y.id);
  assert.equal(read().marketing, false);
  const w = rt.engine.journal.length;
  t.clock.now = at(DAY, 11);
  const on = await y.b.patch('/api/me/consent', { marketing: true });
  assert.equal(on.status, 200, on.text);
  assert.equal(read().marketing, true);
  assert.equal(read().marketingSrc, 'espace');
  assert.equal(read().marketingAt, at(DAY, 11));
  assert.equal(read().sms, true, 'reminders untouched');
  const ev = events(rt, 'client.updated').at(-1);
  assert.deepEqual(ev.actor, CLIENT_ACTOR, 'the chained actor names nobody');
  assert.equal(ev.data.cid, y.id);
  assert.deepEqual(ev.data.patch, { marketing: true, marketingSrc: 'espace', marketingAt: at(DAY, 11) });
  assert.equal((await y.b.get('/api/me/home')).json.consent.marketing, true);
  // the same answer again: nothing more in the journal
  const n = rt.engine.journal.length;
  assert.equal((await y.b.patch('/api/me/consent', { marketing: true, sms: true })).status, 200);
  assert.equal(rt.engine.journal.length, n);
  // and back off: the proof moves with it
  t.clock.now = at(DAY, 12);
  await y.b.patch('/api/me/consent', { marketing: false });
  assert.deepEqual([read().marketing, read().marketingSrc, read().marketingAt], [false, 'espace', at(DAY, 12)]);
  assert.ok(rt.engine.journal.length > w);
  // a boolean, nothing else
  assert.equal((await y.b.patch('/api/me/consent', { sms: 'non' })).status, 400);

  // sms off: the evening-before reminder is not queued by the next tick; a client who kept it gets his
  const keep = await t.engine.run(addClient, { first: 'Omar', last: 'B', phone: '0611223344' }, t.asOwner());
  const day = addDays(DAY, 1);
  t.clock.now = at(DAY, 9);
  await t.engine.run(A.createAppointment, { clientId: y.id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start: 600 }, t.asOwner());
  await t.engine.run(A.createAppointment, { clientId: keep.id, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day, start: 600 }, t.asOwner());
  assert.equal((await y.b.patch('/api/me/consent', { sms: false })).status, 200);
  assert.equal(read().sms, false);
  assert.equal((await y.b.get('/api/me/home')).json.consent.sms, false);
  t.clock.now = at(DAY, 20, 30);
  await t.engine.run(tick, {}, t.sys);
  await rt.engine.sync(true);
  assert.equal(messages(rt, 'reminder').filter((m) => m.cid === y.id).length, 0, 'no reminder for the client who said no');
  assert.equal(messages(rt, 'reminder').filter((m) => m.cid === keep.id).length, 1, 'the other one still gets his');
});

test('consent: a client brought over from WordPress who answers here counts as told', async () => {
  const { t, rt, me } = await setup();
  const y = await me();
  await t.engine.run({ run: (s, i, ctx) => { ctx.emit('client.updated', { id: y.id, cid: y.id, patch: { marketingSrc: 'wordpress' }, fields: [] }); return {}; } }, {}, t.sys);
  await rt.engine.sync(true);
  assert.equal(neverInformed(rt.engine.state, rt.engine.state.clients.get(y.id)), true);
  assert.equal((await y.b.patch('/api/me/consent', { marketing: true })).status, 200);
  assert.equal(neverInformed(rt.engine.state, rt.engine.state.clients.get(y.id)), false);
});

test('prefs: a barber who still takes bookings, or nobody; an archived one is refused; a repeat writes nothing', async () => {
  const { t, rt, me } = await setup();
  const y = await me();
  const row = () => accountOf(rt.engine.state, [y.id]);
  assert.equal((await y.b.get('/api/me/home')).json.prefs.staffId, null);
  const ok = await y.b.patch('/api/me/prefs', { staffId: t.ids.Ben });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(row().prefs, { staffId: t.ids.Ben });
  assert.equal((await y.b.get('/api/me/home')).json.prefs.staffId, t.ids.Ben);
  const ev = events(rt, 'account.prefs').at(-1);
  assert.deepEqual([ev.data.id, ev.data.cid, ev.data.patch], [y.id, y.id, { staffId: t.ids.Ben }]);
  assert.deepEqual(ev.actor, CLIENT_ACTOR);
  const n = rt.engine.journal.length;
  assert.equal((await y.b.patch('/api/me/prefs', { staffId: t.ids.Ben })).status, 200);
  assert.equal(rt.engine.journal.length, n, 'the same choice again writes nothing');
  // unknown, absent or malformed
  assert.equal((await y.b.patch('/api/me/prefs', { staffId: 'st_nobody' })).status, 400);
  assert.equal((await y.b.patch('/api/me/prefs', {})).status, 400);
  assert.equal((await y.b.patch('/api/me/prefs', { staffId: 7 })).status, 400);
  // archived: refused, and the choice already made falls back to « Peu importe » in what the client reads
  await t.engine.run(archiveStaff, { id: t.ids.Ali }, t.asOwner());
  const gone = await y.b.patch('/api/me/prefs', { staffId: t.ids.Ali });
  assert.equal(gone.status, 400);
  assert.equal(gone.json.error.message, 'Ce barbier ne prend plus de rendez-vous.');
  await t.engine.run(archiveStaff, { id: t.ids.Ben }, t.asOwner());
  assert.equal((await y.b.get('/api/me/home')).json.prefs.staffId, null);
  await t.engine.run(archiveStaff, { id: t.ids.Ben, restore: true }, t.asOwner());
  assert.equal((await y.b.get('/api/me/home')).json.prefs.staffId, t.ids.Ben);
  // « Peu importe »
  assert.equal((await y.b.patch('/api/me/prefs', { staffId: null })).status, 200);
  assert.equal(row().prefs.staffId, null);
});

test('profile: name and birthday, never the phone or the e-mail; personal words stay out of the chained data', async () => {
  const { t, rt, me } = await setup();
  const y = await me({ email: 'yanis@exemple.fr' });
  const file = () => rt.engine.state.clients.get(y.id);
  const before = { ...file() };
  const r = await y.b.patch('/api/me/profile', { first: 'yanis-karim', last: 'Martin-Diaz', birthday: '14-03', phone: '0699999999', email: 'autre@exemple.fr', tags: ['VIP'], notes: 'x', sms: false });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([file().first, file().last, file().birthday], ['Yanis-karim', 'Martin-Diaz', '14-03']);
  assert.equal(file().phone, before.phone, 'the number is the salon’s to change');
  assert.equal(file().email, 'yanis@exemple.fr');
  assert.deepEqual([file().tags, file().notes, file().sms], [[], '', true], 'only three keys travel');
  const ev = events(rt, 'client.updated').at(-1);
  assert.deepEqual(ev.actor, CLIENT_ACTOR);
  assert.deepEqual(ev.data, { id: y.id, cid: y.id, patch: {}, fields: ['first', 'last', 'birthday'] });
  assert.ok(!JSON.stringify(ev.data).includes('Karim') && !JSON.stringify(ev.data).includes('14-03'));
  const stored = (await t.store.read(0)).events.find((e) => e.id === ev.id);
  assert.deepEqual(stored.pii, { first: 'Yanis-karim', last: 'Martin-Diaz', birthday: '14-03' });
  assert.equal((await y.b.get('/api/me/home')).json.birthday, '14-03');
  // the same values again: nothing written
  const n = rt.engine.journal.length;
  assert.equal((await y.b.patch('/api/me/profile', { first: 'Yanis-karim', birthday: '14-03' })).status, 200);
  assert.equal(rt.engine.journal.length, n);
  // the birthday can be taken back; nonsense is refused
  assert.equal((await y.b.patch('/api/me/profile', { birthday: '' })).status, 200);
  assert.equal(file().birthday, '');
  for (const bad of [{ birthday: '31-02x' }, { birthday: '45-13' }, { birthday: '00-01' }, { first: '' }, { first: 'x'.repeat(41) }, { last: 5 }]) assert.equal((await y.b.patch('/api/me/profile', bad)).status, 400, JSON.stringify(bad));
});

test('a space opened on a file that may have changed hands reads and writes nothing of it: the salon does that', async () => {
  const { t, rt, file } = await setup();
  const old = addDays(DAY, -200);
  t.clock.now = at(old, 10);
  const who = await file({ first: 'Mehdi', email: 'mehdi@exemple.fr', birthday: '04-02' });
  t.clock.now = at(DAY, 10);
  const b = browser(rt);
  await b.post('/api/public/account/start', { phone: who.phone });
  await settled();
  const m = messages(rt, 'otp').find((x) => x.cid === who.id);
  for (const first of ['Karim', 'Sofiane', 'Nordine']) await b.post('/api/public/account/verify', { phone: who.phone, code: otpCode(rt.secret, m.id), first });
  assert.equal(accountOf(rt.engine.state, [who.id]).named, false);
  const w = rt.engine.journal.length;
  for (const [method, path, body] of [['POST', '/api/me/export', {}], ['POST', '/api/me/erase-request', {}], ['PATCH', '/api/me/profile', { first: 'Nordine' }]]) {
    const r = await b.raw(method, path, body);
    assert.equal(r.status, 403, method + ' ' + path);
    assert.equal(r.json.error.message, SALON_ONLY);
  }
  assert.deepEqual((await b.get('/api/me/profile')).json, { email: 'm•••@exemple.fr', phone: (await b.get('/api/me/profile')).json.phone, canAsk: false, eraseAt: 0, demo: false });
  assert.equal(rt.engine.journal.length, w, 'nothing written');
  assert.equal(messages(rt, 'dataExport').length + messages(rt, 'owner_erase').length, 0);
  // the switches and the barber are about this phone, not about the file’s past: they work
  assert.equal((await b.patch('/api/me/consent', { sms: false })).status, 200);
});

test('export: the file by e-mail, in the salon’s words plus the space’s own block; never a download; 6 an hour is one too many', async () => {
  const { t, rt, me } = await setup();
  const y = await me({ email: 'karim@gmail.com' });
  // a visit with a ticket, a booking to come, a carnet, a gift card; the sign-in text sits among the texts
  t.clock.now = at(addDays(DAY, -3), 10);
  const done = await t.engine.run(A.createAppointment, { clientId: y.id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -3), start: 600 }, t.asOwner());
  t.clock.now = at(addDays(DAY, -3), 10, 40);
  await t.engine.run(S.checkout, { apptId: done.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  t.clock.now = at(DAY, 11);
  await t.engine.run(A.createAppointment, { clientId: y.id, serviceIds: [t.ids.beard], staffId: t.ids.Ben, day: addDays(DAY, 2), start: 660 }, t.asOwner());
  await y.b.patch('/api/me/prefs', { staffId: t.ids.Ben });

  const pf = await y.b.get('/api/me/profile');
  assert.equal(pf.json.email, 'k•••@gmail.com');
  assert.equal(pf.json.canAsk, true);
  assert.equal(pf.headers.get('cache-control'), 'no-store');
  const res = await y.b.post('/api/me/export');
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { ok: true, sent: true, message: 'Envoyé à k•••@gmail.com' });
  assert.equal(res.headers.get('content-disposition'), null, 'not a download');
  const [mail] = messages(rt, 'dataExport');
  assert.equal(mail.channel, 'email');
  assert.equal(mail.to, 'karim@gmail.com', 'to the address the salon holds, nothing the request names');
  assert.equal(mail.cid, y.id);
  assert.match(mail.mail.subject, /^Tes données chez /);
  assert.equal(mail.mail.attachments.length, 1);
  assert.equal(mail.mail.attachments[0].name, 'mes-donnees-larchitecte.json');
  const data = JSON.parse(mail.mail.attachments[0].content);
  assert.equal(data.fiche.prenom, 'Yanis');
  assert.equal(data.fiche.email, 'karim@gmail.com');
  assert.equal(data.rendezVous.length, 2);
  assert.deepEqual(data.rendezVous.map((x) => x.statut), ['venu', 'à venir']);
  assert.equal(data.tickets.length, 1);
  assert.match(data.tickets[0].total, /^20\s€$/);
  assert.ok(data.espace.ouvertLe && data.espace.derniereConnexion);
  assert.equal(data.espace.connexions, 1);
  assert.equal(data.espace.barbierPrefere, 'Ben');
  // the code texts read {code}: the digits are nowhere
  const codes = data.sms.filter((x) => x.type === 'code de connexion');
  assert.equal(codes.length, 1);
  assert.match(codes[0].texte, /\{code\}/);
  assert.ok(!JSON.stringify(data).includes(otpCode(rt.secret, messages(rt, 'otp')[0].id)), 'the digits are nowhere');
  // the mail is a requested text: leaves before anything else, whatever the file’s SMS switch says
  const { sendRank } = await import('../../server/http/scheduler.js');
  assert.equal(sendRank(mail), 0);
  // the journal holds no address and no JSON outside pii
  const q = (await t.store.read(0)).events.find((e) => e.type === 'message.queued' && e.data.template === 'dataExport');
  assert.ok(!JSON.stringify(q.data).includes('karim@') && !JSON.stringify(q.data).includes('Martin'));
  assert.equal(q.data.cid, y.id);
  assert.deepEqual(q.actor, CLIENT_ACTOR);
  // a retried request (same x-request-id) is the same mail
  const v = rt.engine.journal.length;
  assert.equal((await y.b.post('/api/me/export', {}, { 'x-request-id': 'export-0001' })).status, 200);
  const sent = rt.engine.journal.length;
  assert.equal((await y.b.post('/api/me/export', {}, { 'x-request-id': 'export-0001' })).json.sent, true);
  assert.equal(rt.engine.journal.length, sent, 'replayed, not written twice');
  assert.ok(sent > v);
  // 5 asks an hour (a retry counts as one): the 6th is refused
  for (let asked = 3; asked < 5; asked++) assert.equal((await y.b.post('/api/me/export')).status, 200);
  const six = await y.b.post('/api/me/export');
  assert.equal(six.status, 429, six.text);
  assert.equal(six.json.error.code, 'slow_down');
});

test('export: no e-mail on the file, nothing is sent; the owner is asked to do it', async () => {
  const { rt, me } = await setup();
  const y = await me();
  const res = await y.b.post('/api/me/export');
  assert.deepEqual(res.json, { ok: true, sent: false, message: 'Demande-le au salon' });
  assert.equal(messages(rt, 'dataExport').length, 0);
  const [owner] = messages(rt, 'owner_export');
  assert.equal(owner.to, 'patron@test.fr');
  assert.equal(owner.cid, y.id, 'it names the file, so erasing the file blanks it');
  assert.match(owner.mail.subject, /^Demande de données · Yanis$/);
  // asking again the same day does not mail the owner twice
  await y.b.post('/api/me/export');
  assert.equal(messages(rt, 'owner_export').length, 1);
});

test('erase request: one event and one owner mail per space; the second tap is told it is already there; the owner’s feed shows it, a barber’s does not', async () => {
  const { t, rt, me } = await setup();
  const y = await me();
  const res = await y.b.post('/api/me/erase-request');
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { ok: true, already: false, message: 'Demande envoyée. Le salon efface ta fiche sous un mois.' });
  assert.equal(events(rt, 'account.eraseRequested').length, 1);
  const ev = events(rt, 'account.eraseRequested')[0];
  assert.deepEqual([ev.data.id, ev.data.cid], [y.id, y.id]);
  assert.deepEqual(ev.actor, CLIENT_ACTOR);
  const mails = messages(rt, 'owner_erase');
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'patron@test.fr');
  assert.equal(mails[0].mail.subject, 'Demande d’effacement · Yanis');
  assert.match(mails[0].body, /à traiter sous un mois \(Clients › fiche › Effacer\)/);
  assert.equal(mails[0].cid, y.id);
  assert.equal(accountOf(rt.engine.state, [y.id]).eraseAt, ev.at);
  // the file itself is untouched
  assert.ok(!rt.engine.state.clients.get(y.id).erased);
  // the same day, again: nothing new
  t.clock.now += 3600000;
  const again = await y.b.post('/api/me/erase-request');
  assert.deepEqual(again.json, { ok: true, already: true, message: 'Ta demande est déjà chez le salon.' });
  assert.equal(events(rt, 'account.eraseRequested').length, 1);
  assert.equal(messages(rt, 'owner_erase').length, 1);
  // the feed line: for the owner (client.erase), not for a barber
  const s = rt.engine.state;
  const f = s.feed.find((x) => x.type === 'account.eraseRequested');
  assert.ok(f);
  const ownerCaps = capsOf(s.staff.get(t.ownerId), s.settings), barberCaps = capsOf(s.staff.get(t.ids.Ali), s.settings);
  assert.equal(accountsExtension.item({ s, caps: ownerCaps }, f).title, 'Demande d’effacement · Yanis');
  assert.equal(accountsExtension.item({ s, caps: barberCaps }, f), null);
  // the profile says so
  assert.ok((await y.b.get('/api/me/profile')).json.eraseAt > 0);
});

test('a merged file: the writes go to the file the client now is, the choice lives on the account row', async () => {
  const { t, rt, file, signIn } = await setup();
  const a = await file({ first: 'Yanis' });
  const b = await t.engine.run(addClient, { first: 'Yanis', last: 'Martin' }, t.asOwner());
  const page = await signIn(a);
  await t.engine.run(mergeClients, { from: a.id, into: b.id }, t.asOwner());
  await rt.engine.sync(true);
  assert.deepEqual(fileIds(rt.engine.state, rt.engine.state.clients.get(b.id)).sort(), [a.id, b.id].sort());
  assert.equal((await page.patch('/api/me/profile', { last: 'Diaz' })).status, 200);
  assert.equal(rt.engine.state.clients.get(b.id).last, 'Diaz');
  assert.equal((await page.patch('/api/me/prefs', { staffId: t.ids.Ali })).status, 200);
  assert.equal((await page.get('/api/me/home')).json.prefs.staffId, t.ids.Ali);
  assert.equal((await page.patch('/api/me/consent', { marketing: true })).status, 200);
  assert.equal(rt.engine.state.clients.get(b.id).marketing, true);
  // an erased file: the session is over
  await t.engine.run({ run: (s, i, ctx) => { ctx.emit('client.erased', { id: b.id, cid: b.id, ids: [a.id, b.id], tombs: [] }); return {}; } }, {}, t.sys);
  await rt.engine.sync(true);
  assert.equal((await page.patch('/api/me/consent', { sms: false })).status, 401);
});

test('the salon’s invite: a signed link good 48 h that opens the space on that number, three link texts a day', async () => {
  const { t, rt, file } = await setup();
  const y = await file({ first: 'Yanis' });
  const none = await t.engine.run(addClient, { first: 'Sans', last: 'Numéro' }, t.asOwner());
  const staffOnly = browser(rt);
  assert.equal((await staffOnly.post('/api/v1/clients/' + y.id + '/account/invite')).status, 401);

  // the engine side: the command needs client.edit, and refuses a file with no number
  const { sendSpaceInvite } = await import('../../server/commands/me.js');
  const link = 'https://salon.test/moi?garder=x.y';
  await assert.rejects(() => t.engine.run(sendSpaceInvite, { cid: y.id, link }, { ...t.asClient, meta: {} }), { code: 'forbidden' });
  await assert.rejects(() => t.engine.run(sendSpaceInvite, { cid: none.id, link }, t.asOwner()), { code: 'no_phone' });
  await assert.rejects(() => t.engine.run(sendSpaceInvite, { cid: y.id, link: 'javascript:alert(1)' }, t.asOwner()), { code: 'invalid' });
  assert.equal(messages(rt, 'accesInvite').length, 0);
  // the space closed: no link that opens nothing
  await t.engine.run(updateSettings, { accounts: { enabled: false } }, t.asOwner());
  await rt.engine.sync(true);
  await assert.rejects(() => t.engine.run(sendSpaceInvite, { cid: y.id, link }, t.asOwner()), { code: 'disabled' });
});

describe_demo();
function describe_demo() {
  const clock = { now: at(DAY, 11) };
  let rt;
  before(async () => { rt = await testRuntime({ clock: () => clock.now }); });
  const owner = async () => {
    const o = browser(rt);
    assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
    return o;
  };

  test('demo: the owner sends a client the link of his space; it works for 48 h, is texted to the file’s own number, and counts in the 3 a day', async () => {
    const o = await owner();
    const persona = personaOf(rt.engine.state, clock.now);
    const target = [...rt.engine.state.clients.values()].find((c) => c.phone && !c.erased && !c.mergedInto && c.id !== persona.id && c.source !== 'site' && c.first);
    assert.ok(target);
    const r = await o.post('/api/v1/clients/' + target.id + '/account/invite');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, sent: true });
    const [m] = messages(rt, 'accesInvite').filter((x) => x.cid === target.id);
    assert.equal(m.to, target.phone, 'to the file’s number');
    const url = /(https:\/\/\S+)/.exec(m.body)[1];
    assert.match(url, /^https:\/\/[^/]+\/moi\?garder=/);
    assert.equal(m.channel, 'sms');
    assert.ok(m.body.length <= 200, m.body);
    const token = decodeURIComponent(new URL(url).searchParams.get('garder'));
    // the public side: the link asks for a code on the number it was sent to
    const phone = browser(rt);
    const kept = await phone.post('/api/public/account/keep', { token });
    assert.equal(kept.status, 200, kept.text);
    assert.match(kept.json.sentTo, /•/);
    assert.equal(kept.json.demoCode, undefined, 'the demo shows a code only to a visitor’s own fresh booking');
    const code = messages(rt, 'otp').filter((x) => x.cid === target.id).at(-1);
    const v = await phone.post('/api/public/account/verify', { token, code: otpCode(rt.secret, code.id), first: target.first });
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.ok, true);
    assert.ok(accountOf(rt.engine.state, [target.id]));
    // the cap of link texts: the invite and the code count together, 3 a day
    const again = await o.post('/api/v1/clients/' + target.id + '/account/invite');
    assert.equal(again.status, 200);
    const fourth = await o.post('/api/v1/clients/' + target.id + '/account/invite');
    assert.equal(fourth.status, 429, fourth.text);
    assert.equal(fourth.json.error.message, 'Déjà 3 liens envoyés aujourd’hui à ce client.');
    // 48 h later the link is dead
    clock.now += 49 * 3600000;
    assert.equal((await browser(rt).post('/api/public/account/keep', { token })).status, 404);
    clock.now -= 49 * 3600000;
    // a link made for one file never opens another
    const other = [...rt.engine.state.clients.values()].find((c) => c.phone && c.id !== target.id && c.id !== persona.id && !c.erased && !c.mergedInto);
    const forged = token.replace(target.id, other.id);
    assert.equal((await browser(rt).post('/api/public/account/keep', { token: forged })).status, 404);
    // an unknown file
    assert.equal((await o.post('/api/v1/clients/cl_nobody/account/invite')).status, 404);
  });

  test('demo: the persona’s writes say « Démo : rien n’est changé » and write nothing, so the next visitor finds the showcase as it was', async () => {
    const b = browser(rt);
    assert.equal((await b.post('/api/public/account/demo')).status, 200);
    const persona = personaOf(rt.engine.state, clock.now);
    const w = rt.engine.journal.length;
    const before = JSON.stringify([persona.first, persona.last, persona.sms, persona.marketing, persona.birthday]);
    for (const [m, p, body] of [['PATCH', '/api/me/profile', { first: 'Zoé' }], ['PATCH', '/api/me/consent', { marketing: true, sms: false }], ['PATCH', '/api/me/prefs', { staffId: null }], ['POST', '/api/me/export', {}], ['POST', '/api/me/erase-request', {}]]) {
      const r = await b.raw(m, p, body);
      assert.equal(r.status, 200, m + ' ' + p + ' ' + r.text);
      assert.deepEqual(r.json, DEMO_SAYS, p);
    }
    assert.equal(rt.engine.journal.length, w, 'nothing written');
    assert.equal(JSON.stringify([persona.first, persona.last, persona.sms, persona.marketing, persona.birthday]), before);
    const pf = (await b.get('/api/me/profile')).json;
    assert.equal(pf.demo, true);
  });
}
