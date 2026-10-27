// @ts-check
// The salon's background work, carried by regular traffic (the Comptoir polls every few seconds while
// the shop is open) and by /api/cron/tick when a platform cron is available. At most once a minute.
// It also writes the nightly encrypted backup (core/backup.js), after 03:00 Paris, and delivers SMS, WhatsApp and e-mail.
import { tick } from '../commands/system.js';
import { claimMessage, messageResult } from '../commands/messages.js';
import { demoTick } from '../domain/seed.js';
import { startsAt } from '../domain/policy.js';
import { nightlyBackup, backupsOf, backupState, backupOff, ownBackups, salonOf } from '../core/backup.js';
import { webhookUrl, gatewayStop } from '../messaging/sms.js';
import { waMapping, fillBody } from '../domain/messages.js';
import { TEMPLATE_FLAGS, classOf } from '../core/templates.js';
import { digestDue } from '../commands/steps/digest.js';
import { localParts } from '../../shared/dates.js';
import { SOFTWARE } from '../version.js';

const SYSTEM = { actor: /** @type {const} */ ({ t: 'system', id: 'scheduler', n: 'Automatique' }), caps: new Set() };

export function maybeTick(rt, meta, { force = false } = {}) {
  const now = Date.now();
  if (rt.ticking) return rt.ticking;
  if (!force && now - rt.lastTick < 55000) return null;
  rt.lastTick = now;
  rt.ticking = (async () => {
    const e = rt.engine;
    if (!e.state.version) return;
    try {
      await e.run(tick, {}, { ...SYSTEM, meta: await tickMeta(rt, meta) });
      if (e.state.mode === 'demo') await demoTick(e, meta);
      await dispatch(rt);
    } finally {
      // last, so a slow Blob never holds back reminders; but a failing step before it never skips the backup
      await nightlyBackup(rt);
    }
  })().catch((err) => console.error('[lx] tick', err && err.stack ? err.stack : err)).finally(() => { rt.ticking = null; });
  return rt.ticking;
}

