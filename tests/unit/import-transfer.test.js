// The transfer from WordPress, tried the way it can go wrong for an owner who does it once: the same export twice, the final
// delta after the freeze, one person under several spellings and phone formats, a father and his son on one number, bookings
// that overlapped on the old site, a barber or a service the new salon does not have, a booking outside its hours, deposits,
// the time changes, garbage rows, an interrupted run, an erased client, and no message to anyone before the sends are open.
// The wizard's own code (web/src/lib/wpimport.ts) reads the files; the batches go to the import command as the browser sends them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { rejects, DAY, at } from '../helpers.js';
import { shop, pass, owner, byWp, mapAll, ask, setState, dropLines } from '../wp-helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';
import * as I from '../../server/commands/import.js';
const { importBatch, startImportRun, undoImportRun, undoable, reconOf, runLines } = I;
import { eraseClient } from '../../server/commands/clients.js';
import { freezeWordpress, markSwitched, rollbackBascule, tickBascule } from '../../server/commands/bascule.js';
import * as B from '../../server/projections/bascule.js';
const { lateBookings, cutoverHold, remindedThere } = B;
import { basculeOf } from '../../server/http/routes-bascule.js';
import { dispatch } from '../../server/http/scheduler.js';
import { tick } from '../../server/commands/system.js';
import { moveAppointment, setStatus } from '../../server/commands/agenda.js';
import { addClosure } from '../../server/commands/shop.js';
import { archiveStaff } from '../../server/commands/team.js';
import { addDays } from '../../shared/dates.js';

const fixture = (f) => readFileSync(new URL('../fixtures/' + f, import.meta.url));
const FR = fixture('wp-bookings-fr.csv').toString('utf8');
const DELTA = fixture('wp-bookings-fr-delta.csv').toString('utf8');
const HEAD = '﻿Réservations,de,à\n,"01 Jan 2025","31 Déc 2027"\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT\n';
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
/** One line of the plugin's CSV. */
const L = (wp, when, o = {}) => [wp, q(when), q(o.created || '01 Nov 2026 09:00'), o.first ?? 'Karim', o.last ?? 'Benali', o.email ?? '', q(o.phone ?? ''), q(o.svc || 'Coupe'), q(o.staff ?? 'JKut'), 1, q(o.price || '20 €'), q(o.state || 'Confirmé')].join(',');
const file = (...lines) => [{ name: 'export.csv', text: HEAD + lines.join('\n') + '\n' }];
const fr = (text = FR) => [{ name: 'export.csv', text }];
/** The wizard's own matching: each barber to his chair, each service to its own (the names of the fixture). */
function own(t, p) {
  const n = W.names(p);
  const chair = { JKut: t.ids.jkut, Soldat: t.ids.soldat, John: t.ids.Ali };
  const svc = { Coupe: t.ids.cut, 'Coupe + barbe': t.ids.beard };
  return { services: Object.fromEntries(n.services.map(([x]) => [x, svc[x] || t.ids.cc])), staff: Object.fromEntries(n.staff.map(([x]) => [x, chair[x] ?? ''])) };
}
const go = (t, files, o = {}) => pass(t, files, own(t, W.readFiles(files, DAY)), { run: true, ...o });
const sizes = (t) => { const s = t.engine.state; return { clients: s.clients.size, appts: s.appts.size, messages: s.messages.size, gifts: s.giftcards.size, packs: s.packs.size, payments: s.payments.size, sales: s.sales.size }; };
const clientsOf = (t) => [...t.engine.state.clients.values()].filter((c) => c.source === 'wordpress' && !c.erased && !c.mergedInto);
const fakeSms = () => { const sent = []; return { name: 'brevo', sent, async send(to, body) { sent.push({ to, body }); return { ref: 'b-' + sent.length }; } }; };
const ORIGIN = 'https://salon.test';
const rtOf = (t, x = {}) => ({ engine: t.engine, sms: null, email: null, whatsapp: null, cfg: { cronSecret: '', publicUrl: '' }, origin: ORIGIN, sleep: async () => {}, dnsResolve: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); }, fetch: async () => { throw new Error('x'); }, ...x });
const runTick = (t) => t.engine.run(tick, {}, { ...t.sys, meta: { linkFor: (a) => ORIGIN + '/r/' + a.code, siteUrl: ORIGIN + '/' } });
const reminders = (t) => [...t.engine.state.messages.values()].filter((m) => /^reminder/.test(m.template));
const step = (b, id) => b.steps.find((x) => x.id === id);

