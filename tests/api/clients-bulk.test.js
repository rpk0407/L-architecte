// WP8 · POST /api/v1/clients/bulk and GET /api/v1/clients?fields=ids, over HTTP, on the demo salon plus 2 400 seeded
// files (tests/seed-big.js). What is pinned: the rights of each role (the existing ones, per operation and per file),
// one request = one write of the journal, a retried request writes nothing, the hard caps, « everything this filter
// matches » resolved by the server at the moment of the action (against a filter rewritten here from the state), no text
// to anyone who refused them, an export limited to what was asked, without erased files, and written in the journal.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { seedBigSalon } from '../seed-big.js';
import { DEMO } from '../../server/domain/seed.js';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { BULK_MAX, SMS_MAX } from '../../server/http/routes-bulk.js';
import { smsOptOut, claimMessage } from '../../server/commands/messages.js';
import { diffDays } from '../../shared/dates.js';
import { fmtPhone } from '../../server/lib/util.js';

const DAY = '2026-11-10'; // a Tuesday, 10 h: the salon is open and no text is held by the quiet hours
const clock = { now: at(DAY, 10, 0) };
const ENV = { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' };
let rt, store, big;
before(async () => {
  store = memoryStore();
  rt = await createRuntime({ env: ENV, clock: () => clock.now, store });
  big = (await seedBigSalon(rt.engine, { clients: 2400 })).ids;
});

let seq = 0;
const rid = () => 'b01c0000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const S = () => rt.engine.state;
const sys = { actor: { t: 'system', id: 'test' }, caps: new Set() };

async function owner(on = rt) {
  const b = browser(on);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** A salon tablet with someone's PIN typed. */
async function asStaff(name, pin = DEMO.pins[name]) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin })).status, 200);
  return Object.assign(tab, { id: who.id });
}
let managerMade = false;
async function manager() {
  if (!managerMade) { const b = await owner(); assert.equal((await b.post('/api/v1/staff', { name: 'Mona', role: 'manager', pin: '4826' })).status, 200); managerMade = true; }
  return asStaff('Mona', '4826');
}
const bulk = (b, body, id = rid()) => b.post('/api/v1/clients/bulk', body, { 'x-request-id': id });
const tagsOf = (id) => S().clients.get(id).tags || [];
const live = () => [...S().clients.values()].filter((c) => !c.erased && !c.mergedInto);
/** count the appends the store receives while `fn` runs */
async function writes(fn) {
  const orig = store.append;
  let n = 0;
  store.append = (...a) => { n++; return orig.apply(store, a); };
  try { const out = await fn(); return { n, out }; } finally { store.append = orig; }
}

/* ---------------- the filter, rewritten from the state (nothing shared with the server's) ---------------- */

const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function visitsOf(s) {
  const days = new Map(), next = new Set();
  const push = (cid, day) => { if (!days.has(cid)) days.set(cid, []); days.get(cid).push(day); };
  for (const a of s.appts.values()) {
    if (!a.clientId) continue;
    if (a.status === 'done') push(a.clientId, a.day);
    else if (a.status !== 'no_show' && a.status !== 'cancelled' && a.day >= DAY) next.add(a.clientId);
  }
  for (const x of s.sales.values()) if (x.clientId && !x.apptId && x.lines.some((l) => l.kind === 'service')) push(x.clientId, x.day);
  return { days, next };
}
/** « À relancer »: past the rhythm (median of the last gaps, 28 days without one, plus 3), not booked, less than 180 days, and who may be texted */
function overdueSet(s) {
  const { days, next } = visitsOf(s);
  const out = new Set();
  for (const c of live()) {
    const d = (days.get(c.id) || []).sort();
    if (!d.length || next.has(c.id)) continue;
    const gaps = [];
    for (let i = Math.max(1, d.length - 6); i < d.length; i++) { const g = diffDays(d[i - 1], d[i]); if (g >= 5) gaps.push(g); }
    gaps.sort((a, b) => a - b);
    const m = Math.floor(gaps.length / 2);
    const rhythm = (gaps.length ? (gaps.length % 2 ? gaps[m] : Math.round((gaps[m - 1] + gaps[m]) / 2)) : 0) || 28;
    const since = diffDays(d[d.length - 1], DAY);
    if (since > rhythm + 3 && since < 180 && since >= 7 && c.sms && c.phone && c.marketing) out.add(c.id);
  }
  return out;
}
function scratch({ q = '', segment = 'all' }) {
  const s = S();
  const words = fold(q).split(/[^a-z0-9]+/).filter(Boolean);
  const over = segment === 'relancer' ? overdueSet(s) : null;
  return live().filter((c) => {
    const name = fold(c.first) + ' ' + fold(c.last);
    if (!words.every((w) => name.includes(w))) return false;
    if (segment === 'vip') return (c.tags || []).includes('VIP');
    if (segment === 'anniversaires') return !!c.birthday && c.birthday.slice(3, 5) === DAY.slice(5, 7);
    if (segment === 'relancer') return over.has(c.id);
    return true;
  }).map((c) => c.id).sort();
}

