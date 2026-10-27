// AC-01 · Espace client: a code by SMS opens a client's space on the file the salon already has. The code is never stored
// (derived from the message id, filled as the text leaves), works once and dies after five wrong tries counted in the
// journal; the session lx_c follows the file's number, merges, revocations and erasure; a number that may have changed
// hands opens fenced; the demo's persona changes nothing for the next visitor; guest booking is untouched.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { browser, testRuntime } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, updateClient, mergeClients, eraseClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { createRuntime } from '../../server/http/runtime.js';
import { createEngine } from '../../server/core/engine.js';
import { verifyChain } from '../../server/core/journal.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { router } from '../../server/http/kit.js';
import { signLink } from '../../server/auth/session.js';
import { capsOf } from '../../server/domain/permissions.js';
import { DEMO } from '../../server/domain/seed.js';
import { OTP_TEXT, OTP_LATE_TEXT, OTP_TTL, otpCode, fillOtp, liveCodes, missesOf } from '../../server/domain/otp.js';
import { sendCode, verifyCode, detachPhone, personaOf, sameFirst, CLIENT_ACTOR } from '../../server/commands/accounts.js';
import { accountsExtension, accountOf } from '../../server/projections/accounts.js';
import { meRoutes, ACCOUNT_TIMING, START_MESSAGE, settled } from '../../server/http/routes-me.js';
import { runAs, isPersona } from '../../server/http/me-kit.js';
import { clientRoutes } from '../../server/http/routes-client.js';
import { dispatchNow } from '../../server/http/scheduler.js';
import { CLIENT_COOKIE } from '../../server/auth/client-session.js';
import accountsSection from '../../server/settings/accounts.js';

const SECRET = 'test-secret-0123456789';
const SAME = { ok: true, message: START_MESSAGE };
const fast = () => Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const real = () => Object.assign(ACCOUNT_TIMING, { minMs: 450, jitterMs: 200, verifyMs: 300 });
fast();

let numbers = 0;
/** A number nobody else in this process uses: the per-number limit lives in the process's memory. */
function freshPhone() {
  const digits = '07' + String(10000000 + ++numbers * 7919).slice(-8);
  return { phone: digits.replace(/(\d{2})(?=\d)/g, '$1 '), e164: '+33' + digits.slice(1) };
}

/** A production salon with the space switched on, and its HTTP runtime on the same store. */
async function setup({ enabled = true } = {}) {
  const t = await salon();
  if (enabled) await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET }, store: t.store, clock: () => t.clock.now });
  const client = async (o = {}) => {
    const p = freshPhone();
    const id = (await t.engine.run(addClient, { first: o.first || 'Yanis', last: 'Martin', phone: p.phone, ...(o.email ? { email: o.email } : {}) }, t.asOwner())).id;
    return { id, ...p };
  };
  const S_ = () => rt.engine.state;
  const codes = (cid) => [...S_().messages.values()].filter((m) => m.template === 'otp' && m.cid === cid).sort((a, b) => a.at - b.at);
  const lastCode = (cid) => { const m = codes(cid).at(-1); return m ? otpCode(rt.secret, m.id) : null; };
  /** start → code → verify, as the phone would */
  const signIn = async (b, who, first = 'Yanis') => {
    assert.deepEqual((await b.post('/api/public/account/start', { phone: who.phone })).json, SAME);
    await settled();
    const r = await b.post('/api/public/account/verify', { phone: who.phone, code: lastCode(who.id), first });
    assert.equal(r.status, 200, r.text);
    return r;
  };
  const tickClock = (ms = 1000) => { t.clock.now += ms; };
  return { t, rt, client, codes, lastCode, signIn, tickClock, state: S_ };
}
const ownerCtx = (t) => t.asOwner();
const events = (rt, type) => rt.engine.journal.filter((e) => e.type === type);

test('a known number gets one code whose digits are nowhere but in the text that leaves; it opens the space once', async () => {
  const { t, rt, client, codes } = await setup();
  const yanis = await client();
  // a provider that records what really leaves
  const sent = [];
  rt.sms = { name: 'brevo', send: async (to, body) => { sent.push({ to, body }); return { ref: 'br_' + sent.length }; } };
  const b = browser(rt);
  assert.deepEqual((await b.post('/api/public/account/start', { phone: yanis.phone })).json, SAME);
  await settled();
  const [m] = codes(yanis.id);
  assert.ok(m, 'one code queued');
  assert.equal(codes(yanis.id).length, 1);
  assert.equal(m.id, 'msg_otp_' + yanis.id + '_' + DAY + '_0');
  assert.equal(m.body, OTP_TEXT, 'the queued body keeps the placeholder');
  assert.doesNotMatch(m.body, /\d{6}/);
  const code = otpCode(rt.secret, m.id);
  assert.match(code, /^\d{6}$/);
  // what left: the code, and the WebOTP line for Android
  assert.equal(sent.length, 1, 'sent at once (dispatchNow)');
  assert.equal(sent[0].to, yanis.e164);
  assert.equal(sent[0].body, OTP_TEXT.replace('{code}', code) + '\n\n@salon.test #' + code);
  assert.equal(fillOtp({ id: m.id, body: OTP_TEXT }, rt.secret, 'salon.test'), sent[0].body);
  assert.equal(fillOtp({ id: m.id, body: 'Rien à remplir' }, rt.secret, 'salon.test'), 'Rien à remplir');
  // a text that leaves after its code died (no route for a while) carries no dead digits
  assert.equal(fillOtp({ id: m.id, body: OTP_TEXT, at: 0 }, rt.secret, 'salon.test', OTP_TTL), OTP_LATE_TEXT);
  assert.equal(fillOtp({ id: m.id, body: OTP_TEXT, at: 0 }, rt.secret, 'salon.test', OTP_TTL - 1), sent[0].body);
  // the journal (chained data and pii) never holds the digits; the actor names nobody
  const stored = (await t.store.read(0)).events;
  assert.ok(!JSON.stringify(stored).includes(code), 'the code is not in the journal');
  const q = stored.find((e) => e.type === 'message.queued' && e.data.id === m.id);
  assert.deepEqual(q.actor, CLIENT_ACTOR);
  assert.equal(q.pii.body, OTP_TEXT);
  assert.ok(!JSON.stringify(q.data).includes(yanis.e164.slice(3)));

  // the first opening asks the first name; the right code stays good meanwhile
  const ask = await b.post('/api/public/account/verify', { phone: yanis.phone, code });
  assert.equal(ask.status, 200);
  assert.deepEqual({ ok: ask.json.ok, ask: ask.json.ask }, { ok: false, ask: 'first' });
  assert.equal(b.jar.has(CLIENT_COOKIE), false);
  const ok = await b.post('/api/public/account/verify', { phone: '+33 ' + yanis.e164.slice(3), code, first: 'yanis' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json, { ok: true, first: 'Yanis' });
  const set = ok.headers.getSetCookie().find((c) => c.startsWith(CLIENT_COOKIE + '='));
  assert.ok(set, 'lx_c is set');
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=' + 180 * 86400]) assert.ok(set.includes(attr), attr + ' in ' + set);
  const me = await b.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.first, 'Yanis');
  assert.equal(me.json.phone, '07 •• •• •• ' + yanis.e164.slice(-2));
  assert.equal(me.json.fenced, false);
  assert.equal(me.json.named, true);
  assert.equal((await b.get('/api/public/account')).json.signedIn, true);
  const signed = events(rt, 'account.signedIn');
  assert.equal(signed.length, 1);
  assert.deepEqual(signed[0].data, { id: yanis.id, cid: yanis.id, msgId: m.id, fenced: false, named: true, opened: true });
  assert.equal(signed[0].pii, undefined);
  // a code works once
  const again = await browser(rt).post('/api/public/account/verify', { phone: yanis.phone, code });
  assert.equal(again.status, 400);
  assert.equal(again.json.error.code, 'bad_code');
  assert.equal(again.json.error.message, 'Code incorrect ou expiré. Redemande-en un.');
  assert.ok(rt.engine.state.otpUsed.has(m.id));
});

