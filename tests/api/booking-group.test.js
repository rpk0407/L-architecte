// A booking of several people seen as one, and shareable: the organiser's recap (each person, service, price, the total),
// « Envoyer à mes amis » with a private link per friend, what each link may open (a friend: his own place, never the
// others', never the organiser's other bookings or anyone's number), and the till: the whole group on one ticket, or each
// person separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser, ORIGIN } from './client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import { DEMO } from '../../server/domain/seed.js';
import { signLink } from '../../server/auth/session.js';
import * as S from '../../server/commands/sales.js';
import { capsOf } from '../../server/domain/permissions.js';

const DAY = '2026-11-03'; // a Tuesday
async function setup() {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = () => rt.engine.state;
  const site = browser(rt);
  const info = (await site.get('/api/public/salon')).json;
  const sv = info.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit) || info.services[0];
  const day = addDays(DAY, 2);
  const av = (await site.get(`/api/public/availability?services=${sv.id}&from=${day}&days=1&fresh=1`)).json.days[0].slots;
  return { rt, s, site, sv, day, av, clock };
}
/** Karim books for himself, Adam (a friend with his own number) and Yanis (a friend without one), and one more visit of his own. */
async function group(t) {
  const { site, sv, day, av } = t;
  const m = av[0].m;
  const solo = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day: addDays(day, 1), start: m, first: 'Karim', last: 'Belkacem', phone: '0612000071', sms: true });
  assert.equal(solo.status, 201, JSON.stringify(solo.json));
  const r = await site.post('/api/public/bookings', {
    serviceIds: [sv.id], staffId: 'any', day, start: m, first: 'Karim', last: 'Belkacem', phone: '0612000071', sms: true,
    others: [{ serviceIds: [sv.id], staffId: 'any', day, start: m, guest: { kind: 'other', first: 'Adam', phone: '0612000072' } }, { serviceIds: [sv.id], staffId: 'any', day, start: m + 30, guest: { kind: 'other', first: 'Yanis' } }]
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const appts = r.json.people.map((p) => [...t.s().appts.values()].find((x) => x.code === p.code));
  return { r, solo, appts, m };
}
const get = (b, token) => b.get('/api/public/bookings/' + encodeURIComponent(token));

test('the organiser: one confirmation, one recap with each person, service and price, the total, and the text for his friends', async () => {
  const t = await setup();
  const { r, appts } = await group(t);
  const conf = [...t.s().messages.values()].filter((x) => x.template === 'confirmation' && x.apptId === appts[0].id);
  assert.equal(conf.length, 1, 'one confirmation to the organiser for the places he follows');
  // the answer of the booking carries the recap and the text to share
  assert.equal(r.json.group.by, 'Karim');
  assert.equal(r.json.group.total, t.sv.price * 3);
  // his page: everyone, each price, the total
  const v = (await get(t.site, r.json.token)).json;
  assert.equal(v.group.organiser, true);
  assert.deepEqual(v.group.people.map((p) => [p.first, p.organiser, p.price, p.services.join()]), [['Karim', true, t.sv.price, t.sv.name], ['Adam', false, t.sv.price, t.sv.name], ['Yanis', false, t.sv.price, t.sv.name]]);
  assert.deepEqual([v.group.size, v.group.total], [3, t.sv.price * 3]);
  // the text: who, what, when, with whom, the address, a private link per friend; no number, and no link for his own place
  const text = v.group.share.text;
  assert.match(text, /^Karim a réservé pour 3 chez /);
  for (const w of ['• Karim : ' + t.sv.name, '• Adam : ' + t.sv.name, '• Yanis : ' + t.sv.name, 'Adresse : ', ' avec ']) assert.ok(text.includes(w), w + '\n' + text);
  const links = [...text.matchAll(/Ta place \(voir, déplacer, annuler\) : (\S+)/g)].map((x) => x[1]);
  assert.equal(links.length, 2, 'one link per friend, none for the organiser');
  assert.ok(links.every((l) => l.startsWith(ORIGIN + '/r/')));
  assert.ok(!/06 ?12|0612|\+33/.test(text), 'no phone number in the text');
  assert.ok(!text.includes(r.json.token), 'the organiser’s own link is not in the text');
  assert.deepEqual(v.group.people.map((p) => (p.link ? links.includes(p.link) : null)), [null, true, true]);
});

test('a friend’s link opens his own place only: he sees, moves and cancels it; nothing of the others, nothing of the organiser', async () => {
  const t = await setup();
  const { r, solo, appts } = await group(t);
  const org = (await get(t.site, r.json.token)).json;
  const friend = browser(t.rt);
  for (const i of [1, 2]) {
    const token = org.group.people[i].link.split('/r/')[1];
    const v = await get(friend, token);
    assert.equal(v.status, 200, v.text);
    assert.equal(v.json.code, appts[i].code);
    assert.equal(v.json.guestLink, true);
    assert.deepEqual(v.json.group, { organiser: false, by: 'Karim', size: 3 }, 'who organised it and how many, nothing else');
    const raw = JSON.stringify(v.json);
    for (const leak of ['0612000071', '0612000072', '06 12 00 00 7', '+33612', appts[0].code, solo.json.code, r.json.token, 'share', 'people']) assert.ok(!raw.includes(leak), 'leaks ' + leak);
    // the contact pages (every booking to come of a number, how the salon reaches it) never open with a friend's link
    assert.equal((await friend.get('/api/public/contact/' + encodeURIComponent(token))).status, 404);
    assert.equal((await friend.post('/api/public/contact/' + encodeURIComponent(token) + '/earlier', { code: solo.json.code, on: true })).status, 404);
    assert.equal((await friend.post('/api/public/contact/' + encodeURIComponent(token) + '/notify', { via: 'sms' })).status, 404);
    // and it is not a key to the client space
    assert.notEqual((await friend.post('/api/me/code', { token })).status, 200);
  }
  // Yanis has no number of his own: his code is in his link and he knows Karim's number; together they open his place only
  const found = await browser(t.rt).post('/api/public/find', { code: appts[2].code, phone: '0612000071' });
  assert.equal(found.status, 200);
  assert.equal((await browser(t.rt).get('/api/public/contact/' + encodeURIComponent(found.json.token))).status, 404);
  assert.equal((await get(browser(t.rt), found.json.token)).json.code, appts[2].code);
  // Yanis cancels his place with his link: the two others stay
  const yan = org.group.people[2].link.split('/r/')[1];
  assert.equal((await friend.post('/api/public/bookings/' + encodeURIComponent(yan) + '/cancel', {})).status, 200);
  assert.deepEqual(appts.map((a) => t.s().appts.get(a.id).status), ['booked', 'booked', 'cancelled']);
  // a friend's link is signed for that use: the same code signed for nothing opens nothing
  assert.equal((await get(friend, appts[1].code + '.AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
});

test('the organiser keeps control of every place, and never gets his friend’s other bookings', async () => {
  const t = await setup();
  const { r, solo, appts } = await group(t);
  // Adam has another booking of his own, made with his own number
  const d2 = addDays(t.day, 2);
  const free = (await t.site.get(`/api/public/availability?services=${t.sv.id}&from=${d2}&days=1&fresh=1`)).json.days[0].slots;
  const own = await browser(t.rt).post('/api/public/bookings', { serviceIds: [t.sv.id], staffId: 'any', day: d2, start: free[0].m, first: 'Adam', phone: '0612000072', sms: true });
  assert.equal(own.status, 201, JSON.stringify(own.json));
  const org = (await get(t.site, r.json.token)).json;
  // his contact list: his own two bookings and the places he booked, « pour Adam », « pour Yanis »
  const list = (await t.site.get('/api/public/contact/' + encodeURIComponent(r.json.token))).json.items;
  assert.deepEqual(list.map((x) => x.code).sort(), [solo.json.code, ...appts.map((a) => a.code)].sort());
  assert.ok(!list.some((x) => x.code === own.json.code));
  // the token he holds for Adam's place opens that place, and neither Adam's other booking nor Adam's contact page
  for (const token of [org.group.people[1].token, list.find((x) => x.code === appts[1].code).token, r.json.people[1].token]) {
    assert.equal((await get(t.site, token)).json.code, appts[1].code);
    assert.equal((await t.site.get('/api/public/contact/' + encodeURIComponent(token))).status, 404, 'Adam’s bookings are his own');
  }
  // he cancels Adam's place; Adam, with the link of his own confirmation text, still sees his own bookings only
  assert.equal((await t.site.post('/api/public/bookings/' + encodeURIComponent(org.group.people[1].token) + '/cancel', {})).status, 200);
  assert.equal(t.s().appts.get(appts[1].id).status, 'cancelled');
  const adam = (await browser(t.rt).get('/api/public/contact/' + encodeURIComponent(signLink(t.rt.secret, 'appt', appts[1].code)))).json.items;
  assert.deepEqual(adam.map((x) => x.code), [own.json.code]);
  // the recap follows: two people left, the total with them
  const after = (await get(t.site, r.json.token)).json.group;
  assert.deepEqual([after.size, after.total, after.people.map((p) => p.first)], [2, t.sv.price * 2, ['Karim', 'Yanis']]);
});

test('the Comptoir: « Groupe de Karim · 3 personnes », the whole group on one ticket, or each person separately', async () => {
  const t = await setup();
  const { appts, r } = await group(t);
  // « Laisser un avis » is not on the page of a visit still to come
  assert.equal((await get(t.site, r.json.token)).json.reviewUrl, undefined);
  t.clock.now = at(t.day, 12, 0);
  const b = browser(t.rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  // the agenda and the sheet say it
  const dayRes = await b.get('/api/v1/agenda?day=' + t.day);
  assert.equal(dayRes.status, 200, dayRes.text);
  const day = dayRes.json;
  const mine = day.appts.filter((x) => appts.some((a) => a.id === x.id));
  assert.deepEqual(mine.map((x) => x.group && [x.group.by, x.group.size]), [['Karim', 3], ['Karim', 3], ['Karim', 3]]);
  const sheet = (await b.get('/api/v1/appointments/' + appts[0].id)).json.appt;
  assert.deepEqual(sheet.group.members.map((m) => [m.first, m.organiser, m.price, m.paid]), [['Karim', true, t.sv.price, false], ['Adam', false, t.sv.price, false], ['Yanis', false, t.sv.price, false]]);
  assert.equal(sheet.group.total, t.sv.price * 3);
  // one ticket for the three: every place is closed by it, each barber keeps his line
  const owner = [...t.s().staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, t.s().settings) };
  const line = (a) => ({ kind: 'service', ref: t.sv.id, staffId: a.staffId });
  if (!t.s().drawer) await t.rt.engine.run(S.openDrawer, { float: 10000 }, as);
  // refused: a booking that is not of the group
  const other = [...t.s().appts.values()].find((x) => x.day === t.day && !(x.ext && x.ext.group) && x.status === 'booked');
  if (other) await assert.rejects(t.rt.engine.run(S.checkout, { apptId: appts[0].id, groupApptIds: [other.id], lines: [line(appts[0])], payments: [{ method: 'card', amount: t.sv.price }] }, as), (e) => e.code === 'group');
  const sale = await t.rt.engine.run(S.checkout, { apptId: appts[0].id, groupApptIds: [appts[1].id, appts[2].id], lines: appts.map(line), payments: [{ method: 'card', amount: t.sv.price * 3 }] }, as);
  assert.equal(sale.totals.due, t.sv.price * 3);
  assert.deepEqual(appts.map((a) => [t.s().appts.get(a.id).status, t.s().appts.get(a.id).saleId]), appts.map(() => ['done', sale.id]));
  assert.deepEqual(t.s().sales.get(sale.id).lines.map((l) => l.staffId), appts.map((a) => a.staffId));
  assert.equal([...t.s().sales.values()].filter((x) => appts.some((a) => a.id === x.apptId)).length, 1, 'one ticket');
  // nothing left to ring up for them, and a second ticket is refused
  await assert.rejects(t.rt.engine.run(S.checkout, { apptId: appts[1].id, lines: [line(appts[1])], payments: [{ method: 'card', amount: t.sv.price }] }, as), (e) => e.code === 'paid');
  // once the visit is done, every place's page carries the salon's review link (the same for all: no question, no reward)
  for (const p of r.json.people) assert.match((await get(t.site, p.token)).json.reviewUrl || '', /^https:\/\//);
  const paid = (await b.get('/api/v1/appointments/' + appts[1].id)).json.appt;
  assert.deepEqual(paid.group.members.map((m) => m.paid), [true, true, true]);

  // each person separately: three tickets, and the third cannot be put on a ticket twice
  const t2 = await setup();
  const g2 = await group(t2);
  t2.clock.now = at(t2.day, 12, 0);
  const o2 = [...t2.s().staff.values()].find((x) => x.role === 'owner');
  const as2 = { actor: { t: 'staff', id: o2.id }, staff: o2, caps: capsOf(o2, t2.s().settings) };
  if (!t2.s().drawer) await t2.rt.engine.run(S.openDrawer, { float: 10000 }, as2);
  const one = (a) => t2.rt.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t2.sv.id, staffId: a.staffId }], payments: [{ method: 'card', amount: t2.sv.price }] }, as2);
  const s1 = await one(g2.appts[0]);
  await assert.rejects(t2.rt.engine.run(S.checkout, { apptId: g2.appts[1].id, groupApptIds: [g2.appts[0].id], lines: g2.appts.slice(0, 2).map((a) => ({ kind: 'service', ref: t2.sv.id, staffId: a.staffId })), payments: [{ method: 'card', amount: t2.sv.price * 2 }] }, as2), (e) => e.code === 'paid');
  const s2 = await one(g2.appts[1]);
  const s3 = await one(g2.appts[2]);
  assert.equal(new Set([s1.id, s2.id, s3.id]).size, 3);
  assert.deepEqual(g2.appts.map((a) => t2.s().appts.get(a.id).saleId), [s1.id, s2.id, s3.id]);
});
