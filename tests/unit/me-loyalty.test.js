// FID-03 · The client's own loyalty card (GET /api/me/loyalty, POST /api/me/loyalty/off), the sentences the Comptoir and
// /moi share (shared/loyalty.js), and the launch line of Réglages › Fidélité (GET /api/v1/loyalty/launch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at, DAY, rejects } from '../helpers.js';
import { browser, testRuntime } from '../api/client.js';
import { addDays } from '../../shared/dates.js';
import { ruleWords, termsText, headlineWords, lapseWords, dayWords } from '../../shared/loyalty.js';
import * as S from '../../server/commands/sales.js';
import { addClient, mergeClients } from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { giftReward, launchLoyalty, importLoyalty, setLoyaltyOff } from '../../server/commands/loyalty.js';
import { createRuntime } from '../../server/http/runtime.js';
import { otpCode } from '../../server/domain/otp.js';
import { cardOf, launchView, launchPlan, simulate, saleLoyalty } from '../../server/domain/loyalty.js';
import { checkLink } from '../../server/auth/session.js';
import { DEMO } from '../../server/domain/seed.js';
import { ACCOUNT_TIMING, settled } from '../../server/http/routes-me.js';

Object.assign(ACCOUNT_TIMING, { minMs: 0, jitterMs: 0, verifyMs: 0 });
let numbers = 0;
/** the words with plain spaces (fmtEur puts a no-break space before €) */
const sp = (x) => String(x).replace(/ /g, ' ');

/** A production salon with the client space and the stamp card on (9 visits, the default 10th cut offered up to 25 €). */
async function setup(loyalty = { enabled: true, goal: 9, referral: { enabled: true } }) {
  const t = await salon();
  await t.engine.run(updateSettings, { accounts: { enabled: true }, loyalty }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const file = async (first = 'Yanis') => {
    const digits = '06' + String(30000000 + ++numbers * 7919).slice(-8);
    return (await t.engine.run(addClient, { first, last: 'Martin', phone: digits }, t.asOwner())).id;
  };
  /** a paid visit (20 €, a walk-in) on that day, which earns a stamp */
  const visit = async (cid, day) => {
    t.clock.now = at(day, 10, 40);
    await t.engine.run(S.checkout, { clientId: cid, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  };
  const visits = async (cid, n, from = -60) => { for (let i = 0; i < n; i++) await visit(cid, addDays(DAY, from + i * 3)); t.clock.now = at(DAY, 11); };
  const signIn = async (cid) => {
    const b = browser(rt);
    await rt.engine.sync(true);
    const c = rt.engine.state.clients.get(cid);
    await b.post('/api/public/account/start', { phone: c.phone });
    await settled();
    const m = [...rt.engine.state.messages.values()].filter((x) => x.template === 'otp' && x.cid === cid).at(-1);
    const r = await b.post('/api/public/account/verify', { phone: c.phone, code: otpCode(rt.secret, m.id), first: c.first });
    assert.equal(r.status, 200, r.text);
    return b;
  };
  return { t, rt, file, visit, visits, signIn };
}

test('a client with 6 of 9 reads his card, the rule, the headline, the règlement and his referral link', async () => {
  const { t, rt, file, visits, signIn } = await setup();
  const y = await file();
  await visits(y, 6);
  const b = await signIn(y);
  await rt.engine.sync(true);
  const res = await b.get('/api/me/loyalty');
  assert.equal(res.status, 200, res.text);
  const l = res.json;
  assert.equal(l.enabled, true);
  assert.equal(l.off, false);
  assert.deepEqual(l.card, { units: 6, goal: 9, model: 'stamps' });
  assert.equal(l.rule, '9 passages = la 10e prestation offerte');
  assert.equal(l.headline, 'Encore 3 passages avant ta prestation offerte');
  assert.deepEqual(l.rewards, []);
  assert.equal(l.birthdayMissing, false);
  assert.ok(Array.isArray(l.terms) && l.terms.length >= 8);
  assert.ok(l.terms.every((x) => typeof x === 'string' && x.length > 20));
  assert.ok(l.terms.some((x) => /Tu peux demander à ne pas participer/.test(x)), 'the opt-out the règlement promises');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // the referral link is the one the site opens: a signed token for his file, and the welcome offer in words
  assert.equal(sp(l.referral.offer), '5 € offerts sur ta première visite');
  assert.equal(l.referral.count, 0);
  const token = new URL(l.referral.link).searchParams.get('parrain');
  assert.ok(token, l.referral.link);
  assert.equal(checkLink(rt.secret, 'ref', token), y);
  assert.ok(l.referral.link.startsWith('https://salon.test/?parrain='), l.referral.link);
  const site = await browser(rt).get('/api/public/parrain/' + encodeURIComponent(token));
  assert.equal(site.status, 200, 'the link the card hands out opens the site\'s offer');
  assert.equal(site.json.first, 'Yanis');
  assert.equal(sp(site.json.line), 'Yanis t’offre 5 € sur ta première visite', 'a sentence ready for the site’s ?parrain= block');
  assert.equal(sp(l.referral.gift), '5 € offerts');
  assert.equal(t.clock.now, at(DAY, 11));
});

test('a file merged into his brings its stamps: both files count', async () => {
  const { t, rt, file, visits, signIn } = await setup();
  const y = await file();
  const other = await file('Yanis2');
  await visits(y, 4, -80);
  await visits(other, 2, -40);
  await t.engine.run(mergeClients, { from: other, into: y }, t.asOwner());
  const b = await signIn(y);
  await rt.engine.sync(true);
  assert.equal((await b.get('/api/me/loyalty')).json.card.units, 6);
});

test('a waiting reward is listed with its end date and the headline says so; two come with « et 1 autre »', async () => {
  const { t, rt, file, visits, signIn } = await setup();
  const y = await file();
  await visits(y, 2);
  await t.engine.run(giftReward, { clientId: y, reward: { kind: 'service', refs: [], cap: 2500 }, days: 30 }, t.asOwner());
  const b = await signIn(y);
  await rt.engine.sync(true);
  let l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.rewards.length, 1);
  assert.equal(l.rewards[0].expires, addDays(DAY, 30));
  assert.equal(sp(l.rewards[0].label), 'Une prestation offerte (jusqu’à 25 €)');
  assert.equal(l.headline, 'Ta prestation offerte t’attend jusqu’au ' + dayWords(addDays(DAY, 30)));
  await t.engine.run(giftReward, { clientId: y, reward: { kind: 'amount', amount: 500 }, days: 60 }, t.asOwner());
  await rt.engine.sync(true);
  l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.rewards.length, 2);
  assert.match(l.headline, /· et 1 autre$/);
});

test('the programme off answers { enabled: false }; signed out is a 401', async () => {
  const { t, rt, file, visits, signIn } = await setup();
  const y = await file();
  await visits(y, 3);
  const b = await signIn(y);
  assert.equal((await browser(rt).get('/api/me/loyalty')).status, 401);
  assert.equal((await browser(rt).post('/api/me/loyalty/off', { off: true })).status, 401);
  await t.engine.run(updateSettings, { loyalty: { enabled: false } }, t.asOwner());
  await rt.engine.sync(true);
  const res = await b.get('/api/me/loyalty');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { enabled: false });
});

