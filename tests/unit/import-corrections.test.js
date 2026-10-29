// The final sync and the person: what the old site corrected about a number, an e-mail or a first name is carried to the file only while
// the file still holds what an import gave it. A number or an e-mail the owner changed since, or a number detached for good, is never put
// back (only listed); the booking with the highest WordPress number speaks for its file whatever the order of the rows; the preview counts
// those corrections (never « rien de nouveau » over one); an export older than the last run's is recognised. The browser's code
// (web/src/lib/wpimport.ts) runs as is in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';
import { importBatch, priorView, say, TODO_KINDS } from '../../server/commands/import.js';
import { updateClient, eraseClient } from '../../server/commands/clients.js';
import { detachPhone } from '../../server/commands/accounts.js';
import { clientFull } from '../../server/http/views.js';
import { shop, owner, pass, byWp, withFixes } from '../wp-helpers.js';

/** A booking row as the browser sends it: to come, confirmed, on JKut's chair. */
const row = (t, wp, x = {}) => ({ wp, day: '2026-11-10', start: 540 + (wp % 10) * 40, serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed', first: 'Karim', last: 'Benali', phone: '0605651154', wpUser: 87, ...x });
const send = (t, ...rows) => t.engine.run(importBatch, { appts: rows }, owner(t));
const lines = (a, kind) => a.review.filter((r) => r.kind === kind);

test('a number the owner changed here is never undone by a later pass, and the report does not blame the old site (item 1)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  await send(t, row(t, 31027));
  const cid = byWp(t, 31027).clientId;
  assert.equal(s.clients.get(cid).phone, '+33605651154');
  // the owner corrects it by hand in the Comptoir; the old site still says the first number
  await t.engine.run(updateClient, { id: cid, patch: { phone: '0699887766' } }, as);
  const v = s.version;
  const a = await send(t, row(t, 31027));
  assert.equal(s.clients.get(cid).phone, '+33699887766', 'the owner’s number stays');
  assert.equal(s.clientByPhone.get('+33699887766'), cid);
  assert.equal(s.clientByPhone.get('+33605651154'), undefined);
  assert.equal(s.version, v, 'nothing written');
  assert.equal(a.appts.changed, 0);
  // listed under « À faire », in the words of an edit made here, never as a change of the old site
  assert.deepEqual(lines(a, 'new-number').map((r) => r.v), ['edited']);
  assert.match(lines(a, 'new-number')[0].text, /^Numéro changé ici depuis la reprise pour Karim Benali : gardé tel que tu l’as mis/);
  assert.ok(!a.review.some((r) => /Autre numéro|Numéro changé sur/.test(r.text)));
  assert.ok(TODO_KINDS.has('new-number'));
  // the old site gives a third number: still the owner's file, listed as another number
  const b = await send(t, row(t, 31027, { phone: '0611223344' }));
  assert.equal(s.clients.get(cid).phone, '+33699887766');
  assert.deepEqual(lines(b, 'new-number').map((r) => r.v), [undefined]);
  assert.match(lines(b, 'new-number')[0].text, /numéro gardé/);
  // a file nobody touched still follows the old site (a correction there)
  const u = await send(t, row(t, 31060, { first: 'Omar', last: 'Diallo', phone: '0600000060', wpUser: 60 }));
  assert.equal(u.review.length, 0);
  const c = await send(t, row(t, 31060, { first: 'Omar', last: 'Diallo', phone: '0600000061', wpUser: 60 }));
  assert.equal(s.clients.get(byWp(t, 31060).clientId).phone, '+33600000061');
  assert.deepEqual(lines(c, 'new-number').map((r) => r.v), ['fixed']);
  assert.match(lines(c, 'new-number')[0].text, /^Autre numéro sur l’ancien site pour Omar Diallo : mis sur la fiche/);
  // what the import remembers is personal data: in pii, in no view, gone with the file
  const events = t.engine.journal.filter((e) => e.type === 'client.added' || e.type === 'client.updated');
  assert.ok(events.length >= 3);
  const dump = JSON.stringify(events.map((e) => e.data)) + JSON.stringify(t.engine.journal.filter((e) => e.type.startsWith('import.') || e.type === 'appt.updated').map((e) => e.data));
  for (const x of ['605651154', '699887766', '600000060', '600000061', 'wpPhone']) assert.ok(!dump.includes(x), x + ' is in the chain');
  assert.ok(events.some((e) => e.pii && e.pii.wpPhone), 'remembered in pii');
  assert.ok(!JSON.stringify(clientFull(s, s.clients.get(cid), as.caps, null)).includes('wpPhone'));
  assert.ok(!JSON.stringify(clientFull(s, s.clients.get(cid), as.caps, null)).includes('605651154'));
  for (let i = 0; i < 2; i++) if ((await t.engine.run(eraseClient, { id: cid, cancelUpcoming: true }, as)).erased) break;
  assert.equal(s.clients.get(cid).erased, true);
  assert.equal(s.clients.get(cid).wpPhone, undefined);
});

test('a number detached by the owner is never filled back, by a pass or by a new booking of the same customer (item 1)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  await send(t, row(t, 31027));
  const cid = byWp(t, 31027).clientId;
  await t.engine.run(detachPhone, { id: cid }, as);
  assert.equal(s.clients.get(cid).phone, '');
  assert.ok(s.clients.get(cid).phoneDetachedAt);
  // the old site still says the number the owner detached: nothing to say, nothing written
  const v = s.version;
  const a = await send(t, row(t, 31027));
  assert.equal(s.clients.get(cid).phone, '', 'not attached again');
  assert.equal(s.clientByPhone.get('+33605651154'), undefined);
  assert.equal(s.version, v);
  assert.deepEqual(a.review, []);
  // a new booking of the same customer (the id the old site gives): the file lacks a number, and does not take it back
  const b = await send(t, row(t, 31061, { start: 600 }));
  assert.equal(byWp(t, 31061).clientId, cid);
  assert.equal(s.clients.get(cid).phone, '');
  assert.equal(s.clientByPhone.get('+33605651154'), undefined);
  assert.equal(b.clients.added, 0);
  // the old site gives another number: said, never put on a file whose number was detached
  const c = await send(t, row(t, 31027, { phone: '0611223344' }));
  assert.equal(s.clients.get(cid).phone, '');
  assert.deepEqual(lines(c, 'new-number').map((r) => r.v), ['detached']);
  assert.match(lines(c, 'new-number')[0].text, /^Numéro détaché ici pour Karim Benali, l’ancien site en donne un : pas remis sur la fiche/);
  assert.equal(s.clientByPhone.get('+33611223344'), undefined);
});

