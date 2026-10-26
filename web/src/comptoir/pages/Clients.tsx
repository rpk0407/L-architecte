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
import './clients.css';

type ListData = { total: number; counts: Record<string, number>; items: ClientCard[] };
type FileData = {
  client: ClientFull;
  appts: { id: string; day: string; start: number; dur: number; status: string; services: string[]; staffId: string; price: number; source: string; saleId: string | null; note: string }[];
  sales: { id: string; ref: string; day: string; due: number; revenue: number; refunded: number; lines: string[] }[];
  packs: { id: string; name: string; used: number; total: number; expires: string; soldAt: number }[];
  messages: { id: string; template: string; status: string; at: number }[];
};

const SEGMENTS: { v: string; t: string; hint: string }[] = [
  { v: 'all', t: 'Tous', hint: '' },
  { v: 'relancer', t: 'À relancer', hint: 'En retard sur leur rythme habituel et joignables par SMS.' },
  { v: 'fideles', t: 'Fidèles', hint: 'Viennent régulièrement depuis plusieurs mois.' },
  { v: 'nouveaux', t: 'Nouveaux', hint: 'Première visite il y a moins de 30 jours, ou pas encore venus.' },
  { v: 'abonnes', t: 'Abonnés', hint: 'Ont un abonnement en cours.' },
  { v: 'vip', t: 'VIP', hint: '' },
  { v: 'absents', t: 'Absences', hint: 'Ont déjà manqué un rendez-vous sans prévenir.' },
  { v: 'anniversaires', t: 'Anniversaires', hint: 'Fêtent leur anniversaire ce mois-ci.' }
];
const SORTS = [{ v: 'recent', t: 'Dernière visite' }, { v: 'overdue', t: 'À relancer d’abord' }, { v: 'spend', t: 'Dépense' }, { v: 'visits', t: 'Visites' }, { v: 'name', t: 'Nom' }];
const TAGS = ['VIP', 'Barbe', 'Enfant', 'Étudiant', 'Sensible', 'Parle peu'];
const MSG: Record<string, string> = { confirm: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', moved: 'Déplacement', cancelled: 'Annulation', review: 'Demande d’avis', rebook: 'Relance', receipt: 'Reçu', waitlist: 'Créneau libéré', deposit: 'Lien d’acompte' };

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
  useEffect(() => { setLimit(60); }, [dq, seg, sort]);
  const { data, loading } = useQuery<ListData>('/api/v1/clients' + qs({ q: dq.trim(), segment: seg, sort, limit }));
  const hint = SEGMENTS.find((s) => s.v === seg)?.hint;
  return (
    <section className="card cl-list">
      <div className="row" style={{ gap: 8 }}>
        <label className="search grow"><Icon name="search" /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou numéro" aria-label="Rechercher un client" autoComplete="off" /></label>
        {can('client.edit') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}><span className="hide-phone">Nouveau</span></Button> : null}
      </div>
      <div className="chips cl-segs" role="tablist" aria-label="Segments">
        {SEGMENTS.map((s) => <Chip key={s.v} small on={seg === s.v} onClick={() => setQuery({ segment: s.v === 'all' ? null : s.v, tri: null })}>{s.t}{data?.counts[s.v] != null ? <span className="cnt">{data.counts[s.v]}</span> : null}</Chip>)}
      </div>
      <div className="row cl-tools">
        <span className="muted grow" style={{ fontSize: 13 }}>{data ? plural(data.total, 'client') : ''}{hint ? ' · ' + hint : ''}</span>
        <select className="input select cl-sort" value={sort} onChange={(e) => setQuery({ tri: e.target.value })} aria-label="Trier">{SORTS.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}</select>
        {can('client.export') ? <a className="btn btn-ghost btn-sm btn-icon" href="/api/v1/export?kind=clients" download aria-label="Exporter en CSV" title="Exporter en CSV"><Icon name="download" /></a> : null}
      </div>
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
      <NewClient open={creating} onClose={() => setCreating(false)} initial={q} />
    </section>
  );
}

export function badgeTone(b: string) {
  return b === 'fidèle' || b === 'abonné' ? 'badge-ok' : b === 'nouveau' ? 'badge-info' : b === 'absences' ? 'badge-warn' : b === 'VIP' ? 'badge-accent' : '';
}

