// The salon's real membership (PAY-07): a plan counts by the week, and what a missed week does is the owner's choice.
//   lost   one cut (perWeek) per calendar week, Monday to Sunday, refused « Coupe de la semaine déjà prise (1/1) · … »
//   month  the month's perWeek × 4 cuts whenever he wants, one a day at most
//   free   no ceiling, one a day at most
// A plan or a member from before (no rhythm) reads exactly as it did. One file puts the plan and its use into words
// (shared/membership-words.js), and the Abonnés board says each member's weeks; a barber reads no money there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRuntime } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { capsOf } from '../../server/domain/permissions.js';
import { instantOf, addDays, localParts } from '../../shared/dates.js';
import { initialize } from '../../server/commands/setup.js';
import { addStaff } from '../../server/commands/team.js';
import { addService } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { checkout } from '../../server/commands/sales.js';
import { startMembership, memberPaid, withdrawMember } from '../../server/commands/memberships.js';
import { cover, coverWords, cutValue, label, weeksOf, withdrawRefund, addMonths } from '../../server/domain/membership.js';
import { memberCovers } from '../../server/domain/policy.js';
import { planWords, missedWords, offerWords, useWords, shortWords, labelWords, bookedWords, derivedCuts } from '../../shared/membership-words.js';
import { browser, testRuntime } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { rejects } from '../helpers.js';

const MON = '2026-11-02', TUE = '2026-11-03', FRI = '2026-11-06', NEXT_MON = '2026-11-09';
const at = (day, h = 10) => instantOf(day, h * 60);
const SYS = { actor: { t: 'system', id: 'memberships' }, caps: new Set(), meta: { siteUrl: 'https://salon.test/' } };
const STRIPE = { actor: { t: 'provider', id: 'stripe' }, caps: new Set(), meta: { siteUrl: 'https://salon.test/' } };
const ROOT = new URL('../..', import.meta.url).pathname;

/** A production salon with one formule per rule (and an old monthly one), a member joins on `day`. */
async function club(day = MON) {
  const clock = { now: at(day) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => clock.now, store: memoryStore() });
  const e = rt.engine;
  const init = await e.run(initialize, { mode: 'production', owner: { name: 'Patron', email: 'patron@test.fr' } }, { actor: { t: 'system', id: 'setup' }, caps: new Set() });
  const owner = () => { const st = e.state.staff.get(init.ownerId); return { actor: { t: 'staff', id: init.ownerId }, staff: st, caps: capsOf(st, e.state.settings), meta: { siteUrl: 'https://salon.test/' } }; };
  const week = { 1: [[540, 1110]], 2: [[540, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]], 0: [[540, 1110]] };
  const ali = (await e.run(addStaff, { name: 'Ali', role: 'barber', schedule: week }, owner())).id;
  const cut = (await e.run(addService, { name: 'Coupe classique', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }, owner())).id;
  const plan = (id, x) => ({ id, name: id, price: 8000, serviceIds: [cut], ...x });
  await e.run(updateSettings, { membership: { enabled: true, plans: [
    plan('lost', { rhythm: 'week' }), plan('deux', { rhythm: 'week', perWeek: 2 }), plan('mois', { rhythm: 'week', missed: 'month' }),
    // the fourth: an old monthly formule (no rhythm), as every plan from before PAY-07
    { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, serviceIds: [cut] }
  ] } }, owner());
  let n = 0;
  const join = async (planId, o = {}) => {
    n++;
    const d = o.day || localParts(clock.now).day;
    const m = await e.run(startMembership, { planId, first: 'Karim', phone: '06 11 22 33 ' + String(10 + n), provider: 'stripe', providerRef: 'cs_' + n, channel: 'online' }, SYS);
    await e.run(memberPaid, { ref: 'cs_' + n, invoice: 'in_' + n, amount: e.state.settings.membership.plans.find((p) => p.id === planId).price, periodStart: d, periodEnd: addMonths(d, 1), chargeRef: 'ch_' + n }, STRIPE);
    return e.state.members.get(m.id);
  };
  /** a covered cut at the till on that day */
  const till = (m, day) => { clock.now = at(day, 11); return e.run(checkout, { clientId: m.cid, lines: [{ kind: 'service', ref: cut, staffId: ali, memberId: m.id }], payments: [{ method: 'card', amount: 0 }] }, owner()); };
  const free = async () => { await e.run(updateSettings, { membership: { plans: [...e.state.settings.membership.plans.filter((p) => p.id !== 'mois'), plan('libre', { rhythm: 'week', missed: 'free' })] } }, owner()); };
  return { e, clock, owner, cut, join, till, free, s: () => e.state };
}

