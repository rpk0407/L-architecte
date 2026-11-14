// The Accueil's card « Z du jour à faire » on a day the salon is closed (a fix after WP3): a ticket made on a closed
// Sunday (an online sale, a product sold at the door) does not ask for a Z that day, since nobody is at the till; it is
// not lost: from the next day it is a missed Z, which blocks as before. An open day keeps its card once it is over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, at } from '../helpers.js';
import { home } from '../../server/domain/home.js';
import { checkout } from '../../server/commands/sales.js';

const view = (t) => home(t.engine.state, t.engine.state.staff.get(t.ownerId), t.clock.now);
const z = (v) => v.cards.find((c) => c.id === 'z');
const sell = (t) => t.engine.run(checkout, { lines: [{ kind: 'product', ref: t.ids.oil, staffId: t.ids.Ali }], payments: [{ method: 'card', amount: 1500 }] }, t.asOwner());

test('card z: never « Z du jour à faire » on a day the salon is closed, even with a ticket that day', async () => {
  const t = await salon({ day: '2026-11-01', hour: 11 }); // a Sunday: the fixture's salon opens Tuesday to Saturday
  assert.equal(view(t).moment, 'ferme');
  assert.ok(!z(view(t)), 'closed, nothing at the till');
  await sell(t);
  for (const h of [11, 15, 20, 23]) {
    t.clock.now = at('2026-11-01', h);
    const v = view(t);
    assert.equal(v.moment, 'ferme');
    assert.ok(!z(v), 'closed Sunday at ' + h + ' h: no « Z du jour à faire »');
    assert.ok(!v.cards.some((c) => /Z du jour/.test(c.title)));
  }
  // Monday, closed too: Sunday's ticket is now a day without its Z, and that one does show (it blocks the next ones)
  t.clock.now = at('2026-11-02', 10);
  const mon = z(view(t));
  assert.equal(view(t).moment, 'ferme');
  assert.ok(mon, 'the ticket of the closed day is not lost');
  assert.match(mon.title, /Z de dimanche manquant/);
  assert.ok(!/du jour/.test(mon.title));
});

test('card z: an open day still gets « Z du jour à faire » once it is over, not before', async () => {
  const t = await salon({ day: '2026-11-03', hour: 11 }); // a Tuesday
  await sell(t);
  t.clock.now = at('2026-11-03', 15);
  assert.ok(!z(view(t)), 'the day is running');
  t.clock.now = at('2026-11-03', 19, 30);
  assert.equal(view(t).moment, 'apres');
  assert.equal(z(view(t)).title, 'Z du jour à faire');
});
