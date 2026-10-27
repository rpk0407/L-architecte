// @ts-check
// The Comptoir API, for signed-in staff. Every route states the capability it needs; the handlers
// re-check finer rules (own chair, discount caps) inside the commands.
import { HttpError } from './kit.js';
import { agendaView, apptView, clientCard, clientFull, saleView, staffView, serviceView, productView } from './views.js';
import { freeSlots, staffIntervals, walkinEstimate } from '../domain/availability.js';
import { clientStats, report, previousPeriod, goalOf, goalShares, autoGoal } from '../domain/insights.js';
import { staffStatement } from '../domain/statement.js';
import { drawerExpected, dayTotals, zFigures, METHOD_LABEL, ticketNo, closureNo } from '../domain/cash.js';
import { missedZ, closingWarnings, dayWords, dayAndDate } from '../commands/tick-steps.js';
import { addDays, isDay, weekStart, monthStart, monthEnd, diffDays, dayShort, fmtTime, hhmm, localParts } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';
import { maskPhone, fmtPhone, normGiftCode, sha256 } from '../lib/util.js';
import { EXTENSIONS } from '../core/extensions.js';
import { membersOf, isLive, graceOf, statusIn } from '../domain/membership.js';
import { loyaltyExport } from '../domain/loyalty.js';
import { startPayment, refundOnline } from './routes-public.js';
import { tillRefund } from './routes-payments.js';
import { meView } from './routes-auth.js';
import * as A from '../commands/agenda.js';
import * as C from '../commands/clients.js';
import * as S from '../commands/sales.js';
import { sendRebook } from '../commands/messages.js';
import { rangeWords, timeoffConflicts } from '../commands/team.js';
import { teamViewOf } from '../settings/team.js';
import { attribution } from '../domain/attribution.js';
import { webhookUrl } from '../messaging/sms.js';
import { TEMPLATE_FLAGS } from '../core/templates.js';
import { maybeTick, dispatchNow } from './scheduler.js';
import { waitUntil } from '@vercel/functions';

const dayParam = (r, name = 'day') => { const d = r.query.get(name); return d && isDay(d) ? d : r.local.day; };

/* ---------------- the live feed ---------------- */

function nameOfAppt(s, a) {
  if (!a) return 'Client';
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return c ? c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '') : a.name || 'Client';
}
/** Whose ticket this is, for a barber's own toasts: the appointment's chair, else the tip's barber, else the first line's. */
function saleStaff(s, x) {
  const a = x.apptId ? s.appts.get(x.apptId) : null;
  return (a && a.staffId) || (x.tip && x.tip.staffId) || (x.lines.find((l) => l.staffId) || {}).staffId || null;
}
/**
 * One feed entry as a line for this viewer, or null to hide it. Every line about an appointment or a ticket carries
 * `staffId` (the chair it concerns), so a barber's phone can keep only his own toasts (TEAM-02); staffId null means the
 * line is meant only for holders of the capability it is checked against.
 */