test('« Participer à la carte fidélité »: off stops the stamps and the referral, on gives them back, only on his own file', async () => {
  const { t, rt, file, visit, visits, signIn } = await setup();
  const y = await file();
  const z = await file('Zacharie');
  await visits(y, 2);
  const b = await signIn(y);
  const bad = await b.post('/api/me/loyalty/off', { off: 'oui' });
  assert.equal(bad.status, 400);
  // the file named in the body is ignored: the session's is the one that changes
  const off = await b.post('/api/me/loyalty/off', { off: true, clientId: z, cid: z });
  assert.equal(off.status, 200, off.text);
  assert.deepEqual(off.json, { ok: true, off: true });
  await rt.engine.sync(true);
  const s = rt.engine.state;
  assert.equal(s.clients.get(y).loyaltyOff, true);
  assert.ok(!s.clients.get(z).loyaltyOff, 'another client is untouched');
  const upd = rt.engine.journal.filter((e) => e.type === 'client.updated').at(-1);
  assert.deepEqual(upd.data, { id: y, cid: y, patch: { loyaltyOff: true }, fields: [] });
  assert.deepEqual(upd.actor, { t: 'client', id: 'moi', n: '' }, 'the chained actor is never a name');
  let l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.off, true);
  assert.equal(l.referral, null, 'no referral link for someone who does not take part');
  assert.equal(l.card.units, 2, 'the stamps he had stay readable');
  // a visit while off earns nothing
  await t.engine.run(S.checkout, { clientId: y, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
  await rt.engine.sync(true);
  assert.equal(cardOf(rt.engine.state, y, DAY).units, 2);
  // the same switch twice writes nothing the second time; on again
  const n = rt.engine.journal.length;
  assert.equal((await b.post('/api/me/loyalty/off', { off: true })).status, 200);
  assert.equal(rt.engine.journal.length, n);
  assert.equal((await b.post('/api/me/loyalty/off', { off: false })).status, 200);
  await rt.engine.sync(true);
  l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.off, false);
  assert.ok(l.referral);
  await visit(y, addDays(DAY, 1));
  assert.equal(cardOf(t.engine.state, y, addDays(DAY, 1)).units, 3);
});

