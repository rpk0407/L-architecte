// The monthly membership engine (PAY-02): plans checked, a checkout recorded with its client file, each paid month a
// numbered ticket at the plan's VAT, the member's cuts at 0 € inside a paid period (quota, fair use, grace after a failed
// payment), cancellation and withdrawal with their acknowledgements, merged and erased files, and the demo's billing.
// On a runtime with an injected clock (createRuntime, memory store): a production salon, or a demo one for the billing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { createEngine } from '../../server/core/engine.js';
import { capsOf } from '../../server/domain/permissions.js';
import { instantOf, addDays, localParts } from '../../shared/dates.js';
import { initialize } from '../../server/commands/setup.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { addClient, mergeClients, eraseClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { checkout, closeDay, refund as refundSale } from '../../server/commands/sales.js';
import { tick } from '../../server/commands/system.js';
import { startMembership, memberPaid, memberFailed, memberSync, requestCancel, withdrawMember, endMember } from '../../server/commands/memberships.js';
import { statusIn, cover, cutValue, label, mrr, withdrawRefund, memberOf, periodIn, addMonths } from '../../server/domain/membership.js';
import { memberCards, clientCard } from '../../server/http/views.js';
import { ticketNo } from '../../server/domain/cash.js';
import { rejects } from '../helpers.js';
import { membershipsExtension } from '../../server/projections/memberships.js';
import membershipSection from '../../server/settings/membership.js';

const DAY = '2026-11-03'; // a Tuesday
const at = (day, h = 10, m = 0) => instantOf(day, h * 60 + m);
const SYS = { actor: { t: 'system', id: 'memberships' }, caps: new Set(), meta: { siteUrl: 'https://salon.test/' } };
const STRIPE = { actor: { t: 'provider', id: 'stripe' }, caps: new Set(), meta: { siteUrl: 'https://salon.test/' } };
/** a client, as AC-01's runAs vouches for his file (meta.me.cid); null: no session */
const CLIENT = (cid) => ({ actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { siteUrl: 'https://salon.test/', ...(cid ? { me: { cid } } : {}) } });

async function club({ mode = 'production', day = DAY } = {}) {
  const clock = { now: at(day) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store: memoryStore() });
  const e = rt.engine;
  const init = await e.run(initialize, { mode, owner: { name: 'Patron', email: 'patron@test.fr' } }, { actor: { t: 'system', id: 'setup' }, caps: new Set() });
  const as = (id) => { const st = e.state.staff.get(id); return { actor: { t: 'staff', id }, staff: st, caps: capsOf(st, e.state.settings), meta: { siteUrl: 'https://salon.test/' } }; };
  const owner = () => as(init.ownerId);
  const ali = (await e.run(addStaff, { name: 'Ali', role: 'barber', schedule: { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] } }, owner())).id;
  const svc = async (x) => (await e.run(addService, x, owner())).id;
  const ids = {
    ali, cut: await svc({ name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }),
    contour: await svc({ name: 'Coupe + contour', category: 'Coupes', price: 2500, dur: 30 }),
    beard: await svc({ name: 'Coupe + taille', category: 'Coupes', price: 3000, dur: 30 })
  };
  await e.run(updateSettings, { membership: { enabled: true, plans: [
    { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [ids.cut] },
    { id: 'illimite', name: 'Illimité', price: 4900, cuts: 0, serviceIds: [ids.cut, ids.contour] }
  ] } }, owner());
  let n = 0;
  /** a checkout made by the provider, then its first invoice paid: the period runs a month from today */
  const join = async (planId, phone, first = 'Karim', o = {}) => {
    n++;
    const day = o.day || localParts(clock.now).day;
    const m = await e.run(startMembership, { planId, first, phone, provider: o.provider || 'stripe', providerRef: 'cs_' + n, channel: 'online', ...(o.email ? { email: o.email } : {}), ...(o.demoFail ? { demoFail: true } : {}) }, SYS);
    const paid = await e.run(memberPaid, { ref: 'cs_' + n, invoice: 'in_' + n + '_0', amount: o.amount || e.state.settings.membership.plans.find((p) => p.id === planId).price, periodStart: day, periodEnd: addMonths(day, 1), chargeRef: 'ch_' + n + '_0', customer: 'cus_' + n, subscription: 'sub_' + n, card: 'Visa •• 4242' }, STRIPE);
    return { ...m, ...paid };
  };
  /** one cut rung up at the till for this member's client */
  const cut = (memberId, serviceId = ids.cut, ctx = owner(), more = {}) => {
    const m = e.state.members.get(memberId);
    return e.run(checkout, { clientId: m.cid, lines: [{ kind: 'service', ref: serviceId, staffId: ids.ali, memberId, ...more }], payments: [{ method: 'card', amount: 0 }] }, ctx);
  };
  const go = (day, h = 10) => { clock.now = at(day, h); };
  return { rt, e, clock, go, ids, owner, ali: () => as(ali), join, cut, s: () => e.state };
}
const msgs = (s, template, cid) => [...s.messages.values()].filter((m) => m.template === template && (!cid || m.cid === cid));

