// The personal-data rule (INDEX › Shared contracts), kept by every wave: personal data travels in an event's pii,
// never in its chained data or actor, and every event that carries pii names the client file it belongs to
// (data.cid), so erasing that file reaches it. The few events that carry pii without a file are listed below, each
// with how its data is reached instead. Walked over the seeded demo, then over the payment flows (PAY-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, evolve } from '../../server/core/state.js';
import { DEMO } from '../../server/domain/seed.js';
import { createPayment } from '../../server/commands/payments.js';
import { browser, testRuntime } from '../api/client.js';
import { instantOf } from '../../shared/dates.js';

/**
 * pii without a client file, and why that is right: each entry holds only when its reason does, read on the state
 * just before the event (a booking under a name only, not any booking). A new entry needs the same: how erasure or
 * retention reaches it.
 * @type {Record<string, [string, (d: any, s: any) => boolean]>}
 */
const appt = (s, id) => (id && s.appts.get(id)) || null;
const NO_FILE = {
  'staff.added': ['a team member’s own e-mail (staff data, not a client’s; removed with the person by the owner)', () => true],
  'staff.updated': ['a team member’s own e-mail', () => true],
  'staff.credentials': ['password and PIN hashes of a team member', () => true],
  'staff.photo': ['a team member’s own photo (TEAM-02); a newer photo, its removal or his archiving redacts it (core/engine.js staffRedact)', () => true],
  'settings.updated': ['the owner’s own alert address and mobile (notify), addressed to the salon', () => true],
  'message.queued': ['a text or mail to someone with no file (a walk-in, a stranger on the waiting list, a gift card’s recipient, the owner about a name-only booking); retention drops it by its id',
    (d, s) => !(appt(s, d.apptId) || {}).clientId],
  'giftcard.issued': ['the buyer and recipient words typed at the till for a card sold without a file (or its reissue); the retention purge drops them by the card id',
    (d, s) => !(d.saleId && (s.sales.get(d.saleId) || {}).clientId) && !(d.reissueOf && (s.giftcards.get(d.reissueOf) || {}).cid)],
  'waitlist.added': ['a stranger on the waiting list, with no file yet; dropped by its id (retention purge)', (d) => !d.clientId],
  'queue.added': ['a walk-in’s name with no file; dropped by its id', (d) => !d.clientId],
  'appt.booked': ['a booking under a name only (no file); dropped by its id', (d) => !d.clientId],
  'appt.updated': ['a note or name on such a booking; dropped by its id', (d, s) => !(d.patch && d.patch.clientId) && !(appt(s, d.id) || {}).clientId],
  'appt.cancelled': ['the typed reason of a booking without a file; dropped by its id', (d, s) => !(appt(s, d.id) || {}).clientId],
  'sale.completed': ['a typed discount reason on a ticket without a client; dropped by its id', (d) => !d.clientId],
  'inquiry.received': ['a request from the site by someone with no file; dropped by its id (inquiry.erased)', () => true]
};
const PHONE = /(?<![\w])(?:\+33\s?|0)[1-9](?:[\s.]?\d{2}){4}(?![\w])/;
const MAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/i;
/** the salon's own public contact (Réglages › Le salon) is the business's, not a person's */
const PUBLIC = /^data\.(?:settings|patch)\.shop\./;

function leaves(x, path, out) {
  if (typeof x === 'string') out.push([path, x]);
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) leaves(v, path + '.' + k, out);
  return out;
}