test('unknown, erased and merged-away numbers: the same answer, as slow, and nothing written; the 4th code of a day never leaves', async () => {
  const { t, rt, client, codes } = await setup();
  real();
  try {
    const b = browser(rt);
    const silent = async (phone) => {
      await rt.engine.sync(true);
      const v = rt.engine.state.version;
      const t0 = Date.now();
      const r = await b.post('/api/public/account/start', { phone });
      const ms = Date.now() - t0;
      await settled();
      assert.deepEqual({ status: r.status, json: r.json }, { status: 200, json: SAME }, phone);
      assert.ok(ms >= 450, phone + ' answered in ' + ms + ' ms');
      assert.equal(rt.engine.state.version, v, phone + ' wrote to the journal');
    };
    await silent(freshPhone().phone);
    const gone = await client();
    for (let i = 0; i < 3; i++) if ((await t.engine.run(eraseClient, { id: gone.id, cancelUpcoming: true }, ownerCtx(t))).erased) break;
    await silent(gone.phone);
    // a file merged into another one with its own number: the old number is not the client's any more
    const from = await client(), into = await client();
    await t.engine.run(mergeClients, { from: from.id, into: into.id }, ownerCtx(t));
    await silent(from.phone);
    // a known number, timed like the others
    const known = await client();
    const t0 = Date.now();
    assert.deepEqual((await b.post('/api/public/account/start', { phone: known.phone })).json, SAME);
    assert.ok(Date.now() - t0 >= 450);
    await settled();
    assert.equal(codes(known.id).length, 1);
  } finally { fast(); }
  // three a day, then the same words and no text
  const yanis = await client();
  const b = browser(rt);
  for (let i = 0; i < 4; i++) assert.deepEqual((await b.post('/api/public/account/start', { phone: yanis.phone })).json, SAME);
  await settled();
  assert.equal(codes(yanis.id).length, 3);
  // an invalid number is the only other answer (it says nothing about any file)
  const bad = await b.post('/api/public/account/start', { phone: '12' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.message, 'Vérifie ton numéro.');
});

test('the journal caps the codes of a file a day across two instances, with the other link texts', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: {} };
  const sent = [];
  for (let i = 0; i < 4; i++) sent.push(await (i % 2 ? other : t.engine).run(sendCode, { phone: '06 12 34 56 78' }, ctx));
  assert.deepEqual(sent.map((x) => x.sent), [true, true, true, false]);
  await t.engine.sync(true);
  assert.equal([...t.engine.state.messages.values()].filter((m) => m.template === 'otp').length, 3);
  // the next day the count starts again
  t.clock.now = at(addDays(DAY, 1), 10);
  assert.equal((await other.run(sendCode, { phone: '0612345678' }, ctx)).sent, true);
  // the space closed: nothing at all
  await t.engine.run(updateSettings, { accounts: { enabled: false } }, t.asOwner());
  assert.deepEqual(await t.engine.run(sendCode, { phone: '0612345678' }, ctx), { sent: false });
});

test('five wrong codes burn the file’s codes; a code is dead after 10 minutes', async () => {
  const { t, rt, client, codes, lastCode } = await setup();
  const yanis = await client();
  const b = browser(rt);
  await b.post('/api/public/account/start', { phone: yanis.phone });
  await settled();
  const right = lastCode(yanis.id);
  const wrong = right === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const r = await b.post('/api/public/account/verify', { phone: yanis.phone, code: wrong, first: 'Yanis' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'bad_code');
  }
  await settled();
  assert.equal(events(rt, 'account.codeMissed').length, 5, 'each wrong try against the live code is counted in the journal');
  const burned = events(rt, 'account.codeBurned');
  // the fifth miss already killed the code (OTP_TRIES): the burst finds nothing more to burn, or burns it once
  assert.ok(burned.length <= 1);
  assert.equal(liveCodes(rt.engine.state, yanis.id, t.clock.now).length, 0);
  const late = await b.post('/api/public/account/verify', { phone: yanis.phone, code: right, first: 'Yanis' });
  assert.equal(late.status, 429);
  assert.equal(late.json.error.message, 'Trop d’essais. Réessaie un peu plus tard ou appelle le salon.');
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: { otpCode: (id) => otpCode(rt.secret, id) } };
  assert.deepEqual(await rt.engine.run(verifyCode, { phone: yanis.phone, code: right, first: 'Yanis' }, ctx), { ok: false });

  // a fresh code, 11 minutes later: expired
  const ben = await client({ first: 'Ben' });
  await browser(rt).post('/api/public/account/start', { phone: ben.phone });
  await settled();
  t.clock.now += OTP_TTL + 60000;
  const r = await browser(rt).post('/api/public/account/verify', { phone: ben.phone, code: lastCode(ben.id), first: 'Ben' });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, 'bad_code');
  assert.equal(codes(ben.id).length, 1);
});

