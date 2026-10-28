// Clients › Abonnés: the members at a glance. The strip of figures (MembersKpis, also the Pilotage tile), then who is a member
// with where each stands this month, then the carnets still running. A tap on a row opens the client's file.
import { useMemo } from 'react';
import { qs } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { navigate } from '../../../lib/router';
import { dates, dayShortWord, eur, plural } from '../../../lib/format';
import { ddmm, liveMembers, statusWords, toneClass } from '../../../lib/members';
import { Avatar, Empty, Kpi, Skeleton } from '../../../ui/kit';
import { Icon } from '../../../ui/Icon';
import { useApp } from '../../state';
import type { ClientCard, MemberRow, MemberStatus, MemberSummary } from '../../types';
import './clients-members.css';

/**
 * 16 abonnés · 652 €/mois · 1 paiement à régulariser · 1 résiliation (30 j) · coupes ce mois : 21 (valeur 430 €).
 * report.shop only: it renders nothing for anyone else (the server answers 403), so a tile can drop it in as it is.
 */
export function MembersKpis() {
  const { can } = useApp();
  const q = useQuery<MemberSummary>(can('report.shop') ? '/api/v1/memberships/summary' : null);
  const s = q.data;
  if (!can('report.shop') || q.error) return null;
  if (!s) return <div className="kpis k5" aria-hidden><Skeleton h={92} r={20} /><Skeleton h={92} r={20} /><Skeleton h={92} r={20} /></div>;
  const month = s.month.cuts;
  return (
    <div className="kpis k5" data-guide="members-kpis" role="group" aria-label="Les abonnés en chiffres">
      <Kpi k="Abonnés" v={s.live} s={s.ending ? plural(s.ending, 'résilié, encore couvert', 'résiliés, encore couverts') : s.pending ? plural(s.pending, 'paiement attendu', 'paiements attendus') : 'en cours'} icon="clients" />
      <Kpi k="Chaque mois" v={<span className="money">{eur(s.mrr)}</span>} s="prélevés aux abonnés qui renouvellent" icon="euro" />
      <Kpi k="À régulariser" v={s.troubled + s.disputed} s={s.troubled || s.disputed ? 'paiement refusé' + (s.troubled + s.disputed > 1 ? 's' : '') + (s.disputed ? ', dont ' + s.disputed + ' litige' + (s.disputed > 1 ? 's' : '') : '') : 'aucun paiement refusé'} hot={s.troubled + s.disputed > 0} icon="alert" />
      <Kpi k="Résiliations (30 j)" v={s.days30.left} s={s.days30.joined ? s.days30.joined + ' nouveau' + (s.days30.joined > 1 ? 'x' : '') + ' · départ ' + String(s.days30.churn).replace('.', ',') + ' %' : 'départ ' + String(s.days30.churn).replace('.', ',') + ' %'} icon="x" />
      <Kpi k="Coupes ce mois" v={month} s={<>valeur <span className="money">{eur(s.month.value)}</span> au tarif normal</>} icon="scissors" />
    </div>
  );
}

/** Troubles first, then the ones leaving, then the rest by name. */
const RANK: Record<string, number> = { unpaid: 0, grace: 1, pending: 2, ending: 3, active: 4, paused: 5 };

/** A member as the board reads him, from the card (a barber) or from the owner's rows, which also tell a dispute and a cancellation to confirm. */
type Mem = { id: string; plan: string; status: MemberStatus; used: number; of: number; until: string | null; cancelAt: string | null; disputed: boolean; toConfirm: boolean };
type Row = { c: ClientCard; m: Mem };

