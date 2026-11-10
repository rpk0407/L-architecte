// ⌘K / « / » / la loupe: find a client, a page, a Réglages section, or do something, from one field. The table of what
// it knows is commands.ts; this file only shows it. On a phone it is a full screen: the field on top, 48 px rows.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, qs } from '../lib/api';
import { navigate } from '../lib/router';
import { useDebounced } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { useApp } from './state';
import { RECENTS_KEY, allowed, buildEntries, pushRecent, recentEntries, search, type Ctx, type Entry, type Rules } from './commands';
import { OPEN_SECTIONS, SECTION_CAP, sectionCap } from './pages/reglages/caps';
import { navShows } from './access';
import type { ClientCard } from './types';
import './palette.css';

const RULES: Rules = { SECTION_CAP, OPEN_SECTIONS, sectionCap, navShows };
const ENTRIES = buildEntries(RULES);

type Row = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void };

const readRecents = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
const writeRecents = (v: string[]) => { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
/** The shell keeps theme and masking in these keys (App.tsx, useLocal: JSON); the page follows at once. */
const flip = (key: string, a: string, b: string, apply: (v: string) => void) => {
  let cur = a; try { cur = JSON.parse(localStorage.getItem(key) || JSON.stringify(a)); } catch { /* keep default */ }
  const next = cur === b ? a : b;
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
  apply(next);
};

export function Palette({ onClose }: { onClose: () => void }) {
  const { can, boot } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [clients, setClients] = useState<ClientCard[]>([]);
  const [recents, setRecents] = useState<string[]>(readRecents);
  const dq = useDebounced(q, 160);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!can('client.view') || dq.trim().length < 2) { setClients([]); return; }
    const c = new AbortController();
    api.get<{ items: ClientCard[] }>('/api/v1/clients' + qs({ q: dq, limit: 6 }), c.signal).then((r) => setClients(r.items)).catch(() => {});
    return () => c.abort();
  }, [dq]);

  const mine = useMemo(() => allowed(RULES, ENTRIES, can, !!boot.me.chair), [can, boot.me.chair]);
  const ctx: Ctx = {
    go: (to) => navigate(to),
    toggleMask: () => flip('lx-private', '0', '1', (v) => { if (v === '1') document.documentElement.dataset.private = '1'; else delete document.documentElement.dataset.private; }),
    toggleTheme: () => flip('lx-theme', 'dark', 'light', (v) => { document.documentElement.dataset.theme = v; }),
    tour: () => { import('./guide/ComptoirTour').then((m) => m.startTour('tour', 'start')).catch(() => {}); }
  };
  const open = (e: Entry) => () => { const r = pushRecent(recents, e.id); setRecents(r); writeRecents(r); onClose(); e.run(ctx); };
  const row = (e: Entry, group: string = e.group): Row => ({ id: e.id, group, label: e.label, hint: e.hint, icon: e.icon, run: open(e) });

  const items: Row[] = q.trim()
    ? [
      ...search(mine, q).map((e) => row(e)),
      ...clients.map((c) => ({ id: 'c' + c.id, group: 'Clients', label: c.first + ' ' + c.last, hint: c.phone, icon: 'user', run: () => { onClose(); navigate('/clients/' + c.id); } }))
    ]
    : (() => {
      const rec = recentEntries(recents, mine);
      const ids = new Set(rec.map((e) => e.id));
      return [...rec.map((e) => row(e, 'Récents')), ...mine.filter((e) => e.group === 'Actions' && !ids.has(e.id)).slice(0, 6).map((e) => row(e))];
    })();
  useEffect(() => { setSel(0); }, [q, clients.length]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return createPortal(
    <>
      <div className="veil" onClick={onClose} aria-hidden />
      <div className="palette pal" role="dialog" aria-modal="true" aria-label="Recherche">
        <div className="search">
          <Icon name="search" />
          <input ref={input} className="input" placeholder="Client, page ou action…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} aria-label="Rechercher" role="combobox" aria-expanded="true" aria-controls="pal-list" enterKeyHint="go" autoComplete="off" autoCorrect="off" spellCheck={false} />
          <button type="button" className="pal-close" onClick={onClose} aria-label="Fermer la recherche">Fermer</button>
        </div>
        <ul id="pal-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <li key={'g' + it.group} className="grp" role="presentation">{it.group}</li> : null;
            lastGroup = it.group;
            return [head, <li key={it.group + it.id} role="option" aria-selected={i === sel}><button type="button" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}><Icon name={it.icon} /><span>{it.label}</span>{it.hint ? <small>{it.hint}</small> : null}</button></li>];
          })}
          {!items.length ? <li className="grp" role="presentation">Rien trouvé. Essaie un autre mot.</li> : null}
        </ul>
      </div>
    </>,
    document.body
  );
}
