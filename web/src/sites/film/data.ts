// The salon as this page reads it: the live catalogue once loaded, content.ts until then (first paint, API down).
// Also the few derived words the film repeats: prices, slot labels, the barbers' role lines.
import * as S from '../../site-kit/salon';
import { FALLBACK_SERVICES, FALLBACK_BARBERS } from '../../site-kit/content';
import { dates, eur, dur } from '../../lib/format';
import { esc } from './util';

export type Svc = { id: string | null; slug: string; name: string; short: string; category: string; price: number; from: boolean; dur: number; includes: string[]; description: string; credits: number };
export type Cast = { id: string | null; key: string; name: string; bio: string; instagram: string };
export type NextSlot = { day: string; start: number; staffId: string };

export function services(): Svc[] {
  const s = S.getSalon();
  if (s) return s.services.filter((x) => x.online !== false).sort((a, b) => a.order - b.order).map((x) => ({ ...x, slug: x.slug || x.id, includes: x.includes || [], credits: x.pack?.credits || 0 }));
  // content.ts states the subscription as "5 coupes sur 5 semaines"
  return FALLBACK_SERVICES.map((x) => ({ ...x, id: null, description: '', credits: x.slug === 'ab' ? 5 : 0 }));
}
export const svc = (slug: string) => services().find((x) => x.slug === slug) || null;
export const priceText = (x: Pick<Svc, 'price' | 'from'>) => (x.from ? 'dès ' : '') + eur(x.price);
export const durText = (x: Pick<Svc, 'dur'>) => dur(x.dur);

export function cast(): Cast[] {
  const s = S.getSalon();
  if (s) return s.barbers.slice().sort((a, b) => a.order - b.order).map((b) => ({ id: b.id, key: S.barberKey(b), name: b.name, bio: b.bio || '', instagram: b.instagram || '' }));
  return FALLBACK_BARBERS.map((b) => ({ id: null, key: b.key, name: b.name, bio: b.bio, instagram: b.instagram }));
}
/** The credit line: the first sentence of the barber's own bio. */
export const roleLine = (bio: string) => (bio.split(/\.\s/)[0] || '').replace(/\.$/, '');

/** data-book attributes for a prefilled sheet. Before the catalogue loads, slugs stand in for ids. */
export function bookAttrs(o: { slug?: string; serviceIds?: string[]; staffId?: string | null; staffKey?: string; day?: string; start?: number; source: string }) {
  const a: string[] = ['data-book', `data-book-source="${esc(o.source)}"`];
  if (o.serviceIds?.length) a.push(`data-book-service="${esc(o.serviceIds.join(','))}"`);
  else if (o.slug) { const x = svc(o.slug); a.push(x?.id ? `data-book-service="${esc(x.id)}"` : `data-book-slug="${esc(o.slug)}"`); }
  if (o.staffId) a.push(`data-book-staff-id="${esc(o.staffId)}"`);
  else if (o.staffKey) a.push(`data-book-staff="${esc(o.staffKey)}"`);
  if (o.day) a.push(`data-book-day="${esc(o.day)}"`);
  if (o.start != null) a.push(`data-book-start="${o.start}"`);
  return a.join(' ');
}

/** "aujourd’hui 16 h", "demain 9 h 30", "jeudi 9 h" */
export function slotWords(day: string, start: number) {
  const d = dates.diffDays(S.today(), day);
  const w = d === 0 ? 'aujourd’hui' : d === 1 ? 'demain' : d < 7 ? dates.DAYS_FR[dates.dayParts(day).wd] : dates.dayShort(day);
  return w + ' ' + dates.fmtTime(start);
}

// The API sends slots as { m, s } (s = barber id); the kit's type says staffId. Read both.
const staffOf = (x: S.Slot) => x.staffId || (x as unknown as { s?: string }).s || '';

/** The first free start for the classic cut (the reference service), for one barber or anyone. */
export async function firstSlot(staffId = 'any'): Promise<NextSlot | null> {
  const ref = svc('cl');
  if (!ref?.id) return null;
  const days = await S.availability([ref.id], staffId);
  for (const d of days) if (d.slots.length) return { day: d.day, start: d.slots[0].m, staffId: staffOf(d.slots[0]) || staffId };
  return null;
}
