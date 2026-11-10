// The tiles of Pilotage: the period in nine figures, each against the period before, like for like (range.compare). The built-in ones read the one cockpit
// read; the others are the files of ./tiles (Abonnés, Espace client, Avis Google…), each fetching its own route and gone
// when it answers 403 or 404. A new area adds a file there: there is no list to edit.
import type { ComponentType } from 'react';
import { dates, pct, plural } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { Money } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Cockpit, PilotageTileMeta, PilotageTileProps } from '../../types';
import { Bar, Dlt, HOW, Tile } from './shared';

const found = import.meta.glob<{ meta?: PilotageTileMeta; default?: ComponentType<PilotageTileProps> }>('./tiles/*.tsx', { eager: true });
const EXTRA = Object.values(found)
  .filter((m): m is { meta: PilotageTileMeta; default: ComponentType<PilotageTileProps> } => !!m.meta && !!m.default)
  .map((m) => ({ meta: m.meta, C: m.default }))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

/** A goal reads to the euro. */
const whole = (c: number) => Math.round(c / 100) * 100;

/** « de octobre » is « d’octobre » (avril, août too). */
const ofMonth = (m: string) => (/^[aeiouéèh]/i.test(m) ? 'd’' : 'de ') + m;

/** The delta of one figure between the two sides the server compared like for like; nothing when nothing compares yet. */
function delta(d: Cockpit, key: keyof NonNullable<Cockpit['kpis']['cmp']>, inverse?: boolean) {
  const { cmp, prev } = d.kpis;
  if (!cmp || !prev) return null;
  return <Dlt cur={cmp[key]} prev={prev[key]} against={d.range.prevLabel} soft={d.range.compare.soft} inverse={inverse} />;
}

/** « 5,5 » open days, as the pace counts them. */
const daysWord = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/**
 * The revenue against the month's goal: the bar with where it should be by now, what is left, where this pace leads.
 * « Chiffre d’affaires » is what was sold; « Entré en caisse » under it is the money that really came in (the Z's).
 */
function Cashed({ d }: { d: Cockpit }) {
  const { cashed: c } = d.kpis, g = c.goal, r = d.range;
  const monthEnd = g ? dates.monthEnd(g.month + '-01') : '';
  const over = !!g && r.upTo >= monthEnd && r.today > monthEnd;
  const ratio = g && g.target ? g.done / g.target : 0;
  const left = g ? Math.max(0, g.target - g.done) : 0;
  // where the bar should be by now: the share of the month's open days gone (today for the part already past)
  const mark = g && !over ? g.expected : undefined;
  return (
    <Tile guide="pilotage.encaisse" wide hot k="Chiffre d’affaires" icon="euro" how={HOW.revenue} delta={delta(d, 'cashed')}
      v={<Money cents={c.value} />}
      s={r.closed && !c.tickets ? 'salon fermé ce jour-là' : <>TTC, avoirs déduits · HT <Money cents={c.valueHT} /> · {plural(c.tickets, 'ticket')}</>}>
      <p className="pl-in" title={HOW.takings}><b>Entré en caisse : <Money cents={c.takings} /></b> <span className="faint">carte, espèces et en ligne</span></p>
      {c.prepaidSold || c.value !== d.kpis.performed ? (
        <p className="faint pl-in-s">{c.prepaidSold ? <>dont <Money cents={c.prepaidSold} /> d’abonnements et de carnets vendus</> : null}{c.prepaidSold && c.value !== d.kpis.performed ? ' · ' : ''}{c.value !== d.kpis.performed ? <>réalisé par l’équipe <Money cents={d.kpis.performed} /></> : null}</p>
      ) : null}
      {g ? (
        <div className="pl-goal">
          <Bar ratio={ratio} mark={mark} label={pct(ratio) + ' de l’objectif ' + ofMonth(g.monthLabel.toLowerCase())} />
          <p><b>Objectif {ofMonth(g.monthLabel.toLowerCase())}</b> : <Money cents={whole(g.done)} /> sur <Money cents={whole(g.target)} /> ({pct(ratio)})</p>
          {over ? <p className="faint">{left ? <>Il manquait <Money cents={whole(left)} />.</> : 'Atteint.'}</p> : (
            <>
              {left && g.openDaysLeft ? <p className="faint">Encore <Money cents={whole(left)} /> · <Money cents={whole(g.perDay)} /> par jour ouvert restant</p> : !left ? <p className="faint">Objectif atteint, bravo.</p> : null}
              {g.projection != null ? <p className="faint" title={HOW.pace}>À ce rythme : <Money cents={g.projection} /> fin {g.monthLabel.toLowerCase()} <span className="pl-how">({daysWord(g.pace.elapsed)} jours ouverts écoulés sur {g.pace.total})</span></p> : null}
              {r.kind === 'week' && g.week.target ? <p className="faint">Cette semaine : <Money cents={whole(g.week.done)} /> sur <Money cents={whole(g.week.target)} /></p> : null}
            </>
          )}
        </div>
      ) : (
        <p className="faint pl-goal">Pas d’objectif fixé pour le mois. {/* the goal lives in Réglages › Objectifs */}<Link to="/reglages/objectifs" className="link">Le fixer</Link></p>
      )}
    </Tile>
  );
}

