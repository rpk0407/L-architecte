// @ts-check
// One runtime per server instance: configuration, store, engine, providers. Built on first request.
import { randomBytes } from 'node:crypto';
import { createEngine } from '../core/engine.js';
import { memoryStore } from '../store/memory.js';
import { stripeProvider } from '../payments/stripe.js';
import { simulatedProvider } from '../payments/simulated.js';
import { brevoSms, twilioSms, gatewaySms, GATEWAY_URL } from '../messaging/sms.js';
import * as WA from '../messaging/whatsapp.js';
import * as MAIL from '../messaging/email.js';
import { buildDemoJournal } from '../domain/seed.js';
import { makeSigner } from '../core/signer.js';

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
    // LX_INDEX=1: the build opens the site to search engines; the Comptoir shows it (routes-health.js)
    index: env.LX_INDEX === '1',
    db: env.DATABASE_URL || env.POSTGRES_URL || '',
    blob: !!env.BLOB_READ_WRITE_TOKEN,
    blobPrefix: env.LX_BLOB_PREFIX || 'lx2',
    blobAccess: env.LX_BLOB_ACCESS === 'public' ? 'public' : 'private',
    // encrypts the nightly backups (core/backup.js); kept out of the data so a leaked backup stays unreadable
    backupKey: env.BACKUP_KEY || '',
    dataFile: env.LX_DATA_FILE || '',
    stripe: env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET || '' } : null,
    // every SMS route whose credentials are there (Réglages › Messages › Canal d'envoi tests each one); SMS_PROVIDER picks
    // the one in use. gateway: the salon's Android phone with SMS Gateway for Android (cloud server unless SMSGATE_URL)
    smsRoutes: smsRoutes(env),
    sms: Object.hasOwn(smsRoutes(env), env.SMS_PROVIDER || '') ? smsRoutes(env)[env.SMS_PROVIDER] : null,
    // MSG-02: WhatsApp from the salon's WhatsApp Business number, SMS kept as the fallback (messaging/whatsapp.js says
    // which way: Meta's Cloud API with WHATSAPP_TOKEN and WHATSAPP_PHONE_ID, or Brevo with BREVO_API_KEY and WHATSAPP_SENDER)
    whatsapp: whatsappConfig(env),
    whatsappSenderInvalid: !!env.WHATSAPP_SENDER && !waNumber(env.WHATSAPP_SENDER),
    // one of the two Meta variables without the other: said in the warnings, WhatsApp stays off
    whatsappIncomplete: !!WA.metaWhatsapp && !!(env.WHATSAPP_TOKEN || env.WHATSAPP_PHONE_ID) && !(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID),
    smsProviderUnknown: !!env.SMS_PROVIDER && !['brevo', 'twilio', 'gateway'].includes(env.SMS_PROVIDER),
    // e-mail: the salon's own mailbox over SMTP when SMTP_HOST, SMTP_USER and SMTP_PASS are set (messaging/smtp.js), else
    // Brevo's transactional API with the SMS key. EMAIL_FROM is the sender, e.g. "Barber L'Architecte
    // <rdv@barberlarchitecte.com>" (an address of the mailbox's domain, or one verified in Brevo); replies go to EMAIL_REPLY_TO
    email: emailConfig(env),
    emailFromInvalid: !!env.EMAIL_FROM && !parseFrom(env.EMAIL_FROM),
    // an SMTP host without its user or password: said in the warnings rather than silently falling back
    smtpIncomplete: !!MAIL.smtpEmail && !!env.SMTP_HOST && !(env.SMTP_USER && env.SMTP_PASS),
    // plain-http cookies are for local tests only: a production deployment on Vercel ignores the switch
    secureCookies: env.LX_INSECURE_COOKIES !== '1' || (!!env.VERCEL && mode === 'production'),
    isVercel: !!env.VERCEL,
    // production, preview or development: only production writes the nightly backups
    vercelEnv: env.VERCEL_ENV || ''
  };
}

// The WhatsApp and e-mail providers are read by name from their modules: a way to send that a module does not offer
// (yet, or any more) is simply not configured, and the salon starts all the same.
const waNumber = WA.waNumber;
const parseFrom = MAIL.parseFrom;

