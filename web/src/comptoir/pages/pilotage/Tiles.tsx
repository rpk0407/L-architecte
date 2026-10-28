// The tiles of Pilotage: the period in nine figures, each against the period before. The built-in ones read the one cockpit
// read; the others are the files of ./tiles (Abonnés, Espace client, Avis Google…), each fetching its own route and gone
// when it answers 403 or 404. A new area adds a file there: there is no list to edit.
import type { ComponentType } from 'react';
import { dates, pct, plural } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { Money } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Cockpit, PilotageTileMeta, PilotageTileProps } from '../../types';
import { Bar, Dlt, Tile } from './shared';

const found = import.meta.glob<{ meta?: PilotageTileMeta; default?: ComponentType<PilotageTileProps> }>('./tiles/*.tsx', { eager: true });
const EXTRA = Object.values(found)
  .filter((m): m is { meta: PilotageTileMeta; default: ComponentType<PilotageTileProps> } => !!m.meta && !!m.default)
  .map((m) => ({ meta: m.meta, C: m.default }))
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id));

/** A goal reads to the euro. */
const whole = (c: number) => Math.round(c / 100) * 100;

/** Encaissé against the month's goal: the bar with where it should be by now, what is left, where this pace leads. */
function Cashed({ d }: { d: Cockpit }) {
  const { cashed: c } = d.kpis, g = c.goal, r = d.range;
  const against = r.prevLabel;
  const monthEnd = g ? dates.monthEnd(g.month + '-01') : '';
  const over = !!g && r.upTo >= monthEnd && r.today > monthEnd;
  const ratio = g && g.target ? g.done / g.target : 0;
  const left = g ? Math.max(0, g.target - g.done) : 0;
  // where the bar should be by now: the share of the month's days gone
  const mark = g && !over ? dates.dayParts(r.upTo).d / dates.dayParts(monthEnd).d : undefined;
  return (
    <Tile guide="pilotage.encaisse" wide hot k="Encaissé" icon="euro" delta={<Dlt cur={c.value} prev={c.prev} against={against} />}
      v={<Money cents={c.value} />}
      s={<>{plural(c.tickets, 'ticket')}{c.value !== d.kpis.performed ? <> · réalisé par l’équipe <Money cents={d.kpis.performed} /></> : null}</>}>
      {g ? (
        <div className="pl-goal">
          <Bar ratio={ratio} mark={mark} label={pct(ratio) + ' de l’objectif de ' + g.monthLabel.toLowerCase()} />
          <p><b>Objectif de {g.monthLabel.toLowerCase()}</b> : <Money cents={whole(g.done)} /> sur <Money cents={whole(g.target)} /> ({pct(ratio)})</p>
          {over ? <p className="faint">{left ? <>Il manquait <Money cents={whole(left)} />.</> : 'Atteint.'}</p> : (
            <>
              {left && g.openDaysLeft ? <p className="faint">Encore <Money cents={whole(left)} /> · <Money cents={whole(g.perDay)} /> par jour ouvré</p> : !left ? <p className="faint">Objectif atteint, bravo.</p> : null}
              {g.projection != null ? <p className="faint">À ce rythme : <Money cents={g.projection} /> fin {g.monthLabel.toLowerCase()}</p> : null}
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

/** The whole page's tiles. */
export function Tiles({ d }: { d: Cockpit }) {
  const k = d.kpis, p = k.prev, against = d.range.prevLabel;
  const noShow = k.noShows;
  const o = k.outstanding;
  return (
    <section className="pl-tiles" aria-label="Les chiffres de la période">
      <Cashed d={d} />
      <Tile guide="pilotage.remplissage" k="Remplissage" icon="chair" delta={<Dlt cur={k.fill.value} prev={p.fill} against={against} />} v={pct(k.fill.value)}>
        <ul className="pl-chairs" aria-label="Par fauteuil">
          {k.fill.chairs.map((c) => (
            <li key={c.id}><span className="nm"><i className="sw" style={{ background: c.color }} />{c.name}</span><Bar ratio={c.value} color={c.color} label={c.name + ' ' + pct(c.value)} /><b className="tnum">{Math.round(c.value * 100)}</b></li>
          ))}
        </ul>
      </Tile>
      <Tile guide="pilotage.clients" k="Clients" icon="clients" delta={<Dlt cur={k.clients.total} prev={p.clients} against={against} />} v={k.clients.total}
        s={<>{k.clients.new ? k.clients.new + (k.clients.new > 1 ? ' nouveaux' : ' nouveau') : 'aucun nouveau'} · {plural(k.clients.returning, 'habitué')}</>} />
      <Tile guide="pilotage.absences" k="Absences" icon="alert" hot={noShow.count > 0 && noShow.rate >= 0.08} delta={<Dlt cur={noShow.count} prev={p.noShows} against={against} inverse />} v={noShow.count}
        s={noShow.count ? <>{pct(noShow.rate, 1)}{noShow.lost ? <> · <Money cents={noShow.lost} /> perdus</> : ' · rien de perdu'}{k.lateCancels ? ' · ' + plural(k.lateCancels, 'annulation') + ' du client' : ''}</> : k.lateCancels ? plural(k.lateCancels, 'annulation') + ' du client' : 'aucune absence'} />
      <Tile k="Panier moyen" icon="ticket" delta={<Dlt cur={k.avgTicket} prev={p.avgTicket} against={against} />} v={<Money cents={k.avgTicket} />} s={plural(k.cashed.tickets, 'ticket')} />
      <Tile guide="pilotage.repris" k="Repris avant de partir" icon="calendar" delta={<Dlt cur={k.rebookRate} prev={p.rebookRate} against={against} />} v={pct(k.rebookRate)}
        s={k.returned60 ? <>reviennent sous 60 j : {pct(k.returned60)}</> : 'ont repris rendez-vous à la caisse'} />
      <Tile k="Pourboires" icon="heart" delta={<Dlt cur={k.tips} prev={p.tips} against={against} />} v={<Money cents={k.tips} />} s="hors chiffre d’affaires" />
      <Tile guide="pilotage.realise" k="Chiffre réalisé" icon="scissors" delta={<Dlt cur={k.performed} prev={p.performed} against={against} />} v={<Money cents={k.performed} />} s="ce que l’équipe a coupé, carnets et abonnements compris" />
      <Tile k="Remises" icon="percent" delta={<Dlt cur={k.discounts} prev={p.discounts} against={against} inverse />} v={<Money cents={k.discounts} />} s={k.refunds ? <><Money cents={k.refunds} /> remboursés</> : 'aucun remboursement'} />
      <Tile guide="pilotage.encours" wide k="En cours" icon="gift" v={<Money cents={o.giftcards + o.carnets} />} s="ce que tu dois encore aux clients">
        <dl className="pl-owed">
          <div><dt>Cartes cadeaux</dt><dd><Money cents={o.giftcards} /><small>{plural(o.giftcardCount, 'carte')}</small></dd></div>
          <div><dt>Carnets</dt><dd><Money cents={o.carnets} /><small>{plural(o.cuts, 'coupe')} sur {plural(o.carnetCount, 'carnet')}</small></dd></div>
        </dl>
      </Tile>
    </section>
  );
}

/** The tiles other areas added (./tiles), for what this person may see; each decides by itself whether it shows. */
export function ExtraTiles({ from, to }: PilotageTileProps) {
  const { can } = useApp();
  const list = EXTRA.filter((x) => !x.meta.cap || can(x.meta.cap));
  if (!list.length) return null;
  return <>{list.map(({ meta, C }) => <C key={meta.id} from={from} to={to} />)}</>;
}
