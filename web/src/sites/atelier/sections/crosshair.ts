// The drafting crosshair: two red hairlines and a coordinate readout following a mouse (fine pointers
// only), like a cursor on a plotter. Decorative: aria-hidden, never catches a click, absent for touch
// and for reduced motion. Moves with transforms, one write per frame at most.
import { reduced } from '../../../site-kit/motion';
import { h, text } from '../util';

export function mountCrosshair() {
  if (reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const x = h('i', { class: 'xh-x' }), y = h('i', { class: 'xh-y' }), c = h('span', { class: 'xh-c' });
  const el = h('div', { class: 'xh', 'aria-hidden': 'true' }, x, y, c);
  document.body.append(el);
  let px = 0, py = 0, queued = false;
  const paint = () => {
    queued = false;
    x.style.transform = `translate3d(0,${py}px,0)`;
    y.style.transform = `translate3d(${px}px,0,0)`;
    c.style.transform = `translate3d(${px + 14}px,${py + 12}px,0)`;
    text(c, 'X ' + String(Math.round(px)).padStart(4, '0') + '  Y ' + String(Math.round(py + scrollY)).padStart(5, '0'));
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX; py = e.clientY;
    el.classList.add('on');
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => el.classList.remove('on'));
  addEventListener('blur', () => el.classList.remove('on'));
}
