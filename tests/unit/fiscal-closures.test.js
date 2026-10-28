// CPT-01a: month and year closures with their grand totals, the signed seals and their anti-rewrite rule, the software
// version in the technical log, the routes, and scripts/replay-diff.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { salon, rejects, at } from '../helpers.js';
import * as S from '../../server/commands/sales.js';
import { addProduct } from '../../server/commands/catalog.js';
import { updateSettings } from '../../server/commands/shop.js';
import { tick } from '../../server/commands/system.js';
import { closePeriod } from '../../server/commands/fiscal.js';
import { signStep } from '../../server/commands/steps/fiscal.js';
import { emptyState } from '../../server/core/state.js';
import { zFigures, closureNo } from '../../server/domain/cash.js';
import { verifySeal, signedPayload, unsignedRefs, closableMonth, fiscalYearOf, monthTotals, signatureState } from '../../server/domain/fiscal.js';
import { signerFrom, makeSigner, demoSigner, seedOf } from '../../server/core/signer.js';
import { memoryStore } from '../../server/store/memory.js';
import { testRuntime, browser } from '../api/client.js';
import { DEMO } from '../../server/domain/seed.js';
import { SOFTWARE, versionOf } from '../../server/version.js';
import fiscal from '../../server/settings/fiscal.js';

const SYSTEM = { actor: { t: 'system', id: 'scheduler', n: 'Automatique' }, caps: new Set() };
const KEY = signerFrom(Buffer.alloc(32, 7), 'env');
const runTick = (t, meta = {}) => t.engine.run(tick, {}, { ...SYSTEM, meta });
const sw = (build) => ({ major: 1, minor: 0, build });
const evs = (t, type, from = 0) => t.engine.journal.slice(from).filter((e) => e.type === type);

/** A day at the till: a cut by card, an oil at 5,5 % paid cash, sometimes a credit note; then the count and the Z. */
async function tillDay(t, day, { refund = false, z = true } = {}) {
  t.clock.now = at(day, 9, 30);
  await t.engine.run(S.openDrawer, { float: 10000 }, t.asOwner());
  t.clock.now = at(day, 11);
  const cut = await t.engine.run(S.checkout, { lines: [{ kind: 'service', ref: t.ids.cut, staffId: t.ids.Ali }], tip: { amount: 200, staffId: t.ids.Ali }, payments: [{ method: 'card', amount: 2200 }] }, t.asOwner());
  await t.engine.run(S.checkout, { lines: [{ kind: 'product', ref: t.ids.book }], payments: [{ method: 'cash', amount: 1000 }] }, t.asOwner());
  if (refund) await t.engine.run(S.refund, { saleId: cut.id, amount: 500, reason: 'Geste commercial', method: 'card' }, t.asOwner());
  if (!z) return;
  t.clock.now = at(day, 18, 40);
  const dr = t.engine.state.drawer;
  const expected = dr.float + 1000;
  await t.engine.run(S.closeDrawer, { counts: { 5000: Math.floor(expected / 5000), 1000: (expected % 5000) / 1000 } }, t.asOwner());
  t.clock.now = at(day, 18, 45);
  await t.engine.run(S.closeDay, {}, t.asOwner());
}

/**
 * Tuesday 27, Thursday 29 and Saturday 31 October at the till, a credit note on the 29th. With a signer, the scheduler
 * ticks from the start and after each Z, as it does on a live salon.
 */
async function october({ signer = null } = {}) {
  const t = await salon({ day: '2026-10-27', hour: 8 });
  t.ids.book = (await t.engine.run(addProduct, { name: 'Livre de coiffure', price: 1000, vat: 550 }, t.asOwner())).id;
  if (signer) await runTick(t, { signer });
  for (const [day, o] of [['2026-10-27', {}], ['2026-10-29', { refund: true }], ['2026-10-31', {}]]) {
    await tillDay(t, day, o);
    if (signer) { t.clock.now = at(day, 19); await runTick(t, { signer }); }
  }
  return t;
}

