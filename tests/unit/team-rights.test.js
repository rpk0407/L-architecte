// TEAM-01: each person sees what is theirs. report.shop is the owner's and the managers' only (a barber sees colleagues
// through report.team at most, and never their commission, rates or tips), the month goal and the exports stay theirs,
// a deposit reaches the chair it is for, the desk tablet sees the salon's counts without money, nobody raises his own pay
// or rank, and what a manager changes in a colleague's pay or access is told to the owner (team.changed).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { salon, at, rejects } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { capsOf } from '../../server/domain/permissions.js';
import { teamViewOf } from '../../server/settings/team.js';
import { updateSettings } from '../../server/commands/shop.js';
import { updateStaff, setCredentials } from '../../server/commands/team.js';
import { changeWords } from '../../server/projections/governance.js';
import { tick } from '../../server/commands/system.js';
import { emptyState, evolve } from '../../server/core/state.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 10, 0) };
let rt, ids;
before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
});

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
/** someone on the salon tablet, by PIN */
async function onTablet(name, pin = DEMO.pins[name]) {
  const b = await owner();
  assert.equal((await b.post('/api/auth/device', { name: 'Tablette comptoir' })).status, 200);
  await b.post('/api/auth/logout');
  const r = await b.post('/api/auth/pin', { staffId: ids[name], pin });
  assert.equal(r.status, 200, r.text);
  return b;
}
async function setTeam(team) {
  const r = await (await owner()).patch('/api/v1/settings', { team });
  assert.equal(r.status, 200, r.text);
}
let manager = null;
/** a manager, added by the owner with a PIN (the demo has none) */
async function asManager() {
  if (!manager) {
    const r = await (await owner()).post('/api/v1/staff', { name: 'Nadia', role: 'manager', pin: '4826' });
    assert.equal(r.status, 200, r.text);
    ids.Nadia = r.json.id;
    manager = true;
  }
  return onTablet('Nadia', '4826');
}
const changes = () => rt.engine.journal.filter((e) => e.type === 'team.changed');
const NB = '\u00a0'; // the feed keeps « % » and « : » on the line of their figure

test('capabilities: report.shop never reaches a barber; report.team and client.rebook follow the switches', async () => {
  const t = await salon();
  const caps = (name) => capsOf(t.engine.state.staff.get(t.ids[name]), t.engine.state.settings);
  assert.equal(teamViewOf(t.engine.state.settings), 'salon', 'the default: the salon’s progress');
  assert.ok(!caps('Ali').has('report.shop') && !caps('Ali').has('report.team') && !caps('Ali').has('client.rebook'));
  await t.engine.run(updateSettings, { team: { teamView: 'named', barberRebook: true } }, t.asOwner());
  assert.ok(caps('Ali').has('report.team') && !caps('Ali').has('report.shop'));
  assert.ok(caps('Ali').has('client.rebook'));
  await t.engine.run(updateSettings, { team: { teamView: 'off', barberRebook: false } }, t.asOwner());
  assert.ok(!caps('Ali').has('report.team') && !caps('Ali').has('client.rebook'));

  // an old journal: the old switch on, never a teamView written → read as 'named', no report.shop
  const old = await salon();
  await old.engine.run(updateSettings, { team: { barberSeeRevenue: true } }, old.asOwner());
  const s = emptyState();
  for (const e of old.engine.journal) evolve(s, e);
  assert.equal(teamViewOf(s.settings), 'named');
  const ali = capsOf(s.staff.get(old.ids.Ali), s.settings);
  assert.ok(ali.has('report.team') && !ali.has('report.shop'));
  // choosing a view from the new screen retires the old switch, so the choice holds
  await old.engine.run(updateSettings, { team: { teamView: 'salon' } }, old.asOwner());
  assert.equal(old.engine.state.settings.team.barberSeeRevenue, false);
  assert.equal(teamViewOf(old.engine.state.settings), 'salon');

  // the roles: owner and manager have both report caps through ALL, the desk only client.rebook
  const { addStaff } = await import('../../server/commands/team.js');
  const m = await t.engine.run(addStaff, { name: 'Mona', role: 'manager' }, t.asOwner());
  const d = await t.engine.run(addStaff, { name: 'Dina', role: 'desk' }, t.asOwner());
  const mc = capsOf(t.engine.state.staff.get(m.id), t.engine.state.settings), dc = capsOf(t.engine.state.staff.get(d.id), t.engine.state.settings);
  assert.ok(mc.has('report.shop') && mc.has('report.team') && mc.has('client.rebook'));
  assert.ok(dc.has('client.rebook') && !dc.has('report.shop') && !dc.has('report.team'));
});

