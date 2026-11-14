// What is coming (the audit's C1 and C2): today before it happens, and the next seven days. Always from now, whatever the
// period shown: the appointments booked and what they are worth, each chair's fill, the free time still to sell.
// One server definition for both (chairLoad, server/domain/cockpit.js); the words under the figures are shared/figures.js'.
import { pct, plural, time } from '../../../lib/format';
import { Link } from '../../../lib/router';
import { Icon } from '../../../ui/Icon';
import { Money } from '../../../ui/kit';
import type { CockpitAhead, CockpitToday } from '../../types';
import { Bar, HOW, hoursOf } from './shared';

/** « 6 h 30 » to the quarter of an hour. */
const free = (min: number) => hoursOf(Math.round(min / 15) * 15);

/** « Aujourd’hui »: the day's appointments, the revenue they should bring, each chair's fill and the free time left to sell. */
export function Today({ t }: { t: CockpitToday }) {
  const when = !t.open ? 'salon fermé' : t.over ? 'journée terminée' : t.started ? 'ouvert jusqu’à ' + time(t.closesAt || 0) : 'ouverture à ' + time(t.opensAt || 0);
  const working = t.chairs.filter((c) => !c.off);
  return (
    <section className="card pl-today" aria-label="Aujourd’hui, ce qui est prévu">
      <div className="card-h"><h2><Icon name="calendar" size={16} />Aujourd’hui</h2><span className="muted">{when}</span></div>
      {!t.open && !t.count ? <p className="muted pl-today-none">Pas de rendez-vous aujourd’hui : le salon est fermé.</p> : (
        <>
          <dl className="pl-today-k">
            <div title={HOW.planned}>
              <dt>Rendez-vous</dt>
              <dd>{t.count}</dd>
              <small>{!t.count ? 'aucun pour l’instant' : t.left === t.count ? (t.firstAt != null ? 'le premier à ' + time(t.firstAt) : 'tous à venir') : t.left ? 'encore ' + t.left + ' à venir' : 'tous passés'}</small>
            </div>
            <div title={HOW.planned}>
              <dt>Chiffre prévu</dt>
              <dd><Money cents={t.planned} /></dd>
              {/* the Accueil's « encore prévus », the same figure under the same words */}
              <small>{(t.started && !t.over) || (t.left && t.left !== t.count) ? <><Money cents={t.expected} /> encore prévus</> : 'prix des rendez-vous du jour'}</small>
            </div>
            <div title={HOW.free}>
              <dt>Libre à vendre</dt>
              <dd>{t.over ? '—' : free(t.freeMin)}</dd>
              <small>{t.over ? 'la journée est finie' : t.started ? 'd’ici la fermeture' : 'sur la journée'} · rempli à {pct(t.fill)}</small>
            </div>
          </dl>
          {t.chairs.length ? (
            <ul className="pl-chairs pl-today-chairs" aria-label="Aujourd’hui par fauteuil">
              {t.chairs.map((c) => (
                <li key={c.id}>
                  <span className="nm"><i className="sw" style={{ background: c.color }} />{c.name}</span>
                  {c.off ? <span className="faint pl-today-off">{c.away ? 'absent aujourd’hui' : 'ne travaille pas aujourd’hui'}</span> : (
                    <>
                      <Bar ratio={c.fill} color={c.color} label={c.name + ' rempli à ' + pct(c.fill)} />
                      <span className="pl-today-free"><b className="tnum">{pct(c.fill)}</b>{t.over ? null : <small>{c.freeMin >= 15 ? free(c.freeMin) + ' libres' + (c.gap ? ' · ' + time(c.gap[0]) + ' – ' + time(c.gap[1]) : '') : 'complet'}</small>}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {working.length && !t.over ? <p className="faint pl-note">{HOW.free}</p> : null}
        </>
      )}
      <Link to="/agenda" className="link pl-today-go">Voir l’agenda<Icon name="chevR" size={14} /></Link>
    </section>
  );
}

/** A cell's tone: the emptier the day, the more there is to sell. */
const tone = (v: number) => (v >= 0.75 ? 'full' : v >= 0.4 ? 'mid' : 'low');

/** « Les 7 prochains jours »: the salon's fill day by day, then each chair's; a pale cell is time to sell. */
export function Ahead({ a }: { a: CockpitAhead }) {
  if (!a.days.length) return null;
  const cell = (v: number | null, key: string, what: string) => (v == null
    ? <td key={key} className="off" aria-label={what + ' : ne travaille pas'}>–</td>
    : <td key={key} className={tone(v)} aria-label={what + ' : ' + pct(v)}>{Math.round(v * 100)}</td>);
  return (
    <section className="card pl-ahead" aria-label="Les 7 prochains jours">
      <div className="card-h"><h2><Icon name="chair" size={16} />Les 7 prochains jours</h2><span className="muted">remplis à {pct(a.fill)}</span></div>
      <p className="pl-ahead-sum"><b>{free(a.freeMin)}</b> libres à vendre · {plural(a.count, 'rendez-vous', 'rendez-vous')} pris · <Money cents={a.planned} /> prévus</p>
      <div className="pl-ahead-wrap">
        <table className="pl-ahead-t">
          <caption className="vh">Remplissage en % par jour et par fauteuil</caption>
          <thead><tr><th scope="col"><span className="vh">Fauteuil</span></th>{a.days.map((d) => <th key={d.day} scope="col">{d.label.split(' ')[0]}<small>{d.label.split(' ')[1]}</small></th>)}</tr></thead>
          <tbody>
            <tr className="all"><th scope="row">Salon</th>{a.days.map((d) => cell(d.open && d.capMin ? d.fill : null, d.day, 'Salon ' + d.label))}</tr>
            {a.chairs.map((c) => (
              <tr key={c.id}><th scope="row"><i className="sw" style={{ background: c.color }} />{c.name}</th>{c.days.map((v, i) => cell(v, a.days[i].day, c.name + ' ' + a.days[i].label))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint pl-note">Remplissage en %. Plus la case est claire, plus il reste de place à vendre ; « – » : fermé ou absent.</p>
    </section>
  );
}