function NewClient({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: string }) {
  const [f, setF] = useState({ first: '', last: '', phone: '', email: '', sms: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const digits = initial.replace(/\D/g, '');
    const words = digits.length >= 6 ? [] : initial.trim().split(/\s+/);
    setF({ first: cap(words[0] || ''), last: cap(words.slice(1).join(' ')), phone: digits.length >= 6 ? initial : '', email: '', sms: true });
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/v1/clients', { first: f.first, last: f.last, phone: f.phone || undefined, email: f.email || undefined, sms: f.sms });
      toast({ title: 'Fiche créée', sub: f.first + ' ' + f.last, icon: 'check' });
      refreshAll(); onClose(); navigate('/clients/' + r.id);
    } catch (e: any) {
      if (e.code === 'exists' && e.extra?.id) toast({ kind: 'info', title: 'Ce numéro a déjà une fiche', icon: 'user', action: { label: 'Ouvrir', run: () => { onClose(); navigate('/clients/' + e.extra.id); } } });
      else toastError(e);
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nouveau client" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!f.first.trim()} onClick={go}>Créer la fiche</Button></>}>
      <div className="grid2">
        <Field label="Prénom" htmlFor="nc-f"><input id="nc-f" className="input" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} autoComplete="off" /></Field>
        <Field label="Nom" htmlFor="nc-l"><input id="nc-l" className="input" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} autoComplete="off" /></Field>
      </div>
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
            {c.tags.filter((t) => t !== 'VIP').map((t) => <span key={t} className="badge">{t}</span>)}
          </div>
          <p className="cl-contact">
            {c.hasPhone ? contact ? <a href={'tel:' + c.phone.replace(/\s/g, '')}><Icon name="phone" size={14} />{c.phone}</a> : <span><Icon name="phone" size={14} />{c.phone}</span> : <span className="faint">Pas de numéro</span>}
            {c.email ? <span><Icon name="globe" size={14} />{c.email}</span> : null}
            <span className="faint">Client depuis {monthYear(c.createdAt)}{c.source === 'site' ? ' · venu par le site' : ''}</span>
          </p>
        </div>
        <div className="cl-acts">
          {can('agenda.own') ? <Button variant="primary" icon="calendar" onClick={() => navigate('/agenda?new=1&client=' + c.id)}>Prendre RDV</Button> : null}
          {can('client.edit') ? <Button icon="edit" aria-label="Modifier" onClick={() => setEdit(true)} /> : null}
          {can('agenda.edit') || can('client.erase') ? <Button icon="more" aria-label="Plus d’actions" onClick={(e) => setMenu((e.currentTarget as HTMLElement).getBoundingClientRect())} /> : null}
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
        </div>
        <div className="card">
          <div className="tabs" role="tablist" style={{ marginTop: -6 }}>
            <button type="button" role="tab" aria-selected={tab === 'rdv'} onClick={() => setTab('rdv')}>Rendez-vous<span className="count">{data.appts.length}</span></button>
            {data.sales.length ? <button type="button" role="tab" aria-selected={tab === 'tickets'} onClick={() => setTab('tickets')}>Tickets<span className="count">{data.sales.length}</span></button> : null}
            <button type="button" role="tab" aria-selected={tab === 'sms'} onClick={() => setTab('sms')}>SMS<span className="count">{data.messages.length}</span></button>
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
              <li key={m.id} className="li"><Icon name="sms" size={18} /><span className="li-main"><b>{MSG[m.template] || m.template}</b><small>{cap(dates.dayShort(dates.localParts(m.at).day))} · {time(dates.localParts(m.at).min)}</small></span><span className={'badge ' + (m.status === 'sent' ? 'badge-ok' : m.status === 'failed' ? 'badge-danger' : '')}>{({ sent: 'envoyé', failed: 'échec', simulated: 'simulé (démo)', skipped: 'non envoyé', claimed: 'en cours' } as Record<string, string>)[m.status] || 'en file'}</span></li>
            ))}</ul>
          ) : <Empty icon="sms" title="Aucun SMS">{c.sms ? 'Confirmations, rappels et relances apparaîtront ici.' : 'Il a refusé les SMS.'}</Empty>}
        </div>
      </div>

      <EditClient open={edit} c={c} onClose={() => setEdit(false)} />
      <MergeModal open={merge} into={c} onClose={() => setMerge(false)} />
      {menu ? (
        <Menu anchor={menu} onClose={() => setMenu(null)}>
          {can('agenda.edit') ? <button type="button" role="menuitem" onClick={() => { setMenu(null); setMerge(true); }}><Icon name="copy" />Fusionner un doublon</button> : null}
          {can('client.erase') ? <button type="button" role="menuitem" className="danger" onClick={async () => {
            setMenu(null);
            const yes = await confirm({ title: 'Effacer ' + c.first + ' ' + c.last + ' ?', body: 'Son nom, son numéro, ses notes et sa fiche technique sont supprimés définitivement (droit à l’effacement, RGPD). Les tickets restent dans la comptabilité, sans son nom.', ok: 'Effacer définitivement', danger: true });
            if (!yes) return;
            try { await api.post('/api/v1/clients/' + c.id + '/erase'); toast({ title: 'Fiche effacée', icon: 'trash' }); refreshAll(); navigate('/clients'); } catch (e) { toastError(e); }
          }}><Icon name="trash" />Effacer (RGPD)</button> : null}
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
      <div><b>{c.first} n’est pas revenu depuis {c.sinceLast} jours.</b> {c.cadence ? 'Il venait ' + rhythmWords(c.cadence) + ' : un' : 'Une seule visite jusqu’ici : un'} petit SMS avec le lien de réservation suffit souvent.</div>
      {can('marketing') && c.sms && c.hasPhone ? <Button size="sm" variant="ghost" icon="sms" disabled={sent} onClick={async () => { try { const r = await api.post<{ sent: number }>('/api/v1/relances/send', { clientIds: [c.id] }); setSent(true); toast(r.sent ? 'Relance envoyée' : 'Déjà relancé aujourd’hui'); refreshAll(); } catch (e) { toastError(e); } }}>{sent ? 'Envoyé' : 'Relancer'}</Button> : null}
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
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>Visible par l’équipe uniquement, jamais envoyé au client.</p>
    </div>
  );
}

