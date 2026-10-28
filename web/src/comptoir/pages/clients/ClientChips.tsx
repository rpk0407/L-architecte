// A client's file in one glance: one row of chips at the top (« Espace ✓ · Abonné Essentiel 1/2 · Carte 6/9 · Carnet 3 »), each
// given by its package, and the blocks below it folded until someone asks. A chip opens its block. The membership's and the
// carnet's chips are this package's; the Espace and loyalty ones come from AC-02 and FID-03 through `espace` and `carte`.
import { useCallback, useId, useState, type ReactNode } from 'react';
import { liveMembers, shortWords, statusWords, toneClass } from '../../../lib/members';
import { Icon } from '../../../ui/Icon';
import type { ClientCard } from '../../types';
import './clients-members.css';

/** Which folded blocks are open on this file. A fold opened by its chip scrolls into view. */
export function useFolds() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = useCallback((id: string) => setOpen((o) => ({ ...o, [id]: !o[id] })), []);
  const show = useCallback((id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    // after the fold has opened
    setTimeout(() => document.getElementById('fold-' + id)?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 30);
  }, []);
  return { isOpen: (id: string) => !!open[id], toggle, show };
}

/** A block of the file, folded by default: its title, a few words that say what is inside, and the content when it is open. */
export function Fold({ id, title, icon, summary, open, onToggle, children, guide }: { id: string; title: string; icon: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; guide?: string }) {
  const body = useId();
  return (
    <section className="card cl-fold" id={'fold-' + id} data-guide={guide}>
      <h2 className="cl-fold-h">
        <button type="button" aria-expanded={open} aria-controls={body} onClick={onToggle}>
          <Icon name={icon} size={16} /><span className="cl-fold-t">{title}</span>{summary ? <span className="cl-fold-s">{summary}</span> : null}<Icon name={open ? 'chevU' : 'chevD'} size={16} className={'cl-fold-c' + (open ? ' on' : '')} />
        </button>
      </h2>
      <div id={body} hidden={!open} className="cl-fold-b">{open ? children : null}</div>
    </section>
  );
}

/** The chips for this file. espace / carte: the Espace client and loyalty chips (AC-02, FID-03), already built, or nothing. */
export function ClientChips({ c, onOpen, espace, carte }: { c: ClientCard; onOpen: (fold: string) => void; espace?: ReactNode; carte?: ReactNode }) {
  const m = liveMembers(c.memberships)[0];
  const w = m ? statusWords(m) : null;
  const left = c.packs.reduce((t, p) => t + Math.max(0, p.total - p.used), 0);
  if (!espace && !m && !carte && !left) return null;
  return (
    <div className="cl-chips" data-guide="file-chips" role="group" aria-label="En un coup d’œil">
      {espace}
      {m && w ? (
        <button type="button" className={'cl-chip badge' + toneClass(w.tone)} onClick={() => onOpen('abo')} aria-label={'Abonnement ' + m.plan + ', ' + w.text + '. Ouvrir.'}>
          <Icon name="card" size={12} />Abonné {m.plan} · {shortWords(m, m)}{w.tone === 'warn' || w.tone === 'danger' || m.status === 'ending' ? ' · ' + w.text : ''}
        </button>
      ) : null}
      {carte}
      {left ? <button type="button" className="cl-chip badge badge-info" onClick={() => onOpen('carnets')} aria-label={'Carnet : ' + left + ' coupe' + (left > 1 ? 's' : '') + ' restante' + (left > 1 ? 's' : '') + '. Ouvrir.'}><Icon name="ticket" size={12} />Carnet {left}</button> : null}
    </div>
  );
}
