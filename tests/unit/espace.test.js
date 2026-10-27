// TEAM-04: « Mon espace ». A barber's home is one read computed for him alone (next client with what is known of the cut,
// his day, his gaps, his figures); the cut notes he keeps live in pii next to the event under the client's file, are
// replaced note by note, follow a merge and leave with an erasure.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { at } from '../helpers.js';
import { capsOf } from '../../server/domain/permissions.js';
import { addClient } from '../../server/commands/clients.js';
import * as A from '../../server/commands/agenda.js';
import { report } from '../../server/domain/insights.js';
import { birthdayIn, espaceView } from '../../server/domain/espace.js';
import { cutNotesOf, cutnotesExtension } from '../../server/projections/cutnotes.js';
import { emptyState, evolve } from '../../server/core/state.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 15, 16) };
let rt, ids, owner, cl;
const asOwner = () => { const st = [...rt.engine.state.staff.values()].find((x) => x.role === 'owner'); return { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, rt.engine.state.settings) }; };
const run = (h, input) => rt.engine.run(h, input, asOwner());
const asSite = { actor: { t: 'client', id: 'web', n: '' }, caps: new Set(), meta: {} };

async function login() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** a barber (or the desk) on the salon tablet, by PIN */
async function onTablet(name) {
  const b = await login();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  const r = await b.post('/api/auth/pin', { staffId: ids[name], pin: DEMO.pins[name] });
  assert.equal(r.status, 200, r.text);
  return b;
}
const mineToday = () => [...rt.engine.state.apptsByDay.get(DAY)].map((i) => rt.engine.state.appts.get(i)).filter((a) => a.staffId === ids.JKut);

before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  const s = rt.engine.state;
  ids = Object.fromEntries([...s.staff.values()].map((x) => [x.name, x.id]));
  cl = {};
  // JKut's afternoon, rebuilt: what was still to come is cancelled, then Karim at 15:00 (not arrived), a block, a hold, a
  // booking at 17:15 that leaves a 15-minute hole before it
  for (const a of mineToday()) if (['booked', 'arrived', 'in_chair', 'pending'].includes(a.status) && a.start >= 780) await run(A.cancelAppointment, { id: a.id });
  const karim = await run(addClient, { first: 'Karim', last: 'Benali', phone: '06 11 22 33 44', marketing: true, birthday: '06-11' });
  const nour = await run(addClient, { first: 'Nour', last: 'Test', phone: '06 11 22 33 55' });
  cl.karim = karim.id; cl.nour = nour.id;
  const cut = [...s.services.values()].find((x) => x.slug === 'cl').id;
  const book = (clientId, start) => run(A.createAppointment, { clientId, serviceIds: [cut], staffId: ids.JKut, day: DAY, start, source: 'salon', sms: false });
  cl.apptKarim = (await book(karim.id, 900)).id;
  cl.apptNour = (await book(nour.id, 1035)).id;
  await run(A.addBlock, { staffId: ids.JKut, day: DAY, start: 960, dur: 30, label: 'Pause' });
  await rt.engine.run(A.holdSlot, { serviceIds: [cut], staffId: ids.JKut, day: DAY, start: 990 }, asSite);
});

