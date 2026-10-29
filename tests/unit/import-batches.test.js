// The number and the e-mail of a client file, whatever the way the rows reach the server: a file ends with the value of its
// highest-numbered WordPress booking (or the owner's own edit), however the rows fall into batches and in whichever order, and
// the same export dropped again changes nothing. Every correction is carried or listed, never dropped; a first name the old site
// types differently on a booking already brought in is a correction, not a second person. The merge of two files counts as the
// owner's decision.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { importBatch, say } from '../../server/commands/import.js';
import { mergeClients, updateClient, eraseClient } from '../../server/commands/clients.js';
import { detachPhone } from '../../server/commands/accounts.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { shop, owner, byWp } from '../wp-helpers.js';

/** A booking row as the browser sends it: to come, confirmed, on JKut's chair. */
const row = (t, wp, x = {}) => ({ wp, day: '2026-11-10', start: 480 + (wp % 40) * 15, serviceIds: [t.ids.cut], staffId: t.ids.jkut, status: 'confirmed', first: 'Karim', last: 'Benali', phone: '0605651154', wpUser: 87, ...x });
const send = (t, ...rows) => t.engine.run(importBatch, { appts: rows }, owner(t));
/** The rows in batches of n, as the wizard sends them: every answer, and the lines they hold. */
async function chunks(t, rows, n) {
  const answers = [];
  for (let i = 0; i < rows.length; i += n) answers.push(await send(t, ...rows.slice(i, i + n)));
  return { answers, review: answers.flatMap((a) => a.review), changed: answers.reduce((k, a) => k + a.appts.changed, 0) };
}
const lines = (a, kind) => (a.review || a).filter((r) => r.kind === kind);
const fileOf = (t, wp) => t.engine.state.clients.get(byWp(t, wp).clientId);

test('a file keeps the number of its newest booking when the older booking comes in a later batch (item 1)', async () => {
  const t = await shop();
  const s = t.engine.state;
  const old = row(t, 40010, { phone: '0600000001', email: 'karim@exemple.fr' }), neu = row(t, 40400, { phone: '0600000002', email: 'karim@exemple.fr' });
  // the first pass: the plugin lists the newest first, one booking per batch
  await chunks(t, [neu, old], 1);
  const cid = byWp(t, 40400).clientId;
  assert.equal(s.clients.get(cid).phone, '+33600000002');
  assert.equal(byWp(t, 40010).clientId, cid, 'one person');
  // the final sync, same export, however the batches fall: the older booking never takes the file back to its number
  for (const order of [[neu, old], [old, neu]]) {
    const v = s.version;
    const r = await chunks(t, order, 1);
    assert.equal(s.clients.get(cid).phone, '+33600000002', order.map((x) => x.wp).join());
    assert.equal(s.version, v, 'the same export changes nothing, not even a mark');
    assert.deepEqual(r.review, []);
    assert.equal(r.changed, 0);
  }
  // and in one batch
  assert.deepEqual((await send(t, old, neu)).review, []);
  assert.equal(s.clients.get(cid).phone, '+33600000002');
});

test('a booking corrected twice on the old site is followed each time, and listed (item 1)', async () => {
  const t = await shop();
  const s = t.engine.state;
  await send(t, row(t, 31100, { phone: '0600000001', email: 'a@exemple.fr' }));
  const cid = byWp(t, 31100).clientId;
  const b = await send(t, row(t, 31100, { phone: '0600000002', email: 'b@exemple.fr' }));
  assert.deepEqual([s.clients.get(cid).phone, s.clients.get(cid).email], ['+33600000002', 'b@exemple.fr']);
  assert.deepEqual(lines(b, 'new-number').map((r) => r.v), ['fixed']);
  assert.deepEqual(lines(b, 'new-email').map((r) => r.v), ['fixed']);
  // corrected again: the third export is not ignored
  const c = await send(t, row(t, 31100, { phone: '0600000003', email: 'c@exemple.fr' }));
  assert.deepEqual([s.clients.get(cid).phone, s.clients.get(cid).email], ['+33600000003', 'c@exemple.fr']);
  assert.deepEqual(lines(c, 'new-number').map((r) => r.v), ['fixed']);
  assert.deepEqual(lines(c, 'new-email').map((r) => r.v), ['fixed']);
  assert.equal(c.appts.changed, 1);
  assert.equal(s.clientByPhone.get('+33600000003'), cid);
  assert.equal(s.clientByPhone.get('+33600000002'), undefined);
  // and the same export once more: nothing
  const v = s.version;
  assert.deepEqual((await send(t, row(t, 31100, { phone: '0600000003', email: 'c@exemple.fr' }))).review, []);
  assert.equal(s.version, v);
  // the wording does not claim a booking is the most recent one
  assert.ok(!say('new-number', {}, 'fixed').includes('le plus récent'));
  assert.ok(!lines(c, 'new-number')[0].text.includes('le plus récent'));
});

