// @ts-check
// Online payments seen from both ends: the provider's notices (POST /api/pay/:provider/webhook, and the older
// /api/stripe/webhook Stripe endpoints already point at), what the Comptoir shows of them (Caisse › En ligne: what
// to handle, the payments with their fees, the payouts), a dispute's dossier, and the till's online refund.
import { HttpError } from './kit.js';
import { HANDLERS } from '../payments/handlers.js';
import { providerFor, providerLabel, moneyMode } from '../payments/provider.js';
import { outsideOpen, providerKnown, booked } from '../projections/payments.js';
import { refundOnline } from './routes-public.js';
import { fulfilGiftcard } from './routes-giftshop.js';
import { paymentRefundedOutside } from '../commands/payments.js';
import * as S from '../commands/sales.js';
import { ticketNo, refundNo, METHOD_LABEL } from '../domain/cash.js';
import { localParts, dayLong, hhmm } from '../../shared/dates.js';
import { fmtEur } from '../../shared/money.js';

const DAY = 86400000;
/** Stripe's dispute reasons, as the owner reads them */
export const DISPUTE_REASON = {
  fraudulent: 'fraude déclarée par la banque', unrecognized: 'paiement non reconnu', duplicate: 'paiement en double', product_not_received: 'prestation non reçue',
  product_unacceptable: 'prestation contestée', credit_not_processed: 'remboursement non reçu', subscription_canceled: 'abonnement résilié', general: 'motif général'
};
const eu = (c) => fmtEur(c, { decimals: true });
/** A replayed request (its x-request-id) whose first command is written: its answer comes before any check that
 *  this very write would now fail (http/app.js r.run keys a handler's first command by the request id). */
const replayed = (r) => { const rq = r.req && r.req.headers.get('x-request-id'); return !!rq && r.rt.engine.knows({ t: 'staff', id: r.me.id }, rq) === 'answered'; };
const when = (ms) => { const p = localParts(ms); return p.day.split('-').reverse().join('/') + ' à ' + hhmm(p.min); };

/* ---------------- the provider's notices ---------------- */

/**
 * One notice: parsed and checked by the provider plugged in (another name has no endpoint here), then handled by
 * its kind (payments/handlers.js). A refusal of ours (unknown payment, amount differs) is logged and answered 200
 * { ignored }, so the provider stops sending it for days; a store or network failure answers 5xx, and it retries.
 */
async function webhook(r, name) {
  const prov = r.rt.pay;
  if (!prov || prov.name !== name || prov.name === 'simulated') throw new HttpError(404, 'not_found', 'Indisponible.');
  const ev = prov.parseWebhook(r.raw, r.req.headers.get(prov.sigHeader || 'stripe-signature'));
  if (!ev) return { received: true };
  if (!Object.hasOwn(HANDLERS, ev.kind)) return { received: true, ignored: 'kind' };
  try {
    const out = await HANDLERS[ev.kind](r, ev);
    return out && out.ignored ? { received: true, ignored: out.ignored } : { received: true };
  } catch (e) {
    const st = e && /** @type {any} */ (e).status;
    if (!(Number.isInteger(st) && st >= 400 && st < 500)) throw e;
    console.warn('[lx] webhook ignored', name, ev.kind, ev.ref, /** @type {any} */ (e).code, /** @type {any} */ (e).message);
    return { received: true, ignored: /** @type {any} */ (e).code || 'refused' };
  }
}

/* ---------------- the till's online refund ---------------- */

/**
 * A credit note paid back on the ticket's online payment. Every rule of the credit note runs before any money moves.
 * What the provider already gave back without one (its dashboard, outsideOpen) is not refunded again: the credit note
 * only records it, as does `outside: true` (« remboursé hors caisse »: the provider no longer plugged in, or a refund
 * made in its dashboard whose notice never came), up to what no credit note has recorded yet. If the credit note
 * fails after the provider refunded, the refund is recorded as made outside, so it shows in Caisse.
 * A replayed request (same x-request-id) gets its first answer and moves no money: the provider's key is the
 * request's, so even a replay reaching another instance before it knows of the credit note is one refund at the provider.
 * @param {any} r @param {any} sale @param {any} body
 */
