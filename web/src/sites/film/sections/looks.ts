// 02 · Les looks. Three frames of a film strip (sprockets, edge print, frame numbers), photo first, the caption
// printed under each frame. With a mouse on a wide screen the strip is pinned and the vertical scroll pulls it
// sideways; on touch it is a native swipe strip; with reduced motion the frames simply sit side by side.
import { LOOKS, SHOP } from '../../../site-kit/content';
import { track, reduced } from '../../../site-kit/motion';
import { svc, priceText, durText, bookAttrs } from '../data';
import { $, esc, ARROW } from '../util';
import './looks.css';

const pinned = () => !reduced() && matchMedia('(min-width: 900px) and (pointer: fine)').matches;

export function mountLooks() {
  const sec = $('#looks'), strip = $('[data-looks]');
  if (!sec || !strip) return;
  strip.innerHTML = LOOKS.map((l, i) => {
    const x = svc(l.slug);
    return `<li class="lk-f">
      <p class="lk-edge" aria-hidden="true"><span>LX 400</span><span>▸ ${i * 4 + 12}A</span><span>13013</span></p>
      <figure class="lk-ph">
        <img src="${esc(l.photo.src)}" width="${l.photo.w}" height="${l.photo.h}" alt="${esc(l.photo.alt)}" style="object-position:${esc(l.photo.focus)}" loading="lazy" decoding="async">
        <figcaption class="lk-no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</figcaption>
      </figure>
      <div class="lk-b">
        <h3 class="lk-t" id="lk-t-${i}">${esc(l.title)}</h3>
        <p class="lk-p" data-price="${esc(l.slug)}">${esc(x ? priceText(x) : '')}</p>
        <p class="lk-l">${esc(l.line)}</p>
        <p class="lk-s"><span data-name="${esc(l.slug)}">${esc(x?.name || '')}</span> · <span data-dur="${esc(l.slug)}">${esc(x ? durText(x) : '')}</span></p>
        <button type="button" class="btn ghost lk-go" aria-describedby="lk-t-${i}" ${bookAttrs({ slug: l.slug, source: 'film-look-' + l.key })}>Je veux cette coupe</button>
      </div>
    </li>`;
  }).join('') + `<li class="lk-f lk-ig"><a href="${esc(SHOP.instagram)}" target="_blank" rel="noopener">
      <span class="k">Chaque semaine, de nouvelles coupes</span>
      <span class="t">La suite est sur Instagram.</span>
      <span class="h">${esc(SHOP.instagramHandle)}${ARROW}</span></a></li>`;

  // pinned mode: the section is as tall as the strip is long; the strip slides by the scroll until its last frame
  // rests one gutter from the edge (and clear of the rail, from 1100 px)
  let travel = 0;
  const view = $('.lk-view', sec)!;
  const fit = () => {
    if (!pinned()) { sec.style.height = ''; strip.style.transform = ''; travel = 0; return; }
    const cs = getComputedStyle(view);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const rail = innerWidth >= 1100 ? 64 : 0;
    travel = Math.max(0, Math.round(strip.scrollWidth + pad + rail - view.clientWidth));
    sec.style.height = innerHeight + travel + 'px';
  };
  fit();
  addEventListener('resize', fit, { passive: true });
  // prices, names and the fonts land after first layout: the strip's length changes with them
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(strip);
  track(sec, (p) => { if (travel) strip.style.transform = `translate3d(${(-p * travel).toFixed(1)}px,0,0)`; }, 'sticky');

  // a keyboard user tabbing to a frame scrolls the page to where that frame is in view
  strip.addEventListener('focusin', (e) => {
    if (!travel) return;
    const f = (e.target as Element).closest('.lk-f') as HTMLElement | null;
    if (!f) return;
    const want = Math.min(travel, Math.max(0, f.offsetLeft - view.clientWidth * 0.2));
    scrollTo({ top: sec.getBoundingClientRect().top + scrollY + want, behavior: 'auto' });
  });
}