test('a file ends with the number of its highest booking whatever the order of the rows of a first pass (item 1)', async () => {
  const ends = new Set();
  for (const [name, order] of [['oldest first', [31200, 31201, 31202]], ['newest first', [31202, 31201, 31200]], ['shuffled', [31201, 31202, 31200]]]) {
    for (const n of [1, 2, 3]) {
      const t = await shop();
      const rows = order.map((wp) => row(t, wp, { phone: '06000000' + (wp - 31200 + 10), email: 'k' + (wp - 31200) + '@exemple.fr' }));
      await chunks(t, rows, n);
      const f = fileOf(t, 31200);
      ends.add(f.phone + ' ' + f.email);
      assert.equal(f.phone, '+33600000012', name + ' ' + n);
      assert.equal(f.email, 'k2@exemple.fr', name + ' ' + n);
      assert.equal(t.engine.state.clientByPhone.get('+33600000012'), f.id);
      assert.equal([...t.engine.state.clients.values()].filter((c) => c.source === 'wordpress').length, 1, 'one person, one file');
      // dropped again: nothing, in any order
      const v = t.engine.state.version;
      await chunks(t, [...rows].reverse(), n);
      assert.equal(t.engine.state.version, v, name + ' ' + n + ' again');
    }
  }
  assert.equal(ends.size, 1);
});

test('a correction on an old booking is carried in the pass whether a new booking of the customer comes before it or after (item 2)', async () => {
  for (const order of ['new row first', 'old row first']) {
    const t = await shop();
    const s = t.engine.state;
    await send(t, row(t, 31300, { phone: '0600000001', email: 'karim@exemple.fr' }));
    const cid = byWp(t, 31300).clientId;
    // the customer corrected his number and the typo in his address, and booked again: the new row carries both
    const oldRow = row(t, 31300, { phone: '0600000002', email: 'karim.fixed@exemple.fr' }), newRow = row(t, 31301, { phone: '0600000002', email: 'karim.fixed@exemple.fr' });
    const a = await send(t, ...(order === 'new row first' ? [newRow, oldRow] : [oldRow, newRow]));
    assert.equal(byWp(t, 31301).clientId, cid, order);
    assert.deepEqual([s.clients.get(cid).phone, s.clients.get(cid).email], ['+33600000002', 'karim.fixed@exemple.fr'], order);
    assert.deepEqual(lines(a, 'new-number').map((r) => r.v), ['fixed'], order);
    assert.deepEqual(lines(a, 'new-email').map((r) => r.v), ['fixed'], order);
    assert.equal(a.appts.changed, 1, order + ': the old booking’s correction is counted, as the preview counts it');
    // the same export again: nothing
    const v = s.version;
    const b = await send(t, oldRow, newRow);
    assert.deepEqual(b.review, [], order);
    assert.equal(s.version, v, order);
  }
});

