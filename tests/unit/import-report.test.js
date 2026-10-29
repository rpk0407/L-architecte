// The record of a WordPress run: kept, adding up, without personal data; the bookings deleted on the old site, the
// conflicts (same number other first name, an e-mail already elsewhere, a new number for a customer), the 3-year
// retention, the consent provenance, and the preview that promises what the batch does. The browser's code
// (web/src/lib/wpimport.ts) runs as is in Node, the wizard's sequence is replayed by `wizard` below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { salon, rejects, DAY, at } from '../helpers.js';
import * as W from '../../web/src/lib/wpimport.ts';
import { importBatch, startImportRun, finishImportRun, knownClient, rowTomb, priorView, inWindow, busyView, runLines, say, KIND_TEXT } from '../../server/commands/import.js';
import { addClient, eraseClient, tombKeyOf } from '../../server/commands/clients.js';
import { createAppointment, setStatus, moveAppointment } from '../../server/commands/agenda.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { retentionCutoff, RETENTION_YEARS } from '../../shared/retention.js';
import * as C from '../../server/commands/clients.js';
import { createEngine } from '../../server/core/engine.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { browser } from '../api/client.js';

const fixture = (f) => readFileSync(new URL('../fixtures/' + f, import.meta.url), 'utf8');
const CSV = fixture('wp-bookings-fr.csv');
const DELTA = fixture('wp-bookings-fr-delta.csv');
const WXR = fixture('wp-bookings.wxr.xml');
const HEAD = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT\n';
const PREAMBLE = 'Réservations,de,à\n,"01 Jan 2025","31 Déc 2026"\n\n';
const SECRET = 'test-secret-0123456789';
const TOMB = tombKeyOf(SECRET);
const withKey = (base) => ({ ...base, meta: { ...(base.meta || {}), tombKey: TOMB } });