export async function tillRefund(r, sale, body) {
  if (body.method !== 'online') return r.run(S.refund, { ...body, saleId: sale.id, providerRef: undefined });
  const rq = (r.req && r.req.headers.get('x-request-id')) || '';
  if (replayed(r)) return r.run(S.refund, { ...body, saleId: sale.id });
  S.checkRefund(r.s, { ...body, saleId: sale.id }, { local: r.local, actor: { t: 'staff' }, staff: r.me });
  const pay = sale.payments.map((p) => p.paymentId && r.s.payments.get(p.paymentId)).find((p) => p && p.status === 'paid');
  if (!pay) throw new HttpError(400, 'invalid', 'Aucun paiement en ligne à rembourser sur ce ticket.');
  if (body.amount > pay.amount) throw new HttpError(400, 'invalid', 'Le remboursement en ligne ne peut dépasser ' + fmtEur(pay.amount) + '.');
  const known = providerKnown(r.s, pay);
  if (body.outside === true && body.amount > pay.amount - booked(r.s, pay)) throw new HttpError(400, 'invalid', 'Au plus ' + fmtEur(Math.max(0, pay.amount - booked(r.s, pay))) + ' à enregistrer en « remboursé hors caisse » sur ce paiement en ligne.');
  const already = body.outside === true ? body.amount : Math.min(body.amount, outsideOpen(r.s, pay));
  const part = body.amount - already;
  let providerRef = 'outside';
  if (part > 0) {
    if (part > pay.amount - known) throw new HttpError(400, 'invalid', 'Au plus ' + fmtEur(pay.amount - known) + ' à rembourser sur ce paiement en ligne.');
    const prov = providerFor(r.rt, pay.provider);
    try {
      const charge = pay.chargeRef || (prov.name === 'simulated' ? pay.providerRef : (await prov.retrieveCharge(pay.providerRef)).chargeRef);
      if (!charge) throw new HttpError(409, 'no_charge', 'Paiement introuvable chez ' + providerLabel(prov.name) + ' : rembourse-le depuis son tableau de bord, puis fais l’avoir en « remboursé hors caisse ».');
      providerRef = (await prov.refund(charge, part, sale.id + '-' + (rq ? 'rq-' + rq : sale.refundIds.length))).ref;
    } catch (e) {
      const x = /** @type {any} */ (e);
      // the staff may read the provider's own words; a client never does. A refused refund is not a refused card
      if (x && x.code === 'declined') throw new HttpError(402, 'declined', 'Remboursement refusé par ' + providerLabel(prov.name) + ' : ' + (x.detail || 'sans motif'));
      throw x && x.detail ? new HttpError(x.status || 502, x.code || 'provider', x.message + ' (' + providerLabel(prov.name) + ' : ' + x.detail + ')') : e;
    }
  }
  try {
    return await r.run(S.refund, { ...body, saleId: sale.id, providerRef });
  } catch (e) {
    if (part > 0) {
      try { await r.run(paymentRefundedOutside, { id: pay.id, total: known + part, providerRefund: providerRef }); }
      catch (e2) { console.error('[lx] online refund not recorded', pay.id, e2 && /** @type {any} */ (e2).message); }
    }
    throw e;
  }
}

/* ---------------- what the Comptoir shows ---------------- */

/** A payment's state in one word for the list. */
function rowStatus(s, p) {
  const d = p.disputeId ? s.disputes.get(p.disputeId) : null;
  if (d && d.status === 'open') return 'disputed';
  if (d && d.status === 'lost') return 'dispute_lost';
  if (p.status === 'refunded') return 'refunded';
  // credit notes leave the payment 'paid': all of it given back is refunded all the same
  const back = providerKnown(s, p);
  if (back >= p.amount) return 'refunded';
  if (back > 0) return 'partial';
  return p.usedBy ? 'used' : 'paid';
}

/**
 * Paid, on no ticket, for more than a day, and not waiting for its visit: money in that the books do not see yet.
 * A deposit waits for its appointment's day; a card guarantee holds no money.
 */
function unused(s, p, now, today) {
  if (p.status !== 'paid' || p.usedBy || p.kind === 'guarantee' || !p.paidAt || now - p.paidAt < DAY) return false;
  const a = p.apptId ? s.appts.get(p.apptId) : null;
  return !(p.kind === 'deposit' && a && a.day >= today && !['cancelled', 'no_show'].includes(a.status));
}

/** Whom and which visit a payment is about, so the owner knows the line without opening the dossier: a first name. */
function about(s, p) {
  const a = p && p.apptId ? s.appts.get(p.apptId) : null;
  const c = a && a.clientId ? s.clients.get(a.clientId) : p && p.cid ? s.clients.get(p.cid) : null;
  return { first: c && !c.erased ? c.first : a && a.name ? String(a.name).split(' ')[0] : '', day: a ? a.day : null, apptId: a ? a.id : null };
}

