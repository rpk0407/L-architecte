// @ts-check
// Owner tools: team, catalogue, settings, devices, the activity log, integrity proof, exports.
import { HttpError, guard } from './kit.js';
import { staffView, serviceView, productView } from './views.js';
import { verifyChain, publicEvent } from '../core/journal.js';
import { hashSecret, passwordProblem, pinProblem } from '../auth/password.js';
import { report } from '../domain/insights.js';
import { staffStatement, monthWords } from '../domain/statement.js';
import { payRulesOf } from '../settings/team.js';
import { ticketNo, refundNo, closureNo, METHOD_LABEL, METHODS, zFigures, refundParts } from '../domain/cash.js';
import { closingWarnings } from '../commands/tick-steps.js';
import { isDay, dayRange, monthStart, monthEnd, addDays } from '../../shared/dates.js';
import { staffIntervals } from '../domain/availability.js';
import { refundOnline } from './routes-public.js';
import { fmtEur } from '../../shared/money.js';
import { monthNo, yearNo } from '../domain/fiscal.js';
import { fmtPhone, safeEqual } from '../lib/util.js';
import * as T from '../commands/team.js';
import * as K from '../commands/catalog.js';
import * as SH from '../commands/shop.js';
import { refundPlan, sendGiftcode, reissueGiftcard } from '../commands/sales.js';
import { buildDemoJournal } from '../domain/seed.js';
import { TEMPLATES } from '../core/state.js';
import { CAPS, ROLES, capsOf } from '../domain/permissions.js';
import { changeWords } from '../projections/governance.js';
import { maybeTick } from './scheduler.js';
import { STALE_MS, backupOff, backupStatus, backupsOf, freshBackup, makeBackup, ownBackups, salonOf } from '../core/backup.js';

/* ---------------- the activity log, in plain French ---------------- */

const LABELS = {
  'team.changed': 'Rémunération ou accès modifié',
  'shop.initialized': 'Salon créé', 'shop.restored': 'Salon restauré', 'settings.updated': 'Réglages modifiés', 'staff.added': 'Membre ajouté', 'staff.updated': 'Fiche équipe modifiée',
  'staff.archived': 'Membre désactivé', 'staff.restored': 'Membre réactivé', 'staff.credentials': 'Accès modifiés', 'staff.revoked': 'Sessions fermées',
  'timeoff.added': 'Absence posée', 'timeoff.removed': 'Absence retirée', 'timeoff.requested': 'Absence demandée', 'timeoff.refused': 'Absence refusée',
  'timeoff.withdrawn': 'Demande d’absence retirée', 'device.enrolled': 'Appareil enregistré', 'device.revoked': 'Appareil retiré',
  'import.started': 'Reprise WordPress commencée', 'import.batch': 'Paquet WordPress repris', 'import.finished': 'Reprise WordPress terminée',
  'service.added': 'Prestation créée', 'service.updated': 'Prestation modifiée', 'service.archived': 'Prestation retirée', 'product.added': 'Produit créé',
  'product.updated': 'Produit modifié', 'product.archived': 'Produit retiré', 'stock.adjusted': 'Stock ajusté', 'client.added': 'Client créé',
  'client.updated': 'Fiche client modifiée', 'client.merged': 'Fiches fusionnées', 'client.erased': 'Client effacé (RGPD)', 'appt.held': 'Créneau gardé',
  'hold.released': 'Créneau relâché', 'appt.booked': 'Rendez-vous pris', 'appt.moved': 'Rendez-vous déplacé', 'appt.updated': 'Rendez-vous modifié',
  'appt.status': 'Statut du rendez-vous', 'appt.confirmed': 'Rendez-vous confirmé', 'appt.cancelled': 'Rendez-vous annulé', 'block.added': 'Créneau bloqué',
  'block.removed': 'Créneau rouvert', 'queue.added': 'Passage en file', 'queue.updated': 'File mise à jour', 'waitlist.added': 'Liste d’attente',
  'waitlist.updated': 'Liste d’attente mise à jour', 'sale.completed': 'Vente', 'sale.refunded': 'Remboursement', 'payment.created': 'Paiement en ligne demandé',
  'payment.succeeded': 'Paiement en ligne reçu', 'payment.failed': 'Paiement en ligne échoué', 'payment.expired': 'Paiement en ligne expiré', 'payment.refunded': 'Paiement en ligne remboursé',
  'payment.refundedOutside': 'Remboursé chez le prestataire', 'payment.disputed': 'Litige ouvert', 'payment.disputeClosed': 'Litige clos', 'payout.recorded': 'Virement reçu',
  'drawer.opened': 'Caisse ouverte', 'drawer.moved': 'Mouvement de caisse', 'drawer.closed': 'Caisse comptée', 'day.closed': 'Clôture journalière',
  'giftcard.issued': 'Carte cadeau émise', 'giftcard.redeemed': 'Carte cadeau utilisée', 'giftcard.voided': 'Carte cadeau annulée', 'pack.sold': 'Carnet vendu',
  'pack.used': 'Coupe de carnet', 'pack.voided': 'Carnet annulé', 'pack.returned': 'Coupe rendue au carnet',
  'member.created': 'Abonnement demandé', 'member.activated': 'Abonnement souscrit', 'member.renewed': 'Mois d’abonnement payé', 'member.pastDue': 'Paiement d’abonnement refusé',
  'member.used': 'Coupe d’abonnement', 'member.cancelRequested': 'Abonnement résilié', 'member.withdrawn': 'Rétractation d’abonnement', 'member.ended': 'Abonnement terminé', 'message.queued': 'Message programmé', 'message.updated': 'Message', 'demo.seeded': 'Démo préparée'
};
// CPT-01a: the month and year closures, their signatures, the technical log
Object.assign(LABELS, { 'period.closed': 'Clôture du mois ou de l’année', 'seal.signed': 'Clôture signée', 'tech.logged': 'Journal technique' });
// TEAM-02: linked phones, photos, personal prefs
Object.assign(LABELS, { 'phone.linkIssued': 'Lien de téléphone créé', 'phone.pinMissed': 'Code faux sur un téléphone lié', 'phone.pinCleared': 'Code juste après des erreurs', 'phone.locked': 'Téléphone bloqué (codes faux)', 'staff.photo': 'Photo de l’équipe modifiée', 'prefs.set': 'Réglages personnels modifiés' });
// PAY-03: the salon confirms a cancellation asked from /resilier without the member's link
Object.assign(LABELS, { 'member.cancelConfirmed': 'Résiliation confirmée' });
// AC-01: the client space
Object.assign(LABELS, { 'account.signedIn': 'Espace client : connexion', 'account.codeMissed': 'Espace client : code erroné', 'account.codeBurned': 'Espace client : code bloqué', 'account.fenceOpened': 'Espace client : ouvert sur une fiche inactive', 'account.revoked': 'Espace client : appareils déconnectés', 'account.closed': 'Espace client supprimé' });
const STATUS = { arrived: 'arrivé', in_chair: 'au fauteuil', booked: 'remis à venir', no_show: 'absent' };

