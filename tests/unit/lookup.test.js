// "Mon rendez-vous" without an account: a phone number in, the links of the next appointments out by SMS to that number,
// and the same answer whoever asks (known, unknown, erased, over the limit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { addClient, eraseClient, mergeClients } from '../../server/commands/clients.js';
import { lookupAppointments, LOOKUP_PER_DAY } from '../../server/commands/lookup.js';
import { clientRoutes, LOOKUP_MESSAGE } from '../../server/http/routes-client.js';
import { router, errorResponse } from '../../server/http/kit.js';
import { createRuntime } from '../../server/http/runtime.js';
import { signLink, checkLink } from '../../server/auth/session.js';
import { verifyChain } from '../../server/core/journal.js';
import { TEMPLATES } from '../../server/core/templates.js';

const ORIGIN = 'https://salon.test';
const SAME = { ok: true, message: LOOKUP_MESSAGE };
let clients = 0;

/** The route on its own router (app.js wires it too), with the request the way app.js builds it. */
async function setup({ wait } = {}) {
  const t = await salon();
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const app = router();
  // the work runs after the answer (waitUntil in production): the tests time the answer, then wait for the work
  const pending = [];
  clientRoutes(app, { ...(wait ? {} : { minMs: 0, jitterMs: 0 }), later: (p) => { pending.push(p); } });
  let n = 0;
  const post = async (body, ip = '10.4.0.' + (++n % 250)) => {
    const m = /** @type {any} */ (app.match('POST', '/api/public/lookup'));
    await rt.engine.sync(true);
    const r = {
      rt, body, ip, params: {}, origin: ORIGIN,
      meta: { linkFor: (a) => ORIGIN + '/r/' + signLink(rt.secret, 'appt', a.code), siteUrl: ORIGIN + '/', ip },
      get s() { return rt.engine.state; }, get now() { return rt.engine.clock(); }
    };
    const t0 = Date.now();
    let out;
    try { out = { status: 200, json: await m.route.fn(r) }; } catch (e) { const res = errorResponse(e); out = { status: res.status, json: await res.json() }; }
    const ms = Date.now() - t0;
    await Promise.all(pending.splice(0));
    return { ...out, ms };
  };
  const book = (clientId, day, start, staff = 'Ali') => rt.engine.run(A.createAppointment, { clientId, serviceIds: [t.ids.cut], staffId: t.ids[staff], day, start }, t.asOwner());
  const lookups = () => [...rt.engine.state.messages.values()].filter((m) => m.template === 'lookup');
  // the per-number limit lives in this process's memory, shared by every test: each test has its own client
  const digits = '06' + String(10000000 + ++clients * 7919).slice(-8);
  const phone = digits.replace(/(\d{2})(?=\d)/g, '$1 ');
  const me = (await rt.engine.run(addClient, { first: 'Yanis', last: 'Martin', phone }, t.asOwner())).id;
  return { t, rt, post, book, lookups, me, phone, e164: '+33' + digits.slice(1) };
}

test('a known number with two appointments to come gets one SMS with both links, soonest first', async () => {
  const { t, rt, post, book, lookups, me, phone, e164 } = await setup();
  // one in the past, one cancelled, three to come: only the next two are sent
  t.clock.now = at(addDays(DAY, -7), 9);
  await book(me, addDays(DAY, -7), 600);
  t.clock.now = at(DAY, 10);
  const gone = await book(me, addDays(DAY, 1), 600);
  await rt.engine.run(A.cancelAppointment, { id: gone.id, reason: 'test' }, t.asOwner());
  const third = await book(me, addDays(DAY, 9), 660);
  const first = await book(me, addDays(DAY, 2), 840, 'Ben');
  const second = await book(me, addDays(DAY, 4), 600);

  const res = await post({ phone });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, SAME);
  const sent = lookups();
  assert.equal(sent.length, 1);
  const [m] = sent;
  assert.equal(m.to, e164);
  assert.equal(m.cid, me);
  assert.equal(m.apptId, first.id);
  // the two signed links, for the two soonest appointments, in that order
  const links = [...m.body.matchAll(/https:\/\/salon\.test\/r\/(\S+)/g)].map((x) => x[1]);
  assert.equal(links.length, 2, m.body);
  const s = rt.engine.state;
  assert.deepEqual(links.map((tok) => checkLink(rt.secret, 'appt', tok)), [s.appts.get(first.id).code, s.appts.get(second.id).code]);
  assert.ok(!m.body.includes(s.appts.get(third.id).code));
  assert.match(m.body, /^L'Architecte : ton rendez-vous \S+ \d+ \S+ à 14 h : https:\/\/salon\.test\/r\/\S+ Puis \S+ \d+ \S+ à 10 h : https:\/\/salon\.test\/r\/\S+$/);
  // the number and the links travel as pii, never in the chained data or the actor
  const ev = (await t.store.read(0)).events.find((e) => e.type === 'message.queued' && e.data.id === m.id);
  assert.ok(ev);
  assert.ok(!JSON.stringify(ev.data).includes(e164.slice(3)) && !JSON.stringify(ev.data).includes('/r/'), JSON.stringify(ev.data));
  assert.deepEqual(ev.actor, { t: 'client', id: 'web', n: '' });
  assert.equal(ev.pii.to, e164);
});