const LOOKUP_MS = 2000;
/** A promise that gives up after ms: the tick never waits on a slow Blob. */
function within(p, ms) {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * What the tick's steps cannot see in the state: which providers are there and, when the owner's evening summary is due,
 * the last backup (looked up in Blob at most once a day per instance, within 2 s, so the tick stays cheap).
 */
async function tickMeta(rt, meta) {
  const e = rt.engine;
  const out = { ...meta, providers: { sms: !!rt.sms, email: !!rt.email } };
  // CPT-01a: the closures' signing key and the version the technical log records (commands/steps/fiscal.js)
  Object.assign(out, { signer: rt.signer, software: SOFTWARE });
  const local = localParts(e.clock());
  if (!digestDue(e.state, local)) return out;
  const off = backupOff(rt), blob = off ? null : backupsOf(rt), st = backupState(rt);
  let unknown = false;
  if (blob && !st.last && rt.digestLookup !== local.day) {
    rt.digestLookup = local.day;
    // a lookup that fails says "état inconnu", never "aucune"
    try { st.last = ownBackups(await within(blob.listBackups(), LOOKUP_MS), salonOf(e.journal))[0] || null; } catch { unknown = true; }
  }
  return { ...out, backup: { at: st.last ? st.last.at : 0, off, unknown } };
}

const STALE_MS = 6 * 3600000;

/**
 * A message that waited too long (no provider yet, a long outage) is no longer worth sending:
 * due more than 6 h ago, or about an appointment that has already started.
 * @returns {string} why, or '' when it may still leave
 */
export function staleReason(s, m, now) {
  // a contract's acknowledgement is owed whatever the delay (legal, core/templates.js)
  if ((TEMPLATE_FLAGS[m.template] || {}).legal) return '';
  if (now - m.dueAt > STALE_MS) return 'Trop tard : en attente depuis plus de 6 h';
  const a = m.apptId ? s.appts.get(m.apptId) : null;
  // queued before the appointment (confirmation, reminder), not after it (thanks and review)
  if (a && m.at < startsAt(a) && startsAt(a) <= now) return 'Trop tard : le rendez-vous est passé';
  return '';
}

/**
 * MSG-02 · The WhatsApp template a text goes by, or null for SMS: WhatsApp on, the template mapped, and the variables
 * kept with the text (queued while it was on, and not the salon's own words). Read again as it leaves: switching
 * WhatsApp off sends the waiting ones by SMS.
 */
export function waRoute(s, m) {
  return m.channel !== 'email' && m.wa ? waMapping(s.settings.messages, m.template) : null;
}

/** Before each text to a phone that throttles (the salon's own, paceMs): wait until paceMs since the last one. */
function pacer(rt) {
  let last = 0;
  const sleep = rt.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  return async () => {
    const pace = (rt.sms && rt.sms.paceMs) || 0;
    if (!pace) return;
    const wait = last ? last + pace - Date.now() : 0;
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

/**
 * The order texts leave in (FID-01): what the client is waiting for with his phone in hand first (a code, a link he
 * asked for), then the acknowledgements of a contract and the service texts, then the relation ones, then the offers;
 * the oldest first within each. So a relance of 200 texts never holds back a sign-in code.
 */
export function sendRank(m) {
  const f = TEMPLATE_FLAGS[m.template] || {};
  if (f.requested) return 0;
  const c = m.marketing ? 'marketing' : classOf(m.template);
  return c === 'service' ? 1 : c === 'relation' ? 2 : 3;
}
const byRank = (a, b) => sendRank(a) - sendRank(b) || a.dueAt - b.dueAt;

/** The address could not be reached at all: nothing left, unlike a timeout (its cloud may have taken the text already). */
const UNREACHED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
/** The salon's phone surely did not take the text: its gateway answered with a refusal, or could not be reached. */
function refused(err) {
  if (!err || err.name === 'TimeoutError' || err.name === 'AbortError') return false;
  if (Number.isInteger(err.status)) return true;
  const code = err.cause && (err.cause.code || (err.cause.cause && err.cause.cause.code));
  return UNREACHED.has(code);
}
/** A contract's acknowledgement that failed is tried again, a little later each time (at most every 6 h). */
const retryAt = (m, now) => now + Math.min(6 * 3600000, 5 * 60000 * 2 ** Math.min(6, m.tries || 0));

/**
 * One text: by WhatsApp when it has a template there, else (or when WhatsApp refuses it) by SMS, in this same dispatch
 * and only once. A service text the salon's phone refuses goes once more through Brevo SMS when Brevo is configured too
 * (rt.smsFallback, via 'fallback'). The outcome says how it left (via) and why the first way did not take it (fallback).
 */
async function sendText(rt, s, m, beforeSms) {
  const t = waRoute(s, m);
  let fallback = '';
  if (t && rt.whatsapp) {
    // Meta refuses a template with an empty variable: such a text goes by SMS rather than fail
    const missing = t.params.find((k) => !m.wa[k]);
    if (missing) fallback = 'WhatsApp : {' + missing + '} manque pour ce message';
    else {
      try {
        const r = await rt.whatsapp.send(m.to, { templateId: t.id, params: t.params.map((k) => [k, m.wa[k]]) });
        return { status: 'sent', providerRef: r.ref, via: 'whatsapp' };
      } catch (err) { fallback = String(err && err.message || err); }
    }
    if (!rt.sms) return { status: 'failed', error: fallback, via: 'whatsapp' };
  }
  if (!rt.sms) return { status: 'failed', error: 'Aucun fournisseur SMS', via: 'sms', fallback };
  await beforeSms();
  const text = fillBody(m, rt);
  // from the salon's own number, the STOP mention names that number (Brevo's 36173 would not reach the salon)
  const body = rt.sms.name === 'gateway' && m.marketing ? gatewayStop(text, s.settings.messages.stopSuffix) : text;
  const opts = { marketing: !!m.marketing, webhookUrl: webhookUrl(rt.origin, rt.cfg.cronSecret) };
  const keep = fallback ? { fallback } : {};
  try {
    // marketing: Brevo's promotional type; the webhook brings STOP replies back to the client file
    const r = await rt.sms.send(m.to, body, opts);
    return { status: 'sent', providerRef: r.ref, via: 'sms', ...keep };
  } catch (err) {
    const why = String(err && err.message || err);
    // the salon's phone off, out of credit, or its app logged out: the service texts still reach the client, once, by Brevo.
    // Not after a timeout: the gateway may have taken it, and the client would get it twice
    if (rt.sms.name === 'gateway' && !refused(err)) return { status: 'failed', error: 'Téléphone du salon : pas de réponse à temps (le SMS est peut-être parti : pas de second envoi)', via: 'sms', ...keep };
    if (rt.sms.name === 'gateway' && rt.smsFallback && classOf(m.template) === 'service' && !m.marketing) {
      try {
        const r = await rt.smsFallback.send(m.to, text, { marketing: false, webhookUrl: opts.webhookUrl });
        return { status: 'sent', providerRef: r.ref, via: 'fallback', fallback: why };
      } catch (err2) { return { status: 'failed', error: String(err2 && err2.message || err2), via: 'fallback', fallback: why }; }
    }
    return { status: 'failed', error: why, via: 'sms', ...keep };
  }
}

/**
 * Deliver queued messages: claim them in one write, send each by its channel, record the outcomes in one write.
 * They leave in sendRank order. `only`: these messages and nothing else (dispatchNow).
 * @param {any} rt @param {number} [limit] @param {{ only?: Set<string> }} [o]
 */
export async function dispatch(rt, limit = 10, o = {}) {
  const e = rt.engine;
  const demo = e.state.mode === 'demo';
  const wa = rt.whatsapp || null;
  // production without a provider for a channel: its messages are not claimed, they wait in the outbox for one
  const live = (m) => demo || (m.channel === 'email' ? !!rt.email : !!rt.sms || (!!wa && !!waRoute(e.state, m)));
  if (!demo && !rt.sms && !rt.email && !wa) return 0;
  const now = e.clock();
  const only = o.only || null;
  const queued = [...e.state.messages.values()].filter((m) => m.status === 'queued' && m.dueAt <= now && (!only || only.has(m.id)) && live(m)).sort(byRank);
  // the stale ones go first and cost nothing to close, so a backlog never holds the fresh ones back
  const stale = demo ? [] : queued.filter((m) => staleReason(e.state, m, now)).slice(0, 100);
  const isStale = new Set(stale);
  // the salon's phone takes a few texts per dispatch (perRun), one every paceMs: the next tick takes the rest. What
  // leaves by WhatsApp does not go through the phone; what was asked for now (dispatchNow) is not held to it
  const cap = !demo && !only && rt.sms && rt.sms.perRun ? rt.sms.perRun : Infinity;
  const fresh = [];
  let texts = 0;
  for (const m of queued) {
    if (fresh.length >= limit) break;
    if (isStale.has(m)) continue;
    if (m.channel !== 'email' && !(wa && waRoute(e.state, m)) && texts++ >= cap) continue;
    fresh.push(m);
  }
  const due = [...stale, ...fresh];
  if (!due.length) return 0;
  const claimed = [];
  await e.batch((step) => { for (const m of due) { const r = step(claimMessage, { id: m.id }, SYSTEM); if (r.ok) claimed.push(m.id); } });
  const outcomes = [];
  const beforeSms = pacer(rt);
  for (const id of claimed) {
    const m = e.state.messages.get(id);
    if (!m || m.status !== 'claimed') continue;
    const email = m.channel === 'email';
    // the demo sends nothing; its outbox still says which way each text would have gone
    if (demo || (email ? !rt.email : !rt.sms && !wa)) { outcomes.push({ id, status: 'simulated', ...(email ? {} : { via: waRoute(e.state, m) ? 'whatsapp' : 'sms' }) }); continue; }
    const late = staleReason(e.state, m, now);
    if (late) { outcomes.push({ id, status: 'expired', error: late }); continue; }
    if (!m.to) { outcomes.push({ id, status: 'skipped', error: email ? 'Adresse effacée' : 'Numéro effacé' }); continue; }
    let out;
    if (!email) out = await sendText(rt, e.state, m, beforeSms);
    else {
      try {
        const mail = m.mail || {};
        const r = await rt.email.send({ to: m.to, subject: mail.subject || '', text: fillBody(m, rt), html: mail.html, cta: mail.cta, links: mail.links, attachments: mail.attachments, fromName: e.state.settings.shop.name, tag: m.template });
        out = { status: 'sent', providerRef: r.ref };
      } catch (err) { out = { status: 'failed', error: String(err && err.message || err) }; }
    }
    // a sign-in code's error and fallback are masked by messageResult, whatever the status (core/templates.js SECRET_TEMPLATES)
    // legal: back in the queue for a later try, never given up (its error stays on the row meanwhile)
    if (out.status === 'failed' && (TEMPLATE_FLAGS[m.template] || {}).legal) out = { ...out, status: 'queued', retryAt: retryAt(m, now) };
    outcomes.push({ id, ...out });
  }
  if (outcomes.length) await e.batch((step) => { for (const x of outcomes) step(messageResult, x, SYSTEM); });
  return outcomes.length;
}

/**
 * FID-01 · Send these messages now, not at the next tick: a code or a link the client is waiting for, phone in hand
 * (AC-01). The same claim and result commands as every dispatch, so a tick running at the same time never sends one twice.
 * @param {any} rt @param {string[]} ids
 */
export function dispatchNow(rt, ids) {
  const set = new Set((ids || []).filter(Boolean));
  return set.size ? dispatch(rt, set.size, { only: set }) : Promise.resolve(0);
}
