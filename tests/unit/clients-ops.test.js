// Client files, the owner's side of the law: erasure that closes what is still open (and texts the client first),
// duplicates found and merged, a personal data export, the 3-year retention, consent shown, and no erased person
// brought back by an import of the old site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import * as C from '../../server/commands/clients.js';
import { importBatch, importPack } from '../../server/commands/import.js';
import { addStaff, setCredentials } from '../../server/commands/team.js';
import { createPayment, paymentSucceeded } from '../../server/commands/payments.js';
import { addWait } from '../../server/commands/agenda.js';
import { sha256 } from '../../server/lib/util.js';
import { readFileSync } from 'node:fs';
import * as W from '../../web/src/lib/wpimport.ts';
import { hashSecret } from '../../server/auth/password.js';
import { createRuntime } from '../../server/http/runtime.js';
import { browser } from '../api/client.js';

const TOMORROW = addDays(DAY, 1);

/**
 * The owner signed in on a production runtime over the test salon's store, with a fake SMS provider that notes
 * whether the watched file was already erased when each text left.
 */
async function owner(t, watch = '') {
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const sent = [];
  rt.sms = { name: 'fake', send: async (to, body) => { sent.push({ to, body, erased: !!rt.engine.state.clients.get(watch)?.erased }); return { ref: 'sms-' + sent.length }; } };
  // and a fake e-mail provider that does the same for each mail
  const mails = [];
  rt.email = { name: 'fake', send: async (m) => { mails.push({ ...m, erased: !!rt.engine.state.clients.get(watch)?.erased }); return { ref: 'mail-' + mails.length }; } };
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: 'patron@test.fr', password: 'Patron-1313!', remember: true })).status, 200);
  return { rt, b, sent, mails };
}
const add = async (t, x) => (await t.engine.run(C.addClient, x, t.asOwner())).id;
// what the routes hand the commands: the tombstones' key, derived from the session secret
const TOMB = C.tombKeyOf('test-secret-0123456789');
const withKey = (base) => ({ ...base, meta: { ...(base.meta || {}), tombKey: TOMB } });

