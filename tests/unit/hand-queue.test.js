// « Mode téléphone »: the texts to clients that wait for a person (the Comptoir's Messages screen), the wa.me link each
// one opens, who may send which, the record that it was sent (journaled, once), the clients left out and why, and the
// hold before the switch from WordPress, which keeps these back like every other way of sending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import { addDays, localParts } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import { addClient, updateClient } from '../../server/commands/clients.js';
import { addStaff } from '../../server/commands/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { handSent } from '../../server/commands/messages.js';
import { tick } from '../../server/commands/system.js';
import { startImportRun, finishImportRun, importBatch } from '../../server/commands/import.js';
import { freezeWordpress, markSwitched } from '../../server/commands/bascule.js';
import { tombKeyOf } from '../../server/commands/clients.js';
import { capsOf } from '../../server/domain/permissions.js';
import { cutoverHold } from '../../server/projections/bascule.js';
import { dispatch } from '../../server/http/scheduler.js';
import { waNumber, waMobile, waLink, isMoved, WA_TEMPLATES, waDefaults, waPayload } from '../../server/messaging/whatsapp.js';
import { byHand, effectiveMode, handQueue, handCount, handEligible, handStale } from '../../server/messaging/hand.js';
import { waMode, salonWhatsapp } from '../../server/settings/messages.js';

const ORIGIN = 'https://salon.test';
const LATER = addDays(DAY, 2);
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 'b-' + sent.length }; } }; };
const fakeWa = (fail = '') => { const sent = []; return { name: 'whatsapp', sent, async send(to, msg) { sent.push({ to, msg }); if (fail) throw new Error('WhatsApp : ' + fail); return { ref: 'wa-' + sent.length }; } }; };
const rtOf = (t, x = {}) => ({ engine: t.engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN, sleep: async () => {}, ...x });
const book = (t, x = {}) => t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: LATER, start: 600, first: 'karim', last: 'Benali', phone: '0611223344', ...x }, t.asClient);
const whoOf = (ctx) => ({ caps: ctx.caps, staffId: ctx.staff ? ctx.staff.id : undefined });
const queueOf = (t, rt, ctx = t.asOwner()) => handQueue(t.engine.state, rt, t.clock.now, localParts(t.clock.now), whoOf(ctx));
const msg = (t, id) => t.engine.state.messages.get(id);
const setMode = (t, mode, extra = {}) => t.engine.run(updateSettings, { messages: { whatsapp: { mode, enabled: mode === 'auto', ...extra } } }, t.asOwner());
const runTick = (t) => t.engine.run(tick, {}, { ...t.sys, meta: { linkFor: (a) => ORIGIN + '/r/' + a.code, siteUrl: ORIGIN + '/' } });
const desk = async (t) => {
  const { id } = await t.engine.run(addStaff, { name: 'Inès', role: 'desk' }, t.asOwner());
  const st = t.engine.state.staff.get(id);
  return { actor: { t: 'staff', id }, staff: st, caps: capsOf(st, t.engine.state.settings) };
};

