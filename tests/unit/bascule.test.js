// WP-10 · Jour J: the hold that keeps client texts back until the switch, the freeze and the final sync, the checks of the
// card (DNS, the old addresses, the parked site), the CSV of the bookings taken here, and the features waiting for the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects, DAY, at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import { CASES } from '../../shared/redirects.js';
import { startImportRun, finishImportRun, importBatch } from '../../server/commands/import.js';
import { tombKeyOf } from '../../server/commands/clients.js';
import { freezeWordpress, markSwitched, tickBascule } from '../../server/commands/bascule.js';
import { tick } from '../../server/commands/system.js';
import * as A from '../../server/commands/agenda.js';
import { queueMessage } from '../../server/domain/messages.js';
import { cutoverHold, cutoverHeld, lateBookings } from '../../server/projections/bascule.js';
import { dispatch } from '../../server/http/scheduler.js';
import { basculeOf, sinceCsv, domainOf, takenHere, csv } from '../../server/http/routes-bascule.js';
import { featuresOf } from '../../server/domain/features.js';
import { healthOf } from '../../server/http/routes-health.js';
import { localParts } from '../../shared/dates.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';

const HOUR = 3600000;
const ORIGIN = 'https://salon.test';
const owner = (t) => ({ ...t.asOwner(), meta: { tombKey: tombKeyOf('test-secret-0123456789') } });
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 'b-' + sent.length }; } }; };
/** the runtime the scheduler and the checks read, with the network replaced by what each test injects */
const rtOf = (t, x = {}) => ({
  engine: t.engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '', publicUrl: '' }, origin: ORIGIN, sleep: async () => {},
  dnsResolve: async () => { throw Object.assign(new Error('pas de réseau'), { code: 'ENOTFOUND' }); },
  fetch: async () => { throw Object.assign(new Error('pas de réseau'), { cause: { code: 'ENOTFOUND' } }); }, ...x
});
const q = (t, m) => t.engine.run({ run: (s, i, ctx) => ({ id: queueMessage(s, ctx, m) }) }, {}, { ...t.sys, meta: { siteUrl: ORIGIN + '/' } });
/** one demo salon for the tests that only read it (seeding takes seconds); the routes test is the only one that writes Jour J there */
let demo;
const demoRt = () => (demo ??= testRuntime({ clock: () => at(DAY, 10, 0) }));
const get = (t, id) => t.engine.state.messages.get(id);
const step = (b, id) => b.steps.find((x) => x.id === id);

/** A WordPress run: opened, the bookings sent in one batch, finished (unless `open`). Returns its id. */
async function run(t, appts = [], { open = false } = {}) {
  const as = owner(t);
  const { id } = await t.engine.run(startImportRun, {
    source: 'files', files: [{ name: 'export.csv', kind: 'bookings', rows: appts.length, sha: '0123456789abcdef' }], window: [], map: { services: {}, staff: {} },
    totals: { bookings: appts.length, clients: appts.length, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 }
  }, as);
  if (appts.length) await t.engine.run(importBatch, { appts, run: id, i: 0 }, as);
  if (!open) await t.engine.run(finishImportRun, { id }, as);
  return id;
}
/** An upcoming booking of the old site: a person with a phone number, a service and a chair. */
const row = (t, wp, o = {}) => ({ wp, day: addDays(DAY, 1), start: 600, first: 'Nadia', last: 'Roux', phone: '06 98 76 54 32', serviceIds: [t.ids.cut], staffId: t.ids.Ali, status: 'confirmed', ...o });
const runTick = (t) => t.engine.run(tick, {}, { ...t.sys, meta: { linkFor: (a) => ORIGIN + '/r/' + a.code, siteUrl: ORIGIN + '/' } });

test('before the switch, a text to a client waits whatever provider is plugged; the switch lets it go', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  // the evening before: the reminder is queued from the first tick
  t.clock.now = at(DAY, 19, 0);
  await runTick(t);
  const rem = [...t.engine.state.messages.values()].find((m) => m.template === 'reminder' && m.cid);
  assert.ok(rem, 'the reminder of the imported booking is queued');
  assert.equal(cutoverHold(t.engine.state), true);
  const sms = fakeSms();
  await dispatch(rtOf(t, { sms }));
  assert.equal(sms.sent.length, 0, 'the provider is not called');
  assert.equal(get(t, rem.id).status, 'queued', 'it stays queued');

  // the freeze, a final sync after it, then the switch
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += 5 * 60000;
  await run(t);
  await t.engine.run(markSwitched, {}, owner(t));
  assert.equal(cutoverHold(t.engine.state), false);
  t.clock.now += 5 * 60000;
  await dispatch(rtOf(t, { sms }));
  assert.equal(sms.sent.length, 1);
  assert.equal(get(t, rem.id).status, 'sent');
});