test('plans are checked: 0 to 8 cuts, at least one service, four plans at most, one id each', async () => {
  const t = await club();
  const plan = (x) => ({ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [t.ids.cut], ...x });
  await rejects(t.e.run(updateSettings, { membership: { plans: [plan({ cuts: 9 })] } }, t.owner()), 'invalid');
  await rejects(t.e.run(updateSettings, { membership: { plans: [plan({ serviceIds: [] })] } }, t.owner()), 'invalid');
  await rejects(t.e.run(updateSettings, { membership: { plans: ['a', 'b', 'c', 'd', 'e'].map((k) => plan({ id: 'plan-' + k })) } }, t.owner()), 'invalid');
  await rejects(t.e.run(updateSettings, { membership: { plans: [plan({}), plan({ name: 'Autre' })] } }, t.owner()), 'invalid');
  // a barber never writes them
  await rejects(t.e.run(updateSettings, { membership: { enabled: false } }, t.ali()), 'forbidden');
  const p = t.s().settings.membership.plans.find((x) => x.id === 'illimite');
  assert.deepEqual([p.cuts, p.minDays, p.online, p.active], [0, 7, true, true], 'illimité: a week between two covered cuts by default');
  // Mise en route › Nouveautés: on here; off in production until the CGV are read
  assert.deepEqual(membershipSection.golive.state(t.s()), { on: true, blocker: '' });
  await t.e.run(updateSettings, { membership: { enabled: false } }, t.owner());
  assert.deepEqual(membershipSection.golive.state(t.s()), { on: false, blocker: 'En attente de la relecture des CGV' });
  await rejects(t.e.run(startMembership, { planId: 'essentiel', first: 'Karim', phone: '0611223344', provider: 'stripe', providerRef: 'cs_off', channel: 'online' }, SYS), 'off');
});

test('a checkout, then its first invoice: the file found or created by number, one ticket at 20 %, never twice, after the Z on tomorrow’s till', async () => {
  const t = await club();
  const known = (await t.e.run(addClient, { first: 'Yanis', phone: '06 12 34 56 78' }, t.owner())).id;
  // a new number: the file is created with the member, so every member event names it
  const a = await t.e.run(startMembership, { planId: 'essentiel', first: 'karim', phone: '06 11 22 33 44', email: 'karim@exemple.fr', provider: 'stripe', providerRef: 'cs_a', channel: 'online' }, SYS);
  assert.ok(a.clientCreated);
  const file = t.s().clients.get(a.cid);
  assert.deepEqual([file.first, file.phone, file.source], ['Karim', '+33611223344', 'site']);
  const created = t.e.journal.find((x) => x.type === 'member.created' && x.data.id === a.id);
  assert.deepEqual([created.data.cid, created.data.clientId, created.data.price, created.data.cuts, created.data.vat], [a.cid, a.cid, 3400, 2, 2000]);
  assert.ok(!JSON.stringify(created.data).includes('Karim') && !JSON.stringify(created.data).includes('+33611'), 'the person is in pii only');
  assert.equal(statusIn(t.s(), t.s().members.get(a.id), DAY), 'pending');
  // the same checkout again: the first answer, nothing written
  const v = t.s().version;
  assert.equal((await t.e.run(startMembership, { planId: 'essentiel', first: 'Karim', phone: '0611223344', provider: 'stripe', providerRef: 'cs_a', channel: 'online' }, SYS)).already, true);
  assert.equal(t.s().version, v);
  // nobody but the provider or the scheduler records it
  await rejects(t.e.run(startMembership, { planId: 'essentiel', first: 'X', phone: '0611223399', provider: 'stripe', providerRef: 'cs_x', channel: 'online' }, { actor: { t: 'client', id: 'web' }, caps: new Set() }), 'forbidden');

  const paid = await t.e.run(memberPaid, { ref: 'cs_a', invoice: 'in_a1', amount: 3400, periodStart: DAY, periodEnd: '2026-12-03', chargeRef: 'ch_a1', customer: 'cus_a', subscription: 'sub_a', card: 'Visa •• 4242' }, STRIPE);
  assert.equal(paid.first, true);
  const m = t.s().members.get(a.id);
  assert.equal(statusIn(t.s(), m, DAY), 'active');
  assert.equal(t.s().memberByRef.get('sub_a'), a.id, 'found again by its subscription');
  const sale = t.s().sales.get(paid.saleId);
  assert.match(ticketNo(sale.number), /^T\d{6}$/);
  assert.deepEqual(sale.lines.map((l) => [l.kind, l.ref, l.unit, l.vat, l.net, l.staffId, l.memberId]), [['membership', 'essentiel', 3400, 2000, 3400, null, a.id]]);
  assert.deepEqual(sale.lines[0].period, { start: DAY, end: '2026-12-03' });
  assert.deepEqual(sale.totals.vat, [{ rate: 2000, base: 2833, tax: 567 }], '34 € TTC: 28,33 € HT and 5,67 € of VAT');
  assert.deepEqual([sale.day, sale.clientId, sale.cashierId, !!sale.demo], [DAY, a.cid, null, false]);
  const py = t.s().payments.get(paid.paymentId);
  assert.deepEqual([py.kind, py.status, py.amount, py.usedBy, py.chargeRef], ['membership', 'paid', 3400, sale.id, 'ch_a1']);
  assert.deepEqual(sale.payments, [{ method: 'online', amount: 3400, paymentId: py.id }]);
  // the welcome, by text and by mail (the contract's acknowledgement)
  const welcome = msgs(t.s(), 'memberWelcome', a.cid);
  assert.deepEqual(welcome.map((x) => x.channel).sort(), ['email', 'sms']);
  assert.match(welcome.find((x) => x.channel === 'sms').body, /bienvenue Karim ! Abonnement Essentiel \(34 €\/mois\) actif/);
  assert.match(welcome.find((x) => x.channel === 'email').body, /2 coupes par mois[\s\S]*Prochain prélèvement : le 3 décembre[\s\S]*14 jours/);
  assert.deepEqual(m.acks.map((x) => [x.kind, x.msgIds.length]), [['welcome', 2]]);

  // the same invoice again (a webhook retried): the first answer, no second ticket
  const sales = t.s().sales.size;
  const again = await t.e.run(memberPaid, { id: a.id, invoice: 'in_a1', amount: 3400, periodStart: DAY, periodEnd: '2026-12-03', chargeRef: 'ch_a1' }, STRIPE);
  assert.deepEqual([again.already, again.saleId, t.s().sales.size], [true, sale.id, sales]);
  await rejects(t.e.run(memberPaid, { id: a.id, invoice: 'in_a1', amount: 3400, periodStart: DAY, periodEnd: '2026-12-03', chargeRef: 'ch_a1' }, t.owner()), 'forbidden');
  // what the provider refunds is required: never the invoice in its place
  await rejects(t.e.run(memberPaid, { id: a.id, invoice: 'in_a2', amount: 3400, periodStart: '2026-12-03', periodEnd: '2027-01-03' }, STRIPE), 'invalid');

  // a known number lands on its file; a second live membership on it is refused
  const b = await t.e.run(startMembership, { planId: 'illimite', first: 'Yanis', phone: '+33612345678', provider: 'stripe', providerRef: 'cs_b', channel: 'online' }, SYS);
  assert.deepEqual([b.cid, b.clientCreated], [known, false]);
  await rejects(t.e.run(startMembership, { planId: 'illimite', first: 'Karim', phone: '06 11 22 33 44', provider: 'stripe', providerRef: 'cs_c', channel: 'online' }, SYS), 'already');

  // paid after today's Z: the sealed day stays sealed, the ticket opens tomorrow's till
  await t.e.run(closeDay, { early: true }, t.owner());
  t.go(DAY, 21);
  const late = await t.e.run(memberPaid, { ref: 'cs_b', invoice: 'in_b1', amount: 4900, periodStart: DAY, periodEnd: '2026-12-03', chargeRef: 'ch_b1' }, STRIPE);
  assert.equal(late.day, '2026-11-04');
  assert.equal(t.s().sales.get(late.saleId).day, '2026-11-04');
});