function Prefs({ c }: { c: ClientFull }) {
  const { can } = useApp();
  const ro = !can('client.edit');
  const patch = async (p: Record<string, unknown>) => { try { await api.patch('/api/v1/clients/' + c.id, p); refreshAll(); } catch (e) { toastError(e); } };
  const toggleTag = (t: string) => patch({ tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t].slice(0, 8) });
  return (
    <div className="card col" style={{ gap: 10 }}>
      <div className="card-h"><h2><Icon name="star" size={16} />Préférences</h2></div>
      <div className="chips">{TAGS.map((t) => <Chip key={t} small on={c.tags.includes(t)} disabled={ro} onClick={() => toggleTag(t)}>{t}</Chip>)}</div>
      <Switch on={c.sms} disabled={ro} onChange={(v) => patch({ sms: v })} title="SMS de confirmation et de rappel" hint={c.sms ? 'Activés' : 'Il a demandé à ne plus en recevoir'} />
      <Switch on={c.marketing} disabled={ro} onChange={(v) => patch({ marketing: v })} title="Offres et nouveautés" hint="Consentement marketing, révocable à tout moment" />
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

function MergeModal({ open, into, onClose }: { open: boolean; into: ClientFull; onClose: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 180);
  const [pick, setPick] = useState<ClientCard | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQ(into.first); setPick(null); } }, [open]);
  const res = useQuery<ListData>(open && dq.trim().length >= 2 ? '/api/v1/clients' + qs({ q: dq.trim(), limit: 8 }) : null);
  const items = (res.data?.items || []).filter((x) => x.id !== into.id);
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    try { await api.post('/api/v1/clients/merge', { from: pick.id, into: into.id }); toast({ title: 'Fiches fusionnées', sub: 'Tout l’historique est maintenant sur la fiche de ' + into.first, icon: 'check' }); refreshAll(); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label="Fusionner un doublon">
      <h2>Fusionner un doublon</h2>
      <p>Choisis l’autre fiche de {into.first}. Ses rendez-vous, tickets et abonnements passent sur celle-ci ; les infos manquantes sont complétées.</p>
      <label className="search"><Icon name="search" /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou numéro" autoFocus /></label>
      <ul className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
        {items.map((x) => <li key={x.id}><button type="button" className="li" aria-pressed={pick?.id === x.id} onClick={() => setPick(x)}><span className="li-main"><b>{x.first} {x.last}</b><small>{x.phone || 'sans numéro'} · {plural(x.visits, 'visite')}</small></span>{pick?.id === x.id ? <Icon name="check" /> : null}</button></li>)}
        {dq.trim().length >= 2 && res.data && !items.length ? <li className="muted" style={{ padding: 12 }}>Aucune autre fiche trouvée.</li> : null}
      </ul>
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={!pick} onClick={go}>Fusionner</Button></div>
    </Modal>
  );
}
