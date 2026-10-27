// @ts-check
// The till. A ticket is recorded once, numbered without gaps, and never edited:
// a mistake is corrected by a credit note (avoir), the day is sealed by a Z closure.
import { fail } from '../core/engine.js';
import { str, int, bool, opt, obj, arr, id, oneOf, money, record, parse } from '../lib/validate.js';
import { ticketTotals } from '../../shared/money.js';
import { maxDiscountPct } from '../domain/permissions.js';
import { drawerExpected, dayTotals, zRecord, missedZ, hadTill, dayWords, refundNo, ticketNo } from '../domain/cash.js';
import { getService, getProduct, getClient, getAppt, getStaff } from './common.js';
import { giftCode, normGiftCode, normPhone, sha256 } from '../lib/util.js';
import { addDays, isDay, fmtTime } from '../../shared/dates.js';
import { shopIntervals } from '../domain/availability.js';
import { DENOMS, fmtEur } from '../../shared/money.js';
import { queueMessage } from '../domain/messages.js';
import { TEMPLATES } from '../core/templates.js';
import { clientParts } from './clients.js';

const lineSchema = obj({
  kind: oneOf(/** @type {const} */ (['service', 'product', 'giftcard', 'pack', 'fee'])), ref: opt(id()), name: opt(str({ max: 60 })),
  qty: opt(int({ min: 1, max: 99 })), unit: opt(money(500000)), discount: opt(money(500000)), staffId: opt(id()), packId: opt(id()),
  recipient: opt(str({ max: 60 })), code: opt(str({ max: 20 }))
});
const paySchema = obj({ method: oneOf(/** @type {const} */ (['card', 'cash', 'online', 'giftcard', 'deposit'])), amount: money(1000000), given: opt(money(1000000)), ref: opt(str({ max: 40 })) });
const checkoutSchema = obj({
  apptId: opt(id()), clientId: opt(id()), lines: arr(lineSchema, { min: 1, max: 30 }),
  discount: opt(obj({ amount: money(500000), reason: opt(str({ max: 40 })) })),
  tip: opt(obj({ amount: money(50000), staffId: id() })),
  payments: arr(paySchema, { min: 1, max: 6 }), note: opt(str({ max: 200 }))
});

const PACK_NEW = 'new';
// the Comptoir's reasons (Checkout.tsx). Anything else is typed by staff and may name someone: it is kept in pii,
// out of the chain (the client can be erased) and off his receipt, which shows "Autre"
export const DISCOUNT_REASONS = ['Fidélité', 'Ami de la maison', 'Geste commercial', 'Retard du salon', 'Étudiant'];

