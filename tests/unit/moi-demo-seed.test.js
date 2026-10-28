// The demo shows « Mes avantages » by itself (AC-03a): the client « Essayer avec un client de démo » opens holds a carnet
// still valid, sold by the seed at the till like any other, so the client-demo milestone needs no sale by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoJournal } from '../../server/domain/seed.js';
import { emptyState, evolve } from '../../server/core/state.js';
import { personaOf } from '../../server/commands/accounts.js';
import { meHome } from '../../server/domain/me.js';
import { fileIds } from '../../server/commands/clients.js';
import { at } from '../helpers.js';

test('the demo client holds a carnet in « Mes avantages »', async () => {
  const now = at('2026-11-06', 15, 10);
  const journal = await buildDemoJournal(now, { weeks: 2, ahead: 5 });
  const s = emptyState();
  for (const e of journal) evolve(s, e);
  const c = personaOf(s, now);
  assert.ok(c, 'the demo has its client');
  const home = meHome(s, c, fileIds(s, c), null, { now, today: '2026-11-06', origin: 'https://x', tokenFor: () => 't', receiptFor: () => '', demo: true });
  assert.equal(home.wallet.carnets.length, 1);
  const [k] = home.wallet.carnets;
  assert.ok(k.left > 0 && k.left <= k.total && k.expires > '2026-11-06', JSON.stringify(k));
  assert.ok(home.upcoming.length > 0, 'and a booking to come, the hero');
});
