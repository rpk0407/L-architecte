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
import AccountCard from './clients/AccountCard';
import { LoyaltyCard } from './clients/LoyaltyCard';
import type { CardLine } from '../../lib/loyalty';
import { ClientChips, Fold, useFolds } from './clients/ClientChips';
import MemberBlock, { useSellable } from './clients/MemberBlock';
import Members from './clients/Members';
import { liveMembers, shortWords } from '../../lib/members';
import CutNotes from './espace/CutNotes';
// @ts-ignore — plain JS module with JSDoc types: the server's own STOP mention
import * as SmsRules from '../../../../shared/sms.js';
import { ActionBar, LoadMore, SavedViews, Tick, bulkPost, downloadPost, holdThen, listState as LS, usePages, useSelection, type BulkResult, type Excluded, type SavedView, type Selection, type Target } from '../../ui/ListKit';
import './clients.css';

type ListData = { total: number; counts: Record<string, number>; excludedNoConsent?: number; retention?: { before: string; other: number } | null; items: ClientCard[] };
/** The file as the server sends it, with where the consent to the offers comes from and since when. */
type FileClient = ClientFull & { marketingSrc?: string; marketingAt?: number | null };
type FileData = {
  client: FileClient;
  appts: { id: string; day: string; start: number; dur: number; status: string; services: string[]; staffId: string; price: number; source: string; saleId: string | null; note: string; typed?: string }[];
  sales: { id: string; ref: string; day: string; due: number; revenue: number; refunded: number; lines: string[] }[];
  packs: { id: string; name: string; used: number; total: number; expires: string; soldAt: number }[];
  messages: { id: string; channel?: 'sms' | 'email'; template: string; status: string; at: number }[];
};
type Why = 'name' | 'email' | 'phone';
type Pair = { keep: ClientCard; drop: ClientCard; why: Why[] };
type Open = {
  appts: { id: string; day: string; start: number; staffId: string; services: string[]; deposit: number; passed?: boolean }[];
  packs: { id: string; name: string; left: number; expires: string }[];
  memberships?: { id: string; plan: string; status: string; until: string | null }[];
  giftcards: { id: string; last4: string; balance: number; expires: string }[];
  sms: boolean; smsLive?: boolean; email?: boolean; old?: boolean;
};