function feedItem(r, f) {
  const s = r.s;
  const d = f.data || {};
  const own = (staffId) => r.caps.has('agenda.all') || staffId === r.me.id;
  const staffName = (id) => (s.staff.get(id) || {}).name || '';
  const a = d.id ? s.appts.get(d.id) : null;
  const base = { v: f.v, at: f.at, by: f.actor.t };
  switch (f.type) {
    case 'appt.booked': {
      if (!a || !own(a.staffId)) return null;
      const who = nameOfAppt(s, a);
      const sub = dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId) + ' · ' + a.services.map((x) => x.name).join(' + ');
      const ref = { apptId: a.id, day: a.day, staffId: a.staffId };
      if (a.source === 'site') return { ...base, kind: 'booking', title: who + ' a réservé en ligne', sub, ...ref };
      if (a.source === 'walkin') return { ...base, kind: 'walkin', title: who + ' installé sans rendez-vous', sub, ...ref };
      return { ...base, kind: 'booking', title: 'RDV ajouté · ' + who, sub, ...ref };
    }
    case 'appt.cancelled': {
      if (!a || !own(a.staffId)) return null;
      const who = nameOfAppt(s, a);
      const sub = dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId);
      const title = d.by === 'client' ? who + ' a annulé' : d.by === 'system' ? 'Acompte non réglé · ' + who : 'RDV annulé · ' + who;
      return { ...base, kind: 'cancel', title, sub: sub + ' · créneau libéré', apptId: a.id, day: a.day, staffId: a.staffId };
    }
    case 'appt.moved':
      if (!a || !own(a.staffId)) return null;
      return { ...base, kind: 'move', title: (d.by === 'client' ? nameOfAppt(s, a) + ' a déplacé son RDV' : 'RDV déplacé · ' + nameOfAppt(s, a)), sub: dayShort(a.day) + ' · ' + fmtTime(a.start) + ' · ' + staffName(a.staffId), apptId: a.id, day: a.day, staffId: a.staffId };
    case 'appt.status':
      if (!a || !own(a.staffId) || !['arrived', 'no_show'].includes(d.status)) return null;
      return { ...base, kind: d.status === 'arrived' ? 'arrived' : 'noshow', title: nameOfAppt(s, a) + (d.status === 'arrived' ? ' est arrivé' : ' ne s’est pas présenté'), sub: fmtTime(a.start) + ' · ' + staffName(a.staffId), apptId: a.id, day: a.day, staffId: a.staffId };
    case 'sale.completed': {
      const x = s.sales.get(d.id);
      if (!x || (!r.caps.has('sale.all') && x.cashierId !== r.me.id && !x.lines.some((l) => l.staffId === r.me.id))) return null;
      const methods = [...new Set(x.payments.map((p) => METHOD_LABEL[p.method] || p.method))].join(' + ');
      return { ...base, kind: 'sale', title: 'Encaissé ' + fmtEur(x.totals.due), sub: ticketNo(x.number) + (methods ? ' · ' + methods : '') + (x.tip ? ' · pourboire ' + fmtEur(x.tip.amount) : ''), saleId: x.id, money: true, staffId: saleStaff(s, x) };
    }
    case 'sale.refunded': {
      if (!r.caps.has('sale.all')) return null;
      const x = s.sales.get(d.saleId);
      return { ...base, kind: 'refund', title: 'Remboursé ' + fmtEur(d.amount), sub: d.reason, money: true, staffId: x ? saleStaff(s, x) : null };
    }
    // money paid online on a booking: the till sees every chair's, a barber only his own clients' (a QR or gift card
    // payment names no appointment: the till's only)
    case 'payment.succeeded': {
      const p = s.payments.get(d.id);
      if (!p) return null;
      const pa = p.apptId ? s.appts.get(p.apptId) : null;
      // a membership's month (PAY-02) is the salon's money, not a barber's; other payments: everyone's with sale.all, else one's own
      if (p.kind === 'membership' ? !r.caps.has('member.manage') && !r.caps.has('report.shop') : !r.caps.has('sale.all') && !(pa && pa.staffId === r.me.id)) return null;
      return { ...base, kind: 'payment', title: (p.kind === 'deposit' ? 'Acompte reçu ' : 'Paiement reçu ') + fmtEur(p.amount), sub: p.label, apptId: p.apptId, paymentId: p.id, money: true, staffId: pa ? pa.staffId : null };
    }
    case 'waitlist.added':
      return { ...base, kind: 'wait', title: 'Liste d’attente · ' + (s.waitlist.get(d.id)?.first || ''), sub: dayShort(d.day) + (d.staffId !== 'any' ? ' · ' + staffName(d.staffId) : ' · sans préférence'), day: d.day, staffId: d.staffId !== 'any' ? d.staffId || null : null };
    case 'queue.added':
      return { ...base, kind: 'walkin', title: (s.queue.get(d.id)?.name || 'Un client') + ' attend sans rendez-vous', sub: (s.services.get(d.serviceId)?.name || '') + (d.staffId !== 'any' ? ' · ' + staffName(d.staffId) : ''), staffId: d.staffId !== 'any' ? d.staffId || null : null };
    case 'day.closed':
      if (!r.caps.has('closure') && !r.caps.has('report.shop')) return null;
      return { ...base, kind: 'closure', title: d.auto ? 'Z du ' + dayAndDate(d.day) + ' fait automatiquement' : 'Journée clôturée · ' + closureNo(d.number), sub: (d.auto ? closureNo(d.number) + ' · ' : '') + fmtEur(d.net) + ' · ' + d.tickets + ' tickets', money: true, staffId: null };
    case 'drawer.closed':
      return r.caps.has('drawer') ? { ...base, kind: 'drawer', title: 'Caisse comptée', sub: d.diff ? 'Écart ' + fmtEur(d.diff) : 'Aucun écart', money: true, staffId: null } : null;
    case 'stock.adjusted': {
      const p = s.products.get(d.productId);
      if (!p || d.reason !== 'Vente' || p.stock > p.low || !r.caps.has('catalog')) return null;
      return { ...base, kind: 'stock', title: 'Stock bas · ' + p.name, sub: 'Il en reste ' + p.stock, staffId: null };
    }
    // a request withdrawn while still pending: the owner's toast for it closes (any item for that id that is no request)
    case 'timeoff.withdrawn': {
      if (!r.caps.has('team') || d.was !== 'pending' || !d.staffId || !d.from) return null;
      return { ...base, kind: 'timeoff', title: staffName(d.staffId) + ' retire sa demande · ' + rangeWords(d), sub: 'Plus rien à valider', timeoffId: d.id, staffId: null, aboutStaffId: d.staffId, day: d.from };
    }
    case 'timeoff.requested': case 'timeoff.added': case 'timeoff.refused': {
      const mine = d.staffId === r.me.id;
      if (!r.caps.has('team') && !mine) return null;
      // the request keeps its dates once refused; a posted absence may have been removed since (then the event's own)
      const t = s.timeoff.get(d.id) || s.timeoffRequests.get(d.id) || null;
      const x = t || d;
      const range = x.from ? rangeWords(x) : '';
      // his own line names him (his toasts); the team holders' line names nobody, the absence's barber is aboutStaffId
      const ref = { timeoffId: d.id, staffId: d.staffId, day: x.from };
      if (mine && !r.caps.has('team')) {
        // told: decided or posted by someone else, worth a toast on his screen
        const told = { mine: f.actor.id !== r.me.id };
        if (f.type === 'timeoff.requested') return { ...base, kind: 'timeoff', title: 'Demande envoyée · ' + range, sub: t && t.status === 'refused' ? 'Refusée' : s.timeoff.has(d.id) ? 'Validée' : t ? 'En attente du gérant' : 'Retirée', ...ref };
        if (f.type === 'timeoff.refused') return { ...base, kind: 'timeoff', title: 'Absence refusée · ' + range, sub: 'Vois avec le gérant', ...told, ...ref };
        return { ...base, kind: 'timeoff', title: (d.request ? 'Absence validée · ' : 'Absence posée · ') + range, sub: d.reason || '', ...told, ...ref };
      }
      const who = staffName(d.staffId);
      const about = { timeoffId: d.id, staffId: null, aboutStaffId: d.staffId, day: x.from };
      if (f.type === 'timeoff.refused') return { ...base, kind: 'timeoff', title: who + ' · absence refusée', sub: range, ...about };
      // what is still to replace, now: the count falls as the plan is applied
      const open = t && t.to >= r.local.day && (f.type === 'timeoff.added' ? s.timeoff.has(d.id) : t.status === 'pending');
      const n = open ? timeoffConflicts(s, t, { now: r.now, local: r.local }).length : 0;
      const left = n ? ' · ' + n + ' rdv à replacer' : '';
      if (f.type === 'timeoff.requested') {
        const pending = !!t && t.status === 'pending';
        return { ...base, kind: 'timeoff', title: who + ' demande ' + range + (pending ? left : ''), sub: (d.reason || 'Absence') + ' · ' + (pending ? 'à valider' : s.timeoff.has(d.id) ? 'validée' : t ? 'refusée' : 'retirée'), request: true, pending, ...about };
      }
      return { ...base, kind: 'timeoff', title: who + ' absent ' + range + left, sub: (d.request ? 'Demande validée' : d.reason || 'Absence') + (t ? '' : ' · retirée'), ...about };
    }
    // WP-05's contact and training requests: the first name from its projection (personal data, never in the event)
    case 'inquiry.received': {
      if (!r.caps.has('marketing')) return null;
      const q = s.inquiries && typeof s.inquiries.get === 'function' ? s.inquiries.get(d.id) : null;
      const first = (q && !q.erased && (q.first || q.name)) || '';
      const mod = d.module ? ((s.settings.trainings?.modules || []).find((m) => m.id === d.module)?.title || '') : '';
      return { ...base, kind: 'inquiry', title: 'Nouvelle demande : ' + (d.kind === 'formation' ? 'formation' : 'contact') + (first ? ' · ' + first : ''), sub: mod || (d.kind === 'formation' ? 'Formations' : 'Contact du site'), inquiryId: d.id, staffId: null };
    }
    default: for (const x of EXTENSIONS) if (x.item && x.feed?.includes(f.type)) return x.item(r, f); return null;
  }
}

/**
 * The live feed keeps no system events; the Z the scheduler made on its own is one the owner must hear about.
 * Read from the journal after version `from`, looking back a bounded number of events.
 */
function autoZ(r, from) {
  const j = r.rt.engine.journal;
  const out = [];
  for (let i = Math.max(from, j.length - 5000); i < j.length; i++) {
    const e = j[i];
    if (e.type === 'day.closed' && e.actor.t === 'system' && e.data && e.data.auto) out.push({ v: e.v, type: e.type, at: e.at, actor: e.actor, data: e.data });
  }
  return out;
}
const byV = (a, b) => a.v - b.v;

function badges(r) {
  const s = r.s, L = r.local;
  const mineOnly = !r.caps.has('agenda.all');
  let toPay = 0;
  // a sealed day takes no more payments: what is left is not "to pay" any more
  for (const id of s.closures.has(L.day) ? [] : s.apptsByDay.get(L.day) || []) {
    const a = s.appts.get(id);
    if (!a || a.saleId || a.legacy || (mineOnly && a.staffId !== r.me.id)) continue; // legacy: paid on the old site's till
    if (a.status === 'in_chair' || a.status === 'done' || ((a.status === 'booked' || a.status === 'arrived') && a.start + a.dur <= L.min)) toPay++;
  }
  const queue = [...s.queue.values()].filter((q) => q.status === 'waiting' || q.status === 'called').length;
  let relances = 0;
  if (r.caps.has('marketing')) for (const [id, st] of clientStats(s, L.day, r.now)) { const c = st.overdue && s.clients.get(id); if (c && rebookable(c, st)) relances++; }
  const waitlist = [...s.waitlist.values()].filter((w) => w.status === 'waiting' && w.day >= L.day).length;
  // files past the 3 years /confidentialite promises: on the Clients tab, so the purge does not wait on a memory
  const retention = r.caps.has('client.erase') ? C.inactiveClients(s, L.day).length : 0;
  // absences barbers asked for, waiting for the owner (Équipe)
  let requests = 0;
  if (r.caps.has('team')) for (const q of s.timeoffRequests.values()) if (q.status === 'pending' && q.to >= L.day) requests++;
  return { toPay, queue, relances, waitlist, retention, requests };
}

/**
 * Clients still booked with a barber who will be away, absence by absence, for the agenda's banner: only for whoever
 * can hand them over (Équipe › the absence's plan), and the absences barbers asked for, still to approve.
 */
