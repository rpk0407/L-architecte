// @ts-check
// Gift cards sold online (/carte-cadeau): the order, Stripe Checkout, the card issued once the payment is confirmed,
// its page (/cadeau/:token) and what the Comptoir shows of it.
//
// The card keeps only the hash of its code, like any card (the code is also in the pii of its text, like the till's).
// The code is derived from the payment under the server's secret (codeFor), so the card's page can show it again.
// The order's names and numbers travel in the pii of its payment.created event (commands/payments.js) and are read
// back from the journal at fulfilment.
import { createHmac } from 'node:crypto';
import { HttpError, guard, json } from './kit.js';
import { signLink, checkLink } from '../auth/session.js';
import { newId, normGiftCode, normPhone, sha256, maskPhone } from '../lib/util.js';
import { createPayment, giftOrder, GIFT_MIN, GIFT_MAX, GIFT_SEND_DAYS } from '../commands/payments.js';
import { sellGiftcardOnline, sendGiftcode, giftOrderOf, plannedText } from '../commands/sales.js';
import { fmtEur } from '../../shared/money.js';

const SYSTEM = (r) => ({ actor: /** @type {const} */ ({ t: 'system', id: 'giftshop' }), caps: new Set(['sale.create']), meta: r.meta });
// the chips of /carte-cadeau
const AMOUNTS = [2000, 3000, 5000, 8000];
const NOT_LIVE = 'Les cartes cadeaux en ligne arrivent bientôt : en vente au salon';

// as routes-public.js says them (not imported: that file imports fulfilGiftcard from this one)
const isDemo = (r) => r.rt.cfg.mode === 'demo' && r.s.mode === 'demo';
/**
 * Real money only: the simulated provider takes demo money, and a Stripe test key takes Stripe's test cards, never a
 * production salon's (a card the till accepts would be worth real cuts).
 */
const payLive = (r) => isDemo(r) || (r.rt.pay.name !== 'simulated' && !!r.rt.pay.live);
/** Sold online right now? */
const live = (r) => payLive(r) && !!r.s.settings.payments.giftcard;
/** Can the salon text at all? Without a provider in production, a text would wait in the outbox for good. */
const smsOn = (r) => !!r.rt.sms || isDemo(r);

/** The card's code, from its payment and the server's secret: the same on every instance, and nowhere on disk. */
export function codeFor(secret, paymentId) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = createHmac('sha256', secret).update('giftcode:' + paymentId).digest();
  let s = '';
  for (let i = 0; i < 12; i++) { s += A[buf[i] % A.length]; if (i === 3 || i === 7) s += '-'; }
  return s;
}
export const giftLink = (secret, paymentId) => '/cadeau/' + signLink(secret, 'gift', paymentId);

/**
 * The order's personal data, from its payment.created event (pii, outside the chain; gone once the buyer is erased).
 * The event is recent: the walk back stops a few minutes before the payment was created.
 * @returns {{ buyer: { first: string, phone: string, email: string }, recipient: { first: string, phone: string }, message: string } | null}
 */
export function orderOf(engine, py) {
  const j = engine.journal;
  for (let i = j.length - 1; i >= 0; i--) {
    const e = j[i];
    if (e.at < (py.createdAt || 0) - 10 * 60000) break;
    if (e.type === 'payment.created' && e.data && e.data.id === py.id) return (e.pii && e.pii.order) || null;
  }
  return null;
}

/**
 * The cards a confirmed order issued: the ticket's gift card, then those that replaced it (reissued), the live one last.
 * @returns {any[]}
 */
function cardsOf(s, py) {
  const sale = py && py.usedBy ? s.sales.get(py.usedBy) : null;
  const line = sale ? sale.lines.find((l) => l.kind === 'giftcard') : null;
  const out = [];
  for (let g = line ? s.giftcards.get(line.ref) : null, i = 0; g && i < 20; i++) { out.push(g); g = g.replacedBy ? s.giftcards.get(g.replacedBy) : null; }
  return out;
}
/** A text's state as the buyer and the salon read it: only 'sent' and 'simulated' left; a past-due one is about to. */
function smsView(m, now) {
  if (!m) return null;
  const state = m.status === 'sent' || m.status === 'simulated' ? 'sent' : m.status === 'queued' && m.dueAt > now + 60000 ? 'planned'
    : m.status === 'queued' || m.status === 'claimed' ? 'leaving' : 'failed';
  return { status: m.status, state, dueAt: m.dueAt, to: m.toMasked || '', error: m.error || '' };
}

/**
 * Issue the card of a confirmed order: the ticket, the card and its text (sellGiftcardOnline). Called from the
 * provider's confirmation (routes-public.js afterProviderPaid, WP-06's hook) and again, as a catch-up, by the card's
 * page and the Comptoir's list, so a confirmation that arrived while this failed still ends with a card.
 * Idempotent, and never throws: the payment is recorded whatever happens here.
 * @param {any} r @param {any} payment the payment (or its id)
 */