test('the sentences: the rule, the headline, the règlement from the salon’s own settings', () => {
  const cfg = { goal: 9, minNet: 1000, reward: { kind: 'service', refs: [], cap: 2500 }, rewardDays: 180, resetDays: 365, referral: { enabled: false, referrer: { kind: 'amount', amount: 500 }, referee: { kind: 'amount', amount: 500 }, perYear: 5 } };
  assert.equal(ruleWords(cfg), '9 passages = la 10e prestation offerte');
  assert.equal(sp(ruleWords({ ...cfg, goal: 5, reward: { kind: 'amount', amount: 800 } })), '5 passages = 8 € offerts au 6e passage');
  assert.equal(ruleWords({ ...cfg, reward: { kind: 'service', refs: ['b'] } }, () => 'Barbe'), '9 passages = la 10e prestation offerte : Barbe');
  assert.equal(ruleWords({ ...cfg, reward: { kind: 'service', refs: ['a', 'b'] } }), '9 passages = la 10e prestation offerte');
  assert.equal(lapseWords(180), '6 mois');
  assert.equal(lapseWords(365), '12 mois');
  assert.equal(lapseWords(90), '3 mois');
  assert.equal(lapseWords(45), '45 jours');
  assert.equal(lapseWords(730), '24 mois');
  assert.equal(lapseWords(1095), '36 mois');
  assert.equal(dayWords('2027-03-01'), '1er mars');
  assert.equal(dayWords('2026-05-12'), '12 mai');
  assert.equal(headlineWords({ units: 8, goal: 9, rewards: [] }, cfg), 'Encore 1 passage avant ta prestation offerte');
  assert.equal(sp(headlineWords({ units: 0, goal: 9, rewards: [{ reward: { kind: 'amount', amount: 500 }, expires: '2026-12-05' }] }, cfg)), 'Tes 5 € offerts t’attendent jusqu’au 5 décembre');
  const terms = termsText(cfg).map(sp);
  assert.ok(terms.some((x) => /au moins 10 € de prestations/.test(x) && /un seul par jour/.test(x) && /carnet/.test(x) && /abonnement/.test(x)), 'what earns');
  assert.ok(terms.some((x) => /Sa durée : une récompense se garde 6 mois/.test(x)));
  assert.ok(terms.some((x) => /repart de zéro après 12 mois/.test(x)));
  assert.ok(terms.some((x) => /aucune valeur en argent/.test(x) && /ne se donnent pas/.test(x)), 'no cash value, not transferable');
  assert.ok(terms.some((x) => /ticket est remboursé, son tampon est repris/.test(x)));
  assert.ok(terms.some((x) => /30 jours/.test(x) && /déjà gagnées restent valables/.test(x)));
  assert.ok(!terms.some((x) => /Parrainage/.test(x)), 'no referral paragraph while it is off');
  const withRef = termsText({ ...cfg, referral: { ...cfg.referral, enabled: true } }).map(sp).find((x) => /^Parrainage/.test(x));
  assert.match(withRef, /ton ami reçoit 5 € offerts sur sa première visite, et toi 5 € offerts/);
  assert.match(withRef, /5 parrainages par an au plus/);
  assert.ok(!termsText({ ...cfg, resetDays: 0 }).some((x) => /repart de zéro/.test(x)), 'never resets: nothing to say');
});

test('the launch line: what launching gave on the demo, closed to anyone without a session', async () => {
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  assert.equal((await browser(rt).get('/api/v1/loyalty/launch')).status, 401);
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const done = await owner.get('/api/v1/loyalty/launch');
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.plan, null);
  assert.equal(done.json.launched.headStart, 'half');
  assert.equal(done.json.launched.day, rt.engine.state.loyalty.launched.day);
  assert.ok(Number.isInteger(done.json.launched.clients) && done.json.launched.stamps >= done.json.launched.clients, JSON.stringify(done.json));
  assert.equal((await owner.get('/api/v1/loyalty/launch?headStart=lots')).status, 400);
});