test('Essentiel, two cuts a month: the third is refused, the owner may give it anyway, a barber may not', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  const first = await t.cut(k.id);
  const line = t.s().sales.get(first.id).lines[0];
  assert.deepEqual([line.unit, line.net, line.listPrice, line.credit, line.memberId, line.staffId], [0, 0, 2000, 1700, k.id, t.ids.ali], 'a member cut: 0 €, its price kept, its share of the month');
  assert.equal(line.name, 'Coupe classique · Abonnement · coupe 1/2 (03/11–02/12)', 'the billing month it counts in');
  assert.equal(cutValue(t.s().members.get(k.id)), 1700);
  t.go('2026-11-14');
  await t.cut(k.id);
  t.go('2026-11-20');
  const e = await rejects(t.cut(k.id), 'member_quota');
  assert.equal(e.message, 'Coupe déjà prise ce mois-ci (2/2).');
  await rejects(t.cut(k.id, t.ids.cut, t.ali(), { force: true }), 'forbidden');
  const forced = await t.cut(k.id, t.ids.cut, t.owner(), { force: true });
  assert.equal(t.s().sales.get(forced.id).lines[0].name, 'Coupe classique · Abonnement · coupe 3/2 (03/11–02/12) · hors forfait');
  const used = t.e.journal.filter((x) => x.type === 'member.used' && x.data.id === k.id);
  assert.deepEqual(used.map((x) => x.data.forced), [false, false, true]);
  assert.equal(used[2].data.saleId, forced.id);
  // a service the formule does not cover
  const x = await rejects(t.cut(k.id, t.ids.beard), 'member_service');
  assert.equal(x.message, 'L’abonnement ne couvre pas « Coupe + taille ».');
  // two covered cuts on one ticket count as two
  t.go('2026-12-04');
  await t.e.run(memberPaid, { id: k.id, invoice: 'in_x2', amount: 3400, periodStart: '2026-12-03', periodEnd: '2027-01-03', chargeRef: 'ch_x2' }, STRIPE);
  await rejects(t.e.run(checkout, { clientId: t.s().members.get(k.id).cid, lines: [1, 2, 3].map(() => ({ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: k.id })), payments: [{ method: 'card', amount: 0 }] }, t.owner()), 'member_quota');
  // another client's ticket never uses it
  const other = (await t.e.run(addClient, { first: 'Hugo', phone: '0699887766' }, t.owner())).id;
  await rejects(t.e.run(checkout, { clientId: other, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: k.id }], payments: [{ method: 'card', amount: 0 }] }, t.owner()), 'member_owner');
  // only the system rings a month up
  await rejects(t.e.run(checkout, { clientId: other, lines: [{ kind: 'membership', memberId: k.id, unit: 3400, period: { start: '2026-12-03', end: '2027-01-03' } }], payments: [{ method: 'card', amount: 3400 }] }, t.owner()), 'forbidden');
});

