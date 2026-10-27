// Les clients: who comes, how often, what they like. The technical card is what a barber reads
// before picking up the clippers; the rhythm is what tells the owner who to call back.
import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { navigate, setQuery, useRoute } from '../../lib/router';
import { cap, dates, dayShortWord, eur, plural, rhythmWords, sinceWords, STATUS, time } from '../../lib/format';
import { useDebounced, useIsWide } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Chip, Empty, Field, Kpi, Menu, Modal, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { ClientCard, ClientFull } from '../types';
import ClientReview from './avis/ClientReview';
import { LoyaltyCard } from './clients/LoyaltyCard';
import './clients.css';

type ListData = { total: number; counts: Record<string, number>; excludedNoConsent?: number; retention?: { before: string; other: number } | null; items: ClientCard[] };
/** The file as the server sends it, with where the consent to the offers comes from and since when. */
type FileClient = ClientFull & { marketingSrc?: string; marketingAt?: number | null };
type FileData = {
  client: FileClient;
  appts: { id: string; day: string; start: number; dur: number; status: string; services: string[]; staffId: string; price: number; source: string; saleId: string | null; note: string }[];
  sales: { id: string; ref: string; day: string; due: number; revenue: number; refunded: number; lines: string[] }[];
  packs: { id: string; name: string; used: number; total: number; expires: string; soldAt: number }[];
  messages: { id: string; channel?: 'sms' | 'email'; template: string; status: string; at: number }[];
};
type Why = 'name' | 'email' | 'phone';
type Pair = { keep: ClientCard; drop: ClientCard; why: Why[] };
type Open = {
  appts: { id: string; day: string; start: number; staffId: string; services: string[]; deposit: number; passed?: boolean }[];
  packs: { id: string; name: string; left: number; expires: string }[];
  giftcards: { id: string; last4: string; balance: number; expires: string }[];
  sms: boolean; smsLive?: boolean; email?: boolean;
};

// rare: shown only when it has someone (or is open), for whoever can act on it
const SEGMENTS: { v: string; t: string; hint: string; rare?: boolean; cap?: string }[] = [
  { v: 'all', t: 'Tous', hint: '' },
  { v: 'relancer', t: 'À relancer', hint: 'En retard sur leur rythme, d’accord pour les bons plans.' },
  { v: 'fideles', t: 'Fidèles', hint: 'Viennent régulièrement depuis plusieurs mois.' },
  { v: 'nouveaux', t: 'Nouveaux', hint: 'Première visite il y a moins de 30 jours, ou pas encore venus.' },
  { v: 'abonnes', t: 'Abonnés', hint: 'Ont un abonnement en cours.' },
  { v: 'vip', t: 'VIP', hint: '' },
  { v: 'absents', t: 'Absences', hint: 'Ont déjà manqué un rendez-vous sans prévenir.' },
  { v: 'anniversaires', t: 'Anniversaires', hint: 'Fêtent leur anniversaire ce mois-ci.' },
  { v: 'doublons', t: 'Doublons probables', hint: 'Même nom, même e-mail ou même numéro à quelques chiffres près.', rare: true, cap: 'agenda.edit' },
  { v: 'inactifs', t: 'Sans visite depuis 3 ans', hint: 'Plus rien depuis 3 ans : leur fiche doit être anonymisée.', rare: true, cap: 'client.erase' }
];
const SORTS = [{ v: 'recent', t: 'Dernière visite' }, { v: 'overdue', t: 'À relancer d’abord' }, { v: 'spend', t: 'Dépense' }, { v: 'visits', t: 'Visites' }, { v: 'name', t: 'Nom' }];
const TAGS = ['VIP', 'Barbe', 'Enfant', 'Étudiant', 'Sensible', 'Parle peu'];
// the tag that spares a client the deposit asked of those who missed (server/domain/policy.js TRUSTED)
const TRUSTED = 'confiance';
const MSG: Record<string, string> = { confirm: 'Confirmation', confirmation: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', moved: 'Déplacement', cancelled: 'Annulation', review: 'Demande d’avis', rebook: 'Relance', receipt: 'Reçu', waitlist: 'Créneau libéré', deposit: 'Lien d’acompte', lookup: 'Lien Mon rendez-vous', giftcardCode: 'Code carte cadeau' };
// AC-01: the client space's texts
Object.assign(MSG, { otp: 'Code de connexion', accountOpened: 'Espace client ouvert', accesInvite: 'Lien vers son espace' });

export default function Clients() {
  const route = useRoute();
  const wide = useIsWide();
  const id = route.id;
  return (
    <>
      <PageTitle><h1>Clients</h1></PageTitle>
      <div className={'cl-split' + (id ? ' has-file' : '')}>
        {!id || wide ? <ClientList active={id} /> : null}
        {id ? <ClientFile key={id} id={id} /> : wide ? <section className="card cl-idle"><Empty icon="clients" title="Choisis un client">Sa fiche technique, son rythme, ses rendez-vous et ses tickets s’affichent ici.</Empty></section> : null}
      </div>
    </>
  );
}

/* ---------------- the list ---------------- */

function ClientList({ active }: { active: string | null }) {
  const { can, boot } = useApp();
  const route = useRoute();
  const seg = route.query.get('segment') || 'all';
  const sort = route.query.get('tri') || (seg === 'relancer' ? 'overdue' : 'recent');
  const [q, setQ] = useState(route.query.get('q') || '');
  const dq = useDebounced(q, 200);
  const [limit, setLimit] = useState(60);
  const [creating, setCreating] = useState(false);
  const segsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setLimit(60); }, [dq, seg, sort]);
  const { data, loading } = useQuery<ListData>('/api/v1/clients' + qs({ q: dq.trim(), segment: seg, sort, limit }));
  // the row scrolls sideways: the open segment stays in sight (a rare one sits at the far end)
  useEffect(() => { segsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [seg, !!data]);
  const hint = SEGMENTS.find((s) => s.v === seg)?.hint;
  const excluded = seg === 'relancer' && data?.excludedNoConsent ? ' · ' + data.excludedNoConsent + ' sans accord, ' + (data.excludedNoConsent > 1 ? 'exclus' : 'exclu') : '';
  const shown = SEGMENTS.filter((s) => (!s.cap || can(s.cap)) && (!s.rare || seg === s.v || (data?.counts[s.v] || 0) > 0 || (s.v === 'inactifs' && (data?.retention?.other || 0) > 0)));
  return (
    <section className="card cl-list">
      <div className="row" style={{ gap: 8 }}>
        <label className="search grow"><Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou numéro" aria-label="Rechercher un client" autoComplete="off" /></label>
        {can('client.edit') ? <Button variant="primary" icon="plus" aria-label="Nouveau client" onClick={() => setCreating(true)}><span className="hide-phone">Nouveau</span></Button> : null}
      </div>
      <div ref={segsRef} className="chips cl-segs" role="tablist" aria-label="Segments">
        {shown.map((s) => <Chip key={s.v} small on={seg === s.v} onClick={() => setQuery({ segment: s.v === 'all' ? null : s.v, tri: null })}>{s.t}{data?.counts[s.v] != null ? <span className="cnt">{data.counts[s.v]}</span> : null}</Chip>)}
      </div>
      {seg === 'doublons' ? <Duplicates q={dq.trim()} /> : (
        <>
          <div className="row cl-tools">
            <span className="muted grow" style={{ fontSize: 13 }}>{data ? plural(data.total, 'client') : ''}{hint ? ' · ' + hint : ''}{excluded}</span>
            <select className="input select cl-sort" value={sort} onChange={(e) => setQuery({ tri: e.target.value })} aria-label="Trier">{SORTS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}</select>
            {can('client.export') ? <a className="btn btn-ghost btn-sm btn-icon" href="/api/v1/export?kind=clients" download aria-label="Exporter en CSV" title="Exporter en CSV"><Icon name="download" /></a> : null}
          </div>
          {seg === 'inactifs' && data && can('client.erase') && !dq ? <Retention files={data.counts.inactifs || 0} other={data.retention?.other || 0} before={data.retention?.before || ''} /> : null}
          {seg !== 'inactifs' && data && can('client.erase') && !dq && (data.counts.inactifs || data.retention?.other) ? (
            // the 3 years /confidentialite promises: in sight on the list, not only at the far end of the chips
            <button type="button" className="note warn cl-due" onClick={() => setQuery({ segment: 'inactifs', tri: null })}>
              <Icon name="shield" /><span className="grow">{data.counts.inactifs ? plural(data.counts.inactifs, 'fiche', 'fiches') + ' sans visite depuis 3 ans, à anonymiser' : 'D’anciens tickets ou rendez-vous gardent un nom, à effacer'}</span><Icon name="chevR" size={16} />
            </button>
          ) : null}
          {loading && !data ? <div className="col" style={{ gap: 10 }}>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={52} />)}</div> : !data?.items.length ? (
            <Empty icon="clients" title={dq ? 'Personne à ce nom' : 'Aucun client ici'}>{dq ? 'Vérifie l’orthographe ou cherche par les derniers chiffres du numéro.' : 'Ce segment est vide pour le moment.'}</Empty>
          ) : (
            <>
              <ul className="list">
                {data.items.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="li cl-row" aria-current={active === c.id ? 'true' : undefined} onClick={() => navigate('/clients/' + c.id + location.search)}>
                      <Avatar name={c.first + ' ' + c.last} size="sm" color={c.overdue ? 'var(--warn)' : undefined} />
                      <span className="li-main">
                        <b>{c.first} {c.last}{c.badges.filter((b) => b !== 'nouveau' || !c.visits).slice(0, 2).map((b) => <span key={b} className={'badge ' + badgeTone(b)}>{b}</span>)}</b>
                        <small>{c.next ? 'Prochain RDV ' + dayShortWord(c.next.day, boot.today) + ' ' + time(c.next.start) : c.overdue ? 'Pas revenu ' + sinceWords(c.sinceLast).replace('il y a', 'depuis') + (c.cadence ? ' · venait ' + rhythmWords(c.cadence) : '') : c.lastDay ? 'Venu ' + sinceWords(c.sinceLast) + (c.cadence ? ' · ' + rhythmWords(c.cadence) : '') : 'Pas encore venu'}</small>
                      </span>
                      <span className="li-end"><b className="money tnum">{c.spend ? eur(c.spend) : ''}</b><small className="faint">{c.visits ? plural(c.visits, 'visite') : ''}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.total > data.items.length ? <Button variant="ghost" block onClick={() => setLimit(limit + 60)}>Voir {Math.min(60, data.total - data.items.length)} de plus</Button> : null}
            </>
          )}
        </>
      )}
      <NewClient open={creating} onClose={() => setCreating(false)} initial={q} />
    </section>
  );
}