export const checkout = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    const x = parse(checkoutSchema, input);
    // the demo back-fills past days; nobody else can date a ticket
    const backfill = ctx.actor.t === 'system' && typeof input.day === 'string' && input.day < ctx.local.day ? input.day : null;
    // a card bought online after today's Z (sellGiftcardOnline): the money is in, the sealed day stays as sealed,
    // the ticket opens tomorrow's till
    const online = ctx.actor.t === 'system' && input.online === true && !backfill;
    const day = backfill || (online && s.closures.has(ctx.local.day) ? addDays(ctx.local.day, 1) : ctx.local.day);
    if (s.closures.has(day)) fail(409, 'day_closed', 'La journée est clôturée : plus aucun encaissement possible aujourd’hui.');
    const P = s.settings.payments;
    const appt = x.apptId ? getAppt(s, x.apptId) : null;
    if (appt && (appt.status === 'done' || appt.saleId)) fail(409, 'paid', 'Ce rendez-vous est déjà encaissé.');
    if (appt && appt.status === 'cancelled') fail(409, 'cancelled', 'Ce rendez-vous est annulé.');
    // online: the buyer's file sellGiftcardOnline adds in this same command (not in the state yet)
    const client = online && input.newClient ? input.newClient : x.clientId ? getClient(s, x.clientId) : appt && appt.clientId ? getClient(s, appt.clientId) : null;
    const isBoss = ctx.staff && ['owner', 'manager'].includes(ctx.staff.role);
    // commissions follow the line: a barber credits himself or the appointment's barber. Whoever already edits every
    // chair's agenda (owner, manager, the desk ringing up for the barbers) may credit any of them.
    const anyPerformer = ctx.actor.t === 'system' || ctx.can('agenda.edit');
    const performer = (l) => {
      if (l.staffId && l.staffId !== (appt && appt.staffId) && l.staffId !== (ctx.staff && ctx.staff.id)) {
        if (!anyPerformer) fail(403, 'performer', 'Seul le gérant peut attribuer la prestation d’un autre barbier.');
        getStaff(s, l.staffId);
      }
      return l.staffId || (appt && appt.staffId) || (ctx.staff && ctx.staff.id) || null;
    };
    // the client pays the price he booked at, or today's if it went down: a later rise never reaches his ticket.
    // Each booked service covers one line. Exact prices are matched first, so the order of the lines does not matter.
    const pool = appt ? (appt.services || []).map((v) => ({ id: v.id, price: v.price })) : [];
    /** @type {Map<number, number>} line index → booked price */
    const bookedAt = new Map();
    const low = (v) => { const sv = s.services.get(v.id); return sv ? Math.min(v.price, sv.price) : v.price; };
    const take = (fits) => x.lines.forEach((l, i) => {
      if (l.kind !== 'service' || l.packId || bookedAt.has(i)) return;
      const j = pool.findIndex((v) => v.id === l.ref && fits(l, v));
      if (j >= 0) bookedAt.set(i, pool.splice(j, 1)[0].price);
    });
    take((l, v) => l.unit === low(v));
    take((l, v) => l.unit == null || isBoss || (!!s.services.get(v.id)?.from && l.unit >= low(v)));
    take((l) => true);

    /** @type {any[]} */
    const lines = [];
    const issued = [];
    let newPack = null;
    // a pack sold on this ticket can pay for a service on the same ticket
    for (const l of x.lines) {
      if (l.kind !== 'pack') continue;
      const sv = getService(s, l.ref || '');
      if (!sv.pack) fail(400, 'invalid', `« ${sv.name} » n’est pas un abonnement.`);
      if (!client) fail(400, 'no_client', 'Un abonnement se vend à un client avec sa fiche.');
      if (newPack) fail(400, 'invalid', 'Un seul abonnement par ticket.');
      newPack = { id: ctx.id('pk'), clientId: client.id, name: sv.name, total: sv.pack.credits, serviceIds: sv.pack.serviceIds || [], expires: addDays(day, sv.pack.days), serviceId: sv.id };
    }
    const packUses = new Map();
    for (const [i, l] of x.lines.entries()) {
      const qty = l.qty || 1;
      if (l.kind === 'service') {
        const sv = getService(s, l.ref || '');
        const at = bookedAt.get(i);
        const price = at == null ? sv.price : Math.min(at, sv.price);
        let unit = l.unit ?? price;
        if (unit !== price && !(sv.from && unit >= price) && !isBoss) fail(403, 'price', `Le prix de « ${sv.name} » est fixé à la carte. Utilise une remise.`);
        let name = sv.name, packId = null;
        if (l.packId) {
          const pk = l.packId === PACK_NEW ? newPack : s.packs.get(l.packId);
          if (!pk) fail(404, 'not_found', 'Abonnement introuvable.');
          if (!client || pk.clientId !== client.id) fail(409, 'pack_owner', 'Cet abonnement appartient à un autre client.');
          if (pk.voided) fail(409, 'pack_void', 'Cet abonnement a été annulé et remboursé.');
          const used = (l.packId === PACK_NEW ? 0 : pk.used) + (packUses.get(pk.id) || 0);
          if (used + qty > pk.total) fail(409, 'pack_empty', 'Il ne reste plus de coupe sur cet abonnement.');
          if (pk.expires < day) fail(409, 'pack_expired', 'Cet abonnement a expiré.');
          if (pk.serviceIds.length && !pk.serviceIds.includes(sv.id)) fail(409, 'pack_service', `L’abonnement ne couvre pas « ${sv.name} ».`);
          packUses.set(pk.id, (packUses.get(pk.id) || 0) + qty);
          unit = 0; packId = pk.id; name = sv.name + ' · abonnement ' + (used + qty) + '/' + pk.total;
        }
        // a cut paid by a pack keeps its price: a refund of the pack later values the cuts taken at it (refundPlan)
        lines.push({ kind: 'service', ref: sv.id, name, qty, unit, discount: l.discount || 0, staffId: performer(l), vat: sv.vat ?? P.vat, packId, category: sv.category, ...(packId ? { listPrice: price } : {}) });
      } else if (l.kind === 'product') {
        const p = getProduct(s, l.ref || '');
        if (!p.active) fail(409, 'inactive', `« ${p.name} » n’est plus en vente.`);
        lines.push({ kind: 'product', ref: p.id, name: p.name, qty, unit: p.price, discount: l.discount || 0, staffId: performer(l), vat: p.vat ?? P.vat, cost: p.cost || 0 });
      } else if (l.kind === 'giftcard') {
        // a card already paid online is issued even if the owner switched cards off since
        if (!P.giftcard && !online) fail(409, 'off', 'Les cartes cadeaux sont désactivées.');
        const amount = l.unit || 0;
        if (amount < 1000 || amount > 50000) fail(400, 'invalid', 'Une carte cadeau va de 10 € à 500 €.');
        const code = ctx.actor.t === 'system' && l.code ? l.code : giftCode();
        const gid = ctx.id('gc');
        issued.push({ id: gid, code, amount, recipient: l.recipient || '' });
        lines.push({ kind: 'giftcard', ref: gid, name: 'Carte cadeau ' + code.slice(-4), qty: 1, unit: amount, discount: 0, staffId: performer(l), vat: 0 });
      } else if (l.kind === 'pack') {
        const sv = getService(s, l.ref || '');
        lines.push({ kind: 'pack', ref: sv.id, name: sv.name, qty: 1, unit: sv.price, discount: l.discount || 0, staffId: performer(l), vat: sv.vat ?? P.vat, packId: /** @type {any} */ (newPack).id });
      } else {
        if (!l.name || !l.unit) fail(400, 'invalid', 'Un frais a besoin d’un libellé et d’un montant.');
        lines.push({ kind: 'fee', ref: null, name: l.name, qty, unit: l.unit, discount: l.discount || 0, staffId: performer(l), vat: P.vat });
      }
    }

    const discount = x.discount ? x.discount.amount : 0;
    const totals = ticketTotals(lines, discount, x.tip && P.tips ? x.tip.amount : 0);
    const granted = totals.discount;
    if (granted > 0) {
      if (!ctx.can('sale.discount')) fail(403, 'discount', 'Tu ne peux pas faire de remise.');
      const base = lines.filter((l) => l.kind !== 'giftcard').reduce((t, l) => t + l.unit * l.qty, 0);
      const pct = base ? (granted * 100) / base : 100;
      if (pct > maxDiscountPct(ctx.staff, s.settings) + 0.001) fail(403, 'discount', `Remise maximale : ${maxDiscountPct(ctx.staff, s.settings)} %.`);
      if (x.discount && x.discount.amount > 0 && !x.discount.reason) fail(400, 'invalid', 'Indique la raison de la remise.');
    }
    const why = x.discount ? x.discount.reason || '' : '';
    const typed = why && !DISCOUNT_REASONS.includes(why) ? why : '';
    if (x.tip && x.tip.amount > 0) getStaff(s, x.tip.staffId);

    /* payments must cover the ticket exactly */
    const paid = x.payments.reduce((t, p) => t + p.amount, 0);
    if (paid !== totals.due) fail(400, 'unbalanced', 'Le paiement ne correspond pas au total.', { due: totals.due, paid });
    const payments = [];
    const redeem = [];
    const usedOnline = new Set();
    for (const p of x.payments) {
      if (!p.amount) continue;
      const out = { method: p.method, amount: p.amount };
      if (p.method === 'cash') {
        if (!P.cash) fail(409, 'off', 'Les espèces sont désactivées.');
        if (!s.drawer) fail(409, 'drawer_closed', 'La caisse n’est pas ouverte. Ouvre-la avec le fond de caisse.');
        const given = p.given ?? p.amount;
        if (given < p.amount) fail(400, 'invalid', 'Le montant reçu est inférieur à la somme due.');
        Object.assign(out, { given, change: given - p.amount, drawerId: s.drawer.id });
      } else if (p.method === 'card') {
        if (!P.card) fail(409, 'off', 'Le paiement par carte est désactivé.');
      } else if (p.method === 'online' || p.method === 'deposit') {
        const py = s.payments.get(p.ref || '');
        if (!py || py.status !== 'paid') fail(409, 'unpaid', 'Ce paiement en ligne n’est pas encore confirmé.');
        if (py.usedBy || usedOnline.has(py.id)) fail(409, 'used', 'Ce paiement a déjà été utilisé sur un ticket.');
        if (p.method === 'deposit' && (!appt || py.apptId !== appt.id)) fail(409, 'deposit', 'Cet acompte concerne un autre rendez-vous.');
        if (py.amount !== p.amount) fail(400, 'invalid', 'Le montant ne correspond pas au paiement en ligne.');
        usedOnline.add(py.id);
        Object.assign(out, { paymentId: py.id });
      } else if (p.method === 'giftcard') {
        const g = s.giftcards.get(s.giftByHash.get(sha256(normGiftCode(p.ref))) || '');
        if (!g) fail(404, 'giftcard', 'Carte cadeau inconnue.');
        if (g.status !== 'active') fail(409, 'giftcard', g.replacedBy ? 'Cette carte a été remplacée par une nouvelle : utilise le nouveau code.' : 'Cette carte cadeau a été annulée.');
        if (g.expires < day) fail(409, 'giftcard', 'Cette carte cadeau a expiré le ' + g.expires.split('-').reverse().join('/') + '.');
        const already = redeem.filter((r) => r.id === g.id).reduce((t, r) => t + r.amount, 0);
        if (g.balance - already < p.amount) fail(409, 'giftcard', 'Solde insuffisant sur la carte cadeau.', { balance: g.balance - already });
        if (lines.some((l) => l.kind === 'giftcard')) fail(400, 'invalid', 'Une carte cadeau ne paie pas une autre carte cadeau.');
        redeem.push({ id: g.id, amount: p.amount });
        Object.assign(out, { giftcardId: g.id, last4: g.last4 });
      }
      payments.push(out);
    }

    const sid = ctx.id('sa');
    const number = s.saleSeq + 1;
    ctx.emit('sale.completed', {
      id: sid, number, day, cashierId: ctx.staff ? ctx.staff.id : null, apptId: appt ? appt.id : null, clientId: client ? client.id : null, cid: client ? client.id : undefined,
      lines: lines.map((l, i) => ({ ...l, net: totals.nets[i] })), discount: x.discount ? { amount: discount, reason: typed ? 'Autre' : why } : null,
      tip: totals.tip ? { amount: totals.tip, staffId: /** @type {any} */ (x.tip).staffId } : null, totals: { gross: totals.gross, discount: totals.discount, total: totals.total, tip: totals.tip, due: totals.due, revenue: totals.revenue, revenueHT: totals.revenueHT, liability: totals.liability, vat: totals.vat },
      payments, note: x.note || '', ...(backfill ? { at: input.at } : {}), ...(ctx.actor.t === 'system' && !online ? { demo: true } : {})
    }, typed ? { discountReason: typed } : undefined);
    for (const l of lines) if (l.kind === 'product') ctx.emit('stock.adjusted', { productId: l.ref, delta: -l.qty, reason: 'Vente', saleId: sid, name: l.name });
    // online: the name the buyer typed ("De la part de"), which may not be the one on the file their number found
    const buyer = online && typeof input.buyer === 'string' ? input.buyer.slice(0, 60) : client ? (client.first + ' ' + client.last).trim() : '';
    for (const g of issued) {
      ctx.emit('giftcard.issued', { id: g.id, codeHash: sha256(normGiftCode(g.code)), last4: g.code.slice(-4), amount: g.amount, saleId: sid, expires: addDays(day, 365), ...(online ? { online: true } : {}), cid: client ? client.id : undefined }, { buyer, recipient: g.recipient });
    }
    for (const r of redeem) ctx.emit('giftcard.redeemed', { id: r.id, amount: r.amount, saleId: sid });
    if (newPack) ctx.emit('pack.sold', { ...newPack, saleId: sid, cid: newPack.clientId });
    for (const [pid, n] of packUses) for (let i = 0; i < n; i++) ctx.emit('pack.used', { id: pid, saleId: sid });
    const change = payments.reduce((t, p) => t + (p.change || 0), 0);
    // the only time the full code is known: the till prints it (voucher) or texts it (sendGiftcode), nothing keeps it
    return { id: sid, number, day, totals, change, giftcards: issued.map((g) => ({ id: g.id, code: g.code, last4: g.code.slice(-4), amount: g.amount, recipient: g.recipient, expires: addDays(day, 365) })) };
  }
};

