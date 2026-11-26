// A real client's report, on the salon as it runs live, end to end over HTTP: production mode, everything by e-mail
// (settings.booking.contact 'email', the number optional), no SMS provider, an e-mail provider, the client space open
// (nothing stored: the default in e-mail mode), « annulable à tout moment » (cancelUntilHours 0), « au choix du client »
// (the code's default) with Stripe present. He booked a cut for a Saturday three weeks ahead, by e-mail. Then:
//   1. he wants the Friday before, 11 h 30: the booking's own link moves it (the same appointment, never a second one),
//      the old slot is free again, the confirmation leaves by e-mail, and nothing ever asks a number;
//   2. his space showed « Ta première coupe t'attend » while the site told him « Tu as déjà 3 rendez-vous à venir »:
//      a client who proves he reads the mailbox sees every booking to come made with that address, whatever the file's
//      age (a file brought from the old site opens « fenced »), the first name he gives, or the number of files the
//      salon holds for that address. What the fence protects stays hidden: the past, the name, the address itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at } from '../helpers.js';
import { browser } from './client.js';
import { addDays } from '../../shared/dates.js';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { updateSettings } from '../../server/commands/shop.js';
import { addClient, mergeClients } from '../../server/commands/clients.js';
import { createAppointment } from '../../server/commands/agenda.js';
import { checkout } from '../../server/commands/sales.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { accountOf } from '../../server/projections/accounts.js';
import { defaultSettings } from '../../server/settings/index.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const DAY = '2026-11-12'; // a Thursday: today
const SAT = '2026-12-05', FRI = '2026-12-04'; // the Saturday he booked (23 days ahead), the Friday he wants
let n = 0;
const freshMail = (who) => who + '.' + ++n + '.' + Math.random().toString(36).slice(2, 8) + '@exemple.fr';

/** The live salon's shape. Nothing about deposits nor about the client space is stored: the code's defaults decide. */
async function live() {
  const t = await salon({ day: DAY });
  await t.engine.run(updateSettings, { booking: { contact: 'email', cancelUntilHours: 0 } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, store: t.store, clock: () => t.clock.now });
  await rt.engine.sync(true);
  // Stripe is there, and none of this ever calls it (he pays at the salon)
  const stripeCalls = [];
  rt.pay = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x', fetchImpl: async (url) => { stripeCalls.push(String(url)); throw new Error('Stripe called: ' + url); } });
  const mails = [];
  rt.email = { name: 'test', send: async (m) => { mails.push(m); return { ref: 'm_' + mails.length }; } };
  assert.equal(rt.sms, null, 'no SMS provider');
  const s = () => rt.engine.state;
  const pub = (await browser(rt).get('/api/public/salon')).json;
  assert.deepEqual([pub.booking.contact, pub.sms, pub.payments.live, pub.deposits.mode, pub.booking.cancelUntilHours], ['email', false, true, 'choice', 0], 'the live salon');
  assert.equal(defaultSettings().deposits.mode, 'choice');
  /** the salon's own gestures (the Comptoir), on the same journal */
  const desk = (handler, input) => rt.engine.run(handler, input, t.asOwner());
  const codeFor = (email) => {
    const m = mails.filter((x) => x.to === email && x.tag === 'otp').at(-1);
    assert.ok(m, 'a code was mailed to ' + email);
    return /^(\d{6}) /.exec(m.subject)[1];
  };
  /** « Mon espace » on another phone: the address, the code from the mailbox, then each first name tried in turn */
  const signIn = async (email, firsts) => {
    const b = browser(rt);
    assert.equal((await b.post('/api/public/account/start', { email })).status, 200);
    await settled();
    const code = codeFor(email);
    let v = await b.post('/api/public/account/verify', { email, code });
    for (const first of [].concat(firsts)) { if (v.json && v.json.ok) break; v = await b.post('/api/public/account/verify', { email, code, first }); }
    return { b, v };
  };
  /** a booking from the site, as site.html sends it in e-mail mode: a first name and an address, no number */
  const book = (x) => browser(rt).post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: SAT, start: 600, ...x });
  const apptOf = (r) => s().appts.get(s().apptByCode.get(r.json.code));
  const slotsOf = async (day, extra = '') => ((await browser(rt).get(`/api/public/availability?services=${t.ids.cut}&staff=${t.ids.Ali}&from=${day}&days=1${extra}`)).json.days[0] || { slots: [] }).slots.map((x) => x.m);
  const texts = () => [...s().messages.values()].filter((m) => (m.channel || 'sms') === 'sms');
  return { ...t, rt, s, mails, desk, signIn, book, apptOf, slotsOf, texts, stripeCalls };
}

