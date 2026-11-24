// AC-01 by e-mail · A salon that asks an address and not a number (settings.booking.contact 'email', no SMS route) opens
// the client space with a code sent to the address of the file: the same six digits, life, single use, wrong tries, caps
// and same-answer as the code by SMS, handed straight to the e-mail provider (never queued, never held), with nothing
// of the address or the digits in the journal. « Créer mon compte »: a first name, an address, the code. In 'phone' mode
// nothing of this is reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, DAY } from '../helpers.js';
import { browser, testRuntime } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import { addClient, updateClient, eraseClient, clientByEmail } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { createRuntime } from '../../server/http/runtime.js';
import { createEngine } from '../../server/core/engine.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { signLink } from '../../server/auth/session.js';
import { OTP_TTL, OTP_PER_DAY, otpCode, otpMail, otpMailId, liveCodes, missesOf } from '../../server/domain/otp.js';
import { linkSendsToday, LINK_PER_DAY, LINK_IP_PER_HOUR } from '../../server/domain/linkcap.js';
import { sendCode, verifyCode, fileForSignIn, signInVia, CLIENT_ACTOR } from '../../server/commands/accounts.js';
import { accountOf } from '../../server/projections/accounts.js';
import { ACCOUNT_TIMING, START_MESSAGE, START_MESSAGE_MAIL, ACC_TTL_MS, settled } from '../../server/http/routes-me.js';
import { readClient, CLIENT_COOKIE } from '../../server/auth/client-session.js';
import { sendSpaceInvite } from '../../server/commands/me.js';
import accountsSection, { accountsOn } from '../../server/settings/accounts.js';

const SECRET = 'test-secret-0123456789';
const SAME = { ok: true, message: START_MESSAGE_MAIL };
Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });

let n = 0;
/** An address nobody else in this process uses: the per-address limit lives in the process's memory. */
const freshMail = (who = 'yanis') => who + '.' + ++n + '.' + Math.random().toString(36).slice(2, 8) + '@exemple.fr';

/** A production salon in e-mail mode with the space switched on, an e-mail provider that records what leaves. */
async function setup({ enabled = true, contact = 'email', provider = true } = {}) {
  const t = await salon();
  await t.engine.run(updateSettings, { ...(enabled ? { accounts: { enabled: true } } : {}), booking: { contact } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET }, store: t.store, clock: () => t.clock.now });
  const mails = [], texts = [];
  if (provider) rt.email = { name: 'test', send: async (m) => { mails.push(m); return { ref: 'm_' + mails.length }; } };
  rt.sms = { name: 'test', send: async (to, body) => { texts.push({ to, body }); return { ref: 's_' + texts.length }; } };
  const client = async (o = {}) => {
    const email = o.email || freshMail((o.first || 'yanis').toLowerCase());
    const id = (await t.engine.run(addClient, { first: o.first || 'Yanis', last: 'Martin', email, ...(o.phone ? { phone: o.phone } : {}) }, t.asOwner())).id;
    await rt.engine.sync(true);
    return { id, email };
  };
  const state = () => rt.engine.state;
  const challenges = (cid) => [...state().otpMail.values()].filter((m) => m.cid === cid).sort((a, b) => a.at - b.at);
  const lastCode = (cid) => { const m = challenges(cid).at(-1); return m ? otpCode(rt.secret, m.id) : null; };
  const signIn = async (b, who, first = 'Yanis') => {
    assert.deepEqual((await b.post('/api/public/account/start', { email: who.email })).json, SAME);
    await settled();
    const r = await b.post('/api/public/account/verify', { email: who.email, code: lastCode(who.id), first });
    assert.equal(r.status, 200, r.text);
    return r;
  };
  return { t, rt, mails, texts, client, state, challenges, lastCode, signIn };
}
const events = (rt, type) => rt.engine.journal.filter((e) => e.type === type);
const wrongOf = (...right) => ['000000', '111111', '222222', '333333'].find((x) => !right.includes(x));