test('erasing a client with bookings to come: refused with the list, or cancelled and texted before the erasure', async () => {
  const t = await salon({ hour: 9 });
  const cid = await add(t, { first: 'Karim', last: 'Haddad', phone: '0611223344', email: 'karim@exemple.fr' });
  const a = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: TOMORROW, start: 600 }, t.asOwner());
  await t.engine.run(importPack, { clientId: cid, left: 3, expires: addDays(DAY, 40) }, t.asOwner());
  await t.engine.run(S.checkout, { clientId: cid, lines: [{ kind: 'giftcard', unit: 3000, recipient: 'Pour Adam' }], payments: [{ method: 'card', amount: 3000 }] }, t.asOwner());
  const { rt, b, sent, mails } = await owner(t, cid);

  // what the confirmation lists before anything happens
  const open = (await b.get('/api/v1/clients/' + cid + '/open')).json;
  assert.deepEqual(open.appts.map((x) => [x.id, x.day, x.start]), [[a.id, TOMORROW, 600]]);
  assert.deepEqual(open.packs.map((k) => k.left), [3]);
  assert.deepEqual(open.giftcards.map((g) => g.balance), [3000]);
  assert.equal(open.sms, true);
  assert.equal(open.smsLive, true);
  assert.equal(open.email, true, 'the dialog names the mail too');

  // without cancelUpcoming: 409, the open items in the answer, nothing written
  const v = rt.engine.state.version;
  const no = await b.post('/api/v1/clients/' + cid + '/erase', {});
  assert.equal(no.status, 409);
  assert.equal(no.json.error.code, 'open');
  assert.match(no.json.error.message, /1 rendez-vous à venir, un abonnement en cours, une carte cadeau avec du solde/);
  assert.deepEqual(no.json.error.extra.open.appts.map((x) => x.id), [a.id]);
  assert.equal(rt.engine.state.version, v);
  assert.equal(rt.engine.state.clients.get(cid).erased, false);

  // with it: the booking is cancelled, the text and the mail queued and sent while the number and the address exist,
  // then the file is erased
  const ok = await b.post('/api/v1/clients/' + cid + '/erase', { cancelUpcoming: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual({ ...ok.json }, { ok: true, cancelled: 1, texted: 2, unsent: 0, refunded: 0 });
  const s = rt.engine.state;
  assert.equal(s.appts.get(a.id).status, 'cancelled');
  assert.equal(s.appts.get(a.id).cancel.by, 'salon');
  assert.equal(s.clients.get(cid).erased, true);
  const cx = sent.filter((x) => /annulé/.test(x.body));
  assert.deepEqual(cx.map((x) => [x.to, x.erased]), [['+33611223344', false]], 'texted once, before the erasure');
  // the mail's calendar file takes the event out of his agenda (METHOD:CANCEL), sent before the address goes
  const mx = mails.filter((m) => (m.attachments || []).some((f) => /method=CANCEL/.test(f.type)));
  assert.deepEqual(mx.map((m) => [m.to, m.erased]), [['karim@exemple.fr', false]], 'mailed once, before the erasure');
  assert.match(mx[0].attachments[0].content, /METHOD:CANCEL/);
  assert.match(mx[0].text, /annulé par le salon/);
  const j = rt.engine.journal;
  const iCancel = j.findIndex((e) => e.type === 'appt.cancelled' && e.data.id === a.id);
  const iQueued = j.findIndex((e) => e.type === 'message.queued' && e.data.template === 'cancelled' && e.data.apptId === a.id);
  const iSent = j.findIndex((e) => e.type === 'message.updated' && e.data.patch.status === 'sent');
  const iErased = j.findIndex((e) => e.type === 'client.erased');
  assert.ok(iCancel >= 0 && iCancel < iQueued && iQueued < iSent && iSent < iErased, 'cancelled, queued, sent, then erased: ' + [iCancel, iQueued, iSent, iErased]);
  // and then the number is gone from the text too, in memory and in the store
  const msg = [...s.messages.values()].find((m) => m.apptId === a.id && m.template === 'cancelled' && m.channel !== 'email');
  assert.equal(msg.to, '');
  assert.equal(msg.status, 'sent');
  const mail = [...s.messages.values()].find((m) => m.apptId === a.id && m.template === 'cancelled' && m.channel === 'email');
  assert.equal(mail.to, '');
  assert.equal(mail.status, 'sent');
  const stored = JSON.stringify((await t.store.read(0)).events.map((e) => e.pii || null));
  for (const x of ['Karim', '0611223344', '+33611223344', 'karim@exemple.fr', 'Pour Adam']) assert.ok(!stored.includes(x), x + ' left in the store');
  assert.equal(s.giftcards.size, 1);
  assert.equal([...s.giftcards.values()][0].recipient, '', 'the card stays valid, without the names');
  assert.equal(rt.engine.verify().ok, true);
  // a second tap (or a retry) changes nothing
  assert.equal((await b.post('/api/v1/clients/' + cid + '/erase', { cancelUpcoming: true })).status, 200);
  assert.equal(sent.filter((x) => /annulé/.test(x.body)).length, 1);
  assert.equal(mails.filter((m) => /annulé/.test(m.subject)).length, 1);
});

test('erasure without a text to send happens in one write; a barber may not erase', async () => {
  const t = await salon({ hour: 9 });
  const cid = await add(t, { first: 'Sami', phone: '0622334455', sms: false });
  const a = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: TOMORROW, start: 660 }, t.asOwner());
  await rejects(t.engine.run(C.eraseClient, { id: cid, cancelUpcoming: true }, t.asStaff('Ali')), 'forbidden');
  const r = await t.engine.run(C.eraseClient, { id: cid, cancelUpcoming: true }, t.asOwner());
  assert.equal(r.erased, true);
  assert.deepEqual(r.cancelled, [a.id]);
  assert.equal(t.engine.state.appts.get(a.id).status, 'cancelled');
  assert.ok(![...t.engine.state.messages.values()].some((m) => m.template === 'cancelled'), 'he takes no texts');
  // a past visit is not "open": the file erases without the flag
  const old = await add(t, { first: 'Hugo', phone: '0633445566' });
  t.clock.now = at(DAY, 8);
  assert.equal((await t.engine.run(C.eraseClient, { id: old }, t.asOwner())).erased, true);
  // a booking of this morning nobody closed is still open (it would stay "à encaisser" under no name): cancelled, no text
  const late = await add(t, { first: 'Rayan', phone: '0644556600' });
  const am = await t.engine.run(A.createAppointment, { clientId: late, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 540 }, t.asOwner());
  t.clock.now = at(DAY, 15);
  const e = await rejects(t.engine.run(C.eraseClient, { id: late }, t.asOwner()), 'open');
  assert.deepEqual(e.extra.open.appts.map((x) => [x.id, x.passed]), [[am.id, true]]);
  const r2 = await t.engine.run(C.eraseClient, { id: late, cancelUpcoming: true }, t.asOwner());
  assert.equal(r2.erased, true, 'nothing to text: one write');
  assert.equal(t.engine.state.appts.get(am.id).status, 'cancelled');
});