test('a month closes by itself on the 1st after 05:00: the sum of its Z, the perpetual total of the last one', async () => {
  const t = await october();
  const S0 = t.engine.state;
  assert.equal(S0.closures.size, 3);
  t.clock.now = at('2026-11-01', 4, 50);
  await runTick(t);
  assert.equal(evs(t, 'period.closed').length, 0, 'not before 05:00');
  t.clock.now = at('2026-11-01', 5, 10);
  const mark = t.engine.journal.length;
  await runTick(t);
  const closed = evs(t, 'period.closed', mark);
  assert.equal(closed.length, 1);
  const m = closed[0].data;
  assert.equal(closed[0].actor.t, 'system');
  assert.deepEqual([m.kind, m.period, m.number, m.from, m.to], ['month', '2026-10', 1, '2026-10-01', '2026-10-31']);
  const zs = [...S0.closures.values()].sort((a, b) => a.number - b.number);
  const f = zs.map((z) => zFigures(z));
  const sum = (k) => f.reduce((x, y) => x + y[k], 0);
  for (const k of ['grossTtc', 'refundsTotal', 'netTtc', 'htNet', 'takings', 'prepaid', 'tips', 'giftcardsSold', 'giftcardsRefunded']) assert.equal(m.totals[k], sum(k), k);
  assert.equal(m.totals.refundsTotal, 500);
  // per rate and per method, as the Z list them
  assert.deepEqual(m.totals.vatNet.map((v) => v.rate), [2000, 550]);
  for (const v of m.totals.vatNet) {
    assert.equal(v.tax, f.reduce((x, y) => x + (y.vatNet.find((r) => r.rate === v.rate) || { tax: 0 }).tax, 0));
    assert.equal(v.base, f.reduce((x, y) => x + (y.vatNet.find((r) => r.rate === v.rate) || { base: 0 }).base, 0));
  }
  assert.deepEqual(m.totals.paymentsNet, { card: 3 * 2200 - 500, cash: 3000 });
  assert.equal(m.totals.netTtc, m.totals.htNet + m.totals.vatNet.reduce((x, v) => x + v.tax, 0));
  assert.deepEqual(m.z, { count: 3, first: 1, last: 3 });
  assert.deepEqual(m.tickets, { count: 6, first: 1, last: 6 });
  assert.deepEqual(m.credits, { count: 1, first: 1, last: 1 });
  // the perpetual net is the last Z's grand total; gross and refunds start from zero with the first month
  assert.equal(m.perpetual.net, zs[2].grandTotal);
  assert.deepEqual(m.perpetual, { net: zs[2].grandTotal, gross: m.totals.grossTtc, refunds: 500 });
  const rec = t.engine.state.periods.get('M0001');
  assert.equal(rec.seal, closed[0].p, 'sealed on the journal hash, like a Z');
  assert.equal(t.engine.state.periodByKey.get('M:2026-10'), rec);
  // a second tick adds nothing
  t.clock.now = at('2026-11-01', 5, 11);
  const again = t.engine.journal.length;
  await runTick(t);
  assert.equal(evs(t, 'period.closed', again).length, 0);
  assert.equal(closableMonth(t.engine.state, '2026-11-01'), null);
  assert.equal(t.engine.verify().ok, true);
});

test('a month waits for the Z of a drawer nobody counted, and says so', async () => {
  const t = await salon({ day: '2026-10-27', hour: 8 });
  t.ids.book = (await t.engine.run(addProduct, { name: 'Livre', price: 1000, vat: 550 }, t.asOwner())).id;
  await tillDay(t, '2026-10-27');
  await tillDay(t, '2026-10-31', { z: false });
  t.clock.now = at('2026-11-01', 5, 10);
  const r = await runTick(t);
  assert.equal(evs(t, 'period.closed').length, 0);
  assert.ok(r.warnings.includes('Le mois d’octobre attend le Z du samedi 31.'), r.warnings.join(' | '));
  assert.deepEqual(closableMonth(t.engine.state, '2026-11-01'), { month: '2026-10', waiting: '2026-10-31' });
  // the owner cannot force it either
  const e = await rejects(t.engine.run(closePeriod, { month: '2026-10' }, t.asOwner()), 'days');
  assert.equal(e.status, 409);
  assert.equal(e.message, 'Il manque le Z du samedi 31 : clôture-le d’abord.');
  // count, Z, tick
  t.clock.now = at('2026-11-01', 9);
  const dr = t.engine.state.drawer;
  await t.engine.run(S.closeDrawer, { counts: { 1000: (dr.float + 1000) / 1000 } }, t.asOwner());
  await t.engine.run(S.closeDay, { day: '2026-10-31' }, t.asOwner());
  t.clock.now = at('2026-11-01', 9, 5);
  const r2 = await runTick(t);
  assert.ok(!r2.warnings.some((w) => /Le mois/.test(w)));
  assert.equal(evs(t, 'period.closed').length, 1);
  assert.equal(t.engine.state.periods.get('M0001').z.count, 2);
});

test('refusals: a month not over, a month after one still open, a barber, nothing to close', async () => {
  const t = await october();
  t.clock.now = at('2026-11-02', 10);
  await rejects(t.engine.run(closePeriod, { month: '2026-11' }, t.asOwner()), 'not_over');
  const e = await rejects(t.engine.run(closePeriod, { month: '2026-11' }, t.asOwner()), 'not_over');
  assert.equal(e.message, 'Le mois n’est pas fini.');
  await rejects(t.engine.run(closePeriod, { month: '2026-09' }, t.asOwner()), 'nothing');
  await rejects(t.engine.run(closePeriod, { month: '2026-10' }, t.asStaff('Ali')), 'forbidden');
  await rejects(t.engine.run(closePeriod, { month: '2026-13' }, t.asOwner()), 'invalid');
  // November over, October still open
  t.clock.now = at('2026-12-02', 10);
  const missed = await rejects(t.engine.run(closePeriod, { month: '2026-11' }, t.asOwner()), 'missed');
  assert.equal(missed.message, 'Clôture d’abord octobre.');
  const r = await t.engine.run(closePeriod, { month: '2026-10' }, t.asOwner());
  assert.deepEqual([r.ref, r.number, r.month, r.year], ['M0001', 1, '2026-10', null]);
  assert.equal(t.engine.state.periods.get('M0001').by, t.ownerId);
  await rejects(t.engine.run(closePeriod, { month: '2026-10' }, t.asOwner()), 'closed');
  // a month with no Z follows without a gap, closed with zeros and the same perpetual
  const nov = await t.engine.run(closePeriod, { month: '2026-11' }, t.asOwner());
  const n = t.engine.state.periods.get(nov.ref);
  assert.deepEqual([n.z.count, n.totals.netTtc, n.tickets.count], [0, 0, 0]);
  assert.deepEqual(n.perpetual, t.engine.state.periods.get('M0001').perpetual);
});

