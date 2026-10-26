// Planche 02, the prints: the three looks as annotated plates. The first is a detail of the hero's photo
// at twice its scale (the parting alone), so the same picture never reads twice. The lines draw when a
// plate is well in view; the price and duration are the salon's own, and each plate books its service.
import { LOOKS } from '../../../site-kit/content';
import { reduced } from '../../../site-kit/motion';
import { eur, dur } from '../../../lib/format';
import { $, h, fr, svcBySlug, bookAttrs, setBook, text, onSlots } from '../util';
import { decorate, DRAWINGS, PACE } from '../drawing';

export function mountLooks() {
  const list = $('[data-looks]')!;
  LOOKS.forEach((l, i) => {
    const s = svcBySlug(l.slug);
    const draw = h('div', { class: 'draw' },
      h('img', { src: l.photo.src, width: l.photo.w, height: l.photo.h, alt: l.photo.alt, loading: 'lazy', decoding: 'async' }),
      h('i', { class: 'ht', 'aria-hidden': 'true' }));
    decorate(draw, DRAWINGS[l.key], PACE.print);
    const letter = String.fromCharCode(65 + i);
    list.append(h('li', { class: 'look', 'data-reveal': '', 'data-delay': i * 90 },
      h('figure', null, draw, h('figcaption', { class: 'look-fig' }, h('span', { class: 'micro' }, 'Pl. 02-' + letter),
        i === 0 ? fr('Détail A, éch. 2:1 : la raie tracée.') : fr(l.line))),
      h('div', { class: 'look-b' },
        h('h3', { class: 'look-t' }, fr(l.title)),
        h('p', { class: 'look-s', 'data-look-s': l.slug }, s ? s.name + ' · ' + dur(s.dur) : ''),
        h('p', { class: 'look-p', 'data-look-p': l.slug }, s ? (s.from ? 'dès ' : '') + eur(s.price) : ''),
        h('button', { type: 'button', class: 'btn ghost look-go', 'data-look-go': l.slug, ...bookAttrs(s ? [s] : []) }, 'Je veux cette coupe'))));
  });

  // the lines draw once, when the plate is half in view
  const draws = Array.from(list.querySelectorAll('.draw'));
  if (reduced()) draws.forEach((d) => d.classList.add('go', 'still'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('go'); io.unobserve(e.target); } }), { threshold: 0.5 });
    draws.forEach((d) => io.observe(d));
  }

  // live catalogue: names, prices and the booking prefill follow the salon
  onSlots(() => LOOKS.forEach((l) => {
    const s = svcBySlug(l.slug);
    if (!s) return;
    text($(`[data-look-s="${l.slug}"]`, list), s.name + ' · ' + dur(s.dur));
    text($(`[data-look-p="${l.slug}"]`, list), (s.from ? 'dès ' : '') + eur(s.price));
    setBook($(`[data-look-go="${l.slug}"]`, list)!, bookAttrs([s]));
  }));
}