test('an e-mail typo fixed on the old site is carried when the new booking carries the fixed address (item 2)', async () => {
  const t = await shop();
  const s = t.engine.state;
  await send(t, row(t, 31320, { phone: '0600000021', email: 'karim@exemple.fr', wpUser: undefined }));
  const cid = byWp(t, 31320).clientId;
  // the CSV order: the new booking first; it meets the file by the number
  const a = await send(t, row(t, 31321, { phone: '0600000021', email: 'karim.fixed@exemple.fr', wpUser: undefined }), row(t, 31320, { phone: '0600000021', email: 'karim.fixed@exemple.fr', wpUser: undefined }));
  assert.equal(s.clients.get(cid).email, 'karim.fixed@exemple.fr');
  assert.deepEqual(lines(a, 'new-email').map((r) => r.v), ['fixed']);
  assert.equal(a.appts.changed, 1);
  const v = s.version;
  assert.deepEqual((await send(t, row(t, 31321, { phone: '0600000021', email: 'karim.fixed@exemple.fr', wpUser: undefined }), row(t, 31320, { phone: '0600000021', email: 'karim.fixed@exemple.fr', wpUser: undefined }))).review, []);
  assert.equal(s.version, v);
});

test('a new booking with another number than a salon file is listed, never copied (item 2)', async () => {
  const t = await shop();
  const s = t.engine.state;
  // Yanis is a file of the salon: his number was never given by an import
  const a = await send(t, row(t, 31330, { first: 'Yanis', last: 'Martin', phone: '0612345678', wpUser: 33 }), row(t, 31331, { first: 'Yanis', last: 'Martin', phone: '0699000033', wpUser: 33 }));
  assert.equal(byWp(t, 31331).clientId, t.ids.yanis);
  assert.equal(s.clients.get(t.ids.yanis).phone, '+33612345678');
  assert.deepEqual(lines(a, 'new-number').map((r) => r.v), [undefined]);
  assert.match(lines(a, 'new-number')[0].text, /numéro gardé/);
});

test('a first name the old site types otherwise on a booking already brought in is a correction (item 3)', async () => {
  const t = await shop();
  const s = t.engine.state;
  // the first pass makes the file from the booking; the old site then corrects the typo it typed
  await send(t, row(t, 31400, { first: 'Kérim', wpUser: undefined }));
  const a = await send(t, row(t, 31400, { first: 'Karim', wpUser: undefined }));
  assert.deepEqual(lines(a, 'name').map((r) => r.v), ['fixed']);
  assert.match(lines(a, 'name')[0].text, /^Prénom changé sur l’ancien site \(« Karim »\) : gardé sur ce rendez-vous, pas sur la fiche de Kérim Benali$/);
  assert.equal(byWp(t, 31400).name, 'Karim Benali');
  assert.equal(s.clients.get(byWp(t, 31400).clientId).first, 'Kérim', 'the file is not renamed');
  // again: nothing to say
  const v = s.version;
  assert.deepEqual((await send(t, row(t, 31400, { first: 'Karim', wpUser: undefined }))).review, []);
  assert.equal(s.version, v);
  // another case: the first pass typed « Léo », the old site now types something else
  await send(t, row(t, 31401, { first: 'Léo', last: 'Lefebvre', phone: '0635126318', wpUser: undefined }));
  const b = await send(t, row(t, 31401, { first: 'Hugo', last: 'Lefebvre', phone: '0635126318', wpUser: undefined }));
  assert.deepEqual(lines(b, 'name').map((r) => r.v), ['fixed']);
  assert.match(lines(b, 'name')[0].text, /^Prénom changé sur l’ancien site \(« Hugo »\)/);
  // a second person booking from the same number is a new booking: the family wording stays
  const c = await send(t, row(t, 31402, { first: 'Hugo', last: 'Lefebvre', phone: '0635126318', wpUser: undefined, start: 700 }));
  assert.deepEqual(lines(c, 'name').map((r) => r.v), [undefined]);
  assert.match(lines(c, 'name')[0].text, /Famille \?$/);
  // the owner renames the file: the old site types the same first name as before, which is no correction
  const cid = byWp(t, 31401).clientId;
  await t.engine.run(updateClient, { id: cid, patch: { first: 'Leonard' } }, owner(t));
  const d = await send(t, row(t, 31401, { first: 'Hugo', last: 'Lefebvre', phone: '0635126318', wpUser: undefined }));
  assert.deepEqual(lines(d, 'name'), []);
  assert.equal(byWp(t, 31401).name, 'Hugo Lefebvre');
});

