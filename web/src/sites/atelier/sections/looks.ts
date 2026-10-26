// Planche 02, the prints: the three looks as annotated plates. The lines draw when a plate comes into
// view; the price and duration are the salon's own, and each plate books the service that makes it.
import { LOOKS } from '../../../site-kit/content';
import { reduced } from '../../../site-kit/motion';
import { eur, dur } from '../../../lib/format';
import { $, h, svcBySlug, bookAttrs, text, onSlots } from '../util';
import { overlay, DRAWINGS } from '../drawing';

export function mountLooks() {
  const list = $('[data-looks]')!;
  LOOKS.forEach((l, i) => {
    const s = svcBySlug(l.slug);
    const draw = h('div', { class: 'draw' }, h('img', { src: l.photo.src, width: l.photo.w, height: l.photo.h, alt: l.photo.alt, loading: 'lazy', decoding: 'async' }));
    draw.append(overlay(DRAWINGS[l.key], 0.2));
    const letter = String.fromCharCode(65 + i);
    list.append(h('li', { class: 'look', 'data-reveal': '', 'data-delay': i * 90 },
      h('figure', null, draw, h('figcaption', { class: 'look-fig' }, h('span', { class: 'micro' }, 'Pl. 02-' + letter), l.line)),
      h('div', { class: 'look-b' },
        h('h3', { class: 'look-t' }, l.title),
        h('p', { class: 'look-s', 'data-look-s': l.slug }, s ? s.name + ' · ' + dur(s.dur) : ''),
        h('p', { class: 'look-p', 'data-look-p': l.slug }, s ? (s.from ? 'dès ' : '') + eur(s.price) : ''),
        h('button', { type: 'button', class: 'btn ghost look-go', 'data-look-go': l.slug, ...bookAttrs(s ? [s] : []) }, 'Je veux cette coupe'))));
  });

  // the lines draw once, when the plate is well in view
  const draws = Array.from(list.querySelectorAll('.draw'));
  if (reduced()) draws.forEach((d) => d.classList.add('go', 'still'));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('go'); io.unobserve(e.target); } }), { threshold: 0.45 });
    draws.forEach((d) => io.observe(d));
  }

  // live catalogue: names, prices and the booking prefill follow the salon
  onSlots(() => LOOKS.forEach((l) => {
    const s = svcBySlug(l.slug);
    if (!s) return;
    text($(`[data-look-s="${l.slug}"]`, list), s.name + ' · ' + dur(s.dur));
    text($(`[data-look-p="${l.slug}"]`, list), (s.from ? 'dès ' : '') + eur(s.price));
    const b = $(`[data-look-go="${l.slug}"]`, list)!;
    for (const [k, v] of Object.entries(bookAttrs([s]))) if (v != null) b.setAttribute(k, String(v)); else b.removeAttribute(k);
  }));
}
