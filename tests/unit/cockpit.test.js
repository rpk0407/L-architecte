// TEAM-05a: Pilotage. One read for the owner and the managers (report.shop), whose numbers are the ones Rapports, the agenda
// and the statement already give; the team in chair order and never by takings; a period compared with the same days of
// the one before; the till's state; fairness hints that need ten events; memoised by journal version.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { salon, at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { cockpit, periodOf, EQUITY_MIN } from '../../server/domain/cockpit.js';
import { report, goalOf, openDays } from '../../server/domain/insights.js';
import { addDays, dayRange, weekStart } from '../../shared/dates.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 15, 16) };
let rt, ids;
const S = () => rt.engine.state;
const q = (range = 'day', day = DAY) => ({ range, day, today: DAY, now: clock.now });
/** the in-memory state was changed by hand: the reads forget what they computed for the version before */
const bump = () => { S().version++; };

before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  ids = Object.fromEntries([...S().staff.values()].map((x) => [x.name, x.id]));
});

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
async function onTablet(name) {
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  const r = await b.post('/api/auth/pin', { staffId: ids[name], pin: DEMO.pins[name] });
  assert.equal(r.status, 200, r.text);
  return b;
}

test('access: owner and manager read it, a barber (even with « Toute l’équipe ») and the desk do not', async () => {
  const o = await owner();
  const r = await o.get('/api/v1/cockpit');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.range.kind, 'day');
  const add = await o.post('/api/v1/staff', { name: 'Nadia', role: 'manager', pin: '4826' });
  assert.equal(add.status, 200, add.text);
  const m = await owner();
  await m.post('/api/auth/device', { name: 'Poste manager' });
  await m.post('/api/auth/logout');
  assert.equal((await m.post('/api/auth/pin', { staffId: add.json.id, pin: '4826' })).status, 200);
  assert.equal((await m.get('/api/v1/cockpit?range=week')).status, 200);
  assert.equal((await o.patch('/api/v1/settings', { team: { teamView: 'named' } })).status, 200);
  assert.equal((await (await onTablet('JKut')).get('/api/v1/cockpit')).status, 403);
  assert.equal((await (await onTablet('Inès')).get('/api/v1/cockpit')).status, 403);
  assert.equal((await browser(rt).get('/api/v1/cockpit')).status, 401);
  assert.equal((await o.get('/api/v1/cockpit?range=year')).status, 400);
  assert.equal((await o.get('/api/v1/cockpit?day=hier')).status, 400);
  await o.patch('/api/v1/settings', { team: { teamView: 'salon' } });
});

test('the figures are Rapports’ and the goal’s own: Encaissé, Réalisé, each barber’s row, the month goal', () => {
  for (const range of ['day', 'week', 'month']) {
    const c = cockpit(S(), q(range));
    const rep = report(S(), { from: c.range.from, to: c.range.upTo, staffId: null, today: DAY, now: clock.now });
    assert.equal(c.kpis.cashed.value, rep.revenue, range);
    assert.equal(c.kpis.performed, rep.performed);
    assert.deepEqual(c.kpis.gap, rep.gap);
    assert.equal(c.kpis.tips, rep.tips);
    assert.equal(c.kpis.avgTicket, rep.avgTicket);
    assert.equal(c.kpis.clients.total, rep.clients);
    assert.equal(c.kpis.clients.new + c.kpis.clients.returning, rep.clients);
    assert.equal(c.kpis.noShows.count, rep.noShows);
    assert.equal(c.kpis.fill.value, rep.occupancy);
    for (const x of c.team) {
      const row = rep.staff.find((y) => y.id === x.id);
      assert.equal(x.revenue, row.revenue, x.name);
      assert.equal(x.commission, row.commission);
      assert.equal(x.tips, row.tips);
    }
  }
  const month = cockpit(S(), q('month'));
  const g = goalOf(S(), null, DAY, clock.now);
  assert.equal(month.kpis.cashed.goal.target, g.target);
  assert.equal(month.kpis.cashed.goal.done, g.done);
  assert.equal(month.kpis.cashed.goal.perDay, g.perDay);
  // three open days are needed before a line is drawn
  assert.equal(month.kpis.cashed.goal.projection, null);
  // mid-month: a straight line through the open days so far, over the open days of the month, to the euro
  const mid = '2026-10-20';
  const c = cockpit(S(), { range: 'month', day: mid, today: mid, now: at(mid, 15) });
  const gm = goalOf(S(), null, mid, at(mid, 15));
  const elapsed = openDays(S(), '2026-10-01', mid), total = openDays(S(), '2026-10-01', '2026-10-31');
  assert.equal(c.kpis.cashed.goal.projection, Math.round((gm.done / elapsed) * total / 100) * 100);
  assert.ok(c.kpis.cashed.goal.projection > gm.done);
  // nothing the owner did not already see in Rapports, and no client's name or number
  assert.ok(!/phone|"first"|"last"|email/.test(JSON.stringify(month)));
});

