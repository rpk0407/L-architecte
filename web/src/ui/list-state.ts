// WP8 · The list pattern's state, as plain functions (no React, no DOM): tests/unit/listkit.test.js reads this file.
// ui/ListKit.tsx is the view over it. One order of gestures for every list: filter → select → act → undo.
//
// A selection is either rows ticked one by one (`ids`), or « everything this filter matches » (`all`), which keeps the
// FILTER and the rows unticked since, never the ids: the server resolves the filter when the action runs
// (server/http/routes-bulk.js), so a file that arrived since is in and the pages not loaded are in too. `expect` is the
// count the person saw on the button; the server refuses (409 `changed`) when it no longer holds.

export const PAGE = 60;
export const VIEWS_MAX = 8;
const NAME_MAX = 30, QUERY_MAX = 200;

/** 5 520, with the narrow no-break space */
export const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const files = (n: number) => num(n) + (n > 1 ? ' fiches' : ' fiche');

/* ---------------- selection ---------------- */

export type Filter = { q?: string | null; segment?: string | null; sort?: string | null };
/**
 * on: the list is in « Sélectionner » mode. key: the filter the selection belongs to. all: everything the filter
 * matches (`total` files), `ids` then being the rows unticked; null: `ids` are the rows ticked. capped: the filter
 * matched that many files, over the cap, and only its first ones are ticked (0 otherwise).
 */
export type Sel = { on: boolean; key: string; all: { total: number } | null; ids: string[]; capped: number };
export type AllIds = { key: string; total: number; ids: string[]; truncated: boolean; max: number };

export const NONE: Sel = { on: false, key: '', all: null, ids: [], capped: 0 };

/** What « the same filter » means for a selection: the search and the segment. The sort changes the order, not who is in. */
export function filterKey(f: Filter): string {
  return 'q=' + String(f.q || '').trim().toLowerCase() + '&segment=' + (f.segment || 'all');
}

export const start = (_sel: Sel, key: string): Sel => ({ on: true, key, all: null, ids: [], capped: 0 });
export const stop = (_sel: Sel): Sel => NONE;
export const clear = (sel: Sel): Sel => (sel.on ? { ...sel, all: null, ids: [], capped: 0 } : sel);

/** Tick or untick one row. Under « everything », unticking a row names it as an exception. */
export function toggle(sel: Sel, id: string): Sel {
  if (!sel.on) return sel;
  return { ...sel, ids: sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id] };
}
export const isSelected = (sel: Sel, id: string): boolean => sel.on && (sel.all ? !sel.ids.includes(id) : sel.ids.includes(id));
export const count = (sel: Sel): number => (!sel.on ? 0 : sel.all ? Math.max(0, sel.all.total - sel.ids.length) : sel.ids.length);

/**
 * The server's answer to « Tout sélectionner (N) » (GET …?fields=ids): the whole filter when it fits under the cap,
 * else its first `max` files by id, and `capped` says how many it really matches. An answer for another filter than
 * the one on screen (the person typed on) is dropped.
 */
export function selectAll(sel: Sel, res: AllIds): Sel {
  if (!sel.on || res.key !== sel.key) return sel;
  return res.truncated ? { ...sel, all: null, ids: res.ids.slice(0, res.max), capped: res.total } : { ...sel, all: { total: res.total }, ids: [], capped: 0 };
}

/** The filter on screen changed: what was ticked belonged to the other one, so it is dropped (the mode stays). */
export const forFilter = (sel: Sel, key: string): Sel => (!sel.on || sel.key === key ? sel : start(sel, key));

/** The list of the same filter says another total (someone booked, a file was erased): « everything » follows it. */
export function syncTotal(sel: Sel, key: string, total: number): Sel {
  return !sel.all || sel.key !== key || sel.all.total === total ? sel : { ...sel, all: { total } };
}

export type Target = { ids: string[] } | { filter: { q?: string; segment?: string }; except?: string[]; expect: number };
/** What the bulk request names: the ticked ids, or the filter, its exceptions and the count on the button. */
export function target(sel: Sel, f: Filter): Target {
  if (!sel.all) return { ids: sel.ids };
  const q = String(f.q || '').trim();
  const filter = { ...(q ? { q } : {}), ...(f.segment && f.segment !== 'all' ? { segment: f.segment } : {}) };
  return { filter, ...(sel.ids.length ? { except: sel.ids } : {}), expect: count(sel) };
}

/* ---------------- pages ---------------- */

/** The offsets of the pages on screen: each is asked once, by itself. */
export const pageOffsets = (pages: number): number[] => Array.from({ length: Math.max(1, pages) }, (_, i) => i * PAGE);
/** How many rows « Voir N de plus » brings. */
export const moreCount = (total: number, loaded: number): number => Math.max(0, Math.min(PAGE, total - loaded));
/** « 120 sur 5 520 »: a list that is cut says so; nothing once everything is there. */
export const cutLine = (total: number, loaded: number): string => (loaded < total ? num(loaded) + ' sur ' + num(total) : '');

/* ---------------- saved views (prefs.views: { page, name, query }, 8 at most) ---------------- */

export type SavedView = { page: string; name: string; query: string };
const VIEW_KEYS = ['q', 'segment', 'tri'] as const;

