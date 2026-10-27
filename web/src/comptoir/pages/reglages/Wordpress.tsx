// Reprendre WordPress: the old salon's clients, past visits, upcoming bookings, paper gift cards and subscriptions,
// in four steps. Files are read here (lib/wpimport.ts); the owner sees what will happen before anything is sent; the
// server decides again row by row (server/commands/import.js), and running the same files twice adds nothing.
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { api, uuid } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { cap, dates, plural, time } from '../../../lib/format';
import * as W from '../../../lib/wpimport';
import { Icon } from '../../../ui/Icon';
import { Button, Kpi, Note, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { Card } from './shared';
import { Report } from './wordpress/Report';
import './wordpress.css';

type Known = { known: Set<number>; again: Set<number>; erased: Map<number, number>; imported: Map<number, W.Prior>; inWindow: W.InWindow[]; busy: W.Busy[] };
type Dropped = { name: string; text: string; key: string; modified: number };

const KIND: Record<W.FileKind, string> = { bookings: 'Réservations (CSV)', wxr: 'Réservations (XML)', customers: 'Clients', giftcards: 'Cartes cadeaux', packs: 'Carnets', unknown: 'Format non reconnu' };

/** WordPress writes UTF-8; a CSV saved from French Excel is often Windows-1252. */
async function readText(f: File) {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
const when = (r: { day?: string; start?: number }) => (r.day ? cap(dates.dayShort(r.day)) + ' ' + r.day.slice(0, 4) + (r.start != null ? ' · ' + time(r.start) : '') : '');

export default function Wordpress() {
  const { boot, now, reloadBoot } = useApp();
  const cutoffWords = useMemo(() => { const d = dates.dayParts(W.cutoff(boot.today)); return d.d + (d.d === 1 ? 'er ' : ' ') + dates.MONTHS_FR[d.m - 1] + ' ' + d.y; }, [boot.today]);
  const [files, setFiles] = useState<Dropped[]>([]);
  const [server, setServer] = useState<Known | null>(null);
  const [checking, setChecking] = useState(false);
  const [svcMap, setSvcMap] = useState<Record<string, string>>({});
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // a run just finished: its report replaces the preview until files are dropped again (an interrupted one keeps both: the
  // report says where it stopped, the preview still has the button to go on)
  const [done, setDone] = useState<{ id: string; next?: string; failed?: boolean } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // the record of the runs lives on the server: the report is there after a reload too
  const runs = useQuery<{ runs: Parameters<typeof Report>[0]['runs'] }>('/api/v1/import/runs');

  const services = boot.services.filter((s) => s.active && !s.pack);
  const chairs = boot.staff.filter((s) => s.active && s.chair);
  const chairIds = useMemo(() => new Set(chairs.map((s) => s.id)), [boot.staff]);
  const svcDur = useMemo(() => Object.fromEntries(boot.services.map((s) => [s.id, { dur: s.dur, buffer: s.buffer }])), [boot.services]);
  const parsed = useMemo(() => (files.length ? W.readFiles(files) : null), [files]);
  const seen = useMemo(() => (parsed ? W.names(parsed) : { services: [], staff: [] }), [parsed]);
  const map: W.Mapping = useMemo(() => ({ services: svcMap, staff: staffMap }), [svcMap, staffMap]);
  const pv = useMemo(() => (parsed ? W.preview(parsed, map, now(), { ...(server || {}), chairs: chairIds, today: boot.today, svcDur }) : null), [parsed, map, server, chairIds]);
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
      next.push({ name: f.name, text: await readText(f), key, modified: f.lastModified });
    }
    const p = W.readFiles(next);
    const n = W.names(p);
    const ahead = W.upcomingNames(p, now());
    // matched once, then the owner's choices are kept as more files arrive. A name left unmatched goes to the archived
    // profile only when it is history alone; with upcoming bookings the owner picks a chair
    setSvcMap((m) => Object.fromEntries(n.services.map(([name]) => [name, m[name] ?? W.bestMatch(name, services, (x) => [x.name, x.short, x.slug || ''])])));
    setStaffMap((m) => Object.fromEntries(n.staff.map(([name]) => [name, m[name] ?? (W.bestMatch(name, chairs, (x) => [x.name]) || (ahead.has(name) ? '' : W.LEGACY))])));
    setFiles(next);
    setDone(null);
    await check(p);
  };
  // which people already have a file, which bookings an earlier run brought in, which are still to come inside the
  // periods the files cover, what the agenda holds on the days to come: asked to the server, nothing written
  const check = async (p: W.Parsed) => {
    setChecking(true);
    try {
      const ids = W.preview(p, { services: {}, staff: {} }, now()).identities;
      const keys = ids.flatMap((list, g) => list.map((k) => ({ ...k, g })));
      const known = new Set<number>(), again = new Set<number>(), erased = new Map<number, number>(), imported = new Map<number, W.Prior>();
      for (const part of W.chunks(keys, 400, 40000)) {
        const r = await api.post<{ known: number[]; again?: number[]; erased?: { i: number; at: number }[] }>('/api/v1/import/preview', { keys: part.map(({ g, ...k }) => k) });
        for (const i of r.known) known.add(part[i].g);
        for (const i of r.again || []) again.add(part[i].g);
        for (const x of r.erased || []) erased.set(part[x.i].g, Math.max(x.at, erased.get(part[x.i].g) || 0));
      }
      for (const part of W.chunks(p.bookings.map((b) => b.wp), 4000, 40000)) {
        const r = await api.post<{ appts?: W.Prior[] }>('/api/v1/import/preview', { wp: part });
        for (const a of r.appts || []) imported.set(a.wp, a);
      }
      // the periods are asked 12 at a time: a booking in two overlapping periods comes back twice
      const inWin = new Map<number, W.InWindow>();
      for (let i = 0; i < p.windows.length; i += 12) for (const x of (await api.post<{ inWindow?: W.InWindow[] }>('/api/v1/import/preview', { window: p.windows.slice(i, i + 12) })).inWindow || []) inWin.set(x.wp, x);
      const inWindow = [...inWin.values()];
      const days = [...new Set(p.bookings.filter((b) => b.day >= boot.today).map((b) => b.day))];
      const busy: W.Busy[] = [];
      for (let i = 0; i < days.length; i += 120) busy.push(...((await api.post<{ busy?: W.Busy[] }>('/api/v1/import/preview', { busy: days.slice(i, i + 120) })).busy || []));
      setServer({ known, again, erased, imported, inWindow, busy });
      // a barber left unmatched whose bookings an earlier run put on a chair: that chair again
      const prior = W.priorStaff(p, imported);
      setStaffMap((m) => Object.fromEntries(Object.entries(m).map(([name, v]) => [name, !v && prior[name] && chairIds.has(prior[name]) ? prior[name] : v])));
    } catch (e) { toastError(e); setServer(null); } finally { setChecking(false); }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); };
  const clear = () => { setFiles([]); setServer(null); setDone(null); setSvcMap({}); setStaffMap({}); if (input.current) input.current.value = ''; };

  const rows = useMemo(() => (parsed ? W.toRows(parsed, map, server?.imported, { today: boot.today, known: server?.known, again: server?.again, erased: server?.erased, gone: pv?.gone }) : null), [parsed, map, server, pv]);
  const c = pv?.counts;
  // what this run brings: new bookings, what changed on the old site since an earlier run, cards, carnets
  const nAppts = c ? c.past + c.noShow + c.upcoming + c.cancelled : 0;
  const nChanges = c && pv ? c.toCancel + c.toMove + c.toClose + pv.goneOpen : 0;
  const work = c ? nAppts + nChanges + c.giftcards + c.packs + c.newClients + c.merged : 0;
  // nothing new, but the files still say that the final sync happened: it can be recorded as a run of « déjà là »
  const sendable = !!rows && rows.appts.length + rows.clients.length + rows.giftcards.length + rows.packs.length + rows.gone.length > 0;
  const label = c && pv ? [nAppts ? plural(nAppts, 'rendez-vous') : '', nChanges ? plural(nChanges, 'changement') : '', c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'carnet') : ''].filter(Boolean).join(', ') || (c.newClients + c.merged ? plural(c.newClients + c.merged, 'fiche client', 'fiches clients') : '') : '';

  const run = async () => {
    if (!rows || !parsed || !pv) return;
    // clients first, then the bookings, then what hangs on a client file (carnets), then the bookings deleted on the old site
    const parts = [
      ...W.chunks(rows.clients).map((x) => ({ clients: x })), ...W.chunks(rows.appts).map((x) => ({ appts: x })),
      ...W.chunks(rows.giftcards).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs).map((x) => ({ packs: x })), ...W.chunks(rows.gone, 150).map((x) => ({ gone: x }))
    ];
    // the agenda link opens a booking of this run
    const first = parsed.bookings.find((b) => b.day >= boot.today && !server?.imported.has(b.wp) && W.outcome(b, now()) === 'booked' && b.services.every((n) => svcMap[n]) && chairIds.has(staffMap[b.staff] || ''));
    const rid = uuid().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    setProgress({ done: 0, total: parts.length });
    let opened = '';
    try {
      // the run is opened with what the files held, so its report can say that the numbers add up
      const shas = await Promise.all(files.map((f) => W.sha16(f.text)));
      const { id } = await api.post<{ id: string }>('/api/v1/import/runs', W.runBody(parsed, pv, map, shas, parts.length), 'wp-' + rid + '-start');
      opened = id;
      let made = 0, clientsAdded = 0;
      const changed = { moved: 0, closed: 0, gone: 0 };
      for (const [i, body] of parts.entries()) {
        // one id per request; clicking again after a failure starts a new run, which adds nothing twice (ext.wp, phone, code)
        const r = await api.post<{ clients: { added: number }; appts: Record<string, number> }>('/api/v1/import/batch', { ...body, run: id, i }, 'wp-' + rid + '-' + i);
        clientsAdded += r.clients.added;
        made += (r.appts.done || 0) + (r.appts.booked || 0) + (r.appts.cancelled || 0) + (r.appts.noShow || 0);
        for (const k of ['moved', 'closed', 'gone'] as const) changed[k] += r.appts[k] || 0;
        setProgress({ done: i + 1, total: parts.length });
      }
      await api.post('/api/v1/import/runs/' + id + '/finish', {}, 'wp-' + rid + '-end');
      setDone({ id, next: first?.day });
      setPicked(id);
      void check(parsed);
      // what the old site changed since counts too: a final sync that moved or removed bookings made nothing new, and says so
      const bits = [made || !(changed.moved + changed.closed + changed.gone) ? plural(made, 'rendez-vous') : '', clientsAdded ? plural(clientsAdded, 'nouveau client', 'nouveaux clients') : '', changed.gone ? plural(changed.gone, 'supprimé', 'supprimés') : '', changed.moved ? plural(changed.moved, 'déplacé', 'déplacés') : '', changed.closed ? plural(changed.closed, 'passé', 'passés') : ''].filter(Boolean);
      toast({ title: 'WordPress est repris', sub: bits.join(' · '), icon: 'check' });
      refreshAll();
      await reloadBoot();
    } catch (e) {
      toastError(e);
      // an interrupted run is on the server too: its report, with the way to go on, replaces the preview at once
      if (opened) { setDone({ id: opened, failed: true }); setPicked(opened); }
      refreshAll();
    } finally { setProgress(null); }
  };

  const reports = runs.data?.runs || [];
  const showReport = (reports.length > 0 || !!done) && (!pv || !!done);

  return (
    <div className="col wp" style={{ gap: 16 }}>
      <Card title="1 · Exporte depuis WordPress" icon="globe">
        <ol className="wp-steps">
          <li><b>Salon › Calendrier</b>, tout en bas : remplis l’encadré <b>de / à</b> une année à la fois, puis <b>Exporter dans un fichier CSV</b>. Un fichier par année : l’hébergement coupe les gros exports. Exporte depuis le <b>{cutoffWords}</b>. Plus ancien ne sert à rien : la loi demande d’effacer les clients sans visite depuis 3 ans.</li>
          <li>Facultatif : <b>Outils › Exporter › Tout le contenu</b> (fichier XML). Il ajoute les absences, les notes, la durée réelle et le code des liens des anciens e-mails.</li>
          <li>Facultatif : le fichier clients de l’extension, et deux petits CSV faits à la main : les cartes cadeaux papier <code>code;solde;expire_le</code> et les carnets en cours <code>telephone;coupes_restantes;expire_le</code>.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5 }}>Le jour de la bascule, refais l’export sur la même période et dépose-le à nouveau : seuls les nouveaux rendez-vous et ce qui a changé depuis (annulés, déplacés, passés, supprimés) sont repris. Un rendez-vous encore à venir qui n’est plus dans l’export est annulé ici, sans SMS.</p>
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

      {/* once imported, the report replaces the preview; dropping files again starts a new (delta) run */}
      {parsed && pv && c && !(done && !done.failed) ? (
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
                pv.gone.length ? plural(pv.gone.length, 'supprimé', 'supprimés') + ' sur l’ancien site (annulés ici, sans SMS)' : '',
                pv.excluded.retention ? plural(pv.excluded.retention, 'personne', 'personnes') + ' sans visite depuis 3 ans : pas reprise' + (pv.excluded.retention > 1 ? 's' : '') + ' (règle de conservation)' : '',
                pv.excluded.noVisit ? plural(pv.excluded.noVisit, 'client sans rendez-vous', 'clients sans rendez-vous') + ' : pas repris (règle de conservation)' : '',
                c.toClose ? plural(c.toClose, 'passé', 'passés') + ' depuis sur l’ancien site' : '', c.skipped ? plural(c.skipped, 'réservation ignorée', 'réservations ignorées') + ' (erreur ou paiement non abouti)' : '',
                c.erased ? plural(c.erased, 'ligne ignorée', 'lignes ignorées') + ' (client effacé)' : '',
                c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'carnet') : ''
              ].filter(Boolean).join(' · ') || 'Aucun rendez-vous déjà repris.'}
            </p>
            {pv.warning ? <Note tone="warn" icon="alert">{pv.warning}</Note> : null}
            {server && !checking && !work ? <Note tone="ok" icon="check">Tout est déjà repris : ces fichiers n’apportent rien de nouveau.{sendable ? ' Tu peux enregistrer la vérification : le rapport gardera la trace de cette synchro.' : ''}</Note> : null}
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
              <Button variant="primary" size="lg" icon="check" busy={!!progress} disabled={(!work && !sendable) || checking || !server || need.length > 0} onClick={run}>
                {progress ? 'Import ' + progress.done + ' / ' + progress.total : label ? 'Importer ' + label : sendable ? 'Enregistrer la vérification (rien de nouveau)' : 'Rien de nouveau à importer'}
              </Button>
            </div>
            {progress ? <div className="wp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + '%' }} /></div> : null}
          </Card>
        </>
      ) : null}

      {showReport ? <Report runs={reports} runId={picked || done?.id || null} onPick={setPicked} next={done && !done.failed && (picked || done.id) === done.id ? done.next : undefined} /> : null}
    </div>
  );
}

function Review({ title, rows }: { title: string; rows: W.ReviewRow[] }) {
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
  return <Card title={title + ' · ' + rows.length} icon="alert">{body}</Card>;
}
