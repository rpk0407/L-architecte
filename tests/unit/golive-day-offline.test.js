// Go-live audit · a whole day at the till on a production salon with NO online payment plugged in (no Stripe key, no
// SMS, no e-mail, no Blob): everything the barbers do on day one must work over HTTP, as the Comptoir sends it, and no
// request may leave the server. Cash, the salon's own card terminal, a mixed payment with a tip and a discount, a gift
// card sold then spent, a carnet sold then used, credit notes (cash, split), the drawer count, the Z, then what the
// till answers after the Z and on the next morning (a ticket of a sealed day corrected by a credit note dated today).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService, addProduct, adjustStock } from '../../server/commands/catalog.js';
import { dayTotals, zFigures } from '../../server/domain/cash.js';
import { browser } from '../api/client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const NEXT = addDays(DAY, 1);

/** Any request leaving the server fails the test that made it: these tests run with no account anywhere. */
function noNetwork(t) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { calls.push(String(url && url.url || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; });
  return calls;
}

async function bareProduction() {
  const clock = { now: at(DAY, 9, 50) };
  const env = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' };
  const rt = await createRuntime({ env, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) });
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = {};
  ids.ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, asOwner())).id;
  ids.tr = (await rt.engine.run(addService, { name: 'Transformation', category: 'Changer de tête', price: 5000, dur: 60, slug: 'tr' }, asOwner())).id;
  ids.pack = (await rt.engine.run(addService, { name: 'Carnet 5 coupes', category: 'Carnets', price: 8000, dur: 30, pack: { credits: 5, days: 365, serviceIds: [ids.cut] } }, asOwner())).id;
  ids.oil = (await rt.engine.run(addProduct, { name: 'Huile', price: 1500, cost: 600 }, asOwner())).id;
  await rt.engine.run(adjustStock, { id: ids.oil, delta: 10, reason: 'Stock initial' }, asOwner());
  return { rt, clock, owner, ids, s: () => rt.engine.state };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, r.text); return r.json; };