test('the number of a wa.me link: French mobiles in every spelling, +33, foreign numbers, a landline refused', () => {
  // French mobiles: 06 and 07, however typed
  for (const v of ['06 12 34 56 78', '0612345678', '06.12.34.56.78', '+33 6 12 34 56 78', '+33612345678', '0033 6 12 34 56 78', '+33 (0)6 12 34 56 78', '+33 06 12 34 56 78', '33 6 12 34 56 78'.replace(/^/, '+')]) {
    assert.equal(waMobile(v), '33612345678', v);
  }
  assert.equal(waMobile('07 55 44 33 22'), '33755443322');
  // French landlines (01 to 05) and the 09 boxes: no WhatsApp chat to open
  for (const v of ['04 91 00 00 00', '+33 4 91 00 00 00', '01 42 00 00 00', '09 72 00 00 00', '0033 5 56 00 00 00']) assert.equal(waMobile(v), '', v);
  // a number from elsewhere is taken as written, with its country code: Belgium, Switzerland, Morocco, La Réunion
  assert.equal(waMobile('+32 470 12 34 56'), '32470123456');
  assert.equal(waMobile('+41 79 123 45 67'), '41791234567');
  assert.equal(waMobile('00212 6 12 34 56 78'), '212612345678');
  assert.equal(waMobile('+262 692 12 34 56'), '262692123456');
  // not numbers
  for (const v of ['', '12', 'salon', '+0 612345678', '06 12 34', null, undefined]) assert.equal(waMobile(v), '', String(v));
  // waNumber keeps a landline (the salon's own sender number may be one on the API)
  assert.equal(waNumber('+33 4 91 00 00 00'), '33491000000');
  // the link: digits only, no +, the text URL-encoded (faq.whatsapp.com/5913398998672934)
  assert.equal(waLink('06 12 34 56 78', "C'est noté Karim ! Jeu. 5 nov. à 10 h : https://x/r/LA-1?a=1&b=2"), 'https://wa.me/33612345678?text=C\'est%20not%C3%A9%20Karim%20!%20Jeu.%205%20nov.%20%C3%A0%2010%C2%A0h%20%3A%20https%3A%2F%2Fx%2Fr%2FLA-1%3Fa%3D1%26b%3D2'.replace('%C2%A0', '%20'));
  assert.equal(waLink('+33612345678'), 'https://wa.me/33612345678');
  assert.equal(waLink('04 91 00 00 00', 'x'), '', 'no link to a landline');
  assert.doesNotMatch(waLink('+33612345678', 'a\nb #1'), /[\n #]/);
});

test('the four templates for Meta: names, variables in the body’s order, never a variable first or last', () => {
  assert.deepEqual(Object.keys(WA_TEMPLATES), ['confirmation', 'moved', 'reminder', 'cancelled']);
  for (const [k, t] of Object.entries(WA_TEMPLATES)) {
    assert.match(t.name, /^[a-z0-9_]+$/, k);
    assert.equal(t.lang, 'fr');
    const inText = [...t.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    assert.deepEqual(inText, t.params, k + ': the variables, in order');
    assert.doesNotMatch(t.text, /^\s*\{\{|\}\}\s*$/, k + ': Meta refuses a body that starts or ends with a variable');
    assert.doesNotMatch(t.text, /[—–]/, k);
    assert.ok(t.text.length <= 1024, k);
    assert.deepEqual(Object.keys(t.sample).sort(), [...t.params].sort(), k + ': a sample for each variable');
  }
  assert.deepEqual(waDefaults().reminder, { name: 'rdv_rappel', lang: 'fr', params: ['heure', 'barbier', 'lien'] });
  // by position, for a template created with {{1}}, {{2}}
  assert.deepEqual(waPayload('33612345678', { name: 'rdv_rappel', params: [['heure', '10 h'], ['barbier', 'Ali']] }, false).template.components[0].parameters, [{ type: 'text', text: '10 h' }, { type: 'text', text: 'Ali' }]);
  assert.equal(isMoved({ template: 'confirmation', id: 'msg_conf_ap_1_0' }), false);
  assert.equal(isMoved({ template: 'confirmation', id: 'msg_conf_ap_1_2' }), true);
  assert.equal(isMoved({ template: 'reminder', id: 'msg_rem_ap_1_2026-11-05' }), false);
});

test('the mode: SMS by default, the choice saved, the salon’s number kept as a mobile, a landline refused', async () => {
  const t = await salon();
  assert.equal(waMode(t.engine.state.settings.messages), 'sms');
  assert.equal(salonWhatsapp(t.engine.state.settings.messages), '');
  await setMode(t, 'phone', { number: '06 12 34 56 78' });
  assert.equal(waMode(t.engine.state.settings.messages), 'phone');
  assert.equal(t.engine.state.settings.messages.whatsapp.number, '+33612345678');
  assert.equal(salonWhatsapp(t.engine.state.settings.messages), '33612345678');
  await assert.rejects(setMode(t, 'phone', { number: '04 91 00 00 00' }), (e) => e.status === 400 && /portable WhatsApp/.test(e.message));
  await assert.rejects(setMode(t, 'pigeon'), (e) => e.status === 400);
  await setMode(t, 'phone', { number: '' });
  assert.equal(salonWhatsapp(t.engine.state.settings.messages), '');
  // a salon set up before the choice existed: `enabled` alone still means automatic
  assert.equal(waMode({ whatsapp: { enabled: true, templates: {} } }), 'auto');
  assert.equal(waMode({}), 'sms');
  assert.equal(t.engine.verify().ok, true);
});

test('without any provider the texts wait for a person: the queue, the link, « Envoyé » once, journaled', async () => {
  const t = await salon();
  const rt = rtOf(t);
  assert.equal(effectiveMode(t.engine.state, rt), 'phone', 'SMS chosen, no provider: it comes down to the phone');
  await book(t);
  const q = queueOf(t, rt);
  assert.equal(q.items.length, 1);
  const it = q.items[0];
  assert.equal(it.kind, 'Confirmation');
  assert.equal(it.client.name, 'Karim Benali');
  assert.equal(it.appt.barber, 'Ali');
  assert.match(it.text, /^L'Architecte : c'est noté Karim !/);
  assert.equal(it.link, waLink('+33611223344', it.text));
  assert.match(it.link, /^https:\/\/wa\.me\/33611223344\?text=L'Architecte%20%3A%20c'est%20not/);
  assert.equal(handCount(t.engine.state, rt, t.clock.now, localParts(t.clock.now), whoOf(t.asOwner())), 1);
  // nothing leaves by itself
  assert.equal(await dispatch(rt), 0);
  assert.equal(msg(t, it.id).status, 'queued');

  const before = t.engine.journal.length;
  assert.deepEqual(await t.engine.run(handSent, { id: it.id }, t.asOwner()), { ok: true, status: 'sent' });
  const m = msg(t, it.id);
  assert.equal(m.status, 'sent');
  assert.equal(m.via, 'hand');
  assert.equal(m.by, t.ownerId);
  assert.equal(m.sentAt, t.clock.now);
  const ev = t.engine.journal.slice(before);
  assert.deepEqual(ev.map((e) => e.type), ['message.updated']);
  assert.equal(ev[0].actor.id, t.ownerId, 'the journal says who sent it');
  // a second tap changes nothing, and writes nothing
  const n = t.engine.journal.length;
  assert.deepEqual(await t.engine.run(handSent, { id: it.id }, t.asOwner()), { ok: true, already: true, status: 'sent' });
  assert.equal(t.engine.journal.length, n);
  assert.equal(queueOf(t, rt).items.length, 0);
  // the same request played again (a retry on a weak network) is one write
  await book(t, { first: 'Sami', last: 'Roux', phone: '0622334455', start: 660 });
  const [again] = queueOf(t, rt).items;
  const k = t.engine.journal.length;
  await t.engine.run(handSent, { id: again.id }, { ...t.asOwner(), requestId: 'req-hand-00000001' });
  await t.engine.run(handSent, { id: again.id }, { ...t.asOwner(), requestId: 'req-hand-00000001' });
  assert.equal(t.engine.journal.length, k + 1);
  await rejects(t.engine.run(handSent, { id: 'msg_nope' }, t.asOwner()), 'not_found');
  assert.equal(t.engine.verify().ok, true);
});

test('who may send: the owner and the desk everything, a barber his own clients only', async () => {
  const t = await salon();
  const rt = rtOf(t);
  await book(t);
  await book(t, { staffId: t.ids.Ben, first: 'Sami', last: 'Roux', phone: '0622334455' });
  const all = queueOf(t, rt);
  assert.equal(all.items.length, 2);
  const ofAli = all.items.find((x) => x.appt.barber === 'Ali'), ofBen = all.items.find((x) => x.appt.barber === 'Ben');
  // Ali sees and sends his own client's only
  const ali = queueOf(t, rt, t.asStaff('Ali'));
  assert.deepEqual(ali.items.map((x) => x.id), [ofAli.id]);
  assert.equal(handCount(t.engine.state, rt, t.clock.now, localParts(t.clock.now), whoOf(t.asStaff('Ali'))), 1);
  await rejects(t.engine.run(handSent, { id: ofBen.id }, t.asStaff('Ali')), 'forbidden');
  assert.equal(msg(t, ofBen.id).status, 'queued');
  assert.equal((await t.engine.run(handSent, { id: ofAli.id }, t.asStaff('Ali'))).ok, true);
  assert.equal(msg(t, ofAli.id).by, t.ids.Ali);
  // the desk sends for everyone
  const inès = await desk(t);
  assert.deepEqual(queueOf(t, rt, inès).items.map((x) => x.id), [ofBen.id]);
  assert.equal((await t.engine.run(handSent, { id: ofBen.id }, inès)).ok, true);
  // a client, or nobody: never
  await book(t, { first: 'Léo', last: 'Petit', phone: '0633445566', start: 720 });
  const [left] = queueOf(t, rt).items;
  await rejects(t.engine.run(handSent, { id: left.id }, t.asClient), 'forbidden');
  await rejects(t.engine.run(handSent, { id: left.id }, { actor: { t: 'staff', id: 'x' }, caps: new Set() }), 'forbidden');
  // a text that is not a person's to send (an offer, a code the client waits for) is not found here
  assert.equal(handEligible({ channel: 'sms', cid: 'c', template: 'rebook', marketing: true }), false);
  assert.equal(handEligible({ channel: 'sms', cid: 'c', template: 'review' }), false);
  assert.equal(handEligible({ channel: 'sms', cid: 'c', template: 'otp' }), false);
  assert.equal(handEligible({ channel: 'sms', cid: 'c', template: 'memberWelcome' }), false);
  assert.equal(handEligible({ channel: 'email', cid: 'c', template: 'confirmation' }), false);
  assert.equal(handEligible({ channel: 'sms', cid: null, template: 'confirmation' }), false);
});

test('never a client who switched the messages off, nor one without a mobile: counted, with the reason', async () => {
  const t = await salon();
  const rt = rtOf(t);
  const tomorrow = addDays(DAY, 1);
  // Karim takes the messages; Nora said no on the site; Paul gave a landline at the counter; Yanis switches off afterwards
  await book(t, { day: tomorrow });
  await book(t, { day: tomorrow, start: 660, first: 'Nora', last: 'Diaz', phone: '0644556677', sms: false });
  const paul = (await t.engine.run(addClient, { first: 'Paul', last: 'Fixe', phone: '04 91 00 00 00' }, t.asOwner())).id;
  await t.engine.run(A.createAppointment, { clientId: paul, staffId: t.ids.Ali, day: tomorrow, start: 720, serviceIds: [t.ids.cut] }, t.asOwner());
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, staffId: t.ids.Ben, day: tomorrow, start: 600, serviceIds: [t.ids.cut] }, t.asOwner());
  let q = queueOf(t, rt);
  assert.deepEqual(q.items.map((x) => x.client.name).sort(), ['Karim Benali', 'Yanis Martin']);
  assert.deepEqual(q.left, { optout: 1, nomobile: 1 });
  for (const x of q.items) assert.match(x.link, /^https:\/\/wa\.me\/33[67]\d{8}\?text=/);
  // Yanis switches the salon's messages off after his confirmation was written: it leaves the list, and is counted
  const yanisMsg = q.items.find((x) => x.client.name === 'Yanis Martin');
  await t.engine.run(updateClient, { id: t.ids.yanis, patch: { sms: false } }, t.asOwner());
  q = queueOf(t, rt);
  assert.deepEqual(q.items.map((x) => x.client.name), ['Karim Benali']);
  assert.deepEqual(q.left, { optout: 2, nomobile: 1 });
  // and « Envoyé » on a list not refreshed since does not record a send: the message is closed with the reason
  assert.deepEqual(await t.engine.run(handSent, { id: yanisMsg.id }, t.asOwner()), { ok: false, skipped: 'Messages coupés par le client' });
  assert.equal(msg(t, yanisMsg.id).status, 'skipped');
  assert.equal(msg(t, yanisMsg.id).error, 'Messages coupés par le client');
  // a barber's count only covers his own chair
  assert.deepEqual(queueOf(t, rt, t.asStaff('Ben')).left, { optout: 1, nomobile: 0 });
});

test('tomorrow’s reminders arrive at their hour; one set aside is not sent; a past appointment’s text is closed', async () => {
  const t = await salon({ hour: 10 });
  const rt = rtOf(t);
  const tomorrow = addDays(DAY, 1);
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, staffId: t.ids.Ali, day: tomorrow, start: 600, serviceIds: [t.ids.cut] }, t.asOwner());
  const sami = (await t.engine.run(addClient, { first: 'Sami', last: 'Roux', phone: '07 22 33 44 55' }, t.asOwner())).id;
  await t.engine.run(A.createAppointment, { clientId: sami, staffId: t.ids.Ben, day: tomorrow, start: 660, serviceIds: [t.ids.cut] }, t.asOwner());
  // the confirmations of the two bookings, sent by hand in the morning
  for (const x of queueOf(t, rt).items) await t.engine.run(handSent, { id: x.id }, t.asOwner());
  assert.equal(queueOf(t, rt).items.length, 0);
  // 18 h: the reminders of tomorrow
  t.clock.now = at(DAY, 18, 5);
  await runTick(t);
  const q = queueOf(t, rt);
  assert.deepEqual(q.items.map((x) => [x.kind, x.client.name]), [['Rappel', 'Yanis Martin'], ['Rappel', 'Sami Roux']], 'the earliest appointment first');
  assert.match(q.items[0].text, /rappel, demain 10 h avec Ali/);
  // set aside (told at the counter): recorded as not sent
  assert.deepEqual(await t.engine.run(handSent, { id: q.items[1].id, skip: true }, t.asOwner()), { ok: true, status: 'skipped' });
  assert.equal(msg(t, q.items[1].id).error, 'Écarté à la main');
  assert.equal(msg(t, q.items[1].id).via, 'hand');
  // nobody sent Yanis's reminder: once his appointment has started it is no longer listed, and the next tick closes it
  t.clock.now = at(tomorrow, 10, 1);
  assert.equal(handStale(t.engine.state, msg(t, q.items[0].id), t.clock.now), 'Trop tard : le rendez-vous est passé');
  assert.equal(queueOf(t, rt).items.some((x) => x.id === q.items[0].id), false);
  await dispatch(rt);
  assert.equal(msg(t, q.items[0].id).status, 'expired');
  await rejects(t.engine.run(handSent, { id: q.items[0].id }, t.asOwner()), 'gone');
});

