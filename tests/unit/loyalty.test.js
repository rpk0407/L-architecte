// The loyalty engine (FID-02): a stamp per paid visit, full cards that become rewards, the till applying a reward as a
// real discount on a taxed line, refunds that take stamps back and give rewards back, the right not to take part,
// merged and erased files, referral, the launch's head start, the old site's cards, the simulator and the demo.
// v1 is stamps only (points and birthdays are later ideas, superseded in the spec's amendments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, at, DAY } from '../helpers.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { addDays } from '../../shared/dates.js';
import { capsOf } from '../../server/domain/permissions.js';
import { updateSettings } from '../../server/commands/shop.js';
import { addService } from '../../server/commands/catalog.js';
import { addStaff } from '../../server/commands/team.js';
import { addClient, mergeClients, eraseClient } from '../../server/commands/clients.js';
import { checkout, refund, sendReceipt, closeDay } from '../../server/commands/sales.js';
import { launchLoyalty, adjustLoyalty, giftReward, voidReward, restoreReward, claimReferral, importLoyalty, setLoyaltyOff, loyaltyAfterRefund } from '../../server/commands/loyalty.js';
import { cardOf, rewardsOf, simulate, liability, programStats, referralOf, cfgOf, rootOf, loyaltyExport } from '../../server/domain/loyalty.js';
import { cover } from '../../server/domain/membership.js';
import { loyaltyExtension } from '../../server/projections/loyalty.js';
import { rewardValue, rewardWords, cardWords } from '../../shared/loyalty.js';
import { clientCard, saleView } from '../../server/http/views.js';
import loyaltySection from '../../server/settings/loyalty.js';
import { refLink } from '../../server/http/routes-loyalty.js';
import { memoryStore } from '../../server/store/memory.js';
import { fileStore } from '../../server/store/file.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const d = (n) => addDays(DAY, n);
/** the words with plain spaces (fmtEur puts a no-break space before €) */
const sp = (x) => String(x).replace(/\u00a0/g, ' ');

/** A production salon with the stamp card on (goal 3 unless said), a 25 € classic cut, a 15 € beard, an 8 € contour. */
async function club(loyalty = {}, store = undefined) {
  const t = await salon(store ? { store } : {});
  const e = t.engine;
  const svc = async (x) => (await e.run(addService, x, t.asOwner())).id;
  t.ids.classic = await svc({ name: 'Coupe classique', category: 'Coupes', price: 2500, dur: 30 });
  t.ids.barbe = await svc({ name: 'Barbe', category: 'Barbe', price: 1500, dur: 30 });
  t.ids.contour = await svc({ name: 'Contour', category: 'Barbe', price: 800, dur: 15 });
  await e.run(updateSettings, { loyalty: { enabled: true, goal: 3, ...loyalty } }, t.asOwner());
  const client = async (first, phone, more = {}) => (await e.run(addClient, { first, phone, ...more }, t.asOwner())).id;
  const go = (day, h = 10) => { t.clock.now = at(day, h); };
  /** a ticket paid by card for `due` */
  const pay = (clientId, lines, { as = t.asOwner(), due = 0, ...more } = {}) => e.run(checkout, { clientId, lines, payments: [{ method: 'card', amount: due }], ...more }, as);
  const cut = (more = {}) => ({ kind: 'service', ref: t.ids.classic, ...more });
  /** three paid cuts on three days from `from`: a full card (goal 3) */
  const fill = async (cid, from = 0) => { for (let i = 0; i < 3; i++) { go(d(from + i)); await pay(cid, [cut()], { due: 2500 }); } };
  const ev = (type) => e.journal.filter((x) => x.type === type);
  const s = () => e.state;
  return { ...t, e, s, client, go, pay, cut, fill, ev };
}

test('shared words and values: what a reward takes off a line, and how a card reads', () => {
  const svc = { kind: 'service', refs: [], cap: 2500 };
  assert.equal(rewardValue(svc, { kind: 'service', ref: 'a', unit: 3000 }), 2500, 'up to the cap');
  assert.equal(rewardValue(svc, { kind: 'service', ref: 'a', unit: 2000, qty: 2 }), 2000, 'one cut, not two');
  assert.equal(rewardValue({ kind: 'service', refs: ['b'] }, { kind: 'service', ref: 'a', unit: 2000 }), 0, 'another service');
  assert.equal(rewardValue({ kind: 'service', refs: ['b'] }, { kind: 'service', ref: 'b', unit: 2000 }), 2000, 'no cap: the whole price');
  assert.equal(rewardValue(svc, { kind: 'product', ref: 'p', unit: 1500 }), 0, 'a service reward never pays a product');
  assert.equal(rewardValue({ kind: 'amount', amount: 500 }, { kind: 'product', ref: 'p', unit: 1500 }), 500);
  assert.equal(rewardValue({ kind: 'amount', amount: 500 }, { kind: 'service', ref: 'a', unit: 1500, discount: 1200 }), 300, 'never below 0');
  assert.equal(rewardValue({ kind: 'amount', amount: 500 }, { kind: 'giftcard', unit: 3000 }), 0);
  assert.equal(rewardWords({ kind: 'service', refs: ['a'] }, () => 'Coupe classique'), 'Coupe classique offerte');
  assert.equal(sp(rewardWords(svc)), 'Une prestation offerte (jusqu’à 25 €)');
  assert.equal(sp(rewardWords({ kind: 'amount', amount: 500 })), '5 € offerts');
  assert.equal(cardWords({ units: 6, goal: 9 }), '6/9 tampons');
  assert.equal(cardWords({ units: 180, goal: 250, model: 'points' }), '180/250 points');
  assert.equal(cardWords({ units: 0, goal: 9, rewards: [{ reward: svc }] }), 'Prochaine prestation offerte');
  assert.equal(cardWords({ units: 2, goal: 9, off: true }), 'Ne participe pas');
});

