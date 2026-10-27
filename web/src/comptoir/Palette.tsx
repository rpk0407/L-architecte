// ⌘K: find a client, jump to a page, start an action — without leaving the keyboard.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, qs } from '../lib/api';
import { navigate } from '../lib/router';
import { useDebounced } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { useApp } from './state';
import type { ClientCard } from './types';

type Item = { id: string; group: string; label: string; hint?: string; icon: string; run: () => void };

export function Palette({ onClose }: { onClose: () => void }) {
  const { can, boot } = useApp();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [clients, setClients] = useState<ClientCard[]>([]);
  const dq = useDebounced(q, 160);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!can('client.view') || dq.trim().length < 2) { setClients([]); return; }
    const c = new AbortController();
    api.get<{ items: ClientCard[] }>('/api/v1/clients' + qs({ q: dq, limit: 6 }), c.signal).then((r) => setClients(r.items)).catch(() => {});
    return () => c.abort();
  }, [dq]);

  const go = (to: string) => () => { onClose(); navigate(to); };
  const actions: Item[] = useMemo(() => [
    { id: 'new', group: 'Actions', label: 'Nouveau rendez-vous', hint: 'N', icon: 'plus', run: go('/?new=1') },
    { id: 'walk', group: 'Actions', label: 'Ajouter un passage (sans rendez-vous)', hint: 'P', icon: 'walk', run: go('/?walkin=1') },
    ...(can('sale.create') ? [{ id: 'sale', group: 'Actions', label: 'Vente libre (produit, carte cadeau)', icon: 'caisse', run: go('/caisse?vente=1') }] : []),
    ...(can('closure') ? [{ id: 'z', group: 'Actions', label: 'Compter la caisse et clôturer', icon: 'lock', run: go('/caisse/cloture') }] : []),
    { id: 'p-agenda', group: 'Pages', label: 'Agenda', icon: 'agenda', run: go('/agenda') },
    ...(can('sale.create') ? [{ id: 'p-caisse', group: 'Pages', label: 'Caisse', icon: 'caisse', run: go('/caisse') }] : []),
    ...(can('client.view') ? [{ id: 'p-clients', group: 'Pages', label: 'Clients', icon: 'clients', run: go('/clients') }] : []),
    ...(can('marketing') ? [{ id: 'p-rel', group: 'Pages', label: 'Relances', icon: 'relances', run: go('/relances') }] : []),
    ...(can('report.own') && (boot.me.chair || can('report.shop')) ? [{ id: 'p-rap', group: 'Pages', label: 'Rapports', icon: 'rapports', run: go('/rapports') }] : []),
    ...(can('team') ? [{ id: 'p-eq', group: 'Pages', label: 'Équipe', icon: 'equipe', run: go('/equipe') }] : []),
    ...(can('catalog') ? [{ id: 'p-cat', group: 'Pages', label: 'Catalogue', icon: 'catalogue', run: go('/catalogue') }] : []),
    { id: 'p-set', group: 'Pages', label: 'Réglages', icon: 'reglages', run: go('/reglages') },
    ...(can('audit') ? [{ id: 'p-j', group: 'Pages', label: 'Journal d’activité', icon: 'journal', run: go('/reglages/journal') }] : [])
  ], []);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const items: Item[] = [
    ...clients.map((c) => ({ id: 'c' + c.id, group: 'Clients', label: c.first + ' ' + c.last, hint: c.phone, icon: 'user', run: go('/clients/' + c.id) })),
    ...actions.filter((a) => !q || norm(a.label).includes(norm(q)))
  ];
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
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche">
        <div className="search"><Icon name="search" /><input ref={input} className="input" placeholder="Un client, une page, une action…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} aria-label="Rechercher" role="combobox" aria-expanded="true" aria-controls="pal-list" /></div>
        <ul id="pal-list" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <li key={'g' + it.group} className="grp" role="presentation">{it.group}</li> : null;
            lastGroup = it.group;
            return [head, <li key={it.id} role="option" aria-selected={i === sel}><button type="button" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={it.run}><Icon name={it.icon} /><span>{it.label}</span>{it.hint ? <small>{it.hint}</small> : null}</button></li>];
          })}
          {!items.length ? <li className="grp">Rien trouvé</li> : null}
        </ul>
      </div>
    </>,
    document.body
  );
}
