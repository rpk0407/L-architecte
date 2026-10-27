// @ts-check
// The till. A ticket is recorded once, numbered without gaps, and never edited:
// a mistake is corrected by a credit note (avoir), the day is sealed by a Z closure.
import { fail } from '../core/engine.js';
import { str, int, opt, obj, arr, id, oneOf, money, record, parse } from '../lib/validate.js';
import { ticketTotals } from '../../shared/money.js';
import { maxDiscountPct } from '../domain/permissions.js';
import { drawerExpected, dayTotals, zRecord, missedZ, hadTill, dayWords } from '../domain/cash.js';
import { getService, getProduct, getClient, getAppt, getStaff } from './common.js';
import { giftCode, normGiftCode, sha256 } from '../lib/util.js';
import { addDays, isDay, fmtTime } from '../../shared/dates.js';
import { shopIntervals } from '../domain/availability.js';
import { DENOMS } from '../../shared/money.js';
import { queueMessage } from '../domain/messages.js';

const lineSchema = obj({
  kind: oneOf(/** @type {const} */ (['service', 'product', 'giftcard', 'pack', 'fee'])), ref: opt(id()), name: opt(str({ max: 60 })),
  qty: opt(int({ min: 1, max: 99 })), unit: opt(money(500000)), discount: opt(money(500000)), staffId: opt(id()), packId: opt(id()),
  recipient: opt(str({ max: 60 })), code: opt(str({ max: 20 }))
});
const paySchema = obj({ method: oneOf(/** @type {const} */ (['card', 'cash', 'online', 'giftcard', 'deposit'])), amount: money(1000000), given: opt(money(1000000)), ref: opt(str({ max: 40 })) });
const checkoutSchema = obj({
  apptId: opt(id()), clientId: opt(id()), lines: arr(lineSchema, { min: 1, max: 30 }),
  discount: opt(obj({ amount: money(500000), reason: opt(str({ max: 80 })) })),
  tip: opt(obj({ amount: money(50000), staffId: id() })),
  payments: arr(paySchema, { min: 1, max: 6 }), note: opt(str({ max: 200 }))
});

const PACK_NEW = 'new';

export const checkout = {
  run(s, input, ctx) {
    ctx.need('sale.create');
    const x = parse(checkoutSchema, input);
    // the demo back-fills past days; nobody else can date a ticket
    const backfill = ctx.actor.t === 'system' && typeof input.day === 'string' && input.day < ctx.local.day ? input.day : null;
    const day = backfill || ctx.local.day;
    if (s.closures.has(day)) fail(409, 'day_closed', 'La journée est clôturée : plus aucun encaissement possible aujourd’hui.');
    const P = s.settings.payments;
    const appt = x.apptId ? getAppt(s, x.apptId) : null;
    if (appt && (appt.status === 'done' || appt.saleId)) fail(409, 'paid', 'Ce rendez-vous est déjà encaissé.');
    if (appt && appt.status === 'cancelled') fail(409, 'cancelled', 'Ce rendez-vous est annulé.');
    const client = x.clientId ? getClient(s, x.clientId) : appt && appt.clientId ? getClient(s, appt.clientId) : null;
    const performer = (l) => l.staffId || (appt && appt.staffId) || (ctx.staff && ctx.staff.id) || null;
    const isBoss = ctx.staff && ['owner', 'manager'].includes(ctx.staff.role);

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
    for (const l of x.lines) {
      const qty = l.qty || 1;
      if (l.kind === 'service') {
        const sv = getService(s, l.ref || '');
        let unit = l.unit ?? sv.price;
        if (unit !== sv.price && !(sv.from && unit >= sv.price) && !isBoss) fail(403, 'price', `Le prix de « ${sv.name} » est fixé à la carte. Utilise une remise.`);
        let name = sv.name, packId = null;
        if (l.packId) {
          const pk = l.packId === PACK_NEW ? newPack : s.packs.get(l.packId);
          if (!pk) fail(404, 'not_found', 'Abonnement introuvable.');
          if (!client || pk.clientId !== client.id) fail(409, 'pack_owner', 'Cet abonnement appartient à un autre client.');
          const used = (l.packId === PACK_NEW ? 0 : pk.used) + (packUses.get(pk.id) || 0);
          if (used + qty > pk.total) fail(409, 'pack_empty', 'Il ne reste plus de coupe sur cet abonnement.');
          if (pk.expires < day) fail(409, 'pack_expired', 'Cet abonnement a expiré.');
          if (pk.serviceIds.length && !pk.serviceIds.includes(sv.id)) fail(409, 'pack_service', `L’abonnement ne couvre pas « ${sv.name} ».`);
          packUses.set(pk.id, (packUses.get(pk.id) || 0) + qty);
          unit = 0; packId = pk.id; name = sv.name + ' · abonnement ' + (used + qty) + '/' + pk.total;
        }
        lines.push({ kind: 'service', ref: sv.id, name, qty, unit, discount: l.discount || 0, staffId: performer(l), vat: sv.vat ?? P.vat, packId, category: sv.category });
      } else if (l.kind === 'product') {
        const p = getProduct(s, l.ref || '');
        if (!p.active) fail(409, 'inactive', `« ${p.name} » n’est plus en vente.`);
        lines.push({ kind: 'product', ref: p.id, name: p.name, qty, unit: p.price, discount: l.discount || 0, staffId: performer(l), vat: p.vat ?? P.vat, cost: p.cost || 0 });
      } else if (l.kind === 'giftcard') {
        if (!P.giftcard) fail(409, 'off', 'Les cartes cadeaux sont désactivées.');
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
        if (!g || g.status !== 'active') fail(404, 'giftcard', 'Carte cadeau inconnue.');
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
      lines: lines.map((l, i) => ({ ...l, net: totals.nets[i] })), discount: x.discount ? { amount: discount, reason: x.discount.reason || '' } : null,
      tip: totals.tip ? { amount: totals.tip, staffId: /** @type {any} */ (x.tip).staffId } : null, totals: { gross: totals.gross, discount: totals.discount, total: totals.total, tip: totals.tip, due: totals.due, revenue: totals.revenue, revenueHT: totals.revenueHT, liability: totals.liability, vat: totals.vat },
      payments, note: x.note || '', ...(backfill ? { at: input.at } : {}), ...(ctx.actor.t === 'system' ? { demo: true } : {})
    });
    for (const l of lines) if (l.kind === 'product') ctx.emit('stock.adjusted', { productId: l.ref, delta: -l.qty, reason: 'Vente', saleId: sid, name: l.name });
    for (const g of issued) {
      ctx.emit('giftcard.issued', { id: g.id, codeHash: sha256(normGiftCode(g.code)), last4: g.code.slice(-4), amount: g.amount, saleId: sid, expires: addDays(day, 365), cid: client ? client.id : undefined }, { buyer: client ? client.first + ' ' + client.last : '', recipient: g.recipient });
    }
    for (const r of redeem) ctx.emit('giftcard.redeemed', { id: r.id, amount: r.amount, saleId: sid });
    if (newPack) ctx.emit('pack.sold', { ...newPack, saleId: sid, cid: newPack.clientId });
    for (const [pid, n] of packUses) for (let i = 0; i < n; i++) ctx.emit('pack.used', { id: pid, saleId: sid });
    const change = payments.reduce((t, p) => t + (p.change || 0), 0);
    return { id: sid, number, totals, change, giftcards: issued.map((g) => ({ code: g.code, amount: g.amount, recipient: g.recipient })) };
  }
};