// rare: shown only when it has someone (or is open), for whoever can act on it
const SEGMENTS: { v: string; t: string; hint: string; rare?: boolean; cap?: string }[] = [
  { v: 'all', t: 'Tous', hint: '' },
  { v: 'relancer', t: 'À relancer', hint: 'En retard sur leur rythme, d’accord pour les bons plans.' },
  { v: 'fideles', t: 'Fidèles', hint: 'Viennent régulièrement depuis plusieurs mois.' },
  { v: 'nouveaux', t: 'Nouveaux', hint: 'Première visite il y a moins de 30 jours, ou pas encore venus.' },
  { v: 'abonnes', t: 'Abonnés', hint: 'Ont un abonnement ou un carnet en cours.' },
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
Object.assign(MSG, { otp: 'Code de connexion', accountOpened: 'Espace client ouvert', accesInvite: 'Lien vers son espace', dataExport: 'Copie de ses données' });
// PAY-05: the monthly membership's texts
Object.assign(MSG, { memberWelcome: 'Bienvenue abonné', memberFailed: 'Paiement refusé', memberAction: 'Validation bancaire', memberCancelled: 'Résiliation', memberStopped: 'Résiliation', memberWithdrawn: 'Rétractation', memberWithdrawnNone: 'Rétractation', memberPaused: 'Pause', memberEnded: 'Abonnement arrêté', memberOffer: 'Proposition d’abonnement', memberLink: 'Lien abonnement', memberCard: 'Changer la carte', memberLinkMail: 'Lien abonnement (e-mail)' });

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

type BulkActs = { sms: boolean; tag: boolean; exp: boolean };
const BULK = '/api/v1/clients/bulk';
const smsRules = SmsRules as { withStop(body: string, stop: string): string };

function ClientList({ active }: { active: string | null }) {
  const { can, boot, reloadBoot } = useApp();
  const route = useRoute();
  const seg = route.query.get('segment') || 'all';
  const sort = route.query.get('tri') || (seg === 'relancer' ? 'overdue' : 'recent');
  const [q, setQ] = useState(route.query.get('q') || '');
  const dq = useDebounced(q, 200);
  // a saved view sets the search at once; typing waits for the pause
  const [jump, setJump] = useState<string | null>(null);
  const term = (jump != null && jump === q.trim() ? jump : dq).trim();
  const [creating, setCreating] = useState(false);
  const [sheet, setSheet] = useState<null | 'tag' | 'untag' | 'sms'>(null);
  const [exporting, setExporting] = useState(false);
  const segsRef = useRef<HTMLDivElement>(null);
  // the search is in the address like the segment and the sort: a filter is shared, saved and found again
  useEffect(() => { if ((route.query.get('q') || '') !== term) setQuery({ q: term || null }); }, [term]);
  const filter = { q: term, segment: seg, sort };
  const key = LS.filterKey(filter);
  // pages of 60 by offset: the first is this query, each next one is asked once, by itself (ClientRows)
  const url = (offset: number) => '/api/v1/clients' + qs({ q: term, segment: seg, sort, limit: LS.PAGE, offset: offset || null });
  const { data, loading } = useQuery<ListData>(url(0));
  const pager = usePages(key + '|' + sort);
  const listed = seg !== 'doublons' && seg !== 'abonnes';
  const selection = useSelection(key, listed ? data?.total : undefined);
  const acts: BulkActs = { sms: can('marketing'), tag: can('client.edit'), exp: can('client.export') };
  const canSelect = listed && (acts.sms || acts.tag || acts.exp);
  const picking = canSelect && selection.on;
  // the row scrolls sideways: the open segment stays in sight (a rare one sits at the far end)
  useEffect(() => { segsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [seg, !!data]);
  const hint = SEGMENTS.find((s) => s.v === seg)?.hint;
  const excluded = seg === 'relancer' && data?.excludedNoConsent ? ' · ' + data.excludedNoConsent + ' sans accord, ' + (data.excludedNoConsent > 1 ? 'exclus' : 'exclu') : '';
  const shown = SEGMENTS.filter((s) => (!s.cap || can(s.cap)) && (!s.rare || seg === s.v || (data?.counts[s.v] || 0) > 0 || (s.v === 'inactifs' && (data?.retention?.other || 0) > 0)));
  const viewQuery = LS.viewQuery({ q: term, segment: seg, tri: route.query.get('tri') });
  const applyView = (v: SavedView) => { const p = LS.viewParams(v.query); setJump(p.q || ''); setQ(p.q || ''); setQuery(p); };
  const saveViews = async (views: SavedView[]) => { await api.patch('/api/v1/prefs', { views }); await reloadBoot(); };
  const filtered = !!term || seg !== 'all';

  const selectAll = async () => {
    try {
      const r = await selection.all(() => api.get('/api/v1/clients' + qs({ q: term, segment: seg, sort, fields: 'ids' })));
      if (r.truncated) toast({ kind: 'info', title: LS.num(r.max) + ' fiches au plus à la fois', sub: 'Les ' + LS.num(r.max) + ' premières sur ' + LS.num(r.total) + ' sont cochées. Affine le filtre pour agir sur les autres.', icon: 'info', ttl: 7000 });
    } catch (e) { toastError(e); }
  };
  /** The list moved between the count on the button and the action: nothing was done, the person looks again. */
  const changed = (e: any) => {
    if (e?.code !== 'changed') return false;
    toast({ kind: 'info', title: 'La liste a changé', sub: 'Elle compte maintenant ' + plural(e.extra?.total ?? 0, 'fiche') + ' : rien n’a été fait, vérifie et recommence.', icon: 'info' });
    refreshAll();
    return true;
  };
  const exportNow = async (target: Target) => {
    setExporting(true);
    try {
      const n = await downloadPost(BULK, { op: 'export', ...target }, 'larchitecte-clients-selection.csv');
      toast({ title: n != null ? 'Export de ' + plural(n, 'fiche') : 'Export téléchargé', sub: 'Noté au journal d’activité, à ton nom.', icon: 'download' });
      if (selection.on) selection.stop();
    } catch (e) { if (!changed(e)) toastError(e); } finally { setExporting(false); }
  };
  const main = acts.sms ? { label: 'Envoyer un SMS', short: 'SMS', icon: 'sms', run: () => setSheet('sms') } : acts.tag ? { label: 'Étiqueter', short: 'Étiqueter', icon: 'plus', run: () => setSheet('tag') } : { label: 'Exporter', short: 'Exporter', icon: 'download', run: () => exportNow(selection.target(filter)), disabled: exporting };
  const more = [
    ...(acts.tag && acts.sms ? [{ label: 'Ajouter une étiquette', icon: 'plus', run: () => setSheet('tag') }] : []),
    ...(acts.tag ? [{ label: 'Retirer une étiquette', icon: 'minus', run: () => setSheet('untag') }] : []),
    ...(acts.exp && (acts.sms || acts.tag) ? [{ label: 'Exporter la sélection', icon: 'download', run: () => exportNow(selection.target(filter)), disabled: exporting }] : [])
  ];
  return (
    <section className={'card cl-list' + (picking ? ' is-picking' : '')}>
      <div className="row" style={{ gap: 8 }} data-guide="cl-search">
        <label className="search grow"><Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou numéro" aria-label="Rechercher un client" autoComplete="off" /></label>
        {can('client.edit') ? <Button variant="primary" icon="plus" aria-label="Nouveau client" onClick={() => setCreating(true)}><span className="hide-phone">Nouveau</span></Button> : null}
      </div>
      <div ref={segsRef} className="chips cl-segs" role="tablist" aria-label="Segments" data-guide="cl-segs">
        <SavedViews page="clients" views={boot.me.prefs?.views} query={viewQuery} suggest={term || SEGMENTS.find((s) => s.v === seg)?.t} onApply={applyView} save={saveViews} />
        {shown.map((s) => <Chip key={s.v} small on={seg === s.v} onClick={() => setQuery({ segment: s.v === 'all' ? null : s.v, tri: null })}>{s.t}{data?.counts[s.v] != null ? <span className="cnt">{data.counts[s.v]}</span> : null}</Chip>)}
      </div>
      {seg === 'doublons' ? <Duplicates q={term} /> : seg === 'abonnes' ? <Members q={term} active={active} /> : (
        <>
          <div className="row cl-tools" data-guide="cl-tools">
            <span className="muted grow" style={{ fontSize: 13 }}>{data ? plural(data.total, 'client') : ''}{hint ? ' · ' + hint : ''}{excluded}</span>
            <select className="input select cl-sort" value={sort} onChange={(e) => setQuery({ tri: e.target.value })} aria-label="Trier">{SORTS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}</select>
            {canSelect && !picking && data?.items.length ? <Button variant="ghost" size="sm" className="cl-pick" onClick={selection.start}>Sélectionner</Button> : null}
            {/* the export is the filter's: everything when nothing filters (the whole base, as before), else what is listed */}
            {!acts.exp || picking ? null : filtered
              ? <Button variant="ghost" size="sm" icon="download" className="cl-exp" busy={exporting} disabled={!data?.total} aria-label={'Exporter ' + (data ? plural(data.total, 'fiche') + ' du filtre' : 'le filtre') + ' en CSV'} title="Exporter ce filtre en CSV" onClick={() => exportNow({ filter: { ...(term ? { q: term } : {}), ...(seg !== 'all' ? { segment: seg } : {}) }, expect: data?.total ?? 0 })} />
              : <a className="btn btn-ghost btn-sm btn-icon cl-exp" href="/api/v1/export?kind=clients" download aria-label="Exporter tous les clients en CSV" title="Exporter tous les clients en CSV"><Icon name="download" /></a>}
          </div>
          {seg === 'inactifs' && data && can('client.erase') && !term ? <Retention files={data.counts.inactifs || 0} other={data.retention?.other || 0} before={data.retention?.before || ''} /> : null}
          {seg !== 'inactifs' && data && can('client.erase') && !term && (data.counts.inactifs || data.retention?.other) ? (
            // the 3 years /confidentialite promises: in sight on the list, not only at the far end of the chips
            <button type="button" className="note warn cl-due" onClick={() => setQuery({ segment: 'inactifs', tri: null })}>
              <Icon name="shield" /><span className="grow">{data.counts.inactifs ? plural(data.counts.inactifs, 'fiche', 'fiches') + ' sans visite depuis 3 ans, à anonymiser' : 'D’anciens tickets ou rendez-vous gardent un nom, à effacer'}</span><Icon name="chevR" size={16} />
            </button>
          ) : null}
          {loading && !data ? <div className="col" style={{ gap: 10 }}>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={52} />)}</div> : !data?.items.length ? (
            <div data-tour-empty><Empty icon="clients" title={term ? 'Personne à ce nom' : 'Aucun client ici'}>{term ? 'Vérifie l’orthographe ou cherche par les derniers chiffres du numéro.' : 'Ce segment est vide pour le moment.'}</Empty></div>
          ) : (
            <>
              <ul className="list" data-guide="cl-rows">
                {pager.offsets.map((o) => <ClientRows key={o} url={url(o)} active={active} today={boot.today} selection={picking ? selection : null} />)}
              </ul>
              <LoadMore total={data.total} loaded={Math.min(data.total, pager.pages * LS.PAGE)} onMore={pager.more} />
            </>
          )}
          {picking && data ? <ActionBar sel={selection.sel} total={data.total} busy={selection.busy} onAll={selectAll} onClear={selection.clear} onClose={selection.stop} main={main} more={more} /> : null}
        </>
      )}
      <NewClient open={creating} onClose={() => setCreating(false)} initial={q} />
      {sheet === 'tag' || sheet === 'untag' ? <BulkTag mode={sheet} n={selection.count} target={selection.target(filter)} onClose={() => setSheet(null)} onDone={selection.stop} onChanged={changed} /> : null}
      {sheet === 'sms' ? <BulkSms n={selection.count} target={selection.target(filter)} onClose={() => setSheet(null)} onDone={selection.stop} onChanged={changed} /> : null}
    </section>
  );
}