test('the typed first name is remembered in pii, out of the chain, and gone with the file (item 3)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  await send(t, row(t, 31410, { first: 'Zinedine', last: 'Haddad', phone: '0600000077', wpUser: undefined }));
  const booked = t.engine.journal.find((e) => e.type === 'appt.booked' && e.data.ext && e.data.ext.wp === 31410);
  assert.ok(booked.pii && booked.pii.wpFirst, 'in pii');
  assert.ok(!JSON.stringify(booked.data).includes('Zinedine'), 'not in the chain');
  assert.ok(!JSON.stringify(s.appts.get(booked.data.id).ext || {}).includes('Zinedine'));
  assert.equal(s.appts.get(booked.data.id).wpFirst, 'Zinedine');
  // a correction writes the new one in pii too
  await send(t, row(t, 31410, { first: 'Zidane', last: 'Haddad', phone: '0600000077', wpUser: undefined }));
  const upd = t.engine.journal.filter((e) => e.type === 'appt.updated' && e.data.id === booked.data.id);
  assert.ok(upd.some((e) => e.pii && e.pii.wpFirst === 'Zidane') && !JSON.stringify(upd.map((e) => e.data)).includes('Zidane'));
  assert.equal(s.appts.get(booked.data.id).wpFirst, 'Zidane');
  // the view of a booking does not carry it
  assert.ok(!JSON.stringify([...s.appts.values()].map((a) => a.ext)).includes('Zi'));
  // erased with the file: in memory, and in a state replayed from the journal (whose pii the erasure took away)
  const cid = byWp(t, 31410).clientId;
  for (let i = 0; i < 2; i++) if ((await t.engine.run(eraseClient, { id: cid, cancelUpcoming: true }, as)).erased) break;
  assert.equal(s.clients.get(cid).erased, true);
  assert.equal(s.appts.get(booked.data.id).wpFirst, undefined);
  const replayed = emptyState();
  for (const e of t.engine.journal) evolve(replayed, e);
  assert.equal(replayed.appts.get(booked.data.id).wpFirst, undefined);
  assert.ok(!JSON.stringify(t.engine.journal).includes('Zidane') && !JSON.stringify(t.engine.journal).includes('Zinedine'));
});

test('a customer’s record never outranks a booking, and is not listed again once a booking has spoken (item 1)', async () => {
  const t = await shop();
  const s = t.engine.state;
  const client = { first: 'Zoé', last: 'Roux', phone: '0600000087', wpUser: 87 };
  // the record (the WXR’s customer) is read first, in the same batch as the booking that gives another number
  const a = await t.engine.run(importBatch, { clients: [client], appts: [row(t, 41000, { first: 'Zoé', last: 'Roux', phone: '0600000099', wpUser: 87 })] }, owner(t));
  const cid = byWp(t, 41000).clientId;
  assert.equal(s.clients.get(cid).phone, '+33600000099', 'the booking’s number');
  assert.deepEqual(lines(a, 'new-number').map((r) => r.v), ['fixed']);
  // the next pass reads the record again: it says the number a booking has outranked, nothing to list
  const b = await t.engine.run(importBatch, { clients: [client], appts: [row(t, 41000, { first: 'Zoé', last: 'Roux', phone: '0600000099', wpUser: 87 })] }, owner(t));
  assert.deepEqual(b.review, []);
  assert.equal(s.clients.get(cid).phone, '+33600000099');
  // a record alone never replaces: it fills a file that lacks the number, and lists another
  await t.engine.run(importBatch, { clients: [{ first: 'Nora', last: 'Haddad', phone: '0600000028', wpUser: 28 }] }, owner(t));
  const nora = [...s.clients.values()].find((x) => x.first === 'Nora' && x.source === 'wordpress');
  assert.equal(nora.phone, '+33600000028');
  const d = await t.engine.run(importBatch, { clients: [{ first: 'Nora', last: 'Haddad', phone: '0600000029', wpUser: 28 }] }, owner(t));
  assert.equal(nora.phone, '+33600000028');
  assert.deepEqual(lines(d, 'new-number').map((r) => r.v), [undefined]);
});