test('a known address gets one code by e-mail, at once and straight from the provider; nothing of it is queued or journaled; it opens the space once', async () => {
  const { t, rt, mails, texts, client, challenges } = await setup();
  const yanis = await client();
  const b = browser(rt);
  assert.deepEqual((await b.get('/api/public/account')).json, { enabled: true, contact: 'email', signedIn: false, demo: false, loyalty: (await b.get('/api/public/account')).json.loyalty });
  // typed with capitals and spaces: the same address
  assert.deepEqual((await b.post('/api/public/account/start', { email: '  ' + yanis.email.toUpperCase() + ' ' })).json, SAME);
  await settled();
  const [c] = challenges(yanis.id);
  assert.ok(c, 'one challenge');
  assert.equal(c.id, otpMailId(yanis.id, DAY, 0));
  const code = otpCode(rt.secret, c.id);
  assert.match(code, /^\d{6}$/);
  // what left: one mail, to the file's address, the digits in it, no link to click; no text, nothing in the outbox
  assert.equal(mails.length, 1, 'sent at once, by the provider');
  assert.equal(mails[0].to, yanis.email);
  assert.equal(mails[0].tag, 'otp');
  assert.deepEqual({ subject: mails[0].subject, text: mails[0].text }, otpMail(rt.engine.state.settings.shop.name, code));
  assert.ok(mails[0].subject.startsWith(code) && mails[0].text.includes(code) && mails[0].text.includes('10 minutes'));
  assert.ok(!mails[0].cta && !/https?:/.test(mails[0].text), 'a code, never a link');
  assert.equal(texts.length, 0);
  assert.equal([...rt.engine.state.messages.values()].filter((m) => m.template === 'otp').length, 0, 'no queued message: no queue or hold can keep it');
  // the journal: one event that names the file only; neither the digits nor the address anywhere in it
  const stored = (await t.store.read(0)).events;
  const issued = stored.filter((e) => e.type === 'account.codeIssued');
  assert.equal(issued.length, 1);
  assert.deepEqual(issued[0].data, { id: c.id, cid: yanis.id });
  assert.ok(!issued[0].pii || !Object.keys(issued[0].pii).length, 'no personal data on the challenge');
  assert.deepEqual(issued[0].actor, CLIENT_ACTOR);
  assert.ok(!JSON.stringify(stored).includes(code), 'the code is not in the journal');

  // the first opening asks the first name; the right code stays good meanwhile
  const ask = await b.post('/api/public/account/verify', { email: yanis.email, code });
  assert.deepEqual(ask.json, { ok: false, ask: 'first', message: 'Ton prénom ?' });
  assert.equal((await b.get('/api/me')).status, 401);
  const ok = await b.post('/api/public/account/verify', { email: yanis.email.toUpperCase(), code, first: 'yanis' });
  assert.deepEqual(ok.json, { ok: true, first: 'Yanis' });
  // the session: bound to the address (no number on this file at all), and it opens the space
  const p = readClient(rt.secret, b.jar.get(CLIENT_COOKIE), t.clock.now);
  assert.equal(p.cid, yanis.id);
  assert.equal(p.ph, '');
  assert.match(p.em, /^[\w-]{16}$/);
  assert.ok(!JSON.stringify(p).includes('exemple.fr'), 'the cookie holds a tag, not the address');
  const me = await b.get('/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual({ first: me.json.first, via: me.json.via, phone: me.json.phone }, { first: 'Yanis', via: 'email', phone: '' });
  const home = await b.get('/api/me/home');
  assert.equal(home.status, 200, home.text);
  assert.equal(home.json.contact, 'email');
  const acc = accountOf(rt.engine.state, [yanis.id]);
  assert.deepEqual({ fenced: acc.fenced, named: acc.named, count: acc.count }, { fenced: false, named: true, count: 1 });
  assert.equal(events(rt, 'message.queued').filter((e) => e.data.template === 'accountOpened').length, 0, 'no second mail to the address the code just went to');
  // a code works once
  const again = await browser(rt).post('/api/public/account/verify', { email: yanis.email, code, first: 'Yanis' });
  assert.equal(again.status, 400);
  assert.equal(again.json.error.code, 'bad_code');
});

test('unknown and erased addresses: the same answer and nothing sent or written; a bad address is a 400', async () => {
  const { t, rt, mails, client, state } = await setup();
  const b = browser(rt);
  const before = rt.engine.journal.length;
  assert.deepEqual((await b.post('/api/public/account/start', { email: freshMail('inconnu') })).json, SAME);
  // erased: its address opens nothing
  const gone = await client({ first: 'Parti' });
  for (let i = 0; i < 3; i++) if ((await rt.engine.run(eraseClient, { id: gone.id, cancelUpcoming: true }, t.asOwner())).erased) break;
  assert.ok(state().clients.get(gone.id).erased);
  const afterErase = rt.engine.journal.length;
  assert.deepEqual((await browser(rt).post('/api/public/account/start', { email: gone.email })).json, SAME);
  await settled();
  assert.equal(mails.length, 0);
  assert.equal(events(rt, 'account.codeIssued').length, 0);
  assert.equal(rt.engine.journal.length, afterErase, 'nothing written for an address that opens nothing');
  assert.ok(afterErase > before);
  // not an address: said so (nothing about any file), and never run
  for (const email of ['pas-une-adresse', 'a@b', '@exemple.fr', 'x'.repeat(200) + '@exemple.fr']) {
    const r = await browser(rt).post('/api/public/account/start', { email });
    assert.equal(r.status, 400, email);
    assert.equal(r.json.error.message, 'Vérifie ton adresse e-mail.');
  }
  assert.equal((await browser(rt).post('/api/public/account/start', {})).status, 400);
  // verify against an unknown or malformed address: the wrong-code answer, like a wrong code on a real file
  for (const email of [freshMail('inconnu'), 'pas-une-adresse']) {
    const v = await browser(rt).post('/api/public/account/verify', { email, code: '123456', first: 'Yanis' });
    assert.equal(v.status, 400);
    assert.equal(v.json.error.code, 'bad_code');
  }
  assert.equal(events(rt, 'account.codeMissed').length, 0);
});

test('in phone mode an address opens nothing: the routes ask a number as before, no mail leaves, no challenge is written', async () => {
  const { t, rt, mails, client } = await setup({ contact: 'phone' });
  const y = await client({ phone: '06 55 44 33 22' });
  const b = browser(rt);
  assert.equal((await b.get('/api/public/account')).json.contact, undefined);
  const r = await b.post('/api/public/account/start', { email: y.email });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.message, 'Vérifie ton numéro.');
  const j = await b.post('/api/public/account/join', { first: 'Yanis', email: freshMail() });
  assert.equal(j.status, 400);
  assert.equal(j.json.error.message, 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.');
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: { otpCode: (id) => otpCode(rt.secret, id) } };
  assert.deepEqual(await rt.engine.run(sendCode, { email: y.email }, ctx), { sent: false });
  assert.deepEqual(await rt.engine.run(verifyCode, { email: y.email, code: '123456' }, ctx), { ok: false });
  assert.equal(fileForSignIn(rt.engine.state, { email: y.email }), null);
  // an address in the body beside the number is ignored: the code goes by SMS, the answer is the SMS one
  assert.deepEqual((await b.post('/api/public/account/start', { phone: '06 55 44 33 22', email: y.email })).json, { ok: true, message: START_MESSAGE });
  await settled();
  assert.equal(mails.length, 0);
  assert.equal(events(rt, 'account.codeIssued').length, 0);
  assert.equal([...rt.engine.state.messages.values()].filter((m) => m.template === 'otp' && m.cid === y.id).length, 1);
  assert.equal(signInVia(rt.engine.state, rt.engine.state.clients.get(y.id), { cid: y.id }), 'sms');
  void t;
});