test('before the launch the line is the plan, and the command writes exactly that plan', async () => {
  // visits made while the programme was off earned nothing: the head start is what turns them into stamps
  const t = await salon();
  const e = t.engine;
  const mk = async (first, n) => {
    const cid = (await e.run(addClient, { first, last: 'Test', phone: '06' + String(40000000 + ++numbers * 7919).slice(-8) }, t.asOwner())).id;
    for (let i = 0; i < n; i++) {
      t.clock.now = at(addDays(DAY, -300 + i * 20), 10);
      await e.run(S.checkout, { clientId: cid, lines: [{ kind: 'service', ref: t.ids.cut }], payments: [{ method: 'card', amount: 2000 }] }, t.asOwner());
    }
    return cid;
  };
  const aline = await mk('Aline', 2), boris = await mk('Boris', 7);
  t.clock.now = at(DAY, 10);
  await e.run(updateSettings, { loyalty: { enabled: true, goal: 9 } }, t.asOwner());
  const s = e.state;
  assert.deepEqual(launchView(s, 'none', DAY), { launched: null, plan: { headStart: 'none', cap: 0, clients: 0, stamps: 0 } });
  assert.deepEqual(launchView(s, 'half', DAY).plan, { headStart: 'half', cap: 4, clients: 2, stamps: 6 }, 'Aline 2, Boris 4 at most');
  assert.deepEqual(launchView(s, 'full', DAY).plan, { headStart: 'full', cap: 8, clients: 2, stamps: 9 }, 'Aline 2, Boris 7');
  const ran = await e.run(launchLoyalty, { headStart: 'half' }, t.asOwner());
  assert.deepEqual({ clients: ran.clients, stamps: ran.stamps }, { clients: 2, stamps: 6 }, 'the command writes what the line showed');
  assert.equal(cardOf(e.state, aline, DAY).units, 2);
  assert.equal(cardOf(e.state, boris, DAY).units, 4);
  assert.deepEqual(launchView(e.state, 'half', DAY), { launched: { day: DAY, headStart: 'half', clients: 2, stamps: 6 }, plan: null });
  assert.equal(launchPlan(e.state, 'half', DAY).rows.length, 2, 'asked again, the plan is still computed, the command refuses a second launch');
});

test('the simulator also says how many clients would win a reward', async () => {
  const { t, file, visits } = await setup({ enabled: true, goal: 3 });
  const y = await file(), z = await file('Zoé'), w = await file('Willy');
  await visits(y, 3, -60);
  await visits(z, 6, -50);
  await visits(w, 2, -40);
  const s = t.engine.state;
  const sim = simulate(s, {}, { from: addDays(DAY, -364), to: DAY });
  assert.equal(sim.clients, 3, 'three clients earned stamps');
  assert.equal(sim.winners, 2, 'two of them completed a card');
  assert.equal(sim.rewards, 3, 'one for Yanis, two for Zoé');
  assert.ok(sim.value > 0);
});

/** the WordPress import marks a file as coming from the old site: with no visit here since, its first opening is fenced */
const fromWordpress = (t, cid) => t.engine.run({ run: (s, i, ctx) => { ctx.emit('client.updated', { id: cid, cid, patch: { source: 'wordpress', marketingSrc: 'wordpress' }, fields: [] }); return {}; } }, {}, t.sys);

test('a fenced file keeps the card from the fence on: the stamps before it are the previous holder’s, the switch stays', async () => {
  const { t, rt, file, visit, signIn } = await setup();
  const w = await file('Walid');
  await fromWordpress(t, w);
  t.clock.now = at(addDays(DAY, -5), 10);
  await t.engine.run(importLoyalty, { rows: [{ clientId: w, units: 5 }] }, t.sys);
  t.clock.now = at(DAY, 11);
  const b = await signIn(w);
  await rt.engine.sync(true);
  const row = rt.engine.state.accounts.get(w);
  assert.deepEqual({ fenced: row.fenced, named: row.named, historyFrom: row.historyFrom }, { fenced: true, named: true, historyFrom: DAY });
  let l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.enabled, true, 'a fenced but named account has its card');
  assert.equal(l.card.units, 0, 'the 5 stamps imported before the fence are not his to see');
  assert.deepEqual(l.rewards, []);
  assert.equal(l.referral.count, 0);
  await visit(w, addDays(DAY, 1));
  await visit(w, addDays(DAY, 2));
  await rt.engine.sync(true);
  l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.enabled, true);
  assert.equal(l.card.units, 2, 'only the 2 stamps earned after the fence');
  // the opt-out the règlement promises works from the fence
  const off = await b.post('/api/me/loyalty/off', { off: true });
  assert.equal(off.status, 200, off.text);
  await rt.engine.sync(true);
  l = (await b.get('/api/me/loyalty')).json;
  assert.equal(l.off, true);
  assert.match(l.headline, /^Tu ne participes pas à la carte fidélité/, 'no counting headline for a card that no longer moves');
  assert.equal(l.referral, null);
});

