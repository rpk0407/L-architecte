// Two appointments on the same chair at the same time (a forced booking) are drawn side by side, never one over the
// other. Pure rules, no React: Board.tsx draws from them and tests/unit/agenda-overlap.test.js reads the same ones.

export type Span = { id: string; start: number; dur: number };
/** col: which share of the column (0 = left), cols: how many shares its group has, clash: the ids it overlaps */
export type Place = { col: number; cols: number; clash: string[]; /** when its group starts (minutes): the same for every card of the group */ from: number };

const meets = (a: Span, b: Span) => a.start < b.start + b.dur && b.start < a.start + a.dur;

/** Where each card of one chair goes. Cards that touch nothing keep the whole width (cols 1). */
export function layoutOverlaps(items: Span[]): Map<string, Place> {
  const out = new Map<string, Place>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.dur - a.dur || (a.id < b.id ? -1 : 1));
  let group: Span[] = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    // first free share, left to right: the earlier booking stays on the left
    const ends: number[] = [];
    const cols = new Map<string, number>();
    for (const x of group) {
      let c = ends.findIndex((e) => e <= x.start);
      if (c < 0) { c = ends.length; ends.push(0); }
      ends[c] = x.start + x.dur;
      cols.set(x.id, c);
    }
    for (const x of group) out.set(x.id, { col: cols.get(x.id)!, cols: ends.length, clash: group.filter((y) => y.id !== x.id && meets(x, y)).map((y) => y.id), from: group[0].start });
    group = [];
  };
  for (const x of sorted) {
    if (group.length && x.start >= groupEnd) flush();
    group.push(x);
    groupEnd = Math.max(groupEnd, x.start + x.dur);
  }
  flush();
  return out;
}

/** The appointments a new booking would sit on: asked before forcing, so the confirmation names them. */
export function overlapping<T extends Span>(items: T[], start: number, dur: number): T[] {
  return items.filter((x) => meets(x, { id: '', start, dur })).sort((a, b) => a.start - b.start);
}
