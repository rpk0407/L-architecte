// The weekly carnet bought with its dates (« 5 coupes sur 5 semaines d'affilée », 80 €): sold on the site to a signed-in
// client only, its five dates booked together or not at all, paid online when a payment exists (demo) and at the first
// cut otherwise, one credit per visit, the rules of a missed first cut, a missed week, a move, a child, the desk.
// server/commands/formule.js, server/domain/formule.js, server/http/routes-formule.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY, rejects } from '../helpers.js';
import { browser, testRuntime } from './client.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import * as F from '../../server/commands/formule.js';
import { addService, updateService } from '../../server/commands/catalog.js';
import { addTimeOff } from '../../server/commands/team.js';
import { updateSettings, addClosure } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { paymentSucceeded } from '../../server/commands/payments.js';
import { createRuntime } from '../../server/http/runtime.js';
import { otpCode } from '../../server/domain/otp.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { proposeSeries, weeksOf, rankOf, offerOf } from '../../server/domain/formule.js';
import { normPhone } from '../../server/lib/util.js';
import { DEMO } from '../../server/domain/seed.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const FIRST = '2026-11-05'; // the Thursday after DAY (a Tuesday)
const rid = (n) => 'f0f0f0f0-0000-4000-8000-' + String(n).padStart(12, '0');

async function setup({ missed = 'lost', accounts = true } = {}) {
  const t = await salon();
  if (accounts) await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  t.ids.carnet = (await t.engine.run(addService, { name: 'Carnet 5 coupes', category: 'Carnet', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [t.ids.cut], weekly: true, missed } }, t.asOwner())).id;
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  await rt.engine.sync(true);
  const s = () => rt.engine.state;
  const run = (h, input, ctx) => rt.engine.run(h, input, ctx || t.asOwner());
  return { ...t, rt, s, run };
}
/** « Cette formule demande un compte »: the code sent to the number typed, typed back; the browser is then signed in. */
async function signIn(t, b, phone, first) {
  const j = await b.post('/api/public/account/join', { first, phone });
  assert.equal(j.status, 200, j.text);
  await settled();
  const cid = t.s().clientByPhone.get(normPhone(phone));
  const m = [...t.s().messages.values()].filter((x) => x.template === 'otp' && x.cid === cid).at(-1);
  assert.ok(m, 'a code was sent to the number typed');
  const v = await b.post('/api/public/account/verify', { phone, code: otpCode(t.rt.secret, m.id), first });
  assert.equal(v.status, 200, v.text);
  return cid;
}
const five = (staffId, start = 600, day = FIRST) => ({ first: { staffId, day, start }, weeks: [1, 2, 3, 4].map((k) => ({ staffId, day: addDays(day, 7 * k), start })) });
const apptsOf = (t, fid) => t.s().formules.get(fid).apptIds.map((id) => t.s().appts.get(id));
const formuleOf = (t, cid) => [...t.s().formules.values()].find((f) => f.clientId === cid);
const go = (t, day, h = 10, m = 0) => { t.clock.now = at(day, h, m); };
const card = (amount) => [{ method: 'card', amount }];

test('the carnet is on the site while the client space is open; it is never a plain booking', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const pub = (await site.get('/api/public/salon')).json;
  const sv = pub.services.find((x) => x.slug === 'ab');
  assert.deepEqual(sv.pack, { credits: 5, days: 35, serviceIds: [t.ids.cut], weekly: true, missed: 'lost' });
  assert.ok(!pub.services.some((x) => x.name === 'Abonnement 5 coupes'), 'a carnet without dates stays at the salon');
  assert.equal(pub.menu.find((x) => x.slug === 'ab').online, true);
  // not a visit: no availability, no hold, no booking under its own id
  assert.equal((await site.get(`/api/public/availability?services=${t.ids.carnet}&from=${FIRST}&days=1`)).status, 404);
  assert.equal((await site.post('/api/public/holds', { serviceIds: [t.ids.carnet], staffId: 'any', day: FIRST, start: 600 })).json.error.code, 'not_online');
  const plain = await site.post('/api/public/bookings', { serviceIds: [t.ids.carnet], staffId: 'any', day: FIRST, start: 600, first: 'Karim', phone: '0612000001' });
  assert.equal(plain.json.error.code, 'not_online');
  // a plain booking still needs no account
  assert.equal((await site.post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: 'any', day: FIRST, start: 600, first: 'Karim', phone: '0612000001' })).status, 201);
  // the owner flips « semaine manquée » in the Catalogue: the validity follows (35 days, or 42 with one week made up)
  await t.run(updateService, { id: t.ids.carnet, patch: { pack: { credits: 5, days: 35, serviceIds: [t.ids.cut], weekly: true, missed: 'once' } } });
  assert.equal(t.s().services.get(t.ids.carnet).pack.days, 42);
  assert.equal(offerOf(t.s()).days, 42);
  await rejects(t.run(updateService, { id: t.ids.carnet, patch: { pack: { credits: 5, days: 35, weekly: true, missed: 'lost' } } }, t.asStaff('Ali')), 'forbidden');
  // the client space closed: nothing to sign in with, so it is not sold online
  const off = await setup({ accounts: false });
  const pub2 = (await browser(off.rt).get('/api/public/salon')).json;
  assert.ok(!pub2.services.some((x) => x.slug === 'ab'));
  assert.equal(pub2.menu.find((x) => x.slug === 'ab').online, false);
  assert.equal((await browser(off.rt).get(`/api/public/formule/series?staff=${off.ids.Ali}&day=${FIRST}&start=600`)).status, 404);
});