test('closing the month that ends the fiscal year closes the year with it: the sum of its months', async () => {
  const t = await october();
  await tillDay(t, '2026-11-03');
  await tillDay(t, '2026-12-01', { refund: true });
  t.clock.now = at('2027-01-02', 10);
  assert.equal(t.engine.state.settings.fiscal.yearEndMonth, 12);
  await t.engine.run(closePeriod, { month: '2026-10' }, t.asOwner());
  await t.engine.run(closePeriod, { month: '2026-11' }, t.asOwner());
  const mark = t.engine.journal.length;
  const r = await t.engine.run(closePeriod, { month: '2026-12' }, t.asOwner());
  assert.deepEqual(r.year, { ref: 'Y0001', number: 1, period: '2026' });
  const both = evs(t, 'period.closed', mark);
  assert.deepEqual(both.map((e) => e.data.kind), ['month', 'year'], 'one command, one append');
  const S1 = t.engine.state;
  const y = S1.periods.get('Y0001');
  const months = ['M0001', 'M0002', 'M0003'].map((ref) => S1.periods.get(ref));
  assert.deepEqual([y.period, y.from, y.to], ['2026', '2026-01-01', '2026-12-31']);
  assert.deepEqual(y.months, { count: 3, first: 1, last: 3 });
  for (const k of ['grossTtc', 'refundsTotal', 'netTtc', 'htNet', 'tips', 'takings']) assert.equal(y.totals[k], months.reduce((x, m) => x + m.totals[k], 0), k);
  assert.equal(y.totals.vatNet.find((v) => v.rate === 550).tax, months.reduce((x, m) => x + m.totals.vatNet.find((v) => v.rate === 550).tax, 0));
  assert.deepEqual(y.perpetual, months[2].perpetual);
  assert.equal(y.perpetual.net, S1.grandTotal);
  assert.equal(S1.periodByKey.get('Y:2026'), y);
  // a closed month's figures from the Z: the same perpetual totals as its closure, not the last one's
  assert.deepEqual(monthTotals(S1, '2026-10').perpetual, months[0].perpetual);
  assert.deepEqual(monthTotals(S1, '2026-11').perpetual, months[1].perpetual);
  assert.deepEqual(monthTotals(S1, '2026-09').perpetual, { net: 0, gross: 0, refunds: 0 });
  // another year end: a fiscal year from July to June is named after the year it ends in
  assert.equal(fiscalYearOf('2026-10', 6), '2027');
  assert.equal(fiscalYearOf('2026-06', 6), '2026');
  assert.equal(fiscalYearOf('2026-12', 12), '2026');
});

test('a year ending in June: closing June closes July to June', async () => {
  const t = await salon({ day: '2026-06-02', hour: 8 });
  t.ids.book = (await t.engine.run(addProduct, { name: 'Livre', price: 1000, vat: 550 }, t.asOwner())).id;
  await t.engine.run(updateSettings, { fiscal: { yearEndMonth: 6 } }, t.asOwner());
  await tillDay(t, '2026-06-02');
  await tillDay(t, '2026-07-07');
  t.clock.now = at('2026-08-03', 10);
  const june = await t.engine.run(closePeriod, { month: '2026-06' }, t.asOwner());
  assert.deepEqual(june.year, { ref: 'Y0001', number: 1, period: '2026' });
  const y = t.engine.state.periods.get('Y0001');
  assert.deepEqual([y.from, y.to, y.months.count], ['2025-07-01', '2026-06-30', 1]);
  const july = await t.engine.run(closePeriod, { month: '2026-07' }, t.asOwner());
  assert.equal(july.year, null);
  assert.equal(monthTotals(t.engine.state, '2026-08').perpetual.net, t.engine.state.grandTotal);
});