test('no e-mail provider: the same answer, and no challenge is written (a code nobody receives would use up the day’s three)', async () => {
  const { rt, client } = await setup({ provider: false });
  assert.equal(rt.email, null);
  const y = await client();
  assert.deepEqual((await browser(rt).post('/api/public/account/start', { email: y.email })).json, SAME);
  const j = await browser(rt).post('/api/public/account/join', { first: 'Nouveau', email: freshMail('nouveau') });
  assert.deepEqual(j.json, SAME);
  await settled();
  assert.equal(events(rt, 'account.codeIssued').length, 0);
  assert.equal([...rt.engine.state.clients.values()].filter((c) => c.first === 'Nouveau').length, 0, 'no file made either');
});

test('the provider failing is never said: the same answer, and the next ask sends again', async () => {
  const { rt, mails, client, lastCode } = await setup();
  const y = await client();
  const good = rt.email.send;
  rt.email.send = async () => { throw new Error('smtp down'); };
  const b = browser(rt);
  assert.deepEqual((await b.post('/api/public/account/start', { email: y.email })).json, SAME);
  await settled();
  rt.email.send = good;
  assert.deepEqual((await b.post('/api/public/account/start', { email: y.email })).json, SAME);
  await settled();
  assert.equal(mails.length, 1);
  assert.ok(mails[0].text.includes(lastCode(y.id)));
});

