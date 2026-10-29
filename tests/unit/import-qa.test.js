// The QA round on the WordPress import: what happens over several passes (a booking cancelled by the import and confirmed
// again), cards and carnets named in the report, the service labels that do not match, two people on one e-mail, the
// retention decision taken the same way by the preview and the run, « client depuis », the small server fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { at } from '../helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';
import { cancelAppointment, cancelByClient } from '../../server/commands/agenda.js';
import { runLines, startImportRun, importBatch, CANCEL_REASON, GONE_REASON } from '../../server/commands/import.js';
import { clientStats } from '../../server/domain/insights.js';
import { shop, pass, mapAll, owner, byWp, allByWp, setState, dropLines, DAY } from '../wp-helpers.js';

const QA = (f) => readFileSync(new URL('../fixtures/wp-qa/' + f, import.meta.url), 'utf8');
const C01 = QA('C01-first-pass.csv');

test('a booking the import cancelled comes back when a later export confirms it again; one cancelled by hand or by the client never does', async () => {
  const t = await shop();
  // pass 1: 31021 is already cancelled on WordPress
  const r1 = await pass(t, [{ name: 'export.csv', text: setState(C01, 31021, 'Annulé') }]);
  assert.equal(byWp(t, 31021).status, 'cancelled');
  assert.equal(byWp(t, 31021).cancel.reason, CANCEL_REASON);
  // 31024 and 31025 are cancelled in the Comptoir: by hand, and by the client from the e-mail link
  const as = owner(t);
  await t.engine.run(cancelAppointment, { id: byWp(t, 31024).id, reason: 'Le client a appelé' }, as);
  await t.engine.run(cancelByClient, { id: byWp(t, 31025).id, reason: 'Un contretemps' }, { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { siteUrl: 'https://x' } });
  assert.equal(byWp(t, 31025).cancel.by, 'client');

  // pass 2 (final sync A): 31021 confirmed again; 31022 and 31040 missing from the export; 31023 cancelled
  const p2 = setState(setState(dropLines(C01, 31022, 31040), 31023, 'Annulé'), 31021, 'Confirmé');
  const r2 = await pass(t, [{ name: 'export.csv', text: p2 }]);
  assert.equal(r2.pv.counts.toReopen, 1, '31021 is back');
  assert.equal(byWp(t, 31021).status, 'booked', 'back in the agenda');
  assert.equal(allByWp(t, 31021).length, 2, 'a new booking; the cancelled one stays in the history');
  assert.deepEqual([byWp(t, 31022).status, byWp(t, 31040).status, byWp(t, 31023).status], ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(byWp(t, 31022).cancel.reason, GONE_REASON);
  assert.deepEqual(r2.review.filter((x) => x.kind === 'reopened').map((x) => x.wp), [31021]);

  // pass 3: the complete export again, 31023 still cancelled there. 31022 and 31040 come back, one « Rétabli » line each
  const p3 = setState(C01, 31023, 'Annulé');
  const r3 = await pass(t, [{ name: 'export.csv', text: p3 }]);
  assert.equal(r3.pv.counts.toReopen, 2, 'the preview says « 2 à rétablir », not « déjà repris »');
  assert.equal(r3.pv.review.filter((x) => x.kind === 'reopened').length, 2);
  assert.deepEqual([byWp(t, 31021).status, byWp(t, 31022).status, byWp(t, 31040).status], ['booked', 'booked', 'booked']);
  assert.equal(byWp(t, 31023).status, 'cancelled', 'WordPress still says cancelled');
  assert.deepEqual(r3.review.filter((x) => x.kind === 'reopened').map((x) => x.wp).sort(), [31022, 31040]);
  assert.equal(r3.appts.reopened, 2);
  // cancelled by hand or by the client: left alone, and « déjà repris » in the preview
  assert.equal(byWp(t, 31024).status, 'cancelled');
  assert.equal(byWp(t, 31025).status, 'cancelled');
  assert.equal(allByWp(t, 31024).length, 1);

  // pass 4: 31023 confirmed again on WordPress: back too. A third run with nothing new changes nothing
  const r4 = await pass(t, [{ name: 'export.csv', text: C01 }]);
  assert.equal(r4.pv.counts.toReopen, 1);
  assert.equal(byWp(t, 31023).status, 'booked');
  const r5 = await pass(t, [{ name: 'export.csv', text: C01 }]);
  assert.equal(r5.pv.counts.toReopen, 0);
  assert.equal(r5.appts.reopened || 0, 0);
  // the Comptoir's refusal of its own cancellations holds: 31024 and 31025 are still cancelled after four passes
  assert.deepEqual([byWp(t, 31024).status, byWp(t, 31025).status], ['cancelled', 'cancelled']);
  void r1;
});

test('a reopened booking on a slot someone took meanwhile is said, and the report lists it « À faire »', async () => {
  const t = await shop();
  await pass(t, [{ name: 'export.csv', text: setState(C01, 31021, 'Annulé') }]);
  // the slot is given to a walk-in in the agenda
  const gone = byWp(t, 31021);
  const text = C01.split('\n').map((l) => (l.startsWith('31026,') ? l.replace(/^31026,"[^"]*"/, '31026,"' + frDate(gone.day, gone.start) + '"') : l)).join('\n');
  const r = await pass(t, [{ name: 'export.csv', text }]);
  assert.equal(byWp(t, 31021).status, 'booked');
  const lines = r.review.filter((x) => x.kind === 'reopened');
  assert.equal(lines.length, 1);
  assert.equal(say1(lines[0].kind), 'Rétabli sur l’ancien site : remis dans l’agenda, vérifie le créneau');
  assert.ok(r.review.some((x) => x.kind === 'overlap'), 'the taken slot is reported by the existing overlap check: ' + JSON.stringify(r.review.map((x) => x.kind + x.wp)));
});
const frDate = (day, min) => { const [y, m, d] = day.split('-'); const M = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'][+m - 1]; return d + ' ' + M + ' ' + y + ' ' + String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); };
import { say } from '../../server/commands/import.js';
const say1 = (k) => say(k);

test('gift cards and carnets: a line that shifts, an expiry nobody can read, too many cuts, and every refused line is named in the report', async () => {
  // the reader: « 50,00 » unquoted in a comma file shifts the balance and the date by one column
  const e02 = W.readFiles([{ name: 'e02.csv', text: QA('E02-giftcards-comma-latin1-unquoted-decimals.csv') }], DAY);
  assert.equal(e02.files[0].kind, 'giftcards');
  assert.deepEqual(e02.giftcards.map((g) => [g.code, g.amount, g.expires]), [['AAAA-3333', 3000, '2027-03-27']], 'no card is stored with a wrong balance or date');
  assert.equal(e02.files[0].bad, 2);
  assert.ok(e02.problems.every((x) => /colonnes en trop/.test(x.text) && /•••• \d{4}/.test(x.text)), JSON.stringify(e02.problems));
  // an expiry that is there but impossible is never « dans un an »
  const e01 = W.readFiles([{ name: 'e01.csv', text: QA('E01-giftcards-semicolon-utf8.csv') }], DAY);
  assert.ok(!e01.giftcards.some((g) => g.code === 'EEEE-0004' || g.code === 'FFFF-0005'), 'EEEE-0004 (25:00 expiry) and FFFF-0005 (31/02) are refused');
  assert.ok(e01.problems.some((x) => /EEEE-0004|0004/.test(x.text) && /date d’expiration illisible/.test(x.text)));
  // a carnet with 60 cuts left is refused, not cut to 50
  const e03 = W.readFiles([{ name: 'e03.csv', text: QA('E03-carnets.csv') }], DAY);
  assert.ok(!e03.packs.some((k) => k.left > 50));
  assert.ok(e03.problems.some((x) => /plus de 50 coupes/.test(x.text)));
  const pv = W.preview(e01, { services: {}, staff: {} }, at(DAY, 10), { today: DAY });
  assert.ok(pv.notes.some((x) => /pas de date d’expiration/.test(x)), 'cards without an expiry are counted: ' + JSON.stringify(pv.notes));
  assert.ok(pv.notes.some((x) => /apparaît deux fois|apparaissent deux fois/.test(x)), 'the same code twice is counted');

  // the run: every refused card and carnet is named by its last digits, under « À faire »
  const t = await shop();
  const r = await pass(t, [{ name: 'e01.csv', text: QA('E01-giftcards-semicolon-utf8.csv') }, { name: 'e03.csv', text: QA('E03-carnets.csv') }, { name: 'e04.csv', text: QA('E04-customers-plugin-format.csv') }], { services: {}, staff: {} }, { run: true });
  const cards = r.lines.filter((l) => l.kind === 'giftcard'), carnets = r.lines.filter((l) => l.kind === 'pack');
  assert.ok(cards.length >= 2 && carnets.length >= 2, cards.length + ' cards, ' + carnets.length + ' carnets refused');
  for (const l of cards) { assert.match(l.name, /^•••• ([A-Z0-9]{1,4}|\?) · \d/, JSON.stringify(l)); assert.equal(l.todo, true); }
  for (const l of carnets) { assert.match(l.name, /^(•••• \d{4}|Carnet sans numéro)$/, JSON.stringify(l)); assert.equal(l.todo, true); }
  assert.ok(!JSON.stringify(t.engine.journal.filter((e) => e.type === 'import.batch')).includes('Sofia'), 'no name in the record');
});

test('a service label nobody matched: history goes to « Ancienne prestation », a booking to come is listed, nothing is lost silently', async () => {
  const t = await shop();
  const text = QA('A17-multi-service-and-barber-spellings.csv');
  const p = W.readFiles([{ name: 'a17.csv', text }], DAY);
  const services = [...t.engine.state.services.values()].filter((x) => x.active && !x.pack);
  const chairs = [...t.engine.state.staff.values()].filter((x) => x.active && x.chair);
  const sug = W.suggestServices(p, services, t.clock.now);
  // « Soin visage » has a booking to come (17915): not defaulted to history, the owner decides
  assert.equal(sug.map['Soin visage'], '');
  const map = { services: { ...sug.map, 'Soin visage': W.LEGACY }, staff: W.suggestStaff(p, chairs, t.clock.now).map };
  for (const [n, v] of Object.entries(map.staff)) if (!v) map.staff[n] = t.ids.Ali;
  const r = await pass(t, [{ name: 'a17.csv', text }], map, { run: true });
  const svc = [...t.engine.state.services.values()].filter((x) => x.legacy);
  assert.equal(svc.length, 1, 'the legacy service is created once across batches');
  assert.deepEqual([svc[0].name, svc[0].active, svc[0].online], ['Ancienne prestation', false, false]);
  const past = byWp(t, 17904);
  assert.ok(past && past.status === 'done' && past.legacy && past.services.some((x) => x.id === svc[0].id), 'the past booking with « Soin visage » is kept as history');
  assert.equal(past.services.reduce((n, x) => n + x.price, 0), 3500, 'priced with the total the client paid');
  const client = past.clientId;
  assert.ok(clientStats(t.engine.state, DAY, t.clock.now).get(client).visits >= 1, 'the visit counts for the client’s rhythm');
  assert.equal(clientStats(t.engine.state, DAY, t.clock.now).get(client).favService === svc[0].id, false, '« Ancienne prestation » is nobody’s favourite service');
  // 17915 (10 Nov, « Soin visage ») is to come: not booked on the legacy service, an « À faire » line
  assert.equal(byWp(t, 17915), undefined);
  const line = r.lines.find((l) => l.wp === 17915 && l.kind === 'service');
  assert.ok(line && line.todo, JSON.stringify(r.lines.filter((l) => l.kind === 'service')));
  assert.match(line.text, /ce rendez-vous à venir n’est pas dans l’agenda/);
  assert.ok(r.pv.review.some((x) => x.wp === 17915 && /à venir n’est pas dans l’agenda/.test(x.text)), 'the preview says the same');
  // the services of the boot answer never offer it
  const { serviceView } = await import('../../server/http/views.js');
  assert.ok(![...t.engine.state.services.values()].filter((x) => x.active).some((x) => x.legacy));
  void serviceView;

  // a booking with no service written in the export: its own row in the matching step, « Ne pas reprendre » by default when it is to come
  const empty = `Réservations,de,à\n,"01 Jan 2025","31 Déc 2027"\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"PRIX TOTAL",ÉTAT\n`
    + '9101,"05 Oct 2026 10:00","01 Oct 2026 10:00",Lina,Vide,,0644000101,,JKut,"20 €",Confirmé\n9102,"12 Nov 2026 10:00","01 Nov 2026 10:00",Lina,Vide,,0644000101,,JKut,"20 €",Confirmé\n';
  const q = W.readFiles([{ name: 'v.csv', text: empty }], DAY);
  assert.deepEqual(W.names(q).services, [[W.NO_SERVICE, 2]]);
  assert.equal(W.suggestServices(q, services, t.clock.now).map[W.NO_SERVICE], '', 'one of the two is to come');
});

test('two people on one e-mail stay two people, and the reminder of one never goes to the other’s phone', async () => {
  const t = await shop();
  const r = await pass(t, [{ name: 'b01.csv', text: QA('B01-who-is-who.csv') }], undefined, { run: true });
  const files = [...t.engine.state.clients.values()].filter((c) => c.source === 'wordpress');
  const sarah = files.find((c) => c.first === 'Sarah'), julien = files.find((c) => c.first === 'Julien');
  assert.ok(sarah && julien && sarah.id !== julien.id, 'two files');
  assert.equal(sarah.email, 'famille.roux@exemple.fr', 'the e-mail stays on the first');
  assert.equal(julien.email, '');
  assert.equal(julien.phone, '+33633978240');
  assert.equal(sarah.phone, '+33626609449');
  assert.equal(byWp(t, 21016).clientId, julien.id, 'Julien’s booking is on his own file');
  assert.equal(r.lines.filter((l) => l.kind === 'person').length >= 1, true);
  const line = r.lines.find((l) => l.kind === 'person');
  assert.match(line.text, /Même e-mail que Sarah Roux mais une autre personne/);
  assert.equal(line.todo, true);
  // the preview counted the same files
  assert.equal(r.clients.added, r.pv.counts.newClients, 'the preview promises the files the batches create');
  // Ilyes books on Mourad’s number (no e-mail): the agenda says whose file it is
  const ilyes = byWp(t, 21013);
  const { apptView } = await import('../../server/http/views.js');
  const v = apptView(t.engine.state, ilyes, new Set(['client.contact']), clientStats(t.engine.state, DAY, t.clock.now), t.clock.now);
  assert.equal(v.name, 'Ilyes (fiche de Mourad C.)');
  assert.equal(apptView(t.engine.state, byWp(t, 21010), new Set(), clientStats(t.engine.state, DAY, t.clock.now), t.clock.now).name, 'Mourad C.');
});

test('a contact shared by many people (noemail@noemail.com, 0600000000) never links them', async () => {
  const t = await shop();
  const p = W.readFiles([{ name: 'b08.csv', text: QA('B08-placeholder-contacts.csv') }], DAY);
  const shared = W.sharedContacts(p);
  assert.ok(shared.has('e:noemail@noemail.com') && shared.has('e:a@a.fr'), [...shared].join());
  const r = await pass(t, [{ name: 'b08.csv', text: QA('B08-placeholder-contacts.csv') }]);
  const files = [...t.engine.state.clients.values()].filter((c) => c.source === 'wordpress');
  // no file mixes first names, but one family-sized number: three people on 06 12 34 56 78 stay on one file (« Même numéro, autre prénom »), as before
  const { typedFor } = await import('../../server/http/views.js');
  for (const a of t.engine.state.appts.values()) if (a.source === 'import' && a.clientId) {
    const c = t.engine.state.clients.get(a.clientId);
    if (typedFor(a, c)) assert.equal(c.phone, '+33612345678', a.name + ' on ' + c.first);
  }
  assert.ok(files.length >= 4 && files.length < 8, 'before: 40 people on 11 files; now only the real contacts have one: ' + files.length);
  assert.ok(!files.some((c) => c.email === 'noemail@noemail.com' || c.email === 'a@a.fr'), 'the placeholder is on no file');
  assert.equal(r.clients.added, r.pv.counts.newClients);
  assert.ok(r.pv.review.some((x) => /partagé par plusieurs personnes/.test(x.text)));
  assert.ok(r.pv.notes.some((x) => /partagés par au moins quatre personnes/.test(x)));
});

const MON = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const fr = (day, hhmm = '10:00') => { const [y, m, d] = day.split('-').map(Number); return String(d).padStart(2, '0') + ' ' + MON[m - 1] + ' ' + y + ' ' + hhmm; };
const csvOf = (rows, win = '"01 Jan 2020","31 Déc 2027"') => 'Réservations,de,à\n,' + win + '\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"PRIX TOTAL",ÉTAT\n'
  + rows.map((r) => [r.id, '"' + fr(r.day, r.at) + '"', '"' + fr(r.created || r.day) + '"', r.first, r.last, r.email || '', r.phone || '', r.svc || 'Coupe', r.staff || 'JKut', '"20 €"', r.state || 'Confirmé'].join(',')).join('\n') + '\n';

test('the preview and the run keep the same people: a person whose only recent rows are skipped is not collected for their old ones', async () => {
  const t = await shop();
  const rows = [];
  const phone = (i) => '06 40 ' + String(Math.floor(i / 100)).padStart(2, '0') + ' ' + String(i % 100).padStart(2, '0') + ' 00';
  let id = 50000;
  for (let i = 0; i < 450; i++) {
    const who = { first: 'Pers' + i, last: 'Test', phone: phone(i) };
    const k = i % 5;
    // 0: a visit last month · 1: only a visit in 2021 · 2: 2021 and an ERREUR since · 3: 2021 and a service nobody matched since · 4: 2021 and a visit last month
    if (k === 0) rows.push({ id: id++, day: '2026-10-05', ...who });
    else if (k === 1) rows.push({ id: id++, day: '2021-03-04', ...who });
    else if (k === 2) rows.push({ id: id++, day: '2021-03-04', ...who }, { id: id++, day: '2026-09-02', state: 'Erreur', ...who });
    else if (k === 3) rows.push({ id: id++, day: '2021-03-04', ...who }, { id: id++, day: '2026-09-02', svc: 'Soin visage', ...who });
    else rows.push({ id: id++, day: '2021-03-04', ...who }, { id: id++, day: '2026-10-06', ...who });
  }
  const text = csvOf(rows);
  const p = W.readFiles([{ name: 'big.csv', text }], DAY);
  const map = { services: { Coupe: t.ids.cut, 'Soin visage': '' }, staff: { JKut: t.ids.jkut } };
  const r = await pass(t, [{ name: 'big.csv', text }], map, { run: true });
  void p;
  // 90 + 90 people have a visit to keep; the 270 others have none
  assert.equal(r.pv.counts.newClients, 180);
  assert.equal(r.clients.added, 180, 'the run makes exactly the files the preview announced');
  const made = (a) => (a.done || 0) + (a.noShow || 0) + (a.booked || 0) + (a.cancelled || 0);
  assert.equal(made(r.appts), r.pv.counts.past + r.pv.counts.noShow + r.pv.counts.upcoming + r.pv.counts.cancelled);
  assert.equal(r.appts.skipped, r.pv.counts.skipped + r.pv.counts.unmapped, 'the rows the server skips are the ones the preview skipped');
  // and no file for the others: the old rows of the persons left out were not even sent
  assert.equal([...t.engine.state.clients.values()].filter((c) => c.source === 'wordpress').length, 180);
  assert.equal(r.rows.appts.length, 90 + 0 + 90 + 90 + 180, 'the recent rows of those left out are sent, to be reported with their reason; their old rows are not');
  // the run adds up, with no gap
  const rep = W.reconcile(r.run);
  assert.ok(rep.every((x) => x.gap === 0), JSON.stringify(rep));
  // the whole export again: nothing new, nothing to send but a record of « déjà là »
  const again = await pass(t, [{ name: 'big.csv', text }], map);
  assert.equal(again.pv.counts.newClients + again.pv.counts.merged, 0);
  assert.equal(again.pv.counts.past + again.pv.counts.upcoming + again.pv.counts.noShow + again.pv.counts.cancelled, 0);
  assert.equal(again.clients.added, 0);
});

test('« client depuis » is the oldest creation time the old site gave, not the one of the first row met, whatever the batches', async () => {
  const text = csvOf([
    { id: 60001, day: '2026-10-05', created: '2026-10-01', first: 'Nadia', last: 'Ancienne', phone: '06 41 00 00 01' },
    { id: 60002, day: '2022-03-10', created: '2022-03-01', first: 'Nadia', last: 'Ancienne', phone: '06 41 00 00 01' },
    { id: 60003, day: '2024-05-10', created: '2024-05-02', first: 'Nadia', last: 'Ancienne', phone: '06 41 00 00 01' }
  ]);
  for (const chunk of [150, 1]) {
    const t = await shop();
    await pass(t, [{ name: 'a.csv', text }], undefined, { chunk });
    const c = [...t.engine.state.clients.values()].find((x) => x.first === 'Nadia');
    assert.equal(c.createdAt, at('2022-03-01', 10), 'chunk ' + chunk);
  }
  // with the customers' file: a customer row brings the file in on the import day, the booking rows give it its true age
  const t = await shop();
  const r = await pass(t, [{ name: 'e04.csv', text: QA('E04-customers-plugin-format.csv') }, { name: 'a01.csv', text: QA('A01-plugin-fr-utf8bom-lf.csv') }], undefined, { chunk: 7 });
  const farid = [...t.engine.state.clients.values()].find((x) => x.first === 'Farid' && x.last === 'Chevalier');
  assert.ok(farid, 'Farid is in');
  assert.equal(farid.createdAt, at('2026-08-11', 20, 15), 'his first booking was made on 11 August, not on the import day');
  void r;
});

test('the old links, the e-mail, the landline: small fixes of the server', async () => {
  const { isEmail, isLandline } = await import('../../server/lib/util.js');
  for (const bad of ['victime@exemple.fr?bcc=pirate@x.fr', 'a@b..fr', 'a;b@x.fr', 'a b@x.fr', 'x@y', 'o\'brien@x.fr', 'a@b.c']) assert.equal(isEmail(bad), false, bad);
  for (const ok of ['karim.b@exemple.fr', 'a+tag@gmail.com', 'NOM@EXEMPLE.FR', 'x@sous.domaine.co.uk']) assert.equal(isEmail(ok), true, ok);
  // the browser’s preview reads the same
  const p = W.readFiles([{ name: 'm.csv', text: csvOf([{ id: 61001, day: '2026-10-05', first: 'Hacker', last: 'Test', email: 'victime@exemple.fr?bcc=pirate@x.fr', phone: '06 42 00 00 01' }]) }], DAY);
  const pv = W.preview(p, { services: { Coupe: 'sv' }, staff: { JKut: 'st' } }, at(DAY, 10), { today: DAY });
  assert.ok(pv.review.some((x) => x.kind === 'email'), 'an address that cannot be one is said, and dropped');
  assert.deepEqual(pv.identities.flat().map((x) => x.email), [undefined]);
  // the server drops it with a line too, and keeps the person by the number
  const t = await shop();
  const r = await pass(t, [{ name: 'm.csv', text: csvOf([{ id: 61001, day: '2026-10-05', first: 'Hacker', last: 'Test', email: 'victime@exemple.fr?bcc=pirate@x.fr', phone: '06 42 00 00 01' }]) }], { services: { Coupe: t.ids.cut }, staff: { JKut: t.ids.jkut } }, { run: true });
  assert.ok(r.lines.some((l) => l.kind === 'email'));
  assert.equal([...t.engine.state.clients.values()].find((c) => c.first === 'Hacker').email, '');
  // landlines
  assert.equal(isLandline('+33491123456'), true);
  assert.equal(isLandline('+33972123456'), true);
  assert.equal(isLandline('+33612345678'), false);
  assert.equal(isLandline('+32470123456'), false);
});

test('a deposit sentence comes first in the booking’s note: a long note of the client cannot cut it', async () => {
  const t = await shop();
  const longNote = 'x'.repeat(280);
  const wxr = readFileSync(new URL('../fixtures/wp-qa/D07-deposits.wxr.xml', import.meta.url), 'utf8');
  const p = W.readFiles([{ name: 'd07.xml', text: wxr }], DAY);
  const rows = p.bookings.filter((b) => b.paid && b.day >= DAY);
  assert.ok(rows.length >= 1, 'the fixture holds a booking to come with a deposit');
  const map = mapAll(t, p);
  const sent = W.toRows({ ...p, bookings: rows.map((b) => ({ ...b, note: longNote })) }, map, new Set(), {});
  await t.engine.run(importBatch, { appts: sent.appts }, owner(t));
  const a = byWp(t, rows[0].wp);
  assert.ok(a, 'booked');
  assert.match(a.note, /^(Acompte de .* déjà payé sur l’ancien site|Déjà payé en entier sur l’ancien site \(.*\))/);
  assert.ok(a.note.length <= 300);
});
