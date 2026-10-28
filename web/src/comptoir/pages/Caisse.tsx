// La caisse: who is waiting to pay, the ticket, the day's tickets, and the end-of-day ritual.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '../../lib/query';
import { Link, navigate, setQuery, useRoute } from '../../lib/router';
import { dates, eur, time } from '../../lib/format';
import { useInterval } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Note, Sheet, Skeleton } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import { Checkout, qrOff } from './caisse/Checkout';
import { Sales } from './caisse/Sales';
import { Closing } from './caisse/Closing';
import { Online } from './caisse/Online';
import type { Agenda, Appt } from '../types';
import './caisse.css';

// not NF525-certified: until an accredited body certifies it, the salon's certified till prints the legal ticket.
// The owner reads why in French here; the full note (docs/security.md, its anchor checked by tests/unit/fiscal-note.test.js) is in English.
const FISCAL_NOTE = 'https://github.com/rpk0407/L-architecte/blob/main/docs/security.md#fiscal-note-france';

export default function Caisse() {
  const { boot, can } = useApp();
  const route = useRoute();
  const [why, setWhy] = useState(false);
  const tab = route.id === 'ventes' ? 'ventes' : route.id === 'cloture' && (can('drawer') || can('closure')) ? 'cloture' : 'encaisser';
  const tabs = [
    { to: '/caisse', id: 'encaisser', label: 'Encaisser', icon: 'caisse' },
    { to: '/caisse/ventes', id: 'ventes', label: 'Ventes du jour', icon: 'ticket' },
    ...(can('drawer') || can('closure') ? [{ to: '/caisse/cloture', id: 'cloture', label: 'Caisse & clôture', icon: 'lock' }] : [])
  ];
  return (
    <>
      <PageTitle><h1>Caisse</h1></PageTitle>
      <nav className="tabs" aria-label="Caisse" data-guide="cs-tabs">
        {tabs.map((t) => <Link key={t.id} to={t.to} className="tab" aria-current={tab === t.id ? 'page' : undefined}><Icon name={t.icon} size={16} />{t.label}</Link>)}
      </nav>
      {boot.mode !== 'demo' ? <div style={{ marginBottom: 16 }}><Note icon="info"><b>Caisse de gestion : le ticket légal sort de ta caisse certifiée.</b> <button type="button" className="link" onClick={() => setWhy(true)}>En savoir plus</button></Note></div> : null}
      <Online />
      {tab === 'encaisser' ? <Till /> : tab === 'ventes' ? <Sales /> : <Closing />}
      <FiscalSheet open={why} onClose={() => setWhy(false)} />
    </>
  );
}

function FiscalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Caisse de gestion" kicker="Pas une caisse certifiée"
      footer={<><a className="link" href={FISCAL_NOTE} target="_blank" rel="noopener noreferrer">La note complète (en anglais)</a><span className="grow" /><Button variant="primary" onClick={onClose}>Compris</Button></>}>
      <p>Le Comptoir tient tes ventes, ta caisse, tes clôtures et les commissions, mais il n’est pas encore certifié NF525. Tant qu’il ne l’est pas, c’est ta caisse certifiée qui fait foi.</p>
      <ul className="col" style={{ margin: 0, paddingLeft: 18 }}>
        <li><b>Chaque vente passe aussi sur ta caisse certifiée</b> : c’est elle qui imprime le ticket légal du client.</li>
        <li><b>Son Z est le Z fiscal.</b> Les chiffres et exports du Comptoir sont des chiffres de gestion : dis-le à ton comptable.</li>
        <li><b>Seul un organisme accrédité peut certifier une caisse</b> (NF525 par Infocert, ou le LNE) : une attestation de l’éditeur ne suffit plus, à faire confirmer par ton comptable.</li>
        <li><b>Se servir du Comptoir comme seule caisse</b>, sans certificat, expose à une amende de {'7\u00a0500\u00a0€'} par caisse.</li>
      </ul>
    </Sheet>
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
  // what works with the drawer closed (the QR needs Stripe outside the demo)
  const P = boot.settings.payments;
  const ways = [P.card ? 'la carte' : '', P.qr && !qrOff(boot) ? 'le QR' : ''].filter(Boolean);

  const { toPay, later, paid } = useMemo(() => {
    const appts = (data?.appts || []).filter((a) => !['cancelled', 'no_show'].includes(a.status) && (!mine || a.staffId === boot.me.id));
    const toPay = appts.filter((a) => !a.saleId && !a.legacy && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= nowMin)));
    const later = appts.filter((a) => !a.saleId && !a.legacy && !toPay.includes(a) && a.status !== 'pending').slice(0, 8);
    const paid = appts.filter((a) => a.saleId).length;
    return { toPay, later, paid };
  }, [data, nowMin]);

  // on a wide screen, open the first one waiting; on a phone, the list stays the entry point
  const active = rdv || (free ? null : undefined);
  const showTicket = active !== undefined;
  useEffect(() => {
    if (data && data.closed && (rdv || free)) setQuery({ rdv: null, vente: null, paiement: null });
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
        <button type="button" className="li" aria-pressed={rdv === a.id} onClick={() => setQuery({ rdv: a.id, vente: null, paiement: null })}>
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
        <Button variant={free ? 'solid' : 'primary'} size="lg" block icon="plus" data-guide="cs-free" onClick={() => setQuery({ vente: '1', rdv: null, paiement: null })}>Vente libre</Button>
        <section className="card cs-list" data-guide="cs-topay">
          <div className="card-h"><h2><Icon name="caisse" size={16} />À encaisser</h2>{toPay.length ? <span className="badge badge-accent">{toPay.length}</span> : null}</div>
          {toPay.length ? <ul className="list">{toPay.map((a) => item(a, true))}</ul> : <p className="muted" style={{ padding: '6px 4px 4px' }}>Personne n’attend. {paid ? paid + ' rendez-vous déjà encaissé' + (paid > 1 ? 's' : '') + ' aujourd’hui.' : ''}</p>}
        </section>
        {later.length ? (
          <section className="card cs-list" data-guide="cs-later">
            <div className="card-h"><h2><Icon name="clock" size={16} />Plus tard aujourd’hui</h2></div>
            <ul className="list">{later.map((a) => item(a, false))}</ul>
          </section>
        ) : null}
        {!data?.drawer.open ? <p className="faint" style={{ fontSize: 12.5, padding: '0 4px' }}><Icon name="cash" size={13} /> Tiroir fermé{ways.length || P.cash ? ' : ' : '.'}{ways.length ? ways.join(' et ') + (ways.length > 1 ? ' fonctionnent' : ' fonctionne') + (P.cash ? ', ' : '.') : ''}{P.cash ? 'les espèces demandent d’ouvrir la caisse.' : ''}</p> : null}
      </aside>
      <div className="cs-main">
        {showTicket ? (
          <>
            <button type="button" className="cs-back" onClick={() => setQuery({ rdv: null, vente: null, paiement: null })}><Icon name="chevL" size={16} />Liste</button>
            <Checkout key={rdv || 'free'} apptId={rdv} drawerOpen={!!data?.drawer.open} onClose={() => setQuery({ rdv: null, vente: null, paiement: null })} />
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
