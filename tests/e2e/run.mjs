// End-to-end: the built app in a real browser, against a fresh demo salon on a fixed clock (a Tuesday afternoon).
//
//   npm run build && npm run test:e2e        (Chromium via Playwright: `npx playwright install chromium` once)
//   SHOTS=1 npm run test:e2e                  also saves screenshots in .lx-data/e2e/
//
// Every page is opened on desktop and on a phone, and any JavaScript error fails the run.
// Then every tests/e2e/demo/*.mjs scenario runs, each on its own demo salon (see harness.mjs for the format).
// The production salon (setup, the site at /, redirects) is covered by prod.mjs.
import { playwright, requireBuild, startServer, runner, helpers, runFiles, report, expectText, shot } from './harness.mjs';
import { DEMO } from '../../server/domain/seed.js';

const { chromium } = playwright();
requireBuild();

const DEMO_ENV = { LX_MODE: 'demo', LX_FAKE_NOW: '2026-10-27T15:10:00+01:00' };
const OWNER = { name: 'Gérant', email: DEMO.email, password: DEMO.password, pin: DEMO.ownerPin };
const server = await startServer(DEMO_ENV, ['--memory']);
const BASE = server.base;

const browser = await chromium.launch();
const { results, scenario } = runner(browser);

async function ownerLogin(page) { await helpers({ base: BASE, mode: 'demo', owner: OWNER }).loginOwner(page); }
async function api(page, path, body) {
  return page.evaluate(async ([p, b]) => {
    const r = await fetch(p, b ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) } : {});
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [path, body]);
}

const PAGES = [
  ['/comptoir', 'Aujourd’hui'], ['/comptoir/caisse', 'À encaisser'], ['/comptoir/caisse/ventes', 'Chiffre du jour'], ['/comptoir/caisse/cloture', 'Le tiroir'],
  ['/comptoir/clients', 'clients'], ['/comptoir/relances', 'à relancer'], ['/comptoir/relances/attente', 'En attente'], ['/comptoir/relances/envoyes', 'Derniers messages'],
  ['/comptoir/rapports', 'Objectif du mois'], ['/comptoir/equipe', 'Absences à venir'], ['/comptoir/catalogue', 'prestations'], ['/comptoir/catalogue/produits', 'Valeur du stock'],
  ['/comptoir/catalogue/cartes', 'En circulation'], ['/comptoir/reglages/compte', 'Code PIN'], ['/comptoir/reglages/salon', 'Coordonnées'], ['/comptoir/reglages/horaires', 'Semaine type'],
  ['/comptoir/reglages/reservation', 'Prise de rendez-vous'], ['/comptoir/reglages/paiements', 'Moyens acceptés'], ['/comptoir/reglages/messages', 'Envois automatiques'],
  ['/comptoir/reglages/equipe', 'Qui peut quoi'], ['/comptoir/reglages/objectifs', 'Objectif de chiffre'], ['/comptoir/reglages/appareils', 'Cet appareil'],
  ['/comptoir/reglages/donnees', 'Journal intact'], ['/comptoir/reglages/journal', 'Tout']
];

console.log('\nLe Comptoir · end-to-end on ' + BASE + '\n');

await scenario('owner: every page opens without error (desktop)', async (page) => {
  await ownerLogin(page);
  for (const [path, text] of PAGES) {
    await page.goto(BASE + path);
    try { await expectText(page, text); } catch { throw new Error(path + ': "' + text + '" not shown'); }
  }
  await page.goto(BASE + '/comptoir/clients');
  await page.locator('.cl-row').first().click();
  await expectText(page, 'Fiche technique');
  await page.goto(BASE + '/comptoir/equipe');
  await page.locator('.eq-card').nth(1).click();
  await expectText(page, 'Horaires de la semaine');
});

await scenario('owner: every page opens without error (phone)', async (page) => {
  await ownerLogin(page);
  for (const [path, text] of PAGES) {
    await page.goto(BASE + path);
    try { await expectText(page, text); } catch { throw new Error(path + ': "' + text + '" not shown'); }
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (wide) throw new Error(path + ': the page scrolls sideways on a phone');
  }
}, { viewport: { width: 390, height: 844 } });

