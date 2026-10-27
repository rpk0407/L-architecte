// AC-01 · What a signed-in client reads of himself (GET /api/me/home and /api/me/history, server/domain/me.js): his
// bookings to come with working /r/ links, his rhythm by the salon's own rule, what he holds, his visits with their
// receipts, through merged files, and nothing from before the fence of an account that may have changed hands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { browser } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, mergeClients, eraseClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { createRuntime } from '../../server/http/runtime.js';
import { clientStats } from '../../server/domain/insights.js';
import { rhythmOf, statsOfDays } from '../../server/domain/rhythm.js';
import { meHistory } from '../../server/domain/me.js';
import { otpCode } from '../../server/domain/otp.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
let numbers = 0;

async function setup() {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true } }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const file = async (first = 'Yanis', phone = true) => {
    const digits = '06' + String(20000000 + ++numbers * 7907).slice(-8);
    return (await t.engine.run(addClient, { first, last: 'Martin', ...(phone ? { phone: digits } : {}) }, t.asOwner())).id;
  };
  /** a visit on that day (10:00 with Ali), checked out at 10:40 */
  const visit = async (cid, day, lines = [{ kind: 'service', ref: t.ids.cut }], amount = 2000) => {
    t.clock.now = at(day, 10);
    const a = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start: 600 }, t.asOwner());
    t.clock.now = at(day, 10, 40);
    const sale = await t.engine.run(S.checkout, { apptId: a.id, lines, payments: [{ method: 'card', amount }] }, t.asOwner());
    return { appt: a.id, sale: sale.id };
  };
  const signIn = async (cid) => {
    const b = browser(rt);
    await rt.engine.sync(true);
    const c = rt.engine.state.clients.get(cid);
    await b.post('/api/public/account/start', { phone: c.phone });
    await settled();
    const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === cid).at(-1);
    const r = await b.post('/api/public/account/verify', { phone: c.phone, code: otpCode(rt.secret, m.id), first: c.first });
    assert.equal(r.status, 200, r.text);
    return b;
  };
  return { t, rt, file, visit, signIn };
}

test('home: the bookings to come soonest first with their /r/ links, the rhythm, the usual cut, what he holds; history with receipts', async () => {
  const { t, rt, file, visit, signIn } = await setup();
  const y = await file();
  // four visits four weeks apart (the first one buys a carnet and spends its first cut), then a walk-in a week ago
  // that also buys a gift card
  await visit(y, addDays(DAY, -112), [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], 8000);
  await visit(y, addDays(DAY, -84));
  await visit(y, addDays(DAY, -56));
  await visit(y, addDays(DAY, -28));
  t.clock.now = at(addDays(DAY, -7), 15);
  await t.engine.run(S.checkout, { clientId: y, lines: [{ kind: 'service', ref: t.ids.beard, staffId: t.ids.Ben }, { kind: 'giftcard', unit: 4000, recipient: 'Pour moi' }], payments: [{ method: 'card', amount: 7000 }] }, t.asOwner());
  t.clock.now = at(DAY, 9);
  const later = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.beard], staffId: t.ids.Ben, day: addDays(DAY, 9), start: 660 }, t.asOwner());
  const soon = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, t.asOwner());
  const b = await signIn(y);

  const home = (await b.get('/api/me/home')).json;
  assert.equal(home.first, 'Yanis');
  assert.equal(home.fenced, false);
  assert.equal(home.historyFrom, null);
  assert.deepEqual(home.upcoming.map((x) => x.id), [soon.id, later.id], 'soonest first');
  const [next] = home.upcoming;
  assert.equal(next.manage, 'https://salon.test/r/' + next.token);
  const page = await browser(rt).get('/api/public/bookings/' + next.token);
  assert.equal(page.status, 200, 'the /r/ link works');
  assert.equal(page.json.code, next.code);
  assert.equal(next.staff.name, 'Ali');
  assert.deepEqual(next.services, [{ id: t.ids.cut, name: 'Coupe', price: 2000 }]);
  assert.equal(next.canChange, true);
  assert.equal(next.changeUntil, at(addDays(DAY, 2), 10) - 12 * 3600000);
  assert.equal(next.lateOk, false);
  // the rhythm is the salon's: the same figures the Comptoir reads
  const st = clientStats(rt.engine.state, DAY, t.clock.now).get(y);
  assert.equal(st.visits, 5);
  assert.deepEqual(home.rhythm, rhythmOf(st));
  assert.equal(home.rhythm.lastDay, addDays(DAY, -7));
  assert.equal(home.rhythm.cadence, 28);
  assert.equal(home.rhythm.dueDay, addDays(DAY, 21));
  assert.deepEqual(home.usual, { serviceIds: [t.ids.cut], staffId: t.ids.Ali }, 'the last booked visit');
  assert.equal(home.wallet.carnets.length, 0, 'the carnet sold 112 days ago (70 days) has expired');
  assert.equal(home.wallet.giftcards.length, 1);
  assert.equal(home.wallet.giftcards[0].balance, 4000);
  assert.deepEqual(home.team.map((x) => x.name), ['Ali', 'Ben']);
  assert.equal(home.prefs.staffId, null);
  assert.equal(home.consent.sms, true);

  const hist = (await b.get('/api/me/history')).json;
  assert.equal(hist.items.length, 5);
  assert.equal(hist.more, false);
  assert.deepEqual(hist.items.map((x) => x.day), [-7, -28, -56, -84, -112].map((d) => addDays(DAY, d)), 'newest first');
  for (const x of hist.items) {
    assert.equal(x.status, 'done');
    assert.match(x.receipt, /^https:\/\/salon\.test\/recu\//);
    const token = x.receipt.split('/recu/')[1];
    const rc = await browser(rt).get('/api/public/receipts/' + token);
    assert.equal(rc.status, 200, 'the receipt opens');
  }
  assert.equal(hist.items[0].staff.name, 'Ben', 'a walk-in carries the barber of its service line');
  assert.equal(hist.items[0].price, 7000);
  // paging: never a day cut in two
  const p1 = meHistory(rt.engine.state, [y], { limit: 2 });
  assert.equal(p1.items.length, 2);
  assert.equal(p1.more, true);
  const p2 = meHistory(rt.engine.state, [y], { limit: 2, before: p1.items.at(-1).day });
  assert.deepEqual(p2.items.map((x) => x.day), [-56, -84].map((d) => addDays(DAY, d)));
  // every read is not cached
  assert.equal((await b.get('/api/me/home')).headers.get('cache-control'), 'no-store');
});