test('the settings section: off by default, its schema, its go-live line', async () => {
  const def = loyaltySection.defaults();
  assert.deepEqual(def, { enabled: false, goal: 9, minNet: 1000, reward: { kind: 'service', refs: [], cap: 2500 }, rewardDays: 180, resetDays: 365, headStart: 'half', referral: { enabled: false, referrer: { kind: 'amount', amount: 500 }, referee: { kind: 'amount', amount: 500 }, perYear: 5 } });
  const ok = loyaltySection.schema.parse({ goal: '5', reward: { kind: 'amount', amount: 800, refs: ['x'] }, resetDays: 0, referral: { enabled: true, referee: { kind: 'service', refs: ['sv_1'] } } }, 'loyalty');
  assert.deepEqual(ok, { goal: 5, reward: { kind: 'amount', amount: 800 }, resetDays: 0, referral: { enabled: true, referee: { refs: ['sv_1'], kind: 'service' } } });
  for (const [x, msg] of [[{ goal: 1 }, 'loyalty.goal : entre 2 et 5000'], [{ resetDays: 30 }, 'loyalty.resetDays : 0 (jamais) ou entre 90 et 1095'], [{ reward: { kind: 'points' } }, 'loyalty.reward.kind : valeur non permise'],
    [{ reward: { kind: 'service', cap: 50 } }, 'loyalty.reward.cap : 0 (le prix entier) ou entre 100 et 20000'], [{ minNet: 10001 }, 'loyalty.minNet : entre 0 et 10000'], [{ referral: { perYear: 21 } }, 'loyalty.referral.perYear : entre 0 et 20'],
    [{ headStart: 'all' }, 'loyalty.headStart : valeur non permise'], [{ reward: { kind: 'service', refs: ['a', 'a'] } }, 'loyalty.reward.refs : prestation en double']]) {
    assert.throws(() => loyaltySection.schema.parse(x, 'loyalty'), { message: msg }, JSON.stringify(x));
  }
  // a cap once set is cleared with 0 (settings merge): the whole price again
  assert.deepEqual(loyaltySection.schema.parse({ reward: { kind: 'service', cap: 0 } }, 'loyalty'), { reward: { kind: 'service', refs: [], cap: 0 } });
  assert.equal(rewardValue({ kind: 'service', refs: [], cap: 0 }, { kind: 'service', ref: 'a', unit: 4500 }), 4500);
  assert.equal(sp(rewardWords({ kind: 'service', refs: [], cap: 0 })), 'Une prestation offerte');
  const t = await salon();
  const golive = () => loyaltySection.golive.state(t.engine.state);
  assert.deepEqual(golive(), { on: false, enabled: false, launched: false, blocker: 'À lancer après la synchro finale WordPress' });
  await rejects(t.engine.run(updateSettings, { loyalty: { enabled: true } }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(launchLoyalty, {}, t.asOwner()), 'off');
  assert.equal(t.engine.state.loyalty.launched, null, 'pressed while off: nothing spent');
  await t.engine.run(updateSettings, { loyalty: { enabled: true } }, t.asOwner());
  assert.deepEqual(golive(), { on: false, enabled: true, launched: false, blocker: 'Programme activé : lance la reprise des cartes' });
  await t.engine.run(launchLoyalty, {}, t.asOwner());
  assert.deepEqual(golive(), { on: true, enabled: true, launched: true, blocker: '' });
  // a receipt text saved before the card existed: Mise en route says how to get it back
  await t.engine.run(updateSettings, { messages: { templates: { receipt: "L'Architecte : merci {prenom} ! Ton ticket {ticket} de {montant} : {lien}" } } }, t.asOwner());
  assert.equal(golive().blocker, 'Le reçu SMS n’affiche pas la carte : Réglages › Messages › Reçu › Texte d’origine');
});

test('stamps, goal 3: a paid visit a day from 10 € earns one; the third completes the card; a small ticket, a carnet cut or no client earn nothing', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  let card = cardOf(t.s(), karim, d(2));
  assert.equal(card.units, 0);
  assert.equal(card.goal, 3);
  assert.equal(card.rewards.length, 1);
  assert.deepEqual({ ...card.rewards[0], label: sp(card.rewards[0].label) }, { id: card.rewards[0].id, source: 'card', reward: { kind: 'service', refs: [], cap: 2500 }, label: 'Une prestation offerte (jusqu’à 25 €)', expires: addDays(d(2), 180) });
  assert.deepEqual(card.last.map((x) => [sp(x.what), x.units]), [['Carte complète · Une prestation offerte (jusqu’à 25 €)', -3], ['Visite', 1], ['Visite', 1], ['Visite', 1]]);
  assert.equal(card.lastEarn, d(2));
  // the stamp is on the ticket, the full card an event
  assert.deepEqual([...t.s().sales.values()].map((x) => x.loyalty), [{ units: 1 }, { units: 1 }, { units: 1 }]);
  assert.equal(t.ev('loyalty.rewarded').length, 1);
  assert.equal(t.ev('loyalty.rewarded')[0].data.saleId, [...t.s().sales.values()][2].id);

  // two tickets the same day: one stamp
  t.go(d(3));
  await t.pay(karim, [t.cut()], { due: 2500 });
  await t.pay(karim, [{ kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.equal(cardOf(t.s(), karim, d(3)).units, 1);

  // 8 € on services, the minimum is 10 €: none
  const sam = await t.client('Sam', '06 22 22 22 22');
  await t.pay(sam, [{ kind: 'service', ref: t.ids.contour }], { due: 800 });
  assert.equal(cardOf(t.s(), sam, d(3)).units, 0);
  // a cut the carnet pays: already the loyal price (and the carnet itself is not a visit)
  t.go(d(4));
  await t.pay(sam, [{ kind: 'pack', ref: t.ids.pack }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], { due: 8000 });
  assert.equal(cardOf(t.s(), sam, d(4)).units, 0);
  // a product bought with it does not earn either (v1: services only)
  t.go(d(5));
  await t.pay(sam, [{ kind: 'product', ref: t.ids.oil }], { due: 1500 });
  assert.equal(cardOf(t.s(), sam, d(5)).units, 0);
  // no client file: no stamp, no event
  const before = t.e.journal.length;
  const anon = await t.pay(undefined, [t.cut()], { due: 2500 });
  assert.equal(t.s().sales.get(anon.id).loyalty, undefined);
  assert.equal(t.e.journal.slice(before).filter((x) => x.type.startsWith('loyalty.')).length, 0);
  // the programme switched off: nothing earned
  await t.e.run(updateSettings, { loyalty: { enabled: false } }, t.asOwner());
  t.go(d(6));
  await t.pay(sam, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), sam, d(6)).units, 0);
});

test('a barber applies a reward: the cut at 0 €, its discount the reward’s, once, on its owner’s ticket only; his own cap unchanged', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  const nael = await t.client('Naël', '06 33 33 33 33');
  await t.fill(karim);
  const rid = rewardsOf(t.s(), karim, d(2))[0].id;
  t.go(d(3));
  const ali = t.asStaff('Ali');
  const res = await t.pay(karim, [t.cut({ rewardId: rid })], { as: ali, due: 0 });
  assert.equal(res.totals.total, 0);
  const line = t.s().sales.get(res.id).lines[0];
  assert.equal(line.discount, 2500);
  assert.equal(line.net, 0);
  assert.equal(line.name, 'Coupe classique · fidélité');
  assert.deepEqual(line.reward, { id: rid, amount: 2500 });
  const red = t.ev('loyalty.redeemed');
  assert.equal(red.length, 1);
  assert.deepEqual(red[0].data, { id: rid, cid: karim, saleId: res.id, amount: 2500 });
  assert.equal(t.s().loyalty.rewards.get(rid).usedBy, res.id);
  // a free cut earns no stamp
  assert.equal(t.s().sales.get(res.id).loyalty, undefined);
  assert.equal(cardOf(t.s(), karim, d(3)).rewards.length, 0);

  await rejects(t.pay(karim, [t.cut({ rewardId: rid })], { as: ali, due: 0 }), 'reward_used');
  await rejects(t.pay(nael, [t.cut({ rewardId: rid })], { as: ali, due: 0 }), 'reward_owner');
  // a discount the barber types is checked as before: 20 % is over his 10 %
  await rejects(t.pay(nael, [t.cut()], { as: ali, due: 2000, discount: { amount: 500, reason: 'Geste commercial' } }), 'discount');

  // the desk has no right to discounts, and may still apply a reward: the system checked it
  const desk = await t.e.run(addStaff, { name: 'Inès', role: 'desk' }, t.asOwner());
  const st = t.s().staff.get(desk.id);
  const asDesk = { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, t.s().settings) };
  assert.ok(!asDesk.caps.has('sale.discount'));
  await t.fill(nael, 4);
  t.go(d(7));
  const nrw = rewardsOf(t.s(), nael, d(7))[0].id;
  const r2 = await t.pay(nael, [{ kind: 'service', ref: t.ids.beard, rewardId: nrw }], { as: asDesk, due: 500 });
  assert.equal(r2.totals.total, 500, 'a 30 € service, 25 € off');
});

