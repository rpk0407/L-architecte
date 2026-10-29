// What the browser's reader produces must never be refused by the server's own schemas: a refused row stops its whole batch of
// 150 (and the retry sends the same batch again), a refused preview locks the button. Every fixture of the QA set goes through
// readFiles → preview → toRows, then is parsed with the batch and preview schemas the routes use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as W from '../../web/src/lib/wpimport.ts';
import { batchSchema } from '../../server/commands/import.js';
import { previewSchema } from '../../server/http/routes-import.js';
import { parse } from '../../server/lib/validate.js';
import { isDay } from '../../shared/dates.js';

const DIR = new URL('../fixtures/', import.meta.url);
const NOW = Date.parse('2026-10-27T15:10:00+01:00'), TODAY = '2026-10-27';
const files = [
  ...readdirSync(new URL('wp-qa/', DIR)).filter((f) => /\.(csv|xml|txt)$/.test(f)).map((f) => 'wp-qa/' + f),
  ...readdirSync(DIR).filter((f) => /^wp-bookings.*\.(csv|xml)$/.test(f))
];

test('every QA fixture: the rows the reader sends and the previews it asks for pass the server schemas', () => {
  assert.ok(files.length >= 25, files.length + ' fixtures');
  const refused = [];
  for (const f of files) {
    const p = W.readFiles([{ name: f, text: W.decodeBytes(readFileSync(new URL(f, DIR))), modified: 1 }], TODAY);
    const map = { services: {}, staff: {} };
    for (const [n] of W.names(p).services) map.services[n] = 'sv1';
    for (const [n] of W.names(p).staff) map.staff[n] = 'st1';
    const pv = W.preview(p, map, NOW, { today: TODAY });
    const rows = W.toRows(p, map, new Set(), { today: TODAY, now: NOW });
    const bodies = [
      ...W.chunks(rows.clients).map((x) => ({ clients: x })), ...W.chunks(rows.appts).map((x) => ({ appts: x })),
      ...W.chunks(rows.giftcards).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs).map((x) => ({ packs: x }))
    ];
    for (const b of bodies) { try { parse(batchSchema, b); } catch (e) { refused.push(f + ' batch: ' + e.message); } }
    const keys = pv.identities.flatMap((list, g) => list.map((k) => ({ ...k, g })));
    for (const part of W.chunks(keys, 400, 40000)) { try { parse(previewSchema, { keys: part.map(({ g, ...k }) => k) }); } catch (e) { refused.push(f + ' preview: ' + e.message); } }
  }
  assert.deepEqual(refused, []);
});

test('isDay: a real calendar day, not one that rolls over to the next month', () => {
  for (const d of ['2026-02-30', '2026-02-31', '2026-04-31', '2027-02-29', '2026-13-01', '2026-00-10', '26-01-01', '']) assert.equal(isDay(d), false, d);
  for (const d of ['2028-02-29', '2026-10-27', '2026-12-31', '2026-02-28']) assert.equal(isDay(d), true, d);
});

test('the reader keeps only what the server accepts: a bad creation date, a time of day that does not exist, an id that is no number', () => {
  const read = (name) => W.readFiles([{ name, text: W.decodeBytes(readFileSync(new URL('wp-qa/' + name, DIR))), modified: 1 }], TODAY);
  // CRÉÉ before 2000 or after 2100: the booking is read, the date is not kept
  const a18 = read('A18-dates-and-times-edge.csv');
  assert.ok(a18.bookings.length > 5);
  for (const b of a18.bookings) assert.ok(b.createdAt === undefined || (b.createdAt >= Date.UTC(2000, 0, 1) && b.createdAt < Date.UTC(2100, 0, 1)), b.wp + ' ' + b.createdAt);
  // a draft's post_date_gmt 0000-00-00, an item with an XML time of 25:99, a negative or 7-digit prefix
  for (const f of ['D01-full-content.wxr.xml', 'D03-delta.wxr.xml', 'D05-malformed-and-hostile.wxr.xml']) {
    const p = read(f);
    for (const b of p.bookings) assert.ok(b.createdAt === undefined || b.createdAt >= Date.UTC(2000, 0, 1), f + ' ' + b.wp);
    for (const b of p.bookings) assert.ok(b.start >= 0 && b.start <= 1439 && isDay(b.day), f + ' ' + b.wp + ' ' + b.day + ' ' + b.start);
    for (const b of p.bookings) assert.ok(Number.isInteger(b.wp) && b.wp >= 1 && b.wp <= 999999999999, f + ' ' + b.wp);
  }
});

test('a phone, a prefix or an e-mail too long for the server is cut, in the rows and in the previews alike', () => {
  const long = 'x'.repeat(170) + '@exemple.fr';
  const text = 'Réservations,de,à\n,"01 Jan 2026","31 Déc 2027"\n\nID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"PRIX TOTAL",ÉTAT\n'
    + '9001,"12 Nov 2026 10:00","10 Nov 2026 10:00",Aziz,Long,' + long + ',' + '0' + '6'.repeat(40) + ',Coupe,JKut,"20 €",Confirmé\n';
  const p = W.readFiles([{ name: 'long.csv', text }], TODAY);
  const map = { services: { Coupe: 'sv1' }, staff: { JKut: 'st1' } };
  const pv = W.preview(p, map, NOW, { today: TODAY });
  for (const k of pv.identities.flat()) { parse(previewSchema, { keys: [k] }); assert.ok((k.email || '').length <= 160 && (k.phone || '').length <= 32); }
  const rows = W.toRows(p, map, new Set(), { today: TODAY });
  parse(batchSchema, { appts: rows.appts });
  // and the server itself cuts what it is sent in a preview rather than refusing it
  parse(previewSchema, { keys: [{ email: long, phone: '0'.repeat(50), prefix: '1234567890' }] });
});
