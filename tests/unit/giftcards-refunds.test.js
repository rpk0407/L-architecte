// Gift cards after the sale (the code texted by its holder, a lost card reissued) and credit notes done by line:
// a pack cancelled at its price less the cuts taken, products back on the shelf, an unused gift card paid back
// outside revenue and VAT, a refund split as the payment was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as S from '../../server/commands/sales.js';
import { addService, updateService } from '../../server/commands/catalog.js';
import { addStaff } from '../../server/commands/team.js';
import { createPayment, paymentSucceeded } from '../../server/commands/payments.js';
import { report } from '../../server/domain/insights.js';
import { addClient } from '../../server/commands/clients.js';
import { dayTotals, drawerExpected, zFigures } from '../../server/domain/cash.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { browser } from '../api/client.js';

const card = (amount) => [{ method: 'card', amount }];
const sell = (t, input, as = t.asOwner()) => t.engine.run(S.checkout, input, as);
const giftSale = (t, amount = 5000, payments = card(amount)) => sell(t, { lines: [{ kind: 'giftcard', unit: amount, recipient: 'Pour Karim' }], payments });
const refund = (t, input, as = t.asOwner()) => t.engine.run(S.refund, { reason: 'Retour client', method: 'card', ...input }, as);

/* ---------------- through the API: the code by SMS ---------------- */

async function production() {
  const clock = { now: at(DAY, 10) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  const setup = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) };
  const cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, as)).id;
  const buyer = (await rt.engine.run(addClient, { first: 'Sofiane', last: 'Benali', phone: '06 11 22 33 44' }, as)).id;
  return { rt, owner, cut, buyer };
}
const post = (b, path, body) => b.post(path, body, { 'x-request-id': 'rq-' + Math.random().toString(36).slice(2, 12) });

test('the code by SMS: refused without the right code, sent with it, and never stored in the chain', async () => {
  const { rt, owner, buyer } = await production();
  const sale = await post(owner, '/api/v1/sales', { clientId: buyer, lines: [{ kind: 'giftcard', unit: 5000, recipient: 'Pour Karim' }], payments: card(5000) });
  assert.equal(sale.status, 200, JSON.stringify(sale.json));
  const g = sale.json.giftcards[0];
  assert.match(g.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(g.id && g.expires, 'the till gets what the voucher prints: the card, its expiry');

  const wrong = await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: 'AAAA-BBBB-CCCC', phone: '06 99 88 77 66' });
  assert.equal(wrong.status, 403, JSON.stringify(wrong.json));
  assert.equal([...rt.engine.state.messages.values()].length, 0, 'nothing queued');

  const ok = await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: g.code.toLowerCase(), phone: '06 99 88 77 66' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const m = rt.engine.state.messages.get(ok.json.id);
  assert.equal(m.template, 'giftcardCode');
  assert.equal(m.to, '+33699887766');
  assert.ok(m.body.includes(g.code), 'the full code is in the text: ' + m.body);
  assert.match(m.body, /^L'Architecte : Sofiane t'offre une carte cadeau de 50 € ! Code [A-Z0-9-]{14}, valable jusqu'au \d\d\/\d\d\/\d{4}\. Réserve : /);
  const norm = g.code.replace(/-/g, '');
  for (const e of rt.engine.journal) {
    const chained = JSON.stringify([e.type, e.data, e.actor]);
    assert.ok(!chained.includes(g.code) && !chained.includes(norm), e.type + ' carries the code in its chained data');
  }
  // a second text (another number) is a new message, not swallowed by the first one's id
  const again = await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: g.code, phone: '07 12 12 12 12' });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.notEqual(again.json.id, ok.json.id);
  assert.equal((await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: g.code, phone: '12' })).status, 400);
  assert.equal((await post(browser(rt), '/api/v1/giftcards/' + g.id + '/send', { code: g.code, phone: '0699887766' })).status, 401, 'signed in only');
});

/* ---------------- reissue ---------------- */

