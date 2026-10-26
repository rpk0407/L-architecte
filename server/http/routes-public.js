// @ts-check
// The public API: what the client site and the "mon rendez-vous" page use. No account, no personal data out.
import { HttpError, guard, json } from './kit.js';
import { serviceView, staffView } from './views.js';
import { freeSlots, walkinEstimate, shopIntervals } from '../domain/availability.js';
import { clientMayChange } from '../domain/policy.js';
import { signLink, checkLink } from '../auth/session.js';
import { addDays, isDay, diffDays } from '../../shared/dates.js';
import { newId } from '../lib/util.js';
import * as A from '../commands/agenda.js';
import { createPayment, paymentSucceeded, paymentEnded } from '../commands/payments.js';
import { ticketNo } from '../domain/cash.js';
import { maybeTick } from './scheduler.js';
import { waitUntil } from '@vercel/functions';

const CLIENT = (r, n) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: n || '' }), caps: new Set(), meta: r.meta });
const PROVIDER = (r, id) => ({ actor: /** @type {const} */ ({ t: 'provider', id }), caps: new Set(), meta: r.meta });

function isOpenNow(s, L) { return shopIntervals(s, L.day).some(([a, b]) => L.min >= a && L.min < b); }

function bookingView(r, a) {
  const s = r.s;
  const st = s.staff.get(a.staffId);
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  const pay = a.deposit && a.deposit.paymentId ? s.payments.get(a.deposit.paymentId) : [...s.payments.values()].find((p) => p.apptId === a.id && p.kind === 'deposit' && p.status === 'pending');
  return {
    code: a.code, status: a.status, day: a.day, start: a.start, dur: a.dur, services: a.services.map((x) => ({ id: x.id, name: x.name, price: x.price, from: x.from })), price: a.price,
    staff: st ? { id: st.id, name: st.name, initials: st.initials, color: st.color } : null, anyStaff: a.anyStaff, first: c ? c.first : '',
    deposit: a.deposit ? { amount: a.deposit.amount, paid: a.deposit.paid || 0, url: pay && pay.status === 'pending' ? pay.url : null } : null,
    canChange: ['booked', 'pending'].includes(a.status) && clientMayChange(s, a, r.rt.engine.clock()), cancelUntilHours: s.settings.booking.cancelUntilHours,
    shop: { name: s.settings.shop.name, address: s.settings.shop.address + ', ' + s.settings.shop.zip + ' ' + s.settings.shop.city, phone: s.settings.shop.phone, mapsUrl: s.settings.shop.mapsUrl },
    cancelled: a.cancel ? { by: a.cancel.by, at: a.cancel.at } : null
  };
}

function apptFromToken(r) {
  const code = checkLink(r.rt.secret, 'appt', r.params.token);
  const id = code ? r.s.apptByCode.get(code) : null;
  const a = id ? r.s.appts.get(id) : null;
  if (!a) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  return a;
}

/**
 * Ask the provider for a checkout page and record it.
 * @param {any} r
 * @param {{ kind: string, amount: number, label: string, apptId: string|null, returnPath: string, email?: string }} o
 */