const WHY: Record<Why, string> = { phone: 'même numéro', email: 'même e-mail', name: 'même nom' };

/** The pairs the server finds, the file to keep first: one tap opens the merge preview. */
function Duplicates({ q }: { q: string }) {
  const { data, loading } = useQuery<{ total: number; pairs: Pair[] }>('/api/v1/clients/duplicates');
  const [n, setN] = useState(30);
  const [merging, setMerging] = useState<Pair | null>(null);
  const [busy, setBusy] = useState('');
  const pairs = (data?.pairs || []).filter((p) => !q || [p.keep, p.drop].some((c) => fold(c.first + ' ' + c.last).includes(fold(q)) || (q.replace(/\D/g, '').length >= 2 && c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '')))));
  const distinct = async (p: Pair) => {
    setBusy(p.keep.id + p.drop.id);
    try { await api.post('/api/v1/clients/distinct', { a: p.keep.id, b: p.drop.id }); toast({ title: 'Noté : deux personnes différentes', icon: 'check' }); refreshAll(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  if (loading && !data) return <div className="col" style={{ gap: 10 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={92} />)}</div>;
  if (!pairs.length) return <Empty icon="check" title="Aucun doublon">{q ? 'Aucun doublon probable à ce nom.' : 'Chaque client a une seule fiche.'}</Empty>;
  return (
    <>
      <p className="muted" style={{ fontSize: 13 }}>{plural(q ? pairs.length : data?.total || 0, 'doublon probable', 'doublons probables')} · la fiche avec le plus de visites est gardée, l’autre la rejoint.</p>
      <ul className="list cl-dups">
        {pairs.slice(0, n).map((p) => (
          <li key={p.keep.id + p.drop.id} className="cl-dup">
            <div className="cl-dup-who">
              {[p.keep, p.drop].map((c) => (
                <button key={c.id} type="button" className="cl-dup-one" onClick={() => navigate('/clients/' + c.id + location.search)}>
                  <b>{c.first} {c.last}</b>
                  <small>{c.phone || 'sans numéro'}</small>
                  <small>{c.visits ? plural(c.visits, 'visite') + (c.lastDay ? ', dernière ' + sinceWords(c.sinceLast) : '') : 'pas encore venu'}</small>
                </button>
              ))}
            </div>
            <div className="row cl-dup-acts">
              <span className="faint grow" style={{ fontSize: 12.5 }}>{cap(p.why.map((w) => WHY[w]).join(', '))}</span>
              <Button size="sm" variant="ghost" busy={busy === p.keep.id + p.drop.id} onClick={() => distinct(p)}>Pas un doublon</Button>
              <Button size="sm" variant="primary" icon="copy" onClick={() => setMerging(p)}>Fusionner</Button>
            </div>
          </li>
        ))}
      </ul>
      {pairs.length > n ? <Button variant="ghost" block onClick={() => setN(n + 30)}>Voir {Math.min(30, pairs.length - n)} de plus</Button> : null}
      {merging ? <MergeSheet open into={merging.keep} pick={merging.drop} onClose={() => setMerging(null)} /> : null}
    </>
  );
}

/** Retention: the files past 3 years without a visit, anonymised in one confirmed tap (the count is checked again). */
function Retention({ files, other, before }: { files: number; other: number; before: string }) {
  const [busy, setBusy] = useState(false);
  if (!files && !other) return null;
  const since = before ? dates.dayParts(before) : null;
  const go = async () => {
    const what = files ? plural(files, 'fiche') : plural(other, 'ancienne donnée', 'anciennes données');
    const yes = await confirm({
      title: 'Anonymiser ' + what + ' ?',
      body: (files ? 'Noms, numéros, e-mails, notes et fiches techniques sont supprimés définitivement. Les tickets restent dans la comptabilité, sans nom.' : 'Les noms et motifs laissés sur d’anciens tickets ou rendez-vous sans fiche sont supprimés.') + (files && other ? ' Les noms laissés sur ' + plural(other, 'ancien ticket ou rendez-vous', 'anciens tickets ou rendez-vous') + ' sans fiche partent aussi.' : ''),
      ok: 'Anonymiser ' + what, danger: true
    });
    if (!yes) return;
    setBusy(true);
    try {
      const r = await api.post<{ erased: number; other: number }>('/api/v1/clients/retention', { expect: files });
      toast({ title: r.erased ? plural(r.erased, 'fiche anonymisée', 'fiches anonymisées') : 'Anciennes données effacées', sub: r.other ? plural(r.other, 'autre donnée', 'autres données') + ' sans fiche effacée' + (r.other > 1 ? 's' : '') : undefined, icon: 'trash' });
      refreshAll();
    } catch (e: any) {
      if (e.code === 'changed') { toast({ kind: 'info', title: 'La liste a changé', sub: 'Quelqu’un est revenu entre-temps : vérifie et recommence.', icon: 'info' }); refreshAll(); }
      else toastError(e);
    } finally { setBusy(false); }
  };
  return (
    <div className="note warn cl-retention">
      <Icon name="shield" />
      <div>
        <b>{files ? plural(files, 'fiche', 'fiches') + ' sans visite depuis ' + (since ? 'le ' + since.d + ' ' + dates.MONTHS_FR[since.m - 1] + ' ' + since.y : '3 ans') : 'Aucune fiche à anonymiser'}</b>
        <p>{files ? 'Le site promet de ne garder une fiche que 3 ans après la dernière visite.' : 'Mais ' + plural(other, 'ancien ticket ou rendez-vous', 'anciens tickets ou rendez-vous') + ' sans fiche ' + (other > 1 ? 'gardent' : 'garde') + ' encore un nom ou un motif.'}</p>
        <Button size="sm" variant="danger" icon="trash" busy={busy} onClick={go}>{files > 1 ? 'Anonymiser ces ' + files + ' fiches' : files ? 'Anonymiser cette fiche' : 'Effacer ces données'}</Button>
      </div>
    </div>
  );
}

export function badgeTone(b: string) {
  return b === 'fidèle' || b === 'abonné' ? 'badge-ok' : b === 'nouveau' ? 'badge-info' : b === 'absences' ? 'badge-warn' : b === 'VIP' || b === 'récompense' ? 'badge-accent' : '';
}

/** Names compared the way the server finds duplicates: no case, no accents, no punctuation. */
const fold = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function NewClient({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: string }) {
  const [f, setF] = useState({ first: '', last: '', phone: '', email: '', sms: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const digits = initial.replace(/\D/g, '');
    const words = digits.length >= 6 ? [] : initial.trim().split(/\s+/);
    setF({ first: cap(words[0] || ''), last: cap(words.slice(1).join(' ')), phone: digits.length >= 6 ? initial : '', email: '', sms: true });
  }, [open]);
  // a second file for the same person is the duplicate of tomorrow: say so while typing, without blocking
  const name = useDebounced(f.first.trim() && f.last.trim() ? f.first.trim() + ' ' + f.last.trim() : '', 250);
  const near = useQuery<ListData>(open && name ? '/api/v1/clients' + qs({ q: name, limit: 5 }) : null);
  const same = name && fold(name) === fold(f.first + ' ' + f.last) ? near.data?.items.find((x) => fold(x.first + ' ' + x.last) === fold(name)) : undefined;
  const openFile = (cid: string) => { onClose(); navigate('/clients/' + cid); };
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/v1/clients', { first: f.first, last: f.last, phone: f.phone || undefined, email: f.email || undefined, sms: f.sms });
      toast({ title: 'Fiche créée', sub: f.first + ' ' + f.last, icon: 'check' });
      refreshAll(); onClose(); navigate('/clients/' + r.id);
    } catch (e: any) {
      if (e.code === 'exists' && e.extra?.id) toast({ kind: 'info', title: 'Ce numéro a déjà une fiche', icon: 'user', action: { label: 'Ouvrir', run: () => openFile(e.extra.id) } });
      else toastError(e);
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nouveau client" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!f.first.trim()} onClick={go}>Créer la fiche</Button></>}>
      <div className="grid2">
        <Field label="Prénom" htmlFor="nc-f"><input id="nc-f" className="input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} autoComplete="off" /></Field>
        <Field label="Nom" htmlFor="nc-l"><input id="nc-l" className="input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} autoComplete="off" /></Field>
      </div>
      {same ? (
        <div className="note warn cl-exists" role="status"><Icon name="user" /><div>Une fiche <b>{same.first} {same.last}</b> existe déjà{same.phone ? ' (' + same.phone + ')' : ''} · <button type="button" className="link" onClick={() => openFile(same.id)}>Ouvrir</button></div></div>
      ) : null}
      <Field label="Téléphone" hint="Le numéro relie ses réservations en ligne à sa fiche." htmlFor="nc-p"><input id="nc-p" className="input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="06 12 34 56 78" autoComplete="off" /></Field>
      <Field label="E-mail (facultatif)" htmlFor="nc-e"><input id="nc-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></Field>
      <Switch on={f.sms} onChange={(v) => setF({ ...f, sms: v })} title="Confirmations et rappels par SMS" hint="Il peut répondre STOP à tout moment." />
    </Sheet>
  );
}

/* ---------------- one client ---------------- */

function ClientFile({ id }: { id: string }) {
  const { boot, can, staffById } = useApp();
  const { data, loading, error } = useQuery<FileData>('/api/v1/clients/' + id);
  const [tab, setTab] = useState<'rdv' | 'tickets' | 'sms'>('rdv');
  const [edit, setEdit] = useState(false);
  const [merge, setMerge] = useState(false);
  const [erase, setErase] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const back = () => navigate('/clients' + location.search);
  if (error) return <section className="card"><Empty icon="alert" title="Fiche introuvable" action={<Button variant="ghost" onClick={back}>Retour</Button>}>Elle a peut-être été fusionnée ou effacée.</Empty></section>;
  if (loading && !data) return <section className="card col" style={{ gap: 14 }}><Skeleton h={60} w={300} /><Skeleton h={110} /><Skeleton h={220} /></section>;
  if (!data) return null;
  const c = data.client;
  if (data.client.id !== id) { navigate('/clients/' + data.client.id, { replace: true }); return null; }
  const upcoming = data.appts.filter((a) => a.day >= boot.today && ['booked', 'pending', 'arrived', 'in_chair'].includes(a.status)).reverse();
  const past = data.appts.filter((a) => !upcoming.includes(a));
  const favStaff = topOf(past.filter((a) => a.status === 'done').map((a) => a.staffId));
  const favSvc = topOf(past.filter((a) => a.status === 'done').flatMap((a) => a.services));
  const contact = can('client.contact');

  return (
    <section className="cl-file">
      <button type="button" className="cl-back" onClick={back}><Icon name="chevL" size={16} />Clients</button>
      <div className="card cl-head">
        <Avatar name={c.first + ' ' + c.last} size="xl" color={c.overdue ? 'var(--warn)' : undefined} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2>{c.first} {c.last}</h2>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {c.badges.map((b) => <span key={b} className={'badge ' + badgeTone(b)}>{b}</span>)}
            {c.tags.filter((t) => t !== 'VIP' && t !== TRUSTED).map((t) => <span key={t} className="badge">{t}</span>)}
            {/* the tag's own word: a trusted client still pays the salon's deposit from the threshold up */}
            {c.tags.includes(TRUSTED) ? <span className="badge badge-ok">confiance</span> : null}
          </div>
          <p className="cl-contact">
            {c.hasPhone ? contact ? <a href={'tel:' + c.phone.replace(/\s/g, '')}><Icon name="phone" size={14} />{c.phone}</a> : <span><Icon name="phone" size={14} />{c.phone}</span> : <span className="faint">Pas de numéro</span>}
            {c.email ? <span><Icon name="globe" size={14} />{c.email}</span> : null}
            <span className="faint">Client depuis {monthYear(c.createdAt)}{c.source === 'site' ? ' · venu par le site' : ''}</span>
          </p>
          {c.erased ? null : <ClientReview id={c.id} />}
        </div>
        <div className="cl-acts">
          {can('agenda.own') ? <Button variant="primary" icon="calendar" onClick={() => navigate('/agenda?new=1&client=' + c.id)}>Prendre RDV</Button> : null}
          {can('client.edit') ? <Button icon="edit" aria-label="Modifier" onClick={() => setEdit(true)} /> : null}
          {!c.erased && (can('agenda.edit') || can('client.erase') || can('client.export') || can('settings')) ? <Button icon="more" aria-label="Plus d’actions" onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())} /> : null}
        </div>
      </div>

      <div className="kpis">
        <Kpi k="Visites" v={c.visits} s={c.lastDay ? 'dernière ' + sinceWords(c.sinceLast) : 'pas encore venu'} icon="scissors" />
        <Kpi k="Rythme" v={<span className="kpi-v sm">{c.cadence ? 'tous les ' + c.cadence + ' j' : '—'}</span>} s={c.cadence ? rhythmWords(c.cadence) : 'après 2 visites'} icon="clock" />
        <Kpi k="Dépensé" v={eur(c.spend)} s={c.visits ? 'soit ' + eur(Math.round(c.spend / c.visits)) + ' par visite' : ''} icon="euro" />
        <Kpi k="Absences" v={c.noShows} s={c.noShows ? 'rendez-vous manqué' + (c.noShows > 1 ? 's' : '') : 'toujours venu'} icon="alert" hot={c.noShows > 1} />
      </div>

      {upcoming.length ? (
        <div className="note ok cl-next"><Icon name="calendar" /><div><b>Prochain rendez-vous {dayShortWord(upcoming[0].day, boot.today)} à {time(upcoming[0].start)}</b> · {upcoming[0].services.join(' + ')} avec {staffById.get(upcoming[0].staffId)?.name}{upcoming.length > 1 ? ' · et ' + plural(upcoming.length - 1, 'autre') : ''}</div><Button size="sm" variant="ghost" onClick={() => navigate('/agenda?day=' + upcoming[0].day + '&rdv=' + upcoming[0].id)}>Voir</Button></div>
      ) : c.overdue ? (
        <Overdue c={c} />
      ) : null}

      <div className="cl-cols">
        <div className="col" style={{ gap: 14 }}>
          <TechCard c={c} favStaff={favStaff ? staffById.get(favStaff)?.name || '' : ''} favSvc={favSvc} />
          {data.packs.length ? (
            <div className="card">
              <div className="card-h"><h2><Icon name="ticket" size={16} />Abonnements</h2></div>
              {data.packs.map((p) => (
                <div key={p.id} className="cl-pack">
                  <div className="row"><b className="grow">{p.name}</b><span className={'badge ' + (p.used >= p.total ? '' : p.expires < boot.today ? 'badge-warn' : 'badge-ok')}>{p.used >= p.total ? 'terminé' : p.expires < boot.today ? 'expiré' : (p.total - p.used) + ' restante' + (p.total - p.used > 1 ? 's' : '')}</span></div>
                  <div className="cl-dots" aria-label={p.used + ' utilisées sur ' + p.total}>{Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.used ? 'on' : ''} />)}</div>
                  <small className="faint">Valable jusqu’au {dates.dayShort(p.expires)}</small>
                </div>
              ))}
            </div>
          ) : null}
          <Prefs c={c} />
          <LoyaltyCard c={c} />
        </div>
        <div className="card">
          <div className="tabs" role="tablist" style={{ marginTop: -6 }}>
            <button type="button" role="tab" aria-selected={tab === 'rdv'} onClick={() => setTab('rdv')}>Rendez-vous<span className="count">{data.appts.length}</span></button>
            {data.sales.length ? <button type="button" role="tab" aria-selected={tab === 'tickets'} onClick={() => setTab('tickets')}>Tickets<span className="count">{data.sales.length}</span></button> : null}
            <button type="button" role="tab" aria-selected={tab === 'sms'} onClick={() => setTab('sms')}>Messages<span className="count">{data.messages.length}</span></button>
          </div>
          {tab === 'rdv' ? (
            data.appts.length ? <ul className="list">{[...upcoming, ...past].map((a) => {
              const st = staffById.get(a.staffId);
              return (
                <li key={a.id}><button type="button" className="li" onClick={() => navigate('/agenda?day=' + a.day + '&rdv=' + a.id)}>
                  <span className="cl-date"><b>{dates.dayParts(a.day).d}</b><small>{dates.MONTHS_SH[dates.dayParts(a.day).m - 1].replace('.', '')}{a.day.slice(0, 4) !== boot.today.slice(0, 4) ? ' ' + a.day.slice(2, 4) : ''}</small></span>
                  <span className="li-main"><b>{a.services.join(' + ')}</b><small>{time(a.start)}{st ? ' · ' + st.name : ''}{a.note ? ' · « ' + a.note + ' »' : ''}</small></span>
                  <span className="li-end"><span className={'badge ' + (a.status === 'done' ? '' : a.status === 'no_show' ? 'badge-danger' : a.status === 'cancelled' ? 'badge-warn' : 'badge-info')}>{a.status === 'done' ? eur(a.price) : STATUS[a.status]}</span></span>
                </button></li>
              );
            })}</ul> : <Empty icon="calendar" title="Aucun rendez-vous">Son historique se construit à chaque visite.</Empty>
          ) : tab === 'tickets' ? (
            <ul className="list">{data.sales.map((x) => (
              <li key={x.id}><button type="button" className="li" onClick={() => navigate('/caisse/ventes?jour=' + x.day + '&ticket=' + x.id)}>
                <span className="li-main"><b>{x.lines.join(', ')}</b><small>{x.ref} · {cap(dates.dayShort(x.day))}{x.refunded ? ' · remboursé ' + eur(x.refunded) : ''}</small></span>
                <span className="li-end"><b className="money tnum">{eur(x.due, { decimals: x.due % 100 !== 0 })}</b></span>
              </button></li>
            ))}</ul>
          ) : data.messages.length ? (
            <ul className="list">{data.messages.map((m) => (
              <li key={m.id} className="li"><Icon name={m.channel === 'email' ? 'mail' : 'sms'} size={18} title={m.channel === 'email' ? 'E-mail' : 'SMS'} /><span className="li-main"><b>{MSG[m.template] || m.template}</b><small>{cap(dates.dayShort(dates.localParts(m.at).day))} · {time(dates.localParts(m.at).min)}</small></span><span className={'badge ' + (m.status === 'sent' ? 'badge-ok' : m.status === 'failed' ? 'badge-danger' : '')}>{({ sent: 'envoyé', failed: 'échec', simulated: boot.mode === 'demo' ? 'simulé (démo)' : 'jamais parti', skipped: 'non envoyé', expired: 'trop tard', claimed: 'en cours' } as Record<string, string>)[m.status] || 'en file'}</span></li>
            ))}</ul>
          ) : <Empty icon="sms" title="Aucun SMS">{c.sms ? 'Confirmations, rappels et relances apparaîtront ici.' : 'Il a refusé les SMS.'}</Empty>}
        </div>
      </div>

      <EditClient open={edit} c={c} onClose={() => setEdit(false)} />
      {merge ? <MergeSheet open into={c} onClose={() => setMerge(false)} /> : null}
      {erase ? <EraseModal c={c} onClose={() => setErase(false)} /> : null}
      {takeover ? <PackTakeover c={c} onClose={() => setTakeover(false)} /> : null}
      {menu ? (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          {can('agenda.edit') ? <button type="button" role="menuitem" onClick={() => { setMenu(null); setMerge(true); }}><Icon name="copy" />Fusionner un doublon</button> : null}
          {can('settings') ? <button type="button" role="menuitem" onClick={() => { setMenu(null); setTakeover(true); }}><Icon name="ticket" />Reprendre un abonnement en cours</button> : null}
          {can('client.export') ? <a role="menuitem" href={'/api/v1/clients/' + c.id + '/export'} download><Icon name="download" />Exporter ses données</a> : null}
          {can('client.erase') ? <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); setErase(true); }}><Icon name="trash" />Effacer (RGPD)</button> : null}
        </Menu>
      ) : null}
    </section>
  );
}

