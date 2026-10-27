// @ts-check
// Booking policies the owner sets in Réglages: deposits, cancellation window.
import { instantOf } from '../../shared/dates.js';

/** Stripe Checkout lives at least 30 minutes: a booking must wait at least that long for its deposit. */
export const STRIPE_PAY_MIN = 31;

/**
 * Deposit to pay online for these services, in cents (0 = none).
 * Without a real way to pay online (production on the simulated provider) there is never one:
 * a client must not "pay" a fake deposit that the till then deducts.
 * @param {any} s @param {{ id: string, price: number }[]} services @param {{ payLive?: boolean }} [o]
 */
export function depositFor(s, services, o = {}) {
  if (o.payLive === false) return 0;
  const d = s.settings.deposits;
  const price = services.reduce((t, x) => t + x.price, 0);
  // a service can set its own deposit (0 = never one), otherwise the salon's rule applies
  const own = services.map((x) => s.services.get(x.id)?.deposit);
  const explicit = own.filter((x) => typeof x === 'number' && x > 0);
  if (explicit.length) return Math.min(price, explicit.reduce((a, b) => a + b, 0));
  if (own.length && own.every((x) => x === 0)) return 0;
  if (!d || d.mode === 'none') return 0;
  if (d.mode === 'threshold' && price < d.thresholdCents) return 0;
  return Math.min(price, Math.max(500, Math.round((price * d.percent) / 100 / 100) * 100));
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