test('reissue: the old card is void, the new one has its balance and expiry, the old code is refused at the till', async () => {
  const t = await salon();
  const sold = await giftSale(t, 5000);
  const old = sold.giftcards[0];
  // 15 € spent first: the balance moves, not the face value
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 1500, ref: old.code }, { method: 'card', amount: 500 }] });
  // a barber cannot
  await rejects(t.engine.run(S.reissueGiftcard, { id: old.id }, t.asStaff('Ali')), 'forbidden');
  const r = await t.engine.run(S.reissueGiftcard, { id: old.id }, t.asOwner());
  const s = t.engine.state;
  assert.equal(s.giftcards.get(old.id).status, 'void');
  assert.equal(s.giftcards.get(old.id).replacedBy, r.id);
  const nw = s.giftcards.get(r.id);
  assert.deepEqual([nw.status, nw.balance, nw.expires, nw.reissueOf, nw.recipient], ['active', 3500, s.giftcards.get(old.id).expires, old.id, 'Pour Karim']);
  assert.notEqual(r.code, old.code);
  const e = await rejects(sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 2000, ref: old.code }] }), 'giftcard');
  assert.match(e.message, /remplacée/);
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 2000, ref: r.code }] });
  assert.equal(s.giftcards.get(r.id).balance, 1500);
  await rejects(t.engine.run(S.reissueGiftcard, { id: old.id }, t.asOwner()), 'void');
  // no sale behind a reissue: the day's cards sold are the 50 € card only
  assert.equal(dayTotals(s, DAY).giftcardsSold, 5000);
});

/* ---------------- refunds by line ---------------- */

test('a pack ticket with one cut used: the pack is cancelled, 60 € suggested (80 € − 20 €), a full refund refused unless the owner forces it', async () => {
  const t = await salon();
  // the salon's pack covers the 20 € cut: a cut taken is worth 20 €
  await t.engine.run(updateService, { id: t.ids.pack, patch: { pack: { credits: 5, days: 70, serviceIds: [t.ids.cut] } } }, t.asOwner());
  const sold = await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  const s = t.engine.state;
  const pk = [...s.packs.values()].find((k) => k.saleId === sold.id);
  assert.equal(pk.used, 1);
  const plan = S.refundPlan(s, s.sales.get(sold.id));
  const line = plan.lines[0];
  assert.deepEqual([line.kind, line.pack.left, line.pack.used, line.pack.unit, line.pack.suggested], ['pack', 4, 1, 2000, 6000]);
  assert.equal(plan.consumed, 2000);
  assert.equal(plan.lines[1].left, 0, 'the cut paid by the pack has nothing to refund');

  await rejects(refund(t, { saleId: sold.id, amount: 8000 }), 'pack_used');
  await rejects(refund(t, { saleId: sold.id, amount: 8000, lines: [{ i: 0, qty: 1 }] }), 'invalid');
  const r = await refund(t, { saleId: sold.id, amount: 6000, lines: [{ i: 0, qty: 1 }], reason: 'Déménage' });
  assert.equal(r.ref, 'A000001');
  assert.ok(pk.voided);
  assert.equal(pk.total - pk.used, 0, 'no cut left anywhere');
  assert.equal(s.refunds.get(r.id).lines[0].amount, 6000);
  // the cancelled pack no longer pays a cut, and the rest of the ticket (the cut taken) is not refundable
  await rejects(sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk.id }], payments: card(0) }), 'pack_void');
  await rejects(refund(t, { saleId: sold.id, amount: 2000 }), 'pack_used');
  await rejects(refund(t, { saleId: sold.id, amount: 100, lines: [{ i: 0, qty: 1 }] }), 'pack_void');

  // the owner may refund it all (a cut that went wrong), a manager or a barber may not force it
  const other = await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  await rejects(refund(t, { saleId: other.id, amount: 8000, lines: [{ i: 0, qty: 1 }], override: true }, t.asStaff('Ali')), 'forbidden');
  const full = await refund(t, { saleId: other.id, amount: 8000, lines: [{ i: 0, qty: 1 }], override: true });
  assert.equal(s.refunds.get(full.id).override, true);
  assert.equal(dayTotals(s, DAY).refundsTotal, 14000);
});

