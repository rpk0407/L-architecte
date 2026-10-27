// Deposits by history: a 20 € cut never reaches the 50 € threshold, so the clients who miss never paid one.
// With riskBased, a client who already missed (insights.js risk) pays the usual percent online whatever the price,
// unless the salon trusts them (tag 'confiance', set by who edits every booking); production without Stripe still
// takes no deposit at all.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { salon, rejects, at } from '../helpers.js';
import { addDays } from '../../shared/dates.js';
import * as A from '../../server/commands/agenda.js';
import * as C from '../../server/commands/clients.js';
import { updateSettings } from '../../server/commands/shop.js';
import { updateService } from '../../server/commands/catalog.js';
import { depositFor, TRUSTED } from '../../server/domain/policy.js';
import { riskDeposit } from '../../server/domain/risk.js';
import { hashSecret } from '../../server/auth/password.js';
import { setCredentials } from '../../server/commands/team.js';
import { createRuntime } from '../../server/http/runtime.js';
import { browser } from '../api/client.js';

// two Tuesdays before the test day, when Yanis did not come
const MISSED = ['2026-10-20', '2026-10-27'];
const DAY = '2026-11-03';
const NEXT = addDays(DAY, 1);

/** The test salon, where Yanis (06 12 34 56 78) missed two cuts; the clock on DAY at 10 h. */
async function missedTwice() {
  const t = await salon({ day: MISSED[0], hour: 9 });
  for (const d of MISSED) {
    t.clock.now = at(d, 9);
    const a = await t.engine.run(A.createAppointment, { clientId: t.ids.yanis, serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: d, start: 600 }, t.asOwner());
    t.clock.now = at(d, 11);
    await t.engine.run(A.setStatus, { id: a.id, status: 'no_show' }, t.asOwner());
  }
  t.clock.now = at(DAY, 10);
  return t;
}
const book = (t, start, x = {}, ctx = t.asClient) => t.engine.run(A.bookOnline, { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start, first: 'Yanis', phone: '06 12 34 56 78', ...x }, ctx);
const riskOn = (t, on = true) => t.engine.run(updateSettings, { deposits: { riskBased: on } }, t.asOwner());
// as agenda.js bookOnline asks it, for a file found by phone
const quote = (t, services, clientId = null) => depositFor(t.engine.state, services, { risk: !!clientId && riskDeposit(t.engine.state, clientId, DAY) });

test('a client with 2 no-shows books a 20 € cut online: a 6 € deposit with riskBased, none with the tag confiance or the rule off', async () => {
  const t = await missedTwice();
  assert.equal(t.engine.state.settings.deposits.riskBased, false, 'off until the owner turns it on');
  // off: the threshold alone, as before
  const before = await book(t, 540);
  assert.deepEqual([before.status, before.deposit], ['booked', 0]);
  await t.engine.run(A.cancelAppointment, { id: before.id }, t.asOwner());

  await riskOn(t);
  const r = await book(t, 600);
  assert.equal(r.status, 'pending');
  assert.equal(r.deposit, 600, '30 % of 20 €');
  const a = t.engine.state.appts.get(r.id);
  assert.equal(a.deposit.amount, 600);
  assert.equal(a.clientId, t.ids.yanis, 'found by the phone, typed another way');
  assert.equal(a.deposit.until, t.clock.now + t.engine.state.settings.booking.pendingPayMin * 60000);

  // trusted: the salon's file says so, the threshold rule alone applies again
  await t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: [TRUSTED] } }, t.asOwner());
  const trusted = await book(t, 660);
  assert.deepEqual([trusted.status, trusted.deposit], ['booked', 0]);
  // trusted is not exempt from the threshold: a 60 € colour still asks its 18 €
  const colour = await book(t, 720, { serviceIds: [t.ids.color] });
  assert.deepEqual([colour.status, colour.deposit], ['pending', 1800]);

  // the rule off: booked, tag or not
  await t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: [] } }, t.asOwner());
  for (const id of [colour.id, trusted.id]) await t.engine.run(A.cancelAppointment, { id }, t.asOwner());
  await riskOn(t, false);
  const off = await book(t, 840);
  assert.deepEqual([off.status, off.deposit], ['booked', 0]);
});