test('an e-mail corrected on the old site follows to the file an import made; one the owner changed stays, and is listed (item 2)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  await send(t, row(t, 31030, { email: 'karim@exemple.fr' }));
  const cid = byWp(t, 31030).clientId;
  assert.equal(s.clients.get(cid).email, 'karim@exemple.fr');
  // the typo is fixed on the old site, same number: the file follows, and it counts
  const a = await send(t, row(t, 31030, { email: 'karim.benz@exemple.fr' }));
  assert.equal(s.clients.get(cid).email, 'karim.benz@exemple.fr');
  assert.equal(a.appts.changed, 1);
  assert.deepEqual(lines(a, 'new-email').map((r) => [r.v, r.cid]), [['fixed', cid]]);
  assert.match(lines(a, 'new-email')[0].text, /^E-mail corrigé sur l’ancien site pour Karim Benali : mis sur la fiche/);
  assert.ok(TODO_KINDS.has('new-email'));
  // again with the same files: nothing more
  const v = s.version;
  assert.deepEqual((await send(t, row(t, 31030, { email: 'karim.benz@exemple.fr' }))).review, []);
  assert.equal(s.version, v);
  // the owner puts his own: the old site still says the previous one, the file keeps the owner's
  await t.engine.run(updateClient, { id: cid, patch: { email: 'karim.perso@exemple.fr' } }, as);
  const b = await send(t, row(t, 31030, { email: 'karim.benz@exemple.fr' }));
  assert.equal(s.clients.get(cid).email, 'karim.perso@exemple.fr');
  assert.equal(b.appts.changed, 0);
  assert.deepEqual(lines(b, 'new-email').map((r) => r.v), ['edited']);
  assert.match(lines(b, 'new-email')[0].text, /^E-mail changé ici depuis la reprise/);
  // and when the old site corrects it again, the owner’s e-mail is still not touched, only listed
  const c = await send(t, row(t, 31030, { email: 'karim.autre@exemple.fr' }));
  assert.equal(s.clients.get(cid).email, 'karim.perso@exemple.fr');
  assert.deepEqual(lines(c, 'new-email').map((r) => r.v), [undefined]);
  assert.match(lines(c, 'new-email')[0].text, /^Autre e-mail sur l’ancien site pour Karim Benali : e-mail gardé/);
  // a file of the salon (no import gave it its e-mail): another e-mail on the old site is listed, not copied
  const yan = await send(t, row(t, 31031, { first: 'Yanis', last: 'Martin', phone: '0612345678', wpUser: undefined, email: 'yanis.m@exemple.fr' }));
  assert.equal(byWp(t, 31031).clientId, t.ids.yanis);
  assert.equal(s.clients.get(t.ids.yanis).email, 'yanis.m@exemple.fr', 'a missing e-mail is still filled in');
  await t.engine.run(updateClient, { id: t.ids.yanis, patch: { email: 'yanis@salon.fr' } }, as);
  const d = await send(t, row(t, 31031, { first: 'Yanis', last: 'Martin', phone: '0612345678', wpUser: undefined, email: 'yanis.autre@exemple.fr' }));
  assert.equal(s.clients.get(t.ids.yanis).email, 'yanis@salon.fr');
  assert.equal(lines(d, 'new-email').length, 1);
  assert.deepEqual(yan.review, []);
  // an e-mail another file has is never copied
  const e = await send(t, row(t, 31030, { email: 'yanis@salon.fr' }));
  assert.equal(s.clients.get(cid).email, 'karim.perso@exemple.fr');
  assert.equal(lines(e, 'email-elsewhere').length, 1);
  // an e-mail the owner emptied is not filled back either
  await t.engine.run(updateClient, { id: cid, patch: { email: '' } }, as);
  await send(t, row(t, 31030, { email: 'karim.benz@exemple.fr' }));
  assert.equal(s.clients.get(cid).email, '');
});

