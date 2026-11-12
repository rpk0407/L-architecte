// The site promises the reminder the salon really sends: GET /api/public/salon gives its hour and whether it is on
// (Réglages › Messages), and the booking pages read it instead of a hard-coded « la veille à 18 h ».
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

const clock = { now: at('2026-11-03', 10, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

test('the reminder hour and switch reach the public salon read, as the messages settings have them', async () => {
  const site = browser(rt);
  assert.deepEqual((await site.get('/api/public/salon')).json.reminder, { on: true, hour: 18 });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  assert.equal((await b.patch('/api/v1/settings', { messages: { reminderHour: 17 } })).status, 200);
  assert.deepEqual((await site.get('/api/public/salon')).json.reminder, { on: true, hour: 17 });
  assert.equal((await b.patch('/api/v1/settings', { messages: { reminder: false } })).status, 200);
  assert.deepEqual((await site.get('/api/public/salon')).json.reminder, { on: false, hour: 17 });
  // nothing else of the messages settings leaves (templates, quiet hours, countries)
  assert.deepEqual(Object.keys((await site.get('/api/public/salon')).json.reminder).sort(), ['hour', 'on']);
});

test('the booking pages read it: no page says « la veille à 18 h » by itself', () => {
  for (const f of ['public/refonte/express.js', 'public/refonte/planning.js', 'public/refonte/barbier.js', 'public/site.html']) {
    const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.ok(!/la veille à 18/.test(src), f + ' hard-codes the hour');
    assert.ok(/\.reminder\b/.test(src), f + ' reads salon.reminder');
    assert.ok(/(reminderOf\(\)|rem|R)\.on\b/.test(src), f + ' hides the sentence when reminders are off');
  }
});