test('lost: one cut a calendar week; Friday after Tuesday refused in French, Monday covered, a week skipped adds nothing', async () => {
  const t = await club(MON);
  const m = await t.join('lost');
  assert.deepEqual([m.rhythm, m.perWeek, m.missed, m.cuts, m.minDays], ['week', 1, 'lost', 0, 1], 'he keeps the rule he signed for');
  const tue = await t.till(m, TUE);
  assert.equal(t.s().sales.get(tue.id).lines[0].name, 'Coupe classique · Abonnement · semaine du 02/11 (1/1)');
  assert.equal(t.s().sales.get(tue.id).lines[0].credit, 1846, 'the commission base: 80 € × 12 / 52');
  const fri = cover(t.s(), t.s().members.get(m.id), t.cut, { day: FRI });
  assert.deepEqual([fri.ok, fri.why, fri.used, fri.of, fri.next], [false, 'week', 1, 1, NEXT_MON]);
  assert.equal(coverWords(fri), 'Coupe de la semaine déjà prise (1/1) · prochaine lundi 09/11');
  await rejects(t.till(m, FRI), 'member_week');
  // the next calendar week, Monday: covered again
  assert.equal(cover(t.s(), t.s().members.get(m.id), t.cut, { day: NEXT_MON }).ok, true);
  // a week with no visit (16–22/11) does not add a cut to the next one
  await t.till(m, NEXT_MON);
  const after = cover(t.s(), t.s().members.get(m.id), t.cut, { day: '2026-11-23' });
  assert.equal(after.ok, true);
  await t.till(m, '2026-11-23');
  assert.equal(cover(t.s(), t.s().members.get(m.id), t.cut, { day: '2026-11-24' }).why, 'week', 'one only, whatever week was missed');
  // his weeks of the month: 02/11 came, 09/11 came, 16/11 missed, 23/11 came, 30/11 to come
  const weeks = weeksOf(t.s(), t.s().members.get(m.id), '2026-11-24');
  assert.deepEqual(weeks.map((w) => [w.start, w.came, w.future]), [['2026-11-02', true, false], ['2026-11-09', true, false], ['2026-11-16', false, false], ['2026-11-23', true, false], ['2026-11-30', false, true]]);
});

test('lost with two a week: two in a week, never two the same day', async () => {
  const t = await club(MON);
  const m = await t.join('deux');
  await t.till(m, TUE);
  const same = cover(t.s(), t.s().members.get(m.id), t.cut, { day: TUE });
  assert.deepEqual([same.ok, same.why], [false, 'soon'], 'one a day at most');
  assert.equal(cover(t.s(), t.s().members.get(m.id), t.cut, { day: FRI }).ok, true);
  await t.till(m, FRI);
  const third = cover(t.s(), t.s().members.get(m.id), t.cut, { day: '2026-11-07' });
  assert.deepEqual([third.why, third.used, third.of], ['week', 2, 2]);
  assert.equal(coverWords(third), 'Coupes de la semaine déjà prises (2/2) · prochaine lundi 09/11');
  assert.equal(cutValue(t.s().members.get(m.id)), 923, 'two a week: half the weekly share');
});

