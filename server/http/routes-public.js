// @ts-check
// The public API: what the client site and the "mon rendez-vous" page use. No account, no personal data out.
import { HttpError, guard, json } from './kit.js';
import { serviceView, staffView } from './views.js';
import { freeSlots, eligibleStaff, walkinEstimate, shopIntervals, staffIntervals, UNDECIDED } from '../domain/availability.js';
import { clientMayChange, payWindowMin, payDeadline, payChoice } from '../domain/policy.js';
import { signLink, checkLink } from '../auth/session.js';
import { addDays, isDay, diffDays, dayLong } from '../../shared/dates.js';
import { newId, safeEqual } from '../lib/util.js';
import { createHmac } from 'node:crypto';
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
import { addMonths, abandoned, memberOf, rootOf } from '../domain/membership.js';
import { BILLING } from '../payments/billing.js';
import { memberScheduled, startDayOf } from '../commands/member-billing.js';
import { fmtEur } from '../../shared/money.js';
import { safeRedirect } from '../../shared/reviews.js';
import { groupMembers, organiserOf, heldByOrganiser, groupView } from '../domain/group.js';
import { claimFromLink } from './routes-loyalty.js';
import { receiptLoyalty } from '../domain/loyalty.js';
import { readMemberToken, MEMBER_BOOK } from '../auth/member-token.js';
import { salonWhatsapp } from '../settings/messages.js';
import { effectiveMode } from '../messaging/hand.js';
import { formuleOfAppt, rankOf, payState, endOf, onSite, packCover } from '../domain/formule.js';
import { accountsOn } from '../settings/accounts.js';
import { payView, settleSelfPay } from './routes-selfpay.js';

/** The demo, for real: both the configuration and the journal say so (a demo journal opened in production is not one). */
export const isDemo = (r) => r.rt.cfg.mode === 'demo' && r.s.mode === 'demo';
/** Can a client really pay online? The simulated provider only takes demo money. */
export const payLive = (r) => r.rt.pay.name !== 'simulated' || isDemo(r);
// the actor is chained and can never be erased: no name in it, ever (the client's details travel as pii)
const CLIENT = (r) => ({ actor: /** @type {const} */ ({ t: 'client', id: 'web', n: '' }), caps: new Set(), meta: { ...r.meta, payLive: payLive(r), payProvider: r.rt.pay.name } });
/**
 * Who holds a slot, for the cap on holds (commands/agenda.js holdSlot): the address under the salon's key, cut short and
 * new every day. Never the address itself: a hold's event is chained and cannot be erased.
 */
const visitorOf = (r) => (r.ip ? createHmac('sha256', String(r.rt.secret)).update('lx-hold|' + r.local.day + '|' + r.ip).digest('base64url').slice(0, 12) : '');
/**
 * The idempotency key of a visitor's request (x-request-id, checked in app.js: 8 to 64 letters, digits, dashes), kept
 * apart per route. Every visitor is the same actor, so the id itself is the secret: the site draws a random one.
 * @param {any} r @param {string} what @returns {{ requestId?: string }}
 */
const retryKey = (r, what) => { const id = r.req.headers.get('x-request-id'); return id ? { requestId: what + ':' + id } : {}; };
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

/**
 * A date of a weekly carnet bought with its dates, for the booking's own page: « coupe 3 sur 5 », and what is left to pay
 * (nothing once the carnet is paid; 80 € at the salon at the first cut otherwise). Nothing for any other booking.
 */
export function formuleLine(s, a) {
  const f = formuleOfAppt(s, a.id);
  const r = f ? rankOf(s, a.id) : null;
  if (!f || !r) return {};
  const sv = s.services.get(f.serviceId);
  const pay = payState(s, f);
  return { formule: { n: r.n, of: r.of, name: sv ? sv.name : 'Carnet', pay, due: pay === 'due' || pay === 'pending' ? (sv ? sv.price : 0) : 0, end: endOf(s, f) } };
}

