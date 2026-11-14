// FEATURE C · « Mon planning »: his chair today and the next 13 days (GET /api/v1/espace/planning). A strip of days on
// top, a sideways swipe for the next or the previous day (prefetched, so it changes at once), and for the day: his
// bookings, his free gaps, his breaks, his absence and the day's total. A tap on a booking opens it with the usual
// gestures; a past or sealed day is read-only.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { load, peek, refreshAll, useQuery } from '../../../lib/query';
import { navigate } from '../../../lib/router';
import { dates, dayWord, dur, eur, time } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Empty, Sheet, Skeleton, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import type { NoteTarget } from '../../types';
import { useSwipe } from '../agenda/swipe';
// FEATURE D adds the barber's own checkout here: import { PhoneCheckout } from '../caisse/PhoneCheckout';

export type PlanRow = { id: string; start: number; dur: number; name: string; services: string[]; status: string; price: number; paid: boolean; note: string; late: number };
export type PlanDay = {
  day: string; today: string; readOnly: boolean; work: [number, number][];
  breaks: { start: number; end: number; label: string }[]; rows: PlanRow[]; gaps: { start: number; end: number; dur: number }[];
  total: { count: number; minutes: number; cents: number; work: number };
  absence: { id: string; from: string; to: string; reason: string; part: { start: number; end: number } | null } | null;
  asked: { id: string; from: string; to: string } | null; closed: boolean;
  strip: { day: string; count: number; works: boolean; off: boolean }[];
};

const keyOf = (day: string) => '/api/v1/espace/planning?day=' + day;
const WORD: Record<string, string> = { pending: 'Acompte attendu', arrived: 'Arrivé', in_chair: 'Au fauteuil', done: 'Terminé', no_show: 'Absent' };
const TONE: Record<string, string> = { arrived: 'badge-ok', in_chair: 'badge-accent', no_show: 'badge-danger', pending: 'badge-warn', done: '' };
const DAYS = 14;

type Item = { k: 'appt'; at: number; r: PlanRow } | { k: 'gap'; at: number; end: number } | { k: 'break'; at: number; end: number; label: string };

/** « 3 h 30 », « 45 min » */
const span = (m: number) => dur(m);

