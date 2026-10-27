// Gift cards sold online (/carte-cadeau, routes-giftshop.js): the order checked before any provider call, the card
// issued once and only once its payment is confirmed (a ticket at 0 % VAT, the debt up by its amount, one text at
// the chosen moment), the card's page, the till taking its code, a card paid after today's Z, the production refusal
// while no real provider is connected (nor a Stripe test key), the planned text withdrawn when the card is cancelled or
// replaced, who may resend a code to which number. Also the credit note whose amount is lowered below its lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser, ORIGIN } from '../api/client.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { instantOf, addDays } from '../../shared/dates.js';
import { DENOMS } from '../../shared/money.js';
import { CAPS, capsOf } from '../../server/domain/permissions.js';
import { DEMO } from '../../server/domain/seed.js';
import { dayTotals } from '../../server/domain/cash.js';
import { erasedMatch } from '../../server/core/engine.js';
import { paymentSucceeded } from '../../server/commands/payments.js';
import { claimMessage } from '../../server/commands/messages.js';
import { addProduct, updateService } from '../../server/commands/catalog.js';
import * as S from '../../server/commands/sales.js';
import { fulfilGiftcard, codeFor } from '../../server/http/routes-giftshop.js';
import { salon, rejects } from '../helpers.js';

const DAY = '2026-11-24'; // a Tuesday, a month before Christmas
const XMAS = '2026-12-24T19:00';
const ORDER = { amount: 3000, buyer: { first: 'sofiane', phone: '06 11 22 33 44', email: 'sofiane@exemple.fr' }, recipient: { first: 'Karim', phone: '06 99 88 77 66' }, message: 'Joyeux Noël frérot', delivery: 'recipient', sendAt: XMAS };
const SYS = { actor: { t: 'system', id: 'test' }, caps: new Set(Object.keys(CAPS)) };

