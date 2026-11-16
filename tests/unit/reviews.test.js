// REV-02: the Google review request leaves once the visit is done and paid, after the delay and out of the quiet hours,
// once per client per quarter, never after a no-show, a cancellation, a refund or to a client who takes no texts (an e-mail
// instead when his file has no phone), and every replay of the tick or of the journal finds the same single request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, DAY, at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { reviewClicked, queueReviews, visitClosedAt, quarterOf, REVIEW_LATE_MS } from '../../server/commands/reviews.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { reviewLinkKind, safeRedirect } from '../../shared/reviews.js';

const SAT = '2026-11-07', MON = '2026-11-09', TUE = '2026-11-10';
const LINK = (id) => 'https://salon.test/avis/' + id + '.sig';
const run = (t, day, h, m = 0) => { t.clock.now = at(day, h, m); return t.engine.run(tick, {}, { ...t.sys, meta: { reviewLink: LINK } }); };
const reviews = (t) => [...t.engine.state.messages.values()].filter((m) => m.template === 'review');

/** A booking at `start` on `day`, checked out (done and paid) at `paidAt` minutes. */
async function visit(t, { clientId = t.ids.yanis, day = DAY, start = 600, paidAt = start + 35 } = {}) {
  t.clock.now = at(day, 8);
  const a = await t.engine.run(A.createAppointment, { clientId, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start }, t.asOwner());
  t.clock.now = at(day, 0, paidAt);
  const sale = await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  return { a, sale };
}

test('a finished, paid visit: exactly one request, after the delay, with the tracked link', async () => {
  const t = await salon({ hour: 8 });
  const { a } = await visit(t, { start: 600, paidAt: 640 });
  assert.equal(visitClosedAt(t.engine.state, t.engine.state.appts.get(a.id)), at(DAY, 10, 40));
  await run(t, DAY, 12, 39);
  assert.equal(reviews(t).length, 0, 'not before the two hours');
  await run(t, DAY, 12, 40);
  await run(t, DAY, 12, 41);
  await run(t, DAY, 15);
  const [m, ...more] = reviews(t);
  assert.equal(more.length, 0);
  assert.equal(m.id, 'msg_rev_' + t.ids.yanis + '_' + quarterOf(DAY));
  assert.equal(m.apptId, a.id);
  assert.equal(m.channel, 'sms');
  assert.equal(m.dueAt, at(DAY, 12, 40));
  assert.equal(m.body, 'Merci Yanis ! Ton avis Google nous aide énormément : https://salon.test/avis/' + m.id + '.sig');
  assert.ok(!m.body.includes('search.google.com'), 'the raw Google link is not sent');
});

test('a visit checked out hours after it ended: the delay runs from the ticket, not from the booked time', async () => {
  const t = await salon({ hour: 8 });
  // the later of 'done' and the ticket: here the till, at 15 h, for a 10 h cut
  const { a } = await visit(t, { start: 600, paidAt: 900 });
  const s = t.engine.state;
  assert.equal(visitClosedAt(s, s.appts.get(a.id)), at(DAY, 15));
  await run(t, DAY, 16, 59);
  assert.equal(reviews(t).length, 0);
  await run(t, DAY, 17);
  assert.equal(reviews(t).length, 1);
});

test('a late-evening visit is asked the next morning as the quiet hours end, never lost to the change of day', async () => {
  const t = await salon({ hour: 8 });
  await visit(t, { start: 1080, paidAt: 1170 }); // 18:00, paid 19:30: due 21:30, inside the quiet hours
  await run(t, DAY, 21, 31);
  await run(t, DAY, 23, 59);
  await run(t, addDays(DAY, 1), 7, 59);
  assert.equal(reviews(t).length, 0, 'nothing at night');
  await run(t, addDays(DAY, 1), 8, 0);
  const [m] = reviews(t);
  assert.ok(m, 'sent the next morning');
  assert.equal(m.dueAt, at(addDays(DAY, 1), 8));
  await run(t, addDays(DAY, 1), 9);
  assert.equal(reviews(t).length, 1);
});