test('the burst burns every live code of the file in one write', async () => {
  const { rt, client, codes, lastCode } = await setup();
  const yanis = await client();
  const b = browser(rt);
  // two live codes: four wrong tries leave both alive (4 misses each), the fifth try burns them
  await b.post('/api/public/account/start', { phone: yanis.phone });
  await b.post('/api/public/account/start', { phone: yanis.phone });
  await settled();
  assert.equal(codes(yanis.id).length, 2);
  const right = lastCode(yanis.id);
  const firstCode = otpCode(rt.secret, codes(yanis.id)[0].id);
  const wrong = ['000000', '111111', '222222'].find((x) => x !== right && x !== firstCode);
  for (let i = 0; i < 5; i++) assert.equal((await b.post('/api/public/account/verify', { phone: yanis.phone, code: wrong })).status, 400);
  await settled();
  const s = rt.engine.state;
  for (const m of codes(yanis.id)) assert.equal(missesOf(s, m.id).n, 5);
  assert.equal(liveCodes(s, yanis.id, rt.engine.clock()).length, 0);
});

test('wrong tries are counted in the journal: two instances on one store kill a code after five, between them', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  const ctx = { actor: CLIENT_ACTOR, caps: new Set(), meta: { otpCode: (id) => otpCode(SECRET, id) } };
  const { msgId } = await t.engine.run(sendCode, { phone: '0612345678' }, ctx);
  const right = otpCode(SECRET, msgId);
  const wrong = right === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.deepEqual(await (i % 2 ? other : t.engine).run(verifyCode, { phone: '0612345678', code: wrong, first: 'Yanis' }, ctx), { ok: false });
  await t.engine.sync(true);
  const misses = t.engine.journal.filter((e) => e.type === 'account.codeMissed').map((e) => e.data.id);
  assert.deepEqual(misses, [1, 2, 3, 4, 5].map((k) => 'acm_' + msgId + '_' + k), 'deterministic ids, one per try');
  for (const eng of [t.engine, other]) assert.deepEqual(await eng.run(verifyCode, { phone: '0612345678', code: right, first: 'Yanis' }, ctx), { ok: false });
  // no 6th miss is ever written against a dead code
  assert.equal(t.engine.journal.filter((e) => e.type === 'account.codeMissed').length, 5);
  // replay counts the same
  const s2 = emptyState();
  for (const e of t.engine.journal) evolve(s2, e);
  assert.equal(missesOf(s2, msgId).n, 5);
});

test('« Garde ton espace » after a guest booking: a code to that booking’s number, said where; a bad link is a 404', async () => {
  const { rt, codes, lastCode } = await setup();
  const site = browser(rt);
  const who = freshPhone();
  const book = await site.post('/api/public/bookings', { serviceIds: [[...rt.engine.state.services.values()][0].id], staffId: 'any', day: addDays(DAY, 2), start: 600, first: 'Karim', phone: who.phone });
  assert.equal(book.status, 201, book.text);
  // guest booking is untouched: no cookie of any kind
  assert.deepEqual(book.headers.getSetCookie(), []);
  const keep = await site.post('/api/public/account/keep', { token: book.json.token });
  assert.equal(keep.status, 200, keep.text);
  assert.deepEqual(keep.json, { ok: true, sentTo: '07 •• •• •• ' + who.e164.slice(-2) });
  const cid = rt.engine.state.clientByPhone.get(who.e164);
  const [m] = codes(cid);
  assert.equal(m.to, who.e164);
  // the booking created the file: its booker typed the first name already, so no question
  const v = await site.post('/api/public/account/verify', { token: book.json.token, code: lastCode(cid) });
  assert.equal(v.status, 200, v.text);
  assert.deepEqual(v.json, { ok: true, first: 'Karim' });
  assert.equal((await site.get('/api/me')).json.first, 'Karim');
  assert.equal((await site.post('/api/public/account/keep', { token: 'LA-NOPE.xxxxxxxxxxxxxxxxxxxxxx' })).status, 404);
  assert.equal((await site.post('/api/public/account/keep', {})).status, 404);
});