test('a barber: no export, no tickets on a client file, whatever the team settings', async () => {
  const jkut = await onTablet('JKut');
  const someClient = [...rt.engine.state.clients.values()].find((c) => !c.erased && [...rt.engine.state.sales.values()].some((x) => x.clientId === c.id));
  for (const team of [{ teamView: 'off' }, { teamView: 'salon' }, { teamView: 'named', barberRebook: true }, { barberSeeRevenue: true }]) {
    await setTeam(team);
    const me = (await jkut.get('/api/auth/state')).json.me;
    assert.ok(!me.caps.includes('report.shop'), JSON.stringify(team));
    for (const kind of ['sales', 'vat', 'commissions', 'clients', 'journal']) {
      const r = await jkut.get('/api/v1/export?kind=' + kind + '&from=2026-10-01&to=2026-10-31');
      assert.equal(r.status, 403, kind + ' under ' + JSON.stringify(team));
    }
    const file = await jkut.get('/api/v1/clients/' + someClient.id);
    assert.equal(file.status, 200);
    assert.deepEqual(file.json.sales, [], 'no ticket list on a client file');
  }
  await setTeam({ teamView: 'salon' });
  // the owner still has all of it
  const b = await owner();
  assert.equal((await b.get('/api/v1/export?kind=sales&from=2026-10-01&to=2026-10-31')).status, 200);
  assert.ok((await b.get('/api/v1/clients/' + someClient.id)).json.sales.length > 0);
});