test('« Déplacer » by the link of his confirmation: the same appointment moves to the Friday, the Saturday is free again, the confirmation leaves by e-mail, no number anywhere', async () => {
  const t = await live();
  const email = freshMail('yacine');
  const booked = await t.book({ first: 'Yacine', email });
  assert.equal(booked.status, 201, booked.text);
  const appt = t.apptOf(booked);
  const file = t.s().clients.get(appt.clientId);
  assert.deepEqual([file.email, file.phone || '', appt.status], [email, '', 'booked']);
  // « Gérer mon rendez-vous » in his confirmation is the booking's own page
  const conf = [...t.s().messages.values()].find((m) => m.channel === 'email' && m.to === email && m.apptId === appt.id);
  assert.ok(conf && conf.mail.cta.label === 'Gérer mon rendez-vous' && conf.mail.cta.url.endsWith('/r/' + booked.json.token), 'the confirmation carries the booking’s page');

  // days later, his phone: the page says it can be moved, and that the salon writes by e-mail
  t.clock.now = at(addDays(DAY, 2), 18);
  const b = browser(t.rt);
  const page = (await b.get('/api/public/bookings/' + booked.json.token)).json;
  assert.deepEqual([page.day, page.start, page.canChange, page.contact], [SAT, 600, true, 'email']);
  // the Friday he wants is three weeks ahead: the page reads further than its first two weeks (« Jours suivants »)
  const first = (await b.get(`/api/public/availability?services=${t.ids.cut}&staff=${t.ids.Ali}&days=14&move=${booked.json.token}`)).json.days;
  assert.equal(first.length, 14);
  assert.ok(first.at(-1).day < FRI, 'the first two weeks stop before his Friday');
  const next = (await b.get(`/api/public/availability?services=${t.ids.cut}&staff=${t.ids.Ali}&from=${addDays(first.at(-1).day, 1)}&days=14&move=${booked.json.token}`)).json.days;
  const fri = next.find((d) => d.day === FRI), sat = next.find((d) => d.day === SAT);
  assert.ok(fri && fri.slots.some((x) => x.m === 690), 'Friday 11 h 30 is offered');
  assert.ok(sat && sat.slots.some((x) => x.m === 600), 'his own slot stays offered to him while he moves');
  assert.ok(!(await t.slotsOf(SAT)).includes(600), 'and to nobody else');

  // one tap on the hour: the day and the minute, nothing else (no number, no name)
  const before = { appts: t.s().appts.size, clients: t.s().clients.size, mails: [...t.s().messages.values()].filter((m) => m.channel === 'email' && m.to === email).length };
  const moved = await b.post('/api/public/bookings/' + booked.json.token + '/move', { day: FRI, start: 690 });
  assert.equal(moved.status, 200, moved.text);
  assert.deepEqual([moved.json.code, moved.json.day, moved.json.start, moved.json.status, moved.json.staff.id], [booked.json.code, FRI, 690, 'booked', t.ids.Ali]);
  // the SAME appointment: no second booking, no second file
  assert.equal(t.s().appts.size, before.appts);
  assert.equal(t.s().clients.size, before.clients);
  const now = t.s().appts.get(appt.id);
  assert.deepEqual([now.day, now.start, now.status, now.moves, now.clientId], [FRI, 690, 'booked', 1, file.id]);
  // the old slot is free for everyone, the new one is his
  assert.ok((await t.slotsOf(SAT)).includes(600), 'Saturday 10 h is free again');
  assert.ok(!(await t.slotsOf(FRI)).includes(690), 'Friday 11 h 30 is taken');
  // his confirmation of the move, by e-mail, with the same page; no text is ever queued
  const mine = [...t.s().messages.values()].filter((m) => m.channel === 'email' && m.to === email && m.apptId === appt.id);
  assert.equal(mine.length, before.mails + 1);
  const last = mine.at(-1);
  assert.match(last.mail.subject, /^Rendez-vous déplacé : vendredi 4 décembre à 11\sh\s30/);
  assert.match(last.body, /Ton rendez-vous est déplacé : vendredi 4 décembre à 11\sh\s30 avec Ali/);
  assert.ok(last.mail.cta.url.endsWith('/r/' + booked.json.token), 'the same page manages it');
  assert.equal(t.texts().length, 0, 'no text for a file without a number');
  assert.deepEqual(t.stripeCalls, [], 'nothing to pay online');

  // from his space too (the hero of /moi moves through the same link): the one appointment, where he put it
  const { b: me, v } = await t.signIn(email, 'Yacine');
  assert.deepEqual(v.json, { ok: true, first: 'Yacine' });
  const home = (await me.get('/api/me/home')).json;
  assert.deepEqual(home.upcoming.map((x) => [x.id, x.day, x.start, x.canChange]), [[appt.id, FRI, 690, true]]);
  const back = await me.post('/api/public/bookings/' + home.upcoming[0].token + '/move', { day: SAT, start: 630 });
  assert.equal(back.status, 200, back.text);
  assert.deepEqual((await me.get('/api/me/home')).json.upcoming.map((x) => [x.id, x.day, x.start]), [[appt.id, SAT, 630]]);
  assert.equal(t.s().appts.size, before.appts);
});

