// Rapports › Avis Google: the review requests that left in the period, how many had their link opened (GET /avis/…, once
// per request), by barber. The reviews themselves live on the salon's Google page: this card says the requests work.
import { qs } from '../../../lib/api';
import { pct, plural } from '../../../lib/format';
import { useQuery } from '../../../lib/query';
import { Link, useRoute } from '../../../lib/router';
import { Icon } from '../../../ui/Icon';
import { Note, Skeleton } from '../../../ui/kit';
import { useApp } from '../../state';
import './avis.css';

type Stats = {
  from: string; to: string; sent: number; opened: number; rate: number; waiting: number; failed: number; on: boolean; link: boolean;
  staff: { id: string; name: string; color: string; sent: number; opened: number; rate: number }[];
};

export default function ReviewsCard({ from, to }: { from: string; to: string }) {
  const { can } = useApp();
  const staff = useRoute().query.get('barbier');
  const { data } = useQuery<Stats>('/api/v1/reviews/stats' + qs({ from, to, staff }));
  return (
    <section className="card av-card" aria-label="Avis Google" data-guide="rapports-avis">
      <div className="card-h">
        <h2><Icon name="star" size={16} />Avis Google</h2>
        {can('settings') ? <Link to="/reglages/messages" className="btn btn-ghost btn-sm">Réglages<Icon name="chevR" size={14} /></Link> : null}
      </div>
      {!data ? <Skeleton h={120} r={14} /> : (
        <>
          <div className="av-figs">
            <div><b className="tnum">{data.sent}</b><span>{data.sent > 1 ? 'demandes envoyées' : 'demande envoyée'}</span></div>
            <div><b className="tnum">{data.opened}</b><span>{data.opened > 1 ? 'liens ouverts' : 'lien ouvert'}{data.sent ? ' · ' + pct(data.rate) : ''}</span></div>
          </div>
          {data.sent ? <span className="av-track" role="img" aria-label={pct(data.rate) + ' des liens ouverts'}><i style={{ width: Math.round(data.rate * 100) + '%' }} /></span> : null}
          {data.staff.length > 1 ? (
            <ul className="rp-ranked av-staff" aria-label="Par barbier">
              {data.staff.map((x) => (
                <li key={x.id}>
                  <span className="nm"><i className="sw" style={{ background: x.color || 'var(--tx3)' }} /><b>{x.name}</b><small>{plural(x.sent, 'demande')} · {plural(x.opened, 'ouvert')}</small></span>
                  <span className="vl tnum">{pct(x.rate)}</span>
                  <span className="tr" aria-hidden><i style={{ width: Math.round(x.rate * 100) + '%', background: x.color || undefined }} /></span>
                </li>
              ))}
            </ul>
          ) : null}
          {!data.on ? <Note tone="warn" icon="alert">La demande d’avis est coupée : aucune ne part après les visites.</Note>
            : !data.sent ? <p className="muted av-none">Aucune demande sur cette période : elles partent après chaque visite encaissée, une fois par trimestre au plus par client.</p> : null}
          {data.waiting || data.failed ? <p className="faint av-foot">{[data.waiting ? plural(data.waiting, 'demande en attente', 'demandes en attente') : '', data.failed ? plural(data.failed, 'demande non partie', 'demandes non parties') : ''].filter(Boolean).join(' · ')}</p> : null}
          <p className="faint av-foot">Un lien compte une fois, à sa première ouverture. Les avis eux-mêmes se lisent sur ta fiche Google.</p>
        </>
      )}
    </section>
  );
}
