// @ts-check
// Booking policies the owner sets in Réglages: deposits, cancellation window.
import { instantOf, addDays } from '../../shared/dates.js';
import { cover, periodIn } from './membership.js';

/** Stripe Checkout lives at least 30 minutes: a booking must wait at least that long for its deposit. */
export const STRIPE_PAY_MIN = 31;

/** The tag on a client file that spares them the deposit asked of clients who missed (Clients › Préférences, domain/risk.js). */
export const TRUSTED = 'confiance';

/**
 * Deposit to pay online for these services, in cents (0 = none).
 * Without a real way to pay online (production on the simulated provider) there is never one:
 * a client must not "pay" a fake deposit that the till then deducts.
 * risk (domain/risk.js riskDeposit, for the file found by phone): a client who already missed pays it under the threshold too.
 * member (PAY-04): a membership the route verified (the member page's signed link, never a typed phone), with the
 * booking's day and that file's other bookings to come: none when his plan pays for every service (memberCovers).
 * @param {any} s @param {{ id: string, price: number }[]} services
 * @param {{ payLive?: boolean, risk?: boolean, member?: any, day?: string, upcoming?: any[] }} [o]
 */
export function depositFor(s, services, o = {}) {
  if (o.payLive === false) return 0;
  if (o.member && o.day && memberCovers(s, o.member, services, o.day, o.upcoming).ok) return 0;
  const d = s.settings.deposits;
  const price = services.reduce((t, x) => t + x.price, 0);
  // a service can set its own deposit (0 = never one), otherwise the salon's rule applies
  const own = services.map((x) => s.services.get(x.id)?.deposit);
  const explicit = own.filter((x) => typeof x === 'number' && x > 0);
  if (explicit.length) return Math.min(price, explicit.reduce((a, b) => a + b, 0));
  if (own.length && own.every((x) => x === 0)) return 0;
  if (!d || d.mode === 'none') return 0;
  // a 20 € cut never reaches the threshold: the clients who miss are the ones it lets through
  if (d.mode === 'threshold' && price < d.thresholdCents && !o.risk) return 0;
  return Math.min(price, Math.max(500, Math.round((price * d.percent) / 100 / 100) * 100));
}

/**
 * Would this member's plan pay for every one of these services on that day, as the till will check it (cover)? A booking
 * consumes nothing (the till does), so the file's other bookings to come that the plan would pay count as taken: three
 * covered bookings in a month of two cuts leave the third at the usual deposit, and an illimité's next booking must
 * keep its days between cuts from them too. used: the cut this booking would be in its month (2 of « 2/2 »).
 * @param {any} s @param {any} m @param {{ id: string }[]} services @param {string} day
 * @param {{ day: string, services: { id: string }[] }[]} [upcoming]
 * @returns {{ ok: boolean, used: number, of: number }}
 */
export function memberCovers(s, m, services, day, upcoming = []) {
  const no = { ok: false, used: 0, of: m ? m.cuts : 0 };
  if (!m || !services.length) return no;
  const p = periodIn(s, m, day);
  if (!p) return no;
  const paid = (a) => a.services.some((x) => (m.serviceIds || []).includes(x.id));
  const others = upcoming.filter(paid);
  const inPeriod = others.filter((a) => a.day >= p.start && a.day < p.end).length;
  // a minimum gap between cuts: the bookings to come keep it as cuts already taken would
  if (m.minDays && others.some((a) => a.day < addDays(day, m.minDays) && addDays(a.day, m.minDays) > day)) return no;
  let used = 0;
  for (let i = 0; i < services.length; i++) {
    const c = cover(s, m, services[i].id, { day, pending: i });
    if (!c.ok || (m.cuts && c.used + inPeriod >= m.cuts)) return no;
    used = c.used + inPeriod + 1;
  }
  return { ok: true, used, of: m.cuts };
}

/** Minutes a booking waits for its online deposit. With Stripe, never less than its checkout's lifetime. */
export function payWindowMin(s, { stripe = false } = {}) {
  const m = s.settings.booking.pendingPayMin;
  return stripe ? Math.max(m, STRIPE_PAY_MIN) : m;
}

/** When an unpaid booking frees its slot: the deadline set at booking, or (older bookings) the salon's setting. */
export function payDeadline(s, appt) {
  return appt.deposit && appt.deposit.until ? appt.deposit.until : appt.createdAt + s.settings.booking.pendingPayMin * 60000;
}

/** Can the client still move or cancel online? (otherwise: call the salon) */
export function clientMayChange(s, appt, now) {
  const start = instantOf(appt.day, appt.start);
  return now < start - s.settings.booking.cancelUntilHours * 3600000;
}

export function startsAt(appt) { return instantOf(appt.day, appt.start); }