test('a product returned: by line and quantity, back in stock, the VAT of its own rate', async () => {
  const t = await salon();
  const s = t.engine.state;
  const sold = await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }, { kind: 'product', ref: t.ids.oil, qty: 2 }], payments: card(5000) });
  const stock = s.products.get(t.ids.oil).stock;
  assert.equal(stock, 8);
  const r = await refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 1, qty: 1 }], restock: [{ productId: t.ids.oil, qty: 1 }] });
  assert.equal(s.products.get(t.ids.oil).stock, stock + 1);
  const rf = s.refunds.get(r.id);
  assert.deepEqual(rf.vat, [{ rate: 2000, base: 1250, tax: 250 }]);
  assert.deepEqual(s.sales.get(sold.id).lineRefunds[1], { qty: 1, amount: 1500 });
  // one jar left to give back, not two
  await rejects(refund(t, { saleId: sold.id, amount: 3000, lines: [{ i: 1, qty: 2 }] }), 'invalid');
  await rejects(refund(t, { saleId: sold.id, amount: 1600, lines: [{ i: 1, qty: 1 }] }), 'invalid');
  await refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 1, qty: 1 }], restock: [{ productId: t.ids.oil, qty: 1 }] });
  assert.equal(S.refundPlan(s, s.sales.get(sold.id)).lines[1].left, 0);
  assert.equal(s.sales.get(sold.id).refunded, 3000);
});

test('an unused gift card refunded: the card is void, the Z net is unchanged, the cash out is in the drawer', async () => {
  const t = await salon();
  const s = t.engine.state;
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2000) });
  const sold = await giftSale(t, 5000, [{ method: 'cash', amount: 5000 }]);
  const before = dayTotals(s, DAY);
  assert.equal(drawerExpected(s, s.drawer), 15000);
  const plan = S.refundPlan(s, s.sales.get(sold.id));
  assert.equal(plan.lines[0].giftcard.unused, true);
  // only in full, and the card goes with it
  await rejects(refund(t, { saleId: sold.id, amount: 2000, method: 'cash', lines: [{ i: 0, qty: 1 }] }), 'invalid');
  await rejects(refund(t, { saleId: sold.id, amount: 5000, method: 'cash' }), 'invalid');
  const r = await refund(t, { saleId: sold.id, amount: 5000, method: 'cash', lines: [{ i: 0, qty: 1 }], reason: 'Cadeau en double' });
  assert.equal(r.liability, 5000);
  assert.equal(s.giftcards.get(sold.giftcards[0].id).status, 'void');
  await rejects(sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 2000, ref: sold.giftcards[0].code }] }), 'giftcard');
  assert.deepEqual(s.refunds.get(r.id).vat, [], 'no VAT was ever charged on it');

  const after = dayTotals(s, DAY);
  assert.equal(after.netTtc, before.netTtc, 'revenue untouched');
  assert.equal(after.refundsTotal, 0);
  assert.deepEqual(after.vatNet, before.vatNet);
  assert.equal(after.paymentsNet.cash, 0, 'the cash came in and went out');
  assert.equal(after.giftcardsSold, 0);
  assert.equal(after.giftcardsRefunded, 5000);
  assert.equal(after.paidTotal, after.netTtc + after.tips + after.giftcardsSold);
  assert.equal(drawerExpected(s, s.drawer), 10000, 'the drawer expects the cash given back');
  assert.equal(s.sales.get(sold.id).refunded, 0, 'nothing of the revenue');
  assert.equal(s.sales.get(sold.id).refundedLiability, 5000);

  // the sealed Z says the same
  await t.engine.run(S.closeDrawer, { counts: { 5000: 2 } }, t.asOwner());
  t.clock.now = at(DAY, 19);
  const z = await t.engine.run(S.closeDay, {}, t.asOwner());
  const f = zFigures(s.closures.get(DAY));
  assert.equal(z.net, 2000);
  assert.deepEqual([f.netTtc, f.giftcardsSold, f.giftcardsRefunded, f.paidTotal], [2000, 0, 5000, 2000]);
});

