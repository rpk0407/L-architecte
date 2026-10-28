// Espace client on Pilotage: how many clients have a space and how many came back to it this month (AC-01 accounts/stats).
import { useQuery } from '../../../../lib/query';
import { plural } from '../../../../lib/format';
import { useApp } from '../../../state';
import type { PilotageTileMeta } from '../../../types';
import { Tile } from '../shared';

export const meta: PilotageTileMeta = { id: 'espace-client', cap: 'report.shop' };

type Stats = { accounts: number; active30: number; opened30: number };

export default function Accounts() {
  const { boot } = useApp();
  const q = useQuery<Stats>('/api/v1/accounts/stats');
  const s = q.data;
  // refused, not found, or a space nobody has and the salon has not opened: nothing to say
  if (!s || (!s.accounts && !boot.settings.accounts?.enabled)) return null;
  return (
    <Tile guide="pilotage.espace-client" k="Espace client" icon="user" v={s.accounts}
      s={s.accounts ? <>{plural(s.active30, 'revenu', 'revenus')} ce mois · {plural(s.opened30, 'ouvert', 'ouverts')} ce mois</> : 'personne n’a encore ouvert son espace'} />
  );
}
