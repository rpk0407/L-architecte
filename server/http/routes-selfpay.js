// @ts-check
// « Payer ma coupe » over HTTP (commands/selfpay.js says what the ticket is):
//  - the client's page (/r/…): what he owes (payView, read with the booking), POST …/checkout opens the provider's
//    page for that amount and his tip; once the money is in, settleSelfPay writes the till's ticket, or gives the money
//    back when the till got there first (cash taken meanwhile, the link withdrawn, the amount changed);
//  - the barber's till: POST …/pay-link keeps his ticket on the appointment and sends the link, DELETE takes it back.
import { HttpError, guard } from './kit.js';
import { payLive, startPayment, refundOnline, apptFromToken } from './routes-public.js';
import { selfQuote, selfPayOn, selfPayOpen, selfPaymentOf, groupToPay, requestSelfPay, cancelSelfPay, SELF_MIN, SELF_TIP_MAX, SELF_TIPS } from '../commands/selfpay.js';
import { paymentEnded } from '../commands/payments.js';
import * as S from '../commands/sales.js';
import { ticketNo } from '../domain/cash.js';
import { groupMembers, organiserOf, heldByOrganiser, personFirst } from '../domain/group.js';
import { providerFor } from '../payments/provider.js';

const SYSTEM = (r) => ({ actor: /** @type {const} */ ({ t: 'system', id: 'selfpay' }), caps: new Set(['sale.create']), meta: r.meta });
const refused = (e) => { const st = e && /** @type {any} */ (e).status; return Number.isInteger(st) && st >= 400 && st < 500; };

/** May this link pay for the whole group? The organiser's own link only, never a friend's. */
function organiserLink(r, a) {
  if (r.guestLink) return false;
  const members = groupMembers(r.s, a);
  return members.length > 1 && heldByOrganiser(r.s, a, organiserOf(r.s, members));
}

/** A ticket line as the client reads it: what it is, what he pays for it, its price when something else pays it. */
const lineView = (l) => ({ name: l.name, qty: l.qty, amount: l.net, ...(l.net < l.unit * l.qty || l.listPrice ? { was: (l.listPrice || l.unit) * l.qty } : {}) });

/**
 * What the booking's page says about paying: nothing (not today, not arrived, the salon keeps it off), « À régler »
 * with the amount the server computed, « rien à régler » when a carnet, a membership or a deposit covers the visit,
 * « Payé · merci » with the receipt once the ticket exists. A link never shows another person's ticket: the receipt
 * goes to the place the ticket was rung up on, a friend rung up on the organiser's ticket only reads « payé ».
 * @param {any} r @param {any} a
 */
export function payView(r, a) {
  const s = r.s;
  const py = selfPaymentOf(s, a);
  const sale = a.saleId ? s.sales.get(a.saleId) : null;
  // given back since: the till got there first, or the amount had changed
  const back = py && py.paidAt && !py.usedBy && (py.refunded || 0) > 0 ? { refunded: py.refunded } : {};
  if (sale) {
    const online = !!py && py.usedBy === sale.id;
    if (!online && a.day !== r.local.day) return null;
    const own = sale.apptId === a.id;
    return { pay: { state: 'paid', online, ...(own ? { total: sale.totals.due, ticket: ticketNo(sale.number), receipt: r.meta.receiptLink ? r.meta.receiptLink(sale) : null } : {}), ...back } };
  }
  if (!payLive(r) || !selfPayOpen(s, a, r.local)) return back.refunded ? { pay: { state: 'none', ...back } } : null;
  const guestOfSent = r.guestLink && a.pay && a.pay.ticket && (a.pay.ticket.groupApptIds || []).length;
  let q;
  try { if (!guestOfSent) q = selfQuote(s, a, { now: r.now, local: r.local }); } catch (e) { if (!refused(e)) throw e; }
  if (!q || q.base < 0 || (q.base > 0 && q.base < SELF_MIN)) return { pay: { state: 'desk', ...back } };
  const paid = q.deposits.reduce((t, d) => t + d.amount, 0);
  const view = {
    amount: q.base, lines: q.lines.map(lineView), total: q.totals.total, discount: q.totals.discount, deposit: paid,
    ...(q.group.length ? { groupOf: q.group.length + 1 } : {})
  };
  if (q.base === 0) return { pay: { state: 'covered', ...view, ...back } };
  // the organiser may pay for the friends who are here too, in one payment
  let group = null;
  if (!q.sent && organiserLink(r, a) && groupToPay(s, a).length) {
    try {
      const g = selfQuote(s, a, { now: r.now, local: r.local, group: true });
      const org = organiserOf(s, groupMembers(s, a));
      if (g.base >= SELF_MIN) group = { amount: g.base, n: g.group.length + 1, names: g.group.map((x) => personFirst(s, x, org)), lines: g.lines.map(lineView), deposit: g.deposits.reduce((t, d) => t + d.amount, 0) };
    } catch (e) { if (!refused(e)) throw e; }
  }
  const open = py && py.status === 'pending' && py.exp > r.now;
  return { pay: { state: 'due', ...view, tips: s.settings.payments.tips ? SELF_TIPS : null, tipMax: SELF_TIP_MAX, ...(open ? { paying: true } : {}), ...(group ? { group } : {}), ...back } };
}