test('the salon’s « acc » invite: a code to the file’s number for 48 h, then the first name; expired, tampered or erased is a 404', async () => {
  const { t, rt, client, lastCode } = await setup();
  const y = await client({ first: 'Yanis' });
  const acc = (cid, ms = 48 * 3600000) => signLink(rt.secret, 'acc', cid + '~' + (t.clock.now + ms).toString(36));
  const b = browser(rt);
  const tok = acc(y.id);
  const keep = await b.post('/api/public/account/keep', { token: tok });
  assert.equal(keep.status, 200, keep.text);
  assert.deepEqual(keep.json, { ok: true, sentTo: '07 •• •• •• ' + y.e164.slice(-2) });
  // the link proves the phone, as a code does: the first opening still asks the first name
  const ask = await b.post('/api/public/account/verify', { token: tok, code: lastCode(y.id) });
  assert.deepEqual({ ok: ask.json.ok, ask: ask.json.ask }, { ok: false, ask: 'first' });
  const v = await b.post('/api/public/account/verify', { token: tok, code: lastCode(y.id), first: 'Yanis' });
  assert.equal(v.status, 200, v.text);
  assert.deepEqual(v.json, { ok: true, first: 'Yanis' });
  assert.equal((await b.get('/api/me')).json.first, 'Yanis');
  // dead links
  const nope = browser(rt);
  const expired = acc(y.id, -1000);
  assert.equal((await nope.post('/api/public/account/keep', { token: expired })).status, 404);
  assert.equal((await nope.post('/api/public/account/keep', { token: tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA') })).status, 404, 'tampered');
  assert.equal((await nope.post('/api/public/account/keep', { token: signLink(rt.secret, 'appt', y.id + '~' + (t.clock.now + 9e6).toString(36)) })).status, 404, 'another kind of link');
  const gone = await client();
  for (let i = 0; i < 3; i++) if ((await t.engine.run(eraseClient, { id: gone.id, cancelUpcoming: true }, ownerCtx(t))).erased) break;
  assert.equal((await nope.post('/api/public/account/keep', { token: acc(gone.id) })).status, 404, 'erased file');
  const ve = await nope.post('/api/public/account/verify', { token: expired, code: lastCode(y.id), first: 'Yanis' });
  assert.equal(ve.status, 400);
  assert.equal(ve.json.error.code, 'bad_code');
});

test('the session ends with « Déconnecter tous mes appareils », and a new sign-in works', async () => {
  const { t, rt, client, signIn, tickClock } = await setup();
  const yanis = await client();
  const phone = browser(rt), laptop = browser(rt);
  await signIn(phone, yanis);
  tickClock();
  // a second device, signed in before the revocation
  laptop.jar.set(CLIENT_COOKIE, phone.jar.get(CLIENT_COOKIE));
  tickClock();
  const out = await phone.post('/api/me/signout-all');
  assert.equal(out.status, 200);
  assert.equal(phone.jar.has(CLIENT_COOKIE), false, 'this phone is signed out');
  const old = await laptop.get('/api/me');
  assert.equal(old.status, 401);
  assert.equal(old.json.error.code, 'signed_out');
  assert.equal(old.json.error.message, 'Ton espace s’est fermé. Reconnecte-toi.');
  assert.equal(laptop.jar.has(CLIENT_COOKIE), false, 'a dead cookie is cleared');
  assert.deepEqual(events(rt, 'account.revoked').map((e) => e.data), [{ id: yanis.id, cid: yanis.id, by: 'client' }]);
  tickClock();
  await signIn(phone, yanis);
  assert.equal((await phone.get('/api/me')).status, 200);
  // signing out only clears this phone's cookie
  assert.equal((await phone.post('/api/me/signout')).status, 200);
  assert.equal((await phone.get('/api/me')).status, 401);
  assert.equal(events(rt, 'account.revoked').length, 1);
  void t;
});

test('the session ends when the salon changes or detaches the number, merges the file into another number, erases it, or the client closes his space', async () => {
  const { t, rt, client, signIn, tickClock, state } = await setup();
  const alive = async (b) => (await b.get('/api/me')).status;

  // the salon changes the number on the file
  const a = await client(); const ba = browser(rt);
  await signIn(ba, a);
  await t.engine.run(updateClient, { id: a.id, patch: { phone: freshPhone().phone } }, ownerCtx(t));
  assert.equal(await alive(ba), 401);

  // « Numéro réattribué ? Détacher ce numéro »: the number leaves the file, the next booker gets a fresh file
  const d = await client(); const bd = browser(rt);
  await signIn(bd, d);
  tickClock();
  assert.equal((await rt.engine.run(detachPhone, { id: d.id }, ownerCtx(t))).revoked, 1);
  assert.equal(await alive(bd), 401);
  assert.equal(state().clients.get(d.id).phone, '');
  assert.ok(state().clients.get(d.id).phoneDetachedAt);
  assert.equal(state().clientByPhone.get(d.e164), undefined);
  assert.deepEqual(events(rt, 'account.revoked').at(-1).data, { id: d.id, cid: d.id, by: 'salon', reason: 'phone' });
  const ali = t.asStaff('Ali');
  await assert.rejects(rt.engine.run(detachPhone, { id: a.id }, ali), { code: 'forbidden' }, 'detaching needs agenda.edit');

  // merged into a file with another number: out; into a file without one (it takes this number): still in
  const m1 = await client(), other = await client(); const bm1 = browser(rt);
  await signIn(bm1, m1);
  await t.engine.run(mergeClients, { from: m1.id, into: other.id }, ownerCtx(t));
  assert.equal(await alive(bm1), 401);
  const m2 = await client(); const bm2 = browser(rt);
  const bare = (await t.engine.run(addClient, { first: 'Yanis', last: 'Martin' }, ownerCtx(t))).id;
  await signIn(bm2, m2);
  await t.engine.run(mergeClients, { from: m2.id, into: bare }, ownerCtx(t));
  assert.equal(await alive(bm2), 200, 'same number after the merge: the session stays');
  assert.ok(accountOf(state(), [bare, m2.id]), 'the account follows the file through the merge');

  // erased: out, and its account row is gone
  const e = await client(); const be = browser(rt);
  await signIn(be, e);
  for (let i = 0; i < 3; i++) if ((await rt.engine.run(eraseClient, { id: e.id, cancelUpcoming: true }, ownerCtx(t))).erased) break;
  assert.equal(await alive(be), 401);
  assert.equal(state().accounts.has(e.id), false);
  assert.equal(state().accountPast.has(e.id), false);

  // « Supprimer mon espace »: the account goes, the file stays
  const c = await client(); const bc = browser(rt);
  await signIn(bc, c);
  const old = bc.jar.get(CLIENT_COOKIE);
  tickClock();
  assert.equal((await bc.post('/api/me/close')).status, 200);
  assert.equal(await alive(bc), 401);
  assert.equal(state().accounts.has(c.id), false);
  assert.equal(state().clients.get(c.id).erased, false);
  // opened again later: the cookie from before the closing stays dead
  tickClock();
  await signIn(bc, c);
  const stale = browser(rt);
  stale.jar.set(CLIENT_COOKIE, old);
  assert.equal(await alive(stale), 401);
  assert.equal(await alive(bc), 200);
});

test('a file inactive for 600 days opens fenced: nothing before today, a line for who sees the files', async () => {
  const { t, rt, signIn } = await setup();
  const old = addDays(DAY, -600);
  t.clock.now = at(old, 10);
  const who = freshPhone();
  const id = (await t.engine.run(addClient, { first: 'Yanis', phone: who.phone }, ownerCtx(t))).id;
  const a = await t.engine.run(A.createAppointment, { clientId: id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: old, start: 600 }, ownerCtx(t));
  t.clock.now = at(old, 10, 40);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, ownerCtx(t));
  t.clock.now = at(DAY, 10);
  const b = browser(rt);
  await signIn(b, { id, ...who });
  const [ev] = events(rt, 'account.signedIn');
  assert.equal(ev.data.fenced, true);
  assert.equal(ev.data.historyFrom, DAY);
  assert.equal(ev.data.named, true);
  const me = await b.get('/api/me');
  assert.deepEqual({ fenced: me.json.fenced, historyFrom: me.json.historyFrom }, { fenced: true, historyFrom: DAY });
  const hist = await b.get('/api/me/history');
  assert.deepEqual(hist.json, { items: [], more: false }, 'the previous holder’s visit stays hidden');
  const home = await b.get('/api/me/home');
  assert.equal(home.json.rhythm.visits, 0);
  assert.equal(home.json.rhythm.lastDay, null);
  // the feed line, for whoever may read the files (client.view), not for someone without it; a sign-in is not news
  const s = rt.engine.state;
  assert.equal(s.feed.filter((x) => x.type === 'account.signedIn').length, 0, 'sign-ins stay out of the feed');
  const f = s.feed.find((x) => x.type === 'account.fenceOpened');
  assert.ok(f, 'kept in the feed');
  const line = accountsExtension.item({ s, caps: new Set(['client.view']) }, f);
  assert.deepEqual(line, { v: f.v, at: f.at, by: 'client', kind: 'account', clientId: id, staffId: null, title: 'Espace ouvert sur une fiche inactive', sub: 'Yanis · vérifie que c’est la même personne' });
  assert.equal(accountsExtension.item({ s, caps: new Set(['agenda.own']) }, f), null);
  // a re-opening keeps the first fence (and writes no second feed line)
  await b.post('/api/me/signout');
  t.clock.now += 3600000;
  await signIn(b, { id, ...who });
  const again = events(rt, 'account.signedIn').at(-1);
  assert.equal(again.data.fenced, true);
  assert.equal(again.data.historyFrom, DAY);
  assert.equal(again.data.opened, undefined);
  assert.equal(events(rt, 'account.fenceOpened').length, 1, 'one feed line, at the opening');
});

test('a file not seen for 600 days stays fenced when its number books today: a booking is not a visit', async () => {
  const { t, rt } = await setup();
  const old = addDays(DAY, -600);
  t.clock.now = at(old, 10);
  const who = freshPhone();
  const id = (await t.engine.run(addClient, { first: 'Yanis', last: 'Martin', phone: who.phone, birthday: '12-03' }, ownerCtx(t))).id;
  const a = await t.engine.run(A.createAppointment, { clientId: id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: old, start: 600 }, ownerCtx(t));
  t.clock.now = at(old, 10, 40);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, ownerCtx(t));
  // a stale booking from long ago, never closed, proves nothing either
  await t.engine.run(A.createAppointment, { clientId: id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(old, 1), start: 600 }, ownerCtx(t));
  t.clock.now = at(DAY, 9);
  // the new holder of the number books for today on the site, with the same first name: it lands on the old file
  const site = browser(rt);
  const book = await site.post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: 'any', day: DAY, start: 960, first: 'Yanis', phone: who.phone });
  assert.equal(book.status, 201, book.text);
  assert.equal(rt.engine.state.appts.get(book.json.id || [...rt.engine.state.appts.values()].at(-1).id).clientId, id);
  assert.equal((await site.post('/api/public/account/keep', { token: book.json.token })).status, 200);
  const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === id).at(-1);
  const v = await site.post('/api/public/account/verify', { token: book.json.token, code: otpCode(rt.secret, m.id), first: 'Yanis' });
  assert.equal(v.status, 200, v.text);
  const row = accountOf(rt.engine.state, [id]);
  assert.deepEqual({ fenced: row.fenced, historyFrom: row.historyFrom, named: row.named }, { fenced: true, historyFrom: DAY, named: true });
  // fenced but named: the first name he gave, not the last name nor the birthday of a file that may be someone else's
  const me = (await site.get('/api/me')).json, home = (await site.get('/api/me/home')).json;
  assert.deepEqual([me.first, me.last], ['Yanis', '']);
  assert.deepEqual([home.first, home.last, home.birthday], ['Yanis', '', '']);
  assert.deepEqual((await site.get('/api/me/history')).json.items, []);
});

