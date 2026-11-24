// @ts-check
// The e-mails about one appointment: the client's confirmation (with the calendar file and the "Gérer mon rendez-vous"
// link) and cancellation, the formule's one mail for its five dates (with the way into the client space), and the
// owner's alert for each online booking or cancellation. Each is queued like an SMS
// (domain/messages.js), with a deterministic key, and left by the scheduler (messaging/email.js).
import { addDays, dayParts, dayLong, DAYS_SH, fmtTime, pad2 } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { apptIcs } from '../lib/ics.js';
import { isEmail } from '../lib/util.js';
import { queueMessage } from './messages.js';
import { forFirstIn } from './notify.js';

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
 * @param {{ to: string, first?: string, link?: string, key?: string, resendOf?: string }} o key, resendOf: a fresh copy
 *   asked from the Comptoir (« Renvoyer la confirmation », commands/messages.js), under its own key
 */
export function mailConfirmation(s, ctx, a, o) {
  if (!s.settings.messages.email || !isEmail(o.to)) return null;
  const shop = s.settings.shop, barber = barberOf(s, a);
  const when = dayFr(a.day) + ' à ' + fmtTime(a.start);
  const moved = (a.moves || 0) > 0;
  // a place booked for a child or a friend on this contact's file: « avec JKut pour Léo »
  const g = forFirstIn(s, [a.clientId], a), pour = g ? ' pour ' + g : '';
  const paid = a.deposit && a.deposit.paid ? ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' réglé' : '';
  const text = [
    hello(o.first), '',
    (moved ? 'Ton rendez-vous est déplacé : ' : 'C’est noté : ') + when + ' avec ' + barber + pour + '.',
    what(a) + ' · ' + price(a) + paid, '',
    shop.name, where(shop),
    ...(o.link ? ['', 'Gérer mon rendez-vous (déplacer ou annuler) : ' + o.link] : []),
    '', 'Le fichier joint ajoute le rendez-vous à ton agenda.', 'À bientôt !'
  ].join('\n');
  return queueMessage(s, ctx, {
    key: o.key || 'mconf_' + a.id + '_' + (a.moves || 0), channel: 'email', template: 'confirmation', to: o.to, cid: a.clientId, apptId: a.id, vars: {}, ...(o.resendOf ? { resendOf: o.resendOf } : {}),
    subject: (moved ? 'Rendez-vous déplacé : ' : 'Rendez-vous confirmé : ') + when + pour + ' · ' + shop.name, text,
    cta: o.link ? { label: 'Gérer mon rendez-vous', url: o.link } : undefined, links: [o.link || ''],
    attachments: [{ name: 'rendez-vous.ics', type: 'text/calendar; charset=utf-8; method=PUBLISH', content: apptIcs(shop, a, { barber, link: o.link, now: ctx.now }) }]
  });
}

/**
 * The formule (« 5 coupes sur 5 semaines ») is activated: ONE mail for the whole purchase, with what it is (its cuts, its
 * price, how it is paid, what is left), every date still to come, and the way into the client space where each date is
 * seen, moved or cancelled. A service mail about something he bought: no consent to ask, no quiet hours. One key per
 * purchase, so a sale played again never writes twice; « Renvoyer le lien » (commands/formule.js) asks for a fresh copy
 * under its own key.
 * @param {{ id: string, name: string, credits: number, price: number, pay: 'salon'|'paid'|'online', left?: number, toBook?: number }} f
 *   left: the cuts still to take (all of them at the purchase); toBook: weeks without a date yet
 * @param {any[]} appts the dates still to come, as booked
 * @param {{ to: string, first?: string, cid: string, forFirst?: string, link?: string, space?: boolean, key?: string, resendOf?: string }} o
 *   link: the client space (space true: /moi?garder=…, opened with a code sent to this same address) or, while the space
 *   is closed, the first date's own page
 */