test('erasure mails the cancellation to a client without SMS before the address goes, but not for a deposit never paid', async () => {
  const t = await salon({ hour: 9 });
  const cid = await add(t, { first: 'Inès', phone: '0622330000', email: 'ines@exemple.fr', sms: false });
  const a = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: TOMORROW, start: 600 }, t.asOwner());
  // waiting for its deposit: never confirmed by mail, so nothing to take out of an agenda
  const p = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: t.ids.Ben, day: TOMORROW, start: 600, first: 'Inès', phone: '0622330000' }, t.asClient);
  assert.equal(t.engine.state.appts.get(p.id).status, 'pending');
  const r = await t.engine.run(C.eraseClient, { id: cid, cancelUpcoming: true }, withKey(t.asOwner()));
  assert.equal(r.erased, false, 'the mail leaves first');
  const queued = r.texts.map((id) => t.engine.state.messages.get(id));
  assert.deepEqual(queued.map((m) => [m.channel, m.template, m.apptId, m.to]), [['email', 'cancelled', a.id, 'ines@exemple.fr']]);
  const r2 = await t.engine.run(C.eraseClient, { id: cid, cancelUpcoming: true }, withKey(t.asOwner()));
  assert.equal(r2.erased, true);
  assert.equal(t.engine.state.messages.get(queued[0].id).to, '', 'the address goes with the file');
});

test('erasure takes him off the waiting list, pays the deposit back, and only for who may erase', async () => {
  const t = await salon({ hour: 9 });
  const bk = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.color], staffId: t.ids.Ali, day: TOMORROW, start: 840, first: 'Nolan', phone: '0611220000' }, t.asClient);
  const s = t.engine.state;
  const appt = s.appts.get(bk.id);
  assert.equal(appt.status, 'pending', 'a deposit is asked');
  const pay = { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']) };
  await t.engine.run(createPayment, { id: 'py_dep1', kind: 'deposit', amount: appt.deposit.amount, provider: 'simulated', providerRef: 'sim_dep1', apptId: appt.id, exp: t.clock.now + 30 * 60000 }, pay);
  await t.engine.run(paymentSucceeded, { providerRef: 'sim_dep1', amount: appt.deposit.amount }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set() });
  assert.equal(s.appts.get(bk.id).status, 'booked');
  const cid = appt.clientId;
  await t.engine.run(addWait, { day: addDays(DAY, 2), staffId: 'any', serviceId: t.ids.cut, from: 600, to: 900, first: 'Nolan', phone: '0611220000' }, t.asClient);
  const w = [...s.waitlist.values()].find((x) => x.clientId === cid);
  assert.ok(w && w.status === 'waiting');
  const { rt, b } = await owner(t, cid);
  rt.pay.refund = async () => ({ ref: 're_1' });

  const open = (await b.get('/api/v1/clients/' + cid + '/open')).json;
  assert.equal(open.appts[0].deposit, appt.deposit.amount);
  const r = await b.post('/api/v1/clients/' + cid + '/erase', { cancelUpcoming: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual({ ...r.json }, { ok: true, cancelled: 1, texted: 1, unsent: 0, refunded: 1 });
  const rs = rt.engine.state;
  assert.equal(rs.payments.get('py_dep1').status, 'refunded');
  assert.equal(rs.waitlist.get(w.id).status, 'removed', 'nobody to offer a freed slot to');
  assert.equal(rs.waitlist.get(w.id).phone, '');
  // the tombstone is keyed: not the plain hash of the number anyone could recompute
  const ev = rt.engine.journal.find((x) => x.type === 'client.erased');
  assert.deepEqual(ev.data.tombs, [C.tombOf(TOMB, '+33611220000')]);
  assert.ok(!ev.data.tombs.includes(sha256('lx-erased-v1|+33611220000').slice(0, 32)));
  assert.ok(!ev.data.tombs.includes(sha256('+33611220000').slice(0, 32)));
});

