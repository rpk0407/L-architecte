// The salon, as the public sites see it: catalogue, barbers, hours, free slots, and the few things a visitor
// can do (hold, book, join the waiting list). Everything goes through /api/public; nothing here needs an account.
import { dates } from '../lib/format';

export type Service = {
  id: string; slug: string | null; name: string; short: string; category: string; price: number; from: boolean; dur: number; buffer: number;
  online: boolean; deposit: number | null; vat: number; order: number; description: string; includes: string[]; pack: { credits: number; days: number; serviceIds?: string[] } | null;
};
export type Barber = { id: string; name: string; initials: string; color: string; order: number; bio: string; instagram: string };
export type Interval = [number, number];
export type Salon = {
  shop: { name: string; address: string; zip: string; city: string; phone: string; email: string; mapsUrl: string; reviewUrl: string; instagram: string };
  hours: Record<string, Interval[]>; closures: { id: string; from: string; to: string; label: string }[];
  booking: { enabled: boolean; stepMin: number; minNoticeMin: number; maxDaysAhead: number; holdMin: number; cancelUntilHours: number; waitlist: boolean; walkinWait: boolean };
  deposits: { mode: 'none' | 'threshold' | 'all'; thresholdCents: number; percent: number };
  services: Service[]; barbers: Barber[]; payments: { provider: string }; mode: 'demo' | 'production'; today: string; now: number;
};
export type Slot = { m: number; staffId: string };
export type DaySlots = { day: string; open: boolean; slots: Slot[] };
export type Live = { open: boolean; waitMin: number | null; queued: number; today: string; min: number };
export type BookResult = { code: string; token: string; manage: string; status: 'booked' | 'pending'; deposit: number; staffId: string; payment: { id: string; url: string } | null };
export type Offer = { serviceId: string; staffId: string; day: string; start: number; holdId: string; exp: number; first: string };

export class SalonError extends Error {
  code: string; status: number;
  constructor(message: string, code = 'http', status = 0) { super(message); this.code = code; this.status = status; }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' };
  if (body !== undefined) { (init.headers as Record<string, string>)['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res: Response;
  try { res = await fetch(path, init); } catch { throw new SalonError('Pas de connexion. Vérifie ton réseau et réessaie.', 'network'); }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new SalonError(j?.error?.message || 'Le salon ne répond pas. Réessaie dans un instant.', j?.error?.code || 'http', res.status);
  return j as T;
}

/* ---------------- the salon, loaded once ---------------- */

let salon: Salon | null = null;
let salonP: Promise<Salon> | null = null;
let skew = 0;
const listeners = new Set<() => void>();
export function onChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* a listener must not break the others */ } }); }

export function loadSalon(force = false): Promise<Salon> {
  if (salonP && !force) return salonP;
  salonP = call<Salon>('GET', '/api/public/salon').then((s) => {
    salon = s;
    skew = s.now - Date.now();
    emit();
    return s;
  }).catch((e) => { salonP = null; throw e; });
  return salonP;
}
export const getSalon = () => salon;

/** The salon's clock: a phone set to the wrong time still sees the right slots. */
export const now = () => Date.now() + skew;
export const today = () => dates.localParts(now()).day;
export const nowMin = () => dates.localParts(now()).min;

export function hoursOf(day: string): Interval[] {
  if (!salon) { const wd = dates.dayParts(day).wd; return wd >= 2 && wd <= 6 ? [[540, 1110]] : []; }
  if (salon.closures.some((c) => c.from <= day && c.to >= day)) return [];
  return salon.hours[String(dates.dayParts(day).wd)] || [];
}
export function openDays(n: number, from = today()): string[] {
  const out: string[] = [];
  const max = salon ? salon.booking.maxDaysAhead : 30;
  let d = from;
  for (let i = 0; i <= max && out.length < n; i++) { if (hoursOf(d).length) out.push(d); d = dates.addDays(d, 1); }
  return out;
}
/** "Ouvert · jusqu’à 18 h 30", "Fermé · ouvre à 9 h", "Fermé · rouvre mardi à 9 h" */
export function openStatus(): { open: boolean; label: string; short: string; until: number | null } {
  const d = today(), m = nowMin(), iv = hoursOf(d);
  const cur = iv.find(([a, b]) => m >= a && m < b);
  if (cur) return { open: true, label: 'Ouvert · jusqu’à ' + dates.fmtTime(iv[iv.length - 1][1]), short: 'Ouvert', until: cur[1] };
  const later = iv.find(([a]) => m < a);
  if (later) return { open: false, label: 'Fermé · ouvre à ' + dates.fmtTime(later[0]), short: 'Fermé', until: null };
  let k = d;
  for (let i = 1; i <= 30; i++) {
    k = dates.addDays(k, 1);
    const h = hoursOf(k);
    if (h.length) return { open: false, label: 'Fermé · rouvre ' + (i === 1 ? 'demain' : dates.DAYS_FR[dates.dayParts(k).wd]) + ' à ' + dates.fmtTime(h[0][0]), short: 'Fermé', until: null };
  }
  return { open: false, label: 'Fermé', short: 'Fermé', until: null };
}