/** One page of the list (60 rows): its own query, so the page after it never asks for it again. */
function ClientRows({ url, active, today, selection }: { url: string; active: string | null; today: string; selection: Selection | null }) {
  const { data, loading } = useQuery<ListData>(url);
  if (!data) return loading ? <>{[0, 1, 2].map((i) => <li key={i} className="cl-wait"><Skeleton h={52} /></li>)}</> : null;
  return (
    <>
      {data.items.map((c) => {
        const on = !!selection && selection.isSelected(c.id);
        return (
          <li key={c.id}>
            <button type="button" className="li cl-row" aria-current={!selection && active === c.id ? 'true' : undefined} aria-pressed={selection ? on : undefined}
              onClick={() => (selection ? selection.toggle(c.id) : navigate('/clients/' + c.id + location.search))}>
              {selection ? <Tick on={on} /> : <Avatar name={c.first + ' ' + c.last} size="sm" color={c.overdue ? 'var(--warn)' : undefined} />}
              <span className="li-main">
                <b>{c.first} {c.last}{c.badges.filter((b) => b !== 'nouveau' || !c.visits).slice(0, 2).map((b) => <span key={b} className={'badge ' + badgeTone(b)}>{b}</span>)}</b>
                <small>{c.next ? 'Prochain RDV ' + dayShortWord(c.next.day, today) + ' ' + time(c.next.start) : c.overdue ? 'Pas revenu ' + sinceWords(c.sinceLast).replace('il y a', 'depuis') + (c.cadence ? ' · venait ' + rhythmWords(c.cadence) : '') : c.lastDay ? 'Venu ' + sinceWords(c.sinceLast) + (c.cadence ? ' · ' + rhythmWords(c.cadence) : '') : 'Pas encore venu'}</small>
              </span>
              <span className="li-end"><b className="money tnum">{c.spend ? eur(c.spend) : ''}</b><small className="faint">{[c.visits ? plural(c.visits, 'visite') : '', cardChip(c)].filter(Boolean).join(' · ')}</small></span>
            </button>
          </li>
        );
      })}
    </>
  );
}