test('JKut: the next client is Karim, 16 minutes late, with his birthday coming; only JKut’s day and figures', async () => {
  const jk = await onTablet('JKut');
  const r = await jk.get('/api/v1/espace');
  assert.equal(r.status, 200, r.text);
  const v = r.json;
  assert.equal(v.next.name, 'Karim B.');
  assert.equal(v.next.status, 'booked');
  assert.equal(v.next.late, 16);
  assert.equal(v.next.client.firstVisit, true);
  assert.deepEqual(v.next.client.birthdaySoon, { inDays: 3, day: '2026-11-06' });
  assert.equal(v.next.client.member, null);
  assert.equal(v.next.canNote, false, 'not in the chair yet');
  // the day: only his own appointments, in order, no colleague's anywhere in the JSON
  const mine = new Set(mineToday().map((a) => a.id));
  assert.ok(v.list.length >= 3);
  for (const x of v.list) assert.ok(mine.has(x.id), x.name + ' is not JKut’s');
  assert.deepEqual(v.list.map((x) => x.start), [...v.list.map((x) => x.start)].sort((a, b) => a - b));
  const json = JSON.stringify(v);
  for (const other of ['Frank', 'Le Soldat', 'Esteban', ids.Frank, ids['Le Soldat'], ids.Esteban]) assert.ok(!json.includes(other), 'found ' + other);
  assert.ok(!/phone|telephone|06 11|\+33/i.test(json), 'no number leaves');
  // his figures are his: the report of his chair alone
  const own = report(rt.engine.state, { from: DAY, to: DAY, staffId: ids.JKut, today: DAY, now: clock.now });
  assert.equal(v.figures.day.performed, own.revenue);
  assert.equal(v.figures.day.tips, own.tips);
  assert.equal(v.figures.month.commission, own.staff[0].commission);
  assert.ok(v.figures.goal && v.figures.goal.staffId === ids.JKut);
  // the salon in percent, no names, no euros (teamView 'salon' by default)
  assert.ok(v.salon && typeof v.salon.goalPct === 'number' && !('team' in v.salon));
});

test('the gaps: his work minus bookings, the block and the live hold, nothing under 20 minutes', async () => {
  const jk = await onTablet('JKut');
  const v = (await jk.get('/api/v1/espace')).json;
  // 15:30–16:00 is free; 16:00–16:30 is the block, 16:30–17:00 a client filling the booking sheet; 17:00–17:15 is 15 minutes
  assert.deepEqual(v.gaps, [{ start: 930, end: 960, dur: 30 }, { start: 1065, end: 1110, dur: 45 }]);
  for (const g of v.gaps) assert.ok(g.dur >= 20);
  assert.equal(v.now.status, 'busy', 'Karim’s slot has come: the chair is not free');
  assert.equal(v.now.phase, 'expected');
  assert.equal(v.now.with, 'Karim B.');
});

test('his status chip: libre jusqu’à, au fauteuil, off before and after his day', async () => {
  const was = clock.now;
  // a PIN session left alone ends after 10 minutes: a new one at each hour of the day
  const at_ = async (h, m) => { clock.now = at(DAY, h, m); return (await (await onTablet('JKut')).get('/api/v1/espace')).json; };
  try {
    let v = await at_(14, 40);
    assert.equal(v.now.status, 'free');
    assert.equal(v.now.until, 900, 'free until Karim’s 15:00');
    v = await at_(8, 0);
    assert.equal(v.now.status, 'off');
    assert.equal(v.now.kind, 'before');
    assert.equal(v.now.until, 540);
    v = await at_(12, 45);
    assert.equal(v.now.kind, 'break');
    assert.equal(v.now.until, 780);
    v = await at_(19, 0);
    assert.equal(v.now.kind, 'after');
    assert.equal(v.now.until, null);
  } finally { clock.now = was; }
});

test('Mon espace is for a chair: the desk is told so, a signed-out call is refused', async () => {
  const desk = await onTablet('Inès');
  const r = await desk.get('/api/v1/espace');
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'no_chair');
  assert.equal(r.json.error.message, 'Mon espace est pour ceux qui ont un fauteuil.');
  assert.equal((await browser(rt).get('/api/v1/espace')).status, 401);
  // the owner has no chair in the demo either; a barber's page never shows another chair's day
  const frank = await onTablet('Frank');
  const f = (await frank.get('/api/v1/espace')).json;
  assert.ok(f.list.every((x) => !mineToday().some((a) => a.id === x.id)));
});

