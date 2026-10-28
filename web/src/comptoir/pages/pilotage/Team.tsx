// « L’équipe »: one row per barber, in the order of the chairs and never by takings (nobody is ranked): photo, name, what he
// performed over the period, his month goal as a thin bar, the fill of his chair. A tap opens his sheet.
import { pct } from '../../../lib/format';
import { navigate } from '../../../lib/router';
import { Avatar, Button, Empty, Money } from '../../../ui/kit';
import { photoOf, useApp } from '../../state';
import type { CockpitTeamRow } from '../../types';
import { Bar } from './shared';

export function Team({ rows, onOpen }: { rows: CockpitTeamRow[]; onOpen: (id: string) => void }) {
  const { can } = useApp();
  // a salon without a chair yet: the first thing to do, as the agenda says it
  if (!rows.length) {
    return (
      <section className="card pl-team" data-guide="pilotage.equipe" aria-label="L’équipe">
        <div className="card-h"><h2>L’équipe</h2></div>
        <Empty icon="equipe" title="Ajoute ton équipe pour voir ses chiffres" action={
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {can('team') ? <Button variant="primary" icon="plus" onClick={() => navigate('/equipe')}>Ajouter l’équipe</Button> : null}
            {can('settings') ? <Button variant="ghost" icon="check" onClick={() => navigate('/reglages/mise-en-route')}>Voir la mise en route</Button> : null}
          </div>
        }>
          Chaque barbier a sa ligne ici : son chiffre, son objectif du mois, son remplissage.
        </Empty>
      </section>
    );
  }
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