const END_FR = { cancelled: 'résilié', unpaid: 'faute de paiement', withdrawn: 'rétractation', abandoned: 'paiement jamais fait' };
const dm = (day) => (typeof day === 'string' ? day.slice(8, 10) + '/' + day.slice(5, 7) : '');
function memberSummary(s, type, d) {
  const m = s.members ? s.members.get(d.id) : null;
  const plan = m ? m.name : '';
  switch (type) {
    case 'member.created': return plan + ' · ' + fmtEur(d.price) + '/mois · ' + (d.channel === 'salon' ? 'au salon' : d.channel === 'import' ? 'reprise' : 'en ligne');
    case 'member.renewed': return plan + ' · ' + dm(d.periodStart) + ' au ' + dm(addDays(d.periodEnd, -1)) + ' · ' + fmtEur(d.amount);
    case 'member.pastDue': return plan + ' · essai ' + (d.attempt || 1) + (d.action ? ' · validation demandée par la banque' : '');
    case 'member.used': return plan + (d.forced ? ' · hors forfait' : '');
    case 'member.cancelRequested': return plan + ' · fin le ' + dm(d.effective) + ' · ' + (d.by === 'salon' ? 'par le salon' : 'par le client');
    case 'member.withdrawn': return plan + ' · ' + fmtEur(d.refund) + ' à rembourser';
    case 'member.ended': return plan + ' · ' + (END_FR[d.reason] || 'résilié');
    default: return plan;
  }
}

/** Z CSV columns, written out: a gift card used or a deposit settles a ticket without money coming in that day. */
const Z_CSV_METHOD = { card: 'Encaissé carte (TPE)', cash: 'Encaissé espèces', online: 'Encaissé paiement en ligne', deposit: 'Réglé par acompte en ligne', giftcard: 'Réglé par carte cadeau' };