test('duplicates: the Yanis Benali pair, the same e-mail, the same last 8 digits; marked distinct, they stop', async () => {
  const t = await salon();
  const y1 = await add(t, { first: 'Yanis', last: 'Benali', phone: '0611111111' });
  const y2 = await add(t, { first: 'yanis', last: 'BENALI', phone: '0622222222' });
  const e1 = await add(t, { first: 'Karim', last: 'Fabre', email: 'k.fabre@exemple.fr' });
  const e2 = await add(t, { first: 'Kader', email: 'K.Fabre@exemple.fr' });
  // the same mobile, typed with another country prefix
  const p1 = await add(t, { first: 'Nolan', phone: '06 98 76 54 32' });
  const p2 = await add(t, { first: 'Nono', phone: '+32 6 98 76 54 32' });
  await add(t, { first: 'Yanis', phone: '0633333333' }); // a first name alone is not a duplicate
  const pairs = C.findDuplicates(t.engine.state);
  const key = (a, b) => [a, b].sort().join('|');
  assert.deepEqual(new Set(pairs.map((p) => key(p.a, p.b))), new Set([key(y1, y2), key(e1, e2), key(p1, p2)]));
  assert.deepEqual(pairs.find((p) => key(p.a, p.b) === key(y1, y2)).why, ['name']);
  assert.equal(key(pairs[0].a, pairs[0].b), key(p1, p2), 'the strongest first');

  // the HTTP side: the pair with the file to keep first (more visits), and the segment
  const a = await t.engine.run(A.createAppointment, { clientId: y2, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  const { b } = await owner(t);
  const dup = (await b.get('/api/v1/clients/duplicates')).json;
  const yb = dup.pairs.find((p) => [p.keep.id, p.drop.id].includes(y1));
  assert.equal(yb.keep.id, y2, 'the one who came is kept');
  assert.equal(yb.drop.first + ' ' + yb.drop.last, 'Yanis Benali');
  // the segment lists pairs: its count says pairs, like the line under it
  assert.equal((await b.get('/api/v1/clients?segment=doublons')).json.counts.doublons, 3);
  assert.equal((await b.get('/api/v1/clients?segment=doublons&q=benali')).json.counts.doublons, 1);

  // telling two people apart is a merge decision: the desk and the owner, not a barber
  await rejects(t.engine.run(C.markDistinct, { a: y1, b: y2 }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(C.markDistinct, { a: y1, b: 7 }, t.asOwner()), 'invalid');
  await t.engine.run(C.markDistinct, { a: y1, b: y2 }, t.asOwner());
  assert.ok(!C.findDuplicates(t.engine.state).some((p) => key(p.a, p.b) === key(y1, y2)), 'two different people');
  // merged, the pair is gone too, and an erased file never merges
  await t.engine.run(C.mergeClients, { from: e2, into: e1 }, t.asOwner());
  assert.ok(!C.findDuplicates(t.engine.state).some((p) => key(p.a, p.b) === key(e1, e2)));
  await t.engine.run(C.eraseClient, { id: p2 }, t.asOwner());
  await rejects(t.engine.run(C.mergeClients, { from: p2, into: p1 }, t.asOwner()), 'erased');
});

test('the export holds the file, the bookings, the tickets and the texts; only for who may export', async () => {
  const t = await salon({ hour: 9 });
  const cid = await add(t, { first: 'Adam', last: 'Rossi', phone: '0644556677', email: 'adam@exemple.fr', notes: 'Allergique au henné' });
  const done = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 540 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: done.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.beard], staffId: t.ids.Ben, day: TOMORROW, start: 600, notify: true }, t.asOwner());
  // a duplicate merged into the file: its bookings belong to the export too
  const dup = await add(t, { first: 'Adam', phone: '0700000001' });
  await t.engine.run(A.createAppointment, { clientId: dup, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 7), start: 600 }, t.asOwner());
  await t.engine.run(C.mergeClients, { from: dup, into: cid }, t.asOwner());
  const { b } = await owner(t);
  const r = await b.get('/api/v1/clients/' + cid + '/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="larchitecte-donnees-adam-rossi-2026-11-03\.json"/);
  assert.match(r.headers.get('content-type'), /application\/json/);
  const x = r.json;
  assert.equal(x.fiche.prenom, 'Adam');
  assert.equal(x.fiche.telephone, '06 44 55 66 77');
  assert.equal(x.fiche.notes, 'Allergique au henné');
  assert.deepEqual(x.rendezVous.map((a) => [a.jour, a.heure, a.statut, a.barbier]), [[DAY, '09:00', 'venu', 'Ali'], [TOMORROW, '10:00', 'à venir', 'Ben'], [addDays(DAY, 7), '10:00', 'à venir', 'Ben']]);
  assert.equal(x.tickets.length, 1);
  assert.match(x.tickets[0].total, /20/);
  assert.ok(Array.isArray(x.sms));
  // in words the client reads, not the server's codes
  assert.equal(x.rendezVous[0].origine, 'au salon');
  assert.ok(x.sms.length >= 1);
  for (const m of x.sms) { assert.ok(!['reminder', 'reminder2h', 'cancelled', 'rebook'].includes(m.type), m.type); assert.ok(!['sent', 'simulated', 'queued', 'claimed', 'failed'].includes(m.statut), m.statut); }
  // the merged-away id leads to the kept file
  assert.equal((await b.get('/api/v1/clients/' + dup + '/export')).json.fiche.prenom, 'Adam');
  // a barber signed in gets a refusal from the route itself, not the file
  await t.engine.run(addStaff, { name: 'Carl', role: 'barber', email: 'carl@test.fr' }, t.asOwner());
  const carl = [...t.engine.state.staff.values()].find((x) => x.name === 'Carl');
  await t.engine.run(setCredentials, { id: carl.id, pwdHash: await hashSecret('Barbier-2468!') }, t.asOwner());
  const rt2 = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const bb = browser(rt2);
  assert.equal((await bb.post('/api/auth/login', { email: 'carl@test.fr', password: 'Barbier-2468!' })).status, 200);
  const no = await bb.get('/api/v1/clients/' + cid + '/export');
  assert.equal(no.status, 403);
  assert.ok(!no.text.includes('Allergique'));
});