test('who the rule asks: an existing file that missed, never a new number, a service without deposit or a mode without one', async () => {
  const t = await missedTwice();
  await riskOn(t);
  const cut = [{ id: t.ids.cut, price: 2000 }];
  assert.equal(riskDeposit(t.engine.state, t.ids.yanis, DAY), true);
  assert.equal(quote(t, cut, t.ids.yanis), 600);
  assert.equal(quote(t, cut), 0, 'no file, no history');

  // a new number: booked, and its file starts clean
  const fresh = await book(t, 540, { first: 'Nadir', phone: '0699887766' });
  assert.deepEqual([fresh.status, fresh.deposit], ['booked', 0]);

  // one absence before the third visit counts (insights.js risk), as on the client card's badge
  const once = (await t.engine.run(C.addClient, { first: 'Bilal', phone: '0655443322' }, t.asOwner())).id;
  t.clock.now = at(DAY, 9);
  const m = await t.engine.run(A.createAppointment, { clientId: once, serviceIds: [t.ids.cut], staffId: t.ids.Ben, day: DAY, start: 540 }, t.asOwner());
  t.clock.now = at(DAY, 10);
  await t.engine.run(A.setStatus, { id: m.id, status: 'no_show' }, t.asOwner());
  const b = await book(t, 600, { first: 'Bilal', phone: '0655443322', staffId: t.ids.Ben });
  assert.deepEqual([b.status, b.deposit], ['pending', 600]);

  // a service the owner set to "never a deposit" stays so; "Jamais" means never
  await t.engine.run(updateService, { id: t.ids.cut, patch: { deposit: 0 } }, t.asOwner());
  assert.equal(quote(t, cut, t.ids.yanis), 0);
  await t.engine.run(updateService, { id: t.ids.cut, patch: { deposit: null } }, t.asOwner());
  await t.engine.run(updateSettings, { deposits: { mode: 'none' } }, t.asOwner());
  assert.equal(quote(t, cut, t.ids.yanis), 0);
  // "Toujours": the same deposit for everyone
  await t.engine.run(updateSettings, { deposits: { mode: 'all' } }, t.asOwner());
  assert.equal(quote(t, cut), 600);
  // an erased file is nobody's history
  await t.engine.run(updateSettings, { deposits: { mode: 'threshold' } }, t.asOwner());
  await t.engine.run(C.eraseClient, { id: t.ids.yanis }, { ...t.asOwner(), meta: { tombKey: C.tombKeyOf('test-secret-0123456789') } });
  assert.equal(riskDeposit(t.engine.state, t.ids.yanis, DAY), false);
});

test('turning it on dates new CGV; trusting a client is for who edits every booking, not a barber', async () => {
  const t = await missedTwice();
  const v0 = t.engine.state.settings.shop.cgvVersion;
  await rejects(t.engine.run(updateSettings, { deposits: { riskBased: 'oui' } }, t.asOwner()), 'invalid');
  await riskOn(t);
  assert.equal(t.engine.state.settings.shop.cgvVersion, DAY, 'the deposit rules changed: the CGV in force are dated today');
  assert.ok(DAY >= v0);

  // a barber edits tags, but sparing a client the deposit is a money decision
  await rejects(t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: [TRUSTED] } }, t.asStaff('Ali')), 'forbidden');
  // nor a new file born trusted
  await rejects(t.engine.run(C.addClient, { first: 'Testeur', phone: '0611002233', tags: [TRUSTED] }, t.asStaff('Ali')), 'forbidden');
  assert.ok((await t.engine.run(C.addClient, { first: 'Testeur', phone: '0611002233', tags: ['Barbe'] }, t.asStaff('Ali'))).created);
  await t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: ['Barbe'] } }, t.asStaff('Ali'));
  await t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: [TRUSTED, 'Barbe'] } }, t.asOwner());
  // the barber's other tags leave it as it is, and he cannot take it off either
  await t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: [TRUSTED, 'Barbe', 'Enfant'] } }, t.asStaff('Ali'));
  await rejects(t.engine.run(C.updateClient, { id: t.ids.yanis, patch: { tags: ['Barbe'] } }, t.asStaff('Ali')), 'forbidden');
  assert.deepEqual(t.engine.state.clients.get(t.ids.yanis).tags, [TRUSTED, 'Barbe', 'Enfant']);
  assert.equal(riskDeposit(t.engine.state, t.ids.yanis, DAY), false);
});