test('a move replaces the confirmation still waiting, a cancellation closes what was not sent and adds its own text', async () => {
  const t = await salon();
  const rt = rtOf(t);
  const r = await book(t);
  const first = queueOf(t, rt).items[0];
  await t.engine.run(A.moveAppointment, { id: r.id, day: LATER, start: 720, staffId: t.ids.Ali, notify: true }, t.asOwner());
  let q = queueOf(t, rt);
  assert.deepEqual(q.items.map((x) => x.kind), ['Déplacement'], 'the older confirmation gives way');
  assert.match(q.items[0].text, /12 h avec Ali/);
  assert.equal(handStale(t.engine.state, msg(t, first.id), t.clock.now), 'Remplacé par un message plus récent');
  await t.engine.run(A.cancelAppointment, { id: r.id, reason: 'Fermeture', notify: true }, t.asOwner());
  q = queueOf(t, rt);
  assert.deepEqual(q.items.map((x) => x.kind), ['Annulation']);
  assert.match(q.items[0].text, /est annulé/);
  await dispatch(rt);
  assert.equal(msg(t, first.id).status, 'expired');
});

test('the mode decides who carries a text: phone mode holds it from an SMS provider, automatic takes the mapped ones', async () => {
  // SMS chosen, a provider plugged: nothing for a person, the SMS leaves as before
  const a = await salon();
  await book(a);
  const sms = fakeSms();
  assert.equal(queueOf(a, rtOf(a, { sms })).items.length, 0);
  await dispatch(rtOf(a, { sms }));
  assert.equal(sms.sent.length, 1);

  // phone mode chosen: the provider is left alone for the texts a person sends, and still carries the others
  const b = await salon();
  await setMode(b, 'phone');
  await book(b);
  const sms2 = fakeSms();
  const rt2 = rtOf(b, { sms: sms2 });
  assert.equal(effectiveMode(b.engine.state, rt2), 'phone');
  assert.equal(queueOf(b, rt2).items.length, 1);
  await dispatch(rt2);
  assert.equal(sms2.sent.length, 0, 'no SMS on top of the WhatsApp a person sends');
  assert.equal([...b.engine.state.messages.values()][0].status, 'queued');

  // automatic, plugged, the four templates: the confirmation leaves by Meta; a text without a template (the same-day
  // reminder) waits for a person when no SMS route stands behind
  const c = await salon();
  await setMode(c, 'auto', { templates: waDefaults() });
  await book(c);
  const wa = fakeWa();
  const rt3 = rtOf(c, { whatsapp: wa });
  assert.equal(effectiveMode(c.engine.state, rt3), 'auto');
  assert.equal(queueOf(c, rt3).items.length, 0);
  await dispatch(rt3);
  assert.equal(wa.sent.length, 1);
  assert.deepEqual([wa.sent[0].msg.name, wa.sent[0].msg.lang, wa.sent[0].msg.params.map(([k]) => k)], ['rdv_confirmation', 'fr', ['prenom', 'date', 'heure', 'barbier', 'lien']]);
  assert.equal([...c.engine.state.messages.values()][0].via, 'whatsapp');
  // moved: the other template
  const appt = [...c.engine.state.appts.values()][0];
  await c.engine.run(A.moveAppointment, { id: appt.id, day: LATER, start: 720, staffId: c.ids.Ali, notify: true }, { ...c.asOwner(), meta: { linkFor: (x) => ORIGIN + '/r/' + x.code } });
  await dispatch(rt3);
  assert.equal(wa.sent.length, 2);
  assert.equal(wa.sent[1].msg.name, 'rdv_deplace');

  // automatic chosen but not plugged in (no token): the phone mode stands in, even with an SMS provider there
  const d = await salon();
  await setMode(d, 'auto', { templates: waDefaults() });
  await book(d);
  const sms4 = fakeSms();
  const rt4 = rtOf(d, { sms: sms4 });
  assert.equal(effectiveMode(d.engine.state, rt4), 'phone');
  assert.equal(queueOf(d, rt4).items.length, 1);
  await dispatch(rt4);
  assert.equal(sms4.sent.length, 0);

  // automatic, Meta refuses, no SMS behind: back to a person, with Meta's reason on the card
  const e = await salon();
  await setMode(e, 'auto', { templates: waDefaults() });
  await book(e);
  const rt5 = rtOf(e, { whatsapp: fakeWa('modèle introuvable ou pas encore approuvé dans cette langue (Meta 132001, modèle rdv_confirmation)') });
  await dispatch(rt5);
  const [back] = queueOf(e, rt5).items;
  assert.ok(back, 'handed back');
  assert.match(back.error, /Meta 132001/);
  assert.equal(byHand(e.engine.state, rt5, msg(e, back.id)), true);
  assert.equal((await e.engine.run(handSent, { id: back.id }, e.asOwner())).ok, true);
  assert.equal(msg(e, back.id).via, 'hand');
});