async function demo(hour = 15) {
  const clock = { now: instantOf(DAY, hour * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  return { rt, clock, s: () => rt.engine.state };
}
/** What a route handler gets as `r`, for calling the hook WP-06 adds to the provider's confirmation. */
const req = (rt) => ({ rt, get s() { return rt.engine.state; }, get local() { return { day: DAY }; }, origin: ORIGIN, meta: {} });
const onlineSales = (s, pid) => [...s.sales.values()].filter((x) => x.payments.some((p) => p.paymentId === pid));
const tokenOf = (o) => o.json.card.split('/').pop();

async function buy(rt, b = browser(rt), order = ORDER) {
  const o = await b.post('/api/public/giftcards', order);
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const paid = await b.post('/api/public/payments/' + o.json.id + '/simulate', {});
  assert.equal(paid.status, 200, JSON.stringify(paid.json));
  // the provider's confirmation runs fulfilGiftcard (WP-06's hook); without it, the card's page issues the card
  await fulfilGiftcard(req(rt), o.json.id);
  return o;
}

test('bought online in the demo: one ticket at 0 % VAT, the debt up by its amount, one text at the chosen moment, never twice', async () => {
  const { rt, s } = await demo();
  const b = browser(rt);
  const info = (await b.get('/api/public/giftcards')).json;
  assert.equal(info.live, true);
  assert.deepEqual(info.amounts, [2000, 3000, 5000, 8000]);
  const before = dayTotals(s(), DAY);
  const messages = s().messages.size;

  const o = await b.post('/api/public/giftcards', ORDER);
  assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.match(o.json.url, /\/paiement\/py_[^?]+\?retour=%2Fcadeau%2F/, 'the test checkout knows where to go once paid');
  const py = s().payments.get(o.json.id);
  assert.deepEqual([py.kind, py.amount, py.status, py.gift.delivery, py.gift.sendAt], ['giftcard', 3000, 'pending', 'recipient', instantOf('2026-12-24', 19 * 60)]);
  // nothing is issued before the money is in, not even the buyer's file (an abandoned checkout leaves none)
  assert.ok(py.cid && !s().clients.has(py.cid));
  const pending = await b.get('/api/public/giftcards/' + tokenOf(o));
  assert.deepEqual([pending.status, pending.json.status, pending.json.code], [200, 'pending', undefined]);
  assert.equal(onlineSales(s(), py.id).length, 0);

  assert.equal((await b.post('/api/public/payments/' + py.id + '/simulate', {})).status, 200);
  await fulfilGiftcard(req(rt), s().payments.get(py.id));
  const buyer = s().clients.get(py.cid);
  assert.deepEqual([buyer.first, buyer.phone, buyer.email, buyer.source], ['Sofiane', '+33611223344', 'sofiane@exemple.fr', 'site'], 'the file takes the id the order reserved');
  const [sale] = onlineSales(s(), py.id);
  assert.ok(sale, 'a ticket for the card');
  assert.deepEqual(sale.lines.map((l) => [l.kind, l.unit, l.vat, l.net]), [['giftcard', 3000, 0, 3000]]);
  assert.deepEqual([sale.day, sale.cashierId, sale.clientId, !!sale.demo], [DAY, null, buyer.id, false]);
  assert.deepEqual([sale.totals.revenue, sale.totals.liability, sale.totals.vat], [0, 3000, []]);
  assert.deepEqual(sale.payments, [{ method: 'online', amount: 3000, paymentId: py.id }]);
  const after = dayTotals(s(), DAY);
  assert.equal(after.liability, before.liability + 3000, 'the gift cards owed go up by its amount');
  assert.equal(after.revenue, before.revenue, 'not revenue');
  assert.deepEqual(after.vat, before.vat, 'no VAT on a card');

  const g = [...s().giftcards.values()].find((x) => x.saleId === sale.id);
  assert.deepEqual([g.amount, g.balance, g.status, g.buyer, g.recipient, g.online, g.cid], [3000, 3000, 'active', 'Sofiane', 'Karim', true, buyer.id]);
  assert.equal(g.expires, addDays(DAY, 365));
  const sms = [...s().messages.values()].filter((m) => m.template === 'giftcard');
  assert.equal(sms.length, 1);
  assert.equal(s().messages.size, messages + 1, 'one text, nothing else');
  assert.deepEqual([sms[0].to, sms[0].dueAt, sms[0].status, sms[0].cid], ['+33699887766', instantOf('2026-12-24', 19 * 60), 'queued', buyer.id]);
  const code = codeFor(rt.secret, py.id);
  assert.ok(sms[0].body.includes('Sofiane') && sms[0].body.includes(code) && sms[0].body.includes(ORIGIN + '/cadeau/'), sms[0].body);

  // the provider confirms again, the page polls, the Comptoir looks: still one ticket, one card, one text
  await rt.engine.run(paymentSucceeded, { providerRef: py.providerRef, amount: 3000 }, { actor: { t: 'provider', id: 'simulated' }, caps: new Set() });
  assert.equal((await b.post('/api/public/payments/' + py.id + '/simulate', {})).status, 409);
  assert.deepEqual(await fulfilGiftcard(req(rt), py.id), { already: true, saleId: sale.id });
  const page = await b.get('/api/public/giftcards/' + tokenOf(o));
  assert.equal(onlineSales(s(), py.id).length, 1);
  assert.equal([...s().giftcards.values()].filter((x) => x.saleId === sale.id).length, 1);
  assert.equal([...s().messages.values()].filter((m) => m.template === 'giftcard').length, 1);

  // the card's page: the code, the amount, the expiry, the message; nothing is cached
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.deepEqual([page.json.status, page.json.code, page.json.amount, page.json.balance, page.json.expires, page.json.message, page.json.first, page.json.from], ['ready', code, 3000, 3000, g.expires, 'Joyeux Noël frérot', 'Karim', 'Sofiane']);
  assert.deepEqual(page.json.sms, { status: 'queued', state: 'planned', dueAt: instantOf('2026-12-24', 19 * 60), to: '06 •• •• •• 66', error: '' });
  assert.equal((await b.get('/api/public/giftcards/' + py.id + '.forged')).status, 404);

  // the code and the order's names never reach the chain
  for (const e of rt.engine.journal) {
    const chained = JSON.stringify([e.type, e.data, e.actor]);
    for (const secret of [code, code.replace(/-/g, ''), '+33699887766', '+33611223344', 'Karim', 'Joyeux']) assert.ok(!chained.includes(secret), e.type + ' carries ' + secret);
  }
  // the buyer's erasure finds the order's personal data (the payment carries the file's id)
  const created = rt.engine.journal.find((e) => e.type === 'payment.created' && e.data.id === py.id);
  assert.equal(created.pii.order.recipient.phone, '+33699887766');
  assert.ok(erasedMatch(/** @type {any} */ ({ data: { id: buyer.id } }))(created));

  // the till takes its code
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const cut = [...s().services.values()].find((x) => x.active && !x.pack && !x.from && x.price <= 3000);
  const asOwner = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) };
  await rt.engine.run(S.checkout, { lines: [{ kind: 'service', ref: cut.id, staffId: [...s().staff.values()].find((x) => x.chair).id }], payments: [{ method: 'giftcard', amount: cut.price, ref: code.toLowerCase() }] }, asOwner);
  assert.equal(s().giftcards.get(g.id).balance, 3000 - cut.price);
  const spent = (await b.get('/api/public/giftcards/' + tokenOf(o))).json;
  assert.deepEqual([spent.status, spent.balance], [3000 - cut.price ? 'ready' : 'spent', 3000 - cut.price]);
});

