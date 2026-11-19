// The salon as it runs today, end to end over HTTP: production mode, no SMS provider, everything by e-mail
// (settings.booking.contact 'email', the number optional), the monthly membership not live, no online payment, the
// client space switched on by the owner. What the demo hides (texts and memberships simulated ON) is checked here:
//   - what the public page needs is in the public payloads (the formule to take, the space's way in);
//   - a client who booked with an address signs in to /moi with a code by e-mail, sees his appointment and cancels it;
//   - the formule (5 cuts, paid at the salon) is taken with an account made from a first name and an address;
//   - nothing of this is reachable while the owner has not switched the space on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at } from '../helpers.js';
import { browser } from './client.js';
import { addDays } from '../../shared/dates.js';
import { createRuntime } from '../../server/http/runtime.js';
import { updateSettings } from '../../server/commands/shop.js';
import { addService, archiveService } from '../../server/commands/catalog.js';
import { ACCOUNT_TIMING, START_MESSAGE_MAIL, settled } from '../../server/http/routes-me.js';
import { defaultSettings } from '../../server/settings/index.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
const FIRST = '2026-11-05'; // the Thursday after the helpers' DAY (a Tuesday)
let n = 0;
const freshMail = (who) => who + '.' + ++n + '.' + Math.random().toString(36).slice(2, 8) + '@exemple.fr';

/** The live salon's shape: e-mail mode, « annulable à tout moment », one formule in the catalogue, the space on or off. */
async function setup({ accounts = true, oldCarnet = false } = {}) {
  const t = await salon();
  await t.engine.run(updateSettings, { ...(accounts ? { accounts: { enabled: true } } : {}), booking: { contact: 'email', cancelUntilHours: 0 } }, t.asOwner());
  // one formule, as the salon sells it; the helpers' carnet without dates is not part of this salon
  if (!oldCarnet) await t.engine.run(archiveService, { id: t.ids.pack }, t.asOwner());
  t.ids.formule = (await t.engine.run(addService, { name: 'Formule Entretien 5 semaines', category: 'Formule', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [t.ids.cut], weekly: true, missed: 'lost' } }, t.asOwner())).id;
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  await rt.engine.sync(true);
  // the e-mail provider records what leaves; there is no SMS provider at all, as in production today
  const mails = [];
  rt.email = { name: 'test', send: async (m) => { mails.push(m); return { ref: 'm_' + mails.length }; } };
  assert.equal(rt.sms, null, 'no SMS provider');
  const s = () => rt.engine.state;
  /** the six digits of the last code mailed to that address, as the client reads them */
  const codeFor = (email) => {
    const m = mails.filter((x) => x.to === email && x.tag === 'otp').at(-1);
    assert.ok(m, 'a code was mailed to ' + email);
    const d = /^(\d{6}) /.exec(m.subject);
    assert.ok(d && m.text.startsWith(d[1]), 'the digits open the mail');
    return d[1];
  };
  const texts = () => [...s().messages.values()].filter((m) => (m.channel || 'sms') === 'sms');
  return { ...t, rt, s, mails, codeFor, texts };
}

test('defaults: nothing here switches the client space on by itself', () => {
  assert.equal(defaultSettings().accounts.enabled, false);
});

test('the public payloads carry what the page needs: the formule to take, no monthly plan, the space by e-mail', async () => {
  const t = await setup();
  const site = browser(t.rt);
  const pub = (await site.get('/api/public/salon')).json;
  assert.equal(pub.booking.contact, 'email');
  assert.equal(pub.payments.live, false, 'everything is paid at the salon');
  const row = pub.menu.find((x) => x.name === 'Formule Entretien 5 semaines');
  assert.deepEqual([row.price, row.online, row.slug], [8000, true, 'ab']);
  const sv = pub.services.find((x) => x.slug === 'ab');
  assert.ok(sv && sv.pack && sv.pack.weekly && sv.pack.credits === 5, 'the page can open the formule (« Prendre la formule »)');
  // the chapter's data: no plan to sell (the plans' card stays hidden), the formule's card
  const m = (await site.get('/api/public/memberships')).json;
  assert.equal(m.live, false);
  assert.deepEqual(m.carnet, { name: 'Formule Entretien 5 semaines', price: 8000, credits: 5, days: 35, weekly: true, missed: 'lost' });
  // the way in: « Mon espace » shows, and asks an address
  assert.deepEqual((await site.get('/api/public/account')).json, { enabled: true, contact: 'email', signedIn: false, demo: false, loyalty: (await site.get('/api/public/account')).json.loyalty });
});

