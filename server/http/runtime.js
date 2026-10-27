// @ts-check
// One runtime per server instance: configuration, store, engine, providers. Built on first request.
import { randomBytes } from 'node:crypto';
import { createEngine } from '../core/engine.js';
import { memoryStore } from '../store/memory.js';
import { stripeProvider } from '../payments/stripe.js';
import { simulatedProvider } from '../payments/simulated.js';
import { brevoSms, twilioSms } from '../messaging/sms.js';
import { buildDemoJournal } from '../domain/seed.js';

/** Everything configurable, read from the environment once. */
export function readConfig(env = process.env) {
  const mode = env.LX_MODE === 'production' ? 'production' : 'demo';
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '';
  return {
    mode,
    publicUrl: (env.PUBLIC_URL || (vercelUrl ? 'https://' + vercelUrl : '')).replace(/\/+$/, ''),
    sessionSecret: env.SESSION_SECRET || '',
    setupToken: env.SETUP_TOKEN || '',
    cronSecret: env.CRON_SECRET || '',
    db: env.DATABASE_URL || env.POSTGRES_URL || '',
    blob: !!env.BLOB_READ_WRITE_TOKEN,
    blobPrefix: env.LX_BLOB_PREFIX || 'lx2',
    blobAccess: env.LX_BLOB_ACCESS === 'public' ? 'public' : 'private',
    // encrypts the nightly backups (core/backup.js); kept out of the data so a leaked backup stays unreadable
    backupKey: env.BACKUP_KEY || '',
    dataFile: env.LX_DATA_FILE || '',
    stripe: env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET || '' } : null,
    sms: env.SMS_PROVIDER === 'brevo' && env.BREVO_API_KEY ? { kind: 'brevo', apiKey: env.BREVO_API_KEY, sender: env.SMS_SENDER || 'LArchitecte' }
      : env.SMS_PROVIDER === 'twilio' && env.TWILIO_ACCOUNT_SID ? { kind: 'twilio', sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_FROM || '' }
        : null,
    // plain-http cookies are for local tests only: a production deployment on Vercel ignores the switch
    secureCookies: env.LX_INSECURE_COOKIES !== '1' || (!!env.VERCEL && mode === 'production'),
    isVercel: !!env.VERCEL,
    // production, preview or development: only production writes the nightly backups
    vercelEnv: env.VERCEL_ENV || ''
  };
}

async function makeStore(cfg) {
  if (cfg.db) { const { postgresStore } = await import('../store/postgres.js'); return postgresStore({ url: cfg.db }); }
  if (cfg.blob) { const { blobStore } = await import('../store/blob.js'); return blobStore({ prefix: cfg.blobPrefix, access: cfg.blobAccess }); }
  if (cfg.dataFile) { const { fileStore } = await import('../store/file.js'); return fileStore(cfg.dataFile); }
  return memoryStore();
}

/** @type {Promise<any>|null} */
let booting = null;
/** @type {any} */
let current = null;

/**
 * @param {{ env?: any, clock?: () => number, store?: any }} [opt] tests inject a clock and a store
 */
export async function runtime(opt = {}) {
  if (current) return current;
  if (!booting) booting = boot(opt).then((rt) => { current = rt; return rt; }).finally(() => { booting = null; });
  return booting;
}
export function resetRuntime() { current = null; booting = null; }

/** A fresh, independent runtime (tests). */
export function createRuntime(opt = {}) { return boot(opt); }

/** A configuration the salon must not run with: every /api route answers with it, until it is fixed. */
function configError(what) {
  return Object.assign(new Error('Configuration incomplète : ' + what), { status: 503, code: 'config', expose: true });
}

async function boot(opt) {
  const cfg = readConfig(opt.env || process.env);
  // a generated key would be stored next to the data and sign every session and client link: refuse instead
  if (cfg.mode === 'production' && !cfg.sessionSecret) { console.error('[lx] SESSION_SECRET is not set: refusing to start'); throw configError('SESSION_SECRET'); }
  // local testing only: pretend it is another moment (e.g. a Tuesday afternoon). Never in production.
  const fake = (opt.env || process.env).LX_FAKE_NOW;
  if (fake && cfg.mode !== 'production' && !opt.clock) { const offset = Date.parse(fake) - Date.now(); if (Number.isFinite(offset)) opt = { ...opt, clock: () => Date.now() + offset }; }
  const store = opt.store || (await makeStore(cfg));
  const engine = createEngine(store, { clock: opt.clock, syncEveryMs: cfg.db || cfg.blob ? 1500 : 0 });
  await engine.sync(true);
  if (engine.state.version === 0 && cfg.mode === 'demo') {
    const journal = await buildDemoJournal(engine.clock(), { siteUrl: cfg.publicUrl ? cfg.publicUrl + '/site' : undefined });
    await engine.adopt(journal);
  }
  const secret = cfg.sessionSecret || (await store.secret('session', () => randomBytes(32).toString('base64url')));
  const warnings = [];
  if (!cfg.sessionSecret) warnings.push('SESSION_SECRET n’est pas défini : une clé a été générée et stockée avec les données.');
  if (!cfg.db && !cfg.blob && !cfg.dataFile && cfg.isVercel) warnings.push('Aucun stockage durable : les données disparaissent au redémarrage du serveur.');
  if (cfg.mode === 'production' && !cfg.stripe) warnings.push('Stripe n’est pas connecté : aucun acompte n’est demandé en ligne et le QR code est coupé.');
  if (cfg.stripe && !cfg.stripe.webhookSecret) warnings.push('Clé Stripe présente mais STRIPE_WEBHOOK_SECRET manquant : paiements simulés');
  if (cfg.mode === 'production' && cfg.stripe && /^(sk|rk)_test_/.test(cfg.stripe.secretKey)) warnings.push('Stripe en mode test : aucun vrai paiement');
  if (cfg.mode === 'production' && !cfg.sms) warnings.push('Aucun fournisseur SMS : les messages restent dans la boîte d’envoi.');
  // in demo, refuse live Stripe keys: a demo must never charge anyone
  const stripeOk = cfg.stripe && cfg.stripe.webhookSecret && !(cfg.mode === 'demo' && /^(sk|rk)_live_/.test(cfg.stripe.secretKey));
  const rt = {
    cfg, store, engine, secret,
    // read on every request: the setup token outlives the setup until someone removes it
    get warnings() { return engine.state.version > 0 && cfg.setupToken ? [...warnings, 'SETUP_TOKEN est toujours défini : supprime-le puis redéploie'] : warnings; },
    origin: cfg.publicUrl,
    pay: null,
    sms: cfg.mode === 'demo' || !cfg.sms ? null : cfg.sms.kind === 'brevo' ? brevoSms(/** @type {any} */ (cfg.sms)) : twilioSms(/** @type {any} */ (cfg.sms)),
    lastTick: 0, ticking: /** @type {Promise<any>|null} */ (null)
  };
  rt.pay = stripeOk ? stripeProvider(/** @type {any} */ (cfg.stripe)) : simulatedProvider({ get baseUrl() { return rt.origin; } });
  return rt;
}
