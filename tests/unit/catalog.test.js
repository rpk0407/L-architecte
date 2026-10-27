import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects } from '../helpers.js';
import * as K from '../../server/commands/catalog.js';
import { serviceView } from '../../server/http/views.js';

const add = (t, x) => t.engine.run(K.addService, { category: 'Coupes', price: 2000, dur: 30, ...x }, t.asOwner());
const slugOf = (t, id) => t.engine.state.services.get(id).slug;

test('a service gets its site slug from its name, unique and at most 24 characters', async () => {
  const t = await salon();
  const a = await add(t, { name: 'Coupe classique' });
  assert.equal(slugOf(t, a.id), 'coupe-classique');
  const b = await add(t, { name: 'Coupe classique' });
  assert.equal(slugOf(t, b.id), 'coupe-classique-2');
  const c = await add(t, { name: '  Coupe   classique ! ' });
  assert.equal(slugOf(t, c.id), 'coupe-classique-3');
  // the helper salon already has a 'Décoloration' (slug derived the same way), so a second one is deduplicated
  assert.equal(slugOf(t, t.ids.color), 'decoloration');
  const d = await add(t, { name: 'Décoloration' });
  assert.equal(slugOf(t, d.id), 'decoloration-2');
  const long = await add(t, { name: 'Coupe + taille de barbe et soin complet' });
  const ls = slugOf(t, long.id);
  assert.equal(ls, 'coupe-taille-de-barbe-et');
  assert.ok(ls.length <= 24);
  const long2 = await add(t, { name: 'Coupe + taille de barbe et soin complet' });
  assert.equal(slugOf(t, long2.id), 'coupe-taille-de-barbe-2');
  assert.ok(slugOf(t, long2.id).length <= 24);
  const cut = await add(t, { name: 'Soin visage complet au charbon actif' });
  assert.equal(slugOf(t, cut.id), 'soin-visage-complet-au', 'cut at a dash, not in the middle of a word');
  const one = await add(t, { name: 'Shampooingdécolorationsoinbarbe' });
  assert.equal(slugOf(t, one.id), 'shampooingdecolorationso', 'one long word is still capped at 24');
  const odd = await add(t, { name: '€€ ++' });
  assert.equal(slugOf(t, odd.id), 'prestation', 'a name with no letter still gives a usable slug');
});

test('an explicit slug is kept, and refused when another service already has it', async () => {
  const t = await salon();
  assert.equal(slugOf(t, t.ids.cut), 'cl');
  await rejects(add(t, { name: 'Coupe enfant', slug: 'cl' }), 'slug_taken');
  const j = await add(t, { name: 'Coupe junior', slug: 'cj' });
  assert.equal(slugOf(t, j.id), 'cj');
});

test('updateService keeps the slug on a rename, changes it only when one is sent', async () => {
  const t = await salon();
  const a = await add(t, { name: 'Coupe junior' });
  await t.engine.run(K.updateService, { id: a.id, patch: { name: 'Coupe enfant', price: 1500 } }, t.asOwner());
  assert.equal(slugOf(t, a.id), 'coupe-junior', 'links already shared keep working');
  await t.engine.run(K.updateService, { id: a.id, patch: { slug: 'coupe-junior' } }, t.asOwner());
  assert.equal(slugOf(t, a.id), 'coupe-junior', 'sending its own slug is a no-op');
  await t.engine.run(K.updateService, { id: a.id, patch: { slug: 'enfant' } }, t.asOwner());
  assert.equal(slugOf(t, a.id), 'enfant');
  await rejects(t.engine.run(K.updateService, { id: a.id, patch: { slug: 'cl' } }, t.asOwner()), 'slug_taken');
  await rejects(t.engine.run(K.updateService, { id: a.id, patch: { slug: 'Pas Bon' } }, t.asOwner()), 'invalid');
});

test('the tag is optional, bounded, and reaches the site view', async () => {
  const t = await salon();
  const a = await add(t, { name: 'Coupe + taille de barbe', tag: 'La plus complète' });
  assert.equal(serviceView(t.engine.state.services.get(a.id)).tag, 'La plus complète');
  assert.equal(serviceView(t.engine.state.services.get(t.ids.cut)).tag, '');
  await rejects(add(t, { name: 'Trop long', tag: 'x'.repeat(31) }), 'invalid');
  await t.engine.run(K.updateService, { id: a.id, patch: { tag: '' } }, t.asOwner());
  assert.equal(serviceView(t.engine.state.services.get(a.id)).tag, '');
});

test('adding a service is idempotent: a retried request does not create a second slug', async () => {
  const t = await salon();
  const ctx = { ...t.asOwner(), requestId: 'req-junior-1' };
  const before = t.engine.state.services.size;
  const a = await t.engine.run(K.addService, { name: 'Coupe junior', category: 'Coupes', price: 1500, dur: 30 }, ctx);
  const b = await t.engine.run(K.addService, { name: 'Coupe junior', category: 'Coupes', price: 1500, dur: 30 }, { ...t.asOwner(), requestId: 'req-junior-1' });
  assert.equal(a.id, b.id);
  assert.equal(t.engine.state.services.size, before + 1);
  assert.equal(slugOf(t, a.id), 'coupe-junior');
});
