// @ts-check
// « Payer ma coupe »: the client pays his cut himself, on his own page (/r/…), once he is at the salon. Nothing new
// in the books: the payment is the QR one (kind 'qr', method « en ligne »), the ticket is the till's own (commands/
// sales.js checkout, same numbering, same lines, the tip apart). This file says what that ticket is and what it
// comes to, so the page, the payment link and the ticket written once the money is in all read one source:
//  - the barber's ticket when he sent the link from his till (a product added, a discount: kept on the appointment),
//  - otherwise the ticket the till opens by default (the booked services, his carnet or membership, his deposit).
import { fail } from '../core/engine.js';
import { getAppt } from './common.js';
import { quoteCheckout, DISCOUNT_REASONS } from './sales.js';
import { str, int, bool, opt, obj, arr, id, oneOf, money, parse } from '../lib/validate.js';
import { capsOf } from '../domain/permissions.js';
import { formuleOfAppt, paidOnline, payState, packCover } from '../domain/formule.js';
import { membersOf, isLive, graceOf, cover } from '../domain/membership.js';
import { groupMembers, groupIdOf } from '../domain/group.js';
import { queueMessage, messageId } from '../domain/messages.js';
import { isEmail } from '../lib/util.js';

/** The least a checkout page takes (the provider's own floor). */
export const SELF_MIN = 50;
/** The most a client tips from his page. */
export const SELF_TIP_MAX = 5000;
/** The tips the page offers: « aucun · 2 € · 5 € · autre ». */
export const SELF_TIPS = [200, 500];
/** Payment links a barber may send for one appointment. */
export const PAY_LINKS_MAX = 3;
// GSM alphabet (è is in it), one SMS with the link
export const PAY_LINK_TEXT = "L'Architecte : {prenom}, règle ta coupe en ligne ({montant}), carte ou Apple Pay : {lien}";

export const selfPayOn = (s) => !!(s.settings.payments && s.settings.payments.selfPay);
/** The latest payment page the client opened for this appointment (core/state.js keeps its id), or null. */
export const selfPaymentOf = (s, a) => (a && a.payId ? s.payments.get(a.payId) || null : null);
const present = (a) => a.status === 'arrived' || a.status === 'in_chair';

/**
 * May this appointment be paid by its client now? Today, not rung up, the day not sealed, and the client at the salon
 * (arrived or in the chair), or the barber sent him the link himself.
 * @param {any} s @param {any} a @param {{ day: string }} local
 */
export function selfPayOpen(s, a, local) {
  if (!selfPayOn(s) || !a || a.saleId || a.legacy || a.day !== local.day || s.closures.has(local.day)) return false;
  return present(a) || (!!a.pay && a.status === 'booked');
}

/** What the till and the agenda say of it: the link is out, the client is on the payment page, or he paid online. */
export function payBrief(s, a, now) {
  const py = selfPaymentOf(s, a);
  if (a.saleId) return py && py.usedBy === a.saleId ? { paidOnline: true } : {};
  const paying = !!py && py.status === 'pending' && py.exp > now;
  if (!paying && !a.pay) return {};
  return { onlinePay: { state: paying ? 'paying' : 'sent', due: paying ? py.amount : a.pay.due, at: paying ? py.createdAt : a.pay.at } };
}

/** A deposit paid online and on no ticket yet, as the till puts it on the ticket. */
function depositOf(s, a) {
  const py = a.deposit && a.deposit.paid && a.deposit.paymentId ? s.payments.get(a.deposit.paymentId) : null;
  return py && py.status === 'paid' && !py.usedBy ? { method: 'deposit', amount: py.amount, ref: py.id } : null;
}

/** The other places of his group the organiser may pay with his own: here today, not rung up. */
export function groupToPay(s, a) {
  if (!groupIdOf(a)) return [];
  return groupMembers(s, a).filter((g) => g.id !== a.id && g.day === a.day && !g.saleId && present(g));
}

/**
 * The ticket the till opens for this appointment (Checkout.tsx does the same on the barber's screen): each booked
 * service at its barber, the weekly carnet it starts sold on it, a carnet's or the membership's cut covered.
 * @param {any} s @param {any} a @param {string} day @param {any[]} others the group places paid with it
 */
