// « Anniversaires »: his regulars with a birthday this week, a good reason to say it. Hidden when there is none.
import { dates } from '../../../../lib/format';
import type { EspaceCardMeta, EspaceCardProps } from '../../../types';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'anniversaires', title: 'Anniversaires', chairOnly: true };

export default function Anniversaires({ data }: EspaceCardProps) {
  if (!data.birthdays.length) return null;
  return (
    <EsCard guide="espace.anniversaires" title="Anniversaires" icon="heart">
      <ul className="es-plain">
        {data.birthdays.map((b) => (
          <li key={b.id}><b>{b.name}</b><span className="muted">{b.inDays === 0 ? 'aujourd’hui' : b.inDays === 1 ? 'demain' : dates.DAYS_FR[dates.weekday(b.day)]}</span></li>
        ))}
      </ul>
    </EsCard>
  );
}
