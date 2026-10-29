// Réglages › Reprendre WordPress leaves a report: the French export dropped and imported, the report is on the server
// (it is the same after a reload) and adds up, the CSV downloads, then the delta export (one upcoming booking missing)
// cancels that booking and says so under « Pour info ». Screenshots of the report on a desktop and on a phone.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'WordPress report: counts that add up, kept across a reload, CSV, deleted bookings';

const FIX = join(ROOT, 'tests', 'fixtures');

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);
  const drop = (file) => page.setInputFiles('.wp-drop input[type=file]', [join(FIX, file)]);
  const ready = async () => {
    await page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches'), null, { timeout: 15000 });
    // the old « Coupe + barbe » has no namesake in the demo's catalogue: the owner picks one
    const beard = page.getByRole('combobox', { name: 'Prestation pour « Coupe + barbe »' });
    if (await beard.count() && await beard.inputValue() === '') await beard.selectOption({ label: 'Coupe + taille de barbe' });
    // John left the salon but has a booking to come: a chair is needed (the first time only)
    const john = page.getByRole('combobox', { name: 'Barbier pour « John »' });
    if (await john.count() && await john.inputValue() === '') await john.selectOption({ label: 'JKut' });
    await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 15000 });
  };
  /** The report's table as numbers: { Réservations: [source, repris, déjà, ignorés, hors], … } */
  const table = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.wr-table tr.wr-row')].map((tr) => [tr.querySelector('th').textContent.trim(), [...tr.querySelectorAll('td[data-label]')].map((td) => Number(td.textContent))])));

  await page.goto(h.base + '/comptoir/reglages/wordpress');
  await h.expectText(page, 'Exporte depuis WordPress');
  // the wizard says why not to export further back
  await h.expectText(page, 'la loi demande d’effacer les clients sans visite depuis 3 ans');
  await h.expectText(page, '27 octobre 2023');
  await drop('wp-bookings-fr.csv');
  await h.expectText(page, 'Ce qui va être repris');
  await ready();
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();

  // the report replaces the preview
  await h.expectText(page, 'Tout est compté ✓', 20000);
  await h.expectText(page, 'Terminée');
  const first = await table();
  // 14 bookings in the export: 13 made, none already there, the one in error skipped, none left out
  if (first['Réservations'].join() !== '14,13,0,1,0') throw new Error('bookings row: ' + JSON.stringify(first));
  await h.expectText(page, 'État « Erreur » sur l’ancien site');
  await page.locator('.wr').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-report-desktop');

  // the same tab, with no reload and no « Tout retirer »: the next drop starts from an empty list, so what the old site deleted since is seen
  await drop('wp-bookings-fr-delta.csv');
  await h.expectText(page, 'Ce qui va être repris');
  await h.expectText(page, 'Nouveau passage : les fichiers du précédent ont été retirés');
  const listed = await page.locator('.wp-files .li b').allTextContents();
  if (listed.join() !== 'wp-bookings-fr-delta.csv') throw new Error('the file list after a finished run: ' + listed.join(' | '));
  await h.expectText(page, '1 supprimé sur l’ancien site');
  await page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches'), null, { timeout: 15000 });
  if (await page.locator('.note.ok', { hasText: 'Tout est compté' }).count()) throw new Error('the old report still stands over the new drop');

  // the report is the server's: a reload shows the same
  await page.reload();
  await h.expectText(page, 'Tout est compté ✓', 15000);
  const again = await table();
  if (JSON.stringify(again) !== JSON.stringify(first)) throw new Error('the report changed after a reload: ' + JSON.stringify(again) + ' vs ' + JSON.stringify(first));
  const head = await page.locator('.wr h2, .wr .card-h h2').first().textContent();
  if (!/^Reprise du \d{1,2} [a-zéûô]+ à \d{2}:\d{2} · 1\sfichier/.test(head.trim())) throw new Error('header: ' + head);

  // the skipped rows can be opened by reason
  await page.getByRole('button', { name: 'Détail de réservations' }).click();
  await h.expectText(page, 'État « Erreur » sur l’ancien site');

  // the CSV: BOM, separator, columns, the reason of the skipped row
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger le rapport (CSV)' }).click()]);
  if (!/^reprise-wordpress-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}\.csv$/.test(dl.suggestedFilename())) throw new Error('file name ' + dl.suggestedFilename());
  const csv = await readFile(await dl.path());
  if (csv.subarray(0, 3).toString('hex') !== 'efbbbf') throw new Error('no UTF-8 BOM');
  const text = csv.toString('utf8').replace(/^﻿/, '');
  if (text.split('\r\n')[0] !== 'type;raison;n° WordPress;date;heure;client;barbier;détail') throw new Error('columns: ' + text.split('\r\n')[0]);
  if (!/error;[^;]+;1311;21\/10\/2026;17:00;/.test(text)) throw new Error('no line for the booking in error:\n' + text.slice(0, 600));
  if (!text.includes('compte;Réservations')) throw new Error('no counts in the CSV');

  // the cut-over day: the same export without Sami’s booking of 18 November (deleted on the old site)
  await drop('wp-bookings-fr-delta.csv');
  await h.expectText(page, 'Ce qui va être repris');
  await h.expectText(page, '1 supprimé sur l’ancien site');
  await ready();
  await page.getByRole('button', { name: /^Importer 1 changement/ }).click();
  await h.expectText(page, 'Tout est compté ✓', 20000);
  await h.expectText(page, 'Supprimés sur l’ancien site');
  await page.getByRole('button', { name: 'Pour info' }).click();
  await h.expectText(page, 'Supprimé sur l’ancien site : annulé ici, sans SMS');
  // « À faire » is not where it sits
  await page.getByRole('button', { name: 'À faire' }).click();
  const todo = await page.locator('.wr-group', { hasText: 'Supprimés sur l’ancien site' }).count();
  if (todo !== 0) throw new Error('a deleted booking is « Pour info », not « À faire »');
  await page.getByRole('button', { name: /^Tout \d/ }).click();
  const sami = (await h.api('/api/v1/agenda?day=2026-11-18')).json.appts.find((a) => a.name.startsWith('Sami'));
  if (!sami || sami.status !== 'cancelled') throw new Error('Sami’s booking is ' + (sami && sami.status));
  // two runs now: the list of the last ones
  await h.expectText(page, 'Les dernières reprises');
  await page.locator('.wr-group').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-report-delta-desktop');

  // the final sync that changes nothing leaves its trace too: the same export dropped again is recorded as a run of « déjà là »
  await drop('wp-bookings-fr-delta.csv');
  await h.expectText(page, 'Tout est déjà repris');
  await ready();
  const empty = page.getByRole('button', { name: 'Enregistrer la vérification (rien de nouveau)' });
  await empty.click();
  // the toast says what was done: nothing new, not « repris »
  await h.expectText(page, 'Rien de nouveau');
  await page.waitForFunction(() => document.querySelectorAll('.wr-recent li').length === 3 && document.body.textContent.includes('Tout est compté ✓'), null, { timeout: 20000 });
  const [src, made, already, skipped, left] = (await table())['Réservations'];
  if (made !== 0 || already <= 0 || already + skipped + left !== src) throw new Error('a re-run should only find « déjà là »: ' + [src, made, already, skipped, left]);

  // a phone: four cards instead of the table, nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await h.expectText(page, 'Tout est compté ✓', 15000);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('the report scrolls sideways on a phone');
  const cards = await page.locator('.wr-table tr.wr-row').evaluateAll((rows) => rows.map((r) => getComputedStyle(r).display + '/' + Math.round(r.getBoundingClientRect().width)));
  if (cards.length !== 4 || cards.some((c) => !c.startsWith('block/'))) throw new Error('not four cards: ' + cards.join(' '));
  await page.locator('.wr').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-report-phone');
  await page.getByRole('button', { name: 'Détail de réservations' }).scrollIntoViewIfNeeded();
  const small = await page.evaluate(() => [...document.querySelectorAll('.wr button, .wr a.btn')].filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 44)).map((b) => b.textContent));
  if (small.length) throw new Error('touch targets under 44 px: ' + small.join(' | '));

  // the button of an export with nothing new carries the longest label: on a phone it wraps inside the button, never spills out of its rounded ends
  await drop('wp-bookings-fr-delta.csv');
  await h.expectText(page, 'Tout est déjà repris');
  await ready();
  const go = await page.evaluate(() => { const b = document.querySelector('.wp-go button'); const r = b.getBoundingClientRect(); return { label: b.textContent, over: b.scrollWidth - b.clientWidth, h: Math.round(r.height), right: Math.round(r.right), vw: window.innerWidth }; });
  if (!go.label.includes('Enregistrer la vérification')) throw new Error('not the nothing-new button: ' + go.label);
  if (go.over > 1) throw new Error('the label spills out of the button on a phone (' + go.over + ' px): ' + go.label);
  if (go.h < 44 || go.right > go.vw) throw new Error('the button on a phone: ' + JSON.stringify(go));
  await page.locator('.wp-go').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await h.shot(page, 'wp-go-phone');

  // a run that stops half way (the second batch is lost): the page says so at once, fits the phone, and going on completes it
  await page.getByRole('button', { name: 'Tout retirer' }).click().catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setInputFiles('.wp-drop input[type=file]', [{ name: 'export-delta.csv', mimeType: 'text/csv', buffer: await readFile(join(FIX, 'wp-bookings-fr-delta.csv')) }, { name: 'cartes.csv', mimeType: 'text/csv', buffer: Buffer.from('code;solde;expire_le\nCARTE-0042-AB;50;2027-06-30\n') }]);
  await h.expectText(page, 'Ce qui va être repris');
  await ready();
  // the staged server error is the one console line this part expects
  page.expect.push(/status of 500/);
  let cut = true;
  await page.route('**/api/v1/import/batch', (route) => (cut && (route.request().postData() || '').includes('giftcards') ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Le serveur a eu un souci.' } }) }) : route.continue()));
  await page.getByRole('button', { name: /^Importer 1 carte cadeau/ }).click();
  await h.expectText(page, 'Interrompue à 1/2 paquets', 30000);
  await h.expectText(page, 'rien ne sera compté deux fois');
  if (await page.getByText('Rien à regarder').count()) throw new Error('an interrupted run is not « tout est en place »');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the interrupted run scrolls sideways on a phone');
  await page.locator('.wr').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-report-interrupted-phone');
  cut = false;
  await page.getByRole('button', { name: /^Importer 1 carte cadeau/ }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Terminée') && document.body.textContent.includes('Tout est compté ✓') && !document.body.textContent.includes('Interrompue à 1/2'), null, { timeout: 20000 });
};