/* ---------------- a gift card bought on /carte-cadeau ---------------- */

// DO-05 adds 'giftcard' to the registry (core/templates.js); until then, and on a salon whose settings predate it, this one
const GIFT_ONLINE = "{acheteur} t'offre {montant} chez {salon} ! Ton code : {code}. Réserve ici : {lien}";
// the buyer keeps it (to print, or to pass on himself): his own text, not "X t'offre"
const GIFT_BUYER = "{salon} : merci {acheteur} ! Ta carte cadeau de {montant} : code {code}, valable jusqu'au {date}. Pour l'imprimer ou l'offrir : {lien}";
const onlineSchema = obj({
  paymentId: id(), code: str({ min: 12, max: 20 }), link: str({ max: 300 }), buyer: opt(str({ max: 40 })),
  recipient: opt(str({ max: 40 })), to: opt(str({ max: 32 })), buyerPhone: opt(str({ max: 32 })), buyerEmail: opt(str({ max: 120 }))
});

/** The order paid on /carte-cadeau behind a card, through the cards it replaced (reissued): its payment, or null (sold at the till). */
export function giftOrderOf(s, g) {
  for (let i = 0; g && !g.saleId && i < 20; i++) g = g.reissueOf ? s.giftcards.get(g.reissueOf) : null;
  const sale = g && g.saleId ? s.sales.get(g.saleId) : null;
  const pay = sale ? sale.payments.find((p) => p.method === 'online' && p.paymentId) : null;
  const py = pay ? s.payments.get(pay.paymentId) : null;
  return py && py.kind === 'giftcard' ? py : null;
}
/** The text the buyer planned, its latest version: a card reissued before it left queues it again under the new code. */
export function plannedText(s, paymentId) {
  const k = 'msg_giftshop_' + paymentId;
  let m = s.messages.get(k) || null;
  for (const [key, v] of s.messages) if (key.startsWith(k + '_')) m = v;
  return m;
}
/** A card cancelled before its planned text left: the text stays unsent (a dead code on Christmas Eve helps nobody). */
function withdrawPlanned(s, ctx, g, why) {
  const py = giftOrderOf(s, g);
  const m = py ? plannedText(s, py.id) : null;
  if (!m || m.status !== 'queued') return null;
  ctx.emit('message.updated', { id: m.id, patch: { status: 'skipped', error: why } });
  return { py, m };
}