test('a used gift card is not refunded; a refund is split as the payment was', async () => {
  const t = await salon();
  const s = t.engine.state;
  const sold = await giftSale(t, 3000);
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 1000, ref: sold.giftcards[0].code }, { method: 'card', amount: 1000 }] });
  assert.equal(S.refundPlan(s, s.sales.get(sold.id)).lines[0].left, 0);
  await rejects(refund(t, { saleId: sold.id, amount: 3000, lines: [{ i: 0, qty: 1 }] }), 'giftcard_used');

  await t.engine.run(S.openDrawer, { float: 5000 }, t.asOwner());
  const mixed = await sell(t, { lines: [{ kind: 'service', ref: t.ids.beard }, { kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 3000 }, { method: 'cash', amount: 2000 }] });
  const plan = S.refundPlan(s, s.sales.get(mixed.id));
  assert.deepEqual(plan.split.map((x) => [x.method, x.share]), [['card', 0.6], ['cash', 0.4]]);
  await rejects(refund(t, { saleId: mixed.id, amount: 2500, split: [{ method: 'card', amount: 1500 }, { method: 'cash', amount: 900 }] }), 'invalid');
  const r = await refund(t, { saleId: mixed.id, amount: 2500, split: [{ method: 'cash', amount: 1000 }, { method: 'card', amount: 1500 }] });
  const rf = s.refunds.get(r.id);
  assert.equal(rf.method, 'card');
  assert.deepEqual(rf.parts, [{ method: 'card', amount: 1500 }, { method: 'cash', amount: 1000 }]);
  assert.equal(drawerExpected(s, s.drawer), 5000 + 2000 - 1000);
  const d = dayTotals(s, DAY);
  assert.deepEqual([d.refundsByMethod.card, d.refundsByMethod.cash, d.paymentsNet.cash], [1500, 1000, 1000]);
});

test('the credit note as printed: its number, the ticket, the lines and the VAT given back', async () => {
  const { rt, owner, cut } = await production();
  const sale = await post(owner, '/api/v1/sales', { lines: [{ kind: 'service', ref: cut }], payments: card(2000) });
  const plan = await owner.get('/api/v1/sales/' + sale.json.id + '/refund-plan');
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.equal(plan.json.lines[0].left, 1);
  const rf = await post(owner, '/api/v1/sales/' + sale.json.id + '/refund', { amount: 2000, method: 'card', reason: 'Prestation ratée', lines: [{ i: 0, qty: 1 }] });
  assert.equal(rf.status, 200, JSON.stringify(rf.json));
  const note = await owner.get('/api/v1/refunds/' + rf.json.id);
  assert.equal(note.status, 200, JSON.stringify(note.json));
  assert.deepEqual([note.json.ref, note.json.saleRef, note.json.amount, note.json.lines[0].name], ['A000001', 'T000001', 2000, 'Coupe']);
  assert.deepEqual(note.json.vat, [{ rate: 2000, base: 1667, tax: 333 }]);
  assert.ok(rt.engine.state.refunds.has(rf.json.id));
});

/* ---------------- the holes a refund must not open ---------------- */

test('a card spent in part then reissued is not "unused": its first ticket refunds nothing of it', async () => {
  const t = await salon();
  const s = t.engine.state;
  const sold = await giftSale(t, 5000);
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'giftcard', amount: 2000, ref: sold.giftcards[0].code }] });
  const nw = await t.engine.run(S.reissueGiftcard, { id: sold.giftcards[0].id }, t.asOwner());
  const line = S.refundPlan(s, s.sales.get(sold.id)).lines[0];
  assert.deepEqual([line.left, line.giftcard.unused, line.giftcard.id, line.giftcard.balance], [0, false, nw.id, 3000]);
  await rejects(refund(t, { saleId: sold.id, amount: 5000, lines: [{ i: 0, qty: 1 }] }), 'giftcard_used');
  await rejects(refund(t, { saleId: sold.id, amount: 3000, lines: [{ i: 0, qty: 1 }] }), 'giftcard_used');
  assert.equal(s.giftcards.get(nw.id).status, 'active');
  // reissued before any use: still the same card, still refundable in full, and the live card goes
  const other = await giftSale(t, 4000);
  const nw2 = await t.engine.run(S.reissueGiftcard, { id: other.giftcards[0].id }, t.asOwner());
  await refund(t, { saleId: other.id, amount: 4000, lines: [{ i: 0, qty: 1 }] });
  assert.equal(s.giftcards.get(nw2.id).status, 'void');
});