test('while the owner has not switched it on: no way in, no code, and the formule stays « au salon »', async () => {
  const t = await setup({ accounts: false });
  const site = browser(t.rt);
  const acc = (await site.get('/api/public/account')).json;
  assert.equal(acc.enabled, false);
  const email = freshMail('karim');
  assert.equal((await site.post('/api/public/account/start', { email })).status, 409);
  assert.equal((await site.post('/api/public/account/join', { first: 'Karim', email })).status, 409);
  assert.equal(t.mails.length, 0);
  const pub = (await site.get('/api/public/salon')).json;
  assert.equal(pub.menu.find((x) => x.slug === 'ab').online, false);
  assert.ok(!pub.services.some((x) => x.slug === 'ab'));
  // the formule is still in the chapter's data: the page shows it, « À acheter au salon »
  assert.equal((await site.get('/api/public/memberships')).json.carnet.name, 'Formule Entretien 5 semaines');
  // a booking by e-mail works as before
  assert.equal((await site.post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: 'any', day: FIRST, start: 600, first: 'Karim', email })).status, 201);
});

test('a client who booked with his address signs in with a code by e-mail, sees his appointment and cancels it', async () => {
  const t = await setup();
  const email = freshMail('nora');
  // he booked on the site: an address, no number
  const booked = await browser(t.rt).post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: FIRST, start: 600, first: 'Nora', email });
  assert.equal(booked.status, 201, booked.text);
  const appt = t.s().appts.get(t.s().apptByCode.get(booked.json.code));
  const file = t.s().clients.get(appt.clientId);
  assert.deepEqual([file.email, file.phone || ''], [email, '']);
  // his confirmation went to his address with the booking's own link (« Gérer mon rendez-vous »): kept as it was
  const conf = [...t.s().messages.values()].find((m) => m.channel === 'email' && m.to === email && m.apptId === appt.id);
  assert.ok(conf, 'the confirmation e-mail');
  assert.equal(t.texts().length, 0, 'no text is queued for a file without a number');

  // days later, another phone: « Mon espace », his address, the code from his mailbox
  t.clock.now = at('2026-11-04', 9);
  const b = browser(t.rt);
  assert.equal((await b.get('/api/me/home')).status, 401);
  assert.deepEqual((await b.post('/api/public/account/start', { email: email.toUpperCase() })).json, { ok: true, message: START_MESSAGE_MAIL });
  await settled();
  assert.equal(t.mails.filter((m) => m.tag === 'otp').length, 1);
  const code = t.codeFor(email);
  // the code is nowhere but in that mail
  assert.ok(!JSON.stringify([...t.s().messages.values()]).includes(code), 'never in the outbox');
  // a wrong code opens nothing
  assert.equal((await b.post('/api/public/account/verify', { email, code: code === '000000' ? '111111' : '000000' })).status, 400);
  // the right one: a first opening from another device asks the first name he gave, once
  const ask = await b.post('/api/public/account/verify', { email, code });
  assert.deepEqual([ask.json.ok, ask.json.ask], [false, 'first']);
  const ok = await b.post('/api/public/account/verify', { email, code, first: 'nora' });
  assert.deepEqual(ok.json, { ok: true, first: 'Nora' });
  assert.deepEqual((await b.get('/api/public/account')).json.signedIn, true);

  // his appointment, with what « Annuler » needs
  const home = (await b.get('/api/me/home')).json;
  assert.equal(home.contact, 'email');
  assert.equal(home.upcoming.length, 1);
  const up = home.upcoming[0];
  assert.deepEqual([up.id, up.day, up.start, up.status, up.canChange], [appt.id, FIRST, 600, 'booked', true]);
  assert.ok(up.token && up.manage.endsWith('/r/' + up.token));
  // the session's word on the profile: an e-mail session, no number to show
  assert.equal((await b.get('/api/me')).json.via, 'email');

  // « annulable à tout moment » (cancelUntilHours 0): still his to cancel one hour before
  t.clock.now = at(FIRST, 9);
  assert.equal((await b.get('/api/me/home')).json.upcoming[0].canChange, true);
  const gone = await b.post('/api/public/bookings/' + up.token + '/cancel', {});
  assert.equal(gone.status, 200, gone.text);
  assert.equal(t.s().appts.get(appt.id).status, 'cancelled');
  assert.deepEqual((await b.get('/api/me/home')).json.upcoming, []);
  // the slot is free again on the site
  const day = (await browser(t.rt).get(`/api/public/availability?services=${t.ids.cut}&staff=${t.ids.Ali}&from=${FIRST}&days=1`)).json;
  assert.ok(JSON.stringify(day).includes('600'));
  // signing out ends it
  assert.equal((await b.post('/api/me/signout', {})).status, 200);
  assert.equal((await b.get('/api/me/home')).status, 401);
});

