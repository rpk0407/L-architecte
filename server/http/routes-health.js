// @ts-check
// Is the salon ready, and is it running? The facts behind Réglages › Mise en route (the go-live steps, ticked live)
// and the Santé card of Réglages › Données: scheduler, Stripe webhook, messages that failed or wait for a provider,
// backup, integrity, public address and indexing. Read only, except the owner's test SMS (no event: it changes nothing).
import { HttpError, guard } from './kit.js';
import { verifyChain } from '../core/journal.js';
import { backupState, backupStatus } from '../core/backup.js';
import { shopIntervals } from '../domain/availability.js';
import { phoneAllowed, renderTemplate } from '../domain/messages.js';
import { normPhone, maskPhone } from '../lib/util.js';
import { frHoliday } from '../../shared/sms.js';
import { lastSmsTrouble } from './routes-channels.js';
import { TEMPLATE_FLAGS } from '../core/templates.js';
import { addDays, weekday } from '../../shared/dates.js';

const HOUR = 3600000;
/** the external scheduler is fine when it called under 15 minutes ago; past 30 during opening hours, held texts are not leaving */
export const TICK_OK_MS = 15 * 60000;
export const TICK_LATE_MS = 30 * 60000;
/** a text that waited this long after its time with no dispatch at all in between: nothing was sending */
export const LATE_MS = 30 * 60000;
export const TEST_SMS_PER_HOUR = 3;
/** FID-01: the salon's phone sends 5 texts a dispatch; with the cron further apart than this, it falls behind */
export const GATEWAY_CRON_MS = 3 * 60000;
/** the Blob store is listed at most this often for the health answer (each list is a billed call) */
const BACKUP_LIST_MS = 5 * 60000;

/** What the mentions légales need (public/mentions-legales.html), with the owner's words for each. */
const LEGAL = /** @type {const} */ ([
  ['legalName', 'nom légal'], ['siret', 'SIRET'], ['registration', 'immatriculation (RM ou RNE)'], ['address', 'adresse'], ['zip', 'code postal'],
  ['city', 'ville'], ['phone', 'téléphone'], ['email', 'e-mail'], ['publicationDirector', 'directeur de la publication'],
  ['mediator.name', 'médiateur de la consommation'], ['host.name', 'hébergeur']
]);
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/** the whole chain is checked again at most this often: a long journal takes a second or two */
const VERIFY_EVERY_MS = 10 * 60000;
const WEBHOOK_TYPES = new Set(['payment.succeeded', 'payment.failed', 'payment.expired', 'payment.refundedOutside', 'payment.disputed', 'payment.disputeClosed', 'payout.recorded']);
// PAY-03: Stripe Billing's notices that write no payment (a refused renewal, a cancellation in the portal, an end)
for (const t of ['member.pastDue', 'member.cancelRequested', 'member.ended']) WEBHOOK_TYPES.add(t);

/** Things only the journal knows. The journal only grows, so each visit reads just the events added since the last one
 *  (from the start again when it was replaced: a demo reset, a restore). */
const memo = new WeakMap();
export function journalFacts(rt) {
  const j = rt.engine.journal;
  let m = memo.get(rt);
  if (!m || m.n > j.length || (m.n && j[m.n - 1].h !== m.last)) m = { n: 0, last: '', stripe: 0, site: 0, wp: 0, integrity: null, checked: 0, checkedHead: '' };
  for (; m.n < j.length; m.n++) {
    const x = j[m.n];
    const d = x.data || {};
    // what a provider's webhook records (routes-payments.js; not the test page); a refund is written as the provider too, but by our own server (refundOnline)
    if (x.actor.t === 'provider' && x.actor.id !== 'simulated' && WEBHOOK_TYPES.has(x.type)) m.stripe = x.at;
    else if (x.type === 'appt.booked' && d.source === 'site' && !d.demo) m.site = x.at;
    // the WordPress import: what a run brought or carried over (a delta run that changed nothing leaves no trace)
    if ((x.type === 'client.added' && d.source === 'wordpress') || (x.type === 'appt.booked' && d.source === 'import') || (x.type === 'appt.moved' && d.by === 'import')
      || ((x.type === 'giftcard.issued' || x.type === 'pack.sold') && d.legacy) || (x.type === 'appt.cancelled' && d.reason === 'Annulé sur l’ancien site')) m.wp = x.at;
  }
  m.last = j.length ? j[j.length - 1].h : '';
  const now = Date.now();
  if (!m.integrity || (m.checkedHead !== m.last && now - m.checked > VERIFY_EVERY_MS)) {
    const v = /** @type {any} */ (verifyChain(j));
    m.integrity = v.ok ? { ok: true, count: v.count } : { ok: false, count: v.count, brokenAt: v.brokenAt, reason: v.reason };
    m.checked = now; m.checkedHead = m.last;
  }
  memo.set(rt, m);
  return m;
}

/** The e-mail channel (WP-02): its provider's name, or null. Read defensively, it may not be built on this install. */
function emailProvider(rt) {
  if (rt.email) return rt.email.name || 'brevo';
  return rt.cfg.email ? rt.cfg.email.kind || 'brevo' : null;
}

/** The public holidays of the next 12 months on a day the salon opens: those left open, and those closed. Once the
 *  owner has closed some, the others count as open on purpose. */
function holidaysOf(s, today) {
  const open = [];
  let closed = 0;
  for (let i = 0, d = today; i < 366; i++, d = addDays(d, 1)) {
    if (!frHoliday(d) || !(s.settings.hours[weekday(d)] || []).length) continue;
    if (s.settings.closures.some((c) => d >= c.from && d <= c.to)) closed++; else open.push(d);
  }
  return { open, closed };
}

/**
 * Did texts leave on time? Lasting evidence, read from the messages (shared by every instance, and not erased by the
 * owner's own visits, which tick too): a text due at D whose first dispatch of anything after D came more than LATE_MS
 * later had nobody sending it, typically the 08:00 texts held by quiet hours when no cron calls. A long relance
 * draining 10 texts a tick is not late: dispatches run all along. Texts due before the provider's first attempt
 * (the backlog of the go-live day) do not count.
 */
function lateness(msgs, now, hasProvider) {
  const claims = msgs.map((m) => m.claimedAt).filter((t) => t > 0).sort((a, b) => a - b);
  const firstAfter = (t) => { let lo = 0, hi = claims.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (claims[mid] < t) lo = mid + 1; else hi = mid; } return lo < claims.length ? claims[lo] : null; };
  let from = Infinity;
  for (const m of msgs) if ((m.status === 'sent' || m.status === 'failed') && m.sentAt < from) from = m.sentAt;
  let late = 0, overdue = 0, last = null;
  for (const m of msgs) {
    // dispatchable (claimed once, or waiting), on a channel with a provider, due in the last 24 h after the first attempt
    if (!(m.claimedAt || m.status === 'queued') || !hasProvider(m.channel || 'sms') || !(m.dueAt >= from) || m.dueAt < now - 24 * HOUR) continue;
    const next = firstAfter(m.dueAt);
    if (next != null ? next - m.dueAt <= LATE_MS : now - m.dueAt <= LATE_MS) continue;
    if (next == null) { overdue++; continue; }
    late++;
    if (!last || m.dueAt > last.dueAt) last = { dueAt: m.dueAt, ms: next - m.dueAt };
  }
  return { late, overdue, last };
}

/**
 * FID-01 · What the owner checks when a client says « je n'ai rien reçu »: how long the oldest text a client asked for
 * (a code, a link) has been waiting, and when the salon's phone last took a text.
 */
function sendFacts(msgs, now) {
  let oldest = 0, gatewayAt = 0;
  for (const m of msgs) {
    if (m.status === 'queued' && (TEMPLATE_FLAGS[m.template] || {}).requested && m.dueAt <= now && (!oldest || m.dueAt < oldest)) oldest = m.dueAt;
    // by SMS from the phone: not WhatsApp, not the Brevo fallback, not an e-mail
    if (m.status === 'sent' && m.channel !== 'email' && (m.via || 'sms') === 'sms' && m.sentAt > gatewayAt) gatewayAt = m.sentAt;
  }
  return { requestedWaitMs: oldest ? now - oldest : null, lastSentAt: gatewayAt || null };
}

/** The backup facts without listing Blob on every visit: the list at most every 5 minutes, this instance's newer
 *  backup (« Sauvegarder maintenant », the night's) on top of it. */
