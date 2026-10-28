// PAY-04 · The client side of the membership: a covered cut books with no deposit only on the member page's verified
// path (never a typed phone), the member's own routes under the client session (/api/me/membership*), the
// acknowledgement he downloads and its e-mail retried until it leaves, the CGV's membership section shown only while
// the membership is sold online, and the guide steps that point at real parts of the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { instantOf, addDays, localParts } from '../../shared/dates.js';
import { initialize } from '../../server/commands/setup.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { checkout } from '../../server/commands/sales.js';
import * as A from '../../server/commands/agenda.js';
import { startMembership, memberPaid, memberFailed, requestCancel } from '../../server/commands/memberships.js';
import { addMonths, memberOf } from '../../server/domain/membership.js';
import { depositFor, memberCovers } from '../../server/domain/policy.js';
import { memberToken, readMemberToken, MEMBER_BOOK } from '../../server/auth/member-token.js';
import { CGV_TEXT } from '../../server/settings/shop.js';
import { otpCode } from '../../server/domain/otp.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { dispatch } from '../../server/http/scheduler.js';
import { browser, testRuntime } from '../api/client.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const DAY = '2026-11-03'; // a Tuesday
const SECRET = 'test-secret-0123456789';
const ORIGIN = 'https://salon.test';
const at = (day, h = 10, m = 0) => instantOf(day, h * 60 + m);
const SYS = { actor: { t: 'system', id: 'memberships' }, caps: new Set(), meta: { siteUrl: ORIGIN + '/' } };
const STRIPE = { actor: { t: 'provider', id: 'stripe' }, caps: new Set(), meta: { siteUrl: ORIGIN + '/' } };
const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');

/** A production salon: a barber, three cuts, both plans, deposits on every online booking (30 %), client spaces on. */
async function club() {
  const clock = { now: at(DAY) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET }, clock: () => clock.now, store: memoryStore() });
  const e = rt.engine;
  const init = await e.run(initialize, { mode: 'production', owner: { name: 'Patron', email: 'patron@test.fr' } }, { actor: { t: 'system', id: 'setup' }, caps: new Set() });
  const owner = () => { const st = e.state.staff.get(init.ownerId); return { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, e.state.settings), meta: { siteUrl: ORIGIN + '/' } }; };
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ali = (await e.run(addStaff, { name: 'Ali', role: 'barber', schedule: week }, owner())).id;
  const svc = async (x) => (await e.run(addService, x, owner())).id;
  const ids = { ali, cut: await svc({ name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }), contour: await svc({ name: 'Coupe + contour', category: 'Coupes', price: 2500, dur: 30 }), beard: await svc({ name: 'Coupe + taille', category: 'Coupes', price: 3000, dur: 30 }) };
  await e.run(updateSettings, { deposits: { mode: 'all', percent: 30 }, accounts: { enabled: true }, membership: { enabled: true, plans: [
    { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [ids.cut] },
    { id: 'illimite', name: 'Illimité', price: 4900, cuts: 0, serviceIds: [ids.cut, ids.contour] }
  ] } }, owner());
  let n = 0;
  const join = async (planId, phone, o = {}) => {
    n++;
    const day = localParts(clock.now).day;
    const m = await e.run(startMembership, { planId, first: o.first || 'Karim', phone, email: o.email || 'karim' + n + '@exemple.fr', provider: 'stripe', providerRef: 'cs_' + n, channel: 'online' }, SYS);
    await e.run(memberPaid, { ref: 'cs_' + n, invoice: 'in_' + n + '_0', amount: e.state.settings.membership.plans.find((p) => p.id === planId).price, periodStart: day, periodEnd: addMonths(day, 1), chargeRef: 'ch_' + n + '_0', customer: 'cus_' + n, subscription: 'sub_' + n, card: 'Visa •• 4242' }, STRIPE);
    return e.state.members.get(m.id);
  };
  const go = (day, h = 10) => { clock.now = at(day, h); };
  return { rt, e, clock, go, ids, owner, join, s: () => e.state };
}
const services = (t, ...ids) => ids.map((id) => ({ id, price: t.s().services.get(id).price }));
const upcoming = (days, id) => days.map((day) => ({ day, services: [{ id }] }));

