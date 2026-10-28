// Abonnés on Pilotage: the strip of Clients › Abonnés (MembersKpis: members, presence, weeks missed, monthly income, payments to
// settle, cancellations, cuts of the month). It reads the memberships summary and is gone when the route refuses or fails.
import { useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { Icon } from '../../../../ui/Icon';
import type { MemberSummary, PilotageTileMeta } from '../../../types';
import { MembersKpis } from '../../clients/Members';

export const meta: PilotageTileMeta = { id: 'abonnes', cap: 'report.shop' };

export default function Abonnes() {
  const q = useQuery<MemberSummary>('/api/v1/memberships/summary');
  // 403, 404 or nothing to show yet: no empty frame
  if (!q.data) return null;
  return (
    <section className="pl-extra" data-guide="pilotage.abonnes" aria-label="Abonnés">
      <div className="pl-extra-h"><h2 className="section-k">Abonnés</h2><Link to="/clients?segment=abonnes" className="link">Voir le tableau<Icon name="chevR" size={14} /></Link></div>
      <MembersKpis />
    </section>
  );
}
