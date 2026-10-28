// FID-01: one consent rule per class of text (service, relation, marketing), so nothing leaves to someone who said no:
// STOP stops the review request too, an e-mail only goes to a file without a phone, the quarter is the visit's, WhatsApp
// carries service texts only, files imported from WordPress get no relation text before they were told about the new
// site, and an « ok » answered to the salon's phone is filed by itself with the text it answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as S from '../../server/commands/sales.js';
import { addClient, eraseClient, updateClient } from '../../server/commands/clients.js';
import { smsOptOut, claimMessage, messageResult } from '../../server/commands/messages.js';
import { smsReply, smsReport, isAck, REPLY_HANDLERS } from '../../server/commands/sms-inbound.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { quarterOf } from '../../server/commands/reviews.js';
import { classOf, TEMPLATE_FLAGS } from '../../server/core/templates.js';
import { queueMessage, consentGone, waMapping, FILLERS } from '../../server/domain/messages.js';
import { WA_SMS_ONLY } from '../../server/settings/messages.js';
import { informedAt, neverInformed } from '../../server/projections/informed.js';
import { dispatch } from '../../server/http/scheduler.js';
import { emptyState, evolve } from '../../server/core/state.js';

const ORIGIN = 'https://salon.test';
const META = { reviewLink: (id) => ORIGIN + '/avis/' + id + '.sig', siteUrl: ORIGIN + '/', linkFor: (a) => ORIGIN + '/r/' + a.code };
const PROVIDER = { actor: /** @type {const} */ ({ t: 'provider', id: 'gateway', n: '' }), caps: new Set(), meta: META };
const run = (t, day, h, m = 0) => { t.clock.now = at(day, h, m); return t.engine.run(tick, {}, { ...t.sys, meta: META }); };
const msgs = (t, tpl) => [...t.engine.state.messages.values()].filter((m) => !tpl || m.template === tpl);
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 'r' + sent.length }; } }; };
const rtOf = (t, sms) => ({ engine: t.engine, sms, email: null, whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN });
/** What a consent change outside the salon's screens writes (the site's box, an import): set directly on the file. */
const setFile = { run(s, input, ctx) { ctx.emit('client.updated', { id: input.id, cid: input.id, patch: input.patch, fields: [] }); return { ok: true }; } };