/**
 * A tag on everything selected, added or taken off. The server changes the files in one write and says which ones
 * changed; « Annuler », on the confirmation, sends the inverse for those files only.
 */
function BulkTag({ mode, n, target, onClose, onDone, onChanged }: { mode: 'tag' | 'untag'; n: number; target: Target; onClose: () => void; onDone: () => void; onChanged: (e: any) => boolean }) {
  const { can } = useApp();
  const [tag, setTag] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = (other.trim() || tag).slice(0, 24);
  const who = plural(n, 'fiche');
  const go = async () => {
    setBusy(true);
    try {
      const r = await bulkPost<BulkResult>(BULK, { op: mode, tag: chosen, ...target });
      const undo = LS.undoOf(r);
      const words = LS.tagDone(r);
      toast({
        title: words.title, sub: words.sub, icon: r.changed ? 'check' : 'info', kind: r.changed ? 'ok' : 'info', ttl: undo ? 10000 : undefined,
        action: undo ? { label: 'Annuler', run: () => { bulkPost<BulkResult>(BULK, undo).then((u) => { toast({ title: 'Annulé', sub: plural(u.changed || 0, 'fiche') + (((u.changed || 0) > 1) ? ' remises' : ' remise') + ' comme avant', icon: 'undo' }); refreshAll(); }).catch(toastError); } } : undefined
      });
      refreshAll(); onDone(); onClose();
    } catch (e) { if (onChanged(e)) { onDone(); onClose(); } else toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} kicker={who + (n > 1 ? ' sélectionnées' : ' sélectionnée')} title={mode === 'tag' ? 'Ajouter une étiquette' : 'Retirer une étiquette'}
      footer={<Button variant="primary" block busy={busy} disabled={!chosen || !n} onClick={go}>{chosen ? (mode === 'tag' ? 'Ajouter « ' + chosen + ' » à ' : 'Retirer « ' + chosen + ' » de ') + who : 'Choisis une étiquette'}</Button>}>
      <div className="chips lk-tags">{[...TAGS, ...(can('agenda.edit') ? [TRUSTED] : [])].map((t) => <Chip key={t} on={!other.trim() && tag === t} onClick={() => { setTag(t); setOther(''); }}>{t}</Chip>)}</div>
      <Field label="Ou une autre" htmlFor="bt-o" hint="24 caractères au plus."><input id="bt-o" className="input" value={other} maxLength={24} onChange={(e) => setOther(e.target.value)} placeholder="Soirée du 12, Étudiants…" autoComplete="off" /></Field>
      {chosen === TRUSTED ? <Note tone="warn" icon="shield">{mode === 'tag' ? '« confiance » : plus d’acompte demandé à ces clients, même après une absence.' : 'Sans « confiance », l’acompte est de nouveau demandé à ceux qui ont manqué un rendez-vous.'}</Note> : null}
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{mode === 'tag' ? 'Les fiches qui l’ont déjà ne changent pas.' : 'Les fiches qui ne l’ont pas ne changent pas.'} Tu peux annuler juste après, depuis le message de confirmation.</p>
    </Sheet>
  );
}

