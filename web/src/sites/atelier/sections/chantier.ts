// Planche 04, the method: a construction line that draws down through the four phases as they reach
// the reading line, lighting each one on the way. Driven by the shared scroll loop (motion.track);
// sizes are measured on resize only, never per frame. Reduced motion: the line is drawn, all lit.
import { track, reduced } from '../../../site-kit/motion';
import { $, $$ } from '../util';

export function mountChantier() {
  const list = $('[data-steps]')!, steps = $$<HTMLElement>('.step', list);
  if (reduced()) { list.classList.add('still'); steps.forEach((s) => s.classList.add('on')); return; }

  let H = 1, marks: number[] = [];
  const measure = () => {
    H = Math.max(1, list.offsetHeight);
    marks = steps.map((s) => (s.offsetTop + 28) / H);
  };
  measure();
  new ResizeObserver(measure).observe(list);

  // 'through' gives 0 when the list enters at the bottom, 1 when it leaves at the top; turn it into
  // "how much of the list is above 62 % of the screen"
  track(list, (p) => {
    const vh = innerHeight, top = vh - p * (H + vh);
    const k = Math.min(1, Math.max(0, (vh * 0.62 - top) / H));
    list.style.setProperty('--k', k.toFixed(4));
    steps.forEach((s, i) => s.classList.toggle('on', k >= marks[i]));
  }, 'through');
}
