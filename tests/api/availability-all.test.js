// The site's one read of the free slots (GET /api/public/availability?all=1): every service sold online, « sans
// préférence » and barber by barber, must say exactly what asking service by service and barber by barber says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';

const DAY = '2026-11-03'; // a Tuesday

test('availability all=1: the same slots as one read per service and per barber', async () => {
  const clock = { now: at(DAY, 9, 0) };
  const rt = await testRuntime({ clock: () => clock.now });
  const site = browser(rt);
  const info = (await site.get('/api/public/salon')).json;
  // the first requests wake the salon's background work (the members' weekly visits get their slots): read once it is done
  let all = await site.get('/api/public/availability?days=14&all=1&fresh=1');
  assert.equal(all.status, 200, JSON.stringify(all.json));
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const again = await site.get('/api/public/availability?days=14&all=1&fresh=1');
    const same = JSON.stringify(again.json) === JSON.stringify(all.json);
    all = again;
    if (same && i > 1) break;
  }
  const j = all.json;
  assert.equal(j.from, DAY);
  const services = info.services.filter((x) => !x.pack);
  assert.ok(services.length > 1 && info.barbers.length > 1);
  // every service online is in one set, and only once
  const seen = j.sets.flatMap((x) => x.services).sort();
  assert.deepEqual(seen, services.map((x) => x.id).sort());
  let slots = 0;
  for (const sv of services) {
    const set = j.sets.find((x) => x.services.includes(sv.id));
    const one = (await site.get(`/api/public/availability?services=${sv.id}&from=${DAY}&days=14&staff=any&fresh=1`)).json;
    assert.equal(set.dur, one.dur);
    assert.deepEqual(set.days.map((d) => ({ day: d.day, open: d.open, slots: d.slots.map((x) => ({ m: x[0], s: j.staff[x[1]] })) })), one.days, sv.name + ' · sans préférence');
    for (const b of info.barbers) {
      const his = (await site.get(`/api/public/availability?services=${sv.id}&from=${DAY}&days=14&staff=${b.id}&fresh=1`)).json;
      const i = j.staff.indexOf(b.id);
      const mine = set.days.map((d) => ({ day: d.day, open: d.open, slots: d.slots.filter((x) => i >= 0 && (x[2] & (1 << i))).map((x) => ({ m: x[0], s: b.id })) }));
      assert.deepEqual(mine, his.days, sv.name + ' · ' + b.name);
      slots += his.days.reduce((t, d) => t + d.slots.length, 0);
    }
  }
  assert.ok(slots > 50, 'the demo has free slots to compare');
  // kept a few seconds by the network like the single read, never when asked fresh
  assert.equal((await site.get('/api/public/availability?days=14&all=1')).headers.get('cache-control'), 'public, max-age=0, s-maxage=5');
  assert.equal(all.headers.get('cache-control'), 'no-store');
});
