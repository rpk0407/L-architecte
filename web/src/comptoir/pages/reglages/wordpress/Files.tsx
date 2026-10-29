// The files the owner dropped, and what was understood of them: one row per file (what it spans, what is wrong with it, how to
// take it off), the first lines as they were read, the lines nobody could read, the two models to fill in by hand.
// Presentational only: the reading itself is lib/wpimport.ts.
import { dates, cap, plural, time } from '../../../../lib/format';
import * as W from '../../../../lib/wpimport';

import { Button, Note } from '../../../../ui/kit';
import { saveText } from './save';

const KIND: Record<W.FileKind, string> = { bookings: 'Réservations (CSV)', wxr: 'Réservations (XML)', customers: 'Clients', giftcards: 'Cartes cadeaux', packs: 'Carnets', unknown: 'Format non reconnu' };
/** '2026-10-20' → '20 oct. 2026' */
const dmy = (day: string) => { const p = dates.dayParts(day); return p.d + ' ' + dates.MONTHS_SH[p.m - 1] + ' ' + p.y; };

export function FileList({ files, reading, onRemove }: { files: W.FileReport[]; reading: string[]; onRemove: (i: number) => void }) {
  return (
    <>
      <ul className="list wp-files" aria-label="Fichiers déposés">{files.map((f, i) => {
        const bad = f.kind === 'unknown' || !!f.why;
        const span = (f.kind === 'bookings' || f.kind === 'wxr') && f.rows && f.first && f.last
          ? 'du ' + dmy(f.first) + ' au ' + dmy(f.last) + ' · ' + plural(f.rows, 'rendez-vous', 'rendez-vous') + (f.ahead ? ' (dont ' + f.ahead + ' à venir)' : '') + (f.window ? ' · période demandée du ' + dmy(f.window.from) + ' au ' + dmy(f.window.to) : '')
          : '';
        return (
          <li key={i} className="li" data-kind={f.kind}>
            <span className="li-main">
              <b>{f.name}</b>
              <small>{KIND[f.kind]}{f.kind !== 'unknown' ? ' · ' + plural(f.rows, 'ligne') : ''}</small>
              {span ? <small className="wp-span">{span}</small> : null}
              {f.why ? <small className="wp-why-file">{f.why}</small> : null}
              {f.info ? <small className="wp-info">{f.info}</small> : null}
            </span>
            <span className={'badge ' + (f.kind === 'unknown' ? 'badge-danger' : f.why ? 'badge-warn' : f.rows ? 'badge-ok' : '')}>{f.kind === 'unknown' ? 'à refaire' : f.why ? 'vide' : f.rows ? 'lu' : f.dupes ? 'déjà lu' : 'vide'}</span>
            <Button size="sm" variant="ghost" icon="x" aria-label={'Retirer « ' + f.name + ' »'} onClick={() => onRemove(i)} data-bad={bad ? '' : undefined} />
          </li>
        );
      })}</ul>
      <div aria-live="polite">{reading.map((n) => <p key={n} className="faint wp-reading"><span className="spin" aria-hidden />Lecture de « {n} »…</p>)}</div>
    </>
  );
}

/** « Voici comment j’ai lu tes 3 premières lignes »: the date, the name, the service, the barber and the price, as they were understood. */
export function Sample({ files }: { files: W.FileReport[] }) {
  const f = files.find((x) => x.sample && x.sample.length);
  if (!f || !f.sample) return null;
  return (
    <section className="wp-sample" aria-label="Lecture des premières lignes" data-guide="wp-lecture">
      <h3>Voici comment j’ai lu tes {f.sample.length > 1 ? f.sample.length + ' premières lignes' : 'première ligne'}</h3>
      <div className="table-wrap">
        <table className="table wp-sample-t">
          <caption className="vh">Les premières lignes de {f.name}, telles qu’elles ont été lues</caption>
          <thead><tr><th scope="col">N°</th><th scope="col">Date lue</th><th scope="col">Nom</th><th scope="col">Prestation</th><th scope="col">Barbier</th><th scope="col" className="num">Prix</th></tr></thead>
          <tbody>{f.sample.map((r) => (
            <tr key={r.wp}>
              <th scope="row" data-label="N°">{r.wp}</th>
              <td data-label="Date lue">{cap(dates.dayShort(r.day)) + ' ' + r.day.slice(0, 4) + ' · ' + time(r.start)}</td>
              <td data-label="Nom">{r.name || '—'}</td>
              <td data-label="Prestation">{r.services.join(', ') || '—'}</td>
              <td data-label="Barbier">{r.staff || '—'}</td>
              <td data-label="Prix" className="num">{r.price == null ? '—' : (r.price / 100).toLocaleString('fr-FR', { minimumFractionDigits: r.price % 100 ? 2 : 0 }) + ' €'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="faint">Si une date, un nom ou un prix est faux, ne continue pas : retire le fichier et refais l’export.</p>
    </section>
  );
}

/** The lines the reader could not understand: the count, then every one (200 at most here) with the file, the line, the WordPress number and the reason; the whole list as a CSV. */
export function Issues({ problems }: { problems: W.Problem[] }) {
  if (!problems.length) return null;
  const shown = problems.slice(0, 200);
  return (
    <div className="col wp-issues" style={{ gap: 8 }} data-guide="wp-soucis">
      <Note tone="warn" icon="alert">{plural(problems.length, 'ligne n’a pas pu être lue', 'lignes n’ont pas pu être lues')} : {problems.length > 1 ? 'elles ne seront pas reprises' : 'elle ne sera pas reprise'}, et le rapport les gardera.</Note>
      <details className="wp-issues-list">
        <summary>{problems.length > 200 ? 'Voir les 200 premières' : 'Voir ' + (problems.length > 1 ? 'les ' + problems.length + ' soucis' : 'le souci')}</summary>
        <ul className="list">{shown.map((x, i) => (
          <li key={i} className="li"><span className="li-main"><b>{x.file}{x.line ? ' · ligne ' + x.line : ''}{x.wp ? <span className="faint"> · n° {x.wp}</span> : null}</b><small>{x.text}</small></span></li>
        ))}</ul>
      </details>
      <div><Button size="sm" icon="download" onClick={() => saveText('lignes-illisibles.csv', W.problemsCsv(problems))}>Télécharger la liste (CSV)</Button></div>
    </div>
  );
}

/** The two small files typed by hand: a model to fill in, with one example line. */
export function Templates() {
  return (
    <span className="row wp-models" data-guide="wp-modeles">
      <Button size="sm" icon="download" onClick={() => saveText(W.TEMPLATES.giftcards.name, W.TEMPLATES.giftcards.text)}>Modèle des cartes cadeaux</Button>
      <Button size="sm" icon="download" onClick={() => saveText(W.TEMPLATES.packs.name, W.TEMPLATES.packs.text)}>Modèle des carnets</Button>
    </span>
  );
}

