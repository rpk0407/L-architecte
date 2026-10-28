// « L’équipe »: one row per barber, in the order of the chairs and never by takings (nobody is ranked): photo, name, what he
// performed over the period, his month goal as a thin bar, the fill of his chair. A tap opens his sheet.
import { pct } from '../../../lib/format';
import { Avatar, Money } from '../../../ui/kit';
import { photoOf } from '../../state';
import type { CockpitTeamRow } from '../../types';
import { Bar } from './shared';

export function Team({ rows, onOpen }: { rows: CockpitTeamRow[]; onOpen: (id: string) => void }) {
  return (
    <section className="card pl-team" data-guide="pilotage.equipe" aria-label="L’équipe">
      <div className="card-h"><h2>L’équipe</h2><span className="muted">dans l’ordre des fauteuils</span></div>
      <ul className="list">
        {rows.map((x) => (
          <li key={x.id}>
            <button type="button" className="pl-row" onClick={() => onOpen(x.id)} aria-label={'Le détail de ' + x.name}>
              <Avatar name={x.name} color={x.color} photo={photoOf(x)} />
              <span className="pl-row-main">
                <b>{x.name}</b>
                {x.goalPct != null ? <Bar ratio={x.goalPct / 100} color={x.color} label={x.goalPct + ' % de son objectif du mois'} /> : null}
                <small>{x.goalPct != null ? x.goalPct + ' % de l’objectif du mois' : 'pas d’objectif'}</small>
              </span>
              <span className="pl-row-end"><b><Money cents={x.revenue} /></b><small>remplissage {pct(x.occupancy)}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
