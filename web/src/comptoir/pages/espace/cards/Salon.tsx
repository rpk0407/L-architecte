// « Le salon »: how the whole salon is doing this month, in percent: the goal reached and how full the chairs are. No euros,
// and nothing when the owner chose to show barbers nothing of the others (Réglages › Équipe).
import { pct } from '../../../../lib/format';
import type { EspaceCardMeta, EspaceCardProps } from '../../../types';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'salon', title: 'Le salon', chairOnly: true };

export default function Salon({ data }: EspaceCardProps) {
  const s = data.salon;
  // nothing to show on a salon with no goal and no cut yet
  if (!s || (!s.goalPct && !s.fill && !(s.team && s.team.length))) return null;
  return (
    <EsCard guide="espace.salon" title="Le salon" icon="chair">
      <p className="es-big">{s.goalPct != null ? s.goalPct + ' % de l’objectif du mois · ' : ''}remplissage {pct(s.fill)}</p>
      {s.team && s.team.length ? (
        <ul className="es-plain">
          {s.team.map((t) => <li key={t.id}><b>{t.name}</b><span className="muted">{t.done} coupe{t.done > 1 ? 's' : ''} · remplissage {pct(t.occupancy)}</span></li>)}
        </ul>
      ) : null}
    </EsCard>
  );
}