test('a file corrected by several bookings of a batch is one change (the preview counts the file once)', async () => {
  const t = await shop();
  const s = t.engine.state;
  const rows = (phone) => [31600, 31601, 31602].map((wp) => row(t, wp, { phone, start: 480 + (wp % 10) * 45 }));
  await send(t, ...rows('0600000001'));
  const cid = byWp(t, 31600).clientId;
  const a = await send(t, ...rows('0600000002'));
  assert.equal(s.clients.get(cid).phone, '+33600000002');
  assert.equal(a.appts.changed, 1, 'one file, one change');
  assert.deepEqual(lines(a, 'new-number').map((r) => [r.v, r.wp]), [['fixed', 31602]], 'said once, on the newest booking');
});

test('after the owner merges two files, the winner keeps the number he chose (item 4)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  // two files of the same person made by the import (no customer id on the old site, two numbers, two e-mails)
  await send(t, row(t, 31103, { first: 'Omar', last: 'Diallo', phone: '0600000001', email: 'omar@exemple.fr', wpUser: undefined }));
  await send(t, row(t, 31104, { first: 'Omar', last: 'Diallo', phone: '0600000002', email: 'omar2@exemple.fr', wpUser: undefined, start: 700 }));
  const c1 = byWp(t, 31103).clientId, c2 = byWp(t, 31104).clientId;
  assert.notEqual(c1, c2);
  await t.engine.run(mergeClients, { from: c2, into: c1 }, as);
  assert.equal(byWp(t, 31104).clientId, c1);
  assert.equal(s.clients.get(c1).phone, '+33600000001');
  // the final sync: the newest booking says the other number; the owner's choice stays, and it is listed
  const a = await send(t, row(t, 31103, { first: 'Omar', last: 'Diallo', phone: '0600000001', email: 'omar@exemple.fr', wpUser: undefined }), row(t, 31104, { first: 'Omar', last: 'Diallo', phone: '0600000002', email: 'omar2@exemple.fr', wpUser: undefined, start: 700 }));
  assert.equal(s.clients.get(c1).phone, '+33600000001');
  assert.equal(s.clients.get(c1).email, 'omar@exemple.fr');
  assert.ok(lines(a, 'new-number').every((r) => r.v !== 'fixed'));
  assert.ok(lines(a, 'new-number').length >= 1, 'listed, not dropped');
  assert.ok(lines(a, 'new-email').length >= 1);
  assert.equal(a.appts.changed, 0);
  // the pass wrote nothing it did not say
  assert.equal(s.clients.get(c1).wpPhone, '', 'the memory of what an import gave is gone');
});

test('the owner’s own number stays whatever the batches and the order (items 1, 4)', async () => {
  const t = await shop();
  const s = t.engine.state, as = owner(t);
  const old = row(t, 31500, { phone: '0600000001' }), neu = row(t, 31501, { phone: '0600000002', start: 700 });
  await chunks(t, [neu, old], 1);
  const cid = byWp(t, 31500).clientId;
  await t.engine.run(updateClient, { id: cid, patch: { phone: '0699887766' } }, as);
  for (const [order, n] of [[[neu, old], 1], [[old, neu], 1], [[old, neu], 2]]) {
    const r = await chunks(t, order, n);
    assert.equal(s.clients.get(cid).phone, '+33699887766', order.map((x) => x.wp).join() + ' ' + n);
    assert.ok(r.review.every((l) => l.kind !== 'new-number' || l.v !== 'fixed'));
  }
});

/* ---------------- many customers, many shapes: the same end whatever the batches and the order ---------------- */