/**
 * A card paid on /carte-cadeau, once the provider confirms: the buyer's file, the ticket (nobody at the till, paid
 * online, so a liability at 0 % VAT), the card under the code the route derived from the payment, and one text at the
 * time the buyer chose, to the person it is for or to the buyer. Run by fulfilGiftcard (routes-giftshop.js) as the
 * system, with the order's names and numbers read back from the journal; they only reach the events' pii. A second
 * confirmation (webhook retried, the card page polling) finds the payment used and stops there.
 */
export const sellGiftcardOnline = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    if (ctx.actor.t !== 'system') fail(403, 'forbidden', 'Réservé au paiement en ligne.');
    const x = parse(onlineSchema, input);
    const py = s.payments.get(x.paymentId);
    if (!py || py.kind !== 'giftcard') fail(404, 'not_found', 'Commande introuvable.');
    if (py.usedBy) return { already: true, saleId: py.usedBy };
    if (py.status !== 'paid') fail(409, 'unpaid', 'Ce paiement en ligne n’est pas encore confirmé.');
    // the buyer's file only once paid (an abandoned checkout leaves none): the one their number already had, or a new one
    // under the id the order reserved (payments.js), so erasing that file also erases the order's personal data
    let cid = py.cid && s.clients.has(py.cid) ? py.cid : undefined;
    /** @type {any} */
    let fresh = null;
    if (!cid && x.buyerPhone && x.buyer) {
      const { pii } = clientParts({ first: x.buyer, phone: x.buyerPhone, ...(x.buyerEmail ? { email: x.buyerEmail } : {}) });
      const known = pii.phone ? s.clientByPhone.get(pii.phone) : null;
      if (known && s.clients.has(known)) cid = known;
      else if (py.cid) {
        ctx.emit('client.added', { id: py.cid, cid: py.cid, source: 'site', sms: true, marketing: false, tags: [] }, pii);
        cid = py.cid; fresh = { id: py.cid, first: pii.first || '', last: '' };
      }
    }
    const res = checkout.run(s, {
      clientId: fresh ? undefined : cid, newClient: fresh, online: true, buyer: x.buyer || '',
      lines: [{ kind: 'giftcard', unit: py.amount, ...(x.recipient ? { recipient: x.recipient } : {}), code: x.code }],
      payments: [{ method: 'online', amount: py.amount, ref: py.id }]
    }, ctx);
    const g = res.giftcards[0];
    const gift = py.gift || {};
    const toBuyer = gift.delivery !== 'recipient';
    const own = (s.settings.messages.templates || {}).giftcard;
    const tpl = toBuyer ? GIFT_BUYER : own || /** @type {any} */ (TEMPLATES).giftcard || GIFT_ONLINE;
    const mid = x.to ? queueMessage(s, ctx, {
      key: 'giftshop_' + py.id, template: 'giftcard', text: tpl, to: x.to, cid: cid || null,
      vars: { acheteur: x.buyer || '', prenom: x.recipient || '', montant: fmtEur(g.amount), code: g.code, date: g.expires.split('-').reverse().join('/'), lien: x.link, salon: s.settings.shop.name },
      // planned for 24/12 19:00, never before the card exists
      dueAt: Math.max(ctx.now, gift.sendAt || 0)
    }) : null;
    return { saleId: res.id, number: res.number, day: res.day, giftcardId: g.id, last4: g.last4, expires: g.expires, messageId: mid, cid: cid || null };
  }
};

/* ---------------- credit notes (avoirs) ---------------- */

/** A sale's gift card and every card that replaced it (reissued), the live one last. */
function cardChain(s, id) {
  const out = [];
  for (let g = s.giftcards.get(id), i = 0; g && i < 20; i++) { out.push(g); g = g.replacedBy ? s.giftcards.get(g.replacedBy) : null; }
  return out;
}
/**
 * What one cut taken on a pack is worth: the price of the service it paid for, as that ticket priced it (listPrice,
 * kept on the line), so a later change of the catalogue moves nothing. Uses recorded before that, or taken over from
 * the old site, fall back on the covered service's price, then on the pack's own price per cut.
 */
function cutPrice(s, pk, line) {
  const sv = (pk.serviceIds || []).map((x) => s.services.get(x)).find(Boolean);
  const fallback = sv ? sv.price : Math.round(line.net / Math.max(1, pk.total + (pk.voided ? pk.voided.left : 0)));
  const prices = (pk.uses || []).map((u) => {
    const l = (s.sales.get(u.saleId) || { lines: [] }).lines.find((y) => y.kind === 'service' && y.packId === pk.id);
    return l && l.listPrice != null ? l.listPrice : fallback;
  });
  return prices.length ? Math.round(prices.reduce((t, v) => t + v, 0) / prices.length) : fallback;
}
const MONEY_METHODS = /** @type {const} */ (['card', 'cash', 'online']);

/**
 * What can still be refunded on a ticket, line by line, as the refund screen shows it and the refund checks it.
 * A pack line is worth its price less the cuts taken (`suggested`), a gift card line only while no card of its chain
 * (the card and those that replaced it) was ever used, a cut paid by a pack nothing. A pack's value goes back only
 * through its line, which cancels it: `free` is what a refund without lines may take, the packs' value kept out.
 * `consumed` is the value of the cuts taken, refunded only when the owner forces it. `split` is the payment's mix.
 */