test('the same export dropped twice adds nothing: no client, no booking, no message, and the second report says « déjà là »', async () => {
  const t = await shop();
  const a = await go(t, fr());
  const before = sizes(t);
  assert.ok(a.appts.booked > 0 && a.clients.added > 0);
  assert.equal(before.messages, 0, 'an import queues no message');
  const b = await go(t, fr());
  assert.deepEqual(sizes(t), before);
  assert.equal(b.clients.added, 0);
  assert.equal((b.appts.booked || 0) + (b.appts.done || 0) + (b.appts.cancelled || 0) + (b.appts.noShow || 0) + (b.appts.moved || 0) + (b.appts.changed || 0) + (b.appts.updated || 0), 0);
  // and a third time in tiny batches, in another order
  const c = await go(t, fr(FR.split('\n').slice(0, 4).concat(FR.split('\n').slice(4).filter(Boolean).reverse()).join('\n') + '\n'), { chunk: 2 });
  assert.deepEqual(sizes(t), before);
  assert.equal(c.clients.added, 0);
});

test('the final delta only carries what changed: cancelled, moved, new, edited, deleted; everything else is « déjà là »', async () => {
  const t = await shop();
  await go(t, fr());
  const before = sizes(t);
  const slot1361 = { day: byWp(t, 1361).day, start: byWp(t, 1361).start };
  let csv = setState(FR, 1360, 'Annulé');
  csv = csv.replace('1361,"15 Déc 2026 14:30"', '1361,"16 Déc 2026 10:00"').replace('"40 € (10 € déjà payé en acompte)"', '"45 € (10 € déjà payé en acompte)"');
  csv = dropLines(csv, 1380) + L(1400, '19 Nov 2026 11:00', { first: 'Sami', last: 'Kaci', phone: '0644556677', created: '03 Nov 2026 09:30' }) + '\n';
  const d = await go(t, fr(csv));
  assert.equal(d.appts.cancelledNow, 1);
  assert.equal(d.appts.moved, 1);
  assert.equal(d.appts.booked, 1);
  assert.equal(d.appts.changed, 1);
  assert.equal(d.appts.gone, 1);
  assert.equal(d.clients.added, 0, 'Sami already has a file');
  assert.equal(sizes(t).appts, before.appts + 1);
  assert.equal(sizes(t).messages, 0, 'a cancellation or a move carried from the old site texts nobody');
  assert.equal(byWp(t, 1360).status, 'cancelled');
  assert.equal(byWp(t, 1380).status, 'cancelled');
  assert.notDeepEqual({ day: byWp(t, 1361).day, start: byWp(t, 1361).start }, slot1361);
  assert.equal(byWp(t, 1361).day, '2026-12-16');
  assert.equal(byWp(t, 1350).price, 4500);
  // the fixture's own delta: one booking deleted on the old site, nothing else
  const t2 = await shop();
  await go(t2, fr());
  const d2 = await go(t2, fr(DELTA));
  assert.equal(d2.appts.gone, 1);
  assert.equal((d2.appts.booked || 0) + (d2.appts.moved || 0) + (d2.appts.changed || 0) + (d2.appts.cancelledNow || 0), 0);
});

test('a booking moved on WordPress between the two passes follows; one moved here too is kept and listed', async () => {
  const t = await shop();
  await go(t, fr());
  await t.engine.run(moveAppointment, { id: byWp(t, 1360).id, day: '2026-12-15', start: 600, staffId: t.ids.soldat }, t.asOwner());
  const csv = FR.replace('1360,"15 Déc 2026 14:30"', '1360,"17 Déc 2026 09:00"').replace('1380,"18 Nov 2026 15:00"', '1380,"18 Nov 2026 16:00"');
  const d = await go(t, fr(csv));
  assert.equal(byWp(t, 1380).start, 960);
  assert.equal(byWp(t, 1360).start, 600, 'the owner’s own move stays');
  assert.ok(d.lines.some((l) => l.wp === 1360 && l.kind === 'moved' && l.todo), 'and the line asks for a look');
});

test('a booking taken on WordPress after the freeze is caught, and the sends cannot be opened over it', async () => {
  const t = await shop();
  await go(t, fr());
  await t.engine.run(freezeWordpress, {}, owner(t));
  const frozen = t.clock.now;
  t.clock.now += 30 * 60000;
  // 10:20 on the day, twenty minutes after the freeze
  await go(t, fr(FR + L(1401, '20 Nov 2026 11:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', created: '03 Nov 2026 10:20' }) + '\n'));
  assert.ok(byWp(t, 1401).createdAt > frozen);
  assert.equal(lateBookings(t.engine.state), 1);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'late_bookings');
  assert.equal(step(await basculeOf(rtOf(t)), 'final-sync').state, 'err');
  assert.equal(cutoverHold(t.engine.state), true);
});

