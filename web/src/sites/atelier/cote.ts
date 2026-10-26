// A dimension line ("cote"): |<—— 1 h 30 ——>|, its length proportional to a duration. The line scales
// and the end tick slides (transforms only), so a change of plan is felt, not just read.
import { dur } from '../../lib/format';
import { h, text } from './util';

const MAX = 180;

export function cote() {
  const lab = h('span', { class: 'cote-v' });
  const el = h('div', { class: 'cote', 'aria-hidden': 'true' },
    h('i', { class: 'cote-a' }), h('i', { class: 'cote-l' }), h('i', { class: 'cote-b' }), lab,
    h('span', { class: 'cote-s' }, h('span', null, '0'), h('span', null, '1 h'), h('span', null, '2 h'), h('span', null, '3 h')));
  return {
    el,
    set(min: number) {
      el.style.setProperty('--k', Math.min(1, Math.max(0.04, min / MAX)).toFixed(3));
      text(lab, min ? dur(min) : '—');
    }
  };
}