/** A small seeded generator (the same draws on every run). */
function prng(seed) {
  let x = seed >>> 0 || 1;
  const next = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p };
}
const shuffled = (a, r) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = r.int(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/**
 * Customers with several bookings each (one WordPress account per customer, so the number may change from a booking to the next). The first
 * export gives each booking a number and an address; the second corrects some of them, adds newer bookings with other numbers and drops
 * nothing. Whatever the order of the rows and the size of the batches, each file ends with the number and the address of the highest-numbered
 * booking that has one, and the same export once more changes nothing.
 */
function world(seed) {
  const r = prng(seed);
  const people = [];
  let wp = 50000;
  for (let i = 0; i < 6; i++) {
    const bookings = [];
    for (let k = 0, n = 1 + r.int(4); k < n; k++) {
      wp += 1 + r.int(5);
      bookings.push({ wp, phone: '06' + String(10 + i).padStart(2, '0') + String(r.int(4)).padStart(4, '0') + '0' + r.int(3), email: r.chance(0.8) ? 'p' + i + 'v' + r.int(4) + '@exemple.fr' : '' });
    }
    people.push({ i, first: 'Karim' + 'abcdefg'[i], last: 'Benali', bookings });
  }
  // the second export: some bookings corrected, some customers booked again with other numbers
  const later = people.map((p) => {
    const bookings = p.bookings.map((b) => (r.chance(0.35) ? { ...b, phone: '06' + String(10 + p.i).padStart(2, '0') + String(4 + r.int(4)).padStart(4, '0') + '1' + r.int(3) } : r.chance(0.2) ? { ...b, email: 'p' + p.i + 'w' + r.int(4) + '@exemple.fr' } : b));
    for (let k = 0, n = r.chance(0.5) ? 1 + r.int(2) : 0; k < n; k++) { wp += 1 + r.int(5); bookings.push({ wp, phone: '06' + String(10 + p.i).padStart(2, '0') + String(8 + r.int(4)).padStart(4, '0') + '2' + r.int(3), email: r.chance(0.7) ? 'p' + p.i + 'x' + r.int(4) + '@exemple.fr' : '' }); }
    return { ...p, bookings };
  });
  return { people, later };
}
const rowsOf = (t, people) => people.flatMap((p) => p.bookings.map((b) => row(t, b.wp, { first: p.first, last: p.last, phone: b.phone, email: b.email || undefined, wpUser: 700 + p.i, start: 480 + (b.wp % 60) * 10, day: '2026-11-' + String(10 + (b.wp % 10)).padStart(2, '0') })));
const ending = (t, people) => people.map((p) => {
  const f = fileOf(t, p.bookings[0].wp);
  return f.first + ' ' + f.phone + ' ' + f.email;
}).join('\n');
/** What each file must end with: the number of the highest booking that gives one, and the address of the highest that gives one. */
const expected = (people) => people.map((p) => {
  const top = (k) => [...p.bookings].filter((b) => b[k]).sort((a, b) => b.wp - a.wp)[0];
  const norm = (n) => '+33' + n.slice(1);
  return p.first + ' ' + norm(top('phone').phone) + ' ' + (top('email') ? top('email').email : '');
}).join('\n');

test('many customers: the end state is the same for every batch size and row order, equals the highest booking, and a repeat changes nothing (items 1, 2)', async () => {
  const shapes = [['newest first', (rows) => [...rows].sort((a, b) => b.wp - a.wp)], ['oldest first', (rows) => [...rows].sort((a, b) => a.wp - b.wp)], ['shuffled', (rows, r) => shuffled(rows, r)]];
  let checked = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const { people, later } = world(seed);
    const first = new Set(), second = new Set();
    // the first export in every shape and batch size
    for (const [name1, shape1] of shapes) for (const n1 of [1, 2, 7, 150]) {
      const t = await shop();
      await chunks(t, shape1(rowsOf(t, people), prng(seed * 31 + n1)), n1);
      assert.equal(ending(t, people), expected(people), 'seed ' + seed + ' first ' + name1 + ' ' + n1);
      first.add(ending(t, people));
    }
    // the second on top of two different first passes
    for (const [name1, shape1, n1] of [[shapes[0][0], shapes[0][1], 150], [shapes[2][0], shapes[2][1], 2]]) {
      for (const [name2, shape2] of shapes) for (const n2 of [1, 3, 150]) {
        const u = await shop();
        await chunks(u, shape1(rowsOf(u, people), prng(seed * 31 + n1)), n1);
        const tag = 'seed ' + seed + ' first ' + name1 + ' ' + n1 + ' then ' + name2 + ' ' + n2;
        await chunks(u, shape2(rowsOf(u, later), prng(seed * 17 + n2)), n2);
        assert.equal(ending(u, later), expected(later), tag);
        second.add(ending(u, later));
        // the same export dropped again, in another order: nothing moves
        const v = u.engine.state.version;
        const again = await chunks(u, shape2(rowsOf(u, later), prng(seed * 5 + n2)).reverse(), n2);
        assert.equal(u.engine.state.version, v, tag + ' again');
        assert.equal(again.changed, 0, tag + ' again');
        checked++;
      }
    }
    assert.equal(first.size, 1, 'seed ' + seed + ': the first pass does not depend on the order or the batches');
    assert.equal(second.size, 1, 'seed ' + seed + ': nor the second');
  }
  assert.equal(checked, 8 * 2 * 3 * 3);
});

