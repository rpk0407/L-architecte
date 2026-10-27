// @ts-check
// Messages the salon sends: confirmations, reminders, review requests, "on recoupe ?" by SMS, and e-mails (client
// confirmations with the calendar file, the owner's alerts and summaries).
// They are queued as events (so the Comptoir shows exactly what left and when) and delivered by a provider.
import { dayParts, DAYS_SH, MONTHS_SH, fmtTime } from '../../shared/dates.js';
import { afterQuiet, withStop } from '../../shared/sms.js';
import { maskPhone, maskEmail, isEmail } from '../lib/util.js';
import { fmtEur } from '../../shared/money.js';
import { TEMPLATE_FLAGS, classOf } from '../core/templates.js';
import { waVarNames } from '../settings/messages.js';
import { neverInformed } from '../projections/informed.js';

export function renderTemplate(tpl, vars) {
  // typographic quotes and dashes would switch the SMS to Unicode (70 characters instead of 160)
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)).replace(/\s+/g, ' ')
    .replace(/[’‘]/g, "'").replace(/«\s*|\s*»|[“”]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...').trim();
}

export function whenWords(day, start) {
  const p = dayParts(day);
  const w = DAYS_SH[p.wd];
  return { date: w.charAt(0).toUpperCase() + w.slice(1) + ' ' + p.d + ' ' + MONTHS_SH[p.m - 1], heure: fmtTime(start) };
}

/**
 * Variables available to every appointment template.
 * @param {(a: any) => string} [linkFor] signed "manage my appointment" link
 */
export function apptVars(s, a, linkFor) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  const st = s.staff.get(a.staffId);
  return {
    prenom: (c && c.first) || (a.name || '').split(' ')[0] || '',
    ...whenWords(a.day, a.start),
    barbier: st ? st.name : 'ton barbier',
    prestation: a.services.map((x) => x.name).join(' + '),
    prix: fmtEur(a.price),
    salon: s.settings.shop.name,
    avis: s.settings.shop.reviewUrl,
    lien: linkFor ? linkFor(a) : ''
  };
}

/** The id queueMessage gives the message of this key: what a link naming the message signs (the review's /avis/…). */
export const messageId = (key) => 'msg_' + key;

/**
 * {avis} of a review request: the tracked /avis/<token> link of that message (ctx.meta.reviewLink, http/app.js), which
 * records the opening and redirects to the salon's Google page; that page itself when nothing can sign (a script, a test).
 * @param {string} id the message id
 */
export function reviewLink(s, ctx, id) {
  const meta = ctx && ctx.meta;
  return meta && typeof meta.reviewLink === 'function' ? meta.reviewLink(id) : s.settings.shop.reviewUrl || '';
}

// the quiet hours and the STOP mention live in shared/, so the Comptoir shows what the server does
export { afterQuiet, withStop };

/** Is this number in one of the countries the salon texts? (E.164, from normPhone) */
export function phoneAllowed(to, countries) {
  return !Array.isArray(countries) || !countries.length || countries.some((p) => String(to).startsWith(p));
}

/** The file a message is about, followed through merges (a merged file's texts follow the client). */
export function fileOf(s, cid) {
  let c = cid ? s.clients.get(cid) : null;
  for (let i = 0; c && c.mergedInto && i < 20; i++) c = s.clients.get(c.mergedInto) || null;
  return c || null;
}

/**
 * Why a relation or marketing text may not go to this file now, or '' (core/templates.js says what each class needs).
 * Relation: a file, not erased, no STOP, texts not switched off (an e-mail to a file without a phone is the exception);
 * marketing: the client's yes. Neither to a file imported from WordPress and never told about the new site.
 * @param {'relation'|'marketing'} cls @param {'sms'|'email'} channel
 */
function refusal(s, c, cls, channel) {
  if (cls === 'marketing') return !c || c.erased || !c.marketing ? 'Désinscrit des bons plans' : neverInformed(s, c) ? 'Jamais informé' : '';
  if (!c || c.erased || c.marketingSrc === 'stop') return 'A répondu STOP';
  if (channel !== 'email' && c.sms === false) return 'SMS coupés par le client';
  return neverInformed(s, c) ? 'Jamais informé' : '';
}