function todo(r) {
  const s = r.s, out = [];
  for (const d of s.disputes.values()) {
    if (d.status !== 'open') continue;
    const p = s.payments.get(d.pid);
    out.push({ kind: 'dispute', id: d.id, paymentId: d.pid, amount: d.amount, reason: DISPUTE_REASON[d.reason] || d.reason || '', dueBy: d.dueBy || null, label: p ? p.label : '', payKind: p ? p.kind : '', ...about(s, p) });
  }
  for (const p of s.payments.values()) {
    const open = p.usedBy ? outsideOpen(s, p) : 0;
    const sale = p.usedBy ? s.sales.get(p.usedBy) : null;
    if (open > 0 && sale) out.push({ kind: 'outside', id: 'out_' + p.id, paymentId: p.id, amount: open, saleId: sale.id, ticket: ticketNo(sale.number), day: sale.day, label: p.label, payKind: p.kind, at: p.outsideAt || 0 });
    else if (unused(s, p, r.now, r.local.day)) {
      const a = p.apptId ? s.appts.get(p.apptId) : null;
      // cancelled: by whom, and late or not, tells a deposit kept (a late call) from one whose refund failed
      out.push({ kind: 'unused', id: 'un_' + p.id, paymentId: p.id, amount: p.amount, paidAt: p.paidAt, label: p.label, payKind: p.kind, apptStatus: a ? a.status : null, cancelBy: a && a.cancel ? a.cancel.by : null, ...about(s, p) });
    }
  }
  // the most urgent first: a dispute's answer date, then the oldest money
  const key = (x) => (x.kind === 'dispute' ? (x.dueBy || 0) : 1e15 + (x.paidAt || x.at || 0));
  return out.sort((a, b) => key(a) - key(b)).slice(0, 50);
}

/**
 * A dispute's dossier, in plain French, from the journal: what the owner pastes in the provider's dashboard. The
 * booking (when, from where, the CGV accepted), the texts it sent (status, time), what happened on the day, the ticket.
 * The client's first name and initial only: no number, no e-mail.
 */
