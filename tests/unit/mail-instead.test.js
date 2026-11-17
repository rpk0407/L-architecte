// No SMS provider: every client message leaves by e-mail (messaging/hand.js byMail, sent by http/scheduler.js), never
// twice when its own e-mail exists, never an offer, and a client without an address keeps the hand queue. Then
// « Renvoyer » (commands/messages.js): a fresh copy by e-mail, three a day, by whoever may send that client's messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY, rejects } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, updateClient } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { queueMessage } from '../../server/domain/messages.js';
import { resendMessage, resendConfirmation, resendRefusal, RESENDS_PER_DAY } from '../../server/commands/messages.js';
import { byHand, byMail } from '../../server/messaging/hand.js';
import { mailOfText } from '../../server/messaging/bymail.js';
import { mailHtml } from '../../server/messaging/email.js';
import { dispatch, dispatchNow } from '../../server/http/scheduler.js';
import { quarterOf } from '../../server/commands/reviews.js';

const ORIGIN = 'https://salon.test';
const LATER = addDays(DAY, 2);
const LINK = (id) => ORIGIN + '/avis/' + id + '.sig';
const META = { siteUrl: ORIGIN + '/', linkFor: (a) => ORIGIN + '/r/' + a.code, reviewLink: LINK };
const fakeEmail = (o = {}) => {
  const sent = [];
  return { name: 'smtp', sent, async send(mail) { sent.push(mail); if (o.fail) throw new Error(o.fail); return { ref: 'mail-' + sent.length }; } };
};
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 'sms-' + sent.length }; } }; };
const rtOf = (t, x = {}) => ({ engine: t.engine, sms: null, email: fakeEmail(), whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN, sleep: async () => {}, ...x });
const owner = (t) => ({ ...t.asOwner(), meta: META });
const staff = (t, name) => ({ ...t.asStaff(name), meta: META });
const q = (t, m) => t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, m) }) }, {}, { ...t.sys, meta: META });
const msgs = (t, f) => [...t.engine.state.messages.values()].filter(f);
const one = (t, id) => t.engine.state.messages.get(id);
const runTick = (t, day, h, m = 0) => { t.clock.now = at(day, h, m); return t.engine.run(tick, {}, { ...t.sys, meta: { ...META, providers: { sms: false, email: true } } }); };

/** A client with a phone and an address, and a booking with Ali two days ahead. */
async function booked(t, o = {}) {
  const cid = (await t.engine.run(addClient, { first: 'Karim', last: 'Benali', phone: '06 11 22 33 44', ...(o.email === null ? {} : { email: o.email || 'karim@exemple.fr' }) }, t.asOwner())).id;
  const a = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: o.day || LATER, start: o.start || 600 }, owner(t));
  return { cid, a };
}

test('the salon cancels from the Comptoir: the client gets one e-mail, and the SMS is not mailed a second time', async () => {
  const t = await salon();
  const { a } = await booked(t);
  const rt = rtOf(t);
  await dispatch(rt);
  // the confirmation: its own e-mail (calendar file) left; the SMS has that twin, so it is not mailed too
  assert.deepEqual(rt.email.sent.map((m) => m.tag), ['confirmation']);
  assert.equal(rt.email.sent[0].attachments.length, 1);
  const conf = one(t, 'msg_conf_' + a.id + '_0');
  assert.equal(conf.status, 'queued');
  assert.equal(byMail(t.engine.state, rt, conf), '', 'the confirmation e-mail already says it');
  assert.equal(byHand(t.engine.state, rt, conf), true, 'as before: it waits on the Messages screen');

  await t.engine.run(A.cancelAppointment, { id: a.id, reason: 'Annulé par le salon', notify: true }, owner(t));
  await dispatch(rt);
  const cx = rt.email.sent.filter((m) => m.tag === 'cancelled');
  assert.equal(cx.length, 1, 'exactly one cancellation e-mail');
  assert.equal(cx[0].to, 'karim@exemple.fr');
  assert.match(cx[0].subject, /^Rendez-vous annulé/);
  assert.match(cx[0].text, /annulé par le salon/);
  await dispatch(rt);
  await dispatch(rt);
  assert.equal(rt.email.sent.length, 2, 'nothing more at the next dispatches');
});