test('one appointment to come: its link and nothing after it, whatever way the number is written', async () => {
  const { rt, post, book, lookups, me, e164 } = await setup();
  const a = await book(me, addDays(DAY, 3), 630);
  assert.deepEqual((await post({ phone: '+33 ' + e164.slice(3, 4) + ' ' + e164.slice(4) })).json, SAME);
  const [m] = lookups();
  const link = ORIGIN + '/r/' + signLink(rt.secret, 'appt', rt.engine.state.appts.get(a.id).code);
  assert.match(m.body, /^L'Architecte : ton rendez-vous \S+ \d+ \S+ à 10 h 30 : /);
  assert.ok(m.body.endsWith(' : ' + link), m.body);
  assert.ok(!m.body.includes('{suite}') && !m.body.includes('Puis'));
});

test('an unknown number, a client with nothing to come, and an erased client: the same answer, nothing written', async () => {
  const { t, rt, post, book, lookups, me, phone } = await setup();
  const silent = async (p) => {
    const v = rt.engine.state.version;
    const { status, json } = await post({ phone: p });
    assert.deepEqual({ status, json }, { status: 200, json: SAME });
    assert.equal(rt.engine.state.version, v, p + ' wrote to the journal');
  };
  await silent('07 98 76 54 32');
  // known to the salon, with only a past visit and a cancelled one
  t.clock.now = at(addDays(DAY, -3), 9);
  await book(me, addDays(DAY, -3), 600);
  t.clock.now = at(DAY, 10);
  const old = await book(me, addDays(DAY, 1), 600);
  await rt.engine.run(A.cancelAppointment, { id: old.id, reason: 'test' }, t.asOwner());
  await silent(phone);
  // an erased client's number finds nothing, even with an appointment still in the agenda
  const lea = (await rt.engine.run(addClient, { first: 'Léa', phone: '06 99 88 77 66' }, t.asOwner())).id;
  await book(lea, addDays(DAY, 2), 600);
  await rt.engine.run(eraseClient, { id: lea }, t.asOwner());
  await silent('06 99 88 77 66');
  assert.equal(lookups().length, 0);
});

test('the 4th ask of the day still answers the same, and sends nothing more', async () => {
  const { post, book, lookups, me, phone, e164 } = await setup();
  await book(me, addDays(DAY, 2), 600);
  for (let i = 0; i < 3; i++) assert.deepEqual((await post({ phone })).json, SAME);
  assert.equal(lookups().length, 3);
  // written differently, still the same number
  assert.deepEqual((await post({ phone: e164 })).json, SAME);
  assert.equal(lookups().length, 3);
});

test('the daily cap is kept in the journal too: a second server cannot send a 4th text that day', async () => {
  const { t, rt, book, lookups, me, phone } = await setup();
  await book(me, addDays(DAY, 2), 600);
  const ctx = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { linkFor: (a) => 'https://x/r/' + a.code } };
  const sent = [];
  for (let i = 0; i < LOOKUP_PER_DAY + 2; i++) sent.push((await rt.engine.run(lookupAppointments, { phone }, ctx)).sent);
  assert.deepEqual(sent, [true, true, true, false, false]);
  assert.equal(lookups().length, LOOKUP_PER_DAY);
  // the next day the count starts again
  t.clock.now = at(addDays(DAY, 1), 9);
  assert.equal((await rt.engine.run(lookupAppointments, { phone }, ctx)).sent, true);
});