/* ---------------- fields=ids ---------------- */

test('fields=ids: the ids of the whole filter, in the list’s order, 2 000 at most and said so', async () => {
  const b = await owner();
  for (const f of [{ segment: 'vip' }, { segment: 'relancer' }, { segment: 'anniversaires' }, { q: 'wassim' }, { q: 'ben ka', segment: 'vip' }, { q: 'garcia', segment: 'relancer' }]) {
    const u = new URLSearchParams({ ...f, fields: 'ids' });
    const r = await b.get('/api/v1/clients?' + u);
    assert.equal(r.status, 200, r.text);
    const want = scratch(f);
    assert.ok(want.length > 0 || f.q === 'ben ka', JSON.stringify(f) + ' matches someone');
    assert.deepEqual([...r.json.ids].sort(), want, JSON.stringify(f));
    assert.deepEqual([r.json.total, r.json.truncated, r.json.max], [want.length, false, BULK_MAX]);
    assert.deepEqual(Object.keys(r.json).sort(), ['ids', 'max', 'total', 'truncated'], 'ids only: no card, no count of the other segments');
  }
  // the same order as the pages of the list, so « the first 2 000 » are the ones on screen
  for (const sort of ['recent', 'name', 'spend']) {
    const page = (await b.get('/api/v1/clients?segment=vip&sort=' + sort + '&limit=60')).json;
    const ids = (await b.get('/api/v1/clients?segment=vip&fields=ids&sort=' + sort)).json;
    assert.deepEqual(ids.ids.slice(0, 60), page.items.map((c) => c.id), sort);
    assert.equal(ids.total, page.total);
  }
  const all = (await b.get('/api/v1/clients?fields=ids')).json;
  assert.equal(all.total, live().length);
  assert.ok(all.total > BULK_MAX);
  assert.deepEqual([all.ids.length, all.truncated], [BULK_MAX, true]);
});

test('pages by offset: page 2 is the next 60, nothing of page 1, and a page stays under 8 KB gzip', async () => {
  const b = await owner();
  const p1 = await b.get('/api/v1/clients?sort=name&limit=60');
  const p2 = await b.get('/api/v1/clients?sort=name&limit=60&offset=60');
  const both = (await b.get('/api/v1/clients?sort=name&limit=120')).json.items.map((c) => c.id);
  assert.deepEqual([...p1.json.items, ...p2.json.items].map((c) => c.id), both);
  assert.equal(p2.json.items.length, 60);
  assert.equal(p2.json.total, live().length);
  for (const p of [p1, p2]) { const gz = gzipSync(Buffer.from(p.text)).length; assert.ok(gz <= 8192, gz + ' bytes gzip'); }
});

/* ---------------- tags: one write, idempotent, undone by the inverse ---------------- */

