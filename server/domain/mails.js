// @ts-check
// The e-mails about one appointment: the client's confirmation (with the calendar file and the "Gérer mon rendez-vous"
// link) and cancellation, and the owner's alert for each online booking or cancellation. Each is queued like an SMS
// (domain/messages.js), with a deterministic key, and left by the scheduler (messaging/email.js).
import { dayParts, dayLong, DAYS_SH, fmtTime, pad2 } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { apptIcs } from '../lib/ics.js';
import { isEmail } from '../lib/util.js';
import { queueMessage } from './messages.js';

/** Where the owner's mail goes: settings.notify.to, else the owner account's own e-mail (both kept in pii). */
export function ownerEmail(s) {
  const n = s.settings.notify;
  if (n && n.to) return n.to;
  const o = [...s.staff.values()].find((x) => x.role === 'owner' && x.active && x.email);
  return o ? o.email : '';
}

/** dayLong, with French's "1er": "dimanche 1er novembre". */
export const dayFr = (day) => dayLong(day).replace(/(^|\s)1(?=\s)/, (m, sp) => sp + '1er');

/** "jeu. 29/10 10 h" */
export function shortWhen(day, start) { const p = dayParts(day); return DAYS_SH[p.wd] + ' ' + pad2(p.d) + '/' + pad2(p.m) + ' ' + fmtTime(start); }

const barberOf = (s, a) => { const st = s.staff.get(a.staffId); return st ? st.name : 'ton barbier'; };
const what = (a) => a.services.map((x) => x.name).join(' + ');
const price = (a) => (a.services.some((x) => x.from) ? 'à partir de ' : '') + fmtEur(a.price);
const where = (shop) => [shop.address, [shop.zip, shop.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const hello = (first) => 'Bonjour' + (first ? ' ' + first : '') + ',';

/**
 * The client's confirmation, or the new time after a move (a.moves counts it): the same calendar event, updated.
 * @param {{ to: string, first?: string, link?: string }} o
 */
export function mailConfirmation(s, ctx, a, o) {
  if (!s.settings.messages.email || !isEmail(o.to)) return null;
  const shop = s.settings.shop, barber = barberOf(s, a);
  const when = dayFr(a.day) + ' à ' + fmtTime(a.start);
  const moved = (a.moves || 0) > 0;
  const paid = a.deposit && a.deposit.paid ? ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' réglé' : '';
  const text = [
    hello(o.first), '',
    (moved ? 'Ton rendez-vous est déplacé : ' : 'C’est noté : ') + when + ' avec ' + barber + '.',
    what(a) + ' · ' + price(a) + paid, '',
    shop.name, where(shop),
    ...(o.link ? ['', 'Gérer mon rendez-vous (déplacer ou annuler) : ' + o.link] : []),
    '', 'Le fichier joint ajoute le rendez-vous à ton agenda.', 'À bientôt !'
  ].join('\n');
  return queueMessage(s, ctx, {
    key: 'mconf_' + a.id + '_' + (a.moves || 0), channel: 'email', template: 'confirmation', to: o.to, cid: a.clientId, apptId: a.id, vars: {},
    subject: (moved ? 'Rendez-vous déplacé : ' : 'Rendez-vous confirmé : ') + when + ' · ' + shop.name, text,
    cta: o.link ? { label: 'Gérer mon rendez-vous', url: o.link } : undefined, links: [o.link || ''],
    attachments: [{ name: 'rendez-vous.ics', type: 'text/calendar; charset=utf-8; method=PUBLISH', content: apptIcs(shop, a, { barber, link: o.link, now: ctx.now }) }]
  });
}

/**
 * The client's cancellation, by the salon or by themselves: the calendar file takes it out of their agenda.
 * @param {{ to: string, first?: string, by: 'salon'|'client' }} o
 */
export function mailCancellation(s, ctx, a, o) {
  if (!s.settings.messages.email || !isEmail(o.to)) return null;
  const shop = s.settings.shop, barber = barberOf(s, a);
  const when = dayFr(a.day) + ' à ' + fmtTime(a.start);
  const site = ctx.meta.siteUrl || '';
  const text = [
    hello(o.first), '',
    (o.by === 'client' ? 'Ton annulation est bien prise en compte : ton rendez-vous du ' : 'Ton rendez-vous du ') + when + ' avec ' + barber + (o.by === 'client' ? ' est annulé.' : ' est annulé par le salon.'),
    ...(site ? ['', 'Pour en reprendre un : ' + site] : []),
    '', shop.name + (shop.phone ? ' · ' + shop.phone : '')
  ].join('\n');
  return queueMessage(s, ctx, {
    key: 'mcx_' + a.id, channel: 'email', template: 'cancelled', to: o.to, cid: a.clientId, apptId: a.id, vars: {},
    subject: 'Rendez-vous annulé : ' + when + ' · ' + shop.name, text,
    cta: site ? { label: 'Reprendre rendez-vous', url: site } : undefined, links: [site],
    attachments: [{ name: 'annulation.ics', type: 'text/calendar; charset=utf-8; method=CANCEL', content: apptIcs(shop, a, { barber, now: ctx.now, cancel: true, organizer: isEmail(shop.email) ? shop.email : undefined }) }]
  });
}

/**
 * The owner's alert: 'Nouveau rendez-vous : Karim, jeu. 29/10 10 h avec JKut (Coupe classique)'.
 * It names the client, so it carries their id: erasing them blanks it with the rest.
 * @param {'booked'|'cancelled'} kind
 * @param {{ first?: string, reason?: string }} [o]
 */
export function mailOwner(s, ctx, a, kind, o = {}) {
  const N = s.settings.notify;
  if (!N || !(kind === 'booked' ? N.newBooking : N.cancel)) return null;
  const to = ownerEmail(s);
  if (!isEmail(to)) return null;
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  const first = o.first || (c && c.first) || (a.name || '').split(' ')[0] || 'Un client';
  const head = (kind === 'booked' ? 'Nouveau rendez-vous : ' : 'Annulation : ') + first + ', ' + shortWhen(a.day, a.start) + ' avec ' + barberOf(s, a) + ' (' + what(a) + ')';
  const comptoir = ctx.meta.siteUrl ? ctx.meta.siteUrl.replace(/\/+$/, '') + '/comptoir' : '';
  const text = [
    head + '.', '',
    kind === 'booked' ? 'Réservé en ligne · ' + price(a) + (a.deposit && a.deposit.paid ? ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' réglé' : '')
      : 'Annulé en ligne par le client' + (o.reason ? ' : « ' + o.reason + ' »' : '') + (a.deposit && a.deposit.paid ? ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' à voir' : ''),
    ...(comptoir ? ['', 'Le Comptoir : ' + comptoir] : [])
  ].join('\n');
  return queueMessage(s, ctx, {
    key: (kind === 'booked' ? 'obk_' : 'ocx_') + a.id, channel: 'email', template: kind === 'booked' ? 'owner_booking' : 'owner_cancel',
    // no apptId: the appointment's own messages are the client's
    to, cid: a.clientId || null, vars: {}, subject: head, text, links: [comptoir]
  });
}