export async function fulfilGiftcard(r, payment) {
  const py = r.s.payments.get(typeof payment === 'string' ? payment : payment && payment.id);
  if (!py || py.kind !== 'giftcard' || py.status !== 'paid') return null;
  if (py.usedBy) return { already: true, saleId: py.usedBy };
  const o = orderOf(r.rt.engine, py);
  const toRecipient = py.gift && py.gift.delivery === 'recipient';
  try {
    return await r.rt.engine.run(sellGiftcardOnline, {
      paymentId: py.id, code: codeFor(r.rt.secret, py.id), link: r.origin + giftLink(r.rt.secret, py.id),
      buyer: o ? o.buyer.first : undefined, recipient: o && o.recipient.first ? o.recipient.first : undefined,
      buyerPhone: o ? o.buyer.phone || undefined : undefined, buyerEmail: o ? o.buyer.email || undefined : undefined,
      // no SMS provider: no text that would never leave; the card's page has the code
      to: o && smsOn(r) ? (toRecipient ? o.recipient.phone : o.buyer.phone) || undefined : undefined
    }, SYSTEM(r));
  } catch (e) {
    console.error('[lx] gift card not issued', py.id, e && e.message);
    return null;
  }
}

/** What /cadeau/:token shows. The code only while the card can be spent, and only if it still is this card's code. */
function cardView(r, py) {
  const s = r.s;
  const sh = s.settings.shop;
  const chain = cardsOf(s, py);
  const g = chain[chain.length - 1];
  const o = orderOf(r.rt.engine, py);
  const m = plannedText(s, py.id);
  const base = {
    amount: py.amount, first: o ? o.recipient.first : '', from: o ? o.buyer.first : '', message: o ? o.message : '',
    delivery: py.gift ? py.gift.delivery : 'buyer', sendAt: py.gift ? py.gift.sendAt || 0 : 0,
    shop: { name: sh.name, address: sh.address + ', ' + sh.zip + ' ' + sh.city, phone: sh.phone }
  };
  if (!g) {
    const status = py.status === 'paid' ? 'paid' : py.status === 'pending' ? 'pending' : 'failed';
    return { ...base, status };
  }
  const code = codeFor(r.rt.secret, py.id);
  const mine = sha256(normGiftCode(code)) === g.codeHash;
  const status = g.status !== 'active' ? (g.voidReason === 'reissued' ? 'replaced' : 'void') : g.expires < r.local.day ? 'expired' : g.balance <= 0 ? 'spent' : 'ready';
  // still valid but its code is not the one this page can work out: reissued by the salon (a new random code), or the
  // server's secret changed since (operations.md)
  const hidden = status === 'ready' && !mine ? (chain.length > 1 ? 'reissued' : 'secret') : null;
  return {
    ...base, status, last4: g.last4, balance: g.balance, expires: g.expires, code: status === 'ready' && mine ? code : null,
    ...(hidden ? { hidden } : {}), sms: smsView(m, r.now)
  };
}