test('month: the 4 cuts of the month whenever he wants, a 5th refused, two the same day refused', async () => {
  const t = await club(MON);
  const m = await t.join('mois');
  assert.deepEqual([m.cuts, m.minDays], [4, 1]);
  // four in the first week: no calendar week rule
  for (const d of [MON, TUE, '2026-11-04', '2026-11-05']) await t.till(m, d);
  const fifth = cover(t.s(), t.s().members.get(m.id), t.cut, { day: '2026-11-20' });
  assert.deepEqual([fifth.ok, fifth.why, fifth.used, fifth.of], [false, 'quota', 4, 4]);
  const t2 = await club(MON);
  const k = await t2.join('mois');
  await t2.till(k, TUE);
  assert.equal(cover(t2.s(), t2.s().members.get(k.id), t2.cut, { day: TUE }).why, 'soon');
  assert.equal(label(t2.s().members.get(k.id), 2, { start: MON, end: '2026-12-02', week: { start: MON } }), 'Abonnement · coupe 2/4 (02/11–01/12)');
});

test('free: no ceiling, one a day', async () => {
  const t = await club(MON);
  await t.free();
  const m = await t.join('libre');
  assert.deepEqual([m.missed, m.cuts, m.minDays], ['free', 0, 1]);
  for (let i = 0; i < 6; i++) await t.till(m, addDays(MON, i));
  assert.equal(cover(t.s(), t.s().members.get(m.id), t.cut, { day: addDays(MON, 6) }).ok, true, 'a seventh day running');
  await t.till(m, addDays(MON, 6));
  assert.equal(cover(t.s(), t.s().members.get(m.id), t.cut, { day: addDays(MON, 6) }).why, 'soon');
});

test('a plan from before (no rhythm) reads as it did: the member record keeps its shape, quota and value', async () => {
  const t = await club(MON);
  const m = await t.join('essentiel');
  assert.ok(!('rhythm' in m) && !('perWeek' in m) && !('missed' in m), 'no new key on a monthly member (replay-diff digests stay)');
  assert.ok(!('rhythm' in t.s().settings.membership.plans.find((p) => p.id === 'essentiel')));
  await t.till(m, TUE); await t.till(m, FRI);
  const third = cover(t.s(), t.s().members.get(m.id), t.cut, { day: '2026-11-07' });
  assert.deepEqual([third.why, third.used, third.of, 'week' in third], ['quota', 2, 2, false]);
  assert.equal(coverWords(third), 'Coupe déjà prise ce mois-ci (2/2)');
  assert.equal(cutValue(m), 1700);
  assert.equal(label(m, 1, { start: MON, end: '2026-12-02' }), 'Abonnement · coupe 1/2 (02/11–01/12)');
});

test('a booking to come in the same week counts as taken (lost); the withdrawal counts the cuts at their weekly value', async () => {
  const t = await club(MON);
  const m = await t.join('lost');
  const sv = [{ id: t.cut }];
  const open = memberCovers(t.s(), m, sv, FRI, []);
  assert.deepEqual([open.ok, open.used, open.of, open.week && open.week.start], [true, 1, 1, MON]);
  assert.equal(bookedWords(m, open), 'semaine du 02/11');
  // Tuesday already booked: Friday's booking would be the week's second
  assert.equal(memberCovers(t.s(), m, sv, FRI, [{ day: TUE, services: sv }]).ok, false);
  // the next week is free again
  assert.equal(memberCovers(t.s(), m, sv, NEXT_MON, [{ day: TUE, services: sv }]).ok, true);
  await t.till(m, TUE);
  assert.equal(withdrawRefund(t.s().members.get(m.id), TUE), 8000 - 1846);
  t.clock.now = at(TUE, 15);
  const w = await t.e.run(withdrawMember, { id: m.id }, { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { memberId: m.id } });
  assert.equal(w.refund, 6154);
});