/** WhatsApp: Meta's Cloud API when its two variables are there, else Brevo's (same key as the SMS), else none. */
function whatsappConfig(env) {
  const sender = waNumber(env.WHATSAPP_SENDER) ? '+' + waNumber(env.WHATSAPP_SENDER) : '';
  if (WA.metaWhatsapp && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) return { kind: 'meta', token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID, version: env.WHATSAPP_API_VERSION || undefined, senderNumber: sender };
  if (/** @type {any} */ (WA).brevoWhatsapp && env.BREVO_API_KEY && sender) return { kind: 'brevo', apiKey: env.BREVO_API_KEY, senderNumber: sender };
  return null;
}
/** The provider of a WhatsApp configuration. */
function whatsappProvider(c) {
  return c.kind === 'meta' ? WA.metaWhatsapp(c) : /** @type {any} */ (WA).brevoWhatsapp(c);
}
/** E-mail: the salon's mailbox over SMTP, else Brevo, else none (mail waits in the outbox). */
function emailConfig(env) {
  const from = parseFrom(env.EMAIL_FROM);
  if (!from) return null;
  const common = { from: from.email, fromName: from.name, replyTo: (parseFrom(env.EMAIL_REPLY_TO) || { email: '' }).email };
  if (MAIL.smtpEmail && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return { kind: 'smtp', host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 465, user: env.SMTP_USER, pass: env.SMTP_PASS, ...common };
  if (env.BREVO_API_KEY) return { kind: 'brevo', apiKey: env.BREVO_API_KEY, ...common };
  return null;
}
/** The provider of an e-mail configuration. */
function emailProvider(c) {
  return c.kind === 'smtp' ? MAIL.smtpEmail(c) : MAIL.brevoEmail(c);
}

/** @returns {Record<string, any>} */
function smsRoutes(env) {
  /** @type {Record<string, any>} */
  const out = {};
  if (env.BREVO_API_KEY) out.brevo = { kind: 'brevo', apiKey: env.BREVO_API_KEY, sender: env.SMS_SENDER || 'LArchitecte' };
  if (env.TWILIO_ACCOUNT_SID) out.twilio = { kind: 'twilio', sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_FROM || '' };
  if (env.SMSGATE_USERNAME && env.SMSGATE_PASSWORD) out.gateway = { kind: 'gateway', url: (env.SMSGATE_URL || GATEWAY_URL).replace(/\/+$/, ''), username: env.SMSGATE_USERNAME, password: env.SMSGATE_PASSWORD };
  return out;
}
/** The provider of one SMS route's configuration. */
export function smsProvider(c) {
  return c.kind === 'brevo' ? brevoSms(c) : c.kind === 'twilio' ? twilioSms(c) : gatewaySms(c);
}

async function makeStore(cfg) {
  if (cfg.db) { const { postgresStore } = await import('../store/postgres.js'); return postgresStore({ url: cfg.db }); }
  if (cfg.blob) { const { blobStore } = await import('../store/blob.js'); return blobStore({ prefix: cfg.blobPrefix, access: cfg.blobAccess }); }
  if (cfg.dataFile) { const { fileStore } = await import('../store/file.js'); return fileStore(cfg.dataFile); }
  return memoryStore();
}

/**
 * Why PUBLIC_URL cannot be used as it is, in the owner's words ('' when it is fine or unset: the deployment's own address
 * is then used). It must be a bare https origin; http is accepted on localhost only (local runs and tests).
 * @param {string} v @returns {string}
 */
export function publicUrlProblem(v) {
  if (!v) return '';
  let u = null;
  try { u = new URL(v); } catch { /* not an address */ }
  const local = !!u && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u && (u.protocol === 'https:' || (u.protocol === 'http:' && local)) && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash) return '';
  return 'PUBLIC_URL doit être l’adresse complète du site, en https et sans chemin (https://barberlarchitecte.com) : les liens des SMS et le retour du paiement en ligne seraient faux.';
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
  const env = opt.env || process.env;
  const cfg = readConfig(env);
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
  // CPT-01a: the key that signs the closures, LX_SIGN_KEY or else kept with the data (core/signer.js)
  const sign = await makeSigner(env, store, cfg.mode);
  if (sign.warning) warnings.push(sign.warning);
  // a real salon on the memory store (no database, no Blob, no file) loses every ticket at the next restart, wherever it runs
  if (!opt.store && !cfg.db && !cfg.blob && !cfg.dataFile && (cfg.isVercel || cfg.mode === 'production')) warnings.push('Aucun stockage durable : les données disparaissent au redémarrage du serveur.');
  // the address goes into every SMS link and into Stripe's return address: without https:// both are wrong
  if (cfg.mode === 'production' && publicUrlProblem(cfg.publicUrl)) warnings.push(publicUrlProblem(cfg.publicUrl));
  if (cfg.mode === 'production' && !cfg.stripe) warnings.push('Stripe n’est pas connecté : aucun acompte n’est demandé en ligne et le QR code est coupé.');
  if (cfg.stripe && !cfg.stripe.webhookSecret) warnings.push('Clé Stripe présente mais STRIPE_WEBHOOK_SECRET manquant : paiements simulés');
  if (cfg.mode === 'production' && cfg.stripe && /^(sk|rk)_test_/.test(cfg.stripe.secretKey)) warnings.push('Stripe en mode test : aucun vrai paiement');
  if (cfg.mode === 'production' && !cfg.sms) warnings.push('Aucun fournisseur SMS : les messages restent dans la boîte d’envoi.');
  if (cfg.smsProviderUnknown) warnings.push('SMS_PROVIDER doit valoir brevo, twilio ou gateway : aucun SMS ne part.');
  else if (cfg.mode === 'production' && (env.SMS_PROVIDER || '') && !cfg.sms) warnings.push('SMS_PROVIDER=' + env.SMS_PROVIDER + ' sans ses identifiants (' + ({ brevo: 'BREVO_API_KEY', twilio: 'TWILIO_ACCOUNT_SID', gateway: 'SMSGATE_USERNAME et SMSGATE_PASSWORD' }[env.SMS_PROVIDER] || '') + ') : aucun SMS ne part.');
  if (cfg.whatsappSenderInvalid) warnings.push('WHATSAPP_SENDER n’est pas un numéro international (+33…) : WhatsApp coupé.');
  if (cfg.whatsappIncomplete) warnings.push('WhatsApp : WHATSAPP_TOKEN et WHATSAPP_PHONE_ID vont ensemble, il en manque un : WhatsApp coupé.');
  if (cfg.emailFromInvalid) warnings.push('EMAIL_FROM n’est pas une adresse e-mail valide : aucun e-mail ne part.');
  if (cfg.smtpIncomplete) warnings.push('SMTP_HOST sans SMTP_USER ou SMTP_PASS : les e-mails ne partent pas par la boîte du salon.');
  if (cfg.mode === 'production' && !cfg.email) warnings.push('Aucun fournisseur e-mail : les e-mails restent dans la boîte d’envoi (' + (MAIL.smtpEmail ? 'EMAIL_FROM avec SMTP_HOST, SMTP_USER et SMTP_PASS, ou avec BREVO_API_KEY' : 'BREVO_API_KEY et EMAIL_FROM') + ').');
  // in demo, refuse live Stripe keys: a demo must never charge anyone
  /** @type {Record<string, any>} */
  const routes = {};
  const stripeOk = cfg.stripe && cfg.stripe.webhookSecret && !(cfg.mode === 'demo' && /^(sk|rk)_live_/.test(cfg.stripe.secretKey));
  const rt = {
    cfg, store, engine, secret, signer: sign.signer,
    // read on every request: the setup token outlives the setup until someone removes it
    get warnings() { return engine.state.version > 0 && cfg.setupToken ? [...warnings, 'SETUP_TOKEN est toujours défini : supprime-le puis redéploie'] : warnings; },
    origin: cfg.publicUrl,
    pay: null,
    sms: cfg.mode === 'demo' || !cfg.sms ? null : smsProvider(cfg.sms),
    // FID-01: texts leave from the salon's phone and Brevo is configured too: a service text the phone refuses goes once
    // more through Brevo (scheduler.js sendText), so a phone left off does not lose a reminder
    smsFallback: cfg.mode === 'demo' || !cfg.sms || cfg.sms.kind !== 'gateway' || !cfg.smsRoutes.brevo ? null : smsProvider(cfg.smsRoutes.brevo),
    // MSG-02: none in demo either (the outbox shows the way it would have gone)
    whatsapp: cfg.mode === 'demo' || !cfg.whatsapp ? null : whatsappProvider(cfg.whatsapp),
    /** The provider of an SMS route, for the owner's test of a route not in use yet (built once). @param {string} kind */
    smsRoute(kind) {
      if (cfg.mode === 'demo' || !Object.hasOwn(cfg.smsRoutes, kind)) return null;
      if (rt.sms && rt.sms.name === kind) return rt.sms;
      if (rt.smsFallback && rt.smsFallback.name === kind) return rt.smsFallback;
      routes[kind] = routes[kind] || smsProvider(cfg.smsRoutes[kind]);
      return routes[kind];
    },
    // like the SMS: none in demo (marked simulé), none without the configuration (mail waits in the outbox)
    email: cfg.mode === 'demo' || !cfg.email ? null : emailProvider(cfg.email),
    lastTick: 0, ticking: /** @type {Promise<any>|null} */ (null)
  };
  rt.pay = stripeOk ? stripeProvider(/** @type {any} */ (cfg.stripe)) : simulatedProvider({ get baseUrl() { return rt.origin; } });
  return rt;
}