test('every Z and month is signed by the key; a changed figure no longer verifies', async () => {
  const seed = randomBytes(32).toString('base64');
  const store = memoryStore();
  const a = await makeSigner({ LX_SIGN_KEY: seed }, store, 'production');
  const b = await makeSigner({ LX_SIGN_KEY: seed }, store, 'production');
  assert.equal(a.signer.kid, b.signer.kid, 'the same seed, the same key id');
  assert.match(a.signer.kid, /^[0-9a-f]{16}$/);
  assert.deepEqual([a.signer.source, a.warning], ['env', '']);
  const signer = a.signer;
  const t = await october({ signer });
  // the key first, before any Z; then each Z the evening it is made
  const key = evs(t, 'tech.logged').filter((e) => e.data.kind === 'key');
  assert.equal(key.length, 1);
  assert.deepEqual([key[0].data.kid, key[0].data.publicKey, key[0].data.source, key[0].data.backlog], [signer.kid, signer.publicKey, 'env', []]);
  assert.deepEqual(evs(t, 'seal.signed').map((e) => e.data.ref), ['Z0001', 'Z0002', 'Z0003']);
  // the month closed in a tick is signed by the next one
  t.clock.now = at('2026-11-01', 5, 10);
  await runTick(t, { signer });
  assert.equal(t.engine.state.signatures.has('M0001'), false);
  t.clock.now = at('2026-11-01', 5, 11);
  await runTick(t, { signer });
  const st = t.engine.state;
  assert.deepEqual([...st.signatures.keys()].sort(), ['M0001', 'Z0001', 'Z0002', 'Z0003']);
  assert.equal(evs(t, 'tech.logged').length, 1, 'the key is logged once');
  for (const ref of ['Z0001', 'Z0002', 'Z0003', 'M0001']) {
    assert.deepEqual(verifySeal(st, ref, signer.publicKey), { ok: true }, ref);
    assert.equal(st.signatures.get(ref).late, false);
    assert.equal(signatureState(st, ref, t.clock.now), 'signed');
  }
  const sg = evs(t, 'seal.signed').find((e) => e.data.ref === 'M0001').data;
  const p = signedPayload(st, 'M0001');
  assert.deepEqual(Object.keys(p).sort(), ['digest', 'kind', 'of', 'ref', 'seal']);
  assert.deepEqual([sg.kind, sg.of, sg.digest, sg.kid], ['month', st.periods.get('M0001').id, p.digest, signer.kid]);
  assert.equal(p.seal, st.periods.get('M0001').seal);
  // another key does not verify, and a figure changed in a copy of the state does not either
  assert.equal(verifySeal(st, 'Z0001', demoSigner().publicKey).why, 'key');
  const copy = structuredClone(st);
  copy.closures.get('2026-10-29').net += 100;
  assert.deepEqual(verifySeal(copy, 'Z0002', signer.publicKey), { ok: false, why: 'digest' });
  assert.deepEqual(verifySeal(copy, 'Z0001', signer.publicKey), { ok: true }, 'the other Z are untouched');
  copy.periods.get('M0001').totals.netTtc -= 1;
  assert.equal(verifySeal(copy, 'M0001', signer.publicKey).why, 'digest');
  // the seal it was signed on (the journal hash) is covered too
  const moved = structuredClone(st);
  moved.closures.get('2026-10-27').seal = '0'.repeat(64);
  assert.equal(verifySeal(moved, 'Z0001', signer.publicKey).why, 'signature');
  assert.equal(verifySeal(st, 'Z0099', signer.publicKey).why, 'unknown');
  assert.equal(t.engine.verify().ok, true);
});

test('the anti-rewrite rule: an old closure is signed only as the backlog of a new key, marked late', async () => {
  const first = KEY;
  const t = await salon({ day: '2026-10-27', hour: 8 });
  t.ids.book = (await t.engine.run(addProduct, { name: 'Livre', price: 1000, vat: 550 }, t.asOwner())).id;
  t.clock.now = at('2026-10-27', 8, 30);
  await runTick(t, { signer: first });
  assert.equal(t.engine.state.signKey.kid, first.kid, 'the key is known before any Z');
  await tillDay(t, '2026-10-27');
  // three days without a tick that signs (the step failed, the scheduler was off): the Z is now too old
  t.clock.now = at('2026-10-30', 19);
  const mark = t.engine.journal.length;
  await runTick(t, { signer: first });
  assert.equal(evs(t, 'seal.signed', mark).length, 0, 'not signed quietly');
  assert.deepEqual(unsignedRefs(t.engine.state), ['Z0001']);
  assert.equal(signatureState(t.engine.state, 'Z0001', t.clock.now), 'unsigned');
  assert.equal(verifySeal(t.engine.state, 'Z0001', first.publicKey).why, 'unsigned');
  // a fresh Z the same week is still signed
  await tillDay(t, '2026-10-31');
  t.clock.now = at('2026-10-31', 19);
  await runTick(t, { signer: first });
  assert.deepEqual(unsignedRefs(t.engine.state), ['Z0001']);
  assert.equal(t.engine.state.signatures.get('Z0002').late, false);
  // a new key: logged first, with its backlog, which it signs late; nothing older that comes later joins it
  const second = signerFrom(Buffer.alloc(32, 9), 'env');
  const m2 = t.engine.journal.length;
  await runTick(t, { signer: second });
  const added = t.engine.journal.slice(m2);
  assert.deepEqual(added.filter((e) => e.type === 'tech.logged' || e.type === 'seal.signed').map((e) => e.type), ['tech.logged', 'seal.signed']);
  const k = added.find((e) => e.type === 'tech.logged').data;
  assert.deepEqual([k.kind, k.kid, k.backlog], ['key', second.kid, ['Z0001']]);
  const late = added.find((e) => e.type === 'seal.signed').data;
  assert.deepEqual([late.ref, late.late, late.kid], ['Z0001', true, second.kid]);
  const S2 = t.engine.state;
  assert.deepEqual(unsignedRefs(S2), []);
  assert.equal(signatureState(S2, 'Z0001', t.clock.now), 'late');
  assert.deepEqual(verifySeal(S2, 'Z0001', second.publicKey), { ok: true });
  assert.deepEqual(verifySeal(S2, 'Z0002', first.publicKey), { ok: true }, 'the older signatures keep their key');
  assert.equal(S2.signKey.kid, second.kid);
  assert.deepEqual([...S2.signKeys.keys()], [first.kid, second.kid]);
});

