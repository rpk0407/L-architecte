// Small DOM helpers. Every string that reaches innerHTML goes through esc().
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/** Writes text only when it changed (live chips refresh every minute; screen readers hear real changes only). */
export function setText(el: Element | null, text: string) { if (el && el.textContent !== text) el.textContent = text; }
export const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

// What each live block last drew, kept out of the DOM: a block is only re-drawn when its markup changed,
// so a focused button survives the minute refresh.
const drawn = new WeakMap<Element, string>();
/** Replaces el's markup if it changed. Returns true when it did; focus inside it moves to the same spot in the new markup. */
export function swap(el: Element | null, html: string) {
  if (!el || drawn.get(el) === html) return false;
  const a = document.activeElement;
  const at = a && el.contains(a) ? $$('a[href], button', el).indexOf(a as HTMLElement) : -1;
  drawn.set(el, html);
  el.innerHTML = html;
  if (at >= 0) ($$('a[href], button', el)[at] || $$('a[href], button', el)[0])?.focus({ preventScroll: true });
  return true;
}

/** Links that come from storage or the API: only http(s) or a same-site path, never a script. */
export function safeUrl(u: string | null | undefined, fallback = '') {
  const s = String(u || '').trim();
  if (/^\/(?!\/)/.test(s)) return s;
  try { const x = new URL(s); if (x.protocol === 'https:' || x.protocol === 'http:') return s; } catch { /* not a URL */ }
  return fallback;
}
/** Numbers keep their unit on the same line ("5 coupes sur 5 semaines"). */
export const keepUnits = (s: string) => s.replace(/(\d) /g, '$1\u00a0');

/** The arrow used on external links and "go" buttons. */
export const ARROW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