test('the hold spares what the client asked for, a contract’s acknowledgement and the owner’s own texts', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  const to = '+33612345678', cid = t.ids.yanis;
  const mine = [
    await q(t, { key: 'conf', template: 'confirmation', to, cid, vars: {}, text: 'Confirmation https://x' }),
    await q(t, { key: 'look', template: 'lookup', to, cid, vars: {}, text: 'Ton rendez-vous https://x' }),
    await q(t, { key: 'welc', template: 'memberWelcome', to, cid, vars: {}, text: 'Bienvenue https://x' }),
    await q(t, { key: 'digest', template: 'digest', to: '+33699999999', vars: {}, text: 'Résumé du soir' }),
    await q(t, { key: 'rev', template: 'review', to: '+33699999999', vars: {}, text: 'Test de la demande d’avis', owner: true })
  ].map((x) => x.id);
  const sms = fakeSms();
  await dispatch(rtOf(t, { sms }));
  const status = Object.fromEntries(['conf', 'look', 'welc', 'digest', 'rev'].map((k, i) => [k, get(t, mine[i]).status]));
  assert.deepEqual(status, { conf: 'queued', look: 'sent', welc: 'sent', digest: 'sent', rev: 'sent' });
  assert.deepEqual(sms.sent.map((x) => x.to).sort(), ['+33612345678', '+33612345678', '+33699999999', '+33699999999']);
  // the same rule as a function, for any new way of sending
  const s = t.engine.state;
  assert.equal(cutoverHeld(s, { template: 'reminder', cid }), true);
  assert.equal(cutoverHeld(s, { template: 'reminder', cid: null }), false);
  assert.equal(cutoverHeld(s, { template: 'lookup', cid }), false);
  assert.equal(cutoverHeld(s, { template: 'memberWelcome', cid }), false);
  assert.equal(cutoverHeld(s, { template: 'review', cid, owner: true }), false);
});

test('an e-mail to a client waits as well, and the card counts the texts waiting for the switch', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  const mail = await q(t, { key: 'mail', channel: 'email', template: 'confirmation', to: 'yanis@example.fr', cid: t.ids.yanis, vars: {}, subject: 'Rendez-vous', text: 'Ton rendez-vous' });
  const ownerMail = await q(t, { key: 'omail', channel: 'email', template: 'digest', to: 'patron@test.fr', vars: {}, subject: 'Résumé', text: 'Le résumé' });
  await q(t, { key: 'conf', template: 'confirmation', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  const sent = [];
  const email = { async send(m) { sent.push(m.to); return { ref: 'e' }; } };
  await dispatch(rtOf(t, { email, sms: fakeSms() }));
  assert.deepEqual(sent, ['patron@test.fr']);
  assert.equal(get(t, mail.id).status, 'queued');
  assert.equal(get(t, ownerMail.id).status, 'sent');
  const b = await basculeOf(rtOf(t));
  assert.deepEqual(b.hold, { on: true, queued: 2 });
  assert.equal(step(b, 'switch').line, '2 messages attendent la bascule.');
  // one that waited more than 6 h will never leave: it no longer counts
  t.clock.now += 7 * HOUR;
  assert.equal((await basculeOf(rtOf(t))).hold.queued, 0);
});

test('a demo salon is never held, nor a production salon that imported nothing', async () => {
  const t = await salon();
  await q(t, { key: 'conf', template: 'confirmation', to: '+33612345678', cid: t.ids.yanis, vars: {}, text: 'Confirmation https://x' });
  const sms = fakeSms();
  assert.equal(cutoverHold(t.engine.state), false, 'no run, no old site to double');
  await dispatch(rtOf(t, { sms }));
  assert.equal(sms.sent.length, 1);

  // the demo: the same state, with a run, only the mode differs (it simulates every text and sends none)
  const rt = await demoRt();
  const e = rt.engine;
  const as = { actor: { t: 'staff', id: [...e.state.staff.values()].find((x) => x.role === 'owner').id }, staff: null, caps: new Set(['settings']) };
  await e.run(startImportRun, { source: 'files', files: [], window: [], map: { services: {}, staff: {} }, totals: { bookings: 0, clients: 0, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 } }, as);
  assert.equal(e.state.mode, 'demo');
  assert.equal(e.state.imports.runs.size, 1);
  assert.equal(cutoverHold(e.state), false);
  assert.equal((await basculeOf({ ...rt })).hold.on, false);
});

test('freeze and final sync: a run before the freeze does not count, one after it does, a booking taken after the freeze is an alarm', async () => {
  const t = await salon();
  await run(t, [row(t, 5001, { createdAt: t.clock.now - 2 * HOUR })]);
  const rt = () => rtOf(t);
  let b = await basculeOf(rt());
  assert.equal(step(b, 'first-run').state, 'ok');
  assert.match(step(b, 'first-run').line, /^1 client, 1 rendez-vous · 3 novembre$/);
  assert.equal(step(b, 'freeze').state, 'todo');
  assert.equal(step(b, 'final-sync').state, 'todo');

  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  const frozen = t.clock.now;
  b = await basculeOf(rt());
  assert.equal(step(b, 'freeze').state, 'ok');
  assert.equal(step(b, 'freeze').at, frozen);
  assert.equal(step(b, 'final-sync').state, 'todo', 'the run came before the freeze');

  // a clean final sync: a booking the old site took before the freeze
  t.clock.now += HOUR;
  await run(t, [row(t, 5002, { first: 'Karim', phone: '06 11 22 33 44', createdAt: frozen - 10 * 60000 })]);
  b = await basculeOf(rt());
  assert.equal(step(b, 'final-sync').state, 'ok');
  assert.match(step(b, 'final-sync').line, /^Faite à \d{2}:\d{2}, après le gel\.$/);

  // the old site still took a booking after the freeze: the final sync brings it in, and says so
  t.clock.now += HOUR;
  await run(t, [row(t, 5003, { first: 'Louis', phone: '06 55 44 33 22', createdAt: frozen + 30 * 60000 })]);
  b = await basculeOf(rt());
  assert.equal(step(b, 'final-sync').state, 'err');
  assert.equal(step(b, 'final-sync').line, '1 rendez-vous pris sur WordPress après le gel : la réservation en ligne est-elle bien coupée ? Coupe-la, puis refais la synchro.');
  // the switch is refused while it reads red, forcing it is recorded; a clean sync after the booking was switched off clears it
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'late_bookings');
  t.clock.now += HOUR;
  await run(t);
  b = await basculeOf(rt());
  assert.equal(step(b, 'final-sync').state, 'ok', 'only the latest sync after the freeze counts');
  assert.equal(late(t), 0);
  await t.engine.run(markSwitched, {}, owner(t));
  assert.equal(t.engine.state.bascule.forced, null);
});
const late = (t) => lateBookings(t.engine.state);