test('settings: a weekly plan stores its derived cuts and gap; 4 a week and an unknown rule are refused in French', async () => {
  const t = await club(MON);
  const plans = t.s().settings.membership.plans;
  assert.deepEqual(plans.map((p) => [p.id, p.rhythm, p.perWeek, p.missed, p.cuts, p.minDays]), [
    ['lost', 'week', 1, 'lost', 0, 1], ['deux', 'week', 2, 'lost', 0, 1], ['mois', 'week', 1, 'month', 4, 1], ['essentiel', undefined, undefined, undefined, 2, 0]
  ]);
  const base = { id: 'x1', name: 'Hebdo', price: 8000, serviceIds: [t.cut], rhythm: 'week' };
  const e1 = await rejects(t.e.run(updateSettings, { membership: { plans: [{ ...base, perWeek: 4 }] } }, t.owner()), 'invalid');
  assert.equal(e1.message, 'membership.plans[0].perWeek : entre 1 et 3');
  const e2 = await rejects(t.e.run(updateSettings, { membership: { plans: [{ ...base, missed: 'x' }] } }, t.owner()), 'invalid');
  assert.equal(e2.message, 'membership.plans[0].missed : valeur non permise');
  const e3 = await rejects(t.e.run(updateSettings, { membership: { plans: [{ ...base, rhythm: 'jour' }] } }, t.owner()), 'invalid');
  assert.equal(e3.message, 'membership.plans[0].rhythm : valeur non permise');
  // a monthly plan still says its cuts; a weekly one's typed cuts give way to the rule's
  const e4 = await rejects(t.e.run(updateSettings, { membership: { plans: [{ id: 'x2', name: 'Mensuel', price: 3000, serviceIds: [t.cut] }] } }, t.owner()), 'invalid');
  assert.equal(e4.message, 'membership.plans[0].cuts : obligatoire');
  await t.e.run(updateSettings, { membership: { plans: [{ ...base, missed: 'month', perWeek: 2, cuts: 1, minDays: 9 }] } }, t.owner());
  const p = t.s().settings.membership.plans[0];
  assert.deepEqual([p.cuts, p.minDays], [8, 1]);
  assert.deepEqual(derivedCuts({ rhythm: 'week', perWeek: 3, missed: 'free' }), { cuts: 0, minDays: 1 });
  // 3 a week caught up in the month stores 12 cuts: the plan as stored saves again unchanged
  await t.e.run(updateSettings, { membership: { plans: [{ ...base, missed: 'month', perWeek: 3 }] } }, t.owner());
  const stored = structuredClone(t.s().settings.membership.plans);
  assert.equal(stored[0].cuts, 12);
  await t.e.run(updateSettings, { membership: { plans: stored } }, t.owner());
  assert.deepEqual(t.s().settings.membership.plans, stored);
  // « Abonnement Abonnement »: the server refuses the name as the screen does
  const e5 = await rejects(t.e.run(updateSettings, { membership: { plans: [{ ...base, name: 'Abonnement' }] } }, t.owner()), 'invalid');
  assert.match(e5.message, /^membership\.plans\[0\]\.name : /);
});