function defaultTicket(s, a, day, others) {
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  /** @type {any[]} */
  let lines = a.services.map((v) => ({ kind: 'service', ref: v.id, staffId: a.staffId }));
  const f = formuleOfAppt(s, a.id);
  const fsv = f ? s.services.get(f.serviceId) : null;
  const sell = f && !f.packId && fsv && fsv.active && fsv.pack ? fsv : null;
  const cut = sell ? lines.find((l) => !(sell.pack.serviceIds || []).length || sell.pack.serviceIds.includes(l.ref)) : null;
  if (sell && cut) {
    cut.packId = 'new';
    lines = [{ kind: 'pack', ref: sell.id, staffId: a.staffId }, ...lines];
  } else if (c) {
    const packs = [...s.packs.values()].filter((k) => k.clientId === c.id && !k.voided && k.expires >= day);
    const left = new Map(packs.map((k) => [k.id, k.total - k.used]));
    const fits = (k, l) => (left.get(k.id) || 0) > 0 && (!packCover(s, k).ids.length || packCover(s, k).ids.includes(l.ref));
    for (const l of lines) {
      const pk = (f && f.packId ? packs.find((k) => k.id === f.packId && fits(k, l)) : null) || packs.find((k) => fits(k, l));
      if (pk) { l.packId = pk.id; left.set(pk.id, /** @type {number} */ (left.get(pk.id)) - 1); }
    }
    // the membership pays a covered cut before any carnet, in the order of the ticket
    const m = membersOf(s, c.id).find((x) => isLive(x, day, graceOf(s)));
    let covered = 0;
    if (m) for (const l of lines) {
      if (l.kind !== 'service') continue;
      if (cover(s, m, l.ref, { day, pending: covered }).ok) { covered++; l.memberId = m.id; delete l.packId; }
    }
  }
  for (const g of others) for (const v of g.services) lines.push({ kind: 'service', ref: v.id, staffId: g.staffId });
  return { lines, ...(others.length ? { groupApptIds: others.map((g) => g.id) } : {}) };
}

/**
 * What the client owes for this appointment, and the ticket it will be: the till's own rules (quoteCheckout), run as
 * the barber who prepared it (his prices, his discount cap) or as the system for the default ticket. Throws the
 * till's own refusal when that ticket cannot be rung up.
 * @param {any} s @param {any} a
 * @param {{ now: number, local: any, tip?: number, group?: boolean|string[] }} o group: the organiser pays the places
 *   of his group that are here (true), or exactly these ones (the ids kept on a payment)
 * @returns {{ input: any, deposits: any[], lines: any[], totals: any, amount: number, base: number, tip: number, staff: any, caps: Set<string>, sent: boolean, group: any[] }}
 */
export function selfQuote(s, a, o) {
  const sent = !!(a.pay && a.pay.ticket);
  const staff = sent ? s.staff.get(a.pay.by) || null : null;
  const caps = new Set([...(staff ? capsOf(staff, s.settings) : []), 'sale.create']);
  let others = [];
  if (sent) others = (a.pay.ticket.groupApptIds || []).map((i) => s.appts.get(i)).filter(Boolean);
  else if (o.group) others = groupToPay(s, a).filter((g) => o.group === true || /** @type {string[]} */ (o.group).includes(g.id));
  if (Array.isArray(o.group) && !sent && others.length !== o.group.length) fail(409, 'changed', 'Le groupe a changé.');
  const ticket = sent ? a.pay.ticket : defaultTicket(s, a, o.local.day, others);
  const tip = s.settings.payments.tips && o.tip ? o.tip : 0;
  const input = { apptId: a.id, lines: ticket.lines, ...(ticket.discount ? { discount: ticket.discount } : {}), ...(ticket.groupApptIds && ticket.groupApptIds.length ? { groupApptIds: ticket.groupApptIds } : {}), ...(tip ? { tip: { amount: tip, staffId: a.staffId } } : {}), online: true };
  const ctx = {
    now: o.now, local: o.local, actor: /** @type {const} */ ({ t: 'system', id: 'selfpay' }), staff, caps, meta: {}, drafts: [],
    emit() { /* a quote writes nothing */ }, id: (/** @type {string} */ p) => p + '_quote', token: () => '', code: () => '',
    can: (/** @type {string} */ c) => caps.has(c), need(/** @type {string} */ c) { if (!caps.has(c)) fail(403, 'forbidden', 'Tu n’as pas accès à cette action.'); }
  };
  const q = quoteCheckout(s, input, /** @type {any} */ (ctx));
  // the deposits already paid online: his own (or his carnet's price paid on the site), and each group place's
  const deposits = [];
  const own = depositOf(s, a);
  const f = formuleOfAppt(s, a.id);
  const fpaid = !own && f && !f.packId && payState(s, f) === 'online' && ticket.lines.some((/** @type {any} */ l) => l.kind === 'pack') ? paidOnline(s, f) : null;
  if (own) deposits.push(own); else if (fpaid) deposits.push({ method: 'deposit', amount: fpaid.amount, ref: fpaid.paymentId });
  for (const g of others) { const d = depositOf(s, g); if (d) deposits.push(d); }
  const amount = q.totals.due - deposits.reduce((t, d) => t + d.amount, 0);
  return { input, deposits, lines: q.lines, totals: q.totals, amount, base: amount - q.totals.tip, tip: q.totals.tip, staff, caps, sent, group: others };
}

/* ---------------- the barber sends the payment link ---------------- */