test('a booking without the old site’s creation time is not mistaken for one taken after the freeze', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += HOUR;
  await run(t, [row(t, 5002, { first: 'Karim', phone: '06 11 22 33 44' })]);
  const b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'final-sync').state, 'ok');
});

test('the switch: not before the freeze and a sync after it, unless forced with a reason; the freeze happens once', async () => {
  const t = await salon();
  const e = await rejects(t.engine.run(markSwitched, {}, owner(t)), 'not_ready');
  assert.equal(e.message, 'Bloque d’abord WordPress et fais la synchro finale.');
  await run(t, [row(t, 5001)]);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'not_ready');
  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  await rejects(t.engine.run(freezeWordpress, {}, owner(t)), 'frozen');
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'not_ready');
  // forcing needs a reason
  await rejects(t.engine.run(markSwitched, { force: true }, owner(t)), 'invalid');
  await rejects(t.engine.run(markSwitched, { force: true, reason: '   ' }, owner(t)), 'invalid');
  const r = await t.engine.run(markSwitched, { force: true, reason: 'L’hébergeur coupe les exports' }, owner(t));
  assert.equal(r.day, DAY);
  const ev = t.engine.journal.find((x) => x.type === 'bascule.switched');
  assert.equal(ev.data.force, true);
  assert.equal(ev.data.reason, 'L’hébergeur coupe les exports');
  assert.equal(t.engine.state.bascule.forced.reason, 'L’hébergeur coupe les exports');
  assert.equal(t.engine.state.bascule.switchedAt, t.clock.now);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'switched');
  assert.match(step(await basculeOf(rtOf(t)), 'switch').line, /^Bascule faite le 3 novembre\. Les rappels partent\. \(Forcée : L’hébergeur coupe les exports\)$/);
});

test('the switch after a real final sync needs no force, and records none', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += HOUR;
  await run(t);
  await t.engine.run(markSwitched, { force: true, reason: 'au cas où' }, owner(t));
  const ev = t.engine.journal.find((x) => x.type === 'bascule.switched');
  assert.equal(ev.data.force, undefined, 'nothing was forced');
  assert.equal(t.engine.state.bascule.forced, null);
});