/** The 'abonnes' segment of the client list. q: the search box. active: the file open beside it. */
export default function Members({ q, active }: { q: string; active: string | null }) {
  const { boot, can } = useApp();
  const { data, loading } = useQuery<{ total: number; items: ClientCard[] }>('/api/v1/clients' + qs({ q, segment: 'abonnes', sort: 'name', limit: 200 }));
  // member.manage: the owner's rows. Reading them is also what catches up a month whose renewal notice never came (nothing else does in production)
  const manage = can('member.manage');
  const rows = useQuery<{ members: MemberRow[] }>(manage ? '/api/v1/memberships' : null);
  const [members, carnets] = useMemo(() => {
    const items = data?.items || [];
    const fromCard = (c: ClientCard): Row[] => liveMembers(c.memberships).map((m) => ({ c, m: { ...m, disputed: false, toConfirm: false } }));
    let mem: Row[];
    if (rows.data) {
      const by = new Map(items.map((c) => [c.id, c]));
      mem = rows.data.members.flatMap((m) => {
        const c = m.clientId ? by.get(m.clientId) : undefined;
        return c && m.status !== 'pending' && m.status !== 'ended' ? [{ c, m: { id: m.id, plan: m.plan, status: m.status, used: m.used, of: m.of, until: m.until, cancelAt: m.cancelAt, disputed: m.disputed, toConfirm: m.cancelVerified === false } }] : [];
      });
    } else mem = items.flatMap(fromCard);
    mem.sort((a, b) => (RANK[a.m.status] ?? 9) - (RANK[b.m.status] ?? 9) || a.c.name.localeCompare(b.c.name, 'fr'));
    const car = items.flatMap((c) => c.packs.map((p) => ({ c, p }))).sort((a, b) => a.p.expires.localeCompare(b.p.expires));
    return [mem, car] as const;
  }, [data, rows.data]);
  const open = (id: string) => navigate('/clients/' + id + location.search);
  if ((loading && !data) || (manage && !rows.data && !rows.error)) return <div className="col" style={{ gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={52} />)}</div>;
  if (!members.length && !carnets.length) return <Empty icon="clients" title={q ? 'Personne à ce nom' : 'Aucun abonné ni carnet'}>{q ? 'Vérifie l’orthographe.' : 'Les abonnements et les carnets en cours apparaissent ici.'}</Empty>;
  return (
    <div className="mbs">
      <MembersKpis />
      {members.length ? (
        <section aria-labelledby="mbs-a" data-guide="members-list">
          <h3 id="mbs-a" className="mbs-h section-k">Abonnés <small>{members.length}</small></h3>
          <ul className="list">
            {members.map(({ c, m }) => {
              const w = statusWords(m);
              return (
                <li key={m.id}>
                  <button type="button" className="li mbs-row" aria-current={active === c.id ? 'true' : undefined} onClick={() => open(c.id)}>
                    <Avatar name={c.first + ' ' + c.last} size="sm" color={m.status === 'grace' || m.status === 'unpaid' ? 'var(--warn)' : undefined} />
                    <span className="li-main"><b>{c.first} {c.last}<span className={'badge' + toneClass(w.tone)}>{w.text}</span></b><small>{m.plan}{m.until && m.status === 'active' ? ' · couvert jusqu’au ' + ddmm(m.until) : ''}{m.toConfirm ? ' · résiliation à confirmer' : ''}</small></span>
                    <span className="li-end"><b className="money tnum">{m.of ? m.used + '/' + m.of : m.used}</b><small className="faint">ce mois-ci</small></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {carnets.length ? (
        <section aria-labelledby="mbs-c" data-guide="members-carnets">
          <h3 id="mbs-c" className="mbs-h section-k">Carnets en cours <small>{carnets.length}</small></h3>
          <ul className="list">
            {carnets.map(({ c, p }) => {
              const late = p.expires < boot.today;
              const soon = !late && p.expires <= dates.addDays(boot.today, 14);
              return (
                <li key={p.id}>
                  <button type="button" className="li mbs-row" aria-current={active === c.id ? 'true' : undefined} onClick={() => open(c.id)}>
                    <Avatar name={c.first + ' ' + c.last} size="sm" />
                    <span className="li-main"><b>{c.first} {c.last}{late ? <span className="badge badge-warn">expiré</span> : soon ? <span className="badge badge-warn">bientôt fini</span> : null}</b><small>{p.name} · valable jusqu’au {dayShortWord(p.expires, boot.today)}</small></span>
                    <span className="li-end"><b className="money tnum">{p.total - p.used}</b><small className="faint">restante{p.total - p.used > 1 ? 's' : ''}</small></span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {data && data.total > data.items.length ? <p className="muted" style={{ fontSize: 13 }}><Icon name="info" size={14} /> Les {data.items.length} premiers sur {data.total} : cherche un nom pour les autres.</p> : null}
    </div>
  );
}