test('the booking with the highest WordPress number gives the file its number, whatever the order of the rows (item 4)', async () => {
  const ends = [];
  for (const order of ['older first', 'newer first']) {
    const t = await shop();
    const s = t.engine.state;
    const a = row(t, 31050, { phone: '0600000050', start: 540 }), b = row(t, 31051, { phone: '0600000051', start: 600 });
    const pick = (x, y) => (order === 'older first' ? [x, y] : [y, x]);
    // the first pass: one person, two bookings, two numbers: the file ends with the newest booking’s, whichever comes first
    const first = await send(t, ...pick(a, b));
    const cid = byWp(t, 31050).clientId;
    ends.push(s.clients.get(cid).phone);
    assert.equal(s.clients.get(cid).phone, '+33600000051', order);
    assert.equal(s.clientByPhone.get('+33600000051'), cid);
    assert.equal(s.clientByPhone.get('+33600000050'), undefined);
    assert.deepEqual(first.clients.added, 1);
    // the final sync reads them in the order the export happens to give: nothing to change, nothing to say
    const v = s.version;
    for (const o of [pick(a, b), pick(b, a)]) assert.deepEqual((await send(t, ...o)).review, [], order);
    assert.equal(s.version, v, order);
    // the newest booking is corrected on the old site: the file follows, whatever the order, and the older booking does not take it back
    const fix = { ...b, phone: '0600000052' };
    const res = await send(t, ...pick(a, fix));
    assert.deepEqual(lines(res, 'new-number').map((r) => [r.v, r.wp]), [['fixed', 31051]], order);
    assert.match(lines(res, 'new-number')[0].text, /^Autre numéro sur l’ancien site pour Karim Benali : mis sur la fiche, vérifie$/);
    assert.equal(s.clients.get(cid).phone, '+33600000052', order);
    const v2 = s.version;
    assert.deepEqual((await send(t, ...pick(fix, a))).review, [], order);
    assert.equal(s.version, v2, order);
    assert.equal(s.clients.get(cid).phone, '+33600000052', order);
  }
  assert.deepEqual(ends, ['+33600000051', '+33600000051']);
});

