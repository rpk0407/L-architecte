// The report of a WordPress run (Réglages › Reprendre WordPress): kept on the server, so it survives a reload; what the
// files held against what was made, already there, skipped (by reason) and left out; the rows that want a look, grouped by
// reason; the CSV to hand to whoever helps. Counts come from lib/wpimport.ts `reconcile`, the lines from GET /import/runs/:id.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '../../../../lib/query';
import { Link } from '../../../../lib/router';
import { ago, cap, dates, plural, time } from '../../../../lib/format';
import { kindTitle as group, reconcile, reportCsv, SKIP_WORDS, type ReportLine, type Recon, type RunRecord } from '../../../../lib/wpimport';
import { Icon } from '../../../../ui/Icon';
import { Button, Chip, Empty, Note, Skeleton } from '../../../../ui/kit';
import { useApp } from '../../../state';
import { Card } from '../shared';
import { saveText } from './save';

type Summary = RunRecord & { reviewTotal?: number; reviewKept?: number };
type Detail = { run: Summary; lines: ReportLine[] };

const stamp = (ms: number) => { const p = dates.localParts(ms); return p.d + ' ' + dates.MONTHS_FR[p.m - 1] + ' à ' + dates.hhmm(p.min); };
const sourceWords = (r: Summary) => (r.source === 'site' ? 'site connecté' : plural(r.files.length, 'fichier'));

/** Why the run on this page stopped, when it did: a lost connection or a server error can be resumed, a refusal of one row cannot. */
export type Halt = { transient: boolean; words?: string };
/** A run whose last batch came in less than a minute ago is still going, perhaps in another tab. */
const LIVE_MS = 60000;
const going = (r: Summary, now: number) => !r.finishedAt && !r.undoneAt && now - (r.lastAt || r.at) < LIVE_MS;

