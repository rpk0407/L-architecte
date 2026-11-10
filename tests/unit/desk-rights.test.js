// What the Comptoir's wording leans on (audit 02 · A3, D1): only the owner and the manager refund, so only they are told
// « l'acompte sera remboursé »; the desk edits every chair's agenda (it may close a barber's day with a block) without
// the `team` right (absences over several days stay the owner's, docs/security.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capsOf } from '../../server/domain/permissions.js';

const settings = (team = {}) => ({ team: { barberCheckout: true, barberAllAgenda: true, ...team } });
const caps = (role, team) => capsOf({ active: true, role }, settings(team));

test('refunds: the owner and the manager, never the desk nor a barber, whatever the toggles', () => {
  assert.ok(caps('owner').has('sale.refund'));
  assert.ok(caps('manager').has('sale.refund'));
  for (const team of [{}, { barberCheckout: false }, { barberAllAgenda: false }, { barberRebook: true }]) {
    assert.ok(!caps('desk', team).has('sale.refund'), 'desk');
    assert.ok(!caps('barber', team).has('sale.refund'), 'barber');
  }
});

test('the desk edits every chair (blocks, moves) and rings up, but holds no team right', () => {
  const d = caps('desk');
  for (const c of ['agenda.all', 'agenda.edit', 'sale.create', 'client.view', 'client.contact']) assert.ok(d.has(c), c);
  for (const c of ['team', 'closure', 'settings', 'report.shop']) assert.ok(!d.has(c), c);
  assert.ok(!caps('barber').has('agenda.edit'), 'a barber only manages his own chair');
});

test('someone inactive has no right at all', () => {
  assert.equal(capsOf({ active: false, role: 'owner' }, settings()).size, 0);
  assert.equal(capsOf(null, settings()).size, 0);
});
