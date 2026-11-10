// WP8 · ListKit: the one pattern of every list of objects (docs/owner-experience.md, 3.6): filter → select → act → undo.
// Clients is the first list on it; Messages envoyés, Tickets, Liste d’attente and Catalogue follow.
// - useSelection: rows ticked one by one, or « everything this filter matches » (the filter is kept, not the ids:
//   the server resolves it when the action runs). A selection never outlives its filter.
// - ActionBar: stuck at the bottom while the list is in « Sélectionner » mode, above the phone's tabs: one main action,
//   the others under « ⋯ ».
// - usePages / LoadMore: pages of 60 by `offset`; the next page never asks for the ones before; a cut list says so.
// - SavedViews: a name and the query string, in prefs.views (8 at most), shown as the first chips.
// - bulkPost / downloadPost / holdThen: one request id per gesture (a retry never applies twice), a download that
//   keeps the file as the server wrote it, and a send held back a few seconds for « Annuler ».
// The state itself is plain functions in ./list-state.ts (tests/unit/listkit.test.js). Styles: `.lk-*`, in
// comptoir/pages/clients.css until a second list uses them.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, uuid, withRetry } from '../lib/api';
import { Icon } from './Icon';
import { Button, Chip, Field, Menu, Modal, toast, toastError } from './kit';
import * as L from './list-state';

export { L as listState };
export type { Sel, Filter, Target, BulkResult, Excluded, SavedView, AllIds } from './list-state';

/* ---------------- selection ---------------- */

/**
 * key: the filter on screen (list-state filterKey). total: what the list of that filter counts now, once known.
 * all(load): « Tout sélectionner (N) »: `load` asks the server for the ids of the whole filter (its count and whether
 * it is cut at the cap); the answer is dropped if the filter changed meanwhile.
 */
export function useSelection(key: string, total: number | undefined) {
  const [sel, setSel] = useState<L.Sel>(L.NONE);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel((s) => L.forFilter(s, key)); }, [key]);
  useEffect(() => { if (total != null) setSel((s) => L.syncTotal(s, key, total)); }, [key, total]);
  const all = useCallback(async (load: () => Promise<Omit<L.AllIds, 'key'>>) => {
    setBusy(true);
    try {
      const res = await load();
      setSel((s) => L.selectAll(s, { ...res, key }));
      return res;
    } finally { setBusy(false); }
  }, [key]);
  // a row of another filter, still on screen while the new one loads, is never shown as ticked
  const cur = sel.on && sel.key !== key ? L.forFilter(sel, key) : sel;
  return {
    sel: cur, on: cur.on, count: L.count(cur), busy,
    start: () => setSel((s) => L.start(s, key)),
    stop: () => setSel(L.stop),
    clear: () => setSel(L.clear),
    toggle: (id: string) => setSel((s) => L.toggle(L.forFilter(s, key), id)),
    isSelected: (id: string) => L.isSelected(cur, id),
    all,
    target: (f: L.Filter) => L.target(cur, f)
  };
}
export type Selection = ReturnType<typeof useSelection>;

/** The tick of a row in « Sélectionner » mode. The row itself is the button: this is only its mark. */
export function Tick({ on }: { on: boolean }) {
  return <span className={'lk-tick' + (on ? ' on' : '')} aria-hidden>{on ? <Icon name="check" size={16} /> : null}</span>;
}

/** short: the words on a phone, where the bar has little room */
type Act = { label: string; short?: string; icon?: string; run: () => void; disabled?: boolean };
/**
 * The bar of the selection. total: what the filter matches (for « Tout sélectionner (N) »); onAll asks for it.
 * main: the one accent button; more: the rest, under « ⋯ ». What is selected is always written out: « 3 fiches »,
 * « Les 214 du filtre », « 2 000 premières sur 5 520 ».
 */
export function ActionBar({ sel, total, noun = ['fiche', 'fiches'], onAll, onClear, onClose, main, more = [], busy }: {
  sel: L.Sel; total: number; noun?: [string, string]; onAll: () => void; onClear: () => void; onClose: () => void; main?: Act; more?: Act[]; busy?: boolean;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const n = L.count(sel);
  const words = (k: number) => L.num(k) + ' ' + (k > 1 ? noun[1] : noun[0]);
  const whole = !!sel.all && !sel.ids.length;
  const what = !n ? 'Coche des ' + noun[1] : sel.capped ? L.num(n) + (n > 1 ? ' premières sur ' : ' première sur ') + L.num(sel.capped) : whole ? (n > 1 ? 'Les ' + L.num(n) + ' du filtre' : words(n)) : words(n);
  return (
    <div className="lk-bar" role="toolbar" aria-label="Actions sur la sélection" data-guide="lk-bar">
      <Button variant="ghost" icon="x" aria-label="Quitter la sélection" title="Quitter la sélection" onClick={onClose} />
      <div className="lk-bar-what">
        <b aria-live="polite">{what}</b>
        {whole || sel.capped || n >= total ? (n ? <button type="button" className="link" onClick={onClear}>Tout décocher</button> : null)
          : <button type="button" className="link" disabled={busy || !total} onClick={onAll}>{busy ? 'Un instant…' : 'Tout sélectionner (' + L.num(total) + ')'}</button>}
      </div>
      {more.length ? <Button variant="ghost" icon="more" aria-label="Autres actions" title="Autres actions" disabled={!n} onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())} /> : null}
      {main ? <Button variant="primary" icon={main.icon} disabled={!n || main.disabled} onClick={main.run} aria-label={main.label}><span className="lk-long">{main.label}</span><span className="lk-short">{main.short || main.label}</span></Button> : null}
      <Menu anchor={menu} onClose={() => setMenu(null)}>
        {more.map((a) => <button key={a.label} type="button" role="menuitem" disabled={a.disabled} onClick={a.run}>{a.icon ? <Icon name={a.icon} /> : null}{a.label}</button>)}
      </Menu>
    </div>
  );
}