test('only the owner’s capability freezes, switches or ticks', async () => {
  const t = await salon();
  const barber = t.asStaff('Ali');
  await rejects(t.engine.run(freezeWordpress, {}, barber), 'forbidden');
  await rejects(t.engine.run(markSwitched, { force: true, reason: 'x' }, barber), 'forbidden');
  await rejects(t.engine.run(tickBascule, { item: 'licences', done: true }, barber), 'forbidden');
});

test('ticks: set once, unset, and only the known items', async () => {
  const t = await salon();
  await t.engine.run(tickBascule, { item: 'cold-backup', done: true }, owner(t));
  const at1 = t.engine.state.bascule.ticks['cold-backup'];
  assert.equal(at1, t.clock.now);
  t.clock.now += HOUR;
  await t.engine.run(tickBascule, { item: 'cold-backup', done: true }, owner(t));
  assert.equal(t.engine.state.bascule.ticks['cold-backup'], at1, 'a second tick changes nothing');
  assert.equal(t.engine.journal.filter((x) => x.type === 'bascule.ticked').length, 1);
  await t.engine.run(tickBascule, { item: 'cold-backup', done: false }, owner(t));
  assert.equal('cold-backup' in t.engine.state.bascule.ticks, false);
  await rejects(t.engine.run(tickBascule, { item: 'whatever', done: true }, owner(t)), 'invalid');
  // the steps follow the ticks
  await t.engine.run(tickBascule, { item: 'app-password', done: true }, owner(t));
  const b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'app-password').state, 'ok');
  assert.equal(step(b, 'cold-backup').state, 'todo');
  // WordPress's reminders: to do with the freeze, a warning when the freeze is noted and they are not
  assert.equal(step(b, 'reminders-off').state, 'todo');
  await t.engine.run(freezeWordpress, {}, owner(t));
  assert.equal(step(await basculeOf(rtOf(t)), 'reminders-off').state, 'warn');
  await t.engine.run(tickBascule, { item: 'reminders-off', done: true }, owner(t));
  assert.equal(step(await basculeOf(rtOf(t)), 'reminders-off').state, 'ok');
  // the licences are « info » until a month after the switch
  assert.equal(step(b, 'licences').state, 'info');
});

test('the licences become a to-do a month after the switch', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  await t.engine.run(markSwitched, { force: true, reason: 'test' }, owner(t));
  t.clock.now += 29 * 24 * HOUR;
  assert.equal(step(await basculeOf(rtOf(t)), 'licences').state, 'info');
  t.clock.now += 2 * 24 * HOUR;
  assert.equal(step(await basculeOf(rtOf(t)), 'licences').state, 'todo');
  await t.engine.run(tickBascule, { item: 'licences', done: true }, owner(t));
  assert.equal(step(await basculeOf(rtOf(t)), 'licences').state, 'ok');
});

test('providers: planned for the day before the switch, a gap after it', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  assert.equal(step(await basculeOf(rtOf(t)), 'providers').state, 'info');
  assert.match(step(await basculeOf(rtOf(t)), 'providers').line, /^Branchés au jour J/);
  await t.engine.run(markSwitched, { force: true, reason: 'test' }, owner(t));
  const none = step(await basculeOf(rtOf(t)), 'providers');
  assert.deepEqual([none.state, none.line], ['todo', 'Il manque : SMS, e-mail, adresse du site.']);
  const all = step(await basculeOf(rtOf(t, { cfg: { sms: { kind: 'brevo' }, email: { kind: 'brevo' }, publicUrl: 'https://barberlarchitecte.com' } })), 'providers');
  assert.equal(all.state, 'ok');
  // Vercel's provisional address is not the salon's own
  assert.match(step(await basculeOf(rtOf(t, { cfg: { sms: {}, email: {}, publicUrl: 'https://salon-xyz.vercel.app' } })), 'providers').line, /adresse du site/);
});