test('depositFor: none for a covered cut of a live member, the usual one for a service the plan leaves out or past the grace', async () => {
  const t = await club();
  const m = await t.join('essentiel', '06 11 22 33 01');
  const cut = services(t, t.ids.cut), beard = services(t, t.ids.beard);
  assert.equal(depositFor(t.s(), cut, {}), 600, 'the salon’s rule: 30 % of 20 €');
  assert.equal(depositFor(t.s(), cut, { member: m, day: DAY }), 0);
  assert.equal(depositFor(t.s(), beard, { member: m, day: DAY }), 900, 'not in the plan: the usual deposit');
  assert.deepEqual(memberCovers(t.s(), m, cut, DAY), { ok: true, used: 1, of: 2 });
  // the bookings to come count as taken: two already in the month leave the third at the usual deposit
  assert.deepEqual(memberCovers(t.s(), m, cut, addDays(DAY, 9), upcoming([addDays(DAY, 2)], t.ids.cut)), { ok: true, used: 2, of: 2 });
  assert.equal(depositFor(t.s(), cut, { member: m, day: addDays(DAY, 9), upcoming: upcoming([addDays(DAY, 2), addDays(DAY, 5)], t.ids.cut) }), 600);
  // a booking beyond the paid month is not covered yet (the renewal is not paid)
  assert.equal(memberCovers(t.s(), m, cut, addDays(DAY, 40)).ok, false);
  // a refused renewal: covered during the grace, not after it
  await t.e.run(memberFailed, { id: m.id, invoice: 'in_1_1', attempt: 1 }, STRIPE);
  t.go('2026-12-05');
  assert.equal(depositFor(t.s(), cut, { member: t.s().members.get(m.id), day: '2026-12-05' }), 0, 'in the grace');
  t.go('2026-12-12');
  assert.equal(depositFor(t.s(), cut, { member: t.s().members.get(m.id), day: '2026-12-12' }), 600, 'past due beyond the grace');
});

test('an illimité keeps its days between cuts from the bookings to come too', async () => {
  const t = await club();
  const m = await t.join('illimite', '06 11 22 33 02');
  const cut = services(t, t.ids.cut);
  const next = upcoming([addDays(DAY, 2)], t.ids.cut);
  assert.equal(memberCovers(t.s(), m, cut, addDays(DAY, 5), next).ok, false, '3 days after a booked cut');
  assert.equal(memberCovers(t.s(), m, cut, addDays(DAY, 9), next).ok, true, '7 days after it');
  assert.equal(memberCovers(t.s(), m, services(t, t.ids.cut, t.ids.contour), DAY).ok, false, 'two cuts in one booking');
  assert.equal(memberCovers(t.s(), m, cut, DAY).used, 1);
});

