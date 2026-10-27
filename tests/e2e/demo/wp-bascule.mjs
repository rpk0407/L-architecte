// Réglages › Reprendre WordPress › Jour J: once a first run is in, the card shows the ten steps in order: the first run done,
// the freeze to do; « C’est fait » records the freeze; the final sync only counts when it comes after it; « Ouvrir les envois »
// waits for it, asks, and records the switch. The network checks read « Démo ». Mise en route follows (Reprise WordPress,
// Nouveautés). Desktop and phone: nothing scrolls sideways, every target is at least 44 px. Screenshots with SHOTS=1.
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'Jour J: the card follows the run, the freeze, the final sync and the switch';

const FIX = join(ROOT, 'tests', 'fixtures');
const IDS = ['first-run', 'freeze', 'final-sync', 'cold-backup', 'dns', 'redirects', 'ancien', 'switch', 'app-password', 'licences'];

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);
  const drop = (file) => page.setInputFiles('.wp-drop input[type=file]', [join(FIX, file)]);
  const ready = async () => {
    await page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches'), null, { timeout: 15000 });
    const beard = page.getByRole('combobox', { name: 'Prestation pour « Coupe + barbe »' });
    if (await beard.count() && await beard.inputValue() === '') await beard.selectOption({ label: 'Coupe + taille de barbe' });
    const john = page.getByRole('combobox', { name: 'Barbier pour « John »' });
    if (await john.count() && await john.inputValue() === '') await john.selectOption({ label: 'JKut' });
    await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 15000 });
  };
  const step = (id) => page.locator('.jj-step[data-step="' + id + '"]');
  const state = (id) => step(id).getAttribute('data-state');
  const expectState = async (id, want) => {
    for (const t0 = Date.now(); Date.now() - t0 < 10000; await page.waitForTimeout(150)) if ((await state(id)) === want) return;
    throw new Error(id + ' should be ' + want + ', it is ' + (await state(id)));
  };

  await page.goto(h.base + '/comptoir/reglages/wordpress');
  await h.expectText(page, 'Exporte depuis WordPress');
  // no run yet: no card
  if (await page.locator('.jj').count()) throw new Error('the Jour J card shows before any run');

  await drop('wp-bookings-fr.csv');
  await h.expectText(page, 'Ce qui va être repris');
  await ready();
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();
  await h.expectText(page, 'Tout est compté ✓', 20000);

  // the card is at the top, with its ten steps in order
  await page.getByRole('heading', { name: 'Jour J' }).waitFor({ timeout: 8000 });
  const order = await page.locator('.jj-step').evaluateAll((li) => li.map((x) => x.getAttribute('data-step')));
  if (order.join() !== IDS.join()) throw new Error('steps: ' + order.join());
  const top = await page.evaluate(() => { const c = document.querySelector('.jj'); const w = document.querySelector('.wp'); return c && w ? [...w.children].indexOf(c) : -1; });
  if (top !== 0) throw new Error('the card is not first on the page (' + top + ')');
  await expectState('first-run', 'ok');
  await expectState('freeze', 'todo');
  await h.expectText(page, 'client');
  const first = await step('first-run').textContent();
  if (!/\d+ clients?, \d+ rendez-vous · \d+ \S+/.test(first)) throw new Error('first run line: ' + first);
  // the demo checks nothing on the network
  for (const id of ['dns', 'redirects', 'ancien']) {
    if (!/Démo/.test(await step(id).textContent())) throw new Error(id + ' does not read « Démo »');
  }
  // the switch waits for the freeze and a sync after it
  if (!(await step('switch').getByRole('button', { name: 'Ouvrir les envois' }).isDisabled())) throw new Error('« Ouvrir les envois » is open before the freeze');
  await page.locator('.jj').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-bascule-desktop');

  // « C'est fait » on the freeze
  await step('freeze').getByRole('button', { name: 'C’est fait' }).click();
  await expectState('freeze', 'ok');
  await h.expectText(page, 'WordPress est bloqué depuis le');
  const card = (await h.api('/api/v1/bascule')).json;
  if (!card.steps.find((x) => x.id === 'freeze' && x.state === 'ok')) throw new Error('the freeze is not recorded');
  // still no sync after it, the switch stays shut; « Synchroniser » leads to the file drop
  await expectState('final-sync', 'todo');
  await step('final-sync').getByRole('button', { name: 'Synchroniser' }).click();
  if (!(await page.evaluate(() => document.activeElement && document.activeElement.closest('.wp-drop')))) throw new Error('« Synchroniser » does not lead to the file drop');

  // the final sync: the same files again after the freeze (nothing new: recorded as a run of « déjà là »)
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Tout retirer' }).click();
  await drop('wp-bookings-fr.csv');
  await h.expectText(page, 'Tout est déjà repris');
  await ready();
  await page.getByRole('button', { name: 'Enregistrer la vérification (rien de nouveau)' }).click();
  await expectState('final-sync', 'ok');
  await h.expectText(page, 'après le gel');
  await expectState('switch', 'todo');
  const open = step('switch').getByRole('button', { name: 'Ouvrir les envois' });
  if (await open.isDisabled()) throw new Error('« Ouvrir les envois » stays shut after the final sync');

  // the ticks by hand
  await step('cold-backup').getByRole('button', { name: 'C’est fait' }).click();
  await expectState('cold-backup', 'ok');

  // the switch asks first
  await page.locator('.jj').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-bascule-ready-desktop');
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Confirmation' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expectState('switch', 'todo');
  await open.click();
  await dialog.getByRole('button', { name: 'Ouvrir les envois' }).click();
  await expectState('switch', 'ok');
  await h.expectText(page, 'Bascule faite le');
  // the day after and the month after only count once the switch is made
  await step('app-password').getByRole('button', { name: 'C’est fait' }).waitFor();
  await step('app-password').getByRole('button', { name: 'C’est fait' }).click();
  await expectState('app-password', 'ok');

  // the return plan is folded, with the CSV link
  const plan = page.locator('.jj-back');
  if (await plan.evaluate((d) => d.open)) throw new Error('the return plan is open');
  await plan.locator('summary').click();
  await h.expectText(page, 'Remets WordPress en route : réservation en ligne et rappels');
  const csv = await plan.getByRole('link', { name: /Télécharger les rendez-vous pris ici depuis la bascule/ }).getAttribute('href');
  if (csv !== '/api/v1/bascule/since') throw new Error('csv link ' + csv);
  const file = await h.api('/api/v1/bascule/since');
  if (file.status !== 200 || !/^date;heure;barbier;prestations;client;téléphone;e-mail;état;pris le/.test(file.text.replace(/^﻿/, ''))) throw new Error('csv: ' + file.status + ' ' + file.text.slice(0, 80));
  await plan.scrollIntoViewIfNeeded();
  await h.shot(page, 'wp-bascule-plan-desktop');

  // Mise en route follows: the takeover is done, and the switches that wait are listed
  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  const wp = page.locator('.mr-step[data-step="wordpress"]');
  await wp.waitFor();
  if (!/Bascule faite le/.test(await wp.textContent())) throw new Error('Mise en route › Reprise WordPress: ' + (await wp.textContent()));
  if (!/Jour J/.test(await wp.textContent())) throw new Error('no way to Jour J');
  await page.getByRole('region', { name: 'Nouveautés' }).waitFor();
  if (!(await page.locator('.mr-feat[data-feature="membership"]').count())) throw new Error('Nouveautés lists no membership row');
  // each row leads to its setting
  await page.getByRole('link', { name: 'Réglage : Abonnements' }).click();
  await page.waitForURL(/\/comptoir\/reglages\/paiements$/);
  await page.goBack();
  await page.getByRole('region', { name: 'Nouveautés' }).waitFor();
  if ((await page.locator('.mr-step').count()) !== 14) throw new Error('Mise en route should still list 14 steps');
  await page.getByRole('region', { name: 'Nouveautés' }).scrollIntoViewIfNeeded();
  await h.shot(page, 'mise-en-route-nouveautes-desktop');

  // a phone: one column, full-width buttons, targets of 44 px, nothing sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(h.base + '/comptoir/reglages/wordpress');
  await page.getByRole('heading', { name: 'Jour J' }).waitFor({ timeout: 8000 });
  await page.locator('.jj-back summary').click().catch(() => {});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('Jour J scrolls sideways on a phone');
  const small = await page.evaluate(() => [...document.querySelectorAll('.jj button, .jj a.btn, .jj summary, .jj input')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => (b.textContent || b.id).trim().slice(0, 30)));
  if (small.length) throw new Error('targets under 44 px: ' + small.join(' | '));
  await page.locator('.jj').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-bascule-phone');
  await page.goto(h.base + '/comptoir/reglages/mise-en-route');
  await page.getByRole('region', { name: 'Nouveautés' }).scrollIntoViewIfNeeded();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('Nouveautés scrolls sideways on a phone');
  const tiny = await page.evaluate(() => [...document.querySelectorAll('.mr-feat a')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent));
  if (tiny.length) throw new Error('Nouveautés: targets under 44 px: ' + tiny.join(' | '));
  await h.shot(page, 'mise-en-route-nouveautes-phone');
};