test('three codes a day per address, shared with the other link texts and counted in the journal; the 4th ask gets the same answer and nothing', async () => {
  const { t, rt, mails, client, challenges, state } = await setup();
  const y = await client();
  for (let i = 0; i < 5; i++) assert.deepEqual((await browser(rt).post('/api/public/account/start', { email: y.email })).json, SAME);
  await settled();
  assert.equal(OTP_PER_DAY, 3);
  assert.equal(challenges(y.id).length, 3);
  assert.equal(mails.length, 3);
  assert.equal(linkSendsToday(state(), y.id, DAY), LINK_PER_DAY);
  // the journal's cap holds on another instance (its memory knows nothing of the asks above)
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: {} };
  assert.deepEqual(await other.run(sendCode, { email: y.email }, ctx), { sent: false, cid: y.id });
  // a link text already sent today counts against the codes: one invite by SMS, then two codes only
  const z = await client({ first: 'Zed', phone: '06 77 66 55 44' });
  await t.engine.run(sendSpaceInvite, { cid: z.id, link: 'https://salon.test/moi?garder=x' }, t.asOwner());
  await rt.engine.sync(true);
  const sent = [];
  for (let i = 0; i < 3; i++) sent.push((await rt.engine.run(sendCode, { email: z.email }, ctx)).sent);
  assert.deepEqual(sent, [true, true, false]);
  // tomorrow the address may ask again
  t.clock.now += 24 * 3600000;
  assert.equal((await rt.engine.run(sendCode, { email: y.email }, ctx)).sent, true);
});

test('ten asks an hour per device, every address together: then 429', async () => {
  const { rt, client } = await setup();
  const b = browser(rt, { ip: '10.77.0.9' });
  const y = await client();
  for (let i = 0; i < LINK_IP_PER_HOUR; i++) assert.equal((await b.post('/api/public/account/start', { email: i ? freshMail('x') : y.email })).status, 200);
  const r = await b.post('/api/public/account/start', { email: y.email });
  assert.equal(r.status, 429);
  assert.equal((await b.post('/api/public/account/join', { first: 'Yanis', email: freshMail() })).status, 429, 'join shares the device limit');
  await settled();
});