/** A booking at `start` on `day`, checked out (done and paid) at `paidAt` minutes. */
async function visit(t, clientId, day = DAY, start = 600, paidAt = start + 35) {
  t.clock.now = at(day, 8);
  const a = await t.engine.run(A.createAppointment, { clientId, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day, start }, t.asOwner());
  t.clock.now = at(day, 0, paidAt);
  await t.engine.run(S.checkout, { apptId: a.id, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  return a;
}

test('three classes: review is relation, rebook marketing, the rest service; the flags say so', () => {
  assert.equal(classOf('rebook'), 'marketing');
  assert.equal(classOf('review'), 'relation');
  assert.equal(classOf('reminder'), 'service');
  assert.equal(classOf('confirmation'), 'service');
  assert.equal(classOf('lookup'), 'service');
  assert.equal(classOf('jamais-vu'), 'service', 'a text with no entry is a service text');
  assert.deepEqual(TEMPLATE_FLAGS.review, { relation: true, quiet: true });
  assert.equal(TEMPLATE_FLAGS.lookup.requested, true);
  // no contract text is ever promotional
  for (const k of ['confirmation', 'reminder', 'cancelled', 'receipt', 'lookup']) assert.equal(!!(TEMPLATE_FLAGS[k] || {}).marketing, false, k);
});

test('a STOP stops the review request: none queued after it, and one waiting for the morning is skipped at claim', async () => {
  const t = await salon({ hour: 8 });
  const karim = (await t.engine.run(addClient, { first: 'Karim', phone: '0611111111' }, t.asOwner())).id;
  await t.engine.run(setFile, { id: karim, patch: { marketing: false, marketingSrc: 'site', marketingAt: t.clock.now } }, t.sys);
  await visit(t, karim);
  await run(t, DAY, 13);
  assert.equal(msgs(t, 'review').length, 1, 'texts on, no offers: still asked (relation, not marketing)');

  // the next quarter, after a STOP: nothing
  const jan = '2027-01-05';
  await visit(t, karim, jan);
  t.clock.now = at(jan, 11);
  await t.engine.run(smsOptOut, { phone: '0611111111' }, PROVIDER);
  await run(t, jan, 13);
  assert.equal(msgs(t, 'review').length, 1);
  const s = t.engine.state;
  assert.equal(s.clients.get(karim).marketingSrc, 'stop');

  // queued in the evening, held by the quiet hours for 8 h, then the STOP in the night: skipped as it would leave
  const u = await salon({ hour: 8 });
  const sami = (await u.engine.run(addClient, { first: 'Sami', phone: '0622222222' }, u.asOwner())).id;
  const a = await visit(u, sami, DAY, 1080, 1170);
  u.clock.now = at(DAY, 21);
  await u.engine.run({ run: (st, i, ctx) => queueMessage(st, ctx, { key: 'rev_late', template: 'review', to: '+33622222222', cid: sami, apptId: a.id, vars: { prenom: 'Sami', avis: ORIGIN + '/avis/x' } }) }, {}, u.sys);
  const [m] = msgs(u, 'review');
  assert.equal(m.dueAt, at(addDays(DAY, 1), 8), 'held by the quiet hours');
  u.clock.now = at(DAY, 23);
  await u.engine.run(smsOptOut, { phone: '0622222222' }, PROVIDER);
  assert.equal(u.engine.state.messages.get(m.id).status, 'queued', 'smsOptOut closes the offers; the claim checks the rest');
  u.clock.now = at(addDays(DAY, 1), 8, 1);
  const sms = fakeSms();
  await dispatch(rtOf(u, sms));
  const after = u.engine.state.messages.get(m.id);
  assert.equal(after.status, 'skipped');
  assert.equal(after.error, 'A répondu STOP');
  assert.equal(sms.sent.length, 0);
  assert.equal(u.engine.verify().ok, true);
});

test('the relation gate: no file, an erased file, texts switched off; the owner’s own test passes', async () => {
  const t = await salon();
  const s = () => t.engine.state;
  const q = (m) => t.engine.run({ run: (st, i, ctx) => ({ id: queueMessage(st, ctx, m) }) }, {}, t.sys);
  const vars = { prenom: 'X', avis: ORIGIN + '/avis/x' };
  assert.equal((await q({ key: 'r1', template: 'review', to: '+33611111111', vars })).id, null, 'no file');
  assert.equal((await q({ key: 'r2', template: 'review', to: '+33611111111', vars, owner: true })).id, 'msg_r2', 'the owner’s test');
  assert.equal(consentGone(s(), s().messages.get('msg_r2')), '', 'and never held back at claim');
  const nabil = (await t.engine.run(addClient, { first: 'Nabil', phone: '0644444444', sms: false }, t.asOwner())).id;
  assert.equal((await q({ key: 'r3', template: 'review', to: '+33644444444', cid: nabil, vars })).id, null, 'texts off');
  const lea = (await t.engine.run(addClient, { first: 'Léa', phone: '0655555555' }, t.asOwner())).id;
  assert.equal((await q({ key: 'r4', template: 'review', to: '+33655555555', cid: lea, vars })).id, 'msg_r4');
  await t.engine.run(eraseClient, { id: lea }, t.asOwner());
  assert.equal(consentGone(s(), s().messages.get('msg_r4')), 'A répondu STOP', 'erased since: not sent');
  // a service text is never held back by the relation rules
  assert.equal((await q({ key: 'c1', template: 'reminder', to: '+33644444444', cid: nabil, vars })).id, 'msg_c1');
  assert.equal(consentGone(s(), s().messages.get('msg_c1')), '');
});

test('texts off with an e-mail: no review at all; no phone with an e-mail: one e-mail that says how to say no', async () => {
  const t = await salon({ hour: 8 });
  const nabil = (await t.engine.run(addClient, { first: 'Nabil', phone: '0644444444', email: 'nabil@exemple.fr', sms: false }, t.asOwner())).id;
  const ilyes = (await t.engine.run(addClient, { first: 'Ilyes', email: 'ilyes@exemple.fr' }, t.asOwner())).id;
  await visit(t, nabil, DAY, 600);
  await visit(t, ilyes, DAY, 660);
  await run(t, DAY, 14);
  const r = msgs(t, 'review');
  assert.deepEqual(r.map((m) => [m.cid, m.channel]), [[ilyes, 'email']]);
  assert.match(r[0].body, /Réponds « stop »/);
  assert.match(r[0].body, /Tu ne veux plus de demande d’avis \?/);
});

test('the cap follows the visit’s quarter: 31 March asked on 1 April counts with 15 March; 2 April is a new quarter', async () => {
  const t = await salon({ day: '2027-03-16', hour: 8 });
  await visit(t, t.ids.yanis, '2027-03-16', 600);
  await run(t, '2027-03-16', 13);
  assert.equal(msgs(t, 'review').length, 1);
  // 31 March, finished at 19:30: asked the next morning, 1 April, in the second quarter by the calendar
  await visit(t, t.ids.yanis, '2027-03-31', 1080, 1170);
  await run(t, '2027-04-01', 8, 5);
  await run(t, '2027-04-01', 12);
  assert.equal(msgs(t, 'review').length, 1, 'same quarter as the visit of mid-March');
  await visit(t, t.ids.yanis, '2027-04-02', 600);
  await run(t, '2027-04-02', 13);
  assert.deepEqual(msgs(t, 'review').map((m) => m.id.split('_').pop()), [quarterOf('2027-03-16'), '2027-2']);
});

test('WhatsApp carries service texts only: the mapping of a review is ignored, and refused when saved', async () => {
  const M = { whatsapp: { enabled: true, templates: { reminder: { id: 13, params: ['heure', 'barbier'] }, review: { id: 14, params: ['prenom', 'avis'] } } } };
  assert.deepEqual(waMapping(M, 'reminder'), { id: 13, params: ['heure', 'barbier'] });
  assert.equal(waMapping(M, 'review'), null);
  assert.equal(waMapping(M, 'rebook'), null);
  const t = await salon();
  const e = await t.engine.run(updateSettings, { messages: { whatsapp: { enabled: true, templates: { rebook: { id: 20, params: ['prenom'] } } } } }, t.asOwner()).catch((x) => x);
  assert.equal(e.status, 400);
  assert.equal(e.message, WA_SMS_ONLY);
  assert.equal(e.message, 'Ce message part par SMS : WhatsApp demande un accord à part du client.');
  // taking one out stays possible (a mapping saved before this rule), and service texts map as before
  await t.engine.run(updateSettings, { messages: { whatsapp: { enabled: true, templates: { review: null, reminder: { id: 13, params: ['heure'] } } } } }, t.asOwner());
  assert.equal(t.engine.state.settings.messages.whatsapp.templates.reminder.id, 13);
});

test('a file imported from WordPress: no review before it was told; its reminder tells it, then the review may go', async () => {
  const t = await salon({ hour: 8 });
  const omar = (await t.engine.run(addClient, { first: 'Omar', phone: '0677777777' }, t.asOwner())).id;
  // WordPress kept his yes to offers: still not told about the new site
  await t.engine.run(setFile, { id: omar, patch: { marketingSrc: 'wordpress', marketing: true } }, t.sys);
  assert.equal(neverInformed(t.engine.state, t.engine.state.clients.get(omar)), true);
  await visit(t, omar, DAY, 600);
  await run(t, DAY, 13);
  assert.equal(msgs(t, 'review').length, 0, 'never told about the new site: no review request');
  // an offer is refused too, whatever its consent says
  const rb = await t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'rb', template: 'rebook', to: '+33677777777', cid: omar, vars: {} }) }) }, {}, t.sys);
  assert.equal(rb.id, null);

  // tomorrow's booking: the reminder, at 18 h, is its first service text and carries the line
  t.clock.now = at(DAY, 14);
  await t.engine.run(A.createAppointment, { clientId: omar, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 1), start: 600 }, t.asOwner());
  await run(t, DAY, 18);
  const [rem] = msgs(t, 'reminder');
  assert.equal(rem.informs, true);
  assert.ok(rem.body.endsWith(' Nouveau site du salon. Tes données : https://salon.test/confidentialite'), rem.body);
  assert.equal(msgs(t, 'review').length, 0, 'queued is not told: it must have left');
  // a second service text the same day does not repeat it
  const again = await t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'x2', template: 'cancelled', to: '+33677777777', cid: omar, vars: {} }) }) }, {}, { ...t.sys, meta: META });
  assert.equal(t.engine.state.messages.get(again.id).informs, undefined);
  const ev = t.engine.journal.find((e) => e.type === 'message.queued' && e.data.id === rem.id);
  assert.equal(ev.data.informs, true);
  t.clock.now = at(DAY, 18, 1);
  await dispatch(rtOf(t, fakeSms()), 20);
  assert.ok(informedAt(t.engine.state, omar) > 0);
  const told = t.engine.journal.filter((e) => e.type === 'client.informed');
  assert.deepEqual(told.map((e) => e.data), [{ cid: omar, msgId: rem.id }]);
  assert.equal(told[0].pii, undefined, 'nothing personal');
  // within the day of the visit: now the request goes
  await run(t, DAY, 18, 5);
  assert.equal(msgs(t, 'review').length, 1);
  // the journal folded again says the same
  const s2 = emptyState();
  for (const e of t.engine.journal) evolve(s2, e);
  assert.equal(informedAt(s2, omar), informedAt(t.engine.state, omar));
  // a file whose consent the client changed himself is told already
  const fares = (await t.engine.run(addClient, { first: 'Farès', phone: '0688888888' }, t.asOwner())).id;
  await t.engine.run(setFile, { id: fares, patch: { marketingSrc: 'wordpress' } }, t.sys);
  await t.engine.run(setFile, { id: fares, patch: { marketing: true, marketingSrc: 'site', marketingAt: t.clock.now } }, t.sys);
  assert.equal(neverInformed(t.engine.state, t.engine.state.clients.get(fares)), false);
  assert.equal(t.engine.verify().ok, true);
});