/** Every breach of the rule in a journal, in words. */
function breaches(journal) {
  // the file rule reads the state just before each event; the names, the whole journal's clients
  const s = emptyState();
  const out = [];
  for (const e of journal) {
    const why = Object.hasOwn(NO_FILE, e.type) ? NO_FILE[e.type] : null;
    if (e.pii != null && !(e.data && e.data.cid) && !(why && why[1](e.data || {}, s))) out.push(e.type + ' v' + e.v + ': pii without data.cid (' + Object.keys(e.pii).join(', ') + ')');
    evolve(s, e);
  }
  const names = new Set(), firsts = new Set();
  for (const c of s.clients.values()) { if (c.first && c.first !== 'Client') firsts.add(c.first); if (c.first && c.last) names.add(c.first + ' ' + c.last); }
  // a whole value equal to a client's first name counts (a first name inside a sentence would be noise: « Tom » in « Tomber »)
  for (const e of journal) {
    for (const [path, v] of [...leaves(e.data, 'data', []), ...leaves({ n: e.actor.t === 'staff' ? '' : e.actor.n, id: e.actor.id }, 'actor', [])]) {
      if (PUBLIC.test(path)) continue;
      const why = PHONE.test(v) ? 'a phone number' : MAIL.test(v) ? 'an e-mail' : firsts.has(v.trim()) ? 'a client’s first name' : [...names].some((n) => v.includes(n)) ? 'a client’s name' : '';
      if (why) out.push(e.type + ' v' + e.v + ' ' + path + ': ' + why + ' in chained data (' + JSON.stringify(v).slice(0, 60) + ')');
    }
  }
  return out;
}

test('the seeded demo and the payment flows keep personal data out of the chain, each piece under its client file', async () => {
  const clock = { now: instantOf('2026-11-24', 15 * 60) };
  const rt = await testRuntime({ clock: () => clock.now });
  const s = rt.engine.state;
  assert.ok(rt.engine.journal.length > 1000, 'the demo is seeded');
  const seeded = breaches(rt.engine.journal);
  assert.deepEqual(seeded, [], seeded.join('\n'));

  // a deposit paid online, a card bought on /carte-cadeau, a QR at the till: the processor's ids stay out of the chain
  const site = browser(rt);
  const svc = [...s.services.values()].find((x) => x.active && x.online !== false && !x.pack && x.price >= 4000);
  const av = (await site.get('/api/public/availability?services=' + svc.id + '&days=7')).json;
  const day = av.days.find((d) => d.slots.length && d.day > av.days[0].day);
  const b = await site.post('/api/public/bookings', { serviceIds: [svc.id], staffId: day.slots[0].s, day: day.day, start: day.slots[0].m, first: 'Gaspard', last: 'Testeur', phone: '0611002233', email: 'gaspard@exemple.fr' });
  assert.equal(b.status, 201, b.text);
  assert.ok(b.json.payment, 'a deposit is asked');
  assert.equal((await site.post('/api/public/payments/' + b.json.payment.id + '/simulate', {})).status, 200);
  const gift = await site.post('/api/public/giftcards', { amount: 3000, buyer: { first: 'Octave', phone: '06 44 55 66 77', email: 'octave@exemple.fr' }, recipient: { first: 'Basile', phone: '06 77 66 55 44' }, message: 'Bon anniversaire', delivery: 'recipient' });
  assert.equal(gift.status, 201, gift.text);
  assert.equal((await site.post('/api/public/payments/' + gift.json.id + '/simulate', {})).status, 200);
  const owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  const qr = await owner.post('/api/v1/payments/qr', { amount: 2500, label: 'Coupe' });
  assert.equal(qr.status, 200, qr.text);
  assert.equal((await site.post('/api/public/payments/' + qr.json.id + '/simulate', {})).status, 200);
  await rt.engine.run(createPayment, { id: 'py_member', kind: 'deposit', amount: 1500, provider: 'simulated', providerRef: 'sim_member', label: 'x', cid: [...s.clients.keys()][0] }, { actor: { t: 'system', id: 'test' }, caps: new Set(['sale.create']) });
  assert.equal(rt.engine.journal.at(-1).data.cid, [...s.clients.keys()][0], 'a caller may name the file (a member’s)');

  const paid = rt.engine.journal.filter((e) => e.type === 'payment.succeeded');
  assert.ok(paid.length >= 3);
  for (const e of paid) assert.ok(!('customer' in e.data) && !('pm' in e.data), e.type + ' ' + JSON.stringify(e.data));
  const flows = breaches(rt.engine.journal);
  assert.deepEqual(flows, [], flows.join('\n'));

  // the nonce that salts the pii hash (core/journal.js) is not data: no file, no projection and no answer of the API carries it
  assert.ok(rt.engine.journal.filter((e) => e.pii != null).every((e) => /^[0-9a-f]{16}$/.test(e.pii._n)), 'every pii is sealed with its nonce');
  assert.deepEqual(nonceAt(rt.engine.state, 'state', new Set()), [], 'the nonce reached the projection');
  const cid = [...s.clients.keys()].find((id) => s.clients.get(id).phone);
  for (const path of ['/api/v1/clients', '/api/v1/clients/' + cid, '/api/v1/clients/' + cid + '/open', '/api/v1/export?kind=clients', '/api/v1/export?kind=journal', '/api/v1/audit', '/api/v1/bootstrap']) {
    const r = await owner.get(path);
    assert.equal(r.status, 200, path + ' ' + r.text.slice(0, 120));
    assert.ok(!/"_n"\s*:/.test(r.text), path + ' shows the nonce');
  }
});