export async function startPayment(r, { kind, amount, label, apptId, returnPath, email }) {
  const id = newId('py');
  const origin = r.origin;
  const co = await r.rt.pay.createCheckout({ id, amount, label, email, successUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=ok', cancelUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=annule' });
  await r.rt.engine.run(createPayment, { id, kind, amount, provider: r.rt.pay.name, providerRef: co.ref, url: co.url, apptId, exp: co.exp, label }, { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']), meta: r.meta });
  return { id, url: co.url };
}

/** Give back an online deposit (timely cancellation, payment after expiry). */
export async function refundOnline(r, payment, reason) {
  if (!payment || payment.status !== 'paid') return false;
  try {
    if (payment.chargeRef || r.rt.pay.name === 'simulated') await r.rt.pay.refund(payment.chargeRef || payment.providerRef, payment.amount, payment.id);
    await r.rt.engine.run(paymentEnded, { id: payment.id, status: 'refunded', reason }, PROVIDER(r, r.rt.pay.name));
    return true;
  } catch (e) { console.error('[lx] refund failed', e && e.message); return false; }
}

/** Client traffic carries the reminders too, so they leave even when no one has the Comptoir open (at most once a minute). */
function background(r) { const t = maybeTick(r.rt, r.meta); if (t) waitUntil(t); }

export function publicRoutes(app) {
  app.get('/api/public/salon', (r) => {
    const s = r.s;
    const L = r.local;
    const services = [...s.services.values()].filter((x) => x.active && x.online !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(serviceView);
    const barbers = [...s.staff.values()].filter((x) => x.active && x.chair && x.bookable).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((x) => staffView(x));
    const b = s.settings.booking;
    return json({
      shop: { ...s.settings.shop }, hours: s.settings.hours, closures: s.settings.closures.filter((c) => c.to >= L.day),
      booking: { enabled: b.enabled, stepMin: b.stepMin, minNoticeMin: b.minNoticeMin, maxDaysAhead: b.maxDaysAhead, holdMin: b.holdMin, cancelUntilHours: b.cancelUntilHours, waitlist: b.waitlist, walkinWait: b.walkinWait },
      deposits: s.settings.deposits, services, barbers, payments: { provider: r.rt.pay.name }, mode: s.mode, today: L.day, now: r.now
    }, 200, { 'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=60' });
  });

  app.get('/api/public/live', (r) => {
    const s = r.s, L = r.local;
    background(r);
    const open = isOpenNow(s, L);
    const est = open && s.settings.booking.walkinWait ? walkinEstimate(s, r.now, L) : { minutes: null, queued: 0 };
    return json({ open, waitMin: est.minutes, queued: est.queued, today: L.day, min: L.min }, 200, { 'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' });
  });

  app.get('/api/public/availability', (r) => {
    const s = r.s, L = r.local;
    background(r);
    const q = r.query;
    const from = isDay(q.get('from') || '') ? /** @type {string} */ (q.get('from')) : L.day;
    const days = Math.max(1, Math.min(14, Number(q.get('days')) || 10));
    const ids = String(q.get('services') || '').split(',').filter(Boolean).slice(0, 4);
    const staffId = q.get('staff') || 'any';
    if (!ids.length) throw new HttpError(400, 'invalid', 'Choisis une prestation.');
    const services = ids.map((id) => s.services.get(id)).filter((x) => x && x.active && x.online !== false);
    if (services.length !== ids.length) throw new HttpError(404, 'not_found', 'Prestation introuvable.');
    const dur = services.reduce((t, x) => t + x.dur, 0) + Math.max(0, ...services.map((x) => x.buffer || 0));
    let ignoreAppt = null;
    if (q.get('move')) { const code = checkLink(r.rt.secret, 'appt', q.get('move')); ignoreAppt = code ? r.s.apptByCode.get(code) || null : null; }
    const out = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      if (diffDays(L.day, day) > s.settings.booking.maxDaysAhead) break;
      const slots = freeSlots(s, { day, dur, serviceIds: ids, staffId, now: r.now, local: L, online: true, ignoreAppt, ignoreHold: q.get('hold') || null });
      out.push({ day, open: shopIntervals(s, day).length > 0, slots: slots.map((x) => ({ m: x.m, s: x.staffId })) });
    }
    const cacheable = !ignoreAppt && !q.get('hold');
    return json({ dur, days: out, now: r.now }, 200, { 'cache-control': cacheable ? 'public, max-age=0, s-maxage=5, stale-while-revalidate=10' : 'no-store' });
  });

  app.post('/api/public/holds', async (r) => {
    guard('hold|' + r.ip, 30, 60000);
    return r.rt.engine.run(A.holdSlot, r.body, CLIENT(r));
  });
  app.del('/api/public/holds/:id', async (r) => r.rt.engine.run(A.releaseHold, { id: r.params.id }, CLIENT(r)));

  app.post('/api/public/bookings', async (r) => {
    guard('book|' + r.ip, 6, 60000, 'Trop de réservations d’un coup. Patiente une minute.');
    guard('bookh|' + r.ip, 30, 3600000, 'Trop de réservations depuis cet appareil. Appelle le salon.');
    const res = await r.rt.engine.run(A.bookOnline, { ...r.body, demo: undefined }, CLIENT(r, r.body && r.body.first));
    const token = signLink(r.rt.secret, 'appt', res.code);
    let payment = null;
    if (res.status === 'pending' && res.deposit > 0) {
      const sv = r.s.appts.get(res.id);
      payment = await startPayment(r, { kind: 'deposit', amount: res.deposit, label: 'Acompte · ' + sv.services.map((x) => x.name).join(' + '), apptId: res.id, returnPath: '/r/' + token, email: r.body.email });
    }
    return json({ code: res.code, token, manage: r.origin + '/r/' + token, status: res.status, deposit: res.deposit, staffId: res.staffId, payment }, 201);
  });

  app.get('/api/public/bookings/:token', (r) => bookingView(r, apptFromToken(r)));

  app.post('/api/public/bookings/:token/cancel', async (r) => {
    guard('cx|' + r.ip, 10, 60000);
    const a = apptFromToken(r);
    const res = await r.rt.engine.run(A.cancelByClient, { id: a.id, reason: r.body && r.body.reason }, CLIENT(r));
    if (res.deposit && res.deposit.paymentId) await refundOnline(r, r.s.payments.get(res.deposit.paymentId), 'Annulation dans les délais');
    return bookingView(r, r.s.appts.get(a.id));
  });

  app.post('/api/public/bookings/:token/move', async (r) => {
    guard('mv|' + r.ip, 10, 60000);
    const a = apptFromToken(r);
    await r.rt.engine.run(A.moveByClient, { id: a.id, day: r.body.day, start: r.body.start, holdId: r.body.holdId }, CLIENT(r));
    return bookingView(r, r.s.appts.get(a.id));
  });

  app.post('/api/public/bookings/:token/pay', async (r) => {
    guard('pay|' + r.ip, 10, 60000);
    const a = apptFromToken(r);
    if (a.status !== 'pending' || !a.deposit) throw new HttpError(409, 'nothing', 'Rien à régler pour ce rendez-vous.');
    const open = [...r.s.payments.values()].find((p) => p.apptId === a.id && p.kind === 'deposit' && p.status === 'pending' && p.exp > r.now + 120000);
    if (open) return { url: open.url };
    const p = await startPayment(r, { kind: 'deposit', amount: a.deposit.amount, label: 'Acompte · ' + a.services.map((x) => x.name).join(' + '), apptId: a.id, returnPath: '/r/' + r.params.token });
    return { url: p.url };
  });

  app.post('/api/public/waitlist', async (r) => {
    guard('wl|' + r.ip, 5, 60000);
    return r.rt.engine.run(A.addWait, r.body, CLIENT(r));
  });

  app.get('/api/public/offers/:token', (r) => {
    const id = checkLink(r.rt.secret, 'offer', r.params.token);
    const w = id ? r.s.waitlist.get(id) : null;
    if (!w || w.status !== 'offered' || !w.offer || w.offer.exp < r.now) throw new HttpError(410, 'expired', 'Cette place n’est plus disponible. Tu restes sur la liste d’attente.');
    return { serviceId: w.serviceId, staffId: w.offer.staffId, day: w.day, start: w.offer.start, holdId: w.offer.holdId, exp: w.offer.exp, first: w.first };
  });

  app.get('/api/public/payments/:id', (r) => {
    const p = r.s.payments.get(r.params.id);
    if (!p) throw new HttpError(404, 'not_found', 'Paiement introuvable.');
    const a = p.apptId ? r.s.appts.get(p.apptId) : null;
    return { id: p.id, status: p.status, amount: p.amount, label: p.label, kind: p.kind, provider: p.provider, exp: p.exp, shop: r.s.settings.shop.name, back: a ? '/r/' + signLink(r.rt.secret, 'appt', a.code) : null };
  });

  app.post('/api/public/payments/:id/simulate', async (r) => {
    guard('sim|' + r.ip, 20, 60000);
    if (r.rt.pay.name !== 'simulated') throw new HttpError(404, 'not_found', 'Indisponible.');
    const p = r.s.payments.get(r.params.id);
    if (!p || p.status !== 'pending') throw new HttpError(409, 'closed', 'Ce paiement n’est plus en attente.');
    if (r.body && r.body.outcome === 'cancel') { await r.rt.engine.run(paymentEnded, { id: p.id, status: 'failed', reason: 'Annulé par le client' }, PROVIDER(r, 'simulated')); }
    else await afterProviderPaid(r, { ref: p.providerRef, amount: p.amount, chargeRef: 'sim_ch_' + p.id }, 'simulated');
    return { status: r.s.payments.get(p.id).status };
  });

  app.get('/api/public/receipts/:token', (r) => {
    const num = checkLink(r.rt.secret, 'receipt', r.params.token);
    const x = num ? [...r.s.sales.values()].find((y) => String(y.number) === num) : null;
    if (!x) throw new HttpError(404, 'not_found', 'Reçu introuvable.');
    const c = x.clientId ? r.s.clients.get(x.clientId) : null;
    const sh = r.s.settings.shop;
    return {
      ref: ticketNo(x.number), day: x.day, at: x.at, first: c ? c.first : '',
      shop: { name: sh.name, legalName: sh.legalName, address: sh.address + ', ' + sh.zip + ' ' + sh.city, siret: sh.siret, vatNumber: sh.vatNumber },
      lines: x.lines.map((l) => ({ name: l.name, qty: l.qty, net: l.net })), totals: x.totals, discount: x.discount, tip: x.tip,
      payments: x.payments.map((p) => ({ method: p.method, amount: p.amount })), refunded: x.refunded, footer: r.s.settings.payments.receiptFooter
    };
  });

  app.post('/api/stripe/webhook', async (r) => {
    const ev = r.rt.pay.parseWebhook(r.raw, r.req.headers.get('stripe-signature'));
    if (!ev) return { received: true };
    const pid = r.s.paymentByRef.get(ev.ref);
    if (!pid) return { received: true, unknown: true };
    if (ev.kind === 'paid') await afterProviderPaid(r, ev, 'stripe');
    else await r.rt.engine.run(paymentEnded, { id: pid, status: ev.kind === 'expired' ? 'expired' : 'failed' }, PROVIDER(r, 'stripe'));
    return { received: true };
  }, { raw: true, csrf: false });
}

/** A payment went through: record it; if its booking expired meanwhile, give the money back. */
async function afterProviderPaid(r, ev, provider) {
  const res = await r.rt.engine.run(paymentSucceeded, { providerRef: ev.ref, amount: ev.amount, chargeRef: ev.chargeRef, pm: ev.pm, customer: ev.customer }, PROVIDER(r, provider));
  if (res && res.late) {
    const p = r.s.payments.get(r.s.paymentByRef.get(ev.ref));
    await refundOnline(r, p, 'Réservation expirée avant le paiement');
  }
  return res;
}