test('after today’s Z a card paid online falls on tomorrow: the sealed day does not move', async () => {
  const { rt, s } = await demo(20);
  // the evening's routine: the drawer counted, the day sealed
  if (s().drawer) {
    const { drawerExpected } = await import('../../server/domain/cash.js');
    let left = drawerExpected(s(), s().drawer);
    const counts = {};
    for (const d of DENOMS) { const n = Math.floor(left / d); if (n) { counts[d] = n; left -= n * d; } }
    await rt.engine.run(S.closeDrawer, { counts }, SYS);
  }
  if (!s().closures.has(DAY)) await rt.engine.run(S.closeDay, {}, SYS);
  const z = { ...s().closures.get(DAY) };
  const totals = dayTotals(s(), DAY);
  const grand = s().grandTotal;

  const o = await buy(rt, browser(rt), { ...ORDER, delivery: 'buyer', sendAt: undefined });
  const [sale] = onlineSales(s(), o.json.id);
  assert.ok(sale, 'issued although the day is sealed');
  const tomorrow = addDays(DAY, 1);
  assert.equal(sale.day, tomorrow);
  assert.deepEqual(s().closures.get(DAY), z, 'today’s Z is unchanged');
  assert.deepEqual(dayTotals(s(), DAY), totals, 'and so are today’s figures');
  assert.equal(s().grandTotal, grand);
  assert.equal(dayTotals(s(), tomorrow).liability, 3000, 'tomorrow’s Z counts it');
  const g = [...s().giftcards.values()].find((x) => x.saleId === sale.id);
  assert.equal(g.expires, addDays(tomorrow, 365));
  // to the buyer, right away: his own text
  const [m] = [...s().messages.values()].filter((x) => x.template === 'giftcard');
  assert.deepEqual([m.to, m.dueAt], ['+33611223344', rt.engine.clock()]);
  assert.match(m.body, /^Barber L'Architecte : merci Sofiane ! Ta carte cadeau de 30 € : code [A-Z0-9-]{14}, valable jusqu'au \d\d\/\d\d\/\d{4}\. Pour l'imprimer ou l'offrir : /);
  // a staff sale stays refused on a sealed day
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  await rejects(rt.engine.run(S.checkout, { lines: [{ kind: 'giftcard', unit: 3000 }], payments: [{ method: 'card', amount: 3000 }] }, { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) }), 'day_closed');
});