test('300 files tagged in one request: one write of the journal, the change reported per file', async () => {
  const b = await owner();
  const ids = big.slice(0, 300);
  const had = ids.filter((id) => tagsOf(id).includes('Fidélité')).length;
  assert.equal(had, 0);
  const before = rt.engine.journal.length;
  const { n, out: r } = await writes(() => bulk(b, { op: 'tag', ids, tag: 'Fidélité' }));
  assert.equal(r.status, 200, r.text);
  assert.equal(n, 1, 'one append for the 300 files');
  assert.deepEqual([r.json.matched, r.json.changed, r.json.unchanged, r.json.missing], [300, 300, 0, 0]);
  assert.deepEqual([...r.json.ids].sort(), [...ids].sort());
  const added = rt.engine.journal.slice(before);
  assert.equal(added.length, 300);
  assert.ok(added.every((e) => e.type === 'client.updated' && e.data.cid === e.data.id && !e.pii && e.at === added[0].at && e.actor.t === 'staff'), 'the existing event, no personal data, one instant, signed by who did it');
  assert.ok(ids.every((id) => tagsOf(id).includes('Fidélité')));
  assert.ok(!tagsOf(big[300]).includes('Fidélité'), 'nobody else');
  assert.equal((await rt.engine.verify()).ok, true, 'the chain still verifies');

  // again: those who have it are left alone (no event), and said so
  const again = await writes(() => bulk(b, { op: 'tag', ids: big.slice(250, 350), tag: 'Fidélité' }));
  assert.deepEqual([again.out.json.changed, again.out.json.unchanged, again.out.json.ids.length], [50, 50, 50]);
  assert.equal(again.n, 1);

  // undo = the inverse on the files that changed, and only them: the 50 who had it before keep it
  const undo = await bulk(b, { op: 'untag', ids: again.out.json.ids, tag: 'Fidélité' });
  assert.deepEqual([undo.json.changed, undo.json.unchanged], [50, 0]);
  assert.ok(big.slice(250, 300).every((id) => tagsOf(id).includes('Fidélité')));
  assert.ok(big.slice(300, 350).every((id) => !tagsOf(id).includes('Fidélité')));
});

test('a file that cannot take the tag is reported, the others pass: erased, merged away, unknown, already 8 tags', async () => {
  const b = await owner();
  const [gone, full, ok, merged, into] = big.slice(400, 405);
  assert.equal((await b.patch('/api/v1/clients/' + full, { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })).status, 200);
  assert.equal((await b.post('/api/v1/clients/' + gone + '/erase', { cancelUpcoming: true })).status, 200);
  assert.equal((await b.post('/api/v1/clients/merge', { from: merged, into })).status, 200);
  const r = await bulk(b, { op: 'tag', ids: [gone, full, ok, merged, 'cl_inconnu', ok], tag: 'Barbe+' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.matched, r.json.changed, r.json.missing, r.json.full], [5, 1, 3, 1], 'an id sent twice counts once');
  assert.deepEqual(r.json.ids, [ok]);
  assert.equal(tagsOf(full).length, 8);
  assert.ok(!(S().clients.get(gone).tags || []).includes('Barbe+'), 'an erased file is never written to again');
});

