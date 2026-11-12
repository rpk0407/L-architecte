// WP3 · GET /api/v1/home over HTTP, on the demo salon: every signed-in role gets its own Accueil (the amendment), the
// barber's is a privacy test, the relances count is the pulse's at the same instant, `chairs` answers like /api/v1/slots,
// the answer stays under 4 KB gzip, and the Accueil's prefs are stored like the others.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { prefsDefaults } from '../../server/projections/staffprefs.js';

const DAY = '2026-11-10'; // the Tuesday of docs/owner-experience.md
const clock = { now: at(DAY, 7, 40) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** A salon tablet with someone's PIN typed. */
async function asStaff(name) {
  const tab = await owner();
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette ' + name })).status, 200);
  await tab.post('/api/auth/logout');
  const who = (await tab.get('/api/auth/state')).json.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: who.id, pin: DEMO.pins[name] })).status, 200);
  return Object.assign(tab, { id: who.id });
}
function money(v) {
  const out = [];
  JSON.stringify(v, (k, x) => { if (k === 'amount' || (x && typeof x === 'object' && x.unit === 'eur')) out.push(k); return x; });
  return out;
}
const SHOP_CARDS = ['z', 'absence-demande', 'orphelins', 'demandes', 'relances', 'echecs', 'stock', 'purge', 'comptable', 'objectif', 'semaine'];

test('signed out: 401; the owner: the whole contract, under 4 KB gzip', async () => {
  clock.now = at(DAY, 7, 40);
  assert.equal((await browser(rt).get('/api/v1/home')).status, 401);
  const b = await owner();
  const r = await b.get('/api/v1/home');
  assert.equal(r.status, 200, r.text);
  const v = r.json;
  assert.equal(v.moment, 'avant');
  assert.match(v.line.label, /^Mardi 10 novembre · ouverture à 9 h$/);
  assert.ok(v.line.facts.length <= 3 && v.line.facts.some((f) => f.unit === 'eur'));
  assert.equal(v.day.scope, 'salon');
  assert.equal(v.day.chairs.length, 4);
  assert.ok(v.day.appts.length <= 12 && v.day.appts.length > 0 && v.day.next);
  assert.ok(v.cards.every((c) => c.why && c.preview.length <= 3));
  const gz = gzipSync(Buffer.from(r.text)).length;
  console.log('    home (owner, demo, 07:40): ' + r.text.length + ' bytes, ' + gz + ' bytes gzip, ' + v.cards.length + ' cards, ' + v.day.appts.length + '+' + v.day.more + ' appointments');
  assert.ok(gz <= 4096, gz + ' bytes gzip');
  // during the day too, when the list of appointments is at its longest
  clock.now = at(DAY, 15, 10);
  const mid = await b.get('/api/v1/home');
  assert.equal(mid.json.moment, 'pendant');
  const gz2 = gzipSync(Buffer.from(mid.text)).length;
  console.log('    home (owner, demo, 15:10): ' + mid.text.length + ' bytes, ' + gz2 + ' bytes gzip');
  assert.ok(gz2 <= 4096, gz2 + ' bytes gzip');
});

