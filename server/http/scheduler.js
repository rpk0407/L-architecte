// @ts-check
// The salon's background work, carried by regular traffic (the Comptoir polls every few seconds while
// the shop is open) and by /api/cron/tick when a platform cron is available. At most once a minute.
// It also writes the nightly encrypted backup (core/backup.js), after 03:00 Paris, and delivers SMS and e-mail.
import { tick } from '../commands/system.js';
import { claimMessage, messageResult } from '../commands/messages.js';
import { demoTick } from '../domain/seed.js';
import { startsAt } from '../domain/policy.js';
import { nightlyBackup, backupsOf, backupState, backupOff, ownBackups, salonOf } from '../core/backup.js';
import { webhookUrl } from '../messaging/sms.js';
import { digestDue } from '../commands/steps/digest.js';
import { localParts } from '../../shared/dates.js';

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
  if (now - m.dueAt > STALE_MS) return 'Trop tard : en attente depuis plus de 6 h';
  const a = m.apptId ? s.appts.get(m.apptId) : null;
  // queued before the appointment (confirmation, reminder), not after it (thanks and review)
  if (a && m.at < startsAt(a) && startsAt(a) <= now) return 'Trop tard : le rendez-vous est passé';
  return '';
}

/** Deliver queued messages: claim them in one write, send each by its channel, record the outcomes in one write. */
export async function dispatch(rt, limit = 10) {
  const e = rt.engine;
  const demo = e.state.mode === 'demo';
  /** @type {Record<string, any>} */
  const providers = { sms: rt.sms, email: rt.email };
  // production without a provider for a channel: its messages are not claimed, they wait in the outbox for one
  const live = (m) => demo || !!providers[m.channel || 'sms'];
  if (!demo && !rt.sms && !rt.email) return 0;
  const now = e.clock();
  const queued = [...e.state.messages.values()].filter((m) => m.status === 'queued' && m.dueAt <= now && live(m));
  // the stale ones go first and cost nothing to close, so a backlog never holds the fresh ones back
  const stale = demo ? [] : queued.filter((m) => staleReason(e.state, m, now)).slice(0, 100);
  const isStale = new Set(stale);
  const due = [...stale, ...queued.filter((m) => !isStale.has(m)).slice(0, limit)];
  if (!due.length) return 0;
  const claimed = [];
  await e.batch((step) => { for (const m of due) { const r = step(claimMessage, { id: m.id }, SYSTEM); if (r.ok) claimed.push(m.id); } });
  const outcomes = [];
  for (const id of claimed) {
    const m = e.state.messages.get(id);
    if (!m || m.status !== 'claimed') continue;
    const email = m.channel === 'email';
    const provider = providers[email ? 'email' : 'sms'];
    if (!provider || demo) { outcomes.push({ id, status: 'simulated' }); continue; }
    const late = staleReason(e.state, m, now);
    if (late) { outcomes.push({ id, status: 'expired', error: late }); continue; }
    if (!m.to) { outcomes.push({ id, status: 'skipped', error: email ? 'Adresse effacée' : 'Numéro effacé' }); continue; }
    try {
      if (email) {
        const mail = m.mail || {};
        const r = await provider.send({ to: m.to, subject: mail.subject || '', text: m.body, html: mail.html, cta: mail.cta, links: mail.links, attachments: mail.attachments, fromName: e.state.settings.shop.name, tag: m.template });
        outcomes.push({ id, status: 'sent', providerRef: r.ref });
      } else {
        // marketing: Brevo's promotional type; the webhook brings STOP replies back to the client file
        const r = await provider.send(m.to, m.body, { marketing: !!m.marketing, webhookUrl: webhookUrl(rt.origin, rt.cfg.cronSecret) });
        outcomes.push({ id, status: 'sent', providerRef: r.ref });
      }
    } catch (err) { outcomes.push({ id, status: 'failed', error: String(err && err.message || err) }); }
  }
  if (outcomes.length) await e.batch((step) => { for (const o of outcomes) step(messageResult, o, SYSTEM); });
  return outcomes.length;
}
