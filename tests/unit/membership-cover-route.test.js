// The till's dry check (PAY-05): GET /api/v1/memberships/:id/cover says, before ringing up, whether a member's plan pays for
// a service today: ok for the first covered cut, `quota` with the French reason after two, `soon` with the next date for
// an Illimité plan; the checkout still decides, and a barber's `force` is refused (403) while the owner's is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browser, testRuntime } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { instantOf, addDays } from '../../shared/dates.js';

const DAY = '2026-11-24'; // a Tuesday, the demo's journal is long behind it
let phones = 0;
const phone = () => '06 00 00 ' + String(40 + ++phones).padStart(2, '0') + ' ' + String(10 + phones).padStart(2, '0');

/** The demo salon, an owner, a barber on a salon device, and a way to join a plan from the site. */
async function setup() {
  const clock = { now: instantOf(DAY, 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await owner.post('/api/auth/device', { name: 'Poste 1' })).status, 200);
  const s = () => rt.engine.state;
  const ids = Object.fromEntries([...s().staff.values()].map((x) => [x.name, x.id]));
  const barber = browser(rt);
  barber.jar.set('lx_d', owner.jar.get('lx_d'));
  assert.equal((await barber.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  const site = browser(rt);
  const plans = (await site.get('/api/public/memberships')).json.plans;
  const svc = (slug) => [...s().services.values()].find((x) => x.slug === slug).id;
  /** a new member of that plan, first month paid on the demo's test page */
  const join = async (planId, first = 'Test') => {
    const res = await site.post('/api/public/memberships', { planId, first, phone: phone(), email: 'cover' + phones + '@exemple.fr', startNow: true, cgv: '2026-10-27' });
    assert.equal(res.status, 201, JSON.stringify(res.json));
    const id = res.json.url.split('/paiement/')[1];
    assert.deepEqual((await site.post('/api/public/payments/' + id + '/simulate', { outcome: 'ok' })).json, { status: 'paid' });
    return s().members.get(id);
  };
  /** one cut at the till, paid by the plan (or priced), as a request would carry it */
  const till = (who, m, serviceId, more = {}) => who.post('/api/v1/sales', { clientId: m.cid, lines: [{ kind: 'service', ref: serviceId, staffId: ids.JKut, memberId: m.id, ...more }], payments: [{ method: 'card', amount: 0 }] }, { 'x-request-id': 'cut-' + Math.random().toString(36).slice(2) });
  const cover = (who, m, serviceId, extra = '') => who.get('/api/v1/memberships/' + m.id + '/cover?serviceId=' + serviceId + extra);
  return { rt, owner, barber, site, plans, svc, join, till, cover, ids, s, clock };
}

test('cover: ok for the first covered cut, quota in French after two, the next cut counted before the ticket is rung up', async () => {
  const t = await setup();
  const cl = t.svc('cl');
  const m = await t.join('essentiel');
  let c = await t.cover(t.owner, m, cl);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.deepEqual([c.json.ok, c.json.why, c.json.used, c.json.of, c.json.words], [true, null, 0, 2, '']);
  assert.match(c.json.label, /^Abonnement · coupe 1\/2 \(\d\d\/\d\d–\d\d\/\d\d\)$/);
  // two covered cuts already on the ticket being rung up: the third is the one that is refused
  const two = await t.cover(t.owner, m, cl, '&pending=2');
  assert.deepEqual([two.json.ok, two.json.why, two.json.words], [false, 'quota', 'Coupe déjà prise ce mois-ci (2/2)']);

  assert.equal((await t.till(t.owner, m, cl)).status, 200);
  c = await t.cover(t.owner, m, cl);
  assert.deepEqual([c.json.ok, c.json.used], [true, 1]);
  assert.match(c.json.label, /^Abonnement · coupe 2\/2 /);
  assert.equal((await t.till(t.owner, m, cl)).status, 200);

  c = await t.cover(t.owner, m, cl);
  assert.deepEqual([c.json.ok, c.json.why, c.json.used, c.json.of, c.json.words, c.json.label], [false, 'quota', 2, 2, 'Coupe déjà prise ce mois-ci (2/2)', '']);
  assert.ok(c.json.next > DAY, 'the next included cut: the day the month renews');
  assert.equal(c.json.force, true, 'the owner may give it anyway');
  // the checkout refuses a third as the dry check said
  const third = await t.till(t.owner, m, cl);
  assert.deepEqual([third.status, third.json.error.code], [409, 'member_quota']);
});

test('cover: a service the plan does not cover, a stranger’s id, an unknown service', async () => {
  const t = await setup();
  const m = await t.join('essentiel');
  const beard = t.svc('tb');
  const c = await t.cover(t.owner, m, beard);
  assert.deepEqual([c.json.ok, c.json.why], [false, 'service']);
  assert.match(c.json.words, /ne couvre pas « Taille de barbe »/);
  assert.equal((await t.cover(t.owner, { id: 'mb_nope' }, beard)).status, 404);
  assert.equal((await t.cover(t.owner, m, 'sv_nope')).status, 404);
});

test('cover: an Illimité plan says soon, with the day of the next included cut', async () => {
  const t = await setup();
  const cl = t.svc('cl');
  const m = await t.join('illimite');
  assert.equal((await t.cover(t.owner, m, cl)).json.ok, true);
  assert.equal((await t.till(t.owner, m, cl)).status, 200);
  const c = await t.cover(t.owner, m, cl);
  assert.deepEqual([c.json.ok, c.json.why, c.json.next], [false, 'soon', addDays(DAY, 7)]);
  assert.match(c.json.words, /^Prochaine coupe incluse le 01\/12$/);
  // a week later it is ok again
  t.clock.now = instantOf(addDays(DAY, 7), 15 * 60);
  assert.equal((await t.owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200, 'a week later the session is renewed');
  const later = await t.cover(t.owner, m, cl);
  assert.equal(later.json.ok, true, JSON.stringify(later.json));
});

test('force: refused to a barber (403) both by the dry check’s flag and by the checkout, recorded for the owner', async () => {
  const t = await setup();
  const cl = t.svc('cl');
  const m = await t.join('essentiel');
  for (let i = 0; i < 2; i++) assert.equal((await t.till(t.owner, m, cl)).status, 200);
  const asked = await t.cover(t.barber, m, cl);
  assert.deepEqual([asked.status, asked.json.ok, asked.json.force], [200, false, false], 'a barber is not offered « L’offrir quand même »');
  const refused = await t.till(t.barber, m, cl, { force: true });
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.equal(t.s().members.get(m.id).uses.length, 2, 'nothing was recorded');
  const given = await t.till(t.owner, m, cl, { force: true });
  assert.equal(given.status, 200, JSON.stringify(given.json));
  const sale = t.s().sales.get(given.json.id);
  assert.match(sale.lines[0].name, /hors forfait/);
  assert.equal(sale.totals.due, 0);
  assert.equal(t.s().members.get(m.id).uses.at(-1).forced, true);
  // an ended contract is never given: the flag is off for the owner too
  assert.equal((await t.owner.post('/api/v1/memberships/' + m.id + '/cancel', { now: true })).status, 200);
  const ended = await t.cover(t.owner, m, cl);
  assert.deepEqual([ended.json.ok, ended.json.why, ended.json.force], [false, 'ended', false]);
});

test('the list of one file, with the next charge and what a cancellation today would give back', async () => {
  const t = await setup();
  const m = await t.join('essentiel', 'Une');
  await t.join('illimite', 'Autre');
  const rows = (await t.owner.get('/api/v1/memberships?clientId=' + m.cid)).json.members;
  assert.deepEqual(rows.map((x) => x.id), [m.id]);
  assert.equal(rows[0].next > DAY, true);
  assert.ok(rows[0].refund > 0 && rows[0].refund < 3400, 'the unused days of the month, pro rata: ' + rows[0].refund);
  // a barber sees the badge and the cuts, not what a cancellation would give back
  const seen = (await t.barber.get('/api/v1/memberships?clientId=' + m.cid)).json.members[0];
  assert.deepEqual([seen.status, seen.refund], ['active', 0]);
  // the amount shown is the amount given back
  const done = await t.owner.post('/api/v1/memberships/' + m.id + '/cancel', { now: true, refund: true });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.refunded.amount, rows[0].refund);
});