test('bootstrap: the month goal for the owner and managers only; closing warnings for whoever closes', async () => {
  const jkut = await onTablet('JKut');
  assert.deepEqual((await jkut.get('/api/v1/bootstrap')).json.settings.goals, {});
  const goal = rt.engine.state.settings.goals.monthCents;
  assert.equal((await (await owner()).get('/api/v1/bootstrap')).json.settings.goals.monthCents, goal);
  const mgr = await asManager();
  assert.equal((await mgr.get('/api/v1/bootstrap')).json.settings.goals.monthCents, goal);

  // a drawer left open overnight: tomorrow morning the manager who may close the day hears about it, a barber does not
  const clock2 = { now: at(DAY, 18, 40) };
  const rt2 = await testRuntime({ clock: () => clock2.now });
  const o = browser(rt2);
  await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  const add = await o.post('/api/v1/staff', { name: 'Nadia', role: 'manager', pin: '4826' });
  assert.equal(add.status, 200, add.text);
  assert.ok(rt2.engine.state.drawer, 'the demo opened today’s drawer');
  clock2.now = at('2026-11-04', 0, 6);
  await rt2.engine.run(tick, {}, { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() });
  assert.equal(rt2.engine.state.closures.has(DAY), false, 'the demo drawer is still open');
  // signed in again the next morning
  assert.equal((await o.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const ob = await o.get('/api/v1/bootstrap');
  assert.equal(ob.status, 200, ob.text);
  const ownerWarn = ob.json.warnings;
  assert.ok(ownerWarn.some((w) => /n’est pas comptée/.test(w)), JSON.stringify(ownerWarn));
  await o.post('/api/auth/device', { name: 'Tablette' });
  await o.post('/api/auth/logout');
  assert.equal((await o.post('/api/auth/pin', { staffId: add.json.id, pin: '4826' })).status, 200);
  const mgrBoot = (await o.get('/api/v1/bootstrap')).json;
  assert.ok(mgrBoot.warnings.some((w) => /n’est pas comptée/.test(w)), 'the manager is told before he closes');
  await o.post('/api/auth/logout');
  const jk = [...rt2.engine.state.staff.values()].find((x) => x.name === 'JKut');
  assert.equal((await o.post('/api/auth/pin', { staffId: jk.id, pin: DEMO.pins.JKut })).status, 200);
  assert.deepEqual((await o.get('/api/v1/bootstrap')).json.warnings, []);
});

test('feed: a deposit reaches the chair it is for and the till, and every booking line names its chair', async () => {
  const site = browser(rt);
  const salonInfo = (await site.get('/api/public/salon')).json;
  const deco = salonInfo.services.find((s) => s.slug === 'de');
  const av = await site.get(`/api/public/availability?services=${deco.id}&staff=${ids.Frank}&from=${DAY}&days=10`);
  const day = av.json.days.find((d) => d.slots.length);
  const book = await site.post('/api/public/bookings', { serviceIds: [deco.id], staffId: ids.Frank, day: day.day, start: day.slots[0].m, first: 'Sacha', phone: '0677889911' });
  assert.equal(book.status, 201, book.text);
  assert.ok(book.json.deposit > 0);
  const since = rt.engine.state.version;
  const pid = book.json.payment.url.split('/').pop();
  await site.post('/api/public/payments/' + pid + '/simulate', { outcome: 'paid' });
  const deposit = (b) => b.get('/api/v1/pulse?since=' + since).then((r) => r.json.feed.find((f) => f.kind === 'payment' && f.paymentId === pid));
  const frank = await onTablet('Frank');
  const seen = await deposit(frank);
  assert.ok(seen, 'Frank sees the deposit on his own client');
  assert.equal(seen.staffId, ids.Frank);
  assert.equal(await deposit(await onTablet('JKut')), undefined, 'JKut does not see a colleague’s money');
  assert.ok(await deposit(await owner()), 'the owner sees it');

  const items = (await (await owner()).get('/api/v1/feed')).json.items;
  const bookings = items.filter((f) => ['booking', 'walkin', 'cancel', 'move', 'arrived', 'noshow'].includes(f.kind) && f.apptId);
  assert.ok(bookings.length > 0);
  for (const f of bookings) assert.equal(f.staffId, rt.engine.state.appts.get(f.apptId).staffId, f.title);
  for (const f of items.filter((x) => x.kind === 'sale')) assert.ok('staffId' in f);
});

test('the desk tablet: the whole salon’s counts and fill, never money', async () => {
  const ines = await onTablet('Inès');
  const ag = await ines.get('/api/v1/agenda?day=' + DAY);
  assert.equal(ag.status, 200, ag.text);
  const k = ag.json.kpis;
  assert.equal(k.scope, 'desk');
  const all = [...rt.engine.state.apptsByDay.get(DAY)].map((id) => rt.engine.state.appts.get(id)).filter((a) => a.status !== 'cancelled');
  assert.equal(k.total, all.length, 'every chair’s appointments');
  assert.ok(new Set(all.map((a) => a.staffId)).size > 1);
  assert.equal(k.revenue, null);
  assert.equal(k.tips, null);
  assert.equal(k.planned, null);
  assert.ok(k.fill > 0);
  const owners = (await (await owner()).get('/api/v1/agenda?day=' + DAY)).json.kpis;
  assert.equal(owners.scope, 'shop');
  assert.equal(owners.total, k.total);
  assert.equal(owners.fill, k.fill);
  // nor in the week view
  const wk = await ines.get('/api/v1/week?day=' + DAY);
  assert.ok(wk.json.days.every((d) => d.kpis.revenue === null));
});

test('a barber’s own figures: the salon in % and the team without commissions, as the owner chose', async () => {
  const jkut = await onTablet('JKut');
  await setTeam({ teamView: 'salon' });
  let r = (await jkut.get('/api/v1/reports')).json;
  assert.equal(r.scope, 'own');
  assert.equal(typeof r.salon.goalPct, 'number');
  assert.ok(r.salon.fill >= 0 && r.salon.fill <= 1);
  assert.equal(r.team, undefined);
  assert.equal(r.goal, null, 'no euros of the goal');

  await setTeam({ teamView: 'named' });
  r = (await jkut.get('/api/v1/reports?from=2026-10-01&to=2026-10-31')).json;
  assert.equal(typeof r.salon.goalPct, 'number');
  assert.equal(r.team.length, 4, 'the four chairs');
  for (const row of r.team) {
    for (const k of ['commission', 'rates', 'tips', 'serviceRevenue', 'productRevenue']) assert.ok(!(k in row), k);
    for (const k of ['id', 'name', 'color', 'revenue', 'done', 'occupancy', 'rebookRate', 'noShows', 'avgTicket']) assert.ok(k in row, k);
  }
  assert.ok(r.team.some((x) => x.id === ids.Frank && x.revenue > 0));

  await setTeam({ teamView: 'off' });
  r = (await jkut.get('/api/v1/reports')).json;
  assert.ok(!('salon' in r) && !('team' in r));
  await setTeam({ teamView: 'salon' });
  // the owner's report keeps its shape (no own-scope additions)
  const o = (await (await owner()).get('/api/v1/reports')).json;
  assert.ok(!('salon' in o) && !('team' in o) && o.goal);
});

test('governance: nobody raises his own commission or role; a manager’s change to a colleague is told to the owner', async () => {
  const mgr = await asManager();
  const self = await mgr.patch('/api/v1/staff/' + ids.Nadia, { commission: { service: 5000, product: 5000 } });
  assert.equal(self.status, 403);
  assert.equal(self.json.error.code, 'self_commission');
  assert.equal(self.json.error.message, 'Ta commission se règle avec le gérant.');
  assert.equal((await mgr.patch('/api/v1/staff/' + ids.Nadia, { role: 'barber' })).json.error.code, 'self_role');
  assert.equal(rt.engine.state.staff.get(ids.Nadia).commission.service, 4000);

  const before = changes().length;
  const was = rt.engine.state.staff.get(ids.JKut).commission;
  const body = { commission: { service: 4500, product: was.product } };
  const rid = 'team-01-0000-4000-8000-000000000001';
  const ok = await mgr.patch('/api/v1/staff/' + ids.JKut, body, { 'x-request-id': rid });
  assert.equal(ok.status, 200, ok.text);
  const mine = changes().slice(before);
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].data, { staffId: ids.JKut, field: 'commission', from: { service: 4000, product: was.product }, to: { service: 4500, product: was.product }, by: ids.Nadia });
  assert.equal(mine[0].pii, undefined, 'ids and rates only');
  assert.equal(rt.engine.state.teamChanges.at(-1).field, 'commission');

  // the same request again: nothing more
  const n = rt.engine.journal.length;
  assert.equal((await mgr.patch('/api/v1/staff/' + ids.JKut, body, { 'x-request-id': rid })).status, 200);
  assert.equal(rt.engine.journal.length, n);
  assert.equal(changes().length, before + 1);

  const line = 'Nadia a changé la commission de JKut' + NB + ': 40 → 45' + NB + '%';
  const ownerFeed = (await (await owner()).get('/api/v1/feed')).json.items;
  const item = ownerFeed.find((f) => f.title === line);
  assert.ok(item, 'the owner is told');
  assert.equal(item.staffId, null);
  assert.ok(!(await (await onTablet('JKut')).get('/api/v1/feed')).json.items.some((f) => f.kind === 'team'), 'JKut is not');
  assert.ok(!(await mgr.get('/api/v1/feed')).json.items.some((f) => f.kind === 'team' && f.title === line), 'nor Nadia: her own change is no news to her');
  // the activity journal names it in words
  const audit = (await (await owner()).get('/api/v1/audit?type=team')).json.items;
  assert.deepEqual([audit[0].label, audit[0].summary], ['Rémunération ou accès modifié', line]);

  // a PIN set by the manager is told too; the owner's own changes are not news
  assert.equal((await mgr.post('/api/v1/staff/' + ids.Esteban + '/pin', { pin: '9752' })).status, 200);
  assert.deepEqual(changes().at(-1).data, { staffId: ids.Esteban, field: 'access', from: null, to: 'pin', by: ids.Nadia });
  assert.ok((await (await owner()).get('/api/v1/feed')).json.items.some((f) => f.title === 'Nadia a défini le code d’Esteban'));
  const c = changes().length;
  const b = await owner();
  assert.equal((await b.patch('/api/v1/staff/' + ids.JKut, { commission: { service: 4000, product: was.product } })).status, 200);
  assert.equal((await b.post('/api/v1/staff/' + ids.Esteban + '/pin', { pin: DEMO.pins.Esteban })).status, 200);
  assert.equal(changes().length, c, 'the owner’s own changes emit nothing');
  // a role changed by the manager
  assert.equal((await mgr.patch('/api/v1/staff/' + ids['Inès'], { role: 'barber' })).status, 200);
  assert.deepEqual(changes().at(-1).data, { staffId: ids['Inès'], field: 'role', from: 'desk', to: 'barber', by: ids.Nadia });
  assert.ok((await (await owner()).get('/api/v1/feed')).json.items.some((f) => f.title === 'Nadia a changé le rôle d’Inès' + NB + ': accueil → barbier'));
  assert.equal((await b.patch('/api/v1/staff/' + ids['Inès'], { role: 'desk' })).status, 200);
});