test('the salon moves an appointment from the Comptoir: the client gets the « déplacé » e-mail, once', async () => {
  const t = await salon();
  const { a } = await booked(t);
  const rt = rtOf(t);
  await dispatch(rt);
  await t.engine.run(A.moveAppointment, { id: a.id, day: LATER, start: 660, staffId: t.ids.Ali, notify: true }, owner(t));
  await dispatch(rt);
  await dispatch(rt);
  const moved = rt.email.sent.filter((m) => /déplacé/.test(m.subject));
  assert.equal(moved.length, 1);
  assert.match(moved[0].text, /Ton rendez-vous est déplacé/);
  assert.equal(rt.email.sent.length, 2, 'the confirmation, then the move: nothing twice');
});

test('a text with no e-mail of its own (« rendez-vous à décaler ») leaves by e-mail: subject, same words, the link as a button', async () => {
  const t = await salon();
  const { cid, a } = await booked(t);
  const rt = rtOf(t);
  await dispatch(rt);
  t.clock.now += 60000;
  const link = ORIGIN + '/r/' + a.code;
  const { id } = await q(t, { key: 'rs_test_' + a.id, template: 'reschedule', to: '+33611223344', cid, apptId: a.id, vars: { prenom: 'Karim', date: 'Jeudi 5 nov.', lien: link } });
  const m = one(t, id);
  assert.equal(byMail(t.engine.state, rt, m), 'karim@exemple.fr');
  assert.equal(byHand(t.engine.state, rt, m), false, 'the mail takes it: nothing to send by hand');
  await dispatch(rt);
  const mail = rt.email.sent.at(-1);
  assert.equal(mail.to, 'karim@exemple.fr');
  assert.equal(mail.subject, 'Ton rendez-vous doit être décalé · ' + t.engine.state.settings.shop.name);
  assert.ok(mail.text.includes('Karim, on doit décaler ton rendez-vous du Jeudi 5 nov.'), mail.text);
  assert.ok(mail.text.includes(link), 'the link is kept in the text');
  assert.deepEqual(mail.cta, { label: 'Choisir un nouveau créneau', url: link });
  const html = mailHtml(mail.text, mail);
  assert.ok(html.includes('href="' + link + '"') && html.includes('Choisir un nouveau créneau'), 'a button for the main link');
  assert.ok(html.includes('on doit décaler'), 'the words stay beside the button');
  const done = one(t, id);
  assert.equal(done.status, 'sent');
  assert.equal(done.via, 'email');
  assert.equal(done.toMasked.includes('@'), true, 'the outbox says where it went');
  await dispatch(rt);
  assert.equal(rt.email.sent.at(-1), mail, 'sent once');
});

test('who is not mailed: no address (hand queue as before), an offer, a text to someone else’s phone, an SMS provider plugged in, e-mails off', async () => {
  const t = await salon();
  const rt = rtOf(t);
  const s = () => t.engine.state;
  // no address: today's behaviour
  const { cid: noMail, a } = await booked(t, { email: null });
  const conf = one(t, 'msg_conf_' + a.id + '_0');
  assert.equal(byMail(s(), rt, conf), '');
  assert.equal(byHand(s(), rt, conf), true);
  await dispatch(rt);
  assert.equal(rt.email.sent.length, 0);
  assert.equal(one(t, conf.id).status, 'queued');
  assert.ok(noMail);
  // an offer, even to a client who said yes to the offers by SMS and has an address: never by e-mail
  const yes = (await t.engine.run(addClient, { first: 'Omar', phone: '06 22 33 44 55', email: 'omar@exemple.fr', marketing: true }, t.asOwner())).id;
  const offer = await q(t, { key: 'rb_omar', template: 'rebook', to: '+33622334455', cid: yes, vars: { prenom: 'Omar', jours: 40, lien: ORIGIN } });
  assert.ok(offer.id, 'queued as an SMS, as before');
  assert.equal(byMail(s(), rt, one(t, offer.id)), '');
  // a gift card's code texted to the person it is for: not to the buyer's address
  const gift = await q(t, { key: 'gc_omar', template: 'giftcardCode', to: '+33699887766', cid: yes, vars: { acheteur: 'Omar', montant: '30 €', code: 'ABCD', date: '01/01', lien: ORIGIN } });
  assert.equal(byMail(s(), rt, one(t, gift.id)), '');
  // a service text to his own phone: yes…
  const svc = await q(t, { key: 'q_omar', template: 'queue', to: '+33622334455', cid: yes, vars: { prenom: 'Omar' } });
  assert.equal(byMail(s(), rt, one(t, svc.id)), 'omar@exemple.fr');
  // …but not with an SMS provider (nothing changes for a salon that texts), nor without an e-mail provider
  assert.equal(byMail(s(), rtOf(t, { sms: fakeSms() }), one(t, svc.id)), '');
  assert.equal(byMail(s(), rtOf(t, { email: null }), one(t, svc.id)), '');
  // …nor when the owner switched the e-mails to clients off
  await t.engine.run(updateSettings, { messages: { email: false } }, t.asOwner());
  assert.equal(byMail(s(), rt, one(t, svc.id)), '');
  await dispatch(rt, 50);
  assert.equal(rt.email.sent.length, 0, 'nothing left by e-mail');
});

