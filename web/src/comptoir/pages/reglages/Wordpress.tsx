// Reprendre WordPress: the old salon's clients, past visits, upcoming bookings, paper gift cards and subscriptions,
// in four steps. Files are read here (lib/wpimport.ts); the owner sees what will happen before anything is sent; the
// server decides again row by row (server/commands/import.js), and running the same files twice adds nothing.
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { api, uuid } from '../../../lib/api';
import { refreshAll } from '../../../lib/query';
import { Link } from '../../../lib/router';
import { cap, dates, plural, time } from '../../../lib/format';
import * as W from '../../../lib/wpimport';
import { Icon } from '../../../ui/Icon';
import { Button, Kpi, Note, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { Card } from './shared';
import './wordpress.css';

type Known = { known: Set<number>; again: Set<number>; imported: Map<number, W.Prior> };
type Result = { clients: { added: number; merged: Set<string> }; appts: Record<string, number>; giftcards: Record<string, number>; packs: Record<string, number>; review: W.ReviewRow[]; next?: string };
type Dropped = { name: string; text: string; key: string };
type ServerRow = { kind: string; text: string; wp?: number; day?: string; start?: number; name?: string };

const KIND: Record<W.FileKind, string> = { bookings: 'Réservations (CSV)', wxr: 'Réservations (XML)', customers: 'Clients', giftcards: 'Cartes cadeaux', packs: 'Abonnements', unknown: 'Format non reconnu' };

/** WordPress writes UTF-8; a CSV saved from French Excel is often Windows-1252. */
async function readText(f: File) {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
const when = (r: { day?: string; start?: number }) => (r.day ? cap(dates.dayShort(r.day)) + ' ' + r.day.slice(0, 4) + (r.start != null ? ' · ' + time(r.start) : '') : '');

export default function Wordpress() {
  const { boot, now, reloadBoot } = useApp();
  const [files, setFiles] = useState<Dropped[]>([]);
  const [server, setServer] = useState<Known | null>(null);
  const [checking, setChecking] = useState(false);
  const [svcMap, setSvcMap] = useState<Record<string, string>>({});
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const services = boot.services.filter((s) => s.active && !s.pack);
  const chairs = boot.staff.filter((s) => s.active && s.chair);
  const chairIds = useMemo(() => new Set(chairs.map((s) => s.id)), [boot.staff]);
  const parsed = useMemo(() => (files.length ? W.readFiles(files) : null), [files]);
  const seen = useMemo(() => (parsed ? W.names(parsed) : { services: [], staff: [] }), [parsed]);
  const map: W.Mapping = useMemo(() => ({ services: svcMap, staff: staffMap }), [svcMap, staffMap]);
  const pv = useMemo(() => (parsed ? W.preview(parsed, map, now(), { ...(server || {}), chairs: chairIds, today: boot.today }) : null), [parsed, map, server, chairIds]);
  // barbers with upcoming bookings to bring in: the archived profile has no lane in the agenda, so a chair is required
  const upcoming = useMemo(() => (parsed ? W.upcomingNames(parsed, now(), { imported: server?.imported }) : new Set<string>()), [parsed, server]);
  const need = useMemo(() => (parsed ? [...W.upcomingNames(parsed, now(), { imported: server?.imported, map })].filter((n) => !chairIds.has(staffMap[n] || '')) : []), [parsed, server, map, chairIds]);

  const add = async (list: FileList | File[] | null) => {
    if (!list || !list.length) return;
    const next = [...files];
    for (const f of [...list]) {
      if (f.size > 20 * 1024 * 1024) { toast({ kind: 'err', title: '« ' + f.name + ' » est trop lourd (20 Mo au plus).', icon: 'alert' }); continue; }
      // two exports of the same name from different folders are two files; the same file dropped again is one
      const key = f.name + '|' + f.size + '|' + f.lastModified;
      if (next.some((x) => x.key === key)) continue;
      next.push({ name: f.name, text: await readText(f), key });
    }
    const p = W.readFiles(next);
    const n = W.names(p);
    const ahead = W.upcomingNames(p, now());
    // matched once, then the owner's choices are kept as more files arrive. A name left unmatched goes to the archived
    // profile only when it is history alone; with upcoming bookings the owner picks a chair
    setSvcMap((m) => Object.fromEntries(n.services.map(([name]) => [name, m[name] ?? W.bestMatch(name, services, (x) => [x.name, x.short, x.slug || ''])])));
    setStaffMap((m) => Object.fromEntries(n.staff.map(([name]) => [name, m[name] ?? (W.bestMatch(name, chairs, (x) => [x.name]) || (ahead.has(name) ? '' : W.LEGACY))])));
    setFiles(next);
    setResult(null);
    await check(p);
  };
  // which people already have a file, which bookings an earlier run brought in: asked to the server, nothing written
  const check = async (p: W.Parsed) => {
    setChecking(true);
    try {
      const ids = W.preview(p, { services: {}, staff: {} }, now()).identities;
      const keys = ids.flatMap((list, g) => list.map((k) => ({ ...k, g })));
      const known = new Set<number>(), again = new Set<number>(), imported = new Map<number, W.Prior>();
      for (const part of W.chunks(keys, 400, 40000)) {
        const r = await api.post<{ known: number[]; again?: number[] }>('/api/v1/import/preview', { keys: part.map(({ g, ...k }) => k) });
        for (const i of r.known) known.add(part[i].g);
        for (const i of r.again || []) again.add(part[i].g);
      }
      for (const part of W.chunks(p.bookings.map((b) => b.wp), 4000, 40000)) {
        const r = await api.post<{ appts?: W.Prior[] }>('/api/v1/import/preview', { wp: part });
        for (const a of r.appts || []) imported.set(a.wp, a);
      }
      setServer({ known, again, imported });
      // a barber left unmatched whose bookings an earlier run put on a chair: that chair again
      const prior = W.priorStaff(p, imported);
      setStaffMap((m) => Object.fromEntries(Object.entries(m).map(([name, v]) => [name, !v && prior[name] && chairIds.has(prior[name]) ? prior[name] : v])));
    } catch (e) { toastError(e); setServer(null); } finally { setChecking(false); }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); };
  const clear = () => { setFiles([]); setServer(null); setResult(null); setSvcMap({}); setStaffMap({}); if (input.current) input.current.value = ''; };

  const rows = useMemo(() => (parsed ? W.toRows(parsed, map, server?.imported) : null), [parsed, map, server]);
  const c = pv?.counts;
  // what this run brings: new bookings, what changed on the old site since an earlier run, cards, subscriptions
  const nAppts = c ? c.past + c.noShow + c.upcoming + c.cancelled : 0;
  const nChanges = c ? c.toCancel + c.toMove + c.toClose : 0;
  const work = c ? nAppts + nChanges + c.giftcards + c.packs + c.newClients + c.merged : 0;
  const label = c ? [nAppts ? plural(nAppts, 'rendez-vous') : '', nChanges ? plural(nChanges, 'changement') : '', c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'abonnement') : ''].filter(Boolean).join(', ') || (c.newClients + c.merged ? plural(c.newClients + c.merged, 'fiche client', 'fiches clients') : '') : '';

  const run = async () => {
    if (!rows) return;
    // clients first, then the bookings, then what hangs on a client file (subscriptions)
    const parts = [
      ...W.chunks(rows.clients).map((x) => ({ clients: x })), ...W.chunks(rows.appts).map((x) => ({ appts: x })),
      ...W.chunks(rows.giftcards).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs).map((x) => ({ packs: x }))
    ];
    // the rows the preview already left out stay in sight after the import; the agenda link opens a booking of this run
    const first = parsed?.bookings.find((b) => b.day >= boot.today && !server?.imported.has(b.wp) && W.outcome(b, now()) === 'booked' && b.services.every((n) => svcMap[n]) && chairIds.has(staffMap[b.staff] || ''));
    const out: Result = { clients: { added: 0, merged: new Set() }, appts: {}, giftcards: {}, packs: {}, review: (pv?.review || []).filter((r) => r.kind === 'service'), next: first?.day };
    const sum = (a: Record<string, number>, b: Record<string, number>) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; };
    const rid = uuid().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    setProgress({ done: 0, total: parts.length });
    try {
      for (const [i, body] of parts.entries()) {
        // one id per request; clicking again after a failure starts a new run, which adds nothing twice (ext.wp, phone, code)
        const r = await api.post<{ clients: { added: number; merged: string[] }; appts: Record<string, number>; giftcards: Record<string, number>; packs: Record<string, number>; review: ServerRow[] }>('/api/v1/import/batch', body, 'wp-' + rid + '-' + i);
        out.clients.added += r.clients.added;
        r.clients.merged.forEach((x) => out.clients.merged.add(x));
        sum(out.appts, r.appts); sum(out.giftcards, r.giftcards); sum(out.packs, r.packs);
        out.review.push(...r.review.map((x) => ({ wp: x.wp, day: x.day, start: x.start, name: x.name || '', text: x.text, kind: x.kind })));
        setProgress({ done: i + 1, total: parts.length });
      }
      setResult(out);
      if (parsed) void check(parsed);
      toast({ title: 'WordPress est repris', sub: plural((out.appts.done || 0) + (out.appts.booked || 0) + (out.appts.cancelled || 0) + (out.appts.noShow || 0) + (out.appts.moved || 0) + (out.appts.closed || 0), 'rendez-vous') + ' · ' + plural(out.clients.added, 'nouveau client', 'nouveaux clients'), icon: 'check' });
      refreshAll();
      await reloadBoot();
    } catch (e) { toastError(e); } finally { setProgress(null); }
  };


  return (
    <div className="col wp" style={{ gap: 16 }}>
      <Card title="1 · Exporte depuis WordPress" icon="globe">
        <ol className="wp-steps">
          <li><b>Salon › Calendrier</b>, tout en bas : remplis l’encadré <b>de / à</b> une année à la fois, de 2019 à 2027, puis <b>Exporter dans un fichier CSV</b>. Un fichier par année : l’hébergement coupe les gros exports.</li>
          <li>Facultatif : <b>Outils › Exporter › Tout le contenu</b> (fichier XML). Il ajoute les absences, les notes, la durée réelle et le code des liens des anciens e-mails.</li>
          <li>Facultatif : le fichier clients de l’extension, et deux petits CSV faits à la main : les cartes cadeaux papier <code>code;solde;expire_le</code> et les abonnements en cours <code>telephone;coupes_restantes;expire_le</code>.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5 }}>Le jour de la bascule, refais l’export et dépose-le à nouveau : seuls les nouveaux rendez-vous et ce qui a changé depuis (annulés, déplacés, passés) sont repris.</p>
      </Card>

      <Card title="2 · Dépose les fichiers" icon="download" aside={files.length ? <Button size="sm" variant="ghost" icon="x" onClick={clear}>Tout retirer</Button> : undefined}>
        <label className={'wp-drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <input ref={input} type="file" multiple accept=".csv,.xml,.txt,text/csv,text/xml,application/xml" onChange={(e) => void add(e.target.files)} aria-label="Fichiers exportés de WordPress" />
          <Icon name="download" size={22} />
          <b>Glisse les fichiers ici</b>
          <span>ou <u>choisis-les</u> · CSV et XML, plusieurs à la fois</span>
        </label>
        {parsed ? (
          <ul className="list wp-files">{parsed.files.map((f, i) => (
            <li key={i} className="li">
              <span className="li-main"><b>{f.name}</b><small>{KIND[f.kind]}{f.kind !== 'unknown' ? ' · ' + plural(f.rows, 'ligne') : ''}</small></span>
              <span className={'badge ' + (f.kind === 'unknown' ? 'badge-danger' : f.rows ? 'badge-ok' : '')}>{f.kind === 'unknown' ? 'ignoré' : f.rows ? 'lu' : f.dupes ? 'déjà lu' : 'vide'}</span>
            </li>
          ))}</ul>
        ) : null}
        {parsed?.problems.length ? (
          <Note tone="warn" icon="alert">{plural(parsed.problems.length, 'souci de lecture', 'soucis de lecture')} : {parsed.problems.slice(0, 3).map((p) => p.file + (p.line ? ' l. ' + p.line : '') + ' (' + p.text + ')').join(' ; ')}{parsed.problems.length > 3 ? '…' : ''}</Note>
        ) : null}
      </Card>

      {/* once imported, the result replaces the preview; dropping files again starts a new (delta) run */}
      {parsed && pv && c && !result ? (
        <>
          <section className="col" style={{ gap: 10 }} aria-label="Aperçu">
            <div className="card-h" style={{ margin: 0 }}><h2><Icon name="eye" size={16} />3 · Ce qui va être repris</h2>{checking ? <span className="faint" style={{ fontSize: 13 }}>Vérification des fiches…</span> : null}</div>
            <div className="kpis k5 wp-kpis">
              <Kpi k="Nouveaux clients" v={c.newClients} s="fiches créées" icon="user" />
              <Kpi k="Fusionnés" v={c.merged} s="même numéro ou e-mail qu’une fiche" icon="clients" />
              <Kpi k="Visites passées" v={c.past + c.noShow} s={c.noShow ? 'dont ' + plural(c.noShow, 'absence') : 'pour le rythme de chacun'} icon="scissors" />
              <Kpi k="À venir" v={c.upcoming} s="rendez-vous dans l’agenda, sans SMS" icon="calendar" hot={c.upcoming > 0} />
              <Kpi k="Annulés" v={c.cancelled + c.toCancel} s={c.toCancel ? 'dont ' + c.toCancel + ' depuis le premier import' : 'gardés dans l’historique'} icon="x" />
            </div>
            <p className="muted wp-also">
              {[
                c.already ? plural(c.already, 'rendez-vous déjà repris', 'rendez-vous déjà repris') : '', c.toMove ? plural(c.toMove, 'déplacé', 'déplacés') + ' sur l’ancien site' : '',
                c.toClose ? plural(c.toClose, 'passé', 'passés') + ' depuis sur l’ancien site' : '', c.skipped ? plural(c.skipped, 'réservation ignorée', 'réservations ignorées') + ' (erreur ou paiement non abouti)' : '',
                c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'abonnement') : ''
              ].filter(Boolean).join(' · ') || 'Aucun rendez-vous déjà repris.'}
            </p>
            {server && !checking && !work ? <Note tone="ok" icon="check">Tout est déjà repris : ces fichiers n’apportent rien de nouveau.</Note> : null}
          </section>

          {pv.review.length ? <Review title="À regarder" rows={pv.review} /> : null}

          <Card title="4 · Fais correspondre" icon="link">
            {seen.services.length ? (
              <div className="wp-map">
                <p className="section-k">Prestations</p>
                {seen.services.map(([name, n]) => (
                  <label key={name} className="wp-row">
                    <span><b>{name}</b><small>{plural(n, 'rendez-vous')}</small></span>
                    <Icon name="arrowR" size={16} />
                    <select className="input select" value={svcMap[name] || ''} onChange={(e) => setSvcMap({ ...svcMap, [name]: e.target.value })} aria-label={'Prestation pour « ' + name + ' »'}>
                      <option value="">Ne pas reprendre ces rendez-vous</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            {seen.staff.length ? (
              <div className="wp-map">
                <p className="section-k">Barbiers</p>
                {seen.staff.map(([name, n]) => (
                  <label key={name} className="wp-row">
                    <span><b>{name || 'Sans barbier'}</b><small>{plural(n, 'rendez-vous')}</small></span>
                    <Icon name="arrowR" size={16} />
                    <select className={'input select' + (need.includes(name) ? ' wp-need' : '')} value={staffMap[name] ?? ''} onChange={(e) => setStaffMap({ ...staffMap, [name]: e.target.value })} aria-label={'Barbier pour « ' + (name || 'sans barbier') + ' »'}>
                      {!staffMap[name] ? <option value="" disabled>Choisis un barbier…</option> : null}
                      {chairs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {/* the archived profile has no lane in the agenda: history only */}
                      <option value={W.LEGACY} disabled={upcoming.has(name)}>Ancien barbier (profil archivé{upcoming.has(name) ? ', historique seul' : ''})</option>
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            {need.length ? <Note tone="warn" icon="alert">Choisis un barbier actif pour {need.map((n) => '« ' + (n || 'Sans barbier') + ' »').join(', ')} : ses rendez-vous à venir doivent avoir leur place dans l’agenda.</Note> : null}
            {!services.length ? <Note tone="warn" icon="alert">Ton catalogue est vide : ajoute d’abord tes prestations (Catalogue › Reprendre la carte de l’ancien site).</Note> : null}
            <div className="wp-go">
              <p className="muted">Aucun SMS n’est envoyé à l’import. Les rappels partiront la veille de chaque rendez-vous à venir, comme pour les autres.</p>
              <Button variant="primary" size="lg" icon="check" busy={!!progress} disabled={!work || checking || !server || need.length > 0} onClick={run}>
                {progress ? 'Import ' + progress.done + ' / ' + progress.total : label ? 'Importer ' + label : 'Rien de nouveau à importer'}
              </Button>
            </div>
            {progress ? <div className="wp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + '%' }} /></div> : null}
          </Card>
        </>
      ) : null}

      {result ? (
        <Card title="C’est repris" icon="check" aside={result.next ? <Link to={'/agenda?day=' + result.next} className="btn btn-subtle btn-sm">Voir l’agenda du {dates.dayShort(result.next)}</Link> : undefined}>
          <div className="kv"><span>Nouveaux clients</span><b>{result.clients.added}</b></div>
          <div className="kv"><span>Fiches existantes retrouvées</span><b>{result.clients.merged.size}</b></div>
          <div className="kv"><span>Visites passées</span><b>{(result.appts.done || 0) + (result.appts.noShow || 0)}</b></div>
          <div className="kv"><span>Rendez-vous à venir</span><b>{result.appts.booked || 0}</b></div>
          <div className="kv"><span>Annulés</span><b>{result.appts.cancelled || 0}</b></div>
          {result.appts.moved ? <div className="kv"><span>Déplacés sur l’ancien site</span><b>{result.appts.moved}</b></div> : null}
          {result.appts.closed ? <div className="kv"><span>Passés depuis sur l’ancien site</span><b>{result.appts.closed}</b></div> : null}
          {result.appts.updated ? <div className="kv"><span>Rendez-vous complétés</span><b>{result.appts.updated}</b></div> : null}
          {result.appts.already ? <div className="kv"><span>Déjà repris</span><b>{result.appts.already}</b></div> : null}
          {result.giftcards.added || result.giftcards.already ? <div className="kv"><span>Cartes cadeaux</span><b>{result.giftcards.added}{result.giftcards.already ? ' (+' + result.giftcards.already + ' déjà là)' : ''}</b></div> : null}
          {result.packs.added || result.packs.already ? <div className="kv"><span>Abonnements</span><b>{result.packs.added}{result.packs.already ? ' (+' + result.packs.already + ' déjà là)' : ''}</b></div> : null}
          {result.review.length ? <Review title="À regarder après l’import" rows={result.review} flat /> : <Note tone="ok" icon="check">Rien à regarder : tout est en place.</Note>}
        </Card>
      ) : null}
    </div>
  );
}

function Review({ title, rows, flat }: { title: string; rows: W.ReviewRow[]; flat?: boolean }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, 8);
  const body = (
    <>
      <ul className="list wp-review">{list.map((r, i) => (
        <li key={i} className="li">
          <span className="li-main"><b>{r.name || 'Ligne'}{r.wp ? <span className="faint"> · n° {r.wp}</span> : null}</b><small>{[when(r), r.text].filter(Boolean).join(' · ')}</small></span>
        </li>
      ))}</ul>
      {rows.length > list.length ? <Button variant="ghost" block onClick={() => setAll(true)}>Voir les {rows.length} lignes</Button> : null}
    </>
  );
  if (flat) return <div className="col" style={{ gap: 6, marginTop: 8 }}><p className="section-k">{title} · {rows.length}</p>{body}</div>;
  return <Card title={title + ' · ' + rows.length} icon="alert">{body}</Card>;
}