type SmsPreview = { sent: number; matched: number; excluded: Excluded; max: number; template: string; stop: string; first: { prenom: string; jours: number } | null; dueAt: number | null };
/**
 * A follow-up text to everything selected. The sheet opens on the server's own preview (the send itself, unsaved):
 * who gets it, who is left out and why. Consent is the server's rule; nothing here can widen it. A text cannot be
 * taken back: the only undo is the 5 seconds before it leaves, and the sheet says so.
 */
function BulkSms({ n, target, onClose, onDone, onChanged }: { n: number; target: Target; onClose: () => void; onDone: () => void; onChanged: (e: any) => boolean }) {
  const [pre, setPre] = useState<SmsPreview | null>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.post<SmsPreview>(BULK, { op: 'sms', dry: true, ...target }).then((r) => { if (live) setPre(r); }).catch((e) => { if (!live) return; if (onChanged(e)) { onDone(); onClose(); } else setErr(e?.message || 'Aperçu impossible.'); });
    return () => { live = false; };
  }, []);
  const words = (text ?? pre?.template ?? '').trim();
  const custom = text != null && !!pre && words !== pre.template.trim();
  const tooMany = !!pre && pre.sent > pre.max;
  const bad = custom && (words.length < 10 || words.length > 320);
  const sample = pre ? smsRules.withStop(words.replace(/\{prenom\}/g, pre.first?.prenom || 'Karim').replace(/\{jours\}/g, String(pre.first?.jours ?? 35)).replace(/\{lien\}/g, location.origin + '/site'), pre.stop || '') : '';
  const out = pre ? LS.excludedWords(pre.excluded) : '';
  const send = () => {
    if (!pre) return;
    const who = plural(pre.sent, 'client');
    onClose(); onDone();
    holdThen({
      title: 'Envoi à ' + who + ' dans 5 s', sub: 'Après, un SMS ne se rattrape plus.', icon: 'sms',
      onCancel: () => toast({ kind: 'info', title: 'Envoi annulé', sub: 'Aucun SMS n’est parti.', icon: 'undo' }),
      run: async () => {
        try {
          const r = await bulkPost<BulkResult>(BULK, { op: 'sms', ...(custom ? { text: words } : {}), ...target });
          const done = LS.smsDone(r);
          toast({ title: done.title, sub: done.sub, icon: 'sms', kind: r.sent ? 'ok' : 'info' });
          refreshAll();
        } catch (e) { if (!onChanged(e)) toastError(e); }
      }
    });
  };
  return (
    <Sheet open onClose={onClose} kicker={plural(n, 'fiche') + (n > 1 ? ' sélectionnées' : ' sélectionnée')} title="Relancer par SMS"
      footer={<Button variant="primary" block icon="sms" disabled={!pre || !pre.sent || tooMany || bad} onClick={send}>{!pre ? 'Un instant…' : pre.sent ? 'Envoyer à ' + plural(pre.sent, 'client') : 'Personne à qui envoyer'}</Button>}>
      {err ? <Note tone="err" icon="alert">{err}</Note> : !pre ? <div className="col" style={{ gap: 10 }}><Skeleton h={22} w="60%" /><Skeleton h={84} /></div> : (
        <>
          <div className="lk-sum"><b className="tnum">{LS.num(pre.sent)}</b><span>{pre.sent > 1 ? 'recevront le SMS' : pre.sent ? 'recevra le SMS' : 'ne le recevra'} sur {plural(pre.matched, 'fiche')}</span></div>
          {out ? <Note icon="shield">{out}.</Note> : null}
          {tooMany ? <Note tone="err" icon="alert">{LS.num(pre.max)} SMS au plus à la fois : affine le filtre, ou envoie en plusieurs fois.</Note> : null}
          {pre.sent ? (
            <>
              <div className="bubble" aria-label="Aperçu"><small>{pre.first ? 'Aperçu pour ' + pre.first.prenom : 'Aperçu'}</small><p>{sample}</p></div>
              {text == null ? <button type="button" className="link lk-edit" onClick={() => setText(pre.template)}>Modifier le texte</button> : (
                <Field label="Texte" htmlFor="bs-t" hint="{prenom}, {jours} et {lien} sont remplacés pour chacun. La mention STOP est ajoutée." error={bad ? 'Entre 10 et 320 caractères.' : null}>
                  <textarea id="bs-t" className="input textarea" rows={4} maxLength={320} value={text} onChange={(e) => setText(e.target.value)} />
                </Field>
              )}
              {pre.dueAt ? <Note icon="clock">Hors des heures d’envoi : les SMS partiront {dates.localParts(pre.dueAt).day === dates.localParts(Date.now()).day ? '' : 'demain '}à {time(dates.localParts(pre.dueAt).min)}.</Note> : null}
              <Note tone="warn" icon="alert">Un SMS envoyé ne se rattrape pas. Après « Envoyer », tu as 5 secondes pour annuler ; ensuite, plus rien.</Note>
            </>
          ) : null}
        </>
      )}
    </Sheet>
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

/** « Carte 6/9 »: where his stamp card stands; nothing while the programme is off or he does not take part, and the « récompense » badge says it when one waits */
export function cardChip(c: ClientCard): string {
  const l = (c as ClientCard & { loyalty?: CardLine }).loyalty;
  return l && !l.off && !l.rewards ? 'Carte ' + Math.max(0, l.units) + '/' + l.goal : '';
}
export function badgeTone(b: string) {
  return b === 'fidèle' || b === 'abonné' ? 'badge-ok' : b === 'nouveau' || b === 'carnet' ? 'badge-info' : b === 'absences' ? 'badge-warn' : b === 'VIP' || b === 'récompense' ? 'badge-accent' : '';
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
  const folds = useFolds();
  // the Abonnement block is for a file that has a membership, or for any file once memberships are on sale
  const sell = useSellable();
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
      <div className="card cl-head" data-guide="file-head">
        <Avatar name={c.first + ' ' + c.last} size="xl" color={c.overdue ? 'var(--warn)' : undefined} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h2>{c.first} {c.last}</h2>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            {c.badges.map((b) => <span key={b} className={'badge ' + badgeTone(b)}>{b}</span>)}
            {cardChip(c) ? <span className="badge">{cardChip(c)}</span> : null}
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

      {c.erased ? null : <ClientChips c={c} onOpen={folds.show} />}

      <div className="kpis" data-guide="file-kpis">
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
          {c.erased || !(c.memberships.length || sell.live) ? null : (
            <Fold id="abo" guide="file-abonnement" title="Abonnement" icon="card" open={folds.isOpen('abo')} onToggle={() => folds.toggle('abo')}
              summary={liveMembers(c.memberships)[0] ? liveMembers(c.memberships)[0].plan + ' · ' + shortWords(liveMembers(c.memberships)[0], liveMembers(c.memberships)[0]) : 'Aucun'}>
              <MemberBlock c={c} onEdit={() => setEdit(true)} />
            </Fold>
          )}
          {c.erased ? null : <CutNotes clientId={c.id} />}
          {data.packs.length ? (
            <Fold id="carnets" guide="file-carnets" title="Carnets" icon="ticket" open={folds.isOpen('carnets')} onToggle={() => folds.toggle('carnets')}
              summary={(() => { const n = data.packs.reduce((t, p) => t + Math.max(0, p.total - p.used), 0); return n ? n + ' restante' + (n > 1 ? 's' : '') : 'terminés'; })()}>
              {data.packs.map((p) => (
                <div key={p.id} className="cl-pack">
                  <div className="row"><b className="grow">{p.name}</b><span className={'badge ' + (p.used >= p.total ? '' : p.expires < boot.today ? 'badge-warn' : 'badge-ok')}>{p.used >= p.total ? 'terminé' : p.expires < boot.today ? 'expiré' : (p.total - p.used) + ' restante' + (p.total - p.used > 1 ? 's' : '')}</span></div>
                  <div className="cl-dots" aria-label={p.used + ' utilisées sur ' + p.total}>{Array.from({ length: p.total }, (_, i) => <i key={i} className={i < p.used ? 'on' : ''} />)}</div>
                  <small className="faint">Valable jusqu’au {dates.dayShort(p.expires)}</small>
                </div>
              ))}
            </Fold>
          ) : null}
          <Prefs c={c} />
          <AccountCard c={c} />
          <LoyaltyCard c={c} />
        </div>
        <div className="card" data-guide="file-history">
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
                  <span className="li-main"><b>{a.services.join(' + ')}{a.typed ? <span className="faint"> · pour {a.typed}</span> : null}</b><small>{time(a.start)}{st ? ' · ' + st.name : ''}{a.note ? ' · « ' + a.note + ' »' : ''}</small></span>
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
          {can('settings') ? <button type="button" role="menuitem" onClick={() => { setMenu(null); setTakeover(true); }}><Icon name="ticket" />Reprendre un carnet en cours</button> : null}
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
    <div className="card" data-guide="file-tech">
      <div className="card-h"><h2><Icon name="scissors" size={16} />Fiche technique</h2><small className="faint">{state === 'saving' ? 'Enregistrement…' : state === 'saved' ? 'Enregistré' : ''}</small></div>
      {favStaff || favSvc ? <p className="muted" style={{ fontSize: 13.5, margin: '-4px 0 10px' }}>{favSvc ? 'Prend souvent : ' + favSvc : ''}{favStaff && favSvc ? ' · ' : ''}{favStaff ? 'Habitué de ' + favStaff : ''}</p> : null}
      <textarea className="input textarea" rows={4} value={tech} readOnly={ro} maxLength={500} placeholder="Dégradé, hauteur des côtés, sabot, produit, ce qu’il n’aime pas…" onChange={(e) => { setTech(e.target.value); save({ tech: e.target.value }); }} aria-label="Fiche technique" />
      <label className="section-k" htmlFor="cl-notes" style={{ display: 'block', margin: '14px 0 8px' }}>Notes privées</label>
      <textarea id="cl-notes" className="input textarea" rows={2} value={notes} readOnly={ro} maxLength={1000} placeholder="Allergies, préférences, sujets de conversation… Le client peut demander à lire ses notes." onChange={(e) => { setNotes(e.target.value); save({ notes: e.target.value }); }} />
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>Visible par l’équipe ; remis au client s’il demande ses données.</p>
    </div>
  );
}

