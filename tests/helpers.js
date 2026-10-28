// Test fixture: a small salon on an in-memory store with a controllable clock.
import { createEngine } from '../server/core/engine.js';
import { memoryStore } from '../server/store/memory.js';
import { CAPS, capsOf } from '../server/domain/permissions.js';
import { instantOf } from '../shared/dates.js';
import { initialize } from '../server/commands/setup.js';
import { addStaff } from '../server/commands/team.js';
import { addService, addProduct, adjustStock } from '../server/commands/catalog.js';
import { addClient } from '../server/commands/clients.js';

// A Tuesday, so the salon is open.
export const DAY = '2026-11-03';
export const at = (day, h, m = 0) => instantOf(day, h * 60 + m);

export async function salon({ store = memoryStore(), day = DAY, hour = 10 } = {}) {
  const clock = { now: at(day, hour) };
  const engine = createEngine(store, { clock: () => clock.now, syncEveryMs: 0 });
  const sys = { actor: { t: 'system', id: 'test' }, caps: new Set(Object.keys(CAPS)) };
  const init = await engine.run(initialize, { mode: 'production', owner: { name: 'Patron', email: 'patron@test.fr' } }, sys);
  const owner = () => engine.state.staff.get(init.ownerId);
  const asOwner = () => ({ actor: { t: 'staff', id: init.ownerId }, staff: owner(), caps: capsOf(owner(), engine.state.settings) });
  const week = { 2: [[540, 780], [810, 1110]], 3: [[540, 1110]], 4: [[540, 1110]], 5: [[540, 1110]], 6: [[540, 1110]] };
  const ids = {};
  for (const name of ['Ali', 'Ben']) {
    const r = await engine.run(addStaff, { name, role: 'barber', schedule: week, commission: { service: 4000, product: 1000 } }, asOwner());
    ids[name] = r.id;
  }
  const svc = async (x) => (await engine.run(addService, x, asOwner())).id;
  ids.cut = await svc({ name: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' });
  ids.beard = await svc({ name: 'Coupe + barbe', category: 'Coupes', price: 3000, dur: 30 });
  ids.color = await svc({ name: 'Décoloration', category: 'Couleur', price: 6000, from: true, dur: 60 });
  ids.pack = await svc({ name: 'Abonnement 5 coupes', category: 'Abonnement', price: 8000, dur: 30, pack: { credits: 5, days: 70 } });
  ids.oil = (await engine.run(addProduct, { name: 'Huile', price: 1500, cost: 600 }, asOwner())).id;
  await engine.run(adjustStock, { id: ids.oil, delta: 10, reason: 'Stock initial' }, asOwner());
  ids.yanis = (await engine.run(addClient, { first: 'Yanis', last: 'Martin', phone: '06 12 34 56 78' }, asOwner())).id;
  const asStaff = (name) => {
    const st = engine.state.staff.get(ids[name]);
    return { actor: { t: 'staff', id: st.id }, staff: st, caps: capsOf(st, engine.state.settings) };
  };
  const asClient = { actor: { t: 'client', id: 'web' }, caps: new Set(), meta: { linkFor: (a) => 'https://x/r/' + a.code } };
  return { engine, clock, ids, sys, asOwner, asStaff, asClient, ownerId: init.ownerId, store };
}

/** Assert that a promise rejects with a DomainError of that code. */
export async function rejects(p, code) {
  try { await p; } catch (e) {
    if (e.code !== code) throw new Error(`expected ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error('expected rejection with ' + code);
}

/**
 * The demo's two monthly formules from before PAY-07 (Essentiel 34 €, 2 coupes classiques a month; Illimité 49 €, one cut
 * every 7 days), put back beside the salon's own: the tests of the monthly plans read them on the demo salon. rt: a
 * testRuntime (tests/api/client.js) on the demo.
 */
export async function legacyPlans(rt) {
  const { updateSettings } = await import('../server/commands/shop.js');
  const s = rt.engine.state;
  const owner = [...s.staff.values()].find((x) => x.role === 'owner');
  const slug = (k) => [...s.services.values()].find((x) => x.slug === k).id;
  const plans = [
    ...s.settings.membership.plans,
    { id: 'essentiel', name: 'Essentiel', price: 3400, cuts: 2, minDays: 0, serviceIds: [slug('cl')], blurb: '2 coupes classiques par mois, sans engagement.' },
    { id: 'illimite', name: 'Illimité', price: 4900, cuts: 0, minDays: 7, serviceIds: [slug('cl'), slug('cc')], blurb: 'Une coupe chaque semaine, contour de barbe compris.' }
  ];
  await rt.engine.run(updateSettings, { membership: { enabled: true, plans } }, { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s.settings) });
}