test('an answer to the salon’s phone names the text it answers; « Merci ! » to a review request is filed by itself', async () => {
  const t = await salon({ hour: 8 });
  await visit(t, t.ids.yanis, DAY, 600);
  await run(t, DAY, 13);
  const [rev] = msgs(t, 'review');
  await t.engine.run(claimMessage, { id: rev.id }, t.sys);
  await t.engine.run(messageResult, { id: rev.id, status: 'sent', providerRef: 'g1', via: 'sms' }, t.sys);
  // the next day
  t.clock.now = at(addDays(DAY, 1), 10);
  const thanks = await t.engine.run(smsReply, { phone: '+33612345678', text: 'Merci ! 🙏', ref: 'e1' }, PROVIDER);
  assert.equal(thanks.handled, true);
  const q = t.engine.state.inquiries.get(thanks.id);
  assert.deepEqual(q.re, { template: 'review', msgId: rev.id });
  assert.equal(q.status, 'handled');
  assert.equal(q.auto, true);
  const ask = await t.engine.run(smsReply, { phone: '+33612345678', text: 'Je peux venir à 15 h ?', ref: 'e2' }, PROVIDER);
  const open = t.engine.state.inquiries.get(ask.id);
  assert.equal(open.re.template, 'review');
  assert.equal(open.status, 'new');
  // no personal data in the chained data: the template and the id of the text only
  const ev = t.engine.journal.find((e) => e.type === 'inquiry.received' && e.data.id === thanks.id);
  assert.deepEqual(ev.data.re, { template: 'review', msgId: rev.id });
  assert.doesNotMatch(JSON.stringify(ev.data), /Merci|612345678/);
  // a stranger, or a text older than a week: no `re`, left open
  t.clock.now = at(addDays(DAY, 9), 10);
  const late = await t.engine.run(smsReply, { phone: '+33612345678', text: 'ok', ref: 'e3' }, PROVIDER);
  assert.equal(t.engine.state.inquiries.get(late.id).re, null);
  assert.equal(t.engine.state.inquiries.get(late.id).status, 'new');
});