test('one visit gives no due day; a missed and a cancelled booking show in the history without a receipt', async () => {
  const { t, file, visit, signIn } = await setup();
  const y = await file();
  await visit(y, addDays(DAY, -14));
  t.clock.now = at(addDays(DAY, -7), 9);
  const missed = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -7), start: 600 }, t.asOwner());
  t.clock.now = at(addDays(DAY, -7), 11);
  await t.engine.run(A.setStatus, { id: missed.id, status: 'no_show' }, t.asOwner());
  const gone = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, -5), start: 600 }, t.asOwner());
  await t.engine.run(A.cancelAppointment, { id: gone.id }, t.asOwner());
  t.clock.now = at(DAY, 10);
  const b = await signIn(y);
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual(home.rhythm, { visits: 1, cadence: null, lastDay: addDays(DAY, -14), dueDay: null });
  assert.deepEqual(rhythmOf(null), { visits: 0, cadence: null, lastDay: null, dueDay: null });
  assert.deepEqual(rhythmOf({ visits: 2, cadence: null, lastDay: DAY }), { visits: 2, cadence: null, lastDay: DAY, dueDay: addDays(DAY, 28) });
  assert.deepEqual(statsOfDays([DAY, addDays(DAY, -21), addDays(DAY, -42)]), { visits: 3, cadence: 21, lastDay: DAY });
  const hist = (await b.get('/api/me/history')).json;
  assert.deepEqual(hist.items.map((x) => [x.status, !!x.receipt]), [['cancelled', false], ['no_show', false], ['done', true]]);
});

test('merged files: the history and the wallet include what the merged-away file had', async () => {
  const { t, file, visit, signIn } = await setup();
  const y = await file();
  const old = await file('Yanis', false);
  await visit(old, addDays(DAY, -28));
  t.clock.now = at(addDays(DAY, -28), 16);
  await t.engine.run(S.checkout, { clientId: old, lines: [{ kind: 'giftcard', unit: 2500, recipient: 'Pour moi' }], payments: [{ method: 'card', amount: 2500 }] }, t.asOwner());
  t.clock.now = at(DAY, 9);
  await t.engine.run(mergeClients, { from: old, into: y }, t.asOwner());
  const b = await signIn(y);
  const home = (await b.get('/api/me/home')).json;
  assert.equal(home.wallet.giftcards.length, 1, 'the gift card of the merged-away file');
  const hist = (await b.get('/api/me/history')).json;
  assert.equal(hist.items.filter((x) => x.day === addDays(DAY, -28)).length, 2, 'its visit and its purchase');
  // erased: the space is gone with it
  for (let i = 0; i < 3; i++) if ((await t.engine.run(eraseClient, { id: y, cancelUpcoming: true }, t.asOwner())).erased) break;
  assert.equal((await b.get('/api/me/home')).status, 401);
  assert.equal((await b.get('/api/me/history')).status, 401);
});

test('a fenced account: nothing from before the fence in home, history or wallet', async () => {
  const { t, rt, file, visit, signIn } = await setup();
  await t.engine.run(updateSettings, { accounts: { fenceDays: 90 } }, t.asOwner());
  t.clock.now = at(addDays(DAY, -196), 9);
  const y = await file();
  await visit(y, addDays(DAY, -196));
  await visit(y, addDays(DAY, -168));
  t.clock.now = at(addDays(DAY, -168), 16);
  await t.engine.run(S.checkout, { clientId: y, lines: [{ kind: 'giftcard', unit: 3000, recipient: 'Pour moi' }], payments: [{ method: 'card', amount: 3000 }] }, t.asOwner());
  // the previous holder had booked far ahead
  const ahead = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 4), start: 600 }, t.asOwner());
  t.clock.now = at(DAY, 9);
  const b = await signIn(y);
  const me = (await b.get('/api/me')).json;
  assert.equal(me.fenced, true);
  assert.equal(me.historyFrom, DAY);
  // the new holder books and comes today
  const today = await visit(y, DAY);
  t.clock.now = at(DAY, 12);
  const mine = await t.engine.run(A.createAppointment, { clientId: y, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 7), start: 600 }, t.asOwner());
  const home = (await b.get('/api/me/home')).json;
  assert.deepEqual(home.upcoming.map((x) => x.id), [mine.id], 'not the booking the previous holder made');
  assert.ok(!home.upcoming.some((x) => x.id === ahead.id));
  assert.deepEqual(home.wallet, { carnets: [], giftcards: [] });
  assert.deepEqual(home.rhythm, { visits: 1, cadence: null, lastDay: DAY, dueDay: null });
  assert.deepEqual(home.usual, { serviceIds: [t.ids.cut], staffId: t.ids.Ali });
  const hist = (await b.get('/api/me/history')).json;
  assert.equal(hist.items.length, 1);
  assert.equal(hist.items[0].day, DAY);
  void rt; void today;
});
