// @ts-check
// The owner's summaries (settings.notify), a tick step: every evening at the chosen time, today's takings with the Z and
// its seal, tomorrow's bookings and free half-hours, failed texts and the last backup, by e-mail and optionally by SMS;
// every Monday from 8 h, last week's report. Keys are the day's: two ticks or two servers never queue one twice.
import { addDays, dayParts, fmtTime, instantOf, localParts, MONTHS_SH, parseHhmm } from '../../../shared/dates.js';
import { fmtEur } from '../../../shared/money.js';
import { busyIntervals, staffIntervals, subtract } from '../../domain/availability.js';
import { closureNo, dayTotals, zFigures } from '../../domain/cash.js';
import { previousPeriod, report } from '../../domain/insights.js';
import { dayFr as dayLong, ownerEmail } from '../../domain/mails.js';
import { STALE_MS } from '../../core/backup.js';
import { queueMessage } from '../../domain/messages.js';
import { normPhone, isEmail } from '../../lib/util.js';

export const WEEKLY_FROM_MIN = 8 * 60;
const LIVE = new Set(['pending', 'booked', 'arrived', 'in_chair']);

const recipients = (s) => {
  const N = s.settings.notify || {};
  const to = ownerEmail(s);
  return { to: isEmail(to) ? to : '', phone: N.phone ? normPhone(N.phone) : '' };
};
const pct = (x) => Math.round(x * 100) + ' %';
const halfHours = (n) => n + (n > 1 ? ' demi-heures libres' : ' demi-heure libre');
const comptoir = (ctx, page = '') => (ctx.meta.siteUrl ? ctx.meta.siteUrl.replace(/\/+$/, '') + '/comptoir' + page : '');

/** Is the evening summary due and not queued yet? The scheduler looks the last backup up only then. */
export function digestDue(s, local) {
  const N = s.settings.notify;
  const at = N && N.evening ? parseHhmm(N.evening) : null;
  if (at == null || local.min < at || s.messages.has('msg_digest_' + local.day) || s.messages.has('msg_digestsms_' + local.day)) return false;
  const r = recipients(s);
  return !!(r.to || r.phone);
}

/** "Z0051 · 741,00 € · sceau cdb15a7d…" */
export function zLine(z) {
  return closureNo(z.number) + ' · ' + fmtEur(zFigures(z).netTtc, { decimals: true }) + ' · sceau ' + String(z.seal || '').slice(0, 8) + '…';
}

/** Free half-hours of each chair on a day: working time minus bookings, blocks and holds. */
export function freeHalfHours(s, day, now) {
  const out = [];
  for (const st of s.staff.values()) {
    if (!st.active || !st.chair) continue;
    const work = staffIntervals(s, st.id, day);
    if (!work.length) continue;
    const n = subtract(work, busyIntervals(s, st.id, day, { now })).reduce((t, [a, b]) => t + Math.floor((b - a) / 30), 0);
    out.push({ name: st.name, n });
  }
  return out;
}

/**
 * The evening mail and its SMS, or null on a day with nothing to tell (no till, no Z, nothing tomorrow).
 * ctx.meta.backup (from the scheduler): { at, off } of the last backup; ctx.meta.providers: { sms, email } present.
 */
export function eveningDigest(s, ctx) {
  const day = ctx.local.day, tomorrow = addDays(day, 1);
  const t = dayTotals(s, day);
  const z = s.closures.get(day) || null;
  const appts = [...(s.apptsByDay.get(tomorrow) || [])].map((id) => s.appts.get(id)).filter((a) => a && LIVE.has(a.status) && !a.legacy);
  const noShows = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.status === 'no_show').length;
  if (!t.tickets && !t.refunds && !z && !appts.length) return null;
  const free = freeHalfHours(s, tomorrow, ctx.now);
  const freeN = free.reduce((x, f) => x + f.n, 0);
  const lastZ = z || [...s.closures.values()].filter((c) => c.day < day).sort((a, b) => b.number - a.number)[0] || null;
  const since = instantOf(day, 0);
  const count = (ch, f) => [...s.messages.values()].filter((m) => (m.channel || 'sms') === ch && f(m)).length;
  const failedOf = (ch) => count(ch, (m) => m.status === 'failed' && (m.sentAt || m.at) >= since);
  // an e-mail summary cannot tell that e-mail is failing, so its SMS names both
  const fails = words(failedOf('sms'), failedOf('email'));
  // outside the demo (which simulates them), the messages due that no provider can take
  const providers = s.mode === 'demo' ? null : ctx.meta.providers || null;
  const waitOf = (ch) => (providers && !providers[ch] ? count(ch, (m) => m.status === 'queued' && (m.dueAt || m.at) <= ctx.now) : 0);
  const waiting = words(waitOf('sms'), waitOf('email'));
  const b = ctx.meta.backup;
  const backup = !b ? '' : b.off ? b.off : b.at
    ? 'dernière ' + dayLong(localParts(b.at).day) + ' à ' + fmtTime(localParts(b.at).min) + (ctx.now - b.at > STALE_MS ? ', il y a plus de 36 h : regarde Réglages › Données' : '')
    : b.unknown ? 'état inconnu, le stockage n’a pas répondu : regarde Réglages › Données'
      : 'aucune pour l’instant : vérifie BACKUP_KEY et le stockage Blob (Réglages › Données)';
  const lines = [
    'Bonsoir,', '',
    'Aujourd’hui, ' + dayLong(day),
    '· Chiffre d’affaires : ' + fmtEur(t.net, { decimals: true }) + ' (' + t.tickets + (t.tickets > 1 ? ' tickets' : ' ticket') + ')',
    z ? '· ' + zLine(z) : '· Z du jour pas encore fait' + (lastZ ? '. Dernier : ' + zLine(lastZ) + ' (' + dayLong(lastZ.day) + ')' : ''),
    ...(noShows ? ['· ' + noShows + (noShows > 1 ? ' absences' : ' absence')] : []),
    '',
    'Demain, ' + dayLong(tomorrow),
    ...(free.length || appts.length ? [
      '· ' + appts.length + ' rendez-vous',
      '· ' + halfHours(freeN) + (free.length > 1 && freeN ? ' (' + free.filter((f) => f.n).map((f) => f.name + ' ' + f.n).join(', ') + ')' : '')
    ] : ['· Salon fermé']),
    '',
    '· Envois : ' + (fails ? fails + ' en échec aujourd’hui, le détail dans Relances › Messages envoyés' : 'aucun échec aujourd’hui') + (waiting ? ' ; ' + waiting + ' en attente d’un fournisseur' : ''),
    ...(backup ? ['· Sauvegarde : ' + backup] : []),
    ...(comptoir(ctx) ? ['', 'Le Comptoir : ' + comptoir(ctx)] : [])
  ];
  const subject = 'Ta journée du ' + dayLong(day) + ' : ' + fmtEur(t.net) + ' · demain ' + appts.length + ' rendez-vous';
  const sms = "L'Architecte : aujourd'hui " + fmtEur(t.net) + (z ? ' (' + closureNo(z.number) + ')' : ', Z pas encore fait') + '. Demain ' + appts.length + ' rdv, ' + halfHours(freeN) + '.' + (fails ? ' ' + fails + ' en échec.' : '');
  return { subject, text: lines.join('\n'), sms };
}

