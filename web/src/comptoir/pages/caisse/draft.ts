// A ticket being rung up survives leaving the till and the tablet's 4-minute lock: it is kept on this device, for
// this person and this ticket only, until it is validated or abandoned. Pure rules, no React (Checkout.tsx uses them,
// tests/unit/ticket-draft.test.js reads the same ones).
//  - kept in the tab's own store (sessionStorage): it goes when the tab is closed, and never leaves the device;
//  - for the day only: yesterday's ticket is not offered again;
//  - a gift card's code is never written down (the card is typed again), a deposit comes back from the server;
//  - the request key is kept, so a validation whose answer was lost is the same sale when retried, never a second one.

export type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void; key: (i: number) => string | null; length: number };
export type DraftPay = { method: string; ref?: string; [k: string]: unknown };
export type Draft<L = unknown, P extends DraftPay = DraftPay> = {
  v: 1; day: string; at: number; rid: string; lines: L[]; disc: { amount: number; reason: string } | null; tip: { amount: number; staffId: string } | null;
  pays: P[]; clientId: string | null; giftDropped?: boolean;
};

const PREFIX = 'lx-ticket:';
export const draftKey = (staffId: string, apptId: string | null) => PREFIX + staffId + ':' + (apptId || 'free');

/** What may be written down of the payments: not the deposit (the server gives it back), never a gift card's code. */
export function keptPays<P extends DraftPay>(pays: P[]): { pays: P[]; giftDropped: boolean } {
  return { pays: pays.filter((p) => p.method !== 'giftcard' && p.method !== 'deposit'), giftDropped: pays.some((p) => p.method === 'giftcard') };
}

export function saveDraft<L, P extends DraftPay>(store: Store | null, key: string, d: Omit<Draft<L, P>, 'v' | 'giftDropped'>): boolean {
  if (!store) return false;
  const { pays, giftDropped } = keptPays(d.pays);
  try { store.setItem(key, JSON.stringify({ ...d, v: 1, pays, ...(giftDropped ? { giftDropped: true } : {}) })); return true; } catch { return false; /* private mode, full */ }
}

/** The draft of this ticket, if it is today's and readable; anything else is thrown away. */
export function loadDraft<L, P extends DraftPay>(store: Store | null, key: string, today: string): Draft<L, P> | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || d.day !== today || typeof d.rid !== 'string' || !Array.isArray(d.lines) || !Array.isArray(d.pays)) { store.removeItem(key); return null; }
    return d;
  } catch { try { store.removeItem(key); } catch { /* nothing to clear */ } return null; }
}

export function clearDraft(store: Store | null, key: string) { try { store?.removeItem(key); } catch { /* nothing to clear */ } }

/** The tickets this person left in progress today: appointment ids, and 'free' for a sale without appointment. */
export function draftsOf(store: Store | null, staffId: string, today: string): Set<string> {
  const out = new Set<string>();
  if (!store) return out;
  const mine = PREFIX + staffId + ':';
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(mine)) keys.push(k); }
    for (const k of keys) if (loadDraft(store, k, today)) out.add(k.slice(mine.length));
  } catch { /* unreadable store: no draft */ }
  return out;
}

/** The tab's store, or nothing where the browser refuses it. */
export function tabStore(): Store | null { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } }
