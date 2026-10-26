// Small tools shared by the plates: a DOM builder (no innerHTML for anything that carries data),
// the salon's catalogue with the kit's fallbacks for first paint, and free-slot helpers.
import * as S from '../../site-kit/salon';
import { FALLBACK_SERVICES, FALLBACK_BARBERS } from '../../site-kit/content';
import type { Prefill } from '../../site-kit/booking';
import { dates, dayWord, dayShortWord } from '../../lib/format';
import { whenClosed } from './sheet';

/* ---------------- DOM ---------------- */

/** The non-breaking space (French typesetting). */
export const NB = '\u00a0';

type Kid = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined>;

/** h('p', { class: 'x' }, 'text', child): attributes are set, never parsed; false/null are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  for (const k of kids) if (k != null && k !== false) el.append(typeof k === 'number' ? String(k) : k);
  return el;
}
const NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs?: Attrs | null, ...kids: (Node | null | false)[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids) if (k) el.append(k);
  return el;
}
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll(sel)) as T[];
/** French typesetting for any text the page did not write itself (API bios, includes, content.ts): the space
 *  before ? ! : ; » and after « never breaks, nor the one after a short word, and a " · " separator stays
 *  at the end of its line instead of starting the next one. */
export const fr = (s: string) => s.replace(/\.\.\./g, '\u2026').replace(/ ([?!:;\u00bb%])/g, '\u00a0$1').replace(/\u00ab /g, '\u00ab\u00a0').replace(/ \u00b7 /g, '\u00a0\u00b7 ')
  .replace(/(?<=^|[\s\u00a0])(\u00e0|au|de|du|et|en|le|la|un|une) (?=\S)/g, '$1\u00a0');
/** Sets text only when it changed: aria-live regions stay quiet when nothing new happened. */
export function text(el: Element | null, t: string) { if (el && el.textContent !== t) el.textContent = t; }
/** Links that come from the salon or from this browser's storage: https or this site only. */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^\/(?!\/)/.test(u)) return u;
  try { const x = new URL(u, location.href); return x.protocol === 'https:' || x.origin === location.origin ? x.href : null; } catch { return null; }
}

/** Re-renders a block without losing the keyboard: whatever had focus inside it (marked with data-fk, a key
 *  that survives the fallback → live catalogue switch) gets it back on the new node, else the block's home. */
export function keepFocus(box: Element, render: () => void) {
  const a = document.activeElement as HTMLElement | null;
  const inside = !!a && box.contains(a);
  const key = inside ? a!.closest('[data-fk]')?.getAttribute('data-fk') : null;
  render();
  if (!inside || a!.isConnected) return;
  const t = (key && box.querySelector<HTMLElement>(`[data-fk="${CSS.escape(key)}"]`)) || box.querySelector<HTMLElement>('[data-fk-home]');
  t?.focus({ preventScroll: true });
}

/* ---------------- catalogue ---------------- */

export type Svc = { id: string | null; slug: string | null; name: string; short: string; category: string; price: number; from: boolean; dur: number; includes: string[]; description: string; pack: boolean };
export type Bar = { id: string | null; key: string; name: string; initials: string; color: string; bio: string; instagram: string };

export function services(): Svc[] {
  const sal = S.getSalon();
  if (!sal) return FALLBACK_SERVICES.map((x) => ({ ...x, id: null, includes: [...x.includes], description: '', pack: x.slug === 'ab' }));
  return sal.services.filter((x) => x.online).sort((a, b) => a.order - b.order)
    .map((x) => ({ id: x.id, slug: x.slug, name: x.name, short: x.short || x.name, category: x.category, price: x.price, from: x.from, dur: x.dur, includes: x.includes || [], description: x.description || '', pack: !!x.pack }));
}
let team: { of: S.Salon | null; list: Bar[] } | null = null;
/** The team in the salon's order (computed once per load of the salon). */
export function barbers(): Bar[] {
  const sal = S.getSalon();
  if (team && team.of === sal) return team.list;
  const list = !sal ? FALLBACK_BARBERS.map((b) => ({ ...b, id: null }))
    : sal.barbers.slice().sort((a, b) => a.order - b.order).map((b) => ({ id: b.id, key: S.barberKey(b), name: b.name, initials: b.initials, color: b.color, bio: b.bio || '', instagram: b.instagram || '' }));
  team = { of: sal, list };
  return list;
}
export const barberOf = (id: string | null | undefined) => (id ? barbers().find((b) => b.id === id) || null : null);
export const svcBySlug = (slug: string) => services().find((s) => s.slug === slug) || null;
export const totals = (list: Svc[]) => ({ price: list.reduce((a, s) => a + s.price, 0), dur: list.reduce((a, s) => a + s.dur, 0), from: list.some((s) => s.from) });