test('privacy: a barber gets 200, his only chair, his only appointments, no amount of the salon, no card of the owner', async () => {
  clock.now = at(DAY, 9, 5);
  const boss = await owner();
  const agenda = (await boss.get('/api/v1/agenda?day=' + DAY)).json;
  const jk = await asStaff('JKut');
  const r = await jk.get('/api/v1/home');
  assert.equal(r.status, 200, r.text);
  const v = r.json;
  assert.equal(v.day.scope, 'moi');
  assert.deepEqual(v.day.chairs.map((c) => c.staffId), [jk.id], 'his only chair');
  const mine = agenda.appts.filter((a) => a.staffId === jk.id);
  assert.ok(mine.length > 0, 'the demo books JKut today');
  assert.ok(v.day.appts.length > 0 && v.day.appts.every((a) => a.staffId === jk.id), 'his only appointments');
  assert.ok(v.day.appts.every((a) => mine.some((m) => m.id === a.id)));
  // not one client of another chair, by name or by id, and not one colleague
  const myNames = new Set(mine.map((a) => a.name));
  const others = agenda.appts.filter((a) => a.staffId !== jk.id);
  assert.ok(others.length > 10);
  for (const a of others) {
    assert.ok(!r.text.includes(a.id), 'appointment ' + a.id + ' of another chair');
    if (!myNames.has(a.name)) assert.ok(!r.text.includes(a.name), 'client « ' + a.name + ' » of another chair');
  }
  for (const l of agenda.lanes) if (l.id !== jk.id) assert.ok(!r.text.includes(l.id) && !r.text.includes('"' + l.name + '"'), 'colleague ' + l.name);
  assert.deepEqual(money(v), [], 'no amount, no fact in euros');
  assert.ok(v.cards.every((c) => ['encaisser', 'prochain'].includes(c.id)), v.cards.map((c) => c.id).join());
  for (const id of SHOP_CARDS) assert.ok(!v.cards.some((c) => c.id === id));
  assert.ok(v.cards.some((c) => c.id === 'prochain'), 'his next client');
  // the owner at the same instant reads the salon
  const o = (await boss.get('/api/v1/home')).json;
  assert.equal(o.day.chairs.length, 4);
  assert.ok(o.day.appts.some((a) => a.staffId !== jk.id));
  assert.ok(money(o).length > 0);
});

test('the front desk: every chair and appointment, the cards of its rights, never the money', async () => {
  clock.now = at(DAY, 9, 5);
  const ines = await asStaff('Inès');
  const r = await ines.get('/api/v1/home');
  assert.equal(r.status, 200, r.text);
  const v = r.json;
  assert.equal(v.day.scope, 'salon');
  assert.equal(v.day.chairs.length, 4);
  assert.ok(new Set(v.day.appts.map((a) => a.staffId)).size > 1);
  assert.deepEqual(money(v), []);
  for (const id of ['z', 'absence-demande', 'orphelins', 'stock', 'purge', 'comptable', 'objectif', 'semaine']) assert.ok(!v.cards.some((c) => c.id === id), id);
});

test('relances: the card’s count is the pulse’s badge at the same instant', async () => {
  clock.now = at(DAY, 9, 5);
  const b = await owner();
  const [h, p] = await Promise.all([b.get('/api/v1/home'), b.get('/api/v1/pulse')]);
  const c = h.json.cards.find((x) => x.id === 'relances');
  assert.ok(p.json.badges.relances >= 5, 'the demo has regulars to follow up: ' + p.json.badges.relances);
  assert.ok(c, 'above the threshold: the card is there');
  assert.equal(c.count, p.json.badges.relances);
  assert.ok(c.amount > 0);
  // and the other counts the shell already shows
  const enc = h.json.cards.find((x) => x.id === 'encaisser');
  assert.equal(enc ? enc.count : 0, p.json.badges.toPay);
  const req = h.json.cards.find((x) => x.id === 'absence-demande');
  assert.equal(req ? req.count : 0, p.json.badges.requests);
  const purge = h.json.cards.find((x) => x.id === 'purge');
  assert.equal(purge ? purge.count : 0, p.json.badges.retention);
});

