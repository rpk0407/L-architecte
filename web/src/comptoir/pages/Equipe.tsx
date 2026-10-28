// L'équipe: who works when, who does what, how they are paid, and how they get in.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, uuid } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, setQuery, useRoute } from '../../lib/router';
import { cap, dates, eur, hhmm, plural, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Chip, Field, Modal, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../ui/kit';
import { photoOf, useApp } from '../state';
import { PageTitle } from '../App';
import type { Agenda, Staff } from '../types';
import { PhoneList, PhoneQR, usePhones } from './reglages/Phone';
import './equipe.css';

// conflicts: appointments still on it; status: a request (pending, refused); publicNote: what the site may say meanwhile
type TimeOff = { id: string; staffId: string; from: string; to: string; startMin?: number; endMin?: number; reason: string; publicNote?: string; conflicts?: number; status?: 'pending' | 'refused' };
type TeamData = { items: Staff[]; timeoff: TimeOff[]; requests?: TimeOff[] };
export const COLORS = ['#EB4639', '#F5B544', '#4ADE80', '#60A5FA', '#C084FC', '#F472B6', '#2DD4BF', '#FB923C', '#A3E635', '#E5E7EB'];
const ROLE_HINT: Record<string, string> = {
  owner: 'Tout, y compris les réglages, les appareils et les données.',
  manager: 'Tout sauf les réglages du salon, les appareils et l’effacement RGPD.',
  desk: 'Agenda de tous, encaissement, caisse, clients et relances. Pas de remise au-delà de 20 %.',
  barber: 'Son agenda, ses clients, ses chiffres. Le reste se règle dans Réglages › Équipe et accès.'
};

export default function Equipe() {
  const { can } = useApp();
  // without `team` the list of staff is refused by the server: each one sees their own card instead
  return can('team') ? <TeamPage /> : <MyCard />;
}

function TeamPage() {
  const route = useRoute();
  const { data, loading } = useQuery<TeamData>('/api/v1/staff');
  if (loading && !data) return <><PageTitle><h1>Équipe</h1></PageTitle><div className="eq-grid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={190} r={22} />)}</div></>;
  if (!data) return null;
  const st = route.id ? data.items.find((x) => x.id === route.id) : null;
  // ?absence=<id>: the plan of that absence (the agenda's banner, a request just approved)
  const plan = <HandoverSheet id={route.query.get('absence')} onClose={() => setQuery({ absence: null })} />;
  if (route.id && st) return <><Member key={st.id} st={st} timeoff={data.timeoff.filter((t) => t.staffId === st.id)} />{plan}</>;
  return <><Team data={data} />{plan}</>;
}
const openPlan = (t: TimeOff) => setQuery({ absence: t.id });

/** Absences barbers asked for: the owner says yes (and replaces their clients) or no. */
function Requests({ items, staff }: { items: TimeOff[]; staff: Staff[] }) {
  const [busy, setBusy] = useState('');
  const decide = async (t: TimeOff, yes: boolean) => {
    setBusy(t.id + yes);
    try { await decideRequest(t.id, yes, staff.find((s) => s.id === t.staffId)?.name || ''); } finally { setBusy(''); }
  };
  return (
    <section className="card eq-requests" data-guide="equipe-requests">
      <div className="card-h"><h2><Icon name="bell" size={16} />Demandes d’absence</h2><span className="badge badge-accent">{items.length}</span></div>
      <ul className="list">
        {items.map((t) => {
          const s = staff.find((x) => x.id === t.staffId);
          return (
            <li key={t.id} className="li eq-req">
              {s ? <Avatar name={s.name} initials={s.initials} color={s.color} size="sm" /> : null}
              <span className="li-main">
                <b>{s?.name} demande {rangeText(t)}</b>
                <small>{t.reason}{t.conflicts ? ' · ' + plural(t.conflicts, 'rdv', 'rdv') + ' à replacer' : ' · aucun rendez-vous à replacer'}</small>
              </span>
              <span className="eq-req-acts">
                <Button size="sm" variant="ghost" busy={busy === t.id + 'false'} onClick={() => decide(t, false)}>Refuser</Button>
                <Button size="sm" variant="primary" icon="check" busy={busy === t.id + 'true'} onClick={() => decide(t, true)}>Valider</Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
/** Yes: the absence is posted, then its plan opens if clients are on it. No: the barber sees it refused. */
export async function decideRequest(id: string, yes: boolean, name: string) {
  try {
    if (!yes) { await api.post('/api/v1/timeoff/' + id + '/refuse'); toast({ title: 'Demande refusée', sub: name ? name + ' le voit dans ses absences.' : undefined }); refreshAll(); return; }
    const r = await api.post<{ conflicts: number }>('/api/v1/timeoff/' + id + '/approve');
    refreshAll();
    if (r.conflicts) navigate('/equipe?absence=' + id);
    else toast({ title: 'Absence validée', sub: 'Ses créneaux ne sont plus proposés en ligne.', icon: 'check' });
  } catch (e) {
    // withdrawn by the barber meanwhile (the toast was still up): nothing to decide, not an error
    if (e instanceof ApiError && e.status === 404) { toast({ title: 'Demande retirée', sub: name ? name + ' l’a retirée entre-temps.' : undefined }); refreshAll(); }
    else toastError(e);
  }
}

/* ---------------- my own card (no `team`) ---------------- */

function MyCard() {
  const { boot } = useApp();
  const st = boot.staff.find((x) => x.id === boot.me.id) || boot.me;
  const w = weekOf(st.schedule);
  const shop = boot.settings.hours as Record<string, [number, number][]>;
  const total = weekMinutes(w);
  return (
    <>
      <PageTitle><h1>Ma fiche</h1></PageTitle>
      <div className="eq-member">
        <div className="col" style={{ gap: 16 }}>
          <section className="card col" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 16 }}>
              <Avatar name={st.name} initials={st.initials} color={st.color} photo={photoOf(st)} size="xl" />
              <div className="grow">
                <p className="section-k">{ROLE_LABEL[st.role]}{st.chair ? ' · fauteuil' : ''}</p>
                <h2 className="eq-h">{st.name}</h2>
              </div>
            </div>
            {/* only a chair has a schedule, services and a profile on the site */}
            <p className="muted" style={{ fontSize: 13.5 }}>{st.chair ? <>Tes horaires et tes prestations se changent avec le gérant. Ta couleur et ta présentation sur le site, dans <Link to="/reglages/compte" className="link">Mon compte</Link>.</> : <>Ton accès se règle avec le gérant. Ton code et ton mot de passe, dans <Link to="/reglages/compte" className="link">Mon compte</Link>.</>}</p>
          </section>
          {st.chair ? (
            <section className="card">
              <div className="card-h"><h2><Icon name="clock" size={16} />Mes horaires</h2><span className="faint" style={{ fontSize: 13 }}>{Math.floor(total / 60)} h{total % 60 ? String(total % 60).padStart(2, '0') : ''} par semaine</span></div>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <div key={d} className="kv">
                  <span>{cap(dates.DAYS_FR[d])}</span>
                  {w[d].length ? <span className="tnum">{w[d].map(([a, b]) => hhmm(a) + ' – ' + hhmm(b)).join(' · ')}</span> : <span className="faint">{(shop[d] || []).length ? 'Repos' : 'Salon fermé'}</span>}
                </div>
              ))}
            </section>
          ) : null}
        </div>
        {st.chair ? <MyAbsences st={st} /> : null}
      </div>
    </>
  );
}

/* ---------------- the team at a glance ---------------- */

function Team({ data }: { data: TeamData }) {
  const { boot, pulse, now } = useApp();
  const today = pulse?.today || boot.today;
  const ag = useQuery<Agenda>('/api/v1/agenda?day=' + today);
  const [adding, setAdding] = useState(false);
  const [off, setOff] = useState(false);
  const nowMin = dates.localParts(now()).min;
  const active = data.items.filter((x) => x.active);
  const archived = data.items.filter((x) => !x.active);
  const upcoming = data.timeoff.filter((t) => t.to >= today).sort((a, b) => a.from.localeCompare(b.from));
  const requests = (data.requests || []).filter((q) => q.status === 'pending');
  const status = (s: Staff) => {
    const lane = ag.data?.lanes.find((l) => l.id === s.id);
    const offToday = data.timeoff.find((t) => t.staffId === s.id && t.from <= today && t.to >= today && t.startMin == null);
    if (offToday) return { tone: 'warn', text: offToday.reason + (offToday.to > today ? ' jusqu’au ' + dates.dayShort(offToday.to) : ' aujourd’hui') };
    if (!s.chair) return { tone: '', text: s.role === 'desk' ? 'À l’accueil' : 'Sans fauteuil · gère le salon' };
    if (!lane || !lane.work.length) return { tone: '', text: 'Ne travaille pas aujourd’hui' };
    const chair = ag.data?.appts.find((a) => a.staffId === s.id && a.status === 'in_chair');
    if (chair) return { tone: 'accent', text: 'Avec ' + chair.name + ' jusqu’à ' + time(chair.start + chair.dur) };
    const next = ag.data?.appts.filter((a) => a.staffId === s.id && ['booked', 'arrived'].includes(a.status) && a.start >= nowMin).sort((a, b) => a.start - b.start)[0];
    const end = lane.work[lane.work.length - 1][1];
    if (nowMin >= end) return { tone: '', text: 'Journée terminée' };
    if (nowMin < lane.work[0][0]) return { tone: '', text: 'Arrive à ' + time(lane.work[0][0]) };
    return { tone: 'ok', text: next ? 'Libre · prochain client à ' + time(next.start) : 'Libre jusqu’à ' + time(end) };
  };
  const load = (s: Staff) => {
    const appts = (ag.data?.appts || []).filter((a) => a.staffId === s.id && !['cancelled', 'no_show'].includes(a.status));
    const lane = ag.data?.lanes.find((l) => l.id === s.id);
    const open = (lane?.work || []).reduce((t, [a, b]) => t + b - a, 0);
    return { n: appts.length, fill: open ? Math.min(1, appts.reduce((t, a) => t + a.dur, 0) / open) : 0 };
  };
  return (
    <>
      <PageTitle><h1>Équipe</h1></PageTitle>
      <div className="row wrap eq-bar" data-guide="equipe-bar">
        <p className="muted grow">{plural(active.filter((x) => x.chair).length, 'fauteuil')} · {plural(active.length, 'personne')}</p>
        <Button variant="ghost" icon="calendar" onClick={() => setOff(true)}>Poser une absence</Button>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Ajouter</Button>
      </div>
      {requests.length ? <Requests items={requests} staff={data.items} /> : null}
      <div className="eq-grid" data-guide="equipe-list">
        {active.map((s) => {
          const stt = status(s);
          const l = load(s);
          const days = Object.entries(s.schedule || {}).filter(([, v]) => v.length).map(([k]) => Number(k));
          return (
            <Link key={s.id} to={'/equipe/' + s.id} className="card eq-card">
              <div className="row" style={{ gap: 14 }}>
                <Avatar name={s.name} initials={s.initials} color={s.color} photo={photoOf(s)} size="lg" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <b className="eq-name">{s.name}</b>
                  <small className="muted">{s.roleLabel}{s.chair ? ' · fauteuil' : ''}{!s.bookable && s.chair ? ' · pas en ligne' : ''}</small>
                </div>
                <Icon name="chevR" size={18} />
              </div>
              <p className={'eq-status ' + stt.tone}><i />{stt.text}</p>
              {s.chair ? (
                <>
                  <div className="eq-week" aria-label="Jours travaillés">{[1, 2, 3, 4, 5, 6, 0].map((d) => <span key={d} className={days.includes(d) ? 'on' : ''}>{dates.DAYS_SH[d].slice(0, 1).toUpperCase()}</span>)}</div>
                  <div className="eq-load"><span>{l.n ? plural(l.n, 'rendez-vous', 'rendez-vous') + ' aujourd’hui' : 'Aucun rendez-vous aujourd’hui'}</span><span className="tr" aria-hidden><i style={{ width: l.fill * 100 + '%', background: s.color }} /></span></div>
                </>
              ) : null}
              <div className="eq-access">
                <span className={'badge ' + (s.hasPin ? 'badge-ok' : 'badge-warn')}><Icon name="key" size={12} />{s.hasPin ? 'Code PIN' : 'Pas de PIN'}</span>
                {s.hasPwd ? <span className="badge"><Icon name="lock" size={12} />Mot de passe</span> : null}
                {s.chair ? <span className="badge">{s.commission ? s.commission.service / 100 + ' % prestations' : ''}</span> : null}
              </div>
            </Link>
          );
        })}
      </div>

      <section className="card" style={{ marginTop: 16 }} data-guide="equipe-absences">
        <div className="card-h"><h2><Icon name="calendar" size={16} />Absences à venir</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
        {upcoming.length ? <TimeOffList items={upcoming} staff={data.items} onPlan={openPlan} /> : <p className="muted">Personne n’est absent dans les jours qui viennent.</p>}
      </section>

      {archived.length ? (
        <details className="card eq-archived">
          <summary>{plural(archived.length, 'ancien membre')}</summary>
          <ul className="list">{archived.map((s) => <li key={s.id} className="li"><Avatar name={s.name} initials={s.initials} color="var(--panel3)" size="sm" /><span className="li-main"><b>{s.name}</b><small>{s.roleLabel} · désactivé</small></span><Button size="sm" variant="ghost" onClick={async () => { try { await api.post('/api/v1/staff/' + s.id + '/archive', { restore: true }); refreshAll(); toast(s.name + ' est de retour'); } catch (e) { toastError(e); } }}>Réactiver</Button></li>)}</ul>
        </details>
      ) : null}
      <AddMember open={adding} onClose={() => setAdding(false)} />
      <TimeOffSheet open={off} onClose={() => setOff(false)} staff={active.filter((x) => x.chair)} />
    </>
  );
}

/** "vendredi 30 octobre", "du vendredi 30 au samedi 31 octobre", "jeudi 29 octobre, de 10:00 à 12:00". */
export function rangeText(t: { from: string; to: string; startMin?: number | null; endMin?: number | null }) {
  if (t.from !== t.to) {
    const a = dates.dayParts(t.from), b = dates.dayParts(t.to);
    return 'du ' + (a.m === b.m ? dates.DAYS_FR[a.wd] + ' ' + a.d : dates.dayLong(t.from)) + ' au ' + dates.dayLong(t.to);
  }
  return dates.dayLong(t.from) + (t.startMin != null && t.endMin != null ? ', de ' + time(t.startMin) + ' à ' + time(t.endMin) : '');
}

export function TimeOffList({ items, staff, onPlan }: { items: TimeOff[]; staff: Staff[]; onPlan?: (t: TimeOff) => void }) {
  const { can, boot } = useApp();
  const remove = async (t: TimeOff) => {
    const ask = t.status === 'pending';
    if (t.status !== 'refused' && !await confirm(ask ? { title: 'Retirer cette demande ?', body: 'Le gérant ne la verra plus.', ok: 'Retirer', danger: true } : { title: 'Supprimer cette absence ?', body: 'Les créneaux redeviennent réservables en ligne.', ok: 'Supprimer', danger: true })) return;
    try { await api.del('/api/v1/timeoff/' + t.id); refreshAll(); toast(ask ? 'Demande retirée' : t.status === 'refused' ? 'Demande retirée de la liste' : 'Absence supprimée'); } catch (e) { toastError(e); }
  };
  return (
    <ul className="list">
      {items.map((t) => {
        const s = staff.find((x) => x.id === t.staffId);
        const mine = s?.id === boot.me.id;
        const n = t.conflicts || 0;
        return (
          <li key={t.id} className="li eq-off">
            {s ? <Avatar name={s.name} initials={s.initials} color={s.color} size="sm" /> : null}
            <span className="li-main">
              <b>{s?.name} · {t.reason}</b>
              <small>{t.from === t.to ? cap(dates.dayShort(t.from)) + (t.startMin != null ? ' de ' + time(t.startMin) + ' à ' + time(t.endMin!) : ', toute la journée') : 'Du ' + dates.dayShort(t.from) + ' au ' + dates.dayShort(t.to) + ' · ' + plural(dates.diffDays(t.from, t.to) + 1, 'jour')}{t.publicNote ? ' · « ' + t.publicNote + ' »' : ''}</small>
            </span>
            {/* where it stands, and what it still lands on (the owner replaces them from here): under the text on a phone */}
            {t.status || n ? (
              <span className="eq-off-act">
                {t.status === 'pending' ? <span className="badge badge-warn">en attente du gérant</span> : t.status === 'refused' ? <span className="badge">refusée</span> : null}
                {!t.status && n ? (onPlan ? <Button size="sm" variant="subtle" icon="move" onClick={() => onPlan(t)}>{plural(n, 'rdv', 'rdv')} à replacer</Button> : <span className="badge badge-warn">{plural(n, 'rdv', 'rdv')} à replacer</span>) : null}
              </span>
            ) : null}
            {can('team') || mine ? <Button size="sm" variant="ghost" icon="trash" aria-label={t.status ? 'Retirer la demande' : 'Supprimer'} onClick={() => remove(t)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- the handover plan: the clients an absence lands on ---------------- */

type Prop = { staffId: string; day: string; start: number };
// online: still in time to change it himself (else 'ask' means the salon calls him: the link would refuse him)
type PlanRow = { id: string; day: string; start: number; dur: number; name: string; services: string[]; price: number; status: string; deposit: number; textable: boolean; asked: boolean; online?: boolean; same: Prop | null; nearest: Prop | null; choice: 'same' | 'nearest' | 'ask' };
// back: the first day he works again, for the site's note
type Plan = { staffId: string; from: string; to: string; startMin: number | null; endMin: number | null; count: number; rows: PlanRow[]; back?: string | null };
type Pick = 'same' | 'nearest' | 'ask' | 'cancel' | 'keep';
type Picks = Record<string, Pick>;
type Applied = { moved: number; asked: number; toCall?: number; cancelled: number; texted: number; refunded: number; unrefunded?: number; left: number };
/** Can 'ask' text this client a link he can use? */
const askable = (r: PlanRow) => r.textable && r.online !== false;

/** The plan of an absence, posted or not (POST /api/v1/timeoff/preview), fetched again when the journal moves. */
function usePlan(body: Record<string, unknown> | null) {
  const { pulse } = useApp();
  const key = body ? JSON.stringify(body) : '';
  const [st, setSt] = useState<{ key: string; data?: Plan; error?: string }>({ key: '' });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    // typing dates fires a few changes in a row: ask once they settle
    const t = window.setTimeout(() => {
      api.post<Plan>('/api/v1/timeoff/preview', JSON.parse(key)).then((d) => { if (alive) setSt({ key, data: d }); }, (e) => { if (alive) setSt({ key, error: e?.message || 'Erreur' }); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [key, pulse?.version]);
  return st.key === key && key ? { data: st.data, error: st.error, loading: false } : { data: undefined, error: undefined, loading: !!key };
}
const defaults = (rows: PlanRow[], picks: Picks): Picks => Object.fromEntries(rows.map((r) => [r.id, picks[r.id] || (r.asked ? 'keep' : r.choice)]));

/** Apply the plan: moves, texts and cancellations in one go on the server. */
async function applyPlan(id: string, plan: Plan, picks: Picks) {
  const p = defaults(plan.rows, picks);
  const moves = plan.rows.filter((r) => (p[r.id] === 'same' && r.same) || (p[r.id] === 'nearest' && r.nearest)).map((r) => { const to = (p[r.id] === 'same' ? r.same : r.nearest)!; return { apptId: r.id, staffId: to.staffId, start: to.start }; });
  const body = { moves, ask: plan.rows.filter((r) => p[r.id] === 'ask').map((r) => r.id), cancel: plan.rows.filter((r) => p[r.id] === 'cancel').map((r) => r.id) };
  const res = await api.post<Applied>('/api/v1/timeoff/' + id + '/reassign', body);
  const call = res.toCall || 0, owed = res.unrefunded || 0;
  const done = [res.moved ? plural(res.moved, 'client') + ' replacé' + (res.moved > 1 ? 's' : '') : '', res.asked ? plural(res.asked, 'client') + ' invité' + (res.asked > 1 ? 's' : '') + ' à choisir' : '', call ? call + ' à appeler' : '', res.cancelled ? plural(res.cancelled, 'annulation') : ''].filter(Boolean);
  // a deposit not given back (no right to refund, or the refund failed) is said: it is done from the appointment's sheet
  const sub = [res.texted ? plural(res.texted, 'SMS', 'SMS') + ' envoyé' + (res.texted > 1 ? 's' : '') : 'Aucun SMS', res.refunded ? plural(res.refunded, 'acompte') + ' remboursé' + (res.refunded > 1 ? 's' : '') : '', owed ? plural(owed, 'acompte') + ' à rembourser depuis la fiche du rendez-vous' : '', res.left ? plural(res.left, 'rdv', 'rdv') + ' encore chez lui' : ''].filter(Boolean).join(' · ');
  toast({ title: done.length ? cap(done.join(', ')) : 'Rien à changer', sub, icon: owed ? 'alert' : 'check', ttl: owed || call ? 10000 : 6000 });
  refreshAll();
  return res;
}

/** One line per appointment: when, who, and what happens to it (editable by whoever can move it). */
function PlanList({ plan, picks, setPicks, editable, flag }: { plan: Plan; picks: Picks; setPicks: (p: Picks) => void; editable: boolean; flag?: string }) {
  const { staffById } = useApp();
  const p = defaults(plan.rows, picks);
  const absent = staffById.get(plan.staffId)?.name || 'lui';
  const days = [...new Set(plan.rows.map((r) => r.day))];
  const n = (k: Pick, f: (r: PlanRow) => boolean = () => true) => plan.rows.filter((r) => p[r.id] === k && f(r)).length;
  const where = (to: Prop) => (to.staffId === plan.staffId ? 'Décalé à ' + time(to.start) : 'Chez ' + (staffById.get(to.staffId)?.name || '?') + ' à ' + time(to.start));
  // where each client goes now: an option on a chair another row already takes is not offered (the server would refuse the plan)
  const target = (r: PlanRow) => (p[r.id] === 'same' ? r.same : p[r.id] === 'nearest' ? r.nearest : null);
  const takenBy = (r: PlanRow, to: Prop) => plan.rows.find((o) => { const x = o.id !== r.id ? target(o) : null; return !!x && x.staffId === to.staffId && x.day === to.day && x.start < to.start + r.dur && to.start < x.start + o.dur; });
  const opt = (r: PlanRow, k: 'same' | 'nearest', to: Prop) => { const o = takenBy(r, to); return <option value={k} disabled={!!o}>{where(to)}{o ? ' · pris pour ' + o.name : ''}</option>; };
  const asks = n('ask', askable), calls = n('ask') - asks;
  const sum = [n('same') ? n('same') + ' à la même heure avec un autre barbier' : '', n('nearest') ? n('nearest') + ' à une autre heure de la journée' : '', asks ? asks + ' à qui on demande de choisir' : '', calls ? calls + ' à appeler' : '', n('cancel') ? plural(n('cancel'), 'annulation') : '', n('keep') ? n('keep') + ' laissé' + (n('keep') > 1 ? 's' : '') + ' pour l’instant' : ''].filter(Boolean);
  return (
    <div className="eq-plan">
      <Note tone="warn" icon="alert"><b>{plural(plan.count, 'rendez-vous', 'rendez-vous')} chez {absent}</b> pendant son absence.{editable && sum.length ? ' ' + cap(sum.join(', ')) + '.' : editable ? '' : ' Ils ne sont pas annulés : le gérant les replace, le client est prévenu par SMS.'}</Note>
      {days.map((d) => (
        <div key={d} className="eq-plan-day">
          {days.length > 1 ? <p className="section-k">{cap(dates.dayLong(d))}</p> : null}
          <ul className="list">
            {plan.rows.filter((r) => r.day === d).map((r) => (
              <li key={r.id} className={'li eq-plan-row' + (flag === r.id ? ' eq-plan-err' : '')}>
                <span className="eq-plan-t tnum"><b>{time(r.start)}</b><small>{r.dur} min</small></span>
                <span className="li-main">
                  <b>{r.name}</b>
                  <small>{r.services.join(' + ')} · {eur(r.price)}{r.deposit ? ' · acompte ' + eur(r.deposit) : ''}{r.asked ? ' · déjà invité à choisir' : !r.textable ? ' · pas de SMS possible' : r.online === false ? ' · trop tard pour changer en ligne' : ''}</small>
                </span>
                {editable ? (
                  <select className="input select eq-plan-pick" aria-label={'Pour ' + r.name + ' à ' + time(r.start)} value={p[r.id]} onChange={(e) => setPicks({ ...picks, [r.id]: e.target.value as Pick })}>
                    {r.same ? opt(r, 'same', r.same) : null}
                    {r.nearest ? opt(r, 'nearest', r.nearest) : null}
                    <option value="ask">{askable(r) ? 'Lui demander de choisir (SMS)' : r.textable ? 'À appeler (trop tard pour le lien)' : 'À appeler (pas de SMS)'}</option>
                    <option value="cancel">Annuler le rendez-vous{r.textable ? ' (SMS)' : ''}</option>
                    <option value="keep">Laisser pour l’instant</option>
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The plan of an absence already posted (from its list, the agenda's banner or an approved request). */
export function HandoverSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { staffById } = useApp();
  const plan = usePlan(id ? { id } : null);
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);
  const [flag, setFlag] = useState('');
  useEffect(() => { setPicks({}); setFlag(''); }, [id]);
  const d = plan.data;
  const go = async () => {
    if (!id || !d) return;
    setBusy(true);
    try { const r = await applyPlan(id, d, picks); setPicks({}); setFlag(''); if (!r.left) onClose(); } catch (e) { setFlag(refusedRow(e)); toastError(e); } finally { setBusy(false); }
  };
  const who = d ? staffById.get(d.staffId)?.name || '' : '';
  return (
    <Sheet open={!!id} onClose={onClose} wide title={d ? 'Les clients de ' + who : 'Absence'} kicker={d ? 'Absent ' + rangeText(d) : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Fermer</Button><span className="grow" /><Button variant="primary" icon="sms" busy={busy} disabled={!d || !d.count} onClick={go}>Appliquer et prévenir</Button></>}>
      {plan.error ? <Note tone="err" icon="alert">{plan.error}</Note> : !d ? <Skeleton h={220} r={18} /> : d.count ? <PlanList plan={d} picks={picks} setPicks={setPicks} editable flag={flag} /> : <Note tone="ok" icon="check">Plus aucun rendez-vous chez {who} pendant son absence.</Note>}
    </Sheet>
  );
}

/** The appointment a refused plan names (a slot taken since the preview, two rows on one chair): its row is marked. */
const refusedRow = (e: unknown) => (e instanceof ApiError && e.extra && typeof e.extra.apptId === 'string' ? e.extra.apptId : '');

const REASONS = ['Congés', 'Maladie', 'Formation', 'Rendez-vous perso', 'Récupération'];
export function TimeOffSheet({ open, onClose, staff, fixed }: { open: boolean; onClose: () => void; staff: Staff[]; fixed?: string }) {
  const { boot, can } = useApp();
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(boot.today);
  const [to, setTo] = useState(boot.today);
  const [hours, setHours] = useState(false);
  const [sm, setSm] = useState(600);
  const [em, setEm] = useState(720);
  const [reason, setReason] = useState('Congés');
  const [note, setNote] = useState('');
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);
  // the absence once posted: from then on a tap only applies its plan, it never posts a second, identical absence
  const [posted, setPosted] = useState('');
  const [flag, setFlag] = useState('');
  // one request id per absence asked for: a tap retried after a lost answer finds the first one
  const rid = useRef({ key: '', id: '' });
  useEffect(() => { if (open) { setWho(fixed || staff.find((s) => s.chair)?.id || ''); setFrom(boot.today); setTo(boot.today); setHours(false); setReason('Congés'); setNote(''); setPicks({}); setPosted(''); setFlag(''); } }, [open]);
  const ok = !!who && (hours ? em > sm : to >= from);
  // whoever may hand clients over (the owner) plans it here; a barber sees what his absence lands on
  const planner = can('team') && can('agenda.edit');
  const asks = !can('team') && boot.settings.team?.timeoffApproval !== false;
  const range = { from, to: hours ? from : to, ...(hours ? { startMin: sm, endMin: em } : {}) };
  const plan = usePlan(!open ? null : posted ? { id: posted } : ok ? { staffId: who, ...range } : null);
  const rows = plan.data?.count || 0;
  const name = staff.find((s) => s.id === who)?.name || '';
  // the day he works again (his week, the salon's hours and closures), not just the day after
  const back = plan.data?.back ? dates.dayParts(plan.data.back) : null;
  const suggest = name && back ? name + ' revient le ' + (back.d === 1 ? '1er' : back.d) + ' ' + dates.MONTHS_FR[back.m - 1] : '';
  const go = async (apply: boolean) => {
    setBusy(true);
    try {
      let id = posted;
      if (!id) {
        const body = { staffId: who, ...range, reason, ...(note.trim() ? { publicNote: note.trim() } : {}) };
        const key = JSON.stringify(body);
        if (rid.current.key !== key) rid.current = { key, id: uuid() };
        const r = await api.post<{ id: string; requested?: boolean; conflicts: number }>('/api/v1/timeoff', body, rid.current.id);
        if (r.requested) toast({ title: 'Demande envoyée au gérant', sub: 'Tes créneaux restent ouverts jusqu’à sa validation.', icon: 'check' });
        // the agenda's banner reminds whoever can hand them over; a barber's clients are the owner's to move
        else if (!(apply && plan.data && rows)) toast({ title: 'Absence posée', sub: r.conflicts ? plural(r.conflicts, 'rendez-vous', 'rendez-vous') + (planner ? ' encore à replacer : l’agenda te le rappelle.' : ' encore chez toi : le gérant les replace et prévient tes clients.') : 'Ces créneaux ne sont plus proposés en ligne.', icon: 'check' });
        if (r.requested || !(apply && plan.data && rows)) { refreshAll(); onClose(); return; }
        id = r.id;
        setPosted(id);
        refreshAll();
      }
      if (!plan.data) return;
      await applyPlan(id, plan.data, picks);
      onClose();
    } catch (e) { setFlag(refusedRow(e)); toastError(e); } finally { setBusy(false); }
  };
  const footer = (
    <div className="eq-foot">
      <Button variant="ghost" onClick={onClose}>{posted ? 'Fermer' : 'Annuler'}</Button><span className="grow" />
      {planner && rows && !posted ? <Button variant="ghost" busy={busy} disabled={!ok} onClick={() => go(false)}>Poser seulement</Button> : null}
      <Button variant="primary" icon={planner && rows ? 'sms' : undefined} busy={busy} disabled={!ok || plan.loading || (!!posted && !rows)} onClick={() => go(true)}>{asks ? 'Envoyer la demande' : planner && (rows || posted) ? 'Appliquer et prévenir' : 'Poser l’absence'}</Button>
    </div>
  );
  if (posted) {
    // posted, its plan refused (a slot taken meanwhile, two rows on one chair): change a row and apply again
    return (
      <Sheet open={open} onClose={onClose} wide title="Ses clients à replacer" kicker={name + ' · absent ' + rangeText(range)} footer={footer}>
        <Note tone="ok" icon="check"><b>Absence posée.</b> Ses créneaux ne sont plus proposés en ligne. Il reste à replacer ses clients : change ce qui coince et applique à nouveau, ou ferme, l’agenda te les rappelle.</Note>
        {plan.error ? <Note tone="err" icon="alert">{plan.error}</Note> : plan.data && rows ? <PlanList plan={plan.data} picks={picks} setPicks={setPicks} editable flag={flag} /> : plan.loading ? <Skeleton h={220} r={18} /> : <Note tone="ok" icon="check">Plus aucun rendez-vous chez {name} pendant son absence.</Note>}
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={onClose} wide={planner && rows > 0} title="Poser une absence" footer={footer}>
      {!fixed ? <Field label="Qui"><div className="chips">{staff.map((s) => <Chip key={s.id} dot={s.color} on={who === s.id} onClick={() => setWho(s.id)}>{s.name}</Chip>)}</div></Field> : null}
      <div className="chips">{REASONS.map((r) => <Chip key={r} small on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
      <Switch on={hours} onChange={setHours} title="Quelques heures seulement" hint="Un rendez-vous chez le médecin, une sortie d’école…" />
      {hours ? (
        <div className="grid3">
          <Field label="Le" htmlFor="to-d"><input id="to-d" className="input" type="date" value={from} min={boot.today} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label="De" htmlFor="to-s"><TimeSelect id="to-s" value={sm} onChange={setSm} /></Field>
          <Field label="À" htmlFor="to-e"><TimeSelect id="to-e" value={em} onChange={setEm} /></Field>
        </div>
      ) : (
        <div className="grid2">
          <Field label="Du" htmlFor="to-f"><input id="to-f" className="input" type="date" value={from} min={boot.today} onChange={(e) => { if (!e.target.value) return; setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label="Au (inclus)" htmlFor="to-t"><input id="to-t" className="input" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        </div>
      )}
      {/* WP-06 shows it on the site while he is away */}
      {!hours ? (
        <Field label="Mot pour le site (facultatif)" hint={note ? note.length + ' / 80' : 'Affiché sur sa fiche tant qu’il est absent.'} htmlFor="to-n">
          <div className="row" style={{ gap: 8 }}>
            <input id="to-n" className="input grow" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} placeholder={suggest} />
            {!note && suggest ? <Button size="sm" variant="ghost" onClick={() => setNote(suggest)}>Proposer</Button> : null}
          </div>
        </Field>
      ) : null}
      {plan.error ? <Note tone="err" icon="alert">{plan.error}</Note> : plan.data && rows ? <PlanList plan={plan.data} picks={picks} setPicks={setPicks} editable={planner} flag={flag} /> : plan.loading ? <Skeleton h={64} r={16} /> : plan.data ? <p className="muted" style={{ fontSize: 13.5 }}>Aucun rendez-vous pendant cette absence.</p> : null}
      {asks ? <Note icon="info">Le gérant valide ta demande : tes créneaux restent ouverts d’ici là.</Note> : null}
    </Sheet>
  );
}

/** "Mes absences": posted, asked for (waiting or refused), for whoever has a chair (Ma fiche, Mon compte). */
export function MyAbsences({ st }: { st: Staff }) {
  const mine = useQuery<{ items: TimeOff[]; requests: TimeOff[]; approval: boolean }>('/api/v1/timeoff/mine');
  const [off, setOff] = useState(false);
  const list = [...(mine.data?.requests || []), ...(mine.data?.items || [])].sort((a, b) => a.from.localeCompare(b.from));
  return (
    <section className="card" id="absences" data-guide="equipe-mes-absences">
      <div className="card-h"><h2><Icon name="calendar" size={16} />Mes absences</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
      {list.length ? <TimeOffList items={list} staff={[st]} /> : <p className="muted">{mine.data?.approval ? 'Aucune absence prévue. Une absence posée ici part au gérant : tes créneaux restent ouverts jusqu’à sa validation.' : 'Aucune absence prévue. Une absence posée ici retire tes créneaux du site immédiatement.'}</p>}
      <TimeOffSheet open={off} onClose={() => { setOff(false); refreshAll(); }} staff={[st]} fixed={st.id} />
    </section>
  );
}

export function TimeSelect({ id, value, onChange, min = 360, max = 1380 }: { id?: string; value: number; onChange: (m: number) => void; min?: number; max?: number }) {
  const opts: number[] = [];
  for (let m = min; m <= max; m += 15) opts.push(m);
  return <select id={id} className="input select" value={value} onChange={(e) => onChange(Number(e.target.value))}>{opts.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}</select>;
}

function AddMember({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { boot } = useApp();
  const [f, setF] = useState({ name: '', role: 'barber' as Staff['role'], pin: '', email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ name: '', role: 'barber', pin: String(Math.floor(1000 + Math.random() * 9000)), email: '' }); }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/v1/staff', { name: f.name.trim(), role: f.role, pin: f.pin, email: f.email || undefined });
      toast({ title: f.name + ' fait partie de l’équipe', sub: 'Code PIN : ' + f.pin + '. Note-le, il ne sera plus affiché.', icon: 'check', ttl: 12000 });
      refreshAll(); onClose(); navigate('/equipe/' + r.id);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nouveau membre" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2 || !/^\d{4,6}$/.test(f.pin)} onClick={go}>Ajouter</Button></>}>
      <Field label="Prénom ou surnom" hint="Comme les clients l’appellent : il s’affiche sur le site." htmlFor="am-n"><input id="am-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></Field>
      <Field label="Rôle" hint={ROLE_HINT[f.role]}>
        <div className="chips">{(['barber', 'desk', 'manager', ...(boot.me.role === 'owner' ? ['owner'] : [])] as Staff['role'][]).map((r) => <Chip key={r} on={f.role === r} onClick={() => setF({ ...f, role: r })}>{{ barber: 'Barbier', desk: 'Accueil', manager: 'Responsable', owner: 'Gérant' }[r]}</Chip>)}</div>
      </Field>
      <Field label="Code PIN (4 à 6 chiffres)" hint="Pour se connecter en deux secondes sur les appareils du salon." htmlFor="am-p"><input id="am-p" className="input tnum" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
      {f.role === 'manager' || f.role === 'owner' ? <Field label="E-mail (pour se connecter de chez soi)" htmlFor="am-e"><input id="am-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field> : null}
      <Note icon="info">Ses horaires reprennent ceux du salon ; ajuste-les sur sa fiche. Il apparaît sur le site dès qu’il prend des rendez-vous en ligne.</Note>
    </Sheet>
  );
}

/* ---------------- one member ---------------- */

function Member({ st, timeoff }: { st: Staff; timeoff: TimeOff[] }) {
  const { boot } = useApp();
  const [off, setOff] = useState(false);
  const upcoming = timeoff.filter((t) => t.to >= boot.today).sort((a, b) => a.from.localeCompare(b.from));
  return (
    <>
      <PageTitle><h1>{st.name}</h1></PageTitle>
      <button type="button" className="cl-back eq-back" onClick={() => navigate('/equipe')}><Icon name="chevL" size={16} />Équipe</button>
      <div className="eq-member">
        <div className="col" style={{ gap: 16 }}>
          <div data-guide="equipe-profil"><Profile st={st} /></div>
          {st.chair ? <section className="card" data-guide="equipe-horaires"><div className="card-h"><h2><Icon name="clock" size={16} />Horaires de la semaine</h2></div><ScheduleEditor st={st} /></section> : null}
          {st.chair ? <div data-guide="equipe-prestations"><ServicesCard st={st} /></div> : null}
        </div>
        <div className="col" style={{ gap: 16 }}>
          {st.chair ? (
            <section className="card">
              <div className="card-h"><h2><Icon name="calendar" size={16} />Absences</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
              {upcoming.length ? <TimeOffList items={upcoming} staff={[st]} onPlan={openPlan} /> : <p className="muted">Aucune absence prévue.</p>}
            </section>
          ) : null}
          {st.chair ? <div data-guide="equipe-commission"><Commission st={st} /></div> : null}
          <div data-guide="equipe-acces"><Access st={st} /></div>
        </div>
      </div>
      <TimeOffSheet open={off} onClose={() => setOff(false)} staff={[st]} fixed={st.id} />
    </>
  );
}

function Profile({ st }: { st: Staff }) {
  const { boot, reloadBoot } = useApp();
  const from = () => ({ name: st.name, initials: st.initials, color: st.color, bio: st.bio, instagram: st.instagram, email: st.email || '', role: st.role, chair: st.chair, bookable: st.bookable });
  const [f, setF] = useState(from);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(from());
  const save = async () => {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      const was = from() as Record<string, unknown>;
      for (const [k, v] of Object.entries(f)) if (was[k] !== v) patch[k] = v;
      await api.patch('/api/v1/staff/' + st.id, patch);
      toast({ title: 'Fiche enregistrée', icon: 'check' }); refreshAll(); reloadBoot().catch(() => {});
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 16 }}>
        <Avatar name={f.name} initials={f.initials} color={f.color} photo={photoOf(st)} size="xl" />
        <div className="grow">
          <p className="section-k">{ROLE_LABEL[f.role]}</p>
          <h2 className="eq-h">{f.name || '—'}</h2>
        </div>
      </div>
      <div className="grid2">
        <Field label="Nom affiché" htmlFor="pf-n"><input id="pf-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Initiales" htmlFor="pf-i"><input id="pf-i" className="input" value={f.initials} maxLength={3} onChange={(e) => setF({ ...f, initials: e.target.value.toUpperCase() })} /></Field>
      </div>
      <Field label="Couleur dans l’agenda"><div className="eq-colors">{COLORS.map((c) => <button key={c} type="button" aria-label={'Couleur ' + c} aria-pressed={f.color === c} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}</div></Field>
      {/* one's own role is set by another (the server refuses it: self_role) */}
      {st.id === boot.me.id ? null : <Field label="Rôle" hint={ROLE_HINT[f.role]}>
        <div className="chips">{(['barber', 'desk', 'manager', 'owner'] as Staff['role'][]).filter((r) => r !== 'owner' || boot.me.role === 'owner').map((r) => <Chip key={r} on={f.role === r} onClick={() => setF({ ...f, role: r })}>{ROLE_LABEL[r]}</Chip>)}</div>
      </Field>}
      <Switch on={f.chair} onChange={(v) => setF({ ...f, chair: v, bookable: v ? f.bookable : false })} title="A un fauteuil" hint="Apparaît comme colonne dans l’agenda." />
      <Switch on={f.bookable} disabled={!f.chair} onChange={(v) => setF({ ...f, bookable: v })} title="Réservable en ligne" hint="Les clients peuvent le choisir sur le site." />
      <Field label="Présentation sur le site" hint={f.bio.length + ' / 280'} htmlFor="pf-b"><textarea id="pf-b" className="input textarea" rows={3} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Spécialiste des dégradés, 8 ans de métier…" /></Field>
      <div className="grid2">
        <Field label="Instagram" htmlFor="pf-ig"><input id="pf-ig" className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="@pseudo" /></Field>
        <Field label="E-mail" htmlFor="pf-e"><input id="pf-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      {dirty ? <div className="row"><span className="grow faint" style={{ fontSize: 13 }}>Modifications non enregistrées</span><Button variant="ghost" onClick={() => setF(from())}>Annuler</Button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2} onClick={save}>Enregistrer</Button></div> : null}
    </section>
  );
}
const ROLE_LABEL: Record<string, string> = { barber: 'Barbier', desk: 'Accueil', manager: 'Responsable', owner: 'Gérant' };

export type Week = Record<number, [number, number][]>;
export const weekOf = (src?: Record<string, [number, number][]>): Week => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, (src?.[d] || []).map((x) => [...x] as [number, number])]));
export const weekMinutes = (w: Week) => Object.values(w).reduce((t, d) => t + d.reduce((x, [a, b]) => x + b - a, 0), 0);
/** The first problem in a week, in words, or null. */
export function weekProblem(w: Week) {
  for (const [d, iv] of Object.entries(w)) for (let i = 0; i < iv.length; i++) {
    if (iv[i][1] <= iv[i][0]) return cap(dates.DAYS_FR[Number(d)]) + ' : la fin doit suivre le début.';
    if (i && iv[i][0] < iv[i - 1][1]) return cap(dates.DAYS_FR[Number(d)]) + ' : les plages se chevauchent.';
  }
  return null;
}

/** A week of opening or working hours: each day on or off, with breaks. */
export function WeekEditor({ value, onChange, reference, offLabel }: { value: Week; onChange: (w: Week) => void; reference?: Record<string, [number, number][]>; offLabel: (d: number) => string }) {
  const set = (d: number, v: [number, number][]) => onChange({ ...value, [d]: v });
  return (
    <div className="col" style={{ gap: 4 }}>
      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
        const iv = value[d] || [];
        return (
          <div key={d} className={'eq-day' + (iv.length ? '' : ' off')}>
            <button type="button" role="switch" aria-checked={iv.length > 0} className="eq-day-k" onClick={() => set(d, iv.length ? [] : (reference?.[d]?.length ? reference[d].map((x) => [...x] as [number, number]) : [[540, 1140]]))}>
              <span className="switch-k" aria-hidden><i /></span><b>{cap(dates.DAYS_FR[d])}</b>
            </button>
            {iv.length ? (
              <div className="eq-spans">
                {iv.map(([a, b], i) => (
                  <span key={i} className="eq-span">
                    <TimeSelect value={a} onChange={(m) => set(d, iv.map((x, j) => (j === i ? [m, x[1]] : x)))} />
                    <span className="faint">→</span>
                    <TimeSelect value={b} onChange={(m) => set(d, iv.map((x, j) => (j === i ? [x[0], m] : x)))} />
                    {iv.length > 1 ? <Button size="sm" variant="ghost" icon="x" aria-label="Retirer cette plage" onClick={() => set(d, iv.filter((_, j) => j !== i))} /> : null}
                  </span>
                ))}
                {iv.length < 3 ? <button type="button" className="link eq-add" onClick={() => { const last = iv[iv.length - 1]; const mid = Math.round((last[0] + last[1]) / 2 / 30) * 30; set(d, [...iv.slice(0, -1), [last[0], mid], [Math.min(mid + 60, last[1] - 30), last[1]]]); }}>+ pause</button> : null}
              </div>
            ) : <span className="faint eq-off">{offLabel(d)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function ScheduleEditor({ st, onSaved }: { st: Staff; onSaved?: () => void }) {
  const { boot, reloadBoot } = useApp();
  const [w, setW] = useState<Week>(() => weekOf(st.schedule));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setW(weekOf(st.schedule)); }, [st.id, JSON.stringify(st.schedule)]);
  const dirty = JSON.stringify(w) !== JSON.stringify(weekOf(st.schedule));
  const shop = boot.settings.hours as Record<string, [number, number][]>;
  const total = useMemo(() => weekMinutes(w), [w]);
  const save = async () => {
    const pb = weekProblem(w);
    if (pb) { toast({ kind: 'err', title: pb }); return; }
    setBusy(true);
    try {
      await api.patch('/api/v1/staff/' + st.id, { schedule: w });
      toast({ title: 'Horaires enregistrés', sub: 'Le site propose les nouveaux créneaux tout de suite.', icon: 'check' });
      refreshAll(); reloadBoot().catch(() => {}); onSaved?.();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <>
      <WeekEditor value={w} onChange={setW} reference={shop} offLabel={(d) => ((shop[d] || []).length ? 'Repos' : 'Salon fermé')} />
      <div className="row" style={{ marginTop: 10 }}>
        <span className="grow faint" style={{ fontSize: 13 }}>{Math.floor(total / 60)} h{total % 60 ? String(total % 60).padStart(2, '0') : ''} par semaine</span>
        {dirty ? <><Button variant="ghost" onClick={() => setW(weekOf(st.schedule))}>Annuler</Button><Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button></> : null}
      </div>
    </>
  );
}

function ServicesCard({ st }: { st: Staff }) {
  const { boot } = useApp();
  const all = st.services === 'all' || !st.services;
  const [sel, setSel] = useState<Set<string>>(new Set(all ? boot.services.map((s) => s.id) : (st.services as string[])));
  const [busy, setBusy] = useState(false);
  const svc = boot.services.filter((s) => s.active && !s.pack);
  const cats = [...new Set(svc.map((s) => s.category))];
  const everything = svc.every((s) => sel.has(s.id));
  const dirty = all ? !everything : JSON.stringify([...sel].filter((id) => svc.some((s) => s.id === id)).sort()) !== JSON.stringify([...(st.services as string[])].filter((id) => svc.some((s) => s.id === id)).sort());
  const save = async () => {
    setBusy(true);
    try { await api.patch('/api/v1/staff/' + st.id, { services: everything ? 'all' : [...sel] }); toast({ title: 'Prestations enregistrées', icon: 'check' }); refreshAll(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <div className="card-h"><h2><Icon name="scissors" size={16} />Ce qu’il fait</h2><span className="faint" style={{ fontSize: 13 }}>{everything ? 'Toutes les prestations' : sel.size + ' sur ' + svc.length}</span></div>
      <p className="muted" style={{ fontSize: 13.5, marginBottom: 12 }}>Le site ne le propose que pour ce qu’il fait. Une couleur, une décoloration : à cocher seulement s’il maîtrise.</p>
      {cats.map((c) => (
        <div key={c} style={{ marginBottom: 10 }}>
          <p className="section-k" style={{ marginBottom: 8 }}>{c}</p>
          <div className="chips">{svc.filter((s) => s.category === c).map((s) => <Chip key={s.id} small on={sel.has(s.id)} onClick={() => { const n = new Set(sel); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setSel(n); }}>{s.name}</Chip>)}</div>
        </div>
      ))}
      {dirty ? <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" busy={busy} disabled={!sel.size} onClick={save}>Enregistrer</Button></div> : null}
    </section>
  );
}

function Commission({ st }: { st: Staff }) {
  const { boot } = useApp();
  // a manager's own rate is the owner's call (the server refuses it: self_commission): shown, not editable
  const fixed = st.id === boot.me.id && boot.me.role !== 'owner';
  const [svc, setSvc] = useState(String((st.commission?.service ?? 0) / 100));
  const [prd, setPrd] = useState(String((st.commission?.product ?? 0) / 100));
  const [busy, setBusy] = useState(false);
  const month = useQuery<any>('/api/v1/reports?staff=' + st.id);
  const row = month.data?.staff?.[0];
  const toBp = (x: string) => Math.round(Math.min(100, Math.max(0, Number(x.replace(',', '.')) || 0)) * 100);
  const dirty = toBp(svc) !== (st.commission?.service ?? 0) || toBp(prd) !== (st.commission?.product ?? 0);
  const save = async () => {
    setBusy(true);
    try { await api.patch('/api/v1/staff/' + st.id, { commission: { service: toBp(svc), product: toBp(prd) } }); toast({ title: 'Commission enregistrée', icon: 'check' }); refreshAll(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="card-h"><h2><Icon name="percent" size={16} />Rémunération</h2><Link to={'/rapports?barbier=' + st.id} className="link">Ses chiffres</Link></div>
      <div className="grid2">
        <Field label="Sur les prestations (%)" htmlFor="cm-s"><input id="cm-s" className="input tnum" inputMode="decimal" value={svc} readOnly={fixed} onChange={(e) => setSvc(e.target.value)} /></Field>
        <Field label="Sur les produits (%)" htmlFor="cm-p"><input id="cm-p" className="input tnum" inputMode="decimal" value={prd} readOnly={fixed} onChange={(e) => setPrd(e.target.value)} /></Field>
      </div>
      {row ? <div className="eq-month"><span>Ce mois : <b className="money">{eur(row.revenue)}</b> de chiffre, <b className="money">{eur(row.tips)}</b> de pourboires</span><span>Commission estimée <b className="serif money" style={{ fontSize: 26 }}>{eur(row.commission)}</b></span></div> : <Skeleton h={48} />}
      {fixed ? <p className="faint" style={{ fontSize: 13 }}>Ta commission se règle avec le gérant.</p> : dirty ? <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button></div> : null}
    </section>
  );
}

function Access({ st }: { st: Staff }) {
  const { boot } = useApp();
  const [pin, setPin] = useState(false);
  const [pwd, setPwd] = useState(false);
  const me = boot.me.id === st.id;
  const revoke = async () => {
    if (!await confirm({ title: 'Déconnecter ' + st.name + ' partout ?', body: 'Toutes ses sessions sont fermées immédiatement, sur tous les appareils.', ok: 'Déconnecter', danger: true })) return;
    try { await api.post('/api/v1/staff/' + st.id + '/revoke'); toast('Sessions fermées'); } catch (e) { toastError(e); }
  };
  const archive = async () => {
    if (!await confirm({ title: 'Désactiver ' + st.name + ' ?', body: 'Il ne peut plus se connecter et disparaît du site. Son historique, ses ventes et ses chiffres sont conservés. Ses rendez-vous à venir restent dans l’agenda : pense à les réattribuer.', ok: 'Désactiver', danger: true })) return;
    try { await api.post('/api/v1/staff/' + st.id + '/archive', {}); toast(st.name + ' a été désactivé'); refreshAll(); navigate('/equipe'); } catch (e) { toastError(e); }
  };
  return (
    <section className="card col" style={{ gap: 10 }}>
      <div className="card-h"><h2><Icon name="key" size={16} />Accès</h2></div>
      <div className="kv"><span>Code PIN (postes du salon et téléphone lié)</span><span className="row" style={{ gap: 8 }}><span className={'badge ' + (st.hasPin ? 'badge-ok' : 'badge-warn')}>{st.hasPin ? 'défini' : 'aucun'}</span><Button size="sm" variant="ghost" onClick={() => setPin(true)}>{st.hasPin ? 'Changer' : 'Définir'}</Button></span></div>
      {['owner', 'manager'].includes(st.role) ? <div className="kv"><span>Mot de passe (connexion de partout)</span><span className="row" style={{ gap: 8 }}><span className={'badge ' + (st.hasPwd ? 'badge-ok' : '')}>{st.hasPwd ? 'défini' : 'aucun'}</span><Button size="sm" variant="ghost" onClick={() => setPwd(true)}>{st.hasPwd ? 'Changer' : 'Définir'}</Button></span></div> : null}
      {boot.settings.team?.personalPhones !== false ? <LinkedPhones st={st} me={me} /> : null}
      <p className="faint" style={{ fontSize: 12.5 }}>Chacun entre avec son code sur les postes du salon et sur son téléphone lié.</p>
      <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
        <Button size="sm" variant="ghost" icon="logout" onClick={revoke}>Déconnecter partout</Button>
        {!me ? <Button size="sm" variant="danger" icon="trash" onClick={archive}>Désactiver</Button> : null}
      </div>
      <SecretModal open={pin} onClose={() => setPin(false)} st={st} kind="pin" />
      <SecretModal open={pwd} onClose={() => setPwd(false)} st={st} kind="password" />
    </section>
  );
}

/** TEAM-02: the member's linked phones (count, Retirer) and the QR that links one more. */
function LinkedPhones({ st, me }: { st: Staff; me: boolean }) {
  const phones = usePhones(st.id);
  const n = phones.data?.items.length ?? 0;
  return (
    <>
      <div className="kv"><span>Téléphones liés</span><span className={'badge ' + (n ? 'badge-ok' : '')}>{n ? plural(n, 'téléphone') : 'aucun'}</span></div>
      {n ? <PhoneList st={st} self={me} /> : null}
      <div data-guide="equipe-phones"><PhoneQR st={st} self={me} compact /></div>
    </>
  );
}

function SecretModal({ open, onClose, st, kind }: { open: boolean; onClose: () => void; st: Staff; kind: 'pin' | 'password' }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(kind === 'pin' ? String(Math.floor(1000 + Math.random() * 9000)) : ''); }, [open]);
  const ok = kind === 'pin' ? /^\d{4,6}$/.test(v) && !/^(\d)\1+$/.test(v) && !'0123456789'.includes(v) && !'9876543210'.includes(v) : v.length >= 10;
  const go = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/staff/' + st.id + '/' + kind, kind === 'pin' ? { pin: v } : { password: v });
      toast({ title: kind === 'pin' ? 'Nouveau code pour ' + st.name + ' : ' + v : 'Mot de passe changé', sub: kind === 'pin' ? 'Donne-le-lui de vive voix.' : 'Ses autres sessions sont fermées.', icon: 'key', ttl: 10000 });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} label={kind === 'pin' ? 'Code PIN' : 'Mot de passe'}>
      <h2>{kind === 'pin' ? 'Code PIN de ' + st.name : 'Mot de passe de ' + st.name}</h2>
      <p>{kind === 'pin' ? '4 à 6 chiffres, pas de suite évidente. Il pourra le changer lui-même ensuite.' : '10 caractères minimum. Une phrase courte se retient mieux qu’un mot compliqué.'}</p>
      <input className={'input' + (kind === 'pin' ? ' tnum eq-pin' : '')} type={kind === 'pin' ? 'text' : 'password'} inputMode={kind === 'pin' ? 'numeric' : undefined} autoComplete="new-password" maxLength={kind === 'pin' ? 6 : 128} value={v} onChange={(e) => setV(kind === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value)} autoFocus />
      <div className="acts"><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" busy={busy} disabled={!ok} onClick={go}>Enregistrer</Button></div>
    </Modal>
  );
}