export function mailFormule(s, ctx, f, appts, o) {
  if (!s.settings.messages.email || !isEmail(o.to)) return null;
  const list = [...appts].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
  const head = list[0];
  if (!head) return null;
  const shop = s.settings.shop;
  const one = list.every((a) => a.staffId === head.staffId);
  const n = list.length, left = f.left == null ? f.credits : f.left, toBook = f.toBook || 0;
  const visits = n + ' rendez-vous';
  const whose = o.forFirst ? 'Les ' + visits + ' de ' + o.forFirst : n > 1 ? 'Tes ' + visits : 'Ton rendez-vous';
  const pay = f.pay === 'salon' ? 'Les ' + fmtEur(f.price) + ' se règlent au salon, à ' + (o.forFirst ? 'sa' : 'ta') + ' première visite.' : f.pay === 'online' ? 'Elle est réglée en ligne.' : 'Elle est déjà réglée.';
  const text = [
    hello(o.first), '',
    (o.forFirst ? 'La ' + f.name + ' de ' + o.forFirst : 'Ta ' + f.name) + ' est activée : ' + f.credits + ' coupes, une par semaine, pour ' + fmtEur(f.price) + '.',
    pay + (left < f.credits ? ' Il ' + (o.forFirst ? 'lui' : 'te') + ' reste ' + left + ' coupe' + (left > 1 ? 's' : '') + ' sur ' + f.credits + '.' : ''), '',
    whose + (one ? ' avec ' + barberOf(s, head) : '') + ' :',
    ...list.map((a, i) => (i + 1) + '. ' + dayFr(a.day) + ' à ' + fmtTime(a.start) + (one ? '' : ' avec ' + barberOf(s, a))),
    ...(toBook ? ['', toBook > 1 ? toBook + ' visites restent à réserver.' : 'Une visite reste à réserver.'] : []),
    '', shop.name, where(shop),
    '', 'Le fichier joint ajoute ' + (n > 1 ? 'le premier rendez-vous' : 'le rendez-vous') + ' à ton agenda.',
    // last, right above the button (the HTML drops the line that spells the address out: messaging/email.js)
    ...(o.link && o.space ? ['', 'Dans ton espace, tu vois ta formule et ce qu’il te reste, et tu déplaces ou annules chaque rendez-vous. À l’ouverture, un code arrive à cette adresse : tape-le, c’est tout.', 'Ouvrir mon espace : ' + o.link]
      : o.link ? ['', 'Chaque rendez-vous se déplace ou s’annule depuis sa page.', 'Gérer mes rendez-vous : ' + o.link] : ['', 'À bientôt !'])
  ].join('\n');
  return queueMessage(s, ctx, {
    key: o.key || 'mfo_' + f.id, channel: 'email', template: 'formuleLink', to: o.to, cid: o.cid, apptId: head.id, vars: {}, ...(o.resendOf ? { resendOf: o.resendOf } : {}),
    subject: f.name + (o.forFirst ? ' de ' + o.forFirst : '') + ' activée : ' + visits + ' · ' + shop.name, text,
    cta: o.link ? { label: o.space ? 'Voir ma formule' : 'Gérer mes rendez-vous', url: o.link } : undefined, links: [o.link || ''],
    attachments: [{ name: 'rendez-vous.ics', type: 'text/calendar; charset=utf-8; method=PUBLISH', content: apptIcs(shop, head, { barber: barberOf(s, head), link: ctx.meta.linkFor ? ctx.meta.linkFor(head) : '', now: ctx.now }) }]
  });
}

/**
 * The client's reminder by e-mail: the evening before (settings.messages.reminderEmail), two hours before for a booking
 * that missed the evening one, or in place of a reminder SMS that failed for good (commands/system.js decides which).
 * One key per appointment, day and kind, whoever asks: the reminder and the fallback never both leave.
 * @param {{ to: string, first?: string, link?: string, soon?: boolean, today: string }} o soon: the 2-hours one
 */
