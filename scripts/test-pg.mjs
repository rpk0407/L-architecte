// Runs the storage contract against a real Postgres.
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db npm run test:pg
import { spawnSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to an empty Postgres database you can create schemas in.');
  process.exit(1);
}
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', 'tests/unit/stores.test.js'], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
