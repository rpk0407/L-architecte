// Abonnés on Pilotage: the strip of Clients › Abonnés (MembersKpis: members, presence, weeks missed, monthly income, payments to
// settle, cancellations, cuts of the month). It reads the memberships summary and is gone when the route refuses or fails.
import { useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { Icon } from '../../../../ui/Icon';
import { useApp } from '../../../state';
import type { MemberSummary, PilotageTileMeta } from '../../../types';
import { MembersKpis } from '../../clients/Members';

export const meta: PilotageTileMeta = { id: 'abonnes', cap: 'report.shop' };

export default function Abonnes() {
  const { boot } = useApp();
  const q = useQuery<MemberSummary>('/api/v1/memberships/summary');
  // 403, 404 or nothing to show yet: no empty frame
  // the route answers 200 with zeros while the plan is off: no strip of zeros until there is a member
  if (!q.data || (!boot.settings.membership?.enabled && !q.data.live && !q.data.pending)) return null;
  return (
    <section className="pl-extra" data-guide="pilotage.abonnes" aria-label="Abonnés">
      <div className="pl-extra-h"><h2 className="section-k">Abonnés</h2><Link to="/clients?segment=abonnes" className="link">Voir le tableau<Icon name="chevR" size={14} /></Link></div>
      <MembersKpis />
    </section>
  );
}
