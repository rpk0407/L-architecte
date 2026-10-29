// What real exports look like: the bytes of a file (UTF-16, Windows-1252, Mac Roman, a paste of two encodings), PHP notices printed
// above the data, files that are not exports at all (and the sentence that says so), a long XML read as a stream, numeric dates,
// the notes that warn the owner before anything is sent. The reader is web/src/lib/wpimport.ts, run as is by Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as W from '../../web/src/lib/wpimport.ts';

const DIR = new URL('../fixtures/wp-qa/', import.meta.url);
const bytes = (f) => readFileSync(new URL(f, DIR));
const read = (f, o = {}) => W.readFiles([{ name: f, text: W.decodeBytes(bytes(f)), modified: 1, ...o }], '2026-10-27');
const NOW = Date.parse('2026-10-27T15:10:00+01:00');
const FR = readFileSync(new URL('../fixtures/wp-bookings-fr.csv', import.meta.url), 'utf8');

test('the bytes of a file: UTF-16 with or without its mark, UTF-8, Windows-1252, a paste of both, Mac Roman', () => {
  const rows = (f, b) => W.readFiles([{ name: f, text: W.decodeBytes(b || bytes(f)), modified: 1 }]).files[0].rows;
  assert.equal(rows('A07c-macroman-excel-mac.csv'), 6, 'Mac Roman, found by the header');
  assert.equal(rows('A09-excel-unicode-text-utf16le-tab.txt'), 7, 'Excel « Texte Unicode »');
  assert.equal(rows('A10-pasted-mixed-encoding.csv'), 6, 'UTF-8 lines, then Windows-1252 lines, a second header in the middle');
  assert.equal(rows('A07-excel-semicolon-cp1252-crlf.csv'), 11);
  assert.equal(rows('A07b-latin1-iso8859-1-no-euro.csv'), 6);
  // one stray é byte in a UTF-8 export (a name typed in a Latin-1 terminal): the other 19 rows keep their accents
  const a01 = Buffer.from(bytes('A01-plugin-fr-utf8bom-lf.csv'));
  const at = a01.indexOf(Buffer.from('é'));
  assert.ok(at > 0);
  const stray = Buffer.concat([a01.subarray(0, at), Buffer.from([0xe9]), a01.subarray(at + 2)]);
  assert.equal(rows('A01', stray), 20);
  assert.equal(W.decodeBytes(stray).includes('é'), true, 'the other accents are intact');
  // the same text as UTF-16LE and BE without a mark: a NUL at every second byte
  const text = 'ID;DATE/HEURE;ÉTAT\n1;12/12/2026 10:00;Confirmé\n'.repeat(3);
  assert.equal(W.decodeBytes(Buffer.from(text, 'utf16le')), text);
  assert.equal(W.decodeBytes(Buffer.from(text, 'utf16le').swap16()), text);
  assert.equal(W.decodeBytes(Buffer.from('﻿' + text)), text, 'a UTF-8 mark is dropped');
});

test('PHP notices above the data are skipped and said; the header can sit far down; line numbers are the file’s', () => {
  const xml = read('X1-xml-with-php-notices-before.xml');
  // 40 bookings: 3 in the trash or draft, 3 in a state the plugin does not know, 3 the XML cannot book (no service, 30 February)
  assert.deepEqual([xml.files[0].kind, xml.files[0].rows], ['wxr', 31]);
  assert.match(xml.files[0].info, /messages d’erreur au début du fichier : ignorés/);
  const csv = read('X3-csv-with-php-notices-before.csv');
  assert.deepEqual([csv.files[0].kind, csv.files[0].rows], ['bookings', 20]);
  assert.match(csv.files[0].info, /messages d’erreur/);
  // not a notice: nothing is said
  assert.equal(read('A01-plugin-fr-utf8bom-lf.csv').files[0].info, undefined);
  // lines are counted in the file, blank lines and quoted line breaks included
  const p = read('A19-custom-columns-and-junk-lines.csv');
  const lines = p.problems.map((x) => x.line);
  assert.deepEqual(p.problems.slice(0, 3).map((x) => [x.line, x.text]), [[14, 'Ligne sans ID'], [15, 'Ligne sans ID'], [16, 'Ligne sans ID']], 'the second header, then « not an id », « 1 100 »');
  assert.deepEqual(lines.slice(-3), [18, 19, 21], '19950 and 19951 on lines 18 and 19, the « Total » line on 21 (line 20 is blank cells)');
  const quoted = 'ID,DATE/HEURE,ÉTAT\n\n\n1,"12 Déc 2026 10:00","Confirmé"\n2,"13 Déc 2026\n10:00",Confirmé\nx,"14 Déc 2026 10:00",Confirmé\n';
  const q = W.readFiles([{ name: 'q.csv', text: quoted }]);
  assert.deepEqual(q.problems.map((x) => [x.line, x.text]), [[5, 'Date illisible : « 13 Déc 2026 10:00 »'], [7, 'Ligne sans ID']], 'blank lines and the line break inside quotes count');
});