test('bookOnline: the member words and no deposit only on the verified path, on the member’s own file', async () => {
  const t = await club();
  const phone = '06 11 22 33 03';
  const m = await t.join('essentiel', phone, { first: 'Karim' });
  const other = await t.join('essentiel', '06 11 22 33 04', { first: 'Sami' });
  const ctx = (memberId) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { payLive: true, linkFor: () => ORIGIN + '/r/x', ...(memberId ? { memberId } : {}) } });
  const book = (start, memberId, p = phone, svc = t.ids.cut) => t.e.run(A.bookOnline, { serviceIds: [svc], staffId: t.ids.ali, day: addDays(DAY, 1), start, first: 'Karim', phone: p }, ctx(memberId));
  const covered = await book(600, m.id);
  assert.deepEqual([covered.status, covered.deposit, covered.member], ['booked', 0, { covered: true, label: 'Inclus dans ton abonnement · 1/2 ce mois' }]);
  // a guest typing the member's number: the usual deposit, no member words (the till still applies the membership)
  const guest = await book(660);
  assert.deepEqual([guest.status, guest.deposit, guest.member], ['pending', 600, undefined]);
  // another member's link on this number counts for nothing
  const wrong = await book(720, other.id);
  assert.deepEqual([wrong.deposit, wrong.member], [600, undefined]);
  // a service the plan leaves out pays the usual deposit; the second covered booking of the month says 2/2; a third
  // one, while two wait, is not covered
  const p2 = '06 11 22 33 14';
  const m2 = await t.join('essentiel', p2, { first: 'Nora' });
  const p3 = '06 11 22 33 15';
  assert.equal((await book(780, (await t.join('essentiel', p3, { first: 'Karim' })).id, p3, t.ids.beard)).deposit, 900);
  const own = (day) => t.e.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.ali, day, start: 600, first: 'Nora', phone: p2 }, ctx(m2.id));
  assert.equal((await own(addDays(DAY, 3))).member.label, 'Inclus dans ton abonnement · 1/2 ce mois');
  assert.equal((await own(addDays(DAY, 4))).member.label, 'Inclus dans ton abonnement · 2/2 ce mois');
  const third = await t.e.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.ali, day: addDays(DAY, 4), start: 660, first: 'Nora', phone: p2 }, ctx(m2.id));
  assert.deepEqual([third.deposit, third.member], [600, undefined]);
});

test('the site’s booking carries the member page’s booking link (mbr); a forged, expired or cancelling one is ignored', async () => {
  const clock = { now: instantOf('2026-11-24', 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const owner = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  await rt.engine.run(updateSettings, { deposits: { mode: 'all', percent: 30 } }, { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, rt.engine.state.settings), meta: {} });
  const site = browser(rt);
  const phone = '06 00 00 41 41';
  const sub = await site.post('/api/public/memberships', { planId: 'essentiel', first: 'Démo', phone, email: 'demo+41@exemple.fr', startNow: true, cgv: CGV_TEXT });
  assert.equal(sub.status, 201, sub.text);
  const id = sub.json.url.split('/paiement/')[1].split('?')[0];
  assert.equal((await site.post('/api/public/payments/' + id + '/simulate', { outcome: 'ok' })).json.status, 'paid');
  const token = sub.json.page.split('/abo/')[1];
  const page = (await site.get('/api/public/memberships/' + token)).json;
  assert.deepEqual([page.status, page.used, page.of, page.nextCut], ['active', 0, 2, '2026-11-24']);
  const cut = page.plan.services[0];
  const day = '2026-11-26';
  const slots = (await site.get('/api/public/availability?from=' + day + '&days=1&services=' + cut.id)).json.days[0].slots;
  const book = (slot, mbr) => site.post('/api/public/bookings', { serviceIds: [cut.id], staffId: slot.s, day, start: slot.m, first: 'Démo', phone, ...(mbr ? { mbr } : {}) });
  // « Réserver ma coupe » carries a link that books and does nothing else: it never cancels, withdraws or changes the card
  assert.ok(page.book && page.book !== token);
  for (const act of ['cancel', 'withdraw', 'card']) assert.equal((await site.post('/api/public/memberships/' + page.book + '/' + act, {})).status, 404, act);
  assert.equal((await site.get('/api/public/memberships/' + page.book)).status, 404);
  const ok = await book(slots[0], page.book);
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual([ok.json.status, ok.json.deposit, ok.json.payment, ok.json.member], ['booked', 0, null, { covered: true, label: 'Inclus dans ton abonnement · 1/2 ce mois' }]);
  const forged = await book(slots[1], page.book.slice(0, -2) + (page.book.endsWith('aa') ? 'bb' : 'aa'));
  assert.equal(forged.status, 201, forged.text);
  assert.equal(forged.json.member, undefined);
  assert.ok(forged.json.deposit > 0, 'the usual deposit');
  const expired = memberToken(rt.secret, id, clock.now - 1000, MEMBER_BOOK);
  const late = await book(slots[2], expired);
  assert.equal(late.json.member, undefined);
  // the page's own link (it cancels) is not a booking's, nor the other way round
  assert.deepEqual(readMemberToken(rt.secret, token, clock.now, MEMBER_BOOK), { error: 'invalid' });
  assert.deepEqual(readMemberToken(rt.secret, page.book, clock.now), { error: 'invalid' });
});

/** A client's space on this file: the code by SMS (read from the outbox), then the first name. */
async function signIn(rt, cid) {
  const b = browser(rt);
  const c = rt.engine.state.clients.get(cid);
  await b.post('/api/public/account/start', { phone: c.phone });
  await settled();
  const msg = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === cid).at(-1);
  const r = await b.post('/api/public/account/verify', { phone: c.phone, code: otpCode(rt.secret, msg.id), first: c.first });
  assert.equal(r.status, 200, r.text);
  return b;
}