test('what the owner changed between two passes survives every batch size and row order; the rest follows the highest booking (items 1, 4)', async () => {
  const shapes = [(rows) => [...rows].sort((a, b) => b.wp - a.wp), (rows) => [...rows].sort((a, b) => a.wp - b.wp), (rows, r) => shuffled(rows, r)];
  for (let seed = 1; seed <= 6; seed++) {
    const { people, later } = world(seed);
    const finals = new Set();
    for (const [k, shape] of shapes.entries()) for (const n of [1, 4, 150]) {
      const t = await shop();
      const as = owner(t);
      await chunks(t, shapes[0](rowsOf(t, people)), 150);
      // between the passes: one owner edits a number, another detaches one, another changes an e-mail
      const mine = {};
      for (const p of people) {
        const f = fileOf(t, p.bookings[0].wp);
        const what = (seed + p.i) % 5;
        if (what === 0) { await t.engine.run(updateClient, { id: f.id, patch: { phone: '0699' + String(100000 + p.i * 7 + seed).slice(0, 6) } }, as); mine[p.i] = ['phone', t.engine.state.clients.get(f.id).phone]; }
        else if (what === 1) { await t.engine.run(detachPhone, { id: f.id }, as); mine[p.i] = ['phone', '']; }
        else if (what === 2) { await t.engine.run(updateClient, { id: f.id, patch: { email: 'owner' + p.i + '@mine.fr' } }, as); mine[p.i] = ['email', 'owner' + p.i + '@mine.fr']; }
      }
      await chunks(t, shape(rowsOf(t, later), prng(seed * 13 + k)), n);
      const norm = (x) => '+33' + x.slice(1);
      const end = people.map((p) => {
        const f = fileOf(t, p.bookings[0].wp);
        const top = (key) => [...later.find((q) => q.i === p.i).bookings].filter((b) => b[key]).sort((a, b) => b.wp - a.wp)[0];
        const m = mine[p.i];
        const want = { phone: m && m[0] === 'phone' ? m[1] : norm(top('phone').phone), email: m && m[0] === 'email' ? m[1] : top('email') ? top('email').email : '' };
        assert.deepEqual([f.phone, f.email], [want.phone, want.email], 'seed ' + seed + ' shape ' + k + ' batch ' + n + ' person ' + p.i + ' ' + JSON.stringify(m));
        return f.first + ' ' + f.phone + ' ' + f.email;
      }).join('\n');
      finals.add(end);
      // and the same export again: no mark, no number, nothing moves
      const v = t.engine.state.version;
      await chunks(t, shape(rowsOf(t, later), prng(seed * 7 + k)).reverse(), n);
      assert.equal(t.engine.state.version, v, 'seed ' + seed + ' shape ' + k + ' batch ' + n + ' again');
    }
    assert.equal(finals.size, 1, 'seed ' + seed);
  }
});

