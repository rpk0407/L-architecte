// « Équité »: where the salon's chances are not shared the way the chairs are (new clients, walk-ins, « sans préférence »
// bookings, idle hours), over the last 30 days. Hidden when there is nothing to say; a hint is never a ranking.
import { Icon } from '../../../ui/Icon';
import type { CockpitEquity } from '../../types';

const ICON: Record<CockpitEquity['kind'], string> = { new: 'user', walkin: 'walk', any: 'calendar', idle: 'clock' };

export function Equity({ hints, onOpen }: { hints: CockpitEquity[]; onOpen: (staffId: string) => void }) {
  if (!hints.length) return null;
  return (
    <section className="card pl-equity" data-guide="pilotage.equite" aria-label="Équité">
      <div className="card-h"><h2><Icon name="info" size={16} />Équité</h2><span className="muted">30 derniers jours</span></div>
      <ul className="list">
        {hints.map((h) => (
          <li key={h.staffId + h.kind}>
            <button type="button" className="li" onClick={() => onOpen(h.staffId)}>
              <Icon name={ICON[h.kind]} size={20} /><span className="li-main"><b>{h.text}</b></span><Icon name="chevR" size={18} />
            </button>
          </li>
        ))}
      </ul>
      <p className="faint pl-note">Un repère pour répartir les chances, pas un classement.</p>
    </section>
  );
}