test('dns: Vercel’s address or CNAME is the new site, an IONOS address is not, a resolver error is a doubt', async () => {
  const t = await salon();
  const dns = (a, c) => async (host, type) => {
    const v = type === 'A' ? a : c;
    if (v instanceof Error) throw v;
    return v;
  };
  const noData = Object.assign(new Error('queryCname ENODATA'), { code: 'ENODATA' });
  const check = async (resolve) => step(await basculeOf(rtOf(t, { dnsResolve: resolve }), { domain: 'barberlarchitecte.com' }), 'dns');

  let d = await check(dns(['76.76.21.21'], noData));
  assert.deepEqual([d.state, d.line], ['ok', 'barberlarchitecte.com pointe vers le nouveau site.']);
  d = await check(dns(noData, ['cname.vercel-dns.com']));
  assert.equal(d.state, 'ok');
  d = await check(dns(['217.160.0.1'], noData));
  assert.equal(d.state, 'todo');
  assert.match(d.line, /pointe vers 217\.160\.0\.1, pas vers le nouveau site/);
  assert.equal((await check(dns(['216.198.79.1'], noData))).state, 'ok', 'the newer address');
  assert.equal((await check(dns(noData, ['3f2a9c1b.vercel-dns-017.com']))).state, 'ok', 'a project’s own CNAME');
  d = await check(dns(noData, noData));
  assert.equal(d.state, 'todo');
  assert.match(d.line, /n’a pas d’adresse/);
  d = await check(dns(new Error('queryA ESERVFAIL'), new Error('queryCname ESERVFAIL')));
  assert.equal(d.state, 'warn');
  assert.match(d.line, /^Vérification impossible : queryA ESERVFAIL$/);
  // no domain yet: the card asks for one
  const none = step(await basculeOf(rtOf(t)), 'dns');
  assert.deepEqual([none.state, none.field], ['todo', 'domain']);
  // the domain follows the public address, but not Vercel’s own
  assert.equal(domainOf(t.engine.state, { publicUrl: 'https://www.barberlarchitecte.com' }), 'barberlarchitecte.com');
  assert.equal(domainOf(t.engine.state, { publicUrl: 'https://salon-xyz.vercel.app' }), '');
  assert.equal(domainOf(t.engine.state, { publicUrl: 'http://localhost:3000' }), '');
  assert.equal(domainOf(t.engine.state, { publicUrl: '' }, 'ancien.autre.fr'), 'autre.fr');
  // what the browser remembers is a fallback: the public address wins over it, a typed domain over both
  assert.equal(domainOf(t.engine.state, { publicUrl: '' }, '', 'www.vieux.fr'), 'vieux.fr');
  assert.equal(domainOf(t.engine.state, { publicUrl: 'https://barberlarchitecte.com' }, '', 'vieux.fr'), 'barberlarchitecte.com');
  assert.equal(domainOf(t.engine.state, { publicUrl: 'https://barberlarchitecte.com' }, 'autre.fr', 'vieux.fr'), 'autre.fr');
});

test('the DNS answer is kept a minute, and « Vérifier » asks again', async () => {
  const t = await salon();
  let calls = 0;
  const rt = rtOf(t, { dnsResolve: async (h, type) => { calls++; if (type === 'A') return ['76.76.21.21']; throw Object.assign(new Error('x'), { code: 'ENODATA' }); } });
  await basculeOf(rt, { domain: 'a.fr' });
  const first = calls;
  await basculeOf(rt, { domain: 'a.fr' });
  assert.equal(calls, first, 'cached');
  await basculeOf(rt, { domain: 'a.fr', refresh: true });
  assert.ok(calls > first, 'asked again');
});

/** The live domain as the cases expect it, except the paths in `broken`. */
function liveSite(origin, broken = {}) {
  const by = new Map(CASES.map(([from, status, to]) => [origin + from, { status, to }]));
  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    if (Object.hasOwn(broken, String(url).slice(origin.length))) return new Response('Introuvable', { status: broken[String(url).slice(origin.length)] });
    const c = by.get(String(url));
    return new Response(null, { status: c.status, headers: { location: c.to } });
  };
  return { fetch, asked };
}

