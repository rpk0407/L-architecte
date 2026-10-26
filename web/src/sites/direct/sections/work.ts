// 04 · Le travail. The three looks of content.ts, each tied to the service that makes it, priced live,
// and one tap from the sheet. The photos drift a few pixels against the scroll (motion.track, transform
// only); reduced motion keeps them still.
import { dates, eur } from '../../../lib/format';
import { LOOKS } from '../../../site-kit/content';
import { reduced, trackVar } from '../../../site-kit/motion';
import { $, h, svg, ARROW, bookAttrs } from '../dom';
import { svc } from '../store';

export function paintLooks() {
  const host = $('[data-looks]')!;
  host.replaceChildren(...LOOKS.map((l, i) => {
    const s = svc(l.slug);
    const go = h('button', { type: 'button', class: 'look-go' }, h('span', {}, 'Ce look'), svg(ARROW));
    bookAttrs(go, { slugs: [l.slug], source: 'look-' + l.key });
    go.setAttribute('aria-label', 'Réserver ' + (s ? s.name : l.title) + ' pour le look ' + l.title);
    const img = h('img', { src: l.photo.src, width: l.photo.w, height: l.photo.h, alt: l.photo.alt, loading: 'lazy', decoding: 'async' });
    img.style.objectPosition = l.photo.focus;
    return h('li', { class: 'look', 'data-reveal': '', 'data-delay': i * 90 },
      h('figure', { class: 'look-ph' }, img, h('span', { class: 'look-n', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0'))),
      h('div', { class: 'look-b' },
        h('h3', { class: 'look-t' }, l.title),
        h('p', { class: 'look-l' }, l.line),
        h('p', { class: 'look-s' }, s ? s.name + ' · ' + dates.fmtDur(s.dur) : '', h('b', {}, s ? (s.from ? 'dès ' : '') + eur(s.price) : '')),
        go));
  }));
}

export function initWork() {
  paintLooks();
  if (!reduced()) trackVar($('[data-work]'), '--p', 'through');
}