test('a `]]>` in a note survives the CDATA splitter of WordPress', () => {
  const item = (note) => '<item><wp:post_id>9</wp:post_id><wp:post_type><![CDATA[sln_booking]]></wp:post_type><wp:status><![CDATA[sln-b-confirmed]]></wp:status>'
    + '<wp:postmeta><wp:meta_key><![CDATA[_sln_booking_date]]></wp:meta_key><wp:meta_value><![CDATA[2026-11-12]]></wp:meta_value></wp:postmeta>'
    + '<wp:postmeta><wp:meta_key><![CDATA[_sln_booking_time]]></wp:meta_key><wp:meta_value><![CDATA[10:00]]></wp:meta_value></wp:postmeta>'
    + '<wp:postmeta><wp:meta_key><![CDATA[_sln_booking_note]]></wp:meta_key><wp:meta_value>' + note + '</wp:meta_value></wp:postmeta>'
    + '<wp:postmeta><wp:meta_key><![CDATA[_sln_booking_services]]></wp:meta_key><wp:meta_value><![CDATA[a:1:{i:0;a:2:{s:7:"service";s:1:"5";s:8:"duration";s:5:"00:30";}}]]></wp:meta_value></wp:postmeta></item>'
    + '<item><wp:post_id>5</wp:post_id><wp:post_type><![CDATA[sln_service]]></wp:post_type><title><![CDATA[Coupe]]></title></item>';
  const wxr = '<?xml version="1.0"?><rss><channel>' + item('<![CDATA[a]]]]><![CDATA[>b]]>') + '</channel></rss>';
  const p = W.readFiles([{ name: 'n.xml', text: wxr }]);
  assert.equal(p.bookings[0].note, 'a]]>b');
});

