// @ts-check
// The public API: what the client site and the "mon rendez-vous" page use. No account, no personal data out.
import { HttpError, guard, json } from './kit.js';
import { serviceView, staffView } from './views.js';
import { freeSlots, walkinEstimate, shopIntervals, staffIntervals, UNDECIDED } from '../domain/availability.js';
import { clientMayChange, payWindowMin, payDeadline } from '../domain/policy.js';
import { signLink, checkLink } from '../auth/session.js';
import { addDays, isDay, diffDays, dayLong } from '../../shared/dates.js';
import { newId, safeEqual } from '../lib/util.js';
import * as A from '../commands/agenda.js';
import { createPayment, paymentSucceeded, paymentEnded } from '../commands/payments.js';
import { ticketNo } from '../domain/cash.js';
import { smsOptOut } from '../commands/messages.js';
import { smsReply, smsReport } from '../commands/sms-inbound.js';
import { webhookKey, parseSmsWebhook } from '../messaging/sms.js';
import { maybeTick } from './scheduler.js';
import { hoursText, closedText } from '../settings/hours.js';
import { waitUntil } from '@vercel/functions';
import { fulfilGiftcard } from './routes-giftshop.js';
import { providerFor, providerLabel } from '../payments/provider.js';
import { providerKnown } from '../projections/payments.js';
import { memberPaid, endMember } from '../commands/memberships.js';
import { addMonths, abandoned } from '../domain/membership.js';
import { BILLING } from '../payments/billing.js';
import { memberScheduled, startDayOf } from '../commands/member-billing.js';
import { fmtEur } from '../../shared/money.js';
import { claimFromLink } from './routes-loyalty.js';
import { receiptLoyalty } from '../domain/loyalty.js';

/** The demo, for real: both the configuration and the journal say so (a demo journal opened in production is not one). */
export const isDemo = (r) => r.rt.cfg.mode === 'demo' && r.s.mode === 'demo';
/** Can a client really pay online? The simulated provider only takes demo money. */
export const payLive = (r) => r.rt.pay.name !== 'simulated' || isDemo(r);
// the actor is chained and can never be erased: no name in it, ever (the client's details travel as pii)
const CLIENT = (r) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...r.meta, payLive: payLive(r), payProvider: r.rt.pay.name } });
const PROVIDER = (r, id) => ({ actor: /** @type {const} */ ({ t: 'provider', id }), caps: new Set(), meta: r.meta });

// once today's Z is done (an early close), the shop takes nobody else: the site stops saying "Ouvert"
function isOpenNow(s, L) { return !s.closures.has(L.day) && shopIntervals(s, L.day).some(([a, b]) => L.min >= a && L.min < b); }

/**
 * What the site may say of a barber who is away today: only when the absence carries a public note (DO-05's
 * publicNote, its text or true for the plain 'JKut revient le …'). Back-to-back absences read as one.
 * @returns {{ until: string, back: string|null, note: string }|null}
 */
