// The demo's journal stays small enough to replay on a cold start (PAY-02, kept green by every wave): the seeded salon
// in at most 8 000 events, and a fresh instance rebuilding its state from the store in at most a second. Prints both.
// Also what the seed promises of the membership: sixteen members, the salon's weekly formule, a running MRR, and (PAY-07)
// a board with someone to call: three not come this week, one of them missing last week too, one in grace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoJournal } from '../../server/domain/seed.js';
import { memoryStore } from '../../server/store/memory.js';
import { createEngine } from '../../server/core/engine.js';
import { statusIn, mrr, weeksOf } from '../../server/domain/membership.js';
import { membershipSummary } from '../../server/http/routes-membership.js';
import { at } from '../helpers.js';
import { weekStart } from '../../shared/dates.js';

const MAX_EVENTS = 8000, MAX_REPLAY_MS = 1000;

test('the seeded demo journal fits the budget: ≤ 8 000 events, a cold replay ≤ 1 s', async () => {
  const now = at('2026-10-27', 15, 10); // the Tuesday afternoon the end-to-end tests use
  const journal = await buildDemoJournal(now);
  const store = memoryStore();
  const seed = createEngine(store, { clock: () => now, syncEveryMs: 0 });
  assert.equal(await seed.adopt(journal), true);
  // a cold start: a new instance reads the whole journal from the store and folds it
  const t0 = performance.now();
  const cold = createEngine(store, { clock: () => now, syncEveryMs: 0 });
  await cold.sync(true);
  const ms = performance.now() - t0;
  console.log(`[journal-budget] ${journal.length} events (max ${MAX_EVENTS}), cold replay ${ms.toFixed(0)} ms (max ${MAX_REPLAY_MS})`);
  assert.equal(cold.state.version, journal.length);
  assert.ok(journal.length <= MAX_EVENTS, journal.length + ' events');
  assert.ok(ms <= MAX_REPLAY_MS, ms.toFixed(0) + ' ms');

  // the membership as the demo shows it: 12 running, 1 in grace, 1 ending, 2 ended
  const s = cold.state;
  assert.equal(s.settings.membership.enabled, true);
  // PAY-07: one formule, 80 € a month, one cut a week, a missed week lost (cuts and minDays derived)
  assert.deepEqual(s.settings.membership.plans.map((p) => [p.name, p.price, p.rhythm, p.perWeek, p.missed, p.cuts, p.minDays]), [['Hebdo', 8000, 'week', 1, 'lost', 0, 1]]);
  const count = {};
  for (const m of s.members.values()) { const st = statusIn(s, m, now); count[st] = (count[st] || 0) + 1; }
  assert.deepEqual(count, { active: 12, grace: 1, ending: 1, ended: 2 });
  assert.ok(mrr(s, now) > 0);
  assert.ok([...s.members.values()].some((m) => m.uses.length > 0), 'members had their cuts at 0 €');
  assert.ok([...s.members.values()].every((m) => m.rhythm === 'week' && m.perWeek === 1 && m.missed === 'lost'));
  const weeks = membershipSummary(s, now).weeks;
  assert.equal(weeks.members, 14);
  assert.equal(weeks.notYet, 3, 'three members have not come this week');
  assert.ok(weeks.rate >= 70 && weeks.rate < 100, 'most weeks attended: ' + weeks.rate + ' %');
  const day = '2026-10-27';
  const twice = [...s.members.values()].filter((m) => { const w = weeksOf(s, m, day).filter((x) => !x.future); return w.length >= 2 && !w[w.length - 1].came && !w[w.length - 2].came; });
  assert.equal(twice.length, 1, 'one member has missed two weeks running');
  // one a week: never two covered cuts in a calendar week
  for (const m of s.members.values()) assert.equal(new Set(m.uses.map((u) => weekStart(u.day))).size, m.uses.length);
  const carnet = [...s.services.values()].find((x) => x.pack);
  assert.deepEqual([carnet.name, carnet.category, carnet.online], ['Carnet 5 coupes', 'Carnet', false]);
});