test('cut notes: only his own appointment, in the chair or within two weeks; the text sits in pii under the file', async () => {
  const jk = await onTablet('JKut'), frank = await onTablet('Frank');
  const done = mineToday().find((a) => a.status === 'done' && a.clientId);
  const url = (id) => '/api/v1/appointments/' + id + '/cut-note';
  // a colleague cannot write on JKut’s appointment
  const no = await frank.post(url(done.id), { text: 'Dégradé 1,5 sur les côtés' });
  assert.equal(no.status, 403, no.text);
  // booked, not yet in the chair: too early
  assert.equal((await jk.post(url(cl.apptKarim), { text: 'Trop tôt' })).status, 409);
  assert.equal((await jk.post(url(done.id), { text: '   ' })).status, 400);
  assert.equal((await jk.post(url(done.id), { text: 'x'.repeat(281) })).status, 400);
  const ok = await jk.post(url(done.id), { text: 'Dégradé 1,5 sur les côtés, dessus aux ciseaux' });
  assert.equal(ok.status, 200, ok.text);
  const e = rt.engine.journal.at(-1);
  assert.equal(e.type, 'cut.noted');
  assert.equal(e.data.cid, done.clientId, 'under the client’s file');
  assert.equal(e.data.apptId, done.id);
  assert.equal(e.data.staffId, ids.JKut);
  assert.equal(e.pii.text, 'Dégradé 1,5 sur les côtés, dessus aux ciseaux');
  assert.ok(!JSON.stringify(e.data).includes('Dégradé'), 'the text is not in the chained data');
  assert.ok(!JSON.stringify(e.actor).includes('Dégradé'));
  // the row no longer asks for it
  const row = (await jk.get('/api/v1/espace')).json.list.find((x) => x.id === done.id);
  assert.equal(row.needsNote, false);
  assert.equal(row.noted, true);
  // a retried request (same id) writes once
  const before = rt.engine.journal.length;
  const key = { 'x-request-id': 'cutnote-retry-0001' };
  assert.equal((await jk.post(url(done.id), { text: 'Garde la longueur dessus' }, key)).status, 200);
  assert.equal((await jk.post(url(done.id), { text: 'Garde la longueur dessus' }, key)).status, 200);
  assert.equal(rt.engine.journal.length, before + 1);
  // a second note on the same visit replaces the first; the first stays in the history
  const list = (await jk.get('/api/v1/clients/' + done.clientId + '/cut-notes')).json.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].text, 'Garde la longueur dessus');
  assert.equal(list[0].edited, true);
  assert.equal(list[0].staff, 'JKut');
  assert.equal(list[0].mine, true);
  assert.equal((await frank.get('/api/v1/clients/' + done.clientId + '/cut-notes')).json.items[0].mine, false);
  assert.deepEqual(cutNotesOf(rt.engine.state, [done.clientId])[0].prev.map((p) => p.text), ['Dégradé 1,5 sur les côtés, dessus aux ciseaux']);
  // two weeks after the cut it is too late
  const was = clock.now;
  try {
    clock.now = at('2026-11-18', 10);
    const later = await onTablet('JKut');
    const late = await later.post(url(done.id), { text: 'Trop tard' });
    assert.equal(late.status, 409);
    assert.equal(late.json.error.code, 'too_old');
  } finally { clock.now = was; }
});

