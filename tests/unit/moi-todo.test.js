// FEATURE B · /moi: « Ce qui manque » (GET /api/me/todo), how the salon reaches him (PATCH /api/me/notify), « préviens-moi
// si un créneau se libère plus tôt » (POST /api/me/earlier), and the reminders that follow the channel he chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { browser } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { createRuntime } from '../../server/http/runtime.js';
import { otpCode } from '../../server/domain/otp.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { byHand } from '../../server/messaging/hand.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const RID = 'c0ffee00-0000-4000-8000-00000000000';

async function setup() {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const y = (await t.engine.run(addClient, { first: 'Yanis', last: 'Martin', phone: '0645454545', email: 'yanis@example.com' }, t.asOwner())).id;
  const b = browser(rt);
  await rt.engine.sync(true);
  await b.post('/api/public/account/start', { phone: '0645454545' });
  await settled();
  const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === y).at(-1);
  assert.equal((await b.post('/api/public/account/verify', { phone: '0645454545', code: otpCode(rt.secret, m.id), first: 'Yanis' })).status, 200);
  return { t, rt, y, b };
}

test('todo: a carnet that ends within 30 days, payments listed; nothing for a carnet far from its end', async () => {
  const { t, rt, y, b } = await setup();
  // a carnet bought today (its validity is the salon's), one cut used
  await t.engine.run(S.checkout, { clientId: y, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: [{ method: 'card', amount: 8000 }] }, t.asOwner());
  await rt.engine.sync(true);
  const k = [...rt.engine.state.packs.values()].find((x) => x.clientId === y);
  const far = (await b.get('/api/me/todo')).json;
  assert.ok(Array.isArray(far.items) && Array.isArray(far.payments));
  // move the clock to 10 days before its end: it shows, with the cuts left and the day
  t.clock.now = at(addDays(k.expires, -10), 10);
  const near = (await b.get('/api/me/todo')).json;
  const item = near.items.find((x) => x.id === 'pk_' + k.id);
  assert.ok(item, JSON.stringify(near));
  assert.equal(item.tone, 'warn');
  assert.equal(item.left, k.total - k.used);
  assert.equal(item.until, k.expires);
  if (addDays(k.expires, -10) > addDays(DAY, 30)) assert.ok(!far.items.some((x) => x.id === 'pk_' + k.id));
});

test('notify: he picks the e-mail, the evening reminder goes by e-mail and no text; WhatsApp goes to the hand queue', async () => {
  const { t, rt, y, b } = await setup();
  assert.deepEqual((await b.get('/api/me/home')).json.notify.via, 'sms');
  const r = await b.patch('/api/me/notify', { via: 'email' }, { 'x-request-id': RID + '1' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await b.get('/api/me/home')).json.notify.via, 'email');
  // a booking tomorrow, the reminder hour passed
  const a = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  t.engine.state.appts.get(a.id).createdAt = at(DAY, 8);
  t.clock.now = at(DAY, 19);
  await t.engine.run(updateSettings, { messages: { reminder: true, reminderHour: 18 } }, t.asOwner());
  await t.engine.run(tick, {}, { actor: { t: 'system', id: 'tick' }, caps: new Set(), meta: { linkFor: () => 'https://salon.test/r/x' } });
  const msgs = [...t.engine.state.messages.values()].filter((m) => m.apptId === a.id && /reminder/.test(m.template));
  assert.ok(msgs.length >= 1, 'a reminder');
  assert.ok(msgs.every((m) => m.channel === 'email'), JSON.stringify(msgs.map((m) => m.channel)));
  // WhatsApp: offered once the salon has a WhatsApp number; a text to him then waits for a person
  assert.equal((await b.patch('/api/me/notify', { via: 'whatsapp' })).status, 400);
  await t.engine.run(updateSettings, { messages: { whatsapp: { mode: 'sms', number: '06 11 22 33 44' } } }, t.asOwner());
  await rt.engine.sync(true);
  assert.equal((await b.patch('/api/me/notify', { via: 'whatsapp' })).status, 200);
  await rt.engine.sync(true);
  const s = rt.engine.state;
  const prev = s.mode;
  s.mode = 'production';
  assert.equal(byHand(s, { sms: {} }, { channel: 'sms', cid: y, template: 'reminder' }), true);
  s.mode = prev;
});

test('earlier: on and off on his own booking only, and home says it', async () => {
  const { t, rt, y, b } = await setup();
  const a = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 900 }, t.asOwner());
  const other = (await t.engine.run(addClient, { first: 'Paul', phone: '0646464646' }, t.asOwner())).id;
  const o = await t.engine.run(A.createAppointment, { clientId: other, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 960 }, t.asOwner());
  assert.equal((await b.post('/api/me/earlier', { id: a.id, on: true })).status, 200);
  await rt.engine.sync(true);
  assert.equal((await b.get('/api/me/home')).json.upcoming.find((x) => x.id === a.id).earlier, true);
  assert.equal((await b.post('/api/me/earlier', { id: o.id, on: true })).status, 404);
  assert.equal((await b.post('/api/me/earlier', { id: a.id, on: false })).status, 200);
  await rt.engine.sync(true);
  assert.equal((await b.get('/api/me/home')).json.upcoming.find((x) => x.id === a.id).earlier, false);
});
