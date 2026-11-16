// The « Formule Entretien 5 semaines » (the owner's words, 16 November 2026): one visit a week on a half-hour slot,
// shampooing, coupe, coiffage and the beard upkeep, five weeks for 80 €. What the till charges: one credit pays the cut
// (the classic one or the one with the beard contour), the beard upkeep done in the same visit is on the ticket at 0 €
// and takes no credit; alone, it is paid. And a salon that already has the old « Carnet 5 coupes » gets the new name and
// what it covers through the preset, once, after the owner confirms; a carnet already sold gains the beard too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salon, rejects } from '../helpers.js';
import { browser } from './client.js';
import { memoryStore } from '../../server/store/memory.js';
import { instantOf } from '../../shared/dates.js';

const card = (amount) => [{ method: 'card', amount }];
import { createRuntime } from '../../server/http/runtime.js';
import { addService, updateService } from '../../server/commands/catalog.js';
import * as S from '../../server/commands/sales.js';
import { packCover, offerOf } from '../../server/domain/formule.js';
import { presetPlan } from '../../server/commands/setup.js';
import { ARCHITECTE } from '../../server/presets/architecte.js';
import { clientCard } from '../../server/http/views.js';
import { capsOf } from '../../server/domain/permissions.js';

async function setup() {
  const t = await salon();
  const add = async (x) => (await t.engine.run(addService, x, t.asOwner())).id;
  t.ids.cc = await add({ name: 'Coupe + contour de barbe', category: 'Coupes', price: 2500, dur: 30, slug: 'cc' });
  t.ids.eb = await add({ name: 'Entretien barbe', category: 'Barbe', price: 1500, dur: 30, slug: 'eb' });
  t.ids.tb = await add({ name: 'Taille de barbe', category: 'Barbe', price: 1800, dur: 30, slug: 'tb' });
  t.ids.fo = await add({ name: 'Formule Entretien 5 semaines', category: 'Formule', price: 8000, dur: 30, slug: 'ab', pack: { credits: 5, days: 35, serviceIds: [t.ids.cut, t.ids.cc], withIds: [t.ids.eb], weekly: true, missed: 'lost' } });
  const cid = t.ids.yanis;
  return { ...t, cid, s: () => t.engine.state, run: (h, input, ctx) => t.engine.run(h, input, ctx || t.asOwner()) };
}
const pkOf = (t) => [...t.s().packs.values()].find((k) => k.clientId === t.cid);

test('a visit of the formule: the cut on one credit, the beard upkeep of the same visit at 0 € and no credit, a half-hour slot', async () => {
  const t = await setup();
  assert.equal(offerOf(t.s()).dur, 30, 'the visit is booked on half an hour');
  // visit 1: the formule is sold, the cut is its first credit, the beard upkeep is included
  const s1 = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'pack', ref: t.ids.fo }, { kind: 'service', ref: t.ids.cut, packId: 'new' }, { kind: 'service', ref: t.ids.eb }], payments: card(8000) });
  assert.equal(s1.totals.due, 8000);
  const pk = () => pkOf(t);
  assert.equal(pk().used, 1);
  const l1 = t.s().sales.get(s1.id).lines;
  assert.deepEqual(l1.map((l) => [l.kind, l.unit, l.net, !!l.packId]), [['pack', 8000, 8000, true], ['service', 0, 0, true], ['service', 0, 0, false]]);
  assert.equal(l1[2].name, 'Entretien barbe · inclus');
  assert.equal(l1[2].vat, l1[1].vat, 'same VAT as any service line');
  // visit 2: « Coupe + contour de barbe » is covered too, one credit
  const s2 = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.cc, packId: pk().id }], payments: card(0) });
  assert.equal(s2.totals.due, 0);
  assert.equal(pk().used, 2);
  // visit 3: the cut and the beard upkeep, whatever the order of the lines and whatever unit the screen sent
  const s3 = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.eb, unit: 1500 }, { kind: 'service', ref: t.ids.cut, packId: pk().id }], payments: card(0) });
  assert.equal(s3.totals.due, 0);
  assert.equal(pk().used, 3, 'the beard upkeep takes no credit');
  // one upkeep per visit: a second one on the same ticket is paid; so is another beard service
  const s4 = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.cut, packId: pk().id }, { kind: 'service', ref: t.ids.eb }, { kind: 'service', ref: t.ids.eb }, { kind: 'service', ref: t.ids.tb }], payments: card(3300) });
  assert.equal(s4.totals.due, 1500 + 1800);
  // alone, without a visit of the formule on the ticket, the upkeep is at its price, and never payable by a credit
  const s5 = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.eb }], payments: card(1500) });
  assert.equal(s5.totals.due, 1500);
  await rejects(t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.eb, packId: pk().id }], payments: card(0) }), 'pack_service');
  assert.equal(pk().used, 4);
  // the till's card of the client says what the formule covers and includes
  const view = clientCard(t.s(), t.s().clients.get(t.cid), new Set(['client.contact']), null, t.clock.now).packs[0];
  assert.deepEqual([view.serviceIds, view.withIds], [[t.ids.cut, t.ids.cc], [t.ids.eb]]);
});