test('a corrected first name is worded as a correction when the booking already carried another name (item 6)', async () => {
  const t = await shop();
  const s = t.engine.state;
  await send(t, row(t, 31070, { first: 'Léo', last: 'Lefebvre', phone: '0600000070', wpUser: 70 }));
  // a father books his son from the same number: the family wording, as before
  const fam = await send(t, row(t, 31071, { first: 'Karim', last: 'Lefebvre', phone: '0600000070', wpUser: undefined, start: 600 }));
  assert.equal(byWp(t, 31071).name, 'Karim Lefebvre');
  assert.equal(lines(fam, 'name')[0].text, 'Même numéro, autre prénom (« Karim ») : mis sur la fiche de Léo Lefebvre. Famille ?');
  // the old site corrects the typed name: said as a correction, kept on the booking only
  const fix = await send(t, row(t, 31071, { first: 'Kérim', last: 'Lefebvre', phone: '0600000070', wpUser: undefined, start: 600 }));
  assert.equal(byWp(t, 31071).name, 'Kérim Lefebvre');
  assert.equal(s.clients.get(byWp(t, 31071).clientId).first, 'Léo');
  assert.deepEqual(lines(fix, 'name').map((r) => r.v), ['fixed']);
  assert.equal(lines(fix, 'name')[0].text, 'Prénom changé sur l’ancien site (« Kérim ») : gardé sur ce rendez-vous, pas sur la fiche de Léo Lefebvre');
  assert.equal(say('name', { typed: 'Kérim', file: 'Léo Lefebvre' }, 'fixed'), lines(fix, 'name')[0].text);
  assert.ok(TODO_KINDS.has('name'));
  // a booking with no name of its own (it followed the file) whose typed name now differs is a correction too: it was brought in as a booking
  // of the file, so the old site changed what it typed (the family wording is for a booking that is new)
  await send(t, row(t, 31072, { first: 'Léo', last: 'Lefebvre', phone: '0600000070', wpUser: undefined, start: 660 }));
  assert.equal(byWp(t, 31072).name, '');
  const other = await send(t, row(t, 31072, { first: 'Hugo', last: 'Lefebvre', phone: '0600000070', wpUser: undefined, start: 660 }));
  assert.deepEqual(lines(other, 'name').map((r) => r.v), ['fixed']);
  assert.equal(lines(other, 'name')[0].text, 'Prénom changé sur l’ancien site (« Hugo ») : gardé sur ce rendez-vous, pas sur la fiche de Léo Lefebvre');
  assert.equal(byWp(t, 31072).name, 'Hugo Lefebvre');
});

/* ---------------- the preview ---------------- */

const HEAD = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT\n';
const PREAMBLE = 'Réservations,de,à\n,"01 Jan 2025","31 Déc 2026"\n\n';
const csv = (...rows) => PREAMBLE + HEAD + rows.join('');
const line = (wp, when, first, last, email, phone) => `${wp},"${when}","01 Nov 2026 08:00",${first},${last},${email},${phone},Coupe,JKut,1,"20 €",Confirmé\n`;
const base = () => [line(31027, '20 Nov 2026 10:00', 'Karim', 'Benali', 'karim@exemple.fr', '0605651154'), line(31028, '20 Nov 2026 11:00', 'Nora', 'Haddad', 'nora@exemple.fr', '0600000028'), line(31029, '20 Nov 2026 12:00', 'Hamid', 'Zian', 'hamid@exemple.fr', '0600000029')];

test('the preview counts a corrected number, e-mail or first name: it never says « rien de nouveau » over one (item 3)', async () => {
  const t = await shop();
  const first = await pass(t, [{ name: 'export.csv', text: csv(...base()) }]);
  assert.equal(first.pv.counts.upcoming, 3);
  // the same files again: nothing new, and the preview says so
  const same = await pass(t, [{ name: 'export.csv', text: csv(...base()) }]);
  assert.deepEqual([same.pv.counts.toUpdate, same.pv.counts.already], [0, 3]);
  assert.equal(same.appts.changed || 0, 0);
  // each correction alone is counted, and is what sending then does (each export keeps the corrections of the one before: the old site’s state moves on)
  let cur = base();
  const cases = [
    ['a number', () => line(31027, '20 Nov 2026 10:00', 'Karim', 'Benali', 'karim@exemple.fr', '0605651199'), /numéro/, 31027],
    ['an e-mail', () => line(31028, '20 Nov 2026 11:00', 'Nora', 'Haddad', 'nora.h@exemple.fr', '0600000028'), /e-mail/, 31028],
    ['a first name', () => line(31029, '20 Nov 2026 12:00', 'Hakim', 'Zian', 'hamid@exemple.fr', '0600000029'), /prénom/, 31029]
  ];
  for (const [what, make, re, wp] of cases) {
    cur = cur.map((l) => (l.startsWith(wp + ',') ? make() : l));
    const text = csv(...cur);
    const p = W.readFiles([{ name: 'export.csv', text }], DAY);
    const s = t.engine.state;
    const imported = withFixes(s, p, new Map(priorView(s, p.bookings.map((b) => b.wp)).map((a) => [a.wp, a])), t.clock.now);
    const pv = W.preview(p, { services: Object.fromEntries(W.names(p).services.map(([x]) => [x, t.ids.cut])), staff: { JKut: t.ids.Ali } }, t.clock.now, { imported, chairs: new Set([t.ids.Ali, t.ids.jkut]) });
    assert.equal(pv.counts.toUpdate, 1, what);
    assert.equal(pv.counts.already, 2, what);
    assert.match(pv.review.find((r) => r.wp === wp).text, re, what);
    // the preview called « rien de nouveau » is the one that sends nothing: here sending changes the file
    const res = await pass(t, [{ name: 'export.csv', text }]);
    assert.equal(res.appts.changed, 1, what);
  }
  // the owner’s own number: sending would list it and change nothing, and the preview says no change
  const s = t.engine.state;
  const cid = byWp(t, 31027).clientId;
  await t.engine.run(updateClient, { id: cid, patch: { phone: '0699887766' } }, owner(t));
  const mine = await pass(t, [{ name: 'export.csv', text: csv(...cur) }]);
  assert.equal(mine.pv.counts.toUpdate, 0, 'a number the owner changed is not overwritten, so not a change');
  assert.equal(s.clients.get(cid).phone, '+33699887766');
});