/**
 * A promotional or relation text still waiting (quiet hours hold one up to a day and a half) may no longer go: the
 * client said STOP, or the salon switched their offers off, or the file is gone. Checked again right before it leaves.
 * Service texts and the owner's own tests are never held back here.
 * @returns {string} why it must not leave, or ''
 */
export function consentGone(s, m) {
  const cls = m.marketing ? 'marketing' : classOf(m.template);
  if (cls === 'service' || m.owner) return '';
  return refusal(s, fileOf(s, m.cid), cls, m.channel === 'email' ? 'email' : 'sms');
}

/**
 * MSG-02 · The template a text goes by on WhatsApp, or null: WhatsApp switched on, an approved template mapped for it,
 * and the salon's own words (a typed relance, an answer to a request) cannot ride on a fixed template, so those go by SMS.
 * Service texts only (FID-01): a review request or an offer would need the client's separate yes to WhatsApp, which the
 * salon does not collect, so those always leave by SMS.
 * @returns {{ id: number, params: string[] } | null}
 */
export function waMapping(M, template, custom = false) {
  const w = M && M.whatsapp;
  const t = w && w.enabled && w.templates && classOf(template) === 'service' ? w.templates[template] : null;
  return !custom && t && t.id > 0 ? t : null;
}
/** The variables a WhatsApp template may need, as text: kept with the SMS (pii) so the scheduler can fill the template. */
function waVars(vars) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of waVarNames()) if (vars && (typeof vars[k] === 'string' || typeof vars[k] === 'number')) out[k] = renderTemplate('{v}', { v: vars[k] });
  return out;
}