test('« Tes 4 autres rendez-vous »: same weekday, hour and barber; a closed week or a barber off proposes the nearest slot and says why', async () => {
  const t = await setup();
  const site = browser(t.rt);
  // week 2: the salon is closed on the Thursday (a public holiday); week 3: Ali is off all week; week 4: his 10:00 is taken
  await t.run(addClosure, { from: '2026-11-12', to: '2026-11-12', label: 'Férié' });
  await t.run(addTimeOff, { staffId: t.ids.Ali, from: '2026-11-17', to: '2026-11-21', reason: 'Congé' });
  await t.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: '2026-11-26', start: 600 });
  const r = await site.get(`/api/public/formule/series?staff=${t.ids.Ali}&day=${FIRST}&start=600`);
  assert.equal(r.status, 200, r.text);
  const [w1, w2, w3, w4] = r.json.weeks;
  assert.equal(r.json.end, '2026-12-09', 'five weeks from the first date, that day included');
  // the nearest day of that week with Ali, the nearest hour
  assert.deepEqual([w1.day, w1.start, w1.staffId, w1.exact], ['2026-11-13', 600, t.ids.Ali, false]);
  assert.match(w1.why, /Le salon est fermé jeudi 12 novembre/);
  // Ali is away the whole week: another barber, same day and hour, and the reason
  assert.deepEqual([w2.day, w2.start, w2.staffId, w2.exact], ['2026-11-19', 600, t.ids.Ben, false]);
  assert.match(w2.why, /Ali est absent jeudi 19 novembre/);
  assert.deepEqual([w3.day, w3.staffId, w3.exact], ['2026-11-26', t.ids.Ali, false]);
  assert.ok(Math.abs(w3.start - 600) === 30, 'the nearest hour that day');
  assert.match(w3.why, /Ali est déjà pris/);
  assert.deepEqual([w4.day, w4.start, w4.staffId, w4.exact, w4.why], ['2026-12-03', 600, t.ids.Ali, true, '']);
});