test('Illimité, a week between two cuts: day 0 yes, day 5 no, day 7 yes', async () => {
  const t = await club();
  const k = await t.join('illimite', '06 11 22 33 44');
  await t.cut(k.id, t.ids.contour);
  t.go(addDays(DAY, 5));
  const e = await rejects(t.cut(k.id), 'member_soon');
  assert.equal(e.message, 'Prochaine coupe incluse le 10/11.');
  t.go(addDays(DAY, 7));
  const ok = await t.cut(k.id);
  assert.equal(t.s().sales.get(ok.id).lines[0].name, 'Coupe classique · Abonnement illimité (03/11–02/12)');
  assert.equal(t.s().sales.get(ok.id).lines[0].credit, 1225, 'illimité: a quarter of the month');
  assert.equal(label(t.s().members.get(k.id), 1, { start: '2026-09-26', end: '2026-10-26' }), 'Abonnement illimité (26/09–25/10)', 'a cut of 1 October in a period from 26 September');
});

test('a refused renewal: cuts kept for the grace, refused after it, back once paid; one text per invoice', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  // the renewal day itself, before the provider's webhook: still covered
  t.go('2026-12-03', 9);
  assert.equal(cover(t.s(), t.s().members.get(k.id), t.ids.cut, { day: '2026-12-03' }).ok, true);
  const f = await t.e.run(memberFailed, { id: k.id, invoice: 'in_r2', attempt: 1, nextAt: at('2026-12-06'), url: 'https://invoice.stripe.com/i/abc' }, STRIPE);
  assert.ok(f.messageId);
  const m = () => t.s().members.get(k.id);
  assert.equal(statusIn(t.s(), m(), '2026-12-03'), 'grace');
  assert.match(t.s().messages.get(f.messageId).body, /paiement de l'abonnement \(34 €\) refusé\. Mets ta carte à jour : https:\/\/invoice\.stripe\.com\/i\/abc/);
  // the next attempt fails again: the next try moves, no second text
  await t.e.run(memberFailed, { id: k.id, invoice: 'in_r2', attempt: 2, nextAt: at('2026-12-08'), action: true }, STRIPE);
  assert.equal(msgs(t.s(), 'memberFailed').length + msgs(t.s(), 'memberAction').length, 1);
  assert.equal(m().pastDue.attempt, 2);
  assert.equal((await t.e.run(memberFailed, { id: k.id, invoice: 'in_r2', attempt: 2 }, STRIPE)).already, true);
  t.go('2026-12-09');
  await t.cut(k.id);
  t.go('2026-12-11');
  const e = await rejects(t.cut(k.id), 'member_unpaid');
  assert.equal(e.message, 'Paiement de l’abonnement en attente.');
  assert.equal(statusIn(t.s(), m(), '2026-12-11'), 'unpaid');
  await t.e.run(memberPaid, { id: k.id, invoice: 'in_r2', amount: 3400, periodStart: '2026-12-03', periodEnd: '2027-01-03', chargeRef: 'ch_r2' }, STRIPE);
  assert.equal(statusIn(t.s(), m(), '2026-12-11'), 'active');
  assert.equal(m().pastDue, null);
  const ok = await t.cut(k.id);
  assert.match(t.s().sales.get(ok.id).lines[0].name, /coupe 2\/2 \(03\/12–02\/01\)/, 'the cut taken in grace counts in that month');
  // a failure reported after the invoice was paid (webhooks out of order) changes nothing
  assert.equal((await t.e.run(memberFailed, { id: k.id, invoice: 'in_r2', attempt: 3 }, STRIPE)).paid, true);
  assert.equal(statusIn(t.s(), m(), '2026-12-11'), 'active');
});