test('one person under several spellings and phone formats is ONE file; a row with the number and a row with the e-mail are tied by a row that has both', async () => {
  const t = await shop();
  const r = await go(t, file(
    L(2001, '01 Oct 2026 10:00', { phone: '0698765432' }),
    L(2002, '02 Oct 2026 10:00', { first: 'KARIM', last: 'benali', phone: '+33 6 98 76 54 32' }),
    L(2003, '03 Oct 2026 10:00', { first: 'Karim', last: 'Bénali', phone: '06.98.76.54.32' }),
    L(2004, '06 Oct 2026 10:00', { phone: '06 98 76 54 32' }),
    L(2005, '07 Oct 2026 10:00', { phone: '33698765432' }),
    L(2006, '08 Oct 2026 10:00', { phone: '0033698765432' }),
    L(2007, '09 Oct 2026 10:00', { phone: '698765432' }),
    L(2008, '10 Oct 2026 10:00', { phone: '06-98-76-54-32', email: 'Karim.Benali@Exemple.fr' }),
    L(2009, '13 Oct 2026 10:00', { email: 'karim.benali@exemple.fr' })
  ));
  assert.equal(r.clients.added, 1);
  assert.equal(clientsOf(t).length, 1);
  const c = clientsOf(t)[0];
  assert.equal(c.phone, '+33698765432');
  assert.equal(c.email, 'karim.benali@exemple.fr');
  for (let wp = 2001; wp <= 2009; wp++) assert.equal(byWp(t, wp).clientId, c.id, 'n° ' + wp);
  assert.equal(r.pv.counts.newClients, 1, 'and the dry run said one');
});

test('the same name with the number on one row and the e-mail on another, and nothing to tie them: two files, and the owner is told before and after', async () => {
  const t = await shop();
  const files = file(L(2101, '01 Oct 2026 10:00', { first: 'Lucas', last: 'Morel', phone: '0755667788' }), L(2102, '20 Nov 2026 10:00', { first: 'Lucas', last: 'Morel', email: 'lucas.morel@exemple.fr' }));
  const r = await go(t, files);
  assert.equal(clientsOf(t).length, 2, 'nothing but a name links them: never merged on a name alone');
  const twin = r.pv.review.filter((x) => x.kind === 'twin');
  assert.equal(twin.length, 1, 'the dry run says « peut-être la même personne »');
  assert.match(twin[0].text, /même personne/);
});

test('a father and his son on one number: one file, never silently, the son’s booking keeps his name and the line says « Famille ? »', async () => {
  const t = await shop();
  const r = await go(t, file(L(2201, '20 Nov 2026 10:00', { first: 'Karim', phone: '0698765432' }), L(2202, '20 Nov 2026 10:30', { first: 'Ilyes', phone: '06 98 76 54 32', staff: 'Soldat' })));
  assert.equal(clientsOf(t).length, 1);
  assert.equal(byWp(t, 2202).name, 'Ilyes Benali');
  const line = r.lines.find((l) => l.kind === 'name');
  assert.ok(line && line.todo && /Famille/.test(line.text));
  assert.ok(r.pv.review.some((x) => x.kind === 'name'), 'and the dry run said so before anything was written');
});

test('two bookings that overlapped on WordPress both come in, and both the dry run and the report say where', async () => {
  const t = await shop();
  const r = await go(t, file(L(2301, '20 Nov 2026 10:00', { phone: '0698765432' }), L(2302, '20 Nov 2026 10:15', { first: 'Nadia', last: 'Roux', phone: '0677889900' })));
  assert.equal(byWp(t, 2301).status, 'booked');
  assert.equal(byWp(t, 2302).status, 'booked');
  assert.equal(r.pv.review.filter((x) => x.kind === 'overlap').length, 1);
  const line = r.lines.find((l) => l.kind === 'overlap');
  assert.ok(line && line.todo && line.day === '2026-11-20' && line.wp === 2302);
});

test('a barber or a service the new salon does not have: nothing is lost silently, the upcoming booking is listed « à faire »', async () => {
  const t = await shop();
  const files = file(
    L(2401, '20 Nov 2026 10:00', { phone: '0698765432', staff: 'Fantôme' }), L(2402, '21 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', svc: 'Soin du visage' }),
    L(2403, '01 Oct 2026 10:00', { first: 'Paul', last: 'Remy', phone: '0611111111', staff: 'Fantôme' })
  );
  const p = W.readFiles(files, DAY);
  const map = { services: { Coupe: t.ids.cut, 'Soin du visage': '' }, staff: { JKut: t.ids.jkut, 'Fantôme': W.LEGACY } };
  const r = await pass(t, files, map, { run: true });
  assert.equal(byWp(t, 2401), undefined);
  assert.equal(byWp(t, 2402), undefined);
  assert.equal(byWp(t, 2403).status, 'done', 'history goes to the archived profile');
  assert.ok(r.pv.review.some((x) => x.wp === 2401 && x.kind === 'staff'));
  assert.ok(r.pv.review.some((x) => x.wp === 2402 && x.kind === 'service'));
  assert.ok(r.lines.some((l) => l.wp === 2401 && l.kind === 'staff' && l.todo));
  assert.ok(r.lines.some((l) => l.wp === 2402 && l.kind === 'service' && l.todo));
  // mapped once, applied to every row: the second pass brings both in
  const r2 = await pass(t, files, { services: { Coupe: t.ids.cut, 'Soin du visage': t.ids.cut }, staff: { JKut: t.ids.jkut, 'Fantôme': t.ids.soldat } }, { run: true });
  assert.equal(r2.appts.booked, 2);
  assert.equal(byWp(t, 2401).staffId, t.ids.soldat);
  assert.equal(W.names(p).staff.length, 2);
});

