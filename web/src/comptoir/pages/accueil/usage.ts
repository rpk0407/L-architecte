// WP5 · Accueil: what this person did with each card, counted on the device only (`lx-accueil-usage`, 30 days): how
// often he dealt with it, how often he put it off. It serves to hide a card until tomorrow (« Plus tard ») and to
// PROPOSE hiding one he keeps putting off; it never moves or hides anything by itself, and nothing goes to the server
// (every prefs write is a line of the sealed journal: counters have no place there).
export const USAGE_KEY = 'lx-accueil-usage';
export const USAGE_DAYS = 30;
/** « Tu remets … à plus tard depuis 5 fois : la masquer ? » */
export const LATER_ASK = 5;

/** d: when he pressed the card's button; l: when he put it off; on: the salon day of the last « Plus tard ». */
export type CardUse = { d: number[]; l: number[]; on?: string };
export type Usage = Record<string, CardUse>;
export type Store = Pick<Storage, 'getItem' | 'setItem'>;

const DAY = 86400000;
const stamps = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []);

/** Only the last 30 days count; a card with nothing left is dropped. */
export function prune(u: Usage, now: number): Usage {
  const out: Usage = {};
  for (const id of Object.keys(u)) {
    const c = u[id];
    const d = stamps(c?.d).filter((t) => now - t < USAGE_DAYS * DAY && t <= now);
    const l = stamps(c?.l).filter((t) => now - t < USAGE_DAYS * DAY && t <= now);
    if (d.length || l.length) out[id] = { d, l, ...(typeof c.on === 'string' && l.length ? { on: c.on } : {}) };
  }
  return out;
}

export function readUsage(store: Store | null, now: number): Usage {
  try {
    const v = JSON.parse(store?.getItem(USAGE_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? prune(v as Usage, now) : {};
  } catch { return {}; }
}
export function writeUsage(store: Store | null, u: Usage): void {
  try { store?.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* private mode: nothing kept */ }
}

/** He pressed the card's button. */
export function done(u: Usage, id: string, now: number): Usage {
  const c = u[id] || { d: [], l: [] };
  return prune({ ...u, [id]: { ...c, d: [...c.d, now] } }, now);
}
/** « Plus tard »: hidden for the rest of the salon's day `today`, and counted. */
export function later(u: Usage, id: string, now: number, today: string): Usage {
  const c = u[id] || { d: [], l: [] };
  return prune({ ...u, [id]: { d: c.d, l: [...c.l, now], on: today } }, now);
}
/** « Garder »: the question is not asked again until he has put the card off five more times. */
export function keep(u: Usage, id: string): Usage {
  const c = u[id];
  return c ? { ...u, [id]: { d: c.d, l: [], ...(c.on ? { on: c.on } : {}) } } : u;
}
/** Put off today (the salon's day, from the server's answer)? */
export const isLater = (u: Usage, id: string, today: string): boolean => u[id]?.on === today;

/** The one card to ask about: put off 5 times or more in 30 days, still hideable, the most put off first. */
export function toAsk(u: Usage, cards: readonly { id: string; canHide: boolean }[]): string | null {
  let best: string | null = null, n = LATER_ASK - 1;
  for (const c of cards) { const k = u[c.id]?.l.length || 0; if (c.canHide && k > n) { best = c.id; n = k; } }
  return best;
}