test('a file brought from the old site: his three bookings made with his address show in his space, the day after too; the fence still hides the past', async () => {
  const t = await live();
  const email = freshMail('mehdi');
  // the salon had him on file long before (the old site: a number and an address), with a visit back then
  t.clock.now = at(addDays(DAY, -400), 10);
  const old = await t.desk(addClient, { first: 'Mehdi', last: 'Benali', phone: '06 11 22 33 44', email });
  const visit = await t.desk(createAppointment, { clientId: old.id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -400), start: 600 });
  t.clock.now = at(addDays(DAY, -400), 10, 40);
  await t.desk(checkout, { apptId: visit.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] });

  // this week he books on the site with his address, three times; the fourth is refused, with the way to move one
  t.clock.now = at(DAY, 10);
  const made = [];
  for (const [day, start] of [[SAT, 600], [addDays(SAT, 7), 600], [addDays(SAT, 14), 600]]) {
    const r = await t.book({ first: 'Mehdi', email, day, start });
    assert.equal(r.status, 201, r.text);
    assert.equal(t.apptOf(r).clientId, old.id, 'the file that carries his address');
    made.push(t.apptOf(r).id);
  }
  const fourth = await t.book({ first: 'Mehdi', email, day: FRI, start: 690 });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.json.error.code, 'too_many');
  assert.match(fourth.json.error.message, /^Tu as déjà 3 rendez-vous à venir\. Pour en déplacer un, .*« Déplacer »/);

  // the day after: « Mon espace », his address, the code, his first name
  t.clock.now = at(addDays(DAY, 1), 9);
  const { b, v } = await t.signIn(email, 'Mehdi');
  assert.deepEqual(v.json, { ok: true, first: 'Mehdi' });
  // a file not seen for over a year opens fenced, as before: its past may be someone else's
  const me = (await b.get('/api/me')).json;
  assert.deepEqual([me.fenced, me.historyFrom, me.named, me.last], [true, addDays(DAY, 1), true, '']);
  const home = (await b.get('/api/me/home')).json;
  // the three appointments the site counted are the three his space lists (each confirmation is in his mailbox)
  assert.deepEqual(home.upcoming.map((x) => x.id), made);
  assert.ok(home.upcoming.every((x) => x.canChange && x.token && !x.forFirst));
  // what the fence protects stays hidden: the old visit, its ticket, the last name, the address
  assert.deepEqual(home.rhythm.visits, 0);
  assert.deepEqual((await b.get('/api/me/history')).json.items, []);
  assert.equal((await b.get('/api/me/profile')).json.email, '');
  assert.deepEqual((await b.get('/api/me/todo')).json.items, []);
  // each one is his to move: the Saturday to the Friday, 11 h 30
  const moved = await b.post('/api/public/bookings/' + home.upcoming[0].token + '/move', { day: FRI, start: 690 });
  assert.equal(moved.status, 200, moved.text);
  assert.deepEqual((await b.get('/api/me/home')).json.upcoming.map((x) => [x.id, x.day, x.start]), [[made[0], FRI, 690], [made[1], addDays(SAT, 7), 600], [made[2], addDays(SAT, 14), 600]]);
});

test('three wrong first names: the space opens unnamed and fenced as before, and still shows the bookings whose links are in that mailbox', async () => {
  const t = await live();
  const email = freshMail('famille');
  // the file carries the first name typed at the first booking (his son's, booked with the family's address)
  const r = await t.book({ first: 'Ilyes', email });
  assert.equal(r.status, 201, r.text);
  t.clock.now = at(addDays(DAY, 3), 9);
  const { b, v } = await t.signIn(email, ['Karim', 'Karim B', 'Abdelkarim']);
  assert.deepEqual(v.json, { ok: true, first: '' }, 'opened, and told nothing of the holder');
  const acc = accountOf(t.s(), [t.apptOf(r).clientId]);
  assert.deepEqual({ fenced: acc.fenced, named: acc.named }, { fenced: true, named: false });
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual([home.first, home.last, home.fenced], ['', '', true]);
  assert.equal((await b.get('/api/me/profile')).json.email, '');
  assert.deepEqual(home.upcoming.map((x) => [x.id, x.day, x.start, x.canChange]), [[t.apptOf(r).id, SAT, 600, true]]);
});