export function awayOf(s, st, today) {
  const off = [...s.timeoff.values()].filter((t) => t.staffId === st.id && (t.startMin == null || t.from !== t.to) && !UNDECIDED.has(t.status));
  const cur = off.find((t) => t.from <= today && t.to >= today && t.publicNote);
  if (!cur) return null;
  let until = cur.to;
  for (let more = true; more;) { more = false; for (const t of off) if (t.from <= addDays(until, 1) && t.to > until) { until = t.to; more = true; } }
  let back = null;
  for (let i = 1; i <= 60 && !back; i++) { const d = addDays(until, i); if (staffIntervals(s, st.id, d).length) back = d; }
  const own = typeof cur.publicNote === 'string' ? cur.publicNote.trim().slice(0, 120) : '';
  const note = own || (back ? st.name + ' revient le ' + dayLong(back) : '');
  return note ? { until, back, note } : null;
}

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
  if (!payLive(r)) throw new HttpError(409, 'no_provider', 'Le paiement en ligne n’est pas branché (Stripe).');
  const id = newId('py');
  const origin = r.origin;
  const payMin = kind === 'deposit' ? payWindowMin(r.s, { stripe: r.rt.pay.name === 'stripe' }) : undefined;
  const co = await r.rt.pay.createCheckout({ id, amount, label, email, payMin, successUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=ok', cancelUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=annule' });
  await r.rt.engine.run(createPayment, { id, kind, amount, provider: r.rt.pay.name, providerRef: co.ref, url: co.url, apptId, exp: co.exp, label }, { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']), meta: r.meta });
  return { id, url: co.url };
}

/**
 * Give back an online payment (a timely cancellation, a payment after expiry, a deposit the salon gives back): all of
 * what is left of it, or `amount`, through the provider it was paid with (never whichever is plugged in now). A
 * payment recorded before its charge was known asks the provider for it rather than skipping the refund. ok: the
 * money went back; error: why not, in the provider's words for the Comptoir (« Acompte non remboursé chez Stripe : … »),
 * and the payment stays paid.
 * @param {any} r @param {any} payment @param {string} reason @param {number} [amount]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function refundOnline(r, payment, reason, amount) {
  if (!payment || payment.status !== 'paid') return { ok: false, error: 'ce paiement n’est pas réglé' };
  const done = providerKnown(r.s, payment);
  const left = payment.amount - done;
  const amt = amount == null ? left : Math.min(amount, left);
  if (!(amt > 0)) return { ok: false, error: 'déjà remboursé' };
  let prov;
  try {
    prov = providerFor(r.rt, payment.provider || r.rt.pay.name);
    let charge = payment.chargeRef || '';
    if (!charge && prov.name !== 'simulated') charge = (await prov.retrieveCharge(payment.providerRef)).chargeRef || '';
    if (!charge && prov.name !== 'simulated') throw new Error('paiement introuvable chez ' + providerLabel(prov.name));
    // the whole payment keeps the key it always had, so a retry never refunds twice; a part is keyed by what went back before
    await prov.refund(charge || payment.providerRef, amt, payment.id + (amt === payment.amount ? '' : '-' + done));
  } catch (e) {
    const why = (e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message)) || 'erreur';
    console.error('[lx] refund failed', payment.id, why);
    return { ok: false, error: why };
  }
  // the money is back: if this record fails, the provider's refund notice writes it (payments/handlers.js refunded)
  try { await r.rt.engine.run(paymentEnded, { id: payment.id, status: 'refunded', reason, ...(amt < payment.amount ? { amount: amt } : {}) }, PROVIDER(r, prov.name)); }
  catch (e) { console.error('[lx] refund not recorded', payment.id, e && /** @type {any} */ (e).message); }
  return { ok: true };
}

/** Client traffic carries the reminders too, so they leave even when no one has the Comptoir open (at most once a minute). */
function background(r) { const t = maybeTick(r.rt, r.meta); if (t) waitUntil(t); }