test('redirects: every old address is tried on the public address, one that answers 404 is named', async () => {
  const t = await salon();
  const origin = 'https://barberlarchitecte.com';
  const ok = liveSite(origin);
  let r = step(await basculeOf(rtOf(t, { fetch: ok.fetch, cfg: { publicUrl: origin } })), 'redirects');
  assert.equal(r.state, 'ok');
  assert.equal(r.line, CASES.length + ' anciennes adresses redirigent comme prévu.');
  assert.equal(ok.asked.filter((u) => u.startsWith(origin + '/')).length, CASES.length, 'each case once (the parked site is read from another host)');
  assert.ok(ok.asked.includes(origin + '/wp-sitemap-posts-page-1.xml'));

  const bad = liveSite(origin, { '/author/admin': 404 });
  r = step(await basculeOf(rtOf(t, { fetch: bad.fetch, cfg: { publicUrl: origin } })), 'redirects');
  assert.equal(r.state, 'err');
  assert.match(r.line, /^1 ancienne adresse sur \d+ ne redirige pas comme prévu : \/author\/admin → 404 \(sans Location\), attendu 308 \//);
  // a network failure on one address is named too, never thrown
  const down = async (url) => { if (String(url).endsWith('/news')) throw new Error('connect ECONNREFUSED'); return liveSite(origin).fetch(url); };
  r = step(await basculeOf(rtOf(t, { fetch: down, cfg: { publicUrl: origin } })), 'redirects');
  assert.equal(r.state, 'err');
  assert.match(r.line, /\/news → connect ECONNREFUSED/);
  // no public address, nothing to try
  assert.equal(step(await basculeOf(rtOf(t)), 'redirects').state, 'todo');
});

test('the parked old site: noindex by header or tag is fine, an indexable one is a warning, an unknown host is to do', async () => {
  const t = await salon();
  const page = (head, status = 200, headers = {}) => async () => new Response('<html><head>' + head + '</head></html>', { status, headers });
  const ancien = async (fetch, over = {}) => step(await basculeOf(rtOf(t, { dnsResolve: async () => ['203.0.113.7'], fetch, ...over }), { domain: 'barberlarchitecte.com' }), 'ancien');

  let a = await ancien(page('<meta name="robots" content="noindex, nofollow">'));
  assert.deepEqual([a.state, a.line], ['ok', 'ancien.barberlarchitecte.com répond et reste hors de Google.']);
  assert.equal((await ancien(page("<meta name='robots' content='noindex, nofollow' />"))).state, 'ok', 'WordPress writes single quotes');
  assert.equal((await ancien(page('', 200, { 'x-robots-tag': 'noindex, nofollow' }))).state, 'ok');
  a = await ancien(page('<meta name="description" content="noindex is a word">'));
  assert.equal(a.state, 'warn');
  assert.match(a.line, /répond mais reste indexable/);
  assert.equal((await ancien(page('', 404))).state, 'todo');
  // a redirect: the sub-domain exists, WordPress’s own addresses are not moved to it yet
  const moved = await ancien(page('', 301, { location: 'https://barberlarchitecte.com/' }));
  assert.equal(moved.state, 'todo');
  assert.match(moved.line, /renvoie vers https:\/\/barberlarchitecte\.com\/ : passe les deux adresses de WordPress/);
  assert.equal((await ancien(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { cause: { code: 'ENOTFOUND' } }); })).state, 'todo');
  assert.equal((await ancien(async () => { throw new Error('socket hang up'); })).state, 'warn');
  // never an address inside the datacenter, whatever the owner typed
  const privately = await ancien(page(''), { dnsResolve: async () => ['10.0.0.5'] });
  assert.equal(privately.state, 'warn');
  assert.match(privately.line, /adresse privée/);
  // IPv4-mapped IPv6 is the same private address
  for (const ip of ['::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a00:1', '0.0.0.0', '::']) assert.match((await ancien(page(''), { dnsResolve: async () => [ip] })).line, /adresse privée/, ip);
  // no address at all: nothing is fetched. An unknown name is to do, a resolver that failed is a doubt
  let fetched = 0;
  const counting = async () => { fetched++; return new Response(''); };
  assert.equal((await ancien(counting, { dnsResolve: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } })).state, 'todo');
  assert.equal((await ancien(counting, { dnsResolve: async () => { throw new Error('queryA ESERVFAIL'); } })).state, 'warn');
  assert.equal((await ancien(counting, { dnsResolve: async () => [] })).state, 'todo');
  assert.equal(fetched, 0);
  // only the first 64 KB of the page are read: a meta tag after them is not seen, and the stream is cut
  let pulled = 0;
  const endless = async () => new Response(new ReadableStream({ pull(c) { pulled++; c.enqueue(new TextEncoder().encode(' '.repeat(16384))); } }), { status: 200 });
  assert.equal((await ancien(endless)).state, 'warn');
  assert.ok(pulled < 10, 'stopped after ' + pulled + ' chunks');
  // the owner’s word stands when the check cannot say
  await t.engine.run(tickBascule, { item: 'ancien-noindex', done: true }, owner(t));
  assert.equal((await ancien(page('<meta name="description" content="x">'))).state, 'ok');
});

test('the demo reads « Démo » for every network check, and never touches the network', async () => {
  const rt = await demoRt();
  const calls = [];
  const b = await basculeOf({ ...rt, fetch: async (u) => { calls.push(u); throw new Error('no'); }, dnsResolve: async (h) => { calls.push(h); throw new Error('no'); } }, { domain: 'barberlarchitecte.com' });
  assert.deepEqual(calls, []);
  for (const id of ['dns', 'redirects', 'ancien']) {
    assert.equal(step(b, id).state, 'info');
    assert.match(step(b, id).line, /^Démo/);
  }
});

