// Small DOM helpers shared by the sections. Every value from the salon or the visitor goes in through
// textContent (h() below); innerHTML only ever receives this module's own constant SVG paths.
import { dates } from '../../lib/format';
import * as S from '../../site-kit/salon';

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
export const NB = ' ';

type Attrs = Record<string, string | number | boolean | null | undefined>;
/** h('button', { class: 'x', 'data-book': '' }, 'Réserver') — false/null attributes are left out */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) el.setAttribute(k, v === true ? '' : String(v));
  for (const k of kids) if (k != null && k !== false) el.append(k);
  return el;
}
export function svg(path: string, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = path;
  return s;
}
export const ARROW = '<path d="M4 12h15M13 6l6 6-6 6"/>';
export const PLUS = '<path d="M12 5v14M5 12h14"/>';
export const OUT = '<path d="M7 17L17 7M8 7h9v9"/>';

/** The booking attributes a [data-book] element carries (the kit's sheet reads them on click). */
export function bookAttrs(el: HTMLElement, p: { slugs?: string[]; staff?: string | null; day?: string | null; start?: number | null; source?: string }) {
  const set = (k: string, v: string | null | undefined) => { if (v) el.setAttribute(k, v); else el.removeAttribute(k); };
  el.setAttribute('data-book', '');
  set('data-book-slug', p.slugs?.length ? p.slugs.join(',') : null);
  set('data-book-staff', p.staff || null);
  set('data-book-day', p.day || null);
  set('data-book-start', p.day && p.start != null ? String(p.start) : null);
  set('data-book-source', p.source || null);
}

const capF = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Aujourd’hui", "Demain", "Jeudi 29": short enough for a row */
export function dayName(day: string) {
  const n = dates.diffDays(S.today(), day);
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  const p = dates.dayParts(day);
  return capF(dates.DAYS_FR[p.wd]) + ' ' + p.d;
}
/** The one short form of a day: "Demain", "Jeu. 29" (lower: "demain", "jeu. 29", for inside a sentence) */
export function dayShort(day: string, lower = false) {
  const n = dates.diffDays(S.today(), day);
  const p = dates.dayParts(day);
  const w = n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : dates.DAYS_SH[p.wd] + ' ' + p.d;
  return lower ? w : capF(w);
}
/** "aujourd’hui à 16 h", "demain à 9 h 30", "jeudi 29 octobre à 10 h" */
export function whenWords(day: string, m: number) {
  const n = dates.diffDays(S.today(), day);
  return (n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : dates.dayLong(day)) + ' à ' + dates.fmtTime(m);
}
/** Only this site's own links and https: ones go into an href (values from storage or the API). */
export function safeUrl(u: string | null | undefined) {
  if (!u) return null;
  try { const x = new URL(u, location.href); return x.origin === location.origin || x.protocol === 'https:' ? u : null; } catch { return null; }
}

/** Runs cb(true/false) as the element enters or leaves the screen. */
export function watch(el: Element | null, cb: (on: boolean) => void, margin = '0px') {
  if (!el) return;
  if (typeof IntersectionObserver === 'undefined') { cb(true); return; }
  new IntersectionObserver((es) => { for (const e of es) cb(e.isIntersecting); }, { rootMargin: margin }).observe(el);
}

/** A barber's monogram on stone, the brand's dot screen on the lower half, his colour as a thin ring. */
export function mono(b: { initials: string; color: string }, cls = 'mono') {
  const el = h('span', { class: cls, 'aria-hidden': 'true' }, b.initials);
  el.style.setProperty('--c', b.color);
  return el;
}

/** Re-renders a list without losing a keyboard user: the focused [data-fk] element, or its fallback
 *  (fallback(key) → another data-fk), gets the focus back once the new nodes are in. */
export function keepFocus(host: Element, render: () => void, fallback?: (key: string) => string) {
  const a = document.activeElement as HTMLElement | null;
  const k = a && host.contains(a) ? a.dataset.fk : undefined;
  render();
  if (!k) return;
  const el = host.querySelector<HTMLElement>('[data-fk="' + CSS.escape(k) + '"]') || (fallback ? host.querySelector<HTMLElement>('[data-fk="' + CSS.escape(fallback(k)) + '"]') : null);
  el?.focus({ preventScroll: true });
}