test('the same request retried returns the same answer and writes nothing, even after the undo, even on another instance', async () => {
  const b = await owner();
  const ids = big.slice(500, 620);
  const key = rid();
  const r1 = await bulk(b, { op: 'tag', ids, tag: 'Relance mars' }, key);
  assert.equal(r1.json.changed, 120);
  const len = rt.engine.journal.length;
  const r2 = await bulk(b, { op: 'tag', ids, tag: 'Relance mars' }, key);
  assert.equal(r2.status, 200);
  assert.deepEqual([r2.json.changed, r2.json.ids.length], [120, 120], 'the first answer, not « already tagged »');
  assert.equal(rt.engine.journal.length, len, 'no new event');
  // undone, then the first request arrives again (a retry that was on its way): it must not tag them back
  assert.equal((await bulk(b, { op: 'untag', ids: r1.json.ids, tag: 'Relance mars' })).json.changed, 120);
  const len2 = rt.engine.journal.length;
  const r3 = await bulk(b, { op: 'tag', ids, tag: 'Relance mars' }, key);
  assert.equal(r3.json.changed, 120);
  assert.equal(rt.engine.journal.length, len2);
  assert.ok(ids.every((id) => !tagsOf(id).includes('Relance mars')), 'still undone');
  // another instance on the same store never saw the first answer: it rebuilds it from the journal, and writes nothing
  const other = await createRuntime({ env: ENV, clock: () => clock.now, store });
  const b2 = await owner(other);
  const r4 = await bulk(b2, { op: 'tag', ids, tag: 'Relance mars' }, key);
  assert.equal(r4.status, 200, r4.text);
  assert.deepEqual([r4.json.changed, [...r4.json.ids].sort()], [120, [...ids].sort()]);
  assert.equal(other.engine.journal.length, len2);
  // by filter, when the action itself empties the filter (« retirer VIP » from the VIP files): the retry still gets the
  // first answer, not « la liste a changé », and writes nothing
  const vip = scratch({ segment: 'vip' });
  const k3 = rid();
  const body = { op: 'untag', filter: { segment: 'vip' }, tag: 'VIP', expect: vip.length };
  const u1 = await bulk(b, body, k3);
  assert.deepEqual([u1.status, u1.json.changed], [200, vip.length]);
  assert.equal(scratch({ segment: 'vip' }).length, 0);
  const len4 = rt.engine.journal.length;
  const u2 = await bulk(b, body, k3);
  assert.deepEqual([u2.status, u2.json.changed, [...u2.json.ids].sort()], [200, vip.length, vip]);
  assert.equal(rt.engine.journal.length, len4);
  // the same body as a NEW request is another matter: the list did change, and it is refused
  assert.equal((await bulk(b, body)).status, 409);
  assert.equal((await bulk(b, { op: 'tag', ids: u1.json.ids, tag: 'VIP' })).json.changed, vip.length, 'undone: the VIP files are back');
  assert.deepEqual(scratch({ segment: 'vip' }), vip);
  // an export retried is logged once
  const k2 = rid();
  const e1 = await bulk(b, { op: 'export', ids: ids.slice(0, 5) }, k2);
  const len3 = rt.engine.journal.length;
  const e2 = await bulk(b, { op: 'export', ids: ids.slice(0, 5) }, k2);
  assert.equal(e1.text, e2.text);
  assert.equal(rt.engine.journal.length, len3);
});

/* ---------------- the caps ---------------- */

test('bounded: 2 000 files a request, by ids or by filter, 500 texts; over it nothing happens and the message says why', async () => {
  const b = await owner();
  const len = rt.engine.journal.length;
  assert.deepEqual([BULK_MAX, SMS_MAX], [2000, 500]);
  const tooMany = await bulk(b, { op: 'tag', ids: big.slice(0, BULK_MAX + 1), tag: 'Trop' });
  assert.equal(tooMany.status, 400, tooMany.text);
  assert.match(tooMany.json.error.message, /2\s000/);
  const all = await bulk(b, { op: 'tag', filter: {}, tag: 'Trop' });
  assert.equal(all.status, 400);
  assert.equal(all.json.error.code, 'too_many');
  assert.match(all.json.error.message, /2\s000/);
  assert.equal(all.json.error.extra.total, live().length, 'and how many the filter matches');
  const exp = await bulk(b, { op: 'export', filter: { segment: 'all' } });
  assert.equal(exp.status, 400);
  // texts: the cap counts those who would really get one
  const sms = await bulk(b, { op: 'sms', ids: big.slice(0, BULK_MAX) });
  assert.equal(sms.status, 400, sms.text);
  assert.equal(sms.json.error.code, 'too_many');
  assert.match(sms.json.error.message, /500/);
  assert.equal(rt.engine.journal.length, len, 'nothing written, nothing queued');
  // exactly 2 000 passes
  const ok = await writes(() => bulk(b, { op: 'tag', ids: big.slice(0, BULK_MAX), tag: 'Plein' }));
  assert.equal(ok.out.status, 200, ok.out.text);
  assert.deepEqual([ok.out.json.matched, ok.n], [BULK_MAX, 1]);
  assert.equal((await bulk(b, { op: 'untag', ids: ok.out.json.ids, tag: 'Plein' })).json.changed, ok.out.json.changed);
});

test('a malformed request is refused whole: no operation, both ids and a filter, neither, no tag, a text too short', async () => {
  const b = await owner();
  const len = rt.engine.journal.length;
  for (const body of [{ ids: [big[0]] }, { op: 'delete', ids: [big[0]] }, { op: 'tag', tag: 'X' }, { op: 'tag', tag: 'X', ids: [big[0]], filter: {} }, { op: 'tag', ids: [big[0]] }, { op: 'tag', ids: [big[0]], tag: 'x'.repeat(25) },
    { op: 'tag', ids: [], tag: 'X' }, { op: 'tag', ids: ['pas un id !'], tag: 'X' }, { op: 'sms', ids: [big[0]], text: 'court' }, { op: 'tag', filter: { segment: 'inconnu' }, tag: 'X' }, { op: 'tag', ids: [big[0]], except: [big[1]], tag: 'X' }]) {
    const r = await bulk(b, body);
    assert.equal(r.status, 400, JSON.stringify(body) + ' → ' + r.text);
  }
  assert.equal(rt.engine.journal.length, len);
});