test('a carnet sold before the change gains what the offer holds today, and never loses a right', async () => {
  const t = await setup();
  await t.run(updateService, { id: t.ids.fo, patch: { pack: { credits: 5, days: 35, serviceIds: [t.ids.cut], weekly: true, missed: 'lost' } } });
  await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'pack', ref: t.ids.fo }, { kind: 'service', ref: t.ids.cut, packId: 'new' }], payments: card(8000) });
  const pk = pkOf(t);
  assert.deepEqual(packCover(t.s(), pk), { ids: [t.ids.cut], withIds: [] });
  await rejects(t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.cc, packId: pk.id }], payments: card(0) }), 'pack_service');
  await t.run(updateService, { id: t.ids.fo, patch: { pack: { credits: 5, days: 35, serviceIds: [t.ids.cc], withIds: [t.ids.eb], weekly: true, missed: 'lost' } } });
  assert.deepEqual(packCover(t.s(), pk), { ids: [t.ids.cut, t.ids.cc], withIds: [t.ids.eb] }, 'what it was sold with, plus what the offer covers now');
  const x = await t.run(S.checkout, { clientId: t.cid, lines: [{ kind: 'service', ref: t.ids.cc, packId: pk.id }, { kind: 'service', ref: t.ids.eb }], payments: card(0) });
  assert.equal(x.totals.due, 0);
  // a carnet that covers every service (no list) stays so
  assert.deepEqual(packCover(t.s(), { serviceIds: [], serviceId: t.ids.fo }).ids, []);
});

test('the preset renames the old « Carnet 5 coupes » once, after the owner confirms; a name he typed himself is left alone', async () => {
  const clock = { now: instantOf('2026-11-17', 600) };
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' }, clock: () => clock.now, store: memoryStore() });
  const b = browser(rt);
  assert.equal((await b.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  const s = () => rt.engine.state;
  const bySlug = (k) => [...s().services.values()].find((x) => x.slug === k);
  await b.post('/api/v1/preset/apply', {});
  const ab = bySlug('ab');
  assert.equal(ab.name, 'Formule Entretien 5 semaines');
  // the salon of the first days: the old name, the old content, the owner's own « semaine sautée » setting and price
  const owner = [...s().staff.values()].find((x) => x.role === 'owner');
  const as = { actor: { t: 'staff', id: owner.id }, staff: owner, caps: capsOf(owner, s().settings) };
  await rt.engine.run(updateService, { id: ab.id, patch: { name: 'Carnet 5 coupes', short: 'Carnet', category: 'Carnet', tag: '16 € la coupe', includes: ['5 coupes, une par semaine', 'Sans la barbe'], price: 8500, pack: { credits: 5, days: 35, serviceIds: [bySlug('cl').id], weekly: true, missed: 'once' } } }, as);
  const today = '2026-11-17';
  let plan = presetPlan(s(), ARCHITECTE, { today });
  const line = plan.services.find((x) => x.slug === 'ab');
  assert.deepEqual([line.status, line.was, plan.count.updates, plan.count.services], ['update', 'Carnet 5 coupes', 1, 0]);
  const v0 = s().version;
  assert.equal(bySlug('ab').name, 'Carnet 5 coupes', 'reading the plan writes nothing');
  const r = await b.post('/api/v1/preset/apply', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.done.updates, 1);
  const now = bySlug('ab');
  assert.deepEqual([now.name, now.short, now.category, now.tag, now.slug, now.price], ['Formule Entretien 5 semaines', 'Entretien 5 sem.', 'Formule', '16 € la visite', 'ab', 8500]);
  assert.deepEqual(now.includes, ['Shampooing', 'Coupe', 'Coiffage', 'Entretien de barbe']);
  assert.deepEqual(now.pack, { credits: 5, days: 42, serviceIds: [bySlug('cl').id, bySlug('cc').id], withIds: [bySlug('eb').id], weekly: true, missed: 'once' }, 'his « reportable une fois » is kept');
  assert.deepEqual(rt.engine.journal.slice(v0).map((e) => e.type), ['service.updated']);
  // twice changes nothing; and a name of his own is never renamed
  const v1 = s().version;
  assert.equal((await b.post('/api/v1/preset/apply', {})).json.done.written, 0);
  assert.equal(s().version, v1);
  await rt.engine.run(updateService, { id: ab.id, patch: { name: 'Mon forfait barbe' } }, as);
  plan = presetPlan(s(), ARCHITECTE, { today });
  assert.deepEqual([plan.services.find((x) => x.slug === 'ab').status, plan.count.updates], ['exists', 0]);
  // the WordPress alias still sends the old title's bookings to the coupe classique
  assert.equal(plan.aliases['Formule Abonnement 80€ 5 rdv sur 5 semaines d’affilées'], bySlug('cl').id);
});