/** What the booking sheet needs: ids once the salon is loaded, slugs and keys before (the kit resolves them). */
export function prefill(list: Svc[], bar?: Bar | 'any' | null, day?: string, start?: number): Prefill {
  const p: Prefill = {};
  if (list.length && list.every((s) => s.id)) p.serviceIds = list.map((s) => s.id!);
  else p.slugs = list.map((s) => s.slug).filter((x): x is string => !!x);
  if (bar === 'any') p.staffId = 'any';
  else if (bar) { if (bar.id) p.staffId = bar.id; else p.staffKey = bar.key; }
  if (day) p.day = day;
  if (day && start != null) p.start = start;
  return p;
}
/** The same prefill, written as data-book attributes (so the kit's own click handler opens the sheet). */
export function bookAttrs(list: Svc[], bar?: Bar | 'any' | null, day?: string, start?: number): Attrs {
  const p = prefill(list, bar, day, start);
  return {
    'data-book': '', 'data-book-service': p.serviceIds?.join(','), 'data-book-slug': p.slugs?.join(','),
    'data-book-staff-id': p.staffId, 'data-book-staff': p.staffKey, 'data-book-day': p.day, 'data-book-start': p.start
  };
}
/** Rewrites the data-book attributes of an element that stays in place. */
export function setBook(el: Element, a: Attrs) {
  for (const k of ['data-book-service', 'data-book-slug', 'data-book-staff-id', 'data-book-staff', 'data-book-day', 'data-book-start']) {
    const v = a[k];
    if (v != null && v !== false) el.setAttribute(k, String(v)); else el.removeAttribute(k);
  }
}

/* ---------------- free slots ---------------- */

export type Free = { day: string; start: number; staffId: string };
// The API sends each slot as { m, s }; the kit's type says { m, staffId }. Read both.
const staffOf = (x: S.Slot) => x.staffId || (x as unknown as { s?: string }).s || '';

/** The next n free starts for these services (ids) with this barber ('any' for the first free). */
export async function freeSlots(ids: string[], staffId = 'any', n = 1, o: { perDay?: boolean; until?: string } = {}): Promise<Free[]> {
  if (!ids.length) return [];
  const days = await S.availability(ids, staffId);
  const out: Free[] = [];
  for (const d of days) {
    if (o.until && d.day > o.until) break;
    for (const x of d.slots) {
      out.push({ day: d.day, start: x.m, staffId: staffOf(x) || staffId });
      if (out.length >= n) return out;
      if (o.perDay) break;
    }
  }
  return out;
}
export const idsOf = (list: Svc[]) => (list.every((s) => s.id) ? list.map((s) => s.id!) : []);

/** "Aujourd’hui · 16 h", "Demain · 9 h 30", "Jeudi 29 octobre · 11 h" */
export const whenLong = (f: { day: string; start: number }) => dayWord(f.day, S.today()) + ' · ' + dates.fmtTime(f.start);
/** "auj. 16 h", "demain 9 h 30", "jeu. 29 oct. 11 h" */
export const whenShort = (f: { day: string; start: number }) => dayShortWord(f.day, S.today()) + ' ' + dates.fmtTime(f.start);
/** The Saturday that closes the salon's current week. */
export function endOfWeek(day = S.today()) { const wd = dates.dayParts(day).wd; return dates.addDays(day, wd === 0 ? 6 : 6 - wd); }

/** Calls fn once the salon is loaded (also after a failed first load, when a retry succeeds), after every
 *  booking made on this page, and when the visitor comes back to the tab after a while: the moments free
 *  slots can have moved. Never while the booking sheet is open: the element that opened it must still be
 *  there to take the focus back when it closes. */
export function onSlots(fn: () => void) {
  let at = 0;
  const job = () => { at = Date.now(); fn(); };
  const run = () => whenClosed(job);
  S.loadSalon().then(run, () => { const off = S.onChange(() => { if (S.getSalon()) { off(); run(); } }); });
  addEventListener('lx:booked', run);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && at && Date.now() - at > 120000) run(); });
}