test('a key that appears late signs what was waiting, marked late; never twice', async () => {
  const t = await october();
  t.clock.now = at('2026-11-01', 5, 10);
  await runTick(t, { signer: KEY });
  // the Z of the 27th and 29th are older than 36 h: the backlog of this new key; the 31st's is fresh
  const key = evs(t, 'tech.logged')[0].data;
  assert.deepEqual(key.backlog, ['Z0001', 'Z0002']);
  assert.deepEqual(evs(t, 'seal.signed').map((e) => [e.data.ref, !!e.data.late]), [['Z0003', false], ['Z0001', true], ['Z0002', true]], 'the fresh one first');
  await runTick(t, { signer: KEY });
  const n = evs(t, 'seal.signed').length;
  assert.equal(n, 4, 'then the month');
  await runTick(t, { signer: KEY });
  assert.equal(evs(t, 'seal.signed').length, n);
  // at most 100 a tick: a long backlog takes several
  const big = emptyState();
  for (let i = 1; i <= 150; i++) big.closures.set('day' + i, { id: 'zc' + i, number: i, day: 'day' + i, net: i, at: 1 });
  const drafts = [];
  signStep.run(big, /** @type {any} */ ({ now: at('2026-11-01', 5), meta: { signer: KEY }, emit: (type, data) => drafts.push({ type, data }) }));
  assert.deepEqual([drafts[0].data.backlog.length, drafts.filter((d) => d.type === 'seal.signed').length], [150, 100]);
  // without a signer (a tick run by hand) nothing is signed, nothing logged
  const u = await salon({ day: '2026-10-27', hour: 8 });
  u.ids.book = (await u.engine.run(addProduct, { name: 'Livre', price: 1000, vat: 550 }, u.asOwner())).id;
  await tillDay(u, '2026-10-27');
  await runTick(u);
  assert.equal(evs(u, 'seal.signed').length + evs(u, 'tech.logged').length, 0);
});

test('the technical log records each software version once', async () => {
  const t = await salon();
  await runTick(t, { software: sw('aaaaaaa') });
  assert.equal(t.engine.state.software, '1.0 (aaaaaaa)');
  const mark = t.engine.journal.length;
  await runTick(t, { software: sw('bbbbbbb') });
  const v = evs(t, 'tech.logged', mark);
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].data, { kind: 'version', from: '1.0 (aaaaaaa)', to: '1.0 (bbbbbbb)' });
  const m2 = t.engine.journal.length;
  await runTick(t, { software: sw('bbbbbbb') });
  assert.equal(evs(t, 'tech.logged', m2).length, 0);
  assert.equal(versionOf({ major: 1, minor: 0, build: 'a1b2c3d' }), '1.0 (a1b2c3d)');
  assert.match(versionOf(SOFTWARE), /^1\.0 \(.{1,7}\)$/);
  assert.equal(t.engine.state.techCount, 2);
});

test('the signing key: LX_SIGN_KEY, else kept with the data and said so; the demo has its own', async () => {
  assert.equal(seedOf('abc'), null);
  assert.equal(seedOf(randomBytes(31).toString('base64')), null);
  assert.equal(seedOf(randomBytes(32).toString('base64url')).length, 32);
  const store = memoryStore();
  const kept = await makeSigner({}, store, 'production');
  assert.equal(kept.signer.source, 'store');
  assert.equal(kept.warning, 'LX_SIGN_KEY n’est pas définie : la clé de signature est gardée avec les données. Ton prestataire la crée (32 octets en base64), puis redéploie.');
  assert.equal((await makeSigner({}, store, 'production')).signer.kid, kept.signer.kid, 'generated once');
  const bad = await makeSigner({ LX_SIGN_KEY: 'trop-court' }, store, 'production');
  assert.equal(bad.signer.kid, kept.signer.kid);
  assert.match(bad.warning, /^LX_SIGN_KEY n’est pas une clé de 32 octets/);
  const demo = await makeSigner({}, memoryStore(), 'demo');
  assert.deepEqual([demo.signer.source, demo.signer.kid, demo.warning], ['demo', demoSigner().kid, '']);
  // the demo keeps its own key even with a real one set: its seeded journal is signed with it
  const demoEnv = await makeSigner({ LX_SIGN_KEY: Buffer.alloc(32, 7).toString('base64') }, memoryStore(), 'demo');
  assert.deepEqual([demoEnv.signer.source, demoEnv.signer.kid, demoEnv.warning], ['demo', demoSigner().kid, '']);
  // Mise en route › Nouveautés: red until LX_SIGN_KEY is set
  assert.deepEqual(fiscal.golive.state(null, { signer: kept.signer }), { on: false, blocker: 'gardée avec les données' });
  assert.deepEqual(fiscal.golive.state(null, { signer: signerFrom(Buffer.alloc(32, 1), 'env') }), { on: true, blocker: '' });
  // the runtime: production warns, the demo does not
  const prod = await testRuntime({ env: { LX_MODE: 'production' } });
  assert.equal(prod.signer.source, 'store');
  assert.ok(prod.warnings.includes(kept.warning));
  const env = await testRuntime({ env: { LX_MODE: 'production', LX_SIGN_KEY: Buffer.alloc(32, 7).toString('base64') } });
  assert.deepEqual([env.signer.source, env.signer.kid], ['env', KEY.kid]);
  assert.ok(!env.warnings.some((w) => /LX_SIGN_KEY/.test(w)));
});