test('a recycled number after 120 days: three wrong first names open the space fenced and unnamed, and it says nothing of the file', async () => {
  const { t, rt } = await setup();
  const old = addDays(DAY, -120);
  t.clock.now = at(old, 10);
  const who = freshPhone();
  const id = (await t.engine.run(addClient, { first: 'Mehdi', last: 'Benali', birthday: '04-02', phone: who.phone, marketing: true }, ownerCtx(t))).id;
  t.clock.now = at(DAY, 10);
  const b = browser(rt);
  await b.post('/api/public/account/start', { phone: who.phone });
  await settled();
  const m = [...rt.engine.state.messages.values()].find((x) => x.template === 'otp' && x.cid === id);
  const code = otpCode(rt.secret, m.id);
  for (const first of ['Karim', 'Sofiane']) {
    const r = await b.post('/api/public/account/verify', { phone: who.phone, code, first });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: false, ask: 'first', message: 'Ce n’est pas le prénom de la fiche. Réessaie.' });
  }
  assert.equal(events(rt, 'account.signedIn').length, 0);
  const third = await b.post('/api/public/account/verify', { phone: who.phone, code, first: 'Nordine' });
  assert.equal(third.status, 200, third.text);
  assert.deepEqual(third.json, { ok: true, first: '' }, 'not even the name he could not give');
  const row = accountOf(rt.engine.state, [id]);
  assert.equal(row.fenced, true);
  assert.equal(row.named, false, 'AC-02 refuses the export and the erasure request: !fenced && named');
  assert.equal(row.historyFrom, DAY);
  // nothing of the previous holder: no first or last name, no birthday, not when he said yes to offers
  const seen = JSON.stringify([(await b.get('/api/me')).json, (await b.get('/api/me/home')).json, (await b.get('/api/public/account')).json]);
  for (const x of ['Mehdi', 'Benali', '04-02']) assert.ok(!seen.includes(x), x + ' in ' + seen);
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual([home.first, home.last, home.birthday, home.consent.marketingAt], ['', '', '', null]);
  assert.equal((await b.get('/api/public/account')).json.first, '');
  // the same file named right at the first opening would not be fenced at 120 days
  assert.equal(sameFirst('mehdi', 'Mehdi'), true);
  assert.equal(sameFirst('Jean', 'Jean-Pierre'), true);
  assert.equal(sameFirst('Élodie', 'elodie'), true);
  assert.equal(sameFirst('Jean-Pierre', 'Jean'), true);
  assert.equal(sameFirst('Alex', 'Alexandre'), true, 'shortened from 4 letters');
  assert.equal(sameFirst('Je', 'Jean'), false);
  assert.equal(sameFirst('Meh', 'Mehdi'), false, 'three letters do not sweep a name');
  assert.equal(sameFirst('Mar', 'Marc'), false);
  assert.equal(sameFirst('Mo', 'Mo'), true, 'or the whole of a short name');
  assert.equal(sameFirst('Karim', 'Mehdi'), false);
  assert.equal(sameFirst('أحمد', 'أحمد'), true, 'any script');
  assert.equal(sameFirst('ахмед', 'Ахмед'), true);
  assert.equal(sameFirst('Ахмед', 'Мехди'), false);
});

test('wrong first names count over days: two one day, one the next, and the space opens fenced and unnamed', async () => {
  const { t, rt } = await setup();
  t.clock.now = at(addDays(DAY, -30), 10);
  const who = freshPhone();
  const id = (await t.engine.run(addClient, { first: 'Mehdi', last: 'Benali', phone: who.phone }, ownerCtx(t))).id;
  t.clock.now = at(DAY, 10);
  const b = browser(rt);
  const ask = async (first) => {
    await b.post('/api/public/account/start', { phone: who.phone });
    await settled();
    const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === id).at(-1);
    return b.post('/api/public/account/verify', { phone: who.phone, code: otpCode(rt.secret, m.id), first });
  };
  const WRONG = { ok: false, ask: 'first', message: 'Ce n’est pas le prénom de la fiche. Réessaie.' };
  for (const first of ['Karim', 'Sofiane']) assert.deepEqual((await ask(first)).json, WRONG, first);
  // the next day: the count goes on
  t.clock.now = at(addDays(DAY, 1), 10);
  const third = await ask('Nordine');
  assert.deepEqual(third.json, { ok: true, first: '' });
  const row = accountOf(rt.engine.state, [id]);
  assert.deepEqual({ fenced: row.fenced, named: row.named, historyFrom: row.historyFrom }, { fenced: true, named: false, historyFrom: addDays(DAY, 1) });
  assert.equal(rt.engine.state.nameMisses.get(id), undefined, 'the opening clears the count');
  // the right name later changes nothing: the space keeps its first fence
  await b.post('/api/me/signout');
  t.clock.now += 3600000;
  // (a code queued straight: this process already let the number ask three times today)
  const { msgId } = await rt.engine.run(sendCode, { phone: who.phone }, { actor: CLIENT_ACTOR, caps: new Set(), meta: {} });
  const v = await b.post('/api/public/account/verify', { phone: who.phone, code: otpCode(rt.secret, msgId), first: 'Mehdi' });
  assert.deepEqual(v.json, { ok: true, first: '' });
  assert.equal(accountOf(rt.engine.state, [id]).named, false);
});

