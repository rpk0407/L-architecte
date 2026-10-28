// Pilotage: the owner's cockpit. The whole salon for a day, a week or a month in tiles against the period before, the till,
// each barber in one tap, and the tiles the other areas add (./pilotage/tiles). One server read (GET /api/v1/cockpit),
// refreshed when the journal moves; on a shared salon screen the amounts start hidden.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { qs } from '../../lib/api';
import { useInterval, useLocal } from '../../lib/hooks';
import { useQuery } from '../../lib/query';
import { Link } from '../../lib/router';
import { dates } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Empty, Seg, Skeleton, Stale } from '../../ui/kit';
import { useApp, useMaskedAmounts } from '../state';
import { PageTitle } from '../App';
import type { Cockpit, CockpitRange } from '../types';
import { Cash } from './pilotage/Cash';
import { Tiles, ExtraTiles } from './pilotage/Tiles';
import { Team } from './pilotage/Team';
import { BarberSheet } from './pilotage/BarberSheet';
import { Equity } from './pilotage/Equity';
import './pilotage.css';

// the statement is Rapports' sheet: loaded when it is asked for
const StatementSheet = lazy(() => import('./Rapports').then((m) => ({ default: m.StatementSheet })));

const RANGES: { v: CockpitRange; t: string }[] = [{ v: 'day', t: 'Aujourd’hui' }, { v: 'week', t: 'Semaine' }, { v: 'month', t: 'Mois' }];
/** The amounts of a shared salon screen start hidden; a tap on the eye shows them for 30 seconds. */
const REVEAL_MS = 30000;

/** The day to ask for when stepping one period back (-1) or forward (+1) from `day`. */
function step(kind: CockpitRange, day: string, dir: -1 | 1): string {
  if (kind === 'day') return dates.addDays(day, dir);
  if (kind === 'week') return dates.addDays(day, 7 * dir);
  return dir < 0 ? dates.addDays(dates.monthStart(day), -1) : dates.addDays(dates.monthEnd(day), 1);
}