/** An e-mail's text: the variables filled in, the lines kept (an SMS is one line, a mail is not). */
export function renderMail(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * FILLERS (FID-01): a text whose words are only known as it leaves (a sign-in code, a fresh link), keyed by template:
 * the scheduler calls it on SMS and e-mail send, in place of the queued body. A REGISTRY: the package that owns the
 * template registers it here (AC-01 otp, AC-05 mailok and mlogin); nobody else edits the send path.
 * @type {Record<string, (m: any, rt: any) => string>}
 */
export const FILLERS = {};
/** The words a message leaves with: its filler's, else what was queued. */
export function fillBody(m, rt) {
  const f = Object.hasOwn(FILLERS, m.template) ? FILLERS[m.template] : null;
  return f ? f(m, rt) : m.body;
}

/** The line that tells a file imported from WordPress about the new site (decision 9 of the plan: the owner's words). */
export const INFORM_LINE = 'Nouveau site du salon. Tes données : {origin}/confidentialite';
/** Is a text that tells this file about the new site already on its way (or gone)? Then the next one need not say it. */
function informing(s, ctx, cid) {
  for (const x of s.messages.values()) if (x.informs && x.cid === cid && !['failed', 'skipped', 'expired'].includes(x.status)) return true;
  return ctx.drafts.some((d) => d.type === 'message.queued' && d.data.informs && d.data.cid === cid);
}
/** The salon's address for the line, from the request (no address, no line: a link to nowhere tells nobody). */
const originOf = (ctx) => String((ctx && ctx.meta && ctx.meta.siteUrl) || '').replace(/\/+$/, '');

/**
 * Queue one message. Deterministic ids (kind + target) mean the same reminder is never queued twice,
 * even when two servers run the scheduler at the same moment.
 * The consent class of the template decides who may get it (core/templates.js): marketing texts need the client's
 * yes and carry the STOP mention, relation texts stop at a STOP, neither goes to a file imported from WordPress before
 * it was told about the new site (the first service text to such a file tells it, with one line and `informs`);
 * quiet ones wait for the morning; a number outside the allowed countries is recorded as not sent.
 * Returns the id only when the text will leave.
 * channel 'email' takes a subject and the text (with an optional html, button and attachments): transactional
 * mail, so no quiet hours; never promotional (there is no unsubscribe link to honour).
 * owner: the owner's own test of the text (Réglages), to his own phone or e-mail: no client file to ask, and no quiet
 * hours (he is pressing the button now).
 * @param {any} s
 * @param {import('../core/engine.js').Ctx} ctx
 * @param {{ key: string, template: string, text?: string, to: string, cid?: string|null, apptId?: string|null, vars: Record<string, any>, dueAt?: number, channel?: 'sms'|'email',
 *   subject?: string, html?: string, cta?: { label: string, url: string }, links?: string[], attachments?: import('../messaging/email.js').MailAttachment[], owner?: boolean }} m
 */
export function queueMessage(s, ctx, m) {
  const id = messageId(m.key);
  if (s.messages.has(id) || ctx.drafts.some((d) => d.type === 'message.queued' && d.data.id === id)) return null;
  if (!m.to) return null;
  const M = s.settings.messages;
  const flags = TEMPLATE_FLAGS[m.template] || {};
  const cls = classOf(m.template);
  const c = fileOf(s, m.cid);
  // whoever queues it: no consent, no promotional text; a STOP or no file, no relation text
  if (cls !== 'service' && !(m.owner && cls === 'relation') && refusal(s, c, cls, m.channel === 'email' ? 'email' : 'sms')) return null;
  const origin = originOf(ctx);
  // to the client himself only: an alert to the owner about him, or a gift card to someone else, tells him nothing
  const own = !!c && (m.to === c.phone || (!!c.email && String(m.to).toLowerCase() === String(c.email).toLowerCase()));
  // not a text filled as it leaves (a sign-in code): its filler's words replace the queued ones, the line with them
  const informs = cls === 'service' && own && !!origin && !Object.hasOwn(FILLERS, m.template) && neverInformed(s, c) && !informing(s, ctx, c.id);
  const told = informs ? renderTemplate(INFORM_LINE, { origin }) : '';
  const extra = { ...(informs ? { informs: true } : {}), ...(m.owner ? { owner: true } : {}) };
  if (m.channel === 'email') return queueMail(ctx, m, id, flags, told, extra);
  const tpl = m.text || M.templates[m.template] || '';
  let body = renderTemplate(tpl, m.vars);
  if (told) body += ' ' + told;
  if (flags.marketing) body = withStop(body, M.stopSuffix);
  const due = m.dueAt || ctx.now;
  // WhatsApp on: the variables travel with the text (personal data, so in pii), the scheduler fills the template.
  // Not for the text that tells an imported file about the site: a template would drop that line
  const wa = !informs && waMapping(M, m.template, !!m.text && m.text !== M.templates[m.template]) ? waVars(m.vars) : null;
  ctx.emit('message.queued', {
    id, channel: 'sms', template: m.template, cid: m.cid || null, apptId: m.apptId || null,
    dueAt: flags.quiet && !m.owner ? afterQuiet(M.quiet, due) : due, toMasked: maskPhone(m.to), ...(flags.marketing ? { marketing: true } : {}), ...extra
  }, { to: m.to, body, ...(wa ? { wa } : {}) });
  if (!phoneAllowed(m.to, M.countries)) {
    ctx.emit('message.updated', { id, patch: { status: 'skipped', error: 'Numéro étranger non autorisé' } });
    return null;
  }
  return id;
}

/** The address, the subject and the files are personal data like the text: all in pii, out of the chain. */
function queueMail(ctx, m, id, flags, told = '', extra = {}) {
  if (flags.marketing || !isEmail(m.to)) return null;
  const vars = m.vars || {};
  const text = renderMail(m.text || '', vars);
  const body = text && told ? text + '\n\n' + told : text;
  // one line; the no-break spaces of '10 h' and '50 €' stay
  const subject = renderMail(m.subject || '', vars).replace(/[ \t\r\n]+/g, ' ').slice(0, 200);
  if (!body || !subject) return null;
  const mail = { subject, ...(m.html ? { html: m.html } : {}), ...(m.cta ? { cta: m.cta } : {}), ...(m.links && m.links.filter(Boolean).length ? { links: m.links.filter(Boolean) } : {}), ...(m.attachments && m.attachments.length ? { attachments: m.attachments } : {}) };
  ctx.emit('message.queued', {
    id, channel: 'email', template: m.template, cid: m.cid || null, apptId: m.apptId || null, dueAt: m.dueAt || ctx.now, toMasked: maskEmail(m.to, { domain: true }), ...extra
  }, { to: String(m.to).toLowerCase(), body, mail });
  return id;
}