test('governance in the commands: a barber cannot touch pay; the projection keeps the last 100; replay gives the same', async () => {
  const t = await salon();
  await rejects(t.engine.run(updateStaff, { id: t.ids.Ali, patch: { commission: { service: 9000, product: 1000 } } }, t.asStaff('Ali')), 'forbidden');
  const { addStaff } = await import('../../server/commands/team.js');
  const { capsOf: caps } = await import('../../server/domain/permissions.js');
  const m = await t.engine.run(addStaff, { name: 'Mona', role: 'manager' }, t.asOwner());
  const mona = () => { const st = t.engine.state.staff.get(m.id); return { actor: { t: 'staff', id: st.id }, staff: st, caps: caps(st, t.engine.state.settings) }; };
  // the same value is no change: neither refused nor told
  await t.engine.run(updateStaff, { id: m.id, patch: { commission: { service: 4000, product: 1000 }, bio: 'Responsable' } }, mona());
  for (let i = 0; i < 102; i++) await t.engine.run(updateStaff, { id: t.ids.Ben, patch: { commission: { service: 3000 + (i % 2) * 100, product: 1000 } } }, mona());
  assert.equal(t.engine.state.teamChanges.length, 100);
  assert.equal(t.engine.journal.filter((e) => e.type === 'team.changed').length, 102);
  const s = emptyState();
  for (const e of t.engine.journal) evolve(s, e);
  assert.deepEqual(s.teamChanges, t.engine.state.teamChanges);
});

