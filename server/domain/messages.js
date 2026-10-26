// @ts-check
// Text messages the salon sends: confirmations, reminders, review requests, "on recoupe ?".
// They are queued as events (so the Comptoir shows exactly what left and when) and delivered by a provider.
import { dayParts, DAYS_SH, MONTHS_SH, fmtTime } from '../../shared/dates.js';
import { maskPhone } from '../lib/util.js';
import { fmtEur } from '../../shared/money.js';

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

/**
 * Queue one message. Deterministic ids (kind + target) mean the same reminder is never queued twice,
 * even when two servers run the scheduler at the same moment.
 * @param {any} s
 * @param {import('../core/engine.js').Ctx} ctx
 * @param {{ key: string, template: string, text?: string, to: string, cid?: string|null, apptId?: string|null, vars: Record<string, any>, dueAt?: number, channel?: 'sms'|'email' }} m
 */
export function queueMessage(s, ctx, m) {
  const id = 'msg_' + m.key;
  if (s.messages.has(id) || ctx.drafts.some((d) => d.type === 'message.queued' && d.data.id === id)) return null;
  if (!m.to) return null;
  const tpl = m.text || s.settings.messages.templates[m.template] || '';
  const body = renderTemplate(tpl, m.vars);
  ctx.emit('message.queued', {
    id, channel: m.channel || 'sms', template: m.template, cid: m.cid || null, apptId: m.apptId || null,
    dueAt: m.dueAt || ctx.now, toMasked: maskPhone(m.to)
  }, { to: m.to, body });
  return id;
}
