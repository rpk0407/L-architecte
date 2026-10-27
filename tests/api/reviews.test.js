// REV-02 over HTTP: the request the tick sends carries /avis/<token>; that link records one opening (no personal data in
// the chain) and redirects to Google; a forged token or a link preview records nothing and still lands on Google; the
// owner's figures, the client file's line and the owner's test.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, browser } from './client.js';
import { at } from '../helpers.js';
import { DEMO } from '../../server/domain/seed.js';
import { signLink } from '../../server/auth/session.js';
import { dispatch } from '../../server/http/scheduler.js';

const DAY = '2026-11-03'; // a Tuesday
const clock = { now: at(DAY, 9, 0) };
let rt;
before(async () => { rt = await testRuntime({ clock: () => clock.now }); });

async function owner() {
  const b = browser(rt);
  assert.equal((await b.post('/api/auth/login', { email: DEMO.email, password: DEMO.password })).status, 200);
  return b;
}
const clicks = () => rt.engine.journal.filter((e) => e.type === 'review.clicked');
/** what Vercel does with /avis/:token (vercel.json): the one function, the path in ?route= */
const open = (b, token, headers) => b.get('/api/main?route=avis/' + encodeURIComponent(token), headers);

test('the visit, the text with its tracked link, one recorded opening, then Google', async () => {
  const b = await owner();
  const boot = (await b.get('/api/v1/bootstrap')).json;
  const google = boot.settings.shop.reviewUrl;
  const ali = boot.staff.find((x) => x.chair && x.active);
  const cut = boot.services.find((x) => x.active && !x.pack && x.price > 0 && !x.from);
  const a = await b.post('/api/v1/appointments', { client: { first: 'Rayane', phone: '06 98 76 54 32' }, serviceIds: [cut.id], staffId: ali.id, day: DAY, start: 540, force: true, seat: true });
  assert.equal(a.status, 200, a.text);
  clock.now = at(DAY, 9, 40);
  const sale = await b.post('/api/v1/sales', { apptId: a.json.id, lines: [{ kind: 'service', ref: cut.id }], payments: [{ method: 'card', amount: cut.price }] });
  assert.equal(sale.status, 200, sale.text);
  const appt = rt.engine.state.appts.get(a.json.id);

  // two hours later, the Comptoir's pulse carries the tick
  clock.now = at(DAY, 11, 41);
  rt.lastTick = 0;
  await b.get('/api/v1/pulse');
  await rt.ticking;
  // the demo's outbox leaves ten at a time, oldest first: empty it
  await dispatch(rt, 500);
  const m = [...rt.engine.state.messages.values()].find((x) => x.template === 'review' && x.apptId === appt.id);
  assert.ok(m, 'the request is queued');
  assert.equal(m.status, 'simulated', 'the demo sends nothing for real');
  const token = /https:\/\/salon\.test\/avis\/(\S+)$/.exec(m.body)?.[1];
  assert.equal(token, signLink(rt.secret, 'review', m.id));

  const before = clicks().length;
  const r1 = await open(b, token);
  assert.equal(r1.status, 302);
  assert.equal(r1.headers.get('location'), google);
  assert.equal(r1.headers.get('cache-control'), 'no-store');
  const r2 = await open(browser(rt), token);
  assert.equal(r2.status, 302);
  const mine = clicks().slice(before);
  assert.equal(mine.length, 1, 'once per message');
  // nothing personal in the chain: the message id, an anonymous actor, no pii
  assert.deepEqual(mine[0].data, { id: m.id });
  assert.equal(mine[0].pii, undefined);
  assert.deepEqual(mine[0].actor, { t: 'client', id: 'web', n: '' });
  assert.ok(!JSON.stringify(mine[0]).includes('98 76'));

  // the client file says it
  const cf = await b.get('/api/v1/reviews/client/' + appt.clientId);
  assert.equal(cf.status, 200);
  assert.equal(cf.json.last.status, 'sent');
  assert.equal(cf.json.last.opened, clock.now);
  assert.equal(rt.engine.verify().ok, true);
});