test('a legacy « Toute l’équipe » survives an unrelated save from Réglages (the screen sends the view it shows)', async () => {
  const t = await salon();
  await t.engine.run(updateSettings, { team: { barberSeeRevenue: true } }, t.asOwner());
  const section = t.engine.state.settings.team;
  assert.equal(section.teamView, 'salon', 'the default is merged in: the raw section would read as « Le salon »');
  assert.equal(teamViewOf(t.engine.state.settings), 'named');
  // Equipe.tsx: { ...T, teamView: view, barberSeeRevenue: false } with view = what the Seg shows
  await t.engine.run(updateSettings, { team: { ...section, barberCheckout: false, teamView: teamViewOf(t.engine.state.settings), barberSeeRevenue: false } }, t.asOwner());
  assert.equal(teamViewOf(t.engine.state.settings), 'named');
  assert.equal(t.engine.state.settings.team.barberCheckout, false);
  assert.ok(capsOf(t.engine.state.staff.get(t.ids.Ali), t.engine.state.settings).has('report.team'));
});

test('a sealed day: its Z number for everyone, its figures only for whoever closes or reads the salon’s money', async () => {
  const day = [...rt.engine.state.closures.keys()].sort().at(-1);
  assert.ok(day, 'the demo has closed days');
  const z = (b) => b.get('/api/v1/agenda?day=' + day).then((r) => { assert.equal(r.status, 200, r.text); return r.json; });
  for (const name of ['JKut', 'Inès']) {
    const a = await z(await onTablet(name));
    assert.equal(a.closed, true);
    assert.deepEqual(Object.keys(a.closure).sort(), ['auto', 'number'], name);
    assert.ok(!('net' in a.closure) && !('tips' in a.closure) && !('grandTotal' in a.closure), name);
  }
  const o = await z(await owner());
  assert.equal(typeof o.closure.net, 'number');
  assert.equal(typeof (await z(await asManager())).closure.net, 'number');
});