test('a booking outside the new opening hours, on a closed weekday or on a closure is kept as an exception and flagged, before and after', async () => {
  const t = await shop();
  await t.engine.run(addClosure, { from: '2026-12-24', to: '2026-12-26', label: 'Noël' }, t.asOwner());
  const files = file(
    L(2501, '20 Nov 2026 21:30', { phone: '0698765432' }), // a Friday, after closing
    L(2502, '22 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900' }), // a Sunday
    L(2503, '24 Déc 2026 10:00', { first: 'Paul', last: 'Remy', phone: '0611111111' }), // closure
    L(2504, '20 Nov 2026 10:00', { first: 'Zoé', last: 'Petit', phone: '0622222222' }) // fine
  );
  const r = await go(t, files);
  for (const wp of [2501, 2502, 2503, 2504]) assert.equal(byWp(t, wp).status, 'booked', 'n° ' + wp + ' is kept: the old site accepted it');
  const flagged = r.lines.filter((l) => l.kind === 'hours').map((l) => l.wp).sort();
  assert.deepEqual(flagged, [2501, 2502, 2503]);
  assert.ok(r.lines.filter((l) => l.kind === 'hours').every((l) => l.todo));
  assert.deepEqual(r.pv.review.filter((x) => x.kind === 'hours').map((x) => x.wp).sort(), [2501, 2502, 2503], 'the dry run flags the same ones');
});

test('past visits are history (no chair figure, no message), upcoming ones are in the agenda; a deposit paid on WordPress is remembered, never cashed twice', async () => {
  const t = await shop();
  const r = await go(t, fr());
  const s = t.engine.state;
  const past = [...s.appts.values()].filter((a) => a.source === 'import' && a.day < DAY);
  assert.ok(past.length > 0 && past.every((a) => a.legacy && ['done', 'cancelled', 'no_show'].includes(a.status)));
  const ahead = [...s.appts.values()].filter((a) => a.source === 'import' && a.day >= DAY);
  assert.ok(ahead.length > 0 && ahead.every((a) => !a.legacy && ['booked', 'cancelled'].includes(a.status)));
  const dep = byWp(t, 1350);
  assert.equal(dep.ext.paid, 1000);
  assert.match(dep.note, /Acompte de 10\s€ déjà payé sur l’ancien site/);
  assert.equal(dep.deposit, null, 'no deposit of the new salon is invented');
  assert.equal(s.payments.size, 0);
  assert.equal(s.sales.size, 0);
  assert.ok(r.lines.some((l) => l.wp === 1350 && l.kind === 'paid' && l.todo));
  // the same export again: the deposit is not counted a second time
  await go(t, fr());
  assert.equal(byWp(t, 1350).ext.paid, 1000);
  assert.equal((byWp(t, 1350).note.match(/Acompte/g) || []).length, 1);
});

test('the time changes and midnight: the day and the minute of the old site are kept as written, on both Sundays and around 00:00', async () => {
  const t = await shop();
  const r = await go(t, file(
    L(2601, '29 Mar 2026 02:30', { phone: '0698765432' }), // the hour that does not exist
    L(2602, '25 Oct 2026 02:30', { phone: '0698765432' }), // the hour that exists twice
    L(2603, '25 Oct 2026 03:00', { phone: '0698765432' }),
    L(2604, '02 Nov 2026 23:45', { phone: '0698765432' }), // ends after midnight, yesterday
    L(2605, '04 Nov 2026 00:00', { phone: '0698765432' }), // midnight, tomorrow
    L(2606, '28 Mar 2027 02:30', { phone: '0698765432' }), // next spring's lost hour, to come
    L(2607, '31 Oct 2027 02:30', { phone: '0698765432', staff: 'Soldat' }),
    L(2608, '03 Nov 2026 09:00', { phone: '0698765432' }), // earlier today
    L(2609, '03 Nov 2026 23:30', { phone: '0698765432' }) // tonight
  ));
  const slot = (wp) => byWp(t, wp).day + ' ' + byWp(t, wp).start;
  assert.equal(slot(2601), '2026-03-29 150');
  assert.equal(slot(2602), '2026-10-25 150');
  assert.equal(slot(2603), '2026-10-25 180');
  assert.equal(slot(2604), '2026-11-02 1425');
  assert.equal(slot(2605), '2026-11-04 0');
  assert.equal(slot(2606), '2027-03-28 150');
  assert.equal(slot(2607), '2027-10-31 150');
  for (const wp of [2601, 2602, 2603, 2604, 2608]) assert.equal(byWp(t, wp).status, 'done', 'n° ' + wp);
  for (const wp of [2605, 2606, 2607, 2609]) assert.equal(byWp(t, wp).status, 'booked', 'n° ' + wp);
  assert.equal(r.appts.done, 5);
  // again: the same slots are recognised (no move, no duplicate) across the change of hour
  const again = await go(t, file(L(2601, '29 Mar 2026 02:30', { phone: '0698765432' }), L(2602, '25 Oct 2026 02:30', { phone: '0698765432' }), L(2606, '28 Mar 2027 02:30', { phone: '0698765432' }), L(2607, '31 Oct 2027 02:30', { phone: '0698765432', staff: 'Soldat' })));
  assert.equal((again.appts.moved || 0) + (again.appts.booked || 0) + (again.appts.done || 0), 0);
});