function bookingView(r, a) {
  const s = r.s;
  const st = s.staff.get(a.staffId);
  const c = a.clientId ? s.clients.get(a.clientId) : null;
  const pay = a.deposit && a.deposit.paymentId ? s.payments.get(a.deposit.paymentId) : [...s.payments.values()].find((p) => p.apptId === a.id && p.kind === 'deposit' && p.status === 'pending');
  // « payer maintenant » left unfinished: its page while it still lives, so he can go back to it; the booking stands either way
  const ahead = !a.deposit && !a.saleId && a.status === 'booked' && pay && pay.full && pay.status === 'pending' && pay.exp > r.now + 60000 ? pay : null;
  return {
    code: a.code, status: a.status, day: a.day, start: a.start, dur: a.dur, services: a.services.map((x) => ({ id: x.id, name: x.name, price: x.price, from: x.from })), price: a.price,
    staff: st ? { id: st.id, name: st.name, initials: st.initials, color: st.color } : null, anyStaff: a.anyStaff,
    // a place booked for someone else shows the name typed for it, never what the salon's file says (privacy)
    first: a.ext && a.ext.guest ? a.name || '' : c ? c.first : '', ...(a.ext && a.ext.guest ? { guest: a.ext.guest.kind } : {}),
    deposit: a.deposit ? { amount: a.deposit.amount, paid: a.deposit.paid || 0, url: pay && pay.status === 'pending' ? pay.url : null, ...(a.deposit.full ? { full: true } : {}) } : null,
    ...(ahead ? { prepay: { amount: ahead.amount, url: ahead.url } } : {}),
    canChange: ['booked', 'pending'].includes(a.status) && clientMayChange(s, a, r.rt.engine.clock()), cancelUntilHours: s.settings.booking.cancelUntilHours,
    shop: { name: s.settings.shop.name, address: s.settings.shop.address + ', ' + s.settings.shop.zip + ' ' + s.settings.shop.city, phone: s.settings.shop.phone, mapsUrl: s.settings.shop.mapsUrl },
    cancelled: a.cancel ? { by: a.cancel.by, at: a.cancel.at } : null,
    // « Laisser un avis »: only once the visit is done, for everyone alike (no question first, no reward: Google's rules)
    ...(a.status === 'done' && safeRedirect(s.settings.shop.reviewUrl) ? { reviewUrl: safeRedirect(s.settings.shop.reviewUrl) } : {}),
    ...formuleLine(s, a),
    ...(r.guestLink ? { guestLink: true } : {}),
    ...groupLine(r, a),
    // « Payer ma coupe »: what he owes today, or « payé » with his receipt (routes-selfpay.js); today: the page then
    // follows the till by itself (seated, a product added, rung up)
    ...(a.day === r.local.day ? { today: true } : {}),
    ...(payView(r, a) || {})
  };
}

/** The group of a booking as its page shows it: everything to the organiser, « réservé par Karim » to a friend. */
function groupLine(r, a) {
  const s = r.s;
  const members = groupMembers(s, a);
  if (members.length < 2) return {};
  const org = organiserOf(s, members);
  const organiser = !r.guestLink && heldByOrganiser(s, a, org);
  const g = groupView(s, a, { organiser, origin: r.origin, tokenFor: (x, kind) => signLink(r.rt.secret, kind, x.code) });
  return g ? { group: g } : {};
}

export function apptFromToken(r) {
  // two kinds of link open a booking: the contact's own ('appt', which also opens his other bookings, routes-client.js)
  // and a friend's ('guest', sent by the organiser of a group: that one place and nothing else)
  let code = checkLink(r.rt.secret, 'appt', r.params.token);
  r.guestLink = false;
  if (!code) { code = checkLink(r.rt.secret, 'guest', r.params.token); r.guestLink = !!code; }
  const id = code ? r.s.apptByCode.get(code) : null;
  const a = id ? r.s.appts.get(id) : null;
  if (!a) throw new HttpError(404, 'not_found', 'Ce lien n’est pas (ou plus) valable.');
  return a;
}

/**
 * Does his file already hold what pays this visit at the till (a carnet with a cut left for one of these services, a
 * running membership that covers one)? Then « payer maintenant » takes nothing: paid twice, the till would have a
 * ticket at 0 € and money it cannot put on it. The answer never says why (nothing of a file is told to a visitor).
 */