function orphans(r) {
  if (!r.caps.has('team') || !r.caps.has('agenda.edit')) return null;
  const o = { now: r.now, local: r.local };
  const list = [];
  for (const t of r.s.timeoff.values()) {
    if (t.to < r.local.day) continue;
    const c = timeoffConflicts(r.s, t, o);
    if (c.length) list.push({ id: t.id, staffId: t.staffId, from: t.from, to: t.to, count: c.length, day: c[0].day });
  }
  const requests = [...r.s.timeoffRequests.values()].filter((q) => q.status === 'pending' && q.to >= r.local.day)
    .map((q) => ({ id: q.id, staffId: q.staffId, from: q.from, to: q.to, count: timeoffConflicts(r.s, q, o).length, day: q.from }));
  return { items: list.sort((a, b) => a.day.localeCompare(b.day)), requests };
}

/** The file a client route names, followed through merges; an erased file is still found (it says so). */
function fileOf(r) {
  let c = r.s.clients.get(r.params.id);
  while (c && c.mergedInto) c = r.s.clients.get(c.mergedInto);
  if (!c) throw new HttpError(404, 'not_found', 'Client introuvable.');
  return c;
}

const STATUS_FR = { pending: 'acompte en attente', booked: 'à venir', arrived: 'arrivé', in_chair: 'au fauteuil', done: 'venu', no_show: 'absent', cancelled: 'annulé' };
// the export is read by the client: words, not the codes the server keeps
const SOURCE_FR = { site: 'en ligne', salon: 'au salon', phone: 'par téléphone', walkin: 'sans rendez-vous', wordpress: 'ancien site', import: 'ancien site' };
const WAIT_FR = { waiting: 'en attente', offered: 'place proposée', booked: 'réservé', removed: 'retiré', expired: 'expiré' };
const SMS_FR = { confirmation: 'confirmation', reminder: 'rappel la veille', reminder2h: 'rappel 2 h avant', moved: 'déplacement', cancelled: 'annulation', review: 'demande d’avis', rebook: 'relance', receipt: 'reçu', waitlist: 'place libérée', queue: 'file d’attente', deposit: 'lien d’acompte',
  reassign: 'changement de barbier', reassignAt: 'changement de barbier et d’heure', reschedule: 'rendez-vous à décaler', giftcard: 'carte cadeau',
  memberWelcome: 'abonnement : bienvenue', memberFailed: 'abonnement : paiement refusé', memberAction: 'abonnement : paiement à valider', memberCancelled: 'abonnement : résiliation', memberStopped: 'abonnement : résiliation', memberWithdrawn: 'abonnement : rétractation', memberWithdrawnNone: 'abonnement : rétractation', memberEnded: 'abonnement : fin faute de paiement', memberOffer: 'abonnement proposé', memberLink: 'lien de l’abonnement', owner_member: 'alerte abonnement' };
// PAY-03's member texts and mails
Object.assign(SMS_FR, { memberCard: 'abonnement : changer la carte', memberLinkMail: 'lien de l’abonnement (e-mail)' });
const MEMBER_FR = { pending: 'paiement attendu', active: 'en cours', grace: 'paiement en retard', unpaid: 'impayé', ending: 'résilié, en cours jusqu’à la fin du mois payé', ended: 'terminé' };
const SMS_STATUS_FR = { queued: 'en attente', claimed: 'en cours d’envoi', sent: 'envoyé', simulated: 'non envoyé (simulé)', failed: 'échec', skipped: 'non envoyé', expired: 'trop tard, non envoyé' };
const fr = (map, v) => map[v] || v || '';
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
/** The client's own data, in words a person can read: the file, bookings, tickets, subscriptions, cards, texts. */
function clientExport(s, c, now) {
  const ids = new Set(C.fileIds(s, c));
  const who = (id) => (s.staff.get(id) || {}).name || '';
  const byDay = (a, b) => (a.day + String(a.start ?? 0).padStart(4, '0')).localeCompare(b.day + String(b.start ?? 0).padStart(4, '0'));
  return {
    salon: s.settings.shop.name, exporteLe: iso(now),
    fiche: {
      prenom: c.first, nom: c.last, telephone: fmtPhone(c.phone), email: c.email, anniversaire: c.birthday ? c.birthday.replace('-', '/') : '',
      notes: c.notes, ficheTechnique: c.tech, etiquettes: c.tags || [], smsDeService: !!c.sms,
      smsBonsPlans: { accord: !!c.marketing, origine: c.marketingSrc === 'stop' ? 'STOP par SMS' : c.marketingSrc === 'wordpress' ? 'ancien site · jamais demandé' : fr(SOURCE_FR, c.marketingSrc), depuis: iso(c.marketingAt) }, origine: fr(SOURCE_FR, c.source), creeLe: iso(c.createdAt), effacee: !!c.erased
    },
    rendezVous: [...s.appts.values()].filter((a) => ids.has(a.clientId)).sort(byDay).map((a) => ({
      jour: a.day, heure: hhmm(a.start), dureeMinutes: a.dur, prestations: a.services.map((x) => x.name), barbier: who(a.staffId), prix: fmtEur(a.price),
      statut: STATUS_FR[a.status] || a.status, origine: fr(SOURCE_FR, a.source), note: a.note || '', prisLe: iso(a.createdAt),
      ...(a.cancel ? { annulation: { par: a.cancel.by === 'client' ? 'client' : a.cancel.by === 'system' ? 'automatique' : 'salon', motif: a.cancel.reason || '' } } : {}),
      ...(a.deposit && a.deposit.paid ? { acompte: fmtEur(a.deposit.paid) } : {})
    })),
    tickets: [...s.sales.values()].filter((x) => ids.has(x.clientId)).sort((a, b) => a.at - b.at).map((x) => ({
      numero: ticketNo(x.number), jour: x.day, lignes: x.lines.map((l) => ({ libelle: l.name, quantite: l.qty, montant: fmtEur(l.net) })),
      total: fmtEur(x.totals.due), reglements: (x.payments || []).map((p) => ({ moyen: METHOD_LABEL[p.method] || p.method, montant: fmtEur(p.amount) })),
      ...(x.refunded ? { rembourse: fmtEur(x.refunded) } : {}), ...(x.discountNote ? { motifRemise: x.discountNote } : {})
    })),
    // the monthly contract (PAY-02) and the prepaid carnets
    abonnementsMensuels: [...s.members.values()].filter((m) => ids.has(m.cid)).map((m) => ({
      formule: m.name, prixParMois: fmtEur(m.price), statut: fr(MEMBER_FR, statusIn(s, m, now)), souscritLe: iso(m.createdAt), actifDepuis: iso(m.activatedAt || null), carte: m.card,
      periodesPayees: m.periods.map((p) => ({ du: p.start, au: addDays(p.end, -1), montant: fmtEur(p.amount) })), coupes: m.uses.map((u) => u.day),
      ...(m.cancel ? { resiliation: { le: iso(m.cancel.at), dernierJourInclus: addDays(m.cancel.effective, -1), par: m.cancel.by === 'salon' ? 'salon' : 'client', motif: m.cancel.reason || '' } } : {}),
      ...(m.withdrawn ? { retractation: { le: iso(m.withdrawn.at), rembourse: fmtEur(m.withdrawn.refund) } } : {})
    })),
    carnets: [...s.packs.values()].filter((k) => ids.has(k.clientId)).map((k) => ({ nom: k.name, coupesUtilisees: k.used, coupesTotal: k.total, valableJusquAu: k.expires })),
    cartesCadeaux: [...s.giftcards.values()].filter((g) => ids.has(g.cid)).map((g) => ({ carte: '•••• ' + g.last4, montant: fmtEur(g.amount), solde: fmtEur(g.balance), valableJusquAu: g.expires, pour: g.recipient || '' })),
    // FID-02: the loyalty card, its movements and rewards, the reasons of adjustments made by hand
    fidelite: loyaltyExport(s, c.id, localParts(now).day),
    listeAttente: [...s.waitlist.values()].filter((w) => ids.has(w.clientId)).map((w) => ({ jour: w.day, statut: fr(WAIT_FR, w.status), inscritLe: iso(w.at) })),
    sms: [...s.messages.values()].filter((m) => ids.has(m.cid)).sort((a, b) => a.at - b.at).map((m) => ({ le: iso(m.at), type: fr(SMS_FR, m.template), statut: fr(SMS_STATUS_FR, m.status), numero: fmtPhone(m.to), texte: m.body }))
  };
}