test('chairs: « can he take someone now » is what /api/v1/slots answers, at four clocks', async () => {
  const b = await owner();
  const boot = (await b.get('/api/v1/bootstrap')).json;
  const services = boot.services.filter((x) => x.active && !x.pack);
  let libre = 0, pas = 0;
  // before opening, a running morning, JKut's break (12:30 to 13:00), the afternoon, after closing
  for (const [h, m] of [[7, 45], [10, 15], [12, 45], [15, 15], [19, 30]]) {
    clock.now = at(DAY, h, m);
    const min = h * 60 + m;
    const v = (await b.get('/api/v1/home')).json;
    const agenda = (await b.get('/api/v1/agenda?day=' + DAY)).json;
    for (const c of v.day.chairs) {
      // the one case the agenda's free time does not tell: a client still in the chair after the end of his slot
      const late = agenda.appts.some((a) => a.staffId === c.staffId && a.status === 'in_chair' && a.start + a.dur <= min);
      assert.equal(c.state === 'occupe' && c.until === null, late && agenda.lanes.find((l) => l.id === c.staffId).work.some(([x, y]) => min >= x && min < y) && !agenda.appts.some((a) => a.staffId === c.staffId && a.status !== 'cancelled' && a.status !== 'no_show' && a.start <= min && a.start + a.dur > min), c.name + ' at ' + h + ':' + m);
      if (c.state === 'occupe' && c.until === null) { assert.deepEqual([c.freeMin, c.canTake], [0, []]); pas++; continue; }
      const fits = [];
      for (const sv of services) {
        const sl = (await b.get('/api/v1/slots?day=' + DAY + '&services=' + sv.id + '&staff=' + c.staffId)).json;
        const nowSlot = sl.days[0].slots.some((x) => x.m === min);
        if (nowSlot) fits.push(sv.id);
        // the same rule seen from the minutes: the agenda offers « now » exactly when the service is no longer than his free time
        assert.equal(nowSlot, c.state === 'libre' && sl.dur <= c.freeMin, c.name + ' · ' + sv.name + ' at ' + h + ':' + m + ' (' + c.state + ', ' + c.freeMin + ' min)');
      }
      assert.deepEqual(c.canTake.map((x) => x.serviceId), fits.slice(0, 3), c.name + ' at ' + h + ':' + m + ' (' + c.state + ', ' + c.freeMin + ' min)');
      if (c.state === 'libre') libre++; else pas++;
    }
    if (h === 7 || h === 19) assert.ok(v.day.chairs.every((c) => c.state === 'ferme' || c.state === 'absent'), 'the salon is not open at ' + h + ' h');
    if (h === 12) { const jk = v.day.chairs.find((c) => c.name === 'JKut'); assert.deepEqual([jk.state, jk.until, jk.freeMin, jk.canTake], ['absent', 780, 0, []], 'JKut on his break'); }
  }
  assert.ok(libre > 0 && pas > 0, 'both answers were met: ' + libre + ' free, ' + pas + ' not');
  // Esteban does not work on Wednesdays
  clock.now = at('2026-11-11', 10, 15);
  const est = (await (await owner()).get('/api/v1/home')).json.day.chairs.find((c) => c.name === 'Esteban');
  assert.deepEqual([est.state, est.until, est.freeMin, est.canTake], ['absent', null, 0, []]);
  clock.now = at(DAY, 9, 5);
});

test('a closed day: moment « ferme », every chair closed, the week ahead as a card', async () => {
  clock.now = at('2026-11-15', 10, 0); // a Sunday
  const b = await owner();
  const v = (await b.get('/api/v1/home')).json;
  assert.equal(v.moment, 'ferme');
  assert.ok(v.day.chairs.every((c) => c.state === 'ferme' && c.until === null && !c.canTake.length));
  assert.deepEqual(v.day.appts, []);
  assert.ok(v.cards.some((c) => c.id === 'semaine'));
  clock.now = at(DAY, 9, 5);
});

