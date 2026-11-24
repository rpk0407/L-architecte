// The formule sold at the Comptoir to a client known by a first name and an address, on the salon as it runs live, over
// HTTP: production mode, everything by e-mail (booking.contact 'email'), no SMS provider, an e-mail provider that
// records what leaves, Stripe present on a fake network (it must never be called: the formule is paid at the till), and
// nothing stored about the client space (open by default for a salon that writes by e-mail).
//   - the sale books the five dates and sends ONE mail, at once, with the way into his space; a retry sends no second one;
//   - the link alone opens nothing: the page asks for the code sent to his address, then (a first opening) his first name;
//   - in his space he sees the formule (5 cuts, 80 €, what is left) and his five dates, and cancels one;
//   - « Renvoyer le lien » sends it again, three times a day at most;
//   - a known client without an address gets one from the sheet; the owner's « fermé » turns the link into the date's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../server/http/runtime.js';
import { stripeProvider } from '../../server/payments/stripe.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';
import { browser, ORIGIN } from './client.js';
import { at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const DAY = '2026-11-03'; // a Tuesday
const FIRST = addDays(DAY, 2);
let n = 0;
const freshMail = (who) => who + '.' + ++n + '.' + Math.random().toString(36).slice(2, 8) + '@exemple.fr';

async function live(t, { contact = 'email', accounts = /** @type {boolean | undefined} */ (undefined) } = {}) {
  const real = globalThis.fetch;
  const leaked = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { leaked.push(String((url && url.url) || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; assert.deepEqual(leaked, [], 'a request left the server'); });
  const clock = { now: at(DAY, 10) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, clock: () => clock.now, store: memoryStore() });
  // Stripe is there (the site's « payer maintenant »), on a network that records: the formule's sale must never reach it
  const stripe = [];
  rt.pay = stripeProvider({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x', fetchImpl: async (url, init) => { stripe.push(init.method + ' ' + url); return new Response('{}', { status: 500 }); } });
  const mails = [];
  rt.email = { name: 'test', send: async (m) => { mails.push(m); return { ref: 'm_' + mails.length }; } };
  assert.equal(rt.sms, null, 'no SMS provider, as on the live salon');
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const asOwner = () => ({ actor: { t: 'staff', id: boss.id }, staff: rt.engine.state.staff.get(boss.id), caps: capsOf(rt.engine.state.staff.get(boss.id), rt.engine.state.settings) });
  const week = { 2: [[540, 1140]], 3: [[540, 1140]], 4: [[540, 1140]], 5: [[540, 1140]], 6: [[540, 1140]] };
  const ids = {};
  ids.ali = (await rt.engine.run(addStaff, { name: 'Ali', role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner())).id;
  ids.cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2500, dur: 30, slug: 'cl' }, asOwner())).id;
  ids.formule = (await rt.engine.run(addService, { name: 'Formule Entretien 5 semaines', category: 'Formule', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [ids.cut], weekly: true, missed: 'lost' } }, asOwner())).id;
  await rt.engine.run(updateSettings, { booking: { contact, cancelUntilHours: 0 }, ...(accounts === undefined ? {} : { accounts: { enabled: accounts } }) }, asOwner());
  const s = () => rt.engine.state;
  /** the sheet's own two calls: the dates proposed after the first one, then the sale */
  const sell = async (who, { start = 600, headers } = {}) => {
    const series = await owner.get(`/api/v1/formule/series?staff=${ids.ali}&day=${FIRST}&start=${start}`);
    assert.equal(series.status, 200, series.text);
    return owner.post('/api/v1/formules', { serviceId: ids.formule, first: { staffId: ids.ali, day: FIRST, start }, weeks: series.json.weeks.map((w) => ({ staffId: w.staffId, day: w.day, start: w.start })), ...who }, headers);
  };
  const to = (email, tag) => mails.filter((m) => m.to === email && (tag ? m.tag === tag : m.tag !== 'otp'));
  const codeFor = (email) => { const m = to(email, 'otp').at(-1); assert.ok(m, 'a code was mailed to ' + email); return /^(\d{6}) /.exec(m.subject)[1]; };
  const texts = () => [...s().messages.values()].filter((m) => (m.channel || 'sms') === 'sms');
  return { rt, clock, owner, ids, s, sell, mails, to, codeFor, texts, stripe, asOwner };
}
/** The way into the space, as the mail carries it. */
const linkOf = (mail) => { const m = /https:\/\/\S+\/moi\?garder=(\S+)/.exec(mail.text); assert.ok(m, 'the mail carries the /moi link: ' + mail.text); return { url: m[0], token: decodeURIComponent(m[1]) }; };

