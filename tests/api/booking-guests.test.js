// Booking for someone else on the site: another adult (his first name, his phone if given), a child (a file linked to
// the parent, no phone), and several people in one booking (all or none, each cancellable on his own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import { DEMO } from '../../server/domain/seed.js';

const DAY = '2026-11-03'; // a Tuesday
async function demo() {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  return { rt, s: () => rt.engine.state };
}
async function setup() {
  const t = await demo();
  const site = browser(t.rt);
  const info = (await site.get('/api/public/salon')).json;
  // a service with no deposit: the booking is confirmed at once
  const sv = info.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit) || info.services[0];
  const day = addDays(DAY, 2);
  const av = (await site.get(`/api/public/availability?services=${sv.id}&from=${day}&days=1&fresh=1`)).json.days[0].slots;
  return { ...t, site, sv, day, av };
}
async function owner(rt) {
  const b = browser(rt);
  const r = await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal(r.status, 200);
  return b;
}

test('a parent books for his child: the parent is the contact, the child gets his own file without a phone, reused next time', async () => {
  const { rt, s, site, sv, day, av } = await setup();
  const slot = av[0];
  const body = { serviceIds: [sv.id], staffId: slot.s, day, start: slot.m, first: 'Karim', last: 'Belkacem', phone: '0612000001', guest: { kind: 'child', first: 'léo', age: 8 } };
  const r = await site.post('/api/public/bookings', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = [...s().appts.values()].find((x) => x.code === r.json.code);
  const parent = s().clients.get(a.clientId);
  assert.equal(parent.first, 'Karim', 'the booker stays the contact');
  assert.equal(a.name, 'Léo');
  assert.equal(a.ext.guest.kind, 'child');
  const child = s().clients.get(a.ext.guest.cid);
  assert.equal(child.first, 'Léo');
  assert.equal(child.phone, '', 'no phone for the child');
  assert.equal(child.ext.parent, parent.id, 'linked to the parent');
  assert.match(child.notes, /^8 ans/);
  // the confirmation goes to the parent and names the child
  const msg = [...s().messages.values()].find((m) => m.apptId === a.id && m.template === 'confirmation');
  assert.ok(msg, 'a confirmation');
  assert.equal(msg.to, parent.phone);
  assert.match(msg.body, /pour Léo/);
  // the agenda and the barber read « Léo (enfant de Karim B.) »
  const b = await owner(rt);
  const ag = (await b.get('/api/v1/agenda?day=' + day)).json;
  const row = ag.appts.find((x) => x.id === a.id);
  assert.equal(row.name, 'Léo (enfant de Karim B.)');
  // the booking's own page shows the child's name, nothing of a file
  const view = (await site.get('/api/public/bookings/' + r.json.token)).json;
  assert.equal(view.first, 'Léo');
  assert.equal(view.guest, 'child');
  // booked again (another day): the same child file
  const day2 = addDays(day, 1);
  const s2 = (await site.get(`/api/public/availability?services=${sv.id}&from=${day2}&days=1&fresh=1`)).json.days[0].slots[0];
  const r2 = await site.post('/api/public/bookings', { ...body, day: day2, start: s2.m, staffId: s2.s, guest: { kind: 'child', first: 'Léo' } });
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  const a2 = [...s().appts.values()].find((x) => x.code === r2.json.code);
  assert.equal(a2.ext.guest.cid, child.id, 'the same child keeps his file');
  assert.equal([...s().clients.values()].filter((c) => c.ext && c.ext.parent === parent.id).length, 1);
});

test('for another adult: without his phone the texts go to the booker; with it, to him, and nothing of his file is shown back', async () => {
  const { rt, s, site, sv, day, av } = await setup();
  const r = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: av[0].s, day, start: av[0].m, first: 'Nadia', phone: '0612000002', guest: { kind: 'other', first: 'Marc' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = [...s().appts.values()].find((x) => x.code === r.json.code);
  assert.equal(s().clients.get(a.clientId).first, 'Nadia');
  assert.equal(a.name, 'Marc');
  const b = await owner(rt);
  assert.equal((await b.get('/api/v1/agenda?day=' + day)).json.appts.find((x) => x.id === a.id).name, 'Marc (réservé par Nadia)');
  // an existing client's number given as the guest's: the place lands on his file, the page shows only the typed name
  const known = [...s().clients.values()].find((c) => c.phone && !c.erased && c.first && c.first !== 'Sam');
  const slot = av.find((x) => x.m !== av[0].m || x.s !== av[0].s);
  const r2 = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: slot.s, day, start: slot.m, first: 'Nadia', phone: '0612000002', guest: { kind: 'other', first: 'Sam', phone: known.phone } });
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  assert.ok(!JSON.stringify(r2.json).includes(known.first), 'the answer says nothing of the file');
  const a2 = [...s().appts.values()].find((x) => x.code === r2.json.code);
  assert.equal(a2.clientId, known.id, 'his own texts, on his own file');
  assert.equal(a2.ext.guest.by, s().clientByPhone.get('+33612000002'));
  const view = (await site.get('/api/public/bookings/' + r2.json.token)).json;
  assert.equal(view.first, 'Sam', 'the typed name, never the file’s');
  const msg = [...s().messages.values()].find((m) => m.apptId === a2.id && m.template === 'confirmation');
  assert.equal(msg.to, known.phone);
});