test('production with the simulated provider: not sold online, nothing recorded', async () => {
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => instantOf(DAY, 15 * 60), store: memoryStore() });
  const b = browser(rt);
  assert.equal((await b.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  assert.equal((await b.get('/api/public/giftcards')).json.live, false);
  const o = await b.post('/api/public/giftcards', ORDER);
  assert.equal(o.status, 409);
  assert.deepEqual(o.json.error, { code: 'not_live', message: 'Les cartes cadeaux en ligne arrivent bientôt : en vente au salon' });
  assert.equal(rt.engine.state.payments.size, 0);
  assert.equal(rt.engine.state.clients.size, 0);
});

test('the order is checked before the provider is asked for anything', async () => {
  const { rt, s } = await demo();
  const b = browser(rt);
  const payments = s().payments.size;
  const bad = [
    { ...ORDER, amount: 1500 }, { ...ORDER, amount: 20100 }, { ...ORDER, buyer: { first: 'Sofiane', phone: '12' } }, { ...ORDER, buyer: { phone: '0611223344' } },
    { ...ORDER, recipient: { first: 'Karim' } }, { ...ORDER, message: 'x'.repeat(121) }, { ...ORDER, delivery: 'mail' }, { ...ORDER, sendAt: '2027-06-01T10:00' }, { ...ORDER, sendAt: '2026-12-24T25:00' }
  ];
  // six orders a minute from one address: each try from its own
  for (const x of bad) assert.equal((await browser(rt).post('/api/public/giftcards', x)).status, 400, JSON.stringify(x));
  assert.equal(s().payments.size, payments);
  // a moment already past means now; a free amount in whole cents is fine
  const now = await b.post('/api/public/giftcards', { ...ORDER, amount: 4200, sendAt: '2026-11-01T10:00' });
  assert.equal(now.status, 201);
  assert.equal(s().payments.get(now.json.id).gift.sendAt, 0);
  // gift cards switched off in Réglages: not sold online either
  s().settings.payments.giftcard = false;
  assert.equal((await b.get('/api/public/giftcards')).json.live, false);
  assert.equal((await b.post('/api/public/giftcards', ORDER)).status, 409);
});

test('the Comptoir: which cards were bought online, and DO-03’s resend for a code nobody at the salon holds', async () => {
  const { rt, s } = await demo();
  const o = await buy(rt);
  const g = [...s().giftcards.values()].find((x) => x.saleId === onlineSales(s(), o.json.id)[0].id);
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const list = await owner.get('/api/v1/giftshop');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const item = list.json.items.find((x) => x.giftcardId === g.id);
  assert.deepEqual([item.delivery, item.sendAt, item.sms.to, item.sms.status], ['recipient', instantOf('2026-12-24', 19 * 60), '06 •• •• •• 66', 'queued']);
  assert.equal(list.json.items.filter((x) => x.giftcardId === g.id).length, 1);

  const rq = () => ({ 'x-request-id': 'rq-' + Math.random().toString(36).slice(2, 12) });
  const again = await owner.post('/api/v1/giftshop/' + g.id + '/resend', {}, rq());
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const m = s().messages.get(again.json.id);
  assert.deepEqual([m.template, m.to], ['giftcardCode', '+33699887766']);
  assert.ok(m.body.includes(codeFor(rt.secret, o.json.id)), m.body);
  const other = await owner.post('/api/v1/giftshop/' + g.id + '/resend', { phone: '07 12 12 12 12' }, rq());
  assert.equal(s().messages.get(other.json.id).to, '+33712121212');
  // the text carries the card's own page, not just the site
  assert.ok(m.body.includes(ORIGIN + '/cadeau/'), m.body);
  // a card sold at the till is not one of these
  const till = [...s().giftcards.values()].find((x) => !x.online && x.status === 'active');
  if (till) assert.equal((await owner.post('/api/v1/giftshop/' + till.id + '/resend', {}, rq())).status, 404);
  assert.equal((await browser(rt).get('/api/v1/giftshop')).status, 401);
});

