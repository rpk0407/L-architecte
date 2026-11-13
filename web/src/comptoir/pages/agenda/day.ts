// What a day's planning shows besides the appointments: the hours drawn, why a stretch is not bookable (closed, a
// pause, away), and the free stretches, which read « Libre 30 min » instead of an empty space. Display rules only, from
// what GET /api/v1/agenda already says (each chair's working intervals, the appointments, the blocks, the held slots);
// what may really be booked stays the server's answer. Plain rules without React: Phone.tsx and Board.tsx draw from
// them, tests/unit/agenda-day.test.js reads the same ones.

export type Iv = [number, number];
type Span = { start: number; dur: number };

/** a stretch without work inside a chair's day, up to this long, is a pause; a longer one is an absence */
export const PAUSE_MAX = 90;
/** a free stretch shorter than this is not offered */
export const FREE_MIN = 15;
export const STEP = 15;

/** The hours drawn: the working hours of the chairs, stretched to anything booked outside them, on whole hours. */
export function drawnRange(works: readonly (readonly Iv[])[], appts: readonly Span[]): Iv {
  let a = 9 * 60, b = 18 * 60 + 30;
  const starts = works.flatMap((w) => w.map((x) => x[0])).concat(appts.map((x) => x.start));
  const ends = works.flatMap((w) => w.map((x) => x[1])).concat(appts.map((x) => x.start + x.dur));
  if (starts.length) a = Math.min(...starts);
  if (ends.length) b = Math.max(...ends);
  return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60];
}

export type OffKind = 'ferme' | 'pause' | 'absent';
export type Off = { a: number; b: number; kind: OffKind };

/**
 * The stretches of [from, to] a chair does not work, and why. Before his first hour and after his last: 'ferme'.
 * Between two working stretches: 'pause' up to PAUSE_MAX minutes, 'absent' beyond (half a day off). No hour at all
 * while the salon is open: 'absent' for the whole column; on a closed day: 'ferme'.
 */
export function offZones(work: readonly Iv[], from: number, to: number, shopOpen = true): Off[] {
  if (to <= from) return [];
  const w = [...work].sort((x, y) => x[0] - y[0]);
  if (!w.length) return [{ a: from, b: to, kind: shopOpen ? 'absent' : 'ferme' }];
  const out: Off[] = [];
  let t = from;
  w.forEach(([a, b], i) => {
    if (a > t) out.push({ a: t, b: a, kind: i === 0 ? 'ferme' : a - t <= PAUSE_MAX ? 'pause' : 'absent' });
    t = Math.max(t, b);
  });
  if (t < to) out.push({ a: t, b: to, kind: 'ferme' });
  return out;
}

export const OFF_LABEL: Record<OffKind, string> = { ferme: 'Fermé', pause: 'Pause', absent: 'Absent' };

/** a minus the busy stretches, in order */
function minus(a: readonly Iv[], busy: readonly Iv[]): Iv[] {
  let out: Iv[] = a.map((x) => [x[0], x[1]]);
  for (const [s, e] of busy) {
    const next: Iv[] = [];
    for (const [x, y] of out) {
      if (e <= x || s >= y) { next.push([x, y]); continue; }
      if (s > x) next.push([x, s]);
      if (e < y) next.push([e, y]);
    }
    out = next;
  }
  return out;
}

/**
 * The free stretches of a chair: his working hours minus what takes them (appointments still standing, blocks, held
 * slots), from `floor` on (now on the day itself, so the morning already gone is not offered), FREE_MIN and more.
 */
export function freeGaps(work: readonly Iv[], busy: readonly Span[], floor = 0, min = FREE_MIN): Iv[] {
  const taken: Iv[] = busy.map((x) => [x.start, x.start + x.dur]);
  return minus(work, taken)
    .map(([a, b]): Iv => [Math.max(a, floor), b])
    .filter(([a, b]) => b - a >= min);
}

/** The minute a touch in a free stretch books: the quarter touched, kept inside the stretch (never its last minutes). */
export function slotAt(gap: Iv, touched: number, step = STEP): number {
  const last = Math.max(gap[0], gap[1] - step);
  return Math.min(last, Math.max(gap[0], Math.floor(touched / step) * step));
}

/** How full a day is, 0..1, from each chair's booked minutes and working minutes; null on a day nobody works. */
export function loadOf(staff: readonly { minutes: number; cap: number }[]): number | null {
  let m = 0, c = 0;
  for (const s of staff) { m += s.minutes; c += s.cap; }
  return c > 0 ? Math.min(1, m / c) : null;
}
/** In words, for the week strip: « rempli à 69 % », « fermé ». */
export const loadWords = (v: number | null): string => (v == null ? 'fermé' : v >= 0.995 ? 'complet' : 'rempli à ' + Math.round(v * 100) + ' %');

/** The day as a list: one group per hour, in order (a group per hour that has something). */
export function byHour<T extends { start: number }>(items: readonly T[]): { hour: number; items: T[] }[] {
  const out: { hour: number; items: T[] }[] = [];
  for (const x of [...items].sort((a, b) => a.start - b.start)) {
    const h = Math.floor(x.start / 60);
    const last = out[out.length - 1];
    if (last && last.hour === h) last.items.push(x); else out.push({ hour: h, items: [x] });
  }
  return out;
}

/** Which way a finger went: 'x' for a sideways swipe (day, barber), 'y' for the page's own scroll, null while unsure. */
export function swipeAxis(dx: number, dy: number, slop = 10): 'x' | 'y' | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay * 1.5 ? 'x' : 'y';
}
/** A swipe counts when it went far enough, or fast enough over a shorter way. -1: to the left (next), 1: to the right. */
export function swipeEnd(dx: number, ms: number, width: number): -1 | 0 | 1 {
  const far = Math.abs(dx) > Math.min(120, width * 0.28);
  const fast = Math.abs(dx) > 36 && Math.abs(dx) / Math.max(1, ms) > 0.45;
  return far || fast ? (dx < 0 ? -1 : 1) : 0;
}