test('the demo is seeded with its months closed and signed on their dates', async () => {
  const clock = { now: at('2026-11-03', 10) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = rt.engine.state;
  assert.equal(rt.signer.source, 'demo');
  assert.deepEqual([...s.periods.keys()], ['M0001', 'M0002', 'M0003']);
  assert.equal(s.periods.get('M0003').period, '2026-10');
  assert.equal(s.periods.get('M0003').perpetual.net, s.closures.get('2026-10-31').grandTotal);
  assert.deepEqual(unsignedRefs(s), []);
  assert.ok([...s.signatures.values()].every((x) => !x.late));
  for (const ref of ['M0001', 'M0003', closureNo(s.closureSeq)]) assert.deepEqual(verifySeal(s, ref, rt.signer.publicKey), { ok: true }, ref);
  assert.deepEqual(s.tech.map((x) => x.kind), ['version', 'key']);

  /* the routes, as Caisse › Clôture reads them */
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const list = await b.get('/api/v1/periods');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map((x) => [x.ref, x.period, x.signature, x.signatureLabel]), [['M0003', '2026-10', 'signed', '✓ signée'], ['M0002', '2026-09', 'signed', '✓ signée'], ['M0001', '2026-08', 'signed', '✓ signée']]);
  assert.equal(list.json.items[0].net, s.periods.get('M0003').totals.netTtc);
  assert.equal(list.json.closable, null, 'November is not over');
  assert.deepEqual(list.json.key, { kid: rt.signer.kid, source: 'demo', sourceLabel: 'démo' });
  const one = await b.get('/api/v1/periods/M0003');
  assert.equal(one.status, 200);
  assert.deepEqual([one.json.ref, one.json.totals.netTtc, one.json.perpetual.net, one.json.signature, one.json.kid], ['M0003', s.periods.get('M0003').totals.netTtc, s.periods.get('M0003').perpetual.net, 'signed', rt.signer.kid]);
  assert.equal(one.json.seal.length, 64);
  // what the month report prints: the record's spans, not the list's counts
  assert.deepEqual(one.json.tickets, s.periods.get('M0003').tickets);
  assert.deepEqual(one.json.z, s.periods.get('M0003').z);
  assert.ok(one.json.tickets.count > 0 && one.json.tickets.first > 0);
  assert.equal(one.json.by, 'Automatique');
  assert.equal(list.json.items[0].ticketCount, s.periods.get('M0003').tickets.count);
  assert.equal((await b.get('/api/v1/periods/M0099')).status, 404);
  const early = await b.post('/api/v1/periods/close', { month: '2026-11' }, { 'x-request-id': 'close-nov-0001' });
  assert.deepEqual([early.status, early.json.error.code], [409, 'not_over']);
  assert.equal((await b.post('/api/v1/periods/close', { month: 'nov' })).status, 400);
  const log = await b.get('/api/v1/fiscal/log?limit=10');
  assert.equal(log.status, 200);
  assert.deepEqual(log.json.items.map((x) => x.label), ['Clé de signature', 'Version du logiciel']);
  assert.equal(log.json.software, versionOf(SOFTWARE));
  // the public keys, to check a signature without the Comptoir
  assert.deepEqual(log.json.keys.map((k) => [k.kid, k.publicKey, k.source]), [[rt.signer.kid, rt.signer.publicKey, 'demo']]);
  // Réglages › Journal says which closure, which key, which version
  const sum = async (type) => ((await b.get('/api/v1/audit?limit=5&type=' + type)).json.items[0] || {}).summary;
  assert.match(await sum('seal.signed'), /^(Z|M)\d{4} · clé [0-9a-f]{16}$/);
  assert.match((await sum('tech.logged')) || '', /^(clé [0-9a-f]{16}|version 1\.0 \(.+\))$/);
  assert.match(await sum('period.closed'), /^M0003 · 2026-10 · [\d\s]+(,\d\d)?\s€$/);
  // a month closed from the Comptoir: in the owner's feed, answered again for a retried request
  clock.now = at('2026-12-01', 10);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  // the seed's day carries the demo members' renewals (PAY-02): its drawer counted and its Z first, as the Comptoir asks
  if (s.drawer) {
    const counted = await b.post('/api/v1/drawer/close', { counts: {}, note: 'Caisse de démo comptée pour le test' }, { 'x-request-id': 'drawer-nov-03-0001' });
    assert.equal(counted.status, 200, JSON.stringify(counted.json));
  }
  const z = await b.post('/api/v1/closures', { day: '2026-11-03' }, { 'x-request-id': 'z-nov-03-0001' });
  assert.equal(z.status, 200, JSON.stringify(z.json));
  const nov = await b.post('/api/v1/periods/close', { month: '2026-11' }, { 'x-request-id': 'close-nov-0002' });
  assert.equal(nov.status, 200, JSON.stringify(nov.json));
  assert.deepEqual([nov.json.ref, nov.json.month], ['M0004', '2026-11']);
  const again = await b.post('/api/v1/periods/close', { month: '2026-11' }, { 'x-request-id': 'close-nov-0002' });
  assert.deepEqual([again.status, again.json.ref], [200, 'M0004']);
  assert.equal(rt.engine.journal.filter((e) => e.type === 'period.closed').length, 4);
  const feed = await b.get('/api/v1/feed');
  const item = feed.json.items.find((x) => x.kind === 'closure' && /M0004/.test(x.title));
  assert.ok(item, JSON.stringify(feed.json.items.slice(0, 3)));
  assert.equal(item.title, 'Novembre clôturé · M0004');
  assert.equal(item.money, true);
  const pending = (await b.get('/api/v1/periods')).json.items[0];
  assert.deepEqual([pending.ref, pending.signature, pending.signatureLabel], ['M0004', 'pending', 'signature en cours']);
});