test('desk scope is the desk tablet’s: someone with no chair who cannot see every chair stays in his own scope', async () => {
  const b = await owner();
  const jk = rt.engine.state.staff.get(ids.JKut);
  const was = { chair: jk.chair, bookable: jk.bookable };
  await setTeam({ barberAllAgenda: false });
  assert.equal((await b.patch('/api/v1/staff/' + ids.JKut, { chair: false, bookable: false })).status, 200);
  const k = (await (await onTablet('JKut')).get('/api/v1/agenda?day=' + DAY)).json.kpis;
  assert.equal(k.scope, 'own');
  const day = [...rt.engine.state.apptsByDay.get(DAY)].map((id) => rt.engine.state.appts.get(id)).filter((a) => a.status !== 'cancelled');
  assert.equal(k.total, day.filter((a) => a.staffId === ids.JKut).length, 'his own, not the salon’s counts');
  assert.ok(k.total < day.length);
  assert.equal((await b.patch('/api/v1/staff/' + ids.JKut, was)).status, 200);
  await setTeam({ barberAllAgenda: true });
  assert.equal((await (await onTablet('Inès')).get('/api/v1/agenda?day=' + DAY)).json.kpis.scope, 'desk');
});

test('governance: a newcomer a manager adds is told; a removed code reads as removed; both rates are named', async () => {
  const mgr = await asManager();
  const n = changes().length;
  const add = await mgr.post('/api/v1/staff', { name: 'Zoé', role: 'manager', pin: '9182' });
  assert.equal(add.status, 200, add.text);
  const told = changes().slice(n).map((e) => e.data);
  assert.deepEqual(told[0], { staffId: add.json.id, field: 'role', from: null, to: 'manager', by: ids.Nadia });
  assert.ok(told.some((d) => d.field === 'access' && d.to === 'pin'));
  assert.ok(!told.some((d) => d.field === 'commission'), 'the salon’s default rate is no news');
  const feed = (await (await owner()).get('/api/v1/feed')).json.items.map((f) => f.title);
  assert.ok(feed.includes('Nadia a ajouté Zoé comme responsable'), JSON.stringify(feed.slice(0, 4)));
  // with a rate of her choosing
  const add2 = await mgr.post('/api/v1/staff', { name: 'Yanis', role: 'barber', pin: '9183', commission: { service: 6000, product: 2000 } });
  assert.equal(add2.status, 200, add2.text);
  assert.ok(changes().some((e) => e.data.staffId === add2.json.id && e.data.field === 'commission' && e.data.from === null && e.data.to.service === 6000));

  const t = await salon();
  const { addStaff } = await import('../../server/commands/team.js');
  const m = await t.engine.run(addStaff, { name: 'Mona', role: 'manager' }, t.asOwner());
  const st = t.engine.state.staff.get(m.id);
  const mona = { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, t.engine.state.settings) };
  await t.engine.run(setCredentials, { id: t.ids.Ali, pinHash: '' }, mona);
  const last = t.engine.journal.at(-1).data;
  assert.deepEqual([last.field, last.from, last.to], ['access', 'pin', null]);
  assert.equal(changeWords(t.engine.state, last), 'Mona a retiré le code d’Ali');
  const words = (from, to) => changeWords(t.engine.state, { field: 'commission', staffId: t.ids.Ben, by: m.id, from, to });
  assert.equal(words({ service: 4000, product: 1000 }, { service: 4500, product: 5000 }), 'Mona a changé la commission de Ben' + NB + ': prestations 40 → 45' + NB + '%, produits 10 → 50' + NB + '%');
  assert.equal(words({ service: 4000, product: 1000 }, { service: 4000, product: 1500 }), 'Mona a changé la commission produits de Ben' + NB + ': 10 → 15' + NB + '%');
});

test('an absence told to the team holders names nobody in staffId: the barber is its subject (aboutStaffId)', async () => {
  const jkut = await onTablet('JKut');
  const q = await jkut.post('/api/v1/timeoff', { staffId: ids.JKut, from: '2026-11-20', to: '2026-11-20' });
  assert.equal(q.status, 200, q.text);
  const ofOwner = (await (await owner()).get('/api/v1/feed')).json.items.find((f) => f.timeoffId === q.json.id);
  assert.equal(ofOwner.staffId, null);
  assert.equal(ofOwner.aboutStaffId, ids.JKut);
  const his = (await jkut.get('/api/v1/feed')).json.items.find((f) => f.timeoffId === q.json.id);
  assert.equal(his.staffId, ids.JKut);
  assert.equal((await jkut.del('/api/v1/timeoff/' + q.json.id)).status, 200);
});