const refundSchema = obj({ saleId: id(), amount: money(1000000), method: oneOf(/** @type {const} */ (['cash', 'card', 'online'])), reason: str({ min: 3, max: 120 }), restock: opt(arr(obj({ productId: id(), qty: int({ min: 1, max: 99 }) }), { max: 20 })), providerRef: opt(str({ max: 80 })) });
export const refund = {
  run(s, input, ctx) {
    ctx.need('sale.refund');
    const x = parse(refundSchema, input);
    const sale = s.sales.get(x.saleId);
    if (!sale) fail(404, 'not_found', 'Ticket introuvable.');
    const day = ctx.local.day;
    if (s.closures.has(day)) fail(409, 'day_closed', 'La journée est clôturée.');
    const refundedRevenue = sale.refundIds.reduce((t, rid) => t + (s.refunds.get(rid)?.amount || 0), 0);
    const left = sale.totals.revenue - refundedRevenue;
    if (x.amount <= 0 || x.amount > left) fail(400, 'invalid', 'Montant remboursable au maximum : ' + (left / 100).toFixed(2).replace('.', ',') + ' €.', { left });
    if (x.method === 'cash' && !s.drawer) fail(409, 'drawer_closed', 'Ouvre la caisse pour rembourser en espèces.');
    if (x.method === 'online' && !sale.payments.some((p) => p.method === 'online' || p.method === 'deposit')) fail(400, 'invalid', 'Ce ticket n’a pas été payé en ligne.');
    const ratio = x.amount / sale.totals.revenue;
    let rest = x.amount;
    const vat = sale.totals.vat.map((r, i, all) => {
      const ttc = i === all.length - 1 ? rest : Math.round((r.base + r.tax) * ratio);
      rest -= ttc;
      const base = r.rate ? Math.round((ttc * 10000) / (10000 + r.rate)) : ttc;
      return { rate: r.rate, base, tax: ttc - base };
    });
    const rid = ctx.id('rf');
    const number = s.refundSeq + 1;
    ctx.emit('sale.refunded', { id: rid, number, saleId: sale.id, saleNumber: sale.number, day, amount: x.amount, method: x.method, reason: x.reason, vat, drawerId: x.method === 'cash' ? s.drawer.id : null, providerRef: x.providerRef || null, cid: sale.clientId || undefined });
    for (const r of x.restock || []) ctx.emit('stock.adjusted', { productId: getProduct(s, r.productId).id, delta: r.qty, reason: 'Retour', saleId: sale.id, name: getProduct(s, r.productId).name });
    return { id: rid, number };
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