const CONSENT_SRC: Record<string, string> = { site: 'site', salon: 'au salon', stop: 'STOP par SMS', wordpress: 'jamais demandé (ancien site)', espace: 'depuis son espace' };
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
    <div className="card col" style={{ gap: 10 }} data-guide="file-prefs">
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
      {data?.old ? <Note tone="warn" icon="info">Il reste dans l’ancien site et sa copie complète : efface-le aussi là-bas.</Note> : null}
      {!data ? <Skeleton h={60} /> : n || data.packs.length || data.giftcards.length || data.memberships?.length ? (
        <div className="cl-open">
          <b className="section-k">Encore ouvert sur sa fiche</b>
          <ul>
            {data.appts.map((a) => <li key={a.id}><Icon name="calendar" size={15} /><span>{cap(dayShortWord(a.day, boot.today))} à {time(a.start)} · {a.services.join(' + ')}{staffById.get(a.staffId) ? ' avec ' + staffById.get(a.staffId)!.name : ''}{a.passed ? ' · passé, jamais clôturé' : ''}{a.deposit ? ' · acompte de ' + eur(a.deposit, { decimals: a.deposit % 100 !== 0 }) + ' remboursé' : ''}</span></li>)}
            {data.memberships?.map((m) => <li key={m.id}><Icon name="card" size={15} /><span>Abonnement {m.plan} en cours : résilie l’abonnement d’abord (sa fiche, bloc Abonnement).</span></li>)}
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
        <Button variant="danger" busy={busy} disabled={!data || (n > 0 && !cancel) || !!data.memberships?.length} onClick={go}>Effacer définitivement</Button>
      </div>
    </Modal>
  );
}