function topOf<T>(xs: T[]): T | null {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  let best: T | null = null, n = 0;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}
function monthYear(ms: number) { const d = dates.localParts(ms).day; return dates.MONTHS_FR[Number(d.slice(5, 7)) - 1] + ' ' + d.slice(0, 4); }

function Overdue({ c }: { c: ClientFull }) {
  const { can } = useApp();
  const [sent, setSent] = useState(false);
  return (
    <div className="note warn cl-next">
      <Icon name="clock" />
      <div><b>{c.first} n’est pas revenu depuis {c.sinceLast} jours.</b> {c.marketing ? (c.cadence ? 'Il venait ' + rhythmWords(c.cadence) + ' : un' : 'Une seule visite jusqu’ici : un') + ' petit SMS avec le lien de réservation suffit souvent.' : (c.cadence ? 'Il venait ' + rhythmWords(c.cadence) + '. ' : '') + 'Pas d’accord pour les bons plans : pas de relance par SMS.'}</div>
      {can('marketing') && c.sms && c.marketing && c.hasPhone ? <Button size="sm" variant="ghost" icon="sms" disabled={sent} onClick={async () => { try { const r = await api.post<{ sent: number }>('/api/v1/relances/send', { clientIds: [c.id] }); setSent(true); toast(r.sent ? 'Relance envoyée' : 'Déjà relancé aujourd’hui'); refreshAll(); } catch (e) { toastError(e); } }}>{sent ? 'Envoyé' : 'Relancer'}</Button> : null}
    </div>
  );
}

