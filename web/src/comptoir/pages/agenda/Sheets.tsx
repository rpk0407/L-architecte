// Everything that opens from the agenda: an appointment, a new booking, a move, a walk-in, a block.
import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { navigate } from '../../../lib/router';
import { cap, dates, dayShortWord, dayWord, dur, eur, hhmm, rhythmWords, sinceWords, STATUS, SOURCE, time, ago } from '../../../lib/format';
import { useDebounced } from '../../../lib/hooks';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Chip, Field, Money, Note, Sheet, Switch, confirm, toast, toastError, Skeleton } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Appt, ClientCard, ClientFull, Service } from '../../types';

/* ---------------- shared pickers ---------------- */

export function ServicePicker({ value, onChange, multi = true }: { value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  const { boot } = useApp();
  const groups = useMemo(() => {
    const m = new Map<string, Service[]>();
    for (const s of boot.services.filter((x) => x.active && !x.pack)) { const l = m.get(s.category) || []; l.push(s); m.set(s.category, l); }
    return [...m.entries()];
  }, [boot.services]);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : multi ? [...value, id].slice(-3) : [id]);
  return (
    <div className="col" style={{ gap: 10 }}>
      {groups.map(([cat, list]) => (
        <div key={cat} className="svc-g">
          <p className="section-k">{cat}</p>
          <div className="chips">{list.map((s) => <Chip key={s.id} on={value.includes(s.id)} onClick={() => toggle(s.id)}>{s.short || s.name}<small>{s.from ? 'dès ' : ''}{eur(s.price)} · {dur(s.dur)}</small></Chip>)}</div>
        </div>
      ))}
    </div>
  );
}

export function StaffPicker({ value, onChange, any = true }: { value: string; onChange: (v: string) => void; any?: boolean }) {
  const { boot, can } = useApp();
  const list = boot.staff.filter((s) => s.active && s.chair && (can('agenda.edit') || s.id === boot.me.id));
  return (
    <div className="chips">
      {any && list.length > 1 ? <Chip on={value === 'any'} onClick={() => onChange('any')}>Le premier libre</Chip> : null}
      {list.map((s) => <Chip key={s.id} on={value === s.id} dot={s.color} onClick={() => onChange(s.id)}>{s.name}</Chip>)}
    </div>
  );
}