test('retention: files without a visit for 3 years are anonymised, the tickets stay, and anonymous old data goes too', async () => {
  const OLD = '2022-06-07', NOW = DAY;
  const t = await salon({ day: OLD, hour: 10 });
  const gone = await add(t, { first: 'Bilal', last: 'Ziani', phone: '0655555555', notes: 'Parle de foot' });
  const a = await t.engine.run(A.createAppointment, { clientId: gone, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: OLD, start: 660 }, t.asOwner());
  const sale = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  // a ticket without a client, with a typed discount reason (pii), and a booking under a name only
  const anon = await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut }], discount: { amount: 200, reason: 'Cousin de Bilal' }, payments: [{ method: 'card', amount: 1800 }] }, t.asOwner());
  const walk = await t.engine.run(A.createAppointment, { name: 'Monsieur Pons', serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: OLD, start: 720 }, t.asOwner());
  // someone from the same time who came back last month stays; his old ticket's typed reason still goes
  const back = await add(t, { first: 'Mehdi', phone: '0666666666' });
  const mOld = await t.engine.run(S.checkout, { clientId: back, lines: [{ kind: 'service', ref: t.ids.cut }], discount: { amount: 300, reason: 'Ami de Mehdi' }, payments: [{ method: 'card', amount: 1700 }] }, t.asOwner());
  t.clock.now = at(addDays(NOW, -28), 10);
  const v2 = await t.engine.run(A.createAppointment, { clientId: back, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(NOW, -28), start: 600 }, t.asOwner());
  await t.engine.run(S.checkout, { apptId: v2.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  t.clock.now = at(NOW, 10);

  const s = t.engine.state;
  assert.equal(C.retentionCutoff(NOW), '2023-11-03');
  assert.deepEqual(C.inactiveClients(s, NOW).map((c) => c.id).sort(), [gone, t.ids.yanis].sort(), 'Yanis was created in 2022 and never came');
  assert.deepEqual(C.staleAnonymous(s, NOW).sort(), [anon.id, walk.id, mOld.id].sort());
  const { rt, b } = await owner(t);
  const list = (await b.get('/api/v1/clients?segment=inactifs')).json;
  assert.equal(list.counts.inactifs, 2);
  assert.deepEqual(list.retention, { before: '2023-11-03', other: 3 });
  // the Clients tab says it, wherever the owner is
  assert.equal((await b.get('/api/v1/pulse')).json.badges.retention, 2);

  // the count the owner saw must still be right
  const stale = await b.post('/api/v1/clients/retention', { expect: 5 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, 'changed');
  const r = await b.post('/api/v1/clients/retention', { expect: 2 }, { 'x-request-id': 'retention-run-1' });
  assert.deepEqual(r.json, { erased: 2, other: 3 });
  // the same request again (a retry): the same answer, nothing written twice
  const v1 = rt.engine.state.version;
  assert.deepEqual((await b.post('/api/v1/clients/retention', { expect: 2 }, { 'x-request-id': 'retention-run-1' })).json, { erased: 2, other: 3 });
  assert.equal(rt.engine.state.version, v1);

  await t.engine.sync(true);
  assert.equal(s.clients.get(gone).erased, true);
  assert.equal(s.clients.get(back).erased, false);
  // the books are intact: same tickets, same totals, the chain verifies
  assert.equal(s.sales.get(sale.id).totals.due, 2000);
  assert.equal(s.sales.get(anon.id).totals.due, 1800);
  assert.equal(s.sales.get(anon.id).discountNote, '');
  assert.equal(s.appts.get(walk.id).name, '');
  assert.equal(s.sales.get(mOld.id).discountNote, '');
  assert.equal(s.sales.get(mOld.id).clientId, back, 'still his ticket');
  assert.equal(s.sales.size, 4);
  const stored = JSON.stringify((await t.store.read(0)).events.map((e) => e.pii || null));
  for (const x of ['Bilal', 'Parle de foot', 'Cousin de Bilal', 'Monsieur Pons', '0655555555', 'Ami de Mehdi']) assert.ok(!stored.includes(x), x + ' left in the store');
  assert.equal((await b.get('/api/v1/pulse')).json.badges.retention, 0);
  assert.ok(stored.includes('Mehdi'), 'the regular is kept');
  assert.equal(t.engine.verify().ok, true);
  // nothing left to do: the segment is empty and a second run writes nothing
  assert.equal(C.inactiveClients(s, NOW).length, 0);
  const v = s.version;
  assert.deepEqual((await b.post('/api/v1/clients/retention', { expect: 0 })).json, { erased: 0, other: 0 });
  await t.engine.sync(true);
  assert.equal(s.version, v);

  // the old site re-imported on cut-over day: Bilal's old rows stay out, but a booking he made there after the
  // purge is him coming back, and it comes in on a new file
  const purged = rt.engine.journal.find((e) => e.type === 'client.erased' && e.data.retention);
  assert.equal(purged.data.files, 2);
  const pv = (await b.post('/api/v1/import/preview', { keys: [{ phone: '06 55 55 55 55' }, { phone: '0612000000' }] })).json;
  assert.deepEqual(pv.erased, [{ i: 0, at: purged.at }], 'the preview leaves them out too');
  const imp = await b.post('/api/v1/import/batch', {
    appts: [
      { wp: 3001, day: OLD, start: 660, createdAt: at(OLD, 9), first: 'Bilal', last: 'Ziani', phone: '0655555555', serviceIds: [t.ids.cut], staffId: t.ids.Ali, status: 'confirmed', note: 'Parle de foot' },
      { wp: 3002, day: addDays(NOW, 5), start: 600, createdAt: at(NOW, 11), first: 'Bilal', last: 'Ziani', phone: '0655555555', serviceIds: [t.ids.cut], staffId: t.ids.Ali, status: 'confirmed' }
    ]
  });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  assert.equal(imp.json.appts.skipped, 1);
  assert.equal(imp.json.appts.booked, 1);
  assert.equal(imp.json.clients.added, 1);
  assert.deepEqual(imp.json.review.filter((x) => x.kind === 'erased').map((x) => [x.wp, x.text]), [[3001, 'Fiche anonymisée après 3 ans sans visite : ses lignes sont ignorées']]);
  const rs = rt.engine.state;
  const nb = rs.appts.get(rs.apptByWp.get('3002'));
  assert.equal(rs.clients.get(nb.clientId).first, 'Bilal');
  assert.notEqual(nb.clientId, gone, 'a new file, not the anonymised one');
  assert.ok(!rs.apptByWp.has('3001'));
});

test('an erased client never comes back with an import of the old site', async () => {
  const t = await salon({ hour: 9 });
  const cid = await add(t, { first: 'Karim', last: 'Benali', phone: '0698765432', email: 'karim.benali@exemple.fr' });
  await t.engine.run(C.eraseClient, { id: cid }, withKey(t.asOwner()));
  const ev = t.engine.journal.find((e) => e.type === 'client.erased');
  assert.equal(ev.data.tombs.length, 2, 'number and e-mail');
  assert.ok(!JSON.stringify(ev).includes('98765432') && !JSON.stringify(ev).includes('karim'), 'the tombstone names nobody');
  // and cannot be recomputed from the code alone: not a salted hash of the number, a keyed one
  assert.ok(!ev.data.tombs.includes(sha256('lx-erased-v1|+33698765432').slice(0, 32)));
  assert.ok(ev.data.tombs.includes(C.tombOf(TOMB, '+33698765432')));
  assert.notEqual(C.tombOf(C.tombKeyOf('another-secret'), '+33698765432'), C.tombOf(TOMB, '+33698765432'));
  // without the key (a run outside a route) nothing is matched: the import needs the key too
  assert.equal(C.erasedTomb(t.engine.state, '', '+33698765432', ''), null);

  const before = t.engine.state.clients.size;
  const out = await t.engine.run(importBatch, {
    clients: [{ first: 'Karim', last: 'Benali', phone: '+33 6 98 76 54 32', email: 'karim.benali@exemple.fr' }, { first: 'K.', email: 'Karim.Benali@exemple.fr' }, { first: 'Lucas', phone: '0612000000' }],
    appts: [{ wp: 1201, day: addDays(DAY, -60), start: 600, first: 'Karim', last: 'Benali', phone: '0698765432', serviceIds: [t.ids.cut], staffId: t.ids.Ali, status: 'confirmed', note: 'Allergique' }],
    packs: [{ phone: '0698765432', left: 2, expires: addDays(DAY, 30) }]
  }, withKey(t.asOwner()));
  assert.equal(out.clients.added, 1, 'only Lucas');
  assert.equal(t.engine.state.clients.size, before + 1);
  assert.equal(out.appts.skipped, 1);
  assert.equal(out.packs.skipped, 1);
  const erased = out.review.filter((x) => x.kind === 'erased');
  assert.equal(erased.length, 1, 'said once for the person');
  assert.equal(erased[0].text, 'Client effacé à sa demande : ses lignes sont ignorées');
  assert.ok(!('name' in erased[0]));
  assert.ok(![...t.engine.state.appts.values()].some((a) => a.ext && a.ext.wp === 1201), 'no booking under his name either');
  assert.ok(!JSON.stringify(t.engine.journal.slice(-5)).includes('Benali'));
});

test('the "À relancer" segment counts the same people as Relances, and the file says where the consent comes from', async () => {
  const t = await salon();
  const yes = await add(t, { first: 'Karim', phone: '0611111111', marketing: true }), no = await add(t, { first: 'Sami', phone: '0622222222' });
  for (const [i, id] of [yes, no].entries()) {
    t.clock.now = at(addDays(DAY, -40), 10);
    const a = await t.engine.run(A.createAppointment, { clientId: id, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -40), start: 600 + 30 * i }, t.asOwner());
    await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  }
  t.clock.now = at(DAY, 10);
  const { b } = await owner(t);
  const seg = (await b.get('/api/v1/clients?segment=relancer')).json;
  const rel = (await b.get('/api/v1/relances')).json;
  assert.deepEqual(seg.items.map((c) => c.id), rel.items.map((c) => c.id));
  assert.deepEqual(seg.items.map((c) => c.id), [yes]);
  assert.equal(seg.counts.relancer, 1);
  assert.equal(seg.excludedNoConsent, rel.excludedNoConsent);
  assert.equal(seg.excludedNoConsent, 1);

  // consent given at the counter: recorded with its source and date
  assert.equal((await b.patch('/api/v1/clients/' + no, { marketing: true })).status, 200);
  const f = (await b.get('/api/v1/clients/' + no)).json.client;
  assert.equal(f.marketing, true);
  assert.equal(f.marketingSrc, 'salon');
  assert.equal(f.marketingAt, at(DAY, 10));
  // a patch that changes nothing keeps the first date
  t.clock.now = at(DAY, 11);
  await b.patch('/api/v1/clients/' + no, { marketing: true, tags: ['VIP'] });
  assert.equal((await b.get('/api/v1/clients/' + no)).json.client.marketingAt, at(DAY, 10));
});

