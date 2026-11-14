// The agenda on a phone, for whoever runs the salon with one hand. A week strip on top (how full each day is, today
// marked, a touch jumps), then three ways to read the day, remembered on the device:
//   « Salon »   every chair side by side in narrow columns: who is busy, who is free, the gaps, the line of the hour;
//               four chairs fit the screen, a fifth is reached by sliding the columns
//   « Barbier » one chair, full width, with the details of each appointment
//   « Liste »   the day in order, hour by hour, with the state of each appointment
// A swipe to the left or to the right changes day (in « Barbier »: changes barber); the page itself scrolls up and
// down, the week strip and the names stay in sight. A free stretch says « Libre 30 min » and books there in one touch.
// Nothing here decides what may be booked: it draws GET /api/v1/agenda (rules: agenda/day.ts).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { qs } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { cap, dates, dur, hhmm, STATUS, time } from '../../../lib/format';
import { useInterval } from '../../../lib/hooks';
import { Icon } from '../../../ui/Icon';
import { Chip, Empty, Seg, Skeleton } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Agenda, Appt, Lane } from '../../types';
import { serieWords } from '../../types';
import { ApptCard, apptLabel, missedOf } from './Board';
import { layoutOverlaps, type Place } from './overlap';
import { byHour, drawnRange, freeGaps, loadOf, loadWords, offZones, OFF_LABEL, slotAt, type Iv } from './day';
import { useSwipe } from './swipe';
import { arrivalWords } from '../espace/Arrival';

export type PhoneView = 'salon' | 'barbier' | 'liste';
export const VIEW_KEY = 'lx-agenda-tel';
export const viewOf = (v: unknown): PhoneView => (v === 'barbier' || v === 'liste' ? v : 'salon');
/** chairs side by side without sliding */
const FIT = 4;
const GUT = 36;

type At = { x: number; y: number };
export type PhoneProps = {
  data: Agenda | undefined; loading: boolean; error?: ReactNode;
  day: string; today: string;
  /** now, in steps of five minutes: what is free from now on, who is busy (the line of the hour moves by itself) */
  nowStep: number;
  view: PhoneView; setView: (v: PhoneView) => void;
  lane: string | null; setLane: (id: string) => void;
  selected: string | null; myId: string; canSeeMoney: boolean;
  /** beside the switch: « Aujourd’hui », the file */
  extra?: ReactNode;
  /** shown in place of the planning on a day nobody works */
  closed?: ReactNode;
  onDay: (d: string) => void;
  onOpen: (a: Appt) => void;
  onFree: (staffId: string, min: number) => void;
  onEmpty: (staffId: string, min: number, at: At) => void;
  onBlock: (id: string, at: At) => void;
  onLane?: (staffId: string, at: At) => void;
};

type WeekData = { days: { day: string; staff: { minutes: number; cap: number }[] }[] };

/** The week of the day shown: seven days, how full each one is, today marked. A touch jumps; a swipe changes week. */
function WeekStrip({ day, today, onDay }: { day: string; today: string; onDay: (d: string) => void }) {
  const from = dates.weekStart(day);
  const { data } = useQuery<WeekData>('/api/v1/week' + qs({ day: from }));
  const ref = useRef<HTMLDivElement>(null);
  useSwipe(ref, { on: true, go: (dir) => onDay(dates.addDays(day, dir < 0 ? 7 : -7)) });
  return (
    <div className="agp-week" ref={ref} role="group" aria-label="Semaine">
      {Array.from({ length: 7 }, (_, i) => dates.addDays(from, i)).map((d) => {
        const p = dates.dayParts(d);
        const row = data?.days.find((x) => x.day === d);
        const load = row ? loadOf(row.staff) : undefined;
        return (
          <button key={d} type="button" className={'agp-d' + (d === today ? ' today' : '') + (load === null ? ' shut' : '')} aria-pressed={d === day} aria-current={d === today ? 'date' : undefined}
            aria-label={cap(dates.dayLong(d)) + (d === today ? ', aujourd’hui' : '') + (load !== undefined ? ', ' + loadWords(load) : '')} onClick={() => onDay(d)}>
            <small>{d === today ? 'auj.' : dates.DAYS_SH[p.wd].replace('.', '')}</small>
            <b className="tnum">{p.d}</b>
            <i className="agp-load" aria-hidden>{load != null ? <i style={{ width: Math.max(8, Math.round(load * 100)) + '%' }} data-full={load >= 0.85 ? '1' : undefined} /> : null}</i>
          </button>
        );
      })}
    </div>
  );
}