test('a forged token, a request that is not a review, a link preview: Google, and nothing recorded', async () => {
  const google = rt.engine.state.settings.shop.reviewUrl;
  const s = rt.engine.state;
  const unopened = [...s.messages.values()].find((m) => m.template === 'review' && !s.reviewClicks.has(m.id));
  const other = [...s.messages.values()].find((m) => m.template !== 'review');
  assert.ok(unopened && other);
  const b = browser(rt);
  const n = clicks().length;
  for (const token of [unopened.id + '.AAAAAAAAAAAAAAAAAAAAAA', 'nimporte-quoi', signLink('another-secret', 'review', unopened.id), signLink(rt.secret, 'receipt', unopened.id), signLink(rt.secret, 'review', other.id), signLink(rt.secret, 'review', 'msg_rev_inconnu')]) {
    const r = await open(b, token);
    assert.equal(r.status, 302, token);
    assert.equal(r.headers.get('location'), google);
  }
  const preview = await open(b, signLink(rt.secret, 'review', unopened.id), { 'user-agent': 'WhatsApp/2.23.20.0 A' });
  assert.equal(preview.status, 302);
  assert.equal(clicks().length, n, 'no opening recorded');
  assert.equal((await b.get('/api/avis/x.y')).status, 302, 'the direct path answers the same');
});

test('the owner sees the figures by barber; a barber does not; the test goes to the owner and counts nowhere', async () => {
  const b = await owner();
  const st = await b.get('/api/v1/reviews/stats?from=2026-10-01&to=' + DAY);
  assert.equal(st.status, 200);
  assert.ok(st.json.sent > 50, 'the demo has its history');
  assert.ok(st.json.opened > 0 && st.json.opened < st.json.sent);
  assert.equal(st.json.staff.reduce((t, x) => t + x.sent, 0), st.json.sent);
  assert.ok(st.json.staff.every((x) => x.name && x.id));
  const one = await b.get('/api/v1/reviews/stats?from=2026-10-01&to=' + DAY + '&staff=' + st.json.staff[0].id);
  assert.equal(one.json.sent, st.json.staff[0].sent);
  assert.equal((await b.get('/api/v1/reviews/stats?from=2026-10-09&to=2026-10-01')).status, 400);
  assert.equal((await browser(rt).get('/api/v1/reviews/stats?from=2026-10-01&to=' + DAY)).status, 401);

  const t = await b.post('/api/v1/reviews/test', { phone: '06 12 34 56 78' });
  assert.equal(t.status, 200, t.text);
  assert.equal(t.json.channel, 'sms');
  assert.equal(t.json.status, 'simulated');
  const m = [...rt.engine.state.messages.values()].find((x) => x.template === 'review' && !x.apptId && x.id.startsWith('msg_revtest_'));
  assert.ok(m && /https:\/\/salon\.test\/avis\/msg_revtest_/.test(m.body), m && m.body);
  const again = await b.get('/api/v1/reviews/stats?from=2026-10-01&to=' + DAY);
  assert.equal(again.json.sent, st.json.sent, 'the test is not a request');
  assert.equal((await b.post('/api/v1/reviews/test', { phone: '+44 7700 900123' })).status, 400);

  // a barber on the salon tablet
  const tab = await owner();
  await tab.post('/api/auth/device', { name: 'Tablette' });
  await tab.post('/api/auth/logout');
  const team = (await tab.get('/api/auth/state')).json.team;
  await tab.post('/api/auth/pin', { staffId: team.find((x) => x.name === 'Frank').id, pin: DEMO.pins.Frank });
  assert.equal((await tab.get('/api/v1/reviews/stats?from=2026-10-01&to=' + DAY)).status, 403);
  assert.equal((await tab.post('/api/v1/reviews/test', {})).status, 403);
});
