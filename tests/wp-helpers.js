// Shared by the WordPress import tests that replay the wizard on an engine: a salon with the old site's barbers and
// services, `pass` (preview, rows, every batch) and a few small readers of the state. The browser's code
// (web/src/lib/wpimport.ts) runs as is in Node.
import { salon, DAY } from './helpers.js';
import * as W from '../web/src/lib/wpimport.ts';
import { importBatch, startImportRun, finishImportRun, knownClient, rowTomb, priorView, inWindow, busyView, runLines } from '../server/commands/import.js';
import { addStaff } from '../server/commands/team.js';
import { addService } from '../server/commands/catalog.js';
import { tombKeyOf } from '../server/commands/clients.js';

export const TOMB = tombKeyOf('test-secret-0123456789');
export { DAY };
export const owner = (t) => { const a = t.asOwner(); return { ...a, meta: { ...(a.meta || {}), tombKey: TOMB } }; };

/** The helper salon (Ali, Ben, Yanis Martin on 06 12 34 56 78) plus the old site's chairs and its menu. */
export async function shop() {
  const t = await salon();
  const as = t.asOwner();
  const week = { 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  t.ids.jkut = (await t.engine.run(addStaff, { name: 'JKut', role: 'barber', schedule: week }, as)).id;
  t.ids.soldat = (await t.engine.run(addStaff, { name: 'Le Soldat', role: 'barber', schedule: week }, as)).id;
  t.ids.cc = (await t.engine.run(addService, { name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' }, as)).id;
  return t;
}
/** Every service name to Coupe, every barber to Ali (no overlap noise matters here): the mapping of a wizard that matched nothing special. */
export function mapAll(t, p, { legacyUnknown = false } = {}) {
  const n = W.names(p);
  return { services: Object.fromEntries(n.services.map(([x]) => [x, legacyUnknown ? W.LEGACY : t.ids.cut])), staff: Object.fromEntries(n.staff.map(([x]) => [x, t.ids.Ali])) };
}
const chairsOf = (t) => new Set([...t.engine.state.staff.values()].filter((x) => x.active && x.chair).map((x) => x.id));

/**
 * The wizard's second question about the bookings already brought in (POST /api/v1/import/preview, `who`): what a pass would correct on the
 * person (number, e-mail, names, note), added to each as `fix`. Same rows as the browser sends (W.whoRows).
 */
export function withFixes(s, p, imported, now) {
  const rows = W.whoRows(p, imported, now);
  W.applyFixes(imported, priorView(s, rows.map((r) => r.wp), rows));
  return imported;
}

/** What the wizard asks the server before it sends anything (POST /api/v1/import/preview). */
export async function ask(t, p, map) {
  const s = t.engine.state, today = DAY;
  const ids = W.preview(p, { services: {}, staff: {} }, t.clock.now).identities;
  const keys = ids.flatMap((list, g) => list.map((k) => ({ ...k, g })));
  const known = new Set(), again = new Set(), erased = new Map();
  for (const k of keys) {
    const w = knownClient(s, k, TOMB);
    if (w === 'salon') known.add(k.g); else if (w === 'wordpress') again.add(k.g);
    else if (w === 'erased') erased.set(k.g, Math.max(rowTomb(s, k, TOMB).at, erased.get(k.g) || 0));
  }
  const imported = withFixes(s, p, new Map(priorView(s, p.bookings.map((b) => b.wp)).map((a) => [a.wp, a])), t.clock.now);
  const days = [...new Set(p.bookings.filter((b) => b.day >= today).map((b) => b.day))].slice(0, 120);
  const svcDur = Object.fromEntries([...s.services.values()].map((x) => [x.id, { dur: x.dur, buffer: x.buffer || 0 }]));
  const opts = { known, again, erased, imported, chairs: chairsOf(t), today, inWindow: inWindow(s, p.windows, today), busy: busyView(s, days), svcDur };
  return { pv: W.preview(p, map, t.clock.now, opts), opts, imported };
}
/** Files in, answers out: the preview, the rows, every batch (no run record: see import-report.test.js for the run). */
export async function pass(t, files, map, { run = false, chunk = 150 } = {}) {
  const p = W.readFiles(files, DAY);
  const m = map || mapAll(t, p);
  const { pv, opts, imported } = await ask(t, p, m);
  const rows = W.toRows(p, m, imported, { today: opts.today, known: opts.known, again: opts.again, erased: opts.erased, gone: pv.gone, now: t.clock.now, chairs: opts.chairs });
  const parts = [
    ...W.chunks(rows.clients, chunk).map((x) => ({ clients: x })), ...W.chunks(rows.appts, chunk).map((x) => ({ appts: x })),
    ...W.chunks(rows.giftcards, chunk).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs, chunk).map((x) => ({ packs: x })), ...W.chunks(rows.gone, chunk).map((x) => ({ gone: x }))
  ];
  const answers = [];
  // with a run: the record the report is made from (the lines, with their names rebuilt from the state)
  const id = run ? (await t.engine.run(startImportRun, W.runBody(p, pv, m, p.files.map(() => '0123456789abcdef'), parts.length), owner(t))).id : null;
  for (const [i, body] of parts.entries()) answers.push(await t.engine.run(importBatch, id ? { ...body, run: id, i } : body, owner(t)));
  if (id) await t.engine.run(finishImportRun, { id }, owner(t));
  const record = id ? t.engine.state.imports.runs.get(id) : null;
  return { p, map: m, pv, rows, answers, review: answers.flatMap((a) => a.review), appts: sum(answers, 'appts'), clients: sum(answers, 'clients'), run: record, lines: record ? runLines(t.engine.state, record) : [] };
}
export function sum(answers, key) {
  const out = {};
  for (const a of answers) for (const [k, v] of Object.entries(a[key])) if (typeof v === 'number') out[k] = (out[k] || 0) + v;
  return out;
}
export const byWp = (t, wp) => t.engine.state.appts.get(t.engine.state.apptByWp.get(String(wp)));
/** Every booking of a WordPress number, the cancelled ones too (a reopened booking leaves its predecessor in the history). */
export const allByWp = (t, wp) => [...t.engine.state.appts.values()].filter((a) => a.ext && String(a.ext.wp) === String(wp));

/** Change the state of a line of a plugin CSV, or drop it. */
export const setState = (csv, wp, state) => csv.split('\n').map((l) => (l.startsWith(wp + ',') ? l.replace(/,[^,]*$/, ',' + state) : l)).join('\n');
export const dropLines = (csv, ...wps) => csv.split('\n').filter((l) => !wps.some((w) => l.startsWith(w + ','))).join('\n');