test('/api/me/membership: the session’s own member, cancelled from the space, its acknowledgement to download', async () => {
  const t = await club();
  const m = await t.join('essentiel', '06 11 22 33 05', { first: 'Karim', email: 'karim@exemple.fr' });
  const other = await t.join('essentiel', '06 11 22 33 06', { first: 'Sami' });
  assert.equal((await browser(t.rt).get('/api/me/membership')).status, 401, 'no session, nothing');
  const b = await signIn(t.rt, m.cid);
  const page = (await b.get('/api/me/membership')).json;
  assert.deepEqual([page.member.id, page.member.status, page.member.used, page.member.of, page.member.card], [m.id, 'active', 0, 2, 'Visa •• 4242']);
  assert.ok(page.member.book && page.member.book.startsWith(m.id + '~'), 'a signed link for « Réserver ma coupe »');
  // nothing the space answers (the demo's persona shares this answer with every visitor) cancels at the token routes
  const strings = JSON.stringify(page).match(/"[^"]{20,}"/g) || [];
  for (const x of strings) assert.notEqual((await browser(t.rt).post('/api/public/memberships/' + encodeURIComponent(x.slice(1, -1)) + '/cancel', {})).status, 200, x);
  assert.equal(t.s().members.get(m.id).cancel, null);
  assert.ok(!JSON.stringify(page).includes('06 11'), 'no number in the page');
  // a member id in the body names nothing: the session's file decides
  t.go(addDays(DAY, 7));
  const cx = await b.post('/api/me/membership/cancel', { id: other.id, reason: 'Je déménage' }, { 'x-request-id': 'cancel-me-0001' });
  assert.equal(cx.status, 200, cx.text);
  assert.deepEqual([cx.json.cancelled.effective, cx.json.cancelled.last, cx.json.member.status], ['2026-12-03', '2026-12-02', 'ending']);
  assert.equal(t.s().members.get(other.id).cancel, null, 'the other member is untouched');
  const c = t.s().members.get(m.id).cancel;
  assert.deepEqual([c.by, c.channel, c.reason], ['client', 'moi', 'Je déménage']);
  assert.ok(t.s().messages.has('msg_mcxm_' + m.id) && t.s().messages.has('msg_mcx_' + m.id), 'acknowledged by e-mail and SMS');
  // the acknowledgement, from the space and from the member page's link
  const ack = await b.get('/api/me/membership/ack/cancel');
  assert.equal(ack.status, 200);
  assert.match(ack.headers.get('content-type'), /^text\/html/);
  assert.match(ack.headers.get('content-disposition'), /attachment; filename="confirmation-resiliation.html"/);
  assert.match(ack.text, /Résiliation reçue le 10 novembre 2026 à 10\sh\./);
  assert.match(ack.text, /prend fin le 2 décembre 2026 au soir/);
  assert.match(ack.text, /tes coupes restent incluses : 2 coupes par mois \(Coupe classique\)/);
  const token = memberToken(SECRET, m.id, t.clock.now + 3600000);
  assert.equal((await browser(t.rt).get('/api/public/memberships/' + token + '/ack/cancel')).text, ack.text);
  assert.equal((await browser(t.rt).get('/api/public/memberships/' + token + '/ack/withdraw')).status, 404, 'never withdrawn');
  assert.equal((await browser(t.rt).get('/api/public/memberships/' + token.slice(0, -3) + 'xyz/ack/cancel')).status, 404);
  assert.equal((await browser(t.rt).get('/api/public/memberships/' + memberToken(SECRET, m.id, t.clock.now - 1) + '/ack/cancel')).status, 410);
  // a name with markup stays text in the file
  assert.ok(!/<script/i.test(ack.text));
});