test('a space unused for longer than the fence, on a file not seen since: the question comes back and the fence starts again', async () => {
  const { t, rt, signIn } = await setup();
  const old = addDays(DAY, -600);
  t.clock.now = at(old, 10);
  const who = freshPhone();
  const id = (await t.engine.run(addClient, { first: 'Yanis', last: 'Martin', birthday: '12-03', phone: who.phone }, ownerCtx(t))).id;
  const a = await t.engine.run(A.createAppointment, { clientId: id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: old, start: 600 }, ownerCtx(t));
  t.clock.now = at(old, 10, 40);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, ownerCtx(t));
  // Yanis opens his space the day after his visit: named, not fenced
  t.clock.now = at(addDays(old, 1), 10);
  await signIn(browser(rt), { id, ...who });
  assert.equal(accountOf(rt.engine.state, [id]).fenced, false);
  // 600 days later someone else holds the number: the code alone is not enough
  t.clock.now = at(DAY, 10);
  const b = browser(rt);
  await b.post('/api/public/account/start', { phone: who.phone });
  await settled();
  const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === id).at(-1);
  const code = otpCode(rt.secret, m.id);
  const r0 = await b.post('/api/public/account/verify', { phone: who.phone, code });
  assert.deepEqual({ ok: r0.json.ok, ask: r0.json.ask }, { ok: false, ask: 'first' });
  for (const first of ['Karim', 'Sofiane']) assert.equal((await b.post('/api/public/account/verify', { phone: who.phone, code, first })).json.message, 'Ce n’est pas le prénom de la fiche. Réessaie.');
  const r3 = await b.post('/api/public/account/verify', { phone: who.phone, code, first: 'Nordine' });
  assert.deepEqual(r3.json, { ok: true, first: '' });
  const row = accountOf(rt.engine.state, [id]);
  assert.deepEqual({ fenced: row.fenced, named: row.named, historyFrom: row.historyFrom }, { fenced: true, named: false, historyFrom: DAY });
  const ev = events(rt, 'account.signedIn').at(-1);
  assert.equal(ev.data.refenced, true);
  assert.equal(events(rt, 'account.fenceOpened').length, 1);
  const seen = JSON.stringify([(await b.get('/api/me')).json, (await b.get('/api/me/home')).json, (await b.get('/api/me/history')).json]);
  for (const x of ['Yanis', 'Martin', '12-03', 'Coupe']) assert.ok(!seen.includes(x), x + ' in ' + seen);
  // replay folds the same
  const s2 = emptyState();
  for (const e of rt.engine.journal) evolve(s2, e);
  assert.deepEqual(accountOf(s2, [id]), accountOf(rt.engine.state, [id]));
});

test('a file brought from WordPress and never seen here opens fenced', async () => {
  const { t, rt, client, signIn } = await setup();
  const w = await client();
  await t.engine.run({ run: (s, i, ctx) => { ctx.emit('client.updated', { id: w.id, cid: w.id, patch: { source: 'wordpress', marketingSrc: 'wordpress' }, fields: [] }); return {}; } }, {}, t.sys);
  await signIn(browser(rt), w);
  assert.equal(accountOf(rt.engine.state, [w.id]).fenced, true);
});

test('the first opening on a file with an e-mail tells that address once', async () => {
  const { t, rt, client, signIn, tickClock } = await setup();
  await t.engine.run(updateSettings, { shop: { phone: '04 91 00 00 00' } }, t.asOwner());
  const y = await client({ email: 'yanis.m@exemple.fr' });
  const b = browser(rt);
  await signIn(b, y);
  const mails = () => [...rt.engine.state.messages.values()].filter((m) => m.template === 'accountOpened');
  assert.equal(mails().length, 1);
  const [m] = mails();
  assert.equal(m.channel, 'email');
  assert.equal(m.to, 'yanis.m@exemple.fr');
  assert.equal(m.mail.subject, 'Ton espace L’Architecte est ouvert');
  assert.equal(m.body, 'Ton espace vient d’être ouvert avec le numéro 07 •• •• •• ' + y.e164.slice(-2) + '. Si c’est toi, rien à faire. Sinon, appelle le salon au 04 91 00 00 00.');
  await b.post('/api/me/signout');
  tickClock();
  await signIn(b, y);
  assert.equal(mails().length, 1, 'a second sign-in tells nobody');
});

test('erasing the file blanks its codes’ texts; the chain still verifies', async () => {
  const { t, rt, client, signIn } = await setup();
  const y = await client();
  await signIn(browser(rt), y);
  for (let i = 0; i < 3; i++) if ((await rt.engine.run(eraseClient, { id: y.id, cancelUpcoming: true }, ownerCtx(t))).erased) break;
  const stored = (await t.store.read(0)).events;
  const q = stored.filter((e) => e.type === 'message.queued' && e.data.template === 'otp' && e.data.cid === y.id);
  assert.equal(q.length, 1);
  assert.equal(q[0].pii, undefined, 'the number and the text are gone');
  assert.equal(rt.engine.state.messages.get(q[0].data.id).to, '');
  assert.equal(verifyChain(stored).ok, true);
  // the account events name the file only, so a replay after the erasure has no account left for it
  const s2 = emptyState();
  for (const e of stored) evolve(s2, e);
  assert.equal(s2.accounts.size, 0);
});