test('the till’s refusals: expired, one per ticket, another service, a carnet or membership cut, a voided reward', async () => {
  const t = await club({ rewardDays: 30 });
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  const rid = rewardsOf(t.s(), karim, d(2))[0].id;
  const gift = await t.e.run(giftReward, { clientId: karim, reward: { kind: 'service', refs: [t.ids.barbe] }, days: 60 }, t.asOwner());
  t.go(d(3));
  const e1 = await rejects(t.pay(karim, [t.cut({ rewardId: gift.id })], { due: 2500 }), 'reward_line');
  assert.equal(e1.message, 'Elle s’applique à « Barbe ».');
  await rejects(t.pay(karim, [t.cut({ rewardId: rid }), { kind: 'service', ref: t.ids.barbe, rewardId: gift.id }], { due: 0 }), 'reward_one');
  await rejects(t.pay(karim, [{ kind: 'pack', ref: t.ids.pack }, t.cut({ packId: 'new', rewardId: rid })], { due: 8000 }), 'reward_cover');
  // voided by the owner: taken back, the till says so
  await t.e.run(voidReward, { id: gift.id }, t.asOwner());
  const e2 = await rejects(t.pay(karim, [{ kind: 'service', ref: t.ids.barbe, rewardId: gift.id }], { due: 1500 }), 'reward_used');
  assert.equal(e2.message, 'Cette récompense a été annulée.');
  await rejects(t.e.run(voidReward, { id: gift.id }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.e.run(giftReward, { clientId: karim, reward: { kind: 'amount', amount: 500 } }, t.asStaff('Ali')), 'forbidden');
  // past its 30 days
  t.go(d(40));
  const e3 = await rejects(t.pay(karim, [t.cut({ rewardId: rid })], { due: 0 }), 'reward_expired');
  assert.equal(e3.message, 'Cette récompense a expiré le ' + addDays(d(2), 30).slice(8, 10) + '/' + addDays(d(2), 30).slice(5, 7) + '.');
  await rejects(t.pay(karim, [t.cut({ rewardId: 'lrw_nope' })], { due: 0 }), 'not_found');
});

test('a reward is a discount on a taxed line: Coupe 25 € offered + Barbe 15 € → revenue and VAT on 15 €', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  const rid = rewardsOf(t.s(), karim, d(2))[0].id;
  t.go(d(3));
  const res = await t.pay(karim, [t.cut({ rewardId: rid }), { kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.equal(res.totals.gross, 4000);
  assert.equal(res.totals.discount, 2500);
  assert.equal(res.totals.revenue, 1500);
  assert.deepEqual(res.totals.vat, [{ rate: 2000, base: 1250, tax: 250 }]);
  // the beard paid 15 €: that ticket earns its stamp
  assert.deepEqual(t.s().sales.get(res.id).loyalty, { units: 1 });
});

test('refunds: the stamp taken back (the reward stays, the debt is paid by the next visit), a used reward given back, idempotent', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  const third = [...t.s().sales.values()][2];
  t.go(d(3));
  const input = { saleId: third.id, amount: 2500, method: 'card', reason: 'Erreur de caisse' };
  const owner = { ...t.asOwner(), requestId: 'refund-third-0001' };
  await t.e.run(refund, input, owner);
  const rev = t.ev('loyalty.reversed');
  assert.equal(rev.length, 1);
  assert.equal(rev[0].data.units, -1);
  assert.equal(rev[0].data.saleId, third.id);
  let card = cardOf(t.s(), karim, d(3));
  assert.equal(card.units, -1);
  assert.equal(card.rewards.length, 1, 'the reward stays');
  assert.equal(card.last[0].what, 'Remboursement du ticket');
  // the same request again: nothing new; the hook again on the stored refund: nothing to do
  const n = t.e.journal.length;
  await t.e.run(refund, input, owner);
  assert.equal(t.e.journal.length, n);
  const ctx = { drafts: [], local: { day: d(3) }, emit(type, data) { this.drafts.push({ type, data }); }, id: (p) => p + '_x' };
  loyaltyAfterRefund(t.s(), ctx, t.s().sales.get(third.id), t.s().refunds.get(rev[0].data.refundId));
  assert.deepEqual(ctx.drafts, []);
  // the next paid visit pays the debt back
  t.go(d(4));
  await t.pay(karim, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), karim, d(4)).units, 0);

  // the ticket a reward was used on, refunded in full: the reward comes back, 30 days at least
  const rid = card.rewards[0].id;
  t.go(d(5));
  const used = await t.pay(karim, [t.cut({ rewardId: rid }), { kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.equal(rewardsOf(t.s(), karim, d(5)).length, 0);
  // a part refunded: the reward stays used, the stamp stays (10 € left on services)
  await t.e.run(refund, { saleId: used.id, amount: 300, method: 'card', reason: 'Geste' }, t.asOwner());
  assert.equal(t.ev('loyalty.restored').length, 0);
  assert.equal(t.ev('loyalty.reversed').length, 1);
  await t.e.run(refund, { saleId: used.id, amount: 1200, method: 'card', reason: 'Client mécontent' }, t.asOwner());
  const back = t.ev('loyalty.restored');
  assert.equal(back.length, 1);
  assert.equal(back[0].data.id, rid);
  assert.ok(back[0].data.expires >= addDays(d(5), 30));
  assert.equal(t.ev('loyalty.reversed').length, 2, 'its stamp too');
  assert.deepEqual(rewardsOf(t.s(), karim, d(5)).map((r) => r.id), [rid]);
  t.go(d(6));
  const again = await t.pay(karim, [t.cut({ rewardId: rid })], { due: 0 });
  assert.equal(again.totals.total, 0, 'usable again');
  assert.equal(t.s().loyalty.rewards.get(rid).restored.length, 1);
});

test('the right not to take part: nothing is earned, the card says so, a reward already earned stays usable', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  await t.e.run(setLoyaltyOff, { clientId: karim, off: true }, t.asStaff('Ali'));
  const up = t.ev('client.updated').at(-1);
  assert.deepEqual(up.data, { id: karim, cid: karim, patch: { loyaltyOff: true }, fields: [] });
  assert.equal(t.s().clients.get(karim).loyaltyOff, true);
  const n = t.e.journal.length;
  await t.e.run(setLoyaltyOff, { clientId: karim, off: true }, t.asOwner());
  assert.equal(t.e.journal.length, n, 'nothing to change');
  t.go(d(3));
  const paid = await t.pay(karim, [{ kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.equal(t.s().sales.get(paid.id).loyalty, undefined);
  const card = cardOf(t.s(), karim, d(3));
  assert.equal(card.off, true);
  assert.equal(cardWords({ ...card, rewards: [] }), 'Ne participe pas');
  await rejects(t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Tampon oublié' }, t.asOwner()), 'loyalty_off');
  t.go(d(4));
  const free = await t.pay(karim, [t.cut({ rewardId: card.rewards[0].id })], { due: 0 });
  assert.equal(free.totals.total, 0);
  await t.e.run(setLoyaltyOff, { clientId: karim, off: false }, t.asOwner());
  t.go(d(5));
  await t.pay(karim, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), karim, d(5)).units, 1);
});

test('stamps by hand: one a day at the till for a forgotten stamp, any number by the owner; the reason stays out of the chain', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  const ali = t.asStaff('Ali');
  await t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Tampon oublié' }, ali);
  await rejects(t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Passage sans ticket' }, ali), 'adjusted');
  await rejects(t.e.run(adjustLoyalty, { clientId: karim, units: 2, reason: 'Tampon oublié' }, ali), 'forbidden');
  await rejects(t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Mon cousin' }, ali), 'invalid');
  // a ticket that earned today: no stamp by hand on top
  const sam = await t.client('Sam', '06 22 22 22 22');
  await t.pay(sam, [t.cut()], { due: 2500 });
  await rejects(t.e.run(adjustLoyalty, { clientId: sam, units: 1, reason: 'Tampon oublié' }, ali), 'adjusted');
  // the owner: any number, any reason, kept as personal data
  await t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Venu avec son frère Karim Benali' }, t.asOwner());
  const last = t.ev('loyalty.earned').at(-1);
  assert.deepEqual(last.pii, { note: 'Venu avec son frère Karim Benali' });
  assert.ok(!JSON.stringify(last.data).includes('frère'));
  assert.equal(last.data.reason, 'adjust');
  assert.equal(cardOf(t.s(), karim, DAY).units, 2);
  // the third completes the card
  t.go(d(1));
  const res = await t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Tampon oublié' }, ali);
  assert.equal(res.rewards, 1);
  assert.equal(cardOf(t.s(), karim, d(1)).rewards.length, 1);
  await t.e.run(adjustLoyalty, { clientId: karim, units: -2, reason: 'Erreur de saisie' }, t.asOwner());
  assert.equal(cardOf(t.s(), karim, d(1)).units, -2);
  // the feed: the owner and the managers see the adjustments, a barber does not
  const f = t.s().feed.filter((x) => x.type === 'loyalty.earned').at(-1);
  const ownerCaps = t.asOwner().caps;
  assert.equal(loyaltyExtension.item({ s: t.s(), caps: ownerCaps }, f).title, 'Ajustement fidélité · -2 · Karim');
  assert.equal(loyaltyExtension.item({ s: t.s(), caps: ali.caps }, f), null);
  const g = t.s().feed.filter((x) => x.type === 'loyalty.rewarded').at(-1);
  assert.equal(loyaltyExtension.item({ s: t.s(), caps: ownerCaps }, g).title, 'Récompense offerte · Karim · Une prestation');
});

test('a card with no visit for resetDays starts again; a debt is kept', async () => {
  const t = await club({ resetDays: 90 });
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.pay(karim, [t.cut()], { due: 2500 });
  t.go(d(1));
  await t.pay(karim, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), karim, d(1)).units, 2);
  assert.equal(cardOf(t.s(), karim, d(92)).units, 0, 'more than 90 days since the last visit');
  t.go(d(95));
  await t.pay(karim, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), karim, d(95)).units, 1, 'starts again from this visit');
  await t.e.run(adjustLoyalty, { clientId: karim, units: -3, reason: 'Erreur' }, t.asOwner());
  assert.equal(cardOf(t.s(), karim, d(300)).units, -2, 'a debt is not wiped by time');
});

test('two files merged: one card with the stamps of both', async () => {
  const t = await club({ goal: 9 });
  const a = await t.client('Karim', '06 11 11 11 11');
  const b = await t.client('Karim', '06 44 44 44 44');
  await t.pay(a, [t.cut()], { due: 2500 });
  t.go(d(1));
  await t.pay(b, [t.cut()], { due: 2500 });
  await t.e.run(adjustLoyalty, { clientId: b, units: 2, reason: 'Ancienne carte' }, t.asOwner());
  await t.e.run(mergeClients, { from: b, into: a }, t.asOwner());
  assert.equal(cardOf(t.s(), a, d(1)).units, 4);
  assert.equal(cardOf(t.s(), b, d(1)).units, 4, 'the merged file reads the one kept');
  // one earning ticket a day across both files
  t.go(d(2));
  await t.pay(a, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), a, d(2)).units, 5);
});

