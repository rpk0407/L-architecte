// Production, the first hour: the setup screen says each mistake under its field, the agenda asks for the team instead
// of saying the salon is closed, and Réglages › Mise en route ticks the menu and the team as soon as they exist.
// Run by tests/e2e/prod.mjs on its own fresh salon.
export const name = 'first run: setup errors, “Ajoute ton équipe”, Mise en route ticks live';

const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Europe/Paris', deviceScaleFactor: 1 };
const until = async (what, fn, timeout = 10000) => {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await new Promise((r) => setTimeout(r, 200))) { if (await fn()) return; }
  throw new Error('timed out waiting for ' + what);
};
/** the error under one field of the setup form (Field: label, input, then the hint or the error) */
const errorOf = (page, id) => page.locator('.field', { has: page.locator('#' + id) }).locator('.hint.err');
const step = (page, id) => page.locator('.mr-step[data-step="' + id + '"]');
const done = async (page, id) => (await step(page, id).getAttribute('data-done')) === '1';

/** The setup screen on a phone, before anyone claims the salon. */
async function setupScreen(h, page) {
  await page.goto(h.base + '/comptoir');
  await h.expectText(page, 'Code d’installation (donné par ton prestataire)');
  if (await page.getByText('SETUP_TOKEN').count()) throw new Error('the setup screen still talks about SETUP_TOKEN');
  await page.fill('#su-t', 'pas-le-bon-code');
  await page.fill('#su-n', h.owner.name);
  await page.fill('#su-e', h.owner.email);
  await page.fill('#su-p', 'court');
  await page.getByRole('button', { name: 'Ouvrir le Comptoir' }).click();
  await errorOf(page, 'su-p').filter({ hasText: '10 caractères' }).waitFor({ timeout: 5000 });
  if (await errorOf(page, 'su-t').count()) throw new Error('the token is blamed before the server has seen it');
  await page.fill('#su-p', h.owner.password);
  await page.getByRole('button', { name: 'Ouvrir le Comptoir' }).click();
  await errorOf(page, 'su-t').filter({ hasText: 'Code d’installation incorrect' }).waitFor({ timeout: 5000 });
  if (await errorOf(page, 'su-p').count()) throw new Error('the password still shows an error');
  await h.shot(page, 'setup-errors');
}

export default async ({ browser, h, page }) => {
  // its own context: the wrong code is a 403 the console logs, which would fail the watched pages
  const sctx = await browser.newContext(PHONE);
  const setup = await sctx.newPage();
  const crashes = [];
  setup.on('pageerror', (e) => crashes.push(e.message));
  await setupScreen(h, setup);
  if (crashes.length) throw new Error('setup screen: ' + crashes[0]);
  await sctx.close();

  /* right after setup: no chair yet */
  await h.loginOwner(page);
  // the owner lands on Pilotage: its team card says what to do first, as the agenda does
  await page.goto(h.base + '/comptoir');
  await h.expectText(page, 'Ajoute ton équipe pour voir ses chiffres');
  await page.getByRole('button', { name: 'Ajouter l’équipe' }).waitFor();
  await page.getByRole('button', { name: 'Voir la mise en route' }).waitFor();
  await h.shot(page, 'pilotage-no-team');
  await page.goto(h.base + '/comptoir/agenda');
  await h.expectText(page, 'Ajoute ton équipe pour ouvrir l’agenda');
  if (await page.getByText(/Fermé/).locator('visible=true').count()) throw new Error('the agenda says « Fermé » while the salon only lacks its team');
  await h.shot(page, 'agenda-no-team');
  await page.getByRole('button', { name: 'Voir la mise en route' }).click();
  await page.waitForURL(/\/comptoir\/reglages\/mise-en-route$/);
  await step(page, 'team').waitFor();
  for (const id of ['menu', 'team']) if (await done(page, id)) throw new Error(id + ' is ticked on a fresh salon');
  if ((await page.locator('.mr-step').count()) !== 14) throw new Error('Mise en route should list 14 steps');
  // Réglages opens on it, at the top
  await page.goto(h.base + '/comptoir/reglages');
  await step(page, 'menu').waitFor();
  const first = (await page.locator('.rg-link').first().textContent()) || '';
  if (!first.includes('Mise en route')) throw new Error('the first Réglages section is ' + first);

  /* the old menu in one tap, a barber with his code */
  await page.goto(h.base + '/comptoir/catalogue');
  await page.getByRole('button', { name: 'Reprendre la carte de l’ancien site' }).click();
  await h.expectText(page, 'Ta carte est reprise');
  await page.goto(h.base + '/comptoir/equipe');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'am-n', null, { timeout: 5000 }).catch(() => {});
  await page.fill('#am-n', 'JKut');
  await page.fill('#am-p', '2468');
  await page.locator('.sheet').getByRole('button', { name: 'Ajouter', exact: true }).click();
  await h.expectText(page, 'JKut fait partie de l’équipe');

  /* the steps tick, the agenda opens */
  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  await step(page, 'menu').waitFor();
  await until('the menu and the team ticked', async () => (await done(page, 'menu')) && (await done(page, 'team')));
  // the old menu's eleven, less the carnet sold at the salon (PAY-04)
  await h.expectText(page, '10 prestations visibles sur le site');
  await h.expectText(page, '1 fauteuil, chacun avec son code');
  await h.shot(page, 'mise-en-route');
  await page.goto(h.base + '/comptoir/agenda');
  await page.locator('.ag-head').waitFor({ timeout: 8000 });
  if (await page.getByText('Ajoute ton équipe').count()) throw new Error('the agenda still asks for the team');
};
