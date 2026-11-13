// Go-live audit · readiness. A production salon started with nothing but its two secrets must work, and say in words
// what is not plugged in instead of failing: no Stripe, no SMS, no e-mail, no backup store, no cron, no domain. Each
// half-done configuration (a Stripe key without its webhook secret, a test key, a PUBLIC_URL without https) is named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, publicUrlProblem } from '../../server/http/runtime.js';
import { memoryStore } from '../../server/store/memory.js';
import { browser } from './client.js';
import { at } from '../helpers.js';

const DAY = '2026-11-03';
const BASE = { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789', SETUP_TOKEN: 'pose-13' };

async function production(env = {}) {
  const rt = await createRuntime({ env: { ...BASE, ...env }, clock: () => at(DAY, 10), store: memoryStore() });
  const owner = browser(rt);
  assert.equal((await owner.post('/api/setup', { token: 'pose-13', name: 'Gérant', email: 'gerant@salon.test', password: 'Architecte13!', pin: '1313' })).status, 200);
  return { rt, owner };
}

test('day one with zero external account: every screen of the Comptoir answers, and health says what is off, in words', async (t) => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { calls.push(String(url && url.url || url)); throw new Error('network call in a test: ' + url); });
  t.after(() => { globalThis.fetch = real; });
  const { rt, owner } = await production();
  const h = (await owner.get('/api/v1/health')).json;
  assert.equal(h.mode, 'production');
  assert.deepEqual(h.store, { kind: 'memory', durable: false });
  assert.equal(h.stripe.state, 'off');
  assert.equal(h.stripe.problem, '', 'no Stripe is a choice, not a breakdown');
  assert.equal(h.sms.provider, null);
  assert.equal(h.email.provider, null);
  assert.equal(h.tick.cron, false);
  assert.equal(h.backup.configured, false);
  assert.match(h.backup.problem, /BACKUP_KEY/);
  assert.equal(h.integrity.ok, true);
  assert.equal(h.publicUrlProblem, '');
  for (const re of [/Stripe n’est pas connecté/, /Aucun fournisseur SMS/, /Aucun fournisseur e-mail/, /SETUP_TOKEN est toujours défini/, /LX_SIGN_KEY/]) assert.ok(h.warnings.some((w) => re.test(w)), String(re));
  // what the owner opens on the first day: none of it may answer a server error
  const month = DAY.slice(0, 7);
  const pages = ['/api/v1/bootstrap', '/api/v1/system', '/api/v1/agenda?day=' + DAY, '/api/v1/drawer', '/api/v1/sales?day=' + DAY, '/api/v1/closures', '/api/v1/periods', '/api/v1/payments/online',
    '/api/v1/reports', '/api/v1/giftcards', '/api/v1/backups', '/api/v1/fiscal/log', '/api/v1/compta/vat?month=' + month, '/api/v1/compta/vat?month=' + month + '&csv=1', '/api/v1/compta/balances',
    '/api/v1/compta/entries?month=' + month + '&format=csv&provisional=1', '/api/v1/export?kind=sales', '/api/v1/export?kind=vat', '/api/v1/export?kind=commissions', '/api/v1/export?kind=payroll', '/api/v1/export?kind=journal',
    '/api/public/salon', '/api/public/live'];
  for (const p of pages) { const r = await owner.get(p); assert.equal(r.status, 200, p + ' → ' + r.status + ' ' + r.text.slice(0, 160)); }
  // the month's import file is refused in words while the month runs (never a 500)
  const fec = await owner.get('/api/v1/compta/entries?month=' + month + '&format=fec');
  assert.equal(fec.status, 409);
  assert.match(fec.json.error.message, /Novembre n’est pas terminé/);
  // what needs an account says so
  const sms = await owner.post('/api/v1/health/test-sms', { phone: '0612345678' });
  assert.equal(sms.status, 409);
  assert.match(sms.json.error.message, /Aucun fournisseur SMS/);
  // no CRON_SECRET: the scheduler's address is closed, not open to anyone
  assert.equal((await browser(rt).get('/api/cron/tick')).status, 401);
  assert.deepEqual(calls, [], 'nothing left the server');
});