test('the dates keep their hour across the change of clock (last Sunday of March)', async () => {
  const t = await setup();
  go(t, '2027-03-16');
  const weeks = proposeSeries(t.s(), { serviceId: t.ids.cut, staffId: t.ids.Ali, day: '2027-03-18', start: 600, weeks: 5, now: t.clock.now, local: { day: '2027-03-16', min: 600 }, online: true });
  assert.deepEqual(weeks.map((w) => [w.day, w.start, w.exact]), [['2027-03-25', 600, true], ['2027-04-01', 600, true], ['2027-04-08', 600, true], ['2027-04-15', 600, true]]);
  const site = browser(t.rt);
  await signIn(t, site, '0612000077', 'Nadir');
  const r = await site.post('/api/me/formule', five(t.ids.Ali, 600, '2027-03-18'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.appts.map((a) => [a.day, a.start]), [['2027-03-18', 600], ['2027-03-25', 600], ['2027-04-01', 600], ['2027-04-08', 600], ['2027-04-15', 600]]);
  // 10:00 in Paris on both sides of the change: one hour less of UTC after it
  const [before, after] = [at('2027-03-25', 10), at('2027-04-01', 10)];
  assert.equal(after - before, 7 * 86400000 - 3600000);
});

test('an account is required: 401 without one; the code proves the number; five dates on the session’s file, booked once', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const body = five(t.ids.Ali);
  const no = await site.post('/api/me/formule', body);
  assert.equal(no.status, 401);
  assert.equal(t.s().formules.size, 0);
  // the wrong code opens nothing, and nothing is attached to the number
  await site.post('/api/public/account/join', { first: 'Karim', phone: '0612000001' });
  await settled();
  const cid = t.s().clientByPhone.get(normPhone('0612000001'));
  assert.ok(cid, 'the file of the number typed, as a booking would make it');
  assert.equal((await site.post('/api/public/account/verify', { phone: '0612000001', code: '000000', first: 'Karim' })).status, 400);
  assert.equal((await site.post('/api/me/formule', body)).status, 401);
  assert.equal(t.s().formules.size, 0);
  // the answer of « join » never tells whether the number was known
  const known = await browser(t.rt).post('/api/public/account/join', { first: 'Zed', phone: '06 12 34 56 78' });
  assert.deepEqual(Object.keys(known.json).sort(), ['message', 'ok']);
  await settled();
  assert.equal(t.s().clients.get(t.ids.yanis).first, 'Yanis', 'a known file keeps its name');
  // signed in: the purchase lands on the session's file whatever the body says
  await signIn(t, site, '0612000001', 'Karim');
  const r = await site.post('/api/me/formule', { ...body, clientId: t.ids.yanis, client: { first: 'Yanis', phone: '0612345678' } }, { 'x-request-id': rid(1) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.pay, 'salon', 'no online payment plugged in: paid at the first cut');
  assert.equal(r.json.amount, 8000);
  const f = formuleOf(t, cid);
  assert.ok(f && !formuleOf(t, t.ids.yanis));
  const list = apptsOf(t, f.id);
  assert.deepEqual(list.map((a) => [a.day, a.start, a.staffId, a.status, a.clientId]), [0, 1, 2, 3, 4].map((k) => [addDays(FIRST, 7 * k), 600, t.ids.Ali, 'booked', cid]));
  assert.ok(list.every((a) => a.services.length === 1 && a.services[0].id === t.ids.cut && a.source === 'site'));
  assert.equal(t.s().packs.size, 0, 'no credit before the money');
  // one confirmation listing the five dates, with what is left to pay
  const texts = [...t.s().messages.values()].filter((m) => m.cid === cid && m.template === 'confirmation' && m.channel === 'sms');
  assert.equal(texts.length, 1);
  assert.match(texts[0].body, /Tes 5 coupes avec Ali : .*12\/11, 19\/11, 26\/11, 3\/12\. 80 € à régler à la 1re coupe\./);
  // a double tap, or a lost answer tried again: the same answer, nothing booked twice
  const again = await site.post('/api/me/formule', body, { 'x-request-id': rid(1) });
  assert.deepEqual(again.json, r.json);
  assert.equal(t.s().formules.size, 1);
  assert.equal([...t.s().appts.values()].filter((a) => a.clientId === cid).length, 5);
  // a second purchase while this one runs (another device): refused, in his words
  const twice = await site.post('/api/me/formule', five(t.ids.Ben, 660), { 'x-request-id': rid(2) });
  assert.equal(twice.status, 409);
  assert.equal(twice.json.error.code, 'has_formule');
  // each date has its own page, which says « coupe 3 sur 5 » and what is due
  const view = (await browser(t.rt).get('/api/public/bookings/' + r.json.appts[2].token)).json;
  assert.deepEqual(view.formule, { n: 3, of: 5, name: 'Carnet 5 coupes', pay: 'due', due: 8000, end: '2026-12-09' });
  const contact = (await browser(t.rt).get('/api/public/contact/' + r.json.appts[0].token)).json;
  assert.deepEqual(contact.items.map((x) => x.formule && x.formule.n), [1, 2, 3, 4, 5]);
});

test('personal: never for another adult; for a child the parent’s account holds it and the child is served', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const cid = await signIn(t, site, '0612000002', 'Samir');
  const other = await site.post('/api/me/formule', { ...five(t.ids.Ali), guest: { kind: 'other', first: 'Bilal', phone: '0612000009' } });
  assert.equal(other.status, 400);
  assert.equal(other.json.error.code, 'personal');
  assert.equal(t.s().formules.size, 0);
  const r = await site.post('/api/me/formule', { ...five(t.ids.Ali), guest: { kind: 'child', first: 'léo', age: 9 } });
  assert.equal(r.status, 200, r.text);
  const f = formuleOf(t, cid);
  const kid = t.s().clients.get(f.guest.cid);
  assert.deepEqual([kid.first, kid.phone, kid.ext.parent], ['Léo', '', cid]);
  assert.ok(apptsOf(t, f.id).every((a) => a.clientId === cid && a.name === 'Léo' && a.ext.guest.cid === kid.id));
  // the parent may take his own beside his child's; not a second one for the same child
  assert.equal((await site.post('/api/me/formule', { ...five(t.ids.Ben, 660), guest: { kind: 'child', first: 'Léo' } })).json.error.code, 'has_formule');
  assert.equal((await site.post('/api/me/formule', five(t.ids.Ben, 660))).status, 200);
  // at the till the carnet is the parent's: the first ticket of the child's dates sells it and pays his cut
  go(t, FIRST, 10, 40);
  const a = apptsOf(t, f.id)[0];
  await t.run(S.checkout, { apptId: a.id, lines: [{ kind: 'pack', ref: t.ids.carnet }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  const pk = t.s().packs.get(t.s().formules.get(f.id).packId);
  assert.deepEqual([pk.clientId, pk.used, pk.total], [cid, 1, 5]);
  assert.equal(formuleOf(t, cid) && [...t.s().formules.values()].filter((x) => x.packId).length, 1, 'the other carnet (the parent’s own) is still to pay');
});

test('all five slots are kept together or none; a slot stolen while the code is typed refuses the purchase and books nothing', async () => {
  const t = await setup();
  const site = browser(t.rt), rival = browser(t.rt);
  const slots = [0, 1, 2, 3, 4].map((k) => ({ staffId: t.ids.Ali, day: addDays(FIRST, 7 * k), start: 600 }));
  // the rival already keeps week 3's slot: the visitor gets none
  const kept = await rival.post('/api/public/holds', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: slots[2].day, start: 600 });
  assert.equal(kept.status, 200, kept.text);
  const none = await site.post('/api/public/formule/holds', { slots });
  assert.equal(none.status, 409);
  assert.deepEqual(none.json.error.extra, { week: 2 });
  assert.equal([...t.s().holds.values()].filter((h) => h.id !== kept.json.holdId).length, 0, 'none of the five is kept');
  await rival.del('/api/public/holds/' + kept.json.holdId);
  const h = await site.post('/api/public/formule/holds', { slots });
  assert.equal(h.status, 200, h.text);
  assert.equal(h.json.holds.length, 5);
  assert.equal((await rival.post('/api/public/holds', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: slots[4].day, start: 600 })).status, 409, 'kept for him meanwhile');
  // changing one line keeps five holds, not ten
  const h2 = await site.post('/api/public/formule/holds', { slots: slots.map((x, i) => (i === 1 ? { ...x, start: 660 } : x)), replace: h.json.holds.map((x) => x.holdId) });
  assert.equal(h2.status, 200, h2.text);
  assert.equal(t.s().holds.size, 5);
  // the code takes too long: the holds lapse, the rival books week 4's slot
  await signIn(t, site, '0612000003', 'Hugo');
  t.clock.now += 7 * 60000;
  assert.equal((await rival.post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: slots[3].day, start: 600, first: 'Rival', phone: '0612000099' })).status, 201);
  const body = { first: { ...slots[0], holdId: h2.json.holds[0].holdId }, weeks: slots.slice(1).map((x, i) => ({ ...x, start: i === 0 ? 660 : 600, holdId: h2.json.holds[i + 1].holdId })) };
  const r = await site.post('/api/me/formule', body);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'taken');
  assert.deepEqual(r.json.error.extra, { week: 3 });
  assert.match(r.json.error.message, /jeudi 26 novembre/);
  assert.equal(t.s().formules.size, 0);
  assert.equal([...t.s().appts.values()].filter((a) => a.name !== 'Rival' && a.clientId !== t.s().clientByPhone.get(normPhone('0612000099'))).length, 0, 'nothing of the five is booked');
  // that line set to « je choisirai plus tard »: the four others are booked, the week stays to book
  const r2 = await site.post('/api/me/formule', { first: body.first, weeks: body.weeks.map((w, i) => (i === 2 ? { later: true } : w)) });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.appts.length, 4);
  const f = [...t.s().formules.values()][0];
  assert.deepEqual(weeksOf(t.s(), f, DAY).map((w) => w.state), ['booked', 'booked', 'booked', 'open', 'booked']);
});

