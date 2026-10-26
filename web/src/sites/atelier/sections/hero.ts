// Planche 01: the promise, the live state of the salon, and a photo on which the construction lines
// draw themselves once the image is on screen. The "Réserver" buttons carry the next free slot.
import { reduced } from '../../../site-kit/motion';
import { $, $$, text, svcBySlug, idsOf, freeSlots, whenShort, onSlots } from '../util';
import { setFallbackSub } from './chrome';
import { overlay, DRAWINGS } from '../drawing';

export function mountHero() {
  const draw = $('[data-draw]')!, img = $<HTMLImageElement>('img', draw)!;
  draw.append(overlay(DRAWINGS.hero, 0.15));
  // draw once the photo is decoded: lines over a blank frame would read as a bug, not a sketch
  const go = () => draw.classList.add('go');
  if (reduced()) draw.classList.add('go', 'still');
  else if (img.complete) go();
  else { img.addEventListener('load', go, { once: true }); img.addEventListener('error', go, { once: true }); }

  // the next free cut, for the hero and final buttons and the dock
  let key = '';
  const next = () => {
    const cut = svcBySlug('cl'), ids = cut ? idsOf([cut]) : [];
    if (!ids.length) return;
    freeSlots(ids, 'any', 1).then(([f]) => {
      const sub = f ? 'libre ' + whenShort(f) : 'sans compte';
      if (sub === key) return;
      key = sub;
      $$('[data-next]').forEach((el) => text(el, sub));
      setFallbackSub(sub);
    }, () => { /* keep "sans compte" */ });
  };
  onSlots(next);
}
