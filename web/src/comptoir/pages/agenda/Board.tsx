// The day, one column per chair. Mouse and pen can drag an appointment to another time or chair;
// on touch screens the drawer's "Déplacer" does the same job without fighting the scroll.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { Avatar, Chip, Money } from '../../../ui/kit';
import { hhmm, time } from '../../../lib/format';
import { useIsPhone } from '../../../lib/hooks';
import type { Agenda, Appt, Lane } from '../../types';

export type BoardProps = {
  data: Agenda;
  today: string;
  nowMin: number;
  canSeeMoney: boolean;
  myId: string;
  selected: string | null;
  lane: string | null;
  setLane: (id: string) => void;
  onOpen: (a: Appt) => void;
  onEmpty: (staffId: string, min: number, rect: { x: number; y: number }) => void;
  onBlock: (id: string, rect: { x: number; y: number }) => void;
  onMove: (a: Appt, staffId: string, start: number) => void;
  canMove: (a: Appt, toStaff: string) => boolean;
};

const STEP = 15;

export function Board(p: BoardProps) {
  const phone = useIsPhone();
  const px = phone ? 2.1 : 2;
  const { lanes, appts, blocks, holds } = p.data;
  const visible: Lane[] = phone ? lanes.filter((l) => l.id === (p.lane || lanes[0]?.id)) : lanes;
  const isToday = p.data.day === p.today;

  // the drawn range: opening hours, stretched to anything booked outside them
  const [from, to] = useMemo(() => {
    let a = 9 * 60, b = 18 * 60 + 30;
    const starts = lanes.flatMap((l) => l.work.map((w) => w[0])).concat(appts.map((x) => x.start));
    const ends = lanes.flatMap((l) => l.work.map((w) => w[1])).concat(appts.map((x) => x.start + x.dur));
    if (starts.length) a = Math.min(...starts);
    if (ends.length) b = Math.max(...ends);
    return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60];
  }, [lanes, appts]);
  const height = (to - from) * px;
  const y = (m: number) => (m - from) * px;

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  useEffect(() => {
    // open on "now" (or the morning) the first time a day is shown; the page itself never jumps
    if (scrolled.current === p.data.day) return;
    scrolled.current = p.data.day;
    const target = isToday ? p.nowMin - 60 : from;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, y(Math.max(from, target)));
  }, [p.data.day]);

  /* ---------- drag (mouse, pen) ---------- */
  const [drag, setDrag] = useState<{ a: Appt; staffId: string; start: number; ok: boolean } | null>(null);
  const dragRef = useRef<{ a: Appt; dy: number; moved: boolean; x0: number; y0: number } | null>(null);
  const justDragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent, a: Appt) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (!['booked', 'pending', 'arrived'].includes(a.status)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { a, dy: e.clientY - rect.top, moved: false, x0: e.clientX, y0: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    d.moved = true;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-lane]');
    if (!el) return;
    const staffId = el.dataset.lane!;
    const r = el.getBoundingClientRect();
    let start = Math.round(((e.clientY - d.dy - r.top) / px + from) / STEP) * STEP;
    start = Math.max(from, Math.min(to - d.a.dur, start));
    const clash = appts.some((x) => x.id !== d.a.id && x.staffId === staffId && !['cancelled', 'no_show'].includes(x.status) && x.start < start + d.a.dur && start < x.start + x.dur)
      || blocks.some((b) => b.staffId === staffId && b.start < start + d.a.dur && start < b.start + b.dur);
    setDrag({ a: d.a, staffId, start, ok: !clash && p.canMove(d.a, staffId) });
  };
  const onPointerUp = (a: Appt) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    // the click that follows a drag must not open the card
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const g = drag;
    setDrag(null);
    if (g && g.ok && (g.start !== a.start || g.staffId !== a.staffId)) p.onMove(a, g.staffId, g.start);
  };

  const hours = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  const nowY = isToday && p.nowMin >= from && p.nowMin <= to ? y(p.nowMin) : null;
  const cols = phone ? '46px minmax(0, 1fr)' : `56px repeat(${visible.length}, minmax(140px, 1fr))`;

  return (
    <section className="board" aria-label="Planning de la journée">
      {phone && lanes.length > 1 ? (
        <div className="lane-pick" role="tablist" aria-label="Barbier affiché">
          {lanes.map((l) => <Chip key={l.id} small on={l.id === (p.lane || lanes[0]?.id)} dot={l.color} onClick={() => p.setLane(l.id)}>{l.name}{l.id === p.myId ? ' (moi)' : ''}</Chip>)}
        </div>
      ) : null}
      <div className="board-h" style={{ gridTemplateColumns: cols }}>
        <span className="gut-h">{isToday ? <span className="now-chip tnum">{hhmm(p.nowMin)}</span> : null}</span>
        {visible.map((l) => {
          const mine = appts.filter((x) => x.staffId === l.id && x.status !== 'cancelled').sort((a, b) => a.start - b.start);
          const live = isToday ? mine.find((x) => x.status === 'in_chair') : null;
          const next = isToday ? mine.find((x) => x.start > p.nowMin && ['booked', 'arrived', 'pending'].includes(x.status)) : null;
          const rev = mine.reduce((t, x) => t + (x.status === 'done' ? x.price : 0), 0);
          const off = !l.work.length;
          const line = off ? 'Absent aujourd’hui' : !isToday ? mine.filter((x) => x.status !== 'no_show').length + ' rendez-vous' : live ? 'Au fauteuil · ' + live.name.split(' ')[0] + ' · fin ' + time(live.start + live.dur) : next ? 'Libre jusqu’à ' + time(next.start) : 'Libre';
          return (
            <div key={l.id} className={'lh' + (live ? ' busy' : '')}>
              <Avatar name={l.name} initials={l.initials} color={l.color} />
              <span className="lh-t"><b>{l.name}</b><small>{line}</small></span>
              {p.canSeeMoney && !phone ? <span className="lh-rev"><Money cents={rev} /></span> : null}
            </div>
          );
        })}
      </div>
      <div className="board-scroll" ref={scrollRef}>
      <div className="tl" style={{ gridTemplateColumns: phone ? '46px minmax(0, 1fr)' : '56px minmax(0, 1fr)', height }}>
        <div className="hours" aria-hidden>{hours.map((m) => <span key={m} style={{ top: y(m) }}>{hhmm(m)}</span>)}</div>
        <div className="lanes-g" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(${phone ? 0 : 140}px, 1fr))`, backgroundSize: `100% ${60 * px}px, 100% ${30 * px}px` }}>
          {visible.map((l) => {
            const offIv: [number, number][] = [];
            let t = from;
            for (const [a, b] of [...l.work].sort((x, z) => x[0] - z[0])) { if (a > t) offIv.push([t, a]); t = Math.max(t, b); }
            if (t < to) offIv.push([t, to]);
            return (
              <div key={l.id} className={'lane' + (drag && drag.staffId === l.id ? ' drop' : '')} data-lane={l.id}
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const m = Math.floor(((e.clientY - r.top) / px + from) / 15) * 15;
                  p.onEmpty(l.id, Math.max(from, Math.min(to - 15, m)), { x: e.clientX, y: e.clientY });
                }}>
                {offIv.map(([a, b]) => <div key={a} className="off" style={{ top: y(a), height: (b - a) * px }} />)}
                {blocks.filter((b) => b.staffId === l.id).map((b) => (
                  <button key={b.id} type="button" className="bl" style={{ top: y(b.start) + 1, height: b.dur * px - 2 }} onClick={(e) => p.onBlock(b.id, { x: e.clientX, y: e.clientY })} aria-label={'Bloqué ' + time(b.start) + ' – ' + time(b.start + b.dur) + ' : ' + b.label}>
                    <Icon name="block" size={13} />{b.label} · {hhmm(b.start)}
                  </button>
                ))}
                {holds.filter((h) => h.staffId === l.id).map((h) => (
                  <div key={h.id} className="bl hold" style={{ top: y(h.start) + 1, height: h.dur * px - 2 }} aria-label="Un client réserve ce créneau en ce moment">
                    <Icon name="globe" size={13} />{h.by === 'waitlist' ? 'Proposé à la liste d’attente' : 'Réservation en cours…'}
                  </div>
                ))}
                {appts.filter((a) => a.staffId === l.id && a.status !== 'cancelled').map((a) => (
                  <ApptCard key={a.id} a={a} px={px} top={y(a.start)} laneColor={l.color} selected={p.selected === a.id} dragging={drag?.a.id === a.id}
                    fresh={Date.now() - a.createdAt < 120000 && a.source === 'site'} showMoney={p.canSeeMoney}
                    onPointerDown={(e) => onPointerDown(e, a)} onPointerMove={onPointerMove} onPointerUp={() => onPointerUp(a)}
                    onClick={() => { if (!justDragged.current) p.onOpen(a); }} />
                ))}
                {drag && drag.staffId === l.id ? <ApptCard a={{ ...drag.a, start: drag.start }} px={px} top={y(drag.start)} laneColor={l.color} ghost bad={!drag.ok} showMoney={false} /> : null}
              </div>
            );
          })}
          {nowY != null ? <div className="nowline" style={{ top: nowY }} aria-hidden /> : null}
        </div>
      </div>
      </div>
    </section>
  );
}

function ApptCard({ a, px, top, laneColor, selected, dragging, ghost, bad, fresh, showMoney, onPointerDown, onPointerMove, onPointerUp, onClick }: {
  a: Appt; px: number; top: number; laneColor: string; selected?: boolean; dragging?: boolean; ghost?: boolean; bad?: boolean; fresh?: boolean; showMoney: boolean;
  onPointerDown?: (e: React.PointerEvent) => void; onPointerMove?: (e: React.PointerEvent) => void; onPointerUp?: (e: React.PointerEvent) => void; onClick?: () => void;
}) {
  const h = a.dur * px - 3;
  const short = h < 40;
  const badges = a.client?.badges || [];
  const cls = ['ap', 'st-' + a.status, short ? 'short' : '', selected ? 'sel' : '', dragging ? 'dragging' : '', ghost ? 'ghost' : '', bad ? 'bad' : '', fresh ? 'fresh' : ''].filter(Boolean).join(' ');
  // a client who already missed: the count in words on the card, not one more icon to decode
  const missed = badges.includes('absences') && a.client && a.client.noShows ? a.client.noShows + (a.client.noShows > 1 ? ' absences' : ' absence') : '';
  const svc = a.services.map((s) => s.name.replace('Coupe + ', '+ ').replace(' de barbe', '')).join(' · ');
  const label = `${time(a.start)}, ${a.name}, ${a.services.map((s) => s.name).join(' et ')}, ${a.status === 'in_chair' ? 'au fauteuil' : a.status === 'done' ? 'terminé' : a.status === 'no_show' ? 'absent' : a.status === 'arrived' ? 'arrivé' : a.status === 'pending' ? 'acompte en attente' : 'à venir'}${missed ? ', ' + missed : ''}`;
  return (
    <button type="button" className={cls} style={{ top: top + 1, height: h, ['--lc' as any]: laneColor }} aria-label={label}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={onClick} tabIndex={ghost ? -1 : undefined}>
      <span className="ap-top">
        {short ? <span className="ap-t">{hhmm(a.start)}</span> : null}
        <span className="ap-n">{a.name}</span>
        {!short ? <span className="ap-ic">
          {a.source === 'site' ? <Icon name="globe" /> : a.source === 'phone' ? <Icon name="phone" /> : a.source === 'walkin' ? <Icon name="walk" /> : null}
          {badges.includes('nouveau') ? <Icon name="sparkle" /> : null}
          {missed ? <span className="badge badge-warn" style={{ height: 17, padding: '0 6px', fontSize: 10.5 }}>{missed}</span> : null}
          {a.deposit && a.deposit.paid ? <Icon name="card" /> : null}
        </span> : null}
      </span>
      <span className="ap-s"><span><b className="ap-t">{hhmm(a.start)}</b> · {svc}</span>{showMoney ? <Money cents={a.price} /> : null}</span>
    </button>
  );
}
