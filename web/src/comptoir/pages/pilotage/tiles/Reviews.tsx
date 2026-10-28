// Avis Google on Pilotage: the requests that left over the period and how many had their link opened (REV-02 reviews/stats).
import { qs } from '../../../../lib/api';
import { pct, plural } from '../../../../lib/format';
import { useQuery } from '../../../../lib/query';
import type { PilotageTileMeta, PilotageTileProps } from '../../../types';
import { Bar, Tile } from '../shared';

export const meta: PilotageTileMeta = { id: 'avis', cap: 'report.shop' };

type Stats = { sent: number; opened: number; rate: number; waiting: number; failed: number; on: boolean; link: boolean };

export default function Reviews({ from, to }: PilotageTileProps) {
  const q = useQuery<Stats>('/api/v1/reviews/stats' + qs({ from, to }));
  const s = q.data;
  // refused, not found, or the requests are off and none left: nothing to say
  if (!s || (!s.on && !s.sent)) return null;
  return (
    <Tile guide="pilotage.avis" k="Avis Google" icon="star" v={s.sent} s={s.sent ? <>{plural(s.sent, 'demande envoyée', 'demandes envoyées')} · {plural(s.opened, 'lien ouvert', 'liens ouverts')} ({pct(s.rate)})</> : 'aucune demande sur la période'}>
      {s.sent ? <Bar ratio={s.rate} label={pct(s.rate) + ' des liens ouverts'} /> : null}
    </Tile>
  );
}