/** Same salon as import.test.js: Ali, Ben, JKut, Le Soldat, the services of the old menu, Yanis Martin on 06 12 34 56 78. */
async function shop() {
  const t = await salon();
  const as = t.asOwner();
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  t.ids.jkut = (await t.engine.run(addStaff, { name: 'JKut', role: 'barber', schedule: week }, as)).id;
  t.ids.soldat = (await t.engine.run(addStaff, { name: 'Le Soldat', role: 'barber', schedule: week }, as)).id;
  t.ids.cc = (await t.engine.run(addService, { name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' }, as)).id;
  return t;
}
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
const byWp = (t, wp) => t.engine.state.appts.get(t.engine.state.apptByWp.get(String(wp)));
const chairsOf = (t) => new Set([...t.engine.state.staff.values()].filter((x) => x.active && x.chair).map((x) => x.id));
/** the salon's clock stays on DAY in these tests */
const todayOf = () => DAY;
const owner = (t) => withKey(t.asOwner());
/** Erasing a file with open bookings first queues their cancellation texts; the second call erases. */
async function erase(t, id) { for (let i = 0; i < 2; i++) if ((await t.engine.run(eraseClient, { id, cancelUpcoming: true }, owner(t))).erased) return; assert.fail('not erased'); }

/** What the wizard asks the server before it sends anything (POST /api/v1/import/preview), then the run itself. */
async function ask(t, p, map) {
  const s = t.engine.state, today = todayOf(t);
  const ids = W.preview(p, { services: {}, staff: {} }, t.clock.now).identities;
  const keys = ids.flatMap((list, g) => list.map((k) => ({ ...k, g })));
  const known = new Set(), again = new Set(), erased = new Map();
  for (const k of keys) {
    const w = knownClient(s, k, TOMB);
    if (w === 'salon') known.add(k.g); else if (w === 'wordpress') again.add(k.g);
    else if (w === 'erased') erased.set(k.g, Math.max(rowTomb(s, k, TOMB).at, erased.get(k.g) || 0));
  }
  const imported = new Map(priorView(s, p.bookings.map((b) => b.wp)).map((a) => [a.wp, a]));
  const days = [...new Set(p.bookings.filter((b) => b.day >= today).map((b) => b.day))].slice(0, 120);
  const svcDur = Object.fromEntries([...s.services.values()].map((x) => [x.id, { dur: x.dur, buffer: x.buffer || 0 }]));
  const opts = { known, again, erased, imported, chairs: chairsOf(t), today, inWindow: inWindow(s, p.windows, today), busy: busyView(s, days), svcDur };
  const pv = W.preview(p, map, t.clock.now, opts);
  return { pv, opts, imported };
}
/** Files in, run out: preview, start, every batch with the run and its index, finish (unless `stop` batches were sent). */
async function wizard(t, files, { map: m, stop, chunk = 150 } = {}) {
  const p = W.readFiles(files);
  const map = m || mapping(t, p);
  const { pv, opts, imported } = await ask(t, p, map);
  const rows = W.toRows(p, map, imported, { today: opts.today, known: opts.known, again: opts.again, erased: opts.erased, gone: pv.gone, now: t.clock.now, chairs: opts.chairs });
  const parts = [
    ...W.chunks(rows.clients, chunk).map((x) => ({ clients: x })), ...W.chunks(rows.appts, chunk).map((x) => ({ appts: x })),
    ...W.chunks(rows.giftcards, chunk).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs, chunk).map((x) => ({ packs: x })), ...W.chunks(rows.gone, chunk).map((x) => ({ gone: x }))
  ];
  const { id } = await t.engine.run(startImportRun, W.runBody(p, pv, map, p.files.map(() => '0123456789abcdef'), parts.length), owner(t));
  const answers = [];
  for (const [i, body] of parts.entries()) {
    if (stop != null && i >= stop) break;
    answers.push(await t.engine.run(importBatch, { ...body, run: id, i }, owner(t)));
  }
  if (stop == null) await t.engine.run(finishImportRun, { id }, owner(t));
  return { p, map, pv, rows, id, answers, run: t.engine.state.imports.runs.get(id) };
}
/** The batches' answers summed the way the run record sums its events. */
function summed(answers) {
  const out = { clients: { added: 0, merged: 0, again: 0 }, appts: {}, giftcards: {}, packs: {}, skip: {} };
  for (const a of answers) {
    out.clients.added += a.clients.added; out.clients.merged += a.clients.merged.length; out.clients.again += a.clients.again;
    for (const k of ['appts', 'giftcards', 'packs', 'skip']) for (const [x, v] of Object.entries(a[k])) out[k][x] = (out[k][x] || 0) + v;
  }
  return out;
}
const reasons = (rows, type) => Object.fromEntries(rows.find((r) => r.type === type).reasons.map((x) => [x.key, x.n]));

/* ---------------- through the API, on a production salon ---------------- */

async function production() {
  const clock = { now: at(DAY, 10) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: SECRET, SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const b = browser(rt);
  const setup = await b.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  const boss = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: boss.id }, staff: boss, caps: capsOf(boss, rt.engine.state.settings) };
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ids = {};
  for (const n of ['JKut', 'Le Soldat']) ids[n] = (await rt.engine.run(addStaff, { name: n, role: 'barber', schedule: week }, as)).id;
  ids.cut = (await rt.engine.run(addService, { name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, as)).id;
  ids.beard = (await rt.engine.run(addService, { name: 'Coupe + barbe', category: 'Coupes', price: 3000, dur: 30 }, as)).id;
  ids.cc = (await rt.engine.run(addService, { name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' }, as)).id;
  ids.yanis = (await rt.engine.run(addClient, { first: 'Yanis', last: 'Martin', phone: '06 12 34 56 78' }, as)).id;
  return { rt, clock, b, ids, engine: rt.engine };
}
let rq = 0;
const post = (b, path, body) => b.post(path, body, { 'x-request-id': 'rq-report-' + ++rq + '-' + Math.random().toString(36).slice(2, 10) });

test('a run leaves a record: start, three batches, finish; the counts are the batches’ sums; a re-run only finds what is already there', async () => {
  const P = await production();
  const t = { engine: P.engine, clock: P.clock };
  const p = W.readFiles([{ name: 'export.csv', text: CSV }]);
  const map = mapping(t, p);
  const { pv, opts, imported } = await ask(t, p, map);
  const rows = W.toRows(p, map, imported, { today: opts.today, gone: pv.gone, now: t.clock.now, chairs: opts.chairs });
  assert.equal(rows.appts.length, 14);
  const parts = W.chunks(rows.appts, 5);
  assert.equal(parts.length, 3);

  const body = W.runBody(p, pv, map, ['0123456789abcdef'], parts.length);
  const start = await post(P.b, '/api/v1/import/runs', body);
  assert.equal(start.status, 200, JSON.stringify(start.json));
  assert.match(start.json.id, /^ir_/);
  const answers = [];
  for (const [i, appts] of parts.entries()) {
    const r = await post(P.b, '/api/v1/import/batch', { appts, run: start.json.id, i });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    answers.push(r.json);
  }
  // not finished: the report says it was interrupted until the browser closes it
  assert.equal((await P.b.get('/api/v1/import/runs/' + start.json.id)).json.run.finishedAt, null);
  assert.equal((await post(P.b, '/api/v1/import/runs/' + start.json.id + '/finish', {})).status, 200);

  const got = (await P.b.get('/api/v1/import/runs/' + start.json.id)).json;
  const sum = summed(answers);
  assert.deepEqual(got.run.counts.appts, sum.appts, 'the run adds the batches’ answers up');
  assert.deepEqual(got.run.skip, sum.skip);
  assert.equal(got.run.counts.clients.added, sum.clients.added);
  assert.equal(got.run.batches, 3);
  assert.equal(got.run.parts, 3);
  assert.equal(got.run.by, 'Gérant');
  assert.equal(got.run.source, 'files');
  assert.ok(got.run.finishedAt);
  assert.deepEqual(got.run.window, [{ from: '2025-01-01', to: '2026-12-31' }], 'the preamble of the CSV');
  assert.deepEqual(got.run.files.map(({ newest, ...f }) => f), [{ name: 'export.csv', kind: 'bookings', rows: 14, sha: '0123456789abcdef' }]);
  assert.ok(got.run.files[0].newest > Date.UTC(2026, 0, 1), 'the newest creation time of the file is kept: how fresh the export is');
  assert.ok(got.lines.length > 0 && got.lines.every((l) => typeof l.text === 'string' && typeof l.todo === 'boolean'));
  assert.equal((await P.b.get('/api/v1/import/runs')).json.runs[0].id, start.json.id);
  assert.equal((await P.b.get('/api/v1/import/runs/ir_nope')).status, 404);
  assert.equal((await browser(P.rt).get('/api/v1/import/runs')).status, 401);

  // the same files again: a second run, with only « déjà là »
  const p2 = W.readFiles([{ name: 'export.csv', text: CSV }]);
  const a2 = await ask(t, p2, map);
  const rows2 = W.toRows(p2, map, a2.imported, { today: a2.opts.today, known: a2.opts.known, again: a2.opts.again, now: t.clock.now, chairs: a2.opts.chairs });
  const s2 = await post(P.b, '/api/v1/import/runs', W.runBody(p2, a2.pv, map, ['0123456789abcdef'], 1));
  const r2 = await post(P.b, '/api/v1/import/batch', { appts: rows2.appts, run: s2.json.id, i: 0 });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal((await post(P.b, '/api/v1/import/runs/' + s2.json.id + '/finish', {})).status, 200);
  const again = (await P.b.get('/api/v1/import/runs/' + s2.json.id)).json.run;
  assert.deepEqual(Object.fromEntries(Object.entries(again.counts.appts).filter(([, v]) => v)), { already: 13, skipped: 1 }, 'only what is already there (and the ERREUR row, skipped again)');
  assert.equal(again.counts.clients.added, 0);
  assert.equal((await P.b.get('/api/v1/import/runs')).json.runs.length, 2);
  // the people the re-run carried over count as « déjà là »; the one whose only booking is in error has no visit to keep: left out, no file
  const rc = W.reconcile(again).find((x) => x.type === 'clients');
  assert.deepEqual([rc.source, rc.made, rc.already, rc.skipped, rc.left, rc.gap], [7, 0, 6, 0, 1, 0]);
  assert.ok(W.reconcile(again).every((x) => x.gap === 0));

  // a finished run takes no more batches
  const late = await post(P.b, '/api/v1/import/batch', { appts: [], run: start.json.id, i: 9 });
  assert.equal(late.status, 409);
  assert.equal(late.json.error.code, 'run_closed');
  assert.equal(late.json.error.message, 'Cette reprise est terminée : relance l’import, rien ne sera compté deux fois.');
  assert.equal((await post(P.b, '/api/v1/import/batch', { appts: [], run: 'ir_unknown', i: 0 })).json.error.code, 'run_closed');
  // closing twice changes nothing
  const v = P.engine.state.version;
  assert.equal((await post(P.b, '/api/v1/import/runs/' + start.json.id + '/finish', {})).status, 200);
  assert.equal(P.engine.state.version, v);
});

test('a run that stops halfway reads as interrupted, and the next one counts nothing twice', async () => {
  const t = await shop();
  const half = await wizard(t, [{ name: 'a.csv', text: CSV }], { stop: 1, chunk: 5 });
  assert.equal(half.run.finishedAt, null);
  assert.deepEqual([half.run.batches, half.run.parts], [1, 3]);
  const full = await wizard(t, [{ name: 'a.csv', text: CSV }], { chunk: 5 });
  assert.ok(full.run.finishedAt);
  const sum = summed(full.answers);
  assert.equal(sum.appts.already, 5, 'the first five bookings are what the half run brought in');
  const total = ['done', 'noShow', 'cancelled', 'booked'].reduce((n, k) => n + (half.run.counts.appts[k] || 0) + (full.run.counts.appts[k] || 0), 0);
  assert.equal(total, 13, 'every booking exists once');
});

test('it adds up: rows of the export = made + already there + skipped by reason + left out', async () => {
  const t = await shop();
  // the FR fixture plus a past booking whose online payment never went through
  const text = CSV + '1450,"05 Oct 2026 09:00","04 Oct 2026 10:00",Zoé,Test,,0633333333,Coupe,JKut,1,"20 €","Paiement en attente"\n';
  const r = await wizard(t, [{ name: 'export.csv', text }]);
  const rep = W.reconcile(r.run);
  const b = rep.find((x) => x.type === 'bookings');
  assert.equal(b.source, 15);
  assert.deepEqual(reasons(rep, 'bookings'), { error: 1, unpaid: 1 });
  assert.equal(b.made + b.already + b.skipped + b.left, 15);
  assert.deepEqual([b.made, b.already, b.skipped, b.left, b.gap], [13, 0, 2, 0, 0]);
  assert.ok(rep.every((x) => x.gap === 0), JSON.stringify(rep));
  assert.deepEqual([r.run.skip.error, r.run.skip.unpaid], [1, 1]);
  // the lines say why, in the exact words
  const lines = runLines(t.engine.state, r.run);
  const line = (kind) => lines.filter((l) => l.kind === kind);
  assert.deepEqual(line('error').map((l) => [l.wp, l.text, l.todo]), [[1311, 'État « Erreur » sur l’ancien site : ignoré', false]]);
  assert.deepEqual(line('unpaid').map((l) => [l.wp, l.text]), [[1450, 'Paiement en ligne jamais terminé sur l’ancien site : ignoré']]);
  assert.ok(line('overlap').every((l) => l.todo) && line('pending').every((l) => l.todo));
  // the clients: people, counted once for the whole run
  const c = rep.find((x) => x.type === 'clients');
  assert.equal(c.source, 8, 'Mehdi, Karim, Yanis, Lucas, Hugo, Nolan, Sami, Zoé');
  // Zoé (her online payment never went through) and the person whose only booking is in error have no visit to keep: no file for them
  assert.deepEqual([c.made, c.already, c.left], [5, 1, 2]);
  assert.ok(c.gap === 0);

  // and the preview promised exactly that (clients-ops.test.js does the same for the batch)
  const sum = summed(r.answers);
  assert.equal(sum.clients.added, r.pv.counts.newClients);
  assert.equal((sum.appts.done || 0) + (sum.appts.noShow || 0) + (sum.appts.booked || 0) + (sum.appts.cancelled || 0), r.pv.counts.past + r.pv.counts.noShow + r.pv.counts.upcoming + r.pv.counts.cancelled);
  assert.equal(sum.skip.error + sum.skip.unpaid, r.pv.counts.skipped);
  assert.equal(r.pv.totals.bookings, 15);
});

test('what is left out before sending is counted too: repeats across files, unreadable lines, a WXR item in an unknown state', async () => {
  const t = await shop();
  const bad = CSV + '1460,"31 Juin 2026 10:00",,Test,Test,,0644444444,Coupe,JKut,1,"20 €",Confirmé\n';
  const wxr = WXR.replace('sln-b-paid', 'sln-b-frobnicated');
  const files = [{ name: 'a.csv', text: bad }, { name: 'b.csv', text: CSV }, { name: 'c.xml', text: wxr }];
  const p = W.readFiles(files);
  assert.ok(p.problems.some((x) => x.kind === 'status-unknown' && /1350/.test(x.text) && /État inconnu sur l’ancien site : ligne ignorée/.test(x.text)));
  assert.ok(p.unreadable.has(1460) && p.unreadable.has(1460) === true);
  const r = await wizard(t, files);
  const b = W.reconcile(r.run).find((x) => x.type === 'bookings');
  // 15 lines in a.csv (14 + the unreadable one), the same 14 again in b.csv, 3 items in the XML: one in a state the plugin does not know, one repeating the CSV, one only there
  assert.equal(r.run.excluded.duplicate, 14 + 1, 'b.csv again, and the XML’s repeat of 1310');
  assert.equal(r.run.excluded.unreadable, 2, 'the 31 June and the XML item in an unknown state');
  assert.equal(b.gap, 0, JSON.stringify(b));
  assert.equal(r.run.excluded.by.bookings, r.run.excluded.duplicate + r.run.excluded.unreadable);
});

/* ---------------- bookings deleted on the old site ---------------- */

test('deleted on the old site: cancelled here with its reason and no message, unless someone handled it here', async () => {
  const t = await shop();
  await wizard(t, [{ name: 'export.csv', text: CSV }]);
  assert.equal(byWp(t, 1380).status, 'booked');
  assert.equal(byWp(t, 1361).status, 'booked');
  // Lucas has arrived here on the 15th; both his booking and Sami's are gone from the next export
  await t.engine.run(setStatus, { id: byWp(t, 1361).id, status: 'arrived' }, t.asOwner());
  const text = DELTA.split('\n').filter((l) => !l.startsWith('1361,')).join('\n');
  const v0 = t.engine.state.version;
  const r = await wizard(t, [{ name: 'export-delta.csv', text }]);
  const sami = byWp(t, 1380);
  assert.equal(sami.status, 'cancelled');
  assert.equal(sami.cancel.reason, 'Supprimé sur l’ancien site');
  assert.equal(sami.cancel.by, 'salon');
  const ev = t.engine.journal.slice(v0);
  assert.ok(!ev.some((e) => e.type === 'message.queued'), 'no SMS to the client');
  assert.equal(ev.find((e) => e.type === 'appt.cancelled').data.gone, true);
  assert.equal(byWp(t, 1361).status, 'arrived', 'handled here: left alone');
  assert.equal(summed(r.answers).appts.gone, 1);
  const lines = runLines(t.engine.state, r.run);
  assert.deepEqual(lines.filter((l) => l.kind === 'gone').map((l) => [l.wp, l.text, l.todo]), [[1380, 'Supprimé sur l’ancien site : annulé ici, sans SMS', false]]);
  assert.deepEqual(lines.filter((l) => l.kind === 'gone-handled').map((l) => [l.wp, l.text, l.todo]), [[1361, 'Supprimé sur l’ancien site, mais déjà pris en charge ici : vérifie', true]]);
  // the report still adds up: the deleted ones are not rows of the export
  assert.ok(W.reconcile(r.run).every((x) => x.gap === 0));
  // and sending it again cancels nothing more
  const v1 = t.engine.state.version;
  const again = await wizard(t, [{ name: 'export-delta.csv', text }]);
  assert.equal(summed(again.answers).appts.gone || 0, 0);
  assert.deepEqual(t.engine.journal.slice(v1).map((e) => e.type).filter((x) => x.startsWith('appt.')), []);
});

test('deleted on the old site: an export without its period cannot say what is missing, and a short export cancels nothing', async () => {
  const t = await shop();
  await wizard(t, [{ name: 'export.csv', text: CSV }]);
  // no « de / à » preamble: it covers nothing
  const bare = DELTA.split('\n').slice(3).join('\n');
  const r = await wizard(t, [{ name: 'bare.csv', text: bare }]);
  assert.deepEqual(r.p.windows, []);
  assert.equal(byWp(t, 1380).status, 'booked');
  assert.deepEqual(r.pv.gone, []);
  // the WXR covers nothing either
  const x = await wizard(t, [{ name: 'r.xml', text: WXR }]);
  assert.deepEqual(x.pv.gone, []);

  // twelve upcoming bookings, six of them missing from the next export: half the agenda would go, nothing is sent
  const t2 = await shop();
  const day = (i) => '2026-12-' + String(i + 1).padStart(2, '0');
  const row = (i) => `${2000 + i},"${day(i).split('-').reverse().join(' ').replace(' 12 ', ' Déc ')} 10:00",,Client${i},Test,,06000000${String(i).padStart(2, '0')},Coupe,JKut,1,"20 €",Confirmé\n`;
  const all = Array.from({ length: 12 }, (_, i) => row(i));
  const first = await wizard(t2, [{ name: 'a.csv', text: PREAMBLE + HEAD + all.join('') }]);
  assert.equal(summed(first.answers).appts.booked, 12);
  const second = await wizard(t2, [{ name: 'b.csv', text: PREAMBLE + HEAD + all.slice(6).join('') }]);
  assert.deepEqual(second.pv.gone, []);
  assert.equal(second.pv.warning, '6 rendez-vous à venir ont disparu de l’export : vérifie qu’il couvre toute la période. Rien n’est annulé.');
  assert.equal([...t2.engine.state.appts.values()].filter((a) => a.status === 'booked' && a.source === 'import').length, 12);
  // a few missing (5 or fewer) go through
  const third = await wizard(t2, [{ name: 'c.csv', text: PREAMBLE + HEAD + all.slice(5).join('') }]);
  assert.equal(third.pv.warning, '');
  assert.equal(third.pv.gone.length, 5);
  assert.equal(summed(third.answers).appts.gone, 5);
});

/* ---------------- conflicts ---------------- */

test('conflicts: same number other first name, an e-mail already on another file, a customer who changed number', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  const ali = (await t.engine.run(addClient, { first: 'Ali', phone: '0611111111' }, as)).id;
  const ben = (await t.engine.run(addClient, { first: 'Ben', email: 'ben@exemple.fr' }, as)).id;
  const row = (wp, x) => ({ wp, day: '2026-11-10', start: 540 + (wp % 100) * 30, serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed', ...x });

  // a father books his son from his own number
  const a = await t.engine.run(importBatch, { appts: [row(901, { first: 'Karim', phone: '0612345678' })] }, as);
  assert.equal(byWp(t, 901).clientId, t.ids.yanis, 'on the file the number belongs to');
  assert.equal(byWp(t, 901).name, 'Karim', 'the typed name stays on the booking (erased with the file)');
  const nm = a.review.find((r) => r.kind === 'name');
  assert.equal(nm.text, 'Même numéro, autre prénom (« Karim ») : mis sur la fiche de Yanis Martin. Famille ?');
  // a nickname or a longer name is the same person
  const b = await t.engine.run(importBatch, { appts: [row(902, { first: 'Yan', phone: '0612345678' }), row(903, { first: 'yanis-karim', phone: '0612345678' }), row(904, { first: 'YÀNIS', phone: '0612345678' })] }, as);
  assert.deepEqual(b.review.filter((r) => r.kind === 'name').map((r) => r.wp), [], 'a prefix, or the same name in other letters, is no conflict');
  assert.equal(byWp(t, 902).name, '');

  // Ben’s e-mail typed with Ali’s number
  const c = await t.engine.run(importBatch, { appts: [row(905, { first: 'Ali', phone: '0611111111', email: 'ben@exemple.fr' })] }, as);
  assert.equal(byWp(t, 905).clientId, ali);
  assert.equal(s.clients.get(ali).email, '', 'Ali’s e-mail unchanged');
  assert.equal(c.review.find((r) => r.kind === 'email-elsewhere').text, 'Cet e-mail est déjà sur la fiche de Ben : pas copié');
  assert.equal(s.clients.get(ben).email, 'ben@exemple.fr');

  // a customer of the old site, by id: a new number is kept apart
  const d = await t.engine.run(importBatch, { appts: [row(906, { first: 'Zoé', last: 'Roux', phone: '0600000087', wpUser: 87 })] }, as);
  const zoe = byWp(t, 906).clientId;
  assert.deepEqual(s.clients.get(zoe).ext, { wp: 87 });
  assert.deepEqual(d.review.filter((r) => r.kind === 'new-number'), []);
  const e = await t.engine.run(importBatch, { appts: [row(907, { first: 'Zoé', last: 'Roux', phone: '0600000099', wpUser: 87 })] }, as);
  assert.equal(byWp(t, 907).clientId, zoe, 'one person, one file');
  assert.equal(s.clients.get(zoe).phone, '+33600000087', 'the number is not changed');
  assert.equal(e.review.find((r) => r.kind === 'new-number').text, 'Nouveau numéro sur l’ancien site pour Zoé Roux : numéro gardé, à vérifier');
  assert.equal(s.clientByPhone.get('+33600000099'), undefined);
  // a file met by number gets the customer id, for the next time
  await t.engine.run(importBatch, { appts: [row(908, { first: 'Ali', phone: '0611111111', wpUser: 55 })] }, as);
  assert.deepEqual(s.clients.get(ali).ext, { wp: 55 });
  const f = await t.engine.run(importBatch, { appts: [row(909, { first: 'Ali', phone: '0699999999', wpUser: 55 })] }, as);
  assert.equal(byWp(t, 909).clientId, ali);
  assert.ok(f.review.some((r) => r.kind === 'new-number'));
});

/* ---------------- retention ---------------- */

test('retention: nobody is brought in only to be purged, and the server defends the same rule', async () => {
  const t = await shop();
  const cutoff = retentionCutoff(DAY);
  assert.equal(RETENTION_YEARS, 3);
  assert.equal(cutoff, '2023-11-03');
  assert.equal(C.retentionCutoff(DAY), cutoff, 'clients.js re-exports the shared rule');
  const old = '2023-01-10', older = '2022-06-14', recent = '2026-09-01';
  const text = PREAMBLE + HEAD
    + `3001,"10 Jan 2023 10:00","05 Jan 2023 10:00",Vieux,Client,vieux@exemple.fr,0600000001,Coupe,JKut,1,"20 €",Confirmé\n`
    + `3002,"14 Juin 2022 10:00","10 Jun 2022 10:00",Vieux,Client,vieux@exemple.fr,0600000001,Coupe,JKut,1,"20 €",Confirmé\n`
    + `3003,"10 Jan 2023 11:00","05 Jan 2023 10:00",Fidele,Client,,0600000002,Coupe,JKut,1,"20 €",Confirmé\n`
    + `3004,"01 Sep 2026 11:00","25 Aug 2026 10:00",Fidele,Client,,0600000002,Coupe,JKut,1,"20 €",Confirmé\n`;
  const customers = 'First Name,Last Name,Email,Mobile Phone\nSans,Visite,sans@exemple.fr,0600000003\n';
  const r = await wizard(t, [{ name: 'a.csv', text }, { name: 'clients.csv', text: customers }]);
  assert.equal(old < cutoff && older < cutoff && recent > cutoff, true);
  assert.equal(r.run.excluded.retention, 1, 'one person, two bookings');
  assert.equal(r.run.excluded.noVisit, 1, 'a customer with no booking at all');
  assert.equal(byWp(t, 3001), undefined);
  assert.equal(byWp(t, 3002), undefined);
  assert.equal([...t.engine.state.clients.values()].some((c) => c.first === 'Vieux' || c.first === 'Sans'), false, 'no file made');
  // someone with a visit since stays whole, old bookings included
  assert.ok(byWp(t, 3003) && byWp(t, 3004));
  assert.equal(byWp(t, 3003).clientId, byWp(t, 3004).clientId);
  assert.equal(r.pv.excluded.by.bookings, 2);
  assert.ok(W.reconcile(r.run).every((x) => x.gap === 0), JSON.stringify(W.reconcile(r.run)));
  assert.equal(W.reconcile(r.run).find((x) => x.type === 'bookings').left, 2);

  // the same row sent anyway: the server skips it, no file is made
  const v0 = t.engine.state.version;
  const row = { wp: 3001, day: old, start: 600, first: 'Vieux', last: 'Client', phone: '0600000001', email: 'vieux@exemple.fr', serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed' };
  const forced = await t.engine.run(importBatch, { appts: [row] }, owner(t));
  assert.equal(forced.appts.skipped, 1);
  assert.equal(forced.skip.retention, 1);
  assert.equal(forced.review[0].text, 'Plus de 3 ans sans visite : pas repris (règle de conservation)');
  assert.ok(!t.engine.journal.slice(v0).some((e) => e.type === 'client.added' || e.type === 'appt.booked'));
  // a row without any way to tell who it is, and old, never stays either
  const anon = await t.engine.run(importBatch, { appts: [{ ...row, wp: 3009, phone: undefined, email: undefined }] }, owner(t));
  assert.equal(anon.skip.retention, 1);
  // someone who already has a file keeps their history
  const known = await t.engine.run(importBatch, { appts: [{ ...row, wp: 3010, first: 'Yanis', phone: '0612345678' }] }, owner(t));
  assert.equal(known.appts.done, 1);
  // no flag can switch the rule off: the server decides from the rows it holds
  await rejects(t.engine.run(importBatch, { appts: [{ ...row, wp: 3011, phone: '0600000077', keep: true }] }, owner(t)), 'invalid');
  const lone = await t.engine.run(importBatch, { appts: [{ ...row, wp: 3011, phone: '0600000077', email: undefined }] }, owner(t));
  assert.equal(lone.skip.retention, 1);
  // an old row comes in with a person who has a visit since in the same batch, whatever the order of the rows
  const pair = await t.engine.run(importBatch, { appts: [{ ...row, wp: 3012, phone: '0600000078', email: undefined }, { ...row, wp: 3013, day: recent, phone: '0600000078', email: undefined }] }, owner(t));
  assert.equal(pair.appts.done + pair.appts.booked, 2);
  assert.equal(byWp(t, 3012).clientId, byWp(t, 3013).clientId);
  // the wizard sends the recent rows first, so an old row met in a later batch finds the file made before
  const two = await wizard(t, [{ name: 'b.csv', text: PREAMBLE + HEAD
    + `3021,"10 Jan 2023 10:00","05 Jan 2023 10:00",Tardif,Client,,0600000090,Coupe,JKut,1,"20 €",Confirmé\n`
    + `3022,"01 Sep 2026 11:00","25 Aug 2026 10:00",Tardif,Client,,0600000090,Coupe,JKut,1,"20 €",Confirmé\n` }], { chunk: 1 });
  assert.deepEqual(two.rows.appts.map((x) => x.wp), [3022, 3021]);
  assert.ok(byWp(t, 3021) && byWp(t, 3022));
  assert.equal(byWp(t, 3021).clientId, byWp(t, 3022).clientId);
});

test('the review of a pass: an id sent twice is cancelled once, a booking moved here is not promised a cancellation, the erased and the unmatched read well', async () => {
  const t = await shop();
  await wizard(t, [{ name: 'export.csv', text: CSV }]);
  const s = t.engine.state;
  // moved in the agenda since: handled here, so « open » is false and the preview does not promise to cancel it
  const sami = byWp(t, 1380);
  const mv = await t.engine.run(moveAppointment, { id: sami.id, day: sami.day, start: sami.start + 30, staffId: sami.staffId }, t.asOwner());
  assert.ok(mv);
  assert.equal(inWindow(s, [{ from: '2025-01-01', to: '2026-12-31' }], DAY).find((x) => x.wp === 1380).open, false);
  const text = DELTA.split('\n').filter((l) => !l.startsWith('1380,')).join('\n');
  const r = await wizard(t, [{ name: 'export-delta.csv', text }]);
  assert.ok(r.pv.gone.includes(1380), 'still sent: the server lists it for a look');
  assert.equal(r.pv.goneOpen, 0, 'but not counted as a change');
  assert.equal(r.pv.review.find((x) => x.wp === 1380).text, 'Supprimé sur l’ancien site, mais déjà pris en charge ici : vérifie');
  assert.equal(byWp(t, 1380).status, 'booked');
  assert.equal(runLines(s, r.run).find((l) => l.kind === 'gone-handled').wp, 1380);

  // the same id twice in one batch: one cancellation, counted once, tagged with its run
  const t2 = await shop();
  await wizard(t2, [{ name: 'export.csv', text: CSV }]);
  const { id } = await t2.engine.run(startImportRun, { source: 'files', files: [], window: [], map: { services: {}, staff: {} }, totals: { bookings: 0, clients: 0, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 } }, owner(t2));
  const v0 = t2.engine.state.version;
  const g = await t2.engine.run(importBatch, { gone: [1380, 1380], run: id }, owner(t2));
  assert.equal(g.appts.gone, 1);
  const cancels = t2.engine.journal.slice(v0).filter((e) => e.type === 'appt.cancelled');
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].data.run, id, 'WP-09 can undo it by the run tag');
  assert.equal(t2.engine.state.imports.runs.get(id).startedAt, t2.clock.now);
});

test('the unmatched service is named in the report, and a client erased leaves nothing to do', async () => {
  const t = await shop();
  const text = PREAMBLE + HEAD + `4001,"10 Nov 2026 10:00","05 Nov 2026 10:00",Karim,Benali,,0600000050,"Formule Coupe + Contour Barbe 25€",JKut,1,"25 €",Confirmé\n`
    + `4002,"11 Nov 2026 10:00","05 Nov 2026 10:00",Nora,Said,,0600000051,Coupe,JKut,1,"20 €",Confirmé\n`;
  const p = W.readFiles([{ name: 'a.csv', text }]);
  const map = mapping(t, p);
  map.services['Formule Coupe + Contour Barbe 25€'] = '';
  const r = await wizard(t, [{ name: 'a.csv', text }], { map });
  assert.equal(summed(r.answers).skip.service, 1);
  const line = runLines(t.engine.state, r.run).find((l) => l.kind === 'service');
  // an upcoming booking lost to its service label is something to do, not a note
  assert.equal(line.text, 'Prestation inconnue : Formule Coupe + Contour Barbe 25€ : ce rendez-vous à venir n’est pas dans l’agenda, ajoute-le à la main');
  assert.equal(line.todo, true);
  assert.ok(!JSON.stringify(t.engine.journal.filter((e) => e.type.startsWith('import.'))).includes('Karim'));

  // the same number under another first name, then the file is erased
  const as = owner(t);
  const row = (wp, x) => ({ wp, day: '2026-11-10', start: 540 + (wp % 100) * 30, serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed', ...x });
  const { id } = await t.engine.run(startImportRun, { source: 'files', files: [], window: [], map: { services: {}, staff: {} }, totals: { bookings: 1, clients: 1, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0 } }, as);
  await t.engine.run(importBatch, { appts: [row(4010, { first: 'Karim', phone: '0612345678' })], run: id }, as);
  let l = runLines(t.engine.state, t.engine.state.imports.runs.get(id)).find((x) => x.kind === 'name');
  assert.equal(l.todo, true);
  await erase(t, t.ids.yanis);
  l = runLines(t.engine.state, t.engine.state.imports.runs.get(id)).find((x) => x.kind === 'name');
  assert.equal(l.text, 'Client effacé : rien à faire');
  assert.equal(l.todo, false);
  // the words stay whole when the other side is gone (a replayed answer has no names)
  assert.equal(say('name', { typed: 'Karim' }), 'Même numéro, autre prénom (« Karim ») : mis sur la fiche. Famille ?');
  assert.equal(say('email-elsewhere'), 'Cet e-mail est déjà sur la fiche : pas copié');
  assert.equal(say('new-number'), 'Nouveau numéro sur l’ancien site : numéro gardé, à vérifier');
});

test('the clients row names the people whose file was erased; a re-run of nothing new is a run of « déjà là »', async () => {
  const t = await shop();
  const first = await wizard(t, [{ name: 'export.csv', text: CSV }]);
  const again = await wizard(t, [{ name: 'export.csv', text: CSV }]);
  assert.ok(again.rows.appts.length > 0, 'the bookings already there are sent, so the run can count them');
  assert.equal(again.pv.counts.already, first.pv.counts.past + first.pv.counts.noShow + first.pv.counts.upcoming + first.pv.counts.cancelled);
  const rows = W.reconcile(again.run);
  assert.ok(rows.every((x) => x.gap === 0));
  const b = rows.find((x) => x.type === 'bookings');
  assert.equal(b.made, 0);
  assert.equal(b.already, again.pv.counts.already);
  const base = rows.find((x) => x.type === 'clients');
  const rest = (base.reasons.find((x) => x.key === 'rows') || { n: 0 }).n;
  const more = W.reconcile({ ...again.run, totals: { ...again.run.totals, clients: base.source + 3 }, skippedPeople: 2 }).find((x) => x.type === 'clients');
  assert.deepEqual(more.reasons, [{ key: 'erased', n: 2 }, { key: 'rows', n: rest + 1 }]);
});

/* ---------------- consent ---------------- */

test('consent: an imported file was never asked, and no row can say otherwise', async () => {
  const t = await shop();
  const r = await wizard(t, [{ name: 'export.csv', text: CSV }]);
  const karim = t.engine.state.clients.get(byWp(t, 1201).clientId);
  assert.deepEqual([karim.marketing, karim.marketingSrc, karim.marketingAt, karim.sms, karim.source], [false, 'wordpress', t.clock.now, true, 'wordpress']);
  assert.equal(karim.ext.run, r.id, 'the file carries the run that made it');
  // old files of the salon are not touched
  assert.equal(t.engine.state.clients.get(t.ids.yanis).marketingSrc, undefined);
  const row = { first: 'Test', phone: '0600000042' };
  await rejects(t.engine.run(importBatch, { clients: [{ ...row, marketing: true }] }, owner(t)), 'invalid');
  await rejects(t.engine.run(importBatch, { clients: [{ ...row, marketingSrc: 'site' }] }, owner(t)), 'invalid');
  await rejects(t.engine.run(importBatch, { appts: [{ wp: 1, day: '2026-11-10', start: 600, ...row, marketing: true, serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed' }] }, owner(t)), 'invalid');
  await rejects(t.engine.run(importBatch, { packs: [{ ...row, left: 2, expires: '2027-01-01', sms: true }] }, owner(t)), 'invalid');
  assert.ok(![...t.engine.state.clients.values()].some((c) => c.phone === '+33600000042'));
});

/* ---------------- the preview promises what the batch does ---------------- */

test('fidelity: overlaps against the agenda, the newest file wins a repeated id, the WXR deposit fills a CSV row', async () => {
  const t = await shop();
  // a booking made in the agenda on JKut’s chair at 10:00 on 10 Nov
  await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.jkut, day: '2026-11-10', start: 600 }, t.asOwner());
  const text = PREAMBLE + HEAD
    + '4001,"10 Nov 2026 10:15",,Ana,Test,,0644000001,Coupe,JKut,1,"20 €",Confirmé\n'
    + '4002,"10 Nov 2026 11:00",,Bob,Test,,0644000002,Coupe,JKut,1,"20 €",Confirmé\n'
    + '4003,"10 Nov 2026 11:15",,Cid,Test,,0644000003,Coupe,JKut,1,"20 €",Confirmé\n';
  const p = W.readFiles([{ name: 'a.csv', text }]);
  const { pv } = await ask(t, p, mapping(t, p));
  assert.deepEqual(pv.review.filter((r) => r.kind === 'overlap').map((r) => r.wp), [4001, 4003], 'with the agenda’s booking, and with the one of this file');
  const r = await wizard(t, [{ name: 'a.csv', text }]);
  const live = summed(r.answers);
  assert.equal(r.answers.flatMap((a) => a.review).filter((x) => x.kind === 'overlap').length, pv.review.filter((x) => x.kind === 'overlap').length, 'the preview’s count is the batch’s');
  assert.equal(live.appts.booked, 3);
  // a service longer than 30 minutes: the preview reads the catalogue’s length like the server
  const t2 = await shop();
  await t2.engine.run(createAppointment, { clientId: t2.ids.yanis, serviceIds: [t2.ids.cut], staffId: t2.ids.jkut, day: '2026-11-10', start: 600 }, t2.asOwner());
  const longer = PREAMBLE + HEAD + '4010,"10 Nov 2026 09:45",,Ana,Test,,0644000001,"Décoloration",JKut,1,"60 €",Confirmé\n';
  const pl = W.readFiles([{ name: 'l.csv', text: longer }]);
  const ml = { services: { Décoloration: t2.ids.color }, staff: { JKut: t2.ids.jkut } };
  const { pv: pvl } = await ask(t2, pl, ml);
  assert.equal(pvl.review.filter((x) => x.kind === 'overlap').length, 1, '09:45 + 60 minutes meets the 10:00 booking');
  const rl = await wizard(t2, [{ name: 'l.csv', text: longer }], { map: ml });
  assert.equal(rl.answers[0].review.filter((x) => x.kind === 'overlap').length, 1);

  // the same id in two exports: the more recently modified file wins, whatever the order they were dropped in
  const one = HEAD + '4100,"20 Nov 2026 10:00",,Ana,Test,,0644000001,Coupe,JKut,1,"20 €",Confirmé\n';
  const two = HEAD + '4100,"20 Nov 2026 10:00",,Ana,Test,,0644000001,Coupe,JKut,1,"20 €",Annulé\n';
  for (const files of [
    [{ name: 'old.csv', text: one, modified: 1 }, { name: 'new.csv', text: two, modified: 2 }],
    [{ name: 'new.csv', text: two, modified: 2 }, { name: 'old.csv', text: one, modified: 1 }]
  ]) {
    const q = W.readFiles(files);
    assert.equal(q.bookings.length, 1);
    assert.equal(q.bookings[0].status, 'canceled', 'the newer export says cancelled');
    assert.deepEqual(q.files.map((f) => [f.name, f.rows, f.dupes || 0]).sort(), [['new.csv', 1, 0], ['old.csv', 0, 1]], 'the replaced row counts as a repeat of the old file');
  }
  assert.equal(W.readFiles([{ name: 'x.csv', text: one }, { name: 'y.csv', text: two }]).bookings[0].status, 'confirmed', 'without dates, the first dropped stands');

  // the deposit only the XML knows, and its no-show, fill the CSV row
  const csv = HEAD + '1350,"10 Nov 2026 10:00","02 Nov 2026 21:05",Yanis,Martin,yanis@exemple.fr,0612345678,"Coupe + barbe",JKut,1,"40 €",Confirmé\n';
  const merged = W.readFiles([{ name: 'a.csv', text: csv }, { name: 'r.xml', text: WXR }]);
  const b = merged.bookings.find((x) => x.wp === 1350);
  assert.equal(b.paid, 1000, 'the deposit of the XML');
  const t3 = await shop();
  const out = await wizard(t3, [{ name: 'a.csv', text: csv }, { name: 'r.xml', text: WXR }]);
  assert.equal(byWp(t3, 1350).ext.paid, 1000);
  assert.ok(out.answers.flatMap((a) => a.review).some((x) => x.kind === 'paid' && /Acompte de 10\s€ déjà payé/.test(x.text)));
});

/* ---------------- no personal data in the run ---------------- */

test('no personal data in the run record, and the lines say « Client effacé » once a file is erased', async () => {
  const t = await shop();
  const p = [{ name: 'export.csv', text: CSV + '1470,"11 Nov 2026 10:00",,Kader,Autre,karim.benali@exemple.fr,0698765432,Coupe,JKut,1,"20 €",Confirmé\n' }, { name: 'r.xml', text: WXR }];
  const r = await wizard(t, p);
  const events = t.engine.journal.filter((e) => e.type.startsWith('import.'));
  assert.deepEqual([...new Set(events.map((e) => e.type))].sort(), ['import.batch', 'import.finished', 'import.started']);
  const dump = JSON.stringify(events.map((e) => ({ data: e.data, actor: e.actor, pii: e.pii })));
  for (const x of ['Mehdi', 'Haddad', 'Karim', 'Benali', 'Hugo', 'Fabre', 'Nolan', 'Girard', 'Sami', 'Kaci', 'Lucas', 'Roux', 'Adam', 'Kader', 'Autre', 'exemple.fr', '698765432', '711223344', '755667788', '612345678', '644556677', 'Yanis']) assert.ok(!dump.includes(x), x + ' is in the run');
  assert.ok(events.every((e) => e.pii == null));
  // the chain of the whole journal is intact
  assert.equal(t.engine.verify().ok, true);

  // lines: names come from the files today
  let lines = runLines(t.engine.state, r.run);
  const lucas = lines.find((l) => l.wp === 1361);
  assert.equal(lucas.name, 'Lucas Martin');
  assert.equal(lucas.staff, 'Le Soldat');
  assert.equal(lucas.text, 'Chevauche un autre rendez-vous');
  const cid = byWp(t, 1361).clientId;
  await erase(t, cid);
  lines = runLines(t.engine.state, r.run);
  assert.equal(lines.find((l) => l.wp === 1361).name, 'Client effacé');
  assert.ok(!JSON.stringify(lines).includes('Lucas'));
  // a booking that keeps a typed name loses it with the file
  assert.equal(runLines(t.engine.state, r.run).find((l) => l.kind === 'name').name, 'Karim Benali');
  assert.ok(runLines(t.engine.state, r.run).find((l) => l.kind === 'name').text.includes('« Kader »'));
  await erase(t, byWp(t, 1201).clientId);
  const after = runLines(t.engine.state, r.run).find((l) => l.kind === 'name');
  assert.equal(after.name, 'Client effacé');
  assert.ok(!after.text.includes('Kader') && !after.text.includes('Karim'));
});

test('the words of the review list: one text per kind, the variants and the to-do split', () => {
  assert.equal(say('service', { names: 'Coupe, Barbe' }), 'Prestation inconnue : Coupe, Barbe (ligne ignorée)');
  assert.equal(say('service'), 'Prestation inconnue (ligne ignorée)', 'a missing detail takes its words with it');
  assert.equal(say('erased', {}, 'retention'), 'Fiche anonymisée après 3 ans sans visite : ses lignes sont ignorées');
  assert.equal(say('status-unknown'), 'État inconnu sur l’ancien site : ligne ignorée');
  for (const k of ['error', 'unpaid', 'retention', 'gone', 'gone-handled', 'name', 'email-elsewhere', 'new-number', 'status-unknown']) assert.ok(KIND_TEXT[k], k);
});

test('a batch sent again after its first answer was lost gets the same answer from its events (another instance, a restart)', async () => {
  const t = await shop();
  const p = W.readFiles([{ name: 'a.csv', text: CSV }]);
  const map = mapping(t, p);
  const rows = W.toRows(p, map, new Map(), { today: DAY });
  const { id } = await t.engine.run(startImportRun, W.runBody(p, (await ask(t, p, map)).pv, map, ['0123456789abcdef'], 1), owner(t));
  const base = { ...owner(t), requestId: 'wp-replay-0' };
  const first = await t.engine.run(importBatch, { appts: rows.appts, run: id, i: 0 }, base);
  // a second engine on the same journal never saw the first answer
  const other = createEngine(t.store, { clock: () => t.clock.now, syncEveryMs: 0 });
  await other.sync(true);
  const staff = other.state.staff.get(t.ownerId);
  const again = await other.run(importBatch, { appts: rows.appts, run: id, i: 0 }, { actor: base.actor, staff, caps: base.caps, meta: base.meta, requestId: 'wp-replay-0' });
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.appts, first.appts);
  assert.deepEqual(again.skip, first.skip);
  assert.equal(again.clients.added, first.clients.added);
  assert.deepEqual(again.review.map((r) => [r.kind, r.wp]), first.review.map((r) => [r.kind, r.wp]));
  assert.equal(other.state.imports.runs.get(id).batches, 1, 'and nothing was written twice');
});

test('the CSV of a report: BOM, ; and CRLF, the counts first, a formula from the old site is not run', () => {
  const lines = [
    { kind: 'error', wp: 1311, day: '2026-10-21', start: 1020, name: '=HYPERLINK("x")', staff: 'JKut', text: 'État « Erreur » sur l’ancien site : ignoré ; ligne', todo: false },
    { kind: 'gone', wp: 1380, day: '2026-11-18', start: 900, name: 'Sami Kaci', staff: '', text: 'Supprimé sur l’ancien site : annulé ici, sans SMS', todo: false }
  ];
  const rep = W.reconcile({ totals: { bookings: 3, clients: 1, giftcards: 0, packs: 0 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 0, by: { bookings: 0, clients: 0, giftcards: 0, packs: 0 } }, counts: { clients: { added: 1 }, appts: { done: 2, skipped: 1 } }, skip: { error: 1 } });
  const csv = W.reportCsv(lines, rep);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const rows = csv.slice(1).split('\r\n');
  assert.equal(rows[0], 'type;raison;n° WordPress;date;heure;client;barbier;détail');
  assert.ok(rows[1].startsWith('compte;Réservations;') && rows[1].endsWith('source 3 · repris 2 · déjà là 0 · ignorés 1 · hors conservation 0 · écart 0'));
  const err = rows.find((r) => r.startsWith('error;'));
  assert.equal(err, 'error;État « Erreur » sur l’ancien site;1311;21/10/2026;17:00;"\'=HYPERLINK(""x"")";JKut;"État « Erreur » sur l’ancien site : ignoré ; ligne"');
  assert.equal(rows.find((r) => r.startsWith('gone;')), 'gone;Supprimés sur l’ancien site;1380;18/11/2026;15:00;Sami Kaci;;Supprimé sur l’ancien site : annulé ici, sans SMS');
  assert.equal(rows[rows.length - 1], '');
  assert.equal(W.kindTitle('whatever'), 'whatever');
});

test('the wizard speaks of carnets, never abonnements', () => {
  const p = W.readFiles([{ name: 'k.csv', text: 'telephone;coupes_restantes;expire_le\n06 98 76 54 32;0;15/01/2027\n' }]);
  assert.deepEqual(p.problems.map((x) => x.text), ['Carnet •••• 5432 : sans coupes restantes ou sans date d’expiration']);
  assert.equal(W.reconcile({ totals: { bookings: 0, clients: 0, giftcards: 0, packs: 1 }, excluded: { retention: 0, noVisit: 0, duplicate: 0, unreadable: 1, by: { packs: 1 } }, counts: {}, skip: {} }).at(-1).label, 'Carnets');
  assert.equal(say('pack', {}, 'nofile'), 'Aucun client avec ce numéro : ajoute son prénom');
  assert.equal(say('pack', { day: 'jeu. 15 janv. 2027' }, 'expired'), 'Carnet expiré le jeu. 15 janv. 2027');
  for (const text of Object.values(KIND_TEXT)) assert.ok(!/bonnement/i.test(text), text);
});