/** What the barber reads before starting: autosaved, no button to forget. */
function TechCard({ c, favStaff, favSvc }: { c: ClientFull; favStaff: string; favSvc: string | null }) {
  const { can } = useApp();
  const [tech, setTech] = useState(c.tech);
  const [notes, setNotes] = useState(c.notes);
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const timer = useRef(0);
  const save = (patch: Record<string, string>) => {
    clearTimeout(timer.current);
    setState('saving');
    timer.current = window.setTimeout(async () => {
      try { await api.patch('/api/v1/clients/' + c.id, patch); setState('saved'); } catch (e) { toastError(e); setState(''); }
    }, 700);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const ro = !can('client.edit');
  return (
    <div className="card">
      <div className="card-h"><h2><Icon name="scissors" size={16} />Fiche technique</h2><small className="faint">{state === 'saving' ? 'Enregistrement…' : state === 'saved' ? 'Enregistré' : ''}</small></div>
      {favStaff || favSvc ? <p className="muted" style={{ fontSize: 13.5, margin: '-4px 0 10px' }}>{favSvc ? 'Prend souvent : ' + favSvc : ''}{favStaff && favSvc ? ' · ' : ''}{favStaff ? 'Habitué de ' + favStaff : ''}</p> : null}
      <textarea className="input textarea" rows={4} value={tech} readOnly={ro} maxLength={500} placeholder="Dégradé, hauteur des côtés, sabot, produit, ce qu’il n’aime pas…" onChange={(e) => { setTech(e.target.value); save({ tech: e.target.value }); }} aria-label="Fiche technique" />
      <label className="section-k" htmlFor="cl-notes" style={{ display: 'block', margin: '14px 0 8px' }}>Notes privées</label>
      <textarea id="cl-notes" className="input textarea" rows={2} value={notes} readOnly={ro} maxLength={1000} placeholder="Allergies, préférences, sujets de conversation…" onChange={(e) => { setNotes(e.target.value); save({ notes: e.target.value }); }} />
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>Visible par l’équipe ; remis au client s’il demande ses données.</p>
    </div>
  );
}

const CONSENT_SRC: Record<string, string> = { site: 'site', salon: 'au salon', stop: 'STOP par SMS', wordpress: 'jamais demandé (ancien site)' };
/** "oui (site, 12/10/2026)", "non (STOP par SMS, 03/11/2026)", or just "oui" / "non" when nobody recorded where. */
export function consentWords(c: { marketing: boolean; marketingSrc?: string; marketingAt?: number | null }) {
  const src = c.marketingSrc ? CONSENT_SRC[c.marketingSrc] || c.marketingSrc : '';
  const day = c.marketingAt ? dates.localParts(c.marketingAt).day.split('-').reverse().join('/') : '';
  const how = [src, day].filter(Boolean).join(', ');
  return (c.marketing ? 'oui' : 'non') + (how ? ' (' + how + ')' : '');
}

function Prefs({ c }: { c: FileClient }) {
  const { boot, can } = useApp();
  const ro = !can('client.edit');
  const patch = async (p: Record<string, unknown>) => { try { await api.patch('/api/v1/clients/' + c.id, p); refreshAll(); } catch (e) { toastError(e); } };
  const toggleTag = (t: string) => patch({ tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t].slice(0, 8) });
  // the deposit asked of clients who already missed (Réglages › Réservation): shown where it applies, or to take it back
  const trusted = c.tags.includes(TRUSTED);
  const dep = boot.settings.deposits || {};
  const rule = !!dep.riskBased && dep.mode === 'threshold';
  const askRisk = rule && c.badges.includes('absences');
  // as Réglages › Réservation says it: in production without Stripe, no deposit is asked at all yet
  const noOnline = boot.mode !== 'demo' && boot.providers.payments === 'simulated';
  const boss = can('agenda.edit');
  const riskHint = trusted
    ? rule ? 'Le site ne lui demande plus l’acompte prévu pour les absences. À partir de ' + eur(dep.thresholdCents ?? 5000) + ', la règle du salon reste la même.' : 'Sans effet tant que l’acompte pour les absences est coupé (Réglages › Réservation).'
    : plural(c.noShows, 'absence') + (noOnline ? ' : le site lui demandera un acompte même pour une coupe, dès que Stripe sera branché.' : ' : le site lui demande un acompte même pour une coupe.');
  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="card-h"><h2><Icon name="star" size={16} />Préférences</h2></div>
      <div className="chips">{TAGS.map((t) => <Chip key={t} small on={c.tags.includes(t)} disabled={ro} onClick={() => toggleTag(t)}>{t}</Chip>)}</div>
      <Switch on={c.sms} disabled={ro} onChange={(v) => patch({ sms: v })} title="SMS de confirmation et de rappel" hint={c.sms ? 'Activés' : 'Il a demandé à ne plus en recevoir'} />
      <Switch on={c.marketing} disabled={ro} onChange={(v) => patch({ marketing: v })} title={'SMS bons plans : ' + consentWords(c)} hint="Offres et nouveautés · il peut répondre STOP" />
      {askRisk || trusted ? (
        // a money decision (the server asks agenda.edit): a barber sees it, dimmed, and who can take it
        <div style={boss ? undefined : { opacity: 0.65 }}>
          <Switch on={trusted} disabled={ro || !boss} onChange={(v) => patch({ tags: v ? [TRUSTED, ...c.tags].slice(0, 8) : c.tags.filter((x) => x !== TRUSTED) })} title="Ne plus demander d’acompte"
            hint={riskHint + (boss ? trusted ? '' : ' Si tu lui fais confiance, active.' : trusted ? ' Seul le gérant ou l’accueil peut le changer.' : ' Seul le gérant ou l’accueil peut l’en dispenser.')} />
        </div>
      ) : null}
      {c.birthday ? <p className="muted" style={{ fontSize: 13.5 }}><Icon name="gift" size={14} /> Anniversaire le {Number(c.birthday.slice(0, 2))} {dates.MONTHS_FR[Number(c.birthday.slice(3, 5)) - 1]}</p> : null}
    </div>
  );
}