test('cancelled on the 10th: cuts until the end of the paid month, then none; the acknowledgement by text and mail with both dates', async () => {
  const t = await club();
  const k = await t.join('illimite', '06 11 22 33 44', 'Karim', { email: 'karim@exemple.fr' });
  t.go('2026-11-10', 14);
  // a client only on his own file, as his session says it: a cid typed in the body counts for nothing
  await rejects(t.e.run(requestCancel, { id: k.id, by: 'client', channel: 'moi', cid: k.cid }, CLIENT('cl_other')), 'forbidden');
  await rejects(t.e.run(requestCancel, { id: k.id, by: 'client', channel: 'moi', cid: k.cid }, CLIENT(null)), 'forbidden');
  await rejects(t.e.run(requestCancel, { id: k.id, by: 'salon', channel: 'moi' }, CLIENT(k.cid)), 'forbidden');
  await rejects(t.e.run(requestCancel, { id: k.id, by: 'salon', channel: 'comptoir', now: true }, t.ali()), 'forbidden');
  const r = await t.e.run(requestCancel, { id: k.id, by: 'client', channel: 'moi', reason: 'Je déménage' }, CLIENT(k.cid));
  assert.deepEqual([r.effective, r.last, r.ended], ['2026-12-03', '2026-12-02', false]);
  const m = () => t.s().members.get(k.id);
  assert.equal(statusIn(t.s(), m(), '2026-11-10'), 'ending');
  const sms = msgs(t.s(), 'memberCancelled').find((x) => x.channel === 'sms');
  // no member page yet (PAY-03's memberLink): no link rather than a dead one
  assert.equal(sms.body.trim(), "L'Architecte : résiliation enregistrée le 10/11. Tes coupes restent incluses jusqu'au 02/12.");
  const mail = msgs(t.s(), 'memberCancelled').find((x) => x.channel === 'email');
  assert.match(mail.body, /résiliation le 10 novembre à 14\sh[\s\S]*prend fin le 2 décembre au soir[\s\S]*restent incluses/);
  assert.equal(mail.to, 'karim@exemple.fr');
  assert.deepEqual(m().acks.map((x) => x.kind), ['welcome', 'cancel']);
  assert.equal(m().cancel.reason, 'Je déménage');
  assert.ok(!JSON.stringify(t.e.journal.find((x) => x.type === 'member.cancelRequested').data).includes('déménage'), 'the reason is pii');
  assert.equal(msgs(t.s(), 'owner_member').length, 1, 'the owner hears of it');
  assert.equal((await t.e.run(requestCancel, { id: k.id, by: 'client', channel: 'moi', cid: k.cid }, SYS)).already, true);
  t.go('2026-12-02');
  await t.cut(k.id);
  t.go('2026-12-03');
  await rejects(t.cut(k.id), 'member_ended');
  assert.equal(statusIn(t.s(), m(), '2026-12-03'), 'ended');
  assert.equal(mrr(t.s(), '2026-11-20'), 0, 'a cancelled member renews nothing');
});

test('the provider’s view: a cancellation made in its portal gets the same acknowledgement; its end ends the member', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  t.go('2026-11-12');
  const r = await t.e.run(memberSync, { ref: 'sub_' + 1, snapshot: { status: 'active', cancelAt: at('2026-12-03', 10) } }, STRIPE);
  assert.deepEqual(r.changed, ['cancel']);
  const m = () => t.s().members.get(k.id);
  assert.deepEqual([m().cancel.by, m().cancel.channel, m().cancel.effective], ['provider', 'stripe', '2026-12-03']);
  assert.equal(msgs(t.s(), 'memberCancelled').length, 1);
  assert.deepEqual((await t.e.run(memberSync, { ref: 'sub_1', snapshot: { status: 'active', cancelAt: at('2026-12-03', 10) } }, STRIPE)).changed, [], 'only differences are written');
  t.go('2026-12-03');
  assert.deepEqual((await t.e.run(memberSync, { ref: 'sub_1', snapshot: { status: 'canceled' } }, STRIPE)).changed, ['ended']);
  assert.deepEqual(m().ended.reason, 'cancelled');
  // retries exhausted: the end for want of payment, told to the client and to the owner
  const u = await t.join('illimite', '06 99 88 77 66', 'Hugo');
  await t.e.run(endMember, { id: u.id, reason: 'unpaid' }, STRIPE);
  assert.equal(statusIn(t.s(), t.s().members.get(u.id), '2026-12-03'), 'ended');
  assert.match(msgs(t.s(), 'memberEnded')[0].body, /a pris fin faute de paiement/);
  // the provider's writes reach the Comptoir's feed, for who manages the memberships, never a barber
  const feed = t.s().feed.filter((x) => x.type.startsWith('member.'));
  assert.deepEqual([...new Set(feed.map((x) => x.type))].sort(), ['member.activated', 'member.cancelRequested', 'member.ended']);
  const line = (ctx, f) => membershipsExtension.item?.({ s: t.s(), caps: ctx.caps, me: ctx.staff }, f);
  const act = feed.find((x) => x.type === 'member.activated' && x.data.id === u.id);
  assert.deepEqual(line(t.owner(), act), { v: act.v, at: act.at, by: 'provider', kind: 'member', memberId: u.id, clientId: u.cid, staffId: null, title: 'Nouvel abonné · Hugo · Illimité', sub: '49\u00a0€/mois', money: true });
  assert.equal(line(t.ali(), act), null);
});

test('the 14-day withdrawal: the month less the cuts taken; not after 14 days', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  await t.cut(k.id);
  assert.equal(withdrawRefund(t.s().members.get(k.id), DAY), 1700, 'Essentiel, one cut taken: 17 € back');
  t.go('2026-11-08');
  const w = await t.e.run(withdrawMember, { id: k.id, by: 'salon' }, t.owner());
  assert.deepEqual([w.refund, w.used, !!w.saleId], [1700, 1, true]);
  const m = t.s().members.get(k.id);
  assert.equal(statusIn(t.s(), m, '2026-11-08'), 'ended');
  assert.match(msgs(t.s(), 'memberWithdrawn')[0].body, /rétractation enregistrée le 08\/11\. Remboursement de 17 € sous 14 jours/);
  assert.equal((await t.e.run(withdrawMember, { id: k.id }, t.owner())).already, true);
  // past the 14 days: only the cancellation is left
  const late = await t.join('illimite', '06 99 88 77 66', 'Hugo');
  t.go('2026-11-23');
  await rejects(t.e.run(withdrawMember, { id: late.id }, t.owner()), 'late');
  await rejects(t.e.run(withdrawMember, { id: late.id }, t.ali()), 'forbidden');
});