export function mailReminder(s, ctx, a, o) {
  if (!isEmail(o.to)) return null;
  const shop = s.settings.shop, barber = barberOf(s, a);
  const time = fmtTime(a.start);
  const day = a.day === o.today ? 'aujourd’hui' : a.day === addDays(o.today, 1) ? 'demain' : dayFr(a.day);
  const g = forFirstIn(s, [a.clientId], a), pour = g ? ' pour ' + g : '';
  const text = [
    hello(o.first), '',
    'Un petit rappel : on t’attend ' + day + ' à ' + time + ' avec ' + barber + pour + '.',
    what(a) + ' · ' + price(a), '',
    shop.name, where(shop),
    ...(o.link ? ['', 'Un imprévu ? Déplace ou annule ici : ' + o.link] : []),
    '', 'À ' + (a.day === o.today ? 'tout à l’heure' : 'bientôt') + ' !'
  ].join('\n');
  return queueMessage(s, ctx, {
    key: (o.soon ? 'mrem2_' : 'mrem_') + a.id + '_' + a.day, channel: 'email', template: o.soon ? 'reminder2h' : 'reminder', to: o.to, cid: a.clientId, apptId: a.id, vars: {},
    subject: 'Rappel : ' + day + ' à ' + time + ' avec ' + barber + pour + ' · ' + shop.name, text,
    cta: o.link ? { label: 'Gérer mon rendez-vous', url: o.link } : undefined, links: [o.link || '']
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
  // everything the barber needs without opening the Comptoir: who (and how to reach him), what, how long, how much, his word
  const name = [first, c && c.last].filter(Boolean).join(' ');
  const mins = a.dur ? (a.dur >= 60 ? Math.floor(a.dur / 60) + ' h' + (a.dur % 60 ? ' ' + pad2(a.dur % 60) : '') : a.dur + ' min') : '';
  const text = [
    head + '.', '',
    'Quand : ' + dayFr(a.day) + ' à ' + fmtTime(a.start) + (mins ? ' (' + mins + ')' : ''),
    'Avec : ' + barberOf(s, a),
    'Client : ' + name + (c && c.phone ? ' · ' + c.phone : '') + (c && c.email ? ' · ' + c.email : ''),
    'Prestation : ' + what(a) + ' · ' + price(a),
    ...(a.note ? ['Son mot : « ' + a.note + ' »'] : []), '',
    kind === 'booked' ? 'Réservé en ligne' + (a.deposit && a.deposit.paid ? ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' réglé' : '')
      : 'Annulé en ligne par le client' + (o.reason ? ' : « ' + o.reason + ' »' : '') + (a.deposit && a.deposit.paid ? (a.deposit.full ? ' · ' + fmtEur(a.deposit.paid, { decimals: true }) + ' payés en ligne, remboursés automatiquement (à vérifier dans Caisse › En ligne)' : ' · acompte de ' + fmtEur(a.deposit.paid, { decimals: true }) + ' à voir') : ''),
    ...(comptoir ? ['', 'Le Comptoir : ' + comptoir] : [])
  ].join('\n');
  const send = (key, addr) => queueMessage(s, ctx, {
    key, channel: 'email', template: kind === 'booked' ? 'owner_booking' : 'owner_cancel',
    // no apptId: the appointment's own messages are the client's
    to: addr, cid: a.clientId || null, vars: {}, subject: head, text, links: [comptoir]
  });
  // the barber it is with gets the same lines at his own address, when he has one that is not the owner's
  const st = s.staff.get(a.staffId);
  if (st && st.active && isEmail(st.email) && st.email.toLowerCase() !== to.toLowerCase()) send((kind === 'booked' ? 'bbk_' : 'bcx_') + a.id, st.email);
  return send((kind === 'booked' ? 'obk_' : 'ocx_') + a.id, to);
}