function summary(s, e) {
  const d = e.data || {};
  switch (e.type) {
    case 'sale.completed': return ticketNo(d.number) + ' · ' + fmtEur(d.totals.due) + ' · ' + d.payments.map((p) => METHOD_LABEL[p.method] || p.method).join(' + ');
    case 'sale.refunded': return refundNo(d.number) + ' · ' + fmtEur(d.amount) + ' sur ' + ticketNo(d.saleNumber) + ' · ' + refundMethods(d) + (d.liability ? ' · carte cadeau annulée' : '') + ' · ' + d.reason;
    case 'day.closed': return closureNo(d.number) + ' · ' + d.day + ' · ' + fmtEur(d.net) + (d.auto ? ' · automatique' : d.late ? ' · rattrapage' : d.early ? ' · en avance' : '');
    case 'drawer.opened': return 'Fond de caisse ' + fmtEur(d.float);
    case 'drawer.moved': return fmtEur(d.amount) + ' · ' + d.reason;
    case 'drawer.closed': return 'Compté ' + fmtEur(d.counted) + (d.diff ? ' · écart ' + fmtEur(d.diff) : ' · juste');
    case 'appt.booked': return d.day + ' ' + Math.floor(d.start / 60) + 'h' + String(d.start % 60).padStart(2, '0') + ' · ' + ((s.staff.get(d.staffId) || {}).name || '') + ' · ' + (d.services || []).map((x) => x.name).join(' + ');
    case 'appt.moved': return 'vers ' + d.day + ' ' + Math.floor(d.start / 60) + 'h' + String(d.start % 60).padStart(2, '0');
    case 'appt.status': return STATUS[d.status] || d.status;
    case 'period.closed': return (d.kind === 'year' ? yearNo(d.number) : monthNo(d.number)) + ' · ' + d.period + ' · ' + fmtEur(d.totals ? d.totals.netTtc : 0);
    case 'seal.signed': return d.ref + (d.late ? ' · en retard' : '') + ' · clé ' + d.kid;
    case 'tech.logged': return d.kind === 'key' ? 'clé ' + d.kid + (d.backlog && d.backlog.length ? ' · ' + d.backlog.length + ' en attente' : '') : d.kind === 'version' ? 'version ' + d.to : d.kind;
    case 'import.batch': return d.i != null ? 'Paquet n° ' + (d.i + 1) : '';
    case 'phone.linkIssued': return 'pour ' + ((s.staff.get(d.staffId) || {}).name || '');
    case 'device.enrolled': case 'phone.locked': return d.staffId ? 'téléphone de ' + ((s.staff.get(d.staffId) || {}).name || '') + ' · ' + (d.name || '') : '';
    case 'staff.photo': return ((s.staff.get(d.id) || {}).name || '') + (d.v ? '' : ' · retirée');
    case 'prefs.set': return Object.keys(d.prefs || {}).join(', ');
    case 'shop.restored': return 'depuis ' + (d.from === 'fichier' ? 'un fichier' : d.from) + ' · ' + d.count + ' opérations';
    case 'appt.cancelled': {
      // a client's own reason is personal data (pii): shown until the client is erased
      const why = d.reason || (e.pii && e.pii.reason) || '';
      return (d.by === 'client' ? 'par le client' : d.by === 'system' ? 'automatique' : 'par le salon') + (why ? ' · ' + why : '');
    }
    case 'stock.adjusted': return (d.name || '') + ' ' + (d.delta > 0 ? '+' : '') + d.delta + ' · ' + d.reason;
    case 'settings.updated': return Object.keys(d.patch || {}).join(', ');
    case 'staff.added': return d.staff ? d.staff.name : '';
    case 'team.changed': return changeWords(s, d);
    case 'service.updated': case 'product.updated': return Object.keys(d.patch || {}).join(', ');
    case 'payment.succeeded': { const p = s.payments.get(d.id); return p ? fmtEur(p.amount) + ' · ' + p.label : ''; }
    case 'giftcard.issued': return '•••• ' + d.last4 + ' · ' + fmtEur(d.amount) + (d.reissueOf ? ' · réémise (remplace •••• ' + ((s.giftcards.get(d.reissueOf) || {}).last4 || '') + ')' : d.legacy ? ' · reprise' : '');
    case 'giftcard.voided': return '•••• ' + ((s.giftcards.get(d.id) || {}).last4 || '') + (d.reason === 'reissued' ? ' · remplacée' : d.reason === 'refunded' ? ' · remboursée' : '');
    case 'pack.voided': { const k = s.packs.get(d.id); return k ? k.name + (k.voided ? ' · ' + k.voided.left + ' restante' + (k.voided.left > 1 ? 's' : '') + ' annulée' + (k.voided.left > 1 ? 's' : '') : '') : ''; }
    case 'client.updated': return (d.fields || []).join(', ');
    // the memberships (PAY-02): the formule and the figures, never the person (pii)
    case 'member.created': case 'member.activated': case 'member.renewed': case 'member.pastDue': case 'member.used':
    case 'member.cancelRequested': case 'member.withdrawn': case 'member.ended': return memberSummary(s, e.type, d);
    case 'timeoff.added': case 'timeoff.requested': return ((s.staff.get(d.staffId) || {}).name || '') + ' · ' + T.rangeWords(d) + (d.reason ? ' · ' + d.reason : '') + (d.request ? ' · demande validée' : '');
    default: return '';
  }
}
/** "Carte (TPE)", or "Carte (TPE) 15,00 € + Espèces 10,00 €" for a credit note split as the payment was. */
function refundMethods(rf) {
  return rf.parts && rf.parts.length > 1 ? refundParts(rf).map((p) => (METHOD_LABEL[p.method] || p.method) + ' ' + fmtEur(p.amount, { decimals: true })).join(' + ') : METHOD_LABEL[rf.method] || rf.method;
}
function actorName(s, a) {
  if (a.t === 'staff') return (s.staff.get(a.id) || {}).name || 'Équipe';
  if (a.t === 'client') return a.id === 'moi' ? 'Client (espace)' : 'Client (site)';
  if (a.t === 'provider') return a.id === 'stripe' ? 'Stripe' : 'Paiement';
  return a.n || 'Automatique';
}

/* ---------------- an absence and the clients it lands on ---------------- */

/** The absence a request names: posted, or still a request. */
function absenceOf(r, id) {
  const t = r.s.timeoff.get(id) || r.s.timeoffRequests.get(id);
  // a barber only ever reads his own
  if (!t || (!r.caps.has('team') && t.staffId !== r.me.id)) throw new HttpError(404, 'not_found', 'Absence introuvable.');
  return t;
}
function clientWord(s, a) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  return c && !c.erased ? c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '') : a.name || 'Client';
}
/** What the absence sheet shows: each appointment, what is proposed for it, and whether the client can be texted
 *  (online: still in time to change it himself, so 'ask' may text him a link; otherwise the salon calls him). */
function planView(r, t) {
  const s = r.s;
  const rows = T.handoverPlan(s, t, { now: r.now, local: r.local }).map(({ a, same, nearest, choice, online }) => ({
    id: a.id, day: a.day, start: a.start, dur: a.dur, name: clientWord(s, a), services: a.services.map((x) => x.name), serviceIds: a.services.map((x) => x.id),
    price: a.price, status: a.status, deposit: a.deposit && a.deposit.paid ? a.deposit.paid : 0, textable: T.textable(s, a), asked: T.askedToReschedule(s, a),
    online, same, nearest, choice
  }));
  return { staffId: t.staffId, from: t.from, to: t.to, startMin: t.startMin ?? null, endMin: t.endMin ?? null, count: rows.length, rows, back: backDay(s, t) };
}
/** The first day after the absence the barber works again (his week, the salon's hours and closures, his other
 *  absences): the site's note proposes it ('Frank revient le 3 novembre', not a Sunday). Null beyond two months. */