test('the words, for every rhythm, from one file', () => {
  const lost = { rhythm: 'week', perWeek: 1, missed: 'lost', cuts: 0, minDays: 1 };
  const two = { ...lost, perWeek: 2 };
  const month = { rhythm: 'week', perWeek: 1, missed: 'month', cuts: 4, minDays: 1 };
  const free = { rhythm: 'week', perWeek: 1, missed: 'free', cuts: 0, minDays: 1 };
  const essentiel = { cuts: 2, minDays: 0 }, illimite = { cuts: 0, minDays: 7 };
  assert.deepEqual([lost, two, month, free, essentiel, illimite].map((p) => planWords(p)), ['1 coupe par semaine', '2 coupes par semaine', '4 coupes par mois', 'coupes illimitées, une par jour au plus', '2 coupes par mois', '1 coupe tous les 7 jours']);
  assert.equal(planWords(illimite, { detail: true }), 'coupes illimitées, une tous les 7 jours au plus');
  assert.deepEqual([lost, month, free, essentiel].map(missedWords), ['Semaine manquée : perdue', 'Semaine manquée : rattrapable dans le mois', 'Semaine manquée : pas de limite', '']);
  assert.equal(offerWords({ ...lost, price: 8000 }), '80 €/mois · 1 coupe par semaine · semaine manquée : perdue');
  assert.equal(offerWords({ ...month, price: 8000 }), '80 €/mois · 4 coupes par mois · semaine manquée : rattrapable dans le mois');
  assert.equal(useWords(lost, { used: 1, of: 0, week: { used: 1 } }), 'Cette semaine : prise');
  assert.equal(useWords(lost, { used: 0, of: 0, week: { used: 0 } }), 'Cette semaine : à prendre');
  assert.equal(useWords(two, { used: 1, of: 0, week: { used: 1 } }), 'Cette semaine : 1/2');
  assert.equal(useWords(month, { used: 2, of: 4, week: { used: 0 } }), 'Cette semaine : à prendre · 2/4 ce mois-ci');
  assert.equal(useWords(essentiel, { used: 1, of: 2 }), '1/2 ce mois-ci');
  assert.equal(useWords(illimite, { used: 3, of: 0 }), '3 (illimité) ce mois-ci');
  assert.deepEqual([shortWords(lost, { used: 0, of: 0, week: { used: 1 } }), shortWords(lost, { used: 0, of: 0, week: null }), shortWords(essentiel, { used: 1, of: 2 })], ['semaine prise', 'semaine à prendre', '1/2 ce mois']);
  const period = { start: '2026-11-02', end: '2026-12-02', week: { start: '2026-11-02' } };
  assert.equal(labelWords(lost, 1, period), 'Abonnement · semaine du 02/11 (1/1)');
  assert.equal(labelWords(free, 1, period), 'Abonnement · semaine du 02/11');
  assert.equal(labelWords(month, 3, period), 'Abonnement · coupe 3/4 (02/11–01/12)');
  assert.equal(labelWords(essentiel, 2, period), 'Abonnement · coupe 2/2 (02/11–01/12)');
  assert.equal(labelWords(illimite, 1, period), 'Abonnement illimité (02/11–01/12)');
  assert.deepEqual([bookedWords(essentiel, { used: 1, of: 2 }), bookedWords(illimite, { used: 1, of: 0 }), bookedWords(month, { used: 2, of: 4 })], ['1/2 ce mois', 'illimité', '2/4 ce mois']);
});

test('no file but shared/membership-words.js puts « coupe(s) par mois / par semaine » into words', () => {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = ['server', 'shared', 'web/src', 'public'].flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(js|ts|tsx|html)$/.test(f));
  // built from a count (' coupes' + ' par mois', n + ' coupe par semaine'): a placeholder, a hint or a guide step may say it
  const BUILT = /['"`]\s*coupes?['"`]\s*\)?\s*\+\s*['"`]\s*par (mois|semaine)|\+\s*['"`]\s*coupes? par (mois|semaine)|coupes?['"`]\s*\)\s*\+\s*['"`] par (mois|semaine)/;
  const bad = [];
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (rel === 'shared/membership-words.js') continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (BUILT.test(line)) bad.push(rel + ':' + (i + 1) + '  ' + line.trim().slice(0, 120)); });
  }
  assert.deepEqual(bad, [], 'the plan in words comes from shared/membership-words.js:\n' + bad.join('\n'));
  // the check itself catches what the old code did
  for (const s of ["m.cuts + (m.cuts > 1 ? ' coupes' : ' coupe') + ' par mois'", "n + ' coupe par semaine'"]) assert.ok(BUILT.test(s), s);
});