test('the import preview leaves an erased client out as the batch does, and lets in what he booked there since', async () => {
  const t = await salon({ day: '2026-10-31', hour: 10 });
  const cid = await add(t, { first: 'Karim', last: 'Benali', phone: '06 98 76 54 32', email: 'karim.benali@exemple.fr' });
  const { rt, b } = await owner(t);
  assert.equal((await b.post('/api/v1/clients/' + cid + '/erase', {})).status, 200);
  t.clock.now = at(DAY, 10);
  const p = W.readFiles([{ name: 'export.csv', text: readFileSync(new URL('../fixtures/wp-bookings-fr.csv', import.meta.url), 'utf8') }]);
  const svc = Object.fromEntries(W.names(p).services.map(([n]) => [n, t.ids.cut])), staff = Object.fromEntries(W.names(p).staff.map(([n]) => [n, t.ids.Ali]));
  const map = { services: svc, staff };
  const ids = W.preview(p, map, t.clock.now).identities;
  const keys = ids.flatMap((list, g) => list.map((k) => ({ ...k, g })));
  const pre = (await b.post('/api/v1/import/preview', { keys: keys.map(({ g, ...k }) => k) })).json;
  const erased = new Map(pre.erased.map((x) => [keys[x.i].g, x.at]));
  assert.equal(erased.size, 1, 'Karim, once');
  const known = new Set(pre.known.map((i) => keys[i].g)), again = new Set(pre.again.map((i) => keys[i].g));
  const pv = W.preview(p, map, t.clock.now, { known, again, erased, chairs: new Set([t.ids.Ali, t.ids.Ben]), today: DAY });
  // 1201, 1245 and 1290 were booked before the erasure; 1360 on 1 November, after it: he came back
  assert.equal(pv.counts.erased, 3);
  assert.equal(pv.review.filter((r) => r.kind === 'erased').length, 1);
  const rows = W.toRows(p, map);
  const res = (await b.post('/api/v1/import/batch', { clients: rows.clients, appts: rows.appts })).json;
  const c = pv.counts;
  assert.equal(res.clients.added, c.newClients, 'the preview promises the files the batch creates');
  assert.equal((res.appts.done || 0) + (res.appts.noShow || 0) + (res.appts.booked || 0) + (res.appts.cancelled || 0), c.past + c.noShow + c.upcoming + c.cancelled, 'and the bookings');
  const s = rt.engine.state;
  assert.ok(s.apptByWp.has('1360') && !s.apptByWp.has('1201') && !s.apptByWp.has('1290'));
});
