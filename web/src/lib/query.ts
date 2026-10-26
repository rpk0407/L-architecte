// A small query cache. Screens read with useQuery(path); when the journal version moves (someone booked,
// paid, cancelled — on this device or another), every visible query refreshes. Stale data stays on
// screen while the fresh copy loads, so nothing flickers.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api, ApiError } from './api';

type Entry = { data?: any; error?: ApiError; loading: boolean; at: number; inflight?: Promise<any>; subs: Set<() => void>; snap: Snap };
type Snap = { data: any; error: ApiError | undefined; loading: boolean };

const cache = new Map<string, Entry>();
function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) { e = { loading: false, at: 0, subs: new Set(), snap: { data: undefined, error: undefined, loading: false } }; cache.set(key, e); }
  return e;
}
function publish(e: Entry) { e.snap = { data: e.data, error: e.error, loading: e.loading }; e.subs.forEach((fn) => fn()); }

export function load(key: string): Promise<any> {
  const e = entry(key);
  if (e.inflight) return e.inflight;
  e.loading = true;
  publish(e);
  e.inflight = api.get(key).then(
    (d) => { e.data = d; e.error = undefined; e.at = Date.now(); },
    (err) => { e.error = err instanceof ApiError ? err : new ApiError(0, 'unknown', String(err)); }
  ).finally(() => { e.loading = false; e.inflight = undefined; publish(e); });
  return e.inflight;
}

/** Refresh everything on screen; forget the rest so it reloads when opened again. */
export function refreshAll() {
  for (const [key, e] of cache) {
    if (e.subs.size) load(key);
    else e.at = 0;
  }
}
export function prime(key: string, data: any) { const e = entry(key); e.data = data; e.at = Date.now(); publish(e); }
export function peek<T = any>(key: string): T | undefined { return cache.get(key)?.data; }
export function forget(prefix = '') { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); }

export function useQuery<T = any>(key: string | null, opts: { maxAge?: number } = {}) {
  const k = key || '';
  const subscribe = useCallback((fn: () => void) => {
    if (!k) return () => {};
    const e = entry(k);
    e.subs.add(fn);
    return () => { e.subs.delete(fn); };
  }, [k]);
  const snap = useSyncExternalStore(subscribe, () => (k ? entry(k).snap : EMPTY), () => EMPTY);
  useEffect(() => {
    if (!k) return;
    const e = entry(k);
    if (!e.at || Date.now() - e.at > (opts.maxAge ?? 0)) load(k);
  }, [k]);
  return { data: snap.data as T | undefined, error: snap.error, loading: snap.loading && snap.data === undefined, refreshing: snap.loading, refresh: () => (k ? load(k) : Promise.resolve()) };
}
const EMPTY: Snap = { data: undefined, error: undefined, loading: false };