function EditClient({ open, c, onClose }: { open: boolean; c: ClientFull; onClose: () => void }) {
  const { can } = useApp();
  const [f, setF] = useState({ first: '', last: '', phone: '', email: '', birthday: '' });
  const [busy, setBusy] = useState(false);
  const contact = can('client.contact');
  useEffect(() => { if (open) setF({ first: c.first, last: c.last, phone: contact ? c.phone : '', email: contact ? c.email : '', birthday: c.birthday ? c.birthday.replace('-', '/') : '' }); }, [open]);
  const bday = f.birthday.trim() ? f.birthday.trim().replace(/[./ ]/g, '-').replace(/^(\d)-/, '0$1-').replace(/-(\d)$/, '-0$1') : '';
  const bdayOk = !bday || /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])$/.test(bday);
  const go = async () => {
    setBusy(true);
    try {
      const p: Record<string, string> = { first: f.first, last: f.last, birthday: bday };
      if (contact) { p.phone = f.phone; p.email = f.email; }
      await api.patch('/api/v1/clients/' + c.id, p);
      toast({ title: 'Fiche mise à jour', icon: 'check' }); refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Modifier la fiche" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!f.first.trim() || !bdayOk} onClick={go}>Enregistrer</Button></>}>
      <div className="grid2">
        <Field label="Prénom" htmlFor="ec-f"><input id="ec-f" className="input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></Field>
        <Field label="Nom" htmlFor="ec-l"><input id="ec-l" className="input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></Field>
      </div>
      {contact ? (
        <>
          <Field label="Téléphone" htmlFor="ec-p"><input id="ec-p" className="input" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="E-mail" htmlFor="ec-e"><input id="ec-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </>
      ) : <Note icon="lock">Le numéro et l’e-mail ne sont visibles que par l’accueil et le gérant.</Note>}
      <Field label="Anniversaire (jour/mois)" error={bdayOk ? null : 'Format jj/mm, par exemple 14/03.'} htmlFor="ec-b"><input id="ec-b" className="input" inputMode="numeric" value={f.birthday} onChange={(e) => setF({ ...f, birthday: e.target.value })} placeholder="14/03" maxLength={5} /></Field>
    </Sheet>
  );
}

