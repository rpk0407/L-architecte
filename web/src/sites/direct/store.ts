// What every module of the page reads: the catalogue and the team (live, or content.ts until the salon
// answers), the free slots of every barber merged into one list, and the little state the modules share
// (the service the board and the chairs are showing). Nothing here touches the DOM.
import * as S from '../../site-kit/salon';
import { FALLBACK_BARBERS, FALLBACK_SERVICES } from '../../site-kit/content';

export type Svc = { id: string | null; slug: string; name: string; short: string; category: string; price: number; from: boolean; dur: number; includes: string[] };
export type Bar = { id: string | null; key: string; name: string; initials: string; color: string; bio: string; instagram: string };
export type Free = { day: string; m: number; key: string };

export function services(): Svc[] {
  const sal = S.getSalon();
  if (!sal) return FALLBACK_SERVICES.map((x) => ({ ...x, id: null }));
  return sal.services.filter((x) => x.online && x.slug).sort((a, b) => a.order - b.order)
    .map((x) => ({ id: x.id, slug: x.slug!, name: x.name, short: x.short || x.name, category: x.category, price: x.price, from: x.from, dur: x.dur, includes: x.includes || [] }));
}
export function barbers(): Bar[] {
  const sal = S.getSalon();
  if (!sal) return FALLBACK_BARBERS.map((b) => ({ ...b, id: null }));
  return sal.barbers.slice().sort((a, b) => a.order - b.order)
    .map((b) => ({ id: b.id, key: S.barberKey(b), name: b.name, initials: b.initials, color: b.color, bio: b.bio, instagram: b.instagram }));
}
export const svc = (slug: string) => services().find((x) => x.slug === slug) || null;
export const barber = (keyOrId: string | null | undefined) => (keyOrId ? barbers().find((b) => b.key === keyOrId || b.id === keyOrId) || null : null);
export const slugsOf = (ids: string[]) => ids.map((id) => S.serviceById(id)?.slug).filter((x): x is string => !!x);
export function total(slugs: string[]) {
  const l = slugs.map(svc).filter((x): x is Svc => !!x);
  return { price: l.reduce((a, x) => a + x.price, 0), dur: l.reduce((a, x) => a + x.dur, 0), from: l.some((x) => x.from), names: l.map((x) => x.name), shorts: l.map((x) => x.short) };
}

/* ---------------- free slots, every barber at once ---------------- */
// One availability call per barber: each slot is known to be his without reading the API's staff field.

const idsOf = (slugs: string[]) => slugs.map((s) => S.serviceBySlug(s)?.id).filter((x): x is string => !!x);

function merge(per: { b: Bar; days: S.DaySlots[] | null }[]): Free[] {
  const out: Free[] = [];
  for (const { b, days } of per) for (const d of days || []) for (const x of d.slots) out.push({ day: d.day, m: x.m, key: b.key });
  const order = new Map(barbers().map((b, i) => [b.key, i]));
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.m - b.m || (order.get(a.key)! - order.get(b.key)!));
}

/** Every barber's free starts for these services over 14 days, soonest first. Rejects only if no barber answered. */
export async function pool(slugs: string[], fresh = false): Promise<Free[]> {
  await S.loadSalon();
  const ids = idsOf(slugs);
  if (!ids.length) return [];
  const team = barbers();
  let ok = 0, err: unknown = null;
  const per = await Promise.all(team.map((b) => S.availability(ids, b.id!, { fresh }).then((days) => { ok++; return { b, days }; }, (e) => { err = e; return { b, days: null }; })));
  if (!ok && err) throw err;
  return merge(per);
}
/** The same, from what is already cached (null while nothing is known). */
export function knownPool(slugs: string[]): Free[] | null {
  if (!S.getSalon()) return null;
  const ids = idsOf(slugs);
  if (!ids.length) return [];
  const per = barbers().map((b) => ({ b, days: S.knownAvailability(ids, b.id!) }));
  return per.every((p) => !p.days) ? null : merge(per);
}

/* ---------------- shared page state ---------------- */

type Shared = { svc: string; staff: string };
const st: Shared = { svc: 'cl', staff: 'any' };
const subs = new Set<() => void>();
export const shared = () => st;
export function setShared(p: Partial<Shared>) { Object.assign(st, p); subs.forEach((f) => f()); }
export function onShared(f: () => void) { subs.add(f); }