test('five wrong codes kill the code and lock the file for a while; a code is dead after 10 minutes; wrong tries are counted across instances', async () => {
  const { t, rt, client, lastCode, challenges } = await setup();
  const y = await client();
  const b = browser(rt);
  await b.post('/api/public/account/start', { email: y.email });
  await settled();
  const right = lastCode(y.id);
  const wrong = wrongOf(right);
  for (let i = 0; i < 5; i++) {
    const r = await b.post('/api/public/account/verify', { email: y.email, code: wrong, first: 'Yanis' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'bad_code');
  }
  await settled();
  assert.equal(missesOf(rt.engine.state, challenges(y.id)[0].id).n, 5);
  assert.equal(liveCodes(rt.engine.state, y.id, t.clock.now).length, 0);
  // the file is locked (whatever the device), and the right code is dead anyway
  const late = await browser(rt).post('/api/public/account/verify', { email: y.email.toUpperCase(), code: right, first: 'Yanis' });
  assert.equal(late.status, 429);
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: { otpCode: (id) => otpCode(rt.secret, id) } };
  assert.deepEqual(await rt.engine.run(verifyCode, { email: y.email, code: right, first: 'Yanis' }, ctx), { ok: false });

  // expiry
  const ben = await client({ first: 'Ben' });
  await browser(rt).post('/api/public/account/start', { email: ben.email });
  await settled();
  const code = lastCode(ben.id);
  t.clock.now += OTP_TTL - 1000;
  assert.equal(liveCodes(rt.engine.state, ben.id, t.clock.now).length, 1);
  t.clock.now += 2000;
  const r = await browser(rt).post('/api/public/account/verify', { email: ben.email, code, first: 'Ben' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'bad_code');

  // two instances on one store: five misses between them, deterministic ids, and a replay counts the same
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  const carl = await client({ first: 'Carl' });
  await rt.engine.sync(true);
  const { msgId } = await rt.engine.run(sendCode, { email: carl.email }, ctx);
  const good = otpCode(rt.secret, msgId);
  for (let i = 0; i < 5; i++) assert.deepEqual(await (i % 2 ? other : rt.engine).run(verifyCode, { email: carl.email, code: wrongOf(good), first: 'Carl' }, ctx), { ok: false });
  await rt.engine.sync(true);
  assert.deepEqual(rt.engine.journal.filter((e) => e.type === 'account.codeMissed' && e.data.msgId === msgId).map((e) => e.data.id), [1, 2, 3, 4, 5].map((k) => 'acm_' + msgId + '_' + k));
  assert.deepEqual(await other.run(verifyCode, { email: carl.email, code: good, first: 'Carl' }, ctx), { ok: false });
  const s2 = emptyState();
  for (const e of rt.engine.journal) evolve(s2, e);
  assert.equal(missesOf(s2, msgId).n, 5);
  assert.equal(liveCodes(s2, carl.id, t.clock.now).length, 0);
});

test('twenty wrong codes an hour from one device, whatever the addresses: 429', async () => {
  const { rt } = await setup();
  const b = browser(rt, { ip: '10.88.0.3' });
  for (let i = 0; i < 20; i++) assert.equal((await b.post('/api/public/account/verify', { email: freshMail('z'), code: '123456' })).status, 400);
  assert.equal((await b.post('/api/public/account/verify', { email: freshMail('z'), code: '123456' })).status, 429);
});

test('the first name: asked once, a wrong one says so about the address, the third opens the space fenced and unnamed', async () => {
  const { rt, client, lastCode } = await setup();
  const y = await client({ first: 'Mohamed' });
  const b = browser(rt);
  await b.post('/api/public/account/start', { email: y.email });
  await settled();
  const code = lastCode(y.id);
  const w1 = await b.post('/api/public/account/verify', { email: y.email, code, first: 'Karim' });
  assert.deepEqual(w1.json, { ok: false, ask: 'first', message: 'Ce n’est pas le prénom qu’on a pour cette adresse. Réessaie.' });
  await b.post('/api/public/account/verify', { email: y.email, code, first: 'Samir' });
  const third = await b.post('/api/public/account/verify', { email: y.email, code, first: 'Nabil' });
  assert.deepEqual(third.json, { ok: true, first: '' }, 'opened, and told nothing of the holder');
  const acc = accountOf(rt.engine.state, [y.id]);
  assert.deepEqual({ fenced: acc.fenced, named: acc.named }, { fenced: true, named: false });
  const prof = await b.get('/api/me/profile');
  assert.equal(prof.json.email, '', 'a fenced space learns nothing of the address on file');
});

test('the session follows the address: it ends when the salon changes it or erases the file, and « Déconnecter tous mes appareils » ends every one', async () => {
  const { t, rt, client, signIn } = await setup();
  const alive = async (b) => (await b.get('/api/me')).status;
  const a = await client(); const ba = browser(rt);
  await signIn(ba, a);
  assert.equal(await alive(ba), 200);
  // a number added to the file changes nothing for a session opened by e-mail
  await t.engine.run(updateClient, { id: a.id, patch: { phone: '06 11 22 33 44' } }, t.asOwner());
  assert.equal(await alive(ba), 200);
  await t.engine.run(updateClient, { id: a.id, patch: { email: freshMail('autre') } }, t.asOwner());
  assert.equal(await alive(ba), 401, 'the address changed: the session is over');
  // the old address opens nothing any more
  assert.equal(fileForSignIn(rt.engine.state, { email: a.email }), null);

  const c = await client({ first: 'Carl' }); const b1 = browser(rt), b2 = browser(rt);
  await signIn(b1, c, 'Carl');
  t.clock.now += 1000;
  await signIn(b2, c, 'Carl');
  t.clock.now += 1000;
  assert.equal((await b1.post('/api/me/signout-all')).status, 200);
  assert.equal(await alive(b1), 401);
  assert.equal(await alive(b2), 401);
  t.clock.now += 1000;
  await signIn(b2, c, 'Carl');
  assert.equal(await alive(b2), 200);

  const e = await client({ first: 'Eric' }); const be = browser(rt);
  await signIn(be, e, 'Eric');
  for (let i = 0; i < 3; i++) if ((await rt.engine.run(eraseClient, { id: e.id, cancelUpcoming: true }, t.asOwner())).erased) break;
  assert.equal(await alive(be), 401);
  assert.equal([...rt.engine.state.otpMail.values()].filter((m) => m.cid === e.id).length, 0, 'the erased file’s challenges are forgotten');
});

test('« Créer mon compte »: a first name, an address, the code; the file is made when no file carries the address, and nothing more is asked', async () => {
  const { rt, mails, lastCode, state } = await setup();
  const email = freshMail('nadia');
  const b = browser(rt);
  assert.equal(clientByEmail(state(), email), null);
  const j = await b.post('/api/public/account/join', { first: 'nadia', email: email.toUpperCase() });
  assert.deepEqual(j.json, SAME);
  const c = clientByEmail(state(), email);
  assert.ok(c, 'the file is made');
  assert.deepEqual({ first: c.first, email: c.email, phone: c.phone || '', source: c.source, marketing: !!c.marketing }, { first: 'Nadia', email, phone: '', source: 'site', marketing: false });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, email);
  const v = await b.post('/api/public/account/verify', { email, code: lastCode(c.id), first: 'Nadia' });
  assert.deepEqual(v.json, { ok: true, first: 'Nadia' });
  const acc = accountOf(state(), [c.id]);
  assert.deepEqual({ fenced: acc.fenced, named: acc.named }, { fenced: false, named: true });
  assert.equal((await b.get('/api/me/home')).status, 200);
  // asked again for the same address: no second file, the same answer
  const files = state().clients.size;
  assert.deepEqual((await browser(rt).post('/api/public/account/join', { first: 'Nadia', email })).json, SAME);
  assert.equal(state().clients.size, files);
});

