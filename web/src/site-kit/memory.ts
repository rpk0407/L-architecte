// What a returning visitor's browser remembers, so the site can greet him and rebook in one tap.
// Stored on his device only (localStorage), never sent anywhere until he books.
import { dates } from '../lib/format';
import { now, today } from './salon';

export type Kept = { token: string; code: string; manage: string; day: string; start: number; dur: number; serviceIds: string[]; services: string; staffId: string; staff: string; status: 'booked' | 'pending' | 'cancelled'; payUrl?: string | null; at: number };
export type Me = { first: string; last: string; phone: string; email: string; serviceIds: string[]; staffId: string | null; bookings: Kept[] };

const KEY = 'lx-me-v2';
const EMPTY: Me = { first: '', last: '', phone: '', email: '', serviceIds: [], staffId: null, bookings: [] };

export function me(): Me {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    // the previous site's memory: keep the name and phone he already typed
    const old = JSON.parse(localStorage.getItem('lx-me') || 'null');
    if (old && typeof old === 'object') return { ...EMPTY, first: old.first || '', last: old.last || '', phone: old.phone || '', email: old.email || '' };
  } catch { /* storage off or corrupted: start fresh */ }
  return { ...EMPTY };
}
export function save(patch: Partial<Me>) {
  const next = { ...me(), ...patch };
  next.bookings = (next.bookings || []).slice(-10);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: memory only for this page */ }
  window.dispatchEvent(new CustomEvent('lx:me'));
  return next;
}
export function keep(b: Kept) { const m = me(); save({ bookings: [...m.bookings.filter((x) => x.token !== b.token), b] }); }
export function forgetMe() { try { localStorage.removeItem(KEY); localStorage.removeItem('lx-me'); } catch { /* nothing to forget */ } window.dispatchEvent(new CustomEvent('lx:me')); }

/** His next appointment booked from this browser, if any. */
export function upcoming(): Kept | null {
  const t = now(), list = me().bookings.filter((b) => b.status !== 'cancelled' && dates.instantOf(b.day, b.start + b.dur) > t);
  list.sort((a, b) => (a.day + String(a.start).padStart(4, '0')).localeCompare(b.day + String(b.start).padStart(4, '0')));
  return list[0] || null;
}
/** His last appointment, already past (to say "ça fait 3 semaines"). */
export function lastVisit(): Kept | null {
  const t = now(), list = me().bookings.filter((b) => b.status !== 'cancelled' && dates.instantOf(b.day, b.start) <= t);
  list.sort((a, b) => (b.day + String(b.start).padStart(4, '0')).localeCompare(a.day + String(a.start).padStart(4, '0')));
  return list[0] || null;
}
export function daysSince(day: string) { return dates.diffDays(day, today()); }
export const firstName = () => { const f = me().first.trim().split(/\s+/)[0] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1) : ''; };