test('the notes show on the client’s next visit, with their author, whoever reads; a merge keeps them; erasure takes them away', async () => {
  const jk = await onTablet('JKut'), frank = await onTablet('Frank'), boss = await login();
  const s = rt.engine.state;
  const cut = [...s.services.values()].find((x) => x.slug === 'cl').id;
  // Frank sits a client down today and writes a note on the cut
  const mine = await run(addClient, { first: 'Sami', last: 'Notes', phone: '06 99 88 77 66' });
  // the first free half-hour on a chair that day
  const bookAt = async (staffId, day, from) => {
    for (let m = from; m < 1080; m += 30) { try { return await run(A.createAppointment, { clientId: mine.id, serviceIds: [cut], staffId, day, start: m, source: 'salon', sms: false }); } catch (e) { if (e.code !== 'taken') throw e; } }
    throw new Error('no free slot');
  };
  const visit = await bookAt(ids.Frank, DAY, 540);
  assert.equal((await frank.post('/api/v1/appointments/' + visit.id + '/status', { status: 'in_chair' })).status, 200);
  assert.equal((await frank.post('/api/v1/appointments/' + visit.id + '/cut-note', { text: 'Skin fade, laisser 3 cm dessus' })).status, 200);
  // JKut reads it on the same client’s next visit, with the author’s name
  const next = await bookAt(ids.JKut, '2026-11-10', 540);
  const v = (await jk.get('/api/v1/espace?day=2026-11-10')).json;
  assert.equal(v.next.id, next.id);
  assert.equal(v.next.cutNotes.length, 1);
  assert.equal(v.next.cutNotes[0].staff, 'Frank');
  assert.equal(v.next.cutNotes[0].text, 'Skin fade, laisser 3 cm dessus');
  assert.equal(v.next.cutNotes[0].mine, false);
  assert.equal(v.now, null, 'the live parts are today’s');

  // a merge: the notes are found from the file that is kept
  const twin = await run(addClient, { first: 'Sami', last: 'Notes', phone: '06 99 88 77 67' });
  assert.equal((await boss.post('/api/v1/clients/merge', { from: mine.id, into: twin.id })).status, 200);
  const merged = (await jk.get('/api/v1/clients/' + twin.id + '/cut-notes')).json.items;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'Skin fade, laisser 3 cm dessus');
  assert.equal((await jk.get('/api/v1/espace?day=2026-11-10')).json.next.cutNotes.length, 1, 'the booking follows the kept file');
  const exp = JSON.parse((await boss.get('/api/v1/clients/' + twin.id + '/export')).text);
  assert.deepEqual(exp.notesDeCoupe, [{ jour: DAY, barbier: 'Frank', texte: 'Skin fade, laisser 3 cm dessus' }]);

  // erasure: the notes are gone from memory, the export has none, and the store lost the text
  const er = await boss.post('/api/v1/clients/' + twin.id + '/erase', { cancelUpcoming: true });
  assert.equal(er.status, 200, er.text);
  assert.deepEqual(cutNotesOf(rt.engine.state, [twin.id, mine.id]), []);
  assert.deepEqual((await jk.get('/api/v1/clients/' + twin.id + '/cut-notes')).json.items, []);
  assert.deepEqual(JSON.parse((await boss.get('/api/v1/clients/' + twin.id + '/export')).text).notesDeCoupe, []);
  const noted = rt.engine.journal.filter((e) => e.type === 'cut.noted' && e.data.cid === mine.id);
  assert.equal(noted.length, 1);
  assert.equal(noted[0].pii, undefined, 'the text left the journal with the file');
  const stored = (await rt.engine.store.read(0)).events.filter((e) => e.type === 'cut.noted' && e.data.cid === mine.id);
  assert.equal(stored.length, 1);
  assert.ok(stored.every((e) => !e.pii || !JSON.stringify(e.pii).includes('Skin fade')), 'the store forgot the text too');
});

