// Absences without surprises (DO-05): the appointments an absence lands on, over any range of days, each with a
// proposal; the owner's plan applied in one batch with the clients told; a barber's own absence waiting for the owner.
// On the demo salon, on the Tuesday afternoon the end-to-end tests use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { freeSlots } from '../../server/domain/availability.js';
import { localParts } from '../../shared/dates.js';
import { salon, rejects, DAY } from '../helpers.js';
import { addTimeOff, approveTimeOff, refuseTimeOff, removeTimeOff, handoverPlan, applyHandover, NEAREST_MAX_MIN } from '../../server/commands/team.js';
import { createAppointment, addBlock } from '../../server/commands/agenda.js';
import { updateSettings } from '../../server/commands/shop.js';

const NOW = Date.parse('2026-10-27T15:10:00+01:00');

async function demo() {
  const rt = await testRuntime({ clock: () => NOW });
  // every write the engine sends to the store, to tell one batch from several
  let appends = 0;
  const append = rt.store.append.bind(rt.store);
  rt.store.append = (...a) => { appends++; return append(...a); };
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const team = (await owner.get('/api/v1/staff')).json.items;
  const id = (name) => team.find((x) => x.name === name).id;
  return { rt, owner, id, appends: () => appends };
}
/** A barber on a salon device, signed in with his PIN. */
async function barber(rt, owner, name) {
  const tab = browser(rt);
  assert.equal((await tab.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  await tab.post('/api/auth/logout');
  const st = (await tab.get('/api/auth/state')).json;
  const me = st.team.find((x) => x.name === name);
  assert.equal((await tab.post('/api/auth/pin', { staffId: me.id, pin: DEMO.pins[name] })).status, 200);
  return tab;
}
const slotsOf = (rt, staffId, day) => freeSlots(rt.engine.state, { day, dur: 30, serviceIds: [], staffId, now: NOW, local: localParts(NOW), online: false, step: 30 }).length;

test('Frank off 30–31 Oct: 20 appointments to replace, the plan applied in one batch with the clients told', async () => {
  const { rt, owner, id, appends } = await demo();
  const frank = id('Frank');
  const range = { staffId: frank, from: '2026-10-30', to: '2026-10-31' };

  // before posting: what the absence would land on, each with a proposal
  const before = (await owner.post('/api/v1/timeoff/preview', range)).json;
  assert.equal(before.count, 20);
  assert.equal(before.rows.length, 20);
  assert.ok(before.rows.every((x) => ['2026-10-30', '2026-10-31'].includes(x.day)));
  for (const x of before.rows) {
    if (x.choice === 'same') assert.ok(x.same.staffId !== frank && x.same.start === x.start && x.same.day === x.day, 'the same time with another barber');
    if (x.choice === 'nearest') assert.ok(x.nearest.day === x.day && x.nearest.start !== x.start, 'another time that day');
  }
  assert.ok(before.rows.some((x) => x.choice === 'same'));
  // no two proposals give the same chair at the same time
  const seat = (x, p) => ({ id: x.id, s: p.staffId, d: p.day, a: p.start, b: p.start + x.dur });
  const taken = before.rows.filter((x) => x.choice !== 'ask').map((x) => seat(x, x[x.choice]));
  const clash = (p, q) => p.id !== q.id && p.s === q.s && p.d === q.d && p.a < q.b && q.a < p.b;
  for (const [i, p] of taken.entries()) for (const q of taken.slice(i + 1)) assert.ok(!clash(p, q), 'proposals overlap');
  for (const x of before.rows) {
    // nor does any alternative take another row's default: switching one row never breaks the plan
    for (const k of ['same', 'nearest']) if (x[k] && k !== x.choice) for (const q of taken) assert.ok(!clash(seat(x, x[k]), q), x.name + ': ' + k + ' overlaps a default');
    if (x.choice === 'nearest') assert.ok(Math.abs(x.nearest.start - x.start) <= NEAREST_MAX_MIN, 'a default never far from the booked time');
    assert.equal(x.online, true, 'three days ahead: the client may still change it himself');
  }
  // the site's note proposes the day he is back: Sunday and Monday the salon is closed
  assert.equal(before.back, '2026-11-03');

  const posted = await owner.post('/api/v1/timeoff', { ...range, reason: 'Congés', publicNote: 'Frank revient le 3 novembre' });
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  assert.equal(posted.json.conflicts, 20);
  const tid = posted.json.id;
  assert.equal(rt.engine.state.timeoff.get(tid).publicNote, 'Frank revient le 3 novembre', 'the note the site may show (WP-06)');
  const plan = (await owner.post('/api/v1/timeoff/preview', { id: tid })).json;
  assert.equal(plan.count, 20, 'the posted absence: the same list');
  assert.equal(slotsOf(rt, frank, '2026-10-30'), 0, 'posted by the owner: his slots are gone at once');

  // the owner keeps two proposals and asks a third client to choose
  const same = plan.rows.filter((x) => x.choice === 'same' && x.textable);
  const [m1, m2] = same;
  const asked = plan.rows.find((x) => x.textable && x.id !== m1.id && x.id !== m2.id);
  const body = { moves: [m1, m2].map((x) => ({ apptId: x.id, staffId: x.same.staffId, start: x.same.start })), ask: [asked.id] };
  const v0 = rt.engine.state.version, n0 = appends();
  const res = await owner.post('/api/v1/timeoff/' + tid + '/reassign', body);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json, { moved: 2, asked: 1, toCall: 0, cancelled: 0, texted: 3, refunded: 0, unrefunded: 0, left: 18 });
  assert.equal(appends() - n0, 1, 'all in one batch');
  const ev = rt.engine.journal.filter((e) => e.v > v0);
  assert.deepEqual(ev.filter((e) => e.type === 'appt.moved').map((e) => e.data.id).sort(), [m1.id, m2.id].sort());
  const sms = ev.filter((e) => e.type === 'message.queued');
  assert.deepEqual(sms.map((e) => e.data.template).sort(), ['reassign', 'reassign', 'reschedule']);
  const s = rt.engine.state;
  for (const x of [m1, m2]) {
    const a = s.appts.get(x.id);
    assert.deepEqual([a.staffId, a.day, a.start], [x.same.staffId, x.day, x.start]);
    const m = [...s.messages.values()].find((y) => y.apptId === x.id && y.template === 'reassign');
    assert.match(m.body, new RegExp('^Frank est absent vendredi 3\\d, ' + s.staff.get(x.same.staffId).name + ' te prend à '));
    assert.match(m.body, /prix inchangé\. Pas d'accord \? https?:\/\/\S+\/r\//);
    assert.equal(m.status, 'queued');
  }
  const rs = [...s.messages.values()].find((y) => y.apptId === asked.id && y.template === 'reschedule');
  assert.match(rs.body, /, on doit décaler ton rendez-vous du (vendredi 30|samedi 31)\. Choisis un nouveau créneau : http/);
  assert.equal(s.appts.get(asked.id).staffId, frank, 'asked: the appointment waits for the client');

  // the list now: two fewer, the asked one marked so
  const after = (await owner.post('/api/v1/timeoff/preview', { id: tid })).json;
  assert.equal(after.count, 18);
  assert.equal(after.rows.find((x) => x.id === asked.id).asked, true);

  // the same request again (a retry after a network drop): nothing written twice
  const v1 = s.version;
  const again = await owner.post('/api/v1/timeoff/' + tid + '/reassign', body);
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.equal(rt.engine.state.version, v1);

  // a plan that no longer holds (the chair m1 was just given) writes nothing at all, not even the text before it
  const r2 = after.rows.find((x) => x.id !== asked.id && x.textable);
  const r1 = after.rows.find((x) => x.id !== asked.id && x.id !== r2.id && x.day === m1.day);
  const no = await owner.post('/api/v1/timeoff/' + tid + '/reassign', { ask: [r2.id], moves: [{ apptId: r1.id, staffId: m1.same.staffId, start: m1.start }] });
  assert.equal(no.status, 409);
  assert.equal(no.json.error.code, 'taken');
  assert.match(no.json.error.message, /n’est plus libre pour/);
  assert.equal(rt.engine.state.version, v1, 'nothing half-applied');
  assert.equal((await owner.post('/api/v1/timeoff/' + tid + '/reassign', { moves: [{ apptId: m1.id, staffId: frank, start: 600 }], ask: [m1.id] })).status, 400, 'one answer per appointment');
  // two rows of the plan on one chair: said as the owner's own clash, before anything runs
  const [c1, c2] = after.rows.filter((x) => x.id !== asked.id && x.day === '2026-10-31' && x.dur === after.rows.find((y) => y.id !== asked.id && y.day === '2026-10-31').dur);
  const esteban = id('Esteban');
  const both = await owner.post('/api/v1/timeoff/' + tid + '/reassign', { moves: [{ apptId: c1.id, staffId: esteban, start: c1.start }, { apptId: c2.id, staffId: esteban, start: c1.start }] });
  assert.equal(both.status, 409);
  assert.equal(both.json.error.code, 'clash');
  assert.match(both.json.error.message, /^Ton plan donne Esteban deux fois à \d+\sh(\s\d+)?, à \S+ et \S+\. Change l’un des deux\.$/);
  assert.equal(both.json.error.extra.apptId, c2.id);
  assert.equal(rt.engine.state.version, v1);

  // the agenda tells the owner what is left, and the feed says it
  const ag = (await owner.get('/api/v1/agenda?day=2026-10-27')).json;
  assert.deepEqual(ag.absences.items.map((x) => [x.id, x.count, x.day]), [[tid, 18, '2026-10-30']]);
  const feed = (await owner.get('/api/v1/feed')).json.items;
  assert.ok(feed.some((f) => f.kind === 'timeoff' && f.title === 'Frank absent du vendredi 30 au samedi 31 · 18 rdv à replacer'), JSON.stringify(feed.slice(0, 3)));

  // a barber neither applies a plan nor reads another's absence
  const tab = await barber(rt, owner, 'JKut');
  assert.equal((await tab.post('/api/v1/timeoff/' + tid + '/reassign', body)).json.error.code, 'forbidden');
  assert.equal((await tab.post('/api/v1/timeoff/' + tid + '/reassign', body)).status, 403);
  assert.equal((await tab.post('/api/v1/timeoff/preview', range)).status, 403);
  assert.equal((await tab.post('/api/v1/timeoff/preview', { id: tid })).status, 404);
});

test('JKut asks for his own absence: nothing closes until the owner approves; a feed item and the plan follow', async () => {
  const { rt, owner, id } = await demo();
  const jkut = id('JKut');
  const day = '2026-10-29';
  const open = slotsOf(rt, jkut, day);
  const tab = await barber(rt, owner, 'JKut');
  const v0 = rt.engine.state.version;

  // he sees what it would land on before asking
  const pv = (await tab.post('/api/v1/timeoff/preview', { staffId: jkut, from: day, to: day })).json;
  assert.ok(pv.count > 0);
  const res = await tab.post('/api/v1/timeoff', { staffId: jkut, from: day, to: day, reason: 'Rendez-vous perso' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.requested, true);
  assert.equal(res.json.conflicts, pv.count);
  const ev = rt.engine.journal.filter((e) => e.v > v0);
  assert.deepEqual(ev.map((e) => e.type), ['timeoff.requested']);
  assert.equal(rt.engine.state.timeoff.size, 0, 'not an absence yet');
  assert.equal(slotsOf(rt, jkut, day), open, 'no change to his availability');
  const mine = (await tab.get('/api/v1/timeoff/mine')).json;
  assert.deepEqual(mine.requests.map((q) => [q.id, q.status, q.conflicts]), [[res.json.id, 'pending', pv.count]]);
  assert.equal(mine.approval, true);
  assert.equal((await tab.post('/api/v1/timeoff/' + res.json.id + '/approve')).status, 403, 'he cannot approve himself');

  // the owner hears of it: a feed item, a badge, the agenda
  const feed = (await owner.get('/api/v1/feed')).json.items;
  const item = feed.find((f) => f.kind === 'timeoff' && f.timeoffId === res.json.id);
  assert.ok(item, 'a feed item exists');
  assert.equal(item.title, 'JKut demande jeudi 29 · ' + pv.count + ' rdv à replacer');
  assert.equal(item.pending, true);
  assert.equal(item.by, 'staff');
  assert.equal((await owner.get('/api/v1/pulse')).json.badges.requests, 1);
  assert.deepEqual((await owner.get('/api/v1/agenda')).json.absences.requests.map((q) => q.id), [res.json.id]);
  assert.deepEqual((await owner.get('/api/v1/staff')).json.requests.map((q) => [q.id, q.conflicts]), [[res.json.id, pv.count]]);

  // approved: the same id becomes the absence, his slots are gone, the plan lists the clients
  const ok = await owner.post('/api/v1/timeoff/' + res.json.id + '/approve');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json, { id: res.json.id, ok: true, conflicts: pv.count });
  const t = rt.engine.state.timeoff.get(res.json.id);
  assert.equal(t.staffId, jkut);
  assert.equal(t.request.by, jkut);
  assert.equal(rt.engine.state.timeoffRequests.size, 0);
  assert.equal(slotsOf(rt, jkut, day), 0, 'slots gone');
  assert.equal((await owner.post('/api/v1/timeoff/preview', { id: res.json.id })).json.count, pv.count);
  assert.equal((await owner.post('/api/v1/timeoff/' + res.json.id + '/approve')).status, 200, 'a second tap changes nothing');
  const after = (await owner.get('/api/v1/feed')).json.items.find((f) => f.timeoffId === res.json.id && f.request);
  assert.equal(after.pending, false);
  assert.match(after.sub, /validée/);
  // and he is told
  const his = (await tab.get('/api/v1/feed')).json.items;
  assert.ok(his.some((f) => f.timeoffId === res.json.id && f.title === 'Absence validée · jeudi 29'), JSON.stringify(his.slice(0, 3)));
  assert.ok(!his.some((f) => f.kind === 'timeoff' && f.staffId !== jkut), 'only his own');

  // a second request, withdrawn before the owner answers: his item says so, the owner's toast has an item to close on
  const q2 = (await tab.post('/api/v1/timeoff', { staffId: jkut, from: '2026-11-12', to: '2026-11-12' })).json;
  assert.equal(q2.requested, true);
  assert.equal((await tab.del('/api/v1/timeoff/' + q2.id)).status, 200);
  const own = (await tab.get('/api/v1/feed')).json.items.find((f) => f.timeoffId === q2.id);
  assert.deepEqual([own.title, own.sub], ['Demande envoyée · jeudi 12', 'Retirée']);
  const ofOwner = (await owner.get('/api/v1/feed')).json.items.filter((f) => f.timeoffId === q2.id);
  assert.deepEqual(ofOwner.map((f) => [f.title, !!f.request, !!f.pending]), [['JKut retire sa demande · jeudi 12', false, false], ['JKut demande jeudi 12', true, false]]);
  assert.match(ofOwner[1].sub, /retirée$/);
  assert.equal((await owner.post('/api/v1/timeoff/' + q2.id + '/approve')).status, 404, 'nothing left to approve');
});

test('a refused request stays visible to the barber until he puts it away; without approval his absence is posted', async () => {
  const t = await salon({ hour: 9 });
  const ali = t.asStaff('Ali');
  const v = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660 }, t.asOwner());
  const q = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: DAY, startMin: 600, endMin: 720 }, ali);
  assert.equal(q.requested, true);
  await rejects(t.engine.run(addTimeOff, { staffId: t.ids.Ben, from: DAY, to: DAY }, ali), 'forbidden');
  await t.engine.run(refuseTimeOff, { id: q.id }, t.asOwner());
  assert.equal(t.engine.state.timeoffRequests.get(q.id).status, 'refused');
  await rejects(t.engine.run(approveTimeOff, { id: q.id }, t.asOwner()), 'decided');
  assert.equal(t.engine.state.timeoff.size, 0);
  await t.engine.run(removeTimeOff, { id: q.id }, ali);
  assert.equal(t.engine.state.timeoffRequests.size, 0, 'put away');

  // the owner switches approval off: his own absence closes his hours at once
  await t.engine.run(updateSettings, { team: { timeoffApproval: false } }, t.asOwner());
  const p = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: DAY, startMin: 600, endMin: 720 }, t.asStaff('Ali'));
  assert.equal(p.requested, undefined);
  const off = t.engine.state.timeoff.get(p.id);
  assert.deepEqual([off.startMin, off.endMin, off.reason], [600, 720, 'Absence']);

  // a few hours off: only the appointment inside them; Ben free, he takes it at the same time
  const o = { now: t.clock.now, local: localParts(t.clock.now) };
  const plan = handoverPlan(t.engine.state, off, o);
  assert.deepEqual(plan.map((x) => [x.a.id, x.choice, x.same && x.same.staffId, x.same && x.same.start]), [[v.id, 'same', t.ids.Ben, 660]]);
  // Ben's day blocked: the nearest time is Ali's own, once his errand is over
  await t.engine.run(addBlock, { staffId: t.ids.Ben, day: DAY, start: 540, end: 1110, label: 'Formation' }, t.asOwner());
  const later = handoverPlan(t.engine.state, off, o);
  assert.deepEqual(later.map((x) => [x.choice, x.same, x.nearest]), [['nearest', null, { staffId: t.ids.Ali, day: DAY, start: 720 }]]);
  // nobody free that day at all: ask the client; at 9 h for 11 h it is too late for him to change online, so the
  // salon calls him: no text with a link that would refuse him
  const all = await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: DAY }, t.asOwner());
  assert.deepEqual(handoverPlan(t.engine.state, off, o).map((x) => [x.choice, x.same, x.nearest, x.online]), [['ask', null, null, false]]);
  const v0 = t.engine.state.version;
  const res = await applyHandover(t.engine, t.engine.state.timeoff.get(all.id), { ask: [v.id] }, t.asOwner());
  assert.deepEqual([res.asked, res.toCall, res.texted], [0, 1, 0]);
  assert.equal(t.engine.state.version, v0, 'nothing sent, nothing written');
});