test('the team is in chair order, never by takings', () => {
  const c = cockpit(S(), q('month'));
  const chairs = [...S().staff.values()].filter((x) => x.chair && x.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'fr'));
  assert.deepEqual(c.team.map((x) => x.id), chairs.map((x) => x.id));
  const byTakings = [...c.team].sort((a, b) => b.revenue - a.revenue).map((x) => x.id);
  assert.notDeepEqual(byTakings, c.team.map((x) => x.id), 'the demo’s takings order differs from its chairs, so this test would catch a sort');
  for (const x of c.team) {
    assert.equal(typeof x.goalPct === 'number' || x.goalPct === null, true);
    assert.equal(x.week.from, weekStart(DAY));
    assert.ok(x.week.minutes > 0);
  }
});

test('periods: a week is Monday to Sunday, a month the calendar month, compared with the same days before; a coming day reads as today', () => {
  const day = periodOf('day', DAY, DAY);
  assert.deepEqual([day.from, day.to, day.prev.from], [DAY, DAY, '2026-10-27']);
  assert.equal(day.label, 'Mardi 3 novembre');
  const week = periodOf('week', '2026-11-05', DAY);
  assert.deepEqual([week.from, week.to, week.upTo], ['2026-11-02', '2026-11-08', DAY]);
  // Monday to Tuesday against last Monday to Tuesday, not against a whole week
  assert.deepEqual(week.prev, { from: '2026-10-26', to: '2026-10-27' });
  assert.equal(week.label, 'Semaine du 2 au 8 nov.');
  const month = periodOf('month', DAY, DAY);
  assert.deepEqual([month.from, month.to, month.upTo, month.label], ['2026-11-01', '2026-11-30', DAY, 'Novembre 2026']);
  assert.deepEqual(month.prev, { from: '2026-10-01', to: '2026-10-03' });
  // a period over is read whole, against the whole one before
  const past = periodOf('month', '2026-10-15', DAY);
  assert.deepEqual([past.upTo, past.prev.from, past.prev.to, past.live], ['2026-10-31', '2026-09-01', '2026-09-30', false]);
  assert.equal(periodOf('week', '2026-10-14', DAY).prev.to, '2026-10-11');
  assert.equal(periodOf('day', '2027-01-01', DAY).day, DAY);
  const c = cockpit(S(), q('week'));
  const prev = report(S(), { from: c.range.prev.from, to: c.range.prev.to, staffId: null, today: DAY, now: clock.now });
  assert.equal(c.kpis.prev.cashed, prev.revenue);
  assert.equal(dayRange(c.range.from, c.range.upTo).length, 2);
});

test('memoised by (journal version, range, day); a new version computes again', () => {
  const a = cockpit(S(), q('week'));
  assert.equal(cockpit(S(), q('week')), a);
  assert.notEqual(cockpit(S(), q('month')), a);
  assert.notEqual(cockpit(S(), q('week', addDays(DAY, -7))), a);
  bump();
  const b = cockpit(S(), q('week'));
  assert.notEqual(b, a);
  assert.deepEqual(b.kpis, a.kpis);
});

test('absences lost: a no-show nobody paid for counts, a kept deposit or a fee does not', () => {
  const s = S();
  const a = [...s.apptsByDay.get(DAY)].map((i) => s.appts.get(i)).find((x) => x.status === 'booked' && !x.saleId);
  const before = cockpit(s, q()).kpis.noShows;
  const saved = { status: a.status, price: a.price, deposit: a.deposit };
  Object.assign(a, { status: 'no_show', price: 3000, deposit: null }); bump();
  const lost = cockpit(s, q()).kpis.noShows;
  assert.equal(lost.count, before.count + 1);
  assert.equal(lost.lost, before.lost + 3000);
  a.deposit = { amount: 1000, paid: 1000 }; bump();
  assert.equal(cockpit(s, q()).kpis.noShows.lost, before.lost, 'the deposit was kept');
  Object.assign(a, saved); bump();
  assert.equal(cockpit(s, q()).kpis.noShows.lost, before.lost);
});