test('a note needs a file and a chair’s appointment', async () => {
  const jk = await onTablet('JKut');
  const s = rt.engine.state;
  const cut = [...s.services.values()].find((x) => x.slug === 'cl').id;
  const walk = await run(A.createAppointment, { name: 'Passage', serviceIds: [cut], staffId: ids.JKut, day: DAY, start: 1080, source: 'walkin', sms: false });
  assert.equal((await jk.post('/api/v1/appointments/' + walk.id + '/status', { status: 'in_chair' })).status, 200);
  const r = await jk.post('/api/v1/appointments/' + walk.id + '/cut-note', { text: 'Rien à garder' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'no_client');
  assert.equal((await jk.post('/api/v1/appointments/ap_inconnu/cut-note', { text: 'x' })).status, 404);
});

test('the projection keeps the last 20, ignores a copy whose text was erased, and replays to the same state', () => {
  const s = emptyState();
  const ev = (v, d, pii) => ({ v, id: 'e' + v, type: 'cut.noted', at: v * 1000, actor: { t: 'staff', id: 'st_1' }, h: 'h', p: 'p', data: d, ...(pii ? { pii } : {}) });
  for (let i = 1; i <= 25; i++) evolve(s, ev(i, { id: 'cn_' + i, apptId: 'ap_' + i, cid: 'cl_1', staffId: 'st_1', day: '2026-10-' + String(i).padStart(2, '0') }, { text: 'note ' + i }));
  const list = cutNotesOf(s, ['cl_1'], 50);
  assert.equal(list.length, 20);
  assert.equal(list[0].text, 'note 25');
  assert.equal(list.at(-1).text, 'note 6');
  // a redacted copy (its text is gone) is not kept
  evolve(s, ev(26, { id: 'cn_26', apptId: 'ap_26', cid: 'cl_1', staffId: 'st_1', day: '2026-10-30' }, undefined));
  assert.equal(cutNotesOf(s, ['cl_1'], 50).length, 20);
  assert.ok(cutnotesExtension.on['cut.noted'] && cutnotesExtension.on['client.erased']);
});

test('birthdays: within a week, the 29th of February in a common year, an impossible date', () => {
  assert.deepEqual(birthdayIn('06-11', '2026-11-03'), { inDays: 3, day: '2026-11-06' });
  assert.deepEqual(birthdayIn('03-11', '2026-11-03'), { inDays: 0, day: '2026-11-03' });
  assert.equal(birthdayIn('02-11', '2026-11-03'), null, 'yesterday is not soon');
  assert.equal(birthdayIn('11-11', '2026-11-03'), null, 'eight days');
  assert.deepEqual(birthdayIn('02-01', '2026-12-30'), { inDays: 3, day: '2027-01-02' }, 'across the new year');
  assert.deepEqual(birthdayIn('29-02', '2027-02-25'), { inDays: 3, day: '2027-02-28' });
  assert.equal(birthdayIn('31-04', '2026-04-29'), null);
  assert.equal(birthdayIn('', '2026-11-03'), null);
});

test('in the chair: the note of this very visit is his to correct, and « la dernière fois » stays the earlier ones', async () => {
  const jk = await onTablet('JKut');
  assert.equal((await jk.post('/api/v1/appointments/' + cl.apptKarim + '/status', { status: 'in_chair' })).status, 200);
  let v = (await jk.get('/api/v1/espace')).json;
  assert.equal(v.next.id, cl.apptKarim);
  assert.equal(v.next.status, 'in_chair');
  assert.equal(v.next.canNote, true);
  assert.equal(v.next.myNote, null);
  assert.equal(v.now.status, 'busy');
  assert.deepEqual([v.now.phase, v.now.with], ['chair', 'Karim B.']);
  assert.equal((await jk.post('/api/v1/appointments/' + cl.apptKarim + '/cut-note', { text: 'Sabot 2 sur les côtés' })).status, 200);
  v = (await jk.get('/api/v1/espace')).json;
  assert.equal(v.next.myNote, 'Sabot 2 sur les côtés');
  assert.deepEqual(v.next.cutNotes, [], 'this visit’s note is not « la dernière fois »');
  assert.equal(v.next.late, 0, 'in the chair is not late');
  // AC-04's late notice, when that package is there: the minutes the client announced
  const s = rt.engine.state;
  // (the read is memoised per journal version and minute: a notice comes with an event, which moves the version)
  s.lateNotices = new Map([[cl.apptKarim, { min: 10, at: clock.now }]]);
  clock.now += 60000;
  try { assert.deepEqual((await jk.get('/api/v1/espace')).json.next.lateNotice, { min: 10, at: clock.now - 60000 }); } finally { delete s.lateNotices; clock.now -= 60000; }
});

test('the view reads without the optional modules (no walk-in rotation, no late notice, no favourite barber)', () => {
  const s = rt.engine.state;
  const v = espaceView(s, s.staff.get(ids.JKut), capsOf(s.staff.get(ids.JKut), s.settings), { day: DAY, now: clock.now });
  assert.deepEqual(v.walkins, { waiting: 0, mineNext: null });
  assert.equal(v.next.lateNotice, null);
  assert.equal(v.next.client.prefersMe, false);
});