/** The line of the hour: it reads the salon's clock by itself, so the planning is not drawn again every minute. */
function NowLine({ from, to, px, chip }: { from: number; to: number; px: number; chip?: boolean }) {
  const app = useApp();
  const [, tick] = useState(0);
  useInterval(() => tick((t) => t + 1), 30000);
  const min = dates.localParts(app.now()).min;
  if (min < from || min > to) return null;
  return <div className="nowline agp-now" style={{ top: (min - from) * px }} aria-hidden>{chip ? <span className="tnum">{hhmm(min)}</span> : null}</div>;
}

export const PhoneAgenda = memo(function PhoneAgenda(p: PhoneProps) {
  const { data } = p;
  const lanes = data?.lanes || [];
  const appts = data?.appts || [];
  const blocks = data?.blocks || [];
  const holds = data?.holds || [];
  const isToday = p.day === p.today;
  // one chair (a barber on his own agenda): « Salon » and « Barbier » are the same thing
  const solo = lanes.length <= 1;
  const view: PhoneView = solo && p.view === 'salon' ? 'barbier' : p.view;
  const cur = lanes.find((l) => l.id === p.lane) || lanes[0];
  const visible: Lane[] = view === 'barbier' ? (cur ? [cur] : []) : lanes;
  const compact = view === 'salon';
  const wide = compact && lanes.length > FIT;
  const px = compact ? 1.55 : 2.1;
  const gut = compact ? GUT : 46;

  const [from, to] = useMemo(() => drawnRange(lanes.map((l) => l.work), appts), [data]);
  const y = (m: number) => (m - from) * px;
  const floor = p.day < p.today ? Infinity : isToday ? p.nowStep : 0;
  const shopOpen = lanes.some((l) => l.work.length > 0);
  const nothing = !!data && (!lanes.length || (!shopOpen && !appts.length));

  const places = useMemo(() => {
    const m = new Map<string, Place>();
    for (const l of lanes) for (const [id, pl] of layoutOverlaps(appts.filter((a) => a.staffId === l.id && a.status !== 'cancelled'))) m.set(id, pl);
    return m;
  }, [data]);
  const byId = useMemo(() => new Map(appts.map((a) => [a.id, a])), [data]);
  const clashOf = (a: Appt): Appt[] => (a.status === 'no_show' ? [] : (places.get(a.id)?.clash || []).map((id) => byId.get(id)!).filter((o) => o && o.status !== 'no_show'));

  /* ---------- the sticky head sits under the Comptoir's title bar, whatever its height ---------- */
  const root = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const topOf = () => (document.querySelector<HTMLElement>('.top')?.offsetHeight ?? 56) + (document.querySelector<HTMLElement>('.down-bar')?.offsetHeight ?? 0);
  useLayoutEffect(() => { root.current?.style.setProperty('--agp-top', topOf() + 'px'); }, []);
  // a pull down at the top of the planning must not reload the page under the finger
  useEffect(() => {
    const els = [document.documentElement, document.body];
    const was = els.map((e) => e.style.overscrollBehaviorY);
    els.forEach((e) => { e.style.overscrollBehaviorY = 'contain'; });
    return () => els.forEach((e, i) => { e.style.overscrollBehaviorY = was[i]; });
  }, []);

  // open on « now » (an hour before) the first time today is shown; a swipe to another day keeps the hour in sight
  // (so does a change of view, whose scale is not the same)
  const opened = useRef('');
  useEffect(() => {
    if (opened.current === view || !data || !isToday || nothing) return;
    const first = !opened.current;
    opened.current = view;
    const at = view === 'liste' ? root.current?.querySelector<HTMLElement>('.agp-nowrow') : null;
    const el = body.current;
    if (!el || !sticky.current) return;
    const under = topOf() + sticky.current.offsetHeight + 6;
    const want = view === 'liste' ? (at ? at.getBoundingClientRect().top : null) : p.nowStep - 60 > from ? el.getBoundingClientRect().top + y(p.nowStep - 60) : null;
    if (want != null && (want > under || !first)) window.scrollTo({ top: Math.max(0, window.scrollY + want - under) });
  }, [data, view]);

  // the barber shown keeps his chip in sight (a swipe may have chosen him)
  useEffect(() => { if (view === 'barbier') root.current?.querySelector('.lane-pick .chip[aria-pressed="true"], .lane-pick .chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [cur?.id, view]);

  /* ---------- the swipe: a day, or a barber ---------- */
  const laneAt = (dir: -1 | 1) => { const i = lanes.findIndex((l) => l.id === cur?.id); return lanes[i - dir]; };
  useSwipe(zone, {
    on: !wide,
    can: (dir) => view !== 'barbier' || solo || !!laneAt(dir),
    go: (dir) => { if (view === 'barbier' && !solo) { const l = laneAt(dir); if (l) p.setLane(l.id); } else p.onDay(dates.addDays(p.day, dir < 0 ? 1 : -1)); }
  }, body);

  /* ---------- pieces ---------- */
  const stateOf = (l: Lane): { text: string; cls: string; live: boolean } => {
    const mine = appts.filter((x) => x.staffId === l.id && x.status !== 'cancelled' && x.status !== 'no_show');
    if (!l.work.length) return { text: shopOpen ? 'Absent' : 'Fermé', cls: 'is-off', live: false };
    if (!isToday) return { text: mine.length + ' rdv', cls: '', live: false };
    const live = mine.find((x) => x.status === 'in_chair');
    if (live) return { text: compact ? 'Occupé' : 'Au fauteuil · ' + live.name.split(' ')[0] + ' · fin ' + time(live.start + live.dur), cls: 'is-busy', live: true };
    const now = p.nowStep;
    const zoneNow = offZones(l.work, from, to, shopOpen).find((z) => now >= z.a && now < z.b);
    if (zoneNow) return { text: OFF_LABEL[zoneNow.kind], cls: 'is-off', live: false };
    const taken = [...mine.filter((x) => x.status !== 'done'), ...blocks.filter((b) => b.staffId === l.id), ...holds.filter((h) => h.staffId === l.id)].some((x) => x.start <= now && x.start + x.dur > now);
    if (taken) return { text: 'Occupé', cls: 'is-busy', live: false };
    const next = mine.filter((x) => x.start > now && ['booked', 'arrived', 'pending'].includes(x.status)).sort((a, b) => a.start - b.start)[0];
    return { text: compact ? 'Libre' : next ? 'Libre jusqu’à ' + time(next.start) : 'Libre', cls: 'is-free', live: false };
  };

  // more than four chairs: each column keeps a quarter of the screen (a little less, so the next one shows) and the
  // columns slide sideways under the finger, the hours staying in place
  const cols = wide ? `${gut}px repeat(${visible.length}, calc((100vw - 28px - ${gut}px) / 4.35))` : `${gut}px repeat(${Math.max(1, visible.length)}, minmax(0, 1fr))`;
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);

  const lanesBody = (
    <div className={'agp-grid' + (compact ? ' compact' : '') + (wide ? ' wide' : '')} onScroll={wide ? (e) => { if (heads.current) heads.current.scrollLeft = (e.currentTarget as HTMLElement).scrollLeft; } : undefined}>
      <div className="agp-tl" style={{ gridTemplateColumns: cols, height: (to - from) * px, backgroundSize: `100% ${60 * px}px, 100% ${30 * px}px`, backgroundPosition: `${gut}px 0`, ['--gut' as any]: gut + 'px' }}>
        <div className="hours agp-hours" aria-hidden>{hours.map((m) => <span key={m} style={{ top: y(m) }}>{compact ? Math.floor(m / 60) + ' h' : hhmm(m)}</span>)}</div>
        {visible.map((l) => {
          const mine = appts.filter((a) => a.staffId === l.id && a.status !== 'cancelled');
          const free = freeGaps(l.work, [...mine.filter((a) => a.status !== 'no_show'), ...blocks.filter((b) => b.staffId === l.id), ...holds.filter((h) => h.staffId === l.id)], floor);
          return (
            <div key={l.id} className="lane agp-lane" data-lane={l.id}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const r = e.currentTarget.getBoundingClientRect();
                const m = Math.floor(((e.clientY - r.top) / px + from) / 15) * 15;
                p.onEmpty(l.id, Math.max(from, Math.min(to - 15, m)), { x: e.clientX, y: e.clientY });
              }}>
              {offZones(l.work, from, to, shopOpen).map((z) => <div key={z.a} className={'off off-' + z.kind} style={{ top: y(z.a), height: (z.b - z.a) * px }}>{z.kind !== 'ferme' && (z.b - z.a) * px >= 20 ? <span>{OFF_LABEL[z.kind]}</span> : null}</div>)}
              {free.map((g) => <FreeSlot key={'f' + g[0]} gap={g} px={px} top={y(g[0])} who={l.name} onPick={(m) => p.onFree(l.id, m)} />)}
              {blocks.filter((b) => b.staffId === l.id).map((b) => (
                <button key={b.id} type="button" className="bl" style={{ top: y(b.start) + 1, height: b.dur * px - 2 }} onClick={(e) => p.onBlock(b.id, { x: e.clientX, y: e.clientY })} aria-label={'Bloqué ' + time(b.start) + ' – ' + time(b.start + b.dur) + ' : ' + b.label}>
                  {compact ? null : <Icon name="block" size={13} />}{b.label}{compact ? '' : ' · ' + hhmm(b.start)}
                </button>
              ))}
              {holds.filter((h) => h.staffId === l.id).map((h) => (
                <div key={h.id} className="bl hold" style={{ top: y(h.start) + 1, height: h.dur * px - 2 }} aria-label="Un client réserve ce créneau en ce moment">
                  <Icon name="globe" size={13} />{compact ? '' : h.by === 'waitlist' ? 'Proposé à la liste d’attente' : 'Réservation en cours…'}
                </div>
              ))}
              {mine.map((a) => compact
                ? <MiniCard key={a.id} a={a} px={px} top={y(a.start)} laneColor={l.color} place={places.get(a.id)} clash={clashOf(a)} selected={p.selected === a.id} onOpen={p.onOpen} />
                : <ApptCard key={a.id} a={a} px={px} top={y(a.start)} laneColor={l.color} place={places.get(a.id)} clash={clashOf(a)} selected={p.selected === a.id} showMoney={p.canSeeMoney} fresh={false} onClick={() => p.onOpen(a)} />)}
            </div>
          );
        })}
        {isToday ? <NowLine from={from} to={to} px={px} chip /> : null}
      </div>
    </div>
  );

  const shown = appts.filter((a) => a.status !== 'cancelled');
  const firstAhead = isToday ? [...shown].sort((a, b) => a.start - b.start).find((a) => a.start + a.dur > p.nowStep && a.status !== 'done' && a.status !== 'no_show') : null;
  const list = shown.length ? (
    <ol className="agp-list">
      {byHour(shown).map((g) => (
        <li key={g.hour} className="agp-hour">
          <h3 className="tnum">{g.hour} h</h3>
          <ul>
            {g.items.map((a) => {
              const l = lanes.find((x) => x.id === a.staffId);
              const late = isToday && a.status === 'booked' && p.nowStep - a.start >= 5;
              const missed = missedOf(a);
              return (
                <li key={a.id} className={firstAhead && firstAhead.id === a.id ? 'agp-nowrow' : undefined}>
                  <button type="button" className={'agp-row st-' + a.status + (p.selected === a.id ? ' sel' : '')} onClick={() => p.onOpen(a)}>
                    <span className="agp-row-h tnum">{hhmm(a.start)}</span>
                    <span className="agp-row-t">
                      <b className="ellipsis">{a.name}</b>
                      <small className="ellipsis">{a.services.map((s) => s.name).join(' + ')}{a.formule ? ' · ' + serieWords(a.formule) : ''}{missed ? ' · ' + missed : ''}{arrivalWords(a as any) ? ' · ' + arrivalWords(a as any) : ''}</small>
                    </span>
                    <span className="agp-row-e">
                      <span className={'agp-st ' + (late ? 'late' : a.status)}>{late ? 'En retard' : STATUS[a.status] || a.status}</span>
                      {solo || !l ? null : <small className="ellipsis"><i style={{ background: l.color }} aria-hidden />{l.name}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  ) : <div className="agp-none"><Empty icon="calendar" title="Aucun rendez-vous ce jour-là">Touche « Rendez-vous » pour en prendre un.</Empty></div>;

  return (
    <section ref={root} className={'board agp agp-' + view} aria-label="Planning de la journée" data-guide="ag-board" data-view={view}>
      <div className="agp-sticky" ref={sticky}>
        <WeekStrip day={p.day} today={p.today} onDay={p.onDay} />
        <div className="agp-bar">
          <Seg label="Affichage" value={view} onChange={p.setView}
            options={solo ? [{ v: 'barbier' as PhoneView, t: 'Planning' }, { v: 'liste' as PhoneView, t: 'Liste' }] : [{ v: 'salon' as PhoneView, t: 'Salon' }, { v: 'barbier' as PhoneView, t: 'Barbier' }, { v: 'liste' as PhoneView, t: 'Liste' }]} />
          {p.extra}
        </div>
        {data && !nothing && view === 'barbier' && !solo ? (
          <div className="lane-pick" role="tablist" aria-label="Barbier affiché">
            {lanes.map((l) => <Chip key={l.id} small on={l.id === cur?.id} dot={l.color} onClick={() => p.setLane(l.id)}>{l.name}{l.id === p.myId ? ' (moi)' : ''}</Chip>)}
          </div>
        ) : null}
        {data && !nothing && view !== 'liste' ? (
          <div className={'agp-heads' + (compact ? ' compact' : '') + (wide ? ' wide' : '')} ref={heads}>
            <div className="agp-heads-in" style={{ gridTemplateColumns: cols }}>
              <span />
              {visible.map((l) => {
                const st = stateOf(l);
                const clashes = appts.filter((x) => x.staffId === l.id && x.status !== 'cancelled' && clashOf(x).length);
                const inner = <><i className="agp-dot" style={{ background: l.color }} aria-hidden /><span className="agp-h-t"><b className="ellipsis">{l.name}</b><small className={'ellipsis ' + (clashes.length ? 'clash' : st.cls)}>{clashes.length ? (compact ? 'Doublon' : clashOf(clashes[0]).length + 1 + ' clients à ' + time(Math.min(...clashOf(clashes[0]).map((x) => x.start)))) : st.text}</small></span></>;
                return p.onLane && l.work.length && isToday
                  ? <button key={l.id} type="button" className={'agp-h' + (st.live ? ' live' : '')} aria-label={l.name + ', ' + st.text + ' : absent aujourd’hui ou pause'} onClick={(e) => p.onLane!(l.id, { x: e.clientX, y: e.clientY })}>{inner}</button>
                  : <div key={l.id} className={'agp-h' + (st.live ? ' live' : '')}>{inner}</div>;
              })}
            </div>
          </div>
        ) : null}
      </div>
      <div className="agp-zone" ref={zone} data-wide={wide ? '1' : undefined}>
        <div className="agp-body" ref={body} aria-busy={p.loading}>
          {p.error ? p.error : !data ? <Skeleton h={480} r={18} /> : nothing ? p.closed : view === 'liste' ? list : lanesBody}
        </div>
      </div>
    </section>
  );
});

/** A free stretch of a chair: it says so, and a touch books at the quarter touched. */
function FreeSlot({ gap, px, top, who, onPick }: { gap: Iv; px: number; top: number; who: string; onPick: (min: number) => void }) {
  const h = (gap[1] - gap[0]) * px - 2;
  return (
    <button type="button" className={'fr' + (h < 30 ? ' short' : '')} style={{ top: top + 1, height: h }}
      aria-label={'Libre ' + dur(gap[1] - gap[0]) + ' chez ' + who + ', de ' + time(gap[0]) + ' à ' + time(gap[1]) + '. Prendre un rendez-vous ici'}
      onClick={(e) => {
        // a keyboard or a screen reader has no place under the finger: the start of the stretch
        const r = e.currentTarget.getBoundingClientRect();
        onPick(e.detail === 0 ? gap[0] : slotAt(gap, gap[0] + (e.clientY - r.top) / px));
      }}>
      <span><b>Libre</b> {dur(gap[1] - gap[0])}</span>
    </button>
  );
}

/** An appointment in a narrow column: the name, the hour when there is room; everything else is one touch away. */
function MiniCard({ a, px, top, laneColor, place, clash, selected, onOpen }: { a: Appt; px: number; top: number; laneColor: string; place?: Place; clash: Appt[]; selected: boolean; onOpen: (a: Appt) => void }) {
  const h = a.dur * px - 2;
  const shared = !!place && place.cols > 1;
  const missed = missedOf(a);
  const cls = ['ap', 'agp-ap', 'st-' + a.status, h < 32 ? 'short' : '', selected ? 'sel' : '', clash.length ? 'clash' : '', shared ? 'shared' : ''].filter(Boolean).join(' ');
  const share = place && shared ? { left: `calc(2px + (100% - 4px) * ${place.col} / ${place.cols})`, right: 'auto', width: `calc((100% - 4px) / ${place.cols} - ${place.col < place.cols - 1 ? 2 : 0}px)` } : null;
  return (
    <button type="button" className={cls} style={{ top: top + 1, height: h, ['--lc' as any]: laneColor, ...share }} aria-label={apptLabel(a, missed, clash)} data-clash={clash.length ? '1' : undefined} onClick={() => onOpen(a)}>
      <span className="ap-n">{a.name}</span>
      {h >= 32 ? <span className="ap-s"><span><b className="ap-t">{hhmm(a.start)}</b></span>{missed ? <i className="agp-miss" title={missed} aria-hidden /> : null}</span> : null}
    </button>
  );
}