export function refundPlan(s, sale) {
  const done = sale.lineRefunds || {};
  let consumed = 0, inPacks = 0;
  const lines = sale.lines.map((l, i) => {
    const r = done[i] || { qty: 0, amount: 0 };
    /** @type {any} */
    const o = { i, kind: l.kind, ref: l.ref, name: l.name, qty: l.qty, net: l.net, vat: l.vat, left: l.net > 0 ? l.qty - r.qty : 0, value: l.net - r.amount };
    if (l.kind === 'pack') {
      const pk = s.packs.get(l.packId);
      const unit = pk ? cutPrice(s, pk, l) : 0;
      // a live pack keeps its whole value out of a refund without lines; a cancelled one only the cuts taken (what a
      // credit note lowered below the line did not give back is the ticket's again)
      inPacks += Math.max(0, pk && pk.voided ? Math.min(o.value, pk.used * unit) : o.value);
      if (pk) {
        consumed += Math.max(0, Math.min(o.value, pk.used * unit));
        o.pack = { id: pk.id, name: pk.name, total: pk.voided ? pk.used + pk.voided.left : pk.total, used: pk.used, left: pk.voided ? 0 : pk.total - pk.used, unit, voided: !!pk.voided, suggested: Math.max(0, o.value - pk.used * unit) };
        if (pk.voided) o.left = 0;
      }
    } else if (l.kind === 'giftcard') {
      const chain = cardChain(s, l.ref);
      const g = chain[chain.length - 1];
      // a card spent in part then reissued carries its balance, never its history: the whole chain says "unused"
      const unused = !!g && g.status === 'active' && g.balance === l.net && chain.every((c) => !c.uses.length);
      o.giftcard = g ? { id: g.id, last4: g.last4, status: g.status, balance: g.balance, unused, replaced: chain.length > 1 } : null;
      if (!unused) o.left = 0;
    }
    return o;
  });
  // the payment's proportion, over the ways money can go back (a deposit goes back online; a gift card spent stays spent)
  /** @type {Record<string, number>} */
  const paid = {};
  for (const p of sale.payments) { const m = p.method === 'deposit' ? 'online' : p.method; if (MONEY_METHODS.includes(m)) paid[m] = (paid[m] || 0) + p.amount; }
  const total = Object.values(paid).reduce((t, v) => t + v, 0);
  const revenueLeft = sale.totals.revenue - sale.refunded;
  return {
    saleId: sale.id, ref: ticketNo(sale.number), lines,
    revenueLeft, liabilityLeft: (sale.totals.liability || 0) - (sale.refundedLiability || 0), consumed, free: Math.max(0, revenueLeft - inPacks),
    split: Object.entries(paid).sort((a, b) => b[1] - a[1]).map(([method, amount]) => ({ method, share: total ? amount / total : 0 })),
    online: sale.payments.some((p) => p.method === 'online' || p.method === 'deposit'),
    giftcardPaid: sale.payments.filter((p) => p.method === 'giftcard').reduce((t, p) => t + p.amount, 0)
  };
}

const refundSchema = obj({
  saleId: id(), amount: money(1000000), method: oneOf(MONEY_METHODS), reason: str({ min: 3, max: 120 }),
  restock: opt(arr(obj({ productId: id(), qty: int({ min: 1, max: 99 }) }), { max: 20 })), providerRef: opt(str({ max: 80 })),
  // by line: the ticket's line index and how many of it
  lines: opt(arr(obj({ i: int({ min: 0, max: 29 }), qty: int({ min: 1, max: 99 }) }), { max: 30 })),
  // card and cash, in the proportion of the payment (never online: that money moves at the provider, one refund at a time)
  split: opt(arr(obj({ method: oneOf(/** @type {const} */ (['card', 'cash'])), amount: money(1000000) }), { min: 2, max: 2 })),
  // the owner refunds a pack in full although cuts were taken
  override: opt(bool())
});

/**
 * Every rule of a credit note, without writing anything: the refund command runs it, and the online refund route runs
 * it before any money moves at the provider, so a refund refused here never leaves the salon's account.
 * @param {any} s @param {any} input @param {{ local: { day: string }, actor: { t: string }, staff?: any }} ctx
 */