test('Saturday evening waits for Monday 8 h; a request more than 24 h late is dropped', async () => {
  const t = await salon({ day: SAT, hour: 8 });
  await visit(t, { day: SAT, start: 1080, paidAt: 1170 });
  await run(t, addDays(SAT, 1), 12); // Sunday: quiet all day
  assert.equal(reviews(t).length, 0);
  await run(t, MON, 8, 1);
  assert.equal(reviews(t).length, 1);

  // nobody ticked from Monday 8 h to Tuesday 9 h (an outage, a long weekend): too late for a « merci »
  const u = await salon({ day: SAT, hour: 8 });
  await visit(u, { day: SAT, start: 1080, paidAt: 1170 });
  u.clock.now = at(MON, 8) + REVIEW_LATE_MS + 60000;
  await u.engine.run(tick, {}, u.sys);
  await run(u, TUE, 12);
  assert.equal(reviews(u).length, 0);
});

test('no request after a no-show, a cancellation, a refunded ticket, nor to a client who takes no texts', async () => {
  const t = await salon({ hour: 8 });
  const s = () => t.engine.state;
  // no-show and cancelled: never done
  const ns = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 540 }, t.asOwner());
  t.clock.now = at(DAY, 9, 10);
  await t.engine.run(A.setStatus, { id: ns.id, status: 'no_show' }, t.asOwner());
  const sami = (await t.engine.run(addClient, { first: 'Sami', phone: '0622222222' }, t.asOwner())).id;
  const cx = await t.engine.run(A.createAppointment, { clientId: sami, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 600 }, t.asOwner());
  await t.engine.run(A.cancelAppointment, { id: cx.id }, t.asOwner());
  // refunded: paid, then given back
  const karim = (await t.engine.run(addClient, { first: 'Karim', phone: '0633333333' }, t.asOwner())).id;
  const { sale } = await visit(t, { clientId: karim, start: 660 });
  t.clock.now = at(DAY, 11, 50);
  await t.engine.run(S.refund, { saleId: sale.id, amount: 2000, reason: 'Retour client', method: 'card' }, t.asOwner());
  // opted out of texts, no e-mail
  const nabil = (await t.engine.run(addClient, { first: 'Nabil', phone: '0644444444', sms: false }, t.asOwner())).id;
  await visit(t, { clientId: nabil, start: 720 });
  for (const h of [14, 15, 18]) await run(t, DAY, h);
  assert.deepEqual(reviews(t).map((m) => m.cid), [], JSON.stringify(reviews(t)));
  assert.equal(s().appts.get(ns.id).status, 'no_show');
});