/** Can this client get a follow-up text? Agreed to the offers, takes SMS, and not seen in the last week. */
function rebookable(c, st) { return !c.erased && !c.mergedInto && c.sms && !!c.phone && c.marketing && st.sinceLast != null && st.sinceLast >= 7; }

/* ---------------- day figures ---------------- */

/**
 * The agenda's day figures. scope 'shop': everything (report.shop); 'own': a chair's own; 'desk': someone with no chair
 * and no report.shop (the desk tablet), who runs the whole salon's day but sees no money: counts and fill for every chair,
 * revenue, tips and planned null.
 */
function dayKpis(r, day) {
  const s = r.s;
  // the desk runs every chair's day: without agenda.all, someone with no chair is no desk (own scope, an empty day)
  const desk = !r.caps.has('report.shop') && !r.me.chair && r.caps.has('agenda.all');
  const mine = !r.caps.has('report.shop') && !desk;
  const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.status !== 'cancelled' && (!mine || a.staffId === r.me.id));
  const done = appts.filter((a) => a.status === 'done').length;
  const noShows = appts.filter((a) => a.status === 'no_show').length;
  const upcoming = appts.filter((a) => ['booked', 'pending', 'arrived'].includes(a.status) && (day > r.local.day || a.start >= r.local.min)).length;
  let revenue = 0, tips = 0;
  if (mine) {
    // his Chiffre réalisé, as Mes chiffres and his statement count it (TEAM-03): cut values in, refunds out on their day
    const own = report(s, { from: day, to: day, staffId: r.me.id, today: r.local.day, now: r.now });
    revenue = own.revenue; tips = own.tips;
  } else for (const id of s.salesByDay.get(day) || []) {
    const x = s.sales.get(id);
    if (x) { revenue += x.totals.revenue - x.refunded; tips += x.totals.tip; }
  }
  const planned = appts.filter((a) => a.status !== 'no_show').reduce((t, a) => t + a.price, 0);
  const staffIds = mine ? [r.me.id] : [...s.staff.values()].filter((x) => x.active && x.chair).map((x) => x.id);
  let cap = 0, booked = 0;
  for (const id of staffIds) for (const [a, b] of staffIntervals(s, id, day)) cap += b - a;
  for (const a of appts) if (a.status !== 'no_show') booked += a.dur;
  const showMoney = !desk && (r.caps.has('report.shop') || r.caps.has('report.own'));
  return { total: appts.length, done, noShows, upcoming, revenue: showMoney ? revenue : null, tips: showMoney ? tips : null, planned: showMoney ? planned : null, fill: cap ? Math.min(1, booked / cap) : 0, scope: desk ? 'desk' : mine ? 'own' : 'shop' };
}

/**
 * What someone in own scope sees of the others (TEAM-01, Réglages › Équipe › « Ce que chacun voit des autres »):
 * salon, unless the owner chose 'off': the month goal reached and the salon's fill this month, in % and never in euros
 * (goalPct a whole percent, null without a goal; fill 0..1 like the agenda's); team, with report.team ('named'): each
 * active chair's figures over the asked period, never commission, rates or tips.
 */
function teamSide(r, from, to) {
  const s = r.s, L = r.local;
  const out = {};
  if (teamViewOf(s.settings) !== 'off') {
    const m = report(s, { from: monthStart(L.day), to: L.day, staffId: null, today: L.day, now: r.now });
    const target = s.settings.goals.monthCents;
    out.salon = { goalPct: target > 0 ? Math.round((m.revenue / target) * 100) : null, fill: m.occupancy };
  }
  if (r.caps.has('report.team')) {
    out.team = report(s, { from, to, staffId: null, today: L.day, now: r.now }).staff.filter((x) => s.staff.get(x.id)?.active && s.staff.get(x.id)?.chair)
      .map((x) => ({ id: x.id, name: x.name, color: x.color, revenue: x.revenue, done: x.done, occupancy: x.occupancy, rebookRate: x.rebookRate, noShows: x.noShows, avgTicket: x.avgTicket }));
  }
  return out;
}

