// The client file's line: « Avis Google demandé le 12 oct. · ouvert », from the last review request about one of his visits.
import { cap, dates } from '../../../lib/format';
import { useQuery } from '../../../lib/query';
import { Icon } from '../../../ui/Icon';
import './avis.css';

type Last = { at: number; channel: 'sms' | 'email'; status: 'sent' | 'queued' | 'failed'; opened: number | null };

export default function ClientReview({ id }: { id: string }) {
  const { data } = useQuery<{ last: Last | null; count: number }>('/api/v1/reviews/client/' + id);
  const l = data?.last;
  if (!l) return null;
  const day = (ms: number) => dates.dayShort(dates.localParts(ms).day).replace(/^\S+ /, '');
  const by = l.channel === 'email' ? ' par e-mail' : '';
  return (
    <p className="cl-review">
      <Icon name="star" size={14} />
      {l.status === 'queued' ? 'Avis Google : demande en attente d’envoi' : l.status === 'failed' ? 'Avis Google : la demande n’est pas partie' : cap('avis Google demandé le ' + day(l.at) + by)}
      {l.status === 'sent' ? <span className={'badge ' + (l.opened ? 'badge-ok' : '')}>{l.opened ? 'ouvert' : 'pas encore ouvert'}</span> : null}
    </p>
  );
}
