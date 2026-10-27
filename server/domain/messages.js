// @ts-check
// Text messages the salon sends: confirmations, reminders, review requests, "on recoupe ?".
// They are queued as events (so the Comptoir shows exactly what left and when) and delivered by a provider.
import { dayParts, DAYS_SH, MONTHS_SH, fmtTime } from '../../shared/dates.js';
import { afterQuiet, withStop } from '../../shared/sms.js';
import { maskPhone } from '../lib/util.js';
import { fmtEur } from '../../shared/money.js';
import { TEMPLATE_FLAGS } from '../core/templates.js';

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

// the quiet hours and the STOP mention live in shared/, so the Comptoir shows what the server does
export { afterQuiet, withStop };

/** Is this number in one of the countries the salon texts? (E.164, from normPhone) */
export function phoneAllowed(to, countries) {
  return !Array.isArray(countries) || !countries.length || countries.some((p) => String(to).startsWith(p));
}

/**
 * A promotional text still waiting (quiet hours hold one up to a day and a half) may no longer go: the client said
 * STOP, or the salon switched their offers off, or the file is gone. Checked again right before it leaves.
 * @returns {string} why it must not leave, or ''
 */
export function consentGone(s, m) {
  if (!m.marketing) return '';
  let c = m.cid ? s.clients.get(m.cid) : null;
  if (c && c.mergedInto) c = s.clients.get(c.mergedInto) || c;
  return !c || c.erased || !c.marketing ? 'Désinscrit des bons plans' : '';
}

/**
 * Queue one message. Deterministic ids (kind + target) mean the same reminder is never queued twice,
 * even when two servers run the scheduler at the same moment.
 * Marketing texts need the client's consent and carry the STOP mention; quiet ones wait for the morning;
 * a number outside the allowed countries is recorded as not sent. Returns the id only when the text will leave.
 * @param {any} s
 * @param {import('../core/engine.js').Ctx} ctx
 * @param {{ key: string, template: string, text?: string, to: string, cid?: string|null, apptId?: string|null, vars: Record<string, any>, dueAt?: number, channel?: 'sms'|'email' }} m
 */
export function queueMessage(s, ctx, m) {
  const id = 'msg_' + m.key;
  if (s.messages.has(id) || ctx.drafts.some((d) => d.type === 'message.queued' && d.data.id === id)) return null;
  if (!m.to) return null;
  const M = s.settings.messages;
  const flags = TEMPLATE_FLAGS[m.template] || {};
  const c = m.cid ? s.clients.get(m.cid) : null;
  // whoever queues it: no consent, no promotional text
  if (flags.marketing && (!c || !c.marketing)) return null;
  const tpl = m.text || M.templates[m.template] || '';
  let body = renderTemplate(tpl, m.vars);
  if (flags.marketing) body = withStop(body, M.stopSuffix);
  const due = m.dueAt || ctx.now;
  const sms = (m.channel || 'sms') === 'sms';
  ctx.emit('message.queued', {
    id, channel: m.channel || 'sms', template: m.template, cid: m.cid || null, apptId: m.apptId || null,
    dueAt: flags.quiet ? afterQuiet(M.quiet, due) : due, toMasked: maskPhone(m.to), ...(flags.marketing ? { marketing: true } : {})
  }, { to: m.to, body });
  if (sms && !phoneAllowed(m.to, M.countries)) {
    ctx.emit('message.updated', { id, patch: { status: 'skipped', error: 'Numéro étranger non autorisé' } });
    return null;
  }
  return id;
}
