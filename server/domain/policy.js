// @ts-check
// Booking policies the owner sets in Réglages: deposits, cancellation window.
import { instantOf } from '../../shared/dates.js';

/** Deposit to pay online for these services, in cents (0 = none). */
export function depositFor(s, services) {
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

/** Can the client still move or cancel online? (otherwise: call the salon) */
export function clientMayChange(s, appt, now) {
  const start = instantOf(appt.day, appt.start);
  return now < start - s.settings.booking.cancelUntilHours * 3600000;
}

export function startsAt(appt) { return instantOf(appt.day, appt.start); }