test('what is owed to clients: live gift card balances and the cuts left on carnets', async () => {
  const c = cockpit(S(), q());
  const list = await (await owner()).get('/api/v1/giftcards');
  assert.equal(c.kpis.outstanding.giftcards, list.json.outstanding);
  assert.ok(c.kpis.outstanding.carnets > 0 && c.kpis.outstanding.cuts > 0);
});

test('the till: Z missed for a past day nobody closed, done once it is, due while today waits', () => {
  const s = S();
  const open = cockpit(s, q()).cash;
  assert.ok(['due', 'done'].includes(open.z), open.z);
  assert.equal(typeof open.unpaid, 'number');
  const days = [...s.closures.keys()].filter((d) => d < DAY).sort();
  const d = days[days.length - 1];
  const z = s.closures.get(d);
  s.closures.delete(d); bump();
  const missed = cockpit(s, q()).cash;
  assert.equal(missed.z, 'missed');
  assert.equal(missed.missedDay, d);
  s.closures.set(d, z); bump();
  assert.notEqual(cockpit(s, q()).cash.z, 'missed');
  const today = s.closures.get(DAY);
  s.closures.set(DAY, { number: 999, day: DAY }); bump();
  assert.equal(cockpit(s, q()).cash.z, 'done');
  if (today) s.closures.set(DAY, today); else s.closures.delete(DAY);
  bump();
});

test('equity: one chair taking 10+ new clients’ visits far above his hours is named, in words; never below ten events', async () => {
  const s = S();
  // whatever the demo's own luck says (a chair with fewer walk-ins than hours), none is about new clients
  const base = cockpit(s, q()).equity;
  assert.ok(!base.some((h) => h.kind === 'new' || h.kind === 'idle'), JSON.stringify(base));
  // the first visit of every client of the last 30 days goes to JKut
  const from = addDays(DAY, -29);
  const first = new Map();
  for (const d of dayRange(from, DAY)) for (const id of s.apptsByDay.get(d) || []) {
    const a = s.appts.get(id);
    if (a && a.status === 'done' && a.clientId && !a.legacy && !first.has(a.clientId)) first.set(a.clientId, a);
  }
  const moved = [...first.values()].map((a) => [a, a.staffId]);
  assert.ok(moved.length >= EQUITY_MIN);
  for (const [a] of moved) a.staffId = ids.JKut;
  bump();
  const hints = cockpit(s, q('week')).equity;
  assert.ok(hints.length >= 1 && hints.length <= 3);
  const mine = hints.find((h) => h.staffId === ids.JKut && h.kind === 'new');
  assert.ok(mine, JSON.stringify(hints));
  assert.match(mine.text, /^JKut reçoit \d+\s% des nouveaux clients pour \d+\s% des heures ouvertes\.$/);
  assert.equal(cockpit(s, q('week')).equity.length, hints.length, 'whatever the period shown');
  for (const [a, st] of moved) a.staffId = st;
  bump();
  assert.deepEqual(cockpit(s, q()).equity, base);
  // a chair that stood empty since Monday
  const mondays = [...s.appts.values()].filter((a) => a.staffId === ids.Esteban && a.day >= weekStart(DAY) && a.day <= DAY && a.status !== 'cancelled');
  const kept = mondays.map((a) => [a, a.status]);
  for (const a of mondays) a.status = 'cancelled';
  bump();
  const idle = cockpit(s, q()).equity.find((h) => h.kind === 'idle');
  assert.ok(idle && idle.staffId === ids.Esteban, JSON.stringify(cockpit(s, q()).equity));
  assert.match(idle.text, /^Esteban a \d+\sh( \d+)? libres cette semaine\.$|^Esteban a \d+\sh(\s\d+)? libres cette semaine\.$/);
  for (const [a, st] of kept) a.status = st;
  bump();
  // a quiet salon proves nothing: below ten events there is no hint, and no error on an empty journal
  const t = await salon();
  const e = cockpit(t.engine.state, { range: 'month', day: DAY, today: DAY, now: at(DAY, 10) });
  assert.deepEqual(e.equity, []);
  assert.equal(e.kpis.cashed.value, 0);
  assert.equal(e.kpis.cashed.goal ? e.kpis.cashed.goal.done : 0, 0);
  assert.ok(e.team.length >= 2);
});