test('nothing leaves before the switch from WordPress: held in every mode, by hand too', async () => {
  const t = await salon();
  const as = { ...t.asOwner(), meta: { tombKey: tombKeyOf('test-secret-0123456789') } };
  const tomorrow = addDays(DAY, 1);
  const run = async (appts) => {
    const { id } = await t.engine.run(startImportRun, {
      source: 'files', files: [{ name: 'export.csv', kind: 'bookings', rows: Math.max(1, appts.length), sha: '0123456789abcdef' }], window: [], map: { services: {}, staff: {} },
      totals: { bookings: appts.length, clients: appts.length, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 }
    }, as);
    if (appts.length) await t.engine.run(importBatch, { appts, run: id, i: 0 }, as);
    await t.engine.run(finishImportRun, { id }, as);
  };
  await run([{ wp: 5001, day: tomorrow, start: 600, first: 'Nadia', last: 'Roux', phone: '06 98 76 54 32', serviceIds: [t.ids.cut], staffId: t.ids.Ali, status: 'confirmed' }]);
  await setMode(t, 'phone');
  t.clock.now = at(DAY, 19, 0);
  await runTick(t);
  const rem = [...t.engine.state.messages.values()].find((m) => m.template === 'reminder' && m.cid);
  assert.ok(rem, 'the reminder of the imported booking is written');
  assert.equal(cutoverHold(t.engine.state), true);
  const rt = rtOf(t);
  // the screen lists nothing to send, says how many wait, and the menu shows no number
  let q = queueOf(t, rt);
  assert.equal(q.items.length, 0);
  assert.equal(q.held, 1);
  assert.equal(handCount(t.engine.state, rt, t.clock.now, localParts(t.clock.now), whoOf(t.asOwner())), 0);
  // « Envoyé » on a stale screen is refused, and nothing is written
  const n = t.engine.journal.length;
  const e = await rejects(t.engine.run(handSent, { id: rem.id }, t.asOwner()), 'held');
  assert.match(e.message, /attendent la bascule/);
  assert.equal(t.engine.journal.length, n);
  // no way of sending takes it: SMS, WhatsApp API, or the dispatch's own housekeeping
  const sms = fakeSms(), wa = fakeWa();
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  await setMode(t, 'auto', { templates: waDefaults() });
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  await setMode(t, 'sms');
  await dispatch(rtOf(t, { sms, whatsapp: wa }));
  assert.equal(sms.sent.length + wa.sent.length, 0);
  assert.equal(msg(t, rem.id).status, 'queued');
  // the switch: it comes to the person's list
  await setMode(t, 'phone');
  await t.engine.run(freezeWordpress, {}, as);
  t.clock.now += 5 * 60000;
  await run([]);
  await t.engine.run(markSwitched, {}, as);
  assert.equal(cutoverHold(t.engine.state), false);
  q = queueOf(t, rt);
  assert.equal(q.held, 0);
  assert.ok(q.items.some((x) => x.id === rem.id) || msg(t, rem.id).status !== 'queued', 'listed after the switch, unless the bascule closed it as already reminded there');
});