/* ---------------- pages ---------------- */

/** How many pages of the filter `key` are on screen: 1 again as soon as the filter changes. */
export function usePages(key: string): { pages: number; offsets: number[]; more: () => void } {
  const [st, setSt] = useState({ key, n: 1 });
  const pages = st.key === key ? st.n : 1;
  return { pages, offsets: L.pageOffsets(pages), more: () => setSt({ key, n: pages + 1 }) };
}

/** « Voir 60 de plus », and what is on screen out of how many. Nothing once the list is whole. */
export function LoadMore({ total, loaded, onMore }: { total: number; loaded: number; onMore: () => void }) {
  const n = L.moreCount(total, loaded);
  if (!n) return null;
  return (
    <div className="lk-more">
      <Button variant="ghost" block onClick={onMore}>Voir {n} de plus</Button>
      <small className="faint tnum">{L.cutLine(total, loaded)}</small>
    </div>
  );
}

/* ---------------- saved views ---------------- */

/**
 * The person's views of this page as chips (before the list's own chips), and « Enregistrer cette vue » as soon as a
 * filter is on; on a saved view it becomes « Retirer la vue ». query: the current filter (list-state viewQuery).
 * save: writes prefs.views and reloads what reads them (the caller's PATCH /api/v1/prefs).
 */
export function SavedViews({ page, views, query, suggest, onApply, save }: {
  page: string; views: L.SavedView[] | undefined; query: string; suggest?: string; onApply: (v: L.SavedView) => void; save: (views: L.SavedView[]) => Promise<void>;
}) {
  const mine = L.viewsOf(views, page);
  const active = L.activeView(views, page, query);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = () => { setName((suggest || '').slice(0, 30)); setErr(null); setNaming(true); };
  const add = async () => {
    const r = L.addView(views, page, name, query);
    if (r.error) { setErr(r.error); return; }
    setBusy(true);
    try { await save(r.views); setNaming(false); toast({ title: 'Vue enregistrée', sub: name.trim(), icon: 'check' }); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const remove = async (v: L.SavedView) => {
    const before = views || [];
    try {
      await save(L.removeView(views, page, v.name));
      toast({ title: 'Vue retirée', sub: v.name, icon: 'trash', action: { label: 'Annuler', run: () => { save(before).catch(toastError); } } });
    } catch (e) { toastError(e); }
  };
  return (
    <>
      {mine.map((v) => <Chip key={v.name} small className="lk-view" on={active?.name === v.name} onClick={() => onApply(v)}><Icon name="star" size={13} />{v.name}</Chip>)}
      {active ? <Chip small className="lk-view-act" onClick={() => remove(active)}><Icon name="x" size={13} />Retirer la vue</Chip>
        : query ? <Chip small className="lk-view-act" onClick={open}><Icon name="plus" size={13} />Enregistrer cette vue</Chip> : null}
      <Modal open={naming} onClose={() => setNaming(false)} label="Enregistrer cette vue">
        <h2>Enregistrer cette vue</h2>
        <p>Le filtre en cours garde un nom : il revient en un toucher, sur tous tes appareils.</p>
        <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Field label="Nom de la vue" error={err} htmlFor="lk-view-name"><input id="lk-view-name" className="input" value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setErr(null); }} placeholder="VIP à relancer" autoComplete="off" data-autofocus /></Field>
          <div className="acts" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setNaming(false)}>Annuler</Button>
            <Button variant="primary" type="submit" busy={busy}>Enregistrer</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/* ---------------- acting ---------------- */

/**
 * One bulk request = one gesture = one request id: sent again as it is when the network drops (lib/api withRetry), so
 * the server answers the retry with its first answer and writes nothing twice.
 */
export function bulkPost<T = L.BulkResult>(path: string, body: unknown): Promise<T> {
  const id = uuid();
  return withRetry(() => api.post<T>(path, body, id), { waits: [1000, 2000, 4000] });
}

/**
 * A POST whose answer is a file (an export of the selection): saved as the server wrote it (its BOM included, which
 * Excel needs), under the name the server gives. Returns how many rows it holds (x-lx-count), or null.
 */
export async function downloadPost(path: string, body: unknown, fallbackName: string): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'text/csv, application/json', 'x-request-id': uuid() }, body: JSON.stringify(body) });
  } catch { throw new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi puis réessaie.'); }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw data && data.error ? new ApiError(res.status, data.error.code, data.error.message, data.error.extra) : new ApiError(res.status, 'http', 'Erreur ' + res.status);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  const n = Number(res.headers.get('x-lx-count'));
  return Number.isFinite(n) && res.headers.has('x-lx-count') ? n : null;
}

/** How long a send that cannot be taken back waits for « Annuler », in ms. */
export const HOLD_MS = 5000;
/**
 * The honest undo of what has none (a text): nothing leaves for a few seconds, « Annuler » drops it. `run` is called
 * once the delay has passed, never after a cancel. Returns the cancel, for a caller that goes away.
 */
export function holdThen(o: { title: ReactNode; sub?: ReactNode; icon?: string; run: () => void | Promise<void>; onCancel?: () => void; ms?: number }): () => void {
  let live = true;
  const ms = o.ms ?? HOLD_MS;
  const cancel = () => { if (!live) return; live = false; clearTimeout(timer); o.onCancel?.(); };
  const timer = setTimeout(() => { if (!live) return; live = false; void o.run(); }, ms);
  toast({ title: o.title, sub: o.sub, icon: o.icon || 'wait', ttl: ms, action: { label: 'Annuler', run: cancel } });
  return cancel;
}