const short = (day) => { const p = dayParts(day); return (p.d === 1 ? '1er' : p.d) + ' ' + MONTHS_SH[p.m - 1]; };
/** "2 SMS et 1 e-mail", '' for none. */
function words(sms, mail) {
  return [sms ? sms + ' SMS' : '', mail ? mail + (mail > 1 ? ' e-mails' : ' e-mail') : ''].filter(Boolean).join(' et ');
}

/** Monday's mail: the week before, from report(), against the week before it. Null for a week with nothing in it. */
export function weeklyReport(s, ctx) {
  const today = ctx.local.day;
  const from = addDays(today, -7), to = addDays(today, -1);
  const r = report(s, { from, to, today, now: ctx.now });
  if (!r.tickets && !r.done && !r.noShows) return null;
  const p = previousPeriod(from, to);
  const prev = report(s, { from: p.from, to: p.to, today, now: ctx.now });
  const delta = prev.revenue > 0 ? Math.round(((r.revenue - prev.revenue) / prev.revenue) * 100) : null;
  const vs = delta == null ? '' : ' (' + (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta) + ' % sur la semaine d’avant)';
  const best = r.staff.find((x) => x.revenue > 0);
  const top = [...r.services].sort((a, b) => b.count - a.count).slice(0, 3);
  const lines = [
    'Bonjour,', '',
    'La semaine du ' + dayLong(from) + ' au ' + dayLong(to) + ' :',
    '· Chiffre d’affaires : ' + fmtEur(r.revenue, { decimals: true }) + vs,
    '· Visites : ' + r.done + (r.newClients ? ', dont ' + r.newClients + (r.newClients > 1 ? ' nouveaux clients' : ' nouveau client') : ''),
    '· Absences : ' + r.noShows + (r.done + r.noShows ? ' (' + pct(r.noShowRate) + ')' : ''),
    ...(best ? ['· Meilleur barbier : ' + best.name + ', ' + fmtEur(best.revenue, { decimals: true })] : []),
    ...(top.length ? ['· Top prestations : ' + top.map((x) => x.name + ' (' + x.count + ')').join(', ')] : []),
    '· Remplissage : ' + pct(r.occupancy),
    ...(comptoir(ctx) ? ['', 'Le détail : ' + comptoir(ctx, '/rapports')] : [])
  ];
  return { subject: 'Ta semaine du ' + short(from) + ' au ' + short(to) + ' : ' + fmtEur(r.revenue) + (delta == null ? '' : ' (' + (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta) + ' %)'), text: lines.join('\n') };
}

/** @type {{ name: string, run: (s: any, ctx: import('../../core/engine.js').Ctx) => void }} */
export default {
  name: 'digest',
  run(s, ctx) {
    const N = s.settings.notify;
    if (!N) return;
    const L = ctx.local;
    const { to, phone } = recipients(s);
    if (digestDue(s, L)) {
      const d = eveningDigest(s, ctx);
      if (d && to) queueMessage(s, ctx, { key: 'digest_' + L.day, channel: 'email', template: 'digest', to, vars: {}, subject: d.subject, text: d.text, links: [comptoir(ctx)] });
      if (d && phone) queueMessage(s, ctx, { key: 'digestsms_' + L.day, template: 'digest', to: phone, text: d.sms, vars: {} });
    }
    if (N.weekly && to && L.wd === 1 && L.min >= WEEKLY_FROM_MIN && !s.messages.has('msg_weekly_' + L.day)) {
      const w = weeklyReport(s, ctx);
      if (w) queueMessage(s, ctx, { key: 'weekly_' + L.day, channel: 'email', template: 'weekly', to, vars: {}, subject: w.subject, text: w.text, links: [comptoir(ctx, '/rapports')] });
    }
  }
};
