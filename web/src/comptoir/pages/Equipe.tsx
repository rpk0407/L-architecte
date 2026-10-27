// L'équipe: who works when, who does what, how they are paid, and how they get in.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { Link, navigate, useRoute } from '../../lib/router';
import { cap, dates, eur, hhmm, plural, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Chip, Field, Modal, Note, Sheet, Skeleton, Switch, confirm, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import type { Agenda, Staff } from '../types';
import './equipe.css';

type TimeOff = { id: string; staffId: string; from: string; to: string; startMin?: number; endMin?: number; reason: string };
type TeamData = { items: Staff[]; timeoff: TimeOff[] };
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
  if (route.id && st) return <Member key={st.id} st={st} timeoff={data.timeoff.filter((t) => t.staffId === st.id)} />;
  return <Team data={data} />;
}

/* ---------------- my own card (no `team`) ---------------- */

function MyCard() {
  const { boot } = useApp();
  const st = boot.staff.find((x) => x.id === boot.me.id) || boot.me;
  const mine = useQuery<{ items: TimeOff[] }>(st.chair ? '/api/v1/timeoff/mine' : null);
  const [off, setOff] = useState(false);
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
              <Avatar name={st.name} initials={st.initials} color={st.color} size="xl" />
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
        {st.chair ? (
          <section className="card">
            <div className="card-h"><h2><Icon name="calendar" size={16} />Mes absences</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
            {mine.data?.items.length ? <TimeOffList items={mine.data.items} staff={[st]} /> : <p className="muted">Aucune absence prévue. Une absence posée ici retire tes créneaux du site immédiatement.</p>}
            <TimeOffSheet open={off} onClose={() => setOff(false)} staff={[st]} fixed={st.id} />
          </section>
        ) : null}
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
      <div className="row wrap eq-bar">
        <p className="muted grow">{plural(active.filter((x) => x.chair).length, 'fauteuil')} · {plural(active.length, 'personne')}</p>
        <Button variant="ghost" icon="calendar" onClick={() => setOff(true)}>Poser une absence</Button>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Ajouter</Button>
      </div>
      <div className="eq-grid">
        {active.map((s) => {
          const stt = status(s);
          const l = load(s);
          const days = Object.entries(s.schedule || {}).filter(([, v]) => v.length).map(([k]) => Number(k));
          return (
            <Link key={s.id} to={'/equipe/' + s.id} className="card eq-card">
              <div className="row" style={{ gap: 14 }}>
                <Avatar name={s.name} initials={s.initials} color={s.color} size="lg" />
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

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-h"><h2><Icon name="calendar" size={16} />Absences à venir</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
        {upcoming.length ? <TimeOffList items={upcoming} staff={data.items} /> : <p className="muted">Personne n’est absent dans les jours qui viennent.</p>}
      </section>

      {archived.length ? (
        <details className="card eq-archived">
          <summary>{plural(archived.length, 'ancien membre')}</summary>
          <ul className="list">{archived.map((s) => <li key={s.id} className="li"><Avatar name={s.name} initials={s.initials} color="var(--panel3)" size="sm" /><span className="li-main"><b>{s.name}</b><small>{s.roleLabel} · désactivé</small></span><Button size="sm" variant="ghost" onClick={async () => { try { await api.post('/api/v1/staff/' + s.id + '/archive', { restore: true }); refreshAll(); toast(s.name + ' est de retour'); } catch (e) { toastError(e); } }}>Réactiver</Button></li>)}</ul>
        </details>
      ) : null}
      <AddMember open={adding} onClose={() => setAdding(false)} />
      <TimeOffSheet open={off} onClose={() => setOff(false)} staff={active} />
    </>
  );
}

export function TimeOffList({ items, staff }: { items: TimeOff[]; staff: Staff[] }) {
  const { can, boot } = useApp();
  const remove = async (t: TimeOff) => {
    if (!await confirm({ title: 'Supprimer cette absence ?', body: 'Les créneaux redeviennent réservables en ligne.', ok: 'Supprimer', danger: true })) return;
    try { await api.del('/api/v1/timeoff/' + t.id); refreshAll(); toast('Absence supprimée'); } catch (e) { toastError(e); }
  };
  return (
    <ul className="list">
      {items.map((t) => {
        const s = staff.find((x) => x.id === t.staffId);
        const mine = s?.id === boot.me.id;
        return (
          <li key={t.id} className="li">
            {s ? <Avatar name={s.name} initials={s.initials} color={s.color} size="sm" /> : null}
            <span className="li-main">
              <b>{s?.name} · {t.reason}</b>
              <small>{t.from === t.to ? cap(dates.dayShort(t.from)) + (t.startMin != null ? ' de ' + time(t.startMin) + ' à ' + time(t.endMin!) : ', toute la journée') : 'Du ' + dates.dayShort(t.from) + ' au ' + dates.dayShort(t.to) + ' · ' + plural(dates.diffDays(t.from, t.to) + 1, 'jour')}</small>
            </span>
            {can('team') || mine ? <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={() => remove(t)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

const REASONS = ['Congés', 'Maladie', 'Formation', 'Rendez-vous perso', 'Récupération'];
export function TimeOffSheet({ open, onClose, staff, fixed }: { open: boolean; onClose: () => void; staff: Staff[]; fixed?: string }) {
  const { boot } = useApp();
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(boot.today);
  const [to, setTo] = useState(boot.today);
  const [hours, setHours] = useState(false);
  const [sm, setSm] = useState(600);
  const [em, setEm] = useState(720);
  const [reason, setReason] = useState('Congés');
  const [busy, setBusy] = useState(false);
  const conflicts = useQuery<Agenda>(open && who && from === to ? '/api/v1/agenda?day=' + from : null);
  useEffect(() => { if (open) { setWho(fixed || staff.find((s) => s.chair)?.id || ''); setFrom(boot.today); setTo(boot.today); setHours(false); setReason('Congés'); } }, [open]);
  const clash = (conflicts.data?.appts || []).filter((a) => a.staffId === who && !['cancelled', 'no_show', 'done'].includes(a.status) && (!hours || (a.start < em && a.start + a.dur > sm)));
  const go = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/timeoff', { staffId: who, from, to: hours ? from : to, reason, ...(hours ? { startMin: sm, endMin: em } : {}) });
      toast({ title: 'Absence posée', sub: 'Ces créneaux ne sont plus proposés en ligne.', icon: 'check' });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Poser une absence" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><span className="grow" /><Button variant="primary" busy={busy} disabled={!who || (!hours && to < from) || (hours && em <= sm)} onClick={go}>Poser l’absence</Button></>}>
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
      {clash.length ? <Note tone="warn" icon="alert"><b>{plural(clash.length, 'rendez-vous', 'rendez-vous')}</b> déjà pris ce jour-là ({clash.slice(0, 3).map((a) => time(a.start) + ' ' + a.name).join(', ')}{clash.length > 3 ? '…' : ''}). Ils ne sont pas annulés : déplace-les depuis l’agenda, le client est prévenu par SMS.</Note> : null}
    </Sheet>
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
          <Profile st={st} />
          {st.chair ? <section className="card"><div className="card-h"><h2><Icon name="clock" size={16} />Horaires de la semaine</h2></div><ScheduleEditor st={st} /></section> : null}
          {st.chair ? <ServicesCard st={st} /> : null}
        </div>
        <div className="col" style={{ gap: 16 }}>
          {st.chair ? (
            <section className="card">
              <div className="card-h"><h2><Icon name="calendar" size={16} />Absences</h2><Button size="sm" variant="ghost" icon="plus" onClick={() => setOff(true)}>Poser</Button></div>
              {upcoming.length ? <TimeOffList items={upcoming} staff={[st]} /> : <p className="muted">Aucune absence prévue.</p>}
            </section>
          ) : null}
          {st.chair ? <Commission st={st} /> : null}
          <Access st={st} />
        </div>
      </div>
      <TimeOffSheet open={off} onClose={() => setOff(false)} staff={[st]} fixed={st.id} />
    </>
  );
}

function Profile({ st }: { st: Staff }) {
  const { boot, reloadBoot } = useApp();
  const [f, setF] = useState({ name: st.name, initials: st.initials, color: st.color, bio: st.bio, instagram: st.instagram, email: st.email || '', role: st.role, chair: st.chair, bookable: st.bookable });
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: st.name, initials: st.initials, color: st.color, bio: st.bio, instagram: st.instagram, email: st.email || '', role: st.role, chair: st.chair, bookable: st.bookable });
  const save = async () => {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f)) if ((st as any)[k] !== v && !(k === 'email' && (st.email || '') === v)) patch[k] = v;
      await api.patch('/api/v1/staff/' + st.id, patch);
      toast({ title: 'Fiche enregistrée', icon: 'check' }); refreshAll(); reloadBoot().catch(() => {});
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 16 }}>
        <Avatar name={f.name} initials={f.initials} color={f.color} size="xl" />
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
      <Field label="Rôle" hint={ROLE_HINT[f.role]}>
        <div className="chips">{(['barber', 'desk', 'manager', 'owner'] as Staff['role'][]).filter((r) => r !== 'owner' || boot.me.role === 'owner').map((r) => <Chip key={r} on={f.role === r} onClick={() => setF({ ...f, role: r })}>{ROLE_LABEL[r]}</Chip>)}</div>
      </Field>
      <Switch on={f.chair} onChange={(v) => setF({ ...f, chair: v, bookable: v ? f.bookable : false })} title="A un fauteuil" hint="Apparaît comme colonne dans l’agenda." />
      <Switch on={f.bookable} disabled={!f.chair} onChange={(v) => setF({ ...f, bookable: v })} title="Réservable en ligne" hint="Les clients peuvent le choisir sur le site." />
      <Field label="Présentation sur le site" hint={f.bio.length + ' / 280'} htmlFor="pf-b"><textarea id="pf-b" className="input textarea" rows={3} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Spécialiste des dégradés, 8 ans de métier…" /></Field>
      <div className="grid2">
        <Field label="Instagram" htmlFor="pf-ig"><input id="pf-ig" className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="@pseudo" /></Field>
        <Field label="E-mail" htmlFor="pf-e"><input id="pf-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      {dirty ? <div className="row"><span className="grow faint" style={{ fontSize: 13 }}>Modifications non enregistrées</span><Button variant="ghost" onClick={() => setF({ name: st.name, initials: st.initials, color: st.color, bio: st.bio, instagram: st.instagram, email: st.email || '', role: st.role, chair: st.chair, bookable: st.bookable })}>Annuler</Button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2} onClick={save}>Enregistrer</Button></div> : null}
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
        <Field label="Sur les prestations (%)" htmlFor="cm-s"><input id="cm-s" className="input tnum" inputMode="decimal" value={svc} onChange={(e) => setSvc(e.target.value)} /></Field>
        <Field label="Sur les produits (%)" htmlFor="cm-p"><input id="cm-p" className="input tnum" inputMode="decimal" value={prd} onChange={(e) => setPrd(e.target.value)} /></Field>
      </div>
      {row ? <div className="eq-month"><span>Ce mois : <b className="money">{eur(row.revenue)}</b> de chiffre, <b className="money">{eur(row.tips)}</b> de pourboires</span><span>Commission estimée <b className="serif money" style={{ fontSize: 26 }}>{eur(row.commission)}</b></span></div> : <Skeleton h={48} />}
      {dirty ? <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button></div> : null}
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
      <div className="kv"><span>Code PIN (appareils du salon)</span><span className="row" style={{ gap: 8 }}><span className={'badge ' + (st.hasPin ? 'badge-ok' : 'badge-warn')}>{st.hasPin ? 'défini' : 'aucun'}</span><Button size="sm" variant="ghost" onClick={() => setPin(true)}>{st.hasPin ? 'Changer' : 'Définir'}</Button></span></div>
      {['owner', 'manager'].includes(st.role) ? <div className="kv"><span>Mot de passe (connexion de partout)</span><span className="row" style={{ gap: 8 }}><span className={'badge ' + (st.hasPwd ? 'badge-ok' : '')}>{st.hasPwd ? 'défini' : 'aucun'}</span><Button size="sm" variant="ghost" onClick={() => setPwd(true)}>{st.hasPwd ? 'Changer' : 'Définir'}</Button></span></div> : null}
      <p className="faint" style={{ fontSize: 12.5 }}>Les barbiers et l’accueil se connectent seulement depuis les appareils enregistrés du salon, avec leur code.</p>
      <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
        <Button size="sm" variant="ghost" icon="logout" onClick={revoke}>Déconnecter partout</Button>
        {!me ? <Button size="sm" variant="danger" icon="trash" onClick={archive}>Désactiver</Button> : null}
      </div>
      <SecretModal open={pin} onClose={() => setPin(false)} st={st} kind="pin" />
      <SecretModal open={pwd} onClose={() => setPwd(false)} st={st} kind="password" />
    </section>
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