test('an unnamed account (a number that may have changed hands) has no card and cannot switch the programme', async () => {
  const { t, rt, file, visits, signIn } = await setup();
  const y = await file();
  await visits(y, 3);
  await t.engine.run({ run: (s, i, ctx) => { ctx.emit('account.signedIn', { id: y, cid: y, msgId: '', fenced: true, historyFrom: DAY, named: false, opened: true }); return {}; } }, {}, t.sys);
  const b = await signIn(y);
  await rt.engine.sync(true);
  assert.equal(rt.engine.state.accounts.get(y).named, false);
  assert.deepEqual((await b.get('/api/me/loyalty')).json, { enabled: false });
  const n = rt.engine.journal.length;
  const res = await b.post('/api/me/loyalty/off', { off: true });
  assert.equal(res.status, 403, res.text);
  assert.equal(rt.engine.journal.length, n, 'nothing written on the previous holder’s file');
  assert.ok(!rt.engine.state.clients.get(y).loyaltyOff);
});

test('« Participer »: the counter needs client.edit, a client needs his session, the demo persona changes nothing', async () => {
  const { t, file } = await setup();
  const y = await file();
  await rejects(t.engine.run(setLoyaltyOff, { clientId: y, off: true }, { ...t.asStaff('Ali'), caps: new Set(['client.view']) }), 'forbidden');
  await rejects(t.engine.run(setLoyaltyOff, { off: true }, { actor: { t: 'client', id: 'moi' }, caps: new Set() }), 'signed_out');
  assert.ok(!t.engine.state.clients.get(y).loyaltyOff);
  // the showcase: ok, demo, and the journal does not move
  const rt = await testRuntime({ clock: () => at(DAY, 10) });
  const b = browser(rt);
  assert.equal((await b.post('/api/public/account/demo')).status, 200);
  await rt.engine.sync(true);
  const n = rt.engine.journal.length;
  const res = await b.post('/api/me/loyalty/off', { off: true });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { ok: true, demo: true, off: true });
  assert.equal(rt.engine.journal.length, n);
});

test('what a ticket did for the card: its stamp, the card it completed, or why none', async () => {
  const { t, file } = await setup({ enabled: true, goal: 2, minNet: 1000 });
  const y = await file();
  const sale = async (day, hour, x) => {
    t.clock.now = at(day, hour);
    return t.engine.run(S.checkout, { clientId: y, lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 2000 }], ...x }, t.asOwner());
  };
  const get = (id) => saleLoyalty(t.engine.state, t.engine.state.sales.get(id));
  const a = await sale(addDays(DAY, -9), 10);
  assert.deepEqual(get(a.id), { units: 1, rewards: [], why: null });
  const again = await sale(addDays(DAY, -9), 15);
  assert.deepEqual(get(again.id), { units: 0, rewards: [], why: 'today' }, 'a second ticket the same day');
  const full = await sale(addDays(DAY, -6), 10);
  const done = get(full.id);
  assert.equal(done.units, 1);
  assert.equal(done.rewards.length, 1, 'the second stamp completes the card of 2: the reward is this ticket’s');
  assert.equal(done.rewards[0].reward.kind, 'service');
  const next = await sale(addDays(DAY, -3), 10);
  assert.deepEqual(get(next.id).rewards, [], 'a card completed earlier is not this ticket’s');
  await t.engine.run(updateSettings, { loyalty: { minNet: 2500 } }, t.asOwner());
  const small = await sale(addDays(DAY, -1), 10);
  assert.deepEqual(get(small.id), { units: 0, rewards: [], why: 'min' });
  assert.equal(saleLoyalty(t.engine.state, { clientId: null, lines: [] }), null, 'no client, no card');
});
