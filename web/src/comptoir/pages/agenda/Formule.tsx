// The weekly carnet sold at the desk (« 5 coupes sur 5 semaines »): once the first date is chosen in « Nouveau
// rendez-vous », the four other dates are proposed (same weekday, hour and barber; the nearest slot of the week and why
// when that one is not free), each line changed or left for later, and the five are booked in one go
// (POST /api/v1/formules: all of them or none). The 80 € are asked by the till at the first cut.
import { useEffect, useState } from 'react';
import { qs } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { cap, dates, hhmm, time } from '../../../lib/format';
import { Button, Note, Skeleton } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Service } from '../../types';

export type SerieWeek = { week: number; day: string; start: number; staffId: string; exact: boolean; why: string; none?: boolean; later?: boolean };
type Series = { weeks: SerieWeek[]; credits: number; end: string; price: number };

/** The weekly carnet the salon sells, with the cut it pays for; null when there is none. */
export function weeklyCarnet(services: Service[]): { pack: Service; coverId: string } | null {
  const pack = services.filter((s) => s.active && s.pack && s.pack.weekly).sort((a, b) => a.order - b.order)[0];
  const coverId = pack ? (pack.pack!.serviceIds || []).find((id) => services.some((s) => s.id === id && s.active)) : null;
  return pack && coverId ? { pack, coverId } : null;
}

/** The days of one week of the carnet and what is free on them, to change one line. */
function WeekPicker({ from, coverId, staffId, value, onPick }: { from: string; coverId: string; staffId: string; value: SerieWeek; onPick: (v: { day: string; start: number; staffId: string }) => void }) {
  const { staffById } = useApp();
  const [who, setWho] = useState(staffId);
  const { data, loading } = useQuery<{ days: { day: string; slots: { m: number; s: string }[] }[] }>('/api/v1/slots' + qs({ day: from, days: 7, services: coverId, staff: who }));
  const days = (data?.days || []).filter((d) => d.slots.length);
  const [day, setDay] = useState<string | null>(null);
  const cur = days.find((d) => d.day === day) || days.find((d) => d.day === value.day) || days[0];
  if (loading) return <Skeleton h={90} />;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button size="sm" variant={who === staffId ? 'primary' : 'ghost'} onClick={() => setWho(staffId)}>{staffById.get(staffId)?.name || 'Ce barbier'}</Button>
        <Button size="sm" variant={who === 'any' ? 'primary' : 'ghost'} onClick={() => setWho('any')}>Tous les barbiers</Button>
      </div>
      {!cur ? <Note icon="clock">Rien de libre cette semaine-là{who !== 'any' ? ' pour ' + (staffById.get(who)?.name || '') : ''}.</Note> : (
        <>
          <div className="days" role="group" aria-label="Jour de cette semaine">
            {days.map((d) => { const p = dates.dayParts(d.day); return <button key={d.day} type="button" className="dayc" aria-pressed={d.day === cur.day} onClick={() => setDay(d.day)}><small>{dates.DAYS_SH[p.wd]}</small><b>{p.d}</b></button>; })}
          </div>
          <div className="slots">{cur.slots.map((x) => <button key={x.m + x.s} type="button" className="slot" aria-pressed={!value.later && value.day === cur.day && value.start === x.m && value.staffId === x.s} onClick={() => onPick({ day: cur.day, start: x.m, staffId: x.s })}>{hhmm(x.m)}{who === 'any' ? <small>{staffById.get(x.s)?.name}</small> : null}</button>)}</div>
        </>
      )}
    </div>
  );
}

/** « Les 4 autres dates » under the first one. weeks null: still being read. */
export function FormuleDates({ coverId, first, weeks, onChange }: { coverId: string; first: { day: string; start: number; staffId: string }; weeks: SerieWeek[] | null; onChange: (w: SerieWeek[] | null) => void }) {
  const { staffById } = useApp();
  const [edit, setEdit] = useState<number | null>(null);
  const { data, error } = useQuery<Series>('/api/v1/formule/series' + qs({ staff: first.staffId, day: first.day, start: first.start }));
  // a new first date proposes the others again
  useEffect(() => { onChange(data ? data.weeks.map((w) => ({ ...w, later: !!w.none })) : null); setEdit(null); }, [data, first.day, first.start, first.staffId]);
  if (error) return <Note icon="alert">{error.message}</Note>;
  if (!weeks || !data) return <Skeleton h={160} />;
  const set = (week: number, patch: Partial<SerieWeek>) => onChange(weeks.map((w) => (w.week === week ? { ...w, ...patch } : w)));
  return (
    <div className="col" style={{ gap: 10 }} data-guide="agenda-carnet-dates">
      <p className="section-k">Les {weeks.length} autres dates</p>
      {weeks.map((w) => (
        <div key={w.week} className="col" style={{ gap: 8 }}>
          <div className="pick-r" aria-pressed={edit === w.week}>
            <span className="li-main"><b>{w.later ? 'Semaine ' + (w.week + 1) + ' · plus tard' : cap(dates.dayShort(w.day)) + ' · ' + time(w.start) + ' · ' + (staffById.get(w.staffId)?.name || '')}</b><small>{w.why ? w.why + (w.none ? ' : rien de libre cette semaine.' : w.later ? '.' : ' : le plus proche cette semaine.') : w.later ? 'À réserver ensuite, avec le client' : 'Coupe ' + (w.week + 1) + ' sur ' + data.credits}</small></span>
            <Button size="sm" variant="ghost" onClick={() => setEdit(edit === w.week ? null : w.week)}>{edit === w.week ? 'Fermer' : w.later ? 'Choisir' : 'Modifier'}</Button>
            {!w.later ? <Button size="sm" variant="ghost" onClick={() => { set(w.week, { later: true }); setEdit(null); }}>Plus tard</Button> : null}
          </div>
          {edit === w.week ? <WeekPicker from={dates.addDays(first.day, 7 * w.week)} coverId={coverId} staffId={first.staffId} value={w} onPick={(v) => { set(w.week, { ...v, later: false, none: false, why: '', exact: v.day === dates.addDays(first.day, 7 * w.week) && v.start === first.start && v.staffId === first.staffId }); setEdit(null); }} /> : null}
        </div>
      ))}
      <p className="muted" style={{ fontSize: 13.5 }}>Une coupe par semaine, jusqu’au {dates.dayLong(data.end)}. Chaque date se déplace ou s’annule séparément ensuite.</p>
    </div>
  );
}