test('an unpaid booking whose deposit time ran out is not sent; one still in time is', async () => {
  const { t, rt, lookups, phone } = await setup();
  // booked on the site: 60 € asks a deposit, so the slot is held until the deposit's deadline
  const a = await rt.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 600, first: 'Yanis', phone }, t.asClient);
  assert.equal(a.status, 'pending');
  const ctx = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: {} };
  assert.equal((await rt.engine.run(lookupAppointments, { phone }, ctx)).sent, true);
  t.clock.now += 20 * 60000;
  assert.equal((await rt.engine.run(lookupAppointments, { phone }, ctx)).sent, false);
  assert.equal(lookups().length, 1);
});

test('limits: 10 asks per device per hour, then a plain refusal; a number that is not one is refused', async () => {
  const { post } = await setup();
  for (let i = 0; i < 10; i++) assert.equal((await post({ phone: '07 00 00 00 ' + String(10 + i) }, '10.9.9.9')).status, 200);
  const r = await post({ phone: '07 00 00 00 99' }, '10.9.9.9');
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'slow_down');
  for (const phone of ['', '12', 'abc', '06 12 34']) assert.equal((await post({ phone })).status, 400, phone);
  assert.equal((await post({})).status, 400);
});

test('known or unknown, the answer takes about the same time, and never waits for the journal', async () => {
  const { rt, post, book, lookups, me, phone } = await setup({ wait: true });
  await book(me, addDays(DAY, 2), 600);
  const known = await post({ phone }), unknown = await post({ phone: '07 11 22 33 44' });
  assert.deepEqual(known.json, unknown.json);
  for (const x of [known, unknown]) assert.ok(x.ms >= 440 && x.ms < 1000, String(x.ms));
  assert.equal(lookups().length, 1);
  // a slow store (Blob over HTTP, a cold Postgres): the answer still leaves on time, and the text is still written
  const run = rt.engine.run.bind(rt.engine);
  rt.engine.run = async (...a) => { await new Promise((ok) => setTimeout(ok, 1500)); return run(...a); };
  const slow = await post({ phone });
  assert.ok(slow.ms >= 440 && slow.ms < 1000, String(slow.ms));
  assert.equal(lookups().length, 2);
});

test('a merged file: its old number gets nothing, the number on file gets the appointment that moved', async () => {
  const { t, rt, post, book, lookups, me, phone } = await setup();
  const old = (await rt.engine.run(addClient, { first: 'Yanis', phone: '06 55 44 33 22' }, t.asOwner())).id;
  const a = await book(old, addDays(DAY, 4), 600);
  await rt.engine.run(mergeClients, { from: old, into: me }, t.asOwner());
  const v = rt.engine.state.version;
  assert.deepEqual((await post({ phone: '06 55 44 33 22' })).json, SAME);
  assert.equal(rt.engine.state.version, v, 'the old number wrote to the journal');
  assert.deepEqual((await post({ phone })).json, SAME);
  const [m] = lookups();
  assert.equal(m.cid, me);
  assert.equal(m.apptId, a.id);
  assert.ok(m.body.includes(signLink(rt.secret, 'appt', rt.engine.state.appts.get(a.id).code)), m.body);
});

test('erasing the client blanks the text that was sent, and the journal still verifies', async () => {
  const { t, rt, post, book, lookups, me, phone } = await setup();
  await book(me, addDays(DAY, 2), 600);
  await post({ phone });
  assert.equal(lookups().length, 1);
  await rt.engine.run(eraseClient, { id: me }, t.asOwner());
  const [m] = lookups();
  assert.equal(m.to, '');
  assert.equal(m.body, '');
  const events = (await t.store.read(0)).events;
  assert.equal(verifyChain(events).ok, true);
  assert.ok(!events.some((e) => e.type === 'message.queued' && e.data.template === 'lookup' && e.pii && e.pii.to));
});

test('the texts are in the registry: lookup, and DO-03’s gift card code', () => {
  assert.equal(TEMPLATES.lookup, "L'Architecte : ton rendez-vous {date} à {heure} : {lien}{suite}");
  assert.equal(TEMPLATES.giftcardCode, "L'Architecte : {acheteur} t'offre une carte cadeau de {montant} ! Code {code}, valable jusqu'au {date}. Réserve : {lien}");
});
