// After the Z (even an early one) the day takes no more payments: the till's badge stops counting what is left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';

test('an early Z: the “À encaisser” badge drops to 0 while unpaid appointments remain', async () => {
  const rt = await testRuntime({ clock: () => at('2026-11-03', 15, 0) });
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const before = (await b.get('/api/v1/pulse')).json.badges.toPay;
  assert.ok(before > 0, 'the demo has clients waiting to pay at 15:00');
  if (rt.engine.state.drawer) assert.equal((await b.post('/api/v1/drawer/close', { counts: {}, note: 'Compté au test' })).status, 200);
  const z = await b.post('/api/v1/closures', { early: true });
  assert.equal(z.status, 200, JSON.stringify(z.json));
  const day = [...(rt.engine.state.apptsByDay.get('2026-11-03') || [])];
  assert.ok(day.some((id) => { const a = rt.engine.state.appts.get(id); return a && !a.saleId && ['booked', 'arrived', 'in_chair'].includes(a.status); }), 'appointments are still unpaid');
  assert.equal((await b.get('/api/v1/pulse')).json.badges.toPay, 0);
});