test('another barber at another time: the text says the old time; a default never strays far from it', async () => {
  const t = await salon({ hour: 9 });
  const v = await t.engine.run(createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: DAY, start: 660 }, t.asOwner());
  const off = t.engine.state.timeoff.get((await t.engine.run(addTimeOff, { staffId: t.ids.Ali, from: DAY, to: DAY }, t.asOwner())).id);
  const o = { now: t.clock.now, local: localParts(t.clock.now) };
  // Ben busy until noon: an hour later with him is the default
  await t.engine.run(addBlock, { staffId: t.ids.Ben, day: DAY, start: 540, end: 720, label: 'Formation' }, t.asOwner());
  assert.deepEqual(handoverPlan(t.engine.state, off, o).map((x) => [x.choice, x.nearest]), [['nearest', { staffId: t.ids.Ben, day: DAY, start: 720 }]]);
  const res = await applyHandover(t.engine, off, { moves: [{ apptId: v.id, staffId: t.ids.Ben, start: 720 }] }, { ...t.asOwner(), meta: { linkFor: (a) => 'https://x/r/' + a.code } });
  assert.deepEqual([res.moved, res.texted], [1, 1]);
  const m = [...t.engine.state.messages.values()].find((x) => x.apptId === v.id && x.template === 'reassignAt');
  assert.match(m.body, /^Ali est absent mardi 3, Ben te prend à 12 h au lieu de 11 h\. Pas d'accord \? https:\/\/x\/r\//);

  // Ben busy until 14 h instead (3 h later): still offered, but the client is not moved that far without being asked
  const t2 = await salon({ hour: 9 });
  await t2.engine.run(createAppointment, { clientId: t2.ids.yanis, serviceIds: [t2.ids.cut], staffId: t2.ids.Ali, day: DAY, start: 660 }, t2.asOwner());
  const off2 = t2.engine.state.timeoff.get((await t2.engine.run(addTimeOff, { staffId: t2.ids.Ali, from: DAY, to: DAY }, t2.asOwner())).id);
  await t2.engine.run(addBlock, { staffId: t2.ids.Ben, day: DAY, start: 540, end: 840, label: 'Formation' }, t2.asOwner());
  assert.deepEqual(handoverPlan(t2.engine.state, off2, o).map((x) => [x.choice, x.nearest]), [['ask', { staffId: t2.ids.Ben, day: DAY, start: 840 }]]);
});
