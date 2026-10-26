// History-API router for the Comptoir: /comptoir/<page>/<id>. Small on purpose.
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';

const BASE = '/comptoir';
const subs = new Set<() => void>();
let current = parse();

function parse() {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'agenda', id: parts[1] || null, sub: parts[2] || null, query: new URLSearchParams(location.search), key: p + location.search };
}
function emit() { current = parse(); subs.forEach((fn) => fn()); }
window.addEventListener('popstate', emit);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const url = to.startsWith('/') ? BASE + (to === '/' ? '' : to) : to;
  if (url === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  emit();
  if (!opts.replace) window.scrollTo({ top: 0 });
}
export function setQuery(params: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
  const s = q.toString();
  history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  emit();
}

export function useRoute() {
  return useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, () => current);
}

export function Link({ to, children, className, onClick, ...rest }: { to: string; children: ReactNode; className?: string; onClick?: () => void; [k: string]: any }) {
  const href = BASE + (to === '/' ? '' : to);
  const go = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onClick?.();
    navigate(to);
  };
  return <a href={href} className={className} onClick={go} {...rest}>{children}</a>;
}