/** A carnet started on the old site (paper card, WordPress): the cuts left and until when, on this file. */
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
      toast({ title: 'Carnet repris', sub: plural(left, 'coupe restante', 'coupes restantes') + ' jusqu’au ' + dates.dayShort(expires), icon: 'check' });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Reprendre un carnet en cours" kicker={c.first + ' ' + c.last} footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!ok} onClick={go}>Reprendre le carnet</Button></>}>
      <p className="muted">Pour un carnet vendu sur l’ancien site ou sur carton : il n’entre pas dans la caisse du jour (déjà payé), seules les coupes restantes sont reprises.</p>
      {packs.length === 1 ? <p>Carnet : <b>{packs[0].name}</b> ({plural(credits, 'coupe')})</p> : null}
      {packs.length > 1 ? (
        <Field label="Carnet" htmlFor="pk-s"><select id="pk-s" className="input select" value={sid} onChange={(e) => { const x = packs.find((p) => p.id === e.target.value); setSid(e.target.value); setLeft(Math.min(left, Math.max(1, (x?.pack?.credits || 5) - 1))); setExpires(dates.addDays(boot.today, x?.pack?.days || 70)); }}>{packs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      ) : null}
      <Field label="Coupes restantes">
        <div className="chips">{Array.from({ length: Math.max(1, credits - 1) }, (_, i) => i + 1).map((v) => <Chip key={v} on={left === v} onClick={() => setLeft(v)}>{v}</Chip>)}</div>
      </Field>
      <Field label="Valable jusqu’au" htmlFor="pk-e" error={expires < boot.today ? 'Ce carnet a déjà expiré.' : null}><input id="pk-e" className="input" type="date" value={expires} min={boot.today} onChange={(e) => setExpires(e.target.value)} /></Field>
    </Sheet>
  );
}