test('two files for one address (one made at the desk, one by the site): his space lists the bookings of both, and nobody else’s', async () => {
  const t = await live();
  const email = freshMail('karim');
  // the older file: the one the site finds by his address
  const a = await t.desk(addClient, { first: 'Karim', phone: '06 11 22 33 55', email });
  t.clock.now += 60000;
  // a second file with the same address (the desk made it under another number), with a booking to come
  const b2 = await t.desk(addClient, { first: 'Karim', phone: '06 11 22 33 66', email });
  const atDesk = await t.desk(createAppointment, { clientId: b2.id, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: FRI, start: 600 });
  // someone else, another address
  const other = await t.desk(addClient, { first: 'Samir', phone: '06 11 22 33 77', email: freshMail('samir') });
  await t.desk(createAppointment, { clientId: other.id, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: FRI, start: 660 });
  const online = await t.book({ first: 'Karim', email });
  assert.equal(online.status, 201, online.text);
  assert.equal(t.apptOf(online).clientId, a.id);

  const { b, v } = await t.signIn(email, 'Karim');
  assert.deepEqual(v.json, { ok: true, first: 'Karim' });
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual(home.upcoming.map((x) => [x.id, x.forFirst]), [[atDesk.id, ''], [t.apptOf(online).id, '']], 'both files’ bookings, soonest first, none « pour » someone');
  // what he does on the second file's booking from his space works too
  const early = await b.post('/api/me/earlier', { id: atDesk.id, on: true });
  assert.equal(early.status, 200, early.text);
  assert.equal(t.s().appts.get(atDesk.id).earlier, true);
  const moved = await b.post('/api/public/bookings/' + home.upcoming[0].token + '/move', { day: FRI, start: 720 });
  assert.equal(moved.status, 200, moved.text);
  // a booking of a file with another address is nobody's to touch from here
  const samirs = [...t.s().appts.values()].find((x) => x.clientId === other.id);
  assert.equal((await b.post('/api/me/earlier', { id: samirs.id, on: true })).status, 404);

  // a session opened by SMS on a number keeps to its own file (a number proves nothing about an address)
  await t.desk(updateSettings, { booking: { contact: 'phone' }, accounts: { enabled: true } });
  const { bookingsScope } = await import('../../server/domain/me.js');
  const fileB = t.s().clients.get(b2.id);
  assert.deepEqual(bookingsScope(t.s(), fileB, [b2.id], null, false).ids, [b2.id]);
  assert.deepEqual(bookingsScope(t.s(), fileB, [b2.id], null, true).ids.sort(), [a.id, b2.id].sort());
});

test('an address left on a file merged away: a booking with it makes his own file, he can sign in, and a booking already hung on the merged file shows', async () => {
  const t = await live();
  const email = freshMail('nabil');
  // the salon merged his old file into another one that carries another address
  const from = await t.desk(addClient, { first: 'Nabil', phone: '06 11 22 44 55', email });
  t.clock.now += 60000;
  const into = await t.desk(addClient, { first: 'Nabil', phone: '06 11 22 44 66', email: freshMail('autre') });
  await t.desk(mergeClients, { from: from.id, into: into.id });
  // on the live journal a booking can already hang on the merged file (made with his address before this fix)
  const hung = await t.desk(createAppointment, { clientId: into.id, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: FRI, start: 600 });
  await t.rt.engine.run({ run: (s, i, ctx) => { ctx.emit('appt.updated', { id: hung.id, patch: { clientId: from.id }, cid: from.id }); return {}; } }, {}, t.sys);
  assert.equal(t.s().appts.get(hung.id).clientId, from.id);

  // he books with his address: never on the file merged away (nobody opens it), a file of his own
  const r = await t.book({ first: 'Nabil', email });
  assert.equal(r.status, 201, r.text);
  const file = t.s().clients.get(t.apptOf(r).clientId);
  assert.ok(file.id !== from.id && file.id !== into.id && !file.mergedInto, 'a file of his own');
  assert.equal(file.email, email);
  // and that address signs in (before: no code ever left for it)
  const { b, v } = await t.signIn(email, 'Nabil');
  assert.deepEqual(v.json, { ok: true, first: 'Nabil' });
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual(home.upcoming.map((x) => x.id), [hung.id, t.apptOf(r).id]);
});