export function checkRefund(s, input, ctx) {
  const x = parse(refundSchema, input);
  const sale = s.sales.get(x.saleId);
  if (!sale) fail(404, 'not_found', 'Ticket introuvable.');
  if (s.closures.has(ctx.local.day)) fail(409, 'day_closed', 'La journée est clôturée.');
  const plan = refundPlan(s, sale);
  const override = !!x.override;
  if (override && !(ctx.actor.t === 'system' || (ctx.staff && ctx.staff.role === 'owner'))) fail(403, 'override', 'Seul le gérant peut rembourser les coupes déjà faites.');
  const eu = (c) => fmtEur(c, { decimals: true });

  /* the lines given back, each with its value; a gift card line cancels the card, a pack line the pack */
  const picked = [];
  let liability = 0, max = 0;
  const seen = new Set();
  for (const r of x.lines || []) {
    const o = plan.lines[r.i];
    if (!o || seen.has(r.i)) fail(400, 'invalid', 'Ligne inconnue sur ce ticket.');
    seen.add(r.i);
    if (o.kind === 'giftcard' && !o.left) fail(409, 'giftcard_used', 'Cette carte cadeau a déjà servi (ou est annulée) : elle ne se rembourse plus.');
    if (o.kind === 'pack' && o.pack && o.pack.voided) fail(409, 'pack_void', 'Cet abonnement est déjà annulé.');
    if (r.qty > o.left) fail(400, 'invalid', `« ${o.name} » : ${o.left ? 'au plus ' + o.left + ' à rembourser' : o.net > 0 ? 'déjà remboursé' : 'rien à rembourser'}.`);
    // the last ones take what is left of the line, so rounding never leaves a cent behind
    const value = o.kind === 'pack' && o.pack ? (override ? o.value : o.pack.suggested) : r.qty === o.left ? o.value : Math.min(o.value, Math.round((o.net * r.qty) / o.qty));
    if (o.kind === 'giftcard') liability += value;
    max += value;
    picked.push({ ...o, n: r.qty, amount: value });
  }
  if (override && !picked.some((o) => o.kind === 'pack')) fail(400, 'override', 'Le remboursement forcé vaut pour un abonnement : coche sa ligne.');
  if (x.amount <= 0) fail(400, 'invalid', 'Indique un montant.');
  const livePack = plan.lines.some((o) => o.kind === 'pack' && o.value > 0 && !(o.pack && o.pack.voided));
  if (picked.length) {
    if (x.amount > max) fail(400, 'invalid', 'Au plus ' + eu(max) + ' pour les lignes choisies.', { max });
    if (x.amount < liability) fail(400, 'invalid', 'Une carte cadeau annulée se rembourse en entier (' + eu(liability) + ').');
    // what was already given back without lines comes off what these lines may still take
    const room = plan.free + picked.filter((o) => o.kind === 'pack').reduce((t, o) => t + Math.max(0, o.value), 0);
    if (max - liability > room) fail(409, 'refunded', 'Une partie du ticket est déjà remboursée : au plus ' + eu(room + liability) + ' pour ces lignes, ou rembourse un montant sans ligne.', { max: room + liability });
    // less than the lines are worth: each line gives back its share (a gift card always its whole value), so the
    // credit note's lines add up to its amount, the VAT below follows them and what is left of a line stays its own
    if (x.amount < max) {
      const scaled = picked.filter((o) => o.kind !== 'giftcard' && o.amount > 0);
      const from = max - liability, to = x.amount - liability;
      // largest remainder: the cents rounding leaves go to the lines that lost most, so no line exceeds its own value
      const exact = scaled.map((o) => (o.amount * to) / from);
      scaled.forEach((o, i) => { o.amount = Math.floor(exact[i]); });
      let rest = to - scaled.reduce((t, o) => t + o.amount, 0);
      for (const i of scaled.map((o, k) => k).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || a - b)) { if (rest <= 0) break; scaled[i].amount += 1; rest -= 1; }
    }
  } else if (x.amount > plan.free) {
    // a pack's value goes back only through its line, which cancels it: no refund leaves the cuts behind
    if (livePack) fail(409, 'pack_used', 'Un abonnement se rembourse par sa ligne (« Annuler l’abonnement ») : sans ligne, au plus ' + eu(plan.free) + '.', { max: plan.free });
    if (plan.free < plan.revenueLeft) fail(409, 'pack_used', 'Le reste du ticket, ce sont les coupes d’abonnement déjà faites : au plus ' + eu(plan.free) + '.', { max: plan.free });
    fail(400, 'invalid', 'Montant remboursable au maximum : ' + eu(plan.free) + '.', { left: plan.free });
  }
  const revenue = x.amount - liability;
  if (revenue > plan.revenueLeft) fail(400, 'invalid', 'Montant remboursable au maximum : ' + eu(plan.revenueLeft + liability) + '.', { left: plan.revenueLeft });

  /* products back on the shelf: only those given back, at most as many */
  const back = new Map();
  for (const o of picked) if (o.kind === 'product') back.set(o.ref, (back.get(o.ref) || 0) + o.n);
  const restock = (x.restock || []).map((r) => {
    const n = back.get(r.productId) || 0;
    if (r.qty > n) fail(400, 'invalid', 'Ne remets en stock que les produits rendus, dans leur quantité.');
    back.set(r.productId, n - r.qty);
    return { product: getProduct(s, r.productId), qty: r.qty };
  });

  const parts = x.split ? x.split.filter((p) => p.amount > 0) : null;
  if (parts && (x.method === 'online' || x.providerRef)) fail(400, 'invalid', 'Un remboursement en ligne ne se répartit pas : il repart en entier sur le paiement en ligne.');
  if (parts && (parts.reduce((t, p) => t + p.amount, 0) !== x.amount || new Set(parts.map((p) => p.method)).size !== parts.length)) fail(400, 'invalid', 'La répartition ne correspond pas au montant.');
  const split = parts && parts.length > 1 ? parts.sort((a, b) => b.amount - a.amount) : null;
  const method = split ? split[0].method : parts && parts.length ? parts[0].method : x.method;
  const cash = split ? split.some((p) => p.method === 'cash') : method === 'cash';
  if (cash && !s.drawer) fail(409, 'drawer_closed', 'Ouvre la caisse pour rembourser en espèces.');
  if (method === 'online' && !plan.online) fail(400, 'invalid', 'Ce ticket n’a pas été payé en ligne.');

  /* VAT given back: the rates of the lines chosen, or the ticket's own proportion */
  /** @type {Map<number, number>} rate → TTC */
  const byRate = new Map();
  const fromLines = picked.filter((o) => o.kind !== 'giftcard' && o.amount > 0);
  if (fromLines.length) for (const o of fromLines) byRate.set(o.vat, (byRate.get(o.vat) || 0) + o.amount);
  else for (const r of sale.totals.vat) byRate.set(r.rate, r.base + r.tax);
  const weight = [...byRate.values()].reduce((t, v) => t + v, 0);
  const rows = [...byRate.entries()].sort((a, b) => b[0] - a[0]);
  let rest = revenue;
  const vat = revenue <= 0 ? [] : rows.map(([rate, w], i) => {
    const ttc = i === rows.length - 1 ? rest : Math.round((w * revenue) / (weight || 1));
    rest -= ttc;
    const base = rate ? Math.round((ttc * 10000) / (10000 + rate)) : ttc;
    return { rate, base, tax: ttc - base };
  }).filter((r) => r.base || r.tax);
  return { x, sale, plan, picked, liability, method, split, cash, vat, restock, override: override && plan.consumed > 0 };
}

export const refund = {
  run(s, input, ctx) {
    ctx.need('sale.refund');
    const { x, sale, picked, liability, method, split, cash, vat, restock, override } = checkRefund(s, input, ctx);
    const rid = ctx.id('rf');
    const number = s.refundSeq + 1;
    ctx.emit('sale.refunded', {
      id: rid, number, saleId: sale.id, saleNumber: sale.number, day: ctx.local.day, amount: x.amount, method, ...(split ? { parts: split } : {}), reason: x.reason, vat,
      ...(liability ? { liability } : {}), ...(picked.length ? { lines: picked.map((o) => ({ i: o.i, qty: o.n, name: o.name, kind: o.kind, amount: o.amount, vat: o.kind === 'giftcard' ? 0 : o.vat })) } : {}),
      drawerId: cash ? s.drawer.id : null, providerRef: x.providerRef || null, ...(override ? { override: true } : {}), cid: sale.clientId || undefined
    });
    for (const o of picked) {
      if (o.kind === 'pack' && o.pack) ctx.emit('pack.voided', { id: o.pack.id, saleId: sale.id, refundId: rid, cid: sale.clientId || undefined });
      if (o.kind === 'giftcard' && o.giftcard) {
        ctx.emit('giftcard.voided', { id: o.giftcard.id, reason: 'refunded', saleId: sale.id, refundId: rid });
        withdrawPlanned(s, ctx, s.giftcards.get(o.giftcard.id), 'Carte annulée');
      }
    }
    for (const r of restock) ctx.emit('stock.adjusted', { productId: r.product.id, delta: r.qty, reason: 'Retour', saleId: sale.id, name: r.product.name });
    return { id: rid, number, ref: refundNo(number), amount: x.amount, liability };
  }
};

