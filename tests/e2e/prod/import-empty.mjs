// Production: a new salon is not invited into a no-op. With an empty catalogue every booking would be « prestation inconnue »,
// so the page says what to do first (with the link) and the button stays shut; with services but no chair, the barbers'
// selects have nothing to pick, and the page says to create them in Équipe. Once both exist the button opens. The sentence
// under the button promises that nothing is sent before the switch.
// Run by tests/e2e/prod.mjs: export default async ({ h, page }), h = { base, setup(), loginOwner(page), api() }.
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'Réglages › Reprendre WordPress on a new salon: empty catalogue, no chair, then ready';

const FIX = join(ROOT, 'tests', 'fixtures');
const seen = (page, text, timeout = 10000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });
const call = (page, path, body) => page.evaluate(async ([p, b]) => {
  const r = await fetch(p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'e2e-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(b) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [path, body]);
const must = (r, what) => { if (r.status >= 300) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; };

export default async ({ h, page }) => {
  const base = h.base.replace(/\/$/, '');
  await h.loginOwner(page);
  const drop = () => page.setInputFiles('.wp-drop input[type=file]', [join(FIX, 'wp-qa', 'A01-plugin-fr-utf8bom-lf.csv')]);
  const settled = () => page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches') && !document.body.textContent.includes('Lecture de'), null, { timeout: 20000 });
  const button = () => page.locator('.wp-go button').first();
  const open = async () => { await page.goto(base + '/comptoir/reglages/wordpress'); await seen(page, 'Exporte depuis WordPress'); };

  // nothing in the catalogue: said at the top, with the way, and the button is shut
  await open();
  if (await page.getByText('Démo publique').count()) throw new Error('the demo banner on a production salon');
  await drop();
  await seen(page, 'Ton catalogue est vide');
  await settled();
  const link = page.locator('.note a', { hasText: 'Catalogue' }).first();
  await link.waitFor();
  if (!/\/comptoir\/catalogue/.test(await link.getAttribute('href'))) throw new Error('the link to the catalogue: ' + await link.getAttribute('href'));
  if (!(await button().isDisabled())) throw new Error('the import button is open over an empty catalogue');
  await seen(page, 'Aucun SMS ni e-mail n’est envoyé à l’import ni avant la bascule');
  if (await page.getByText('Les rappels partiront la veille').count()) throw new Error('the demo sentence on a production salon');
  await h.shot(page, 'wp-empty-catalogue-desktop');

  // services, but no chair: the barbers cannot be chosen, and the page says where to create them
  must(await call(page, '/api/v1/services', { name: 'Coupe classique', short: 'Coupe', category: 'Coupes', price: 2000, dur: 30, slug: 'cl' }), 'add cl');
  await open();
  await drop();
  await seen(page, 'Tu n’as encore aucun barbier');
  await settled();
  if (await page.getByText('Ton catalogue est vide').count()) throw new Error('the catalogue note stays once there is a service');
  const equipe = page.locator('.note a', { hasText: 'Équipe' }).first();
  await equipe.waitFor();
  if (!/\/comptoir\/equipe/.test(await equipe.getAttribute('href'))) throw new Error('the link to Équipe: ' + await equipe.getAttribute('href'));
  // the old names are listed, so the owner knows whom to create
  await seen(page, 'JKut');
  if (!(await button().isDisabled())) throw new Error('the import button is open with no chair');
  await h.shot(page, 'wp-no-chair-desktop');

  // a phone: the notes fit
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the notes scroll sideways on a phone');
  await h.shot(page, 'wp-no-chair-phone');
  await page.setViewportSize({ width: 1440, height: 900 });

  // the barbers exist: the notes go, the matching is offered, the button opens once every choice is made
  for (const name of ['JKut', 'Le Soldat']) must(await call(page, '/api/v1/staff', { name, role: 'barber' }), 'add ' + name);
  await open();
  await drop();
  await seen(page, 'Ce qui va être repris');
  await settled();
  if (await page.getByText('Tu n’as encore aucun barbier').count()) throw new Error('the chair note stays once the barbers exist');
  if (!(await button().isDisabled())) throw new Error('the button is open before the names are matched');
  for (const sel of await page.locator('.wp-row select').all()) {
    if ((await sel.inputValue()) !== '') continue;
    const v = await sel.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (v.length) await sel.selectOption(v[0]);
  }
  await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 15000 });
};