test('a father and two sons in one booking: one confirmation, side by side, each cancellable on his own', async () => {
  const { s, site, sv, day, av } = await setup();
  // three chairs free at the same minute
  const byM = new Map();
  for (const x of av) byM.set(x.m, (byM.get(x.m) || 0) + 1);
  const free = (await site.get(`/api/public/availability?services=${sv.id}&from=${day}&days=1&fresh=1&staff=any`)).json;
  assert.ok(free.days[0].slots.length);
  const m = av[0].m;
  const msgs0 = s().messages.size;
  const body = {
    serviceIds: [sv.id], staffId: 'any', day, start: m, first: 'Karim', last: 'Belkacem', phone: '0612000003',
    others: [{ serviceIds: [sv.id], staffId: 'any', day, start: m, guest: { kind: 'child', first: 'Adam' } }, { serviceIds: [sv.id], staffId: 'any', day, start: m + 30, guest: { kind: 'child', first: 'Yanis', age: 6 } }]
  };
  const r = await site.post('/api/public/bookings', body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.people.length, 3);
  const appts = r.json.people.map((p) => [...s().appts.values()].find((x) => x.code === p.code));
  assert.notEqual(appts[0].staffId, appts[1].staffId, 'side by side: two chairs at the same time');
  assert.equal(new Set(appts.map((a) => a.ext.group)).size, 1, 'one booking');
  assert.deepEqual(r.json.people.map((p) => p.first), ['Karim', 'Adam', 'Yanis']);
  const conf = [...s().messages.values()].slice(msgs0).filter((x) => x.template === 'confirmation');
  assert.equal(conf.length, 1, 'one confirmation for everyone');
  assert.match(conf[0].body, /Adam/);
  assert.match(conf[0].body, /Yanis/);
  // Adam cancels: the others stay booked
  const c = await site.post('/api/public/bookings/' + r.json.people[1].token + '/cancel', {});
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.deepEqual(appts.map((a) => s().appts.get(a.id).status), ['booked', 'cancelled', 'booked']);
});

test('all or none: one place already taken leaves nothing booked, and only one of the people can be the booker', async () => {
  const { s, site, sv, day, av } = await setup();
  const one = av[0];
  const n0 = s().appts.size;
  const twice = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: one.s, day, start: one.m, first: 'Karim', phone: '0612000004', others: [{ serviceIds: [sv.id], staffId: one.s, day, start: one.m, guest: { kind: 'child', first: 'Adam' } }] });
  assert.equal(twice.status, 409, JSON.stringify(twice.json));
  assert.equal(twice.json.error.code, 'taken');
  assert.match(twice.json.error.message, /pour Adam/);
  assert.equal(s().appts.size, n0, 'nothing booked');
  assert.equal(s().clients.size > 0, true);
  const bad = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day, start: one.m, first: 'Karim', phone: '0612000004', others: [{ serviceIds: [sv.id], staffId: 'any', day, start: one.m + 60 }] });
  assert.equal(bad.status, 400);
  const five = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: 'any', day, start: one.m, first: 'Karim', phone: '0612000004', others: [1, 2, 3, 4].map((i) => ({ serviceIds: [sv.id], staffId: 'any', day, start: one.m + i * 30, guest: { kind: 'other', first: 'Ami' + 'abcd'[i - 1] } })) });
  assert.equal(five.status, 400, 'four people at most');
});

test('a visitor booking for several people keeps one hold per person', async () => {
  const { s, site, sv, day, av } = await setup();
  const starts = [...new Set(av.map((x) => x.m))].slice(0, 5);
  const ids = [];
  for (const m of starts.slice(0, 4)) {
    const h = await site.post('/api/public/holds', { serviceIds: [sv.id], staffId: 'any', day, start: m, party: 4 });
    assert.equal(h.status, 200, JSON.stringify(h.json));
    ids.push(h.json.holdId);
  }
  assert.ok(ids.every((id) => s().holds.has(id)), 'the four kept');
});

test('the agenda elides before a vowel: « Inès (enfant d’Ahmed B.) »', async () => {
  const { rt, s, site, sv, day, av } = await setup();
  const r = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: av[0].s, day, start: av[0].m, first: 'Ahmed', last: 'Benali', phone: '0612000077', guest: { kind: 'child', first: 'Inès' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = [...s().appts.values()].find((x) => x.code === r.json.code);
  const row = (await (await owner(rt)).get('/api/v1/agenda?day=' + day)).json.appts.find((x) => x.id === a.id);
  assert.equal(row.name, 'Inès (enfant d’Ahmed B.)');
});

test('erasing the parent’s file takes the child’s first name off the booking and erases the child’s file', async () => {
  const { rt, s, site, sv, day, av } = await setup();
  const r = await site.post('/api/public/bookings', { serviceIds: [sv.id], staffId: av[0].s, day, start: av[0].m, first: 'Karim', last: 'Belkacem', phone: '0612000088', guest: { kind: 'child', first: 'Léo', age: 8 } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = [...s().appts.values()].find((x) => x.code === r.json.code);
  const childId = a.ext.guest.cid;
  const b = await owner(rt);
  const e = await b.post('/api/v1/clients/' + a.clientId + '/erase', { cancelUpcoming: true });
  assert.equal(e.status, 200, JSON.stringify(e.json));
  if (e.json.erased === false) assert.equal((await b.post('/api/v1/clients/' + a.clientId + '/erase', { cancelUpcoming: true })).status, 200);
  assert.ok(s().clients.get(a.clientId).erased, 'the parent is erased');
  assert.equal(s().appts.get(a.id).name, '', 'no first name left on the booking');
  const child = s().clients.get(childId);
  assert.ok(child.erased && child.first === 'Client' && child.notes === '', 'the child’s file leaves with the parent’s');
});