test('a merged file keeps its membership; erasure waits until it has ended, then its personal data is gone', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44', 'Karim', { email: 'karim@exemple.fr' });
  const into = (await t.e.run(addClient, { first: 'Karim', last: 'Haddad', phone: '0611220000' }, t.owner())).id;
  await t.e.run(mergeClients, { from: k.cid, into }, t.owner());
  assert.equal(memberOf(t.s(), into).id, k.id, 'memberOf follows the merge');
  const ok = await t.e.run(checkout, { clientId: into, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: k.id }], payments: [{ method: 'card', amount: 0 }] }, t.owner());
  assert.equal(t.s().sales.get(ok.id).lines[0].unit, 0);
  assert.deepEqual(memberCards(t.s(), into, t.clock.now).map((x) => [x.plan, x.status, x.used, x.of, x.until, x.card]), [['Essentiel', 'active', 1, 2, '2026-12-02', 'Visa •• 4242']]);
  const e = await rejects(t.e.run(eraseClient, { id: into, cancelUpcoming: true }, t.owner()), 'member');
  assert.equal(e.extra.open.memberships.length, 1);
  // the owner stops it today (« Résilier tout de suite »), then erases
  const stop = await t.e.run(requestCancel, { id: k.id, by: 'salon', channel: 'comptoir', now: true }, t.owner());
  assert.equal(stop.ended, true);
  // ended today: the acknowledgement promises no cut today
  assert.equal(msgs(t.s(), 'memberStopped')[0].body.trim(), "L'Architecte : résiliation enregistrée le 03/11. Ton abonnement prend fin aujourd'hui.");
  assert.equal(msgs(t.s(), 'memberCancelled').length, 0);
  assert.match(msgs(t.s(), 'memberStopped').find((x) => x.channel === 'email').body, /prend fin aujourd’hui/);
  const r = await t.e.run(eraseClient, { id: into }, t.owner());
  assert.equal(r.erased, true);
  const m = t.s().members.get(k.id);
  assert.deepEqual([m.first, m.phone, m.email, m.customer, m.subscription, m.card], ['', '', '', '', '', '']);
  assert.equal(t.s().memberByRef.has('sub_1'), false);
  for (const x of t.e.journal.filter((x) => x.type.startsWith('member.'))) assert.equal(x.pii, undefined, x.type + ' keeps no personal data');
  // the books stay: the month paid and its ticket
  assert.equal(m.periods.length, 1);
  assert.ok(t.s().sales.get(m.periods[0].saleId));
  // a second server reads the same members from the journal
  const other = createEngine(t.rt.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  assert.deepEqual([...other.state.members.values()], [...t.s().members.values()]);
});

test('every member event names its file, and only the pii holds the person', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44', 'Karim', { email: 'karim@exemple.fr' });
  await t.cut(k.id);
  await t.e.run(memberFailed, { id: k.id, invoice: 'in_9', attempt: 1 }, STRIPE);
  await t.e.run(requestCancel, { id: k.id, by: 'salon', channel: 'comptoir' }, t.owner());
  const list = t.e.journal.filter((x) => x.type.startsWith('member.'));
  assert.deepEqual([...new Set(list.map((x) => x.type))].sort(), ['member.activated', 'member.cancelRequested', 'member.created', 'member.pastDue', 'member.renewed', 'member.used']);
  for (const x of list) {
    assert.equal(x.data.cid, k.cid, x.type + ' carries cid');
    assert.ok(!/Karim|karim@|\+3361|cus_|sub_|4242/.test(JSON.stringify(x.data)), x.type + ': nothing personal in the chain');
  }
});