test('the Abonnés board: this week, the weeks of the month and the last visit; a barber reads no money', async () => {
  const now = instantOf('2026-10-27', 15 * 60 + 10);
  const rt = await testRuntime({ clock: () => now });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await owner.post('/api/auth/device', { name: 'Poste 1' })).status, 200);
  const full = (await owner.get('/api/v1/memberships')).json;
  const live = full.members.filter((m) => ['active', 'grace', 'ending'].includes(m.status));
  assert.equal(live.length, 14);
  for (const m of live) {
    assert.equal(m.rhythm, 'week');
    assert.deepEqual([m.week.start, m.week.end, m.week.of], ['2026-10-26', '2026-11-01', 1]);
    assert.equal(m.week.came, m.week.used > 0);
    assert.ok(m.weeks.length >= 1 && m.weeks.every((w) => typeof w.came === 'boolean' && typeof w.future === 'boolean'));
    assert.ok(m.lastVisit === null || m.lastVisit <= '2026-10-27');
    assert.equal(typeof m.price, 'number');
  }
  assert.equal(live.filter((m) => !m.week.came).length, 3, 'three have not come this week');
  assert.ok(full.mrr > 0);
  const sum = (await owner.get('/api/v1/memberships/summary')).json;
  assert.equal(sum.weeks.notYet, 3);
  assert.ok(sum.weeks.rate > 0 && sum.weeks.missed >= 1);
  // a barber on the salon's device: the weeks, never the money nor a payment in trouble
  const ids = Object.fromEntries([...rt.engine.state.staff.values()].map((x) => [x.name, x.id]));
  const barber = browser(rt);
  barber.jar.set('lx_d', owner.jar.get('lx_d'));
  assert.equal((await barber.post('/api/auth/pin', { staffId: ids.JKut, pin: DEMO.pins.JKut })).status, 200);
  const his = (await barber.get('/api/v1/memberships')).json;
  assert.equal(his.mrr, null);
  for (const m of his.members) {
    assert.deepEqual([m.price, m.next, m.refund, m.card, m.pastDueSince], [null, null, 0, '', null]);
    assert.notEqual(m.status, 'grace');
  }
  assert.ok(his.members.some((m) => m.week && m.weeks.length), 'he reads the weeks');
  assert.equal((await barber.get('/api/v1/memberships/summary')).status, 403);
});

test('« Écrire » to a weekly member not come this week: the week since his last visit gives way, consent and once a day stay', async () => {
  const now = instantOf('2026-10-27', 15 * 60 + 10);
  const rt = await testRuntime({ clock: () => now });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await owner.post('/api/auth/device', { name: 'Poste 1' })).status, 200);
  const live = (await owner.get('/api/v1/memberships')).json.members.filter((m) => ['active', 'grace', 'ending'].includes(m.status));
  const cards = new Map((await owner.get('/api/v1/clients?segment=abonnes&limit=200')).json.items.map((c) => [c.id, c]));
  const recent = (c) => c && c.sms && c.hasPhone && c.sinceLast != null && c.sinceLast < 7;
  const idle = live.filter((m) => !m.week.came).map((m) => cards.get(m.clientId)).find((c) => recent(c) && !c.marketing);
  assert.ok(idle, 'the demo has a member not come this week who came within a week (no to the offers)');
  const send = (cid, member) => owner.post('/api/v1/relances/send', { clientIds: [cid], ...(member ? { member: true } : {}) });
  assert.deepEqual([(await send(idle.id, true)).json.sent], [0], 'no consent, no text');
  assert.equal((await owner.patch('/api/v1/clients/' + idle.id, { marketing: true })).status, 200);
  assert.deepEqual([(await send(idle.id)).json.sent], [0], 'the plain relance still waits a week');
  assert.deepEqual([(await send(idle.id, true)).json.sent], [1]);
  const msg = [...rt.engine.state.messages.values()].find((m) => m.cid === idle.id && m.template === 'rebook');
  assert.ok(msg && msg.marketing && /on te garde ta place cette semaine/.test(msg.text || msg.body || JSON.stringify(msg)), 'an offer in the nudge\'s words: STOP mention and quiet hours');
  assert.deepEqual([(await send(idle.id, true)).json.sent], [0], 'once a day');
  // one who came this week gets nothing from the flag
  const came = live.filter((m) => m.week.came).map((m) => cards.get(m.clientId)).find((c) => recent(c) && c.marketing);
  if (came) assert.deepEqual([(await send(came.id, true)).json.sent], [0]);
  // the cards say the consent, so « Écrire » shows only where it can leave
  assert.ok([...cards.values()].every((c) => typeof c.marketing === 'boolean'));
});
