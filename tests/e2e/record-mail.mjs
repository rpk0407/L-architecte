// A recording e-mail provider for an end-to-end server, without touching the app: preloaded into the server's process
// (NODE_OPTIONS=--import <this file>, see mailEnv below), it answers the one request the Brevo provider makes
// (server/messaging/email.js: POST https://api.brevo.com/v3/smtp/email) and appends what was sent to LX_E2E_MAILS, one
// JSON line per mail. So the server runs its real provider code and its real outbox, and no mail ever leaves the machine:
// any other request to the outside is refused.
//
// In a scenario (tests/e2e/prod/*.mjs):
//   import { mailEnv, mailsOf } from '../record-mail.mjs';
//   const box = mailEnv();               export const env = box.env;
//   mailsOf(box)                         → [{ to, subject, text, html, tag, attachments }], in the order they left
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = process.env.LX_E2E_MAILS;
// only inside the server process the scenario started (dev.mjs), never in the runner that imports the helpers below
if (FILE && process.argv.some((a) => /scripts[\\/]dev\.mjs$/.test(a))) {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    const u = String((url && /** @type {any} */ (url).url) || url);
    if (u === 'https://api.brevo.com/v3/smtp/email') {
      const p = JSON.parse(String((init && init.body) || '{}'));
      appendFileSync(FILE, JSON.stringify({ to: p.to && p.to[0] && p.to[0].email, subject: p.subject, text: p.textContent, html: p.htmlContent, tag: (p.tags || [])[0] || '', attachments: (p.attachment || []).map((a) => a.name) }) + '\n');
      return new Response(JSON.stringify({ messageId: 'e2e-' + Date.now() }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) return real(url, init);
    throw new Error('e2e: a request left the server: ' + u);
  });
}

/** The server environment that makes this file its e-mail provider's network, and where the mails are kept. */
export function mailEnv() {
  const file = join(tmpdir(), 'lx-e2e-mails-' + process.pid + '-' + Math.random().toString(36).slice(2, 10) + '.jsonl');
  const opts = [process.env.NODE_OPTIONS || '', '--import ' + JSON.stringify(fileURLToPath(import.meta.url))].filter(Boolean).join(' ');
  return { file, env: { NODE_OPTIONS: opts, LX_E2E_MAILS: file, BREVO_API_KEY: 'e2e-not-a-key', EMAIL_FROM: 'Salon L’Architecte <rdv@salon.test>' } };
}

/** @returns {{ to: string, subject: string, text: string, html: string, tag: string, attachments: string[] }[]} */
export function mailsOf(box) {
  return existsSync(box.file) ? readFileSync(box.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