export function Planning({ note }: { note: (t: NoteTarget) => void }) {
  const { boot, pulse } = useApp();
  const today = pulse?.today || boot.today;
  const [day, setDay] = useState(today);
  const { data, error, loading, refresh } = useQuery<PlanDay>(keyOf(day));
  const [open, setOpen] = useState<PlanRow | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const moved = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const last = dates.addDays(today, DAYS - 1);
  const can = (dir: -1 | 1) => (dir === -1 ? day < last : day > today);
  const go = (dir: -1 | 1) => { if (can(dir)) setDay(dates.addDays(day, -dir)); };
  useSwipe(zone, { on: true, go, can }, moved);
  // the day before and after are read ahead: a swipe shows them at once
  useEffect(() => {
    for (const d of [dates.addDays(day, 1), dates.addDays(day, -1)]) if (d >= today && d <= last && !peek(keyOf(d))) void load(keyOf(d));
  }, [day, today]);
  // the chosen day stays in view in the strip
  useEffect(() => { strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [day]);
  const shown = data && data.day === day ? data : peek<PlanDay>(keyOf(day));
  const days = shown?.strip || Array.from({ length: DAYS }, (_, i) => ({ day: dates.addDays(today, i), count: 0, works: true, off: false }));

  const items: Item[] = shown ? [
    ...shown.rows.map((r) => ({ k: 'appt' as const, at: r.start, r })),
    ...shown.gaps.map((g) => ({ k: 'gap' as const, at: g.start, end: g.end })),
    ...shown.breaks.map((b) => ({ k: 'break' as const, at: b.start, end: b.end, label: b.label }))
  ].sort((a, b) => a.at - b.at || (a.k === 'appt' ? -1 : 1)) : [];

  return (
    <section className="card es-card es-plan" data-guide="espace.planning" aria-label="Mon planning">
      <div className="es-strip" ref={strip} role="group" aria-label="Choisir un jour">
        {days.map((d) => {
          const p = dates.dayParts(d.day);
          return (
            <button key={d.day} type="button" className={'es-sd' + (d.works ? '' : ' rest') + (d.off ? ' off' : '')} aria-pressed={d.day === day}
              aria-label={dayWord(d.day, today) + (d.off ? ', absent' : !d.works ? ', repos' : ', ' + d.count + ' rendez-vous')} onClick={() => setDay(d.day)}>
              <small>{d.day === today ? 'auj.' : dates.DAYS_SH[p.wd]}</small><b>{p.d}</b>
              <i>{d.off ? 'abs.' : !d.works ? 'repos' : d.count ? d.count + ' rdv' : 'libre'}</i>
            </button>
          );
        })}
      </div>
      <div className="es-plan-zone" ref={zone}>
        <div ref={moved}>
          <div className="es-plan-h">
            <button type="button" className="es-arrow" aria-label="Jour précédent" disabled={!can(1)} onClick={() => go(1)}><Icon name="chevL" size={18} /></button>
            <h2 className="grow">{dayWord(day, today)}</h2>
            <button type="button" className="es-arrow" aria-label="Jour suivant" disabled={!can(-1)} onClick={() => go(-1)}><Icon name="chevL" size={18} className="es-flip" /></button>
          </div>
          {!shown && loading ? <Skeleton h={220} r={16} /> : !shown && error ? (
            <Empty icon="alert" title="Planning indisponible" action={<Button variant="primary" onClick={() => { void refresh(); }}>Réessayer</Button>}>{error.message}</Empty>
          ) : shown ? (
            <>
              <p className="es-total" aria-label="Total du jour">
                <b>{shown.total.count} rendez-vous</b>
                {shown.total.minutes ? <span>{span(shown.total.minutes)} réservées{shown.total.work ? ' sur ' + span(shown.total.work) : ''}</span> : shown.total.work ? <span>{span(shown.total.work)} de travail</span> : null}
                {shown.total.cents ? <span className="money">{eur(shown.total.cents)}</span> : null}
                {shown.readOnly ? <span className="badge">Lecture seule</span> : null}
              </p>
              {shown.closed ? <p className="es-plan-note">Le salon est fermé ce jour-là.</p> : null}
              {shown.absence ? <p className="es-plan-note warn"><Icon name="calendar" size={15} />{shown.absence.reason}{shown.absence.part ? ' de ' + time(shown.absence.part.start) + ' à ' + time(shown.absence.part.end) : ''}</p> : null}
              {shown.asked ? <p className="es-plan-note">Absence demandée, en attente du gérant.</p> : null}
              {!shown.work.length && !shown.rows.length && !shown.closed && !shown.absence ? <p className="es-empty"><b>Repos</b><span>Tu ne travailles pas ce jour-là.</span></p> : null}
              {items.length ? (
                <ul className="es-tl" aria-label={'Mon planning, ' + dayWord(day, today)}>
                  {items.map((x) => x.k === 'appt' ? (
                    <li key={x.r.id} className={'es-tl-appt' + (x.r.status === 'done' || x.r.status === 'no_show' ? ' past' : '') + (x.r.status === 'in_chair' ? ' live' : '')}>
                      <button type="button" onClick={() => setOpen(x.r)}>
                        <span className="es-rt tnum">{time(x.r.start)}</span>
                        <span className="es-rn"><b>{x.r.name}</b><small>{x.r.services.join(' + ')} · {x.r.dur} min</small></span>
                        {x.r.late > 0 ? <span className="badge badge-warn">En retard · {x.r.late} min</span> : WORD[x.r.status] ? <span className={'badge ' + (TONE[x.r.status] || '')}>{WORD[x.r.status]}</span> : null}
                      </button>
                    </li>
                  ) : x.k === 'gap' ? (
                    <li key={'g' + x.at} className="es-tl-gap"><span className="es-rt tnum">{time(x.at)}</span><span>Libre jusqu’à {time(x.end)} · {span(x.end - x.at)}</span></li>
                  ) : (
                    <li key={'b' + x.at + x.label} className="es-tl-break"><span className="es-rt tnum">{time(x.at)}</span><span>{x.label} jusqu’à {time(x.end)}</span></li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <ApptSheet row={open} day={shown} onClose={() => setOpen(null)} note={note} onDone={() => { refreshAll(); void refresh(); }} />
    </section>
  );
}

/** One booking of the planning, with the gestures of the moment (today only) and the way to the agenda for the rest. */
function ApptSheet({ row, day, onClose, note, onDone }: { row: PlanRow | null; day: PlanDay | undefined; onClose: () => void; note: (t: NoteTarget) => void; onDone: () => void }) {
  const { offline, can } = useApp();
  const [busy, setBusy] = useState('');
  const r = row;
  const isToday = !!day && day.day === day.today;
  const live = !!day && isToday && !day.readOnly;
  const post = async (what: string, path: string, body: object, done: string) => {
    setBusy(what);
    try { await api.post(path, body); toast({ title: done, icon: 'check' }); onDone(); onClose(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const first = r ? r.name.split(' ')[0] : '';
  const waiting = !!r && (r.status === 'booked' || r.status === 'pending');
  return (
    <Sheet open={!!r} onClose={onClose} title={r ? r.name : ''} kicker={r && day ? dayWord(day.day, day.today) + ' · ' + time(r.start) : undefined}>
      {r && day ? (
        <div className="es-sheet">
          <p className="es-line"><b>{r.services.join(' + ')}</b> · {r.dur} min{r.price ? <> · <span className="money">{eur(r.price)}</span></> : null}</p>
          <p className="es-line">{WORD[r.status] || 'À venir'}{r.late > 0 ? ' · en retard de ' + r.late + ' min' : ''}{r.paid ? ' · encaissé' : ''}</p>
          {r.note ? <p className="es-tech"><b>Note</b> · {r.note}</p> : null}
          {day.readOnly ? <p className="es-plan-note">Ce jour est passé ou clôturé : rien n’y change plus.</p> : null}
          <div className="es-acts">
            {live && waiting ? <Button variant="subtle" icon="check" busy={busy === 'here'} disabled={offline} onClick={() => post('here', '/api/v1/appointments/' + r.id + '/arrival', { answer: 'here' }, first + ' est arrivé')}>Il est là</Button> : null}
            {live && (waiting || r.status === 'arrived') ? <Button variant="primary" icon="chair" busy={busy === 'chair'} disabled={offline} onClick={() => post('chair', '/api/v1/appointments/' + r.id + '/status', { status: 'in_chair' }, 'Au fauteuil · ' + r.name)}>Au fauteuil</Button> : null}
            {live && waiting && r.late > 0 ? <Button variant="ghost" icon="x" busy={busy === 'absent'} disabled={offline} onClick={() => post('absent', '/api/v1/appointments/' + r.id + '/arrival', { answer: 'absent' }, r.name + ' marqué absent')}>Absent</Button> : null}
            {(r.status === 'in_chair' || r.status === 'done') && !day.readOnly ? <Button variant="ghost" icon="edit" disabled={offline} onClick={() => { onClose(); note({ id: r.id, name: r.name }); }}>Note de coupe</Button> : null}
            {/* FEATURE D: « Encaisser » on his phone, when the cut is done and nothing is paid yet:
                {live && !r.paid && (r.status === 'in_chair' || r.status === 'done') && can('sale.create') ? <PhoneCheckout apptId={r.id} onDone={() => { onDone(); onClose(); }} /> : null} */}
            {live && !r.paid && r.status === 'in_chair' && can('sale.create') ? <Button variant="primary" icon="caisse" disabled={offline} onClick={() => navigate('/caisse?rdv=' + r.id)}>Encaisser</Button> : null}
            <Button variant="ghost" icon="calendar" onClick={() => navigate('/agenda?rdv=' + r.id + (isToday ? '' : '&day=' + day.day))}>Ouvrir dans l’agenda</Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
