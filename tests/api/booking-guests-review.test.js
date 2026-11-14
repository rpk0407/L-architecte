// Review of the booking for others: a booking of several people stays all or none even when a deposit page cannot
// open (a place confirmed without a deposit is taken back with the others), and a client who missed is not let past
// the deposit by being booked by a friend under his own number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { salon, at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { updateSettings } from '../../server/commands/shop.js';
import { paymentSucceeded } from '../../server/commands/payments.js';

const DAY = '2026-11-03';

test('a booking of several people whose deposit page fails is taken back whole, and a retry books nobody', async () => {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = () => rt.engine.state;
  const site = browser(rt);
  const info = (await site.get('/api/public/salon')).json;
  const cut = info.services.find((x) => x.price < 5000); // under the 50 € threshold: no deposit
  const big = info.services.find((x) => x.price >= 5000); // a deposit
  const day = addDays(DAY, 2);
  const av = (await site.get(`/api/public/availability?services=${big.id}&from=${day}&days=1&fresh=1`)).json.days[0].slots;
  const m = av[0].m;
  // the provider is down
  const real = rt.pay.createCheckout;
  rt.pay.createCheckout = async () => { throw new Error('provider down'); };
  const n0 = s().appts.size;
  const body = { serviceIds: [cut.id], staffId: 'any', day, start: m, first: 'Karim', phone: '0612000011', others: [{ serviceIds: [big.id], staffId: 'any', day, start: m, guest: { kind: 'other', first: 'Marc' } }] };
  const key = { 'x-request-id': 'rq-group-fail-1' };
  const r = await site.post('/api/public/bookings', body, key);
  assert.equal(r.status, 503, JSON.stringify(r.json));
  const made = [...s().appts.values()].slice(n0);
  assert.equal(made.length, 2);
  assert.deepEqual(made.map((a) => a.status), ['cancelled', 'cancelled'], 'the place without a deposit is taken back too');
  // the lost answer tried again: the same booking, gone, never a « booked » place for a booking said not recorded
  const again = await site.post('/api/public/bookings', body, key);
  assert.equal(again.status, 409, JSON.stringify(again.json));
  assert.equal(again.json.error.code, 'gone');
  // a fresh try once the provider is back books both
  rt.pay.createCheckout = real;
  const ok = await site.post('/api/public/bookings', body, { 'x-request-id': 'rq-group-fail-2' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.people.map((p) => p.status), ['booked', 'pending']);
});

test('the system alone takes back a confirmed place, and only one of a booking of several people from the site', async () => {
  const t = await salon({ day: DAY, hour: 9 });
  const NEXT = addDays(DAY, 1);
  const one = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start: 600, first: 'Yanis', phone: '0612000012' }, t.asClient);
  const sys = { actor: { t: 'system', id: 'payments' }, caps: new Set(), meta: {} };
  await t.engine.run(A.expirePending, { id: one.id, group: true }, sys);
  assert.equal(t.engine.state.appts.get(one.id).status, 'booked', 'a booking of one person is never taken back that way');
  const grp = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start: 660, first: 'Yanis', phone: '0612000012', others: [{ serviceIds: [t.ids.cut], staffId: 'any', day: NEXT, start: 660, guest: { kind: 'child', first: 'Adam' } }] }, t.asClient);
  await t.engine.run(A.expirePending, { id: grp.id, group: true }, t.asClient);
  assert.equal(t.engine.state.appts.get(grp.id).status, 'booked', 'a client cannot take back a place that way');
  await t.engine.run(A.expirePending, { id: grp.id, group: true }, sys);
  assert.equal(t.engine.state.appts.get(grp.id).status, 'cancelled');
});

test('a client who missed twice, booked by a friend under his own number, still owes the deposit', async () => {
  const MISSED = ['2026-10-20', '2026-10-27'];
  const t = await salon({ day: MISSED[0], hour: 9 });
  for (const d of MISSED) {
    t.clock.now = at(d, 9);
    const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: d, start: 600 }, t.asOwner());
    t.clock.now = at(d, 11);
    await t.engine.run(A.setStatus, { id: a.id, status: 'no_show' }, t.asOwner());
  }
  t.clock.now = at(DAY, 10);
  await t.engine.run(updateSettings, { deposits: { riskBased: true } }, t.asOwner());
  const NEXT = addDays(DAY, 1);
  const yanis = t.engine.state.clients.get(t.ids.yanis);
  // a new friend books for Yanis, giving Yanis's number: the place is on Yanis's file, with its history
  const r = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start: 600, first: 'Sofiane', phone: '0612000013', guest: { kind: 'other', first: 'Yanis', phone: yanis.phone } }, t.asClient);
  const a = t.engine.state.appts.get(r.id);
  assert.equal(a.clientId, t.ids.yanis);
  assert.equal(r.status, 'pending');
  assert.ok(r.deposit > 0, 'the usual deposit');
  // the same friend booking for someone else without a number: no deposit (the friend never missed)
  const r2 = await t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start: 660, first: 'Sofiane', phone: '0612000013', guest: { kind: 'other', first: 'Marc' } }, t.asClient);
  assert.deepEqual([r2.status, r2.deposit], ['booked', 0]);
});

test('a child’s place confirmed once its deposit is paid: the text and the e-mail to the parent say « pour Léo »', async () => {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = () => rt.engine.state;
  const site = browser(rt);
  const info = (await site.get('/api/public/salon')).json;
  const big = info.services.find((x) => x.price >= 5000); // a deposit
  const day = addDays(DAY, 2);
  const av = (await site.get(`/api/public/availability?services=${big.id}&from=${day}&days=1&fresh=1`)).json.days[0].slots;
  const r = await site.post('/api/public/bookings', { serviceIds: [big.id], staffId: av[0].s, day, start: av[0].m, first: 'Karim', phone: '0612000013', email: 'karim.parent@example.com', guest: { kind: 'child', first: 'Léo' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const a = [...s().appts.values()].find((x) => x.code === r.json.code);
  assert.equal(a.status, 'pending', 'a deposit is due');
  const py = [...s().payments.values()].find((x) => x.apptId === a.id);
  await rt.engine.run(paymentSucceeded, { providerRef: py.providerRef, amount: py.amount }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set() });
  assert.equal(s().appts.get(a.id).status, 'booked');
  const sms = [...s().messages.values()].find((m) => m.apptId === a.id && m.template === 'confirmation' && m.channel !== 'email');
  assert.ok(sms, 'a confirmation text');
  assert.match(sms.body, /Karim/);
  assert.match(sms.body, /pour Léo/);
  const mail = [...s().messages.values()].find((m) => m.apptId === a.id && m.template === 'confirmation' && m.channel === 'email');
  assert.ok(mail, 'a confirmation e-mail');
  assert.match(mail.body, /avec \S+ pour Léo\./);
  assert.match(mail.mail.subject, /pour Léo/);
});