function paidAtTill(s, a) {
  if (!a.clientId || (a.ext && a.ext.guest)) return false;
  const root = rootOf(s, a.clientId);
  const ids = a.services.map((x) => x.id);
  const m = memberOf(s, a.clientId);
  if (m && m.activatedAt && !m.ended && (m.serviceIds || []).some((x) => ids.includes(x))) return true;
  for (const k of s.packs.values()) {
    if (k.voided || k.used >= k.total || k.expires < a.day || rootOf(s, k.clientId) !== root) continue;
    const cover = packCover(s, k).ids;
    if (!cover.length || cover.some((x) => ids.includes(x))) return true;
  }
  return false;
}

/**
 * When a checkout page lapses, on the salon's clock: the provider counts its lifetime on the real one. The two are the
 * same in production; a demo with its clock moved (LX_FAKE_NOW) keeps a page that lives as long as the provider said.
 * @param {{ now: number }} r @param {{ exp: number }} co
 */
export const lapse = (r, co) => r.now + Math.max(0, co.exp - Date.now());

/**
 * Ask the provider for a checkout page and record it.
 * @param {any} r
 * @param {{ kind: string, amount: number, label: string, apptId: string|null, returnPath: string, email?: string, self?: { tip: number, group?: string[] }, full?: boolean }} o
 *   full: the whole price of a confirmed booking paid ahead by choice (« payer maintenant »), not a deposit it waits for
 */