test('a file that is not an export says why, and what to do', () => {
  const why = (f, text) => W.readFiles([{ name: f, text: text ?? W.decodeBytes(bytes(f)) }]).files[0];
  const x = why('A11-saved-as-workbook.xlsx');
  assert.deepEqual([x.kind, x.rows], ['unknown', 0]);
  assert.match(x.why, /Fichier Excel : ouvre-le puis Fichier > Enregistrer sous > CSV UTF-8/);
  assert.match(why('x.pdf', '%PDF-1.7\n1 0 obj\n').why, /Ce n’est pas un export WordPress/);
  assert.match(why('x.png', new TextDecoder('windows-1252').decode(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).why, /Ce n’est pas un export WordPress/);
  assert.match(why('x.zip', 'PK\u0003\u0004 some archive').why, /Ce n’est pas un export WordPress/);
  assert.match(why('F06c-html-instead-of-csv.csv').why, /page de connexion/);
  for (const f of ['F04-empty-zero-bytes.csv', 'F05-empty-whitespace.csv', 'F06b-bom-only.csv']) assert.match(why(f).why, /Le fichier est vide/, f);
  assert.match(why('bank.csv').why, /Colonnes non reconnues/);
  assert.match(why('E05-wp-users-export.csv').why, /Colonnes non reconnues/);
  const header = 'ID,DATE/HEURE,ÉTAT,SERVICES\n';
  assert.match(why('h.csv', header).why, /Aucune ligne dans ce fichier/);
  // the customers' file alone: nobody is brought in without a booking (retention)
  const c = W.readFiles([{ name: 'E04.csv', text: W.decodeBytes(bytes('E04-customers-plugin-format.csv')) }]);
  assert.match(c.files[0].why, /Dépose aussi le fichier des réservations/);
  const both = W.readFiles([{ name: 'E04.csv', text: W.decodeBytes(bytes('E04-customers-plugin-format.csv')) }, { name: 'A01.csv', text: W.decodeBytes(bytes('A01-plugin-fr-utf8bom-lf.csv')) }]);
  assert.equal(both.files[0].why, undefined);
  assert.equal(why('A01.csv', W.decodeBytes(bytes('A01-plugin-fr-utf8bom-lf.csv'))).why, undefined);
});

/** A WXR read as a stream, chunk by chunk, built on the fly so the test itself never holds it whole. */
function streamOf(head, items, pad, tail, chunk = 65536) {
  const enc = new TextEncoder();
  const parts = [head, ...items.flatMap((it, i) => [it, ...Array.from({ length: pad[i] || 0 }, (_, k) => '<item><title>page ' + i + '-' + k + '</title><wp:post_type><![CDATA[page]]></wp:post_type><content:encoded><![CDATA[' + 'lorem ipsum '.repeat(9000) + ']]></content:encoded></item>\n')]), tail];
  let at = 0, buf = new Uint8Array(0);
  return { stream: () => new ReadableStream({
    pull(c) {
      while (buf.length < chunk && at < parts.length) { const b = enc.encode(parts[at++]); const m = new Uint8Array(buf.length + b.length); m.set(buf); m.set(b, buf.length); buf = m; }
      if (!buf.length) return c.close();
      c.enqueue(buf.subarray(0, chunk)); buf = buf.subarray(chunk);
    }
  }) };
}
test('a long XML is read as a stream: only bookings, services and barbers are kept, memory stays small', async () => {
  const full = bytes('D01-full-content.wxr.xml').toString('utf8');
  const first = full.indexOf('<item>'), last = full.lastIndexOf('</item>') + 7;
  const head = full.slice(0, first), tail = full.slice(last);
  const items = full.slice(first, last).split(/(?<=<\/item>)\s*(?=<item>)/);
  assert.ok(items.length > 20);
  const plain = W.readFiles([{ name: 'D01.xml', text: full }], '2026-10-27');
  // 60 MB of pages between the items
  const pad = items.map((_, i) => (i % 2 ? 0 : 2));
  const per = ('<item><title>page 0-0</title><wp:post_type><![CDATA[page]]></wp:post_type><content:encoded><![CDATA[' + 'lorem ipsum '.repeat(9000) + ']]></content:encoded></item>\n').length;
  const n = Math.ceil(60e6 / per / (pad.reduce((a, b) => a + b, 0) || 1));
  const big = streamOf(head, items, pad.map((x) => x * n), tail);
  let peak = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  const base = process.memoryUsage().heapUsed;
  const r = await W.shrinkWxr(big);
  clearInterval(timer);
  assert.ok(r.items > items.length && r.ended);
  assert.ok(r.text.length < full.length * 1.2, 'the pages are gone: ' + r.text.length);
  assert.ok(peak - base < 100e6, 'heap grew by ' + Math.round((peak - base) / 1e6) + ' MB');
  const small = W.readFiles([{ name: 'D01.xml', text: r.text }], '2026-10-27');
  assert.deepEqual(small.bookings.map((b) => [b.wp, b.day, b.start, b.status, b.services.join('+'), b.staff, b.noShow]), plain.bookings.map((b) => [b.wp, b.day, b.start, b.status, b.services.join('+'), b.staff, b.noShow]));
  assert.equal(small.files[0].cut, undefined);
  // a file that stops short: the reduced text says so
  const cutAt = full.indexOf('<item>', first + 5000);
  const short = await W.shrinkWxr(streamOf(head, [full.slice(first, cutAt)], [0], ''));
  assert.equal(short.ended, false);
  assert.equal(W.readFiles([{ name: 'cut.xml', text: short.text }]).files[0].cut, true);
});

test('numeric dates: an English Excel round trip is read month first, a file that proves nothing is flagged', () => {
  const a08 = read('A08-us-month-first-dates.csv');
  assert.equal(a08.files[0].order, 'md');
  assert.match(a08.files[0].info, /mois\/jour\/année/);
  const b = (wp) => a08.bookings.find((x) => x.wp === wp);
  assert.deepEqual([b(18001).day, b(18003).day, b(18007).day], ['2026-09-22', '2026-10-06', '2026-11-03'], 'rows on the right days');
  assert.equal(a08.problems.length, 0);
  // 03/04/2026 alone: nothing says which is the month
  const flat = 'ID,DATE/HEURE,ÉTAT,SERVICES\n1,"03/04/2026 10:00",Confirmé,Coupe\n';
  const f = W.readFiles([{ name: 'flat.csv', text: flat }], '2026-10-27');
  assert.equal(f.files[0].order, 'unsure');
  assert.equal(f.bookings[0].day, '2026-04-03', 'read day first, as in France');
  const pv = W.preview(f, { services: { Coupe: 'sv' }, staff: { '': 'st' } }, NOW, { today: '2026-10-27' });
  assert.ok(pv.notes.some((x) => /« flat.csv » sont écrites en chiffres/.test(x)), JSON.stringify(pv.notes));
  // the plugin's own textual dates and the French fixture are untouched
  assert.equal(read('A01-plugin-fr-utf8bom-lf.csv').files[0].order, undefined);
  assert.equal(W.readFiles([{ name: 'fr.csv', text: FR }]).files[0].order, undefined);
});

test('the notes before sending: nothing to come, an export that stops short, a hole between two periods, a cut file', () => {
  const today = '2026-10-27';
  const notes = (files, map = { services: {}, staff: {} }) => { const p = W.readFiles(files, today); return W.preview(p, map, NOW, { today }).notes; };
  // « à » left at the day of the export: only the past
  const past = notes([{ name: 'W1.csv', text: readFileSync(new URL('W1-default-window-past-only.csv', DIR), 'utf8') }]);
  assert.ok(past.some((x) => /Aucun rendez-vous à venir/.test(x)), JSON.stringify(past));
  assert.ok(past.some((x) => /Ton export s’arrête le/.test(x)));
  // two years with a hole between them
  const gap = notes([{ name: 'W3a.csv', text: readFileSync(new URL('W3a-year2024.csv', DIR), 'utf8') }, { name: 'W3b.csv', text: readFileSync(new URL('W3b-year2026.csv', DIR), 'utf8') }]);
  assert.ok(gap.some((x) => /Aucun fichier ne couvre la période du/.test(x)), JSON.stringify(gap));
  // a truncated XML
  const cut = notes([{ name: 'D04.xml', text: W.decodeBytes(bytes('D04-truncated.wxr.xml')) }]);
  assert.ok(cut.some((x) => /« D04.xml » est coupé/.test(x)), JSON.stringify(cut));
  // the normal export: a period to a year ahead, bookings to come: nothing to say but the missing country codes
  const fine = notes([{ name: 'export.csv', text: FR }]);
  assert.deepEqual(fine.filter((x) => !/indicatif pays/.test(x)), []);
  assert.ok(fine.some((x) => /Le CSV ne contient pas l’indicatif pays/.test(x)), 'a CSV alone: foreign numbers read as French');
  const withXml = notes([{ name: 'export.csv', text: FR }, { name: 'tout.xml', text: readFileSync(new URL('../fixtures/wp-bookings.wxr.xml', import.meta.url), 'utf8') }]);
  assert.deepEqual(withXml.filter((x) => /indicatif pays/.test(x)), []);
  // each file says what it spans and how many are to come
  const f = W.readFiles([{ name: 'export.csv', text: FR }], today).files[0];
  assert.ok(f.first && f.last && f.ahead > 0, JSON.stringify(f));
});

test('a trashed or draft booking in the XML is a deleted one, not a reading problem; its number is not “read badly”', () => {
  const p = read('D01-full-content.wxr.xml');
  assert.equal(p.files[0].bad || 0, p.problems.filter((x) => x.kind === 'status-unknown' || /sans date/.test(x.text)).length);
  assert.ok(p.files[0].info === undefined || /corbeille ou en brouillon/.test(p.files[0].info));
  assert.ok(p.problems.every((x) => !/trash|draft/i.test(x.text)));
  const trash = readFileSync(new URL('D01-full-content.wxr.xml', DIR), 'utf8');
  assert.ok(/<wp:status><!\[CDATA\[(trash|auto-draft|draft)\]\]>/.test(trash), 'the fixture holds some');
});

test('names that almost match a chair: spaces, typos, the start of a name; a barber who left stays far', () => {
  const chairs = [{ id: 'a', name: 'JKut' }, { id: 'b', name: 'Frank' }, { id: 'c', name: 'Esteban' }, { id: 'd', name: 'L’Architecte' }, { id: 'e', name: 'Le Soldat' }];
  const k = (x) => [x.name];
  assert.equal(W.closeMatch('J Kut', chairs, k), 'a');
  assert.equal(W.closeMatch('Franck', chairs, k), 'b');
  assert.equal(W.closeMatch('Steban', chairs, k), 'c');
  assert.equal(W.closeMatch('larchi', chairs, k), 'd');
  assert.equal(W.closeMatch('L’Archi', chairs, k), 'd');
  for (const gone of ['John', 'JBlades', 'Mourad']) assert.equal(W.closeMatch(gone, chairs, k), '', gone);
  assert.equal(W.closeMatch('Fran', [{ id: 'x', name: 'Frank' }, { id: 'y', name: 'Franck' }], k), '', 'two as close: the owner picks');
});

test('a name like « constructor » is no mapping of Object.prototype', () => {
  const map = { services: { Coupe: 'sv1' }, staff: { JKut: 'st1' } };
  assert.equal(W.svcOf(map, 'Coupe'), 'sv1');
  for (const n of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(W.svcOf(map, n) || W.staffOf(map, n), '', n);
});
