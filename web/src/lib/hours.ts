// Is the salon open that day: the same order as the server (server/domain/availability.js shopIntervals).
import { dates } from './format';

type Iv = [number, number];
type HoursSettings = { hours?: Record<number, Iv[]>; closures?: { from: string; to: string }[]; openings?: { day: string; intervals: Iv[] }[] };

/** The salon's hours that day: a closure beats an exceptional opening, which beats the usual week. */
export function shopHoursOn(st: HoursSettings | null | undefined, day: string): Iv[] {
  if (!st) return [];
  if ((st.closures || []).some((c) => c.from <= day && c.to >= day)) return [];
  const op = (st.openings || []).find((o) => o.day === day);
  return op ? op.intervals : (st.hours && st.hours[dates.weekday(day)]) || [];
}
export const shopOpenOn = (st: HoursSettings | null | undefined, day: string) => shopHoursOn(st, day).length > 0;