/* ---------------- select everything the filter matches ---------------- */

test('« everything this filter matches » is resolved by the server when the action runs, not from the list on screen', async () => {
  const b = await owner();
  for (const f of [{ segment: 'vip' }, { q: 'wassim' }, { segment: 'relancer', q: 'garcia' }]) {
    const want = scratch(f);
    const tag = 'F ' + JSON.stringify(f).length + (f.q || '');
    const r = await bulk(b, { op: 'tag', filter: f, tag, expect: want.length });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.matched, r.json.changed], [want.length, want.length], JSON.stringify(f));
    assert.deepEqual(live().filter((c) => (c.tags || []).includes(tag)).map((c) => c.id).sort(), want, 'exactly the files of the filter, whatever page was loaded');
    assert.equal((await bulk(b, { op: 'untag', ids: r.json.ids, tag })).json.changed, want.length);
  }
  // the screen read the list (2 pages of 60 out of several hundred VIP files)…
  const seen = (await b.get('/api/v1/clients?segment=vip&fields=ids')).json;
  assert.ok(seen.total > 120);
  // …then someone at the desk marks one more file VIP
  const late = big[2300];
  assert.ok(!tagsOf(late).includes('VIP'));
  assert.equal((await b.patch('/api/v1/clients/' + late, { tags: [...tagsOf(late), 'VIP'] })).status, 200);
  // with the count the owner confirmed: refused, nothing written, the new count given
  const len = rt.engine.journal.length;
  const stale = await bulk(b, { op: 'tag', filter: { segment: 'vip' }, tag: 'Soirée', expect: seen.total });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.json.error.code, 'changed');
  assert.equal(stale.json.error.extra.total, seen.total + 1);
  assert.equal(rt.engine.journal.length, len);
  // confirmed again (or without a count): the file that arrived since is in, the unchecked ones are out
  const except = seen.ids.slice(0, 3);
  const r = await bulk(b, { op: 'tag', filter: { segment: 'vip' }, except, tag: 'Soirée', expect: seen.total + 1 - 3 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.changed, seen.total + 1 - 3);
  assert.ok(tagsOf(late).includes('Soirée'), 'matched at the moment of the action');
  assert.ok(except.every((id) => !tagsOf(id).includes('Soirée')));
  assert.equal((await bulk(b, { op: 'untag', ids: r.json.ids, tag: 'Soirée' })).json.changed, r.json.changed);
});

/* ---------------- rights ---------------- */

