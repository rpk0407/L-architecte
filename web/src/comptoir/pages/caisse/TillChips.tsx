// What the till knows of the client in one glance, beside the name: the membership, the carnet, the loyalty reward. Two chips
// at most, in that order, the rest under « +n » (a phone has no room for three); each chip is given by its package, the
// reward's (FID-03's RewardChip) is passed in. The member's payment in trouble shows here too, in amber, in words.
import { useId, useState, type ReactNode } from 'react';
import { ddmm, liveMembers, statusWords, toneClass } from '../../../lib/members';
import { Icon } from '../../../ui/Icon';
import type { ClientCard } from '../../types';
import './tillchips.css';

const SHOWN = 2;

/** The chips of the membership and of the carnet for this client, in the order the till shows them: `[key, chip]`. */
export function tillChipsOf(client: ClientCard | null): [string, ReactNode][] {
  const out: [string, ReactNode][] = [];
  const m = liveMembers(client?.memberships)[0];
  if (m) {
    const w = statusWords(m);
    const trouble = m.status === 'grace' || m.status === 'unpaid';
    out.push(['abo', (
      <span className={'badge' + toneClass(trouble ? 'warn' : 'ok')} title={trouble ? 'Le dernier paiement de son abonnement a été refusé : le salon le suit.' : undefined}>
        <Icon name={trouble ? 'alert' : 'card'} size={12} />{trouble ? w.text : 'Abonné · ' + m.plan}{!trouble && m.status === 'ending' && m.cancelAt ? ' · fin le ' + ddmm(m.cancelAt) : ''}
      </span>
    )]);
  }
  const left = (client?.packs || []).reduce((t, p) => t + Math.max(0, p.total - p.used), 0);
  if (left) out.push(['carnet', <span className="badge badge-info"><Icon name="ticket" size={12} />Carnet · {left} restante{left > 1 ? 's' : ''}</span>]);
  return out;
}

/**
 * abonnement › carnet › récompense. `reward` is the loyalty reward chip (null when there is none to show).
 */
export function TillChips({ client, reward }: { client: ClientCard | null; reward?: ReactNode }) {
  const [more, setMore] = useState(false);
  const id = useId();
  const all = tillChipsOf(client);
  // FID-03's chip when it is passed; until then the server's own badge, so a waiting reward never goes unseen
  if (reward) all.push(['reward', reward]);
  else if (client?.badges.includes('récompense')) all.push(['reward', <span className="badge badge-ok"><Icon name="gift" size={12} />Récompense</span>]);
  if (!all.length) return null;
  const shown = more ? all : all.slice(0, SHOWN);
  const hidden = all.length - SHOWN;
  return (
    <div className="till-chips" data-guide="till-chips" id={id}>
      {shown.map(([k, node]) => <span key={k} className="till-chip">{node}</span>)}
      {hidden > 0 ? (
        <button type="button" className="badge till-more" aria-expanded={more} aria-controls={id} onClick={() => setMore(!more)} aria-label={more ? 'Réduire' : hidden + ' autre' + (hidden > 1 ? 's' : '') + ' à voir'}>{more ? 'Réduire' : '+' + hidden}</button>
      ) : null}
    </div>
  );
}
