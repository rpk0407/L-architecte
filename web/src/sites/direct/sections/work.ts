// 04 · Le travail. The three looks of content.ts, each tied to the service that makes it, priced live,
// and one tap from the sheet. The photos drift a few pixels against the scroll (motion.trackVar, transform
// only); reduced motion keeps them still.
import { dates, eur } from '../../../lib/format';
import { LOOKS } from '../../../site-kit/content';
import { reduced, trackVar } from '../../../site-kit/motion';
import { $, $$, h, svg, ARROW, bookAttrs } from '../dom';
import { svc } from '../store';

/** Service name, length and price under each look (fallback catalogue first, the salon's once loaded). */
export function paintLooks() {
  $$('.look-s').forEach((el, i) => {
    const s = svc(LOOKS[i].slug);
    el.replaceChildren(s ? s.name + ' · ' + dates.fmtDur(s.dur) : '', h('b', {}, s ? (s.from ? 'dès ' : '') + eur(s.price) : ''));
  });
}

export function initWork() {
  $('[data-looks]')!.replaceChildren(...LOOKS.map((l, i) => {
    const go = h('button', { type: 'button', class: 'look-go' }, h('span', {}, 'Ce look'), svg(ARROW));
    bookAttrs(go, { slugs: [l.slug], source: 'look-' + l.key });
    go.setAttribute('aria-label', 'Réserver le look ' + l.title);
    const img = h('img', { src: l.photo.src, width: l.photo.w, height: l.photo.h, alt: l.photo.alt, loading: 'lazy', decoding: 'async' });
    img.style.objectPosition = l.photo.focus;
    return h('li', { class: 'look', 'data-reveal': '', 'data-delay': i * 90 },
      h('figure', { class: 'look-ph' }, img, h('span', { class: 'look-n', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0'))),
      h('div', { class: 'look-b' }, h('h3', { class: 'look-t' }, l.title), h('p', { class: 'look-l' }, l.line), h('p', { class: 'look-s' }), go));
  }));
  paintLooks();
  // each photo carries its own progress, so a scroll frame restyles three frames, not the whole chapter
  if (!reduced()) $$('.look-ph').forEach((el) => trackVar(el, '--p', 'through'));
}
