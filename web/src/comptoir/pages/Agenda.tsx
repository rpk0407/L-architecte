// L'agenda: the day of the salon, live.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, qs } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { navigate, setQuery, useRoute } from '../../lib/router';
import { ago, cap, dates, eur, pct, time, hhmm } from '../../lib/format';
import { useHotkeys, useInterval } from '../../lib/hooks';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Kpi, Menu, Money, Seg, Skeleton, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import { FeedList } from '../Feed';
import { Board } from './agenda/Board';
import { ApptSheet, BlockSheet, CreateSheet, WalkinSheet, type Prefill } from './agenda/Sheets';
import type { Agenda as AgendaData, Appt } from '../types';
import './agenda.css';

export default function Agenda() {
  const app = useApp();
  const { boot, can, staffById, serviceById, pulse } = app;
  const route = useRoute();
  const today = pulse?.today || boot.today;
  const day = route.query.get('day') || today;
  const view = (route.query.get('vue') as 'jour' | 'semaine') || 'jour';
  const sel = route.query.get('rdv');
  const [lane, setLane] = useState<string | null>(boot.me.chair ? boot.me.id : null);
  const [tick, setTick] = useState(0);
  useInterval(() => setTick((t) => t + 1), 30000);
  const nowMin = useMemo(() => dates.localParts(app.now()).min, [tick, pulse?.min]);
  const { data, loading, error } = useQuery<AgendaData>('/api/v1/agenda?day=' + day);
  const [create, setCreate] = useState<Prefill | null>(null);
  const [walkin, setWalkin] = useState(false);
  const [block, setBlock] = useState<{ staffId: string; day: string; start: number } | null | false>(false);
  const [menu, setMenu] = useState<{ x: number; y: number; staffId?: string; min?: number; blockId?: string } | null>(null);

  // deep links from the palette and the feed: ?new=1, ?walkin=1
  useEffect(() => {
    if (route.query.get('new')) { setCreate(route.query.get('client') ? { clientId: route.query.get('client')! } : {}); setQuery({ new: null, client: null }); }
    if (route.query.get('walkin')) { setWalkin(true); setQuery({ walkin: null }); }
  }, [route.key]);
  useHotkeys({
    n: () => setCreate({}), p: () => setWalkin(true), t: () => setQuery({ day: null }),
    arrowleft: () => setQuery({ day: dates.addDays(day, -1) }), arrowright: () => setQuery({ day: dates.addDays(day, 1) })
  }, [day]);

  const goDay = (d: string | null) => setQuery({ day: d === today ? null : d, rdv: null });
  const open = (a: Appt) => setQuery({ rdv: a.id });

  const freeNow = useMemo(() => {
    if (!data || day !== today) return [];
    return data.lanes.filter((l) => l.work.some(([a, b]) => nowMin >= a && nowMin < b) && !data.appts.some((x) => x.staffId === l.id && ['in_chair', 'arrived', 'booked'].includes(x.status) && x.start <= nowMin + 10 && x.start + x.dur > nowMin)).map((l) => l.id);
  }, [data, nowMin]);

  const move = async (a: Appt, staffId: string, start: number) => {
    try {
      await api.post('/api/v1/appointments/' + a.id + '/move', { day: a.day, start, staffId, notify: true });
      refreshAll();
      toast({ title: 'Déplacé à ' + time(start) + (staffId !== a.staffId ? ' chez ' + staffById.get(staffId)?.name : ''), sub: 'Le client est prévenu par SMS', icon: 'move', action: { label: 'Annuler', run: async () => { await api.post('/api/v1/appointments/' + a.id + '/move', { day: a.day, start: a.start, staffId: a.staffId }); refreshAll(); } } });
    } catch (e) { toastError(e); }
  };

  const k = data?.kpis;
  const next = data && day === today ? data.appts.filter((a) => ['booked', 'arrived', 'pending'].includes(a.status) && a.start + 5 >= nowMin && (can('agenda.all') || a.staffId === boot.me.id)).sort((a, b) => a.start - b.start)[0] : null;
  // after the Z (even an early one) nothing more can be paid today; imported history was paid on the old till
  const toPay = data && day === today && !data.closed ? data.appts.filter((a) => !a.saleId && !a.legacy && (a.status === 'in_chair' || a.status === 'done' || (['booked', 'arrived'].includes(a.status) && a.start + a.dur <= nowMin))) : [];
  const moneyOk = k?.revenue != null;
  // the desk tablet (no chair, no salon figures): the whole salon's day in counts, never in euros
  const desk = k ? k.scope === 'desk' : !boot.me.chair && !can('report.shop') && can('agenda.all');
  // a fresh salon has no chair yet: the agenda is not closed, it is waiting for the team
  if (!boot.staff.some((x) => x.active && x.chair)) return <NoTeam />;
  return (
    <>
      <PageTitle><h1>{day === today ? 'Aujourd’hui' : 'Agenda'}</h1></PageTitle>
      <div className="ag-head">
        <div className="ag-date" data-guide="ag-date">
          <Button icon="chevL" aria-label="Jour précédent" onClick={() => goDay(dates.addDays(day, view === 'semaine' ? -7 : -1))} />
          <label style={{ position: 'relative' }}>
            <h2 className="tnum" style={{ cursor: 'pointer', font: '400 30px/1 var(--serif)', padding: '0 4px', whiteSpace: 'nowrap' }}>{view === 'semaine' ? 'Semaine du ' + dates.dayParts(dates.weekStart(day)).d + ' ' + dates.MONTHS_FR[dates.dayParts(dates.weekStart(day)).m - 1] : cap(dates.dayLong(day))}</h2>
            <input type="date" value={day} onChange={(e) => e.target.value && goDay(e.target.value)} aria-label="Choisir une date" />
          </label>
          <Button icon="chevR" aria-label="Jour suivant" onClick={() => goDay(dates.addDays(day, view === 'semaine' ? 7 : 1))} />
          {day !== today ? <Button size="sm" variant="ghost" className="today" onClick={() => goDay(null)}>Aujourd’hui</Button> : null}
        </div>
        <div className="ag-acts">
          <div data-guide="ag-view" style={{ display: 'flex' }}><Seg value={view} onChange={(v) => setQuery({ vue: v === 'jour' ? null : v })} options={[{ v: 'jour', t: 'Jour' }, { v: 'semaine', t: 'Semaine' }]} label="Vue" /></div>
          <Button variant="ghost" icon="block" className="ph-hide" data-guide="ag-block" onClick={() => setBlock({ staffId: boot.me.chair ? boot.me.id : data?.lanes[0]?.id || boot.me.id, day, start: Math.ceil(nowMin / 15) * 15 })}>Bloquer</Button>
          <Button variant="ghost" icon="walk" onClick={() => setWalkin(true)} kbd="P" data-guide="ag-walkin">Passage</Button>
          <Button variant="primary" icon="plus" onClick={() => setCreate({ day })} kbd="N" data-guide="ag-new">Rendez-vous</Button>
        </div>
      </div>

      {view === 'semaine' ? <Week day={day} today={today} onPick={(d) => setQuery({ day: d === today ? null : d, vue: null })} /> : (
        <>
          <AbsentBanner data={data} today={today} />
          {data?.closed ? <div className="note ok"><Icon name="lock" /><div><b>Journée clôturée</b> · {/* the Z's figures only reach whoever closes or reads the salon's money; the others get its number */}{data.closure ? 'Z' + String(data.closure.number).padStart(4, '0') + (typeof data.closure.net === 'number' ? ' · ' + eur(data.closure.net) : '') : ''}. Les ventes de ce jour ne peuvent plus être modifiées.</div></div> : null}
          <section className="kpis" aria-label="La journée en chiffres" data-guide="ag-kpis">
            {desk ? null : moneyOk ? <Kpi k={k!.scope === 'own' ? 'Mon chiffre' : 'Encaissé'} v={<Money cents={k!.revenue} />} s={<>sur <Money cents={k!.planned} /> prévus{k!.tips ? <> · <Money cents={k!.tips} /> de pourboires</> : null}</>} bar={k!.planned ? (k!.revenue || 0) / k!.planned : 0} icon="euro" />
              : <Kpi k="Mes rendez-vous" v={k ? k.total : '—'} s={k ? k.upcoming + ' à venir' : ''} icon="calendar" />}
            <Kpi k="Rendez-vous" v={k ? <>{k.done}<small>/ {k.total}</small></> : '—'} s={k ? k.upcoming + ' à venir' + (k.noShows ? ' · ' + k.noShows + ' absent' + (k.noShows > 1 ? 's' : '') : '') : ''} icon="calendar" />
            <Kpi k={desk ? 'Remplissage salon' : 'Remplissage'} v={k ? pct(k.fill) : '—'} dots={k ? k.fill : 0} s={k ? (k.fill > 0.85 ? 'Presque plein' : k.fill > 0.6 ? 'Belle journée' : 'Il reste de la place') : ''} icon="chair" />
            {desk ? <Kpi k="À encaisser" v={day === today && !data?.closed ? toPay.length : '—'} s={day !== today ? 'Le jour même' : data?.closed ? 'Journée clôturée' : toPay.length ? 'Prestation' + (toPay.length > 1 ? 's' : '') + ' à passer en caisse' : 'Rien en attente'} icon="caisse" /> : null}
            {day === today && next ? (
              <Kpi hot k={<><i style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.8s infinite' }} />Prochain client</>} v={<span className="kpi-v sm">{next.name}</span>} s={time(next.start) + ' · ' + (staffById.get(next.staffId)?.name || '') + (next.start <= nowMin ? ' · en retard de ' + (nowMin - next.start) + ' min' : ' · dans ' + Math.max(0, next.start - nowMin) + ' min')} onClick={() => open(next)} />
            ) : (
              <Kpi k="Sans rendez-vous" v={data?.walkin?.minutes != null ? (data.walkin.minutes < 5 ? 'Tout de suite' : '~' + data.walkin.minutes + ' min') : day === today ? 'Fermé' : '—'} s={data?.walkin ? data.walkin.queued + ' en file' : 'Attente estimée'} icon="walk" />
            )}
          </section>

          <div className="ag-grid">
            {loading ? <Skeleton h={560} r={22} /> : error ? <Empty icon="alert" title="Agenda indisponible">{error.message}</Empty> : data ? (
              !data.lanes.length || (data.lanes.every((l) => !l.work.length) && !data.appts.length) ? <ClosedDay day={day} today={today} onGo={goDay} /> :
              <Board data={data} today={today} nowMin={nowMin} canSeeMoney={moneyOk && k!.scope === 'shop'} myId={boot.me.id} selected={sel} lane={lane} setLane={setLane}
                onOpen={open} onMove={move}
                canMove={(a, to) => can('agenda.edit') || (a.staffId === boot.me.id && to === boot.me.id)}
                onEmpty={(staffId, min, at) => setMenu({ ...at, staffId, min })}
                onBlock={(id, at) => setMenu({ ...at, blockId: id })} />
            ) : null}

            <aside className="ag-side" aria-label="À côté de l’agenda">
              {day === today ? <Queue data={data} freeNow={freeNow} onAdd={() => setWalkin(true)} /> : null}
              {toPay.length && can('sale.create') ? (
                <section className="card" data-guide="ag-topay">
                  <div className="card-h"><h2><Icon name="caisse" size={16} />À encaisser</h2><span className="badge badge-accent">{toPay.length}</span></div>
                  <ul className="list">{toPay.map((a) => (
                    <li key={a.id}><button type="button" className="li" onClick={() => navigate('/caisse?rdv=' + a.id)}>
                      <Avatar name={staffById.get(a.staffId)?.name} initials={staffById.get(a.staffId)?.initials} color={staffById.get(a.staffId)?.color} size="sm" />
                      <span className="li-main"><b>{a.name}</b><small>{a.services.map((s) => s.name).join(' + ')} · {a.status === 'in_chair' ? 'au fauteuil' : 'fini à ' + time(a.start + a.dur)}</small></span>
                      <span className="li-end"><b><Money cents={a.price} /></b></span>
                    </button></li>
                  ))}</ul>
                </section>
              ) : null}
              <section className="card" data-guide="ag-feed">
                <div className="card-h"><h2><i style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ok)', animation: 'pulseOk 2.2s infinite' }} />Le fil</h2><span className="muted">en direct</span></div>
                <FeedList items={app.feed} now={pulse?.now || Date.now()} limit={6} onPick={(f) => { if (f.apptId && f.day) setQuery({ day: f.day === today ? null : f.day, rdv: f.apptId }); }} />
              </section>
              {data && data.waitlist.length ? (
                <section className="card" data-guide="ag-waitlist">
                  <div className="card-h"><h2><Icon name="wait" size={16} />Liste d’attente</h2><span className="muted">{data.waitlist.length}</span></div>
                  <ul className="list">{data.waitlist.map((w) => (
                    <li key={w.id} className="li"><span className="li-main"><b>{w.first}</b><small>{serviceById.get(w.serviceId)?.short || ''} · {w.staffId === 'any' ? 'sans préférence' : staffById.get(w.staffId)?.name} · {hhmm(w.from)}–{hhmm(Math.min(w.to, 1110))}</small></span>{w.status === 'offered' ? <span className="badge badge-ok">place proposée</span> : <span className="badge">en attente</span>}</li>
                  ))}</ul>
                  <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>Dès qu’un créneau se libère, il leur est proposé par SMS et gardé 30 min.</p>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      )}

      <Menu anchor={menu ? { x: menu.x, y: menu.y } : null} onClose={() => setMenu(null)}>
        {menu?.blockId ? (
          <>
            <p className="k">Créneau bloqué</p>
            <button type="button" onClick={async () => { try { await api.del('/api/v1/blocks/' + menu.blockId); refreshAll(); toast('Créneau rouvert · il est de nouveau proposé sur le site'); } catch (e) { toastError(e); } }}><Icon name="undo" />Rouvrir ce créneau</button>
          </>
        ) : menu ? (
          <>
            <p className="k">{staffById.get(menu.staffId!)?.name} · {time(menu.min!)}</p>
            <button type="button" onClick={() => setCreate({ day, start: menu.min, staffId: menu.staffId })}><Icon name="plus" />Nouveau rendez-vous ici</button>
            <button type="button" onClick={() => setBlock({ staffId: menu.staffId!, day, start: menu.min! })}><Icon name="block" />Bloquer à partir de {time(menu.min!)}</button>
          </>
        ) : null}
      </Menu>

      <ApptSheet id={sel} onClose={() => setQuery({ rdv: null })} />
      <CreateSheet open={!!create} prefill={create} onClose={() => setCreate(null)} onCreated={(id, d) => setQuery({ day: d === today ? null : d, rdv: id })} />
      <WalkinSheet open={walkin} onClose={() => setWalkin(false)} freeNow={freeNow} />
      <BlockSheet open={!!block} prefill={block || null} onClose={() => setBlock(false)} />
    </>
  );
}

type Orphans = { items: { id: string; staffId: string; from: string; to: string; count: number; day: string }[]; requests: { id: string; staffId: string; from: string; to: string; count: number }[] } | null;
/** Clients still booked with a barber who will be away, and absences waiting for approval: one tap to the plan. */
function AbsentBanner({ data, today }: { data: AgendaData | undefined; today: string }) {
  const { staffById } = useApp();
  const o = (data as (AgendaData & { absences?: Orphans }) | undefined)?.absences;
  if (!o || (!o.items.length && !o.requests.length)) return null;
  // "jeudi" within the week, "jeudi 12 nov." beyond; a request already under way reads from today
  const when = (d: string) => { const n = Math.max(0, dates.diffDays(today, d)); return n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : n < 7 ? dates.DAYS_FR[dates.weekday(d)] : dates.dayShort(d); };
  const line = (key: string, text: ReactNode, go: string, label: string) => (
    <div key={key} className="note warn" style={{ alignItems: 'center' }}><Icon name="alert" /><div className="grow">{text}</div><Button size="sm" variant="subtle" onClick={() => navigate(go)}>{label}</Button></div>
  );
  const q = o.requests;
  const req = !q.length ? null : q.length === 1
    ? line(q[0].id, <><b>{staffById.get(q[0].staffId)?.name || 'Un barbier'} demande {when(q[0].from)}{q[0].to !== q[0].from ? ' – ' + when(q[0].to) : ''}</b>{q[0].count ? ' · ' + q[0].count + ' rdv à replacer' : ''}</>, '/equipe', 'Voir')
    : line('requests', <><b>{q.length} demandes d’absence</b> à valider</>, '/equipe', 'Voir');
  // two lines at most, or the day's figures and the agenda drop below a phone's fold: the rest is one tap away
  const room = req ? 1 : 2;
  const shown = o.items.slice(0, room), more = o.items.length - shown.length;
  const absents = shown.map((x, i) => line(x.id, <><b>{x.count} rendez-vous</b> chez {staffById.get(x.staffId)?.name || 'un barbier'}, absent {when(x.day)}{i === shown.length - 1 && more ? ' · et ' + more + ' autre' + (more > 1 ? 's' : '') + ' absence' + (more > 1 ? 's' : '') + ' dans Équipe' : ''}</>, '/equipe?absence=' + x.id, 'Traiter'));
  return <>{absents}{req}</>;
}

function NoTeam() {
  const { can } = useApp();
  return (
    <>
      <PageTitle><h1>Agenda</h1></PageTitle>
      {/* the tour passes over the agenda's parts while there is no agenda (GUIDE-01a) */}
      <section className="card" data-tour-empty>
        <Empty icon="equipe" title="Ajoute ton équipe pour ouvrir l’agenda" action={
          <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {can('team') ? <Button variant="primary" icon="plus" onClick={() => navigate('/equipe')}>Ajouter l’équipe</Button> : null}
            {can('settings') ? <Button variant="ghost" icon="check" onClick={() => navigate('/reglages/mise-en-route')}>Voir la mise en route</Button> : null}
          </div>
        }>
          Chaque barbier a sa colonne, ses horaires et son code. Dès le premier, l’agenda se remplit et le site propose ses créneaux.
        </Empty>
      </section>
    </>
  );
}

function ClosedDay({ day, today, onGo }: { day: string; today: string; onGo: (d: string) => void }) {
  const { boot } = useApp();
  let next = dates.addDays(day, 1);
  for (let i = 0; i < 14 && !(boot.settings.hours[dates.weekday(next)] || []).length; i++) next = dates.addDays(next, 1);
  const closure = (boot.settings.closures || []).find((c: any) => day >= c.from && day <= c.to);
  return (
    <div className="card">
      <Empty icon="lock" title={(day === today ? 'Fermé aujourd’hui' : 'Fermé ce jour-là') + (closure ? ' · ' + closure.label : '')} action={<Button variant="primary" icon="arrowR" onClick={() => onGo(next)}>Voir {dates.dayLong(next)}</Button>}>
        {closure ? 'Fermeture exceptionnelle.' : 'Le salon ouvre du mardi au samedi. Les horaires se règlent dans Réglages, les absences de chacun dans Équipe.'}
      </Empty>
    </div>
  );
}

function Queue({ data, freeNow, onAdd }: { data: AgendaData | undefined; freeNow: string[]; onAdd: () => void }) {
  const { staffById, serviceById, pulse } = useApp();
  const q = data?.queue || [];
  const act = async (id: string, action: string, staffId?: string) => {
    try { await api.post('/api/v1/queue/' + id, { action, staffId }); refreshAll(); if (action === 'call') toast('Prévenu par SMS : c’est bientôt son tour'); }
    catch (e) { toastError(e); }
  };
  return (
    <section className="card" data-guide="ag-queue">
      <div className="card-h"><h2><Icon name="walk" size={16} />La file</h2><Button size="sm" variant="ghost" icon="plus" onClick={onAdd}>Passage</Button></div>
      {data?.walkin?.minutes != null
        ? <div className="est" style={{ marginBottom: q.length ? 6 : 0 }}><b>{data.walkin.minutes < 5 ? 'Tout de suite' : '~' + data.walkin.minutes + ' min'}</b><span className="muted" style={{ fontSize: 13 }}>{data.walkin.minutes < 5 ? 'pour un passage sans rendez-vous' : 'd’attente pour un passage'}</span></div>
        : <p className="muted" style={{ fontSize: 13.5 }}>Le salon est fermé pour l’instant.</p>}
      {q.length ? q.map((x, i) => {
        const pick = x.staffId !== 'any' ? (freeNow.includes(x.staffId) ? x.staffId : null) : freeNow[0] || null;
        return (
          <div key={x.id} className={'q-item' + (x.status === 'called' ? ' called' : '')}>
            <span className="q-n">{i + 1}</span>
            <span className="li-main"><b>{x.name}</b><small>{serviceById.get(x.serviceId)?.short || ''}{x.staffId !== 'any' ? ' · ' + staffById.get(x.staffId)?.name : ''} · {ago(x.at, pulse?.now)}{x.status === 'called' ? ' · prévenu' : ''}</small></span>
            <span className="q-acts">
              {x.hasPhone && x.status === 'waiting' ? <Button size="sm" variant="ghost" icon="sms" aria-label={'Prévenir ' + x.name} onClick={() => act(x.id, 'call')} /> : null}
              <Button size="sm" variant={pick ? 'solid' : 'subtle'} icon="chair" onClick={() => act(x.id, 'seat', pick || undefined)} disabled={!pick} title={pick ? 'Installer chez ' + staffById.get(pick)?.name : 'Personne n’est libre'}>{pick ? staffById.get(pick)?.name : 'Attente'}</Button>
              <Button size="sm" variant="ghost" icon="x" aria-label={x.name + ' est parti'} onClick={() => act(x.id, 'leave')} />
            </span>
          </div>
        );
      }) : data?.walkin?.minutes != null ? <p className="muted" style={{ fontSize: 13.5 }}>Personne n’attend. Ce temps d’attente s’affiche aussi sur le site.</p> : null}
    </section>
  );
}

function Week({ day, today, onPick }: { day: string; today: string; onPick: (d: string) => void }) {
  const { boot } = useApp();
  const { data, loading } = useQuery<{ from: string; days: { day: string; kpis: any; staff: { id: string; count: number; minutes: number; cap: number }[] }[]; staff: any[] }>('/api/v1/week' + qs({ day }));
  if (loading || !data) return <Skeleton h={420} r={22} />;
  const money = data.days.some((d) => d.kpis.revenue != null);
  return (
    <section className="card wk" data-guide="ag-week">
      <table>
        <thead><tr><th>Jour</th>{data.staff.map((s) => <th key={s.id}><span className="row" style={{ gap: 8 }}><Avatar name={s.name} initials={s.initials} color={s.color} size="sm" />{s.name}</span></th>)}{money ? <th>Chiffre</th> : null}</tr></thead>
        <tbody>
          {data.days.map((d) => {
            const p = dates.dayParts(d.day);
            const open = (boot.settings.hours[p.wd] || []).length > 0;
            return (
              <tr key={d.day}>
                <td><button type="button" className="wk-d" onClick={() => onPick(d.day)}><b>{cap(dates.DAYS_FR[p.wd])}</b><small>{p.d} {dates.MONTHS_SH[p.m - 1]}{d.day === today ? ' · aujourd’hui' : ''}</small></button></td>
                {d.staff.map((s) => (
                  <td key={s.id}>
                    <button type="button" className={'wk-c' + (d.day === today ? ' today' : '') + (!s.cap ? ' closed' : '')} onClick={() => onPick(d.day)} disabled={!open}>
                      <b>{s.cap ? s.count : '—'}</b><small>{s.cap ? pct(s.minutes / s.cap) + ' rempli' : 'absent'}</small>
                      {s.cap ? <span className="kpi-bar"><i style={{ ['--w' as any]: Math.round(Math.min(1, s.minutes / s.cap) * 100) + '%' }} /></span> : null}
                    </button>
                  </td>
                ))}
                {money ? <td><div className="wk-d"><b className="money tnum">{d.kpis.revenue != null ? eur(d.kpis.revenue) : '—'}</b><small>{d.kpis.total} rdv</small></div></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