export function publicRoutes(app) {
  app.get('/api/public/salon', (r) => {
    const s = r.s;
    const L = r.local;
    const live = payLive(r);
    // no online payment: no deposit is asked, so the site must not announce one either
    const active = [...s.services.values()].filter((x) => x.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const services = active.filter((x) => x.online !== false).map((x) => (live ? serviceView(x) : { ...serviceView(x), deposit: 0 }));
    // the whole price list (the CGV show it, the site's FAQ quotes it): booked at the salon only when online is false
    const menu = active.map((x) => ({ slug: x.slug || null, name: x.name, category: x.category, price: x.price, from: !!x.from, dur: x.dur, online: x.online !== false }));
    const chairs = [...s.staff.values()].filter((x) => x.active && x.chair && x.bookable).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    // the team's photo (TEAM-02) is the Comptoir's, not the site's
    const barbers = chairs.map((x) => ({ ...staffView(x), photo: undefined, away: awayOf(s, x, L.day) }));
    // the days it opens when it usually doesn't, or with other hours; one a closure covers is closed (it wins, as in
    // availability.js), and one for named barbers nobody can be booked on (archived, all away) is not announced
    const closures = s.settings.closures.filter((c) => c.to >= L.day);
    const openings = (s.settings.openings || []).filter((o) => o.day >= L.day && !closures.some((c) => o.day >= c.from && o.day <= c.to) && (!Array.isArray(o.staff) || chairs.some((x) => staffIntervals(s, x.id, o.day).length))).map((o) => ({ day: o.day, intervals: o.intervals, label: o.label }));
    const b = s.settings.booking;
    return json({
      // the hours in words too, for every place the site writes them (footer, FAQ, description)
      shop: { ...s.settings.shop }, hours: s.settings.hours, hoursText: hoursText(s.settings.hours), closedText: closedText(s.settings.hours), closures, openings,
      booking: { enabled: b.enabled, stepMin: b.stepMin, minNoticeMin: b.minNoticeMin, maxDaysAhead: b.maxDaysAhead, holdMin: b.holdMin, pendingPayMin: payWindowMin(s, { stripe: r.rt.pay.name === 'stripe' }), cancelUntilHours: b.cancelUntilHours, waitlist: b.waitlist, walkinWait: b.walkinWait },
      // sms: does a text really leave? payments.live: is a deposit really taken online? (false: the site books without one)
      deposits: live ? s.settings.deposits : { ...s.settings.deposits, mode: 'none' }, services, menu, barbers, sms: !!r.rt.sms || isDemo(r), payments: { provider: r.rt.pay.name, live }, mode: s.mode, today: L.day, now: r.now
    }, 200, { 'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=60' });
  });

  app.get('/api/public/live', (r) => {
    const s = r.s, L = r.local;
    background(r);
    const open = isOpenNow(s, L);
    const est = open && s.settings.booking.walkinWait ? walkinEstimate(s, r.now, L) : { minutes: null, queued: 0 };
    return json({ open, closedToday: s.closures.has(L.day), waitMin: est.minutes, queued: est.queued, today: L.day, min: L.min }, 200, { 'cache-control': 'public, max-age=0, s-maxage=15' });
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
      // a day sealed early (Z done) is closed, not "complet"
      out.push({ day, open: !s.closures.has(day) && shopIntervals(s, day).length > 0, slots: slots.map((x) => ({ m: x.m, s: x.staffId })) });
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
    const res = await r.rt.engine.run(A.bookOnline, { ...r.body, demo: undefined }, CLIENT(r));
    const token = signLink(r.rt.secret, 'appt', res.code);
    let payment = null;
    if (res.status === 'pending' && res.deposit > 0) {
      const sv = r.s.appts.get(res.id);
      payment = await startPayment(r, { kind: 'deposit', amount: res.deposit, label: 'Acompte · ' + sv.services.map((x) => x.name).join(' + '), apptId: res.id, returnPath: '/r/' + token, email: r.body.email });
    }
    // FID-02: a booking that came through a referrer's link (?parrain=); a refusal never touches the booking
    const ref = r.body && r.body.parrain ? await claimFromLink(r, res.id, r.body.parrain) : null;
    return json({ code: res.code, token, manage: r.origin + '/r/' + token, status: res.status, deposit: res.deposit, staffId: res.staffId, payment, ...(ref ? { referral: { ok: !!ref.ok, why: ref.ok ? null : ref.why } } : {}) }, 201);
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
    // a new checkout page would outlive the booking's hold: the client would pay for a slot already given back
    if (payDeadline(r.s, a) - r.now < 120000) throw new HttpError(409, 'late', 'Le délai pour régler l’acompte est dépassé. Réserve un autre créneau.');
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
    // a membership's test checkout (PAY-03: simulated.js createSubscription points here with the member's id)
    const m = !p && r.s.members ? r.s.members.get(r.params.id) : null;
    if (m) return memberCheckout(r, m);
    if (!p) throw new HttpError(404, 'not_found', 'Paiement introuvable.');
    const a = p.apptId ? r.s.appts.get(p.apptId) : null;
    return { id: p.id, status: p.status, amount: p.amount, label: p.label, kind: p.kind, provider: p.provider, exp: p.exp, shop: r.s.settings.shop.name, back: a ? '/r/' + signLink(r.rt.secret, 'appt', a.code) : null };
  });

  app.post('/api/public/payments/:id/simulate', async (r) => {
    guard('sim|' + r.ip, 20, 60000);
    // the test checkout only exists in the demo: in production it would confirm deposits nobody paid
    if (r.rt.pay.name !== 'simulated' || !isDemo(r)) throw new HttpError(404, 'not_found', 'Indisponible.');
    const m = r.s.members ? r.s.members.get(r.params.id) : null;
    if (m && m.provider === 'simulated') return simulateMember(r, m);
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
      payments: x.payments.map((p) => ({ method: p.method, amount: p.amount })), refunded: x.refunded, footer: r.s.settings.payments.receiptFooter,
      loyalty: receiptLoyalty(r.s, x, r.local.day)
    };
  });

  /**
   * Brevo (unsubscribe event, reply STOP), Twilio (inbound STOP) or the salon's phone (sms:received STOP): that client
   * gets no more offers. The salon's phone also brings the clients' other answers (Relances › Demandes) and its
   * delivery reports (the outbox).
   */
  app.post('/api/sms/webhook', async (r) => {
    guard('smswh|' + r.ip, 120, 60000);
    const key = webhookKey(r.rt.cfg.cronSecret);
    if (!key) throw new HttpError(404, 'not_found', 'Indisponible.');
    if (!safeEqual(r.query.get('k') || '', key)) throw new HttpError(401, 'unauthorized', 'Non autorisé.');
    const events = parseSmsWebhook(r.raw, r.req.headers.get('content-type'));
    const ctx = PROVIDER(r, r.rt.sms ? r.rt.sms.name : 'sms');
    let replied = 0;
    for (const ev of events) {
      if (ev.reply && (await r.rt.engine.run(smsReply, ev.reply, ctx)).ok) replied++;
      if (ev.report) await r.rt.engine.run(smsReport, ev.report, ctx);
    }
    const stops = events.filter((ev) => ev.stop);
    if (!stops.length) return replied ? { received: true, replied: true } : { received: true };
    let optedOut = 0;
    for (const ev of stops) {
      for (const phone of ev.phones) {
        const res = await r.rt.engine.run(smsOptOut, { phone }, ctx);
        if (res.found) { optedOut++; break; }
      }
    }
    return optedOut ? { received: true, optedOut: true } : { received: true, unknown: true };
  }, { raw: true, csrf: false });
}

