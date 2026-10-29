// Réglages › Reprendre WordPress, the wizard before and during the run, on the demo salon: files that are not exports say why,
// what the owner is warned about (nothing to come, no country code), how the first lines were read, a file taken off, a
// failed check that can be tried again, a Wi-Fi blip in the middle of the import, a row the server refuses (a sentence with
// the booking number), the lines nobody could read kept in the report. Desktop and phone screenshots with SHOTS=1.
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'WordPress wizard: reasons for a bad file, warnings, the first lines read, retries, a refused row, unreadable lines';

const FIX = join(ROOT, 'tests', 'fixtures');
const QA = (f) => join(FIX, 'wp-qa', f);

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);
  const input = '.wp-drop input[type=file]';
  const drop = (...files) => page.setInputFiles(input, files);
  /** the matching step: every select still empty gets its first real choice (a chair for a barber with bookings to come) */
  const fill = async () => {
    for (const s of await page.locator('.wp-row select').all()) {
      if ((await s.inputValue()) !== '') continue;
      const v = await s.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (v.length) await s.selectOption(v[v.length > 1 ? 1 : 0]);
    }
  };
  const settled = () => page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches') && !document.body.textContent.includes('Lecture de'), null, { timeout: 20000 });
  const ready = async () => { await settled(); await fill(); await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 20000 }); };
  const text = () => page.locator('.wp').textContent();
  const noRedToast = async () => { if (await page.locator('.toast.err').count()) throw new Error('an error toast: ' + (await page.locator('.toast.err').first().textContent())); };

  await page.goto(h.base + '/comptoir/reglages/wordpress');
  await h.expectText(page, 'Exporte depuis WordPress');
  // the demo is public: no real client files
  await h.expectText(page, 'Démo publique : n’y dépose jamais de vrais fichiers de clients');
  // the export steps say the one thing that is easily missed, and what the CSV cannot carry
  await h.expectText(page, 'Mets une date de fin dans un an');
  await h.expectText(page, 'ne les renomme pas');
  if ((await text()).includes('fichier clients de l’extension')) throw new Error('the customers file of the plugin does not exist');
  await page.getByRole('button', { name: 'Modèle des cartes cadeaux' }).waitFor();

  // a workbook is not an export: the sentence says what to do, nothing says « tout est repris »
  await drop(QA('A11-saved-as-workbook.xlsx'));
  await h.expectText(page, 'Fichier Excel : ouvre-le puis Fichier > Enregistrer sous > CSV UTF-8');
  if (!(await page.locator('.wp-files .badge', { hasText: 'à refaire' }).count())) throw new Error('the file is not marked « à refaire »');
  await settled();
  if (await page.locator('.note.ok').count()) throw new Error('« Tout est déjà repris » over a file that was not read');
  // the empty one, the page of login: each its sentence
  await page.getByRole('button', { name: 'Tout retirer' }).click();
  await drop(QA('F04-empty-zero-bytes.csv'), QA('F06c-html-instead-of-csv.csv'), QA('bank.csv'));
  await h.expectText(page, 'Le fichier est vide');
  await h.expectText(page, 'WordPress a renvoyé sa page de connexion');
  await h.expectText(page, 'Colonnes non reconnues');
  await page.getByRole('button', { name: 'Tout retirer' }).click();

  // « à » left at today: no booking to come, said before anything is sent; and a CSV alone cannot say the country codes
  await drop(QA('W1-default-window-past-only.csv'));
  await h.expectText(page, 'Aucun rendez-vous à venir dans ces fichiers');
  await h.expectText(page, 'Ton export s’arrête le');
  await h.expectText(page, 'Le CSV ne contient pas l’indicatif pays');
  await page.getByRole('button', { name: 'Tout retirer' }).click();

  // the French export and the XML: the first lines as read, the span of the file, no warning left
  await drop(join(FIX, 'wp-bookings-fr.csv'), join(FIX, 'wp-bookings.wxr.xml'));
  await h.expectText(page, 'Voici comment j’ai lu tes 3 premières lignes');
  await settled();
  const rows = await page.locator('.wp-sample-t tbody tr').count();
  if (rows !== 3) throw new Error('the sample shows ' + rows + ' lines');
  if (!/du \d+ \S+ 20\d\d au \d+ \S+ 20\d\d · 14\s+rendez-vous \(dont \d+ à venir\)/.test(await page.locator('.wp-files').textContent())) throw new Error('the span of the file: ' + (await page.locator('.wp-files').textContent()).slice(0, 300));
  if ((await text()).includes('Le CSV ne contient pas l’indicatif pays')) throw new Error('the XML is there: no country-code warning');
  // a file taken off alone: the XML goes, the warning comes back, the counts follow
  await page.getByRole('button', { name: 'Retirer « wp-bookings.wxr.xml »' }).click();
  await h.expectText(page, 'Le CSV ne contient pas l’indicatif pays');
  if ((await page.locator('.wp-files .li').count()) !== 1) throw new Error('one file should be left');
  await page.locator('[data-guide="wp-fichiers"]').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-wizard-files-desktop');

  // the check of the files fails (no network): said, with « Réessayer », and the page tries again by itself when it can
  page.expect.push(/ERR_FAILED|net::/);
  let cutOnce = true;
  await page.route('**/api/v1/import/preview', (route) => { if (cutOnce) { cutOnce = false; return route.abort(); } return route.continue(); });
  await page.getByRole('button', { name: 'Tout retirer' }).click();
  await drop(join(FIX, 'wp-bookings-fr.csv'));
  await h.expectText(page, 'Pas de connexion : les fiches n’ont pas pu être vérifiées');
  const importBtn = page.locator('.wp-go button');
  if (!(await importBtn.isDisabled())) throw new Error('the import button is open while the check failed');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await ready();
  // a Wi-Fi blip in the middle of the import: two batch requests are lost once, the import goes on and ends clean
  let lost = 2;
  await page.route('**/api/v1/import/batch', (route) => { if (lost > 0) { lost--; return route.abort(); } return route.continue(); });
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();
  await h.expectText(page, 'Terminée', 60000);
  await h.expectText(page, 'Tout est compté ✓');
  await noRedToast();
  await page.unroute('**/api/v1/import/batch');
  await page.unroute('**/api/v1/import/preview');

  // dates in an English Excel (month first) are read on the right days; nothing refused by the server: A18 has dates that do not exist, R03b a 40-digit number
  await drop(QA('A18-dates-and-times-edge.csv'), QA('R03b-long-phone-only.csv'));
  await h.expectText(page, 'n’ont pas pu être lues', 20000);
  await page.locator('.wp-issues-list summary').click();
  await h.expectText(page, 'Date illisible');
  await h.expectText(page, 'Télécharger la liste (CSV)');
  await ready();
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();
  await h.expectText(page, 'Terminée', 60000);
  await noRedToast();
  // what could not be read does not vanish under a green tick: the report says so, with the list
  await h.expectText(page, 'n’ont pas pu être lues : voir la liste');
  if (await page.locator('.note.ok', { hasText: 'Tout est compté' }).count()) throw new Error('« Tout est compté » over unreadable lines');
  await h.expectText(page, 'Lignes illisibles');

  // a row the server refuses stops the run with a sentence that names the booking, never the path of the field
  await drop(QA('A15-status-matrix.csv'));
  await h.expectText(page, 'Voici comment j’ai lu');
  await ready();
  await h.expectText(page, 'ne sont pas reprises').catch(() => {});
  await page.route('**/api/v1/import/batch', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid', message: 'appts[0].createdAt : entre 0 et 8640000000000000' } }) }));
  page.expect.push(/status of 400/);
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();
  const toast = page.locator('.toast.err');
  await toast.first().waitFor({ timeout: 20000 });
  const said = await toast.first().textContent();
  if (!/Réservation n° \d+ : date de création illisible/.test(said)) throw new Error('the toast: ' + said);
  if (/appts\[|createdAt :/.test(said)) throw new Error('the raw path is shown: ' + said);
  if (/Relance l’import/.test(await text())) throw new Error('« Relance l’import » for a refusal that comes back every time');
  await h.expectText(page, 'envoie-le à ton prestataire');
  await page.unroute('**/api/v1/import/batch');
  await page.locator('.wr').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-wizard-refused-desktop');

  // a phone: nothing scrolls sideways, the sample is made of cards, the targets are 44 px
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await h.expectText(page, 'Reprendre WordPress').catch(() => {});
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the wizard scrolls sideways on a phone');
  await page.getByRole('button', { name: 'Tout retirer' }).click().catch(() => {});
  await drop(join(FIX, 'wp-bookings-fr.csv'));
  await h.expectText(page, 'Voici comment j’ai lu');
  await settled();
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error('the file card scrolls sideways on a phone');
  const small = await page.evaluate(() => [...document.querySelectorAll('.wp-files button, .wp-models button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).map((b) => (b.getAttribute('aria-label') || b.textContent).trim()));
  if (small.length) throw new Error('targets under 44 px: ' + small.join(' | '));
  await page.locator('[data-guide="wp-fichiers"]').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-wizard-files-phone');
};
