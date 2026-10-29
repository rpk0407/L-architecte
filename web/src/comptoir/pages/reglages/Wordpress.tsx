// Reprendre WordPress: the old salon's clients, past visits, upcoming bookings, paper gift cards and subscriptions,
// in four steps. Files are read here (lib/wpimport.ts); the owner sees what will happen before anything is sent; the
// server decides again row by row (server/commands/import.js), and running the same files twice adds nothing.
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { api, ApiError, uuid, withRetry } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { Link } from '../../../lib/router';
import { cap, dates, plural, time } from '../../../lib/format';
import * as W from '../../../lib/wpimport';
import { Icon } from '../../../ui/Icon';
import { Button, Kpi, Note, toast } from '../../../ui/kit';
import { useApp } from '../../state';
import { Card } from './shared';
import { Report } from './wordpress/Report';
import { Bascule } from './wordpress/Bascule';
import { FileList, Issues, Sample, Templates } from './wordpress/Files';
import './wordpress.css';

type Known = { known: Set<number>; again: Set<number>; erased: Map<number, number>; imported: Map<number, W.Prior>; inWindow: W.InWindow[]; busy: W.Busy[]; haveCards: Set<number>; haveCarnets: Set<number> };
type Dropped = { name: string; text: string; key: string; modified: number };
type Halt = { transient: boolean; words?: string };
type Done = { id: string; next?: string; failed?: boolean; halt?: Halt };

const MB = 1024 * 1024;
const when = (r: { day?: string; start?: number }) => (r.day ? cap(dates.dayShort(r.day)) + ' ' + r.day.slice(0, 4) + (r.start != null ? ' · ' + time(r.start) : '') : '');
/** A refusal the owner can act on (a file too heavy), as opposed to a failure of the reading. */
class Refused extends Error {}

/** What a dropped file becomes: its text. An XML is read as a stream (only bookings, services and barbers are kept); anything else in memory, with the right encoding. */
async function load(f: File): Promise<string> {
  const head = new TextDecoder().decode(await f.slice(0, 65536).arrayBuffer());
  if (W.isWxrHead(head)) {
    if (f.size > 150 * MB) throw new Refused('« ' + f.name + ' » fait plus de 150 Mo. Dans Outils › Exporter, choisis seulement « Réservations » (puis « Prestations » et « Assistants ») au lieu de « Tout le contenu » : sans ce fichier, tout le reste est repris, il manque seulement les absences, les notes et les liens des anciens e-mails.');
    return (await W.shrinkWxr(f)).text;
  }
  if (f.size > 20 * MB) throw new Refused('« ' + f.name + ' » est trop lourd (20 Mo au plus). Refais l’export une année à la fois : le champ « de / à » de Salon › Calendrier découpe le fichier.');
  return W.decodeBytes(await f.arrayBuffer());
}