test('the evening: the summary says « à envoyer depuis l’écran Messages » with its link; at 21 h one notice if nobody sent them', async () => {
  const { alertWarnings, handLateMin, HAND_LATE_MIN } = await import('../../server/commands/steps/alerts.js');
  const t = await salon({ hour: 10 });
  const rt = rtOf(t);
  await setMode(t, 'phone');
  await t.engine.run(updateSettings, { notify: { evening: '20:00', alerts: true } }, t.asOwner());
  const tomorrow = addDays(DAY, 1);
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, staffId: t.ids.Ali, day: tomorrow, start: 600, serviceIds: [t.ids.cut] }, t.asOwner());
  const hand = (m) => byHand(t.engine.state, rt, m);
  const meta = (x = {}) => ({ linkFor: (a) => ORIGIN + '/r/' + a.code, siteUrl: ORIGIN + '/', providers: { sms: false, email: true, hand }, health: { providers: { sms: false, email: true, byHand: hand }, backup: null }, ...x });
  const tickAt = (h, m = 0) => { t.clock.now = at(DAY, h, m); return t.engine.run(tick, {}, { ...t.sys, meta: meta() }); };
  // 18 h: tomorrow's reminder joins the confirmation nobody sent
  await tickAt(18, 5);
  assert.deepEqual(queueOf(t, rt).items.map((x) => x.kind), ['Confirmation', 'Rappel']);
  // 20 h: the summary counts them apart from what waits for a provider, with the screen's address
  await tickAt(20, 0);
  const d = t.engine.state.messages.get('msg_digest_' + DAY);
  assert.ok(d, 'the summary');
  assert.match(d.body, /· 2 messages aux clients à envoyer depuis l’écran Messages : https:\/\/salon\.test\/comptoir\/messages/);
  assert.doesNotMatch(d.body, /en attente d’un fournisseur/, 'they wait for a person, not for a provider');
  assert.ok(d.mail.links.includes(ORIGIN + '/comptoir/messages'), 'a link in the HTML version');
  // before 21 h: no notice yet
  assert.equal(HAND_LATE_MIN, 21 * 60);
  assert.equal(handLateMin(t.engine.state), 21 * 60, '18 h reminders: 21 h');
  await tickAt(20, 59);
  assert.equal(t.engine.state.messages.get('msg_alert_hand_' + DAY), undefined);
  // 21 h, still nobody: one notice, by e-mail and in the Comptoir, whatever the ticks after
  await tickAt(21, 0);
  await tickAt(21, 30);
  // (this test never dispatches, so the scheduler's own silence alert may stand beside it: only the notice is read here)
  const n = [...t.engine.state.messages.values()].filter((m) => m.id.startsWith('msg_alert_hand_'));
  assert.equal(n.length, 1);
  assert.equal(n[0].template, 'owner_alert');
  assert.equal(n[0].to, 'patron@test.fr');
  assert.match(n[0].mail.subject, /rappels de demain/);
  assert.match(n[0].body, /2 messages aux clients attendent encore sur l’écran Messages, dont 1 rappel pour demain/);
  const line = () => alertWarnings(t.engine.state, DAY).filter((w) => /écran Messages/.test(w));
  assert.equal(line().length, 1);
  // sent from WhatsApp: the line leaves the Comptoir
  for (const x of queueOf(t, rt).items) await t.engine.run(handSent, { id: x.id }, t.asOwner());
  assert.deepEqual(line(), []);
  // a reminder hour of 21 h: the notice waits until 23 h
  await t.engine.run(updateSettings, { messages: { reminderHour: 21 } }, t.asOwner());
  assert.equal(handLateMin(t.engine.state), 23 * 60);
  // an SMS provider in SMS mode: nothing waits for a person, no notice
  const u = await salon({ hour: 10 });
  await u.engine.run(updateSettings, { notify: { alerts: true } }, u.asOwner());
  await u.engine.run(A.createAppointment, { clientId: u.ids.yanis, staffId: u.ids.Ali, day: tomorrow, start: 600, serviceIds: [u.ids.cut] }, u.asOwner());
  const urt = rtOf(u, { sms: fakeSms() });
  u.clock.now = at(DAY, 21, 5);
  await u.engine.run(tick, {}, { ...u.sys, meta: { siteUrl: ORIGIN + '/', health: { providers: { sms: true, email: true, byHand: (m) => byHand(u.engine.state, urt, m) }, backup: null } } });
  assert.equal(u.engine.state.messages.get('msg_alert_hand_' + DAY), undefined);
});