test('« Créer mon compte » on an address the salon already has: the same answer, no new file, and the file’s own first name is still asked', async () => {
  const { rt, mails, client, lastCode, state } = await setup();
  const y = await client({ first: 'Mohamed' });
  const files = state().clients.size;
  const b = browser(rt);
  assert.deepEqual((await b.post('/api/public/account/join', { first: 'Intrus', email: y.email })).json, SAME);
  assert.equal(state().clients.size, files);
  assert.equal(state().clients.get(y.id).first, 'Mohamed', 'the name typed never rewrites the file');
  assert.equal(mails.length, 1, 'the code goes to the address, which only its holder reads');
  const v = await b.post('/api/public/account/verify', { email: y.email, code: lastCode(y.id), first: 'Intrus' });
  assert.equal(v.json.ok, false);
  assert.equal(v.json.ask, 'first');
  // bad input
  assert.equal((await browser(rt).post('/api/public/account/join', { first: 'N', email: freshMail() })).status, 400);
  assert.equal((await browser(rt).post('/api/public/account/join', { first: 'Nadia', email: 'nope' })).status, 400);
  assert.equal(state().clients.size, files);
});

test('« Garde ton espace » after a booking made with an address: the code goes to that address, said masked; the booker is not asked his name', async () => {
  const { rt, mails, lastCode, state } = await setup();
  const site = browser(rt);
  const email = freshMail('karim');
  const book = await site.post('/api/public/bookings', { serviceIds: [[...state().services.values()][0].id], staffId: 'any', day: addDays(DAY, 2), start: 600, first: 'Karim', email });
  assert.equal(book.status, 201, book.text);
  const before = mails.length;
  const keep = await site.post('/api/public/account/keep', { token: book.json.token });
  assert.equal(keep.status, 200, keep.text);
  assert.deepEqual(keep.json, { ok: true, via: 'email', sentTo: 'k•••@exemple.fr' });
  const c = clientByEmail(state(), email);
  const codeMails = mails.slice(before).filter((m) => m.tag === 'otp');
  assert.equal(codeMails.length, 1);
  assert.equal(codeMails[0].to, email);
  const v = await site.post('/api/public/account/verify', { token: book.json.token, code: lastCode(c.id) });
  assert.deepEqual(v.json, { ok: true, first: 'Karim' });
  assert.equal((await site.get('/api/me')).json.via, 'email');
  assert.equal((await site.post('/api/public/account/keep', { token: 'LA-NOPE.xxxxxxxxxxxxxxxxxxxxxx' })).status, 404);
});