function dossier(r, p) {
  const s = r.s;
  const sh = s.settings.shop;
  const a = p.apptId ? s.appts.get(p.apptId) : null;
  const c = a && a.clientId ? s.clients.get(a.clientId) : p.cid ? s.clients.get(p.cid) : null;
  const sale = p.usedBy ? s.sales.get(p.usedBy) : null;
  const d = p.disputeId ? s.disputes.get(p.disputeId) : null;
  const L = [];
  L.push('Dossier de paiement · ' + sh.name + (sh.legalName && sh.legalName !== sh.name ? ' (' + sh.legalName + ')' : '') + ', ' + sh.address + ', ' + sh.zip + ' ' + sh.city + (sh.siret ? ' · SIRET ' + sh.siret : ''));
  L.push('');
  L.push('Paiement : ' + (p.label || p.kind) + ' · ' + eu(p.amount) + ' · réglé le ' + (p.paidAt ? when(p.paidAt) : '—') + ' sur la page de paiement ' + providerLabel(p.provider) + (p.chargeRef ? ' (' + p.chargeRef + ')' : ''));
  if (d) L.push('Litige : ' + d.id + ' · ' + eu(d.amount) + ' · ' + (DISPUTE_REASON[d.reason] || d.reason || 'sans motif') + (d.dueBy ? ' · réponse avant le ' + when(d.dueBy) : ''));
  if (c && !c.erased) L.push('Client : ' + c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : ''));
  if (a) {
    const SRC = { site: 'sur le site du salon', phone: 'par téléphone', salon: 'au salon', walkin: 'sans rendez-vous, au salon', import: 'sur l’ancien site du salon' };
    const st = s.staff.get(a.staffId);
    L.push('');
    L.push('Réservation : faite le ' + when(a.createdAt) + ' ' + (SRC[a.source] || 'au salon') + '.');
    L.push('Rendez-vous : ' + dayLong(a.day) + ' à ' + hhmm(a.start) + (st ? ' avec ' + st.name : '') + ' · ' + a.services.map((x) => x.name).join(' + ') + ' (' + eu(a.price) + ').');
    // what happened, from the journal: the CGV version the booking recorded (not kept in the projection), moves,
    // confirmations, arrival, the chair, the end, a cancellation
    const STEP = { arrived: 'arrivé au salon', in_chair: 'installé au fauteuil', done: 'prestation terminée', no_show: 'ne s’est pas présenté', booked: 'à venir', pending: 'en attente de l’acompte' };
    const steps = [];
    let cgv = '';
    for (const e of r.rt.engine.journal) {
      if (!e.data || e.data.id !== a.id) continue;
      if (e.type === 'appt.booked' && typeof e.data.cgv === 'string') cgv = e.data.cgv;
      else if (e.type === 'appt.moved') steps.push('- ' + when(e.at) + ' · déplacé au ' + dayLong(e.data.day) + ' à ' + hhmm(e.data.start));
      else if (e.type === 'appt.confirmed') steps.push('- ' + when(e.at) + ' · confirmé (acompte reçu)');
      else if (e.type === 'appt.status') steps.push('- ' + when(e.at) + ' · ' + (STEP[e.data.status] || e.data.status));
      else if (e.type === 'appt.cancelled') steps.push('- ' + when(e.at) + ' · annulé ' + (e.data.by === 'client' ? 'par le client' : e.data.by === 'system' ? 'automatiquement' : 'par le salon') + (e.data.late ? ' (hors délai)' : ''));
    }
    if (cgv) L.push('Conditions générales de vente acceptées à la réservation : version du ' + cgv.split('-').reverse().join('/') + ' (' + r.origin + '/cgv).');
    if (a.deposit && a.deposit.amount) L.push('Acompte demandé : ' + eu(a.deposit.amount) + ', déduit du prix le jour du rendez-vous.');
    const TPL = { confirmation: 'confirmation du rendez-vous', reminder: 'rappel la veille', reminder2h: 'rappel le jour même', cancelled: 'annulation', receipt: 'reçu', reassign: 'changement de barbier', reassignAt: 'changement d’horaire', reschedule: 'demande de décalage', review: 'demande d’avis' };
    const ST = { sent: 'envoyé', simulated: 'envoyé', claimed: 'en cours d’envoi', queued: 'en attente', failed: 'échec', expired: 'non envoyé', skipped: 'non envoyé' };
    const msgs = [...s.messages.values()].filter((m) => m.apptId === a.id).sort((x, y) => x.at - y.at);
    if (msgs.length) {
      L.push('');
      L.push('Messages au client :');
      for (const m of msgs) L.push('- ' + when(m.sentAt || m.at) + ' · ' + (m.channel === 'email' ? 'e-mail' : m.channel === 'whatsapp' ? 'WhatsApp' : 'SMS') + ' de ' + (TPL[m.template] || m.template) + ' · ' + (ST[m.status] || m.status));
    }
    if (sale) steps.push('- ' + when(sale.at) + ' · encaissé, ticket ' + ticketNo(sale.number));
    if (steps.length) { L.push(''); L.push('Suivi du rendez-vous :'); L.push(...steps); }
  }
  if (sale) {
    L.push('');
    L.push('Ticket ' + ticketNo(sale.number) + ' du ' + sale.day.split('-').reverse().join('/') + ' :');
    for (const l of sale.lines) L.push('- ' + (l.qty > 1 ? l.qty + ' × ' : '') + l.name + ' · ' + eu(l.net));
    L.push('Réglé : ' + sale.payments.map((x) => (METHOD_LABEL[x.method] || x.method) + ' ' + eu(x.amount)).join(', ') + '.');
    for (const id of sale.refundIds || []) { const rf = s.refunds.get(id); if (rf) L.push('Avoir ' + refundNo(rf.number) + ' du ' + rf.day.split('-').reverse().join('/') + ' : ' + eu(rf.amount) + ' (' + (METHOD_LABEL[rf.method] || rf.method) + ').'); }
  }
  const back = providerKnown(s, p);
  if (back) { L.push(''); L.push('Déjà remboursé au client : ' + eu(back) + '.'); }
  return L.join('\n');
}