export function giftshopRoutes(app) {
  /** The page's switch: sold online or not, and the chips. */
  app.get('/api/public/giftcards', (r) => json({
    // on: the owner sells gift cards at all (Réglages); live: and online, right now
    live: live(r), on: !!r.s.settings.payments.giftcard, min: GIFT_MIN, max: GIFT_MAX, amounts: AMOUNTS, validDays: 365, sendDays: GIFT_SEND_DAYS,
    provider: r.rt.pay.name, sms: smsOn(r), today: r.local.day, now: r.now
  }, 200, { 'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=60' }));

  app.post('/api/public/giftcards', async (r) => {
    guard('gift|' + r.ip, 6, 60000, 'Trop de commandes d’un coup. Patiente une minute.');
    guard('gifth|' + r.ip, 20, 3600000, 'Trop de commandes depuis cet appareil. Appelle le salon.');
    if (!payLive(r)) throw new HttpError(409, 'not_live', NOT_LIVE);
    if (!r.s.settings.payments.giftcard) throw new HttpError(409, 'off', NOT_LIVE);
    // checked before the provider is asked for anything; createPayment checks it again
    const o = giftOrder(r.body, r.now);
    if (o.delivery === 'recipient' && !smsOn(r)) throw new HttpError(400, 'no_sms', 'Le salon n’envoie pas encore de SMS : garde la carte pour l’offrir toi-même.');
    const id = newId('py');
    const back = giftLink(r.rt.secret, id);
    const label = 'Carte cadeau ' + r.s.settings.shop.name + ' · ' + fmtEur(o.amount);
    const co = await r.rt.pay.createCheckout({ id, amount: o.amount, label, email: o.buyer.email || undefined, successUrl: r.origin + back + '?paiement=ok', cancelUrl: r.origin + '/carte-cadeau?paiement=annule' });
    await r.rt.engine.run(createPayment, { id, kind: 'giftcard', amount: o.amount, provider: r.rt.pay.name, providerRef: co.ref, url: co.url, exp: co.exp, label, order: r.body }, SYSTEM(r));
    // the test checkout page has no success address of its own: it is told where to go once "paid"
    const url = r.rt.pay.name === 'simulated' ? co.url + '?retour=' + encodeURIComponent(back) : co.url;
    return json({ id, url, card: back }, 201);
  });

  app.get('/api/public/giftcards/:token', async (r) => {
    guard('giftv|' + r.ip, 60, 60000);
    const pid = checkLink(r.rt.secret, 'gift', r.params.token);
    const py = pid ? r.s.payments.get(pid) : null;
    if (!py || py.kind !== 'giftcard') throw new HttpError(404, 'not_found', 'Cette carte cadeau est introuvable.');
    // paid but not issued yet (the confirmation's hook missing or failed): issue it now
    if (py.status === 'paid' && !py.usedBy) await fulfilGiftcard(r, py);
    return json(cardView(r, r.s.payments.get(py.id)), 200, { 'cache-control': 'no-store' });
  });

  /** The Comptoir's Cartes cadeaux: which cards were bought online, by whom for whom, and their text. */
  app.get('/api/v1/giftshop', async (r) => {
    for (const py of [...r.s.payments.values()].filter((p) => p.kind === 'giftcard' && p.status === 'paid' && !p.usedBy).slice(0, 5)) await fulfilGiftcard(r, py);
    const items = [];
    for (const py of r.s.payments.values()) {
      if (py.kind !== 'giftcard' || !py.usedBy) continue;
      const chain = cardsOf(r.s, py);
      const g = chain[chain.length - 1];
      if (!g) continue;
      items.push({
        // every card of the chain: a replaced card and its replacement both read "en ligne"
        giftcardId: g.id, cardIds: chain.map((x) => x.id), reissued: chain.length > 1, paymentId: py.id, amount: py.amount, paidAt: py.paidAt || 0,
        delivery: py.gift ? py.gift.delivery : 'buyer', sendAt: py.gift ? py.gift.sendAt || 0 : 0, sms: smsView(plannedText(r.s, py.id), r.now)
      });
    }
    return { items };
  }, { cap: 'sale.all' });

  /**
   * DO-03's resend for a card bought online: nobody at the salon holds its code, so the server derives it and sends
   * it through the same command. To the numbers of the order (its text's, the buyer's, the recipient's) for whoever
   * rings up; to another number only for those who may already reissue a card, and so see a code (sale.refund):
   * otherwise anyone at the till could text himself a card's code and spend it.
   */
  app.post('/api/v1/giftshop/:id/resend', async (r) => {
    guard('gcsend|' + r.me.id, 10, 60000);
    const g = r.s.giftcards.get(r.params.id);
    const py = g ? giftOrderOf(r.s, g) : null;
    if (!g || !py) throw new HttpError(404, 'not_found', 'Cette carte n’a pas été achetée en ligne.');
    if (g.status !== 'active') throw new HttpError(409, 'void', 'Cette carte cadeau est annulée.');
    const code = codeFor(r.rt.secret, py.id);
    if (sha256(normGiftCode(code)) !== g.codeHash) {
      throw new HttpError(409, 'code', g.reissueOf ? 'Cette carte a été réémise : son nouveau code s’envoie depuis la réémission, il n’est gardé nulle part.'
        : 'Le code de cette carte ne se retrouve plus (la clé du serveur a changé) : « Annuler et réémettre » en donne un nouveau.');
    }
    const first = plannedText(r.s, py.id);
    const o = orderOf(r.rt.engine, py);
    const own = [first ? first.to : '', o ? o.recipient.phone : '', o ? o.buyer.phone : ''].filter(Boolean);
    const typed = r.body && typeof r.body.phone === 'string' && r.body.phone.trim() ? r.body.phone.trim() : '';
    const phone = typed || own[0] || '';
    if (!phone) throw new HttpError(400, 'invalid', 'Indique un numéro.');
    if (!own.includes(normPhone(phone)) && !r.caps.has('sale.refund')) throw new HttpError(403, 'forbidden', 'Le code se renvoie au numéro de la commande. Un autre numéro : demande au gérant.');
    const res = await r.run(sendGiftcode, { id: g.id, code, phone, from: o ? o.buyer.first : undefined, link: r.origin + giftLink(r.rt.secret, py.id) });
    const m = r.s.messages.get(res.id);
    return { id: res.id, to: m ? m.toMasked : maskPhone(phone) };
  }, { cap: 'sale.create' });
}
