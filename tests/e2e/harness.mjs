// Shared by the two end-to-end runners (run.mjs: the demo salon, prod.mjs: a fresh production salon).
// It starts the built app with scripts/dev.mjs (same routing as Vercel), runs scenarios in Chromium and reports.
//
// A scenario file in tests/e2e/demo/ or tests/e2e/prod/ is a module:
//   export default async ({ browser, h, page }) => { … throw to fail … }
//   export const viewport = { width: 390, height: 844 };   optional, for `page` (default 1440×900)
//   export const env = { LX_FAKE_NOW: '…' };                optional, extra server environment (demo clock, …)
// Each file gets its own server and its own data, so files never see each other's changes.
// h: { base, mode, owner, setup(), loginOwner(page), api(path, opts), newPage(opts), expectText(page, text), shot(page, name) }.
// Any JavaScript error on `page` or on a page from h.newPage() fails the scenario.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const SHOTS = process.env.SHOTS ? join(ROOT, '.lx-data', 'e2e') : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };

export function playwright() {
  try { return createRequire(import.meta.url)('playwright'); } catch {
    console.error('Playwright is missing: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}
export function requireBuild() {
  if (!existsSync(join(ROOT, 'dist', 'comptoir', 'index.html'))) { console.error('Build first: npm run build'); process.exit(2); }
}

/** A free port in 3100–3999, picked at random (several runs can share a machine). */
async function freePort() {
  for (let i = 0; i < 50; i++) {
    const port = 3100 + Math.floor(Math.random() * 900);
    const ok = await new Promise((done) => { const s = createServer().once('error', () => done(false)).listen(port, () => s.close(() => done(true))); });
    if (ok) return port;
  }
  throw new Error('no free port');
}

/** The built app on a random port, with the given environment. */
export async function startServer(env, args = []) {
  const port = await freePort();
  const base = 'http://localhost:' + port;
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'dev.mjs'), '--dist', '--port', String(port), ...args], {
    env: { ...process.env, NODE_ENV: 'test', PUBLIC_URL: base, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 160 && !ready; i++) {
    if (child.exitCode != null) throw new Error('the server stopped:\n' + log);
    try { ready = (await fetch(base + '/api/public/live')).ok; } catch { /* starting */ }
    if (!ready) await new Promise((r) => setTimeout(r, 250));
  }
  // a clear boot failure for this file, rather than every scenario failing on connection errors
  if (!ready) { child.kill(); throw new Error('the server did not answer in 40 s:\n' + log); }
  return { base, port, log: () => log, stop: () => new Promise((done) => { if (child.exitCode != null) return done(null); child.once('exit', done); child.kill(); }) };
}

export const expectText = async (page, text, timeout = 8000) => { await page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout }); };
export const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, name + '.png') }) : null);

/** Collects results; every scenario runs in fresh browser contexts whose JavaScript errors fail it. */
export function runner(browser) {
  const results = [];
  async function scenario(name, fn, { viewport = DESKTOP } = {}) {
    const errors = [], contexts = [];
    const newPage = async ({ viewport: vp = viewport } = {}) => {
      const ctx = await browser.newContext({ viewport: vp, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 });
      contexts.push(ctx);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text()); });
      return page;
    };
    const page = await newPage();
    const t0 = Date.now();
    try {
      await fn(page, page.context(), newPage);
      if (errors.length) throw new Error(errors.slice(0, 3).join('\n'));
      results.push({ name, ok: true, ms: Date.now() - t0 });
      console.log('  ✓ ' + name + ' (' + (Date.now() - t0) + ' ms)');
    } catch (e) {
      results.push({ name, ok: false, err: e.message });
      console.log('  ✗ ' + name + '\n    ' + String(e && e.stack && !e.message ? e.stack : e.message).split('\n').join('\n    '));
      if (SHOTS) await page.screenshot({ path: join(SHOTS, 'FAIL-' + name.replace(/\W+/g, '-') + '.png') }).catch(() => {});
    }
    for (const c of contexts) await c.close().catch(() => {});
    return results[results.length - 1].ok;
  }
  return { results, scenario };
}