test('a credit note lowered below its lines: each line gives back its share, the VAT follows them', async () => {
  const t = await salon();
  const s = t.engine.state;
  await t.engine.run(updateService, { id: t.ids.pack, patch: { pack: { credits: 5, days: 70, serviceIds: [t.ids.cut] } } }, t.asOwner());
  const balm = (await t.engine.run(addProduct, { name: 'Baume', price: 1500, vat: 550 }, t.asOwner())).id;
  const sold = await t.engine.run(S.checkout, { clientId: t.ids.yanis, lines: [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }, { kind: 'product', ref: balm }], payments: [{ method: 'card', amount: 9500 }] }, t.asOwner());
  // the pack is worth 60 € back (80 € less a cut taken), the balm 15 €: 75 € for both lines, 50 € given
  const r = await t.engine.run(S.refund, { saleId: sold.id, amount: 5000, method: 'card', reason: 'Geste', lines: [{ i: 0, qty: 1 }, { i: 2, qty: 1 }] }, t.asOwner());
  const note = s.refunds.get(r.id);
  assert.deepEqual(note.lines.map((l) => [l.kind, l.amount]), [['pack', 4000], ['product', 1000]]);
  assert.equal(note.lines.reduce((x, l) => x + l.amount, 0), 5000, 'the lines add up to the credit note');
  const ttc = (rate) => note.vat.filter((v) => v.rate === rate).reduce((x, v) => x + v.base + v.tax, 0);
  assert.deepEqual([ttc(2000), ttc(550)], [4000, 1000], 'the VAT given back per rate is the lines’ own');
  const recorded = s.sales.get(sold.id).lineRefunds;
  assert.deepEqual([recorded[0].amount, recorded[2].amount], [4000, 1000]);
  assert.ok(s.packs.get(s.sales.get(sold.id).lines[0].packId).voided, 'the pack is still cancelled');
  // what the lowered note did not give back is the ticket's again: 25 € more, without lines (the cut taken stays out)
  const plan = S.refundPlan(s, s.sales.get(sold.id));
  assert.equal(plan.free, 2500);
  await t.engine.run(S.refund, { saleId: sold.id, amount: 2500, method: 'card', reason: 'Le reste' }, t.asOwner());
  assert.equal(S.refundPlan(s, s.sales.get(sold.id)).free, 0);

  // three lines at odd amounts: no cent lost or invented by rounding; a gift card goes back whole
  const odd = await t.engine.run(S.checkout, { lines: [{ kind: 'product', ref: t.ids.oil }, { kind: 'product', ref: balm }, { kind: 'giftcard', unit: 2000 }], payments: [{ method: 'card', amount: 5000 }] }, t.asOwner());
  const r2 = await t.engine.run(S.refund, { saleId: odd.id, amount: 3333, method: 'card', reason: 'Retour', lines: [{ i: 0, qty: 1 }, { i: 1, qty: 1 }, { i: 2, qty: 1 }] }, t.asOwner());
  const n2 = s.refunds.get(r2.id);
  assert.equal(n2.lines.reduce((x, l) => x + l.amount, 0), 3333);
  assert.equal(n2.lines.find((l) => l.kind === 'giftcard').amount, 2000);
  assert.equal(n2.vat.reduce((x, v) => x + v.base + v.tax, 0), 3333 - 2000);
  for (const l of n2.lines.filter((x) => x.kind === 'product')) assert.equal(n2.vat.filter((v) => v.rate === l.vat).reduce((x, v) => x + v.base + v.tax, 0), l.amount);
});