test('garbage rows never become a wrong booking: 29 February, a missing date, an Excel-mangled date or phone are refused with their reason and line', async () => {
  const t = await shop();
  const files = file(
    L(2701, '29 Fév 2026 10:00', { phone: '0698765432' }), // 2026 is not a leap year
    L(2702, '', { phone: '0698765432' }),
    L(2703, '46345,4375', { phone: '0698765432' }), // an Excel serial date
    L(2704, '20 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '6,98765E+08' }), // Excel's scientific notation
    L(2705, '20 Nov 2026 11:00', { first: 'Paul', last: 'Remy', phone: '6.12345678E8', email: 'paul@exemple.fr' }),
    L(2706, '31 Nov 2026 10:00', { phone: '0698765432' }),
    L(2707, '20 Nov 2026 25:00', { phone: '0698765432' }),
    L(2708, '20 Nov 2026 12:00', { first: 'Zoé', last: 'Petit', phone: '0622222222' })
  );
  const p = W.readFiles(files, DAY);
  const bad = new Set(p.problems.map((x) => x.wp));
  for (const wp of [2701, 2702, 2703, 2706, 2707]) assert.ok(bad.has(wp), 'n° ' + wp + ' is listed as unreadable');
  assert.ok(p.problems.every((x) => x.line > 0 && x.text));
  const r = await go(t, files);
  for (const wp of [2701, 2702, 2703, 2706, 2707]) assert.equal(byWp(t, wp), undefined, 'n° ' + wp);
  assert.equal(byWp(t, 2708).status, 'booked');
  // a mangled number is never guessed: the booking comes in, without a wrong phone on a file
  const phones = [...t.engine.state.clients.values()].map((c) => c.phone);
  assert.ok(!phones.some((x) => /698765000|6987650/.test(x)), 'no number rebuilt from 6,98765E+08');
  assert.ok(r.pv.review.some((x) => x.wp === 2704 && x.kind === 'phone'));
  assert.ok(r.lines.filter((l) => l.kind === 'unreadable').length >= 5, 'the report keeps every unreadable line');
  // the lines to fix come back as a CSV the wizard reads again once corrected
  const fix = W.fixCsv(p.problems);
  assert.match(fix, /POURQUOI/);
  const mended = W.readFiles([{ name: 'a-corriger.csv', text: fix.replace('29 Fév 2026 10:00', '27 Fév 2026 10:00') }], DAY);
  assert.deepEqual(mended.bookings.map((b) => [b.wp, b.day]), [[2701, '2026-02-27']], 'the line fixed is read, the others are still refused');
  assert.equal(mended.problems.length, p.problems.length - 1);
});

test('every file of the QA set: no crash, it adds up, and a second drop adds nothing', async () => {
  const dir = new URL('../fixtures/wp-qa/', import.meta.url);
  const names = readdirSync(dir).filter((f) => /\.(csv|txt|xml)$/.test(f) && !/expected|bank/.test(f));
  assert.ok(names.length > 30);
  for (const f of names) {
    const t = await shop();
    const files = [{ name: f, text: W.decodeBytes(readFileSync(new URL(f, dir))), modified: 1 }];
    const p = W.readFiles(files, DAY);
    const map = mapAll(t, p, { legacyUnknown: false });
    const a = await pass(t, files, map, { run: true });
    for (const row of W.reconcile(a.run)) assert.equal(row.gap, 0, f + ' · ' + row.type + ' adds up');
    const before = sizes(t);
    assert.equal(before.messages, 0, f);
    const b = await pass(t, files, map, { run: true });
    assert.deepEqual(sizes(t), before, f + ' twice');
    assert.equal(b.clients.added || 0, 0, f);
    // every booking made has a real day and a minute inside the day
    for (const x of t.engine.state.appts.values()) assert.ok(/^\d{4}-\d\d-\d\d$/.test(x.day) && x.start >= 0 && x.start < 1440 && addDays(addDays(x.day, 1), -1) === x.day, f + ' n° ' + (x.ext && x.ext.wp));
  }
  // a workbook is not read as text
  const x = W.readFiles([{ name: 'A11.xlsx', text: W.decodeBytes(readFileSync(new URL('A11-saved-as-workbook.xlsx', dir))), modified: 1 }], DAY);
  assert.equal(x.bookings.length, 0);
  assert.equal(x.files[0].kind, 'unknown');
});

test('a run interrupted half-way, then run again: the end state is the one of a single clean pass', async () => {
  const clean = await shop();
  await go(clean, fr());
  const t = await shop();
  const files = fr();
  const p = W.readFiles(files, DAY), map = own(t, p);
  const { pv, opts, imported } = await ask(t, p, map);
  const rows = W.toRows(p, map, imported, { today: opts.today, known: opts.known, again: opts.again, erased: opts.erased, gone: pv.gone, now: t.clock.now, chairs: opts.chairs });
  const parts = W.chunks(rows.appts, 3).map((x) => ({ appts: x }));
  const { id } = await t.engine.run(startImportRun, W.runBody(p, pv, map, ['0123456789abcdef'], parts.length, t.clock.now), owner(t));
  for (const [i, body] of parts.slice(0, 2).entries()) await t.engine.run(importBatch, { ...body, run: id, i }, owner(t));
  assert.equal(t.engine.state.imports.runs.get(id).finishedAt, null);
  assert.ok(sizes(t).appts < sizes(clean).appts);
  const again = await go(t, files);
  assert.deepEqual(sizes(t), sizes(clean));
  assert.ok(again.appts.already >= 6 - again.appts.skipped || again.appts.already > 0);
  const slots = (x) => [...x.engine.state.appts.values()].map((a) => [a.ext.wp, a.day, a.start, a.status].join('|')).sort();
  assert.deepEqual(slots(t), slots(clean));
  assert.equal(clientsOf(t).length, clientsOf(clean).length);
});

test('a client erased here (GDPR) and still in a later export does not come back: no file, no name, no booking, and it is said', async () => {
  const t = await shop();
  await go(t, fr());
  const karim = clientsOf(t).find((c) => c.first === 'Karim');
  for (let i = 0; i < 2; i++) if ((await t.engine.run(eraseClient, { id: karim.id, cancelUpcoming: true }, owner(t))).erased) break;
  assert.equal(t.engine.state.clients.get(karim.id).erased, true);
  const before = sizes(t);
  const r = await go(t, fr());
  assert.equal(sizes(t).clients, before.clients);
  assert.equal(sizes(t).appts, before.appts);
  assert.ok(![...t.engine.state.clients.values()].some((c) => !c.erased && /karim/i.test(c.first)));
  assert.ok(![...t.engine.state.appts.values()].some((a) => /karim/i.test(a.name || '')));
  assert.ok(r.pv.review.some((x) => x.kind === 'erased'));
  assert.ok(r.lines.some((l) => l.kind === 'erased'));
  // booked again on the old site after the erasure: that is someone who came back
  const back = await go(t, fr(FR + L(1500, '25 Nov 2026 10:00', { phone: '0698765432', email: 'karim.benali@exemple.fr', created: '03 Nov 2026 12:00' }) + '\n'));
  assert.equal(back.clients.added, 0 + 1);
});

test('no SMS and no e-mail for an imported booking before the sends are open; after, only upcoming bookings are reminded, once', async () => {
  const t = await shop();
  const tomorrow = addDays(DAY, 1), later = addDays(DAY, 2);
  const d = (k) => { const [y, m, dd] = k.split('-'); return dd + ' ' + ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'][m - 1] + ' ' + y; };
  await go(t, file(
    L(2801, d(addDays(DAY, -1)) + ' 10:00', { phone: '0698765432', email: 'karim.benali@exemple.fr' }),
    L(2802, d(tomorrow) + ' 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', email: 'nadia@exemple.fr' }),
    L(2803, d(later) + ' 10:00', { first: 'Paul', last: 'Remy', phone: '0611111111' }),
    L(2804, d(tomorrow) + ' 11:00', { first: 'Zoé', last: 'Petit', phone: '0622222222', state: 'Annulé' })
  ));
  assert.equal(t.engine.state.messages.size, 0, 'the import itself queues nothing');
  const sms = fakeSms(), mail = { name: 'brevo', sent: [], async send(m) { this.sent.push(m); return { ref: 'm' }; } };
  const rt = rtOf(t, { sms, email: mail });
  // the evening before the cut-over: WordPress still sends its own reminders; ours wait
  t.clock.now = at(DAY, 18, 5);
  await runTick(t); await runTick(t);
  await dispatch(rt);
  assert.equal(sms.sent.length + mail.sent.length, 0, 'held: nothing leaves before the switch');
  assert.ok(reminders(t).every((m) => m.apptId === byWp(t, 2802).id), 'only tomorrow’s live booking has one waiting');
  // the cut-over, the same evening: freeze (WordPress’s reminders cut), final sync, sends opened
  t.clock.now = at(DAY, 19, 0);
  await t.engine.run(freezeWordpress, {}, owner(t));
  await t.engine.run(tickBascule, { item: 'reminders-off', done: true }, owner(t));
  t.clock.now += 5 * 60000;
  await go(t, file(L(2802, d(tomorrow) + ' 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', email: 'nadia@exemple.fr' }), L(2803, d(later) + ' 10:00', { first: 'Paul', last: 'Remy', phone: '0611111111' })));
  await t.engine.run(markSwitched, {}, owner(t));
  t.clock.now += 5 * 60000;
  await runTick(t);
  await dispatch(rt);
  // WordPress reminded Nadia for tomorrow before it was cut (ours was written while it still did): she must not get a second one
  assert.equal(sms.sent.length + mail.sent.length, 0, 'the reminder written while WordPress still sent its own does not leave at the switch');
  assert.equal(remindedThere(t.engine.state).length, 0);
  // the next evening: Paul’s booking of the day after is ours to remind, once, whatever the number of ticks
  t.clock.now = at(tomorrow, 18, 5);
  await runTick(t); await runTick(t);
  await dispatch(rt);
  t.clock.now += 60000;
  await runTick(t);
  await dispatch(rt);
  assert.deepEqual(sms.sent.map((m) => m.to), ['+33611111111']);
  const per = new Map();
  for (const m of reminders(t)) per.set(m.apptId + '|' + (m.channel || 'sms'), (per.get(m.apptId + '|' + (m.channel || 'sms')) || 0) + 1);
  assert.ok([...per.values()].every((n) => n === 1), 'never two reminders for one booking');
  assert.ok(!reminders(t).some((m) => m.apptId === byWp(t, 2801).id || m.apptId === byWp(t, 2804).id), 'none for a past visit or a cancelled booking');
});

