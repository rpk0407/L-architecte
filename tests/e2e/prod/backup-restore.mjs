// Production: the owner downloads the encrypted backup from Réglages › Données, then a brand-new installation
// (empty journal, same BACKUP_KEY) is rebuilt from that file through the setup screen, and the owner signs in
// with the old password. Without a Blob store the Données card says so in red; a one-part file goes in one request,
// and the journal ends with « Salon restauré ».
// Run by tests/e2e/prod.mjs: export default async ({ browser, h }).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from '../harness.mjs';

const KEY = randomBytes(32).toString('base64');
export const env = { BACKUP_KEY: KEY };
export const viewport = { width: 390, height: 844 };

const seen = (page, text, timeout = 10000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });

export default async ({ h, page }) => {
  await h.setup();
  for (const [first, last, phone] of [['Yanis', 'Martin', '0612345678'], ['Inès', 'Haddad', '0698765432']]) {
    const r = await h.api('/api/v1/clients', { body: { first, last, phone } });
    if (!r.ok) throw new Error('client: ' + r.status + ' ' + r.text);
  }
  const before = (await h.api('/api/v1/system')).json;

  /* the old installation: the backup card, then the download */
  await h.loginOwner(page);
  await page.goto(h.base + '/comptoir/reglages/donnees');
  await seen(page, 'Aucun stockage Blob relié');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Télécharger la sauvegarde chiffrée').click()]);
  if (!/^larchitecte-sauvegarde-\d{4}-\d{2}-\d{2}\.json\.gz\.enc$/.test(dl.suggestedFilename())) throw new Error('file name: ' + dl.suggestedFilename());
  const dir = mkdtempSync(join(tmpdir(), 'lx-e2e-restore-'));
  const file = join(dir, dl.suggestedFilename());
  await dl.saveAs(file);

  /* a new deployment: empty, same key, its own setup token */
  const srv = await startServer({
    LX_MODE: 'production', SESSION_SECRET: randomBytes(32).toString('base64url'), SETUP_TOKEN: 'reprise-13', BACKUP_KEY: KEY,
    LX_DATA_FILE: join(dir, 'journal.jsonl'), LX_INSECURE_COOKIES: '1', LX_FAKE_NOW: '', LX_INDEX: '',
    DATABASE_URL: '', POSTGRES_URL: '', BLOB_READ_WRITE_TOKEN: '', STRIPE_SECRET_KEY: '', SMS_PROVIDER: ''
  });
  try {
    await page.context().clearCookies();
    await page.goto(srv.base + '/comptoir');
    await page.getByText('Installer depuis une sauvegarde').click();
    // a wrong code is refused (from Node: a 403 in the page would count as a console error)
    const wrong = await fetch(srv.base + '/api/setup/backups', { headers: { 'x-setup-token': 'mauvais' } });
    if (wrong.status !== 403) throw new Error('wrong token: ' + wrong.status);
    await page.fill('#rs-t', 'reprise-13');
    await page.getByRole('button', { name: 'Voir les sauvegardes' }).click();
    await seen(page, 'Aucun stockage Blob relié à cette installation');
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByRole('button', { name: 'Restaurer ce fichier' }).click();
    await seen(page, 'Salon restauré', 20000);

    await page.fill('#li-e', h.owner.email);
    await page.fill('#li-p', h.owner.password);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await page.locator('#page-title h1').waitFor({ timeout: 10000 });
    const after = await page.evaluate(async () => (await fetch('/api/v1/system')).json());
    if (after.version !== before.version + 1) throw new Error('restored ' + after.version + ', expected ' + before.version + ' and one shop.restored');
    // the backup's journal, unchanged, then the line that says it was rebuilt
    const log = (await page.evaluate(async () => (await fetch('/api/v1/audit')).json())).items;
    const kept = log.find((x) => x.v === before.version);
    if (!kept || kept.hash !== before.head.slice(0, 12)) throw new Error('chain head: ' + JSON.stringify(kept) + ', expected ' + before.head);
    if (log[0].type !== 'shop.restored' || !/un fichier/.test(log[0].summary)) throw new Error('no restore line: ' + JSON.stringify(log[0]));
    const clients = await page.evaluate(async () => (await fetch('/api/v1/clients?q=Haddad')).json());
    if (!JSON.stringify(clients).includes('Inès')) throw new Error('the client file did not come back');

    // a salon with data never restores again
    const again = await fetch(srv.base + '/api/setup/backups', { headers: { 'x-setup-token': 'reprise-13' } });
    if (again.status !== 409) throw new Error('restore after install: ' + again.status);
  } finally {
    await srv.stop();
    rmSync(dir, { recursive: true, force: true });
  }
};