test('rights per role: each operation asks the right the single action asks today', async () => {
  const anon = browser(rt);
  assert.equal((await bulk(anon, { op: 'tag', ids: [big[0]], tag: 'X' })).status, 401);
  assert.equal((await anon.get('/api/v1/clients?fields=ids')).status, 401);
  const ids = big.slice(700, 710);

  // a barber: no text, no export, no « confiance » (it spares the deposit: who edits every booking decides), by ids or by filter
  const barber = await asStaff('JKut');
  const len = rt.engine.journal.length; // after his sign-in (enrolling the tablet is an event)
  for (const body of [{ op: 'sms', ids }, { op: 'sms', ids, dry: true }, { op: 'export', ids }, { op: 'export', filter: { segment: 'vip' } }, { op: 'tag', ids, tag: 'confiance' }, { op: 'untag', filter: { q: 'wassim' }, tag: 'confiance' }]) {
    const r = await bulk(barber, body);
    assert.equal(r.status, 403, JSON.stringify(body) + ' → ' + r.text);
    assert.equal(r.json.error.code, 'forbidden');
  }
  assert.equal(rt.engine.journal.length, len, 'a refused request writes nothing');
  assert.ok(![...S().messages.values()].some((m) => ids.includes(m.cid) && m.template === 'rebook' && m.at === clock.now));
  // …but an ordinary tag is « Modifier les fiches clients », which he has on each file today
  const plain = await bulk(barber, { op: 'tag', ids, tag: 'Dégradé' });
  assert.equal(plain.status, 200, plain.text);
  assert.equal(plain.json.changed, 10);
  assert.equal(rt.engine.journal[rt.engine.journal.length - 1].actor.id, barber.id, 'journalled under his name');
  // the owner switches « Modifier les fiches » off for nobody: a barber without the right would get 403; shown with the desk's export below

  // the front desk: tags, « confiance » and texts; no export
  const desk = await asStaff('Inès');
  assert.equal((await bulk(desk, { op: 'tag', ids, tag: 'confiance' })).json.changed, 10);
  assert.equal((await bulk(desk, { op: 'untag', ids, tag: 'confiance' })).json.changed, 10);
  assert.equal((await bulk(desk, { op: 'sms', ids, dry: true })).status, 200);
  const no = await bulk(desk, { op: 'export', ids });
  assert.equal(no.status, 403, no.text);
  assert.ok(!no.text.includes(S().clients.get(ids[0]).last + ';'), 'no row leaks in a refusal');

  // a manager and the owner: everything
  for (const who of [await manager(), await owner()]) {
    assert.equal((await bulk(who, { op: 'tag', ids, tag: 'confiance' })).status, 200);
    assert.equal((await bulk(who, { op: 'untag', ids, tag: 'confiance' })).status, 200);
    assert.equal((await bulk(who, { op: 'sms', ids, dry: true })).status, 200);
    assert.equal((await bulk(who, { op: 'export', ids })).status, 200);
  }
  assert.equal((await bulk(await owner(), { op: 'untag', ids, tag: 'Dégradé' })).json.changed, 10);
});

/* ---------------- texts ---------------- */

