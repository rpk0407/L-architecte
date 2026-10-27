// Taking over the WordPress salon: the exports read as the browser reads them (web/src/lib/wpimport.ts, run as is by
// Node), sent in batches to the import command, then checked where it matters: client files, past visits that count
// for the rhythm but not for the chairs' figures, upcoming bookings, paper gift cards outside any Z, old e-mail links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';
import { importBatch, importGiftcard, priorView, LEGACY_STAFF } from '../../server/commands/import.js';
import { moveAppointment } from '../../server/commands/agenda.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { clientStats, report } from '../../server/domain/insights.js';
import { normPhoneImport, sha256 } from '../../server/lib/util.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { browser } from '../api/client.js';

const fixture = (f) => readFileSync(new URL('../fixtures/' + f, import.meta.url), 'utf8');
const CSV = fixture('wp-bookings-fr.csv');
const WXR = fixture('wp-bookings.wxr.xml');

/** The helper salon (Ali, Ben, Yanis Martin on 06 12 34 56 78) plus the old site's barbers and its 'cc'. */
async function shop() {
  const t = await salon();
  const as = t.asOwner();
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  t.ids.jkut = (await t.engine.run(addStaff, { name: 'JKut', role: 'barber', schedule: week }, as)).id;
  t.ids.soldat = (await t.engine.run(addStaff, { name: 'Le Soldat', role: 'barber', schedule: week }, as)).id;
  t.ids.cc = (await t.engine.run(addService, { name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' }, as)).id;
  return t;
}

/** What the wizard does: auto-match the names (a barber with upcoming bookings needs a chair), then send the rows 150 at a time. */
function mapping(t, p) {
  const s = t.engine.state;
  const services = [...s.services.values()].filter((x) => x.active && !x.pack);
  const staff = [...s.staff.values()].filter((x) => x.active && x.chair);
  const n = W.names(p);
  const ahead = W.upcomingNames(p, t.clock.now);
  return {
    services: Object.fromEntries(n.services.map(([name]) => [name, W.bestMatch(name, services, (x) => [x.name, x.short, x.slug])])),
    staff: Object.fromEntries(n.staff.map(([name]) => [name, W.bestMatch(name, staff, (x) => [x.name]) || (ahead.has(name) ? '' : W.LEGACY)]))
  };
}
/** What the wizard asks the server before a run (POST /api/v1/import/preview): where earlier imports stand. */
const priors = (t, p) => new Map(priorView(t.engine.state, p.bookings.map((b) => b.wp)).map((a) => [a.wp, a]));
const chairsOf = (t) => new Set([...t.engine.state.staff.values()].filter((x) => x.active && x.chair).map((x) => x.id));
async function send(t, rows) {
  const total = { clients: { added: 0, merged: new Set() }, appts: { done: 0, noShow: 0, cancelled: 0, booked: 0, skipped: 0, already: 0, updated: 0, moved: 0, closed: 0 }, giftcards: { added: 0, already: 0, skipped: 0 }, packs: { added: 0, already: 0, skipped: 0 }, review: [] };
  const parts = [...W.chunks(rows.clients).map((x) => ({ clients: x })), ...W.chunks(rows.appts).map((x) => ({ appts: x })), ...W.chunks(rows.giftcards).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs).map((x) => ({ packs: x }))];
  for (const body of parts) {
    const r = await t.engine.run(importBatch, body, t.asOwner());
    total.clients.added += r.clients.added;
    for (const id of r.clients.merged) total.clients.merged.add(id);
    for (const k of ['appts', 'giftcards', 'packs']) for (const [x, v] of Object.entries(r[k])) total[k][x] += v;
    total.review.push(...r.review);
  }
  return total;
}
const byWp = (t, wp) => t.engine.state.appts.get(t.engine.state.apptByWp.get(String(wp)));

test('phone numbers from the old site: the country code is added, the rest goes to the review list', () => {
  for (const raw of ['612345678', '0033612345678', '33612345678', '06 12 34 56 78', '+33 (0)6 12 34 56 78', '+33612345678']) assert.equal(normPhoneImport(raw), '+33612345678', raw);
  assert.equal(normPhoneImport('470123456', '+32'), '+32470123456', 'the plugin keeps the prefix apart');
  assert.equal(normPhoneImport('+32 470 12 34 56'), '+32470123456');
  assert.equal(normPhoneImport('612345678', '+33'), '+33612345678');
  for (const bad of ['12 34', '512345678', '+1 555 0100', '', 'abc']) assert.equal(normPhoneImport(bad), null, bad);
  for (const raw of ['612345678', '0033612345678', '12 34', '470123456', '+32 470 12 34 56', '0755667788']) assert.equal(W.normPhoneImport(raw, raw === '470123456' ? '+32' : undefined), normPhoneImport(raw, raw === '470123456' ? '+32' : undefined), 'the browser previews what the server does: ' + raw);
});

test('the French bookings export: BOM, preamble, French months and prices, deduplicated across files', () => {
  const p = W.readFiles([{ name: 'export-2025.csv', text: CSV }, { name: 'export-2026.csv', text: CSV }]);
  assert.deepEqual(p.files.map((f) => [f.kind, f.rows]), [['bookings', 14], ['bookings', 0]], 'the same IDs in a second file are not read twice');
  assert.deepEqual(p.problems, []);
  const b = (wp) => p.bookings.find((x) => x.wp === wp);
  assert.deepEqual([b(1100).day, b(1100).start], ['2025-12-13', 600], "'Déc'");
  assert.deepEqual([b(1201).day, b(1201).start, b(1201).createdAt], ['2026-08-12', 600, at('2026-08-10', 18, 22)], "'Aoû' and the creation time");
  assert.deepEqual([b(1350).price, b(1350).paid, b(1350).status], [4000, 1000, 'paid'], "'40 € (10 € déjà payé en acompte)'");
  assert.equal(b(1290).status, 'paylater');
  assert.equal(b(1302).status, 'canceled');
  assert.equal(b(1311).status, 'error');
  assert.equal(b(1380).status, 'pending');
  assert.deepEqual(b(1201).services, ['Formule Coupe + Contour Barbe 25€']);
  assert.equal(W.parseWhen('1er juillet 2026 à 9 h 05')?.min, 545);
  assert.equal(W.parseMoney('1 234,50 €'), 123450);
  assert.equal(W.parseMoney('40.10'), 4010);
});

test('importing the export: client files, past visits, upcoming bookings, nothing sent, the rows to look at', async () => {
  const t = await shop();
  const s = t.engine.state;
  const p = W.readFiles([{ name: 'export.csv', text: CSV }]);
  const map = mapping(t, p);
  assert.equal(map.services['Formule Coupe + Contour Barbe 25€'], t.ids.cc, 'cleaned names match: Formule … 25€ → cc');
  assert.equal(map.services['Coupe'], t.ids.cut);
  assert.equal(map.services['Coupe + barbe'], t.ids.beard);
  assert.equal(map.staff['Soldat'], t.ids.soldat, 'Soldat → Le Soldat');
  assert.equal(map.staff['JKut'], t.ids.jkut);
  assert.equal(map.staff['John'], W.LEGACY, 'a barber who left goes to the archived profile');

  // the preview, with the server telling which people already have a file
  const pv0 = W.preview(p, map, t.clock.now);
  const known = new Set(pv0.identities.map((ids, g) => (ids.some((k) => k.phone && normPhoneImport(k.phone, k.prefix) === '+33612345678') ? g : -1)).filter((g) => g >= 0));
  const pv = W.preview(p, map, t.clock.now, { known });
  assert.deepEqual(pv.counts, { newClients: 5, merged: 1, past: 7, noShow: 0, upcoming: 4, cancelled: 2, skipped: 1, unmapped: 0, already: 0, toCancel: 0, toMove: 0, toClose: 0, erased: 0, giftcards: 0, packs: 0 });
  assert.ok(pv.review.some((r) => r.wp === 1315 && /Numéro illisible/.test(r.text)));
  assert.ok(pv.review.some((r) => r.wp === 1361 && /Chevauche/.test(r.text)));

  await rejects(t.engine.run(importBatch, { appts: [] }, t.asStaff('Ali')), 'forbidden');
  const clients0 = s.clients.size, rep0 = report(s, { from: '2026-08-01', to: '2026-11-02', today: DAY, now: t.clock.now });
  const v0 = s.version;
  const res = await send(t, W.toRows(p, map));
  assert.equal(res.clients.added, 5);
  assert.deepEqual([...res.clients.merged], [t.ids.yanis], 'same number as an existing file: merged into it');
  assert.deepEqual(res.appts, { done: 7, noShow: 0, cancelled: 2, booked: 4, skipped: 0, already: 0, updated: 0, moved: 0, closed: 0 });
  assert.equal(s.clients.size, clients0 + 5);

  // phones normalised: '612345678' and '0033612345678' both land on Yanis's file (+33612345678)
  assert.equal(byWp(t, 1288).clientId, t.ids.yanis);
  assert.equal(byWp(t, 1350).clientId, t.ids.yanis);
  assert.equal(s.clients.get(t.ids.yanis).email, 'yanis@exemple.fr', 'what the file lacked is filled in');
  const karim = s.clients.get(byWp(t, 1201).clientId);
  assert.equal(karim.phone, '+33698765432');
  assert.equal(byWp(t, 1245).clientId, karim.id);
  assert.equal(byWp(t, 1290).clientId, karim.id);
  assert.deepEqual([karim.source, karim.sms, karim.marketing, karim.createdAt], ['wordpress', true, false, at('2026-08-10', 18, 22)]);
  const nolan = s.clients.get(byWp(t, 1315).clientId);
  assert.deepEqual([nolan.first, nolan.phone, nolan.email], ['Nolan', '', 'nolan.girard@exemple.fr'], 'an unreadable number: the file is found by e-mail');

  // statuses and what is kept
  const a = byWp(t, 1350);
  assert.deepEqual([a.status, a.source, a.legacy, a.price, a.services[0].id, a.services[0].price, a.ext.wp, a.ext.paid], ['booked', 'import', false, 4000, t.ids.beard, 4000, 1350, 1000]);
  assert.match(a.note, /Acompte de 10\s€ déjà payé/);
  assert.ok(a.code && s.apptByCode.get(a.code) === a.id, 'a code, so reminders and its page work');
  assert.equal(byWp(t, 1201).status, 'done');
  assert.equal(byWp(t, 1201).legacy, true);
  assert.equal(byWp(t, 1201).createdAt, at('2026-08-10', 18, 22));
  assert.equal(byWp(t, 1290).status, 'done', 'Payer plus tard, past');
  assert.equal(byWp(t, 1310).status, 'done', 'En attente, past');
  assert.equal(byWp(t, 1302).status, 'cancelled');
  assert.equal(byWp(t, 1302).cancel.by, 'salon');
  assert.equal(byWp(t, 1370).status, 'cancelled');
  assert.equal(byWp(t, 1380).status, 'booked', 'En attente, upcoming: booked, not an unpaid deposit the scheduler would cancel');
  assert.equal(byWp(t, 1311), undefined, 'ERREUR is skipped');
  const legacy = [...s.staff.values()].filter((x) => x.legacy);
  assert.equal(legacy.length, 1);
  assert.deepEqual([legacy[0].name, legacy[0].active], ['Ancien barbier', false]);
  assert.equal(byWp(t, 1302).staffId, legacy[0].id);
  assert.equal(byWp(t, 1360).staffId, t.ids.soldat);

  // the rows to look at
  const why = (wp) => res.review.filter((r) => r.wp === wp).map((r) => r.kind).sort();
  assert.deepEqual(why(1315), ['phone']);
  assert.deepEqual(why(1361), ['overlap']);
  assert.deepEqual(why(1380), ['pending']);
  assert.deepEqual(why(1350), ['paid']);

  // nothing sent, nothing in the live feed
  assert.equal(s.messages.size, 0, 'no message queued');
  assert.ok(!t.engine.journal.slice(v0).some((e) => e.type === 'message.queued'));
  assert.ok(!s.feed.some((f) => f.type === 'appt.booked' && f.data.source === 'import'));

  // history counts for the client's rhythm, not for the chairs
  const st = clientStats(s, DAY, t.clock.now).get(karim.id);
  assert.equal(st.visits, 3);
  assert.equal(st.cadence, 28);
  assert.equal(st.isNew, false);
  assert.equal(st.spend, 7000, 'what the client paid on the old site');
  assert.equal(st.next.id, byWp(t, 1360).id, 'the upcoming booking is the next visit');
  assert.equal(clientStats(s, DAY, t.clock.now).get(t.ids.yanis).next.id, a.id);
  const rep1 = report(s, { from: '2026-08-01', to: '2026-11-02', today: DAY, now: t.clock.now });
  assert.equal(rep1.occupancy, rep0.occupancy, 'occupancy unchanged by the imported history');
  assert.deepEqual(rep1.staff, rep0.staff);
  assert.deepEqual([rep1.done, rep1.noShows, rep1.cancelled, rep1.revenue], [rep0.done, rep0.noShows, rep0.cancelled, rep0.revenue]);
  const ahead = report(s, { from: '2026-11-10', to: '2026-11-10', today: DAY, now: t.clock.now });
  assert.equal(ahead.sources.site, 1, 'an upcoming booking from the old site is a real booking of the agenda');

  // the same files again (the cut-over day), sent the way the wizard sends them: nothing new
  const v1 = s.version;
  const imported = priors(t, p);
  assert.equal(imported.size, 13);
  const pv2 = W.preview(p, map, t.clock.now, { imported, chairs: chairsOf(t) });
  assert.deepEqual([pv2.counts.already, pv2.counts.toCancel, pv2.counts.toMove, pv2.counts.newClients], [13, 0, 0, 0]);
  const again = await send(t, W.toRows(p, map, imported));
  assert.equal(s.version, v1, 'running the batch twice adds 0 events the second time');
  assert.deepEqual([again.clients.added, again.appts.already], [0, 13]);
});

test('the delta run, through the wizard: what the old site cancelled, moved or saw take place since the first run', async () => {
  const t = await shop();
  const s = t.engine.state;
  const p = W.readFiles([{ name: 'export.csv', text: CSV }]);
  const map = mapping(t, p);
  await send(t, W.toRows(p, map, priors(t, p)));
  // in the Comptoir meanwhile: Lucas's 15 Dec booking moved to 16:00 by the salon
  await t.engine.run(moveAppointment, { id: byWp(t, 1361).id, day: '2026-12-15', start: 960, force: true }, t.asOwner());
  // nine days later, the cut-over day's export: 1360 cancelled, Sami's 18 Nov moved to the 19th with Soldat, a new one,
  // and Yanis's 10 Nov has taken place on the old site
  t.clock.now = at('2026-11-12', 10);
  const line = (wp) => CSV.split('\n').find((l) => l.startsWith(wp + ','));
  const text = CSV
    .replace(line(1360), line(1360).replace(/Confirmé$/, 'Annulé'))
    .replace(line(1380), line(1380).replace('"18 Nov 2026 15:00"', '"19 Nov 2026 16:00"').replace(',JKut,', ',Soldat,'))
    + '1390,"20 Nov 2026 10:00","03 Nov 2026 08:00",Karim,Benali,,0698765432,Coupe,JKut,1,"20 €",Confirmé\n';
  const later = W.readFiles([{ name: 'export.csv', text }]);
  const imported = priors(t, later);
  // the preview says it before anything is sent
  const pv = W.preview(later, map, t.clock.now, { imported, chairs: chairsOf(t) });
  assert.deepEqual([pv.counts.toCancel, pv.counts.toMove, pv.counts.toClose, pv.counts.upcoming, pv.counts.already], [1, 1, 1, 1, 10]);
  assert.ok(pv.review.some((r) => r.wp === 1360 && /sera annulé ici/.test(r.text)));
  assert.ok(pv.review.some((r) => r.wp === 1380 && /sera déplacé ici/.test(r.text)));
  const rows = W.toRows(later, map, imported);
  assert.equal(rows.appts.length, 14, 'bookings already imported are sent again: the server decides what changed');
  const res = await send(t, rows);
  assert.deepEqual([res.appts.cancelled, res.appts.moved, res.appts.closed, res.appts.booked, res.clients.added], [1, 1, 1, 1, 0]);
  assert.equal(byWp(t, 1360).status, 'cancelled');
  assert.equal(byWp(t, 1360).cancel.reason, 'Annulé sur l’ancien site');
  const sami = byWp(t, 1380);
  assert.deepEqual([sami.day, sami.start, sami.staffId, sami.status], ['2026-11-19', 960, t.ids.soldat, 'booked']);
  assert.ok(res.review.some((r) => r.wp === 1380 && /Déplacé sur l’ancien site/.test(r.text)));
  const yanis = byWp(t, 1350);
  assert.deepEqual([yanis.status, yanis.legacy, yanis.saleId], ['done', true, null], 'taken place on the old site: history, not to be paid here');
  assert.equal(clientStats(s, '2026-11-12', t.clock.now).get(t.ids.yanis).visits, 2, '6 Oct and 10 Nov');
  assert.deepEqual([byWp(t, 1361).start, res.review.filter((r) => r.wp === 1361).length], [960, 0], 'a move made only here is kept, quietly');
  assert.equal(byWp(t, 1390).clientId, byWp(t, 1201).clientId);
  // and a third run changes nothing more
  const v = s.version;
  const third = await send(t, W.toRows(later, map, priors(t, later)));
  assert.equal(s.version, v);
  assert.equal(third.appts.already, 14);
  // the WXR dropped afterwards fills in what the CSV lacked: the secret of the old e-mail links, the real length
  const withWxr = W.readFiles([{ name: 'export.csv', text }, { name: 'reservations.xml', text: WXR }]);
  const fill = await send(t, W.toRows(withWxr, map, priors(t, withWxr)));
  assert.ok(fill.appts.updated >= 1);
  assert.equal(byWp(t, 1350).ext.uniq, sha256('7f3a9c1e2b4d6f8091a2b3c4d5e6f708'));
  assert.equal(byWp(t, 1310).status, 'no_show', 'a past visit the WXR says was a no-show');
});

test('an upcoming booking needs an active chair: never the archived profile, which has no lane in the agenda', async () => {
  const t = await shop();
  t.clock.now = at('2026-10-27', 10);
  const p = W.readFiles([{ name: 'export.csv', text: CSV }]);
  const map = mapping(t, p);
  assert.equal(map.staff['John'], '', 'John has an upcoming booking (28 Oct): no default to the archived profile');
  assert.ok(W.upcomingNames(p, t.clock.now, { map }).has('John'));
  const pv = W.preview(p, map, t.clock.now, { chairs: chairsOf(t) });
  assert.ok(pv.review.some((r) => r.wp === 1315 && /choisis un barbier actif/.test(r.text)));
  // forced through anyway (an old wizard, a script): the server leaves it out and says so
  const res = await send(t, W.toRows(p, { ...map, staff: { ...map.staff, John: W.LEGACY } }));
  assert.equal(byWp(t, 1315), undefined);
  assert.ok(res.review.some((r) => r.wp === 1315 && r.kind === 'staff'));
  assert.equal(byWp(t, 1302).staffId, [...t.engine.state.staff.values()].find((x) => x.legacy).id, 'history stays on the archived profile');
  const r2 = await send(t, W.toRows(p, { ...map, staff: { ...map.staff, John: t.ids.jkut } }));
  assert.equal(r2.appts.booked, 1);
  assert.equal(byWp(t, 1315).staffId, t.ids.jkut);
  assert.equal(LEGACY_STAFF, W.LEGACY);
});

test('reading edge cases: English dates, impossible days, deposits, bounds, UTF-8 sizes, a bookings-only WXR', async () => {
  assert.deepEqual(W.parseWhen('Nov 12, 2026 2:30 pm'), { day: '2026-11-12', min: 870 });
  assert.deepEqual(W.parseWhen('Thu, Nov 12, 2026 10:00'), { day: '2026-11-12', min: 600 });
  assert.equal(W.parseWhen('31 Juin 2026 10:00'), null, 'no 31 June');
  assert.equal(W.parseWhen('29/02/2026 10:00'), null);
  assert.deepEqual(W.parseWhen('29/02/2028 10:00'), { day: '2028-02-29', min: 600 });
  const head = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"PRIX TOTAL",ÉTAT\n';
  const p = W.readFiles([{ name: 'a.csv', text: head + '7,"20 Nov 2026 10:00",,Ana,B,,0611111111,Coupe,JKut,"40 € (10 € déjà payé en acompte)",Confirmé\n' }, { name: 'empty.csv', text: head }]);
  assert.equal(p.bookings[0].paid, 1000, 'a deposit paid online, whatever the status');
  assert.deepEqual(p.files.map((f) => [f.rows, f.dupes]), [[1, 0], [0, 0]]);
  p.bookings[0].dur = 720;
  const rows = W.toRows(p, { services: { Coupe: 'sv1' }, staff: { JKut: 'st1' } });
  assert.equal(rows.appts[0].dur, undefined, 'a duration the server would refuse is left out, not the whole batch');
  const heavy = Array.from({ length: 60 }, () => ({ notes: 'é'.repeat(1000) }));
  for (const part of W.chunks(heavy)) assert.ok(new TextEncoder().encode(JSON.stringify(part)).length < 64000, 'counted in bytes');
  const wxr = WXR.replace(/<item>(?:(?!<\/item>)[\s\S])*?<wp:post_type>(?:<!\[CDATA\[)?sln_(?:service|attendant)(?:\]\]>)?<\/wp:post_type>[\s\S]*?<\/item>/g, '');
  const q = W.readFiles([{ name: 'r.xml', text: wxr }]);
  assert.ok(q.problems.some((x) => /Tout le contenu/.test(x.text)), 'bookings without the services they name: say so');
});

test('a paper card taken over at the counter with a code that reads as nothing: the new code is returned', async () => {
  const t = await shop();
  const r = await t.engine.run(importGiftcard, { code: '---', amount: 2000, expires: '2027-06-30' }, t.asOwner());
  assert.match(r.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('with the WXR export: no-shows, notes, durations, the link secret, and a booking the CSV missed', async () => {
  const t = await shop();
  const p = W.readFiles([{ name: 'export.csv', text: CSV }, { name: 'reservations.xml', text: WXR }]);
  assert.deepEqual(p.files.map((f) => f.kind), ['bookings', 'wxr']);
  const map = mapping(t, p);
  const res = await send(t, W.toRows(p, map));
  assert.deepEqual([res.appts.done, res.appts.noShow, res.appts.booked], [6, 1, 5]);
  assert.equal(byWp(t, 1310).status, 'no_show');
  const a = byWp(t, 1350);
  assert.equal(a.dur, 45);
  assert.equal(a.ext.uniq, sha256('7f3a9c1e2b4d6f8091a2b3c4d5e6f708'), 'only a hash of the secret is kept');
  assert.ok(!JSON.stringify(t.engine.journal).includes('7f3a9c1e2b4d6f8091a2b3c4d5e6f708'));
  assert.match(a.note, /Garde la longueur/);
  const adam = byWp(t, 1400);
  assert.deepEqual([adam.day, adam.start, adam.staffId, adam.services[0].id, adam.status], ['2026-11-24', 600, t.ids.soldat, t.ids.cut, 'booked']);
  assert.equal(t.engine.state.clients.get(adam.clientId).first, 'Adam');
  const lucas = t.engine.state.clients.get(byWp(t, 1310).clientId);
  assert.equal(clientStats(t.engine.state, DAY, t.clock.now).get(lucas.id).noShows, 1);
  assert.equal(W.unserialize('a:1:{i:0;a:2:{s:7:"service";i:30;s:5:"price";d:25.5;}}')?.['0']?.price, 25.5);
  assert.equal(W.unserialize('s:6:"Coupé";'), 'Coupé', 'string lengths are in bytes');
});

/* ---------------- through the API, on a production salon ---------------- */

const SECRET = 'test-secret-0123456789';
async function production() {
  const clock = { now: at(DAY, 10) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const owner = browser(rt);
  const setup = await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) };
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ids = {
    jkut: (await rt.engine.run(addStaff, { name: 'JKut', role: 'barber', schedule: week }, as)).id,
    cut: (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, as)).id,
    pack: (await rt.engine.run(addService, { name: 'Abonnement 5 coupes', category: 'Abonnement', price: 8000, dur: 30, pack: { credits: 5, days: 70 } }, as)).id
  };
  return { rt, clock, owner, ids };
}
const post = (b, path, body) => b.post(path, body, { 'x-request-id': 'rq-' + Math.random().toString(36).slice(2, 12) });

test('the API: preview, batch, paper gift cards in the liabilities and in no Z, subscriptions, old e-mail links', async () => {
  const { rt, owner, ids } = await production();
  const p = W.readFiles([
    { name: 'export.csv', text: CSV }, { name: 'reservations.xml', text: WXR },
    { name: 'cartes.csv', text: 'code;solde;expire_le\nKDO-2025-0042;50,00 €;31/12/2026\nKDO-2024-0007;30;01/01/2025\n' },
    { name: 'abonnements.csv', text: 'telephone;coupes_restantes;expire_le\n06 98 76 54 32;3;15/01/2027\n0600000000;2;15/01/2027\n' }
  ]);
  assert.deepEqual(p.files.map((f) => f.kind), ['bookings', 'wxr', 'giftcards', 'packs']);
  const map = { services: Object.fromEntries(W.names(p).services.map(([n]) => [n, ids.cut])), staff: { JKut: ids.jkut } };

  const pre = await owner.post('/api/v1/import/preview', { keys: [{ phone: '0698765432' }], wp: [1350] });
  assert.equal(pre.status, 200, JSON.stringify(pre.json));
  assert.deepEqual(pre.json, { known: [], again: [], erased: [], imported: [], appts: [] });

  const rows = W.toRows(p, map);
  for (const part of ['appts', 'giftcards', 'packs']) {
    const r = await post(owner, '/api/v1/import/batch', { [part]: rows[part] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    if (part === 'giftcards') assert.deepEqual(r.json.giftcards, { added: 1, already: 0, skipped: 1 }, 'an expired card is left out');
    if (part === 'packs') {
      assert.deepEqual(r.json.packs, { added: 1, already: 0, skipped: 1 });
      assert.ok(r.json.review.some((x) => x.kind === 'pack' && /Aucun client/.test(x.text)));
    }
  }
  const pre2 = await owner.post('/api/v1/import/preview', { keys: [{ phone: '0698765432' }, { email: 'personne@exemple.fr' }], wp: [1350, 9999] });
  assert.deepEqual([pre2.json.known, pre2.json.again, pre2.json.imported], [[], [0], [1350]], 'a file an earlier run created is not counted as merged');
  assert.deepEqual(pre2.json.appts, [{ wp: 1350, day: '2026-11-10', start: 600, dur: 45, staffId: ids.jkut, status: 'booked', open: true, movedHere: false }]);

  // the cut-over day itself: this morning's visit, already over and paid on the old till, is history, not to be paid here
  const head = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"PRIX TOTAL",ÉTAT\n';
  const morning = W.readFiles([{ name: 'today.csv', text: head + '1500,"03 Nov 2026 09:00",,Omar,Test,,0612121212,Coupe,JKut,"20 €",Payant\n' }]);
  const unpaid0 = (await owner.get('/api/v1/drawer')).json.unpaid;
  assert.equal((await post(owner, '/api/v1/import/batch', W.toRows(morning, { services: { Coupe: ids.cut }, staff: { JKut: ids.jkut } }))).json.appts.done, 1);
  assert.equal((await owner.get('/api/v1/drawer')).json.unpaid, unpaid0, 'not counted as waiting at the till');
  const today = (await owner.get('/api/v1/agenda?day=' + DAY)).json.appts.find((a) => a.name.startsWith('Omar'));
  assert.deepEqual([today.status, today.legacy, today.saleId, today.source], ['done', true, null, 'import']);

  assert.equal((await browser(rt).post('/api/v1/import/batch', { appts: [] })).status, 401, 'signed in only');

  // the legacy gift card: in the outstanding balance, in no Z, and usable at the till
  const gc = await owner.get('/api/v1/giftcards');
  assert.equal(gc.json.outstanding, 5000);
  assert.equal(gc.json.items[0].last4, '0042');
  const sale = await post(owner, '/api/v1/sales', { lines: [{ kind: 'service', ref: ids.cut }], payments: [{ method: 'card', amount: 2000 }] });
  assert.equal(sale.status, 200, JSON.stringify(sale.json));
  const z = await post(owner, '/api/v1/closures', { early: true });
  assert.equal(z.status, 200, JSON.stringify(z.json));
  assert.deepEqual([z.json.revenue, z.json.liability, z.json.tickets], [2000, 0, 1], 'the paper card is not sold again in a Z');
  assert.ok(![...rt.engine.state.closures.values()].some((c) => c.liability));

  // the subscription taken over: 3 cuts on the salon's subscription
  const pk = [...rt.engine.state.packs.values()];
  assert.equal(pk.length, 1);
  assert.deepEqual([pk[0].total, pk[0].used, pk[0].expires, pk[0].serviceId, pk[0].legacy], [3, 0, '2027-01-15', ids.pack, true]);
  assert.equal(rt.engine.state.clients.get(pk[0].clientId).phone, '+33698765432');
  const again = await post(owner, '/api/v1/import/batch', { giftcards: rows.giftcards, packs: rows.packs });
  assert.deepEqual([again.json.giftcards.already, again.json.packs.already], [1, 1]);

  // single takeovers (the till's 'Reprendre une carte', the client file's 'Reprendre un abonnement')
  const one = await post(owner, '/api/v1/import/giftcard', { amount: 3000, expires: '2027-06-30' });
  assert.equal(one.status, 200, JSON.stringify(one.json));
  assert.match(one.json.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'no code typed: a new one is printed for it');
  assert.equal((await post(owner, '/api/v1/import/giftcard', { code: 'kdo 2025 0042', amount: 1000, expires: '2027-06-30' })).status, 409);
  const yanis = [...rt.engine.state.clients.values()].find((c) => c.first === 'Yanis');
  const onePk = await post(owner, '/api/v1/import/pack', { clientId: yanis.id, left: 2, expires: '2027-01-01' });
  assert.equal(onePk.status, 200, JSON.stringify(onePk.json));
  assert.equal((await post(owner, '/api/v1/import/pack', { clientId: yanis.id, left: 2, expires: '2027-01-01' })).status, 409);

  // the old e-mail links: the right secret opens the appointment's own page, nothing else does
  const site = browser(rt);
  const ok = await site.get('/api/public/legacy/1350?u=7F3A9C1E2B4D6F8091A2B3C4D5E6F708');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.json.url, /^\/r\/[^/?#]+$/);
  const view = await site.get('/api/public/bookings/' + ok.json.url.slice(3));
  assert.equal(view.status, 200);
  assert.equal(view.json.day, '2026-11-10');
  assert.equal((await site.get('/api/public/legacy/1350?u=0000000000000000000000000000dead')).status, 404, 'wrong md5');
  assert.equal((await site.get('/api/public/legacy/1350')).status, 404);
  assert.equal((await site.get('/api/public/legacy/1360?u=7f3a9c1e2b4d6f8091a2b3c4d5e6f708')).status, 404, 'another booking’s secret');
  assert.equal((await site.get('/api/public/legacy/424242?u=7f3a9c1e2b4d6f8091a2b3c4d5e6f708')).status, 404);
  const flood = browser(rt);
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await flood.get('/api/public/legacy/' + (5000 + i) + '?u=abc')).status;
  assert.equal(last, 429, '20 lookups per hour per address');
});
