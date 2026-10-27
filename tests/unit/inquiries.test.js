// Les demandes: the site's contact and training forms land in Relances › Demandes, with the person's details in pii only,
// an e-mail to the owner, an SMS answer, and an erasure that leaves nothing of them in the journal. Plus /formations' content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { createEngine } from '../../server/core/engine.js';
import { verifyChain } from '../../server/core/journal.js';
import { sealBackup, openBackup } from '../../server/core/backup.js';
import { randomBytes } from 'node:crypto';
import { DEMO } from '../../server/domain/seed.js';
import { eraseClient } from '../../server/commands/clients.js';
import { setCredentials } from '../../server/commands/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { hashSecret } from '../../server/auth/password.js';
import { receiveInquiry, markInquiryHandled, replyInquiry, eraseInquiry, ownerMailId } from '../../server/commands/inquiries.js';
import { INQUIRIES_PER_HOUR } from '../../server/http/routes-inquiries.js';
import trainings, { publicTrainings } from '../../server/settings/trainings.js';
import { addDays } from '../../shared/dates.js';
import { readFileSync } from 'node:fs';

let ips = 0;
/** A production salon behind the real HTTP handler, each test from its own address (the hourly limit is per address). */
async function prod() {
  const t = await salon();
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  return { t, rt, web: browser(rt, { ip: '10.9.' + Math.floor(++ips / 250) + '.' + (ips % 250) }) };
}
/** The same, with the owner signed in at the desk and a fake SMS provider that notes each text. */
async function prodDesk() {
  const t = await salon();
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const sent = [];
  rt.sms = { name: 'fake', send: async (to, body) => { sent.push({ to, body }); return { ref: 'sms-' + sent.length }; } };
  const desk = browser(rt);
  assert.equal((await desk.post('/api/auth/login', { email: 'patron@test.fr', password: 'Patron-1313!' })).status, 200);
  return { t, rt, desk, sent, web: browser(rt, { ip: '10.6.' + Math.floor(++ips / 250) + '.' + (ips % 250) }) };
}
const KARIM = { kind: 'formation', first: 'Karim', phone: '06 98 76 54 32', email: 'Karim.B@exemple.fr', module: 'classique', message: 'Je suis coiffeur depuis deux ans, je veux progresser sur les dégradés.', website: '' };
const events = (rt, type) => rt.engine.journal.filter((e) => e.type === type);

test('a training request from the site: the event carries the kind and the module, the person is in pii only', async () => {
  const { rt, web } = await prod();
  const res = await web.post('/api/public/inquiries', KARIM);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.ok, true);
  const [e] = events(rt, 'inquiry.received');
  assert.deepEqual(e.data, { id: res.json.id, kind: 'formation', module: 'classique' });
  assert.deepEqual(e.pii, { first: 'Karim', phone: '+33698765432', email: 'karim.b@exemple.fr', message: KARIM.message });
  assert.deepEqual(e.actor, { t: 'client', id: 'web', n: '' }, 'the chained actor names nobody');
  // nothing of the person in what the chain covers: data, actor, nor the owner's e-mail event
  const chained = JSON.stringify(rt.engine.journal.map(({ pii, ...rest }) => rest));
  for (const w of ['Karim', '698765432', 'exemple.fr', 'dégradés']) assert.ok(!chained.includes(w), w + ' is out of the chain');
  // the owner's e-mail (WP-02's notify: the owner account's address), the details in its text
  const [mail] = events(rt, 'message.queued').filter((x) => x.data.template === 'owner_inquiry');
  assert.equal(mail.data.id, ownerMailId(e.data.id));
  assert.equal(mail.data.channel, 'email');
  assert.equal(mail.pii.to, 'patron@test.fr');
  assert.match(mail.pii.mail.subject, /^Demande de formation · La coupe homme classique et ses subtilités$/);
  assert.match(mail.pii.body, /Karim a écrit depuis la page Formations/);
  assert.match(mail.pii.body, /Téléphone : 06 98 76 54 32/);
  assert.match(mail.pii.body, /je veux progresser sur les dégradés/);
  const q = rt.engine.state.inquiries.get(e.data.id);
  assert.equal(q.status, 'new');
  assert.equal(q.first, 'Karim');
  assert.ok(verifyChain(rt.engine.journal).ok);
});