test('/api/me/membership/withdraw within 14 days: the month less the cut taken; refused after', async () => {
  const t = await club();
  const m = await t.join('essentiel', '06 11 22 33 07', { first: 'Inès' });
  await t.e.run(checkout, { clientId: m.cid, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.ali, memberId: m.id }], payments: [{ method: 'card', amount: 0 }] }, t.owner());
  const b = await signIn(t.rt, m.cid);
  const page = (await b.get('/api/me/membership')).json.member;
  assert.deepEqual(page.withdraw, { until: '2026-11-17', refund: 1700, used: 1 });
  const late = await club();
  const n = await late.join('essentiel', '06 11 22 33 08', { first: 'Hugo' });
  const lb = await signIn(late.rt, n.cid);
  late.go(addDays(DAY, 15));
  const no = await lb.post('/api/me/membership/withdraw', {});
  assert.deepEqual([no.status, no.json.error.code], [409, 'late']);
  t.go(addDays(DAY, 1));
  const wd = await b.post('/api/me/membership/withdraw', {});
  assert.equal(wd.status, 200, wd.text);
  assert.deepEqual([wd.json.withdrawn.refund, wd.json.member.status, wd.json.member.withdrawn.refund], [1700, 'ended', 1700]);
  // still readable by its member afterwards: « rétracté », and the acknowledgement
  const after = (await b.get('/api/me/membership')).json.member;
  assert.deepEqual([after.status, after.actions], ['ended', { cancel: false, withdraw: false, card: false }]);
  assert.match((await b.get('/api/me/membership/ack/withdraw')).text, /Remboursement : 17\s€ sous 14 jours/);
});

test('the e-mail provider down for 8 hours, then up: the acknowledgement leaves, and the page says when', async () => {
  const t = await club();
  const m = await t.join('essentiel', '06 11 22 33 09', { first: 'Karim', email: 'karim@exemple.fr' });
  const sms = { name: 'brevo', sent: [], async send(to, body) { this.sent.push({ to, body }); return { ref: 's' + this.sent.length }; } };
  const down = { name: 'brevo', async send() { throw Object.assign(new Error('Brevo 503'), { status: 503 }); } };
  const mails = [];
  const up = { name: 'brevo', async send(x) { mails.push(x); return { ref: 'm' + mails.length }; } };
  const rtOf = (email) => ({ engine: t.e, sms, email, whatsapp: null, cfg: { cronSecret: '' }, origin: ORIGIN, sleep: async () => {} });
  // the welcome leaves first, then the cancellation is asked from the member's link
  await dispatch(rtOf(up), 50);
  const self = { actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { siteUrl: ORIGIN + '/', memberId: m.id } };
  await t.e.run(requestCancel, { id: m.id, by: 'client', channel: 'site' }, self);
  const token = memberToken(SECRET, m.id, t.clock.now + 7 * 86400000);
  const ackOf = async () => (await browser(t.rt).get('/api/public/memberships/' + token)).json.acks.find((a) => a.kind === 'cancel');
  await dispatch(rtOf(down), 50);
  assert.equal(t.s().messages.get('msg_mcxm_' + m.id).status, 'queued', 'legal: back in the queue');
  assert.deepEqual([(await ackOf()).sent], [false], '« Envoi en cours »');
  // the file to keep never claims a send that has not happened
  const file = async () => (await browser(t.rt).get('/api/public/memberships/' + token + '/ack/cancel')).text;
  assert.match(await file(), /Son envoi par message est en cours\./);
  // the scheduler ticks every half hour: down for 8 hours, then up; the retries never give it up
  const down8 = t.clock.now + 8 * 3600000;
  while (t.clock.now < down8) { t.clock.now += 1800000; await dispatch(rtOf(down), 50); }
  assert.equal(t.s().messages.get('msg_mcxm_' + m.id).status, 'queued', 'still owed after 8 hours');
  for (let i = 0; i < 14 && t.s().messages.get('msg_mcxm_' + m.id).status !== 'sent'; i++) { t.clock.now += 1800000; await dispatch(rtOf(up), 50); }
  assert.equal(t.s().messages.get('msg_mcxm_' + m.id).status, 'sent', 'sent once the provider is back');
  assert.ok(mails.some((x) => x.to === 'karim@exemple.fr' && /Résiliation/.test(x.subject)));
  const ack = await ackOf();
  assert.equal(ack.sent, true);
  assert.ok(ack.sentAt >= down8, '« Confirmation envoyée le … » says when it really left');
  assert.match(await file(), /Il t’a aussi été envoyé le 3 novembre 2026 à 2\d\sh/);
});