test('since: the bookings made here after the switch, the imported one left out, in the order of the agenda', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += HOUR;
  await run(t);
  // between the freeze and the switch the list starts at the freeze (the old site could not take it)
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 600 }, t.asOwner());
  assert.equal(takenHere(t.engine.state).length, 1);
  t.clock.now += HOUR;
  await t.engine.run(markSwitched, {}, owner(t));
  t.clock.now += HOUR;
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 3), start: 660 }, t.asOwner());
  await t.engine.run(A.createAppointment, { name: 'Passage =cmd', serviceIds: [t.ids.beard], staffId: t.ids.Ben, day: addDays(DAY, 2), start: 660 }, t.asOwner());
  const cancelled = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 4), start: 660 }, t.asOwner());
  await t.engine.run(A.cancelAppointment, { id: cancelled.id }, t.asOwner());

  const text = sinceCsv(t.engine.state);
  assert.equal(text.charCodeAt(0), 0xFEFF, 'UTF-8 BOM');
  const lines = text.slice(1).split('\r\n').filter(Boolean);
  assert.equal(lines[0], 'date;heure;barbier;prestations;client;téléphone;e-mail;état;pris le');
  // the imported one (5001) and the cancelled one are out; the one made between the freeze and the switch stays (WordPress
  // did not know it either); the others come in agenda order
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^05\/11\/2026;11:00;Ben;Coupe \+ barbe;Passage =cmd;;;confirmé;03\/11\/2026 14:00$/);
  assert.match(lines[2], /^06\/11\/2026;10:00;Ali;Coupe;Yanis Martin;06 12 34 56 78;;confirmé;03\/11\/2026 12:00$/);
  assert.match(lines[3], /^06\/11\/2026;11:00;Ali;Coupe;Yanis Martin;06 12 34 56 78;;confirmé;03\/11\/2026 14:00$/);
  const b = await basculeOf(rtOf(t));
  assert.equal(b.since.count, 3);
  assert.equal(b.since.at, t.engine.state.bascule.frozenAt, 'the list starts at the freeze');
});

test('since: nothing before the freeze, and a name that would be read as a formula is quoted', async () => {
  const t = await salon();
  await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: addDays(DAY, 2), start: 600 }, t.asOwner());
  assert.equal(sinceCsv(t.engine.state).slice(1).split('\r\n').filter(Boolean).length, 1, 'only the header');
  t.clock.now += HOUR;
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += HOUR;
  await t.engine.run(A.createAppointment, { name: '=HYPERLINK("http://x")', serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: addDays(DAY, 2), start: 660 }, t.asOwner());
  const lines = sinceCsv(t.engine.state).slice(1).split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes(';"\'=HYPERLINK(""http://x"")";'), lines[1]);
});

test('the routes: owner only, the CSV downloads, ticks and the switch go through the API', async () => {
  const rt = await demoRt();
  const o = browser(rt);
  assert.equal((await o.get('/api/v1/bascule')).status, 401);
  assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  await o.post('/api/auth/device', { name: 'Tablette' });
  const b = await o.get('/api/v1/bascule');
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.deepEqual(b.json.steps.map((x) => x.id), ['first-run', 'freeze', 'reminders-off', 'final-sync', 'cold-backup', 'dns', 'redirects', 'ancien', 'switch', 'providers', 'app-password', 'licences', 'ancien-removed']);
  assert.equal(b.json.hold.on, false);
  assert.equal((await o.get('/api/v1/bascule?domain=localhost')).status, 400);
  assert.equal((await o.get('/api/v1/bascule?domain=http://x.fr/a')).status, 400);

  const f = await o.post('/api/v1/bascule/freeze', {}, { 'x-request-id': 'freeze-0001' });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.ok(rt.engine.state.bascule.ticks['reminders-off'], 'the freeze also ticks WordPress’s reminders');
  assert.equal((await o.post('/api/v1/bascule/freeze', {}, { 'x-request-id': 'freeze-0001' })).status, 200, 'the same request answers the same');
  assert.equal((await o.post('/api/v1/bascule/freeze', {})).json.error.code, 'frozen');
  assert.equal((await o.post('/api/v1/bascule/switch', {})).json.error.code, 'not_ready');
  assert.equal((await o.post('/api/v1/bascule/tick', { item: 'cold-backup', done: true })).status, 200);
  assert.equal((await o.post('/api/v1/bascule/tick', { item: 'nope', done: true })).status, 400);
  assert.equal(step((await o.get('/api/v1/bascule')).json, 'cold-backup').state, 'ok');

  const csv = await o.get('/api/v1/bascule/since');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="rendez-vous-pris-ici-2026-11-03\.csv"$/);
  assert.match(csv.text, /^date;heure;barbier;prestations;client;téléphone;e-mail;état;pris le\r\n/, 'the response decoder drops the BOM; sinceCsv’s own test reads it');

  // a barber on a salon tablet sees none of it
  await o.post('/api/auth/logout');
  const st = await o.get('/api/auth/state');
  const jkut = st.json.team.find((x) => x.name === 'JKut');
  assert.equal((await o.post('/api/auth/pin', { staffId: jkut.id, pin: DEMO.pins.JKut })).status, 200);
  for (const p of ['/api/v1/bascule', '/api/v1/bascule/since', '/api/v1/features']) assert.equal((await o.get(p)).status, 403, p);
  for (const p of ['/api/v1/bascule/freeze', '/api/v1/bascule/switch', '/api/v1/bascule/tick']) assert.equal((await o.post(p, { item: 'licences', done: true })).status, 403, p);
});

