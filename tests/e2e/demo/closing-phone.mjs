// End of the day on a phone (390×844): the drawer and the Z are within thumb reach, the big notes are
// folded away, and a Z with clients still due has to be asked for ("Je ferme plus tôt aujourd’hui").
//
// Loaded by the e2e harness (export default, against its demo salon on the Tuesday-afternoon clock), or alone:
//   npm run build && node tests/e2e/demo/closing-phone.mjs        (PORT=4320 by default, SHOTS=<dir> for screenshots)
// The scenario closes the demo day early, so it resets the demo salon when it is done.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const PHONE = { width: 390, height: 844 };
// For the harness: this scenario seals the shared demo day and then resets the demo salon (which signs
// every open session out), so it must run last or alone, never next to the till scenarios.
export const mutates = true;

export default async function closingPhone({ browser, h = {}, base } = {}) {
  const BASE = base || h.base || h.BASE;
  if (!browser || !BASE) throw new Error('closing-phone: needs { browser, h: { base } }');
  const ctx = await browser.newContext({ viewport: PHONE, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // the refused Z (409) is expected; anything else in the console is a bug
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)|409 \(Conflict\)/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = (name) => (process.env.SHOTS ? page.screenshot({ path: join(process.env.SHOTS, name + '.png'), fullPage: true }) : null);
  const api = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
  const visible = async (name) => {
    const btn = page.getByRole('button', { name, exact: true });
    await btn.waitFor({ timeout: 8000 });
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    if (!box || box.width <= 300) throw new Error(`"${name}" is ${box ? Math.round(box.width) : 0} px wide on a phone (expected > 300)`);
    if (box.x < 0 || box.x + box.width > PHONE.width) throw new Error(`"${name}" overflows the screen (${Math.round(box.x)} → ${Math.round(box.x + box.width)})`);
  };
  try {
    if (typeof h.loginOwner === 'function') await h.loginOwner(page);
    else if (typeof h.ownerLogin === 'function') await h.ownerLogin(page);
    else {
      await page.goto(BASE + '/comptoir');
      await page.fill('#li-e', 'gerant@larchitecte.fr');
      await page.fill('#li-p', 'Architecte13');
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await page.locator('#page-title h1').waitFor({ timeout: 10000 });
    }
    await page.goto(BASE + '/comptoir/caisse/cloture');
    await page.getByText('Le tiroir').first().waitFor({ timeout: 8000 });
    await visible('Compter la caisse');
    await visible('Clôturer la journée');
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the closing page scrolls sideways on a phone');
    await shot('closing-phone');

    // the count: 500 € and 200 € notes are folded behind "Gros billets"
    await page.getByRole('button', { name: 'Compter la caisse', exact: true }).click();
    await page.getByRole('dialog', { name: 'Comptage de la caisse' }).waitFor();
    if (await page.getByLabel('Nombre de 500 €').count()) throw new Error('500 € notes should be folded away');
    await page.getByRole('button', { name: /Gros billets/ }).click();
    await page.getByLabel('Nombre de 500 €').waitFor();
    await shot('closing-phone-count');
    await page.getByRole('button', { name: 'Annuler' }).click();

    // count to the cent (through the API, the same call the dialog makes), then try to close at 15:10
    const dr = await api('/api/v1/drawer');
    if (!dr.json.open) throw new Error('the demo drawer should be open in the afternoon');
    let left = dr.json.open.expected;
    const counts = {};
    for (const c of [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]) { const n = Math.min(10000, Math.floor(left / c)); if (n) { counts[c] = n; left -= n * c; } }
    const closed = await api('/api/v1/drawer/close', { counts });
    if (closed.status !== 200) throw new Error('drawer count refused: ' + JSON.stringify(closed.json));
    await page.reload();
    await visible('Clôturer la journée');
    await page.getByRole('button', { name: 'Clôturer la journée', exact: true }).click();
    const dlg = page.getByRole('dialog', { name: 'Clôturer plus tôt' });
    await dlg.getByText(/Il reste \d+ rendez-vous aujourd’hui/).waitFor({ timeout: 5000 });
    await shot('closing-phone-early');
    const wait = dlg.getByRole('button', { name: 'Attendre' });
    // the dialog focuses its default button just after opening
    await page.waitForFunction(() => document.activeElement && document.activeElement.textContent === 'Attendre', null, { timeout: 2000 }).catch(() => { throw new Error('"Attendre" should be the default button'); });
    await wait.click();
    await dlg.waitFor({ state: 'detached' });
    if ((await api('/api/v1/drawer')).json.closure) throw new Error('"Attendre" closed the day');

    await page.getByRole('button', { name: 'Clôturer la journée', exact: true }).click();
    await dlg.getByRole('button', { name: 'Je ferme plus tôt aujourd’hui' }).click();
    await page.getByText(/Journée close · laisse .* de fond pour demain/).waitFor({ timeout: 8000 });
    if (await page.getByRole('button', { name: 'Ouvrir la caisse' }).count()) throw new Error('"Ouvrir la caisse" is offered after the Z');
    await shot('closing-phone-closed');
    const after = await api('/api/v1/drawer');
    if (!after.json.closure || !after.json.closure.early) throw new Error('the Z should be marked early');
    const sv = (await api('/api/public/salon')).json.services.find((x) => x.dur === 30 && !x.pack);
    const av = await api('/api/public/availability?days=1&services=' + sv.id);
    if (av.json.days[0].slots.length) throw new Error('the site still offers ' + av.json.days[0].slots.length + ' slots after the Z');
    if (errors.length) throw new Error(errors.slice(0, 3).join('\n'));
  } finally {
    // leave a fresh demo salon for whatever runs next (the harness may own that: one reset, one sign-in)
    if (typeof h.reset === 'function') await h.reset();
    else await api('/api/v1/demo/reset', {}).catch(() => null);
    await ctx.close();
  }
}

/* ---------------- alone: its own demo server ---------------- */

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
  const PORT = Number(process.env.PORT || 4320);
  const BASE = 'http://localhost:' + PORT;
  if (process.env.SHOTS) mkdirSync(process.env.SHOTS, { recursive: true });
  const { chromium } = createRequire(import.meta.url)('playwright');
  const server = spawn(process.execPath, [join(ROOT, 'scripts', 'dev.mjs'), '--dist', '--memory', '--port', String(PORT)], {
    env: { ...process.env, NODE_ENV: 'test', LX_MODE: 'demo', LX_FAKE_NOW: '2026-10-27T15:10:00+01:00', PUBLIC_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  let code = 0;
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/api/public/live')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
    await closingPhone({ browser, h: { base: BASE } });
    console.log('  ✓ closing on a phone');
  } catch (e) {
    code = 1;
    console.log('  ✗ closing on a phone\n    ' + String(e && e.message).split('\n').join('\n    '));
    console.log(log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
  } finally {
    await browser.close();
    server.kill();
  }
  process.exit(code);
}