/** A visitor subscribes on the demo's site and goes through the test checkout: the member and his page's link. */
async function siteMember(startNow) {
  const clock = { now: instantOf('2026-11-24', 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  const sub = await site.post('/api/public/memberships', { planId: 'essentiel', first: 'Démo', phone: '06 00 12 34 56', email: 'demo+123456@exemple.fr', startNow, cgv: CGV_TEXT });
  assert.equal(sub.status, 201, sub.text);
  const id = sub.json.url.split('/paiement/')[1].split('?')[0];
  assert.equal((await site.post('/api/public/payments/' + id + '/simulate', { outcome: 'ok' })).json.status, startNow ? 'paid' : 'scheduled');
  return { rt, clock, site, id, token: sub.json.page.split('/abo/')[1] };
}

test('the welcome e-mail’s « Renoncer au contrat ici » still opens the page on the 13th day (texts’ links live a week)', async () => {
  const t = await siteMember(true);
  const mail = t.rt.engine.state.messages.get('msg_mwelm_' + t.id);
  const line = mail.body.split('\n').find((x) => x.startsWith('Renoncer au contrat ici'));
  assert.match(line, /jusqu’au 8 décembre/);
  const renounce = /\/abo\/([^\s?]+)\?renoncer/.exec(line)[1];
  t.clock.now += 13 * 86400000;
  const page = await t.site.get('/api/public/memberships/' + renounce);
  assert.equal(page.status, 200, page.text);
  assert.equal(page.json.actions.withdraw, true, 'the withdrawal is still open, and so is its link');
  // the welcome SMS keeps the usual week
  const sms = t.rt.engine.state.messages.get('msg_mwel_' + t.id);
  const smsToken = /\/abo\/([^\s?]+)/.exec(sms.body)[1];
  assert.equal((await t.site.get('/api/public/memberships/' + smsToken)).status, 410);
});

test('a start called off before it began: the cancel acknowledgement shows on the page, its file says it never began', async () => {
  const t = await siteMember(false);
  const before = (await t.site.get('/api/public/memberships/' + t.token)).json;
  assert.deepEqual([before.status, before.actions.cancel, before.actions.withdraw, before.book], ['pending', true, false, null]);
  const cx = await t.site.post('/api/public/memberships/' + t.token + '/cancel', {});
  assert.equal(cx.status, 200, cx.text);
  const ack = cx.json.member.acks.find((a) => a.kind === 'cancel');
  assert.ok(ack, 'the call-off’s e-mail stands for its acknowledgement');
  assert.equal(t.rt.engine.state.messages.get('msg_mschx_' + t.id).channel, 'email');
  const file = await t.site.get('/api/public/memberships/' + t.token + '/ack/cancel');
  assert.equal(file.status, 200, file.text);
  assert.match(file.text, /Ton abonnement Essentiel ne commencera pas : rien n’est prélevé\./);
});

test('/api/public/memberships says whether the CGV keep the membership’s clauses (terms): on, or a contract running', async () => {
  const t = await club();
  const site = browser(t.rt);
  assert.equal((await site.get('/api/public/memberships')).json.terms, true);
  await t.join('essentiel', '06 11 22 33 21');
  await t.e.run(updateSettings, { membership: { enabled: false } }, t.owner());
  const j = (await site.get('/api/public/memberships')).json;
  assert.deepEqual([j.live, j.terms], [false, true], 'sales stopped, a member still runs');
});

test('a signed-in client subscribes on his own file, whatever number is typed', async () => {
  const clock = { now: instantOf('2026-11-24', 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  // a visitor's booking makes his file; he opens his space on it
  const svc = [...rt.engine.state.services.values()].find((x) => x.slug === 'cl');
  const slot = (await site.get('/api/public/availability?from=2026-11-26&days=1&services=' + svc.id)).json.days[0].slots[0];
  const bk = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: slot.s, day: '2026-11-26', start: slot.m, first: 'Yanis', phone: '06 00 00 52 52' });
  assert.equal(bk.status, 201, bk.text);
  const cid = rt.engine.state.clients.get(rt.engine.state.clientByPhone.get('+33600005252')).id;
  const b = await signIn(rt, cid);
  const sub = await b.post('/api/public/memberships', { planId: 'essentiel', first: 'Yanis', phone: '06 99 99 99 99', email: 'yanis@exemple.fr', startNow: true });
  assert.equal(sub.status, 201, sub.text);
  const m = memberOf(rt.engine.state, cid);
  assert.ok(m, 'the membership is on the session’s file');
  assert.equal(rt.engine.state.clientByPhone.get('+33699999999'), undefined, 'no file made for the typed number');
});

/* ---------------- the pages ---------------- */

/** public/pages.js on a fake page holding the CGV's membership section, with the salon's and memberships' answers. */
function cgvPage(memberships) {
  const make = (tag, attrs = {}) => {
    const el = { tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], hidden: !!attrs.hidden, textContent: '', className: '',
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null), setAttribute: (k, v) => { el.attrs[k] = v; }, removeAttribute: (k) => { delete el.attrs[k]; },
      appendChild: (c) => { el.children.push(c); return c; }, removeChild: (c) => { el.children.splice(el.children.indexOf(c), 1); },
      get firstChild() { return el.children[0] || null; }, querySelectorAll: () => [], closest: () => null };
    return el;
  };
  const section = make('section', { id: 'abonnement', 'data-if': 'membership.terms', hidden: '' });
  const list = make('ul', { 'data-list': 'plans' });
  const all = [section, list];
  const match = (sel) => all.filter((el) => sel.split(',').some((one) => {
    const m = /^\[([\w-]+)(?:([\^]?)="([^"]*)")?\]$/.exec(one.trim());
    if (!m) return false;
    const v = el.getAttribute(m[1]);
    return v != null && (m[3] === undefined || (m[2] === '^' ? v.startsWith(m[3]) : v === m[3]));
  }));
  let done;
  const ready = new Promise((r) => { done = r; });
  const document = {
    documentElement: { getAttribute: () => '2026-10-27', setAttribute: () => done() },
    querySelectorAll: match, querySelector: (sel) => match(sel)[0] || null,
    createElement: (tag) => make(tag), createTextNode: (t) => ({ text: t })
  };
  const salon = { shop: { name: 'Barber L’Architecte' }, booking: {}, deposits: { mode: 'none' }, services: [], payments: { provider: 'stripe', live: true } };
  const fetch = (url) => Promise.resolve({ ok: true, json: () => (url === '/api/public/memberships' ? memberships : salon) });
  vm.runInNewContext(read('public/pages.js'), { document, fetch, location: { pathname: '/cgv' }, localStorage: null, Promise });
  return ready.then(() => ({ hidden: section.hidden, plans: list.children.length }));
}