function backDay(s, t) {
  const h = s.timeoff.has(t.id) ? s : { ...s, timeoff: new Map(s.timeoff).set('_preview', { ...t, id: '_preview' }) };
  for (let d = addDays(t.to, 1), i = 0; i < 62; d = addDays(d, 1), i++) if (staffIntervals(h, t.staffId, d).length) return d;
  return null;
}
const conflictCount = (r, t) => T.timeoffConflicts(r.s, t, { now: r.now, local: r.local }).length;

/* ---------------- CSV for the accountant ---------------- */

function csv(rows) {
  const esc = (v) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
const eu = (c) => (c / 100).toFixed(2).replace('.', ',');
/** The rules the commission figures follow, as the first row of the payroll and commissions CSV (TEAM-03). */
function rulesRow(s) {
  const R = payRulesOf(s.settings);
  return [
    'Base : ' + (R.base === 'ht' ? 'HT' : 'TTC'), 'Coupes de carnet : ' + (R.cutCredit === 'seller' ? 'pour qui vend' : 'pour qui coupe'),
    'Coupes d’abonnement : ' + { split: 'part du mois', zero: 'rien', list: 'prix de la carte' }[R.memberCredit],
    'Coupes fidélité : ' + (R.rewardCredit === 'net' ? 'ce qui est payé' : 'comme payées'),
    'Pourboires carte et espèces : estimés selon le paiement du ticket', 'Estimation, la paie fait foi'
  ];
}

export function adminRoutes(app) {
  /* team */
  app.get('/api/v1/staff', (r) => ({
    items: [...r.s.staff.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffView(x, true)),
    // each absence to come with the appointments still on it (the 'à replacer' of the list), and the requests waiting
    timeoff: [...r.s.timeoff.values()].map((t) => (t.to >= r.local.day ? { ...t, conflicts: conflictCount(r, t) } : t)),
    requests: [...r.s.timeoffRequests.values()].filter((q) => q.to >= r.local.day).sort((a, b) => a.at - b.at).map((q) => ({ ...q, conflicts: conflictCount(r, q) }))
  }), { cap: 'team' });
  app.post('/api/v1/staff', async (r) => {
    // refuse a weak PIN before adding anyone, or the member would exist without a PIN
    const pb = r.body.pin ? pinProblem(r.body.pin) : null;
    if (pb) throw new HttpError(400, 'weak', pb);
    const res = await r.run(T.addStaff, r.body);
    if (r.body.pin) await r.run(T.setCredentials, { id: res.id, pinHash: await hashSecret(r.body.pin) });
    return res;
  }, { cap: 'team' });
  app.patch('/api/v1/staff/:id', (r) => r.run(T.updateStaff, { id: r.params.id, patch: r.body }), { cap: 'agenda.own' });
  app.post('/api/v1/staff/:id/archive', (r) => r.run(T.archiveStaff, { id: r.params.id, restore: !!r.body.restore }), { cap: 'team' });
  app.post('/api/v1/staff/:id/pin', async (r) => {
    const pb = pinProblem(r.body.pin);
    if (pb) throw new HttpError(400, 'weak', pb);
    return r.run(T.setCredentials, { id: r.params.id, pinHash: await hashSecret(r.body.pin) });
  }, { cap: 'team' });
  app.post('/api/v1/staff/:id/password', async (r) => {
    const pb = passwordProblem(r.body.password);
    if (pb) throw new HttpError(400, 'weak', pb);
    return r.run(T.setCredentials, { id: r.params.id, pwdHash: await hashSecret(r.body.password) });
  }, { cap: 'team' });
  app.post('/api/v1/staff/:id/revoke', (r) => r.run(T.revokeSessions, { id: r.params.id }), { cap: 'agenda.own' });
  app.get('/api/v1/timeoff/mine', (r) => {
    const mine = (t) => t.staffId === r.me.id && t.to >= r.local.day;
    const byFrom = (a, b) => a.from.localeCompare(b.from);
    return {
      items: [...r.s.timeoff.values()].filter(mine).sort(byFrom).map((t) => ({ ...t, conflicts: conflictCount(r, t) })),
      // asked for and not yet approved, or refused: the barber sees where his request stands
      requests: [...r.s.timeoffRequests.values()].filter(mine).sort(byFrom).map((q) => ({ ...q, conflicts: conflictCount(r, q) })),
      approval: r.s.settings.team.timeoffApproval !== false && !r.caps.has('team')
    };
  }, { cap: 'agenda.own' });
  app.post('/api/v1/timeoff', async (r) => {
    const res = await r.run(T.addTimeOff, r.body);
    const t = r.s.timeoff.get(res.id) || r.s.timeoffRequests.get(res.id);
    return { ...res, conflicts: t ? conflictCount(r, t) : 0 };
  }, { cap: 'agenda.own' });
  // the appointments an absence would land on, each with a proposal; {id} for one already posted or asked for
  app.post('/api/v1/timeoff/preview', (r) => {
    let t;
    if (r.body && r.body.id) t = absenceOf(r, String(r.body.id));
    else t = T.parseTimeOff({ staffId: r.body.staffId, from: r.body.from, to: r.body.to, startMin: r.body.startMin, endMin: r.body.endMin });
    if (!r.s.staff.has(t.staffId)) throw new HttpError(404, 'not_found', 'Membre de l’équipe introuvable.');
    if (!r.caps.has('team') && t.staffId !== r.me.id) throw new HttpError(403, 'forbidden', 'Seul le gérant voit les absences de l’équipe.');
    return planView(r, t);
  }, { cap: 'agenda.own' });
  app.post('/api/v1/timeoff/:id/approve', async (r) => {
    const res = await r.run(T.approveTimeOff, { id: r.params.id });
    const t = r.s.timeoff.get(res.id);
    return { ...res, conflicts: t ? conflictCount(r, t) : 0 };
  }, { cap: 'team' });
  app.post('/api/v1/timeoff/:id/refuse', (r) => r.run(T.refuseTimeOff, { id: r.params.id }), { cap: 'team' });
  // the handover plan, applied: moves, texts and cancellations in one batch, then the deposits of the cancelled given back.
  // team and agenda.edit, as the plan's preview and the agenda's banner: whoever applies a plan could read it first
  app.post('/api/v1/timeoff/:id/reassign', async (r) => {
    if (!r.caps.has('team')) throw new HttpError(403, 'forbidden', 'Seul le gérant replace les clients d’une absence.');
    const t = r.s.timeoff.get(r.params.id);
    if (!t) throw new HttpError(404, 'not_found', r.s.timeoffRequests.has(r.params.id) ? 'Valide d’abord la demande d’absence.' : 'Absence introuvable.');
    const base = { actor: { t: /** @type {const} */ ('staff'), id: r.me.id, n: r.me.name, ...(r.device ? { dev: r.device.id } : {}) }, staff: r.me, caps: r.caps, meta: r.meta };
    const { deposits, ...res } = await T.applyHandover(r.rt.engine, t, r.body, base);
    let refunded = 0;
    // the salon cancels, so a paid deposit goes back (only for whoever may refund, as on the appointment sheet)
    if (r.caps.has('sale.refund')) for (const d of deposits) if ((await refundOnline(r, r.s.payments.get(d.paymentId), 'Barbier absent')).ok) refunded++;
    // what is still paid: refused, failed or not ours to refund; said, so it is done from the appointment's sheet
    const unrefunded = deposits.filter((d) => { const p = r.s.payments.get(d.paymentId); return p && p.status === 'paid'; }).length;
    return { ...res, refunded, unrefunded, left: conflictCount(r, t) };
  }, { cap: 'agenda.edit' });
  app.del('/api/v1/timeoff/:id', (r) => r.run(T.removeTimeOff, { id: r.params.id }), { cap: 'agenda.own' });

  /* catalogue */
  app.get('/api/v1/catalog', (r) => ({
    services: [...r.s.services.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView),
    products: [...r.s.products.values()].map(productView)
  }), { cap: 'sale.create' });
  app.post('/api/v1/services', (r) => r.run(K.addService, r.body), { cap: 'catalog' });
  app.patch('/api/v1/services/:id', (r) => r.run(K.updateService, { id: r.params.id, patch: r.body }), { cap: 'catalog' });
  app.post('/api/v1/services/:id/archive', (r) => r.run(K.archiveService, { id: r.params.id, restore: !!r.body.restore }), { cap: 'catalog' });
  app.post('/api/v1/products', (r) => r.run(K.addProduct, r.body), { cap: 'catalog' });
  app.patch('/api/v1/products/:id', (r) => r.run(K.updateProduct, { id: r.params.id, patch: r.body }), { cap: 'catalog' });
  app.post('/api/v1/products/:id/archive', (r) => r.run(K.archiveProduct, { id: r.params.id, restore: !!r.body.restore }), { cap: 'catalog' });
  app.post('/api/v1/products/:id/stock', (r) => r.run(K.adjustStock, { id: r.params.id, delta: r.body.delta, reason: r.body.reason }), { cap: 'catalog' });

  /* credit notes and gift cards after the sale */
  app.get('/api/v1/sales/:id/refund-plan', (r) => {
    const x = r.s.sales.get(r.params.id);
    if (!x) throw new HttpError(404, 'not_found', 'Ticket introuvable.');
    return refundPlan(r.s, x);
  }, { cap: 'sale.refund' });
  // the credit note as printed: its number, the ticket it corrects, the lines given back, the VAT given back
  app.get('/api/v1/refunds/:id', (r) => {
    const rf = r.s.refunds.get(r.params.id);
    // whoever may open the ticket may reprint its credit notes (a barber, his own tickets), as GET /api/v1/sales/:id
    const x = rf && r.s.sales.get(rf.saleId);
    if (!rf || !x || (!r.caps.has('sale.all') && x.cashierId !== r.me.id && !x.lines.some((l) => l.staffId === r.me.id))) throw new HttpError(404, 'not_found', 'Avoir introuvable.');
    const by = (r.s.staff.get(rf.by) || {}).name || 'Système';
    return {
      id: rf.id, ref: refundNo(rf.number), saleId: rf.saleId, saleRef: ticketNo(rf.saleNumber), day: rf.day, at: rf.at, amount: rf.amount, liability: rf.liability || 0,
      method: rf.method, parts: refundParts(rf).map((p) => ({ method: p.method, amount: p.amount })), reason: rf.reason, vat: rf.vat || [], lines: rf.lines || [], by
    };
  }, { cap: 'sale.create' });
  app.post('/api/v1/giftcards/:id/send', (r) => {
    // a code is checked against its hash here: a few tries per minute, no guessing
    guard('gcsend|' + r.me.id, 10, 60000);
    return r.run(sendGiftcode, { ...r.body, id: r.params.id });
  }, { cap: 'sale.create' });
  app.post('/api/v1/giftcards/:id/reissue', (r) => r.run(reissueGiftcard, { id: r.params.id }), { cap: 'sale.refund' });

  /* settings and devices */
  app.get('/api/v1/settings', (r) => ({
    settings: r.s.settings,
    // what the owner needs to read the settings: default texts, and what each role can do once the toggles apply
    defaultTemplates: TEMPLATES,
    roles: Object.fromEntries(Object.keys(ROLES).map((role) => [role, [...capsOf({ role, active: true }, r.s.settings)]])),
    caps: CAPS
  }), { cap: 'settings' });
  app.patch('/api/v1/settings', (r) => r.run(SH.updateSettings, r.body), { cap: 'settings' });
  app.post('/api/v1/settings/closures', (r) => r.run(SH.addClosure, r.body), { cap: 'settings' });
  app.del('/api/v1/settings/closures/:id', (r) => r.run(SH.removeClosure, { id: r.params.id }), { cap: 'settings' });
  app.get('/api/v1/devices', (r) => ({ items: [...r.s.devices.values()].filter((d) => !d.revoked).map((d) => ({ id: d.id, name: d.name, at: d.at, by: (r.s.staff.get(d.by) || {}).name || 'Démo', current: r.device && r.device.id === d.id, personal: d.personal ? (r.s.staff.get(d.staffId) || {}).name || '' : null })) }), { cap: 'devices' });
  app.del('/api/v1/devices/:id', (r) => r.run(T.revokeDevice, { id: r.params.id }), { cap: 'devices' });

  /* the journal */
  app.get('/api/v1/audit', (r) => {
    const s = r.s;
    const before = Number(r.query.get('before')) || Infinity;
    const type = r.query.get('type') || '';
    const actor = r.query.get('actor') || '';
    const limit = Math.min(200, Number(r.query.get('limit')) || 60);
    const hide = new Set(['appt.held', 'hold.released', 'message.updated', 'demo.seeded']);
    const out = [];
    const j = r.rt.engine.journal;
    for (let i = j.length - 1; i >= 0 && out.length < limit; i--) {
      const e = j[i];
      if (e.v >= before || hide.has(e.type)) continue;
      if (type && !e.type.startsWith(type)) continue;
      if (actor && e.actor.id !== actor) continue;
      out.push({ v: e.v, at: e.at, type: e.type, label: LABELS[e.type] || e.type, summary: summary(s, e), actor: actorName(s, e.actor), actorId: e.actor.id, device: e.actor.dev ? (s.devices.get(e.actor.dev) || {}).name || '' : '', hash: e.h.slice(0, 12) });
    }
    return { items: out, head: s.head, version: s.version };
  }, { cap: 'audit' });

  app.get('/api/v1/integrity', (r) => {
    guard('integrity|' + r.me.id, 6, 60000);
    const t0 = Date.now();
    const res = verifyChain(r.rt.engine.journal);
    const closures = [...r.s.closures.values()].sort((a, b) => b.number - a.number).slice(0, 10).map((z) => ({ ref: closureNo(z.number), day: z.day, seal: z.seal, net: z.net }));
    return { ...res, ms: Date.now() - t0, first: r.rt.engine.journal[0] ? r.rt.engine.journal[0].at : null, closures, store: r.rt.store.kind };
  }, { cap: 'audit' });

  /* exports */
  app.get('/api/v1/export', (r) => {
    const s = r.s;
    const kind = r.query.get('kind') || 'sales';
    const from = isDay(r.query.get('from') || '') ? /** @type {string} */ (r.query.get('from')) : monthStart(r.local.day);
    const to = isDay(r.query.get('to') || '') ? /** @type {string} */ (r.query.get('to')) : r.local.day;
    const need = { sales: 'report.shop', vat: 'report.shop', closures: 'closure', clients: 'client.export', journal: 'data', commissions: 'team', payroll: 'team' }[kind];
    if (!need) throw new HttpError(400, 'invalid', 'Export inconnu.');
    if (!r.caps.has(need)) throw new HttpError(403, 'forbidden', 'Tu n’as pas accès à cet export.');
    let body = '', name = kind + '-' + from + '-' + to, type = 'text/csv; charset=utf-8';
    const days = new Set(dayRange(from, to));
    if (kind === 'sales') {
      const rows = [['Ticket', 'Date', 'Heure', 'Client', 'Ligne', 'Type', 'Qté', 'PU TTC', 'Net TTC', 'TVA %', 'Barbier', 'Paiements', 'Pourboire']];
      for (const x of [...s.sales.values()].filter((x) => days.has(x.day)).sort((a, b) => a.number - b.number)) {
        const c = x.clientId ? s.clients.get(x.clientId) : null;
        const pays = x.payments.map((p) => (METHOD_LABEL[p.method] || p.method) + ' ' + eu(p.amount)).join(' + ');
        const at = new Date(x.at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
        x.lines.forEach((l, i) => rows.push([ticketNo(x.number), x.day, at, c ? c.first + ' ' + c.last : '', l.name, l.kind, l.qty, eu(l.unit), eu(l.net), l.vat / 100, (s.staff.get(l.staffId) || {}).name || '', i === 0 ? pays : '', i === 0 && x.tip ? eu(x.tip.amount) : '']));
      }
      for (const rf of [...s.refunds.values()].filter((x) => days.has(x.day))) rows.push([refundNo(rf.number), rf.day, '', '', 'Avoir sur ' + ticketNo(rf.saleNumber) + ' · ' + rf.reason, rf.liability ? (rf.liability === rf.amount ? 'avoir carte cadeau' : 'avoir dont carte cadeau ' + eu(rf.liability)) : 'avoir', 1, eu(-rf.amount), eu(-rf.amount), '', '', refundMethods(rf), '']);
      body = csv(rows);
    } else if (kind === 'vat' || kind === 'closures') {
      // the same layout as the screen and the printed Z: gross, refunds, net = HT + VAT, then money in by method
      const zs = [...s.closures.values()].filter((z) => days.has(z.day)).sort((a, b) => a.number - b.number).map((z) => ({ z, f: zFigures(z) }));
      // VAT columns: the shop's rates (default, catalog) and any found, so two exports keep the same columns
      const rates = [...new Set([s.settings.payments.vat, ...[...s.services.values(), ...s.products.values()].filter((x) => x.active).map((x) => x.vat),
        ...zs.flatMap(({ f }) => f.vatNet.map((v) => v.rate))].filter((x) => typeof x === 'number'))].sort((a, b) => b - a);
      const pct = (rate) => String(rate / 100).replace('.', ',') + ' %';
      const rows = [['Clôture', 'Jour', 'Type', 'Tickets', 'Premier', 'Dernier', 'CA TTC brut', 'Remboursements', 'CA TTC net', 'CA HT net', 'TVA nette',
        ...rates.map((rt) => 'TVA ' + pct(rt)), ...METHODS.map((m) => Z_CSV_METHOD[m]), 'Total des règlements', 'dont carte, espèces, en ligne', 'dont carte cadeau et acompte', 'Pourboires', 'Cartes cadeaux vendues', 'Grand total perpétuel', 'Sceau']];
      for (const { z, f } of zs) {
        const tax = f.vatNet.reduce((t, v) => t + v.tax, 0);
        rows.push([closureNo(z.number), z.day, z.auto ? 'automatique' : z.late ? 'rattrapage' : z.early ? 'en avance' : 'normale', z.tickets, z.first ? ticketNo(z.first) : '', z.last ? ticketNo(z.last) : '',
          eu(f.grossTtc), eu(-f.refundsTotal), eu(f.netTtc), eu(f.htNet), eu(tax), ...rates.map((rt) => eu((f.vatNet.find((v) => v.rate === rt) || { tax: 0 }).tax)),
          ...METHODS.map((m) => eu(f.paymentsNet[m] || 0)), eu(f.paidTotal), eu(f.takings), eu(f.prepaid), eu(f.tips), eu(f.giftcardsSold), eu(z.grandTotal), z.seal || '']);
      }
      body = csv(rows);
    } else if (kind === 'commissions') {
      // the Chiffre réalisé of each person (refunds deducted, carnet and membership cuts credited), on the salon's base
      const rep = report(s, { from, to, today: r.local.day, now: r.now });
      const rows = [rulesRow(s), ['Barbier', 'Réalisé TTC', 'Réalisé HT', 'Prestations TTC', 'Produits TTC', 'Taux prestations %', 'Taux produits %', 'Commission', 'Pourboires', 'Clients', 'Panier moyen', 'Passages']];
      for (const x of rep.staff) rows.push([x.name, eu(x.revenue), eu(x.revenueHT), eu(x.serviceRevenue), eu(x.productRevenue), x.rates.service / 100, x.rates.product / 100, eu(x.commission), eu(x.tips), x.clients, eu(x.avgTicket), x.walkins]);
      body = csv(rows);
    } else if (kind === 'payroll') {
      // one row per barber for the payroll provider: the month's statement of each (server/domain/statement.js)
      const month = r.query.get('month') || r.local.day.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'invalid', 'Mois attendu au format AAAA-MM.');
      if (month > r.local.day.slice(0, 7)) throw new HttpError(400, 'future', 'Ce mois n’a pas encore commencé.');
      const ids = [...s.staff.values()].filter((x) => x.chair && x.active).map((x) => x.id);
      const end = monthEnd(month + '-01');
      const rep = report(s, { from: month + '-01', to: end < r.local.day ? end : r.local.day, today: r.local.day, now: r.now });
      // anyone else something is credited to that month (a carnet sold under « pour qui vend », a barber gone since)
      for (const x of rep.staff) if (!ids.includes(x.id) && (x.revenue || x.tips || x.refunds)) ids.push(x.id);
      const all = ids.map((id) => staffStatement(s, id, month, r.local.day, r.now));
      const rows = [[...rulesRow(s), 'Mois : ' + monthWords(month) + (all.some((x) => x.provisional) ? ' (provisoire)' : '')],
        ['Barbier', 'Réalisé TTC', 'Réalisé HT', 'Commission', 'Pourboires carte', 'Pourboires espèces', 'Coupes carnet', 'Coupes abonnement', 'Remboursements déduits', 'Jours travaillés', 'Jours d’absence', 'Remarques']];
      for (const x of all) {
        const notes = [x.cuts.carnet.estimated ? 'dont ' + eu(x.cuts.carnet.estimated) + ' estimé (carnet repris)' : '', x.cuts.carnet.unpriced ? x.cuts.carnet.unpriced + ' coupe(s) de carnet repris sans prix au catalogue' : '', x.rewards.value ? 'coupes fidélité ' + eu(x.rewards.value) : ''].filter(Boolean).join(' · ');
        rows.push([x.staff.name, eu(x.performed), eu(x.performedHt), eu(x.commission), eu(x.tips.card), eu(x.tips.cash), eu(x.cuts.carnet.value), eu(x.cuts.member.value), eu(x.refunds), x.workedDays, x.absenceDays, notes]);
      }
      body = csv(rows);
      name = 'paie-' + month;
    } else if (kind === 'clients') {
      const rows = [['Prénom', 'Nom', 'Téléphone', 'E-mail', 'SMS', 'Marketing', 'Créé le', 'Notes']];
      for (const c of [...s.clients.values()].filter((c) => !c.erased && !c.mergedInto)) rows.push([c.first, c.last, fmtPhone(c.phone), c.email, c.sms ? 'oui' : 'non', c.marketing ? 'oui' : 'non', new Date(c.createdAt).toISOString().slice(0, 10), c.notes]);
      body = csv(rows);
      name = 'clients-' + r.local.day;
    } else {
      // the fiscal archive: every event without personal data, verifiable offline with the hashes
      type = 'application/json; charset=utf-8';
      body = JSON.stringify({ shop: s.settings.shop.name, exportedAt: new Date(r.now).toISOString(), head: s.head, version: s.version, events: r.rt.engine.journal.map(publicEvent) });
      name = 'journal-' + r.local.day;
    }
    return new Response(body, { status: 200, headers: { 'content-type': type, 'content-disposition': `attachment; filename="larchitecte-${name}.${type.startsWith('text/csv') ? 'csv' : 'json'}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }, { cap: 'report.own' });

  /* system */
  app.get('/api/v1/system', (r) => ({
    mode: r.s.mode, store: r.rt.store.kind, version: r.s.version, events: r.rt.engine.journal.length, head: r.s.head,
    payments: { provider: r.rt.pay.name, live: !!r.rt.pay.live }, sms: r.rt.sms ? r.rt.sms.name : null, warnings: [...r.rt.warnings, ...closingWarnings(r.s, r.local.day)], setupProtected: !!r.rt.cfg.setupToken,
    devices: [...r.s.devices.values()].filter((d) => !d.revoked).length
  }), { cap: 'settings' });

  /* encrypted backups (core/backup.js): the nightly ones in Blob, a download to keep elsewhere, one on demand */
  app.get('/api/v1/backups', (r) => backupStatus(r.rt), { cap: 'settings' });
  app.get('/api/v1/backups/latest', async (r) => {
    guard('backup-dl|' + r.me.id, 10, 10 * 60000);
    const file = (name, body) => new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="larchitecte-sauvegarde-${name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    // a demo never reads the Blob store (it may hold the real salon's files)
    const blob = backupOff(r.rt) ? null : backupsOf(r.rt);
    if (blob) {
      try {
        const last = ownBackups(await blob.listBackups(), salonOf(r.rt.engine.journal))[0];
        // streamed from Blob as is, unless the nightly ones stopped: then the salon as it is now
        const stored = last && r.rt.engine.clock() - last.at < STALE_MS ? await blob.getBackup(last.name) : null;
        if (stored && last) return file(last.name, stored.stream);
      } catch (err) { console.error('[lx] backup download', err && err.message); }
    }
    // nothing stored, too old, or Blob down: one sealed now, so the owner can always keep a copy
    const f = await freshBackup(r.rt);
    return file(f.day + '.json.gz.enc', f.body);
  }, { cap: 'settings' });
  app.post('/api/v1/backups/now', async (r) => {
    guard('backup-now|' + r.me.id, 4, 10 * 60000);
    return { item: await makeBackup(r.rt) };
  }, { cap: 'settings' });

  app.post('/api/v1/demo/reset', async (r) => {
    if (r.s.mode !== 'demo' || r.me.role !== 'owner') throw new HttpError(403, 'forbidden', 'Réservé au gérant, en démo.');
    guard('reset|' + r.ip, 3, 10 * 60000);
    const eng = r.rt.engine;
    await eng.reset();
    await eng.adopt(await buildDemoJournal(eng.clock(), { siteUrl: r.meta.siteUrl }));
    return { ok: true, version: eng.state.version };
  }, { cap: 'settings' });

  /** For platforms with a scheduler (Vercel Pro cron, GitHub Actions, cron-job.org). */
  app.get('/api/cron/tick', async (r) => {
    const auth = r.req.headers.get('authorization') || '';
    if (!r.rt.cfg.cronSecret || !safeEqual(auth, 'Bearer ' + r.rt.cfg.cronSecret)) throw new HttpError(401, 'unauthorized', 'Non autorisé.');
    await maybeTick(r.rt, r.meta, { force: true });
    // the external scheduler was seen (Réglages › Mise en route): the Comptoir's own pulse ticks too, so lastTick cannot tell
    // and how far apart its calls are (FID-01: the salon's phone needs one a minute, routes-health.js)
    if (r.rt.lastCron) r.rt.cronGap = Date.now() - r.rt.lastCron;
    r.rt.lastCron = Date.now();
    return { ok: true, version: r.s.version };
  }, { auth: false, csrf: false });
}
