// Réglages › Reprendre WordPress, the files side of the wizard on the demo salon: a 23 MB export read as a stream, one
// over 150 MB sent back with the way out, an entry that cannot be read (the good files stay), a drop a few pixels beside the
// box, an iPad in portrait, a second tab that sees a run going, the two models to fill in (and read back), the list of the
// lines nobody could read as a CSV, the cards and carnets the report names by their last digits, the same export dropped
// again after an import. Screenshots with SHOTS=1.
import { mkdtemp, readFile, writeFile, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../harness.mjs';

export const name = 'WordPress files: 23 MB export, over 150 MB, an unreadable entry, a drop beside the box, iPad, second tab, models, unreadable lines';

const FIX = join(ROOT, 'tests', 'fixtures');
const QA = (f) => join(FIX, 'wp-qa', f);

export default async ({ h, page }) => {
  await h.setup();
  await h.loginOwner(page);
  const dir = await mkdtemp(join(tmpdir(), 'lx-wp-files-'));
  const input = '.wp-drop input[type=file]';
  const drop = (...files) => page.setInputFiles(input, files);
  const payload = async (file, as) => ({ name: as || file.split('/').pop(), mimeType: 'text/csv', buffer: await readFile(file) });
  const clear = async () => { const b = page.getByRole('button', { name: 'Tout retirer' }); if (await b.count()) await b.click(); };
  const fill = async () => {
    for (const s of await page.locator('.wp-row select').all()) {
      if ((await s.inputValue()) !== '') continue;
      const v = await s.locator('option:not([disabled])').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (v.length) await s.selectOption(v[v.length > 1 ? 1 : 0]);
    }
  };
  const settled = () => page.waitForFunction(() => !document.body.textContent.includes('Vérification des fiches') && !document.body.textContent.includes('Lecture de'), null, { timeout: 30000 });
  const ready = async () => { await settled(); await fill(); await page.waitForFunction(() => { const b = document.querySelector('.wp-go button'); return b && !b.disabled; }, null, { timeout: 20000 }); };
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const open = async () => { await page.goto(h.base + '/comptoir/reglages/wordpress'); await h.expectText(page, 'Exporte depuis WordPress'); };

  await open();

  // a long history: 23 MB of pages and pictures around the bookings, read as a stream (the limit of 20 MB is for a CSV)
  const wxr = await readFile(join(FIX, 'wp-bookings.wxr.xml'), 'utf8');
  const junk = '\t<item>\n\t\t<title><![CDATA[Page]]></title>\n\t\t<wp:post_id>9</wp:post_id>\n\t\t<wp:post_type><![CDATA[page]]></wp:post_type>\n\t\t<content:encoded><![CDATA[' + 'Lorem ipsum '.repeat(16000) + ']]></content:encoded>\n\t</item>\n';
  const first = wxr.indexOf('<item>');
  const big = join(dir, 'tout-le-contenu.xml');
  await writeFile(big, wxr.slice(0, first) + junk.repeat(120) + wxr.slice(first));
  await drop(big);
  await h.expectText(page, 'tout-le-contenu.xml', 60000);
  await settled();
  const card = await page.locator('.wp-files').textContent();
  if (/trop lourd|à refaire/.test(card) || !/\d+\s+rendez-vous/.test(card)) throw new Error('the 23 MB export is not read: ' + card.slice(0, 300));
  if (await page.locator('.toast.err').count()) throw new Error('an error toast for the 23 MB export');
  await clear();

  // over 150 MB (a sparse file: only its size matters): refused with the way out, nothing else changes
  const huge = join(dir, 'enorme.xml');
  await writeFile(huge, wxr.slice(0, first));
  await truncate(huge, 151 * 1024 * 1024);
  await drop(huge);
  const err = page.locator('.toast.err').first();
  await err.waitFor({ timeout: 20000 });
  const said = await err.textContent();
  if (!/fait plus de 150 Mo/.test(said) || !/Tout le contenu/.test(said) || !/Réservations/.test(said)) throw new Error('the advice for a file over 150 MB: ' + said);
  if (await page.locator('.wp-files .li').count()) throw new Error('a file over 150 MB is listed');
  await page.reload();
  await h.expectText(page, 'Exporte depuis WordPress');

  // an entry that cannot be read (a folder, a file moved meanwhile): the toast names it, the other file stays
  await page.evaluate(() => { const o = Blob.prototype.arrayBuffer; Blob.prototype.arrayBuffer = function () { return this.name === 'broken.csv' ? Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')) : o.call(this); }; });
  await drop(await payload(join(FIX, 'wp-bookings-fr.csv')), { name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from('x') });
  await h.expectText(page, '« broken.csv » n’a pas pu être lu');
  await settled();
  const listed = await page.locator('.wp-files .li b').allTextContents();
  if (listed.join() !== 'wp-bookings-fr.csv') throw new Error('the good file stays alone: ' + listed.join(' | '));
  await page.reload();
  await h.expectText(page, 'Exporte depuis WordPress');

  // a drop a few pixels beside the box would open the CSV in the tab: the whole page takes it, the drop zone lights up meanwhile
  const csv = await readFile(join(FIX, 'wp-bookings-fr.csv'), 'utf8');
  const beside = await page.evaluate(async (text) => {
    const mk = () => { const dt = new DataTransfer(); dt.items.add(new File([text], 'export.csv', { type: 'text/csv' })); return dt; };
    const title = document.querySelector('h1') || document.querySelector('h2');
    const out = {};
    const enter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: mk() });
    title.dispatchEvent(enter);
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: mk() });
    title.dispatchEvent(over);
    out.over = over.defaultPrevented;
    await new Promise((r) => setTimeout(r, 100));
    out.lit = !!document.querySelector('.wp-drop.over');
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: mk() });
    title.dispatchEvent(drop);
    out.drop = drop.defaultPrevented;
    return out;
  }, csv);
  if (!beside.over || !beside.drop) throw new Error('a drop beside the box is not taken: ' + JSON.stringify(beside));
  if (!beside.lit) throw new Error('the drop zone does not light up while a file is dragged over the page');
  await h.expectText(page, 'Voici comment j’ai lu');
  const taken = await page.locator('.wp-files .li b').allTextContents();
  if (taken.join() !== 'export.csv') throw new Error('the dropped file: ' + taken.join(' | '));

  // an iPad in portrait: nothing scrolls sideways and the button stays in the viewport
  await page.setViewportSize({ width: 768, height: 1024 });
  await ready();
  if (await sideways()) throw new Error('the wizard scrolls sideways at 768 px');
  const right = await page.locator('.wp-go button').evaluate((b) => Math.round(b.getBoundingClientRect().right));
  if (right > 768) throw new Error('the import button leaves the viewport at 768 px: right edge at ' + right);
  await page.locator('.wp-go').evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-files-ipad');

  // a second tab sees the run going (its last batch is seconds old): « En cours », never « Interrompue »
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/v1/import/batch', async (route) => { await gate; await route.continue(); });
  await page.getByRole('button', { name: /^Importer \d+ rendez-vous/ }).click();
  const tab = await page.context().newPage();
  try {
    await tab.goto(h.base + '/comptoir/reglages/wordpress');
    await tab.getByText('En cours', { exact: true }).first().waitFor({ timeout: 20000 });
    if (await tab.getByText('Interrompue', { exact: false }).count()) throw new Error('a run going on in another tab reads « Interrompue »');
  } finally { release(); await tab.close(); }
  await h.expectText(page, 'Terminée', 60000);
  await h.expectText(page, 'Tout est compté ✓');
  await page.unroute('**/api/v1/import/batch');

  // the same export dropped again after the import: « Tout est déjà repris » stays (the green note is not swallowed by the check)
  // (saved now, like the file of the run: an export dated before the last run's would be flagged as older, wp-report.mjs)
  await page.setViewportSize({ width: 1440, height: 900 });
  const again = join(dir, 'wp-bookings-fr.csv');
  await writeFile(again, await readFile(join(FIX, 'wp-bookings-fr.csv')));
  await drop(again);
  await h.expectText(page, 'Tout est déjà repris');
  await settled();
  await page.waitForTimeout(500);
  if (!(await page.locator('.note.ok', { hasText: 'Tout est déjà repris' }).count())) throw new Error('the green note went away');
  await clear();

  // the two models: they download as files, and read back by the wizard as what they are
  const [gdl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Modèle des cartes cadeaux' }).click()]);
  if (gdl.suggestedFilename() !== 'modele-cartes-cadeaux.csv') throw new Error('the model: ' + gdl.suggestedFilename());
  const model = join(dir, 'modele-cartes-cadeaux.csv');
  await gdl.saveAs(model);
  const raw = await readFile(model);
  if (raw.subarray(0, 3).toString('hex') !== 'efbbbf' || !raw.toString('utf8').includes('code;solde;expire_le')) throw new Error('the gift card model: ' + raw.toString('utf8').slice(0, 80));
  const [pdl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Modèle des carnets' }).click()]);
  if (pdl.suggestedFilename() !== 'modele-carnets.csv') throw new Error('the carnet model: ' + pdl.suggestedFilename());
  await drop(model);
  await h.expectText(page, 'carte cadeau');
  await settled();
  if (/à refaire/.test(await page.locator('.wp-files').textContent())) throw new Error('the model, filled as is, is not read');
  await clear();

  // the lines nobody could read: counted, listed, kept in a CSV with the file and the line
  await drop(QA('A18-dates-and-times-edge.csv'));
  await h.expectText(page, 'n’ont pas pu être lues', 20000);
  await page.locator('.wp-issues-list summary').click();
  await h.expectText(page, 'Date illisible');
  const [ldl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger la liste (CSV)' }).click()]);
  if (ldl.suggestedFilename() !== 'lignes-illisibles.csv') throw new Error('the list: ' + ldl.suggestedFilename());
  const list = (await readFile(await ldl.path(), 'utf8')).replace(/^﻿/, '').split('\r\n').filter(Boolean);
  if (list[0] !== 'fichier;ligne;n° WordPress;raison' || list.length < 2 || !/^A18-dates-and-times-edge\.csv;\d+;/.test(list[1])) throw new Error('the list of unreadable lines: ' + list.slice(0, 3).join(' / '));
  await clear();

  // gift cards and carnets by hand: what is refused is named by its last digits (the code or number is a secret), and never by a name
  await drop(QA('E01-giftcards-semicolon-utf8.csv'), QA('E03-carnets.csv'));
  await h.expectText(page, 'Ce qui va être repris', 20000);
  await ready();
  await page.getByRole('button', { name: /^Importer \d+/ }).click();
  await h.expectText(page, 'Terminée', 60000);
  await page.getByRole('button', { name: 'À faire' }).click();
  const lines = await page.locator('.wr-group').allTextContents();
  const todo = lines.join('\n');
  if (!/•••• /.test(todo)) throw new Error('refused cards are not named by their last digits:\n' + todo.slice(0, 600));
  if (/Sofia|Lopez|Belge/.test(todo)) throw new Error('a name in the report of carnets:\n' + todo.slice(0, 600));
  await page.locator('.wr-group').first().evaluate((el) => el.scrollIntoView());
  await h.shot(page, 'wp-files-cards-desktop');
};
