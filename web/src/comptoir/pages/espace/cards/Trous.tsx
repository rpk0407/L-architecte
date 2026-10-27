// « Mes trous »: the free stretches of 20 minutes or more between now and the end of his day, and the walk-ins who wait.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { time, dur } from '../../../../lib/format';
import { Button } from '../../../../ui/kit';
import type { EspaceCardMeta, EspaceCardProps } from '../../../types';
import { useApp } from '../../../state';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'trous', title: 'Mes trous', chairOnly: true };

// « Places du jour » (IN-05) joins by itself when its sheet exists: without it there is no « Proposer »
type OffersProps = { day: string; staffId?: string; open?: boolean; onClose?: () => void };
const found = import.meta.glob<{ OffersSheet?: ComponentType<OffersProps>; default?: ComponentType<OffersProps> }>('../../agenda/OffersSheet.tsx');
const loader = Object.values(found)[0];
const Offers = loader ? lazy(() => loader().then((m) => ({ default: (m.OffersSheet || m.default) as ComponentType<OffersProps> }))) : null;

export default function Trous({ data }: EspaceCardProps) {
  const { boot } = useApp();
  const [offers, setOffers] = useState(false);
  const w = data.walkins;
  return (
    <EsCard guide="espace.trous" title="Mes trous" icon="clock" end={data.gaps.length ? data.gaps.length + ' libre' + (data.gaps.length > 1 ? 's' : '') : undefined}>
      {data.gaps.length ? (
        <ul className="es-gaps" aria-label="Mes créneaux libres">
          {data.gaps.map((g) => <li key={g.start}><b className="tnum">{time(g.start)} – {time(g.end)}</b><span className="muted tnum">{dur(g.dur)}</span></li>)}
        </ul>
      ) : <p className="es-empty"><b>Pas de trou</b><span>Rien de libre de 20 minutes ou plus d’ici la fin de ta journée.</span></p>}
      {w.waiting ? <p className="es-walk"><b>{w.waiting} en attente</b>{w.mineNext ? ' · c’est ton tour' : ''}</p> : null}
      {Offers && data.gaps.length ? (
        <div className="es-acts"><Button variant="ghost" icon="sms" onClick={() => setOffers(true)}>Proposer</Button></div>
      ) : null}
      {Offers && offers ? <Suspense fallback={null}><Offers day={data.day} staffId={boot.me.id} open onClose={() => setOffers(false)} /></Suspense> : null}
    </EsCard>
  );
}