test('nothing is stored about the client space and it is open: the salon writes by e-mail', async (t) => {
  const x = await live(t);
  assert.equal(x.rt.engine.journal.some((e) => e.type === 'settings.updated' && e.data.patch && e.data.patch.accounts), false);
  assert.equal((await browser(x.rt).get('/api/public/account')).json.enabled, true);
  // what the Comptoir reads is a plain yes, and the owner's switch still closes it
  assert.equal((await x.owner.get('/api/v1/bootstrap')).json.settings.accounts.enabled, true);
  assert.equal((await x.owner.get('/api/v1/settings')).json.settings.accounts.enabled, true);
  assert.equal((await x.owner.patch('/api/v1/settings', { accounts: { enabled: false } })).status, 200);
  assert.equal((await browser(x.rt).get('/api/public/account')).json.enabled, false);
  assert.equal((await x.owner.get('/api/v1/bootstrap')).json.settings.accounts.enabled, false);
});

test('sold at the Comptoir with a first name and an address: five dates, one mail with the way into his space, nothing online', async (t) => {
  const x = await live(t);
  const email = freshMail('karim');
  const rid = 'vente-0001-abcd';
  const r = await x.sell({ client: { first: 'karim', email: '  ' + email.toUpperCase() + ' ' } }, { headers: { 'x-request-id': rid } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.pay, r.json.paid, r.json.amount, r.json.appts.length], ['salon', false, 8000, 5]);
  assert.deepEqual(r.json.appts.map((a) => a.day), [0, 1, 2, 3, 4].map((k) => addDays(FIRST, 7 * k)));
  assert.ok(r.json.appts.every((a) => a.status === 'booked'));
  // the sheet is told where the mail went, masked; the outbox's id stays inside
  assert.match(r.json.mail, /^k•+@e•+\.fr$/);
  assert.ok(r.json.mail !== email && !('mailId' in r.json));
  // his file: a first name and an address, no number asked
  const file = [...x.s().clients.values()].find((c) => c.email === email);
  assert.deepEqual([file.first, file.phone || '', file.source], ['Karim', '', 'salon']);
  // paid at the till: no payment anywhere, Stripe never called
  assert.equal(x.s().payments.size, 0);
  assert.deepEqual(x.stripe, []);
  // ONE mail, already gone when the sheet closes; no text for a file without a number
  const sent = x.to(email);
  assert.equal(sent.length, 1, 'exactly one mail');
  assert.equal(x.texts().length, 0);
  const mail = sent[0];
  assert.match(mail.subject, /^Formule Entretien 5 semaines activée : 5 rendez-vous · /);
  assert.match(mail.text, /^Bonjour Karim,/);
  assert.match(mail.text, /Ta Formule Entretien 5 semaines est activée : 5 coupes, une par semaine, pour 80\s€\./);
  assert.match(mail.text, /Les 80\s€ se règlent au salon, à ta première visite\./);
  assert.match(mail.text, /Tes 5 rendez-vous avec Ali :/);
  for (let k = 1; k <= 5; k++) assert.ok(mail.text.includes('\n' + k + '. '), 'date ' + k + ' is listed');
  const link = linkOf(mail);
  assert.ok(link.url.startsWith(ORIGIN + '/moi?garder='));
  assert.deepEqual(mail.cta, { label: 'Voir ma formule', url: link.url });
  assert.ok(mail.attachments && mail.attachments[0].name === 'rendez-vous.ics');
  const queued = [...x.s().messages.values()].filter((m) => m.cid === file.id);
  assert.deepEqual(queued.map((m) => [m.channel, m.template, m.status]), [['email', 'formuleLink', 'sent']]);

  // the same request played again (a lost answer): the same sale, no second mail
  const again = await x.sell({ client: { first: 'karim', email } }, { headers: { 'x-request-id': rid } });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.id, r.json.id);
  // a second sale to him is refused: he holds one
  const twice = await x.sell({ client: { first: 'Karim', email } }, undefined);
  assert.deepEqual([twice.status, twice.json.error.code], [409, 'has_formule']);
  assert.equal(x.to(email).length, 1, 'still exactly one mail');
  assert.equal(x.s().formules.size, 1);

  // ---- his phone: the link alone shows nothing of his file
  const b = browser(x.rt);
  assert.equal((await b.get('/api/me/home')).status, 401);
  assert.equal((await b.get('/api/me/formule')).status, 401);
  // a link that was altered opens nothing and sends nothing
  assert.equal((await browser(x.rt).post('/api/public/account/keep', { token: link.token.slice(0, -2) + 'xx' })).status, 404);
  assert.equal(x.to(email, 'otp').length, 0);
  // the page asks for a code, sent to the address of the file (the answer says where, masked)
  const keep = await b.post('/api/public/account/keep', { token: link.token });
  assert.equal(keep.status, 200, keep.text);
  assert.equal(keep.json.via, 'email');
  assert.ok(keep.json.sentTo && keep.json.sentTo !== email);
  await settled();
  assert.equal(x.to(email, 'otp').length, 1);
  const code = x.codeFor(email);
  // whoever holds the link without the mailbox stays out
  assert.equal((await browser(x.rt).post('/api/public/account/verify', { token: link.token, code: code === '000000' ? '111111' : '000000' })).status, 400);
  // the code, then (a first opening of a file the salon made) his first name
  const ask = await b.post('/api/public/account/verify', { token: link.token, code });
  assert.deepEqual([ask.json.ok, ask.json.ask], [false, 'first']);
  const ok = await b.post('/api/public/account/verify', { token: link.token, code, first: 'Karim' });
  assert.deepEqual(ok.json, { ok: true, first: 'Karim' });

  // ---- his space: the formule and its five dates
  const card = (await b.get('/api/me/formule')).json;
  assert.equal(card.items.length, 1);
  const f = card.items[0];
  assert.deepEqual([f.name, f.price, f.credits, f.used, f.left, f.pay, f.status], ['Formule Entretien 5 semaines', 8000, 5, 0, 5, 'due', 'open']);
  assert.deepEqual(f.weeks.map((w) => w.state), ['booked', 'booked', 'booked', 'booked', 'booked']);
  assert.ok(f.weeks.every((w) => w.appt && w.appt.token));
  const home = (await b.get('/api/me/home')).json;
  assert.equal(home.upcoming.length, 5);
  assert.ok(home.upcoming.every((a) => a.canChange && a.token));
  // he cancels the third one, under the usual rules
  const third = f.weeks[2].appt;
  const gone = await b.post('/api/public/bookings/' + third.token + '/cancel', {});
  assert.equal(gone.status, 200, gone.text);
  const after = (await b.get('/api/me/formule')).json.items[0];
  assert.deepEqual(after.weeks.map((w) => w.state), ['booked', 'booked', 'open', 'booked', 'booked']);
  assert.equal((await b.get('/api/me/home')).json.upcoming.length, 4);
  assert.deepEqual(x.stripe, []);
});