/* ---------------- merge, erase, subscription takeover ---------------- */

type Who = { id: string; first: string; last: string };
const PAGE = 20;

/**
 * Merge a duplicate into this file: search (prefilled with the full name, paged), pick, then a side-by-side preview of
 * what the kept file will hold (the server's own rule: only what it lacks, the notes of both) before the irreversible tap.
 */
function MergeSheet({ open, into, pick: initial, onClose }: { open: boolean; into: Who; pick?: ClientCard; onClose: () => void }) {
  const [q, setQ] = useState((into.first + ' ' + into.last).trim());
  const dq = useDebounced(q, 180);
  const [limit, setLimit] = useState(PAGE);
  const [pick, setPick] = useState<Who | null>(initial || null);
  const [swap, setSwap] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLimit(PAGE); }, [dq]);
  const res = useQuery<ListData>(!pick && dq.trim().length >= 2 ? '/api/v1/clients' + qs({ q: dq.trim(), limit }) : null);
  const items = (res.data?.items || []).filter((x) => x.id !== into.id);
  const keep = pick && swap ? pick : into, gone = pick && swap ? into : pick;
  const go = async () => {
    if (!keep || !gone) return;
    setBusy(true);
    try {
      await api.post('/api/v1/clients/merge', { from: gone.id, into: keep.id });
      toast({ title: 'Fiches fusionnées', sub: 'Tout l’historique est maintenant sur la fiche de ' + keep.first, icon: 'check' });
      refreshAll(); onClose(); navigate('/clients/' + keep.id + location.search);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const footer = pick ? (
    <><Button variant="ghost" onClick={() => (initial ? onClose() : (setPick(null), setSwap(false)))}>{initial ? 'Annuler' : 'Retour'}</Button><span className="grow" /><Button variant="danger" busy={busy} onClick={go}>Fusionner (irréversible)</Button></>
  ) : <><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /></>;
  return (
    <Sheet open={open} onClose={onClose} title="Fusionner un doublon" wide footer={footer}>
      {!pick ? (
        <>
          <p className="muted">Choisis l’autre fiche de {into.first}. Ses rendez-vous, tickets et abonnements passent sur celle-ci ; les infos manquantes sont complétées.</p>
          <label className="search"><Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou numéro" aria-label="Chercher l’autre fiche" autoFocus /></label>
          <ul className="list">
            {items.map((x) => <li key={x.id}><button type="button" className="li" onClick={() => setPick(x)}><Avatar name={x.first + ' ' + x.last} size="sm" /><span className="li-main"><b>{x.first} {x.last}</b><small>{x.phone || 'sans numéro'} · {x.visits ? plural(x.visits, 'visite') : 'pas encore venu'}{x.lastDay ? ' · dernière ' + sinceWords(x.sinceLast) : ''}</small></span><Icon name="chevR" /></button></li>)}
            {dq.trim().length >= 2 && res.data && !items.length ? <li className="muted" style={{ padding: 12 }}>Aucune autre fiche trouvée. Essaie le prénom seul ou les derniers chiffres du numéro.</li> : null}
          </ul>
          {res.data && res.data.total - (res.data.items.length - items.length) > items.length ? <Button variant="ghost" block onClick={() => setLimit(limit + PAGE)}>Voir plus de fiches</Button> : null}
        </>
      ) : keep && gone ? <MergePreview keep={keep} gone={gone} onSwap={() => setSwap(!swap)} /> : null}
    </Sheet>
  );
}

const cleanDay = (b: string) => (b ? Number(b.slice(0, 2)) + ' ' + dates.MONTHS_FR[Number(b.slice(3, 5)) - 1] : '');

function MergePreview({ keep, gone, onSwap }: { keep: Who; gone: Who; onSwap: () => void }) {
  const a = useQuery<FileData>('/api/v1/clients/' + keep.id), b = useQuery<FileData>('/api/v1/clients/' + gone.id);
  if (!a.data || !b.data) return <div className="col" style={{ gap: 10 }}><Skeleton h={60} /><Skeleton h={220} /></div>;
  const k = a.data.client, g = b.data.client;
  // a field of the kept file: its own value, or the other's when it has none (mergedFill on the server)
  const row = (label: string, x: string, y: string) => ({ label, x, y, from: x ? 'keep' : y ? 'gone' : '' });
  const rows = [
    row('Prénom', k.first, g.first), row('Nom', k.last, g.last), row('Téléphone', k.hasPhone ? k.phone : '', g.hasPhone ? g.phone : ''), row('E-mail', k.email, g.email),
    row('Anniversaire', cleanDay(k.birthday), cleanDay(g.birthday)), row('Fiche technique', k.tech, g.tech)
  ];
  const notes = [k.notes, g.notes].filter(Boolean).join(' · ');
  const visits = k.visits + g.visits, upcoming = [a.data, b.data].reduce((t, d) => t + d.appts.filter((x) => ['booked', 'pending', 'arrived'].includes(x.status)).length, 0);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="cl-cmp" role="table" aria-label="Aperçu de la fusion">
        <div className="cl-cmp-h" role="row"><span role="columnheader" /><span role="columnheader"><Icon name="check" size={14} />Fiche gardée</span><span role="columnheader">Fusionnée, disparaît</span></div>
        {rows.map((r) => (
          <div key={r.label} className="cl-cmp-r" role="row">
            <span className="k" role="rowheader">{r.label}</span>
            <span role="cell" className={r.from === 'keep' ? 'on' : r.x ? '' : 'none'}>{r.x || '—'}</span>
            <span role="cell" className={r.from === 'gone' ? 'on' : r.y && r.y !== r.x ? 'lost' : 'none'}>{r.y || '—'}</span>
          </div>
        ))}
        <div className="cl-cmp-r" role="row"><span className="k" role="rowheader">Notes</span><span role="cell" className={(notes ? 'on' : 'none') + ' wide'}>{notes || '—'}</span></div>
        <div className="cl-cmp-r" role="row"><span className="k" role="rowheader">SMS</span><span role="cell" className="on">{'Rappels ' + (k.sms ? 'oui' : 'non') + ' · bons plans ' + consentWords(k)}</span><span role="cell" className="lost">{'Rappels ' + (g.sms ? 'oui' : 'non') + ' · bons plans ' + (g.marketing ? 'oui' : 'non')}</span></div>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>En gras, ce que garde la fiche de {keep.first}. Après la fusion : {visits ? plural(visits, 'visite') : 'aucune visite encore'}{upcoming ? ', ' + plural(upcoming, 'rendez-vous à venir', 'rendez-vous à venir') : ''}, tous les tickets et abonnements, sur une seule fiche. On ne peut pas revenir en arrière.</p>
      <Button variant="ghost" size="sm" icon="undo" onClick={onSwap} style={{ alignSelf: 'flex-start' }}>Garder plutôt la fiche de {gone.first} {gone.last}</Button>
    </div>
  );
}