test('csv: a foreign phone number is not quoted, a text that would be read as a formula is', () => {
  const text = csv([['+41 79 123 45 67', '+33612345678', '+cmd|calc', '=1+1', '-5', '@sum', 'a;b']]);
  // the shared writer (lib/csv.js): a plain amount like -5 is a number in Excel, not a formula
  assert.equal(text.slice(1), '+41 79 123 45 67;+33612345678;\'+cmd|calc;\'=1+1;-5;\'@sum;"a;b"\r\n');
});

test('health: texts held for the switch are not a scheduler that stopped, and neither are those that waited for it', async () => {
  const t = await salon();
  await run(t, [row(t, 5001)]);
  // the evening summary leaves at 18:00 (a text has gone: the lateness has its `from`), then the client’s reminder is queued and held
  t.clock.now = at(DAY, 18, 0);
  await q(t, { key: 'digest', template: 'digest', to: '+33699999999', vars: {}, text: 'Résumé du soir' });
  const sms = fakeSms();
  const rt = () => rtOf(t, { sms, pay: { name: 'simulated' }, lastTick: Date.now() });
  await dispatch(rt());
  assert.equal(sms.sent.length, 1);
  t.clock.now = at(DAY, 19, 0);
  await runTick(t);
  const rem = [...t.engine.state.messages.values()].find((m) => m.template === 'reminder' && m.cid);
  await dispatch(rt());
  assert.equal(get(t, rem.id).status, 'queued');
  t.clock.now += 2 * HOUR;
  const L = () => localParts(t.clock.now);
  let h = await healthOf(rt(), L());
  assert.equal(h.tick.overdue, 0, 'held, not forgotten');
  assert.equal(h.tick.late24h, 0);
  // the switch: what was due before it and goes out after it is not late either
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += 5 * 60000;
  await run(t);
  await t.engine.run(markSwitched, {}, owner(t));
  t.clock.now += 5 * 60000;
  await dispatch(rt());
  t.clock.now += 5 * 60000;
  h = await healthOf(rt(), L());
  assert.equal(h.tick.overdue, 0);
  assert.equal(h.tick.late24h, 0, 'the delay was the hold');
});

test('features: each settings section’s golive, one row each, and one that fails does not hide the others', async () => {
  const rt = await demoRt();
  const f = featuresOf(rt.engine.state, rt);
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('membership') && ids.includes('fiscal'), ids.join());
  const m = f.find((x) => x.id === 'membership');
  assert.deepEqual([m.label, m.on, m.blocker, m.to], ['Abonnements', true, '', 'paiements'], 'on in the demo');
  // the signing key of the demo is the public one: the row says what it waits for
  const k = f.find((x) => x.id === 'fiscal');
  assert.deepEqual([k.label, k.on, k.blocker], ['Clé de signature', false, 'clé de la démo']);
  // a production salon: memberships wait for the lawyer
  const t = await salon();
  const p = featuresOf(t.engine.state, { signer: { source: 'store' } });
  assert.deepEqual(p.find((x) => x.id === 'membership'), { id: 'membership', label: 'Abonnements', on: false, blocker: 'En attente de la relecture des CGV', to: 'paiements' });
  assert.equal(p.find((x) => x.id === 'fiscal').blocker, 'gardée avec les données');
  // a section whose state() throws: the others are still returned, the failing one says it could not check
  const stub = [{ key: 'a', golive: { label: 'A', state: () => ({ on: true }) } }, { key: 'b', golive: { label: 'B', state: () => { throw new Error('boum'); } } }, { key: 'c', golive: { label: 'C', state: () => ({ on: false, blocker: 'attend' }) } }];
  const bad = featuresOf(rt.engine.state, rt, stub);
  assert.deepEqual(bad.map((x) => [x.id, x.on, x.blocker]), [['a', true, ''], ['b', false, 'Vérification impossible : boum'], ['c', false, 'attend']]);
  // the route
  const o = browser(rt);
  await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  const r = await o.get('/api/v1/features');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.features.map((x) => x.id), ids);
});