test('the preview follows the newest booking of a file, as the batch does: an older booking’s other number is no change (item 3)', async () => {
  const t = await shop();
  const s = t.engine.state;
  const two = (n1, n2) => csv(line(41001, '20 Nov 2026 10:00', 'Sami', 'Kaci', 'sami@exemple.fr', n1), line(41002, '21 Nov 2026 10:00', 'Sami', 'Kaci', 'sami@exemple.fr', n2));
  await pass(t, [{ name: 'export.csv', text: two('0644556677', '0644556677') }]);
  const cid = byWp(t, 41001).clientId;
  assert.equal(s.clients.get(cid).phone, '+33644556677');
  // the older booking says another number, the newest the file’s own: the file keeps it, so nothing is to be sent
  const a = await pass(t, [{ name: 'export.csv', text: two('0644556688', '0644556677') }]);
  assert.equal(a.pv.counts.toUpdate, 0, 'the preview does not promise a change the batch will not make');
  assert.equal(a.appts.changed || 0, 0);
  assert.equal(s.clients.get(cid).phone, '+33644556677');
  // the newest booking corrected: one change, on that booking, and the file follows
  const b = await pass(t, [{ name: 'export.csv', text: two('0644556677', '0644556688') }]);
  assert.equal(b.pv.counts.toUpdate, 1);
  assert.match(b.pv.review.find((r) => r.kind === 'update').text, /\(numéro\)/);
  assert.equal(b.pv.review.find((r) => r.kind === 'update').wp, 41002);
  assert.equal(b.appts.changed, 1);
  assert.equal(s.clients.get(cid).phone, '+33644556688');
  // and the same files once more: nothing
  const c = await pass(t, [{ name: 'export.csv', text: two('0644556677', '0644556688') }]);
  assert.equal(c.pv.counts.toUpdate, 0);
});

test('the details a first pass lacked count too: the old site’s note, the link of its e-mails, the real length (item 3)', async () => {
  const t = await shop();
  await pass(t, [{ name: 'export.csv', text: csv(...base()) }]);
  const s = t.engine.state;
  const k = priorView(s, [31027])[0];
  assert.deepEqual([k.uniq, k.note], [false, false]);
  const b = (p) => p.bookings.find((x) => x.wp === 31027);
  const p = W.readFiles([{ name: 'export.csv', text: csv(...base()) }], DAY);
  assert.deepEqual(W.fills({ ...b(p), note: 'Venir avec sa photo' }, k), ['note']);
  assert.deepEqual(W.fills({ ...b(p), uniq: 'abc123def456' }, k), ['lien des anciens e-mails']);
  assert.deepEqual(W.fills(b(p), k), []);
  assert.deepEqual(W.edits({ ...b(p), dur: 45 }, k), ['durée']);
  assert.deepEqual(W.edits({ ...b(p), dur: k.dur }, k), []);
});