await scenario('site: a client books online, the salon sees it', async (page) => {
  await page.goto(BASE + '/');
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so', { hasText: 'Coupe + taille de barbe' }).click();
  await page.locator('.bk button.wh').nth(1).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await page.locator('.bk button.sl').first().click();
  await page.fill('#f-first', 'Rayane');
  await page.fill('#f-phone', '0612345678');
  await page.locator('.bk-foot .btn').click();
  await expectText(page, 'C’est réservé, Rayane');
  const code = (await page.locator('.ok-code b').textContent()).trim();
  await shot(page, 'site-booked');
  await ownerLogin(page);
  const r = await api(page, '/api/v1/feed');
  if (!JSON.stringify(r.json).includes('Rayane')) throw new Error('booking ' + code + ' not in the salon feed');
}, { viewport: { width: 390, height: 844 } });

await scenario('site: deposit paid, the appointment is confirmed', async (page) => {
  await page.goto(BASE + '/site'); // the old address stays an alias of /
  await page.locator('.cta').first().click();
  await page.locator('.bk button.so', { hasText: 'Transformation' }).click();
  await page.locator('.bk button.wh').first().click();
  await page.locator('.bk .dc').nth(2).click();
  await page.locator('.bk button.sl').first().waitFor({ timeout: 8000 });
  await page.locator('.bk button.sl').first().click();
  await page.fill('#f-first', 'Inès');
  await page.fill('#f-phone', '0698765432');
  await page.locator('.bk-foot .btn').click();
  await expectText(page, 'Presque réservé');
  await page.locator('.pay-b .btn').click();
  await page.locator('.c-pay .c-btn').click();
  await page.waitForURL(/\/r\//, { timeout: 10000 });
  await expectText(page, 'Confirmé', 12000);
  await shot(page, 'deposit-confirmed');
  await page.getByRole('button', { name: 'Déplacer' }).click();
  await page.locator('.c-slots button').first().waitFor({ timeout: 8000 });
}, { viewport: { width: 390, height: 844 } });

await scenario('till: a finished appointment is paid by card', async (page) => {
  await ownerLogin(page);
  await page.goto(BASE + '/comptoir/caisse');
  await page.locator('.cs-list .li').first().click();
  await page.getByRole('button', { name: 'Carte Terminal de paiement' }).click();
  await page.getByRole('button', { name: /Valider l’encaissement/ }).click();
  await expectText(page, 'Encaissé');
  await shot(page, 'till-paid');
});

await scenario('barber: own scope only, no owner screens', async (page) => {
  await page.goto(BASE + '/comptoir');
  await page.getByRole('button', { name: /poste du salon/ }).click();
  await page.locator('.team button', { hasText: 'JKut' }).click();
  await page.locator('.keypad').waitFor();
  await page.keyboard.type('2468');
  await page.keyboard.press('Enter');
  await page.locator('#page-title h1').waitFor({ timeout: 10000 });
  const nav = await page.locator('nav').allTextContents();
  const all = nav.join(' ');
  if (/Équipe|Catalogue/.test(all)) throw new Error('a barber sees owner menus: ' + all);
  // the server refuses, whatever the screen shows (asked outside the page, so the 403 is not a page error)
  const r = await page.request.get(BASE + '/api/v1/settings');
  if (r.status() !== 403) throw new Error('settings API answered ' + r.status() + ' to a barber');
  await page.goto(BASE + '/comptoir/rapports');
  await expectText(page, 'Commission estimée');
});

await server.stop();

console.log('\n  demo scenarios (tests/e2e/demo)');
await runFiles(browser, 'demo', {
  scenario,
  boot: async (mod) => {
    const srv = await startServer({ ...DEMO_ENV, ...(mod.env || {}) }, ['--memory']);
    return { ...srv, h: { ...helpers({ base: srv.base, mode: 'demo', owner: OWNER }), demo: DEMO } };
  }
});

await browser.close();
process.exit(report(results, server.log()));