test('production on the simulated provider: no deposit, even for a client who missed (GL-05 wins)', async () => {
  const t = await missedTwice();
  await riskOn(t);
  // the command alone, as the API calls it without Stripe
  const r = await book(t, 540, {}, { ...t.asClient, meta: { ...t.asClient.meta, payLive: false } });
  assert.deepEqual([r.status, r.deposit], ['booked', 0]);

  // and through the site's API on a production runtime over the same salon
  await t.engine.run(setCredentials, { id: t.ownerId, pwdHash: await hashSecret('Patron-1313!') }, t.asOwner());
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, store: t.store, clock: () => t.clock.now });
  const site = browser(rt);
  const salonInfo = (await site.get('/api/public/salon')).json;
  assert.deepEqual(salonInfo.payments, { provider: 'simulated', live: false });
  const res = await site.post('/api/public/bookings', { serviceIds: [t.ids.cut], staffId: t.ids.Ali, day: NEXT, start: 600, first: 'Yanis', phone: '0612345678' });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual([res.json.status, res.json.deposit, res.json.payment], ['booked', 0, null]);
  assert.equal([...rt.engine.state.payments.values()].length, 0, 'no checkout created');
});

/** The CGV's deposit sentence as public/pages.js writes it on /cgv from the salon's public answer. */
function cgvRule(deposits) {
  const el = { textContent: '', getAttribute: (k) => (k === 'data-f' ? 'depositRule' : null) };
  const document = {
    documentElement: { getAttribute: () => null, setAttribute() {} },
    querySelectorAll: (sel) => (sel === '[data-f]' ? [el] : []), querySelector: () => null
  };
  const salon = { shop: { name: 'Barber L’Architecte' }, booking: {}, deposits, services: [], payments: { provider: 'stripe', live: true } };
  let done;
  const ready = new Promise((r) => { done = r; });
  const fetch = () => Promise.resolve({ ok: true, json: () => salon });
  document.documentElement.setAttribute = () => done();
  vm.runInNewContext(readFileSync(new URL('../../public/pages.js', import.meta.url), 'utf8'), { document, fetch, location: { pathname: '/cgv' }, localStorage: null });
  return ready.then(() => el.textContent.replace(/\s/g, ' '));
}

test('the CGV say it only when the rule is on: the same deposit may be asked whatever the amount', async () => {
  const d = { mode: 'threshold', thresholdCents: 5000, percent: 30 };
  const on = await cgvRule({ ...d, riskBased: true });
  assert.match(on, /dont le total atteint 50 € demande un acompte d’environ 30 % du total/);
  assert.match(on, /en dessous, aucun, sauf pour un client qui a déjà manqué un rendez-vous sans prévenir : le même acompte peut alors lui être demandé quel que soit le montant\.$/);
  const off = await cgvRule({ ...d, riskBased: false });
  assert.match(off, /en dessous, aucun\.$/);
  assert.ok(!off.includes('manqué'));
  // "Toujours" asks everyone already: nothing to add
  assert.ok(!(await cgvRule({ ...d, mode: 'all', riskBased: true })).includes('manqué'));
});