export const serviceById = (id: string) => salon?.services.find((s) => s.id === id) || null;
export const serviceBySlug = (slug: string) => salon?.services.find((s) => s.slug === slug) || null;
export const barberById = (id: string) => salon?.barbers.find((b) => b.id === id) || null;
/** "jkut", "frank", "soldat": stable ids the pages can use for photos and anchors */
export const barberKey = (b: { name: string }) => b.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(le|la|les|l'|l’)\s*/, '').replace(/[^a-z0-9]/g, '');

/** The deposit the salon will ask for these services, mirrored from its rule (the server decides). */
export function depositFor(serviceIds: string[]): number {
  if (!salon) return 0;
  const list = serviceIds.map(serviceById).filter(Boolean) as Service[];
  const price = list.reduce((t, s) => t + s.price, 0);
  const own = list.map((s) => s.deposit);
  const explicit = own.filter((x): x is number => typeof x === 'number' && x > 0);
  if (explicit.length) return Math.min(price, explicit.reduce((a, b) => a + b, 0));
  if (own.length && own.every((x) => x === 0)) return 0;
  const d = salon.deposits;
  if (!d || d.mode === 'none' || (d.mode === 'threshold' && price < d.thresholdCents)) return 0;
  return Math.min(price, Math.max(500, Math.round((price * d.percent) / 100 / 100) * 100));
}

/* ---------------- free slots, cached a few seconds per (services, barber) ---------------- */

type AvEntry = { at: number; p: Promise<DaySlots[]> | null; days: DaySlots[] | null; err: SalonError | null };
const av = new Map<string, AvEntry>();
const avKey = (serviceIds: string[], staffId: string, move?: string) => serviceIds.join('+') + '|' + staffId + '|' + (move || '');

/** Free slots for the next 14 days. Cached 20 s; `fresh` forces a new read (before confirming, after a conflict). */
export function availability(serviceIds: string[], staffId = 'any', o: { fresh?: boolean; move?: string } = {}): Promise<DaySlots[]> {
  const k = avKey(serviceIds, staffId, o.move);
  let e = av.get(k);
  if (!e) { e = { at: 0, p: null, days: null, err: null }; av.set(k, e); }
  if (e.p) return e.p;
  if (e.days && !o.fresh && Date.now() - e.at < 20000) return Promise.resolve(e.days);
  const entry = e;
  entry.p = loadSalon().then(() => {
    const q = new URLSearchParams({ from: today(), days: '14', services: serviceIds.join(','), staff: staffId });
    if (o.move) q.set('move', o.move);
    return call<{ days: DaySlots[] }>('GET', '/api/public/availability?' + q.toString());
  }).then((j) => { entry.days = j.days; entry.err = null; entry.at = Date.now(); emit(); return j.days; })
    .catch((err) => { entry.err = err instanceof SalonError ? err : new SalonError(String(err)); entry.at = Date.now(); throw entry.err; })
    .finally(() => { entry.p = null; });
  return entry.p;
}
/** What is already known, without waiting (null while the first answer is on its way). */
export function knownAvailability(serviceIds: string[], staffId = 'any', move?: string): DaySlots[] | null {
  return av.get(avKey(serviceIds, staffId, move))?.days || null;
}
export function invalidate() { av.forEach((e) => { e.at = 0; }); }

export async function earliest(serviceIds: string[], staffId = 'any'): Promise<{ day: string; start: number; staffId: string } | null> {
  const days = await availability(serviceIds, staffId);
  for (const d of days) if (d.slots.length) return { day: d.day, start: d.slots[0].m, staffId: d.slots[0].staffId };
  return null;
}
/** The next few free starts, across days (for "prochains créneaux" boards). */
export async function nextSlots(serviceIds: string[], n: number, staffId = 'any'): Promise<{ day: string; start: number; staffId: string }[]> {
  const days = await availability(serviceIds, staffId);
  const out: { day: string; start: number; staffId: string }[] = [];
  for (const d of days) for (const s of d.slots) { if (out.length >= n) return out; out.push({ day: d.day, start: s.m, staffId: s.staffId }); }
  return out;
}

/* ---------------- live: open now, the wait without appointment ---------------- */

let live: Live | null = null, liveAt = 0, liveP: Promise<Live | null> | null = null;
export function getLive(): Promise<Live | null> {
  if (liveP) return liveP;
  if (live && Date.now() - liveAt < 30000) return Promise.resolve(live);
  liveP = call<Live>('GET', '/api/public/live').then((j) => { live = j; liveAt = Date.now(); emit(); return j; }).catch(() => live).finally(() => { liveP = null; });
  return liveP;
}
export const knownLive = () => live;

/* ---------------- what a visitor does ---------------- */

export async function hold(serviceIds: string[], staffId: string, day: string, start: number) {
  const r = await call<{ holdId: string; staffId: string; exp: number }>('POST', '/api/public/holds', { serviceIds, staffId, day, start });
  invalidate();
  return { id: r.holdId, staffId: r.staffId, exp: r.exp - skew };
}
export function release(id: string | null | undefined) {
  if (!id) return;
  call('DELETE', '/api/public/holds/' + encodeURIComponent(id)).then(invalidate, () => { /* the hold expires anyway */ });
}
export async function book(o: { serviceIds: string[]; staffId: string; day: string; start: number; holdId?: string | null; first: string; last?: string; phone: string; email?: string; note?: string; sms?: boolean }) {
  const r = await call<BookResult>('POST', '/api/public/bookings', {
    serviceIds: o.serviceIds, staffId: o.staffId, day: o.day, start: o.start, holdId: o.holdId || undefined,
    first: o.first, last: o.last || undefined, phone: o.phone, email: o.email || undefined, note: o.note || undefined, sms: o.sms !== false
  });
  invalidate();
  emit();
  return r;
}
export function joinWaitlist(o: { day: string; staffId: string; serviceId: string; first: string; phone: string }) {
  return call<{ id: string }>('POST', '/api/public/waitlist', o);
}
export function offer(token: string) { return call<Offer>('GET', '/api/public/offers/' + encodeURIComponent(token)); }