test('a link on a file without an address still goes by SMS in e-mail mode (the salon’s invite to a number)', async () => {
  const { t, rt, mails, texts, state } = await setup();
  const id = (await t.engine.run(addClient, { first: 'Omar', last: 'B', phone: '06 99 88 77 66' }, t.asOwner())).id;
  await rt.engine.sync(true);
  const token = signLink(rt.secret, 'acc', id + '~' + (t.clock.now + ACC_TTL_MS).toString(36));
  const b = browser(rt);
  const keep = await b.post('/api/public/account/keep', { token });
  assert.deepEqual(keep.json, { ok: true, sentTo: '06 •• •• •• 66' });
  assert.equal(mails.length, 0);
  assert.equal(texts.length, 1);
  const m = [...state().messages.values()].find((x) => x.template === 'otp' && x.cid === id);
  const v = await b.post('/api/public/account/verify', { token, code: otpCode(rt.secret, m.id), first: 'Omar' });
  assert.deepEqual(v.json, { ok: true, first: 'Omar' });
  assert.equal((await b.get('/api/me')).json.via, undefined);
});

test('the demo sends no mail: a visitor’s own fresh account gets its code on the page, a seeded client’s address never does', async () => {
  const rt = await testRuntime();
  const s = () => rt.engine.state;
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const { capsOf } = await import('../../server/domain/permissions.js');
  await rt.engine.run(updateSettings, { accounts: { enabled: true }, booking: { contact: 'email' } }, { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) });
  assert.equal(rt.email, null);
  const email = freshMail('visiteur');
  const b = browser(rt);
  const j = await b.post('/api/public/account/join', { first: 'Visiteur', email });
  assert.equal(j.status, 200, j.text);
  assert.match(j.json.demoCode, /^\d{6}$/);
  const v = await b.post('/api/public/account/verify', { email, code: j.json.demoCode, first: 'Visiteur' });
  assert.deepEqual(v.json, { ok: true, first: 'Visiteur' });
  // a seeded client's address: the same answer, no code handed out
  const seeded = [...s().clients.values()].find((c) => c.email && !c.erased && c.source !== 'site' && clientByEmail(s(), c.email) === c);
  if (seeded) {
    const r = await browser(rt).post('/api/public/account/join', { first: seeded.first, email: seeded.email });
    assert.equal(r.json.demoCode, undefined);
    const st = await browser(rt).post('/api/public/account/start', { email: seeded.email });
    await settled();
    // only the showcase persona's own address may show its code
    const { personaOf } = await import('../../server/commands/accounts.js');
    const persona = personaOf(s(), rt.engine.clock());
    if (!persona || persona.id !== seeded.id) assert.equal(st.json.demoCode, undefined);
  }
});

test('the challenges of two days ago are dropped as new ones fold; golive says the space is ready in e-mail mode', async () => {
  const { t, rt, client, challenges } = await setup();
  const y = await client();
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: {} };
  await rt.engine.run(sendCode, { email: y.email }, ctx);
  t.clock.now += 3 * 24 * 3600000;
  await rt.engine.run(sendCode, { email: y.email }, ctx);
  assert.equal(challenges(y.id).length, 1);
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: { enabled: false }, booking: { contact: 'email' } } }), { on: false, blocker: 'Prêt à ouvrir : le code de connexion part par e-mail' });
  // nothing chosen yet (no `enabled` stored, the live salon's case): a salon that writes by e-mail is open, one that texts is not
  assert.deepEqual(accountsSection.defaults(), { sessionDays: 180, fenceDays: 180 });
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: accountsSection.defaults(), booking: { contact: 'email' } } }), { on: true, blocker: '' });
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: accountsSection.defaults(), booking: { contact: 'phone' } } }), { on: false, blocker: 'S’ouvre quand le SMS est testé et la bascule faite' });
  assert.equal(accountsOn({ settings: { accounts: accountsSection.defaults(), booking: { contact: 'email' } } }), true);
  assert.equal(accountsOn({ settings: { accounts: { enabled: false }, booking: { contact: 'email' } } }), false, 'the owner’s « fermé » wins');
  assert.equal(accountsOn({ settings: { accounts: { enabled: true }, booking: { contact: 'phone' } } }), true);
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: { enabled: false }, booking: { contact: 'phone' } } }), { on: false, blocker: 'S’ouvre quand le SMS est testé et la bascule faite' });
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: { enabled: true }, booking: { contact: 'email' } } }), { on: true, blocker: '' });
});