const sentLine = obj({
  kind: oneOf(/** @type {const} */ (['service', 'product', 'pack', 'fee'])), ref: opt(id()), name: opt(str({ max: 60 })), qty: opt(int({ min: 1, max: 99 })),
  unit: opt(money(500000)), discount: opt(money(500000)), staffId: opt(id()), packId: opt(id()), memberId: opt(id()), force: opt(bool()), rewardId: opt(id())
});
const sentSchema = obj({ lines: arr(sentLine, { min: 1, max: 30 }), groupApptIds: opt(arr(id(), { max: 3 })), discount: opt(obj({ amount: money(500000), reason: opt(str({ max: 40 })) })) });

/**
 * « Envoyer le lien de paiement »: the ticket as it stands on the barber's screen (a product added, a discount) is
 * checked as the till would check it, kept on the appointment, and the client's page asks that amount from then on.
 * send: the link also leaves to the client by the salon's usual channel (his number, else his e-mail).
 */
export const requestSelfPay = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    if (ctx.meta.payLive === false) fail(409, 'no_provider', 'Le paiement en ligne n’est pas branché (Stripe).');
    if (!selfPayOn(s)) fail(409, 'off', 'Le paiement en ligne par le client est désactivé (Réglages › Paiements).');
    const a = getAppt(s, input.id);
    if (a.day !== ctx.local.day) fail(409, 'not_yet', 'Le lien de paiement s’envoie le jour du rendez-vous.');
    const raw = parse(sentSchema, input.ticket || {});
    // a typed reason may name someone: the chained record keeps « Autre », as a ticket does
    const ticket = { lines: raw.lines, ...(raw.groupApptIds && raw.groupApptIds.length ? { groupApptIds: raw.groupApptIds } : {}), ...(raw.discount && raw.discount.amount ? { discount: { amount: raw.discount.amount, reason: DISCOUNT_REASONS.includes(raw.discount.reason || '') ? raw.discount.reason : 'Autre' } } : {}) };
    // every rule of the till, as this person: his own client on his phone, the prices, his discount cap
    quoteCheckout(s, { apptId: a.id, ...ticket, ...(input.phone === true ? { phone: true } : {}) }, ctx);
    const q = selfQuote(s, { ...a, pay: { by: ctx.staff ? ctx.staff.id : null, ticket } }, { now: ctx.now, local: ctx.local });
    if (q.base < SELF_MIN) fail(409, 'nothing', 'Rien à régler en ligne sur ce ticket : valide-le directement.');
    ctx.emit('appt.updated', { id: a.id, patch: { pay: { by: ctx.staff ? ctx.staff.id : null, at: ctx.now, due: q.base, ticket } }, cid: a.clientId || undefined });
    /** @type {{ by: string, to: string }|null} */
    let sent = null;
    const c = a.clientId ? s.clients.get(a.clientId) : null;
    if (input.send !== false && c && !c.erased) {
      let n = 0;
      const key = (/** @type {number} */ i) => 'paylink_' + a.id + '_' + i;
      while (n < PAY_LINKS_MAX && s.messages.has(messageId(key(n)))) n++;
      if (n >= PAY_LINKS_MAX) fail(429, 'too_many', 'Le lien est déjà parti ' + PAY_LINKS_MAX + ' fois : montre plutôt le QR code.');
      const lien = (ctx.meta.linkFor ? ctx.meta.linkFor(a) : '') + '?payer';
      const vars = { prenom: c.first || '', montant: (q.base / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') + ' €', lien, salon: s.settings.shop.name };
      if (c.phone) {
        const mid = queueMessage(s, ctx, { key: key(n), template: 'payLink', text: PAY_LINK_TEXT, to: c.phone, cid: c.id, apptId: a.id, vars });
        if (mid) sent = { by: 'sms', to: c.phone };
      }
      if (!sent && c.email && isEmail(c.email)) {
        const mid = queueMessage(s, ctx, { key: key(n), channel: 'email', template: 'payLink', to: c.email, cid: c.id, apptId: a.id, vars, subject: 'Règle ta coupe en ligne · {salon}', text: 'Bonjour {prenom},\n\nTa coupe se règle en ligne ({montant}), par carte, Apple Pay ou Google Pay :\n{lien}\n\nÀ tout de suite,\n{salon}' });
        if (mid) sent = { by: 'email', to: c.email };
      }
    }
    return { ok: true, due: q.base, sent: sent ? sent.by : null };
  }
};

/** « Annuler et encaisser autrement »: the ticket goes back to the till, the page still open is closed. */
export const cancelSelfPay = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    const a = getAppt(s, input.id);
    if (a.pay) ctx.emit('appt.updated', { id: a.id, patch: { pay: null }, cid: a.clientId || undefined });
    const py = selfPaymentOf(s, a);
    const open = py && py.status === 'pending' ? py : null;
    if (open) ctx.emit('payment.expired', { id: open.id, reason: 'Annulé au salon' });
    return { ok: true, ...(open ? { payment: { id: open.id, provider: open.provider, providerRef: open.providerRef } } : {}) };
  }
};
