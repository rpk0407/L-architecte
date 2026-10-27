// End-to-end on a production salon: LX_MODE=production, a real setup token, an empty journal on disk,
// exactly what the owner gets on the first deploy (minus https: LX_INSECURE_COOKIES=1 on localhost).
//
//   npm run build && node tests/e2e/prod.mjs      (npm run test:e2e runs the demo suite, then this one)
//
// Runs every tests/e2e/prod/*.mjs scenario, each on its own fresh salon (format in harness.mjs):
//   export default async ({ browser, h, page }) => { await h.setup(); await h.loginOwner(page); … }
// h.setup() creates the owner below through POST /api/setup and keeps the session for h.api().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { playwright, requireBuild, startServer, runner, helpers, runFiles, report } from './harness.mjs';

const { chromium } = playwright();
requireBuild();

const OWNER = { name: 'Karim', email: 'patron@larchitecte.test', password: 'Pelabon-13013', pin: '2580' };

const browser = await chromium.launch();
const { results, scenario } = runner(browser);
console.log('\nLe Comptoir · end-to-end on a production salon\n');

await runFiles(browser, 'prod', {
  scenario,
  boot: async (mod) => {
    const dir = mkdtempSync(join(tmpdir(), 'lx-e2e-prod-'));
    const setupToken = randomBytes(12).toString('base64url');
    const env = {
      LX_MODE: 'production', SESSION_SECRET: randomBytes(32).toString('base64url'), SETUP_TOKEN: setupToken,
      LX_DATA_FILE: join(dir, 'journal.jsonl'), LX_INSECURE_COOKIES: '1', LX_FAKE_NOW: '', LX_INDEX: '',
      DATABASE_URL: '', POSTGRES_URL: '', BLOB_READ_WRITE_TOKEN: '', STRIPE_SECRET_KEY: '', SMS_PROVIDER: '',
      ...(mod.env || {})
    };
    const srv = await startServer(env);
    return {
      ...srv,
      h: { ...helpers({ base: srv.base, mode: 'production', owner: OWNER, setupToken }), setupToken, dataDir: dir },
      stop: async () => { await srv.stop(); rmSync(dir, { recursive: true, force: true }); }
    };
  }
});

await browser.close();
if (!results.length) { console.log('  no scenario in tests/e2e/prod'); process.exit(1); }
process.exit(report(results));