test('acknowledgements, and only those; each handled template is in the registry', () => {
  for (const x of ['ok', 'OK !', 'Oki', 'merci', 'Merci beaucoup !!', 'super', 'Top.', 'parfait', 'D’accord', "d'accord", 'daccord', 'Oui', 'ça marche', 'Ca marche !', 'à bientôt', 'A bientot', '👍', '🙏🏽', '!!', 'Ok', 'Merci 😊']) assert.equal(isAck(x), true, x);
  // a few of them in a row are still a thanks
  for (const x of ['Ok merci', 'Super merci !', 'ok, merci à bientôt', 'Merci beaucoup, top 👍']) assert.equal(isAck(x), true, x);
  for (const x of ['Je peux venir à 15 h ?', 'merci, et pour samedi ?', 'oui mais à 11 h', 'Annulez svp', 'ok pour 14h', 'ok merci mais je serai en retard']) assert.equal(isAck(x), false, x);
  assert.deepEqual(Object.keys(REPLY_HANDLERS).sort(), ['receipt', 'reminder', 'review']);
});

test('an imported file stays never told by a sign-in code, by the owner’s switch, and by a text the phone failed later', async () => {
  const t = await salon({ hour: 9 });
  const omar = (await t.engine.run(addClient, { first: 'Omar', phone: '0677777777' }, t.asOwner())).id;
  await t.engine.run(setFile, { id: omar, patch: { source: 'wordpress', marketingSrc: 'wordpress' } }, t.sys);
  const never = () => neverInformed(t.engine.state, t.engine.state.clients.get(omar));
  const q = (m) => t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, m) }) }, {}, { ...t.sys, meta: META });
  // a code whose words are filled as it leaves: the line would be dropped, so it does not claim to tell him
  TEMPLATE_FLAGS.otp = { requested: true };
  FILLERS.otp = () => 'Ton code 123456';
  try {
    const otp = await q({ key: 'otp1', template: 'otp', to: '+33677777777', cid: omar, vars: {}, text: 'code' });
    assert.equal(t.engine.state.messages.get(otp.id).informs, undefined);
    const sms = fakeSms();
    await dispatch(rtOf(t, sms));
    assert.deepEqual(sms.sent.map((x) => x.body), ['Ton code 123456']);
    assert.equal(never(), true, 'a code told him nothing');
  } finally { delete FILLERS.otp; delete TEMPLATE_FLAGS.otp; }
  // the owner turns his offers on, then off, at the counter: that told the client nothing either
  await t.engine.run(updateClient, { id: omar, patch: { marketing: true } }, t.asOwner());
  await t.engine.run(updateClient, { id: omar, patch: { marketing: false } }, t.asOwner());
  assert.equal(t.engine.state.clients.get(omar).marketingSrc, 'salon');
  assert.equal(never(), true);
  // the next service text tells him; the phone takes it (202) and reports later that it failed: not told after all
  const rm = await q({ key: 'rm1', template: 'reminder', to: '+33677777777', cid: omar, vars: {} });
  assert.equal(t.engine.state.messages.get(rm.id).informs, true);
  await t.engine.run(claimMessage, { id: rm.id }, t.sys);
  await t.engine.run(messageResult, { id: rm.id, status: 'sent', providerRef: 'g7', via: 'sms' }, t.sys);
  assert.equal(never(), false);
  await t.engine.run(smsReport, { ref: 'g7', status: 'failed', error: 'RESULT_ERROR_GENERIC_FAILURE' }, PROVIDER);
  assert.equal(t.engine.state.messages.get(rm.id).status, 'failed');
  assert.equal(never(), true, 'the line never arrived');
  assert.equal((await q({ key: 'rv', template: 'review', to: '+33677777777', cid: omar, vars: {} })).id, null);
  // so the next service text carries the line again, and that one counts
  const rm2 = await q({ key: 'rm2', template: 'reminder', to: '+33677777777', cid: omar, vars: {} });
  assert.equal(t.engine.state.messages.get(rm2.id).informs, true);
  await t.engine.run(claimMessage, { id: rm2.id }, t.sys);
  await t.engine.run(messageResult, { id: rm2.id, status: 'sent', providerRef: 'g8', via: 'sms' }, t.sys);
  assert.equal(never(), false);
  // replay says the same
  const s2 = emptyState();
  for (const e of t.engine.journal) evolve(s2, e);
  assert.equal(informedAt(s2, omar), informedAt(t.engine.state, omar));
  assert.equal(t.engine.verify().ok, true);
});