test('the honeypot filled: the same 200, and nothing is stored or sent', async () => {
  const { rt, web } = await prod();
  const v = rt.engine.state.version;
  const res = await web.post('/api/public/inquiries', { ...KARIM, website: 'https://spam.example' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  await rt.engine.sync(true);
  assert.equal(rt.engine.state.version, v, 'no event');
  assert.equal(rt.engine.state.inquiries.size, 0);
});

test('five requests an hour from one address; the sixth is a 429', async () => {
  const { rt, web } = await prod();
  // refused ones count apart: a person fixing a field is not locked out for the hour
  for (let i = 0; i < 4; i++) assert.equal((await web.post('/api/public/inquiries', { ...KARIM, phone: '06 12' })).status, 400);
  for (let i = 0; i < INQUIRIES_PER_HOUR; i++) assert.equal((await web.post('/api/public/inquiries', { ...KARIM, first: 'Karim' + i })).status, 200);
  const sixth = await web.post('/api/public/inquiries', KARIM);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.json.error.code, 'slow_down');
  assert.equal(rt.engine.state.inquiries.size, INQUIRIES_PER_HOUR);
  // another visitor is not held up by that one
  assert.equal((await browser(rt, { ip: '10.8.0.' + (ips % 250) }).post('/api/public/inquiries', KARIM)).status, 200);
});

test('what the form must say, in words the page shows beside the field; writes from another site are refused', async () => {
  const { rt, web } = await prod();
  const bad = async (body, field, msg) => {
    const r = await web.post('/api/public/inquiries', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.extra.field, field);
    assert.match(r.json.error.message, msg);
  };
  await bad({ ...KARIM, phone: '', email: '' }, 'phone', /un numéro ou un e-mail/);
  await bad({ ...KARIM, first: '  ' }, 'first', /prénom/);
  await bad({ ...KARIM, phone: '06 12' }, 'phone', /10 chiffres/);
  await bad({ ...KARIM, email: 'karim@' }, 'email', /e-mail/);
  await bad({ ...KARIM, module: 'peinture' }, 'module', /module/);
  // only a robot sends something else than text: refused, never '[object Object]' in the inbox
  await bad({ ...KARIM, first: { a: 1 } }, 'first', /Vérifie/);
  await bad({ ...KARIM, phone: ['0612345678'] }, 'phone', /Vérifie/);
  await bad({ ...KARIM, module: ['barbe'] }, 'module', /Vérifie/);
  // message: 1000 characters at most (the refusals above count apart from the 5 sent: the same address continues)
  const other = web;
  const long = await other.post('/api/public/inquiries', { ...KARIM, message: 'x'.repeat(1001) });
  assert.equal(long.status, 400);
  assert.equal(long.json.error.extra.field, 'message');
  const contact = await other.post('/api/public/inquiries', { kind: 'contact', first: 'Inès', email: 'ines@exemple.fr', message: '' });
  assert.equal(contact.json.error.extra.field, 'message', 'a contact message needs words');
  // an e-mail alone is enough, without a module for a training request
  // a first name on one line: it heads the card, the feed and the owner's e-mail
  const ok = await other.post('/api/public/inquiries', { kind: 'formation', first: 'Inès\n\tde\r\nla  Rue', email: 'ines@exemple.fr' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(rt.engine.state.inquiries.get(ok.json.id).module, '');
  assert.equal(rt.engine.state.inquiries.get(ok.json.id).first, 'Inès de la Rue');
  const cross = await browser(rt).post('/api/public/inquiries', KARIM, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  assert.equal(rt.engine.state.inquiries.size, 1);
});

test('erasing the request removes the person and their words from the journal, the export and the backup', async () => {
  const { t, rt, web } = await prod();
  const SECRET = 'Rappelle-moi après 18 h, mon patron ne doit pas savoir.';
  const { json } = await web.post('/api/public/inquiries', { ...KARIM, message: SECRET });
  await rt.engine.run(replyInquiry, { id: json.id, text: 'Bonjour {prenom}, Frank te rappelle demain à 18 h 30.' }, t.asOwner());
  const sms = [...rt.engine.state.messages.values()].find((m) => m.template === 'inquiry_reply');
  assert.equal(sms.body, 'Bonjour Karim, Frank te rappelle demain à 18 h 30.');
  const dump = async (engine) => JSON.stringify((await engine.store.read(0)).events);
  assert.ok((await dump(rt.engine)).includes(SECRET), 'kept until erased');

  // only the owner erases (client.erase); a barber cannot even read the inbox
  await rejects(rt.engine.run(eraseInquiry, { id: json.id }, t.asStaff('Ali')), 'forbidden');
  await rt.engine.run(eraseInquiry, { id: json.id }, t.asOwner());
  await rt.engine.run(eraseInquiry, { id: json.id }, t.asOwner());
  assert.equal(events(rt, 'inquiry.erased').length, 1, 'twice is once');
  for (const w of [SECRET, 'Karim', '698765432', 'karim.b@exemple.fr', 'Frank te rappelle']) {
    assert.ok(!(await dump(rt.engine)).includes(w), w + ' left the store');
    assert.ok(!JSON.stringify(rt.engine.journal).includes(w), w + ' left the journal in memory');
  }
  // the encrypted backup (Réglages › Données), opened again: the request is there, its words are not
  const key = randomBytes(32);
  const back = openBackup(sealBackup((await rt.engine.store.read(0)).events, key, { at: t.clock.now }), key);
  const text = JSON.stringify(back);
  assert.ok(text.includes(json.id));
  for (const w of [SECRET, 'Karim', '698765432', 'Frank te rappelle']) assert.ok(!text.includes(w), w + ' is out of the backup');
  const q = rt.engine.state.inquiries.get(json.id);
  assert.deepEqual([q.first, q.phone, q.email, q.message, q.erased], ['', '', '', '', true]);
  const mail = rt.engine.state.messages.get(ownerMailId(json.id));
  assert.deepEqual([mail.to, mail.body], ['', '']);
  assert.ok(verifyChain(rt.engine.journal).ok, 'the chain still verifies');
  // a server starting from the store knows the request, not the person
  const fresh = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await fresh.sync(true);
  assert.equal(fresh.state.inquiries.get(json.id).message, '');
  assert.ok(!JSON.stringify([...fresh.state.messages.values()]).includes('Frank te rappelle'));
  await rejects(rt.engine.run(replyInquiry, { id: json.id, text: 'Encore là ?' }, t.asOwner()), 'erased');
});

test('a request from a client’s number is linked to the file: erasing the file erases it too, everywhere', async () => {
  const { t, rt, desk, sent, web } = await prodDesk();
  const yanis = t.ids.yanis;
  const SECRET = 'Vous ouvrez le lundi de Pâques ? Je sors de l’hôpital.';
  const { json } = await web.post('/api/public/inquiries', { kind: 'contact', first: 'Yanis', phone: '06 12 34 56 78', message: SECRET });
  const [e] = events(rt, 'inquiry.received');
  assert.equal(e.data.cid, yanis);
  assert.equal((await desk.get('/api/v1/inquiries')).json.unread, 1);
  for (let i = 0; i < 3 && !rt.engine.state.clients.get(yanis).erased; i++) await rt.engine.run(eraseClient, { id: yanis, cancelUpcoming: true }, t.asOwner());
  assert.ok(rt.engine.state.clients.get(yanis).erased);
  // the store and the journal
  assert.ok(!JSON.stringify((await t.store.read(0)).events).includes('lundi de Pâques'));
  assert.ok(!JSON.stringify(rt.engine.journal).includes('lundi de Pâques'));
  // memory: the request is blanked and handled, as an Effacer on it would leave it
  const q = rt.engine.state.inquiries.get(json.id);
  assert.deepEqual([q.first, q.phone, q.email, q.message, q.erased, q.status], ['', '', '', '', true, 'handled']);
  // the inbox: nothing of the person, nothing left to do, so no badge stuck on the tab
  const inbox = (await desk.get('/api/v1/inquiries')).json;
  assert.equal(inbox.unread, 0);
  const it = inbox.items.find((x) => x.id === json.id);
  assert.deepEqual([it.erased, it.status, it.first, it.message, it.phone, it.hasPhone, it.cid], [true, 'handled', '', '', '', false, null]);
  // the live feed: the line stays, without the name or the words
  const line = (await desk.get('/api/v1/feed')).json.items.find((x) => x.inquiryId === json.id);
  assert.ok(line);
  assert.ok(!JSON.stringify(line).includes('Yanis') && !JSON.stringify(line).includes('Pâques'), JSON.stringify(line));
  // a tab left open on the desk: no text to that number, no number back in the journal, no reopening
  const v = rt.engine.state.version;
  const reply = await desk.post('/api/v1/inquiries/' + json.id + '/reply', { text: 'Bonjour, oui on ouvre.' });
  assert.equal(reply.status, 409);
  assert.equal(reply.json.error.code, 'erased');
  assert.equal((await desk.post('/api/v1/inquiries/' + json.id + '/handled', { undo: true })).status, 409);
  assert.equal((await desk.post('/api/v1/inquiries/' + json.id + '/handled', {})).status, 200);
  assert.equal(rt.engine.state.version, v, 'nothing written');
  assert.ok(!JSON.stringify(rt.engine.journal).includes('612345678'));
  assert.ok(!sent.some((x) => x.to.includes('612345678')));
  // a server starting from the store blanks it the same way
  const fresh = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await fresh.sync(true);
  assert.deepEqual([fresh.state.inquiries.get(json.id).message, fresh.state.inquiries.get(json.id).phone, fresh.state.inquiries.get(json.id).status], ['', '', 'handled']);
});

test('in production, Répondre par SMS needs a provider: without one the text would wait and expire', async () => {
  const { t, rt, web } = await prod();
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  await rt.engine.sync(true);
  const desk = browser(rt);
  assert.equal((await desk.post('/api/auth/login', { email: 'patron@test.fr', password: 'Patron-1313!' })).status, 200);
  const { json } = await web.post('/api/public/inquiries', KARIM);
  const list = (await desk.get('/api/v1/inquiries')).json;
  assert.deepEqual([list.sms, list.mode], [false, 'production']);
  const r = await desk.post('/api/v1/inquiries/' + json.id + '/reply', { text: 'Bonjour Karim' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'no_sms');
  assert.equal((await desk.get('/api/v1/inquiries')).json.unread, 1, 'still to answer');
});

test('the inbox: unread count, full details for the desk, Marquer traité, Répondre par SMS, a line in the feed', async () => {
  const clock = { now: at(DAY, 11) };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const before = rt.engine.state.version;
  const { json } = await site.post('/api/public/inquiries', KARIM);
  const list = await b.get('/api/v1/inquiries');
  assert.equal(list.status, 200);
  assert.equal(list.json.unread, 1);
  const [it] = list.json.items;
  assert.equal(it.id, json.id);
  assert.deepEqual([it.first, it.phone, it.email, it.moduleTitle, it.status, it.kindLabel], ['Karim', '06 98 76 54 32', 'karim.b@exemple.fr', 'La coupe homme classique et ses subtilités', 'new', 'formation']);
  // the live feed has a line for it
  const feed = await b.get('/api/v1/feed');
  const line = feed.json.items.find((x) => x.kind === 'inquiry');
  assert.equal(line.title, 'Nouvelle demande : formation · Karim');
  assert.equal(line.sub, 'La coupe homme classique et ses subtilités');
  const pulse = await b.get('/api/v1/pulse?since=' + before);
  assert.ok(pulse.json.feed.some((x) => x.kind === 'inquiry'));

  // Marquer traité, twice is once, and back to unread
  assert.equal((await b.post('/api/v1/inquiries/' + json.id + '/handled', {})).status, 200);
  const v = rt.engine.state.version;
  await b.post('/api/v1/inquiries/' + json.id + '/handled', {});
  assert.equal(rt.engine.state.version, v);
  assert.equal((await b.get('/api/v1/inquiries')).json.unread, 0);
  await b.post('/api/v1/inquiries/' + json.id + '/handled', { undo: true });
  assert.equal((await b.get('/api/v1/inquiries')).json.unread, 1);

  // Répondre par SMS: a service text to the number left, the request handled by it
  const r = await b.post('/api/v1/inquiries/' + json.id + '/reply', { text: 'Bonjour {prenom}, c’est Frank : je te rappelle demain matin.' }, { 'x-request-id': 'reply-0001' });
  assert.equal(r.status, 200, r.text);
  // a retried tap sends nothing more
  await b.post('/api/v1/inquiries/' + json.id + '/reply', { text: 'Bonjour {prenom}, c’est Frank : je te rappelle demain matin.' }, { 'x-request-id': 'reply-0001' });
  const after = (await b.get('/api/v1/inquiries')).json;
  assert.equal(after.unread, 0);
  assert.equal(after.items[0].replies.length, 1);
  assert.equal(after.items[0].replies[0].text, "Bonjour Karim, c'est Frank : je te rappelle demain matin.");
  const m = rt.engine.state.messages.get(r.json.msgId);
  assert.equal(m.channel, 'sms');
  assert.equal(m.to, '+33698765432');
  assert.ok(!m.marketing && m.dueAt <= clock.now, 'a service text: no STOP, no quiet hours');
  assert.equal((await b.post('/api/v1/inquiries/' + json.id + '/reply', { text: 'x' })).status, 400);
  assert.equal((await b.post('/api/v1/inquiries/inq_nope/handled', {})).status, 404);
  // without a session, nothing
  assert.equal((await site.get('/api/v1/inquiries')).status, 401);
});

test('an e-mail only request cannot be answered by SMS; a barber has no inbox', async () => {
  const t = await salon();
  const q = await t.engine.run(receiveInquiry, { kind: 'contact', first: 'Inès', email: 'ines@exemple.fr', message: 'Vous faites les mariages ?' }, t.asClient);
  await rejects(t.engine.run(replyInquiry, { id: q.id, text: 'Bonjour Inès' }, t.asOwner()), 'no_phone');
  await rejects(t.engine.run(markInquiryHandled, { id: q.id }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(replyInquiry, { id: q.id, text: 'Bonjour Inès' }, t.asStaff('Ali')), 'forbidden');
});

test('the training content: the four WordPress modules by default, the CPF only with Qualiopi, sessions to come', async () => {
  const t = await salon();
  const d = trainings.defaults();
  assert.deepEqual(d.modules.map((m) => m.id), ['barbe', 'classique', 'complexe', 'image']);
  assert.deepEqual(d.modules.map((m) => m.title), ['Taille et entretien de la coupe et de la barbe', 'La coupe homme classique et ses subtilités', 'La coupe homme complexe et ses techniques', 'Conseiller en image']);
  assert.ok(d.modules.every((m) => m.price === null && m.points.length));
  const pub = () => publicTrainings(t.engine.state.settings, DAY);
  assert.equal(pub().cpf, false);
  assert.equal(pub().qualiopi, '');

  // a journal from before the editor went (WP-05's Le site › Formations) may carry its own content: the page shows it
  const next = addDays(DAY, 9), past = addDays(DAY, -2);
  const modules = d.modules.map((m) => (m.id === 'barbe' ? { ...m, duration: '2 jours · 14 h', price: 45000 } : m));
  await t.engine.run(updateSettings, { trainings: { modules, sessions: [{ moduleId: 'barbe', date: next, seats: 3 }, { moduleId: 'barbe', date: past, seats: 2 }, { moduleId: 'image', date: next, seats: 6 }], qualiopi: 'Certificat n° 2024-QUA-0193 (AFNOR)', nda: '93 13 12345 13' } }, t.asOwner());
  const p = pub();
  assert.equal(p.cpf, true);
  assert.deepEqual(p.modules[0].sessions, [{ date: next, seats: 3 }], 'past sessions are off the page');
  assert.equal(p.modules[0].price, 45000);
  assert.equal(p.modules[0].duration, '2 jours · 14 h');
  // the CPF line goes with the certificate
  await t.engine.run(updateSettings, { trainings: { qualiopi: '' } }, t.asOwner());
  assert.equal(pub().cpf, false);
  // a request names a module the page lists
  await t.engine.run(updateSettings, { trainings: { modules: modules.filter((m) => m.id !== 'image') } }, t.asOwner());
  await rejects(t.engine.run(receiveInquiry, { kind: 'formation', first: 'Karim', phone: '0698765432', module: 'image' }, t.asClient), 'invalid');
});

test('the public training page over HTTP; the Comptoir no longer edits it', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const site = browser(rt);
  const b = browser(rt);
  await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  const pub = await site.get('/api/public/trainings');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.json.modules.map((m) => m.id), ['barbe', 'classique', 'complexe', 'image']);
  assert.equal(pub.json.cpf, false);
  assert.ok(!('sessions' in pub.json), 'sessions come with their module');
  assert.equal((await b.get('/api/v1/trainings')).status, 404, 'Le site › Formations is gone');
  assert.equal((await b.patch('/api/v1/trainings', { qualiopi: 'x' })).status, 404);
});

test('the training settings over PATCH /api/v1/settings keep their rules (the provider’s only way to write them)', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const site = browser(rt);
  const b = browser(rt);
  await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  const d = trainings.defaults();
  const next = addDays(DAY, 9);
  const put = (/** @type {any} */ x) => b.patch('/api/v1/settings', { trainings: x });
  assert.equal((await put({ qualiopi: 'Certificat B-2026-17', sessions: [{ moduleId: 'barbe', date: next, seats: 3 }] })).status, 200);
  const after = (await site.get('/api/public/trainings')).json;
  assert.equal(after.cpf, true);
  assert.deepEqual(after.modules[0].sessions, [{ date: next, seats: 3 }]);
  assert.equal((await site.patch('/api/v1/settings', { trainings: { qualiopi: '' } })).status, 401);
  // a code the page already uses as an id (the form #demande, a heading tm-…) would send its links to the wrong place
  for (const id of ['demande', 'main', 't-fin', 'tm-barbe', 'dm-f', 'A B']) assert.equal((await put({ modules: [{ id, title: 'Rasage' }] })).status, 400, id);
  // a code once; a session names a module of the patch; a real day
  assert.equal((await put({ modules: [d.modules[0], { ...d.modules[1], id: 'barbe' }] })).status, 400, 'twice the same code');
  assert.equal((await put({ modules: d.modules.slice(0, 1), sessions: [{ moduleId: 'image', date: next, seats: 1 }] })).status, 400, 'unknown module');
  assert.equal((await put({ sessions: [{ moduleId: 'barbe', date: '2026-02-30', seats: 1 }] })).status, 400, 'no such day');
  // a module taken out keeps its sessions in the settings, never on the page
  assert.equal((await put({ modules: d.modules.filter((m) => m.id !== 'barbe') })).status, 200);
  const left = (await site.get('/api/public/trainings')).json;
  assert.ok(!left.modules.some((m) => m.id === 'barbe'));
  assert.ok(!JSON.stringify(left).includes(next), 'the orphan session is not shown');
});

test('/formations without the API says what the defaults say, and loads no font from Google', () => {
  const html = readFileSync(new URL('../../public/formations.html', import.meta.url), 'utf8').replace(/&nbsp;/g, ' ');
  const d = trainings.defaults();
  assert.ok(html.includes(d.intro), 'the intro');
  for (const m of d.modules) {
    assert.ok(html.includes('id="' + m.id + '"'), 'the anchor #' + m.id);
    assert.ok(html.includes('<option value="' + m.id + '">' + m.title + '</option>'), 'the module in the form');
    for (const p of m.points) assert.ok(html.includes('<li>' + p + '</li>'), p);
  }
  assert.ok(!html.includes(CPF_LINE_VISIBLE), 'the CPF line is hidden by default');
  for (const f of ['formations.html', 'contact.html', 'demande.css']) assert.ok(!readFileSync(new URL('../../public/' + f, import.meta.url), 'utf8').includes('fonts.googleapis'), f);
});
const CPF_LINE_VISIBLE = '<p data-tr-if="cpf">';