/* ---------------- gift cards after the sale: the code by SMS, a lost card replaced ---------------- */

// WP-04 adds this text to the registry (core/templates.js); until then, and on a salon whose settings predate it, this one
const GIFT_TEXT = "L'Architecte : {acheteur} t'offre une carte cadeau de {montant} ! Code {code}, valable jusqu'au {date}. Réserve : {lien}";
// nobody named (no client on the ticket, "De la part de" left empty): a text out of the blue says it plainly
const GIFT_ANON = "L'Architecte : une carte cadeau de {montant} t'a été offerte ! Code {code}, valable jusqu'au {date}. Réserve : {lien}";
const giftSendSchema = obj({
  id: id(), code: str({ min: 4, max: 40 }), phone: str({ min: 6, max: 32 }), from: opt(str({ max: 40 })),
  // a card bought online: its own printable page (/cadeau/…) rather than the site; nothing else can go in a salon's text
  link: opt(str({ max: 300, pattern: /^https?:\/\/[^\s/]+\/cadeau\/[A-Za-z0-9_.-]{8,200}$/ }))
});

/**
 * Text the code of a card to its recipient. Only someone holding the code can send it (the server keeps a hash):
 * the body, code included, travels in pii, never in the chain.
 */
export const sendGiftcode = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    const x = parse(giftSendSchema, input);
    const g = s.giftcards.get(x.id);
    if (!g) fail(404, 'not_found', 'Carte cadeau introuvable.');
    if (sha256(normGiftCode(x.code)) !== g.codeHash) fail(403, 'code', 'Ce code ne correspond pas à cette carte.');
    if (g.status !== 'active') fail(409, 'void', 'Cette carte cadeau est annulée.');
    if (g.expires < ctx.local.day) fail(409, 'expired', 'Cette carte a expiré le ' + g.expires.split('-').reverse().join('/') + '.');
    const to = normPhone(x.phone);
    if (!to) fail(400, 'invalid', 'Numéro de téléphone invalide.');
    const n = [...s.messages.keys()].filter((k) => k.startsWith('msg_giftcard_' + g.id + '_')).length;
    const M = s.settings.messages;
    const buyer = (x.from || g.buyer || '').trim().split(/\s+/)[0];
    const own = (M.templates || {}).giftcardCode;
    const tpl = buyer ? own || /** @type {any} */ (TEMPLATES).giftcardCode || GIFT_TEXT : own && !own.includes('{acheteur}') ? own : GIFT_ANON;
    const mid = queueMessage(s, ctx, {
      key: 'giftcard_' + g.id + '_' + n, template: 'giftcardCode', text: tpl, to, cid: g.cid || null,
      vars: { acheteur: buyer, montant: fmtEur(g.balance), code: x.code.trim().toUpperCase(), date: g.expires.split('-').reverse().join('/'), lien: x.link || ctx.meta.siteUrl || '' }
    });
    if (!mid) fail(409, 'not_sent', 'Ce numéro ne peut pas recevoir de SMS du salon.');
    return { id: mid };
  }
};

/** A card lost or whose code leaked: the old code stops working, a new one carries the same balance and expiry. */
export const reissueGiftcard = {
  run(s, input, ctx) {
    ctx.need('sale.refund');
    const g = s.giftcards.get(parse(id(), input.id));
    if (!g) fail(404, 'not_found', 'Carte cadeau introuvable.');
    if (g.status !== 'active') fail(409, 'void', 'Cette carte est déjà annulée.');
    if (g.balance <= 0) fail(409, 'empty', 'Cette carte est épuisée : rien à réémettre.');
    if (g.expires < ctx.local.day) fail(409, 'expired', 'Cette carte a expiré le ' + g.expires.split('-').reverse().join('/') + '.');
    const code = giftCode();
    const gid = ctx.id('gc');
    ctx.emit('giftcard.voided', { id: g.id, reason: 'reissued', replacedBy: gid });
    // the balance moves to the new card: no sale, so no Z counts it again
    ctx.emit('giftcard.issued', { id: gid, codeHash: sha256(normGiftCode(code)), last4: code.slice(-4), amount: g.balance, expires: g.expires, reissueOf: g.id, ...(g.legacy ? { legacy: true } : {}), cid: g.cid || undefined }, { buyer: g.buyer || '', recipient: g.recipient || '' });
    // bought online with its text still to leave: the same text, at the same moment, to the same number, under the new code
    const w = withdrawPlanned(s, ctx, g, 'Carte remplacée');
    const old = w && (String(w.m.body).match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/g) || []).find((c) => sha256(normGiftCode(c)) === g.codeHash);
    const planned = w && old && w.m.to ? queueMessage(s, ctx, {
      key: 'giftshop_' + w.py.id + '_' + gid, template: w.m.template, text: String(w.m.body).split(old).join(code), to: w.m.to, cid: w.m.cid || null, vars: {}, dueAt: w.m.dueAt
    }) : null;
    return { id: gid, code, last4: code.slice(-4), amount: g.balance, expires: g.expires, recipient: g.recipient || '', ...(planned ? { planned: { to: w.m.toMasked, dueAt: w.m.dueAt } } : {}) };
  }
};

export const sendReceipt = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    const sale = s.sales.get(input.saleId);
    if (!sale) fail(404, 'not_found', 'Ticket introuvable.');
    const c = sale.clientId ? s.clients.get(sale.clientId) : null;
    const to = input.phone || (c && c.phone) || '';
    if (!to) fail(400, 'invalid', 'Aucun numéro pour envoyer le reçu.');
    const id = queueMessage(s, ctx, {
      key: 'receipt_' + sale.id + '_' + (input.n || 0), template: 'receipt', to, cid: c ? c.id : null,
      vars: { prenom: c ? c.first : '', ticket: 'T' + String(sale.number).padStart(6, '0'), montant: (sale.totals.due / 100).toFixed(2).replace('.', ',') + ' €', lien: ctx.meta.receiptLink ? ctx.meta.receiptLink(sale) : '' }
    });
    return { id };
  }
};