test('runAs: one key per command of a request, none without the header, and never a ctx built by hand', async () => {
  const { t, rt } = await setup();
  const note = { run: (s, input, ctx) => { ctx.emit('demo.seeded', { days: [] }); return { n: input.n, cid: ctx.meta.me.cid, actor: ctx.actor }; } };
  const req = (h = {}) => ({ req: new Request('https://salon.test/api/me/x', { headers: h }), rt, meta: { siteUrl: 'https://salon.test/' } });
  const before = rt.engine.state.version;
  const r1 = req({ 'x-request-id': 'abcdefgh-1234' });
  const run = runAs(r1, { cid: t.ids.yanis });
  const [a, b] = [await run(note, { n: 1 }), await run(note, { n: 2 })];
  assert.deepEqual([a.n, b.n], [1, 2], 'two commands, two results');
  assert.deepEqual(a.actor, CLIENT_ACTOR);
  assert.equal(a.cid, t.ids.yanis);
  assert.equal(rt.engine.state.version, before + 2);
  // the same request retried: the same answers, nothing more written
  const again = runAs(req({ 'x-request-id': 'abcdefgh-1234' }), { cid: t.ids.yanis });
  assert.equal((await again(note, { n: 9 })).n, 1);
  assert.equal(rt.engine.state.version, before + 2);
  // another client sending the same header writes his own
  const other = (await t.engine.run(addClient, { first: 'Ben', phone: freshPhone().phone }, ownerCtx(t))).id;
  assert.equal((await runAs(req({ 'x-request-id': 'abcdefgh-1234' }), { cid: other })(note, { n: 3 })).n, 3);
  // without the header, every request writes
  const v = rt.engine.state.version;
  await runAs(req(), { cid: t.ids.yanis })(note, { n: 4 });
  await runAs(req(), { cid: t.ids.yanis })(note, { n: 4 });
  assert.equal(rt.engine.state.version, v + 2);
  assert.equal(isPersona({ persona: false }), false);
});

test('every /api/me route is closed without the client cookie, and a staff session does not open it', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const staff = browser(rt);
  assert.equal((await staff.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  for (const b of [browser(rt), staff]) {
    for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/me/home'], ['GET', '/api/me/history'], ['POST', '/api/me/signout-all'], ['POST', '/api/me/close']]) {
      const r = await b.raw(m, p, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 401, m + ' ' + p);
      assert.equal(r.json.error.code, 'signed_out');
    }
  }
  // the staff routes and their capabilities
  const app = router();
  meRoutes(app);
  const cap = (m, p) => /** @type {any} */ (app.match(m, p)).route.opt.cap;
  assert.equal(cap('GET', '/api/v1/clients/x/account'), 'client.view');
  assert.equal(cap('POST', '/api/v1/clients/x/account/revoke'), 'client.edit');
  assert.equal(cap('POST', '/api/v1/clients/x/detach-phone'), 'agenda.edit');
  assert.equal(cap('GET', '/api/v1/accounts/stats'), 'report.shop');
  assert.equal((await browser(rt).get('/api/v1/clients/x/account')).status, 401);
});

test('the setting: off by default, golive says what it waits for', () => {
  assert.deepEqual(accountsSection.defaults(), { enabled: false, sessionDays: 180, fenceDays: 180 });
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: { enabled: false } } }), { on: false, blocker: 'S’ouvre quand le SMS est testé et la bascule faite' });
  assert.deepEqual(accountsSection.golive.state({ settings: { accounts: { enabled: true } } }), { on: true, blocker: '' });
});

test('the space closed: every entry point says so and nothing opens', async () => {
  const { rt } = await setup({ enabled: false });
  const b = browser(rt);
  assert.deepEqual((await b.get('/api/public/account')).json, { enabled: false, signedIn: false, demo: false });
  for (const p of ['/api/public/account/start', '/api/public/account/keep', '/api/public/account/verify']) assert.equal((await b.post(p, { phone: '0612345678' })).status, 409, p);
  assert.equal((await b.post('/api/public/account/demo')).status, 404, 'no persona outside the demo');
});

