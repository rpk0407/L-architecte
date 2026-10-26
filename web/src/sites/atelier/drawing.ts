// The construction lines laid over the photos. Coordinates are in the photo's own pixels: the SVG's viewBox
// is the photo (or the part of it a detail plate shows), so the lines and labels stay glued to the hair at
// every width. The letters and words are drawing annotations; nothing here pretends to be a measurement.
//
// Choreography: each note draws its line, then its leader, and its label lands the moment the leader
// reaches it (never a leader pointing at nothing). Notes start a beat apart; the whole sheet is drawn in
// under two seconds on the hero, a little over one on the prints.
import { PHOTOS } from '../../site-kit/content';
import { h, svg } from './util';

type Note = { k: string; t: string; d: string; lead: string; at: [number, number]; side: 'l' | 'r'; red?: boolean; cote?: string };
/** crop: the part of the photo shown, [x, y, w, h] in the photo's pixels (a detail plate). */
export type Drawing = { w: number; h: number; crop?: [number, number, number, number]; axes: string[]; notes: Note[] };
export type Pace = { delay: number; step: number; line: number; lead: number };

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0`;

const RAIE: Note = { k: 'A', t: 'Raie tracée', d: 'M552 398 L884 448', lead: 'M552 398 L560 200', at: [560, 200], side: 'l', red: true };
const DEGRADE: Note = { k: 'B', t: 'Dégradé bas', d: 'M930 476 V694', cote: 'M860 476 H952 M860 694 H952', lead: 'M930 694 L940 760', at: [940, 760], side: 'l' };

export const DRAWINGS = {
  hero: {
    w: PHOTOS.sidepart.w, h: PHOTOS.sidepart.h,
    axes: ['M0 572 H1100', 'M724 0 V1355', circle(620, 500, 292)],
    notes: [RAIE, DEGRADE, { k: 'C', t: 'Contour net', d: 'M626 626 C640 560 780 520 812 660', lead: 'M626 626 L420 980', at: [420, 980], side: 'l', red: true }]
  },
  // Pl. 02-A: a detail of the hero's photo at twice its scale, the parting only
  sidepart: {
    w: PHOTOS.sidepart.w, h: PHOTOS.sidepart.h, crop: [430, 120, 550, 688],
    axes: ['M430 423 H980', 'M718 120 V808'],
    notes: [{ ...RAIE, lead: 'M552 398 L548 214', at: [548, 214] }]
  },
  curls: {
    w: PHOTOS.curls.w, h: PHOTOS.curls.h,
    axes: ['M0 640 H1100', 'M560 0 V1315'],
    notes: [
      { k: 'A', t: 'Contour net', d: 'M628 548 L662 662', lead: 'M645 605 L1060 440', at: [1060, 440], side: 'l', red: true },
      { k: 'B', t: 'Barbe taillée', d: 'M596 770 Q615 885 705 892', lead: 'M705 892 L1060 990', at: [1060, 990], side: 'l' }
    ]
  },
  fade: {
    w: PHOTOS.fade.w, h: PHOTOS.fade.h,
    axes: ['M0 470 H1100', 'M660 0 V1077'],
    notes: [
      { k: 'A', t: 'Décoloré', d: 'M290 330 Q520 90 780 320', lead: 'M532 206 L560 70', at: [560, 70], side: 'r', red: true },
      { k: 'B', t: 'Dégradé à blanc', d: 'M820 360 V590', cote: 'M750 360 H842 M750 590 H842', lead: 'M820 590 L1070 700', at: [1070, 700], side: 'l' }
    ]
  },
  // Pl. 09: the salon's mirror, its red LED line traced over the photo
  salon: {
    w: PHOTOS.salon.w, h: PHOTOS.salon.h,
    axes: ['M0 272 H1100', 'M536 0 V812'],
    notes: [{ k: 'A', t: 'Ligne LED du miroir', d: 'M536 346 V274 L1100 214', lead: 'M760 250 L740 120', at: [740, 120], side: 'l', red: true }]
  }
} satisfies Record<string, Drawing>;

export const PACE = { hero: { delay: 0.1, step: 0.3, line: 0.6, lead: 0.45 }, print: { delay: 0.05, step: 0.22, line: 0.45, lead: 0.35 } } satisfies Record<string, Pace>;

let marks = 0;
/** Lays the drawing over a .draw frame that holds the photo; a cropped drawing also frames the photo. */
export function decorate(frame: HTMLElement, dw: Drawing, pace: Pace) {
  const [cx, cy, cw, ch] = dw.crop || [0, 0, dw.w, dw.h];
  const img = frame.querySelector('img');
  if (dw.crop && img) {
    // the photo moves into a window the size of the crop (the frame keeps its corner marks outside)
    const win = h('div', { class: 'win' });
    img.replaceWith(win);
    win.append(img);
    frame.classList.add('crop');
    frame.style.aspectRatio = `${cw} / ${ch}`;
    img.style.width = ((dw.w / cw) * 100).toFixed(3) + '%';
    img.style.left = ((-cx / cw) * 100).toFixed(3) + '%';
    img.style.top = ((-cy / ch) * 100).toFixed(3) + '%';
  }
  // the crosshair reads coordinates in the photo's pixels
  frame.dataset.box = [cx, cy, cw, ch].join(' ');

  const mark = 'lx-ar' + marks++;
  const t = (s: number) => s.toFixed(2) + 's';
  const path = (d: string, cls: string, at: number, dur: number, extra: Record<string, string> = {}) =>
    svg('path', { d, class: 'd ' + cls, pathLength: 1, style: `--d:${t(at)};--t:${t(dur)}`, ...extra });
  const s = svg('svg', { class: 'draw-svg', viewBox: `${cx} ${cy} ${cw} ${ch}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', null, svg('marker', { id: mark, viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 30, markerHeight: 30, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
      svg('path', { d: 'M0 1.5 L9 5 L0 8.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }))));
  for (const a of dw.axes) s.append(path(a, 'ax', pace.delay, 0.9));
  const tags: HTMLElement[] = [];
  dw.notes.forEach((n, k) => {
    const at = pace.delay + k * pace.step, leadAt = at + pace.line * 0.5;
    if (n.cote) s.append(path(n.cote, 'ext', at, pace.line));
    s.append(path(n.d, n.red ? 'red' : 'ln', at, pace.line, n.cote ? { 'marker-start': `url(#${mark})`, 'marker-end': `url(#${mark})` } : {}));
    s.append(path(n.lead, 'lead', leadAt, pace.lead));
    // the figure's caption describes the drawing; the letters are for the eye only
    tags.push(h('p', {
      class: 'tag ' + (n.side === 'l' ? 'to-l' : 'to-r'), 'aria-hidden': 'true',
      style: `left:${(((n.at[0] - cx) / cw) * 100).toFixed(2)}%;top:${(((n.at[1] - cy) / ch) * 100).toFixed(2)}%;--d:${t(leadAt + pace.lead)}`
    }, h('b', null, n.k), n.t));
  });
  frame.append(s, ...tags);
}