test('a pack goes back only through its line: no amount, no override leaves the cuts behind', async () => {
  const t = await salon();
  const s = t.engine.state;
  await t.engine.run(updateService, { id: t.ids.pack, patch: { pack: { credits: 5, days: 70, serviceIds: [t.ids.cut] } } }, t.asOwner());
  const sold = await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }, { kind: 'product', ref: t.ids.oil }], payments: card(9500) });
  const pk = [...s.packs.values()].find((k) => k.saleId === sold.id);
  const plan = S.refundPlan(s, s.sales.get(sold.id));
  assert.equal(plan.free, 1500, 'without a line, only the oil');
  await rejects(refund(t, { saleId: sold.id, amount: 6000 }), 'pack_used');
  await rejects(refund(t, { saleId: sold.id, amount: 9500, override: true }), 'override');
  await rejects(refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 2, qty: 1 }], override: true }), 'override');
  // a manager may not force it either
  const mgr = await t.engine.run(addStaff, { name: 'Mo', role: 'manager', schedule: {}, commission: { service: 0, product: 0 } }, t.asOwner());
  const st = s.staff.get(mgr.id);
  await rejects(refund(t, { saleId: sold.id, amount: 9500, lines: [{ i: 0, qty: 1 }], override: true }, { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, s.settings) }), 'override');
  assert.equal(pk.voided, undefined);
  // the oil alone, without a line, is fine; then nothing more without the pack's line
  await refund(t, { saleId: sold.id, amount: 1500 });
  await rejects(refund(t, { saleId: sold.id, amount: 100 }), 'pack_used');
  await refund(t, { saleId: sold.id, amount: 6000, lines: [{ i: 0, qty: 1 }] });
  assert.ok(pk.voided);
  // what is left is the cut taken: kept, with a reason given
  const e = await rejects(refund(t, { saleId: sold.id, amount: 2000 }), 'pack_used');
  assert.match(e.message, /coupes d’abonnement déjà faites/);
});

test('a line already paid back without lines is not paid twice; restock follows the lines given back', async () => {
  const t = await salon();
  const s = t.engine.state;
  const sold = await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }, { kind: 'product', ref: t.ids.oil }], payments: card(3500) });
  await refund(t, { saleId: sold.id, amount: 2000, reason: 'Coupe ratée' });
  await rejects(refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 0, qty: 1 }] }), 'refunded');
  // nothing else may go back on the shelf: another product, more jars than given back, or none given back
  await rejects(refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 1, qty: 1 }], restock: [{ productId: t.ids.oil, qty: 2 }] }), 'invalid');
  await rejects(refund(t, { saleId: sold.id, amount: 1500, restock: [{ productId: t.ids.oil, qty: 1 }] }), 'invalid');
  const stock = s.products.get(t.ids.oil).stock;
  await refund(t, { saleId: sold.id, amount: 1500, lines: [{ i: 1, qty: 1 }], restock: [{ productId: t.ids.oil, qty: 1 }] });
  assert.equal(s.products.get(t.ids.oil).stock, stock + 1);
});

test('the cuts taken are priced as their ticket priced them, not at today’s catalogue', async () => {
  const t = await salon();
  const s = t.engine.state;
  await t.engine.run(updateService, { id: t.ids.pack, patch: { pack: { credits: 5, days: 70, serviceIds: [] } } }, t.asOwner());
  const sold = await sell(t, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.beard, packId: 'new' }], payments: card(8000) });
  await t.engine.run(updateService, { id: t.ids.beard, patch: { price: 3500 } }, t.asOwner());
  const line = S.refundPlan(s, s.sales.get(sold.id)).lines[0];
  // any service: the 30 € beard taken, not the pack's 16 € per cut nor the new 35 €
  assert.deepEqual([line.pack.unit, line.pack.suggested], [3000, 5000]);
});

