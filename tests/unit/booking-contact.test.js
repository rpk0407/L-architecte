// What the site asks of a client before it books (settings.booking.contact). 'phone' is the rule the salon started
// with: a number, the e-mail if he likes. 'email' is the salon that sends everything by e-mail: an address, the number
// if he likes; the file is the one that carries the address, and his confirmation and reminder go there.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from '../api/client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { addDays } from '../../shared/dates.js';

const DAY = '2026-11-17';
const clock = { now: at(DAY, 10, 0) };
let rt, sv, owner, n = 0;
before(async () => {
  rt = await testRuntime({ clock: () => clock.now });
  sv = [...rt.engine.state.services.values()].find((x) => x.active && x.online !== false && !x.pack && x.dur === 30);
  owner = browser(rt);
  assert.equal((await owner.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
});
const setContact = async (v) => assert.equal((await owner.patch('/api/v1/settings', { booking: { contact: v } })).status, 200);
/** one more free half hour, a few days out: each test books its own */
const slot = () => { const i = n++; return { serviceIds: [sv.id], staffId: 'any', day: addDays(DAY, 21 + Math.floor(i / 8)), start: 600 + (i % 8) * 30 }; };
/** books the next half hour that is still free (the demo salon is busy, and closed two days a week) */
const book = async (body) => {
  let r = null;
  for (let i = 0; i < 60; i++) {
    r = await browser(rt, { ip: '10.7.' + (n % 200) + '.' + (i + 1) }).post('/api/public/bookings', { ...slot(), ...body });
    if (r.status !== 409) break;
  }
  return r;
};
const apptOf = (r) => rt.engine.state.appts.get(rt.engine.state.apptByCode.get(r.json.code));
const fileOf = (r) => rt.engine.state.clients.get(apptOf(r).clientId);
const mailsTo = (to) => [...rt.engine.state.messages.values()].filter((m) => m.channel === 'email' && m.to === to);

test('by default the site says « phone », and a booking without a number is refused', async () => {
  const salon = await browser(rt).get('/api/public/salon');
  assert.equal(salon.json.booking.contact, 'phone');
  const r = await book({ first: 'Karim', email: 'karim@exemple.fr' });
  assert.equal(r.status, 400, r.text);
  assert.match(r.json.error.message, /^phone/);
  assert.equal((await book({ first: 'Karim', phone: '06 12 00 00 01' })).status, 201);
});

test('« email »: the address is asked, the number is welcome but not needed', async () => {
  await setContact('email');
  assert.equal((await browser(rt).get('/api/public/salon')).json.booking.contact, 'email');
  // no address, or one that is not an address: said in words the site can show under the field
  for (const body of [{ first: 'Nora' }, { first: 'Nora', phone: '06 12 00 00 02' }, { first: 'Nora', email: 'nora@' }]) {
    const r = await book(body);
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error.message, /^email : indique une adresse e-mail valide/);
  }
  // an address alone books; the file is new and carries it; the confirmation goes there
  const r = await book({ first: 'Nora', email: 'Nora.B@Exemple.fr' });
  assert.equal(r.status, 201, r.text);
  const c = fileOf(r);
  assert.equal(c.email, 'nora.b@exemple.fr');
  assert.equal(c.phone || '', '');
  assert.equal(mailsTo('nora.b@exemple.fr').length, 1, 'her confirmation');
  // a number that is not one is refused, an empty one is fine
  const bad = await book({ first: 'Nora', email: 'nora.b@exemple.fr', phone: '12' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.message, /^phone/);
});

test('« email »: the same address books again on the same file, whatever number is typed', async () => {
  await setContact('email');
  const a = await book({ first: 'Samir', email: 'samir@exemple.fr', phone: '06 12 00 00 03' });
  assert.equal(a.status, 201, a.text);
  const file = fileOf(a);
  assert.equal(file.phone, '+33612000003');
  const b = await book({ first: 'Samir', email: 'samir@exemple.fr' });
  assert.equal(b.status, 201, b.text);
  assert.equal(fileOf(b).id, file.id);
  const c = await book({ first: 'Samir', email: 'SAMIR@exemple.fr', phone: '06 12 00 00 99' });
  assert.equal(fileOf(c).id, file.id);
  assert.equal(fileOf(c).phone, '+33612000003', 'the file keeps its own number');
});

test('« email »: a number another file already carries is left off the new file, which keeps its own address', async () => {
  await setContact('phone');
  const first = await book({ first: 'Paul', phone: '06 12 00 00 04' });
  assert.equal(first.status, 201, first.text);
  const old = fileOf(first);
  await setContact('email');
  const r = await book({ first: 'Paul', email: 'paul@exemple.fr', phone: '06 12 00 00 04' });
  assert.equal(r.status, 201, r.text);
  const mine = fileOf(r);
  assert.notEqual(mine.id, old.id);
  assert.equal(mine.email, 'paul@exemple.fr');
  assert.equal(mine.phone || '', '');
  assert.equal(rt.engine.state.clientByPhone.get('+33612000004'), old.id, 'the number still leads to the first file');
  assert.equal(apptOf(r).phone || '', '');
});

test('back to « phone »: the rule the salon started with', async () => {
  await setContact('phone');
  assert.equal((await book({ first: 'Lina', email: 'lina@exemple.fr' })).status, 400);
  assert.equal((await owner.patch('/api/v1/settings', { booking: { contact: 'courrier' } })).status, 400);
});