test('no online payment anywhere: the provider is the test page that takes no money, and every screen is told', async (t) => {
  const calls = noNetwork(t);
  const x = await bareProduction();
  assert.equal(x.rt.pay.name, 'simulated');
  const salon = ok(await browser(x.rt).get('/api/public/salon'));
  assert.deepEqual(salon.payments, { provider: 'simulated', live: false });
  assert.equal(salon.deposits.mode, 'none', 'the site announces no deposit');
  assert.ok(salon.services.every((sv) => !sv.deposit));
  const sys = ok(await x.owner.get('/api/v1/system'));
  assert.ok(sys.warnings.some((w) => /Stripe n’est pas connecté/.test(w)), 'the owner reads why no deposit is asked');
  const online = ok(await x.owner.get('/api/v1/payments/online'));
  assert.equal(online.mode, 'off');
  // Stripe's webhook address answers 404 (nothing is plugged in), never a 500
  const hook = await browser(x.rt).raw('POST', '/api/pay/stripe/webhook', '{}', { 'stripe-signature': 't=1,v1=00', 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' });
  assert.equal(hook.status, 404);
  // the QR at the chair and the test checkout say it plainly instead of pretending
  const qr = await x.owner.post('/api/v1/payments/qr', { amount: 2000 });
  assert.equal(qr.status, 409);
  assert.equal(qr.json.error.code, 'no_provider');
  assert.match(qr.json.error.message, /pas branché/);
  assert.equal((await browser(x.rt).post('/api/public/payments/py_nope/simulate', {})).status, 404);
  assert.deepEqual(calls, []);
});

test('a whole day with no external account: cash, the terminal, mixed, tip, discount, gift card, carnet, credit notes, count, Z', async (t) => {
  const calls = noNetwork(t);
  const x = await bareProduction();
  const { owner, ids } = x;

  // a client books on the site for 14:00: no deposit asked, confirmed at once
  const booked = ok(await browser(x.rt).post('/api/public/bookings', { serviceIds: [ids.tr], staffId: ids.ali, day: DAY, start: 840, first: 'Léon', phone: '0611223344' }), 201);
  assert.equal(booked.status, 'booked');
  assert.equal(booked.deposit, 0);
  assert.equal(booked.payment, null);
  assert.equal(x.s().payments.size, 0);

  // cash before the drawer is open is refused in words; the card terminal works without it
  const early = await owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'cash', amount: 2000, given: 2000 }] });
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, 'drawer_closed');
  ok(await owner.post('/api/v1/drawer/open', { float: 15000 }));

  // 1. walk-in, cash, change given
  x.clock.now = at(DAY, 10, 5);
  const s1 = ok(await owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'cash', amount: 2000, given: 5000 }] }));
  assert.equal(s1.change, 3000);
  assert.equal(s1.number, 1);

  // 2. mixed: a cut and an oil, 5 € off, 2 € tip; 12 € in cash, 20 € on the terminal
  const mixed = { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }, { kind: 'product', ref: ids.oil, staffId: ids.ali }], discount: { amount: 500, reason: 'Fidélité' }, tip: { amount: 200, staffId: ids.ali }, payments: [{ method: 'cash', amount: 1200, given: 2000 }, { method: 'card', amount: 2000 }] };
  // a total the browser got wrong (or tampered with) is refused with the right one
  const off = await owner.post('/api/v1/sales', { ...mixed, payments: [{ method: 'card', amount: 3100 }] });
  assert.equal(off.status, 400);
  assert.equal(off.json.error.code, 'unbalanced');
  assert.equal(off.json.error.extra.due, 3200);
  const s2 = ok(await owner.post('/api/v1/sales', mixed));
  assert.equal(s2.totals.due, 3200);
  assert.equal(s2.totals.revenue, 3000);
  assert.equal(s2.totals.tip, 200);
  assert.equal(s2.change, 800);
  // a double tap on « Encaisser » (same request id) is one ticket
  const rq = { 'x-request-id': 'aaaaaaaa-0000-4000-8000-000000000001' };
  const body3 = { lines: [{ kind: 'giftcard', unit: 5000, recipient: 'Adam' }], payments: [{ method: 'card', amount: 5000 }] };
  const s3 = ok(await owner.post('/api/v1/sales', body3, rq));
  const s3b = ok(await owner.post('/api/v1/sales', body3, rq));
  assert.equal(s3b.id, s3.id);
  assert.equal(x.s().sales.size, 3);
  const code = s3.giftcards[0].code;

  // 3. the site's booking, at 15:00: paid 20 € with the gift card, 30 € on the terminal
  x.clock.now = at(DAY, 15, 5);
  const appt = [...x.s().appts.values()].find((a) => a.source === 'site');
  const s4 = ok(await owner.post('/api/v1/sales', { apptId: appt.id, lines: [{ kind: 'service', ref: ids.tr }], payments: [{ method: 'giftcard', amount: 2000, ref: code }, { method: 'card', amount: 3000 }] }));
  assert.equal(x.s().appts.get(appt.id).status, 'done');
  assert.equal(ok(await owner.get('/api/v1/giftcards/check?code=' + code)).balance, 3000);
  // the same appointment is not paid twice
  assert.equal((await owner.post('/api/v1/sales', { apptId: appt.id, lines: [{ kind: 'service', ref: ids.tr }], payments: [{ method: 'card', amount: 5000 }] })).status, 409);

  // 4. a carnet sold to a client with its first cut, then a second cut on it at 0 €
  const yanis = ok(await owner.post('/api/v1/clients', { first: 'Yanis', last: 'Martin', phone: '06 12 34 56 78' })).id;
  const s5 = ok(await owner.post('/api/v1/sales', { clientId: yanis, lines: [{ kind: 'pack', ref: ids.pack, staffId: ids.ali }, { kind: 'service', ref: ids.cut, packId: 'new', staffId: ids.ali }], payments: [{ method: 'card', amount: 8000 }] }));
  const pk = [...x.s().packs.values()][0];
  const s6 = ok(await owner.post('/api/v1/sales', { clientId: yanis, lines: [{ kind: 'service', ref: ids.cut, packId: pk.id, staffId: ids.ali }], payments: [{ method: 'card', amount: 0 }] }));
  assert.equal(s6.totals.due, 0);
  assert.equal(x.s().packs.get(pk.id).used, 2);

  // 5. credit notes: the oil of the mixed ticket goes back as it was paid (card and cash), the walk-in gets 5 € in cash
  const plan = ok(await owner.get('/api/v1/sales/' + s2.id + '/refund-plan'));
  const oil = plan.lines.find((l) => l.kind === 'product');
  assert.equal(oil.value, 1286, '15 € less its share of the 5 € discount (500 × 1500 / 3500, to the cent)');
  const rf1 = ok(await owner.post('/api/v1/sales/' + s2.id + '/refund', { amount: 1286, method: 'card', reason: 'Huile rendue', lines: [{ i: oil.i, qty: 1 }], restock: [{ productId: ids.oil, qty: 1 }], split: [{ method: 'card', amount: 786 }, { method: 'cash', amount: 500 }] }));
  assert.equal(rf1.ref, 'A000001');
  assert.equal(x.s().products.get(ids.oil).stock, 10);
  ok(await owner.post('/api/v1/sales/' + s1.id + '/refund', { amount: 500, method: 'cash', reason: 'Geste commercial' }));
  // more than the ticket holds, or the gift card's part in money, is refused
  assert.equal((await owner.post('/api/v1/sales/' + s1.id + '/refund', { amount: 1600, method: 'cash', reason: 'Trop' })).status, 400);
  const gc = await owner.post('/api/v1/sales/' + s4.id + '/refund', { amount: 5000, method: 'card', reason: 'Tout rendre' });
  assert.equal(gc.status, 409);
  assert.equal(gc.json.error.code, 'giftcard_paid');
  // an online refund on a ticket nobody paid online is refused before anything moves
  assert.equal((await owner.post('/api/v1/sales/' + s1.id + '/refund', { amount: 500, method: 'online', reason: 'En ligne ?' })).status, 400);

  // the day adds up, to the cent, before anything is sealed
  const d = dayTotals(x.s(), DAY);
  assert.equal(d.tickets, 6);
  assert.equal(d.grossTtc, 2000 + 3000 + 0 + 5000 + 8000 + 0);
  assert.equal(d.refundsTotal, 1786);
  assert.equal(d.netTtc, 16214);
  assert.equal(d.htNet + d.vatNet.reduce((n, v) => n + v.tax, 0), d.netTtc);
  assert.deepEqual(d.paymentsNet, { cash: 2000 + 1200 - 500 - 500, card: 2000 + 5000 + 3000 + 8000 - 786, giftcard: 2000 });
  assert.equal(d.tips, 200);
  assert.equal(d.giftcardsSold, 5000);
  assert.equal(d.paidTotal, d.netTtc + d.tips + d.giftcardsSold, 'what was paid = revenue + tips + gift cards sold');
  assert.equal(d.takings + d.prepaid, d.paidTotal);
  assert.equal(d.prepaid, 2000, 'the gift card spent is not money in today');

  // the Z waits for the drawer; the count finds every cent; a 6 € gap asks for a word
  x.clock.now = at(DAY, 19, 10);
  const z0 = await owner.post('/api/v1/closures', {});
  assert.equal(z0.status, 409);
  assert.equal(z0.json.error.code, 'drawer_open');
  const drawer = ok(await owner.get('/api/v1/drawer'));
  assert.equal(drawer.open.expected, 15000 + 2200);
  const gap = await owner.post('/api/v1/drawer/close', { counts: { 5000: 3, 1000: 1, 500: 1, 100: 1 } });
  assert.equal(gap.status, 400);
  assert.equal(gap.json.error.code, 'note');
  const count = ok(await owner.post('/api/v1/drawer/close', { counts: { 5000: 3, 2000: 1, 200: 1 } }));
  assert.equal(count.diff, 0);
  const z = ok(await owner.post('/api/v1/closures', {}));
  assert.equal(z.number, 1);
  assert.equal(z.grandTotal, 16214);
  assert.deepEqual(zFigures(x.s().closures.get(DAY)).paymentsNet, d.paymentsNet);

  // after the Z: no sale, no credit note, no drawer today, each said in words; nothing is rewritten
  const late = await owner.post('/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut, staffId: ids.ali }], payments: [{ method: 'card', amount: 2000 }] });
  assert.equal(late.status, 409);
  assert.equal(late.json.error.code, 'day_closed');
  const lateRf = await owner.post('/api/v1/sales/' + s5.id + '/refund', { amount: 500, method: 'card', reason: 'Après le Z' });
  assert.equal(lateRf.status, 409);
  assert.equal(lateRf.json.error.code, 'day_closed');
  assert.match(lateRf.json.error.message, /demain/, 'the till says when the credit note can be made');
  assert.equal((await owner.post('/api/v1/drawer/open', { float: 15000 })).status, 409);
  assert.equal((await owner.post('/api/v1/closures', {})).status, 409);

  // the next morning: yesterday's ticket is corrected by a credit note dated today; yesterday's Z does not move
  x.clock.now = at(NEXT, 9, 30);
  const sealed = JSON.stringify(x.s().closures.get(DAY));
  const rf3 = ok(await owner.post('/api/v1/sales/' + s4.id + '/refund', { amount: 1000, method: 'card', reason: 'Coupe ratée' }));
  assert.equal(x.s().refunds.get(rf3.id).day, NEXT);
  assert.equal(JSON.stringify(x.s().closures.get(DAY)), sealed);
  const d2 = dayTotals(x.s(), NEXT);
  assert.equal(d2.netTtc, -1000);
  assert.equal(d2.paymentsNet.card, -1000);
  assert.equal(d2.htNet + d2.vatNet.reduce((n, v) => n + v.tax, 0), d2.netTtc);
  x.clock.now = at(NEXT, 19, 10);
  const z2 = ok(await owner.post('/api/v1/closures', {}));
  assert.equal(z2.number, 2);
  assert.equal(z2.grandTotal, 15214, 'the perpetual total follows the credit note');

  assert.equal(x.rt.engine.verify().ok, true);
  assert.deepEqual(calls, [], 'nothing left the server');
});