/** Next free slots over the coming days, for a service and a chair. */
export function SlotPicker({ serviceIds, staffId, day, value, onPick, ignore, horizon = 14 }: { serviceIds: string[]; staffId: string; day: string; value: { day: string; start: number; staffId: string } | null; onPick: (v: { day: string; start: number; staffId: string }) => void; ignore?: string; horizon?: number }) {
  const { boot, staffById } = useApp();
  const [d, setD] = useState(day);
  const days = useMemo(() => Array.from({ length: horizon }, (_, i) => dates.addDays(boot.today, i)), [boot.today]);
  const key = serviceIds.length ? '/api/v1/slots' + qs({ day: d, services: serviceIds.join(','), staff: staffId, ignore }) : null;
  const { data, loading } = useQuery<{ days: { day: string; slots: { m: number; s: string }[] }[] }>(key);
  const slots = data?.days[0]?.slots || [];
  const parts = [{ t: 'Matin', a: 0, b: 720 }, { t: 'Midi', a: 720, b: 840 }, { t: 'Après-midi', a: 840, b: 1020 }, { t: 'Fin de journée', a: 1020, b: 1440 }];
  if (!serviceIds.length) return <p className="muted" style={{ fontSize: 13.5 }}>Choisis d’abord une prestation.</p>;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="days" role="group" aria-label="Jour">
        {days.map((k) => { const p = dates.dayParts(k); const open = (boot.settings.hours[p.wd] || []).length > 0; return <button key={k} type="button" className="dayc" aria-pressed={k === d} disabled={!open} onClick={() => setD(k)}><small>{k === boot.today ? 'auj.' : dates.DAYS_SH[p.wd]}</small><b>{p.d}</b></button>; })}
      </div>
      {loading ? <Skeleton h={100} /> : !slots.length ? <Note icon="clock">Plus rien de libre ce jour-là{staffId !== 'any' ? ' pour ' + (staffById.get(staffId)?.name || '') : ''}. Essaie un autre jour ou « le premier libre ».</Note> : parts.map((pt) => {
        const list = slots.filter((x) => x.m >= pt.a && x.m < pt.b);
        if (!list.length) return null;
        return (
          <div key={pt.t} className="col" style={{ gap: 8 }}>
            <p className="section-k">{pt.t}</p>
            <div className="slots">{list.map((x) => <button key={x.m + x.s} type="button" className="slot" aria-pressed={!!value && value.day === d && value.start === x.m && value.staffId === x.s} onClick={() => onPick({ day: d, start: x.m, staffId: x.s })}>{hhmm(x.m)}{staffId === 'any' ? <small>{staffById.get(x.s)?.name}</small> : null}</button>)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- an appointment ---------------- */

type ApptDetail = { appt: Appt; client: ClientFull | null; history: { id: string; day: string; services: string[]; staff: string; status: string; price: number }[]; messages: { id: string; template: string; status: string; at: number; sentAt: number | null }[]; payments: { id: string; kind: string; amount: number; status: string }[]; sale: any };
const TPL: Record<string, string> = { confirmation: 'Confirmation', reminder: 'Rappel la veille', reminder2h: 'Rappel 2 h avant', review: 'Demande d’avis', cancelled: 'Annulation', receipt: 'Reçu' };

export function ApptSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const app = useApp();
  const { boot, staffById, can } = app;
  const { data, refresh } = useQuery<ApptDetail>(id ? '/api/v1/appointments/' + id : null);
  const [busy, setBusy] = useState('');
  const [tech, setTech] = useState('');
  const [mode, setMode] = useState<'view' | 'move' | 'edit'>('view');
  const [moveTo, setMoveTo] = useState<{ day: string; start: number; staffId: string } | null>(null);
  const [edit, setEdit] = useState<{ serviceIds: string[]; note: string }>({ serviceIds: [], note: '' });
  useEffect(() => { setMode('view'); setMoveTo(null); }, [id]);
  useEffect(() => { if (data?.client) setTech(data.client.tech || ''); }, [data?.client?.id]);
  const a = data?.appt;
  const st = a ? staffById.get(a.staffId) : null;
  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast({ title: ok, icon: 'check' }); refreshAll(); await refresh(); }
    catch (e) { toastError(e); }
    finally { setBusy(''); }
  };
  const status = (s: string, ok: string) => run(s, () => api.post('/api/v1/appointments/' + a!.id + '/status', { status: s }), ok);
  const cancel = async () => {
    const paid = a!.deposit && a!.deposit.paid;
    const yes = await confirm({ title: 'Annuler ce rendez-vous ?', body: `${a!.name} · ${dayShortWord(a!.day, boot.today)} à ${time(a!.start)}. Le créneau redevient libre${boot.settings.booking.waitlist ? ' et la liste d’attente est prévenue' : ''}.${paid ? ' L’acompte de ' + eur(a!.deposit!.paid) + ' sera remboursé.' : ''}`, ok: 'Oui, annuler', danger: true });
    if (!yes) return;
    run('cancel', () => api.post('/api/v1/appointments/' + a!.id + '/cancel', { reason: 'Annulé par le salon', notify: true, refundDeposit: !!paid && can('sale.refund') }), 'Rendez-vous annulé · le client est prévenu');
    onClose();
  };
  const saveTech = () => { if (data?.client && tech !== data.client.tech) run('tech', () => api.patch('/api/v1/clients/' + data.client!.id, { tech }), 'Fiche technique enregistrée'); };
  const doMove = () => moveTo && run('move', () => api.post('/api/v1/appointments/' + a!.id + '/move', { ...moveTo, notify: true }), 'Rendez-vous déplacé · SMS envoyé').then(() => setMode('view'));
  const doEdit = () => run('edit', () => api.patch('/api/v1/appointments/' + a!.id, { serviceIds: edit.serviceIds, note: edit.note }), 'Rendez-vous modifié').then(() => setMode('view'));

  const footer = !a ? null : mode === 'move' ? (
    <><Button variant="ghost" onClick={() => setMode('view')}>Retour</Button><span className="grow" /><Button variant="primary" disabled={!moveTo} busy={busy === 'move'} onClick={doMove}>{moveTo ? 'Déplacer · ' + dayShortWord(moveTo.day, boot.today) + ' ' + time(moveTo.start) : 'Choisis un créneau'}</Button></>
  ) : mode === 'edit' ? (
    <><Button variant="ghost" onClick={() => setMode('view')}>Retour</Button><span className="grow" /><Button variant="primary" disabled={!edit.serviceIds.length} busy={busy === 'edit'} onClick={doEdit}>Enregistrer</Button></>
  ) : (
    <>
      {['booked', 'pending'].includes(a.status) ? <Button variant="subtle" icon="check" busy={busy === 'arrived'} onClick={() => status('arrived', a.name.split(' ')[0] + ' est arrivé')}>Arrivé</Button> : null}
      {['booked', 'pending', 'arrived'].includes(a.status) ? <Button variant="solid" icon="chair" busy={busy === 'in_chair'} onClick={() => status('in_chair', 'Au fauteuil')}>Installer</Button> : null}
      {a.status === 'in_chair' && can('sale.create') ? <Button variant="primary" size="lg" icon="caisse" className="grow" onClick={() => { onClose(); navigate('/caisse?rdv=' + a.id); }}>Encaisser · {eur(a.price)}</Button> : null}
      {a.status === 'no_show' ? <Button variant="subtle" icon="undo" busy={busy === 'booked'} onClick={() => status('booked', 'Absence annulée')}>Annuler l’absence</Button> : null}
      {a.status === 'done' && data?.sale ? <Button variant="subtle" icon="ticket" onClick={() => { onClose(); navigate('/caisse/ventes?ticket=' + data.sale.id); }}>Voir le ticket {data.sale.ref}</Button> : null}
      {['booked', 'arrived'].includes(a.status) && a.day <= boot.today && can('sale.create') ? <Button variant="primary" icon="caisse" className="grow" onClick={() => { onClose(); navigate('/caisse?rdv=' + a.id); }}>Encaisser</Button> : null}
    </>
  );

  return (
    <Sheet open={!!id} onClose={onClose} title={a ? a.name : ' '} kicker={a ? (STATUS[a.status] || a.status) + ' · ' + a.code : 'Rendez-vous'} footer={footer}>
      {!a ? <div className="col"><Skeleton h={60} /><Skeleton h={120} /><Skeleton h={80} /></div> : mode === 'move' ? (
        <>
          <p className="muted">Avec qui, et quand ? Le client reçoit un SMS avec le nouvel horaire.</p>
          <StaffPicker value={moveTo?.staffId || (a.anyStaff ? 'any' : a.staffId)} onChange={(v) => setMoveTo(moveTo ? { ...moveTo, staffId: v } : { day: a.day, start: -1, staffId: v })} />
          <SlotPicker serviceIds={a.services.map((s) => s.id)} staffId={moveTo?.staffId || a.staffId} day={a.day} value={moveTo} onPick={setMoveTo} ignore={a.id} />
        </>
      ) : mode === 'edit' ? (
        <>
          <ServicePicker value={edit.serviceIds} onChange={(v) => setEdit({ ...edit, serviceIds: v })} />
          <Field label="Note pour le barbier" htmlFor="ap-note"><textarea id="ap-note" className="textarea" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} maxLength={300} /></Field>
        </>
      ) : (
        <>
          <div className="ap-hero">
            <span className={'status ' + a.status}><i />{STATUS[a.status]}{a.statusAt[a.status] ? ' · ' + ago(a.statusAt[a.status]) : ''}</span>
            <p>{cap(dayWord(a.day, boot.today))} · {time(a.start)} – {time(a.start + a.dur)} · avec {st?.name}{a.anyStaff ? ' (sans préférence)' : ''}</p>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="badge">{SOURCE[a.source] || a.source}</span>
              {(a.client?.badges || []).map((b) => <span key={b} className={'badge ' + (b === 'nouveau' ? 'badge-info' : b === 'fidèle' ? 'badge-ok' : b === 'absences' ? 'badge-warn' : b === 'VIP' ? 'badge-accent' : '')}>{b}</span>)}
              {a.deposit ? <span className={'badge ' + (a.deposit.paid ? 'badge-ok' : 'badge-warn')}><Icon name="card" />{a.deposit.paid ? 'Acompte payé ' + eur(a.deposit.paid) : 'Acompte en attente ' + eur(a.deposit.amount)}</span> : null}
            </div>
          </div>
          <div className="card card-tight">
            {a.services.map((s) => <div key={s.id} className="kv"><span>{s.name} · {dur(s.dur)}</span><b><Money cents={s.price} />{s.from ? ' +' : ''}</b></div>)}
            {data?.client ? <div className="kv"><span>Téléphone</span><b>{data.client.hasPhone ? data.client.phone : '—'}</b></div> : null}
          </div>
          {a.note ? <Note icon="sms"><b>Note du client :</b> {a.note}</Note> : null}
          {data?.client ? (
            <div className="tech">
              <span className="label"><Icon name="scissors" size={14} />Fiche technique</span>
              <textarea value={tech} placeholder="Ex. : dégradé bas, sabot 0,5, garder la longueur sur le dessus" onChange={(e) => setTech(e.target.value)} onBlur={saveTech} aria-label="Fiche technique" />
            </div>
          ) : null}
          {data?.client ? (
            <div className="grid3">
              <div className="kpi" style={{ minHeight: 0 }}><span className="kpi-k">Visites</span><span className="kpi-v sm">{data.client.visits}</span></div>
              <div className="kpi" style={{ minHeight: 0 }}><span className="kpi-k">Dernière</span><span className="kpi-v sm" style={{ fontSize: 18 }}>{sinceWords(data.client.sinceLast)}</span></div>
              <div className="kpi" style={{ minHeight: 0 }}><span className="kpi-k">Rythme</span><span className="kpi-v sm" style={{ fontSize: 18 }}>{rhythmWords(data.client.cadence)}</span></div>
            </div>
          ) : null}
          {data && data.history.length ? (
            <div className="card card-tight">
              <div className="card-h"><h3>Ses dernières visites</h3>{data.client ? <button type="button" className="link" onClick={() => { onClose(); navigate('/clients/' + data.client!.id); }}>Fiche complète</button> : null}</div>
              <ul className="hist">{data.history.slice(0, 5).map((h) => <li key={h.id}><span className="d">{dates.dayShort(h.day)}</span><span className="ellipsis">{h.services.join(' + ')} · {h.staff}</span><span className={h.status === 'no_show' ? 'badge badge-warn' : 'muted tnum'}>{h.status === 'no_show' ? 'absent' : <Money cents={h.price} />}</span></li>)}</ul>
            </div>
          ) : null}
          {data && data.messages.length ? (
            <div className="card card-tight">
              <div className="card-h"><h3>Messages automatiques</h3></div>
              <ul className="msgs">{data.messages.map((m) => <li key={m.id}><i className={m.status === 'sent' || m.status === 'simulated' ? 'ok' : ''}>{m.status === 'sent' || m.status === 'simulated' ? <Icon name="check" /> : null}</i><span className="grow">{TPL[m.template] || m.template}</span><small className="faint">{m.status === 'simulated' ? 'simulé (démo) · ' : m.status === 'failed' ? 'échec · ' : ''}{ago(m.sentAt || m.at)}</small></li>)}</ul>
            </div>
          ) : null}
          {['booked', 'pending', 'arrived', 'in_chair'].includes(a.status) ? (
            <div className="acts-row">
              <Button variant="ghost" size="sm" icon="move" onClick={() => { setMoveTo(null); setMode('move'); }}>Déplacer</Button>
              <Button variant="ghost" size="sm" icon="edit" onClick={() => { setEdit({ serviceIds: a.services.map((s) => s.id), note: a.note }); setMode('edit'); }}>Modifier</Button>
              {data?.client?.hasPhone && can('client.contact') ? <a className="btn btn-ghost btn-sm" href={'tel:' + data.client.phone.replace(/\s/g, '')}><Icon name="phone" />Appeler</a> : null}
              {['booked', 'arrived'].includes(a.status) && (a.day < boot.today || (a.day === boot.today)) ? <Button variant="ghost" size="sm" icon="alert" busy={busy === 'no_show'} onClick={() => status('no_show', 'Marqué absent · le créneau est libéré')}>Absent</Button> : null}
              <Button variant="danger" size="sm" icon="x" busy={busy === 'cancel'} onClick={cancel}>Annuler</Button>
            </div>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

/* ---------------- a new booking ---------------- */

export type Prefill = { day?: string; start?: number; staffId?: string; clientId?: string; serviceIds?: string[] };

export function CreateSheet({ open, prefill, onClose, onCreated }: { open: boolean; prefill: Prefill | null; onClose: () => void; onCreated?: (id: string, day: string) => void }) {
  const { boot, staffById, can } = useApp();
  const [q, setQ] = useState('');
  const [client, setClient] = useState<ClientCard | null>(null);
  const [mode, setMode] = useState<'search' | 'new' | 'none'>('search');
  const [nc, setNc] = useState({ first: '', last: '', phone: '' });
  const [name, setName] = useState('');
  const [svc, setSvc] = useState<string[]>([]);
  const [staff, setStaff] = useState('any');
  const [when, setWhen] = useState<{ day: string; start: number; staffId: string } | null>(null);
  const [note, setNote] = useState('');
  const [sms, setSms] = useState(true);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q, 180);
  const results = useQuery<{ items: ClientCard[] }>(open && mode === 'search' && dq.trim().length >= 2 && can('client.view') ? '/api/v1/clients' + qs({ q: dq, limit: 6 }) : null);
  useEffect(() => {
    if (!open) return;
    setQ(''); setMode('search'); setNc({ first: '', last: '', phone: '' }); setName(''); setNote(''); setSms(true);
    setSvc(prefill?.serviceIds || []);
    const st = prefill?.staffId || (can('agenda.edit') ? 'any' : boot.me.id);
    setStaff(st);
    setWhen(prefill?.day != null && prefill.start != null ? { day: prefill.day, start: prefill.start, staffId: prefill.staffId || boot.me.id } : null);
    setClient(null);
    if (prefill?.clientId) api.get<{ client: ClientCard }>('/api/v1/clients/' + prefill.clientId).then((r) => setClient(r.client)).catch(() => {});
  }, [open]);
  const fixed = prefill?.day != null && prefill.start != null && when && when.day === prefill.day && when.start === prefill.start;
  const total = svc.reduce((t, id) => t + (boot.services.find((s) => s.id === id)?.price || 0), 0);
  const length = svc.reduce((t, id) => t + (boot.services.find((s) => s.id === id)?.dur || 0), 0);
  const who = client ? client.first + ' ' + client.last : mode === 'new' ? (nc.first + ' ' + nc.last).trim() : name;
  const valid = svc.length && when && when.start >= 0 && (client || (mode === 'new' && nc.first.trim()) || (mode === 'none' && name.trim()));
  const submit = async (force = false) => {
    if (!valid || !when) return;
    setBusy(true);
    try {
      const body: any = { serviceIds: svc, staffId: when.staffId, day: when.day, start: when.start, note: note || undefined, sms, source: 'phone', force };
      if (client) body.clientId = client.id;
      else if (mode === 'new') body.client = { first: nc.first, last: nc.last, phone: nc.phone || undefined };
      else body.name = name;
      const r = await api.post<{ id: string }>('/api/v1/appointments', body);
      toast({ title: 'Rendez-vous réservé', sub: who + ' · ' + dayShortWord(when.day, boot.today) + ' à ' + time(when.start) + ' avec ' + staffById.get(when.staffId)?.name, icon: 'check' });
      refreshAll();
      onCreated?.(r.id, when.day);
      onClose();
    } catch (e: any) {
      if (e.status === 409 && e.extra?.canForce && !force) {
        const yes = await confirm({ title: e.code === 'outside' ? 'En dehors des horaires' : 'Créneau déjà pris', body: e.message + ' Le réserver quand même ?', ok: 'Forcer' });
        if (yes) { setBusy(false); return submit(true); }
      } else toastError(e);
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Nouveau rendez-vous" kicker={fixed && when ? dayShortWord(when.day, boot.today) + ' · ' + time(when.start) + ' · ' + staffById.get(when.staffId)?.name : 'Au téléphone ou au comptoir'}
      footer={<><span className="sum"><b><Money cents={total} /></b><span>{svc.length ? dur(length) : 'Choisis une prestation'}{when && when.start >= 0 ? ' · ' + dayShortWord(when.day, boot.today) + ' ' + time(when.start) : ''}</span></span><Button variant="primary" size="lg" disabled={!valid} busy={busy} onClick={() => submit()}>Réserver</Button></>}>
      <div className="col" style={{ gap: 10 }}>
        <p className="section-k">Client</p>
        {client ? (
          <div className="pick-r" aria-pressed="true"><Avatar name={client.name} /><span className="li-main"><b>{client.first} {client.last}</b><small>{client.phone || 'sans téléphone'} · {client.visits} visite{client.visits > 1 ? 's' : ''}{client.tech ? ' · ' + client.tech : ''}</small></span><Button size="sm" variant="ghost" onClick={() => setClient(null)}>Changer</Button></div>
        ) : mode === 'search' ? (
          <>
            <div className="search"><Icon name="search" /><input className="input" placeholder="Prénom, nom ou numéro" value={q} onChange={(e) => setQ(e.target.value)} data-autofocus aria-label="Rechercher un client" /></div>
            {results.data?.items.length ? <div className="pick">{results.data.items.map((c) => <button key={c.id} type="button" className="pick-r" onClick={() => setClient(c)}><Avatar name={c.name} size="sm" /><span className="li-main"><b>{c.first} {c.last}</b><small>{c.phone} · {sinceWords(c.sinceLast)}</small></span>{c.badges.slice(0, 1).map((b) => <span key={b} className="badge">{b}</span>)}</button>)}</div> : null}
            <div className="row wrap" style={{ gap: 8 }}>
              <Button size="sm" variant="ghost" icon="plus" onClick={() => { setMode('new'); setNc({ ...nc, first: /\d/.test(q) ? '' : q.split(' ')[0] || '', last: /\d/.test(q) ? '' : q.split(' ').slice(1).join(' '), phone: /\d/.test(q) ? q : '' }); }}>Nouveau client</Button>
              <Button size="sm" variant="ghost" icon="walk" onClick={() => { setMode('none'); setName(q); }}>Sans fiche</Button>
            </div>
          </>
        ) : mode === 'new' ? (
          <div className="col" style={{ gap: 10 }}>
            <div className="grid2"><Field label="Prénom" htmlFor="nc-f"><input id="nc-f" className="input" value={nc.first} onChange={(e) => setNc({ ...nc, first: e.target.value })} autoComplete="off" /></Field><Field label="Nom" htmlFor="nc-l"><input id="nc-l" className="input" value={nc.last} onChange={(e) => setNc({ ...nc, last: e.target.value })} autoComplete="off" /></Field></div>
            <Field label="Téléphone" htmlFor="nc-p" hint="Pour la confirmation et le rappel par SMS"><input id="nc-p" className="input" type="tel" inputMode="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder="06 12 34 56 78" /></Field>
            <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('search')}>Chercher un client existant</button>
          </div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            <Field label="Prénom affiché sur l’agenda" htmlFor="nc-n"><input id="nc-n" className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setMode('search')}>Chercher un client existant</button>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Prestation</p><ServicePicker value={svc} onChange={setSvc} /></div>
      {!fixed ? (
        <>
          <div className="col" style={{ gap: 10 }}><p className="section-k">Barbier</p><StaffPicker value={staff} onChange={(v) => { setStaff(v); setWhen(null); }} /></div>
          <div className="col" style={{ gap: 10 }}><p className="section-k">Quand</p><SlotPicker serviceIds={svc} staffId={staff} day={prefill?.day || boot.today} value={when} onPick={setWhen} /></div>
        </>
      ) : <Note icon="clock">{cap(dayWord(when!.day, boot.today))} à {time(when!.start)} avec {staffById.get(when!.staffId)?.name}. <button type="button" className="link" onClick={() => setWhen(null)}>Changer</button></Note>}
      <Field label="Note pour le barbier" htmlFor="nc-note"><input id="nc-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" maxLength={300} /></Field>
      {(client?.hasPhone || (mode === 'new' && nc.phone)) ? <Switch on={sms} onChange={setSms} title="Confirmer par SMS" hint="Avec un lien pour déplacer ou annuler, puis un rappel la veille." /> : null}
    </Sheet>
  );
}

/* ---------------- walk-in ---------------- */

export function WalkinSheet({ open, onClose, freeNow }: { open: boolean; onClose: () => void; freeNow: string[] }) {
  const { boot, staffById } = useApp();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [svc, setSvc] = useState<string[]>([]);
  const [staff, setStaff] = useState('any');
  const [busy, setBusy] = useState('');
  useEffect(() => { if (open) { setName(''); setPhone(''); setStaff('any'); setSvc(boot.services.filter((s) => s.slug === 'cl').map((s) => s.id).slice(0, 1)); } }, [open]);
  const add = async (seatWith?: string) => {
    setBusy(seatWith || 'add');
    try {
      const r = await api.post<{ id: string }>('/api/v1/queue', { name: name || 'Passage', phone: phone || undefined, serviceId: svc[0], staffId: staff });
      if (seatWith) await api.post('/api/v1/queue/' + r.id, { action: 'seat', staffId: seatWith });
      toast({ title: seatWith ? (name || 'Le client') + ' installé chez ' + staffById.get(seatWith)?.name : (name || 'Le client') + ' ajouté à la file', icon: 'check' });
      refreshAll();
      onClose();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const free = freeNow.filter((id) => staff === 'any' || staff === id);
  return (
    <Sheet open={open} onClose={onClose} title="Un passage" kicker="Sans rendez-vous"
      footer={<>{free.slice(0, 1).map((id) => <Button key={id} variant="solid" icon="chair" busy={busy === id} disabled={!svc.length} onClick={() => add(id)}>Installer chez {staffById.get(id)?.name}</Button>)}<span className="grow" /><Button variant="primary" size="lg" busy={busy === 'add'} disabled={!svc.length} onClick={() => add()}>Ajouter à la file</Button></>}>
      <div className="grid2 stack">
        <Field label="Prénom" htmlFor="wk-n"><input id="wk-n" className="input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus placeholder="Facultatif" /></Field>
        <Field label="Téléphone" htmlFor="wk-p" hint="On lui écrit quand c’est son tour : il peut attendre au café"><input id="wk-p" className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Facultatif" /></Field>
      </div>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Prestation</p><ServicePicker value={svc} onChange={setSvc} multi={false} /></div>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Barbier</p><StaffPicker value={staff} onChange={setStaff} /></div>
      {free.length ? <Note tone="ok" icon="chair">{free.map((id) => staffById.get(id)?.name).join(', ')} {free.length > 1 ? 'sont libres' : 'est libre'} maintenant.</Note> : null}
    </Sheet>
  );
}

/* ---------------- block a slot ---------------- */

export function BlockSheet({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill: { staffId: string; day: string; start: number } | null }) {
  const { boot, can } = useApp();
  const [staff, setStaff] = useState(prefill?.staffId || boot.me.id);
  const [start, setStart] = useState(prefill?.start ?? 780);
  const [len, setLen] = useState<number | 'end'>(30);
  const [label, setLabel] = useState('Pause');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setStaff(prefill?.staffId || (can('agenda.edit') ? boot.staff.find((s) => s.chair)?.id || boot.me.id : boot.me.id)); setStart(prefill?.start ?? 780); setLen(30); setLabel('Pause'); } }, [open]);
  const day = prefill?.day || boot.today;
  const go = async () => {
    setBusy(true);
    try {
      await api.post('/api/v1/blocks', { staffId: staff, day, start, ...(len === 'end' ? { end: 1440, label: label === 'Pause' ? 'Fermé' : label } : { dur: len, label }) });
      toast({ title: 'Créneau bloqué', sub: 'Il n’est plus proposé sur le site.', icon: 'block' });
      refreshAll(); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const times = [];
  for (let m = 540; m <= 1095; m += 15) times.push(m);
  return (
    <Sheet open={open} onClose={onClose} title="Bloquer un créneau" kicker={cap(dayWord(day, boot.today))}
      footer={<><span className="grow muted" style={{ fontSize: 13 }}>Disparaît du site aussitôt.</span><Button variant="primary" size="lg" busy={busy} onClick={go}>Bloquer</Button></>}>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Barbier</p><StaffPicker value={staff} onChange={setStaff} any={false} /></div>
      <Field label="À partir de" htmlFor="bl-s"><select id="bl-s" className="select" value={start} onChange={(e) => setStart(+e.target.value)}>{times.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}</select></Field>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Durée</p><div className="chips">{[15, 30, 45, 60, 90].map((d) => <Chip key={d} on={len === d} onClick={() => setLen(d)}>{dur(d)}</Chip>)}<Chip on={len === 'end'} onClick={() => setLen('end')}>Jusqu’à la fermeture</Chip></div></div>
      <div className="col" style={{ gap: 10 }}><p className="section-k">Raison</p><div className="chips">{['Pause', 'Déjeuner', 'Rendez-vous perso', 'Formation', 'Shooting photo'].map((l) => <Chip key={l} on={label === l} onClick={() => setLabel(l)}>{l}</Chip>)}</div></div>
    </Sheet>
  );
}
