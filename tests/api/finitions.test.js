// Loose ends of the five batches: the Agenda's day figures date a credit note as Pilotage and Rapports do; a public
// booking retried with the same request id (the answer was lost on the way) is one appointment and one answer, with or
// without a deposit; an online gift card's checkout page lapses on the salon's clock; an incident told to the owner
// shows in the Comptoir's bootstrap and pulse, with words for its message in Relances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { addDays, localParts } from '../../shared/dates.js';
import { ticketTotals } from '../../shared/money.js';
import { CAPS } from '../../server/domain/permissions.js';
import { DEMO } from '../../server/domain/seed.js';
import { cockpit } from '../../server/domain/cockpit.js';
import { alertKey, ALERT_TEMPLATE } from '../../server/commands/steps/alerts.js';
import * as S from '../../server/commands/sales.js';

const DAY = '2026-11-03'; // a Tuesday
const SYS = { actor: { t: 'system', id: 'test' }, caps: new Set(Object.keys(CAPS)) };
const raw = { run(s, input, ctx) { for (const [type, data] of input.events) ctx.emit(type, data); return { ok: true }; } };
const rid = (n) => 'f1n1t10n-0000-4000-8000-' + String(n).padStart(12, '0');

async function demo(now = at(DAY, 10)) {
  const clock = { now };
  const rt = await testRuntime({ clock: () => clock.now });
  const owner = browser(rt);
  /** signs in (again: a session does not outlive the night) */
  const login = async () => { const r = await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
  await login();
  return { rt, clock, owner, login, s: () => rt.engine.state };
}
/** A ticket written as the till would, on the clock's day. */
async function sale(t, cents) {
  const s = t.s(), sv = [...s.services.values()][0], st = [...s.staff.values()].find((x) => x.chair);
  const lines = [{ kind: 'service', ref: sv.id, name: sv.name, qty: 1, unit: cents, discount: 0, staffId: st.id, vat: 2000 }];
  const { nets, ...totals } = ticketTotals(lines, 0, 0);
  const id = 'sa_fin' + (s.saleSeq + 1);
  await t.rt.engine.run(raw, { events: [['sale.completed', { id, number: s.saleSeq + 1, day: localParts(t.clock.now).day, cashierId: null, apptId: null, clientId: null, lines: lines.map((l, i) => ({ ...l, net: nets[i] })), discount: null, tip: null, totals, payments: [{ method: 'card', amount: cents }], note: '' }]] }, SYS);
  return id;
}
/** The first free slot of a service from tomorrow on. */
async function freeSlot(site, svcId, from, skip = 0) {
  const av = (await site.get(`/api/public/availability?services=${svcId}&from=${from}&days=10&fresh=1`)).json;
  const all = av.days.flatMap((d) => d.slots.map((x) => ({ day: d.day, start: x.m })));
  assert.ok(all.length > skip, 'a free slot');
  return all[skip];
}

test('Agenda and Pilotage agree on a day: a credit note comes off the day it is made, not the day of its ticket', async () => {
  const t = await demo();
  const agenda = async (day) => (await t.owner.get('/api/v1/agenda?day=' + day)).json.kpis.revenue;
  const pilot = (day) => cockpit(t.s(), { range: 'day', day, today: localParts(t.clock.now).day, now: t.clock.now }).kpis.cashed.value;
  const rapport = async (day) => (await t.owner.get(`/api/v1/reports?from=${day}&to=${day}`)).json.revenue;
  const before = await agenda(DAY);
  const id = await sale(t, 2200);
  assert.equal(await agenda(DAY), before + 2200);
  // the next day: another ticket, and the first one given back
  const NEXT = addDays(DAY, 1);
  t.clock.now = at(NEXT, 11);
  await t.login();
  const base = await agenda(NEXT);
  await sale(t, 5000);
  const boss = [...t.s().staff.values()].find((x) => x.role === 'owner');
  await t.rt.engine.run(S.refund, { saleId: id, amount: 2200, method: 'card', reason: 'Geste commercial' }, { actor: { t: 'staff', id: boss.id }, staff: boss, caps: new Set(Object.keys(CAPS)) });
  assert.equal(await agenda(DAY), before + 2200, 'the ticket’s day keeps its takings (before: 22 € less, 700 against 722 €)');
  assert.equal(await agenda(NEXT), base + 5000 - 2200, 'the credit note is the next day’s');
  for (const d of [DAY, NEXT]) {
    assert.equal(await agenda(d), await rapport(d), 'Agenda = Rapports on ' + d);
    assert.equal(await agenda(d), pilot(d), 'Agenda = Pilotage on ' + d);
  }
});

test('a public booking sent twice with the same request id: one appointment, the same answer', async () => {
  const t = await demo();
  const site = browser(t.rt);
  const info = (await site.get('/api/public/salon')).json;
  const sv = info.services.slice().sort((a, b) => a.price - b.price).find((x) => !x.deposit) || info.services[0];
  const slot = await freeSlot(site, sv.id, addDays(DAY, 1));
  const body = { serviceIds: [sv.id], staffId: 'any', ...slot, first: 'Nadir', phone: '0612345601' };
  const count = () => [...t.s().appts.values()].filter((a) => a.day === slot.day && a.start === slot.start && a.status !== 'cancelled').length;
  const n0 = count();
  const r1 = await site.post('/api/public/bookings', body, { 'x-request-id': rid(1) });
  assert.equal(r1.status, 201, JSON.stringify(r1.json));
  const len = t.rt.engine.journal.length, msgs = t.s().messages.size;
  // (the scheduler's own work rides on the visitors' traffic: only what the visitor's request writes is counted)
  const written = () => t.rt.engine.journal.slice(len).filter((e) => e.actor.id !== 'scheduler').map((e) => e.type);
  // the answer never reached the phone: the page sends the same attempt again
  const r2 = await site.post('/api/public/bookings', body, { 'x-request-id': rid(1) });
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  assert.deepEqual(r2.json, r1.json, 'the same answer: code, link, status');
  assert.deepEqual(written(), [], 'nothing written twice');
  assert.equal(t.s().messages.size, msgs, 'no second confirmation');
  assert.equal(count(), n0 + 1, 'one appointment');
  // without the id (or with a new one) the retry is a new request: the slot is his own, already taken
  const other = await site.post('/api/public/bookings', { ...body, staffId: r1.json.staffId }, { 'x-request-id': rid(2) });
  assert.deepEqual([other.status, other.json.error.code], [409, 'taken']);
  assert.equal((await site.post('/api/public/bookings', body, { 'x-request-id': 'bad id' })).status, 400, 'an id that is not one is refused');
  // a hold too: the same attempt gives the same hold
  const free = await freeSlot(site, sv.id, addDays(DAY, 1), 1);
  const h1 = await site.post('/api/public/holds', { serviceIds: [sv.id], staffId: 'any', ...free }, { 'x-request-id': rid(3) });
  const h2 = await site.post('/api/public/holds', { serviceIds: [sv.id], staffId: 'any', ...free }, { 'x-request-id': rid(3) });
  assert.equal(h1.status, 200, JSON.stringify(h1.json));
  assert.deepEqual(h2.json, h1.json);
  // a booking and a hold never share a key, even with the same id
  const h3 = await site.post('/api/public/holds', { serviceIds: [sv.id], staffId: 'any', ...(await freeSlot(site, sv.id, addDays(DAY, 1), 3)) }, { 'x-request-id': rid(1) });
  assert.ok(h3.json.holdId && h3.json.holdId !== h1.json.holdId, JSON.stringify(h3.json));
});

test('a booking with a deposit retried with the same id: the same appointment and the same page to pay on', async () => {
  const t = await demo();
  const site = browser(t.rt);
  const info = (await site.get('/api/public/salon')).json;
  const sv = info.services.slice().sort((a, b) => b.price - a.price)[0];
  let body = null, r1 = null;
  for (let i = 0; i < 6 && !(r1 && r1.status === 201); i++) {
    body = { serviceIds: [sv.id], staffId: 'any', ...(await freeSlot(site, sv.id, addDays(DAY, 1), i)), first: 'Démo', phone: '0612121212' };
    r1 = await site.post('/api/public/bookings', body, { 'x-request-id': rid(10 + i) });
    if (r1.status === 201) body.rid = rid(10 + i);
  }
  assert.ok(r1.status === 201 && r1.json.payment, 'a booking with a deposit: ' + JSON.stringify(r1.json));
  const { rid: id, ...again } = body;
  const pays = () => [...t.s().payments.values()].filter((p) => p.kind === 'deposit').length;
  const n = pays(), len = t.rt.engine.journal.length;
  const r2 = await site.post('/api/public/bookings', again, { 'x-request-id': id });
  assert.equal(r2.status, 201, JSON.stringify(r2.json));
  assert.deepEqual(r2.json, r1.json, 'the same code and the same checkout page');
  assert.equal(pays(), n, 'no second deposit page');
  assert.deepEqual(t.rt.engine.journal.slice(len).filter((e) => e.actor.id !== 'scheduler').map((e) => e.type), []);
});

test('an online gift card’s checkout page lapses on the salon’s clock, whatever the real date', async () => {
  for (const shift of [-14, 14]) {
    const t = await demo(Date.now() + shift * 86400000);
    const site = browser(t.rt);
    const o = await site.post('/api/public/giftcards', { amount: 3000, buyer: { first: 'Sofiane', phone: '06 11 22 33 44', email: 'sofiane@exemple.fr' }, delivery: 'buyer' });
    assert.equal(o.status, 201, JSON.stringify(o.json));
    const life = (t.s().payments.get(o.json.id).exp - t.clock.now) / 60000;
    assert.ok(life > 1 && life < 24 * 60, 'the page lives from the salon’s now (' + shift + ' days from the real date): ' + life.toFixed(1) + ' min');
  }
});

test('an incident told to the owner today is a line of the Comptoir, for him only, and has words in the message list', async () => {
  const t = await demo();
  assert.deepEqual((await t.owner.get('/api/v1/bootstrap')).json.alerts, []);
  await t.rt.engine.run(raw, { events: [['message.queued', { id: 'msg_' + alertKey('backup', DAY), channel: 'email', to: 'gerant@salon.test', template: ALERT_TEMPLATE, subject: 'Sauvegarde', body: 'La dernière sauvegarde a plus de 36 h.', at: t.clock.now, dueAt: t.clock.now }]] }, SYS);
  assert.ok(t.s().messages.has('msg_' + alertKey('backup', DAY)), 'the alert’s message is there');
  const boot = (await t.owner.get('/api/v1/bootstrap')).json;
  assert.equal(boot.alerts.length, 1);
  assert.match(boot.alerts[0], /sauvegarde a plus de 36 h/);
  assert.ok(boot.warnings.includes(boot.alerts[0]));
  assert.deepEqual((await t.owner.get('/api/v1/pulse')).json.alerts, boot.alerts);
  // a barber's Comptoir says nothing of it
  const tab = browser(t.rt);
  await tab.post('/api/auth/login', { email: DEMO.email, password: DEMO.password });
  assert.equal((await tab.post('/api/auth/device', { name: 'Tablette' })).status, 200);
  await tab.post('/api/auth/logout');
  const frank = [...t.s().staff.values()].find((x) => x.name === 'Frank');
  assert.equal((await tab.post('/api/auth/pin', { staffId: frank.id, pin: DEMO.pins.Frank })).status, 200);
  const his = (await tab.get('/api/v1/bootstrap')).json;
  assert.deepEqual([his.alerts, his.warnings.filter((w) => /sauvegarde/.test(w))], [[], []]);
  assert.equal((await tab.get('/api/v1/pulse')).json.alerts, undefined);
  // the message list (Relances › Messages envoyés, the client's data export) has words for the two new templates
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../web/src/comptoir/pages/Relances.tsx', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../server/http/routes-staff.js', import.meta.url), 'utf8'));
  for (const k of [ALERT_TEMPLATE, 'compta_pack']) assert.equal(src.split(k + ': \'').length, 3, k + ' is named in both lists');
  // the next day the line is gone
  t.clock.now = at(addDays(DAY, 1), 9);
  await t.login();
  assert.deepEqual((await t.owner.get('/api/v1/bootstrap')).json.alerts, []);
  assert.deepEqual((await t.owner.get('/api/v1/pulse')).json.alerts, []);
});