test('the demo renews by itself: a period ended yesterday is paid on the next tick, once; a demoFail member fails once then pays', async () => {
  const t = await club({ mode: 'demo' });
  const k = await t.join('essentiel', '06 11 22 33 44', 'Karim', { provider: 'simulated' });
  const f = await t.join('illimite', '06 99 88 77 66', 'Hugo', { provider: 'simulated', demoFail: true });
  const live = await t.join('illimite', '06 55 44 33 22', 'Live', { provider: 'stripe' });
  t.go('2026-12-04');
  const sales = t.s().sales.size;
  const run = () => t.e.run(tick, {}, SYS);
  await run();
  await run();
  await run();
  const m = t.s().members.get(k.id);
  assert.deepEqual(m.periods.map((p) => [p.start, p.end, p.invoice]), [[DAY, '2026-12-03', 'in_1_0'], ['2026-12-03', '2027-01-03', 'sim_' + k.id + '_1']]);
  assert.equal(statusIn(t.s(), m, '2026-12-04'), 'active');
  const sale = t.s().sales.get(m.periods[1].saleId);
  assert.deepEqual([sale.day, sale.lines[0].kind, sale.totals.revenue], ['2026-12-04', 'membership', 3400]);
  const h = () => t.s().members.get(f.id);
  assert.equal(statusIn(t.s(), h(), '2026-12-04'), 'grace', 'refused once');
  assert.equal(h().periods.length, 1);
  assert.equal(t.s().members.get(live.id).periods.length, 1, 'a real provider’s member is left to its webhooks');
  assert.equal(t.s().sales.size, sales + 1);
  // the tick again: nothing more
  const v = t.s().version;
  await run();
  assert.equal(t.s().sales.size, sales + 1);
  assert.equal(t.s().members.get(k.id).periods.length, 2);
  assert.deepEqual(t.e.journal.slice(v).filter((x) => x.type.startsWith('member.') || x.type.startsWith('sale.') || x.type.startsWith('payment.')), [], 'replayed, the tick adds nothing');
  // two days later, the refused one pays
  t.go('2026-12-06', 11);
  await run();
  assert.equal(statusIn(t.s(), h(), '2026-12-06'), 'active');
  assert.equal(h().periods[1].invoice, 'sim_' + f.id + '_1');
  // a cancellation that took effect ends the member
  await t.e.run(requestCancel, { id: k.id, by: 'client', channel: 'site' }, SYS);
  t.go('2027-01-04');
  await run(); await run(); await run();
  assert.equal(t.s().members.get(k.id).ended.reason, 'cancelled');
  assert.ok(mrr(t.s(), '2027-01-04') > 0);
  assert.equal(periodIn(t.s(), t.s().members.get(k.id), '2027-01-04'), null);
});

test('a client never sets his refund nor speaks for the salon; nothing to refund says so', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  await t.cut(k.id);
  t.go('2026-11-05');
  await rejects(t.e.run(withdrawMember, { id: k.id, by: 'salon' }, CLIENT(k.cid)), 'forbidden');
  await rejects(t.e.run(withdrawMember, { id: k.id }, CLIENT('cl_other')), 'forbidden');
  // the whole month asked back after a cut: the law's amount, and the owner hears of it
  const w = await t.e.run(withdrawMember, { id: k.id, refund: 3400, cid: k.cid }, CLIENT(k.cid));
  assert.deepEqual([w.refund, w.used], [1700, 1]);
  assert.equal(t.s().members.get(k.id).withdrawn.refund, 1700);
  assert.equal(msgs(t.s(), 'owner_member').length, 1);
  // every cut used: no « Remboursement de 0 € »
  const z = await t.join('essentiel', '06 99 88 77 66', 'Hugo');
  await t.cut(z.id);
  t.go('2026-11-14');
  await t.cut(z.id);
  const n = await t.e.run(withdrawMember, { id: z.id }, t.owner());
  assert.equal(n.refund, 0);
  assert.equal(msgs(t.s(), 'memberWithdrawnNone')[0].body.trim(), "L'Architecte : rétractation enregistrée le 14/11. Tes coupes valent le mois : rien à rembourser.");
  assert.equal(msgs(t.s(), 'memberWithdrawn').filter((x) => x.cid === z.cid && x.channel === 'sms').length, 0);
  // the salon still sets its own amount
  const g = await t.join('illimite', '06 55 44 33 22', 'Gilles');
  assert.equal((await t.e.run(withdrawMember, { id: g.id, refund: 4900, by: 'salon' }, t.owner())).refund, 4900);
});

test('a cancellation made at once in the provider’s portal: acknowledged, ended, the owner told', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44', 'Karim', { email: 'karim@exemple.fr' });
  t.go('2026-11-12');
  const r = await t.e.run(memberSync, { ref: 'sub_1', snapshot: { status: 'canceled' } }, STRIPE);
  assert.deepEqual(r.changed, ['cancel', 'ended']);
  const m = t.s().members.get(k.id);
  assert.deepEqual([m.cancel.channel, m.cancel.effective, m.ended.reason], ['stripe', '2026-11-12', 'cancelled']);
  assert.deepEqual(msgs(t.s(), 'memberStopped').map((x) => x.channel).sort(), ['email', 'sms']);
  assert.equal(msgs(t.s(), 'owner_member').length, 1);
  // a checkout never paid that the provider gives up on ends quietly
  const p = await t.e.run(startMembership, { planId: 'essentiel', first: 'Hugo', phone: '0699887766', provider: 'stripe', providerRef: 'cs_p', channel: 'online' }, SYS);
  await t.e.run(endMember, { id: p.id, reason: 'unpaid' }, STRIPE);
  assert.equal(msgs(t.s(), 'memberEnded').length, 0, 'never paid: nothing to stop, nobody told');
  assert.equal(msgs(t.s(), 'owner_member').length, 1);
});