test('the CGV generator shows #abonnement while the membership is live, or on, or a contract still runs', async () => {
  const plans = [{ id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, minDays: 0, words: '2 coupes par mois · Coupe classique' }];
  assert.deepEqual(await cgvPage({ live: true, terms: true, plans, carnet: null, cgv: '2026-10-27' }), { hidden: false, plans: 1 });
  assert.deepEqual(await cgvPage({ live: false, terms: false, plans, carnet: null }), { hidden: true, plans: 0 });
  // online sales stopped (or Stripe unplugged) while members still run: their contract's terms stay readable
  assert.deepEqual(await cgvPage({ live: false, terms: true, plans, carnet: null }), { hidden: false, plans: 1 });
  assert.deepEqual(await cgvPage(null), { hidden: true, plans: 0 }, 'no answer: the clauses stay hidden');
  const html = read('public/cgv.html');
  assert.equal(/data-cgv-text="(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1], CGV_TEXT, 'CGV_TEXT equals cgv.html’s data-cgv-text');
  const sec = html.slice(html.indexOf('id="abonnement"'), html.indexOf('</section>', html.indexOf('id="abonnement"')));
  assert.match(sec, /data-if="membership.terms" hidden/);
  for (const w of ['durée indéterminée', 'date anniversaire', 'ne se reportent pas', 'Résilier mon abonnement', 'fin du mois déjà payé', 'Le prix de ta formule est garanti', '14&nbsp;jours', 'Renoncer au contrat ici', 'Formulaire de rétractation', 'moins les coupes déjà faites']) assert.ok(sec.includes(w), w);
  assert.match(html, /<h2 id="t-sub">Carnet<\/h2>/, 'the pack is the « Carnet »');
});

test('« Résilier mon abonnement » on the site’s footer and every legal page’s; the FAQ and the carnet words', () => {
  const site = read('public/site.html'), pages = read('public/pages.js');
  assert.ok(site.includes('<a href="/resilier">Résilier mon abonnement</a>'));
  assert.ok(pages.includes("['/resilier', 'Résilier mon abonnement']"));
  for (const f of ['cgv', 'mentions-legales', 'confidentialite', 'resilier', 'mon-rendez-vous']) assert.ok(read('public/' + f + '.html').includes('<footer data-footer></footer>'), f);
  assert.ok(site.includes('l’abonnement mensuel (dès ') && site.includes('et le carnet de 5 coupes ('));
  assert.ok(!/Abonnement 5 coupes/.test(site), 'the pack is « Carnet 5 coupes » everywhere on the site');
  // the WordPress menu the owner imports at go-live, and the demo's fixture: the carnet, never a bookable « Abonnement »
  const preset = /\{ slug: 'ab',[^\n]*\}/.exec(read('web/src/comptoir/pages/Catalogue.tsx'))?.[0] || '';
  assert.ok(preset.includes("name: 'Carnet 5 coupes'") && preset.includes("category: 'Carnet'") && preset.includes('online: false'), preset);
  assert.ok(!/Abonnement 5 coupes/.test(read('public/demo.html')));
  assert.ok(site.includes("q: 'Existe-t-il un abonnement ou un carnet ?'") && !site.includes('"Existe-t-il un abonnement ?"'));
  const res = read('public/resilier.html');
  for (const w of ['Résilier ou gérer mon', 'Ton numéro ou ton e-mail', 'Recevoir mon lien', 'Je n’ai plus accès à ce numéro ni à cet e-mail', 'Ouvrir mon espace', 'Démo&nbsp;: n’entre pas tes vraies coordonnées, tout est visible.']) assert.ok(res.includes(w), w);
});

test('every guide step of PAY-04 points at a data-guide that exists in its screens', () => {
  const steps = read('web/src/moi/guide/steps/PAY-04.ts');
  const targets = [...steps.matchAll(/target: '([^']+)'/g)].map((x) => x[1]);
  const ids = [...steps.matchAll(/id: '([^']+)'/g)].map((x) => x[1]);
  assert.ok(targets.length >= 15);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const sources = ['public/site.html', 'public/resilier.html', 'web/src/client/abonnement/Member.tsx', 'web/src/moi/avantages/Membership.tsx'].map(read).join('\n');
  for (const tg of targets) assert.ok(sources.includes('data-guide="' + tg + '"'), tg);
  // two short sentences at most, with « tu »
  for (const body of [...steps.matchAll(/body: '((?:[^'\\]|\\.)*)'/g)].map((x) => x[1])) assert.ok((body.match(/[.!?](\s|$)/g) || []).length <= 2, body);
});