/** Close a payment page of ours at the provider, when it can (Stripe expires its session); ours is already closed. */
async function closePage(r, p) {
  try { const prov = providerFor(r.rt, p.provider); if (prov.expireCheckout && p.providerRef) await prov.expireCheckout(p.providerRef); }
  catch (e) { console.warn('[lx] checkout page not closed at the provider', p.id, e && /** @type {any} */ (e).message); }
}

/**
 * The client's payment is in: the till's ticket is written (same numbering, same lines, « en ligne », his tip apart),
 * once. Called on every paid notice, so a notice sent twice, or again after a failure, ends the same way. The money
 * goes back by the usual refund when no ticket can take it: the salon rang him up meanwhile, the barber withdrew the
 * link, the appointment was cancelled, or the ticket no longer comes to what he paid.
 * @param {any} r @param {any} p the payment
 */
export async function settleSelfPay(r, p) {
  if (!p || p.kind !== 'qr' || !p.self || p.status !== 'paid' || p.usedBy) return null;
  const s = r.s;
  const a = p.apptId ? s.appts.get(p.apptId) : null;
  const back = async (why) => {
    const out = await refundOnline(r, p, why);
    if (!out.ok) console.error('[lx] self payment neither rung up nor refunded', p.id, why, out.error);
    return { refunded: out.ok, why };
  };
  if (p.endedAt) return back('Lien de paiement annulé au salon');
  if (!a || a.status === 'cancelled' || a.status === 'no_show') return back('Rendez-vous annulé');
  if (a.saleId) return back('Déjà encaissé au salon');
  let q;
  try { q = selfQuote(s, a, { now: r.now, local: r.local, tip: p.self.tip || 0, group: p.self.group || false }); }
  catch (e) { if (!refused(e)) throw e; return back('Ticket modifié avant le paiement'); }
  if (q.amount !== p.amount) return back('Montant modifié avant le paiement');
  try {
    const res = await r.rt.engine.run(S.checkout, { ...q.input, payments: [...q.deposits, { method: 'online', amount: p.amount, ref: p.id }] },
      { ...SYSTEM(r), staff: q.staff, caps: q.caps, requestId: 'selfpay:' + p.id });
    return { saleId: res.id };
  } catch (e) {
    if (!refused(e)) throw e;
    console.warn('[lx] self payment not rung up', p.id, /** @type {any} */ (e).code, /** @type {any} */ (e).message);
    return back(/** @type {any} */ (e).code === 'paid' || /** @type {any} */ (e).code === 'paid_online' ? 'Déjà encaissé au salon' : 'Ticket refusé par la caisse');
  }
}