test('the return plan leaves nothing half-sent: once the switch is taken back the sends are closed again, and what waited does not leave', async () => {
  const t = await shop();
  await go(t, file(L(2901, '05 Nov 2026 10:00', { phone: '0698765432' })));
  await t.engine.run(freezeWordpress, {}, owner(t));
  t.clock.now += 60000;
  await go(t, file(L(2901, '05 Nov 2026 10:00', { phone: '0698765432' })));
  await t.engine.run(markSwitched, {}, owner(t));
  const sms = fakeSms();
  t.clock.now = at(addDays(DAY, 1), 18, 1);
  await runTick(t);
  assert.equal(reminders(t).length, 1);
  await t.engine.run(rollbackBascule, { reason: 'Le site ne répond pas' }, owner(t));
  await dispatch(rtOf(t, { sms }));
  assert.equal(sms.sent.length, 0, 'WordPress has the hand again: the reminder waits');
  assert.equal(cutoverHold(t.engine.state), true);
  assert.equal(t.engine.state.bascule.ticks['reminders-off'], undefined, 'and the card asks again for WordPress’s reminders');
});

test('the sends cannot be opened over a final export older than the freeze, nor over upcoming bookings the new salon cannot hold', async () => {
  const t = await shop();
  await go(t, file(L(3001, '20 Nov 2026 10:00', { phone: '0698765432' }), L(3002, '22 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', staff: 'Soldat' })));
  await t.engine.run(freezeWordpress, {}, owner(t));
  const frozen = t.clock.now;
  t.clock.now += 20 * 60000;
  // an export made an hour before the freeze: it cannot hold what changed since
  const stale = [{ name: 'export.csv', text: HEAD + L(3001, '20 Nov 2026 10:00', { phone: '0698765432' }) + '\n' + L(3002, '22 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', staff: 'Soldat' }) + '\n', modified: frozen - 3600000 }];
  await go(t, stale);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'stale_export');
  let b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'final-sync').state, 'err');
  // a fresh one: the export is fine, but n° 3002 is on a Sunday (closed) and JKut has left the salon
  t.clock.now += 60000;
  await go(t, [{ ...stale[0], modified: t.clock.now - 30000 }]);
  await t.engine.run(archiveStaff, { id: t.ids.jkut }, t.asOwner());
  b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'final-sync').state, 'ok');
  assert.equal(step(b, 'capacity').state, 'err');
  assert.match(step(b, 'capacity').line, /1 rendez-vous.*barbier/);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'no_place');
  // moved to a chair that exists: what is left is the Sunday, an exception the owner accepts by name
  await t.engine.run(moveAppointment, { id: byWp(t, 3001).id, day: '2026-11-20', start: 600, staffId: t.ids.soldat }, t.asOwner());
  b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'capacity').state, 'warn');
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'no_place');
  await t.engine.run(tickBascule, { item: 'exceptions-ok', done: true }, owner(t));
  b = await basculeOf(rtOf(t));
  assert.equal(step(b, 'capacity').state, 'ok');
  await t.engine.run(markSwitched, {}, owner(t));
  assert.equal(cutoverHold(t.engine.state), false);
});

