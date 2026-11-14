// What the desk is told must be true (audit 02 · A3, C7): a cancelled booking's deposit goes back only when the person
// cancelling may refund, and the answer says what became of the money; the client search finds a regular fast.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** A salon tablet with someone's PIN typed. */
async function asStaff(name) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin: DEMO.pins[name] })).status, 200);
  return tab;
}
/** A booking made on the site with its deposit paid: { id, paymentId, day }. */
async function paidBooking(first, phone, nth = 0) {
  const site = browser(rt);
  const salon = await site.get('/api/public/salon');
  const deco = salon.json.services.find((s) => s.slug === 'de');
  const av = await site.get(`/api/public/availability?services=${deco.id}&staff=any&from=${DAY}&days=6`);
  const day = av.json.days.filter((d) => d.slots.length)[nth];
  const book = await site.post('/api/public/bookings', { serviceIds: [deco.id], staffId: 'any', day: day.day, start: day.slots[0].m, first, phone });
  assert.equal(book.json.status, 'pending', JSON.stringify(book.json));
  const pid = book.json.payment.url.split('/').pop();
  await site.post('/api/public/payments/' + pid + '/simulate', { outcome: 'paid' });
  const boss = await owner();
  const appt = (await boss.get('/api/v1/agenda?day=' + day.day)).json.appts.find((a) => a.code === book.json.code);
  assert.equal(appt.deposit.paid, 1800);
  return { id: appt.id, paymentId: appt.deposit.paymentId, day: day.day };
}
const payment = async (b, id) => (await b.get('/api/v1/payments/' + id)).json;

test('the desk cancels a booking with a paid deposit: cancelled, NOT refunded, and the answer says so', async () => {
  const bk = await paidBooking('Sacha', '0677889911');
  const desk = await asStaff('Inès');
  const me = (await desk.get('/api/v1/bootstrap')).json;
  assert.ok(!me.me.caps.includes('sale.refund'), 'the desk may not refund');
  const r = await desk.post('/api/v1/appointments/' + bk.id + '/cancel', { reason: 'Annulé par le salon', notify: true, refundDeposit: false });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.notEqual(r.json.refunded, true);
  assert.equal(r.json.depositLeft, 1800, 'the money still held is named, so the screen cannot promise a refund');
  const boss = await owner();
  assert.equal((await payment(boss, bk.paymentId)).status, 'paid', 'nothing went back');
  assert.equal((await boss.get('/api/v1/appointments/' + bk.id)).json.appt.status, 'cancelled');
});

test('a barber or the desk asking for the refund is refused before anything is cancelled', async () => {
  const bk = await paidBooking('Malo', '0677889922', 1);
  const desk = await asStaff('Inès');
  const r = await desk.post('/api/v1/appointments/' + bk.id + '/cancel', { reason: 'Annulé par le salon', notify: true, refundDeposit: true });
  assert.equal(r.status, 403);
  assert.match(r.json.error.message, /gérant/);
  const boss = await owner();
  assert.notEqual((await boss.get('/api/v1/appointments/' + bk.id)).json.appt.status, 'cancelled', 'not half done: the booking still stands');
  assert.equal((await payment(boss, bk.paymentId)).status, 'paid');
  // the owner does both in one go, and the answer says the money went back
  const ok = await boss.post('/api/v1/appointments/' + bk.id + '/cancel', { reason: 'Annulé par le salon', notify: true, refundDeposit: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.refunded, true);
  assert.equal(ok.json.depositLeft, undefined);
  assert.equal((await payment(boss, bk.paymentId)).status, 'refunded');
});

test('the owner who does not ask for the refund is told the deposit is still held; no deposit, no mention', async () => {
  const bk = await paidBooking('Noa', '0677889933', 2);
  const boss = await owner();
  const r = await boss.post('/api/v1/appointments/' + bk.id + '/cancel', { reason: 'Annulé par le salon', notify: false });
  assert.equal(r.json.depositLeft, 1800);
  // an ordinary booking without deposit
  const ag = (await boss.get('/api/v1/agenda?day=' + DAY)).json;
  const plain = ag.appts.find((a) => a.status === 'booked' && !a.deposit);
  assert.ok(plain, 'the demo day has a booking without deposit');
  const c = await boss.post('/api/v1/appointments/' + plain.id + '/cancel', { reason: 'Annulé par le salon', notify: false, refundDeposit: true });
  assert.equal(c.status, 200);
  assert.equal(c.json.depositLeft, undefined);
  assert.equal(c.json.refunded, undefined);
});

test('client search at the desk: first-name starts first, +33 and 06 alike, words in any order', async () => {
  const desk = await asStaff('Inès');
  for (const [first, last, phone] of [['Zakaria', 'Testeur', '0611000001'], ['Karim', 'Testeur', '0639000002'], ['Yanis', 'Karoui', '0611000003']]) {
    assert.equal((await desk.post('/api/v1/clients', { first, last, phone })).status, 200);
  }
  const names = async (q) => (await desk.get('/api/v1/clients?limit=50&q=' + encodeURIComponent(q))).json.items.map((c) => c.first + ' ' + c.last);
  const kar = await names('kar');
  const i = (n) => kar.indexOf(n);
  assert.ok(i('Karim Testeur') >= 0 && i('Yanis Karoui') > i('Karim Testeur') && i('Zakaria Testeur') > i('Yanis Karoui'), kar.join(', '));
  assert.ok(kar.slice(0, kar.findIndex((n) => !/^kar/i.test(n)) < 0 ? kar.length : kar.findIndex((n) => !/^kar/i.test(n))).includes('Karim Testeur'), 'every « Kar… » first name leads the list');
  assert.deepEqual(await names('+33 6 39 00 00 02'), ['Karim Testeur']);
  assert.deepEqual(await names('06 39 00 00 02'), ['Karim Testeur']);
  assert.deepEqual(await names('0033639000002'), ['Karim Testeur']);
  assert.deepEqual(await names('testeur zak'), ['Zakaria Testeur']);
  assert.deepEqual(await names('ZAKÀRIA  testeur'), ['Zakaria Testeur'], 'accents and case do not count');
});