test('Rapports and the Z agree after a gift card is paid back', async () => {
  const t = await salon();
  const s = t.engine.state;
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  await sell(t, { lines: [{ kind: 'service', ref: t.ids.cut }], payments: card(2000) });
  const sold = await giftSale(t, 5000, [{ method: 'cash', amount: 5000 }]);
  const q = { from: DAY, to: DAY, today: DAY };
  const before = report(s, q).revenue;
  await refund(t, { saleId: sold.id, amount: 5000, method: 'cash', lines: [{ i: 0, qty: 1 }] });
  const r = report(s, q);
  assert.equal(r.revenue, before);
  assert.equal(r.revenue, dayTotals(s, DAY).netTtc);
  assert.equal(r.refunds, 0);
  // a split refund lands on both methods
  const mixed = await sell(t, { lines: [{ kind: 'service', ref: t.ids.beard }], payments: [{ method: 'card', amount: 2000 }, { method: 'cash', amount: 1000 }] });
  await refund(t, { saleId: mixed.id, amount: 3000, split: [{ method: 'card', amount: 2000 }, { method: 'cash', amount: 1000 }] });
  const r2 = report(s, q);
  assert.deepEqual([r2.methods.refund_card, r2.methods.refund_cash], [2000, 1000]);
  assert.equal(r2.revenue, dayTotals(s, DAY).netTtc);
});

test('the code is not texted for an expired card; nobody named, the text says it plainly', async () => {
  const { rt, owner } = await production();
  const sale = await post(owner, '/api/v1/sales', { lines: [{ kind: 'giftcard', unit: 3000 }], payments: card(3000) });
  const g = sale.json.giftcards[0];
  const ok = await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: g.code, phone: '06 99 88 77 66' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(rt.engine.state.messages.get(ok.json.id).body, /^L'Architecte : une carte cadeau de 30 € t'a été offerte ! Code /);
  rt.engine.state.giftcards.get(g.id).expires = '2020-01-01';
  const late = await post(owner, '/api/v1/giftcards/' + g.id + '/send', { code: g.code, phone: '06 99 88 77 66' });
  assert.equal(late.status, 409);
  assert.equal(late.json.error.code, 'expired');
});

test('an online refund the credit note would refuse never reaches the provider', async () => {
  const { rt, owner, buyer } = await production();
  const s = rt.engine.state;
  const pack = (await post(owner, '/api/v1/services', { name: 'Abonnement 5 coupes', category: 'Abonnement', price: 8000, dur: 30, pack: { credits: 5, days: 70 } })).json.id;
  assert.ok(pack);
  const cut = [...s.services.values()].find((x) => x.name === 'Coupe').id;
  await rt.engine.run(updateService, { id: pack, patch: { pack: { credits: 5, days: 70, serviceIds: [cut] } } }, { actor: { t: 'system', id: 'test' }, caps: new Set(['catalog']) });
  // a QR payment at the chair, paid (the provider's side is simulated)
  await rt.engine.run(createPayment, { id: 'py_qr1', kind: 'qr', amount: 8000, provider: 'simulated', providerRef: 'sim_qr1', label: 'Abonnement' }, { actor: { t: 'system', id: 'test' }, caps: new Set(['sale.create']) });
  await rt.engine.run(paymentSucceeded, { id: 'py_qr1', amount: 8000, chargeRef: 'ch_test' }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set() });
  const py = s.payments.get('py_qr1');
  const sale = await post(owner, '/api/v1/sales', { clientId: buyer, lines: [{ kind: 'pack', ref: pack }, { kind: 'service', ref: cut, packId: 'new' }], payments: [{ method: 'online', amount: 8000, ref: py.id }] });
  assert.equal(sale.status, 200, JSON.stringify(sale.json));
  const calls = [];
  const real = rt.pay.refund;
  rt.pay.refund = async (...a) => { calls.push(a); return real(...a); };
  const path = '/api/v1/sales/' + sale.json.id + '/refund';
  const full = await post(owner, path, { amount: 8000, method: 'online', reason: 'Déménage' });
  assert.equal(full.status, 409, JSON.stringify(full.json));
  assert.equal(full.json.error.code, 'pack_used');
  const split = await post(owner, path, { amount: 6000, method: 'online', reason: 'Déménage', lines: [{ i: 0, qty: 1 }], split: [{ method: 'card', amount: 3000 }, { method: 'cash', amount: 3000 }] });
  assert.equal(split.status, 400, JSON.stringify(split.json));
  assert.equal(calls.length, 0, 'no money moved');
  assert.equal(s.refunds.size, 0);
  const ok = await post(owner, path, { amount: 6000, method: 'online', reason: 'Déménage', lines: [{ i: 0, qty: 1 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 6000);
  assert.ok(s.refunds.get(ok.json.id).providerRef);
});
