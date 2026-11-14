// WP5 · Accueil: the last answer of GET /api/v1/home kept on the device (`lx-home`), painted first on the next visit
// with « lu à … » and replaced when the server answers. Three rules: it is never written on a shared salon screen (a
// PIN session on a device that is nobody's own phone), it is one person's (another person's copy is thrown away, not
// shown), and signing out removes it (home.ts forgetHome, called by the shell).
import type { Home } from '../../types';

export const SNAP_KEY = 'lx-home';
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isHome = (h: any): h is Home =>
  !!h && typeof h === 'object' && typeof h.asOf === 'number' && !!h.line && typeof h.line.label === 'string' && Array.isArray(h.line.facts)
  && !!h.day && Array.isArray(h.day.appts) && Array.isArray(h.day.chairs) && Array.isArray(h.cards) && Array.isArray(h.quiet);

/** This person's copy, or null (none, unreadable, an older shape, someone else's: those are removed). */
export function readSnap(store: Store | null, who: string): Home | null {
  if (!store) return null;
  try {
    const raw = store.getItem(SNAP_KEY);
    if (raw == null) return null;
    const v = JSON.parse(raw);
    if (v && v.who === who && isHome(v.home)) return v.home;
    store.removeItem(SNAP_KEY);
  } catch { /* private mode, a broken copy: nothing to show first */ }
  return null;
}

/** Keep this answer for the next visit. On a shared screen nothing is written and any copy left there goes. */
export function writeSnap(store: Store | null, who: string, home: Home, shared: boolean): boolean {
  if (!store) return false;
  try {
    if (shared) { store.removeItem(SNAP_KEY); return false; }
    store.setItem(SNAP_KEY, JSON.stringify({ who, home }));
    return true;
  } catch { return false; }
}

export function clearSnap(store: Store | null): void {
  try { store?.removeItem(SNAP_KEY); } catch { /* nothing kept */ }
}