/** Erasure that closes what is still open first: the list, and the cancellation texted before the number is gone. */
function EraseModal({ c, onClose }: { c: FileClient; onClose: () => void }) {
  const { staffById, boot } = useApp();
  const { data, refresh } = useQuery<Open>('/api/v1/clients/' + c.id + '/open');
  const [cancel, setCancel] = useState(true);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const n = data?.appts.length || 0;
  const texts = !!data && data.sms && data.smsLive !== false;
  // the cancellation mail (with its calendar file) leaves too; an older API without the flag: the file and the setting
  const mails = !!data && (data.email ?? (!!c.email && !!boot.settings.messages?.email));
  const by = texts && mails ? 'par SMS et par e-mail' : texts ? 'par SMS' : mails ? 'par e-mail' : '';
  const go = async () => {
    if (!data) return;
    setBusy(true);
    try {
      // only what the owner saw is given up: a booking made since the list loaded comes back as a 409, then is shown
      const r = await api.post<{ cancelled: number; texted: number; unsent: number; refunded: number }>('/api/v1/clients/' + c.id + '/erase', { cancelUpcoming: n ? cancel : !!(data.packs.length || data.giftcards.length) });
      const sub = [r.cancelled ? plural(r.cancelled, 'rendez-vous annulé', 'rendez-vous annulés') : '', r.texted ? 'client prévenu' : '', r.unsent ? plural(r.unsent, 'message non parti', 'messages non partis') : '', r.refunded ? plural(r.refunded, 'acompte remboursé', 'acomptes remboursés') : ''].filter(Boolean).join(' · ');
      toast({ title: 'Fiche effacée', sub: sub || undefined, icon: 'trash' });
      refreshAll(); onClose(); navigate('/clients');
    } catch (e: any) {
      if (e.code === 'open') { setChanged(true); await refresh(); }
      else toastError(e);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} label={'Effacer ' + c.first + ' ' + c.last}>
      <h2>Effacer {c.first} {c.last} ?</h2>
      <p>Son nom, son numéro, ses notes et sa fiche technique sont supprimés définitivement (droit à l’effacement, RGPD). Les tickets restent dans la comptabilité, sans son nom.</p>
      {!data ? <Skeleton h={60} /> : n || data.packs.length || data.giftcards.length ? (
        <div className="cl-open">
          <b className="section-k">Encore ouvert sur sa fiche</b>
          <ul>
            {data.appts.map((a) => <li key={a.id}><Icon name="calendar" size={15} /><span>{cap(dayShortWord(a.day, boot.today))} à {time(a.start)} · {a.services.join(' + ')}{staffById.get(a.staffId) ? ' avec ' + staffById.get(a.staffId)!.name : ''}{a.passed ? ' · passé, jamais clôturé' : ''}{a.deposit ? ' · acompte de ' + eur(a.deposit, { decimals: a.deposit % 100 !== 0 }) + ' remboursé' : ''}</span></li>)}
            {data.packs.map((k) => <li key={k.id}><Icon name="ticket" size={15} /><span>{k.name} : {plural(k.left, 'coupe restante', 'coupes restantes')}, perdue{k.left > 1 ? 's' : ''}</span></li>)}
            {data.giftcards.map((g) => <li key={g.id}><Icon name="gift" size={15} /><span>Carte cadeau •••• {g.last4} : {eur(g.balance, { decimals: g.balance % 100 !== 0 })} de solde, reste valable avec son code</span></li>)}
          </ul>
          {n ? (
            <label className="cl-check">
              <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
              <span>{by ? 'Annuler ses rendez-vous et le prévenir ' + by + ' avant l’effacement' : 'Annuler ses rendez-vous avant l’effacement'}</span>
            </label>
          ) : null}
          {n && cancel && !by ? <Note tone="warn" icon="phone">{data.sms ? 'Les SMS ne partent pas encore (Réglages › Messages)' : 'Il ne reçoit pas de SMS'} : préviens-le toi-même avant d’effacer, son numéro disparaît avec la fiche.</Note> : null}
          {changed ? <Note tone="warn" icon="info">Du nouveau sur sa fiche depuis l’ouverture : vérifie la liste avant d’effacer.</Note> : null}
          {n && !cancel ? <Note tone="warn" icon="alert">Sans ça, ses rendez-vous resteraient dans l’agenda au nom de « Client effacé ». Annule-les ou garde la fiche.</Note> : null}
        </div>
      ) : null}
      <div className="acts">
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant="danger" busy={busy} disabled={!data || (n > 0 && !cancel)} onClick={go}>Effacer définitivement</Button>
      </div>
    </Modal>
  );
}

