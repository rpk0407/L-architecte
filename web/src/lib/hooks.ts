import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMedia(query: string) {
  return useSyncExternalStore(
    (fn) => { const m = matchMedia(query); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); },
    () => matchMedia(query).matches,
    () => false
  );
}
export const useIsPhone = () => useMedia('(max-width: 760px)');
export const useIsWide = () => useMedia('(min-width: 1100px)');

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function useDebounced<T>(value: T, ms = 220) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Desktop shortcuts. Ignored while typing in a field. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[] = []) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const key = (e.metaKey || e.ctrlKey ? 'mod+' : '') + e.key.toLowerCase();
      const fn = map[key];
      if (!fn || (typing && !key.startsWith('mod+') && key !== 'escape')) return;
      fn(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, deps);
}

export function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s == null ? init : JSON.parse(s); } catch { return init; } });
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* private mode */ } }];
}

export function buzz(p: number | number[]) { try { navigator.vibrate?.(p); } catch { /* not supported */ } }
