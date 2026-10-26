// The drafting crosshair: over a drawing only (fine pointers), two red hairlines and a readout in the
// photo's own pixels, like a plotter's cursor over the sheet. It steps aside over links and buttons and
// while the page scrolls. Decorative: aria-hidden, never catches a click, absent for touch and for
// reduced motion. Moves with transforms, one write per frame at most.
import { reduced } from '../../../site-kit/motion';
import { h, text } from '../util';

export function mountCrosshair() {
  if (reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const x = h('i', { class: 'xh-x' }), y = h('i', { class: 'xh-y' }), c = h('span', { class: 'xh-c' });
  const el = h('div', { class: 'xh', 'aria-hidden': 'true' }, x, y, c);
  let frame: HTMLElement | null = null, px = 0, py = 0, w = 1, hh = 1, queued = false;

  const off = () => { el.classList.remove('on'); frame = null; };
  const paint = () => {
    queued = false;
    if (!frame) return;
    const [bx, by, bw, bh] = (frame.dataset.box || '0 0 1 1').split(' ').map(Number);
    x.style.transform = `translate3d(0,${py}px,0)`;
    y.style.transform = `translate3d(${px}px,0,0)`;
    // the readout keeps inside the frame
    c.style.transform = `translate3d(${px > w - 150 ? px - 142 : px + 10}px,${py > hh - 40 ? py - 30 : py + 10}px,0)`;
    text(c, 'X ' + String(Math.round(bx + (px / w) * bw)).padStart(4, '0') + '  Y ' + String(Math.round(by + (py / hh) * bh)).padStart(4, '0'));
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target as Element;
    const f = t.closest?.<HTMLElement>('.draw');
    if (!f || t.closest('a, button, input, label, .tag')) { off(); return; }
    if (f !== frame) { frame = f; f.append(el); }
    const r = f.getBoundingClientRect();
    w = r.width; hh = r.height; px = e.clientX - r.left; py = e.clientY - r.top;
    el.classList.add('on');
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  addEventListener('scroll', off, { passive: true });
  addEventListener('blur', off);
}