/** How the figures are computed, for a phone (no tooltip there): the same sentences as the tiles' titles. */
function Definitions({ d }: { d: Cockpit }) {
  const rows: [string, string][] = [
    ['Les flèches ↑ ↓', HOW.compare + ' Ici : ' + d.range.compare.words + '.'],
    ['Chiffre d’affaires', HOW.revenue], ['Entré en caisse', HOW.takings], ['À ce rythme', HOW.pace], ['Remplissage', HOW.fill],
    ['Clients', HOW.clients], ['Panier moyen', HOW.basket], ['Absences, montant perdu', HOW.noShow], ['Libre à vendre', HOW.free]
  ];
  return (
    <details className="pl-defs">
      <summary>Comment ces chiffres sont calculés</summary>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </details>
  );
}

/** The whole page's tiles. */
export function Tiles({ d }: { d: Cockpit }) {
  const k = d.kpis;
  const noShow = k.noShows;
  const o = k.outstanding;
  // before the doors open on the day shown, the result tiles would be a wall of zeros: the briefing above says the day
  const early = d.range.kind === 'day' && d.range.live && d.today.open && !d.today.started && !k.cashed.served && !noShow.count;
  return (
    <>
      <section className="pl-tiles" aria-label="Les chiffres de la période">
        <Cashed d={d} />
        {early ? <p className="muted pl-early">Le salon n’a pas encore ouvert : remplissage, clients et panier du jour arriveront avec les premiers encaissements.</p> : (
          <>
            <Tile guide="pilotage.remplissage" k="Remplissage" icon="chair" how={HOW.fill} delta={delta(d, 'fill')} v={pct(k.fill.value)}>
              <ul className="pl-chairs" aria-label="Par fauteuil">
                {k.fill.chairs.map((c) => (
                  <li key={c.id}><span className="nm"><i className="sw" style={{ background: c.color }} />{c.name}</span><Bar ratio={c.value} color={c.color} label={c.name + ' ' + pct(c.value)} /><b className="tnum">{Math.round(c.value * 100)}</b></li>
                ))}
              </ul>
            </Tile>
            <Tile guide="pilotage.clients" k="Clients" icon="clients" how={HOW.clients} delta={delta(d, 'clients')} v={k.clients.total}
              s={<>{k.clients.new ? k.clients.new + (k.clients.new > 1 ? ' nouveaux' : ' nouveau') : 'aucun nouveau'} · {k.clients.returning} déjà {k.clients.returning > 1 ? 'clients' : 'client'}</>}>
              {k.clients.total ? <Bar ratio={k.clients.new / k.clients.total} label={pct(k.clients.new / k.clients.total) + ' de nouveaux clients'} /> : null}
            </Tile>
            <Tile guide="pilotage.absences" k="Absences" icon="alert" how={HOW.noShow} hot={noShow.count > 0 && noShow.rate >= 0.08} delta={delta(d, 'noShows', true)} v={noShow.count}
              s={noShow.count ? <>{pct(noShow.rate, 1)}{noShow.lost ? <> · <Money cents={noShow.lost} /> perdus, acomptes gardés déduits</> : ' · rien de perdu'}{k.lateCancels ? ' · ' + plural(k.lateCancels, 'annulation') + ' du client' : ''}</> : k.lateCancels ? plural(k.lateCancels, 'annulation') + ' du client' : 'aucune absence'} />
            <Tile k="Panier moyen" icon="ticket" how={HOW.basket} delta={delta(d, 'avgTicket')} v={<Money cents={k.avgTicket} />} s={<>{k.cashed.served} {k.cashed.served > 1 ? 'tickets' : 'ticket'} avec prestation ou produit</>} />
            <Tile guide="pilotage.repris" k="Repris avant de partir" icon="calendar" delta={delta(d, 'rebookRate')} v={pct(k.rebookRate)}
              s={k.returned60 ? <>reviennent sous 60 j : {pct(k.returned60)}</> : 'ont repris rendez-vous à la caisse'} />
            <Tile k="Pourboires" icon="heart" delta={delta(d, 'tips')} v={<Money cents={k.tips} />} s="hors chiffre d’affaires" />
            <Tile guide="pilotage.realise" k="Chiffre réalisé" icon="scissors" delta={delta(d, 'performed')} v={<Money cents={k.performed} />} s="ce que l’équipe a coupé, carnets et abonnements compris" />
            <Tile k="Remises" icon="percent" delta={delta(d, 'discounts', true)} v={<Money cents={k.discounts} />} s={k.refunds ? <><Money cents={k.refunds} /> remboursés</> : 'aucun remboursement'} />
          </>
        )}
        <Tile guide="pilotage.encours" wide k="Dû aux clients" icon="gift" v={<Money cents={o.giftcards + o.carnets} />} s="déjà payé, pas encore consommé">
          <dl className="pl-owed">
            <div><dt>Cartes cadeaux</dt><dd><Money cents={o.giftcards} /><small>{plural(o.giftcardCount, 'carte')}</small></dd></div>
            <div><dt>Carnets</dt><dd><Money cents={o.carnets} /><small>{plural(o.cuts, 'coupe')} sur {plural(o.carnetCount, 'carnet')}</small></dd></div>
          </dl>
        </Tile>
      </section>
      <Definitions d={d} />
    </>
  );
}

/** The tiles other areas added (./tiles), for what this person may see; each decides by itself whether it shows. */
export function ExtraTiles({ from, to }: PilotageTileProps) {
  const { can } = useApp();
  const list = EXTRA.filter((x) => !x.meta.cap || can(x.meta.cap));
  if (!list.length) return null;
  return <>{list.map(({ meta, C }) => <C key={meta.id} from={from} to={to} />)}</>;
}