const listed = new WeakMap();
async function backupFacts(rt) {
  let c = listed.get(rt);
  if (!c || Date.now() - c.t > BACKUP_LIST_MS) { c = { t: Date.now(), p: backupStatus(rt) }; listed.set(rt, c); }
  let b;
  try { b = await c.p; } catch (err) { listed.delete(rt); throw err; }
  const st = backupState(rt);
  const last = st.last && (!b.last || st.last.at > b.last.at) ? st.last : b.last;
  return { ...b, last, error: b.unreadable ? b.error : last && st.failedAt && last.at > st.failedAt ? '' : st.error };
}

/**
 * Everything GET /api/v1/health returns. Times are on the salon's clock (engine.clock), like every other date.
 * @param {any} rt @param {{ day: string, min: number }} L
 */
export async function healthOf(rt, L) {
  const e = rt.engine;
  const s = e.state;
  const now = e.clock();
  const prod = s.mode === 'production';
  const j = journalFacts(rt);

  // the scheduler. rt.lastTick is this instance's last run, from any traffic (the Comptoir's pulse ticks too), so it
  // proves nothing about the cron; rt.lastCron is this instance's last call of /api/cron/tick. Both on the machine's clock.
  const age = rt.lastTick ? Math.max(0, Date.now() - rt.lastTick) : null;
  const cronAge = rt.lastCron ? Math.max(0, Date.now() - rt.lastCron) : null;
  // a till's Z closes the drawer, not the salon: reminders still leave after it
  const open = shopIntervals(s, L.day).some(([a, b]) => L.min >= a && L.min < b);
  const msgs = [...s.messages.values()];
  const sms = !!rt.sms, mail = emailProvider(rt);
  const late = lateness(msgs, now, (ch) => (ch === 'email' ? !!mail : sms));
  const channel = (ch, provider) => {
    const of = msgs.filter((m) => (m.channel || 'sms') === ch);
    return {
      provider,
      failed24h: of.filter((m) => m.status === 'failed' && (m.updatedAt || m.at) >= now - 24 * HOUR).length,
      // production without a provider keeps them queued (the demo simulates them)
      queuedNoProvider: prod && !provider ? of.filter((m) => m.status === 'queued').length : 0
    };
  };

  /** @type {any} */
  let backup;
  try {
    const b = await backupFacts(rt);
    // configured: the key and the store are there (a step still to do otherwise, not a breakdown)
    backup = {
      at: b.last ? b.last.at : null, off: b.off, configured: b.key && b.blob, staleAfterMs: b.staleAfterMs,
      problem: !b.key ? 'BACKUP_KEY manquante ou invalide : ton prestataire la crée dans Vercel (exactement 43 lettres et chiffres), puis redéploie.'
        : !b.blob ? 'Aucun stockage Blob privé relié (BLOB_READ_WRITE_TOKEN) : pas de sauvegarde automatique.' : b.error
    };
  } catch (err) { backup = { at: null, off: '', configured: false, problem: String(err && err.message || err), staleAfterMs: 36 * HOUR }; }

  const publicUrl = rt.cfg.publicUrl || rt.origin || '';
  let host = '';
  try { host = publicUrl ? new URL(publicUrl).hostname : ''; } catch { /* not a URL */ }
  const shop = s.settings.shop;
  const chairs = [...s.staff.values()].filter((x) => x.active && x.chair).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const services = [...s.services.values()].filter((x) => x.active);
  const hol = holidaysOf(s, L.day);
  return {
    now, mode: s.mode,
    tick: {
      at: age == null ? null : now - age, ageMs: age, cron: !!rt.cfg.cronSecret, cronAt: cronAge == null ? null : now - cronAge, cronAgeMs: cronAge,
      open, overdue: late.overdue, late24h: late.late, lastLate: late.last, okMs: TICK_OK_MS, lateMs: TICK_LATE_MS
    },
    stripe: { provider: rt.pay.name, live: !!rt.pay.live, lastWebhook: j.stripe || null },
    // MSG-02: the route in use (provider, and WhatsApp in front of it when it is on) and the last text that failed
    // FID-01: the oldest text a client asked for still waiting, the last text that left by SMS (from the salon's phone when it
    // is the provider), and whether the cron calls too seldom for the phone (5 texts a dispatch: one call a minute)
    sms: {
      ...channel('sms', sms ? rt.sms.name : null), whatsapp: !!rt.whatsapp && !!(s.settings.messages.whatsapp && s.settings.messages.whatsapp.enabled), ...lastSmsTrouble(msgs),
      ...sendFacts(msgs, now), fallback: !!rt.smsFallback,
      cronSlow: sms && rt.sms.name === 'gateway' && (!rt.cfg.cronSecret || (rt.cronGap || 0) > GATEWAY_CRON_MS || (cronAge != null && cronAge > GATEWAY_CRON_MS))
    },
    email: channel('email', mail),
    backup,
    // when the chain was last checked, on the salon's clock; `events` is the journal now (it grew since, maybe)
    integrity: { ...j.integrity, at: now - (Date.now() - j.checked), events: e.journal.length },
    publicUrl, publicUrlCustom: /^https:\/\//.test(publicUrl) && !!host && !/(^|\.)vercel\.app$/i.test(host) && host !== 'localhost',
    // LX_INDEX (read once, runtime.js) takes effect with the build of this deployment, which reads the same environment
    indexable: rt.cfg.index === true,
    setup: {
      legal: { missing: LEGAL.filter(([k]) => !String(get(shop, k) || '').trim()).map(([, label]) => label) },
      hours: { openDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => (s.settings.hours[d] || []).length).length, holidays: hol.open, holidaysClosed: hol.closed, closures: s.settings.closures.filter((c) => c.to >= L.day).length },
      services: { active: services.length, online: services.filter((x) => x.online !== false).length },
      team: { chairs: chairs.map((x) => ({ id: x.id, name: x.name, pin: !!x.hasPin })) },
      devices: [...s.devices.values()].filter((d) => !d.revoked).length,
      import: { clients: [...s.clients.values()].filter((c) => c.source === 'wordpress' && !c.mergedInto).length, appts: s.apptByWp.size, last: j.wp || null },
      siteBooking: j.site || null
    }
  };
}

