// The way around: the top bar (solid once past the hero photo), the mirror's red LED line as the reading
// progress, the chapter in view, and on phones the bottom dock, which appears once the hero is behind,
// steps aside for the keyboard, the booking sheet and the final call; the page keeps room for it at the
// bottom (CSS). In-page links move the focus with the scroll, and the sheet never strands the focus.
import { closeBooking, isBookingOpen } from '../../../site-kit/booking';
import { smoothAnchors, track } from '../../../site-kit/motion';
import { $, $$ } from '../dom';

export function initNav(onSheet: (open: boolean) => void) {
  const bar = $('[data-bar]')!, dock = $('[data-dock]')!, led = $('[data-led]')!;
  const root = document.documentElement;
  smoothAnchors(64);
  // the kit's anchors only scroll: the skip link, the chapters and the dock also take the focus there
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href^="#"]');
    const t = a ? document.getElementById(a.getAttribute('href')!.slice(1)) : null;
    if (!t || !t.hasAttribute('tabindex')) return;
    requestAnimationFrame(() => t.focus({ preventScroll: true }));
  });

  // reading progress: the LED fills as the page goes by (one shared rAF loop, transform only)
  track($('main'), (p) => { led.style.transform = 'scaleX(' + p.toFixed(4) + ')'; }, 'sticky');

  const flags = { solid: false, past: false, sheet: false, typing: false, last: false };
  const paint = () => {
    bar.classList.toggle('solid', flags.solid);
    dock.classList.toggle('on', flags.past && !flags.sheet && !flags.typing && !flags.last);
  };
  if (typeof IntersectionObserver !== 'undefined') {
    // "behind": gone off the top, not yet below the fold
    const behind = (e: IntersectionObserverEntry) => !e.isIntersecting && e.boundingClientRect.top < 0;
    new IntersectionObserver(([e]) => { flags.solid = behind(e) || e.intersectionRatio < 0.6; paint(); }, { rootMargin: '-64px 0px 0px 0px', threshold: [0, 0.6] }).observe($('.st')!);
    // the whole hero, not its last button: a jump back to the top always crosses it, so the dock always hears it
    new IntersectionObserver(([e]) => { flags.past = behind(e); paint(); }, { rootMargin: '-120px 0px 0px 0px' }).observe($('.hero')!);
    // the final call is its own big red button: one is enough on screen
    new IntersectionObserver(([e]) => { flags.last = e.intersectionRatio >= 0.4; paint(); }, { threshold: [0, 0.4, 1] }).observe($('#reserver')!);
    // the chapter in view: of the chapters crossing the reading line, the one that starts highest
    const links = $$<HTMLAnchorElement>('[data-chap]');
    const inBand = new Set<Element>();
    const ob = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) inBand.add(e.target); else inBand.delete(e.target);
      const cur = [...inBand].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      links.forEach((a) => { const on = !!cur && a.dataset.chap === cur.id; a.classList.toggle('cur', on); if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('main section[id]').forEach((el) => ob.observe(el));
  }

  // the sheet: whatever opened it gets the focus back, even the dock, which was hidden while it was open
  let opener: HTMLElement | null = null, openerAt = 0, body: Element | null = null;
  document.addEventListener('click', (e) => { const el = (e.target as Element).closest?.<HTMLElement>('[data-book]'); if (el) { opener = el; openerAt = Date.now(); } }, true);
  const lost = () => { const a = document.activeElement; return !a || a === document.body; };
  // a step re-renders the sheet's body and the button that was pressed goes with it: the step's title takes the focus
  const steps = new MutationObserver(() => { if (isBookingOpen() && lost()) document.getElementById('lxb-t')?.focus({ preventScroll: true }); });
  // Échap still closes the sheet when the focus has slipped out of it (the kit listens on the sheet only)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isBookingOpen() || (document.activeElement as Element | null)?.closest('.lxb')) return;
    e.preventDefault();
    closeBooking();
  });
  // the sheet locks the page with a class on <html>: that is the one signal for "booking open"
  new MutationObserver(() => {
    const open = root.classList.contains('lxb-lock');
    if (open === flags.sheet) return;
    flags.sheet = open;
    paint();
    if (open && !body && (body = document.querySelector('.lxb-body'))) steps.observe(body, { childList: true });
    // opened from script (the command bar), not from a [data-book] click: the kit's own opener stands
    if (open && Date.now() - openerAt > 1500) opener = null;
    if (!open && opener?.isConnected && (lost() || document.activeElement?.closest('.lxb'))) opener.focus({ preventScroll: true });
    onSheet(open);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  // a phone keyboard pushes fixed elements up: the dock waits while the command bar is in use
  const q = $('#q')!;
  q.addEventListener('focus', () => { flags.typing = true; paint(); });
  q.addEventListener('blur', () => { flags.typing = false; paint(); });
  paint();
}
