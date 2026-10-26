// The way around: the top bar (solid once past the photo), the mirror's red LED line as the reading
// progress, the chapter in view, and on phones the bottom dock, which appears once the hero is behind,
// steps aside for the keyboard and the booking sheet; the page keeps room for it at the bottom (CSS).
import { smoothAnchors, track } from '../../../site-kit/motion';
import { $, $$ } from '../dom';

export function initNav(onSheet: (open: boolean) => void) {
  const bar = $('[data-bar]')!, dock = $('[data-dock]')!, led = $('[data-led]')!;
  const root = document.documentElement;
  smoothAnchors(64);

  // reading progress: the LED fills as the page goes by (one shared rAF loop, transform only)
  track($('main'), (p) => { led.style.transform = 'scaleX(' + p.toFixed(4) + ')'; }, 'sticky');

  const flags = { solid: false, past: false, sheet: false, typing: false };
  const paint = () => {
    bar.classList.toggle('solid', flags.solid);
    dock.classList.toggle('on', flags.past && !flags.sheet && !flags.typing);
  };
  if (typeof IntersectionObserver !== 'undefined') {
    // "behind": gone off the top, not yet below the fold
    const behind = (e: IntersectionObserverEntry) => !e.isIntersecting && e.boundingClientRect.top < 0;
    new IntersectionObserver(([e]) => { flags.solid = behind(e) || e.intersectionRatio < 0.6; paint(); }, { rootMargin: '-64px 0px 0px 0px', threshold: [0, 0.6] }).observe($('.feed')!);
    new IntersectionObserver(([e]) => { flags.past = behind(e); paint(); }, { rootMargin: '-120px 0px 0px 0px' }).observe($('.hero-cta')!);
    // the chapter in view, for the top bar and the dock
    const links = $$<HTMLAnchorElement>('[data-chap]');
    const ob = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) links.forEach((a) => { const on = a.dataset.chap === e.target.id; a.classList.toggle('cur', on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    // every chapter is watched, so leaving "Venir" for "Questions" clears the mark instead of keeping it
    document.querySelectorAll('main section[id]').forEach((el) => ob.observe(el));
  }
  // the sheet locks the page with a class on <html>: that is the one signal for "booking open"
  new MutationObserver(() => {
    const open = root.classList.contains('lxb-lock');
    if (open === flags.sheet) return;
    flags.sheet = open;
    paint();
    onSheet(open);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  // a phone keyboard pushes fixed elements up: the dock waits while the command bar is in use
  const q = $('#q')!;
  q.addEventListener('focus', () => { flags.typing = true; paint(); });
  q.addEventListener('blur', () => { flags.typing = false; paint(); });
  paint();
}