test('with an SMS provider the texts leave by SMS as before, and no copy by e-mail', async () => {
  const t = await salon();
  const { cid, a } = await booked(t);
  const rt = rtOf(t, { sms: fakeSms() });
  await q(t, { key: 'rs_test_' + a.id, template: 'reschedule', to: '+33611223344', cid, apptId: a.id, vars: { prenom: 'Karim', date: 'Jeudi 5', lien: ORIGIN } });
  await dispatch(rt);
  assert.deepEqual(rt.sms.sent.map((x) => x.to), ['+33611223344', '+33611223344'], 'the confirmation and the text, by SMS');
  assert.deepEqual(rt.email.sent.map((m) => m.tag), ['confirmation'], 'only the confirmation’s own e-mail');
});

test('after each finished and paid cut: the « laisse un avis » e-mail with the tracked link, after the delay, once per quarter', async () => {
  const t = await salon({ hour: 8 });
  const { cid, a } = await booked(t, { day: DAY, start: 600 });
  const rt = rtOf(t);
  await dispatch(rt);
  rt.email.sent.length = 0;
  t.clock.now = at(DAY, 10, 40);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await runTick(t, DAY, 12, 39);
  await dispatch(rt);
  assert.equal(rt.email.sent.filter((m) => m.tag === 'review').length, 0, 'not before reviewDelayMin (2 h)');
  await runTick(t, DAY, 12, 40);
  await dispatch(rt);
  await runTick(t, DAY, 12, 41);
  await dispatch(rt);
  const asked = rt.email.sent.filter((m) => m.tag === 'review');
  assert.equal(asked.length, 1, 'one request');
  const id = 'msg_rev_' + cid + '_' + quarterOf(DAY);
  assert.equal(asked[0].to, 'karim@exemple.fr');
  assert.match(asked[0].subject, /^Merci pour ta visite/);
  assert.ok(asked[0].text.includes(LINK(id)), 'the tracked /avis link of this very message');
  assert.deepEqual(asked[0].cta, { label: 'Laisser un avis', url: LINK(id) });
  assert.match(asked[0].text, /Réponds « stop »/, 'a way to say no');
  assert.equal(one(t, id).status, 'sent');
  assert.equal(one(t, id).via, 'email');

  // the existing cap is kept: a second cut in the same quarter is not asked again
  const b = await t.engine.run(A.createAppointment, { clientId: cid, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 1), start: 600 }, owner(t));
  t.clock.now = at(addDays(DAY, 1), 10, 40);
  await t.engine.run(S.checkout, { apptId: b.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await runTick(t, addDays(DAY, 1), 12, 45);
  await dispatch(rt);
  assert.equal(rt.email.sent.filter((m) => m.tag === 'review').length, 1, 'once per client per quarter');
});

test('a cut paid in the evening: the review e-mail waits for the end of the quiet hours', async () => {
  const t = await salon({ hour: 8 });
  const { a } = await booked(t, { day: DAY, start: 1080 });
  const rt = rtOf(t);
  await dispatch(rt);
  t.clock.now = at(DAY, 19, 30);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await runTick(t, DAY, 21, 45);
  await dispatch(rt);
  await runTick(t, addDays(DAY, 1), 7, 59);
  await dispatch(rt);
  assert.equal(rt.email.sent.filter((m) => m.tag === 'review').length, 0, 'nothing at night');
  await runTick(t, addDays(DAY, 1), 8, 0);
  await dispatch(rt);
  assert.equal(rt.email.sent.filter((m) => m.tag === 'review').length, 1, 'the next morning at 8 h');
});

test('a client who said STOP since the request was queued gets no review e-mail (consent is read again as it leaves)', async () => {
  const t = await salon({ hour: 8 });
  const { cid, a } = await booked(t, { day: DAY, start: 1080 });
  const rt = rtOf(t);
  t.clock.now = at(DAY, 19, 30);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  // queued in the evening for the next morning, then the client switches the salon's texts off
  t.clock.now = at(DAY, 20, 30);
  const id = (await q(t, { key: 'rev_' + cid + '_' + quarterOf(DAY), template: 'review', to: '+33611223344', cid, apptId: a.id, vars: { prenom: 'Karim', avis: LINK('x') } })).id;
  assert.ok(id);
  await t.engine.run(updateClient, { id: cid, patch: { sms: false } }, t.asOwner());
  t.clock.now = at(addDays(DAY, 1), 8, 5);
  await dispatch(rt);
  assert.equal(rt.email.sent.filter((m) => m.tag === 'review').length, 0);
  assert.equal(one(t, id).status, 'skipped');
});

test('mailOfText: the link on its own line, the salon under it, a default subject for a text nobody listed', async () => {
  const t = await salon();
  const s = t.engine.state;
  const m = { id: 'msg_x', template: 'inconnu', body: "L'Architecte : voici ton lien https://salon.test/x. Merci !" };
  const mail = mailOfText(s, m);
  assert.equal(mail.subject, 'Un message du salon · ' + s.settings.shop.name);
  assert.deepEqual(mail.links, ['https://salon.test/x']);
  assert.equal(mail.text.split('\n')[1], 'https://salon.test/x');
  assert.equal(mailOfText(s, { id: 'msg_conf_a_2', template: 'confirmation', body: 'ok' }).subject, 'Ton rendez-vous est déplacé · ' + s.settings.shop.name);
});

/* ---------------- « Renvoyer » ---------------- */

test('« Renvoyer la confirmation par e-mail »: a fresh copy under a new id, really sent, three a day, journaled with the staff', async () => {
  const t = await salon();
  const { a } = await booked(t);
  const rt = rtOf(t);
  await dispatch(rt);
  assert.equal(rt.email.sent.length, 1);
  const ids = [];
  for (let i = 0; i < RESENDS_PER_DAY; i++) {
    const r = await t.engine.run(resendConfirmation, { id: a.id }, owner(t));
    assert.ok(r.id && !ids.includes(r.id) && r.id !== 'msg_mconf_' + a.id + '_0', 'a new id each time');
    ids.push(r.id);
    await dispatchNow(rt, [r.id]);
    assert.equal(one(t, r.id).status, 'sent');
  }
  assert.equal(rt.email.sent.length, 1 + RESENDS_PER_DAY);
  const last = rt.email.sent.at(-1);
  assert.equal(last.to, 'karim@exemple.fr');
  assert.match(last.subject, /^Rendez-vous confirmé/);
  assert.equal(last.attachments.length, 1, 'with the calendar file');
  assert.ok(last.text.includes(ORIGIN + '/r/'), 'and the « Gérer mon rendez-vous » link');
  const e = await rejects(t.engine.run(resendConfirmation, { id: a.id }, owner(t)), 'slow_down');
  assert.equal(e.status, 429);
  // the journal names who asked
  const ev = (await t.store.readAll ? await t.store.readAll() : []).filter((x) => x.type === 'message.queued' && x.data.id === ids[0]);
  if (ev.length) assert.equal(ev[0].actor.id, t.ownerId);
  assert.equal(one(t, ids[0]).by, t.ownerId);
  assert.equal(one(t, ids[0]).resendOf, 'conf:' + a.id);
  // tomorrow the count starts again
  t.clock.now += 86400000;
  assert.ok((await t.engine.run(resendConfirmation, { id: a.id }, owner(t))).id);
});

test('« Renvoyer la confirmation »: a barber for his own appointments only; refused without an address or once the appointment is over', async () => {
  const t = await salon();
  const { a } = await booked(t);
  await rejects(t.engine.run(resendConfirmation, { id: a.id }, staff(t, 'Ben')), 'forbidden');
  assert.ok((await t.engine.run(resendConfirmation, { id: a.id }, staff(t, 'Ali'))).id, 'Ali’s own client');
  // a file without an address is refused
  const lone = (await t.engine.run(addClient, { first: 'Sami', phone: '06 99 88 77 66' }, t.asOwner())).id;
  const c = await t.engine.run(A.createAppointment, { clientId: lone, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 840 }, owner(t));
  await rejects(t.engine.run(resendConfirmation, { id: c.id }, owner(t)), 'no_email');
  await t.engine.run(A.cancelAppointment, { id: a.id, notify: false }, owner(t));
  await rejects(t.engine.run(resendConfirmation, { id: a.id }, owner(t)), 'closed');
});

test('« Renvoyer » a message: one that failed or came too late, or an e-mail that left; not one still waiting, not an offer', async () => {
  const t = await salon();
  const { cid, a } = await booked(t);
  const s = () => t.engine.state;
  // the e-mail provider is down: the confirmation fails
  const down = rtOf(t, { email: fakeEmail({ fail: 'Boîte indisponible' }) });
  await dispatch(down);
  const first = one(t, 'msg_mconf_' + a.id + '_0');
  assert.equal(first.status, 'failed');
  assert.equal(resendRefusal(s(), first), '');
  // the SMS confirmation still waits (hand queue): not resendable
  assert.match(resendRefusal(s(), one(t, 'msg_conf_' + a.id + '_0')), /en attente/);
  await rejects(t.engine.run(resendMessage, { id: 'msg_conf_' + a.id + '_0' }, owner(t)), 'not_resendable');
  // a colleague's client: refused; unknown: 404
  await rejects(t.engine.run(resendMessage, { id: first.id }, staff(t, 'Ben')), 'forbidden');
  await rejects(t.engine.run(resendMessage, { id: 'msg_nope' }, owner(t)), 'not_found');

  const rt = rtOf(t);
  const r = await t.engine.run(resendMessage, { id: first.id }, staff(t, 'Ali'));
  assert.notEqual(r.id, first.id);
  assert.equal(one(t, r.id).status, 'queued', 'a message like any other: it waits for the dispatch');
  assert.equal(one(t, r.id).by, t.ids.Ali);
  await dispatchNow(rt, [r.id]);
  assert.equal(one(t, r.id).status, 'sent');
  assert.equal(rt.email.sent.length, 1);
  assert.match(rt.email.sent[0].subject, /^Rendez-vous confirmé/);
  assert.equal(rt.email.sent[0].attachments.length, 1, 'a confirmation of an appointment to come is written again, with its file');
  // the copy that left can be sent again; the count is on the first message: three a day in all
  assert.equal(resendRefusal(s(), one(t, r.id)), '');
  await t.engine.run(resendMessage, { id: r.id }, owner(t));
  await t.engine.run(resendMessage, { id: first.id }, owner(t));
  await rejects(t.engine.run(resendMessage, { id: r.id }, owner(t)), 'slow_down');
  await rejects(t.engine.run(resendMessage, { id: first.id }, owner(t)), 'slow_down');

  // a text that came too late (expired) leaves again as a mail, with its words
  t.clock.now += 60000;
  const late = await q(t, { key: 'late_' + a.id, template: 'reschedule', to: '+33611223344', cid, apptId: a.id, vars: { prenom: 'Karim', date: 'Jeudi 5', lien: ORIGIN + '/r/x' } });
  t.clock.now += 7 * 3600000;
  await dispatch(rt, 50);
  assert.equal(one(t, late.id).status, 'expired');
  const again = await t.engine.run(resendMessage, { id: late.id }, owner(t));
  await dispatchNow(rt, [again.id]);
  const mail = rt.email.sent.at(-1);
  assert.equal(one(t, again.id).status, 'sent');
  assert.match(mail.subject, /^Ton rendez-vous doit être décalé/);
  assert.ok(mail.text.includes('on doit décaler ton rendez-vous'));

  // an offer never leaves by e-mail, whatever its state
  await t.engine.run(updateClient, { id: cid, patch: { marketing: true } }, t.asOwner());
  const offer = await q(t, { key: 'rb_k', template: 'rebook', to: '+33611223344', cid, vars: { prenom: 'Karim', jours: 40, lien: ORIGIN } });
  assert.ok(offer.id);
  t.clock.now += 3 * 86400000;
  await rejects(t.engine.run(resendMessage, { id: offer.id }, owner(t)), 'not_resendable');
});