test('a key seen before is never re-armed: A, B, then A leaves a stale Z unsigned; a forged key entry signs nothing old', async () => {
  const A = KEY, B = signerFrom(Buffer.alloc(32, 9), 'env');
  const t = await salon({ day: '2026-10-27', hour: 8 });
  t.ids.book = (await t.engine.run(addProduct, { name: 'Livre', price: 1000, vat: 550 }, t.asOwner())).id;
  t.clock.now = at('2026-10-27', 8, 30);
  await runTick(t, { signer: A });
  await runTick(t, { signer: B });
  await tillDay(t, '2026-10-27');
  // three days without a tick that signs: Z0001 goes stale while B is the key
  t.clock.now = at('2026-10-30', 19);
  const mark = t.engine.journal.length;
  await runTick(t, { signer: A });
  await runTick(t, { signer: B });
  await runTick(t, { signer: A });
  assert.deepEqual(t.engine.journal.slice(mark).filter((e) => e.type === 'tech.logged' || e.type === 'seal.signed').map((e) => e.type), [], 'A back is not a new key');
  assert.deepEqual(unsignedRefs(t.engine.state), ['Z0001']);
  // two deployments on one database: each signs what is fresh with its own key, neither logs itself again
  await tillDay(t, '2026-10-31');
  t.clock.now = at('2026-10-31', 19);
  await runTick(t, { signer: B });
  await runTick(t, { signer: A });
  const st = t.engine.state;
  assert.deepEqual([st.signatures.get('Z0002').kid, st.signKey.kid], [B.kid, B.kid]);
  assert.equal(evs(t, 'tech.logged').filter((e) => e.data.kind === 'key').length, 2);
  assert.deepEqual(unsignedRefs(st), ['Z0001']);
  // whoever writes the tail logs a key of their own, or the real key again with a backlog: the real key signs nothing old
  const forge = (data) => t.engine.run({ run(s, input, ctx) { ctx.emit('tech.logged', data); return {}; } }, {}, SYSTEM);
  await forge({ kind: 'key', kid: '0123456789abcdef', publicKey: '', source: 'env', backlog: [] });
  await forge({ kind: 'key', kid: A.kid, publicKey: A.publicKey, source: 'env', backlog: ['Z0001'] });
  const m2 = t.engine.journal.length;
  await runTick(t, { signer: A });
  await runTick(t, { signer: B });
  assert.equal(evs(t, 'seal.signed', m2).length + evs(t, 'tech.logged', m2).length, 0);
  assert.deepEqual(unsignedRefs(t.engine.state), ['Z0001']);
  assert.equal(t.engine.state.signKeys.get(A.kid).backlog.size, 0, 'the backlog of a key is the one it was first logged with');
  // a genuinely new key still gets its backlog
  const C = signerFrom(Buffer.alloc(32, 11), 'env');
  await runTick(t, { signer: C });
  assert.deepEqual(unsignedRefs(t.engine.state), []);
  assert.equal(t.engine.state.signatures.get('Z0001').late, true);
});