export async function startPayment(r, { kind, amount, label, apptId, returnPath, email, self, full }) {
  if (!payLive(r)) throw new HttpError(409, 'no_provider', 'Le paiement en ligne n’est pas branché (Stripe).');
  const id = newId('py');
  const origin = r.origin;
  const payMin = kind === 'deposit' ? payWindowMin(r.s, { stripe: r.rt.pay.name === 'stripe' }) : undefined;
  const co = await r.rt.pay.createCheckout({ id, amount, label, email, payMin, successUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=ok', cancelUrl: origin + returnPath + (returnPath.includes('?') ? '&' : '?') + 'paiement=annule' });
  await r.rt.engine.run(createPayment, { id, kind, amount, provider: r.rt.pay.name, providerRef: co.ref, url: co.url, apptId, exp: lapse(r, co), label, ...(self ? { self } : {}), ...(full ? { full: true } : {}) }, { actor: { t: 'system', id: 'payments' }, caps: new Set(['sale.create']), meta: r.meta });
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

/**
 * The photo the site may show of a barber: an active chair, bookable online, with a photo he (or the owner) keeps
 * « visible sur le site ». Anyone else, an archived barber at once included, has none there.
 */
const sitePhoto = (s, st) => (st && st.active && st.chair && st.bookable && st.photoSite && st.photoV ? s.staffPhotos.get(st.id) || null : null);
/** Its address on the site: the version in it, so a new photo is a new address. */
const sitePhotoUrl = (s, st) => { const ph = sitePhoto(s, st); return ph ? '/api/public/barbers/' + encodeURIComponent(st.id) + '/photo?v=' + ph.v : undefined; };

/** Client traffic carries the reminders too, so they leave even when no one has the Comptoir open (at most once a minute). */
function background(r) { const t = maybeTick(r.rt, r.meta); if (t) waitUntil(t); }

export function publicRoutes(app) {
  app.get('/api/public/salon', (r) => {
    const s = r.s;
    const L = r.local;
    const live = payLive(r);
    // no online payment: no deposit is asked, so the site must not announce one either
    const active = [...s.services.values()].filter((x) => x.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    // a carnet is on the site only when it can be bought there: the weekly one, with its dates, and the client space open
    // (it asks for an account); any other stays on the price list, « au salon »
    const space = accountsOn(s);
    const sellable = (x) => onSite(s, x, space);
    // « au choix du client »: no service asks a deposit either, whatever its own rule in the Catalogue says
    const services = active.filter((x) => x.online !== false && sellable(x)).map((x) => (live && !payChoice(s) ? serviceView(x) : { ...serviceView(x), deposit: 0 }));
    // the whole price list (the CGV show it, the site's FAQ quotes it): booked at the salon only when online is false
    const menu = active.map((x) => ({ slug: x.slug || null, name: x.name, category: x.category, price: x.price, from: !!x.from, dur: x.dur, online: x.online !== false && sellable(x) }));
    const chairs = [...s.staff.values()].filter((x) => x.active && x.chair && x.bookable).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    // photo: the address of his photo when he shows it on the site (« Photo visible sur le site »), absent otherwise;
    // the Comptoir's version number and the switch itself are the Comptoir's
    const barbers = chairs.map((x) => ({ ...staffView(x), photoSite: undefined, photo: sitePhotoUrl(s, x), away: awayOf(s, x, L.day) }));
    // the days it opens when it usually doesn't, or with other hours; one a closure covers is closed (it wins, as in
    // availability.js), and one for named barbers nobody can be booked on (archived, all away) is not announced
    const closures = s.settings.closures.filter((c) => c.to >= L.day);
    const openings = (s.settings.openings || []).filter((o) => o.day >= L.day && !closures.some((c) => o.day >= c.from && o.day <= c.to) && (!Array.isArray(o.staff) || chairs.some((x) => staffIntervals(s, x.id, o.day).length))).map((o) => ({ day: o.day, intervals: o.intervals, label: o.label }));
    const b = s.settings.booking;
    return json({
      // the hours in words too, for every place the site writes them (footer, FAQ, description)
      shop: { ...s.settings.shop }, hours: s.settings.hours, hoursText: hoursText(s.settings.hours), closedText: closedText(s.settings.hours), closures, openings,
      booking: { enabled: b.enabled, stepMin: b.stepMin, minNoticeMin: b.minNoticeMin, maxDaysAhead: b.maxDaysAhead, holdMin: b.holdMin, pendingPayMin: payWindowMin(s, { stripe: r.rt.pay.name === 'stripe' }), cancelUntilHours: b.cancelUntilHours, waitlist: b.waitlist, walkinWait: b.walkinWait, contact: b.contact === 'email' ? 'email' : 'phone' },
      // sms: does a text really leave? payments.live: is a deposit really taken online? (false: the site books without one)
      // deposits.mode 'choice' reaches the site only with a real way to pay: it then offers « payer maintenant » or « au salon »
      deposits: live ? s.settings.deposits : { ...s.settings.deposits, mode: 'none' }, services, menu, barbers, sms: !!r.rt.sms || isDemo(r),
      // the reminder of the eve, as Réglages › Messages has it: the site promises it at that hour, or not at all when it is off
      // the salon's own WhatsApp number (digits, country code) once set in Réglages: the booking's last step then offers
      // « Recevoir la confirmation sur WhatsApp », a chat the client opens himself. null: no button
      whatsapp: salonWhatsapp(s.settings.messages) || null,
      // the way the confirmation and the reminder really reach the client: 'whatsapp' when the salon's number is set and
      // its texts leave by WhatsApp (by hand from the salon's phone, or automatic), 'sms' otherwise. The site says so
      channel: salonWhatsapp(s.settings.messages) && effectiveMode(s, r.rt) !== 'sms' ? 'whatsapp' : 'sms',
      reminder: { on: s.settings.messages.reminder !== false, hour: s.settings.messages.reminderHour ?? 18 }, payments: { provider: r.rt.pay.name, live }, mode: s.mode, today: L.day, now: r.now
    }, 200, { 'cache-control': 'public, max-age=0, s-maxage=20, stale-while-revalidate=60' });
  });

  // a barber's photo for the site: only the image, only for one the site lists who shows it (sitePhoto), 404 otherwise.
  // Cached by the visitor's browser under its version; never kept by the CDN, so a photo hidden or a barber archived
  // leaves the site with the salon's next answer
  app.get('/api/public/barbers/:id/photo', (r) => {
    const ph = sitePhoto(r.s, r.s.staff.get(r.params.id));
    const v = r.query.get('v');
    const m = ph && (!v || v === String(ph.v)) ? /^data:(image\/(?:jpeg|webp));base64,(.+)$/.exec(ph.data) : null;
    if (!m) throw new HttpError(404, 'not_found', 'Pas de photo.');
    return new Response(Buffer.from(m[2], 'base64'), { status: 200, headers: { 'content-type': m[1], 'cache-control': v ? 'private, max-age=86400' : 'no-cache', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' } });
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
    // all=1: the site's one read for the whole booking sheet. Every service sold online, « sans préférence » and barber
    // by barber, in one answer: choosing a service, a barber or a day then shows its slots from memory. Services that
    // take the same time with the same barbers share one list (sets); who is free at a time is a bit mask over `staff`.
    if (q.has('all')) {
      const fresh = q.has('fresh');
      const online = [...s.services.values()].filter((x) => x && x.active && x.online !== false && !x.pack);
      /** @type {string[]} */
      const staff = [];
      const bit = (id) => { let i = staff.indexOf(id); if (i < 0) { i = staff.length; staff.push(id); } return i; };
      /** @type {Map<string, { services: string[], dur: number, days: any[] }>} */
      const sets = new Map();
      for (const x of online) {
        const d = x.dur + Math.max(0, x.buffer || 0);
        const k = d + '|' + eligibleStaff(s, [x.id], { online: true }).map((st) => st.id).join(',');
        const set = sets.get(k);
        if (set) { set.services.push(x.id); continue; }
        const out = [];
        for (let i = 0; i < days; i++) {
          const day = addDays(from, i);
          if (diffDays(L.day, day) > s.settings.booking.maxDaysAhead) break;
          const slots = freeSlots(s, { day, dur: d, serviceIds: [x.id], staffId: 'any', now: r.now, local: L, online: true, each: true });
          out.push({ day, open: !s.closures.has(day) && shopIntervals(s, day).length > 0, slots: slots.map((y) => [y.m, bit(y.staffId), (y.free || []).reduce((t, id) => t | (1 << bit(id)), 0)]) });
        }
        sets.set(k, { services: [x.id], dur: d, days: out });
      }
      if (staff.length > 30) throw new HttpError(400, 'invalid', 'Trop de barbiers pour cette lecture.');
      return json({ now: r.now, from, staff, sets: [...sets.values()] }, 200, { 'cache-control': fresh ? 'no-store' : 'public, max-age=0, s-maxage=5' });
    }
    if (!ids.length) throw new HttpError(400, 'invalid', 'Choisis une prestation.');
    const services = ids.map((id) => s.services.get(id)).filter((x) => x && x.active && x.online !== false && !x.pack);
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
    // fresh: the site's next read after a hold, a booking or a 409 « créneau pris », which must see the journal as it is.
    // Never stale-while-revalidate here: a salon's traffic is low, the stale copy would be the one nearly everyone gets
    const cacheable = !ignoreAppt && !q.get('hold') && !q.has('fresh');
    return json({ dur, days: out, now: r.now }, 200, { 'cache-control': cacheable ? 'public, max-age=0, s-maxage=5' : 'no-store' });
  });

  app.post('/api/public/holds', async (r) => {
    guard('hold|' + r.ip, 30, 60000);
    // each hold is an event kept for good: a client looking around takes a few dozen at most
    guard('holdh|' + r.ip, 120, 3600000, 'Trop de créneaux regardés d’un coup. Patiente un peu, ou appelle le salon.');
    const ctx = CLIENT(r);
    return r.rt.engine.run(A.holdSlot, r.body, { ...ctx, meta: { ...ctx.meta, visitor: visitorOf(r) }, ...retryKey(r, 'hold') });
  });
  app.del('/api/public/holds/:id', async (r) => r.rt.engine.run(A.releaseHold, { id: r.params.id }, CLIENT(r)));

  app.post('/api/public/bookings', async (r) => {
    guard('book|' + r.ip, 6, 60000, 'Trop de réservations d’un coup. Patiente une minute.');
    guard('bookh|' + r.ip, 30, 3600000, 'Trop de réservations depuis cet appareil. Appelle le salon.');
    // PAY-04: « Réserver ma coupe » from the member page carries its booking link (mbr, signed for booking only): the one
    // way a guest booking is a member's
    const mt = r.body && typeof r.body.mbr === 'string' ? readMemberToken(r.rt.secret, r.body.mbr.slice(0, 200), r.now, MEMBER_BOOK) : null;
    // the site sends one id per attempt (x-request-id): when the answer was lost on the way and the client tries again,
    // the engine gives the first answer back and nothing is booked twice
    const ctx = { ...CLIENT(r), ...retryKey(r, 'book') };
    const again = !!ctx.requestId && r.rt.engine.knows(ctx.actor, ctx.requestId) === 'answered';
    // « payer maintenant » (deposits mode 'choice'): the route's own word, the booking itself is the same either way
    const { pay: payWish, ...asked } = r.body || {};
    const res = await r.rt.engine.run(A.bookOnline, { ...asked, demo: undefined }, mt && 'id' in mt ? { ...ctx, meta: { ...ctx.meta, memberId: mt.id } } : ctx);
    // one person, one confirmed booking, nothing his membership already pays: the whole price, on the provider's page
    const payNow = payWish === 'now' && payLive(r) && payChoice(r.s) && !res.people && res.status === 'booked' && !res.member && res.price >= 50;
    // one booking can hold up to four people (« Ajouter une personne »): each place has its own link to move, cancel or pay
    const places = res.people || [res];
    const outs = [];
    for (const x of places) {
      // a retry finds the booking as it now stands: its deposit page is the one already opened, never a second one
      const now = r.s.appts.get(x.id);
      // a place booked for a friend under his own number: the booker follows that place, not his friend's other bookings
      const token = signLink(r.rt.secret, now && now.ext && now.ext.guest && now.ext.guest.by ? 'guest' : 'appt', x.code);
      let payment = null, payFailed = false;
      const open = again ? [...r.s.payments.values()].find((p) => p.apptId === x.id && p.kind === 'deposit' && p.status === 'pending') : null;
      // in a booking of several people, any place taken back means the whole booking was (its deposit page failed)
      if (again && (x.status === 'pending' || res.people) && (!now || now.status === 'cancelled')) throw new HttpError(409, 'gone', 'Cette réservation n’a pas abouti : rien n’est enregistré. Choisis ton créneau à nouveau.');
      const status = again && now ? now.status : x.status;
      if (open) payment = { id: open.id, url: open.url };
      else if (status === 'pending' && x.deposit > 0) {
        const sv = r.s.appts.get(x.id);
        try {
          payment = await startPayment(r, { kind: 'deposit', amount: x.deposit, label: 'Acompte · ' + sv.services.map((y) => y.name).join(' + ') + (sv.ext && sv.ext.guest && sv.name ? ' · ' + sv.name : ''), apptId: x.id, returnPath: '/r/' + token, email: r.body.email });
        } catch (e) {
          // no page to pay on (the provider is down, or its page could not be recorded): the booking would hold the slot
          // unpaid, with no link and no text, against its own client's retry. Taken back at once (every place still
          // waiting for its deposit), and said plainly
          console.error('[lx] deposit checkout failed, booking taken back', x.id, e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message));
          // a booking of several people goes whole: a place confirmed without a deposit is taken back too, so the words
          // below (« ton rendez-vous n'est pas enregistré ») stay true and a new try does not book anyone twice
          for (const y of places) {
            if (y.status !== 'pending' && !res.people) continue;
            try { await r.rt.engine.run(A.expirePending, { id: y.id, reason: 'Paiement en ligne indisponible', ...(res.people ? { group: true } : {}) }, { actor: { t: 'system', id: 'payments' }, caps: new Set(), meta: r.meta }); }
            catch (e2) { console.error('[lx] booking not taken back', y.id, e2 && /** @type {any} */ (e2).message); }
          }
          // the provider's answer already put in French for a client (payments/stripe.js: 502 « réessaie dans un instant »)
          if (e && /** @type {any} */ (e).expose) throw e;
          throw new HttpError(503, 'pay_unavailable', 'Le paiement en ligne est momentanément indisponible : ton rendez-vous n’est pas enregistré et rien n’est débité. Réessaie dans un instant, ou appelle le salon.', { retry: true, phone: r.s.settings.shop.phone });
        }
      } else if (payNow && now && now.status === 'booked' && !now.saleId && !(now.deposit && now.deposit.paid)) {
        // the booking is confirmed and stays so whatever becomes of the payment: no page to pay on (the provider is
        // down) is said, never thrown, and he pays at the salon as if he had chosen it
        try {
          if (paidAtTill(r.s, now)) throw new Error('a carnet or a membership of this file pays the visit');
          payment = await startPayment(r, { kind: 'deposit', full: true, amount: now.price, label: now.services.map((y) => y.name).join(' + ') + (now.ext && now.ext.guest && now.name ? ' · ' + now.name : ''), apptId: x.id, returnPath: '/r/' + token, email: r.body.email });
        } catch (e) { payFailed = true; console.error('[lx] pay-now checkout failed, booking kept (to pay at the salon)', x.id, e && (/** @type {any} */ (e).detail || /** @type {any} */ (e).message)); }
      }
      outs.push({ code: x.code, token, manage: r.origin + '/r/' + token, status, deposit: x.deposit, staffId: x.staffId, payment, ...(payNow ? { payNow: { amount: x.price, ok: !!payment, ...(payFailed ? { failed: true } : {}) } } : {}), ...(x.member ? { member: x.member } : {}),
        ...(res.people ? { first: x.first, day: x.day, start: x.start, guest: x.guest, price: x.price } : {}) });
    }
    const head = outs[0];
    // FID-02: a booking that came through a referrer's link (?parrain=); a refusal never touches the booking
    const ref = r.body && r.body.parrain && !again ? await claimFromLink(r, res.id, r.body.parrain) : null;
    const { first: _f, day: _d, start: _s, guest: _g, price: _p, ...one } = head;
    // a group: the recap the confirmation shows and the text « Envoyer à mes amis » sends, as the organiser's page has them
    const grp = res.people ? groupLine(r, r.s.appts.get(res.id)).group : null;
    return json({ ...one, ...(res.people ? { people: outs } : {}), ...(grp && grp.organiser ? { group: { by: grp.by, total: grp.total, share: grp.share } } : {}), ...(ref ? { referral: { ok: !!ref.ok, why: ref.ok ? null : ref.why } } : {}) }, 201);
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
    await r.rt.engine.run(A.moveByClient, { id: a.id, day: r.body.day, start: r.body.start, holdId: r.body.holdId }, { ...CLIENT(r), ...retryKey(r, 'move') });
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
    const fo = formuleOfAppt(r.s, a.id);
    const fsv = fo ? r.s.services.get(fo.serviceId) : null;
    const p = await startPayment(r, { kind: 'deposit', amount: a.deposit.amount, label: fo ? (fsv ? fsv.name : 'Carnet') + ' · ' + fo.apptIds.length + ' rendez-vous' : 'Acompte · ' + a.services.map((x) => x.name).join(' + '), apptId: a.id, returnPath: '/r/' + r.params.token });
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
    // a friend's place paid from the organiser's link goes back to that place alone, never to the friend's other bookings
    const friend = !!(a && p.self && a.ext && a.ext.guest && a.ext.guest.by);
    return { id: p.id, status: p.status, amount: p.amount, label: p.label, kind: p.kind, provider: p.provider, exp: p.exp, shop: r.s.settings.shop.name, back: a ? '/r/' + signLink(r.rt.secret, friend ? 'guest' : 'appt', a.code) : null };
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
      // the whole price paid ahead by choice reads « En ligne » on his receipt, not « Acompte »
      payments: x.payments.map((p) => ({ method: p.method === 'deposit' && p.paymentId && (r.s.payments.get(p.paymentId) || {}).full ? 'online' : p.method, amount: p.amount })), refunded: x.refunded, footer: r.s.settings.payments.receiptFooter,
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
 * What the test checkout page shows of a membership: « Abonnement Hebdo · 80 €/mois », and when it starts (start:
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
  // the client paid his own cut from his page: the till's ticket, on every paid notice (settleSelfPay is idempotent)
  if (p && p.self) await settleSelfPay(r, r.s.payments.get(p.id));
  return res;
}