/** A subscription started on the old site (paper card, WordPress): the cuts left and until when, on this file. */
function PackTakeover({ c, onClose }: { c: FileClient; onClose: () => void }) {
  const { boot } = useApp();
  const packs = boot.services.filter((x) => x.active && x.pack);
  const [sid, setSid] = useState(packs[0]?.id || '');
  const sv = packs.find((x) => x.id === sid);
  const credits = sv?.pack?.credits || 5;
  // from the smallest: the owner taps up to what the card says
  const [left, setLeft] = useState(1);
  const [expires, setExpires] = useState(dates.addDays(boot.today, sv?.pack?.days || 70));
  const [busy, setBusy] = useState(false);
  const ok = expires >= boot.today && left >= 1;
  const go = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/import/pack', { clientId: c.id, left, expires, ...(sid ? { serviceId: sid } : {}) });
      toast({ title: 'Abonnement repris', sub: plural(left, 'coupe restante', 'coupes restantes') + ' jusqu’au ' + dates.dayShort(expires), icon: 'check' });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Reprendre un abonnement en cours" kicker={c.first + ' ' + c.last} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!ok} onClick={go}>Reprendre l’abonnement</Button></>}>
      <p className="muted">Pour un abonnement vendu sur l’ancien site ou sur carton : il n’entre pas dans la caisse du jour (déjà payé), seules les coupes restantes sont reprises.</p>
      {packs.length === 1 ? <p>Abonnement : <b>{packs[0].name}</b> ({plural(credits, 'coupe')})</p> : null}
      {packs.length > 1 ? (
        <Field label="Abonnement" htmlFor="pk-s"><select id="pk-s" className="input select" value={sid} onChange={(e) => { const x = packs.find((p) => p.id === e.target.value); setSid(e.target.value); setLeft(Math.min(left, Math.max(1, (x?.pack?.credits || 5) - 1))); setExpires(dates.addDays(boot.today, x?.pack?.days || 70)); }}>{packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      ) : null}
      <Field label="Coupes restantes">
        <div className="chips">{Array.from({ length: Math.max(1, credits - 1) }, (_, i) => i + 1).map((v) => <Chip key={v} on={left === v} onClick={() => setLeft(v)}>{v}</Chip>)}</div>
      </Field>
      <Field label="Valable jusqu’au" htmlFor="pk-e" error={expires < boot.today ? 'Cet abonnement a déjà expiré.' : null}><input id="pk-e" className="input" type="date" value={expires} min={boot.today} onChange={(e) => setExpires(e.target.value)} /></Field>
    </Sheet>
  );
}