test('a credit note lowered below its lines: rounding never puts a line above its own value', async () => {
  const t = await salon();
  const s = t.engine.state;
  const p = async (name, price, vat) => (await t.engine.run(addProduct, { name, price, vat }, t.asOwner())).id;
  const a = await p('Tondeuse', 4500, 2000), b = await p('Sèche-cheveux', 4500, 2000), c = await p('Peigne', 300, 550);
  const sold = await t.engine.run(S.checkout, { lines: [{ kind: 'product', ref: a }, { kind: 'product', ref: b }, { kind: 'product', ref: c }], payments: [{ method: 'card', amount: 9300 }] }, t.asOwner());
  const r = await t.engine.run(S.refund, { saleId: sold.id, amount: 9299, method: 'card', reason: 'Geste', lines: [{ i: 0, qty: 1 }, { i: 1, qty: 1 }, { i: 2, qty: 1 }] }, t.asOwner());
  const note = s.refunds.get(r.id);
  assert.deepEqual(note.lines.map((l) => l.amount), [4500, 4499, 300]);
  for (const o of S.refundPlan(s, s.sales.get(sold.id)).lines) assert.ok(o.value >= 0, 'no line refunded above its value');
  const ttc = (rate) => note.vat.filter((v) => v.rate === rate).reduce((x, v) => x + v.base + v.tax, 0);
  assert.deepEqual([ttc(2000), ttc(550)], [8999, 300]);
});

test('cancelled or replaced before its text leaves: the planned text is withdrawn, a replacement goes out under the new code', async () => {
  const { rt, clock, s } = await demo();
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) });
  const XMAS_AT = instantOf('2026-12-24', 19 * 60);

  // refunded by its gift card line (a change of mind): the text for Christmas Eve never leaves
  const o1 = await buy(rt);
  const sale1 = onlineSales(s(), o1.json.id)[0];
  await rt.engine.run(S.refund, { saleId: sale1.id, amount: 3000, method: 'online', reason: 'Rétractation', lines: [{ i: 0, qty: 1 }] }, asOwner());
  assert.deepEqual([s().messages.get('msg_giftshop_' + o1.json.id).status, s().messages.get('msg_giftshop_' + o1.json.id).error], ['skipped', 'Carte annulée']);
  assert.equal((await browser(rt).get('/api/public/giftcards/' + tokenOf(o1))).json.status, 'void');

  // reissued after a leak: the old text stops, the same text leaves at the same moment under the new code
  const o2 = await buy(rt);
  const old = [...s().giftcards.values()].find((x) => x.saleId === onlineSales(s(), o2.json.id)[0].id);
  const oldCode = codeFor(rt.secret, o2.json.id);
  const re = await rt.engine.run(S.reissueGiftcard, { id: old.id }, asOwner());
  assert.deepEqual(re.planned, { to: '06 •• •• •• 66', dueAt: XMAS_AT });
  const was = s().messages.get('msg_giftshop_' + o2.json.id);
  assert.deepEqual([was.status, was.error], ['skipped', 'Carte remplacée']);
  const now = s().messages.get('msg_giftshop_' + o2.json.id + '_' + re.id);
  assert.deepEqual([now.status, now.to, now.dueAt, now.template], ['queued', '+33699887766', XMAS_AT, 'giftcard']);
  assert.ok(now.body.includes(re.code) && !now.body.includes(oldCode), now.body);
  clock.now = XMAS_AT + 60000;
  assert.equal((await rt.engine.run(claimMessage, { id: was.id }, SYS)).ok, false, 'the dead code never leaves');
  clock.now = instantOf(DAY, 16 * 60);

  // the replacement still reads "en ligne", with its text; its page says the code changed, its resend refuses
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const item = (await b.get('/api/v1/giftshop')).json.items.find((x) => x.paymentId === o2.json.id);
  assert.deepEqual([item.giftcardId, item.cardIds, item.reissued, item.sms.state, item.sms.dueAt], [re.id, [old.id, re.id], true, 'planned', XMAS_AT]);
  const page = (await browser(rt).get('/api/public/giftcards/' + tokenOf(o2))).json;
  assert.deepEqual([page.status, page.code, page.hidden, page.last4], ['ready', null, 'reissued', re.last4]);
  const rs = await b.post('/api/v1/giftshop/' + re.id + '/resend', {}, { 'x-request-id': 'rq-reissued1' });
  assert.equal(rs.status, 409, JSON.stringify(rs.json));
  // refunded later: the replacement's text is withdrawn too
  await rt.engine.run(S.refund, { saleId: onlineSales(s(), o2.json.id)[0].id, amount: 3000, method: 'online', reason: 'Rétractation', lines: [{ i: 0, qty: 1 }] }, asOwner());
  assert.deepEqual([s().messages.get(now.id).status, s().messages.get(now.id).error], ['skipped', 'Carte annulée']);
});