export default function Wordpress() {
  const { boot, now, reloadBoot } = useApp();
  const cutoffWords = useMemo(() => { const d = dates.dayParts(W.cutoff(boot.today)); return d.d + (d.d === 1 ? 'er ' : ' ') + dates.MONTHS_FR[d.m - 1] + ' ' + d.y; }, [boot.today]);
  const [files, setFiles] = useState<Dropped[]>([]);
  const [reading, setReading] = useState<string[]>([]);
  const [server, setServer] = useState<Known | null>(null);
  const [checking, setChecking] = useState(false);
  // the check failed (no network…): said, with a way to try again, and tried again by itself when the network is back
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [svcMap, setSvcMap] = useState<Record<string, string>>({});
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  // the names whose default is a guess from a near spelling: said, so the owner looks
  const [guessed, setGuessed] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [waiting, setWaiting] = useState(false);
  // a run just finished: its report replaces the preview until files are dropped again (an interrupted one keeps both: the
  // report says where it stopped, the preview still has the button to go on)
  const [done, setDone] = useState<Done | null>(null);
  const [restarted, setRestarted] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // the latest files and run, for drops that follow each other before the page has drawn
  const filesRef = useRef<Dropped[]>([]);
  const doneRef = useRef<Done | null>(null);
  // the record of the runs lives on the server: the report is there after a reload too
  const runs = useQuery<{ runs: Parameters<typeof Report>[0]['runs'] }>('/api/v1/import/runs');

  const services = boot.services.filter((s) => s.active && !s.pack);
  const chairs = boot.staff.filter((s) => s.active && s.chair);
  const chairIds = useMemo(() => new Set(chairs.map((s) => s.id)), [boot.staff]);
  const svcDur = useMemo(() => Object.fromEntries(boot.services.map((s) => [s.id, { dur: s.dur, buffer: s.buffer }])), [boot.services]);
  const parsed = useMemo(() => (files.length ? W.readFiles(files, boot.today) : null), [files, boot.today]);
  const parsedRef = useRef<W.Parsed | null>(null);
  parsedRef.current = parsed;
  const seen = useMemo(() => (parsed ? W.names(parsed) : { services: [], staff: [] }), [parsed]);
  const map: W.Mapping = useMemo(() => ({ services: svcMap, staff: staffMap }), [svcMap, staffMap]);
  const pv = useMemo(() => (parsed ? W.preview(parsed, map, now(), { ...(server || {}), chairs: chairIds, today: boot.today, svcDur }) : null), [parsed, map, server, chairIds]);
  // barbers with upcoming bookings to bring in: the archived profile has no lane in the agenda, so a chair is required
  const upcoming = useMemo(() => (parsed ? W.upcomingNames(parsed, now(), { imported: server?.imported }) : new Set<string>()), [parsed, server]);
  const need = useMemo(() => (parsed ? [...W.upcomingNames(parsed, now(), { imported: server?.imported, map })].filter((n) => !chairIds.has(staffMap[n] || '')) : []), [parsed, server, map, chairIds]);

  const putFiles = (next: Dropped[]) => { filesRef.current = next; setFiles(next); };
  const putDone = (d: Done | null) => { doneRef.current = d; setDone(d); };

  /** The files are these: read them, match the names once (the owner's choices are kept), ask the server what it knows. */
  const settle = async (next: Dropped[]) => {
    putFiles(next);
    putDone(null);
    if (!next.length) { setServer(null); setCheckErr(null); setSvcMap({}); setStaffMap({}); setGuessed({}); return; }
    const p = W.readFiles(next, boot.today);
    // matched once, then the owner's choices are kept as more files arrive. A name left unmatched goes to the archived
    // profile (a barber) or the archived « Ancienne prestation » (a service) only when it is history alone; with upcoming
    // bookings the owner picks. A near spelling (« J Kut ») is proposed, and said.
    const near: Record<string, boolean> = {};
    setSvcMap((m) => { const r = W.suggestServices(p, services, now(), m); for (const g of r.guessed) near['v:' + g] = true; return r.map; });
    setStaffMap((m) => { const r = W.suggestStaff(p, chairs, now(), m); for (const g of r.guessed) near['s:' + g] = true; return r.map; });
    setGuessed((g) => ({ ...g, ...near }));
    await check(p);
  };

  const add = async (list: FileList | File[] | null) => {
    const dropped = list ? [...list] : [];
    if (!dropped.length) return;
    const got: Dropped[] = [];
    setReading((r) => [...r, ...dropped.map((f) => f.name)]);
    for (const f of dropped) {
      try {
        // two exports of the same name from different folders are two files; the same file dropped again is one
        // (after a finished run the list starts again: the same export dropped for the final sync is not « already there »)
        const key = f.name + '|' + f.size + '|' + f.lastModified;
        const d0 = doneRef.current;
        if ((!(d0 && !d0.failed) && filesRef.current.some((x) => x.key === key)) || got.some((x) => x.key === key)) continue;
        got.push({ name: f.name, text: await load(f), key, modified: f.lastModified });
      } catch (e) {
        toast({ kind: 'err', title: e instanceof Refused ? e.message : '« ' + f.name + ' » n’a pas pu être lu (dossier ou fichier déplacé ?).', icon: 'alert', ttl: e instanceof Refused ? 12000 : undefined });
      }
    }
    setReading((r) => { const left = [...r]; for (const f of dropped) { const i = left.indexOf(f.name); if (i >= 0) left.splice(i, 1); } return left; });
    if (!got.length) return;
    // a run that is over: the next drop is a new pass (the final sync), from an empty list. An interrupted one keeps its files, to be resumed.
    const d = doneRef.current;
    const fresh = !!d && !d.failed;
    const had = filesRef.current.length > 0;
    setRestarted(fresh && had);
    await settle([...(fresh ? [] : filesRef.current), ...got]);
  };
  const removeAt = async (i: number) => {
    const next = filesRef.current.filter((_, j) => j !== i);
    if (input.current) input.current.value = '';
    await settle(next);
  };

  // which people already have a file, which bookings an earlier run brought in, which are still to come inside the
  // periods the files cover, what the agenda holds on the days to come: asked to the server, nothing written
  const check = async (p: W.Parsed) => {
    setChecking(true);
    setCheckErr(null);
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
      // the cards and carnets of the files that the salon already has
      const haveCards = new Set<number>(), haveCarnets = new Set<number>();
      for (let i = 0; i < p.giftcards.length; i += 500) for (const j of (await api.post<{ haveCards?: number[] }>('/api/v1/import/preview', { gift: p.giftcards.slice(i, i + 500).map((g) => g.code.slice(0, 40)) })).haveCards || []) haveCards.add(i + j);
      for (let i = 0; i < p.packs.length; i += 500) for (const j of (await api.post<{ haveCarnets?: number[] }>('/api/v1/import/preview', { packs: p.packs.slice(i, i + 500).map((k) => ({ phone: k.phone.slice(0, 32) })) })).haveCarnets || []) haveCarnets.add(i + j);
      setServer({ known, again, erased, imported, inWindow, busy, haveCards, haveCarnets });
      // a barber left unmatched whose bookings an earlier run put on a chair: that chair again
      const prior = W.priorStaff(p, imported);
      setStaffMap((m) => Object.fromEntries(Object.entries(m).map(([name, v]) => [name, !v && prior[name] && chairIds.has(prior[name]) ? prior[name] : v])));
    } catch (e) {
      setServer(null);
      setCheckErr(e instanceof ApiError && e.status === 0 ? 'Pas de connexion : les fiches n’ont pas pu être vérifiées. Vérifie le Wi-Fi puis réessaie.' : (e as Error)?.message || 'Les fiches n’ont pas pu être vérifiées.');
    } finally { setChecking(false); }
  };
  const retryCheck = () => { if (parsedRef.current) void check(parsedRef.current); };
  // the network is back: the check goes again by itself
  const failed = !!checkErr;
  useEffect(() => {
    if (!failed) return;
    const on = () => retryCheck();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [failed]);

  // a file dropped a few pixels off the box must not open in the tab: the whole page takes drops while it is on screen
  useEffect(() => {
    let depth = 0;
    const files = (e: globalThis.DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: globalThis.DragEvent) => { if (files(e)) { depth++; setOver(true); } };
    const overFn = (e: globalThis.DragEvent) => { if (files(e)) e.preventDefault(); };
    const leave = (e: globalThis.DragEvent) => { if (files(e) && --depth <= 0) { depth = 0; setOver(false); } };
    const dropFn = (e: globalThis.DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      depth = 0; setOver(false);
      // inside the box the label's own handler has the files
      if (!(e.target as Element | null)?.closest?.('.wp-drop')) void add(e.dataTransfer!.files);
    };
    document.addEventListener('dragenter', enter); document.addEventListener('dragover', overFn); document.addEventListener('dragleave', leave); document.addEventListener('drop', dropFn);
    return () => { document.removeEventListener('dragenter', enter); document.removeEventListener('dragover', overFn); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', dropFn); };
  }, [boot.today]);

  const drop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); void add(e.dataTransfer.files); };
  const clear = () => { void settle([]); setRestarted(false); if (input.current) input.current.value = ''; };

  const rows = useMemo(() => (parsed ? W.toRows(parsed, map, server?.imported, { today: boot.today, known: server?.known, again: server?.again, erased: server?.erased, gone: pv?.gone, now: now(), chairs: chairIds }) : null), [parsed, map, server, pv]);
  const c = pv?.counts;
  // what this run brings: new bookings, what changed on the old site since an earlier run, cards, carnets
  const nAppts = c ? c.past + c.noShow + c.upcoming + c.cancelled : 0;
  const nChanges = c && pv ? c.toCancel + c.toMove + c.toClose + c.toReopen + pv.goneOpen : 0;
  const work = c ? nAppts + nChanges + c.giftcards + c.packs + c.newClients + c.merged : 0;
  // nothing new, but the files still say that the final sync happened: it can be recorded as a run of « déjà là »
  const sendable = !!rows && rows.appts.length + rows.clients.length + rows.giftcards.length + rows.packs.length + rows.gone.length > 0;
  const label = c && pv ? [nAppts ? plural(nAppts, 'rendez-vous') : '', nChanges ? plural(nChanges, 'changement') : '', c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'carnet') : ''].filter(Boolean).join(', ') || (c.newClients + c.merged ? plural(c.newClients + c.merged, 'fiche client', 'fiches clients') : '') : '';
  // a salon with no catalogue would record a run that makes nothing, and Jour J would take it for the first pass
  const noCatalogue = services.length === 0;
  const noChair = chairs.length === 0;
  // the files held something to read: otherwise « nothing new » would be a lie told over a red badge
  const understood = !!parsed && parsed.files.some((f) => f.rows > 0 || (f.dupes || 0) > 0) && !parsed.files.some((f) => f.kind === 'unknown' || (f.why && !f.rows && !f.dupes));

  const run = async () => {
    if (!rows || !parsed || !pv) return;
    // clients first, then the bookings, then what hangs on a client file (carnets), then the bookings deleted on the old site
    const parts = [
      ...W.chunks(rows.clients).map((x) => ({ clients: x })), ...W.chunks(rows.appts).map((x) => ({ appts: x })),
      ...W.chunks(rows.giftcards).map((x) => ({ giftcards: x })), ...W.chunks(rows.packs).map((x) => ({ packs: x })), ...W.chunks(rows.gone, 150).map((x) => ({ gone: x }))
    ];
    // the agenda link opens a booking of this run
    const first = parsed.bookings.find((b) => b.day >= boot.today && !server?.imported.has(b.wp) && W.outcome(b, now()) === 'booked' && b.services.every((n) => svcMap[n] && svcMap[n] !== W.LEGACY) && chairIds.has(staffMap[b.staff] || ''));
    const rid = uuid().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    setProgress({ done: 0, total: parts.length });
    setWaiting(false);
    let opened = '';
    let sending: Record<string, any> = {};
    // a request that fails for lack of network is sent again with the same request id: the server answers the first one if it came in
    const post = <T,>(path: string, body: Record<string, any>, id: string) => { sending = body; return withRetry(() => api.post<T>(path, body, id), { onWait: () => setWaiting(true) }).then((r) => { setWaiting(false); return r; }); };
    try {
      // the run is opened with what the files held, so its report can say that the numbers add up
      const shas = await Promise.all(files.map((f) => W.sha16(f.text)));
      const { id } = await post<{ id: string }>('/api/v1/import/runs', W.runBody(parsed, pv, map, shas, parts.length), 'wp-' + rid + '-start');
      opened = id;
      let made = 0, clientsAdded = 0;
      const changed = { moved: 0, closed: 0, gone: 0, cancelledNow: 0, reopened: 0 };
      for (const [i, body] of parts.entries()) {
        // one id per request; clicking again after a failure starts a new run, which adds nothing twice (ext.wp, phone, code)
        const r = await post<{ clients: { added: number }; appts: Record<string, number> }>('/api/v1/import/batch', { ...body, run: id, i }, 'wp-' + rid + '-' + i);
        clientsAdded += r.clients.added;
        // what the old site cancelled since an earlier run is counted apart from the bookings it brings in
        made += (r.appts.done || 0) + (r.appts.booked || 0) + (r.appts.cancelled || 0) - (r.appts.cancelledNow || 0) + (r.appts.noShow || 0);
        for (const k of ['moved', 'closed', 'gone', 'cancelledNow', 'reopened'] as const) changed[k] += r.appts[k] || 0;
        setProgress({ done: i + 1, total: parts.length });
      }
      await post('/api/v1/import/runs/' + id + '/finish', {}, 'wp-' + rid + '-end');
      putDone({ id, next: first?.day });
      setPicked(id);
      void check(parsed);
      const bits = [made ? plural(made, 'rendez-vous') : '', clientsAdded ? plural(clientsAdded, 'nouveau client', 'nouveaux clients') : '', changed.cancelledNow ? plural(changed.cancelledNow, 'annulé', 'annulés') : '', changed.gone ? plural(changed.gone, 'supprimé', 'supprimés') : '', changed.moved ? plural(changed.moved, 'déplacé', 'déplacés') : '', changed.closed ? plural(changed.closed, 'passé', 'passés') : '', changed.reopened ? plural(changed.reopened, 'rétabli', 'rétablis') : ''].filter(Boolean);
      toast({ title: bits.length ? 'WordPress est repris' : 'Rien de nouveau', sub: bits.length ? bits.join(' · ') : 'Les fichiers n’ont rien apporté de plus : la vérification est enregistrée.', icon: 'check' });
      refreshAll();
      await reloadBoot();
    } catch (e) {
      // a refusal of the server names the row (never the raw path); a lost connection or a server error can be resumed
      const err = e instanceof ApiError ? e : null;
      const transient = !err || err.status === 0 || err.status >= 500;
      const words = err && err.code === 'invalid' ? W.refusalWords(err.message, sending) : null;
      const sentence = words || (err && err.code === 'network' ? err.message : err?.message) || 'L’import s’est arrêté.';
      toast({ kind: 'err', title: sentence, sub: transient ? 'Reprends l’import : rien ne sera compté deux fois.' : 'Cette ligne ne passe pas : envoie le rapport à ton prestataire.', icon: 'alert', ttl: 9000 });
      // an interrupted run is on the server too: its report, with the way to go on, replaces the preview at once
      if (opened) { putDone({ id: opened, failed: true, halt: { transient, words: words || undefined } }); setPicked(opened); }
      refreshAll();
    } finally { setProgress(null); setWaiting(false); }
  };

  const reports = runs.data?.runs || [];
  const showReport = (reports.length > 0 || !!done) && (!pv || !!done);
  const demo = boot.mode === 'demo';
  const names = seen.staff.map(([n]) => n).filter(Boolean);
  // the green note only when something was read, and read well
  const nothingNew = !!server && !checking && !checkErr && !work && understood;

  return (
    <div className="col wp" style={{ gap: 16 }}>
      {demo ? <Note tone="err" icon="alert">Démo publique : n’y dépose jamais de vrais fichiers de clients, des fichiers d’essai seulement. Le compte de la démo est public et les clients importés n’y sont jamais effacés.</Note> : null}
      {reports.length > 0 ? <Bascule /> : null}
      {noCatalogue ? <Note tone="warn" icon="alert">Ton catalogue est vide : ouvre <Link to="/catalogue">Catalogue</Link> › « Reprendre la carte de l’ancien site », puis reviens ici. Sans prestations, aucun rendez-vous ne peut être repris.</Note> : null}
      {noChair && !noCatalogue ? <Note tone="warn" icon="alert">Tu n’as encore aucun barbier : crée-les dans <Link to="/equipe">Équipe</Link> (un par chaise){names.length ? ', d’après les noms de l’ancien site : ' + names.slice(0, 8).join(', ') + (names.length > 8 ? '…' : '') : ''}. Les rendez-vous à venir en ont besoin.</Note> : null}
      <Card title="1 · Exporte depuis WordPress" guide="wp-export" icon="globe">
        <ol className="wp-steps">
          <li><b>Salon › Calendrier</b>, tout en bas : remplis l’encadré <b>de / à</b> une année à la fois, puis <b>Exporter dans un fichier CSV</b>. Un fichier par année : l’hébergement coupe les gros exports. Exporte depuis le <b>{cutoffWords}</b>. Plus ancien ne sert à rien : la loi demande d’effacer les clients sans visite depuis 3 ans. <b>Mets une date de fin dans un an</b> : le champ « à » propose aujourd’hui, change-le, sinon les rendez-vous à venir ne sont pas dans le fichier. Les fichiers s’appellent tous <code>export.csv</code> : ne les renomme pas, dépose-les ensemble.</li>
          <li>Recommandé : <b>Outils › Exporter › Tout le contenu</b> (fichier XML). Il ajoute les absences, les notes, la durée réelle, l’indicatif pays des numéros et le code des liens des anciens e-mails. Sans lui, un numéro étranger est lu comme français.</li>
          <li>Quelques cartes cadeaux papier ou carnets ? Ajoute-les une par une (Catalogue › Cartes cadeaux › Reprendre une carte existante ; fiche du client › ⋯ › Reprendre un carnet en cours). Beaucoup ? Remplis un modèle à déposer ici : <code>code;solde;expire_le</code> pour les cartes, <code>telephone;coupes_restantes;expire_le</code> pour les carnets. <Templates /> Les notes des clients et de l’équipe sont reprises et visibles de toute l’équipe : relis-les.</li>
        </ol>
        <p className="faint" style={{ fontSize: 12.5 }}>Le jour de la bascule, refais l’export sur la même période et dépose-le à nouveau : seuls les nouveaux rendez-vous et ce qui a changé depuis (annulés, déplacés, passés, supprimés) sont repris. Un rendez-vous encore à venir qui n’est plus dans l’export est annulé ici, sans SMS.</p>
      </Card>

      <Card title="2 · Dépose les fichiers" guide="wp-fichiers" icon="download" aside={files.length ? <Button size="sm" variant="ghost" icon="x" onClick={clear}>Tout retirer</Button> : undefined}>
        <label className={'wp-drop' + (over ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <input ref={input} type="file" multiple accept=".csv,.xml,.txt,text/csv,text/xml,application/xml" onChange={(e) => { const picked = [...(e.target.files || [])]; e.target.value = ''; void add(picked); }} aria-label="Fichiers exportés de WordPress" />
          <Icon name="download" size={22} />
          <b>Glisse les fichiers ici</b>
          <span>ou <u>choisis-les</u> · CSV et XML, plusieurs à la fois</span>
        </label>
        {restarted ? <Note tone="" icon="info">Nouveau passage : les fichiers du précédent ont été retirés.</Note> : null}
        {parsed || reading.length ? <FileList files={parsed?.files || []} reading={reading} onRemove={(i) => void removeAt(i)} /> : null}
        {parsed ? <Sample files={parsed.files} /> : null}
        {parsed ? <Issues problems={parsed.problems} /> : null}
      </Card>

      {/* once imported, the report replaces the preview; dropping files again starts a new (delta) run */}
      {parsed && pv && c && !(done && !done.failed) ? (
        <>
          <section className="col" style={{ gap: 10 }} aria-label="Aperçu" data-guide="wp-apercu">
            <div className="card-h" style={{ margin: 0 }}><h2><Icon name="eye" size={16} />3 · Ce qui va être repris</h2><span className="faint" style={{ fontSize: 13 }} aria-live="polite">{checking ? 'Vérification des fiches…' : ''}</span></div>
            {checkErr ? <Note tone="warn" icon="alert"><span style={{ flex: 1 }}>{checkErr}</span> <Button size="sm" onClick={retryCheck}>Réessayer</Button></Note> : null}
            <div className="kpis k5 wp-kpis" aria-live="polite">
              <Kpi k="Nouveaux clients" v={c.newClients} s="fiches créées" icon="user" />
              <Kpi k="Fusionnés" v={c.merged} s="même numéro ou e-mail qu’une fiche" icon="clients" />
              <Kpi k="Visites passées" v={c.past + c.noShow} s={c.noShow ? 'dont ' + plural(c.noShow, 'absence') : 'pour le rythme de chacun'} icon="scissors" />
              <Kpi k="À venir" v={c.upcoming} s="rendez-vous dans l’agenda, sans SMS" icon="calendar" hot={c.upcoming > 0} />
              <Kpi k="Annulés" v={c.cancelled + c.toCancel} s={c.toCancel ? 'dont ' + c.toCancel + ' depuis le premier import' : 'gardés dans l’historique'} icon="x" />
            </div>
            <p className="muted wp-also">
              {[
                c.already ? plural(c.already, 'rendez-vous déjà repris', 'rendez-vous déjà repris') : '', c.toMove ? plural(c.toMove, 'déplacé', 'déplacés') + ' sur l’ancien site' : '',
                c.toReopen ? plural(c.toReopen, 'à rétablir', 'à rétablir') + ' (annulés ici, de nouveau confirmés sur l’ancien site)' : '',
                pv.gone.length ? plural(pv.gone.length, 'supprimé', 'supprimés') + ' sur l’ancien site (annulés ici, sans SMS)' : '',
                pv.excluded.retention ? plural(pv.excluded.retention, 'personne', 'personnes') + ' sans visite depuis 3 ans : pas reprise' + (pv.excluded.retention > 1 ? 's' : '') + ' (règle de conservation)' : '',
                pv.excluded.noVisit ? plural(pv.excluded.noVisit, 'client sans rendez-vous repris', 'clients sans rendez-vous repris') + ' : pas repris (règle de conservation)' : '',
                c.toClose ? plural(c.toClose, 'passé', 'passés') + ' depuis sur l’ancien site' : '', c.skipped ? plural(c.skipped, 'réservation ignorée', 'réservations ignorées') + ' (erreur ou paiement non abouti)' : '',
                c.erased ? plural(c.erased, 'ligne ignorée', 'lignes ignorées') + ' (client effacé)' : '',
                c.giftcards ? plural(c.giftcards, 'carte cadeau', 'cartes cadeaux') : '', c.packs ? plural(c.packs, 'carnet') : ''
              ].filter(Boolean).join(' · ') || 'Aucun rendez-vous déjà repris.'}
            </p>
            {pv.warning ? <Note tone="warn" icon="alert">{pv.warning}</Note> : null}
            {pv.notes.map((t) => <Note key={t} tone="warn" icon="alert">{t}</Note>)}
            {nothingNew ? <Note tone="ok" icon="check">Tout est déjà repris : ces fichiers n’apportent rien de nouveau.{sendable ? ' Tu peux enregistrer la vérification : le rapport gardera la trace de cette synchro.' : ''}</Note> : null}
          </section>

          {pv.review.length ? <Review title="À regarder" rows={pv.review} /> : null}

          <Card title="4 · Fais correspondre" guide="wp-correspondance" icon="link">
            {seen.services.length ? (
              <div className="wp-map">
                <p className="section-k">Prestations</p>
                {seen.services.map(([name, n]) => (
                  <label key={name} className="wp-row">
                    <span><b>{name}</b><small>{plural(n, 'rendez-vous')}{guessed['v:' + name] ? ' · proposé d’après le nom : vérifie' : ''}</small></span>
                    <Icon name="arrowR" size={16} />
                    <select className="input select" value={svcMap[name] || ''} onChange={(e) => { setSvcMap({ ...svcMap, [name]: e.target.value }); setGuessed({ ...guessed, ['v:' + name]: false }); }} aria-label={'Prestation pour « ' + name + ' »'}>
                      <option value="">Ne pas reprendre ces rendez-vous</option>
                      {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {/* the archived « Ancienne prestation »: the visit counts for the rhythm and the spend, and is in no agenda */}
                      <option value={W.LEGACY}>Autre prestation (ancien site, historique seul)</option>
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
                    <span><b>{name || 'Sans barbier'}</b><small>{plural(n, 'rendez-vous')}{guessed['s:' + name] ? ' · proposé d’après le nom : vérifie' : ''}</small></span>
                    <Icon name="arrowR" size={16} />
                    <select className={'input select' + (need.includes(name) ? ' wp-need' : '')} value={staffMap[name] ?? ''} onChange={(e) => { setStaffMap({ ...staffMap, [name]: e.target.value }); setGuessed({ ...guessed, ['s:' + name]: false }); }} aria-label={'Barbier pour « ' + (name || 'sans barbier') + ' »'}>
                      {!staffMap[name] ? <option value="" disabled>Choisis un barbier…</option> : null}
                      {chairs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {/* the archived profile has no lane in the agenda: history only */}
                      <option value={W.LEGACY} disabled={upcoming.has(name)}>Ancien barbier (profil archivé{upcoming.has(name) ? ', historique seul' : ''})</option>
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
            {need.length && !noChair ? <Note tone="warn" icon="alert">Choisis un barbier actif pour {need.map((n) => '« ' + (n || 'Sans barbier') + ' »').join(', ')} : ses rendez-vous à venir doivent avoir leur place dans l’agenda.</Note> : null}
            <div className="wp-go">
              <p className="muted">{demo ? 'Aucun SMS n’est envoyé à l’import. Les rappels partiront la veille de chaque rendez-vous à venir, comme pour les autres.' : 'Aucun SMS ni e-mail n’est envoyé à l’import ni avant la bascule : les rappels du nouveau salon ne partent qu’après « Ouvrir les envois » (Jour J).'}</p>
              <Button variant="primary" size="lg" icon="check" busy={!!progress} disabled={(!work && !sendable) || checking || !server || need.length > 0 || noCatalogue} onClick={run}>
                {progress ? 'Import ' + progress.done + ' / ' + progress.total : label ? 'Importer ' + label : sendable ? 'Enregistrer la vérification (rien de nouveau)' : 'Rien de nouveau à importer'}
              </Button>
            </div>
            {waiting ? <p className="faint wp-wait" role="status">Connexion perdue : nouvel essai… Rien ne sera compté deux fois.</p> : null}
            {progress ? <div className="wp-bar" role="progressbar" aria-label="Avancement de l’import" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-valuetext={'Paquet ' + progress.done + ' sur ' + progress.total}><i style={{ width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + '%' }} /></div> : null}
          </Card>
        </>
      ) : null}

      {showReport ? <Report runs={reports} runId={picked || done?.id || null} onPick={setPicked} next={done && !done.failed && (picked || done.id) === done.id ? done.next : undefined} halt={done?.failed && (picked || done.id) === done.id ? done.halt : undefined} focus={!!done && !done.failed} /> : null}
    </div>
  );
}

/** The lines to look at before sending: eight, then fifty more at a time (a big export can raise thousands). */
function Review({ title, rows }: { title: string; rows: W.ReviewRow[] }) {
  const [n, setN] = useState(8);
  const list = rows.slice(0, n);
  const body = (
    <>
      <ul className="list wp-review">{list.map((r, i) => (
        <li key={i} className="li">
          <span className="li-main"><b>{r.name || 'Ligne'}{r.wp ? <span className="faint"> · n° {r.wp}</span> : null}</b><small>{[when(r), r.text].filter(Boolean).join(' · ')}</small></span>
        </li>
      ))}</ul>
      {rows.length > list.length ? <Button variant="ghost" block onClick={() => setN(n + 50)}>Voir {Math.min(50, rows.length - n)} lignes de plus ({rows.length - list.length} restantes)</Button> : null}
    </>
  );
  return <Card title={title + ' · ' + rows.length} icon="alert">{body}</Card>;
}