/** The query of a view, canonical: the list's own keys in one order, defaults left out, 200 characters at most. */
export function viewQuery(p: Record<string, string | null | undefined>): string {
  const u = new URLSearchParams();
  for (const k of VIEW_KEYS) {
    const v = String(p[k] || '').trim();
    if (v && !(k === 'segment' && v === 'all')) u.set(k, v);
  }
  let s = u.toString();
  // a search too long to store is cut on the value, never in the middle of an escape
  while (s.length > QUERY_MAX && u.get('q')) { u.set('q', (u.get('q') as string).slice(0, -1)); s = u.toString(); }
  return s.length > QUERY_MAX ? '' : s;
}
/** A saved query back into the list's keys (null: back to the default), whatever else the string holds. */
export function viewParams(query: string): Record<(typeof VIEW_KEYS)[number], string | null> {
  const u = new URLSearchParams(query);
  return { q: u.get('q') || null, segment: u.get('segment') || null, tri: u.get('tri') || null };
}
export const viewsOf = (views: SavedView[] | undefined, page: string): SavedView[] => (views || []).filter((v) => v.page === page);
export const activeView = (views: SavedView[] | undefined, page: string, query: string): SavedView | null => (query && viewsOf(views, page).find((v) => v.query === query)) || null;

/** Add a view, or replace the one of the same name on that page. `error`: why not, in the words to show. */
export function addView(views: SavedView[] | undefined, page: string, name: string, query: string): { views: SavedView[]; error?: string } {
  const all = views || [];
  const n = name.trim();
  if (!n) return { views: all, error: 'Donne un nom à cette vue.' };
  if (n.length > NAME_MAX) return { views: all, error: NAME_MAX + ' caractères au plus pour le nom.' };
  if (!query) return { views: all, error: 'Aucun filtre à enregistrer : choisis un segment ou une recherche.' };
  const at = all.findIndex((v) => v.page === page && v.name === n);
  if (at >= 0) return { views: all.map((v, i) => (i === at ? { page, name: n, query } : v)) };
  if (all.length >= VIEWS_MAX) return { views: all, error: VIEWS_MAX + ' vues au plus : retires-en une d’abord.' };
  return { views: [...all, { page, name: n, query }] };
}
export const removeView = (views: SavedView[] | undefined, page: string, name: string): SavedView[] => (views || []).filter((v) => !(v.page === page && v.name === name));

/* ---------------- after the action ---------------- */

export type Excluded = { noConsent: number; noPhone: number; recent: number; other: number };
export type BulkResult = { op: 'tag' | 'untag' | 'sms' | 'export'; tag?: string; changed?: number; unchanged?: number; missing?: number; full?: number; sent?: number; excluded?: Excluded; ids?: string[] };

/**
 * What « Annuler » sends: the inverse, on the files that really changed (those that had the tag before keep it).
 * null when there is nothing to take back, or when it cannot be: a text that left, a file downloaded.
 */
export function undoOf(r: BulkResult): { op: 'tag' | 'untag'; tag: string; ids: string[] } | null {
  if ((r.op !== 'tag' && r.op !== 'untag') || !r.tag || !r.ids || !r.ids.length) return null;
  return { op: r.op === 'tag' ? 'untag' : 'tag', tag: r.tag, ids: r.ids };
}

export function tagDone(r: BulkResult): { title: string; sub?: string } {
  const n = r.changed || 0;
  const sub = [
    r.unchanged ? num(r.unchanged) + (r.op === 'tag' ? (r.unchanged > 1 ? ' l’avaient déjà' : ' l’avait déjà') : (r.unchanged > 1 ? ' ne l’avaient pas' : ' ne l’avait pas')) : '',
    r.full ? num(r.full) + (r.full > 1 ? ' ont déjà 8 étiquettes' : ' a déjà 8 étiquettes') : '',
    r.missing ? files(r.missing) + (r.missing > 1 ? ' effacées ou fusionnées' : ' effacée ou fusionnée') + ' entre-temps' : ''
  ].filter(Boolean).join(' · ');
  const title = !n ? 'Aucune fiche à changer' : '« ' + r.tag + ' » ' + (r.op === 'tag' ? 'ajoutée à ' : 'retirée de ') + files(n);
  return sub ? { title, sub } : { title };
}

/** « 13 exclus : 10 sans accord pour les bons plans, … »: every file left out of a send, by reason; '' when none. */
export function excludedWords(x: Excluded | undefined): string {
  if (!x) return '';
  const parts = [
    x.noConsent ? num(x.noConsent) + ' sans accord pour les bons plans' : '',
    x.noPhone ? num(x.noPhone) + ' sans numéro ou SMS coupés' : '',
    x.recent ? num(x.recent) + (x.recent > 1 ? ' venus' : ' venu') + ' il y a moins de 7 jours ou jamais' : '',
    x.other ? num(x.other) + (x.other > 1 ? ' déjà relancés' : ' déjà relancé') + ' aujourd’hui ou numéro sans SMS' : ''
  ].filter(Boolean);
  const total = x.noConsent + x.noPhone + x.recent + x.other;
  return total ? num(total) + (total > 1 ? ' exclus : ' : ' exclu : ') + parts.join(', ') : '';
}
export function smsDone(r: { sent?: number; excluded?: Excluded }): { title: string; sub?: string } {
  const n = r.sent || 0;
  const sub = excludedWords(r.excluded);
  const title = !n ? 'Aucun SMS envoyé' : num(n) + (n > 1 ? ' relances en route' : ' relance en route');
  return sub ? { title, sub } : { title };
}