test('a half-done Stripe setup is named: the key without its webhook secret, then a test key', async () => {
  const half = await production({ STRIPE_SECRET_KEY: 'sk_live_x' });
  const h1 = (await half.owner.get('/api/v1/health')).json;
  assert.equal(h1.stripe.provider, 'simulated');
  assert.equal(h1.stripe.state, 'no_webhook_secret');
  assert.match(h1.stripe.problem, /STRIPE_WEBHOOK_SECRET/);
  const testKey = await production({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  const h2 = (await testKey.owner.get('/api/v1/health')).json;
  assert.equal(h2.stripe.state, 'test');
  assert.match(h2.stripe.problem, /clé de test/);
  const live = await production({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  const h3 = (await live.owner.get('/api/v1/health')).json;
  assert.deepEqual([h3.stripe.state, h3.stripe.problem, h3.stripe.live, h3.stripe.lastWebhook], ['live', '', true, null]);
  // the demo is its own word
  const demo = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => at(DAY, 10), store: memoryStore() });
  const b = browser(demo);
  assert.equal((await b.post('/api/auth/login', { email: 'gerant@larchitecte.fr', password: 'Architecte13' })).status, 200);
  assert.equal((await b.get('/api/v1/health')).json.stripe.state, 'demo');
});

test('PUBLIC_URL must be a bare https address: anything else is a warning before a single SMS leaves', async () => {
  assert.equal(publicUrlProblem(''), '');
  assert.equal(publicUrlProblem('https://barberlarchitecte.com'), '');
  assert.equal(publicUrlProblem('http://localhost:3000'), '');
  for (const bad of ['barberlarchitecte.com', 'http://barberlarchitecte.com', 'https://barberlarchitecte.com/site', 'https://barberlarchitecte.com/?x=1', 'www.barberlarchitecte.com/']) assert.match(publicUrlProblem(bad), /PUBLIC_URL/, bad);
  const { rt, owner } = await production({ PUBLIC_URL: 'barberlarchitecte.com' });
  assert.ok(rt.warnings.some((w) => /^PUBLIC_URL doit être/.test(w)));
  const h = (await owner.get('/api/v1/health')).json;
  assert.match(h.publicUrlProblem, /https/);
  assert.equal(h.publicUrlCustom, false);
  const fine = await production({ PUBLIC_URL: 'https://barberlarchitecte.com/' });
  assert.ok(!fine.rt.warnings.some((w) => /PUBLIC_URL/.test(w)), 'a trailing slash is taken off, not a fault');
});

test('a real salon on no durable store is told, wherever it runs; the e-mail and WhatsApp halves too', async () => {
  const rt = await createRuntime({ env: { LX_MODE: 'production', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => at(DAY, 10) });
  assert.equal(rt.store.kind, 'memory');
  assert.ok(rt.warnings.some((w) => /Aucun stockage durable/.test(w)), rt.warnings.join(' | '));
  const demo = await createRuntime({ env: { LX_MODE: 'demo', SESSION_SECRET: 'test-secret-0123456789' }, clock: () => at(DAY, 10) });
  assert.ok(!demo.warnings.some((w) => /Aucun stockage durable/.test(w)), 'a local demo in memory is fine');
  const mail = await createRuntime({ env: { ...BASE, EMAIL_FROM: 'pas une adresse' }, clock: () => at(DAY, 10), store: memoryStore() });
  assert.ok(mail.warnings.some((w) => /EMAIL_FROM n’est pas une adresse/.test(w)));
  assert.equal(mail.email, null);
  const sms = await createRuntime({ env: { ...BASE, SMS_PROVIDER: 'brevo' }, clock: () => at(DAY, 10), store: memoryStore() });
  assert.ok(sms.warnings.some((w) => /SMS_PROVIDER=brevo sans ses identifiants/.test(w)));
  assert.equal(sms.sms, null);
});

test('docs/mise-en-ligne.md names every variable the server reads, the Stripe events the webhook handles, and links that exist', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const page = read('docs/mise-en-ligne.md');
  // every production variable of server/http/runtime.js (the development-only and fine-tuning ones stay in operations.md)
  const DEV = new Set(['LX_DATA_FILE', 'LX_FAKE_NOW', 'LX_INSECURE_COOKIES', 'LX_BLOB_PREFIX', 'LX_BLOB_ACCESS', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SMSGATE_URL', 'WHATSAPP_API_VERSION', 'WHATSAPP_PARAMS']);
  const vars = new Set([...read('server/http/runtime.js').matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]).filter((v) => !DEV.has(v)));
  assert.ok(vars.size >= 15, [...vars].join(', '));
  for (const v of vars) assert.ok(page.includes('`' + v) || page.includes(v + '`') || page.includes('`' + v + '`'), 'docs/mise-en-ligne.md does not say what breaks without ' + v);
  // the events Réglages › Paiements gives to copy, word for word
  const ui = read('web/src/comptoir/pages/reglages/sections/Paiements.tsx');
  const events = [...ui.slice(ui.indexOf('WEBHOOK_EVENTS'), ui.indexOf('];', ui.indexOf('WEBHOOK_EVENTS'))).matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
  assert.ok(events.length >= 9);
  for (const e of events) assert.ok(page.includes('`' + e + '`'), 'the page does not list ' + e);
  assert.ok(page.includes('/api/pay/stripe/webhook'));
  // its links
  const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
  for (const [, file, id] of page.matchAll(/\]\(([\w-]+\.md)#([\w-]+)\)/g)) {
    const anchors = new Set([...read('docs/' + file).matchAll(/^#{1,6} (.+)$/gm)].map(([, h]) => slug(h)));
    assert.ok(anchors.has(id), 'docs/' + file + ' has no heading #' + id);
  }
  // and it says, as every screen does, that this is not the legal till
  assert.match(page, /caisse de gestion/);
  assert.match(page, /Z fiscal/);
});