export function paymentRoutes(app) {
  app.post('/api/pay/:provider/webhook', (r) => webhook(r, r.params.provider), { raw: true, csrf: false });
  // the address declared at Stripe before PAY-01: the same handler
  app.post('/api/stripe/webhook', (r) => webhook(r, 'stripe'), { raw: true, csrf: false });

  app.get('/api/v1/payments/online', (r) => {
    const s = r.s;
    const days = Math.max(1, Math.min(90, Number(r.query.get('days')) || 30));
    const since = r.now - days * DAY;
    const payments = [...s.payments.values()].filter((p) => p.paidAt && p.paidAt >= since).sort((a, b) => b.paidAt - a.paidAt).slice(0, 300).map((p) => {
      const sale = p.usedBy ? s.sales.get(p.usedBy) : null;
      const a = p.apptId ? s.appts.get(p.apptId) : null;
      return {
        id: p.id, at: p.paidAt, kind: p.kind, label: p.label, amount: p.amount, fee: p.fee ?? null, net: p.net ?? null, refunded: providerKnown(s, p),
        status: rowStatus(s, p), provider: p.provider, saleId: sale ? sale.id : null, ticket: sale ? ticketNo(sale.number) : null, saleDay: sale ? sale.day : null, apptId: a ? a.id : null, day: a ? a.day : null
      };
    });
    const payouts = [...s.payouts.values()].filter((x) => (x.arrival || x.at) >= since).sort((a, b) => (b.arrival || b.at) - (a.arrival || a.at)).slice(0, 60)
      .map((x) => ({ id: x.id, arrival: x.arrival || null, at: x.at, amount: x.amount, gross: x.gross, fee: x.fee, count: x.count }));
    return { mode: moneyMode(r), provider: r.rt.pay.name, days, todo: todo(r), payments, payouts };
  }, { cap: 'sale.all' });

  /**
   * A deposit whose visit will not happen (cancelled, no-show), paid and on no ticket: kept as the salon's (a ticket
   * of one « Acompte conservé » line paid by it: the day's revenue at the salon's VAT, the money already in online)
   * or given back. PAY-06a's no-show card does the same from the agenda later. Idempotent: a deposit on a ticket or
   * refunded is not kept or refunded again, and a replay gets the first answer (the request id).
   */
  const settle = (r) => {
    const p = r.s.payments.get(r.params.id);
    const a = p && p.apptId ? r.s.appts.get(p.apptId) : null;
    if (!p || p.status !== 'paid' || p.usedBy) throw new HttpError(409, 'settled', 'Cet acompte est déjà encaissé ou remboursé.');
    if (p.kind !== 'deposit' || !a || !['cancelled', 'no_show'].includes(a.status)) throw new HttpError(409, 'invalid', 'Cet acompte attend encore son rendez-vous : encaisse-le sur son ticket.');
    return { p, a };
  };
  app.post('/api/v1/payments/:id/keep', (r) => {
    if (replayed(r)) return r.run(S.checkout, {});
    const { p, a } = settle(r);
    const name = 'Acompte conservé · ' + (a.status === 'no_show' ? 'absence' : 'annulation') + ' du ' + a.day.split('-').reverse().slice(0, 2).join('/');
    return r.run(S.checkout, { ...(a.clientId ? { clientId: a.clientId } : {}), lines: [{ kind: 'fee', name, unit: p.amount }], payments: [{ method: 'online', amount: p.amount, ref: p.id }] });
  }, { cap: 'sale.refund' });
  app.post('/api/v1/payments/:id/refund', async (r) => {
    const { p } = settle(r);
    const back = await refundOnline(r, p, 'Remboursé depuis la Caisse');
    if (!back.ok) throw new HttpError(502, 'provider', 'Acompte non remboursé chez ' + providerLabel(p.provider) + ' : ' + (back.error || 'erreur'));
    return { ok: true };
  }, { cap: 'sale.refund' });
  // a gift card paid online whose card was not issued (its confirmation's hook failed): issued now
  app.post('/api/v1/payments/:id/issue', async (r) => {
    const p = r.s.payments.get(r.params.id);
    if (!p || p.kind !== 'giftcard' || p.status !== 'paid') throw new HttpError(404, 'not_found', 'Carte cadeau introuvable.');
    const out = await fulfilGiftcard(r, p);
    if (!out) throw new HttpError(409, 'not_issued', 'La carte n’a pas pu être émise : réessaie dans un instant.');
    return { ok: true, saleId: out.saleId || null };
  }, { cap: 'sale.all' });

  app.get('/api/v1/payments/:id/evidence', (r) => {
    const p = r.s.payments.get(r.params.id);
    if (!p || !p.paidAt) throw new HttpError(404, 'not_found', 'Paiement introuvable.');
    return { id: p.id, text: dossier(r, p) };
  }, { cap: 'sale.refund' });
}
