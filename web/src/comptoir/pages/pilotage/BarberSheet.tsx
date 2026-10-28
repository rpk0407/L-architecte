// One barber in a sheet, for the period on screen: every figure of his row (the same TEAM-03 numbers as Rapports and his
// statement), his month goal, this week's hours and absences, the fairness hints that name him, and the way to his agenda,
// his figures and his statement of the month.
import type { ReactNode } from 'react';
import { dates, pct, plural } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { Avatar, Button, Money, Sheet } from '../../../ui/kit';
import { Icon } from '../../../ui/Icon';
import { photoOf, useApp } from '../../state';
import type { Cockpit, CockpitTeamRow } from '../../types';
import { Bar, hoursOf } from './shared';

const span = (from: string, to: string) => (from === to ? dates.dayShort(from) : dates.dayShort(from) + ' → ' + dates.dayShort(to));

/** onStatement: the page opens Rapports' statement sheet (loaded when asked for) once this one is closed. */
/** reveal: the page hides the amounts on a shared screen; the sheet carries the same way to show them for a moment. */
export function BarberSheet({ x, d, reveal, onClose, onStatement }: { x: CockpitTeamRow | null; d: Cockpit; reveal: { shown: boolean; toggle: () => void } | null; onClose: () => void; onStatement: (id: string) => void }) {
  const { can } = useApp();
  if (!x) return null;
  const cuts = x.cutsCarnet.n + x.cutsMember.n;
  const items: [string, ReactNode, ReactNode?][] = [
    ['Commission estimée', <Money cents={x.commission} />, x.rates.service / 100 + ' % prestations · ' + x.rates.product / 100 + ' % produits · sur le ' + (x.base === 'ht' ? 'HT' : 'TTC')],
    ['Pourboires', <Money cents={x.tips} />, <>carte <Money cents={x.tipsCard} /> · espèces <Money cents={x.tipsCash} /></>],
    ['Panier moyen', <Money cents={x.avgTicket} />, plural(x.tickets, 'ticket')],
    ['Prestations', x.services, cuts ? 'dont ' + plural(cuts, 'coupe') + ' de carnet ou d’abonnement' : undefined],
    ['Remplissage', pct(x.occupancy), x.idleMin ? hoursOf(x.idleMin) + ' de fauteuil libre' : undefined],
    ['Repris avant de partir', x.done ? pct(x.rebookRate) : '—', plural(x.done, 'visite')],
    ['Revenus sous 60 j', x.returned60Base ? pct(x.returned60) : '—', x.returned60Base ? pct(x.returned60Mine) + ' avec lui' : 'pas assez de recul'],
    ['Passages', x.walkins, x.walkinOverrides ? x.walkinOverrides + ' hors tour' : 'clients sans rendez-vous'],
    ['Nouveaux clients', x.newClients, x.newToMe ? x.newToMe + ' déjà venus, nouveaux pour lui' : undefined],
    ['Remises accordées', <Money cents={x.discounts} />],
    ['Remboursements déduits', x.refunds ? <>−<Money cents={x.refunds} /></> : <Money cents={0} />, x.refundCount ? plural(x.refundCount, 'avoir') : undefined],
    ['Absences de clients', x.noShows]
  ];
  const hints = d.equity.filter((h) => h.staffId === x.id);
  return (
    <Sheet open onClose={onClose} kicker={d.range.label} title={<span className="row" style={{ gap: 10 }}><Avatar name={x.name} color={x.color} photo={photoOf(x)} size="sm" />{x.name}</span>}
      footer={(
        <div className="pl-foot">
          <Link to={'/agenda?day=' + d.range.upTo} className="btn btn-subtle"><Icon name="agenda" size={16} />L’agenda</Link>
          <Link to={'/rapports?p=perso&du=' + d.range.from + '&au=' + d.range.upTo + '&barbier=' + x.id} className="btn btn-subtle"><Icon name="rapports" size={16} />Ses chiffres</Link>
          {can('team') ? <Button variant="primary" icon="ticket" onClick={() => onStatement(x.id)}>Relevé du mois</Button> : null}
        </div>
      )}>
      <div className="pl-bs">
        {reveal ? <button type="button" className="pl-eye" aria-pressed={reveal.shown} onClick={reveal.toggle}><Icon name={reveal.shown ? 'eyeOff' : 'eye'} size={16} />{reveal.shown ? 'Remasquer' : 'Afficher 30 s'}</button> : null}
        <div className="pl-bs-top"><span className="faint">Chiffre réalisé</span><b className="kpi-v"><Money cents={x.revenue} /></b><small className="faint">HT <Money cents={x.revenueHT} /></small></div>
        {x.goal ? (
          <div className="pl-bs-goal">
            <Bar ratio={x.goal.target ? x.goal.done / x.goal.target : 0} color={x.color} label={(x.goalPct ?? 0) + ' % de son objectif du mois'} />
            <p><b>{x.goalPct} %</b> de son objectif du mois (<Money cents={Math.round(x.goal.done / 100) * 100} /> sur <Money cents={Math.round(x.goal.target / 100) * 100} />){x.goal.auto ? ' · calculé sur ses heures' : ''}{x.goal.openDaysLeft && x.goal.done < x.goal.target ? <> · il lui faut <Money cents={Math.round(x.goal.perDay / 100) * 100} /> par jour</> : null}</p>
          </div>
        ) : null}
        <dl className="pl-dl">{items.map(([k, v, s]) => <div key={k}><dt>{k}{s ? <small>{s}</small> : null}</dt><dd className="tnum">{v}</dd></div>)}</dl>
        <section className="pl-bs-week" aria-label="Sa semaine">
          <h3 className="section-k">Sa semaine · {span(x.week.from, x.week.to)}</h3>
          <p><b>{hoursOf(x.week.minutes)}</b> au fauteuil prévues</p>
          {x.week.off.length ? <ul>{x.week.off.map((o) => <li key={o.id}><Icon name="calendar" size={15} />Absent {span(o.from, o.to)}{o.status === 'pending' ? ' · demande en attente' : ''}</li>)}</ul> : <p className="faint">Aucune absence cette semaine.</p>}
        </section>
        {hints.length ? <section aria-label="Équité"><h3 className="section-k">Équité</h3><ul>{hints.map((h) => <li key={h.kind}><Icon name="info" size={15} />{h.text}</li>)}</ul></section> : null}
      </div>
    </Sheet>
  );
}