/** A tiny cookie jar for calls made from Node (no browser): enough for the session cookie. */
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => k + '=' + v).join('; '),
    take(res) {
      for (const c of res.headers.getSetCookie()) {
        const [kv, ...attrs] = c.split(';');
        const i = kv.indexOf('=');
        const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
        if (!v || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) cookies.delete(k); else cookies.set(k, v);
      }
    }
  };
}

/**
 * The helpers handed to scenario files.
 * @param {{ base: string, mode: 'demo'|'production', owner: { name: string, email: string, password: string, pin?: string }, setupToken?: string }} o
 */
export function helpers({ base, mode, owner, setupToken }) {
  const cookies = jar();
  let ready = null;
  /** fetch from Node with this scenario's owner session; JSON bodies; never follows redirects unless asked. */
  async function api(path, opts = {}) {
    const { body, headers = {}, method = body !== undefined ? 'POST' : 'GET', redirect = 'manual', session = true } = opts;
    const h = { ...headers };
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    if (session && cookies.header()) h.cookie = cookies.header();
    const res = await fetch(base + path, { method, headers: h, redirect, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    cookies.take(res);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, json, text, headers: res.headers, location: res.headers.get('location') };
  }
  /** Production: create the owner (as the setup screen does) and keep the session. Demo: sign the owner in. Safe to call twice. */
  function setup() {
    if (!ready) ready = (async () => {
      if (mode === 'production') {
        const r = await api('/api/setup', { body: { token: setupToken, name: owner.name, email: owner.email, password: owner.password, pin: owner.pin } });
        if (r.ok) return;
        if (r.status !== 409) throw new Error('setup failed: ' + r.status + ' ' + r.text);
      }
      const r = await api('/api/auth/login', { body: { email: owner.email, password: owner.password } });
      if (!r.ok) throw new Error('owner login failed: ' + r.status + ' ' + r.text);
    })().catch((e) => { ready = null; throw e; });
    return ready;
  }
  /** Sign the owner in through the Comptoir's own screen (after setup in production). */
  async function loginOwner(page) {
    if (mode === 'production') await setup();
    await page.goto(base + '/comptoir');
    await page.fill('#li-e', owner.email);
    await page.fill('#li-p', owner.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.locator('#page-title h1').waitFor({ timeout: 10000 });
  }
  return { base, mode, owner, setup, loginOwner, api, expectText, shot };
}

/** Runs every tests/e2e/<dir>/*.mjs file, each against its own server from `boot(file module)`. */
export async function runFiles(browser, dir, { boot, scenario }) {
  const full = join(ROOT, 'tests', 'e2e', dir);
  if (!existsSync(full)) return;
  const files = readdirSync(full).filter((f) => f.endsWith('.mjs')).sort();
  for (const f of files) {
    const name = dir + '/' + basename(f, '.mjs');
    let mod;
    try { mod = await import(pathToFileURL(join(full, f)).href); } catch (e) { await scenario(name, () => { throw e; }); continue; }
    const fn = typeof mod.default === 'function' ? mod.default : null;
    if (!fn) { await scenario(name, () => { throw new Error(f + ' has no default export function'); }); continue; }
    let srv;
    try { srv = await boot(mod); } catch (e) { await scenario(name, () => { throw e; }); continue; }
    const ok = await scenario(typeof mod.name === 'string' ? name + ': ' + mod.name : name, async (page, ctx, newPage) => {
      await fn({ browser, h: { ...srv.h, newPage }, page, ctx });
    }, { viewport: mod.viewport || DESKTOP });
    if (!ok) console.log(srv.log().split('\n').filter((l) => /error|Error/.test(l)).slice(-10).map((l) => '    | ' + l).join('\n'));
    await srv.stop();
  }
}

export function report(results, logs = '') {
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed\n');
  if (failed.length && logs) console.log(logs.split('\n').filter((l) => /error|Error/.test(l)).slice(-10).join('\n'));
  return failed.length ? 1 : 0;
}