test('the phone’s late failure report of a sign-in code keeps fixed words in the journal', async () => {
  const t = await salon();
  TEMPLATE_FLAGS.otp = { requested: true };
  try {
    const id = (await t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'otp', template: 'otp', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Ton code : 482913' }) }) }, {}, t.sys)).id;
    await t.engine.run(claimMessage, { id }, t.sys);
    await t.engine.run(messageResult, { id, status: 'sent', providerRef: 'g1', via: 'sms' }, t.sys);
    await t.engine.run(smsReport, { ref: 'g1', status: 'failed', error: 'refused: Ton code : 482913' }, PROVIDER);
    const m = t.engine.state.messages.get(id);
    assert.equal(m.status, 'failed');
    assert.match(m.error, /détail masqué/);
    assert.doesNotMatch(JSON.stringify(t.engine.journal.map((e) => e.data)), /482913/);
  } finally { delete TEMPLATE_FLAGS.otp; }
});

test('the owner’s own review test is not held by the quiet hours; a booking keeps a client’s « no texts »', async () => {
  const t = await salon({ hour: 8 });
  t.clock.now = at(DAY, 21);
  const r = await t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, { key: 'rt', template: 'review', to: '+33611111111', vars: { avis: ORIGIN }, owner: true }) }) }, {}, t.sys);
  assert.equal(t.engine.state.messages.get(r.id).dueAt, t.clock.now, 'he pressed the button now');
  // a booking made at the counter for a client whose file says no texts: no confirmation, unless the switch says so
  t.clock.now = at(DAY, 9);
  const nabil = (await t.engine.run(addClient, { first: 'Nabil', phone: '0644444444', sms: false }, t.asOwner())).id;
  const a = await t.engine.run(A.createAppointment, { clientId: nabil, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, t.asOwner());
  assert.equal(t.engine.state.appts.get(a.id).sms, false);
  assert.equal(msgs(t, 'confirmation').filter((m) => m.cid === nabil).length, 0);
  const b = await t.engine.run(A.createAppointment, { clientId: nabil, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 600, sms: true }, t.asOwner());
  assert.equal(t.engine.state.appts.get(b.id).sms, true, 'he asked for it at the counter');
});