/* ---------------- the cash drawer ---------------- */

export const openDrawer = {
  run(s, input, ctx) {
    ctx.need('drawer');
    const float = parse(money(500000), input.float);
    if (s.drawer) fail(409, 'open', 'La caisse est déjà ouverte.');
    if (s.closures.has(ctx.local.day)) fail(409, 'day_closed', 'La journée est clôturée.');
    const did = ctx.id('dr');
    ctx.emit('drawer.opened', { id: did, float, day: ctx.local.day });
    return { id: did };
  }
};
export const moveDrawer = {
  run(s, input, ctx) {
    ctx.need('drawer');
    const x = parse(obj({ amount: int({ min: -1000000, max: 1000000 }), reason: str({ min: 2, max: 80 }) }), input);
    if (!s.drawer) fail(409, 'closed', 'La caisse n’est pas ouverte.');
    if (!x.amount) fail(400, 'invalid', 'Indique un montant.');
    if (x.amount < 0 && drawerExpected(s, s.drawer) + x.amount < 0) fail(409, 'invalid', 'Il n’y a pas autant d’espèces dans la caisse.');
    ctx.emit('drawer.moved', { id: ctx.id('dm'), drawerId: s.drawer.id, amount: x.amount, reason: x.reason });
    return { ok: true };
  }
};
export const closeDrawer = {
  run(s, input, ctx) {
    ctx.need('drawer');
    const x = parse(obj({ counts: record(/^\d+$/, int({ min: 0, max: 10000 }), { max: 20 }), note: opt(str({ max: 200 })) }), input);
    if (!s.drawer) fail(409, 'closed', 'La caisse n’est pas ouverte.');
    let counted = 0;
    for (const [k, n] of Object.entries(x.counts)) { if (!DENOMS.includes(+k)) fail(400, 'invalid', 'Coupure inconnue : ' + k); counted += +k * n; }
    const expected = drawerExpected(s, s.drawer);
    const diff = counted - expected;
    if (Math.abs(diff) >= 500 && !x.note) fail(400, 'note', 'Il y a un écart de plus de 5 €. Explique-le en une phrase.', { expected, counted, diff });
    ctx.emit('drawer.closed', { drawerId: s.drawer.id, counted, counts: x.counts, expected, diff, note: x.note || '' });
    return { counted, expected, diff };
  }
};

/* ---------------- Z: the day is sealed ---------------- */

const STILL_TO_COME = new Set(['booked', 'arrived', 'in_chair']);

/**
 * Appointments of the day nobody has finished yet: after the Z they could not be paid. A booking whose time
 * is over and that nobody seated (min given) is a no-show nobody marked: the "unpaid" note covers it.
 */
export function remainingAppts(s, day, min) {
  return [...(s.apptsByDay.get(day) || [])].map((id) => s.appts.get(id)).filter((a) => a && STILL_TO_COME.has(a.status) && !a.saleId && !(a.status === 'booked' && min != null && a.start + a.dur <= min))
    .sort((a, b) => a.start - b.start)
    .map((a) => {
      const c = a.clientId ? s.clients.get(a.clientId) : null;
      return { name: c ? c.first + (c.last ? ' ' + c.last.charAt(0) + '.' : '') : a.name || 'Client', start: a.start, staff: (s.staff.get(a.staffId) || {}).name || '' };
    });
}
/** End of the day's last opening interval, in minutes (0 when the shop is closed that day). */
export function closingMin(s, day) { return Math.max(0, ...shopIntervals(s, day).map((x) => x[1])); }

export const closeDay = {
  run(s, input, ctx) {
    ctx.need('closure');
    const today = ctx.local.day;
    const past = isDay(input.day) && input.day < today;
    const day = past ? input.day : today;
    if (s.closures.has(day)) fail(409, 'closed', 'La journée est déjà clôturée.');
    if (s.drawer && s.drawer.day <= day) fail(409, 'drawer_open', day === today ? 'Compte la caisse avant de clôturer la journée.' : 'La caisse de ce jour-là n’est pas encore comptée. Compte-la avant de clôturer.');
    // Z numbers and the grand total follow the calendar: a forgotten day is sealed before any later one
    const older = (({ close, uncounted }) => [...close, ...uncounted])(missedZ(s, today)).filter((d) => d < day);
    if (older.length) fail(409, 'missed', `La journée de ${dayWords(older[0], today)} n’est pas encore clôturée\u202f: clôture-la d’abord.`, { missed: older });
    // a forgotten day is caught up only if something happened at the till (the demo seeds its own past days)
    if (past && !hadTill(s, day)) fail(409, 'nothing', 'Aucun ticket ce jour-là\u202f: rien à clôturer.');
    let early = false;
    if (!past && ctx.actor.t === 'staff') {
      // after the Z nothing can be paid today: a Z at 15:35 with clients still due is a mistake, unless it is said out loud
      const remaining = remainingAppts(s, day, ctx.local.min);
      const end = closingMin(s, day);
      const open = ctx.local.min < end;
      if (remaining.length || open) {
        if (input.early !== true) {
          const last = remaining[remaining.length - 1], n = remaining.length;
          fail(409, 'too_early', !open
            ? `Il reste ${n} client${n > 1 ? 's' : ''} à encaisser. Après la clôture, plus aucun encaissement aujourd’hui.`
            : n ? `Il reste ${n} rendez-vous aujourd’hui (le dernier à ${fmtTime(last.start)}). Après la clôture, plus aucun encaissement aujourd’hui.`
              : `Le salon est ouvert jusqu’à ${fmtTime(end)}. Après la clôture, plus aucun encaissement aujourd’hui.`, { remaining, closesAt: end, open });
        }
        // "early" is said of the hour only: after closing time, the shop really was closed
        early = open;
      }
    }
    const t = dayTotals(s, day);
    const number = s.closureSeq + 1;
    const grandTotal = s.grandTotal + t.net;
    const backdated = past && ctx.actor.t === 'system' && typeof input.at === 'number' ? { at: input.at } : {};
    ctx.emit('day.closed', { id: ctx.id('zc'), number, ...zRecord(t), grandTotal, ...(early ? { early: true } : {}), ...(past ? { late: true } : {}), ...(past && input.auto === true && ctx.actor.t === 'system' ? { auto: true } : {}), ...backdated });
    return { number, ...t, grandTotal, early, late: past };
  }
};