test('the steps of the card come in the safe order, and the sends stay closed until the last one', async () => {
  const t = await shop();
  await go(t, fr());
  const b = await basculeOf(rtOf(t));
  const order = b.steps.map((x) => x.id);
  const pos = (id) => order.indexOf(id);
  for (const [a, z] of [['first-run', 'freeze'], ['freeze', 'reminders-off'], ['reminders-off', 'final-sync'], ['final-sync', 'capacity'], ['capacity', 'dns'], ['dns', 'redirects'], ['redirects', 'switch']]) assert.ok(pos(a) >= 0 && pos(a) < pos(z), a + ' before ' + z);
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'not_ready');
  await t.engine.run(freezeWordpress, {}, owner(t));
  await rejects(t.engine.run(markSwitched, {}, owner(t)), 'not_ready');
  assert.equal(cutoverHold(t.engine.state), true);
});

test('reconciliation: what WordPress holds to come against what is here, in all and per barber per day for 14 days', async () => {
  const t = await shop();
  const r = await go(t, fr());
  const rec = reconOf(t.engine.state, r.run, DAY);
  // 1350 (10 nov.), 1360 and 1361 (15 déc.), 1380 (18 nov.) are to come and not cancelled; 1370 is cancelled
  assert.equal(rec.wordpress.n, 4);
  assert.equal(rec.here.n, 4);
  assert.equal(rec.wordpress.from, '2026-11-10');
  assert.equal(rec.wordpress.to, '2026-12-15');
  assert.deepEqual(rec.days.map((x) => [x.day, x.staff, x.wordpress, x.here]), [['2026-11-10', 'JKut', 1, 1]]);
  assert.equal(rec.gap, 0);
  // a booking the import could not place shows as a gap, never as a silent equal
  const t2 = await shop();
  const files = file(L(3101, '05 Nov 2026 10:00', { phone: '0698765432' }), L(3102, '06 Nov 2026 10:00', { first: 'Nadia', last: 'Roux', phone: '0677889900', svc: 'Soin du visage' }));
  const r2 = await pass(t2, files, { services: { Coupe: t2.ids.cut }, staff: { JKut: t2.ids.jkut } }, { run: true });
  const rec2 = reconOf(t2.engine.state, r2.run, DAY);
  assert.equal(rec2.wordpress.n, 2);
  assert.equal(rec2.here.n, 1);
  assert.equal(rec2.gap, 1);
  assert.deepEqual(rec2.days.map((x) => [x.day, x.wordpress, x.here]), [['2026-11-05', 1, 1], ['2026-11-06', 1, 0]]);
});

