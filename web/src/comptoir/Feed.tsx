// Le fil: everything that happened, as it happens.
import { navigate } from '../lib/router';
import { ago } from '../lib/format';
import { Icon } from '../ui/Icon';
import { Empty, Sheet } from '../ui/kit';
import { useApp } from './state';
import type { FeedItem } from './types';

const ICON: Record<string, string> = { booking: 'calendar', cancel: 'x', move: 'move', arrived: 'check', noshow: 'alert', sale: 'caisse', refund: 'refund', payment: 'card', wait: 'wait', walkin: 'walk', closure: 'lock', drawer: 'cash', stock: 'box' };
const TONE: Record<string, string> = { booking: 'var(--ok)', cancel: 'var(--accent)', payment: 'var(--ok)', noshow: 'var(--warn)', stock: 'var(--warn)', refund: 'var(--warn)' };

export function FeedList({ items, now, onPick, limit }: { items: FeedItem[]; now: number; onPick?: (f: FeedItem) => void; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return <Empty icon="bell" title="Calme plat">Les réservations, annulations et paiements apparaissent ici en direct.</Empty>;
  return (
    <ul className="list">
      {list.map((f) => (
        <li key={f.v}>
          <button type="button" className="li" onClick={() => onPick?.(f)} style={{ alignItems: 'flex-start' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: '50%', background: 'var(--panel2)', color: TONE[f.kind] || 'var(--tx2)', flex: 'none' }}><Icon name={ICON[f.kind] || 'bell'} size={16} /></span>
            <span className="li-main"><b className={f.money ? 'money' : ''}>{f.title}</b><small>{f.sub}</small></span>
            <span className="li-end"><small className="faint" style={{ fontSize: 11.5 }}>{ago(f.at, now)}</small></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FeedSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { feed, pulse } = useApp();
  const pick = (f: FeedItem) => {
    onClose();
    if (f.apptId && f.day) navigate('/?day=' + f.day + '&rdv=' + f.apptId);
    else if (f.saleId) navigate('/caisse/ventes?ticket=' + f.saleId);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Le fil" kicker="En direct">
      <FeedList items={feed} now={pulse?.now || Date.now()} onPick={pick} />
    </Sheet>
  );
}