test('« Renvoyer le lien »: the mail again from any of its dates, as the formule stands today, three times a day', async (t) => {
  const x = await live(t);
  const email = freshMail('nabil');
  const r = await x.sell({ client: { first: 'Nabil', email } });
  assert.equal(r.status, 200, r.text);
  // the sheet of any of its dates offers it
  const sheet = (await x.owner.get('/api/v1/appointments/' + r.json.appts[3].id)).json;
  assert.equal(sheet.formuleMail, 'ok');
  assert.equal(sheet.appt.formule.id, r.json.id);
  // a date cancelled since: the copy lists what is still to come
  assert.equal((await x.owner.post('/api/v1/appointments/' + r.json.appts[1].id + '/cancel', { reason: 'Annulé par le salon' })).status, 200);
  const before = x.to(email).length;
  for (let k = 1; k <= 3; k++) {
    const again = await x.owner.post('/api/v1/formules/' + r.json.id + '/resend-link', {});
    assert.equal(again.status, 200, again.text);
    assert.deepEqual([again.json.status, again.json.to === email, /^n•+@e•+\.fr$/.test(again.json.to)], ['sent', false, true]);
  }
  const copies = x.to(email).slice(before).filter((m) => /\/moi\?garder=/.test(m.text));
  assert.equal(copies.length, 3);
  assert.match(copies[0].text, /Tes 4 rendez-vous avec Ali :/);
  assert.match(copies[0].text, /Une visite reste à réserver\./);
  assert.equal(linkOf(copies[0]).url.startsWith(ORIGIN + '/moi?garder='), true);
  const fourth = await x.owner.post('/api/v1/formules/' + r.json.id + '/resend-link', {});
  assert.deepEqual([fourth.status, fourth.json.error.code], [429, 'slow_down']);
  // the next day it can leave again
  x.clock.now = at(addDays(DAY, 1), 10);
  assert.equal((await x.owner.post('/api/v1/formules/' + r.json.id + '/resend-link', {})).status, 200);
  // not for a stranger's id, not without a session
  assert.equal((await x.owner.post('/api/v1/formules/fo_nope/resend-link', {})).status, 404);
  assert.equal((await browser(x.rt).post('/api/v1/formules/' + r.json.id + '/resend-link', {})).status, 401);
});