/* ---------------- through the wizard: the preview tells the truth, whatever the batches and the order ---------------- */

const HEAD = 'ID,DATE/HEURE,CRÉÉ,"PRÉNOM DU CLIENT","NOM DU CLIENT","E-MAIL DU CLIENT","TÉL DU CLIENT",SERVICES,ASSISTANTS,"NOMBRE DE POUR CHAQUE SERVICE","PRIX TOTAL",ÉTAT\n';
const PREAMBLE = 'Réservations,de,à\n,"01 Jan 2025","31 Déc 2026"\n\n';
/** The plugin’s export of these people (one e-mail each, a number per booking). */
const csvOf = (people) => PREAMBLE + HEAD + people.flatMap((p) => p.bookings.map((b) => ({ ...b, p }))).map(({ wp, phone, p }) => `${wp},"${10 + (wp % 9)} Nov 2026 ${String(9 + (wp % 8)).padStart(2, '0')}:00","01 Nov 2026 08:00",${p.first},${p.last},p${p.i}@exemple.fr,${phone},Coupe,JKut,1,"20 €",Confirmé\n`).join('');

test('the preview never says « rien de nouveau » over a pass that changes a file, and the pass does not depend on the batches (items 1, 2)', async () => {
  const { pass } = await import('../wp-helpers.js');
  const snap = (t) => JSON.stringify([...t.engine.state.clients.values()].map((c) => [c.first, c.phone, c.email]).sort());
  const work = (c, pv) => c.past + c.noShow + c.upcoming + c.cancelled + c.toCancel + c.toMove + c.toClose + c.toReopen + c.toUpdate + pv.goneOpen + c.giftcards + c.packs + c.newClients + c.merged;
  let silent = 0, ran = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { people, later } = world(seed);
    const ends = new Set();
    for (const chunk of [1, 3, 150]) {
      const t = await shop();
      await pass(t, [{ name: 'export.csv', text: csvOf(people) }], null, { run: true, chunk });
      const before = snap(t);
      // the final sync in the reverse order of rows (the plugin lists newest first, a saved copy may not)
      const rev = later.map((p) => ({ ...p, bookings: [...p.bookings].reverse() })).reverse();
      const text = csvOf(chunk === 150 ? later : rev);
      const second = await pass(t, [{ name: 'export.csv', text }], null, { run: true, chunk });
      const changed = before !== snap(t);
      // « rien de nouveau »: no work counted at all, so nothing may have been written to a file
      if (work(second.pv.counts, second.pv) === 0 && changed) silent++;
      ends.add(snap(t));
      // the same files again: the preview counts nothing, and nothing moves
      const third = await pass(t, [{ name: 'export.csv', text }], null, { run: true, chunk });
      assert.equal(third.pv.counts.toUpdate, 0, 'seed ' + seed + ' chunk ' + chunk);
      assert.equal(third.appts.changed || 0, 0);
      assert.equal(snap(t), ends.values().next().value);
      ran++;
    }
    assert.equal(ends.size, 1, 'seed ' + seed + ': the batches do not change the end');
  }
  assert.equal(silent, 0, 'a pass that changed a file was announced as nothing new');
  assert.equal(ran, 18);
});

test('the wizard’s go button may wrap its long label inside its rounded ends, as it does on a phone (item 5)', () => {
  const css = readFileSync(new URL('../../web/src/comptoir/pages/reglages/wordpress.css', import.meta.url), 'utf8');
  const rule = css.match(/\.wp-go \.btn\s*\{([^}]*)\}/);
  assert.ok(rule, 'a rule for the button of .wp-go');
  assert.match(rule[1], /white-space:\s*normal/);
  assert.match(rule[1], /padding-block:/);
  // the label that is too long for 326 px is the one of an export with nothing new: it stays whole, so the end-to-end tests find the button by it
  const page = readFileSync(new URL('../../web/src/comptoir/pages/reglages/Wordpress.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes('Enregistrer la vérification (rien de nouveau)'));
});