export function healthRoutes(app) {
  app.get('/api/v1/health', (r) => healthOf(r.rt, r.local), { cap: 'settings' });

  /** The owner's own phone gets one text through the real provider: the sender name, the credit and the links, checked. */
  app.post('/api/v1/health/test-sms', async (r) => {
    const s = r.s;
    // the number typed, else the owner's alert phone (settings.notify, WP-02), else the salon's when it is a mobile.
    // A French mobile only: it is the owner's own phone, and the route is no way to text anyone, anywhere.
    const typed = String(r.body.phone || '').trim();
    const mobile = (p) => /^\+33[67]\d{8}$/.test(p);
    const saved = [s.settings.notify && s.settings.notify.phone, s.settings.shop.phone].map(normPhone).find(mobile) || '';
    const to = typed ? normPhone(typed) : saved;
    if (!to) throw new HttpError(400, 'no_phone', typed ? 'Ce numéro n’est pas valable.' : 'Indique ton numéro de portable.');
    if (!phoneAllowed(to, s.settings.messages.countries)) throw new HttpError(400, 'country', 'Les SMS ne partent pas vers ce pays (Réglages › Messages).');
    if (!mobile(to)) throw new HttpError(400, 'not_mobile', 'Le SMS test part vers un portable français (06 ou 07).');
    const demo = s.mode === 'demo';
    if (!r.rt.sms && !demo) throw new HttpError(409, 'no_provider', 'Aucun fournisseur SMS n’est branché : rien ne peut partir pour l’instant.');
    guard('test-sms|' + r.me.id, TEST_SMS_PER_HOUR, HOUR, 'Trois SMS de test par heure au plus. Réessaie plus tard.');
    const body = renderTemplate('Test du Comptoir : les SMS de {salon} partent bien. Les liens envoyés aux clients ouvrent {site}', { salon: s.settings.shop.name, site: r.meta.siteUrl });
    if (demo || !r.rt.sms) return { ok: true, simulated: true, to: maskPhone(to), body };
    try {
      const res = await r.rt.sms.send(to, body, {});
      return { ok: true, simulated: false, to: maskPhone(to), body, ref: res.ref };
    } catch (err) { throw new HttpError(502, 'sms_failed', 'Le fournisseur a refusé le SMS : ' + String(err && err.message || err)); }
  }, { cap: 'settings' });
}