test('someone else’s address opens nothing: no code without the mailbox, and the answers never tell a known address from an unknown one', async () => {
  const t = await setup();
  const email = freshMail('samir');
  await browser(t.rt).post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: FIRST, start: 630, first: 'Samir', email });
  const b = browser(t.rt);
  const known = await b.post('/api/public/account/start', { email });
  const unknown = await b.post('/api/public/account/start', { email: freshMail('personne') });
  await settled();
  assert.deepEqual([known.status, known.json], [unknown.status, unknown.json]);
  assert.equal(t.mails.filter((m) => m.tag === 'otp').length, 1, 'only the known address is written to');
  // guessing: five wrong codes and the file is locked for a while, the real code burned
  const code = t.codeFor(email);
  for (let i = 0; i < 5; i++) assert.equal((await b.post('/api/public/account/verify', { email, code: String(100000 + i) === code ? '999999' : String(100000 + i) })).status, 400);
  const locked = await b.post('/api/public/account/verify', { email, code, first: 'Samir' });
  assert.notEqual(locked.status, 200);
  assert.equal((await b.get('/api/me/home')).status, 401);
});

test('the formule is taken from the site with a first name and an address: five dates, 80 € due at the salon, nothing online', async () => {
  const t = await setup();
  const b = browser(t.rt);
  const email = freshMail('yanis');
  // the dates proposed after the first one, and the slots kept while he types
  const series = await b.get(`/api/public/formule/series?staff=${t.ids.Ali}&day=${FIRST}&start=660`);
  assert.equal(series.status, 200, series.text);
  assert.deepEqual([series.json.credits, series.json.price, series.json.weeks.length], [5, 8000, 4]);
  const slots = [{ staffId: t.ids.Ali, day: FIRST, start: 660 }, ...series.json.weeks.map((w) => ({ staffId: w.staffId, day: w.day, start: w.start }))];
  const holds = await b.post('/api/public/formule/holds', { slots });
  assert.equal(holds.status, 200, holds.text);
  // without an account: 401 « Cette formule demande un compte »
  const body = { first: { ...slots[0], holdId: holds.json.holds[0].holdId }, weeks: slots.slice(1).map((x, i) => ({ ...x, holdId: holds.json.holds[i + 1].holdId })) };
  assert.equal((await b.post('/api/me/formule', body)).status, 401);
  // the account: his first name and his address, the code by e-mail (no number anywhere)
  const j = await b.post('/api/public/account/join', { first: 'Yanis', email });
  assert.deepEqual(j.json, { ok: true, message: START_MESSAGE_MAIL });
  await settled();
  const v = await b.post('/api/public/account/verify', { email, code: t.codeFor(email), first: 'Yanis' });
  assert.deepEqual(v.json, { ok: true, first: 'Yanis' });
  const file = [...t.s().clients.values()].find((c) => c.email === email);
  assert.deepEqual([file.first, file.phone || '', file.marketing === true], ['Yanis', '', false], 'a file with an address, no number, no offers asked');

  // the card of /moi offers it, to be paid at the salon
  const card = (await b.get('/api/me/formule')).json;
  assert.deepEqual([card.offer.name, card.offer.price, card.offer.pay], ['Formule Entretien 5 semaines', 8000, 'salon']);

  const r = await b.post('/api/me/formule', body);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.pay, r.json.amount, r.json.payment], ['salon', 8000, null]);
  assert.equal(r.json.appts.length, 5);
  assert.ok(r.json.appts.every((a) => a.status === 'booked'), 'booked at once: nothing to pay online');
  assert.deepEqual(r.json.appts.map((a) => a.day), [0, 1, 2, 3, 4].map((k) => addDays(FIRST, 7 * k)));
  assert.equal(t.s().payments.size, 0, 'no payment was opened anywhere');
  const f = [...t.s().formules.values()].find((x) => x.clientId === file.id);
  assert.ok(f && f.pay === 'salon');
  // his confirmation goes to his address; no text is queued for a file without a number
  assert.ok([...t.s().messages.values()].some((m) => m.channel === 'email' && m.to === email), 'the confirmation e-mail');
  assert.equal(t.texts().length, 0);

  // his five dates are in his space, each his to cancel
  const home = (await b.get('/api/me/home')).json;
  assert.equal(home.upcoming.length, 5);
  assert.ok(home.upcoming.every((a) => a.canChange && a.token));
  const mine = (await b.get('/api/me/formule')).json;
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].status, 'open');
});

test('two carnets in the catalogue: the page’s card is about the one its button opens (the formule taken online)', async () => {
  // an older carnet without dates comes first in the catalogue: sold at the salon only
  const on = await setup({ oldCarnet: true });
  const pub = (await browser(on.rt).get('/api/public/salon')).json;
  assert.deepEqual(pub.services.filter((x) => x.pack).map((x) => x.slug), ['ab'], 'the only carnet the site can open');
  assert.equal((await browser(on.rt).get('/api/public/memberships')).json.carnet.name, 'Formule Entretien 5 semaines');
  // the space closed: none is taken online, the first of the catalogue is shown « au salon » as before
  const off = await setup({ accounts: false, oldCarnet: true });
  assert.equal((await browser(off.rt).get('/api/public/memberships')).json.carnet.name, 'Abonnement 5 coupes');
});