test('the lookup text says where to find everything while the space is open', async () => {
  const { t, rt, client } = await setup();
  const y = await client();
  await t.engine.run(A.createAppointment, { clientId: y.id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, ownerCtx(t));
  const app = router();
  const pending = [];
  clientRoutes(app, { minMs: 0, jitterMs: 0, later: (p) => { pending.push(p); } });
  const m = /** @type {any} */ (app.match('POST', '/api/public/lookup'));
  const r = { rt, body: { phone: y.phone }, ip: '10.9.9.9', params: {}, origin: 'https://salon.test', meta: { linkFor: (a) => 'https://salon.test/r/' + signLink(rt.secret, 'appt', a.code), siteUrl: 'https://salon.test/' }, get s() { return rt.engine.state; } };
  await m.route.fn(r);
  await Promise.all(pending);
  const text = [...rt.engine.state.messages.values()].find((x) => x.template === 'lookup' && x.cid === y.id);
  assert.ok(text.body.endsWith(' Ton espace : salon.test/moi'), text.body);
  // with the salon's real address the text for one booking is still one SMS
  assert.ok(text.body.replaceAll('salon.test', 'barberlarchitecte.com').length <= 160, text.body);
});

/* ---------------- the demo ---------------- */

describeDemo();
function describeDemo() {
  const clock = { now: at(DAY, 11) };
  let rt;
  before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

  test('demo: « Essayer avec un client de démo » signs in as the persona; its writes change nothing for the next visitor', async () => {
    const b = browser(rt);
    const r = await b.post('/api/public/account/demo');
    assert.equal(r.status, 200, r.text);
    const persona = personaOf(rt.engine.state, clock.now);
    assert.ok(persona, 'a seeded regular with a booking to come');
    assert.equal(persona.source, 'salon');
    assert.deepEqual(r.json, { ok: true, first: persona.first });
    const me = await b.get('/api/me');
    assert.equal(me.json.first, persona.first);
    assert.equal(me.json.demo, true);
    const home = await b.get('/api/me/home');
    assert.equal(home.status, 200);
    assert.ok(home.json.upcoming.length >= 1);
    assert.equal(home.json.demo, true);
    assert.ok(home.json.rhythm.dueDay, 'a regular has a due day');
    assert.equal((await b.get('/api/public/account')).json.demo, true);
    // a second visitor: no second opening written
    const v = events(rt, 'account.signedIn').length;
    assert.equal((await browser(rt).post('/api/public/account/demo')).status, 200);
    assert.equal(events(rt, 'account.signedIn').length, v);
    // signing out everywhere or closing the space: ok, and nothing written
    const w = rt.engine.journal.length;
    clock.now += 1000;
    assert.equal((await b.post('/api/me/signout-all')).status, 200);
    const c = browser(rt);
    await c.post('/api/public/account/demo');
    assert.equal((await c.post('/api/me/close')).status, 200);
    assert.equal(events(rt, 'account.revoked').length + events(rt, 'account.closed').length, 0);
    assert.ok(rt.engine.journal.slice(w).every((e) => !e.type.startsWith('account.')));
    assert.ok(accountOf(rt.engine.state, [persona.id]), 'the persona’s space is still there for the next visitor');
    // staff: the owner sees the account on the file; a barber may not detach a number nor read the salon's figures
    const owner = browser(rt);
    assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
    const acc = await owner.get('/api/v1/clients/' + persona.id + '/account');
    assert.equal(acc.status, 200);
    assert.equal(acc.json.has, true);
    assert.equal(acc.json.fenced, false);
    const stats = await owner.get('/api/v1/accounts/stats');
    assert.equal(stats.status, 200);
    assert.ok(stats.json.accounts >= 1 && stats.json.active30 >= 1 && stats.json.opened30 >= 1);
    const ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
    assert.equal((await owner.post('/api/auth/device', { name: 'Tablette' })).status, 200);
    await owner.post('/api/auth/logout');
    assert.equal((await owner.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
    assert.equal(capsOf(rt.engine.state.staff.get(ids.JKut), rt.engine.state.settings).has('agenda.edit'), false);
    assert.equal((await owner.post('/api/v1/clients/' + persona.id + '/detach-phone')).status, 403);
    assert.equal((await owner.get('/api/v1/accounts/stats')).status, 403);
    assert.equal((await owner.get('/api/v1/clients/' + persona.id + '/account')).status, 200, 'barbers see the files');
    // someone whose role does not hold client.view: no account to read (the route's capability, on a real session)
    const role = (x) => rt.engine.run({ run: (s, i, ctx) => { ctx.emit('staff.updated', { id: ids.JKut, patch: { role: x } }); return {}; } }, {}, { actor: { t: 'system', id: 'test', n: '' }, caps: new Set(), meta: {} });
    await role('stagiaire');
    try {
      assert.equal(capsOf(rt.engine.state.staff.get(ids.JKut), rt.engine.state.settings).has('client.view'), false);
      assert.equal((await owner.get('/api/v1/clients/' + persona.id + '/account')).status, 403);
    } finally { await role('barber'); }
    assert.equal((await owner.get('/api/v1/clients/' + persona.id + '/account')).status, 200);
  });

  test('demo: a code is shown for the persona’s number only, and for a visitor’s own fresh booking', async () => {
    const persona = personaOf(rt.engine.state, clock.now);
    const b = browser(rt);
    const p = await b.post('/api/public/account/start', { phone: persona.phone });
    assert.equal(p.status, 200);
    assert.match(p.json.demoCode, /^\d{6}$/);
    // no « Ton prénom ? » for the showcase (a visitor cannot know it), never fenced, and its cookie is the persona's
    const w0 = rt.engine.journal.length;
    const v = await b.post('/api/public/account/verify', { phone: persona.phone, code: p.json.demoCode });
    assert.equal(v.status, 200, v.text);
    assert.deepEqual(v.json, { ok: true, first: persona.first });
    assert.equal((await b.get('/api/me')).json.demo, true);
    assert.ok(rt.engine.journal.slice(w0).every((e) => !e.type.startsWith('account.')), 'a re-opening of the persona writes nothing');
    for (const first of ['Marc', 'Paul', 'Jean']) {
      const again = await browser(rt).post('/api/public/account/start', { phone: persona.phone });
      assert.equal(again.json.demoCode, p.json.demoCode, 'the live code is shared, past the daily caps');
      assert.equal((await browser(rt).post('/api/public/account/verify', { phone: persona.phone, code: again.json.demoCode, first })).status, 200);
    }
    const row = accountOf(rt.engine.state, [persona.id]);
    assert.deepEqual({ fenced: row.fenced, named: row.named }, { fenced: false, named: true });
    assert.equal(events(rt, 'account.fenceOpened').length, 0);
    // any other number: the same words, no code (a visitor's real number typed by another opens nothing)
    const seeded = [...rt.engine.state.clients.values()].find((c) => c.phone && c.id !== persona.id && !c.erased && !c.mergedInto);
    for (const phone of [seeded.phone, freshPhone().phone]) {
      const r = await browser(rt).post('/api/public/account/start', { phone });
      assert.deepEqual(r.json, SAME);
    }
    await settled();
    // a visitor books with his own number: « Garde ton espace » hands him the code
    const site = browser(rt);
    const who = freshPhone();
    const sv = [...rt.engine.state.services.values()].find((x) => x.active && x.online !== false && !x.pack && x.dur === 30);
    let book;
    for (let i = 0; i < 40 && !(book && book.status === 201); i++) {
      book = await browser(rt).post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day: addDays(DAY, 3 + Math.floor(i / 8)), start: 600 + (i % 8) * 30, first: 'Visiteur', phone: who.phone });
    }
    assert.equal(book.status, 201, book.text);
    const keep = await site.post('/api/public/account/keep', { token: book.json.token });
    assert.match(keep.json.demoCode, /^\d{6}$/);
    assert.equal((await site.post('/api/public/account/verify', { token: book.json.token, code: keep.json.demoCode })).status, 200);
    assert.equal((await site.get('/api/me')).json.demo, false, 'a visitor’s own space is not the persona');
    // a booking on a seeded number: no code handed back
    const other = browser(rt);
    let b2;
    for (let i = 0; i < 40 && !(b2 && b2.status === 201); i++) {
      b2 = await browser(rt).post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day: addDays(DAY, 6 + Math.floor(i / 8)), start: 600 + (i % 8) * 30, first: seeded.first, phone: seeded.phone });
    }
    assert.equal(b2.status, 201, b2.text);
    const k2 = await other.post('/api/public/account/keep', { token: b2.json.token });
    assert.equal(k2.status, 200);
    assert.equal(k2.json.demoCode, undefined);
  });

  test('demo: a visitor’s file is erased two hours after it was made, its booking cancelled and its space gone', async () => {
    const s = rt.engine.state;
    const visitors = [...s.clients.values()].filter((c) => c.source === 'site' && !c.erased);
    assert.ok(visitors.length >= 1);
    const v = visitors[0];
    assert.ok(accountOf(s, [v.id]), 'he opened his space');
    clock.now += 2 * 3600000 + 60000;
    await rt.engine.run(tick, {}, { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set(), meta: {} });
    const after = rt.engine.state;
    assert.equal(after.clients.get(v.id).erased, true);
    assert.equal(accountOf(after, [v.id]), null);
    for (const a of after.appts.values()) if (a.clientId === v.id) assert.equal(a.status, 'cancelled');
    // the seeded files stay
    assert.ok([...after.clients.values()].filter((c) => c.source === 'salon' && !c.erased).length > 400);
    assert.equal(verifyChain(rt.engine.journal).ok, true);
  });
}