test('texts: never to someone who refused them; the preview is the send, unsaved; excluded files are counted by reason', async () => {
  const b = await owner();
  const s = S();
  const ids = big.slice(800, 1100);
  // one who answered STOP since the list was read, one erased, one seen yesterday is in there by construction of the seed
  const stopped = ids.find((id) => { const c = s.clients.get(id); return c.marketing && c.sms && c.phone; });
  await rt.engine.run(smsOptOut, { phone: s.clients.get(stopped).phone }, sys);
  assert.equal(S().clients.get(stopped).marketingSrc, 'stop');
  const { days } = visitsOf(S());
  const since = (id) => { const d = (days.get(id) || []).sort(); return d.length ? diffDays(d[d.length - 1], DAY) : null; };
  const may = (id) => { const c = S().clients.get(id); return !c.erased && !c.mergedInto && c.marketing && c.sms && !!c.phone; };
  const want = ids.filter((id) => may(id) && since(id) != null && since(id) >= 7).sort();
  const refused = ids.filter((id) => !may(id));
  assert.ok(want.length > 30 && refused.length > 100, 'the sample has both: ' + want.length + ' / ' + refused.length);

  // the preview: the same command, nothing saved
  const len = rt.engine.journal.length;
  const dry = await bulk(b, { op: 'sms', ids, dry: true });
  assert.equal(dry.status, 200, dry.text);
  assert.equal(rt.engine.journal.length, len, 'a preview writes nothing');
  assert.deepEqual([dry.json.dry, dry.json.matched, dry.json.sent], [true, 300, want.length]);
  const ex = dry.json.excluded;
  assert.equal(ex.noConsent, ids.filter((id) => { const c = S().clients.get(id); return !c.marketing; }).length, 'no yes to the offers (a STOP is one of them)');
  assert.equal(ex.noPhone, ids.filter((id) => { const c = S().clients.get(id); return c.marketing && (!c.sms || !c.phone); }).length);
  assert.equal(ex.recent, ids.filter((id) => may(id) && (since(id) == null || since(id) < 7)).length);
  assert.equal(dry.json.sent + ex.noConsent + ex.noPhone + ex.recent + ex.other, 300, 'every file is either texted or counted in one reason');
  assert.ok(dry.json.template && dry.json.stop, 'what the confirmation shows: the words and the STOP mention');

  const key = rid();
  const r = await bulk(b, { op: 'sms', ids }, key);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.sent, [...r.json.ids].sort()], [want.length, want]);
  // the request retried (a lost answer): the same answer, and not one text more
  const lenSent = rt.engine.journal.length;
  const again = await bulk(b, { op: 'sms', ids }, key);
  assert.deepEqual([again.status, again.json.sent, [...again.json.ids].sort()], [200, want.length, want]);
  assert.equal(rt.engine.journal.length, lenSent, 'a retry queues nothing');
  assert.deepEqual(r.json.excluded, ex, 'what the preview said');
  const queued = rt.engine.journal.slice(len).filter((e) => e.type === 'message.queued');
  assert.equal(queued.length, want.length);
  assert.deepEqual(queued.map((e) => e.data.cid).sort(), want);
  for (const e of queued) {
    const c = S().clients.get(e.data.cid);
    assert.ok(c.marketing && c.sms && c.phone && c.marketingSrc !== 'stop' && !c.erased, 'a text only to someone who said yes');
    assert.equal(e.data.template, 'rebook');
    assert.equal(e.data.marketing, true);
    assert.equal(e.data.id, [...S().messages.values()].find((m) => m.cid === c.id && m.template === 'rebook' && m.at === clock.now).id);
  }
  assert.ok(!queued.some((e) => refused.includes(e.data.cid)));
  assert.ok(!queued.some((e) => e.data.cid === stopped));
  const body = [...S().messages.values()].find((m) => m.cid === want[0] && m.at === clock.now).body;
  assert.ok(body.includes(S().settings.messages.stopSuffix.trim()), 'the STOP mention goes with every text: ' + body);

  // the same people again the same day (another request): the message queue's own key refuses a second text
  const twice = await bulk(b, { op: 'sms', ids });
  assert.equal(twice.status, 200);
  assert.deepEqual([twice.json.sent, twice.json.excluded.other], [0, want.length], 'already texted today: counted, not texted twice');
  assert.equal(rt.engine.journal.slice(len).filter((e) => e.type === 'message.queued').length, want.length);

  // a STOP that arrives while a text waits beats it when it leaves (the existing guard, still in force for these)
  const m = [...S().messages.values()].find((x) => x.cid === want[1] && x.at === clock.now);
  await rt.engine.run(smsOptOut, { phone: S().clients.get(want[1]).phone }, sys);
  assert.equal((await rt.engine.run(claimMessage, { id: m.id }, sys)).ok, false);
  assert.equal(S().messages.get(m.id).status, 'skipped');
});

