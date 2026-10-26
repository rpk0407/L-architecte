// Planche 01: the promise, the live state of the salon, and a photo on which the construction lines
// draw themselves once the image is on screen. Every "Réserver" that names a slot books that slot: the
// hero's, the last plate's and the dock's open the sheet on the details step with it already held.
import { reduced } from '../../../site-kit/motion';
import { $, $$, text, svcBySlug, idsOf, freeSlots, whenShort, onSlots, setBook, bookAttrs, NB } from '../util';
import { setFallback } from './chrome';
import { book } from '../sheet';
import { decorate, DRAWINGS, PACE } from '../drawing';

export function mountHero() {
  const draw = $('[data-draw]')!, img = $<HTMLImageElement>('img', draw)!;
  decorate(draw, DRAWINGS.hero, PACE.hero);
  // draw once the photo is decoded: lines over a blank frame would read as a bug, not a sketch
  const go = () => draw.classList.add('go');
  if (reduced()) draw.classList.add('go', 'still');
  else if (img.complete) go();
  else { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }

  // the next free cut, with whoever is free first
  let key = '';
  const next = () => {
    const cut = svcBySlug('cl'), ids = cut ? idsOf([cut]) : [];
    if (!cut || !ids.length) return;
    freeSlots(ids, 'any', 1).then(([f]) => {
      const name = cut.short.toLowerCase(), sub = f ? name + ' · ' + whenShort(f) : 'sans compte';
      const k = sub + (f ? f.day + f.start : '');
      if (k === key) return;
      key = k;
      const attrs = f ? bookAttrs([cut], 'any', f.day, f.start) : {};
      $$('[data-next]').forEach((el) => { text(el, sub); const host = el.closest('[data-book]'); if (host) setBook(host, attrs); });
      // the walk-in cell offers the other way in
      $$('[data-wait-or]').forEach((el) => { el.hidden = !f; text(el, f ? NB + '· ou réserve ' + whenShort(f) : ''); });
      setFallback(sub, f ? () => book({ serviceIds: ids, staffId: 'any', day: f.day, start: f.start }) : null);
    }, () => { /* keep "sans compte" and the plain sheet */ });
  };
  onSlots(next);
}
