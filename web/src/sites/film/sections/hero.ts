// 00 · Ouverture. The salon first shows as the brand's dot screen, then resolves into the photograph as the
// visitor starts scrolling; the red LED line of the mirror draws itself last. Opacity and transforms only:
// the dot screen is filtered once, then only faded and scaled.
import { track, span, ease, reduced, magnetic } from '../../../site-kit/motion';
import { $, $$ } from '../util';
import './hero.css';

export function mountHero() {
  const hero = $('#ouverture');
  $$('[data-magnetic]').forEach((el) => magnetic(el, 0.18));
  if (!hero || reduced()) return;
  const ht = $('.hero-ht', hero)!, img = $('.hero-img', hero)!, led = $('.led', hero)!, card = $('.hero-card', hero)!, sub = $('.hero-sub', hero)!;
  track(hero, (p) => {
    const r = ease(span(p, 0.04, 0.8));
    ht.style.opacity = (1 - r).toFixed(3);
    ht.style.transform = `scale(${(1 + r * 0.14).toFixed(4)})`;
    img.style.transform = `scale(${(1.08 - r * 0.08).toFixed(4)})`;
    led.style.transform = `scaleX(${ease(span(p, 0.3, 0.95)).toFixed(4)})`;
    const out = span(p, 0.82, 1);
    card.style.transform = `translate3d(0, ${(-p * 28).toFixed(1)}px, 0)`;
    sub.style.opacity = (1 - span(p, 0.1, 0.4)).toFixed(3);
    card.style.opacity = (1 - out * 0.6).toFixed(3);
  }, 'sticky');
}