test('prefs: the Accueil’s keys are stored for the person, bounded like the others', async () => {
  clock.now = at(DAY, 9, 6);
  const b = await owner();
  const r = await b.patch('/api/v1/prefs', {
    home: 'accueil', homeCards: ['relances', 'stock'], homeHidden: ['purge'], tabs: ['agenda', 'caisse', 'clients'], homeDay: 'moi',
    views: [{ page: 'clients', name: 'À relancer', query: 'segment=relancer&tri=overdue' }],
    homeBlocks: { prochain: true, fauteuils: false, jour: true }
  });
  assert.equal(r.status, 200, r.text);
  const me = (await b.get('/api/v1/bootstrap')).json.me;
  assert.deepEqual(me.prefs, { ...prefsDefaults('owner'), ...me.prefs });
  assert.deepEqual([me.prefs.home, me.prefs.homeCards, me.prefs.homeHidden, me.prefs.tabs, me.prefs.homeDay], ['accueil', ['relances', 'stock'], ['purge'], ['agenda', 'caisse', 'clients'], 'moi']);
  assert.deepEqual(me.prefs.views, [{ page: 'clients', name: 'À relancer', query: 'segment=relancer&tri=overdue' }]);
  // the page's blocks follow the person: read back on another device (a second sign-in)
  assert.deepEqual(me.prefs.homeBlocks, { prochain: true, fauteuils: false, jour: true });
  assert.deepEqual((await (await owner()).get('/api/v1/bootstrap')).json.me.prefs.homeBlocks, { prochain: true, fauteuils: false, jour: true });
  const ids = (n) => Array.from({ length: n }, (_, i) => 'c' + i);
  for (const bad of [
    { homeCards: ids(21) }, { homeHidden: ids(21) }, { homeCards: ['pas un id !'] }, { tabs: ['agenda', 'caisse', 'clients', 'rapports'] }, { homeDay: 'tous' }, { home: 'cockpit' },
    { homeBlocks: { prochain: 'non', fauteuils: true, jour: true } }, { homeBlocks: { prochain: true } }, { homeBlocks: [true, true, true] },
    { views: Array.from({ length: 9 }, (_, i) => ({ page: 'clients', name: 'v' + i, query: '' })) },
    { views: [{ page: 'clients', name: 'x'.repeat(31), query: '' }] }, { views: [{ page: 'clients', name: 'ok', query: 'q'.repeat(201) }] }
  ]) assert.equal((await b.patch('/api/v1/prefs', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  // the hidden card is gone from his Accueil; back to the defaults for the other tests
  assert.ok(!(await b.get('/api/v1/home')).json.cards.some((c) => c.id === 'purge'));
  assert.equal((await b.patch('/api/v1/prefs', { home: 'auto', homeCards: [], homeHidden: [], tabs: [], views: [], homeDay: 'salon', homeBlocks: { prochain: true, fauteuils: true, jour: true } })).status, 200);
});

test('measured: response time warm and after a write (printed; the budget is 20 ms warm)', async () => {
  clock.now = at(DAY, 15, 20);
  const b = await owner();
  const ms = async (f) => { const t0 = performance.now(); await f(); return performance.now() - t0; };
  await b.get('/api/v1/home');
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push(await ms(() => b.get('/api/v1/home')));
  warm.sort((a, c) => a - c);
  // a write that changes no figure (a preference), then one that does (a walk-in ticket)
  await b.patch('/api/v1/prefs', { buzz: false });
  const afterPref = await ms(() => b.get('/api/v1/home'));
  await b.patch('/api/v1/prefs', { buzz: true });
  const boot = (await b.get('/api/v1/bootstrap')).json;
  const cut = boot.services.find((x) => x.slug === 'cl'), jk = boot.staff.find((x) => x.name === 'JKut');
  const sale = await b.post('/api/v1/sales', { lines: [{ kind: 'service', ref: cut.id, staffId: jk.id }], payments: [{ method: 'card', amount: cut.price }] });
  assert.equal(sale.status, 200, sale.text);
  const afterSale = await ms(() => b.get('/api/v1/home'));
  console.log('    home latency (demo, in-process, session and cookies included): warm median ' + warm[10].toFixed(2) + ' ms, p95 ' + warm[18].toFixed(2) + ' ms; after a preference write ' + afterPref.toFixed(1) + ' ms; after a sale ' + afterSale.toFixed(1) + ' ms');
  assert.ok(warm[10] <= 20, 'warm median ' + warm[10].toFixed(2) + ' ms');
});