test('a client the salon already knows: his address is taken from his file, or added to it from the sheet', async (t) => {
  const x = await live(t);
  // no address on his file: the sale goes through without a mail, and the sheet's answer says none left
  const made = await x.owner.post('/api/v1/clients', { first: 'Sofiane', last: 'Habitué' });
  assert.equal(made.status, 200, made.text);
  const bare = await x.sell({ clientId: made.json.id });
  assert.equal(bare.status, 200, bare.text);
  assert.equal(bare.json.mail, undefined);
  assert.equal(x.mails.length, 0);
  assert.equal((await x.owner.get('/api/v1/appointments/' + bare.json.appts[0].id)).json.formuleMail, 'no_email');
  assert.equal((await x.owner.post('/api/v1/formules/' + bare.json.id + '/resend-link', {})).json.error.code, 'no_email');
  // once his address is on his file, « Renvoyer le lien » sends it
  const email = freshMail('sofiane');
  assert.equal((await x.owner.patch('/api/v1/clients/' + made.json.id, { email })).status, 200);
  assert.equal((await x.owner.post('/api/v1/formules/' + bare.json.id + '/resend-link', {})).status, 200);
  assert.equal(x.to(email).length, 1);

  // another known client without an address: typed in the sheet with the sale, it goes on his file and the mail leaves
  const other = await x.owner.post('/api/v1/clients', { first: 'Mehdi' });
  const mail2 = freshMail('mehdi');
  // someone else's address is refused: his sign-in would open the other file
  const clash = await x.sell({ clientId: other.json.id, email }, undefined);
  assert.deepEqual([clash.status, clash.json.error.code], [409, 'exists']);
  assert.equal((await x.sell({ clientId: other.json.id, email: 'pas-une-adresse' })).status, 400);
  const sold = await x.sell({ clientId: other.json.id, email: mail2 }, { start: 660 });
  assert.equal(sold.status, 200, sold.text);
  assert.equal(x.s().clients.get(other.json.id).email, mail2);
  assert.equal(x.to(mail2).length, 1);
  // a first name and an address the salon already has: the same file, never a second one
  const count = x.s().clients.size;
  const dup = await x.sell({ client: { first: 'Mehdi', email: mail2 } });
  assert.deepEqual([dup.status, dup.json.error.code], [409, 'has_formule']);
  assert.equal(x.s().clients.size, count);
});

test('the owner switched the client space off: the mail still leaves, its link is the first date’s own page', async (t) => {
  const x = await live(t, { accounts: false });
  const email = freshMail('ilyes');
  const r = await x.sell({ client: { first: 'Ilyes', email } });
  assert.equal(r.status, 200, r.text);
  const [mail] = x.to(email);
  assert.ok(mail && !/\/moi/.test(mail.text));
  const head = x.s().appts.get(r.json.appts[0].id);
  assert.equal(mail.cta.label, 'Gérer mes rendez-vous');
  assert.ok(mail.cta.url.startsWith(ORIGIN + '/r/' + head.code + '.'));
  // and that link's token opens no space: the sign-in routes are closed
  assert.equal((await browser(x.rt).post('/api/public/account/keep', { token: mail.cta.url.split('/r/')[1] })).status, 409);
});

test('a salon that texts: the number is the way, the sheet’s address is optional and nothing breaks without a provider', async (t) => {
  const x = await live(t, { contact: 'phone' });
  const r = await x.sell({ client: { first: 'Rayan', phone: '06 11 00 00 44' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.mail, undefined);
  assert.equal(x.mails.length, 0);
  // his text is queued as before (no SMS provider here: it waits)
  assert.deepEqual(x.texts().map((m) => m.template), ['confirmation']);
});

test('a plain booking from the Comptoir takes a new client’s address too: his confirmation goes there', async (t) => {
  const x = await live(t);
  const email = freshMail('walid');
  const r = await x.owner.post('/api/v1/appointments', { client: { first: 'Walid', email }, serviceIds: [x.ids.cut], staffId: x.ids.ali, day: FIRST, start: 660, source: 'phone' });
  assert.equal(r.status, 200, r.text);
  const file = [...x.s().clients.values()].find((c) => c.email === email);
  assert.deepEqual([file.first, file.phone || ''], ['Walid', '']);
  const conf = [...x.s().messages.values()].filter((m) => m.cid === file.id);
  assert.deepEqual(conf.map((m) => [m.channel, m.template]), [['email', 'confirmation']]);
  // the same address again: the same file
  const again = await x.owner.post('/api/v1/appointments', { client: { first: 'Walid', email }, serviceIds: [x.ids.cut], staffId: x.ids.ali, day: FIRST, start: 720, source: 'phone' });
  assert.equal(again.status, 200, again.text);
  assert.equal([...x.s().clients.values()].filter((c) => c.email === email).length, 1);
  assert.equal((await x.owner.post('/api/v1/appointments', { client: { first: 'Walid', email: 'x@' }, serviceIds: [x.ids.cut], staffId: x.ids.ali, day: FIRST, start: 780 })).status, 400);
});
