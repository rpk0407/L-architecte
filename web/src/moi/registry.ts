// /moi's folder registries (INDEX › Shared contracts): a card is one file in ./cards, a « Mes avantages » row one file in
// ./avantages, each exporting `meta` and a default component. Vite reads the folders at build time, so another area adds
// its card by adding its file, with no line to edit here. The sorting is plain functions, tested with a fixture glob.
import type { AvantageModule, MoiCardModule } from './types';
import type { Tab } from './paths';

export const TABS: Tab[] = ['home', 'history', 'profile'];

/** A function component, or a memo/forwardRef one (an object React recognises). */
const isComponent = (c: unknown) => typeof c === 'function' || (!!c && typeof c === 'object' && '$$typeof' in c);
const valid = (m: unknown): m is MoiCardModule => {
  const x = m as MoiCardModule | null;
  return !!x && isComponent(x.default) && !!x.meta && typeof x.meta.id === 'string' && TABS.includes(x.meta.tab) && Number.isFinite(x.meta.order);
};

/** A glob's modules → each tab's cards, by order then id (a file without a usable meta is left out, never a crash). */
export function cardsOf(mods: Record<string, unknown>): Record<Tab, MoiCardModule[]> {
  const out: Record<Tab, MoiCardModule[]> = { home: [], history: [], profile: [] };
  for (const m of Object.values(mods)) if (valid(m)) out[m.meta.tab].push(m);
  for (const t of TABS) out[t].sort((a, b) => a.meta.order - b.meta.order || a.meta.id.localeCompare(b.meta.id));
  return out;
}

/** A glob's « Mes avantages » rows, by order then id. */
export function avantagesOf(mods: Record<string, unknown>): AvantageModule[] {
  return Object.values(mods)
    .filter((m): m is AvantageModule => { const x = m as AvantageModule | null; return !!x && isComponent(x.default) && !!x.meta && typeof x.meta.id === 'string' && Number.isFinite(x.meta.order); })
    .sort((a, b) => a.meta.order - b.meta.order || a.meta.id.localeCompare(b.meta.id));
}

let cards: Record<Tab, MoiCardModule[]> | null = null;
/** The cards of a tab, from web/src/moi/cards/*.tsx (read once, on first use: Node can import this file for its tests). */
export function tabCards(tab: Tab): MoiCardModule[] {
  if (!cards) cards = cardsOf(import.meta.glob('./cards/*.tsx', { eager: true }));
  return cards[tab];
}