test('paid at the salon: the first visit sells the carnet with its cut, each later visit takes one credit at 0 €, the beard is extra; then « Reprendre 5 coupes »', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const cid = await signIn(t, site, '0612000004', 'Malik');
  const r = await site.post('/api/me/formule', five(t.ids.Ali));
  assert.equal(r.status, 200, r.text);
  const f = () => t.s().formules.get(r.json.id);
  const appts = () => apptsOf(t, r.json.id);
  // the desk and the barber read « coupe 1 sur 5 », and the till knows the 80 € are due on this ticket
  const { formuleBrief } = await import('../../server/http/views.js');
  assert.deepEqual(formuleBrief(t.s(), appts()[0]), { id: r.json.id, n: 1, of: 5, pay: 'due', packId: null, sell: { serviceId: t.ids.carnet, name: 'Carnet 5 coupes', price: 8000 }, deposit: null });
  go(t, FIRST, 10, 40);
  // a cut on a carnet that does not exist yet cannot be had for nothing
  await rejects(t.run(S.checkout, { apptId: appts()[0].id, lines: [{ kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(0) }), 'not_found');
  const sale = await t.run(S.checkout, { apptId: appts()[0].id, lines: [{ kind: 'pack', ref: t.ids.carnet }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  assert.equal(sale.totals.due, 8000);
  const pk = () => t.s().packs.get(f().packId);
  assert.deepEqual([pk().used, pk().total, pk().expires, pk().weekly], [1, 5, '2026-12-09', true]);
  assert.deepEqual([f().startDay, f().expires], [FIRST, '2026-12-09']);
  assert.equal(formuleBrief(t.s(), appts()[1]).pay, 'paid');
  assert.equal(formuleBrief(t.s(), appts()[1]).sell, null);
  // the month counts the 80 € the day they were paid, as any carnet
  const { tillMonth } = await import('../../server/domain/till.js');
  assert.equal(tillMonth(t.s(), '2026-11', FIRST, t.clock.now).takings, 8000);
  // week 2 on the barber's phone: the cut is covered, the beard is paid as usual
  go(t, addDays(FIRST, 7), 10, 40);
  const tb = await t.run(addService, { name: 'Taille de barbe', category: 'Barbe', price: 1800, dur: 30 });
  await t.run(updateSettings, { team: { barberPhone: true, barberCheckout: true } });
  const s2 = await t.run(S.checkout, { apptId: appts()[1].id, phone: true, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk().id }, { kind: 'service', ref: tb.id }], payments: card(1800) }, t.asStaff('Ali'));
  assert.equal(s2.totals.due, 1800);
  assert.equal(pk().used, 2);
  // weeks 3 to 5 at 0 €; the last one sends « Reprendre 5 coupes », once
  for (const k of [2, 3, 4]) {
    go(t, addDays(FIRST, 7 * k), 10, 40);
    const x = await t.run(S.checkout, { apptId: appts()[k].id, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk().id }], payments: card(0) });
    assert.equal(x.totals.due, 0);
  }
  assert.equal(pk().used, 5);
  const renew = [...t.s().messages.values()].filter((m) => m.template === 'formuleRenew');
  assert.equal(renew.length, 1);
  assert.match(renew[0].body, /Malik, ton carnet est fini\. Reprendre 5 coupes : .*\?reserver&prestation=ab/);
  // no sixth cut on it, and /moi offers the next one
  go(t, addDays(FIRST, 30), 10, 0);
  const extra = await t.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(FIRST, 30), start: 660, force: true });
  go(t, addDays(FIRST, 30), 11, 40);
  await rejects(t.run(S.checkout, { apptId: extra.id, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk().id }], payments: card(0) }), 'pack_empty');
  const me = (await site.get('/api/me/formule')).json;
  assert.equal(me.renew, true);
  assert.deepEqual([me.items[0].status, me.items[0].used, me.items[0].left], ['ended', 5, 0]);
  assert.ok(me.items[0].weeks.every((w) => w.state === 'done'));
  // the owner refunds the unused part of a carnet by its line, as before (2 cuts taken of 5)
  const t2 = await setup();
  const b2 = browser(t2.rt);
  await signIn(t2, b2, '0612000014', 'Rayan');
  const r2 = await b2.post('/api/me/formule', five(t2.ids.Ali));
  go(t2, FIRST, 10, 40);
  const first = await t2.run(S.checkout, { apptId: apptsOf(t2, r2.json.id)[0].id, lines: [{ kind: 'pack', ref: t2.ids.carnet }, { kind: 'service', ref: t2.ids.cut, packId: 'new' }], payments: card(8000) });
  const plan = S.refundPlan(t2.s(), t2.s().sales.get(first.id));
  assert.equal(plan.lines.find((l) => l.kind === 'pack').pack.suggested, 6000, 'the price less the cut taken at its own price');
});

test('the first cut missed with nothing paid: the four other dates are freed and the client told once; with a cut done they stay', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const cid = await signIn(t, site, '0612000005', 'Idriss');
  const r = await site.post('/api/me/formule', five(t.ids.Ali));
  const ids = r.json.appts.map((x) => t.s().apptByCode.get(x.code));
  // absent at the first date
  go(t, FIRST, 10, 20);
  const res = await t.run(A.setStatus, { id: ids[0], status: 'no_show' });
  assert.deepEqual(res.formule, { released: 4 });
  assert.deepEqual(ids.map((id) => t.s().appts.get(id).status), ['no_show', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);
  assert.equal(t.s().appts.get(ids[1]).cancel.reason, F.RELEASE_REASON);
  assert.equal(t.s().formules.get(r.json.id).status, 'released');
  const notice = [...t.s().messages.values()].filter((m) => m.template === 'formuleReleased');
  assert.equal(notice.length, 1);
  assert.match(notice[0].body, /Idriss, 1re coupe manquée et carnet non payé : tes 4 autres rendez-vous sont libérés/);
  assert.equal(notice[0].cid, cid);
  assert.equal(t.s().packs.size, 0, 'no credit was ever given');
  // the slots are back on the site
  const av = (await browser(t.rt).get(`/api/public/availability?services=${t.ids.cut}&staff=${t.ids.Ali}&from=${addDays(FIRST, 7)}&days=1&fresh=1`)).json.days[0].slots;
  assert.ok(av.some((x) => x.m === 600));
  // he may start again
  assert.equal((await site.post('/api/me/formule', five(t.ids.Ali, 600, addDays(FIRST, 7)))).status, 200);

  // cancelled by the salon inside the window (too late): the same; in time by the client: the four others stay
  const u = await setup();
  const b = browser(u.rt);
  await signIn(u, b, '0612000006', 'Noam');
  const r2 = await b.post('/api/me/formule', five(u.ids.Ali));
  const id2 = r2.json.appts.map((x) => u.s().apptByCode.get(x.code));
  assert.equal((await b.post('/api/public/bookings/' + r2.json.appts[0].token + '/cancel', {})).status, 200, 'more than 12 h before: free');
  assert.deepEqual(id2.map((id) => u.s().appts.get(id).status), ['cancelled', 'booked', 'booked', 'booked', 'booked']);
  assert.equal(u.s().formules.get(r2.json.id).status, 'open');
  go(u, addDays(FIRST, 7), 8, 0); // two hours before what is now the first date
  const late = await u.run(A.cancelAppointment, { id: id2[1], reason: 'Appel du client' });
  assert.deepEqual(late.formule, { released: 3 });
  assert.deepEqual(id2.map((id) => u.s().appts.get(id).status), ['cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);

  // once the carnet is paid, a missed week is only lost
  const v = await setup();
  const c = browser(v.rt);
  await signIn(v, c, '0612000007', 'Sofiane');
  const r3 = await c.post('/api/me/formule', five(v.ids.Ali));
  const id3 = r3.json.appts.map((x) => v.s().apptByCode.get(x.code));
  go(v, FIRST, 10, 40);
  await v.run(S.checkout, { apptId: id3[0], lines: [{ kind: 'pack', ref: v.ids.carnet }, { kind: 'service', ref: v.ids.cut, packId: 'new' }], payments: card(8000) });
  go(v, addDays(FIRST, 7), 10, 20);
  const miss = await v.run(A.setStatus, { id: id3[1], status: 'no_show' });
  assert.equal(miss.formule, undefined);
  assert.deepEqual(id3.map((id) => v.s().appts.get(id).status), ['done', 'no_show', 'booked', 'booked', 'booked']);
  go(v, addDays(FIRST, 14), 9, 0);
  const f = v.s().formules.get(r3.json.id);
  assert.deepEqual(weeksOf(v.s(), f, addDays(FIRST, 14)).map((w) => w.state), ['done', 'lost', 'booked', 'booked', 'booked']);
  assert.deepEqual(rankOf(v.s(), id3[2]), { n: 2, of: 5 }, 'the cut after a lost week is the second one taken');
});

test('a missed week made up once: 42 days, a sixth week once one is lost, booked from /moi in one tap', async () => {
  const t = await setup({ missed: 'once' });
  assert.equal(t.s().services.get(t.ids.carnet).pack.days, 42);
  const site = browser(t.rt);
  await signIn(t, site, '0612000008', 'Enzo');
  const r = await site.post('/api/me/formule', five(t.ids.Ali));
  const ids = r.json.appts.map((x) => t.s().apptByCode.get(x.code));
  go(t, FIRST, 10, 40);
  await t.run(S.checkout, { apptId: ids[0], lines: [{ kind: 'pack', ref: t.ids.carnet }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  assert.equal(t.s().packs.get(t.s().formules.get(r.json.id).packId).expires, '2026-12-16');
  let me = (await site.get('/api/me/formule')).json.items[0];
  assert.equal(me.weeks.length, 5, 'no sixth week while none is lost');
  // he cancels week 2 in time and lets it pass
  assert.equal((await site.post('/api/public/bookings/' + r.json.appts[1].token + '/cancel', {})).status, 200);
  go(t, addDays(FIRST, 14), 9, 0);
  me = (await site.get('/api/me/formule')).json.items[0];
  assert.deepEqual(me.weeks.map((w) => w.state), ['done', 'lost', 'booked', 'booked', 'booked', 'open']);
  const todo = (await site.get('/api/me/todo')).json.items;
  const wk = todo.find((x) => x.id === 'fo_wk_' + r.json.id + '_5');
  assert.deepEqual(wk.action, { kind: 'formule', label: 'Réserver cette semaine', formule: r.json.id, week: 5 });
  // the usual slot of that week, booked in one tap
  const w = (await site.get('/api/me/formule/' + r.json.id + '/weeks/5')).json;
  assert.deepEqual(w.proposal, { day: '2026-12-10', start: 600, staffId: t.ids.Ali });
  const ok = await site.post('/api/me/formule/' + r.json.id + '/weeks', w.proposal);
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.items[0].weeks.map((x) => x.state), ['done', 'lost', 'booked', 'booked', 'booked', 'booked']);
  assert.equal((await site.post('/api/me/formule/' + r.json.id + '/weeks', { day: '2026-12-11', start: 600, staffId: t.ids.Ali })).status, 409, 'one a week, and five in all');
  // « perdue » (the default): the same story leaves nothing to book
  const u = await setup();
  const b = browser(u.rt);
  await signIn(u, b, '0612000018', 'Tom');
  const r2 = await b.post('/api/me/formule', five(u.ids.Ali));
  go(u, FIRST, 10, 40);
  await u.run(S.checkout, { apptId: u.s().apptByCode.get(r2.json.appts[0].code), lines: [{ kind: 'pack', ref: u.ids.carnet }, { kind: 'service', ref: u.ids.cut, packId: 'new' }], payments: card(8000) });
  await b.post('/api/public/bookings/' + r2.json.appts[1].token + '/cancel', {});
  go(u, addDays(FIRST, 14), 9, 0);
  assert.deepEqual((await b.get('/api/me/formule')).json.items[0].weeks.map((x) => x.state), ['done', 'lost', 'booked', 'booked', 'booked']);
  assert.equal((await b.get('/api/me/formule/' + r2.json.id + '/weeks/1')).status, 409);
});

test('each date moves and cancels on its own, one cut a week inside the five weeks; the salon changing the barber keeps the count', async () => {
  const t = await setup();
  const site = browser(t.rt);
  await signIn(t, site, '0612000009', 'Yassine');
  const r = await site.post('/api/me/formule', five(t.ids.Ali));
  const tok = r.json.appts.map((x) => x.token);
  const ids = r.json.appts.map((x) => t.s().apptByCode.get(x.code));
  // week 3 to another day and hour of its week: fine
  const mv = await site.post('/api/public/bookings/' + tok[2] + '/move', { day: '2026-11-20', start: 660 });
  assert.equal(mv.status, 200, mv.text);
  // into a week that has its cut, or after the five weeks: refused in plain words
  const same = await site.post('/api/public/bookings/' + tok[2] + '/move', { day: '2026-11-27', start: 660 });
  assert.equal(same.json.error.code, 'weeks');
  assert.match(same.json.error.message, /Une coupe par semaine/);
  const far = await site.post('/api/public/bookings/' + tok[4] + '/move', { day: '2026-12-10', start: 600 });
  assert.equal(far.json.error.code, 'weeks');
  assert.match(far.json.error.message, /5 semaines d’affilée/);
  // Ali leaves: the salon gives week 4 to Ben; it is still « coupe 4 sur 5 »
  await t.run(A.moveAppointment, { id: ids[3], day: '2026-11-26', start: 600, staffId: t.ids.Ben });
  assert.deepEqual(rankOf(t.s(), ids[3]), { n: 4, of: 5 });
  assert.equal(t.s().appts.get(ids[3]).staffId, t.ids.Ben);
  // a barber books and moves his own chair only
  await rejects(t.run(F.bookFormule, { clientId: t.ids.yanis, ...five(t.ids.Ali, 720) }, t.asStaff('Ben')), 'forbidden');
});

test('the desk sells it and books the five dates in one go; a carnet already paid at the till gets its dates with nothing more to pay', async () => {
  const t = await setup();
  const res = await t.run(F.bookFormule, { client: { first: 'Walid', phone: '0612000010' }, ...five(t.ids.Ben, 720) });
  assert.equal(res.pay, 'salon');
  const cid = t.s().clientByPhone.get(normPhone('0612000010'));
  assert.deepEqual(res.appts.map((a) => [a.day, a.start, a.staffId, a.status]), [0, 1, 2, 3, 4].map((k) => [addDays(FIRST, 7 * k), 720, t.ids.Ben, 'booked']));
  assert.ok(apptsOf(t, res.id).every((a) => a.source === 'salon' && a.clientId === cid));
  await rejects(t.run(F.bookFormule, { clientId: cid, ...five(t.ids.Ali, 780) }), 'has_formule');
  await rejects(t.run(F.bookFormule, { ...five(t.ids.Ali, 780) }), 'invalid');
  // a taken slot refuses the whole sheet and says which line
  const e = await rejects(t.run(F.bookFormule, { clientId: t.ids.yanis, ...five(t.ids.Ben, 720) }), 'taken');
  assert.deepEqual(e.extra, { week: 0 });
  assert.equal(formuleOf(t, t.ids.yanis), undefined);
  // paid at the till before any date (a free sale): the dates fixed after cost nothing more, the weeks run from the first
  await t.run(S.checkout, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.carnet }], payments: card(8000) });
  const pk = [...t.s().packs.values()].find((k) => k.clientId === t.ids.yanis);
  assert.equal(pk.expires, addDays(DAY, 34));
  const r2 = await t.run(F.bookFormule, { clientId: t.ids.yanis, ...five(t.ids.Ali, 840) });
  assert.equal(r2.paid, true);
  const f = t.s().formules.get(r2.id);
  assert.deepEqual([f.packId, f.startDay, t.s().packs.get(pk.id).expires], [pk.id, FIRST, '2026-12-09']);
  const { formuleBrief } = await import('../../server/http/views.js');
  assert.deepEqual([formuleBrief(t.s(), apptsOf(t, r2.id)[0]).pay, formuleBrief(t.s(), apptsOf(t, r2.id)[0]).sell], ['paid', null]);
  // the other way round: dates first at the desk, then the 80 € on a ticket without the appointment: the same carnet
  await t.run(S.checkout, { clientId: cid, lines: [{ kind: 'pack', ref: t.ids.carnet }], payments: card(8000) });
  assert.ok(t.s().formules.get(res.id).packId, 'the ticket paid his formule');
  assert.equal(t.s().packs.get(t.s().formules.get(res.id).packId).expires, '2026-12-09');
});

test('online (demo): the five dates wait for the 80 €, are confirmed together by one payment told once or twice, and all go if it never comes', async () => {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = () => rt.engine.state;
  const site = browser(rt);
  const pub = (await site.get('/api/public/salon')).json;
  const carnet = pub.services.find((x) => x.pack && x.pack.weekly);
  assert.ok(carnet, 'the demo sells it online');
  assert.equal(pub.payments.live, true);
  const cut = carnet.pack.serviceIds[0];
  // a first slot a week ahead, then what the site proposes
  const day0 = addDays(DAY, 9);
  const av = (await site.get(`/api/public/availability?services=${cut}&from=${day0}&days=3&fresh=1`)).json.days.find((d) => d.slots.length);
  const first = { staffId: av.slots[0].s, day: av.day, start: av.slots[0].m };
  const series = (await site.get(`/api/public/formule/series?staff=${first.staffId}&day=${first.day}&start=${first.start}`)).json.weeks;
  assert.equal(series.length, 4);
  const weeks = series.map((w) => (w.none ? { later: true } : { staffId: w.staffId, day: w.day, start: w.start }));
  // the demo hands the code of a visitor's own fresh number on the page, never a seeded client's
  const j = await site.post('/api/public/account/join', { first: 'Démo', phone: '0600123456' });
  assert.match(j.json.demoCode, /^\d{6}$/);
  const seeded = [...s().clients.values()].find((c) => c.phone && !c.erased && c.source !== 'site');
  assert.equal((await browser(rt).post('/api/public/account/join', { first: seeded.first, phone: seeded.phone })).json.demoCode, undefined);
  assert.equal((await site.post('/api/public/account/verify', { phone: '0600123456', code: j.json.demoCode, first: 'Démo' })).status, 200);
  const cid = s().clientByPhone.get(normPhone('0600123456'));
  const r = await site.post('/api/me/formule', { first, weeks }, { 'x-request-id': rid(31) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.pay, 'online');
  assert.ok(r.json.payment && r.json.payment.url);
  const f = () => [...s().formules.values()].find((x) => x.clientId === cid);
  const list = () => f().apptIds.map((id) => s().appts.get(id));
  assert.ok(list().every((a) => a.status === 'pending'));
  assert.deepEqual([list()[0].deposit.amount, list()[1].deposit], [8000, null]);
  assert.equal([...s().messages.values()].filter((m) => m.cid === cid && m.template === 'confirmation').length, 0, 'no confirmation before the money');
  // the answer lost, tried again: the same page to pay on, not a second one
  const again = await site.post('/api/me/formule', { first, weeks }, { 'x-request-id': rid(31) });
  assert.equal(again.json.payment.id, r.json.payment.id);
  assert.equal([...s().payments.values()].filter((p) => p.apptId === list()[0].id).length, 1);
  let me = (await site.get('/api/me/formule')).json.items[0];
  assert.equal(me.pay, 'pending');
  const todo = (await site.get('/api/me/todo')).json.items.find((x) => x.id === 'dep_' + list()[0].code);
  assert.deepEqual([todo.title, todo.amount], ['Carnet à régler', 8000]);
  // paid: the five are confirmed, one text; the provider repeating itself changes nothing
  const paid = await site.post('/api/public/payments/' + r.json.payment.id + '/simulate', {});
  assert.equal(paid.json.status, 'paid');
  assert.ok(list().every((a) => a.status === 'booked'));
  const py = s().payments.get(r.json.payment.id);
  const v = rt.engine.version;
  await rt.engine.run(paymentSucceeded, { providerRef: py.providerRef, amount: 8000 }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set(), meta: {} });
  assert.equal(rt.engine.version, v, 'the second notice writes nothing');
  assert.equal([...s().messages.values()].filter((m) => m.cid === cid && m.template === 'confirmation' && m.channel === 'sms').length, 1);
  me = (await site.get('/api/me/formule')).json.items[0];
  assert.equal(me.pay, 'online');
  assert.equal(s().packs.size > 0 && [...s().packs.values()].some((k) => k.clientId === cid), false, 'the carnet exists once a ticket took the money');
  // absent at the first date: nothing is freed (it is paid); the 80 € pay the ticket of the next date
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const { capsOf } = await import('../../server/domain/permissions.js');
  const asOwner = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) };
  const a0 = list()[0];
  clock.now = at(a0.day, Math.floor(a0.start / 60), (a0.start % 60) + 20);
  const miss = await rt.engine.run(A.setStatus, { id: a0.id, status: 'no_show' }, asOwner);
  assert.equal(miss.formule, undefined);
  assert.ok(list().slice(1).every((a) => a.status === 'booked'));
  const keep = await (async () => { const b = browser(rt); await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password }); return b.post('/api/v1/payments/' + py.id + '/keep', {}); })();
  assert.equal(keep.status, 409, 'not kept as a missed deposit while dates remain');
  const a1 = list()[1];
  clock.now = at(a1.day, Math.floor(a1.start / 60), (a1.start % 60) + 40);
  const { formuleBrief } = await import('../../server/http/views.js');
  const brief = formuleBrief(s(), a1);
  assert.deepEqual([brief.n, brief.pay, brief.deposit], [1, 'online', { paymentId: py.id, paid: 8000 }]);
  const sale = await rt.engine.run(S.checkout, { apptId: a1.id, lines: [{ kind: 'pack', ref: carnet.id }, { kind: 'service', ref: cut, packId: 'new' }], payments: [{ method: 'deposit', amount: 8000, ref: py.id }] }, asOwner);
  assert.equal(sale.totals.due, 8000);
  const pk = s().packs.get(f().packId);
  assert.deepEqual([pk.used, pk.expires], [1, addDays(a0.day, 34)], 'the weeks run from the first date, missed or not');

  // never paid: at the deadline the tick frees the five
  const b2 = browser(rt);
  const j2 = await b2.post('/api/public/account/join', { first: 'Démo', phone: '0600123457' });
  await b2.post('/api/public/account/verify', { phone: '0600123457', code: j2.json.demoCode, first: 'Démo' });
  const day1 = addDays(a1.day, 3);
  const av2 = (await b2.get(`/api/public/availability?services=${cut}&from=${day1}&days=4&fresh=1`)).json.days.find((d) => d.slots.length);
  const f2 = { staffId: av2.slots[0].s, day: av2.day, start: av2.slots[0].m };
  const w2 = (await b2.get(`/api/public/formule/series?staff=${f2.staffId}&day=${f2.day}&start=${f2.start}`)).json.weeks.map((w) => (w.none ? { later: true } : { staffId: w.staffId, day: w.day, start: w.start }));
  const r2 = await b2.post('/api/me/formule', { first: f2, weeks: w2 });
  assert.equal(r2.status, 200, r2.text);
  const cid2 = s().clientByPhone.get(normPhone('0600123457'));
  const mine = () => [...s().appts.values()].filter((a) => a.clientId === cid2);
  assert.ok(mine().length >= 2 && mine().every((a) => a.status === 'pending'));
  clock.now += 40 * 60000;
  await rt.engine.run(tick, {}, { actor: { t: 'system', id: 'tick' }, caps: new Set(), meta: {} });
  assert.ok(mine().every((a) => a.status === 'cancelled'), 'every date is given back');
  // a payment that comes after that is refused as late (the route gives it back)
  const late = await rt.engine.run(paymentSucceeded, { id: r2.json.payment.id, amount: 8000 }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set(), meta: {} });
  assert.equal(late.late, true);
  assert.ok(mine().every((a) => a.status === 'cancelled'));
});