test('a past visit the WXR turns into a no-show is counted by the preview too (item 3)', async () => {
  const t = await shop();
  const s = t.engine.state;
  const visit = (x = {}) => row(t, 31001, { day: '2026-10-20', start: 600, first: 'Sami', last: 'Kaci', phone: '0600000001', wpUser: undefined, ...x });
  await send(t, visit());
  assert.equal(byWp(t, 31001).status, 'done');
  const k = priorView(s, [31001])[0];
  assert.deepEqual([k.open, k.late], [false, true]);
  const b = { wp: 31001, day: '2026-10-20', start: 600, dur: 30, status: 'confirmed', noShow: true, services: [], staff: 'JKut', price: 2000, paid: 0, first: 'Sami', last: 'Kaci', email: '', phone: '0600000001', note: '' };
  assert.equal(W.change(b, k, t.ids.jkut, t.clock.now, DAY), 'close', 'the preview counts it');
  assert.equal(W.change({ ...b, noShow: false }, k, t.ids.jkut, t.clock.now, DAY), null, 'a visit that stays done is nothing new');
  const res = await send(t, visit({ noShow: true }));
  assert.equal(res.appts.closed, 1, 'and sending does it');
  assert.equal(byWp(t, 31001).status, 'no_show');
  assert.equal(priorView(s, [31001])[0].late, false);
});

/* ---------------- an export older than the last run ---------------- */

test('an export older than the last run’s is recognised, by the files’ dates or by the newest booking they hold (item 5)', () => {
  const DAYMS = 86400000, T = Date.UTC(2026, 9, 29, 8, 0);
  const run = (files, extra = {}) => ({ batches: 3, undoneAt: null, files, ...extra });
  const f = (kind, at, newest) => ({ kind, ...(at ? { at } : {}), ...(newest ? { newest } : {}) });
  const last = [run([f('bookings', T, T - 3600000), f('wxr', T + 5000, T - 3600000)])];
  // the same export again, or a newer one: not older
  assert.equal(W.olderExport([f('bookings', T), f('wxr', T + 5000)], last), null);
  assert.equal(W.olderExport([f('bookings', T + DAYMS)], last), null);
  // the files of one export are saved seconds apart: a minute of slack
  assert.equal(W.olderExport([f('bookings', T - 30000)], last), null);
  // an older one
  assert.deepEqual(W.olderExport([f('bookings', T - 2 * DAYMS), f('wxr', T - 2 * DAYMS)], last), { mine: T - 2 * DAYMS, last: T + 5000, by: 'file' });
  // no file date (a copy that lost it): the newest booking they hold says it
  const noDate = [run([f('bookings', 0, T - 3600000)])];
  assert.deepEqual(W.olderExport([f('bookings', 0, T - 7200000)], noDate), { mine: T - 7200000, last: T - 3600000, by: 'booking' });
  assert.equal(W.olderExport([f('bookings', 0, T - 3600000)], noDate), null);
  // only the files of bookings are compared: a list of cards is no export, a run that did nothing or was undone is no reference
  assert.equal(W.olderExport([f('giftcards', T - 9 * DAYMS), f('packs', T - 9 * DAYMS)], last), null);
  assert.equal(W.olderExport([f('bookings', T - 2 * DAYMS)], [run([f('bookings', T)], { batches: 0 }), run([f('bookings', T)], { undoneAt: 1 }), run([f('giftcards', T)])]), null);
  assert.equal(W.olderExport([f('bookings', T - 2 * DAYMS)], []), null);
  // the reference is the latest run that read an export, not an older one
  assert.equal(W.olderExport([f('bookings', T - 2 * DAYMS)], [run([f('bookings', T - 3 * DAYMS)]), run([f('bookings', T)])]), null);
  // the dates the page sends travel in the run record (files[].at, files[].newest), kept for this comparison
  const p = W.readFiles([{ name: 'export.csv', text: csv(...base()), modified: T }], DAY);
  assert.equal(p.files[0].at, T);
  const body = W.runBody(p, W.preview(p, { services: {}, staff: {} }, Date.UTC(2026, 10, 3)), { services: {}, staff: {} }, ['0123456789abcdef'], 1);
  assert.equal(body.files[0].at, T);
  assert.deepEqual(W.olderExport(p.files, [{ batches: 1, undoneAt: null, files: [{ ...body.files[0], at: T + DAYMS }] }]), { mine: T, last: T + DAYMS, by: 'file' });
});

test('the run record keeps the dates of the exports it read (item 5)', async () => {
  const t = await shop();
  const T = Date.UTC(2026, 9, 29, 8, 0);
  const r = await pass(t, [{ name: 'export.csv', text: csv(...base()), modified: T }], undefined, { run: true });
  assert.equal(r.run.files[0].at, T);
  // the next drop of an older copy of the same export is older than that run
  const p = W.readFiles([{ name: 'export.csv', text: csv(...base()), modified: T - 3 * 86400000 }], DAY);
  assert.ok(W.olderExport(p.files, [...t.engine.state.imports.runs.values()].reverse()));
});
