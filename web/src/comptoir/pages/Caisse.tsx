// La caisse: who is waiting to pay, the ticket, the day's tickets, and the end-of-day ritual.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '../../lib/query';
import { Link, navigate, setQuery, useRoute } from '../../lib/router';
import { dates, eur, time } from '../../lib/format';
import { useInterval } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Skeleton } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import { Checkout } from './caisse/Checkout';
import { Sales } from './caisse/Sales';
import { Closing } from './caisse/Closing';
import type { Agenda, Appt } from '../types';
import './caisse.css';

export default function Caisse() {
  const { can } = useApp();
  const route = useRoute();
  const tab = route.id === 'ventes' ? 'ventes' : route.id === 'cloture' && (can('drawer') || can('closure')) ? 'cloture' : 'encaisser';
  const tabs = [
    { to: '/caisse', id: 'encaisser', label: 'Encaisser', icon: 'caisse' },
    { to: '/caisse/ventes', id: 'ventes', label: 'Ventes du jour', icon: 'ticket' },
    ...(can('drawer') || can('closure') ? [{ to: '/caisse/cloture', id: 'cloture', label: 'Caisse & clôture', icon: 'lock' }] : [])
  ];
  return (
    <>
      <PageTitle><h1>Caisse</h1></PageTitle>
      <nav className="tabs" aria-label="Caisse">
        {tabs.map((t) => <Link key={t.id} to={t.to} className="tab" aria-current={tab === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}</Link>)}
      </nav>
      {tab === 'encaisser' ? <Till /> : tab === 'ventes' ? <Sales /> : <Closing />}
    </>
  );
}

function Till() {
  const { boot, pulse, staffById, now, can } = useApp();
  const route = useRoute();
  const today = pulse?.today || boot.today;
  const rdv = route.query.get('rdv');
  const free = route.query.get('vente') === '1';
  const { data, loading } = useQuery<Agenda>('/api/v1/agenda?day=' + today);
  const [tick, setTick] = useState(0);
  useInterval(() => setTick((t) => t + 1), 30000);
  const nowMin = useMemo(() => dates.localParts(now()).min, [tick, pulse?.min]);
  const mine = !can('agenda.all');

  const { toPay, later, paid } = useMemo(() => {
    const appts = (data?.appts || []).filter((a) => !['cancelled', 'no_show'].includes(a.status) && (!mine || a.staffId === boot.me.id));
    const toPay = appts.filter((a) => !a.saleId && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= nowMin)));
    const later = appts.filter((a) => !a.saleId && !toPay.includes(a) && a.status !== 'pending').slice(0, 8);
    const paid = appts.filter((a) => a.saleId).length;
    return { toPay, later, paid };
  }, [data, nowMin]);

  // on a wide screen, open the first one waiting; on a phone, the list stays the entry point
  const active = rdv || (free ? null : undefined);
  const showTicket = active !== undefined;
  useEffect(() => {
    if (data && data.closed && (rdv || free)) setQuery({ rdv: null, vente: null });
  }, [data?.closed]);

  if (loading && !data) return <div className="cs-grid"><Skeleton h={320} r={22} /><Skeleton h={420} r={22} /></div>;
  if (data?.closed) {
    return (
      <section className="card">
        <Empty icon="lock" title="La journée est clôturée" action={<Button variant="ghost" icon="ticket" onClick={() => navigate('/caisse/ventes')}>Voir les tickets</Button>}>
          Le Z de {dates.dayLong(today)} est scellé. Les ventes reprendront demain ; une erreur se corrige par un avoir.
        </Empty>
      </section>
    );
  }

  const item = (a: Appt, hot: boolean) => {
    const st = staffById.get(a.staffId);
    return (
      <li key={a.id}>
        <button type="button" className="li" aria-pressed={rdv === a.id} onClick={() => setQuery({ rdv: a.id, vente: null })}>
          {st ? <Avatar name={st.name} initials={st.initials} color={st.color} size="sm" /> : null}
          <span className="li-main"><b>{a.client ? a.client.first + ' ' + a.client.last : a.name}</b><small>{time(a.start)} · {a.services.map((s) => s.name).join(' + ')}{a.deposit?.paid ? ' · acompte ' + eur(a.deposit.paid) : ''}</small></span>
          <span className="li-end">
            <b className="money tnum">{eur(a.price)}</b>
            <small className={hot ? '' : 'faint'} style={hot ? { color: 'var(--accent)' } : undefined}>{a.status === 'in_chair' ? 'au fauteuil' : hot ? 'terminé' : st?.name}</small>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className={'cs-grid' + (showTicket ? ' has-ticket' : '')}>
      <aside className="col cs-side" style={{ gap: 14 }}>
        <Button variant={free ? 'solid' : 'primary'} size="lg" block icon="plus" onClick={() => setQuery({ vente: '1', rdv: null })}>Vente libre</Button>
        <section className="card cs-list">
          <div className="card-h"><h2><Icon name="caisse" size={16} />À encaisser</h2>{toPay.length ? <span className="badge badge-accent">{toPay.length}</span> : null}</div>
          {toPay.length ? <ul className="list">{toPay.map((a) => item(a, true))}</ul> : <p className="muted" style={{ padding: '6px 4px 4px' }}>Personne n’attend. {paid ? paid + ' rendez-vous déjà encaissé' + (paid > 1 ? 's' : '') + ' aujourd’hui.' : ''}</p>}
        </section>
        {later.length ? (
          <section className="card cs-list">
            <div className="card-h"><h2><Icon name="clock" size={16} />Plus tard aujourd’hui</h2></div>
            <ul className="list">{later.map((a) => item(a, false))}</ul>
          </section>
        ) : null}
        {!data?.drawer.open ? <p className="faint" style={{ fontSize: 12.5, padding: '0 4px' }}><Icon name="cash" size={13} /> Tiroir fermé : la carte et le QR fonctionnent, les espèces demandent d’ouvrir la caisse.</p> : null}
      </aside>
      <div className="cs-main">
        {showTicket ? (
          <>
            <button type="button" className="cs-back" onClick={() => setQuery({ rdv: null, vente: null })}><Icon name="chevL" size={16} />Liste</button>
            <Checkout key={rdv || 'free'} apptId={rdv} drawerOpen={!!data?.drawer.open} onClose={() => setQuery({ rdv: null, vente: null })} />
          </>
        ) : (
          <section className="card cs-idle">
            <Empty icon="ticket" title={toPay.length ? 'Choisis le client à encaisser' : 'Prêt à encaisser'}>
              {toPay.length ? 'Sa prestation, son coiffeur et son acompte sont déjà sur le ticket.' : 'Les rendez-vous terminés apparaissent ici d’eux-mêmes. Une vente de produit ou une carte cadeau : « Vente libre ».'}
            </Empty>
          </section>
        )}
      </div>
    </div>
  );
}