export default function Pilotage() {
  const app = useApp();
  const { boot } = app;
  const stored = useLocal<CockpitRange>('lx-pilotage-periode', 'day');
  const kind: CockpitRange = RANGES.some((r) => r.v === stored[0]) ? stored[0] : 'day';
  const setKind = stored[1];
  // '' is the current period; stepping back names a day of an earlier one
  const [day, setDay] = useState('');
  const key = '/api/v1/cockpit' + qs({ range: kind, day: day || null });
  const { data, error, loading, refresh } = useQuery<Cockpit>(key);
  // the screen keeps the last read while the next period loads
  const last = useRef<Cockpit | undefined>(undefined);
  if (data) last.current = data;
  const d = data || last.current;
  // the next period failed to load (offline, 5xx): the old read stays, said plainly, with a way to ask again
  const failed = !data && !!d && !!error;
  const switching = !data && !!d && !failed;
  const masked = useMaskedAmounts();
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!shown) return; const t = window.setTimeout(() => setShown(false), REVEAL_MS); return () => clearTimeout(t); }, [shown]);
  // the blur is carried by the page root, not by .pl: the barber's sheet and the statement are portalled outside it
  const hide = masked && !shown;
  useEffect(() => { if (!hide) return; document.documentElement.dataset.plMasked = '1'; return () => { delete document.documentElement.dataset.plMasked; }; }, [hide]);
  // the till's clock moves without the journal moving: the page asks again every two minutes (the server answers from memory)
  useInterval(() => { void refresh(); }, 120000);
  const [sheet, setSheet] = useState<string | null>(null);
  const [statement, setStatement] = useState<{ staffId: string; month: string } | null>(null);

  const today = app.pulse?.today || boot.today;
  const current = !d || d.range.to >= today;
  const go = (dir: -1 | 1) => {
    const base = d ? d.range.day : today;
    const next = step(kind, base, dir);
    setDay(next >= today ? '' : next);
  };
  const row = d && sheet ? d.team.find((x) => x.id === sheet) || null : null;

  return (
    <div className="pl">
      <PageTitle><h1>Pilotage</h1></PageTitle>
      <header className="pl-head">
        <div className="pl-head-top">
          <div className="pl-when" data-guide="pilotage.periode">
            <Seg value={kind} onChange={(v) => { setKind(v); }} options={RANGES} label="Période" />
            <div className="pl-nav">
              <Button icon="chevL" aria-label={kind === 'day' ? 'Reculer d’un jour' : kind === 'week' ? 'Reculer d’une semaine' : 'Reculer d’un mois'} onClick={() => go(-1)} />
              <div className="pl-label" role="status" aria-live="polite">
                <b>{d ? d.range.label : '…'}</b>
                {d ? <small className="muted">{current ? 'en cours' : 'terminé'} · comparé {d.range.prevLabel}</small> : null}
              </div>
              <Button icon="chevR" aria-label={kind === 'day' ? 'Avancer d’un jour' : kind === 'week' ? 'Avancer d’une semaine' : 'Avancer d’un mois'} disabled={current} onClick={() => go(1)} />
            </div>
          </div>
          <div className="pl-tools">
            {app.offline ? <Stale at={app.pulseAt} now={Date.now()} /> : null}
            {!current ? <Button variant="ghost" onClick={() => setDay('')}>Revenir à aujourd’hui</Button> : null}
            {boot.me.chair ? <Link to="/espace" className="btn btn-ghost">Ma journée<Icon name="arrowR" size={15} /></Link> : null}
            {masked ? (
              <button type="button" className="pl-eye" aria-pressed={shown} aria-label={shown ? 'Remasquer les montants' : 'Afficher les montants pendant 30 secondes'} onClick={() => setShown(!shown)} data-guide="pilotage.montants">
                <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />{shown ? 'Remasquer' : 'Afficher 30 s'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {!d && error ? (
        <section className="card" role="alert"><Empty icon="alert" title="Pilotage est indisponible" action={<Button variant="primary" onClick={() => { void refresh(); }}>Réessayer</Button>}>{error.message}</Empty></section>
      ) : !d || (loading && !d) ? (
        <div className="col" style={{ gap: 14 }} aria-busy="true"><Skeleton h={44} r={14} /><div className="pl-tiles">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={118} r={20} />)}</div><Skeleton h={300} r={22} /></div>
      ) : (
        <div className={'pl-body' + (switching ? ' switching' : '')} aria-busy={switching}>
          {failed ? <div className="pl-fail" role="alert"><Icon name="alert" size={16} /><span>Cette période ne s’est pas chargée : ce que tu vois est la précédente.</span><Button onClick={() => { void refresh(); }}>Réessayer</Button></div> : null}
          <Cash cash={d.cash} today={d.range.today} />
          <Tiles d={d} />
          <div className={'pl-cols' + (d.equity.length ? ' two' : '')}>
            <Team rows={d.team} onOpen={setSheet} />
            <Equity hints={d.equity} onOpen={setSheet} />
          </div>
          <div className="pl-extras"><ExtraTiles from={d.range.from} to={d.range.upTo} /></div>
          <p className="pl-more"><Link to="/rapports" className="link">Tous les chiffres, jour par jour<Icon name="chevR" size={14} /></Link></p>
          <BarberSheet x={row} d={d} reveal={masked ? { shown, toggle: () => setShown(!shown) } : null} onClose={() => setSheet(null)} onStatement={(id) => { setSheet(null); setStatement({ staffId: id, month: d.range.upTo.slice(0, 7) }); }} />
        </div>
      )}
      {statement ? <Suspense fallback={null}><StatementSheet open staffId={statement.staffId} month={statement.month} onClose={() => setStatement(null)} /></Suspense> : null}
    </div>
  );
}