test('a payment that pays for nothing is refused: a second checkout of one file, after the cancellation took effect; an erased file keeps no processor ids', async () => {
  const t = await club();
  // two checkouts of one file before either was paid (two tabs): the second payment is to refund
  const a = await t.e.run(startMembership, { planId: 'essentiel', first: 'Karim', phone: '0611223344', provider: 'stripe', providerRef: 'cs_1', channel: 'online' }, SYS);
  const b = await t.e.run(startMembership, { planId: 'illimite', first: 'Karim', phone: '0611223344', provider: 'stripe', providerRef: 'cs_2', channel: 'online' }, SYS);
  const pay = (ref, inv, x = {}) => t.e.run(memberPaid, { ref, invoice: inv, amount: 3400, periodStart: DAY, periodEnd: '2026-12-03', chargeRef: 'ch_' + inv, ...x }, STRIPE);
  await pay('cs_1', 'in_1');
  await rejects(pay('cs_2', 'in_2', { amount: 4900 }), 'already');
  assert.equal(statusIn(t.s(), t.s().members.get(b.id), DAY), 'pending');
  // cancelled at the end of the month, the provider still charges the next one before its end event
  await t.e.run(requestCancel, { id: a.id, by: 'salon', channel: 'comptoir' }, t.owner());
  t.go('2026-12-03');
  await rejects(pay('cs_1', 'in_1b', { periodStart: '2026-12-03', periodEnd: '2027-01-03' }), 'ended');
  // a file erased between the checkout and its payment
  const e = await t.e.run(startMembership, { planId: 'essentiel', first: 'Hugo', phone: '0699887766', provider: 'stripe', providerRef: 'cs_3', channel: 'online' }, SYS);
  await t.e.run(eraseClient, { id: e.cid }, t.owner());
  await t.e.run(memberPaid, { ref: 'cs_3', invoice: 'in_3', amount: 3400, periodStart: '2026-12-03', periodEnd: '2027-01-03', chargeRef: 'ch_3', customer: 'cus_3', subscription: 'sub_3', card: 'Visa •• 4242' }, STRIPE);
  const act = t.e.journal.find((x) => x.type === 'member.activated' && x.data.id === e.id);
  assert.equal(act.pii, undefined, 'no processor ids under an erased file');
  assert.equal(t.s().memberByRef.has('sub_3'), false);
});

test('a barber sees the badge and the cuts, not the card, a payment in trouble or the contracts in the feed', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  await t.e.run(memberFailed, { id: k.id, invoice: 'in_r2', attempt: 1 }, STRIPE);
  t.go('2026-12-04');
  const c = t.s().clients.get(k.cid);
  const owner = clientCard(t.s(), c, t.owner().caps, null, t.clock.now);
  const barber = clientCard(t.s(), c, t.ali().caps, null, t.clock.now);
  assert.deepEqual([owner.memberships[0].status, owner.memberships[0].card], ['grace', 'Visa •• 4242']);
  assert.deepEqual([barber.memberships[0].status, barber.memberships[0].card, barber.memberships[0].used, barber.memberships[0].of], ['active', '', 0, 2]);
  // lists show two badges: « abonné » comes before « VIP »
  const vip = clientCard(t.s(), { ...c, tags: ['VIP'] }, t.ali().caps, null, t.clock.now);
  assert.ok(vip.badges.indexOf('abonné') >= 0 && vip.badges.indexOf('abonné') < vip.badges.indexOf('VIP'), vip.badges.join(', '));
  // shown the revenue (team.barberSeeRevenue gives report.shop), still no member line in the feed
  const seer = { ...t.ali(), caps: new Set([...t.ali().caps, 'report.shop']) };
  const act = t.s().feed.find((x) => x.type === 'member.activated');
  assert.equal(membershipsExtension.item?.({ s: t.s(), caps: seer.caps, me: seer.staff }, act), null);
});

test('a month’s ticket is not refunded at the till while its contract runs', async () => {
  const t = await club();
  const k = await t.join('essentiel', '06 11 22 33 44');
  const sale = t.s().sales.get(k.saleId);
  await rejects(t.e.run(refundSale, { saleId: sale.id, amount: 3400, method: 'online', reason: 'Erreur' }, t.owner()), 'member_live');
});

test('the owner cannot open the memberships with nothing to sell, nor cover a service that does not exist', async () => {
  const t = await club();
  const plan = { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: ['sv_unknown'] };
  await rejects(t.e.run(updateSettings, { membership: { plans: [plan] } }, t.owner()), 'invalid');
  await rejects(t.e.run(updateSettings, { membership: { enabled: true, plans: [] } }, t.owner()), 'invalid');
  await t.e.run(updateSettings, { membership: { enabled: false, plans: [] } }, t.owner());
  await rejects(t.e.run(updateSettings, { membership: { enabled: true } }, t.owner()), 'invalid');
});

test('the demo’s billing: one member refused costs only its own renewal', async () => {
  const t = await club({ mode: 'demo' });
  const a = await t.join('essentiel', '06 11 22 33 44', 'Karim', { provider: 'simulated' });
  const b = await t.join('essentiel', '06 99 88 77 66', 'Hugo', { provider: 'simulated' });
  // the first member's renewal throws (forced here in memory: a price below what an invoice may be)
  t.s().members.get(a.id).price = 10;
  t.go('2026-12-04');
  await t.e.run(tick, {}, SYS);
  assert.equal(t.s().members.get(b.id).periods.length, 2, 'the next member renews all the same');
  assert.equal(t.s().members.get(a.id).periods.length, 1);
  assert.ok(!t.e.journal.some((x) => x.type === 'payment.created' && x.data.memberId === a.id && x.data.amount === 10), 'nothing half-written for the refused one');
});
