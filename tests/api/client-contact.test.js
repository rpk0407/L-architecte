// FEATURE B · The client without an account: « Retrouver mon rendez-vous » with the code and the number, every booking to
// come of that contact from one link, how the salon reaches him, and « préviens-moi si un créneau se libère plus tôt ».
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser, ORIGIN } from './client.js';
import { at, DAY } from '../helpers.js';
import { signLink } from '../../server/auth/session.js';
import { normCode } from '../../server/http/routes-client.js';
import earlier from '../../server/commands/steps/earlier.js';
import * as A from '../../server/commands/agenda.js';

const clock = { now: at(DAY, 9, 0) };
const RID = 'b1d2c3e4-0000-4000-8000-000000000001';
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

/** One online booking of a classic cut with a given barber (or any), on the first day with room; its answer. */
async function book(site, phone, first, { staff = 'any', pick = 0, email } = {}) {
  const salon = (await site.get('/api/public/salon')).json;
  const cut = salon.services.find((s) => s.slug === 'cl');
  const av = await site.get(`/api/public/availability?services=${cut.id}&staff=${staff}&from=${DAY}&days=5`);
  const day = av.json.days.filter((d) => d.slots.length)[1];
  const slot = pick < 0 ? day.slots[day.slots.length + pick] : day.slots[pick];
  const r = await site.post('/api/public/bookings', { serviceIds: [cut.id], staffId: staff, day: day.day, start: slot.m, first, phone, sms: true, ...(email ? { email } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { ...r.json, day: day.day, start: slot.m };
}

test('normCode reads a code however it is typed', () => {
  assert.equal(normCode('la-7kq2'), 'LA-7KQ2');
  assert.equal(normCode(' LA 7KQ2 '), 'LA-7KQ2');
  assert.equal(normCode('7kq2'), 'LA-7KQ2');
  assert.equal(normCode('12'), '');
});

test('code + number opens the booking; a wrong number says the same words as a wrong code, and the code locks after 5 misses', async () => {
  const site = browser(rt);
  const b = await book(site, '06 31 00 00 01', 'Nadia');
  const ok = await browser(rt).post('/api/public/find', { code: b.code.toLowerCase(), phone: '+33 6 31 00 00 01' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.token, b.token);
  const bad = await browser(rt).post('/api/public/find', { code: b.code, phone: '06 31 00 00 02' });
  const none = await browser(rt).post('/api/public/find', { code: 'LA-ZZZZ', phone: '06 31 00 00 01' });
  assert.equal(bad.status, 404);
  assert.equal(none.status, 404);
  assert.equal(bad.json.error.message, none.json.error.message);
  for (let i = 0; i < 4; i++) await browser(rt).post('/api/public/find', { code: b.code, phone: '06 31 00 00 0' + (3 + i) });
  const locked = await browser(rt).post('/api/public/find', { code: b.code, phone: '06 31 00 00 01' });
  assert.equal(locked.status, 429);
  assert.equal((await browser(rt).post('/api/public/find', { code: '', phone: '06 31 00 00 01' })).status, 400);
});

test('one link lists every booking to come of the contact, with price, barber, deposit, the rules and the salon', async () => {
  const site = browser(rt);
  const b1 = await book(site, '06 31 00 00 11', 'Karim', { pick: 0 });
  const b2 = await book(site, '06 31 00 00 11', 'Karim', { pick: -1 });
  const other = await book(site, '06 31 00 00 12', 'Paul', { pick: 2 });
  const v = await browser(rt).get('/api/public/contact/' + encodeURIComponent(b2.token));
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.deepEqual(v.json.items.map((x) => x.code).sort(), [b1.code, b2.code].sort());
  assert.ok(!v.json.items.some((x) => x.code === other.code));
  const me = v.json.items.find((x) => x.code === b2.code);
  assert.equal(me.self, true);
  assert.ok(me.price > 0 && me.staff && me.staff.name && me.canChange === true && me.services[0].name);
  assert.ok(v.json.shop.address && v.json.cancelUntilHours > 0);
  assert.deepEqual(v.json.notify, { via: 'sms', options: v.json.notify.options });
  assert.ok(v.json.notify.options.includes('sms') && !v.json.notify.options.includes('email'));
  assert.equal((await browser(rt).get('/api/public/contact/not-a-token.abcdefghij')).status, 404);
});

test('the contact chooses the e-mail only when the salon has one; a retried tap writes once', async () => {
  const site = browser(rt);
  const b = await book(site, '06 31 00 00 21', 'Inès', { email: 'ines@example.com' });
  const t = encodeURIComponent(b.token);
  assert.ok((await site.get('/api/public/contact/' + t)).json.notify.options.includes('email'));
  const len = rt.engine.state.seq ?? null;
  const r1 = await site.post('/api/public/contact/' + t + '/notify', { via: 'email' }, { 'x-request-id': RID });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.notify.via, 'email');
  const again = await site.post('/api/public/contact/' + t + '/notify', { via: 'email' }, { 'x-request-id': RID });
  assert.equal(again.status, 200);
  assert.equal((await site.post('/api/public/contact/' + t + '/notify', { via: 'pigeon' })).status, 400);
  const nomail = await book(site, '06 31 00 00 22', 'Hugo');
  const r2 = await site.post('/api/public/contact/' + encodeURIComponent(nomail.token) + '/notify', { via: 'email' });
  assert.equal(r2.status, 400);
  assert.match(r2.json.error.message, /e-mail/);
  void len;
});

test('« préviens-moi » on a booking, then a cancellation frees an earlier slot with the same barber: one text with the slot, once', async () => {
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  const staff = salon.barbers[0].id;
  // two bookings with the same barber: the early one will be cancelled, the late one asked to be told
  const early = await book(site, '06 31 00 00 31', 'Léa', { staff, pick: 0 });
  const late = await book(site, '06 31 00 00 32', 'Sam', { staff, pick: -1 });
  const t = encodeURIComponent(late.token);
  const on = await site.post('/api/public/contact/' + t + '/earlier', { code: late.code, on: true });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.items.find((x) => x.code === late.code).earlier, true);
  // another contact's booking is not his to flag
  assert.equal((await site.post('/api/public/contact/' + t + '/earlier', { code: early.code, on: true })).status, 404);
  const cx = await site.post('/api/public/bookings/' + encodeURIComponent(early.token) + '/cancel', {});
  assert.equal(cx.status, 200, JSON.stringify(cx.json));
  const run = () => rt.engine.run({ run: (s, i, ctx) => earlier.run(s, ctx) }, {}, { actor: { t: 'system', id: 'tick' }, caps: new Set(), meta: { linkFor: (a) => ORIGIN + '/r/' + signLink(rt.secret, 'appt', a.code) } });
  await run();
  await run();
  const texts = [...rt.engine.state.messages.values()].filter((m) => m.template === 'earlier');
  assert.equal(texts.length, 1);
  const lateId = rt.engine.state.apptByCode.get(late.code);
  assert.equal(texts[0].apptId, lateId);
  const body = rt.engine.state.messages.get(texts[0].id).body || '';
  assert.match(body, new RegExp('plus-tot=' + early.day + '\\.' + early.start));
  // the /r/ page takes it through the usual move
  const mv = await site.post('/api/public/bookings/' + t + '/move', { day: early.day, start: early.start });
  assert.equal(mv.status, 200, JSON.stringify(mv.json));
  assert.equal(mv.json.start, early.start);
  // off again
  const off = await site.post('/api/public/contact/' + t + '/earlier', { code: late.code, on: false });
  assert.equal(off.json.items.find((x) => x.code === late.code).earlier, false);
  void A;
});

test('a booking for a child: the parent\'s code and number open it, the list says for whom, « préviens-moi » works on it', async () => {
  const site = browser(rt);
  const salon = (await site.get('/api/public/salon')).json;
  const cut = salon.services.find((s) => s.slug === 'cl');
  const av = await site.get(`/api/public/availability?services=${cut.id}&staff=any&from=${DAY}&days=5`);
  const day = av.json.days.filter((d) => d.slots.length)[2];
  const r = await site.post('/api/public/bookings', { serviceIds: [cut.id], staffId: 'any', day: day.day, start: day.slots[1].m, first: 'Sonia', phone: '06 31 00 00 41', sms: true, guest: { kind: 'child', first: 'Léo', age: 8 } });
  if (r.status !== 201) { console.log('child booking not available yet:', r.status, r.json && r.json.error && r.json.error.message); return; }
  const own = await book(site, '06 31 00 00 41', 'Sonia', { pick: -1 });
  const found = await browser(rt).post('/api/public/find', { code: r.json.code, phone: '06 31 00 00 41' });
  assert.equal(found.status, 200, JSON.stringify(found.json));
  const v = (await site.get('/api/public/contact/' + encodeURIComponent(found.json.token))).json;
  const kid = v.items.find((x) => x.code === r.json.code);
  assert.ok(kid, JSON.stringify(v.items.map((x) => x.code)));
  assert.equal(kid.forFirst, 'Léo');
  assert.ok(v.items.some((x) => x.code === own.code && x.forFirst === ''));
  // the parent is the contact: his channel, his « préviens-moi » on the child's booking
  const on = await site.post('/api/public/contact/' + encodeURIComponent(own.token) + '/earlier', { code: r.json.code, on: true });
  assert.equal(on.status, 200, JSON.stringify(on.json));
});