export function selfPayRoutes(app) {
  /**
   * « Payer maintenant »: { expect, tip, group }. expect is the amount the page showed (without the tip): when the
   * ticket changed meanwhile (a product added by the barber), nothing opens and the page reloads. A second tap gets the
   * page already open; another tip closes it and opens a new one.
   */
  app.post('/api/public/bookings/:token/checkout', async (r) => {
    guard('selfpay|' + r.ip, 12, 60000);
    const a = apptFromToken(r);
    const s = r.s, b = r.body || {};
    if (a.saleId) throw new HttpError(409, 'paid', 'C’est déjà réglé. Merci !');
    if (!payLive(r) || !selfPayOn(s)) throw new HttpError(409, 'off', 'Le paiement en ligne n’est pas disponible : règle au salon.');
    if (!selfPayOpen(s, a, r.local)) throw new HttpError(409, 'not_open', 'Ce rendez-vous se règle au salon, le jour de ta visite.');
    const tip = b.tip == null ? 0 : Number(b.tip);
    if (!Number.isInteger(tip) || tip < 0 || tip > SELF_TIP_MAX) throw new HttpError(400, 'invalid', 'Pourboire invalide.');
    if (tip && !s.settings.payments.tips) throw new HttpError(409, 'off', 'Le salon ne prend pas de pourboire en ligne.');
    const sent = !!(a.pay && a.pay.ticket);
    if (r.guestLink && sent && (a.pay.ticket.groupApptIds || []).length) throw new HttpError(409, 'not_open', 'Ce ticket se règle au salon.');
    const group = b.group === true && !sent;
    if (group && !organiserLink(r, a)) throw new HttpError(403, 'forbidden', 'Seul l’organisateur peut régler pour le groupe.');
    let q;
    try { q = selfQuote(s, a, { now: r.now, local: r.local, tip, group }); }
    catch (e) { if (!refused(e)) throw e; throw new HttpError(409, 'not_open', 'Ce ticket se règle au salon.'); }
    if (Number(b.expect) !== q.base) throw new HttpError(409, 'changed', 'Le montant a changé, recharge la page.', { amount: q.base });
    if (q.base < SELF_MIN) throw new HttpError(409, 'nothing', 'Rien à régler en ligne pour ce rendez-vous.');
    const ids = q.group.map((g) => g.id);
    const cur = selfPaymentOf(s, a);
    if (cur && cur.status === 'pending') {
      const same = cur.amount === q.amount && (cur.self.tip || 0) === q.tip && (cur.self.group || []).join() === (q.sent ? [] : ids).join();
      if (same && cur.exp > r.now + 120000) return { url: cur.url };
      await r.rt.engine.run(paymentEnded, { id: cur.id, status: 'expired', reason: 'Remplacé par un autre paiement' }, SYSTEM(r));
      await closePage(r, cur);
    }
    const label = ('Ta coupe · ' + a.services.map((x) => x.name).join(' + ') + (q.group.length ? ' · groupe de ' + (q.group.length + 1) : '')).slice(0, 80);
    const p = await startPayment(r, { kind: 'qr', amount: q.amount, label, apptId: a.id, returnPath: '/r/' + r.params.token, self: { tip: q.tip, ...(!q.sent && ids.length ? { group: ids } : {}) } });
    return { url: p.url };
  });

  /** The barber's till sends the link: its ticket is checked and kept, the text leaves by the salon's channel. */
  app.post('/api/v1/appointments/:id/pay-link', async (r) => {
    r.meta.payLive = payLive(r);
    const b = r.body || {};
    const out = await r.run(requestSelfPay, { id: r.params.id, ticket: b.ticket, phone: b.phone === true, send: b.send !== false });
    const a = r.s.appts.get(r.params.id);
    // the page's address, for the till to show as a QR code when no text can leave
    return { ...out, url: r.meta.linkFor(a) + '?payer' };
  }, { cap: 'sale.create' });

  /** « Annuler et encaisser autrement » */
  app.del('/api/v1/appointments/:id/pay-link', async (r) => {
    const out = await r.run(cancelSelfPay, { id: r.params.id });
    if (out.payment) await closePage(r, out.payment);
    return { ok: true };
  }, { cap: 'sale.create' });
}