test('the resend: to the order’s numbers for whoever rings up, to another number only for those who may reissue a card', async () => {
  const { rt, s } = await demo();
  const o = await buy(rt);
  const g = [...s().giftcards.values()].find((x) => x.saleId === onlineSales(s(), o.json.id)[0].id);
  const tab = browser(rt);
  assert.equal((await tab.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await tab.post('/api/auth/logout');
  const jkut = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === 'JKut');
  assert.equal((await tab.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut })).status, 200);
  const rq = () => ({ 'x-request-id': 'rq-' + Math.random().toString(36).slice(2, 12) });
  const away = await tab.post('/api/v1/giftshop/' + g.id + '/resend', { phone: '07 00 00 00 01' }, rq());
  assert.equal(away.status, 403, JSON.stringify(away.json));
  assert.ok(![...s().messages.values()].some((m) => m.to === '+33700000001'));
  const same = await tab.post('/api/v1/giftshop/' + g.id + '/resend', {}, rq());
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.equal(s().messages.get(same.json.id).to, '+33699887766');
  // the buyer's own number is the order's too
  assert.equal((await tab.post('/api/v1/giftshop/' + g.id + '/resend', { phone: '06 11 22 33 44' }, rq())).status, 200);
});

test('production: a Stripe test key sells nothing; without an SMS provider the card is not texted', async () => {
  const prod = async (env) => {
    const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', STRIPE_WEBHOOK_SECRET: 'whsec_test', ...env }, clock: () => instantOf(DAY, 15 * 60), store: memoryStore() });
    assert.equal((await browser(rt).post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
    return rt;
  };
  const test = await prod({ STRIPE_SECRET_KEY: 'sk_test_0123456789' });
  assert.equal(test.pay.name, 'stripe');
  assert.equal((await browser(test).get('/api/public/giftcards')).json.live, false);
  const o = await browser(test).post('/api/public/giftcards', ORDER);
  assert.deepEqual([o.status, o.json.error.code], [409, 'not_live']);
  assert.equal(test.engine.state.payments.size, 0);

  const live = await prod({ STRIPE_SECRET_KEY: 'sk_live_0123456789' });
  const info = (await browser(live).get('/api/public/giftcards')).json;
  assert.deepEqual([info.live, info.sms, info.on], [true, false, true]);
  const toThem = await browser(live).post('/api/public/giftcards', ORDER);
  assert.deepEqual([toThem.status, toThem.json.error.code], [400, 'no_sms']);
  assert.equal(live.engine.state.payments.size, 0, 'refused before the provider is asked');
});

test('an abandoned checkout leaves no client file', async () => {
  const { rt, s } = await demo();
  const b = browser(rt);
  const files = s().clients.size;
  const o = await b.post('/api/public/giftcards', { ...ORDER, buyer: { first: 'Abandon', phone: '06 01 02 03 04' } });
  assert.equal(o.status, 201);
  assert.equal((await b.post('/api/public/payments/' + o.json.id + '/simulate', { outcome: 'cancel' })).status, 200);
  await fulfilGiftcard(req(rt), o.json.id);
  assert.equal(s().clients.size, files);
  assert.ok(!s().clientByPhone.has('+33601020304'));
  assert.equal((await b.get('/api/public/giftcards/' + tokenOf(o))).json.status, 'failed');
});
