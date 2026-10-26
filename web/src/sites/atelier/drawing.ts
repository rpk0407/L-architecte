// The construction lines laid over the photos. Coordinates are in the photo's own pixels (the frame keeps
// the photo's ratio, so the SVG and the labels stay glued to the hair at every width). The letters and
// words are drawing annotations; nothing here pretends to be a measurement.
import { PHOTOS } from '../../site-kit/content';
import { h, svg } from './util';

type Note = { k: string; t: string; d: string; lead: string; at: [number, number]; side: 'l' | 'r'; red?: boolean; cote?: string };
export type Drawing = { w: number; h: number; axes: string[]; notes: Note[] };

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0`;

const RAIE: Note = { k: 'A', t: 'Raie tracée', d: 'M552 398 L884 448', lead: 'M552 398 L560 200', at: [560, 200], side: 'l', red: true };
const DEGRADE: Note = { k: 'B', t: 'Dégradé bas', d: 'M930 476 V694', cote: 'M860 476 H952 M860 694 H952', lead: 'M930 694 L940 760', at: [940, 760], side: 'l' };

export const DRAWINGS: Record<'hero' | 'sidepart' | 'curls' | 'fade', Drawing> = {
  hero: {
    w: PHOTOS.sidepart.w, h: PHOTOS.sidepart.h,
    axes: ['M0 572 H1100', 'M724 0 V1355', circle(620, 500, 292)],
    notes: [RAIE, DEGRADE, { k: 'C', t: 'Contour net', d: 'M626 626 C640 560 780 520 812 660', lead: 'M626 626 L420 980', at: [420, 980], side: 'l', red: true }]
  },
  sidepart: { w: PHOTOS.sidepart.w, h: PHOTOS.sidepart.h, axes: ['M0 572 H1100', 'M724 0 V1355'], notes: [RAIE, DEGRADE] },
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
  }
};

/** The SVG and its labels, to append inside a .draw frame. Each stroke carries its order in --d. */
export function overlay(dw: Drawing, delay = 0.1): DocumentFragment {
  const f = document.createDocumentFragment();
  let i = 0;
  const path = (d: string, cls: string, extra: Record<string, string> = {}) =>
    svg('path', { d, class: 'd ' + cls, pathLength: 1, style: `--d:${(delay + i++ * 0.16).toFixed(2)}s`, ...extra });
  const s = svg('svg', { class: 'draw-svg', viewBox: `0 0 ${dw.w} ${dw.h}`, 'aria-hidden': 'true', focusable: 'false' },
    svg('defs', null, svg('marker', { id: 'ar-' + dw.w + dw.h, viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' },
      svg('path', { d: 'M0 1.5 L9 5 L0 8.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }))));
  for (const a of dw.axes) s.append(path(a, 'ax'));
  for (const n of dw.notes) {
    if (n.cote) s.append(path(n.cote, 'ext'));
    s.append(path(n.d, n.red ? 'red' : 'ln', n.cote ? { 'marker-start': `url(#ar-${dw.w}${dw.h})`, 'marker-end': `url(#ar-${dw.w}${dw.h})` } : {}));
    s.append(path(n.lead, 'lead'));
  }
  f.append(s);
  dw.notes.forEach((n, k) => f.append(h('p', {
    class: 'tag ' + (n.side === 'l' ? 'to-l' : 'to-r'),
    style: `left:${((n.at[0] / dw.w) * 100).toFixed(2)}%;top:${((n.at[1] / dw.h) * 100).toFixed(2)}%;--d:${(delay + 0.5 + i * 0.16 + k * 0.12).toFixed(2)}s`
  }, h('b', null, n.k), n.t)));
  return f;
}