test('referral: two persons, a new client, a referrer who came, perYear a year; the referrer’s reward on the first ticket, voided if refunded before use', async () => {
  const t = await club({ goal: 9, referral: { enabled: true, perYear: 5 } });
  const karim = await t.client('Karim', '06 12 34 99 78', { email: 'karim@exemple.fr' });
  const till = (refereeId, referrerId = karim) => t.e.run(claimReferral, { refereeId, referrerId, via: 'till' }, t.asStaff('Ali'));
  const n0 = await t.client('Naël', '06 90 00 00 00');
  assert.deepEqual(await till(n0), { ok: false, why: 'referrer', message: 'Le parrain doit être déjà venu au salon.' });
  await t.pay(karim, [t.cut()], { due: 2500 });
  // the same person under two numbers: same last 8 digits, or the same e-mail
  const twin = await t.client('Karim', '+32 4 12 34 99 78');
  assert.equal((await till(twin)).why, 'same');
  const mail = await t.client('Kad', '06 90 00 00 09', { email: 'KARIM@exemple.fr' });
  assert.equal((await till(mail)).why, 'same');
  assert.equal((await till(karim)).why, 'self');
  const came = await t.client('Lou', '06 90 00 00 08');
  await t.pay(came, [{ kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.equal((await till(came)).why, 'known');
  await rejects(t.e.run(claimReferral, { refereeId: n0, referrerId: karim, via: 'link' }, t.asStaff('Ali')), 'forbidden');

  const ok = await till(n0);
  assert.equal(ok.ok, true);
  assert.equal((await till(n0)).why, 'twice');
  const referred = t.ev('loyalty.referred').at(-1);
  assert.deepEqual(referred.data, { id: ok.id, cid: n0, peer: karim, via: 'till', day: DAY, year: 2026 });
  assert.deepEqual(referred.pii, { by: karim });
  const welcome = t.ev('loyalty.rewarded').at(-1);
  assert.deepEqual([welcome.data.source, welcome.data.clientId, welcome.data.expires, welcome.data.reward], ['referee', n0, addDays(DAY, 60), { kind: 'amount', amount: 500 }]);
  assert.equal(cardOf(t.s(), n0, DAY).referredBy, karim);
  // four more this year, then the limit
  for (let i = 1; i <= 4; i++) assert.equal((await till(await t.client('Filleul', '06 90 00 01 0' + i))).ok, true);
  assert.equal((await till(await t.client('Sixième', '06 90 00 01 09'))).why, 'limit');
  assert.equal(referralOf(t.s(), karim).count, 5);

  // the referee's first paid ticket: the referrer's reward, naming the referee only in pii
  t.go(d(1));
  const first = await t.pay(n0, [t.cut()], { due: 2500 });
  const rw = t.ev('loyalty.rewarded').at(-1);
  assert.deepEqual([rw.data.source, rw.data.clientId, rw.data.cid, rw.data.peer, rw.data.saleId, rw.data.year], ['referrer', karim, karim, n0, first.id, 2026]);
  assert.deepEqual(rw.pii, { for: n0 });
  // not on his second
  t.go(d(2));
  await t.pay(n0, [t.cut()], { due: 2500 });
  assert.equal(t.ev('loyalty.rewarded').filter((x) => x.data.source === 'referrer').length, 1);
  // that first ticket refunded in full before Karim used his reward: voided
  await t.e.run(refund, { saleId: first.id, amount: 2500, method: 'card', reason: 'Annulé' }, t.asOwner());
  assert.deepEqual(t.ev('loyalty.voided').map((x) => x.data), [{ id: rw.data.id, cid: karim, why: 'refund' }]);
  assert.equal(rewardsOf(t.s(), karim, d(2)).length, 0);

  // another referee whose referrer already used the reward: the loss is accepted, the feed says so
  const f1 = [...t.s().loyalty.referrals.values()].find((x) => x.refereeId !== n0);
  t.go(d(3));
  const f1first = await t.pay(f1.refereeId, [t.cut()], { due: 2500 });
  const kRw = rewardsOf(t.s(), karim, d(3)).find((x) => x.source === 'referrer');
  await t.pay(karim, [t.cut({ rewardId: kRw.id })], { due: 2000 });
  t.go(d(4));
  await t.e.run(refund, { saleId: f1first.id, amount: 2500, method: 'card', reason: 'Annulé' }, t.asOwner());
  assert.equal(t.ev('loyalty.voided').length, 1);
  const kept = t.ev('loyalty.reversed').at(-1);
  assert.equal(kept.data.referral, 'kept');
  const f = t.s().feed.filter((x) => x.type === 'loyalty.reversed').at(-1);
  assert.equal(loyaltyExtension.item({ s: t.s(), caps: t.asOwner().caps }, f).title, 'Parrainage remboursé après usage · Karim');
  // off: nobody is referred
  await t.e.run(updateSettings, { loyalty: { referral: { enabled: false } } }, t.asOwner());
  assert.equal((await till(await t.client('Tard', '06 90 00 02 01'))).why, 'off');
});

test('a free cut rung by mistake: a 0 € ticket has nothing to refund, the owner gives its reward back while the day is open', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  const rid = rewardsOf(t.s(), karim, d(2))[0].id;
  t.go(d(3));
  const free = await t.pay(karim, [t.cut({ rewardId: rid })], { as: t.asStaff('Ali'), due: 0 });
  assert.equal(free.totals.revenue, 0);
  // the ticket says why it is free: the line keeps its reward, the detail reads « Fidélité »
  assert.deepEqual(saleView(t.s(), t.s().sales.get(free.id), new Set()).lines[0].reward, { id: rid, amount: 2500 });
  await rejects(t.e.run(refund, { saleId: free.id, amount: 1, method: 'card', reason: 'Erreur' }, t.asOwner()), 'invalid');
  await rejects(t.e.run(restoreReward, { id: rid }, t.asStaff('Ali')), 'forbidden');
  const back = await t.e.run(restoreReward, { id: rid }, t.asOwner());
  const ev = t.ev('loyalty.restored');
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].data, { id: rid, cid: karim, saleId: free.id, refundId: null, expires: back.expires });
  assert.ok(back.expires >= addDays(d(3), 30));
  assert.deepEqual(rewardsOf(t.s(), karim, d(3)).map((r) => r.id), [rid], 'usable again');
  // again: nothing to give back
  const n = t.e.journal.length;
  await t.e.run(restoreReward, { id: rid }, t.asOwner());
  assert.equal(t.e.journal.length, n);
  // counted once in the figures: a restore, not a second reward unlocked
  const st = programStats(t.s(), { from: DAY, to: d(3) });
  assert.deepEqual([st.rewards.unlocked, st.rewards.restored], [1, 1]);
  // a ticket that took money goes through its refund instead
  const mixed = await t.pay(karim, [t.cut({ rewardId: rid }), { kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  await rejects(t.e.run(restoreReward, { id: rid }, t.asOwner()), 'reward_paid');
  await t.e.run(refund, { saleId: mixed.id, amount: 1500, method: 'card', reason: 'Erreur' }, t.asOwner());
  assert.equal(t.ev('loyalty.restored').length, 2);
  // once the day is closed, its Z counted the reward: no giving back
  const z = await club();
  const sam = await z.client('Sam', '06 22 22 22 22');
  const gift = await z.e.run(giftReward, { clientId: sam, reward: { kind: 'service', refs: [] } }, z.asOwner());
  const used = await z.pay(sam, [z.cut({ rewardId: gift.id })], { due: 0 });
  await z.e.run(closeDay, { early: true }, z.asOwner());
  await rejects(z.e.run(restoreReward, { id: gift.id }, z.asOwner()), 'day_closed');
  assert.equal(z.s().loyalty.rewards.get(gift.id).usedBy, used.id);
});

test('a ticket refunded in full frees the day: the right one rung after it earns its stamp, a stamp by hand too', async () => {
  const t = await club({ goal: 9 });
  const karim = await t.client('Karim', '06 11 11 11 11');
  const wrong = await t.pay(karim, [t.cut()], { due: 2500 });
  await t.e.run(refund, { saleId: wrong.id, amount: 2500, method: 'card', reason: 'Erreur de prestation' }, t.asOwner());
  assert.equal(cardOf(t.s(), karim, DAY).units, 0);
  const right = await t.pay(karim, [{ kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  assert.deepEqual(t.s().sales.get(right.id).loyalty, { units: 1 });
  assert.equal(cardOf(t.s(), karim, DAY).units, 1);
  // the same for a stamp by hand at the till
  const sam = await t.client('Sam', '06 22 22 22 22');
  const oops = await t.pay(sam, [t.cut()], { due: 2500 });
  await t.e.run(refund, { saleId: oops.id, amount: 2500, method: 'card', reason: 'Erreur de client' }, t.asOwner());
  await t.e.run(adjustLoyalty, { clientId: sam, units: 1, reason: 'Passage sans ticket' }, t.asStaff('Ali'));
  assert.equal(cardOf(t.s(), sam, DAY).units, 1);
});

test('the till: the cashier’s cap is on what is charged, a reward on a line it cannot pay is refused', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  const rid = rewardsOf(t.s(), karim, d(2))[0].id;
  t.go(d(3));
  const ali = t.asStaff('Ali');
  // 25 € cut offered + 30 € charged: 10 % of what is charged is 3 €, not 10 % of 55 €
  const lines = [t.cut({ rewardId: rid }), { kind: 'service', ref: t.ids.beard }];
  await rejects(t.pay(karim, lines, { as: ali, due: 2600, discount: { amount: 400, reason: 'Geste commercial' } }), 'discount');
  const ok = await t.pay(karim, lines, { as: ali, due: 2700, discount: { amount: 300, reason: 'Geste commercial' } });
  assert.equal(ok.totals.revenue, 2700);
  // a fee, a gift card or a carnet sold: no reward on them, and the cashier is told
  const gift = await t.e.run(giftReward, { clientId: karim, reward: { kind: 'amount', amount: 500 } }, t.asOwner());
  const e = await rejects(t.pay(karim, [{ kind: 'fee', name: 'Frais', unit: 1000, rewardId: gift.id }], { due: 1000 }), 'reward_line');
  assert.equal(e.message, 'Une récompense s’applique à une prestation ou un produit.');
  await rejects(t.pay(karim, [{ kind: 'pack', ref: t.ids.pack, rewardId: gift.id }], { due: 8000 }), 'reward_line');
  assert.equal(t.s().loyalty.rewards.get(gift.id).usedBy, null);
  // a service the salon no longer has: the refusal says so
  const gone = await t.e.run(giftReward, { clientId: karim, reward: { kind: 'service', refs: ['sv_gone'] } }, t.asOwner());
  const e2 = await rejects(t.pay(karim, [t.cut({ rewardId: gone.id })], { due: 2500 }), 'reward_line');
  assert.equal(e2.message, 'Elle s’applique à une prestation qui n’est plus à la carte : offre-en une autre au client.');
});

test('opting out holds everywhere: a merge keeps it, a referral is refused, a referrer who left earns nothing; a merge completes the cards', async () => {
  const t = await club({ goal: 9, referral: { enabled: true } });
  // A opted out with 4 stamps, B has 6: merged, the person stays out
  const a = await t.client('Karim', '06 11 11 11 11');
  const b = await t.client('Karim', '06 44 44 44 44');
  await t.e.run(adjustLoyalty, { clientId: a, units: 4, reason: 'Ancienne carte' }, t.asOwner());
  await t.e.run(adjustLoyalty, { clientId: b, units: 6, reason: 'Ancienne carte' }, t.asOwner());
  await t.e.run(setLoyaltyOff, { clientId: a, off: true }, t.asOwner());
  await t.e.run(mergeClients, { from: a, into: b }, t.asOwner());
  assert.equal(t.s().clients.get(b).loyaltyOff, true);
  assert.equal(cardOf(t.s(), b, DAY).off, true);
  t.go(d(1));
  await t.pay(b, [t.cut()], { due: 2500 });
  assert.equal(cardOf(t.s(), b, d(1)).units, 10, 'nothing earned');
  // both taking part: the full card is a reward at the merge, not at the next visit
  const c = await t.client('Lou', '06 55 55 55 55');
  const e = await t.client('Lou', '06 66 66 66 66');
  await t.e.run(adjustLoyalty, { clientId: c, units: 4, reason: 'Ancienne carte' }, t.asOwner());
  await t.e.run(adjustLoyalty, { clientId: e, units: 6, reason: 'Ancienne carte' }, t.asOwner());
  await t.e.run(mergeClients, { from: c, into: e }, t.asOwner());
  const card = cardOf(t.s(), e, d(1));
  assert.deepEqual([card.units, card.rewards.length, card.off], [1, 1, false]);

  // referral: an opted-out referee or referrer is refused
  const sam = await t.client('Sam', '06 77 77 77 77');
  await t.pay(sam, [t.cut()], { due: 2500 });
  const till = (refereeId, referrerId) => t.e.run(claimReferral, { refereeId, referrerId, via: 'till' }, t.asOwner());
  const newOff = await t.client('Nouveau', '06 90 00 00 01');
  await t.e.run(setLoyaltyOff, { clientId: newOff, off: true }, t.asOwner());
  assert.equal((await till(newOff, sam)).why, 'off');
  assert.equal((await till(await t.client('Autre', '06 90 00 00 02'), b)).why, 'off');
  // the referrer opts out after the claim: the referee keeps his welcome, the referrer gets nothing
  const nael = await t.client('Naël', '06 90 00 00 03');
  assert.equal((await till(nael, sam)).ok, true);
  await t.e.run(setLoyaltyOff, { clientId: sam, off: true }, t.asOwner());
  t.go(d(2));
  await t.pay(nael, [t.cut()], { due: 2500 });
  assert.equal(t.ev('loyalty.rewarded').filter((x) => x.data.source === 'referrer').length, 0);
  assert.equal(rewardsOf(t.s(), nael, d(2)).length, 1);
});

test('referral: the yearly quota counts the rewarded and the recent claims, not junk bookings for good; a referral lost after use says so', async () => {
  // DAY + 60 is in 2027: a calendar year of its own
  const t = await club({ goal: 9, referral: { enabled: true, perYear: 2 } });
  const karim = await t.client('Karim', '06 12 34 99 78');
  t.go(d(60));
  await t.pay(karim, [t.cut()], { due: 2500 });
  const till = async (phone) => t.e.run(claimReferral, { refereeId: await t.client('Filleul', phone), referrerId: karim, via: 'till' }, t.asOwner());
  assert.equal((await till('06 90 00 01 01')).ok, true);
  assert.equal((await till('06 90 00 01 02')).ok, true);
  assert.equal((await till('06 90 00 01 03')).why, 'limit');
  // 61 days on, neither came: the year is open again
  t.go(d(60 + 61));
  assert.equal((await till('06 90 00 01 04')).ok, true);

  // the referee's first ticket half refunded (its stamp taken back), the referrer uses his reward, then the rest is
  // refunded: no stamp left to take back, the feed still says the referral was lost
  const nael = [...t.s().loyalty.referrals.values()].find((x) => x.day === d(121)).refereeId;
  const first = await t.pay(nael, [t.cut()], { due: 2500 });
  await t.e.run(refund, { saleId: first.id, amount: 2000, method: 'card', reason: 'Geste' }, t.asOwner());
  const kRw = rewardsOf(t.s(), karim, d(121)).find((x) => x.source === 'referrer');
  t.go(d(122));
  await t.pay(karim, [t.cut({ rewardId: kRw.id })], { due: 2000 });
  await t.e.run(refund, { saleId: first.id, amount: 500, method: 'card', reason: 'Annulé' }, t.asOwner());
  const kept = t.ev('loyalty.reversed').at(-1);
  assert.deepEqual([kept.data.units, kept.data.referral], [0, 'kept']);
  const f = t.s().feed.filter((x) => x.type === 'loyalty.reversed').at(-1);
  assert.equal(loyaltyExtension.item({ s: t.s(), caps: t.asOwner().caps }, f).title, 'Parrainage remboursé après usage · Karim');
  assert.ok(!cardOf(t.s(), nael, d(122)).last.some((x) => x.units === 0 && x.what === 'Remboursement du ticket'), 'no empty line on the card');
  // the referee's next ticket: the referrer's reward was used, it is not given twice
  t.go(d(123));
  await t.pay(nael, [t.cut()], { due: 2500 });
  assert.equal(t.ev('loyalty.rewarded').filter((x) => x.data.source === 'referrer').length, 1);
});

test('the client’s own data: his card, its movements and rewards, the reasons typed by hand', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  await t.fill(karim);
  await t.e.run(adjustLoyalty, { clientId: karim, units: 1, reason: 'Venu sans ticket' }, t.asOwner());
  const x = loyaltyExport(t.s(), karim, d(2));
  assert.deepEqual([x.participe, x.tampons, x.objectif, x.parraine, x.filleuls], [true, 1, 3, false, 0]);
  assert.equal(x.historique.length, 5);
  assert.deepEqual(x.recompenses.map((r) => [r.origine, r.etat]), [['carte complète', 'à utiliser']]);
  assert.deepEqual(x.ajustements, [{ jour: d(2), tampons: 1, raison: 'Venu sans ticket' }]);
});

// the store as it is kept on disk (re-read by a new instance) as well as in memory
const STORES = { memory: () => [memoryStore(), null], file: () => { const p = join(mkdtempSync(join(tmpdir(), 'lx-fid-')), 'j.jsonl'); return [fileStore(p), () => fileStore(p)]; } };
for (const [kind, make] of Object.entries(STORES)) for (const side of ['referee', 'referrer']) {
  test('erasing the ' + side + ' (' + kind + ' store): the link leaves memory and the store on both sides, the referrer’s count stays', async () => {
    const [store, reopen] = make();
    const t = await club({ goal: 9, referral: { enabled: true } }, store);
    const karim = await t.client('Karim', '06 12 34 99 78');
    await t.pay(karim, [t.cut()], { due: 2500 });
    const nael = await t.client('Naël', '06 55 55 55 55');
    await t.e.run(claimReferral, { refereeId: nael, referrerId: karim, via: 'till' }, t.asOwner());
    t.go(d(1));
    await t.pay(nael, [t.cut()], { due: 2500 });
    const ids = t.e.journal.filter((x) => x.type === 'loyalty.referred' || (x.type === 'loyalty.rewarded' && x.data.source === 'referrer')).map((x) => x.id);
    assert.equal(ids.length, 2);
    assert.ok(t.e.journal.filter((x) => ids.includes(x.id)).every((x) => x.pii), 'both carry the link as pii');
    assert.equal(referralOf(t.s(), karim).count, 1);

    const gone = side === 'referee' ? nael : karim;
    const res = await t.e.run(eraseClient, { id: gone, cancelUpcoming: true }, t.asOwner());
    assert.equal(res.erased, true);
    const erased = t.ev('client.erased').at(-1);
    assert.deepEqual([...erased.data.drop].sort(), t.e.journal.filter((x) => ids.includes(x.id)).map((x) => x.data.id).sort());
    // memory: no link left, on either side
    const L = t.s().loyalty;
    if (side === 'referee') {
      assert.equal(L.referrals.size, 0);
      assert.equal(referralOf(t.s(), karim).count, 1, 'the referrer keeps his count, not whom');
      // his welcome reward can never be used now: voided, out of what the salon owes
      assert.equal(rewardsOf(t.s(), nael, d(1)).length, 0);
      assert.ok([...L.rewards.values()].filter((r) => r.clientId === nael).every((r) => r.voided && r.voided.why === 'erased'));
      for (const r of L.rewards.values()) { assert.equal(r.for, ''); assert.equal(r.peer, null); }
    } else {
      assert.equal([...L.referrals.values()][0].by, null);
      assert.equal(cardOf(t.s(), nael, d(1)).referredBy, null);
      for (const r of L.rewards.values()) assert.equal(r.peer, null);
    }
    // the store: no personal data left on the referral's events, the chain still verifies
    const { events } = await (reopen ? reopen() : t.store).read(0);
    assert.equal(events.filter((x) => ids.includes(x.id)).length, 2);
    for (const x of events.filter((x) => ids.includes(x.id))) assert.equal(x.pii, undefined, x.type + ' keeps pii');
    for (const x of t.e.journal.filter((x) => ids.includes(x.id))) assert.equal(x.pii, undefined);
    assert.equal(t.e.verify().ok, true);
  });
}

test('the launch: half a card from the last 12 months (visits that earned not counted twice, the card never completed by it), once, programme on', async () => {
  const t = await club({ goal: 9, enabled: false });
  const karim = await t.client('Karim', '06 11 11 11 11');
  const sam = await t.client('Sam', '06 22 22 22 22');
  const lou = await t.client('Lou', '06 33 33 33 33');
  // 7 visits of Karim in the last 12 months, one more before; 2 of Sam
  t.go(d(0));
  await t.pay(karim, [t.cut()], { due: 2500 });
  for (let i = 1; i <= 7; i++) { t.go(d(400 + i * 14)); await t.pay(karim, [t.cut()], { due: 2500 }); }
  await t.pay(sam, [t.cut()], { due: 2500 });
  t.go(d(400 + 8 * 14 + 1));
  await t.pay(sam, [t.cut()], { due: 2500 });
  await t.pay(sam, [{ kind: 'service', ref: t.ids.barbe }], { due: 1500 });
  // a ticket refunded in full was no visit
  const wrong = await t.pay(lou, [t.cut()], { due: 2500 });
  await t.e.run(refund, { saleId: wrong.id, amount: 2500, method: 'card', reason: 'Erreur de client' }, t.asOwner());
  await rejects(t.e.run(launchLoyalty, {}, t.asStaff('Ali')), 'forbidden');
  await rejects(t.e.run(launchLoyalty, {}, t.asOwner()), 'off');
  await t.e.run(updateSettings, { loyalty: { enabled: true } }, t.asOwner());
  // switched on before the launch, Sam already has 7 stamps by hand: his head start stops at 8/9, never a card by itself
  await t.e.run(adjustLoyalty, { clientId: sam, units: 7, reason: 'Ancienne carte' }, t.asOwner());
  const res = await t.e.run(launchLoyalty, { headStart: 'half' }, t.asOwner());
  assert.deepEqual([res.clients, res.stamps, res.headStart], [2, 5, 'half']);
  const start = t.ev('loyalty.earned').filter((x) => x.data.reason === 'start');
  assert.deepEqual(start.map((x) => [x.data.clientId, x.data.units]).sort(), [[karim, 4], [sam, 1]].sort());
  assert.equal(t.ev('loyalty.launched')[0].data.headStart, 'half');
  await rejects(t.e.run(launchLoyalty, {}, t.asOwner()), 'launched');
  const today = d(400 + 8 * 14 + 1);
  assert.equal(cardOf(t.s(), sam, today).units, 8);
  assert.equal(cardOf(t.s(), lou, today).units, 0);
  assert.equal(cardOf(t.s(), karim, today).units, 4);
  assert.equal(cardOf(t.s(), karim, today).last[0].what, 'Reprise de la carte au lancement');
});

test('the old site’s cards: imported once per file, by the system only, full cards become rewards', async () => {
  const t = await club({ goal: 9 });
  const karim = await t.client('Karim', '06 11 11 11 11');
  const sam = await t.client('Sam', '06 22 22 22 22');
  const sys = { actor: { t: 'system', id: 'import' }, caps: new Set() };
  await rejects(t.e.run(importLoyalty, { rows: [{ clientId: karim, units: 3 }] }, t.asOwner()), 'forbidden');
  const a = await t.e.run(importLoyalty, { rows: [{ clientId: karim, units: 3 }, { clientId: sam, units: 20 }, { clientId: 'cl_nobody', units: 2 }] }, sys);
  assert.deepEqual(a, { imported: 2, skipped: 1, rewards: 2 });
  const b = await t.e.run(importLoyalty, { rows: [{ clientId: karim, units: 3 }] }, sys);
  assert.deepEqual(b, { imported: 0, skipped: 1, rewards: 0 });
  assert.equal(cardOf(t.s(), karim, DAY).units, 3);
  assert.equal(cardOf(t.s(), sam, DAY).units, 2);
  assert.equal(cardOf(t.s(), sam, DAY).rewards.length, 2);
});

test('the receipt text says where the card stands; the figures and what is owed add up', async () => {
  const t = await club();
  const karim = await t.client('Karim', '06 11 11 11 11');
  const meta = { receiptLink: () => 'https://salon.test/recu/x' };
  const first = await t.pay(karim, [t.cut()], { due: 2500 });
  const m1 = await t.e.run(sendReceipt, { saleId: first.id }, { ...t.asOwner(), meta });
  assert.match(t.s().messages.get(m1.id).body, /: https:\/\/salon\.test\/recu\/x Carte 1\/3\.$/);
  t.go(d(1)); await t.pay(karim, [t.cut()], { due: 2500 });
  t.go(d(2));
  const third = await t.pay(karim, [t.cut()], { due: 2500 });
  const m3 = await t.e.run(sendReceipt, { saleId: third.id }, { ...t.asOwner(), meta });
  assert.match(t.s().messages.get(m3.id).body, /Ta prochaine coupe est offerte !$/);
  const anon = await t.pay(undefined, [t.cut()], { due: 2500 });
  const m4 = await t.e.run(sendReceipt, { saleId: anon.id, phone: '+33677777777' }, { ...t.asOwner(), meta });
  assert.match(t.s().messages.get(m4.id).body, /recu\/x$/);

  const owed = liability(t.s(), d(2));
  assert.deepEqual([owed.available, owed.value], [1, rewardWorthOfAll(t)]);
  t.go(d(3));
  const rid = rewardsOf(t.s(), karim, d(3))[0].id;
  await t.pay(karim, [t.cut({ rewardId: rid })], { due: 0 });
  const st = programStats(t.s(), { from: DAY, to: d(3) });
  assert.deepEqual(st.stamps, { given: 3, visit: 3, start: 0, import: 0, adjust: 0, takenBack: 0 });
  assert.deepEqual([st.rewards.unlocked, st.rewards.used], [1, 1]);
  assert.deepEqual(st.value, { retail: 2500, cost: 2500 });
  assert.deepEqual(st.bySource.card, { unlocked: 1, used: 1, value: 2500 });
  assert.equal(st.byCashier[0].name, 'Patron');
});
/** every active non-carnet service of the fixture up to 25 €, averaged: what an open reward is worth today */
function rewardWorthOfAll(t) {
  const list = [...t.s().services.values()].filter((x) => x.active && !x.pack);
  return Math.round(list.reduce((a, x) => a + Math.min(2500, x.price), 0) / list.length);
}

test('the demo: cards and rewards from its history, the routes for each role, the referrer’s link, the simulator', async () => {
  const clock = { now: at('2026-10-27', 15, 10) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = rt.engine.state;
  const today = '2026-10-27';
  assert.equal(cfgOf(s).enabled, true);
  assert.ok(s.loyalty.launched);
  const rewards = [...s.loyalty.rewards.values()];
  assert.ok(rewards.some((r) => r.usedBy), 'the demo redeems rewards');
  assert.ok(rewards.some((r) => !r.usedBy && r.expires >= today), 'and has some waiting');
  assert.equal(s.loyalty.referrals.size, 6);
  assert.ok(rewards.some((r) => r.source === 'referrer'));
  // the till's arithmetic held for every demo ticket a reward was used on
  for (const r of rewards.filter((x) => x.usedBy)) {
    const sale = s.sales.get(r.usedBy);
    const line = sale.lines.find((l) => l.reward && l.reward.id === r.id);
    assert.equal(line.reward.amount, r.amount);
  }
  const sim = simulate(s, {}, { from: addDays(today, -364), to: today });
  assert.ok(sim.rewards > 0, JSON.stringify(sim));
  assert.ok(sim.share > 0 && sim.share < 0.2, JSON.stringify(sim));

  const o = browser(rt);
  assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  // a seeded regular: the card with its history
  const regular = [...s.clients.values()].find((c) => !c.erased && cardOf(s, c.id, today).units > 2);
  const card = await o.get('/api/v1/loyalty/client/' + regular.id);
  assert.equal(card.status, 200, card.text);
  assert.ok(card.json.units > 2);
  assert.equal(card.json.goal, 9);
  assert.ok(card.json.last.length > 1);
  assert.ok(card.json.last.some((x) => x.what === 'Visite'));
  assert.deepEqual(Object.keys(card.json.referral), ['by', 'count']);
  // the client card in every list: the stamps, and « récompense » while one waits
  const waiting = rewards.find((r) => !r.usedBy && !r.voided && r.expires >= today);
  const cc = clientCard(s, s.clients.get(waiting.clientId), new Set(), null, clock.now);
  assert.ok(cc.badges.includes('récompense'));
  assert.ok(cc.loyalty.rewards >= 1);
  // the simulator and the figures: the owner's
  const sm = await o.get('/api/v1/loyalty/simulate?goal=9&kind=service&cap=2500');
  assert.equal(sm.status, 200, sm.text);
  assert.ok(sm.json.rewards > 0);
  assert.equal((await o.get('/api/v1/loyalty/simulate?goal=1')).status, 400);
  const stats = await o.get('/api/v1/loyalty/stats?from=2026-08-01&to=2026-10-27');
  assert.equal(stats.status, 200, stats.text);
  assert.ok(stats.json.rewards.used > 0);
  assert.ok(stats.json.liability.available > 0);
  assert.equal((await o.post('/api/v1/loyalty/launch', {})).status, 409);

  // a barber: the card yes, a stamp a day, not the figures nor the gifts
  const tab = browser(rt);
  assert.equal((await tab.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  await tab.post('/api/auth/device', { name: 'Tablette' });
  await tab.post('/api/auth/logout');
  const team = (await tab.get('/api/auth/state')).json.team;
  assert.equal((await tab.post('/api/auth/pin', { staffId: team.find((x) => x.name === 'JKut').id, pin: DEMO.pins.JKut })).status, 200);
  assert.equal((await tab.get('/api/v1/loyalty/client/' + regular.id)).status, 200);
  assert.equal((await tab.get('/api/v1/loyalty/stats')).status, 403);
  assert.equal((await tab.get('/api/v1/loyalty/simulate')).status, 403);
  assert.equal((await tab.post('/api/v1/loyalty/gift', { clientId: regular.id, reward: { kind: 'amount', amount: 500 } })).status, 403);
  // PAY-02: a cut the membership pays earns nothing, and takes no reward
  const S1 = rt.engine.state;
  let member = null, covered = null;
  for (const m of S1.members.values()) {
    const sv = [...S1.services.values()].find((x) => x.active && !x.pack && cover(S1, m, x.id, { day: today }).ok);
    if (sv) { member = m; covered = sv; break; }
  }
  assert.ok(member, 'a demo member with a cut covered today');
  const mcid = rootOf(S1, member.cid);
  const g = await o.post('/api/v1/loyalty/gift', { clientId: mcid, reward: { kind: 'service', refs: [] } });
  assert.equal(g.status, 200, g.text);
  const line = { kind: 'service', ref: covered.id, staffId: [...S1.staff.values()].find((x) => x.chair).id, memberId: member.id };
  const refused = await o.post('/api/v1/sales', { clientId: mcid, lines: [{ ...line, rewardId: g.json.id }], payments: [{ method: 'card', amount: 0 }] });
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.json.error.code, 'reward_cover');
  const paid = await o.post('/api/v1/sales', { clientId: mcid, lines: [line], payments: [{ method: 'card', amount: 0 }] });
  assert.equal(paid.status, 200, paid.text);
  assert.equal(rt.engine.state.sales.get(paid.json.id).loyalty, undefined, 'the membership is already the loyal price');
  // the client's own export carries his card
  const ex = await o.get('/api/v1/clients/' + regular.id + '/export');
  assert.equal(ex.status, 200);
  assert.ok(JSON.parse(ex.text).fidelite.historique.length > 1);

  const quiet = [...s.clients.values()].find((c) => !c.erased && !c.loyaltyOff && ![...s.sales.values()].some((x) => x.day === today && x.clientId === c.id));
  const adj = await tab.post('/api/v1/loyalty/adjust', { clientId: quiet.id, units: 1, reason: 'Tampon oublié' });
  assert.equal(adj.status, 200, adj.text);
  assert.equal((await tab.post('/api/v1/loyalty/adjust', { clientId: quiet.id, units: 1, reason: 'Tampon oublié' })).status, 409);

  // the referrer's link on the site: his first name and the offer, then a booking through it records the referral
  const referrer = s.clients.get(regular.id);
  const site = browser(rt);
  const token = tokenOf(rt, referrer.id);
  const p = await site.get('/api/public/parrain/' + encodeURIComponent(token));
  assert.equal(p.status, 200, p.text);
  assert.deepEqual({ ...p.json, offer: sp(p.json.offer), give: sp(p.json.give), line: sp(p.json.line) }, { first: referrer.first, offer: '5 € offerts sur ta première visite', give: '5 €', line: referrer.first + ' t’offre 5 € sur ta première visite' });
  assert.equal((await site.get('/api/public/parrain/' + referrer.id + '.forged')).status, 404);
  const svc = [...s.services.values()].find((x) => x.active && x.online !== false && !x.pack && x.price < 4000);
  const av = (await site.get('/api/public/availability?services=' + svc.id + '&days=7')).json;
  const day = av.days.find((x) => x.slots.length && x.day > today);
  const b = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: day.slots[0].s, day: day.day, start: day.slots[0].m, first: 'Parrainé', phone: '0611002299', parrain: token });
  assert.equal(b.status, 201, b.text);
  assert.deepEqual(b.json.referral, { ok: true, why: null }, 'the site can say the offer is applied');
  // the state as it is now (a request may have rebuilt it from the store)
  const S = rt.engine.state;
  const ref = [...S.loyalty.referrals.values()].find((x) => x.via === 'link');
  assert.ok(ref, 'recorded by the system');
  assert.equal(rootOf(S, ref.by), referrer.id);
  // a forged token never blocks a booking
  const day2 = av.days.find((x) => x.slots.length > 1 && x.day > today && x.day !== day.day) || day;
  const b2 = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: day2.slots[1].s, day: day2.day, start: day2.slots[1].m, first: 'Autre', phone: '0611002298', parrain: 'cl_x.forged' });
  assert.equal(b2.status, 201, b2.text);
  assert.deepEqual(b2.json.referral, { ok: false, why: 'link' });
  assert.equal((await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: day2.slots[0].s, day: day2.day, start: day2.slots[0].m, first: 'Sans', phone: '0611002297' })).json.referral, undefined);
  assert.equal([...rt.engine.state.loyalty.referrals.values()].filter((x) => x.via === 'link').length, 1);
});

/** the token of the link a referrer hands out, as /moi will show it (FID-03) */
function tokenOf(rt, cid) { return /** @type {string} */ (new URL(refLink({ rt, origin: 'https://salon.test' }, cid)).searchParams.get('parrain')); }