export function Report({ runs, runId, onPick, next, halt, focus }: { runs: Summary[]; runId: string | null; onPick: (id: string) => void; next?: string; halt?: Halt; focus?: boolean }) {
  // the run just made is asked for by its id at once: the list of runs may not hold it yet, and the previous run must not stand in for it
  const id = runId || runs[0]?.id || null;
  const { data, loading, error } = useQuery<Detail>(id ? '/api/v1/import/runs/' + id : null);
  const top = useRef<HTMLElement>(null);
  const ready = !!data && !loading;
  // a run just finished: the heading of its report takes the focus (a screen reader says where it is), once
  useEffect(() => {
    if (!focus || !ready) return;
    const h = top.current?.querySelector<HTMLElement>('h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); }
  }, [focus, ready, id]);
  if (!id) return null;
  return (
    <section ref={top} className="col wr" style={{ gap: 16 }} aria-label="Rapport de la reprise" data-guide="wp-rapport">
      {loading || !data ? <Card title="Rapport de la reprise" icon="journal">{error ? <Note tone="err" icon="alert">{error.message}</Note> : <><Skeleton h={22} w="60%" /><Skeleton h={120} /></>}</Card> : <Body d={data} next={next} halt={halt} />}
      <Recent runs={runs} id={id} onPick={onPick} halted={halt ? id : undefined} />
    </section>
  );
}

function Body({ d, next, halt }: { d: Detail; next?: string; halt?: Halt }) {
  const { run, lines } = d;
  const { now } = useApp();
  const rep = reconcile(run);
  const done = !!run.finishedAt;
  // the run this tab just saw stop is not « en cours », whatever the clock says
  const live = !halt && going(run, now());
  const gap = rep.reduce((t, r) => t + Math.abs(r.gap), 0);
  const unread = run.excluded.unreadable;
  const interrupted = !done && !live;
  const [open, setOpen] = useState<string | null>(null);
  const parts = run.parts ?? 0;
  const stopped = parts > 0 ? 'Interrompue à ' + run.batches + '/' + parts + ' paquet' + (parts > 1 ? 's' : '') : 'Interrompue après ' + plural(run.batches, 'paquet');
  return (
    <>
      <Card
        title={'Reprise du ' + stamp(run.at) + ' · ' + sourceWords(run)} icon="journal"
        aside={<span className={'badge ' + (done ? 'badge-ok' : live ? 'badge-info' : 'badge-warn')}>{done ? <><Icon name="check" />Terminée</> : live ? <>En cours</> : <><Icon name="alert" />{stopped}</>}</span>}
      >
        {done ? null : live ? <Note icon="info">Cette reprise est en cours (dans un autre onglet ?). Attends qu’elle se termine avant d’en lancer une autre.</Note>
          : halt && !halt.transient ? <Note tone="err" icon="alert">{(halt.words || 'Une ligne est refusée par le salon') + '.'} Le reste n’a pas été envoyé : télécharge le rapport et envoie-le à ton prestataire.</Note>
          : <Note tone="warn" icon="alert">Relance l’import avec les mêmes fichiers : rien ne sera compté deux fois.</Note>}
        {run.source === 'site' && run.site ? <p className="muted" style={{ fontSize: 13 }}>Lu sur {run.site.url}</p> : (
          <ul className="wr-files" aria-label="Fichiers de cette reprise">{run.files.map((f, i) => <li key={i}><b>{f.name}</b><small>{plural(f.rows, 'ligne')}{f.sha ? ' · ' + f.sha.slice(0, 8) : ''}</small></li>)}</ul>
        )}
        <div className="table-wrap">
          <table className="table wr-table">
            <caption className="vh">Ce que contenait la source, et ce qu’il en est devenu</caption>
            <thead><tr><th scope="col">Type</th><th scope="col" className="num">Dans la source</th><th scope="col" className="num">Repris</th><th scope="col" className="num">Déjà là</th><th scope="col" className="num">Ignorés</th><th scope="col" className="num">Laissées de côté</th>{interrupted ? <th scope="col" className="num">Pas encore traités</th> : null}<th scope="col"><span className="vh">Détail</span></th></tr></thead>
            <tbody>{rep.map((r) => <Row key={r.type} r={r} run={run} open={open === r.type} pending={interrupted} toggle={() => setOpen(open === r.type ? null : r.type)} />)}</tbody>
          </table>
        </div>
        {done ? (gap !== 0 ? <Note tone="err" icon="alert">Écart de {gap} : envoie ce rapport au prestataire.</Note>
          : unread > 0 ? <Note tone="warn" icon="alert">{plural(unread, 'ligne n’a pas pu être lue', 'lignes n’ont pas pu être lues')} : voir la liste « Lignes illisibles » plus bas. Le reste est compté. <span className="faint">Chaque autre ligne est reprise, déjà là, ignorée avec sa raison, ou laissée de côté.</span></Note>
          : <Note tone="ok" icon="check">Tout est compté ✓ <span className="faint">Chaque ligne des fichiers est reprise, déjà là, ignorée avec sa raison, ou laissée de côté.</span></Note>) : null}
        {run.counts.appts?.gone ? <p className="muted" style={{ fontSize: 13 }}>{plural(run.counts.appts.gone, 'rendez-vous supprimé', 'rendez-vous supprimés')} sur l’ancien site, annulé{run.counts.appts.gone > 1 ? 's' : ''} ici sans SMS.</p> : null}
        <div className="row wr-acts">
          <Button icon="download" onClick={() => download(run, lines, rep)}>Télécharger le rapport (CSV)</Button>
          <Link to="/clients?segment=doublons" className="btn btn-subtle">Voir les doublons possibles</Link>
          {next ? <Link to={'/agenda?day=' + next} className="btn btn-subtle">Voir l’agenda du {dates.dayShort(next)}</Link> : null}
        </div>
      </Card>
      <Lines lines={lines} finished={done} truncated={(run.reviewTotal ?? 0) > (run.reviewKept ?? 0)} />
    </>
  );
}

/** One row of the table; the reasons of the skipped and of the left-out rows open under it. */
function Row({ r, run, open, toggle, pending }: { r: Recon; run: Summary; open: boolean; toggle: () => void; pending: boolean }) {
  const ex = run.excluded;
  const leftWhy: [string, number][] = r.type === 'bookings'
    ? [['En double : lignes présentes dans plusieurs fichiers', ex.duplicate], ['Illisibles : lignes que la lecture n’a pas pu comprendre', ex.unreadable]]
    : r.type === 'clients' ? [['Hors conservation : personnes sans visite depuis 3 ans', ex.retention], ['Clients sans rendez-vous repris : pas de fiche (règle de conservation)', ex.noVisit]] : [['Illisibles : lignes que la lecture n’a pas pu comprendre', r.left]];
  const retentionRows = r.type === 'bookings' ? Math.max(0, r.left - ex.duplicate - ex.unreadable) : 0;
  const why = (r.type === 'bookings' ? [...leftWhy, ['Hors conservation : rendez-vous de personnes sans visite depuis 3 ans', retentionRows] as [string, number]] : leftWhy).filter(([, n]) => n > 0);
  const hasMore = r.reasons.length > 0 || why.length > 0;
  return (
    <>
      <tr className="wr-row" data-type={r.type}>
        <th scope="row"><span className="wr-type">{r.label}</span></th>
        <td className="num" data-label="Dans la source">{r.source}</td>
        <td className="num" data-label="Repris">{r.made}</td>
        <td className="num" data-label="Déjà là">{r.already}</td>
        <td className="num" data-label="Ignorés">{r.skipped}</td>
        <td className="num" data-label="Laissées de côté">{r.left}</td>
        {pending ? <td className="num" data-label="Pas encore traités">{r.pending}</td> : null}
        <td className="wr-more">{hasMore ? <button type="button" className="wr-toggle" aria-expanded={open} aria-label={'Détail de ' + r.label.toLowerCase()} onClick={toggle}><Icon name={open ? 'minus' : 'plus'} size={16} /></button> : null}</td>
      </tr>
      {open && hasMore ? (
        <tr className="wr-why"><td colSpan={pending ? 8 : 7}>
          <ul>
            {r.reasons.map((x) => <li key={x.key}><span>{SKIP_WORDS[x.key] || x.key}</span><b>{x.n}</b></li>)}
            {why.map(([t, n]) => <li key={t}><span>{t}</span><b>{n}</b></li>)}
          </ul>
        </td></tr>
      ) : null}
    </>
  );
}

/** The lines that want a look, by reason; « À faire » asks something of the owner, « Pour info » only tells. */
function Lines({ lines, truncated, finished }: { lines: ReportLine[]; truncated: boolean; finished: boolean }) {
  const [view, setView] = useState<'all' | 'todo' | 'info'>('all');
  const [more, setMore] = useState<Record<string, boolean>>({});
  const todo = lines.filter((l) => l.todo).length;
  const shown = lines.filter((l) => view === 'all' || (view === 'todo') === l.todo);
  const groups = [...shown.reduce((m, l) => m.set(l.kind, [...(m.get(l.kind) || []), l]), new Map<string, ReportLine[]>())].sort((a, b) => Number(b[1][0].todo) - Number(a[1][0].todo) || b[1].length - a[1].length);
  // an interrupted run has not looked at everything yet: no « all is in place » for it
  if (!lines.length) return finished ? <Card title="Lignes à regarder" icon="eye"><Note tone="ok" icon="check">Rien à regarder : tout est en place.</Note></Card> : null;
  return (
    <Card title={'Lignes à regarder · ' + lines.length} icon="eye">
      <div className="row wr-chips" role="group" aria-label="Filtrer les lignes">
        <Chip on={view === 'all'} onClick={() => setView('all')}>Tout <small>{lines.length}</small></Chip>
        <Chip on={view === 'todo'} onClick={() => setView('todo')}>À faire <small>{todo}</small></Chip>
        <Chip on={view === 'info'} onClick={() => setView('info')}>Pour info <small>{lines.length - todo}</small></Chip>
      </div>
      {groups.length ? groups.map(([kind, list]) => {
        const all = more[kind], rows = all ? list : list.slice(0, 20);
        return (
          <div key={kind} className="wr-group">
            <div className="wr-gh"><h3>{group(kind)}</h3><span className="badge">{list.length}</span><span className={'badge ' + (list[0].todo ? 'badge-warn' : 'badge-info')}>{list[0].todo ? 'À faire' : 'Pour info'}</span></div>
            <ul className="list wr-list">{rows.map((l, i) => (
              <li key={i} className="li">
                <span className="li-main"><b>{l.name || 'Ligne'}{l.wp ? <span className="faint"> · n° {l.wp}</span> : null}</b><small>{[when(l), l.staff, l.text].filter(Boolean).join(' · ')}</small></span>
              </li>
            ))}</ul>
            {list.length > rows.length ? <Button variant="ghost" block onClick={() => setMore({ ...more, [kind]: true })}>Voir les {list.length}</Button> : null}
          </div>
        );
      }) : <Empty icon="check" title="Aucune ligne dans cette vue" />}
      {truncated ? <p className="faint" style={{ fontSize: 12.5 }}>Les 5 000 premières lignes sont gardées ; les comptes ci-dessus restent exacts.</p> : null}
    </Card>
  );
}

const when = (l: ReportLine) => (l.day ? cap(dates.dayShort(l.day)) + ' ' + l.day.slice(0, 4) + (l.start != null ? ' · ' + time(l.start) : '') : '');

/** The five last runs: when, from what, the main counts. */
function Recent({ runs, id, onPick, halted }: { runs: Summary[]; id: string; onPick: (id: string) => void; halted?: string }) {
  const { now } = useApp();
  if (runs.length < 2) return null;
  return (
    <Card title="Les dernières reprises" icon="clock">
      <ul className="list wr-recent">{runs.slice(0, 5).map((r) => {
        const a = r.counts.appts || {}, made = (a.done || 0) + (a.noShow || 0) + (a.cancelled || 0) + (a.booked || 0) + (a.moved || 0) + (a.closed || 0);
        const bits = [sourceWords(r), plural(made, 'rendez-vous repris', 'rendez-vous repris'), plural(r.counts.clients?.added || 0, 'nouveau client', 'nouveaux clients'), plural(a.already || 0, 'déjà là', 'déjà là'), a.gone ? plural(a.gone, 'supprimé', 'supprimés') : ''].filter(Boolean);
        return (
          <li key={r.id} className="li">
            <button type="button" className="li-main wr-pick" aria-current={r.id === id ? 'true' : undefined} onClick={() => onPick(r.id)}>
              <b>{stamp(r.at)}<span className="faint"> · {ago(r.at, now())}</span></b>
              <small>{bits.join(' · ')}</small>
            </button>
            {r.id === id ? <span className="badge">Affichée</span> : null}
            <span className={'badge ' + (r.finishedAt ? 'badge-ok' : going(r, now()) && r.id !== halted ? 'badge-info' : 'badge-warn')}>{r.finishedAt ? 'Terminée' : going(r, now()) && r.id !== halted ? 'En cours' : 'Interrompue'}</span>
          </li>
        );
      })}</ul>
    </Card>
  );
}

function download(run: Summary, lines: ReportLine[], rep: Recon[]) {
  const p = dates.localParts(run.at);
  saveText('reprise-wordpress-' + p.day + '-' + dates.hhmm(p.min).replace(':', 'h') + '.csv', reportCsv(lines, rep));
}
