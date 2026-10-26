// Small DOM helpers. Every string that reaches innerHTML goes through esc().
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/** Writes text only when it changed (live chips refresh every minute; screen readers hear real changes only). */
export function setText(el: Element | null, text: string) { if (el && el.textContent !== text) el.textContent = text; }
export const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** The arrow used on external links and "go" buttons. */
export const ARROW = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