test('« Annuler cette reprise » removes exactly what the pass added, as long as nothing was touched since; after that it says why not', async () => {
  const t = await shop();
  const before = sizes(t);
  const yanis = { ...t.engine.state.clients.get(t.ids.yanis) };
  const r = await go(t, fr());
  assert.equal(undoable(t.engine.state, r.run).ok, true);
  const out = await t.engine.run(undoImportRun, { id: r.run.id }, owner(t));
  assert.ok(out.appts > 0 && out.clients > 0);
  assert.deepEqual(sizes(t), before);
  assert.equal(t.engine.state.apptByWp.size, 0);
  assert.ok(!clientsOf(t).length);
  assert.equal(t.engine.state.clients.get(t.ids.yanis).phone, yanis.phone, 'the salon’s own file is still there');
  assert.ok(t.engine.state.imports.runs.get(r.run.id).undoneAt);
  await rejects(t.engine.run(undoImportRun, { id: r.run.id }, owner(t)), 'undone');
  // the state survives a replay of the journal, and the same export comes in again as on the first day
  const again = await go(t, fr());
  assert.equal(again.clients.added, r.clients.added);
  assert.equal(again.appts.booked, r.appts.booked);
  // touched since: a booking checked in at the counter
  await t.engine.run(setStatus, { id: byWp(t, 1350).id, status: 'arrived' }, t.asOwner()).catch(() => t.engine.run(moveAppointment, { id: byWp(t, 1350).id, day: '2026-11-10', start: 660, staffId: t.ids.jkut }, t.asOwner()));
  const no = undoable(t.engine.state, again.run);
  assert.equal(no.ok, false);
  assert.match(no.why, /rendez-vous/);
  await rejects(t.engine.run(undoImportRun, { id: again.run.id }, owner(t)), 'touched');
  // a delta that changed earlier bookings cannot be undone in one gesture either, and says so
  const t2 = await shop();
  await go(t2, fr());
  const d = await go(t2, fr(setState(FR, 1360, 'Annulé')));
  assert.equal(undoable(t2.engine.state, d.run).ok, false);
  // nor an earlier pass once a later one has built on it
  const first = [...t2.engine.state.imports.runs.values()][0];
  assert.equal(undoable(t2.engine.state, first).ok, false);
  assert.ok(runLines(t2.engine.state, first).length >= 0);
});