test('a file without a phone gets the request by e-mail, with the link as a button and a way to say no', async () => {
  const t = await salon({ hour: 8 });
  const ilyes = (await t.engine.run(addClient, { first: 'Ilyes', email: 'ilyes@exemple.fr' }, t.asOwner())).id;
  await visit(t, { clientId: ilyes, start: 600 });
  await run(t, DAY, 13);
  const [m] = reviews(t);
  assert.equal(m.channel, 'email');
  assert.equal(m.to, 'ilyes@exemple.fr');
  assert.equal(m.mail.cta.url, LINK(m.id));
  assert.match(m.body, /Laisser un avis : https:\/\/salon\.test\/avis\//);
  assert.match(m.body, /Réponds « stop » à ce mail ou dis-le au salon\.$/);
  // texts switched off, with an e-mail: nothing at all (FID-01: he said no, the salon does not switch channels)
  const nabil = (await t.engine.run(addClient, { first: 'Nabil', phone: '0655555555', email: 'nabil@exemple.fr', sms: false }, t.asOwner())).id;
  await visit(t, { clientId: nabil, start: 700 });
  await run(t, DAY, 14);
  assert.deepEqual(reviews(t).map((x) => x.cid), [ilyes]);
  // e-mails off: nothing
  const u = await salon({ hour: 8 });
  await u.engine.run(updateSettings, { messages: { email: false } }, u.asOwner());
  const x = (await u.engine.run(addClient, { first: 'Ilyes', email: 'ilyes@exemple.fr' }, u.asOwner())).id;
  await visit(u, { clientId: x, start: 600 });
  await run(u, DAY, 13);
  assert.equal(reviews(u).length, 0);
});

test('once per client per quarter, whatever the number of visits', async () => {
  const t = await salon({ hour: 8 });
  await visit(t, { day: DAY, start: 600 });
  await run(t, DAY, 13);
  const d2 = addDays(DAY, 14);
  await visit(t, { day: d2, start: 600 });
  await run(t, d2, 13);
  assert.equal(reviews(t).length, 1, 'the second visit of the quarter asks nothing');
  const jan = '2027-01-05';
  await visit(t, { day: jan, start: 600 });
  await run(t, jan, 13);
  assert.deepEqual(reviews(t).map((m) => m.id.split('_').pop()), ['2026-4', '2027-1']);
});

test('switched off, or no Google link: nothing', async () => {
  const t = await salon({ hour: 8 });
  await t.engine.run(updateSettings, { messages: { review: false } }, t.asOwner());
  await visit(t, { start: 600 });
  await run(t, DAY, 13);
  assert.equal(reviews(t).length, 0);
  const s = t.engine.state;
  assert.deepEqual(queueReviews({ ...s, settings: { ...s.settings, messages: { ...s.settings.messages, review: true }, shop: { ...s.settings.shop, reviewUrl: '' } } }, /** @type {any} */ ({ now: at(DAY, 13), local: { day: DAY }, drafts: [], meta: {} })), []);
});

test('replays are idempotent: the tick twice, the click twice, the journal folded again', async () => {
  const t = await salon({ hour: 8 });
  await visit(t, { start: 600 });
  await run(t, DAY, 13);
  await run(t, DAY, 13); // a second server, the same minute
  const [m] = reviews(t);
  assert.equal(reviews(t).length, 1);
  assert.deepEqual(await t.engine.run(reviewClicked, { id: m.id }, { actor: { t: 'client', id: 'web', n: '' } }), { recorded: true });
  assert.deepEqual(await t.engine.run(reviewClicked, { id: m.id }, { actor: { t: 'client', id: 'web', n: '' } }), { recorded: false });
  assert.deepEqual(await t.engine.run(reviewClicked, { id: 'msg_nope' }, { actor: { t: 'client', id: 'web', n: '' } }), { recorded: false });
  const { events } = await t.store.read(0);
  const clicks = events.filter((e) => e.type === 'review.clicked');
  assert.equal(clicks.length, 1);
  // nothing personal in the chain: the message id only, an anonymous actor, no pii
  assert.deepEqual(clicks[0].data, { id: m.id });
  assert.equal(clicks[0].pii, undefined);
  assert.deepEqual(clicks[0].actor, { t: 'client', id: 'web', n: '' });
  // the projection rebuilt from the stored journal says the same
  const s2 = emptyState();
  for (const e of events) evolve(s2, e);
  assert.equal([...s2.messages.values()].filter((x) => x.template === 'review').length, 1);
  assert.equal(s2.reviewClicks.get(m.id), t.engine.state.reviewClicks.get(m.id));
  assert.equal(t.engine.verify().ok, true);
});

test('the Google link check and the redirect guard', () => {
  assert.equal(reviewLinkKind('https://search.google.com/local/writereview?placeid=ChIJJSWkBLy_yRIRbgAQcMwb-JY'), 'placeid');
  assert.equal(reviewLinkKind('https://g.page/r/CbgAQcMwb-JYEBM/review'), 'gpage');
  assert.equal(reviewLinkKind('https://maps.app.goo.gl/AbCdEf12345'), 'maps');
  assert.equal(reviewLinkKind('https://www.google.com/maps/place/L%27Architecte'), '', 'the map page is not the review form');
  assert.equal(reviewLinkKind('https://g.page/r/CbgAQcMwb-JYEBM'), '', 'without /review it opens the profile');
  assert.equal(reviewLinkKind('http://g.page/r/CbgAQcMwb-JYEBM/review'), '');
  assert.equal(safeRedirect('javascript:alert(1)'), '');
  assert.equal(safeRedirect('//evil.example/'), '');
  assert.equal(safeRedirect(' https://g.page/r/x/review '), 'https://g.page/r/x/review');
});

// RETOURS-01 · After the visit the receipt carries the link: one text, not a second one; the same opt-outs, the same cap.
import { receiptMayAsk, RECEIPT_REVIEW } from '../../server/commands/reviews.js';
import { reviewStats } from '../../server/projections/reviews.js';

const receipt = (t, saleId, o = {}) => t.engine.run(S.sendReceipt, { saleId, ...o }, { ...t.asOwner(), meta: { reviewLink: LINK, receiptLink: (x) => 'https://salon.test/recu/' + x.number } });
const receipts = (t) => [...t.engine.state.messages.values()].filter((m) => m.template === 'receipt');

test('the receipt sent after the visit carries the review link, and no separate request follows that quarter', async () => {
  const t = await salon({ hour: 8 });
  const { a, sale } = await visit(t, { start: 600, paidAt: 640 });
  const r = await receipt(t, sale.id);
  const [m] = receipts(t);
  assert.equal(m.id, r.id);
  assert.equal(m.review, true);
  assert.equal(m.apptId, a.id);
  assert.match(m.body, /^L'Architecte : merci Yanis ! Ton ticket T\d{6} de 20,00 € : https:\/\/salon\.test\/recu\/\d+/);
  assert.ok(m.body.endsWith(' Ton avis Google nous aide : https://salon.test/avis/' + m.id + '.sig'), m.body);
  assert.ok(!/offert|cadeau|réduction|remise|si tu as aimé|satisfait/i.test(m.body), 'no reward, no gating');
  // the tick finds the client already asked: nothing more, that day or after another visit of the quarter
  await run(t, DAY, 12, 40); await run(t, DAY, 15);
  assert.equal(reviews(t).length, 0, 'one message, not a second one');
  const v2 = await visit(t, { day: addDays(DAY, 7), start: 600, paidAt: 640 });
  await receipt(t, v2.sale.id);
  assert.equal(receipts(t)[1].review, undefined, 'asked once a quarter: the next receipt is a plain receipt');
  assert.ok(!receipts(t)[1].body.includes('/avis/'));
  await run(t, addDays(DAY, 7), 15);
  assert.equal(reviews(t).length, 0);
  // the link's opening counts like a request's, once
  assert.deepEqual(await t.engine.run(reviewClicked, { id: m.id }, t.sys), { recorded: true });
  assert.deepEqual(await t.engine.run(reviewClicked, { id: m.id }, t.sys), { recorded: false });
  assert.deepEqual(await t.engine.run(reviewClicked, { id: receipts(t)[1].id }, t.sys), { recorded: false }, 'a plain receipt is not a request');
});

test('the receipt stays a plain receipt: reviews off, no link, a STOP, texts off, another number, a refund, a request already sent', async () => {
  const plain = async (prep, o = {}) => {
    const t = await salon({ hour: 8 });
    const v = await visit(t, { start: 600, paidAt: 640 });
    await prep(t, v);
    const s = t.engine.state;
    const sale = s.sales.get(v.sale.id), c = s.clients.get(t.ids.yanis);
    const asked = receiptMayAsk(s, { now: t.clock.now, drafts: [] }, sale, c, o.to || c.phone);
    if (!o.noSend) { await receipt(t, v.sale.id, o.phone ? { phone: o.phone } : {}); const m = receipts(t)[0]; if (m) assert.ok(!m.body.includes('/avis/') && !m.review, m.body); }
    return asked;
  };
  assert.equal(await plain(async () => {}, { noSend: true }), true, 'the base case asks');
  assert.equal(await plain((t) => t.engine.run(updateSettings, { messages: { review: false } }, t.asOwner())), false);
  assert.equal(await plain((t) => { t.engine.state.settings.shop.reviewUrl = ''; }), false);
  assert.equal(await plain((t) => { t.engine.state.clients.get(t.ids.yanis).sms = false; }), false, 'texts switched off');
  assert.equal(await plain((t) => { t.engine.state.clients.get(t.ids.yanis).marketingSrc = 'stop'; }), false, 'a STOP');
  assert.equal(await plain(async () => {}, { to: '+33699999999', phone: '06 99 99 99 99' }), false, 'a receipt sent to another number asks nothing');
  assert.equal(await plain((t, v) => { t.engine.state.sales.get(v.sale.id).refunded = 500; }), false, 'a ticket refunded');
  assert.equal(await plain(async (t) => { await run(t, DAY, 12, 40); assert.equal(reviews(t).length, 1); }), false, 'the request already left');
});

test('Rapports › Avis Google counts a receipt that carried the link like a request', async () => {
  const t = await salon({ hour: 8 });
  const { sale } = await visit(t, { start: 600, paidAt: 640 });
  const r = await receipt(t, sale.id);
  await t.engine.run({ run: (s, i, ctx) => ctx.emit('message.updated', { id: r.id, patch: { status: 'sent', sentAt: ctx.now } }) }, {}, t.sys);
  await t.engine.run(reviewClicked, { id: r.id }, t.sys);
  const st = reviewStats(t.engine.state, DAY, DAY);
  assert.deepEqual([st.sent, st.opened], [1, 1]);
  assert.equal(RECEIPT_REVIEW, ' Ton avis Google nous aide : {avis}');
});