export function staffRoutes(app) {
  app.get('/api/v1/bootstrap', (r) => {
    const s = r.s;
    const full = r.caps.has('team');
    const settings = r.caps.has('settings') ? s.settings : {
      shop: s.settings.shop, hours: s.settings.hours, closures: s.settings.closures, booking: s.settings.booking, deposits: s.settings.deposits,
      // the month's goal is the owner's and the managers' (Objectifs): a barber gets none
      payments: s.settings.payments, team: s.settings.team, goals: r.caps.has('report.shop') ? s.settings.goals : {},
      messages: { ...s.settings.messages, templates: r.caps.has('marketing') ? s.settings.messages.templates : {} }
    };
    return {
      me: meView(s, r.me, r.device, r.session.kind), mode: s.mode, today: r.local.day, now: r.now, version: s.version, cfg: s.cfgVersion, settings,
      staff: [...s.staff.values()].filter((x) => x.active || full).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffView(x, full || x.id === r.me.id)),
      services: [...s.services.values()].filter((x) => x.active || r.caps.has('catalog')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView),
      products: [...s.products.values()].filter((x) => x.active || r.caps.has('catalog')).map(productView),
      providers: { payments: r.rt.pay.name, paymentsLive: !!r.rt.pay.live, sms: r.rt.sms ? r.rt.sms.name : null, email: r.rt.email ? r.rt.email.name : null, store: r.rt.store.kind },
      // the server's own set-up is the owner's; what stops tonight's Z reaches whoever may close the day
      warnings: [...(r.me.role === 'owner' ? r.rt.warnings : []), ...(r.caps.has('closure') ? closingWarnings(s, r.local.day) : [])]
    };
  });

  /** Polled every few seconds: cheap, and the carrier of the background work. */
  app.get('/api/v1/pulse', (r) => {
    const since = Number(r.query.get('since')) || 0;
    const items = since ? [...r.s.feed.filter((f) => f.v > since), ...autoZ(r, since)].sort(byV).slice(-40).map((f) => feedItem(r, f)).filter(Boolean) : [];
    const t = maybeTick(r.rt, r.meta);
    if (t) waitUntil(t);
    return { version: r.s.version, cfg: r.s.cfgVersion, now: r.now, today: r.local.day, min: r.local.min, feed: items, badges: badges(r) };
  });

  app.get('/api/v1/feed', (r) => {
    const recent = r.s.feed.slice(-120);
    const items = [...recent, ...autoZ(r, recent.length ? recent[0].v : 0)].sort(byV).map((f) => feedItem(r, f)).filter(Boolean).reverse().slice(0, 50);
    return { items };
  });

  /* ---------------- agenda ---------------- */

  app.get('/api/v1/agenda', (r) => {
    const day = dayParam(r);
    const v = agendaView(r.s, day, r.caps, r.me, r.now);
    // a sealed day's Z is the salon's money: its number for everyone, its figures for whoever closes or reads the salon's
    if (v.closure && !r.caps.has('closure') && !r.caps.has('report.shop')) v.closure = { number: v.closure.number, auto: !!v.closure.auto };
    const L = r.local;
    const est = day === L.day ? walkinEstimate(r.s, r.now, L) : null;
    return { ...v, kpis: dayKpis(r, day), walkin: est, drawer: r.s.drawer ? { open: true, since: r.s.drawer.openedAt } : { open: false }, absences: orphans(r) };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/week', (r) => {
    const from = weekStart(dayParam(r));
    const s = r.s;
    const staff = [...s.staff.values()].filter((x) => x.active && x.chair && (r.caps.has('agenda.all') || x.id === r.me.id));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(from, i);
      const appts = [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && a.status !== 'cancelled' && a.status !== 'no_show');
      days.push({
        day, kpis: dayKpis(r, day),
        staff: staff.map((st) => {
          const mine = appts.filter((a) => a.staffId === st.id);
          const cap = staffIntervals(s, st.id, day).reduce((t, [a, b]) => t + b - a, 0);
          const hours = Array.from({ length: 24 }, () => 0);
          for (const a of mine) for (let m = a.start; m < a.start + a.dur; m += 30) hours[Math.floor(m / 60)] += 30;
          return { id: st.id, count: mine.length, minutes: mine.reduce((t, a) => t + a.dur, 0), cap, hours };
        })
      });
    }
    return { from, days, staff: staff.map((x) => staffView(x)) };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/slots', (r) => {
    const day = dayParam(r);
    const ids = String(r.query.get('services') || '').split(',').filter(Boolean).slice(0, 4);
    const staffId = r.query.get('staff') || 'any';
    const services = ids.map((id) => r.s.services.get(id)).filter(Boolean);
    if (!services.length) throw new HttpError(400, 'invalid', 'Choisis une prestation.');
    const dur = services.reduce((t, x) => t + x.dur, 0) + Math.max(0, ...services.map((x) => x.buffer || 0));
    const days = Math.min(14, Number(r.query.get('days')) || 1);
    const ignoreAppt = r.query.get('ignore') || null;
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(day, i);
      const slots = freeSlots(r.s, { day: d, dur, serviceIds: ids, staffId, now: r.now, local: r.local, online: false, step: 15, ignoreAppt });
      out.push({ day: d, slots: slots.map((x) => ({ m: x.m, s: x.staffId })) });
      if (r.query.get('first') && out.reduce((t, x) => t + x.slots.length, 0) >= Number(r.query.get('first'))) break;
    }
    return { dur, days: out };
  }, { cap: 'agenda.own' });

  app.get('/api/v1/appointments/:id', (r) => {
    const s = r.s;
    const a = s.appts.get(r.params.id);
    if (!a || (!r.caps.has('agenda.all') && a.staffId !== r.me.id)) throw new HttpError(404, 'not_found', 'Rendez-vous introuvable.');
    const stats = clientStats(s, r.local.day, r.now);
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    const history = c ? [...s.appts.values()].filter((x) => x.clientId === c.id && x.id !== a.id && (x.status === 'done' || x.status === 'no_show')).sort((x, y) => (x.day < y.day ? 1 : -1)).slice(0, 8)
      .map((x) => ({ id: x.id, day: x.day, start: x.start, services: x.services.map((v) => v.name), staff: (s.staff.get(x.staffId) || {}).name, status: x.status, price: x.saleId ? (s.sales.get(x.saleId)?.totals.revenue ?? x.price) : x.price })) : [];
    const messages = [...s.messages.values()].filter((m) => m.apptId === a.id).map((m) => ({ id: m.id, channel: m.channel || 'sms', template: m.template, status: m.status, at: m.at, sentAt: m.sentAt || null, to: m.toMasked }));
    const payments = [...s.payments.values()].filter((p) => p.apptId === a.id).map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, status: p.status, at: p.createdAt }));
    return { appt: apptView(s, a, r.caps, stats, r.now), client: c && r.caps.has('client.view') ? clientFull(s, c, r.caps, stats, r.now) : null, history, messages, payments, sale: a.saleId && s.sales.get(a.saleId) ? saleView(s, s.sales.get(a.saleId), r.caps) : null };
  }, { cap: 'agenda.own' });

  app.post('/api/v1/appointments', (r) => r.run(A.createAppointment, r.body), { cap: 'agenda.own' });
  app.patch('/api/v1/appointments/:id', (r) => r.run(A.updateAppointment, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/move', (r) => r.run(A.moveAppointment, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/status', (r) => r.run(A.setStatus, { id: r.params.id, status: r.body.status }), { cap: 'agenda.own' });
  app.post('/api/v1/appointments/:id/cancel', async (r) => {
    const res = await r.run(A.cancelAppointment, { id: r.params.id, reason: r.body.reason, notify: r.body.notify });
    if (r.body.refundDeposit && res.deposit && res.deposit.paymentId) {
      if (!r.caps.has('sale.refund')) throw new HttpError(403, 'forbidden', 'Seul le gérant rembourse un acompte.');
      const back = await refundOnline(r, r.s.payments.get(res.deposit.paymentId), 'Annulé par le salon');
      res.refunded = back.ok;
      if (!back.ok) res.refundError = back.error;
    }
    return res;
  }, { cap: 'agenda.own' });

  app.post('/api/v1/blocks', (r) => r.run(A.addBlock, r.body), { cap: 'agenda.own' });
  app.del('/api/v1/blocks/:id', (r) => r.run(A.removeBlock, { id: r.params.id }), { cap: 'agenda.own' });
  app.post('/api/v1/queue', (r) => r.run(A.addWalkin, r.body), { cap: 'agenda.own' });
  app.post('/api/v1/queue/:id', (r) => r.run(A.updateWalkin, { ...r.body, id: r.params.id }), { cap: 'agenda.own' });
  app.get('/api/v1/waitlist', (r) => {
    const s = r.s;
    const items = [...s.waitlist.values()].filter((w) => w.day >= r.local.day && (w.status === 'waiting' || w.status === 'offered'))
      .sort((a, b) => a.day.localeCompare(b.day) || a.from - b.from)
      .map((w) => ({ id: w.id, first: w.first, phone: r.caps.has('client.contact') ? w.phone : maskPhone(w.phone), day: w.day, staffId: w.staffId, serviceId: w.serviceId, from: w.from, to: w.to, status: w.status, offer: w.offer, at: w.at }));
    const recent = [...s.waitlist.values()].filter((w) => r.now - w.at < 30 * 86400000);
    return { items, stats: { added: recent.length, booked: recent.filter((w) => w.status === 'booked').length } };
  }, { cap: 'agenda.own' });
  app.post('/api/v1/waitlist', (r) => r.run(A.addWait, r.body), { cap: 'agenda.own' });
  app.del('/api/v1/waitlist/:id', (r) => r.run(A.removeWait, { id: r.params.id }), { cap: 'agenda.own' });

  /* ---------------- clients ---------------- */

  app.get('/api/v1/clients', (r) => {
    const s = r.s, L = r.local;
    const stats = clientStats(s, L.day, r.now);
    const q = String(r.query.get('q') || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const digits = q.replace(/\D/g, '');
    const seg = r.query.get('segment') || 'all';
    const sort = r.query.get('sort') || 'recent';
    const limit = Math.min(200, Number(r.query.get('limit')) || 60);
    const offset = Math.max(0, Number(r.query.get('offset')) || 0);
    const month = L.day.slice(5, 7);
    let list = [...s.clients.values()].filter((c) => !c.mergedInto && !c.erased);
    if (q) list = list.filter((c) => {
      const name = (c.first + ' ' + c.last).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return name.includes(q) || (digits.length >= 2 && c.phone.replace(/\D/g, '').replace(/^33/, '0').includes(digits));
    });
    const st = (c) => stats.get(c.id) || {};
    const pairs = C.findDuplicates(s), dups = new Set(pairs.flatMap((p) => [p.a, p.b]));
    const inactive = new Set(C.inactiveClients(s, L.day).map((c) => c.id));
    const segs = {
      all: () => true, nouveaux: (c) => st(c).firstDay && diffDays(st(c).firstDay, L.day) <= 30 || !st(c).visits, fideles: (c) => st(c).loyal,
      // the same people as Relances: late on their rhythm and agreed to the offers
      relancer: (c) => st(c).overdue && rebookable(c, st(c)), absents: (c) => st(c).noShows > 0, abonnes: (c) => membersOf(s, c.id).some((m) => isLive(m, L.day, graceOf(s))) || [...s.packs.values()].some((k) => k.clientId === c.id && k.used < k.total),
      vip: (c) => (c.tags || []).includes('VIP'), anniversaires: (c) => c.birthday && c.birthday.slice(3, 5) === month,
      doublons: (c) => dups.has(c.id), inactifs: (c) => inactive.has(c.id)
    };
    const counts = Object.fromEntries(Object.entries(segs).map(([k, f]) => [k, list.filter(f).length]));
    // the duplicates segment lists pairs: its count says pairs too (of the files the search keeps)
    if (q) { const inList = new Set(list.map((c) => c.id)); counts.doublons = pairs.filter((p) => inList.has(p.a) || inList.has(p.b)).length; } else counts.doublons = pairs.length;
    // late but without consent: counted, not listed (as in Relances)
    const excludedNoConsent = list.filter((c) => st(c).overdue && c.sms && c.phone && !c.marketing).length;
    // the purge also clears old tickets and bookings that belong to no file: the owner sees it has work even without files
    const retention = r.caps.has('client.erase') ? { before: C.retentionCutoff(L.day), other: C.staleAnonymous(s, L.day).length } : null;
    list = list.filter(segs[seg] || segs.all);
    const sorters = {
      recent: (a, b) => (st(b).lastDay || '').localeCompare(st(a).lastDay || '') || b.createdAt - a.createdAt,
      name: (a, b) => (a.first + a.last).localeCompare(b.first + b.last, 'fr'),
      spend: (a, b) => (st(b).spend || 0) - (st(a).spend || 0),
      visits: (a, b) => (st(b).visits || 0) - (st(a).visits || 0),
      overdue: (a, b) => (st(a).dueIn ?? 999) - (st(b).dueIn ?? 999)
    };
    list.sort(sorters[sort] || sorters.recent);
    return { total: list.length, counts, excludedNoConsent, retention, items: list.slice(offset, offset + limit).map((c) => clientCard(s, c, r.caps, stats, r.now)) };
  }, { cap: 'client.view' });

  /** Probably the same person twice: the file to keep first (more visits, then the older one). Before /:id. */
  app.get('/api/v1/clients/duplicates', (r) => {
    const s = r.s;
    const stats = clientStats(s, r.local.day, r.now);
    const all = C.findDuplicates(s);
    const visits = (c) => stats.get(c.id)?.visits || 0;
    const pairs = all.slice(0, 200).map((p) => {
      const a = s.clients.get(p.a), b = s.clients.get(p.b);
      const [keep, drop] = visits(a) > visits(b) || (visits(a) === visits(b) && a.createdAt <= b.createdAt) ? [a, b] : [b, a];
      return { keep: clientCard(s, keep, r.caps, stats, r.now), drop: clientCard(s, drop, r.caps, stats, r.now), why: p.why };
    });
    return { total: all.length, pairs };
  }, { cap: 'client.view' });

  app.get('/api/v1/clients/:id', (r) => {
    const s = r.s;
    const c = fileOf(r);
    const stats = clientStats(s, r.local.day, r.now);
    const appts = [...s.appts.values()].filter((a) => a.clientId === c.id).sort((a, b) => (b.day + String(b.start).padStart(4, '0')).localeCompare(a.day + String(a.start).padStart(4, '0')))
      .map((a) => ({ id: a.id, day: a.day, start: a.start, dur: a.dur, status: a.status, services: a.services.map((x) => x.name), staffId: a.staffId, price: a.price, source: a.source, saleId: a.saleId, note: a.note || '' }));
    const sales = [...s.sales.values()].filter((x) => x.clientId === c.id).sort((a, b) => b.at - a.at).slice(0, 40).map((x) => ({ id: x.id, ref: ticketNo(x.number), day: x.day, due: x.totals.due, revenue: x.totals.revenue, refunded: x.refunded, lines: x.lines.map((l) => l.name) }));
    const packs = [...s.packs.values()].filter((k) => k.clientId === c.id).map((k) => ({ id: k.id, name: k.name, used: k.used, total: k.total, expires: k.expires, soldAt: k.soldAt }));
    // the owner's alerts carry the client's id so erasure blanks them, but the client never received them
    const messages = [...s.messages.values()].filter((m) => m.cid === c.id && !m.template.startsWith('owner_')).sort((a, b) => b.at - a.at).slice(0, 20).map((m) => ({ id: m.id, channel: m.channel || 'sms', template: m.template, status: m.status, at: m.at }));
    // where the consent to the offers comes from, and since when: "SMS bons plans : oui (site, 12/10/2026)"
    const consent = { marketingSrc: c.marketingSrc || '', marketingAt: c.marketingAt || null };
    return { client: { ...clientFull(s, c, r.caps, stats, r.now), ...consent }, appts, sales: r.caps.has('sale.all') || r.caps.has('report.shop') ? sales : [], packs, messages };
  }, { cap: 'client.view' });

  app.post('/api/v1/clients', (r) => r.run(C.addClient, r.body), { cap: 'client.edit' });
  app.patch('/api/v1/clients/:id', (r) => r.run(C.updateClient, { id: r.params.id, patch: r.body }), { cap: 'client.edit' });
  app.post('/api/v1/clients/merge', (r) => r.run(C.mergeClients, r.body), { cap: 'client.edit' });
  app.post('/api/v1/clients/distinct', (r) => r.run(C.markDistinct, r.body), { cap: 'client.edit' });

  // what erasing this file would close, shown before anything happens; smsLive: does a text really leave (a provider,
  // or the demo)? Otherwise the owner tells the client himself
  app.get('/api/v1/clients/:id/open', (r) => ({ ...C.openItems(r.s, fileOf(r), r.local), smsLive: !!r.rt.sms || r.s.mode === 'demo' }), { cap: 'client.erase' });
  app.post('/api/v1/clients/:id/erase', async (r) => {
    const input = { id: r.params.id, cancelUpcoming: r.body.cancelUpcoming === true };
    const out = { cancelled: 0, texted: 0, unsent: 0, refunded: 0 };
    r.meta.tombKey = C.tombKeyOf(r.rt.secret);
    // bookings first: cancelled, the texts sent now while the number still exists, deposits paid back; then the erasure
    for (let i = 0; i < 3; i++) {
      const res = await r.run(C.eraseClient, input);
      // a retried request replays the steps the first one already wrote: done once the file is erased
      if (res.duplicate) { if (fileOf(r).erased) return { ok: true, ...out }; continue; }
      out.cancelled += (res.cancelled || []).length;
      if (res.texts && res.texts.length) {
        // exactly these, now: not held behind a backlog nor by the salon's phone's per-dispatch cap
        await dispatchNow(r.rt, res.texts);
        for (const id of res.texts) { const m = r.s.messages.get(id); if (m && ['sent', 'simulated', 'claimed'].includes(m.status)) out.texted++; else out.unsent++; }
      }
      if (r.caps.has('sale.refund')) for (const pid of res.deposits || []) if ((await refundOnline(r, r.s.payments.get(pid), 'Fiche client effacée')).ok) out.refunded++;
      if (res.erased) return { ok: true, ...out };
    }
    throw new HttpError(409, 'busy', 'De nouveaux rendez-vous arrivent sur cette fiche. Réessaie dans un instant.');
  }, { cap: 'client.erase' });

  /** Anonymise the files past the retention period; expect is the count the owner confirmed. */
  app.post('/api/v1/clients/retention', async (r) => {
    const total = { erased: 0, other: 0 };
    r.meta.tombKey = C.tombKeyOf(r.rt.secret);
    let expect = r.body.expect;
    for (let i = 0; i < 40; i++) {
      const res = await r.run(C.purgeRetention, { expect });
      // a retried request: what the first one wrote, read back from its event; the rest waits for another tap
      if (res.duplicate) {
        const e = (res.events || []).find((x) => x.type === 'client.erased');
        if (e) { total.erased += e.data.files || 0; total.other += (e.data.drop || []).length; }
        break;
      }
      total.erased += res.erased || 0; total.other += res.other || 0;
      if (!res.more) break;
      expect = res.left;
    }
    return total;
  }, { cap: 'client.erase' });

  /** Everything the salon holds about one client (GDPR access and portability), as a JSON file. */
  app.get('/api/v1/clients/:id/export', (r) => {
    const s = r.s, c = fileOf(r);
    const body = JSON.stringify(clientExport(s, c, r.now), null, 2);
    const slug = (c.first + '-' + c.last).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client';
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="larchitecte-donnees-${slug}-${r.local.day}.json"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }, { cap: 'client.export' });

  /* ---------------- the till ---------------- */

  app.post('/api/v1/sales', (r) => r.run(S.checkout, { ...r.body, day: undefined, at: undefined }), { cap: 'sale.create' });
  app.get('/api/v1/sales', (r) => {
    const day = dayParam(r);
    const s = r.s;
    const all = r.caps.has('sale.all');
    const list = (s.salesByDay.get(day) || []).map((id) => s.sales.get(id)).filter((x) => x && (all || x.cashierId === r.me.id || x.lines.some((l) => l.staffId === r.me.id)));
    return { day, items: list.sort((a, b) => b.at - a.at).map((x) => saleView(s, x, r.caps)), totals: all ? dayTotals(s, day) : null, closed: s.closures.has(day) };
  }, { cap: 'sale.create' });
  app.get('/api/v1/sales/:id', (r) => {
    const x = r.s.sales.get(r.params.id);
    if (!x || (!r.caps.has('sale.all') && x.cashierId !== r.me.id && !x.lines.some((l) => l.staffId === r.me.id))) throw new HttpError(404, 'not_found', 'Ticket introuvable.');
    return saleView(r.s, x, r.caps);
  }, { cap: 'sale.create' });
  app.post('/api/v1/sales/:id/refund', async (r) => {
    const x = r.s.sales.get(r.params.id);
    if (!x) throw new HttpError(404, 'not_found', 'Ticket introuvable.');
    // every rule of the credit note, run before any money moves at the provider it was paid with (routes-payments.js)
    return tillRefund(r, x, r.body);
  }, { cap: 'sale.refund' });
  app.post('/api/v1/sales/:id/receipt', (r) => r.run(S.sendReceipt, { saleId: r.params.id, phone: r.body.phone, n: r.body.n }), { cap: 'sale.create' });

  app.get('/api/v1/giftcards/check', (r) => {
    const g = r.s.giftcards.get(r.s.giftByHash.get(sha256(normGiftCode(r.query.get('code')))) || '');
    if (!g) throw new HttpError(404, 'not_found', 'Carte cadeau inconnue.');
    const nw = g.replacedBy ? r.s.giftcards.get(g.replacedBy) : null;
    return { id: g.id, last4: g.last4, balance: g.balance, amount: g.amount, expires: g.expires, status: g.status, expired: g.expires < r.local.day, replacedBy: nw ? nw.last4 : null };
  }, { cap: 'sale.create' });
  app.get('/api/v1/giftcards', (r) => {
    const items = [...r.s.giftcards.values()].sort((a, b) => b.issuedAt - a.issuedAt).map((g) => ({ id: g.id, last4: g.last4, amount: g.amount, balance: g.balance, expires: g.expires, status: g.status, recipient: g.recipient, buyer: g.buyer, issuedAt: g.issuedAt, uses: g.uses.length, legacy: !!g.legacy, reissueOf: g.reissueOf || null, voidReason: g.voidReason || '', replacedBy: g.replacedBy ? (r.s.giftcards.get(g.replacedBy) || {}).last4 || null : null }));
    const outstanding = items.filter((g) => g.status === 'active' && g.expires >= r.local.day).reduce((t, g) => t + g.balance, 0);
    return { items, outstanding };
  }, { cap: 'sale.all' });

  app.post('/api/v1/payments/qr', async (r) => {
    const amount = Number(r.body.amount);
    if (!Number.isInteger(amount) || amount < 50 || amount > 500000) throw new HttpError(400, 'invalid', 'Montant invalide.');
    if (!r.s.settings.payments.qr) throw new HttpError(409, 'off', 'Le paiement par QR est désactivé.');
    const p = await startPayment(r, { kind: 'qr', amount, label: String(r.body.label || r.s.settings.shop.name).slice(0, 80), apptId: r.body.apptId || null, returnPath: '/paiement/merci' });
    return p;
  }, { cap: 'sale.create' });
  app.get('/api/v1/payments/:id', (r) => {
    const p = r.s.payments.get(r.params.id);
    if (!p) throw new HttpError(404, 'not_found', 'Paiement introuvable.');
    return { id: p.id, status: p.status, amount: p.amount, kind: p.kind, url: p.url, usedBy: p.usedBy || null, provider: p.provider };
  }, { cap: 'sale.create' });

  /* ---------------- drawer and Z ---------------- */

  app.get('/api/v1/drawer', (r) => {
    const s = r.s;
    const d = s.drawer;
    const last = [...s.drawers.values()].filter((x) => x.closedAt).sort((a, b) => b.closedAt - a.closedAt)[0] || null;
    const today = dayTotals(s, r.local.day);
    const unpaid = [...(s.apptsByDay.get(r.local.day) || [])].map((id) => s.appts.get(id)).filter((a) => a && !a.saleId && !a.legacy && (a.status === 'in_chair' || a.status === 'done' || ((a.status === 'booked' || a.status === 'arrived') && a.start + a.dur <= r.local.min))).length;
    const z = s.closures.get(r.local.day);
    const missed = missedZ(s, r.local.day);
    // the float to leave in the drawer tonight is the one the day started with
    const lastFloat = [...s.drawers.values()].sort((a, b) => b.openedAt - a.openedAt)[0];
    return {
      open: d ? { id: d.id, day: d.day, openedAt: d.openedAt, float: d.float, moves: d.moves, expected: drawerExpected(s, d), openedBy: (s.staff.get(d.openedBy) || {}).name || '' } : null,
      // day: the drawer's own day, so a forgotten drawer counted this morning does not read as "counted tonight"
      last: last ? { day: last.day, counted: last.counted, expected: last.expected, diff: last.diff, closedAt: last.closedAt, note: last.note } : null,
      today, closure: z ? { ...z, ...zFigures(z) } : null, unpaid, grandTotal: s.grandTotal,
      remaining: S.remainingAppts(s, r.local.day, r.local.min), closesAt: S.closingMin(s, r.local.day),
      floatHint: lastFloat ? lastFloat.float : 15000,
      missed: missed.close.map((day) => ({ day, words: dayWords(day, r.local.day), tickets: (s.salesByDay.get(day) || []).length })),
      warnings: closingWarnings(s, r.local.day)
    };
  }, { cap: 'drawer' });
  app.post('/api/v1/drawer/open', (r) => r.run(S.openDrawer, r.body), { cap: 'drawer' });
  app.post('/api/v1/drawer/move', (r) => r.run(S.moveDrawer, r.body), { cap: 'drawer' });
  app.post('/api/v1/drawer/close', (r) => r.run(S.closeDrawer, r.body), { cap: 'drawer' });
  // early: the owner closes before the end of the day on purpose; day: catching up a past day nobody closed
  app.post('/api/v1/closures', (r) => r.run(S.closeDay, { early: r.body.early === true, day: isDay(r.body.day) ? r.body.day : undefined }), { cap: 'closure' });
  app.get('/api/v1/closures', (r) => {
    const items = [...r.s.closures.values()].sort((a, b) => b.number - a.number).slice(0, Math.min(400, Number(r.query.get('limit')) || 60))
      .map((z) => ({ ...z, ...zFigures(z), ref: closureNo(z.number), by: (r.s.staff.get(z.by) || {}).name || (z.auto ? 'Automatique' : 'Système') }));
    return { items, grandTotal: r.s.grandTotal };
  }, { cap: 'closure' });

  /* ---------------- reports ---------------- */

  app.get('/api/v1/reports', (r) => {
    const L = r.local;
    let from = r.query.get('from'), to = r.query.get('to');
    if (!from || !isDay(from)) from = monthStart(L.day);
    if (!to || !isDay(to)) to = L.day;
    if (to < from) [from, to] = [to, from];
    if (diffDays(from, to) > 400) throw new HttpError(400, 'invalid', 'Période trop longue (400 jours maximum).');
    const own = !r.caps.has('report.shop');
    if (own && !r.caps.has('report.own')) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès aux chiffres.');
    const staffId = own ? r.me.id : r.query.get('staff') || null;
    const cur = report(r.s, { from, to, staffId, today: L.day, now: r.now });
    const pp = previousPeriod(from, to);
    const prev = report(r.s, { ...pp, staffId, today: L.day, now: r.now });
    const pick = (x) => ({ revenue: x.revenue, tickets: x.tickets, avgTicket: x.avgTicket, clients: x.clients, newClients: x.newClients, occupancy: x.occupancy, noShowRate: x.noShowRate, tips: x.tips, series: x.series.map((d) => d.revenue) });
    // the goal of the chosen month (TEAM-03): the salon's on Encaissé, a barber's on his Chiffre réalisé. A period over
    // several months (7 days astride two, 3 months, the year) follows the month it ends in, today's for the usual ones;
    // a barber sees his own only when the owner lets barbers see theirs, never the salon's in euros
    const ms = monthStart(to), me = monthEnd(to);
    const gday = me < L.day ? me : ms > L.day ? ms : L.day;
    const elapsed = me < L.day ? diffDays(ms, me) + 1 : ms > L.day ? 0 : diffDays(ms, L.day) + 1;
    const showGoal = !own || r.s.settings.goals.showBarbers !== false;
    const goal = showGoal ? { ...goalOf(r.s, staffId, gday, r.now), days: diffDays(ms, me) + 1, elapsed } : null;
    const mine = staffId ? cur.staff[0] : null;
    return {
      ...cur, scope: own ? 'own' : staffId ? 'staff' : 'shop', prev: pick(prev), prevRange: pp, goal,
      ...(own ? { rebookRate: mine ? mine.rebookRate : 0, ...teamSide(r, from, to) } : {})
    };
  }, { cap: 'report.own' });

  /* ---------------- monthly statement and goals (TEAM-03) ---------------- */

  // a barber's month: his own, unless the asker manages the team (then any chair's, ?staff=)
  app.get('/api/v1/statements', (r) => {
    const L = r.local;
    const month = r.query.get('month') || L.day.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'invalid', 'Mois attendu au format AAAA-MM.');
    if (month > L.day.slice(0, 7)) throw new HttpError(400, 'future', 'Ce mois n’a pas encore commencé.');
    const want = r.query.get('staff');
    const staffId = want && r.caps.has('team') ? want : r.me.id;
    if (!r.s.staff.get(staffId)) throw new HttpError(404, 'not_found', 'Membre de l’équipe introuvable.');
    return staffStatement(r.s, staffId, month, L.day, r.now);
  }, { cap: 'report.own' });

  // Objectifs: each chair's share of this month's open chair minutes, so the screen shows « Auto · 4 200 € » as typed
  app.get('/api/v1/goals', (r) => {
    const s = r.s, day = r.local.day;
    const G = s.settings.goals;
    const shares = goalShares(s, day);
    return {
      month: day.slice(0, 7), monthCents: G.monthCents, showBarbers: G.showBarbers !== false,
      staff: [...shares.entries()].map(([id, share]) => ({ id, share, auto: autoGoal(G.monthCents, share), typed: G.staff && typeof G.staff[id] === 'number' ? G.staff[id] : null }))
    };
  }, { cap: 'settings' });

  /* ---------------- relances ---------------- */

  app.get('/api/v1/relances', (r) => {
    const s = r.s;
    const stats = clientStats(s, r.local.day, r.now);
    const overdue = [...s.clients.values()].filter((c) => !c.erased && !c.mergedInto && c.sms && c.phone && stats.get(c.id)?.overdue);
    // without consent to the offers, no follow-up: they are counted, not listed
    const items = overdue.filter((c) => rebookable(c, stats.get(c.id)))
      .map((c) => clientCard(s, c, r.caps, stats, r.now)).sort((a, b) => (a.dueIn ?? 0) - (b.dueIn ?? 0)).slice(0, 200);
    /** @type {Map<string, any>} */
    const recent = new Map();
    for (const m of s.messages.values()) if (m.template === 'rebook' && r.now - m.at < 60 * 86400000 && m.at > (recent.get(m.cid)?.at || 0)) recent.set(m.cid, m);
    const stat = attribution(s, { now: r.now, templates: ['rebook'] }).rebook;
    // lastDue: the last text is still held by the quiet hours and leaves then ("relance prévue à 8 h")
    const last = (id) => { const m = recent.get(id); return { lastText: m ? m.at : null, lastDue: m && m.status === 'queued' && m.dueAt > r.now ? m.dueAt : null }; };
    return {
      items: items.map((c) => ({ ...c, ...last(c.id) })), excludedNoConsent: overdue.filter((c) => !c.marketing).length,
      stats: stat, template: s.settings.messages.templates.rebook, stop: s.settings.messages.stopSuffix, quiet: s.settings.messages.quiet
    };
  }, { cap: 'marketing' });
  app.post('/api/v1/relances/send', (r) => r.run(sendRebook, r.body), { cap: 'marketing' });

  app.get('/api/v1/messages', (r) => {
    const items = [...r.s.messages.values()].sort((a, b) => b.at - a.at).slice(0, Math.min(300, Number(r.query.get('limit')) || 100))
      .map((m) => ({ id: m.id, channel: m.channel || 'sms', template: m.template, status: m.status, at: m.at, dueAt: m.dueAt || m.at, sentAt: m.sentAt || null, to: m.toMasked || maskPhone(m.to), body: r.caps.has('settings') ? m.body : '', subject: r.caps.has('settings') && m.mail ? m.mail.subject || '' : '', error: m.error || '', via: m.via || null, fallback: m.fallback || '' }));
    return { items, provider: r.rt.sms ? r.rt.sms.name : null, emailProvider: r.rt.email ? r.rt.email.name : null, mode: r.s.mode };
  }, { cap: 'marketing' });
  /** The address that brings STOP replies back (sent with every text; also for the provider's own settings). */
  // marketing: the templates that get the STOP mention (TEMPLATE_FLAGS), so Réglages counts it without a copy of the list
  app.get('/api/v1/messages/webhook', (r) => ({
    url: webhookUrl(r.origin, r.rt.cfg.cronSecret) || null, marketing: Object.keys(TEMPLATE_FLAGS).filter((k) => TEMPLATE_FLAGS[k].marketing)
  }), { cap: 'settings' });
}