test('two builds on one database log each version once, not one entry per tick', async () => {
  const t = await salon();
  for (const b of ['aaaaaaa', 'bbbbbbb', 'aaaaaaa', 'bbbbbbb', 'aaaaaaa']) await runTick(t, { software: sw(b) });
  assert.deepEqual(evs(t, 'tech.logged').map((e) => e.data.to), ['1.0 (aaaaaaa)', '1.0 (bbbbbbb)']);
});

test('a fiscal year end moved during a year leaves no month out of every year', async () => {
  const t = await october();
  await tillDay(t, '2027-01-05');
  await tillDay(t, '2027-06-08');
  await tillDay(t, '2027-09-07');
  t.clock.now = at('2028-01-03', 10);
  const close = (month) => t.engine.run(closePeriod, { month }, t.asOwner());
  for (const m of ['2026-10', '2026-11', '2026-12']) await close(m);
  // from 2027 the year ends in June: January to June 2027 is a short year, after the one closed in December
  await t.engine.run(updateSettings, { fiscal: { yearEndMonth: 6 } }, t.asOwner());
  for (const m of ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05']) assert.equal((await close(m)).year, null);
  const june = await close('2027-06');
  const S1 = t.engine.state;
  const y2 = S1.periods.get(june.year.ref);
  assert.deepEqual([y2.period, y2.from, y2.to, y2.months.count], ['2027', '2027-01-01', '2027-06-30', 6]);
  // and back to December: July to December 2027, a second year ending in 2027; the key keeps the first
  await t.engine.run(updateSettings, { fiscal: { yearEndMonth: 12 } }, t.asOwner());
  for (const m of ['2027-07', '2027-08', '2027-09', '2027-10', '2027-11']) await close(m);
  const dec = await close('2027-12');
  const S2 = t.engine.state;
  const y3 = S2.periods.get(dec.year.ref);
  assert.deepEqual([dec.year.ref, y3.from, y3.to, y3.months.count], ['Y0003', '2027-07-01', '2027-12-31', 6]);
  assert.equal(S2.periodByKey.get('Y:2027'), y2);
  // every month in exactly one year, and the years add up to every Z
  const years = [...S2.periods.values()].filter((p) => p.kind === 'year');
  assert.equal(years.reduce((x, y) => x + y.months.count, 0), [...S2.periods.values()].filter((p) => p.kind === 'month').length);
  assert.equal(years.reduce((x, y) => x + y.totals.netTtc, 0), [...S2.closures.values()].reduce((x, z) => x + z.net, 0));
});

/* ---------------- scripts/replay-diff.mjs ---------------- */

test('replay-diff prints the same figures twice for a journal, and a changed Z total shows up', async () => {
  const t = await october();
  t.clock.now = at('2026-11-01', 5, 10);
  await runTick(t, { signer: KEY });
  const dir = mkdtempSync(join(tmpdir(), 'lx-replay-'));
  const lines = t.engine.journal.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(dir, 'a.jsonl'), lines);
  const script = new URL('../../scripts/replay-diff.mjs', import.meta.url).pathname;
  const run = (...a) => execFileSync(process.execPath, [script, ...a], { encoding: 'utf8' });
  const one = run(join(dir, 'a.jsonl')), two = run(join(dir, 'a.jsonl'));
  assert.equal(one, two);
  const out = JSON.parse(one);
  assert.deepEqual([out.journal.chain, out.z.count, out.z.grandTotal, out.z.recomputedMismatch], ['ok', 3, t.engine.state.grandTotal, []]);
  assert.deepEqual(out.periods.map((p) => [p.ref, p.net, p.perpetual.net]), [['M0001', t.engine.state.periods.get('M0001').totals.netTtc, t.engine.state.grandTotal]]);
  assert.equal(out.refunds.count, 1);
  assert.ok(!/Yanis|Martin|06 12/.test(one), 'figures only');
  // the export of Réglages › Données reads the same
  writeFileSync(join(dir, 'export.json'), JSON.stringify({ events: t.engine.journal }));
  assert.equal(run(join(dir, 'export.json')), one);
  writeFileSync(join(dir, 'a.json'), one);
  assert.match(run(join(dir, 'a.jsonl'), '--compare', join(dir, 'a.json')), /^no drift/);
  assert.equal(run(join(dir, 'a.jsonl'), '--json').trim(), JSON.stringify(out));
  // a copy whose Z of the 29th says 1 € more
  const forged = t.engine.journal.map((e) => (e.type === 'day.closed' && e.data.day === '2026-10-29' ? { ...e, data: { ...e.data, net: e.data.net + 100 } } : e));
  writeFileSync(join(dir, 'b.jsonl'), forged.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const b = JSON.parse(run(join(dir, 'b.jsonl')));
  assert.equal(b.z.net, out.z.net + 100);
  assert.deepEqual(b.z.recomputedMismatch, ['Z0002']);
  assert.match(b.journal.chain, /^broken at /);
  const cmp = spawnSync(process.execPath, [script, join(dir, 'b.jsonl'), '--compare', join(dir, 'a.json')], { encoding: 'utf8' });
  assert.equal(cmp.status, 1);
  assert.match(cmp.stdout, /^drift: .*z\.net/);
});
