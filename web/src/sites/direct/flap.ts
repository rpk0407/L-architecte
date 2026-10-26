// A split-flap display, the board's voice. Each character is a cell of two static halves; the two flaps
// that turn are only built the first time the cell changes, so a board at rest stays light. A change runs
// the drum through a few letters before it lands, cell after cell, like the real thing. Transforms only
// (Web Animations), nothing at all when the visitor asked for less motion.
import { reduced } from '../../site-kit/motion';
import { h } from './dom';

const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.’-';
type Leaf = { el: HTMLElement; b: HTMLElement };
type Cell = { el: HTMLElement; ub: HTMLElement; db: HTMLElement; a: Leaf | null; b: Leaf | null; cur: string; tok: number };

const half = (cls: string): Leaf => { const b = h('b'); return { el: h('span', { class: cls }, b), b }; };
function cell(): Cell {
  const u = half('fl-u'), d = half('fl-d');
  return { el: h('span', { class: 'fl' }, u.el, d.el), ub: u.b, db: d.b, a: null, b: null, cur: ' ', tok: 0 };
}
function leaves(c: Cell) {
  if (!c.a) { c.a = half('fl-a'); c.b = half('fl-b'); c.el.append(c.a.el, c.b!.el); }
  return { a: c.a, b: c.b! };
}

export class Flap {
  readonly el: HTMLElement;
  private cells: Cell[] = [];
  private value = '';
  constructor(len: number, cls = '') {
    this.el = h('span', { class: 'flap ' + cls, 'aria-hidden': 'true' });
    for (let i = 0; i < len; i++) { const c = cell(); this.el.append(c.el); this.cells.push(c); }
  }
  /** Shows text (upper-cased, cut or padded to the width). animate=false lands at once. */
  set(text: string, animate = true, delay = 0) {
    const v = text.toUpperCase().padEnd(this.cells.length).slice(0, this.cells.length);
    if (v === this.value) return;
    this.value = v;
    const motion = animate && !reduced() && typeof Element.prototype.animate === 'function';
    this.cells.forEach((c, i) => {
      const ch = v[i];
      if (ch === c.cur) return;
      const tok = ++c.tok;
      if (!motion) { land(c, ch); return; }
      // two to four letters of the drum before the right one, so the cells don't land in lockstep
      const steps = 2 + ((i * 7 + v.charCodeAt(i)) % 3);
      const ni = DRUM.indexOf(ch);
      const path = ni < 0 ? [ch] : Array.from({ length: steps }, (_, k) => DRUM[(ni - (steps - 1 - k) + DRUM.length) % DRUM.length]);
      let p = new Promise<void>((r) => setTimeout(r, delay + i * 28));
      for (const next of path) p = p.then(() => (tok === c.tok ? flip(c, next) : undefined));
      p.then(() => { if (tok === c.tok) land(c, ch); }).catch(() => land(c, ch));
    });
  }
}

function land(c: Cell, ch: string) {
  c.ub.textContent = c.db.textContent = ch;
  if (c.a) c.a.el.style.visibility = c.b!.el.style.visibility = 'hidden';
  c.cur = ch;
}
function flip(c: Cell, next: string): Promise<void> {
  const ms = 52;
  const { a, b } = leaves(c);
  c.ub.textContent = next;
  a.b.textContent = c.cur;
  b.b.textContent = next;
  a.el.style.visibility = 'visible';
  return a.el.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], { duration: ms, easing: 'cubic-bezier(.55,0,1,.45)' }).finished
    .then(() => {
      a.el.style.visibility = 'hidden';
      b.el.style.visibility = 'visible';
      return b.el.animate([{ transform: 'rotateX(90deg)' }, { transform: 'rotateX(0deg)' }], { duration: ms, easing: 'cubic-bezier(0,.55,.45,1)' }).finished;
    })
    .then(() => { c.db.textContent = next; b.el.style.visibility = 'hidden'; c.cur = next; });
}