/** where a pii nonce sits in a projection (any depth, maps and sets included) */
function nonceAt(x, path, seen) {
  if (!x || typeof x !== 'object' || seen.has(x)) return [];
  seen.add(x);
  const out = [];
  const kids = x instanceof Map ? [...x] : x instanceof Set ? [...x].map((v, i) => [i, v]) : Object.entries(x);
  for (const [k, v] of kids) { if (k === '_n') out.push(path + '._n'); out.push(...nonceAt(v, path + '.' + String(k), seen)); }
  return out;
}

test('the walk sees a breach: a name in chained data, pii without a file', () => {
  const base = { at: 1, h: 'h', p: 'p', actor: { t: 'system', id: 'x' } };
  const j = [
    { ...base, v: 1, id: 'e1', type: 'client.added', data: { id: 'cl_1', cid: 'cl_1' }, pii: { first: 'Yanis', last: 'Martin', phone: '+33612345678' } },
    { ...base, v: 2, id: 'e2', type: 'payment.created', data: { id: 'py_1', kind: 'qr', amount: 100, label: 'Coupe de Yanis Martin' } },
    { ...base, v: 3, id: 'e3', type: 'payment.succeeded', data: { id: 'py_1' }, pii: { customer: 'cus_1' } },
    { ...base, v: 4, id: 'e4', type: 'payment.failed', data: { id: 'py_1', reason: 'appelle le 06 12 34 56 78' } },
    // an allowed type is allowed only for its reason: this booking has a file, its client's text must name it
    { ...base, v: 5, id: 'e5', type: 'appt.booked', data: { id: 'ap_1', clientId: 'cl_1', cid: 'cl_1', day: '2026-11-03', start: 600, dur: 30, staffId: 'st_1', services: [], status: 'booked' } },
    { ...base, v: 6, id: 'e6', type: 'message.queued', data: { id: 'msg_1', channel: 'sms', template: 'confirmation', cid: null, apptId: 'ap_1' }, pii: { to: '+33612345678', body: 'À demain' } },
    { ...base, v: 7, id: 'e7', type: 'appt.booked', data: { id: 'ap_2', clientId: 'cl_1', day: '2026-11-03', start: 660, dur: 30, staffId: 'st_1', services: [], status: 'booked' }, pii: { note: 'x' } },
    { ...base, v: 8, id: 'e8', type: 'message.queued', data: { id: 'msg_2', channel: 'sms', template: 'queue', cid: null, apptId: null }, pii: { to: '+33698765432', body: 'C’est à toi' } }
  ];
  const out = breaches(j);
  assert.equal(out.length, 5, out.join('\n'));
  assert.match(out[0], /payment.succeeded v3: pii without data.cid/);
  assert.match(out[1], /message.queued v6: pii without data.cid/);
  assert.match(out[2], /appt.booked v7: pii without data.cid/);
  assert.match(out[3], /payment.created v2 data.label: a client’s name/);
  assert.match(out[4], /payment.failed v4 data.reason: a phone number/);
});