/**
 * What the test checkout page shows of a membership: « Abonnement Essentiel · 34 €/mois », and when it starts (start:
 * the day of a start not asked for now; scheduled: that start confirmed, nothing paid yet).
 */
function memberCheckout(r, m) {
  const scheduled = !m.activatedAt && !m.ended && !m.startNow && r.s.messages.has('msg_msched_' + m.id);
  const status = m.activatedAt ? 'paid' : scheduled ? 'scheduled' : m.ended || abandoned(m, r.now) ? 'expired' : 'pending';
  // the page says the start day under it (start), so the label stays the plan's
  const label = 'Abonnement ' + m.name + ' · ' + fmtEur(m.price) + '/mois';
  return { id: m.id, status, amount: m.price, label, kind: 'membership', provider: m.provider, exp: m.exp, shop: r.s.settings.shop.name, back: null, start: m.startNow ? null : startDayOf(m) };
}

/**
 * The demo's test checkout of a membership: confirmed, its first month is paid as Stripe's first invoice would be
 * (invoice sim_<id>_0, the numbering the demo's billing goes on with, steps/sim-billing.js); cancelled, the member
 * ends unpaid (abandoned). A start in 14 days pays nothing now, as with Stripe: the contract's confirmation leaves by
 * e-mail (memberScheduled), and the demo's billing pays the first month on the start day.
 */
async function simulateMember(r, m) {
  if (m.activatedAt || m.ended) throw new HttpError(409, 'closed', 'Ce paiement n’est plus en attente.');
  if (r.body && r.body.outcome === 'cancel') {
    if (r.s.messages.has('msg_msched_' + m.id)) throw new HttpError(409, 'closed', 'Cet abonnement est déjà enregistré : il s’annule depuis sa page.');
    await r.rt.engine.run(endMember, { id: m.id, reason: 'abandoned' }, BILLING(r));
    return { status: 'failed' };
  }
  if (!m.startNow) {
    await r.rt.engine.run(memberScheduled, { id: m.id }, BILLING(r));
    return { status: 'scheduled', start: startDayOf(m) };
  }
  const day = r.local.day;
  await r.rt.engine.run(memberPaid, {
    id: m.id, invoice: 'sim_' + m.id + '_0', amount: m.price, periodStart: day, periodEnd: addMonths(day, 1), chargeRef: 'sim_ch_' + m.id + '_0',
    customer: 'cus_sim_' + m.id, subscription: 'sub_sim_' + m.id, card: 'Visa •• 4242'
  }, BILLING(r));
  return { status: 'paid' };
}

/** A payment went through (the provider's notice, payments/handlers.js, or the test page): record it; if its booking
 *  expired meanwhile, give the money back. */
export async function afterProviderPaid(r, ev, provider) {
  const res = await r.rt.engine.run(paymentSucceeded, { providerRef: ev.ref, amount: ev.amount, chargeRef: ev.chargeRef, pm: ev.pm, customer: ev.customer }, PROVIDER(r, provider));
  const p = r.s.payments.get(r.s.paymentByRef.get(ev.ref));
  if (res && res.late) await refundOnline(r, p, 'Réservation expirée avant le paiement');
  // a gift card bought online (IN-01): the sale and the code's SMS, on every paid notice (fulfilGiftcard is idempotent)
  if (p && p.kind === 'giftcard' && p.status === 'paid') await fulfilGiftcard(r, p);
  return res;
}