test('texts by filter, with the owner’s own words: the filter of the moment, 10 to 320 characters', async () => {
  const b = await owner();
  const f = { segment: 'relancer', q: 'martin' };
  const want = scratch(f).filter((id) => ![...S().messages.values()].some((m) => m.cid === id && m.template === 'rebook' && m.at === clock.now));
  assert.ok(want.length > 0);
  const r = await bulk(b, { op: 'sms', filter: f, text: '{prenom}, une place se libère jeudi : {lien}' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([...r.json.ids].sort(), want);
  const m = [...S().messages.values()].find((x) => x.cid === want[0] && x.at === clock.now);
  assert.match(m.body, /une place se libere jeudi|une place se libère jeudi/);
});

/* ---------------- export ---------------- */

test('export: the columns of the clients export, only the files asked, no erased or merged file, written in the journal', async () => {
  const b = await owner();
  const whole = await b.get('/api/v1/export?kind=clients');
  const head = whole.text.split('\r\n')[0];
  const [gone, merged, into, a, c] = big.slice(1200, 1205);
  assert.equal((await b.post('/api/v1/clients/' + gone + '/erase', { cancelUpcoming: true })).status, 200);
  assert.equal((await b.post('/api/v1/clients/merge', { from: merged, into })).status, 200);
  // the row of a file, written here from the state: the eight columns of kind=clients
  const rowOf = (id) => { const x = S().clients.get(id); return [x.first, x.last, fmtPhone(x.phone), x.email, x.sms ? 'oui' : 'non', x.marketing ? 'oui' : 'non', new Date(x.createdAt).toISOString().slice(0, 10), x.notes].join(';'); };
  const len = rt.engine.journal.length;
  const r = await bulk(b, { op: 'export', ids: [gone, merged, into, a, c, 'cl_inconnu'] });
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers.get('content-type'), /^text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="larchitecte-clients-selection-2026-11-10\.csv"/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const lines = r.text.split('\r\n').filter(Boolean);
  assert.equal(lines[0], head, 'the same columns as kind=clients');
  assert.equal(lines.length, 4, 'three files: the erased one, the merged one and the unknown id are not there');
  assert.deepEqual(lines.slice(1).sort(), [into, a, c].map(rowOf).sort());
  for (const l of lines.slice(1)) assert.ok(whole.text.includes(l) || l === rowOf(into), 'each row is a row of the full export');
  // the journal: who exported, how many, never whom
  const logged = rt.engine.journal.slice(len);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].type, 'tech.logged');
  assert.deepEqual(logged[0].data, { kind: 'export', what: 'clients', count: 3, by: 'ids' });
  assert.equal(logged[0].pii, undefined);
  assert.deepEqual([logged[0].actor.t, S().staff.get(logged[0].actor.id).role], ['staff', 'owner']);
  const audit = (await b.get('/api/v1/audit?limit=5')).json.items[0];
  assert.deepEqual([audit.type, audit.label, audit.summary, audit.actorId], ['tech.logged', 'Journal technique', 'export', logged[0].actor.id]);
  const tech = (await b.get('/api/v1/fiscal/log?limit=1')).json.items[0];
  assert.deepEqual([tech.kind, tech.label, tech.data.count], ['export', 'Export', 3]);

  // by filter: the files of the filter, at the moment of the export
  const f = { segment: 'vip', q: 'da silva' };
  const want = scratch(f);
  assert.ok(want.length > 1);
  const byFilter = await bulk(b, { op: 'export', filter: f });
  const got = byFilter.text.split('\r\n').filter(Boolean).slice(1);
  assert.deepEqual(got.sort(), want.map(rowOf).sort());
  assert.deepEqual(rt.engine.journal[rt.engine.journal.length - 1].data, { kind: 'export', what: 'clients', count: want.length, by: 'filter', segment: 'vip', search: true });
  // nothing to export: nothing sent, nothing logged
  const len2 = rt.engine.journal.length;
  const none = await bulk(b, { op: 'export', ids: [gone, 'cl_inconnu'] });
  assert.equal(none.status, 400, none.text);
  assert.equal(rt.engine.journal.length, len2);
});

/* ---------------- measures (docs/owner-experience.md, WP8) ---------------- */

test('measured: a tag on 1 000 files, a page of the list, the ids of a filter (2 900 files)', async () => {
  const b = await owner();
  const ids = big.slice(1300, 2300);
  const t0 = performance.now();
  const r = await writes(() => bulk(b, { op: 'tag', ids, tag: 'Mesure' }));
  const ms = performance.now() - t0;
  assert.deepEqual([r.out.status, r.out.json.changed, r.n], [200, 1000, 1]);
  const t1 = performance.now();
  const u = await bulk(b, { op: 'untag', ids: r.out.json.ids, tag: 'Mesure' });
  const ms2 = performance.now() - t1;
  assert.equal(u.json.changed, 1000);
  const page = await b.get('/api/v1/clients?limit=60&offset=60');
  const t2 = performance.now();
  for (let i = 0; i < 10; i++) await b.get('/api/v1/clients?limit=60&offset=' + 60 * i);
  const pageMs = (performance.now() - t2) / 10;
  const t3 = performance.now();
  const all = await b.get('/api/v1/clients?fields=ids&segment=relancer');
  const idsMs = performance.now() - t3;
  console.log('    bulk tag of 1 000 files: ' + ms.toFixed(0) + ' ms (undo: ' + ms2.toFixed(0) + ' ms), one write · a page of 60: ' + page.text.length + ' bytes, ' + gzipSync(Buffer.from(page.text)).length + ' gzip, ' + pageMs.toFixed(1) + ' ms · ids of « à relancer » (' + all.json.total + '): ' + idsMs.toFixed(1) + ' ms, ' + all.text.length + ' bytes');
  assert.ok(ms < 3000, 'a bulk tag of 1 000 files stays an instant: ' + ms.toFixed(0) + ' ms');
});
