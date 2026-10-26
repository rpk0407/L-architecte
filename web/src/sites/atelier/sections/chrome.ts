// The frame around the plates: the header (plate index, the plate you are on, the scroll gauge) and,
// on phones, the dock: one action under the thumb whose label follows the plate on screen
// ("Valider le devis · 45 €" on the quote, "Réserver ce plan" after the diagnostic, "Mon rendez-vous"
// for someone who already has one).
import { isBookingOpen } from '../../../site-kit/booking';
import { track } from '../../../site-kit/motion';
import { $, $$, text } from '../util';
import { book } from '../sheet';

export type Action = { label: string; sub: string; run: () => void };
const actions = new Map<string, Action>();
let plate = 'planche';
const plain = () => book({});
let fallback: Action = { label: 'Réserver', sub: 'sans compte', run: plain };

const dock = $('[data-dock]')!, dockBtn = $<HTMLAnchorElement>('[data-dock-btn]')!;

function paintDock() {
  const a = actions.get(plate) || actions.get('mine') || fallback;
  text($('[data-dock-label]', dock), a.label);
  text($('[data-dock-sub]', dock), a.sub);
}
/** A plate offers its own next step to the dock (null gives the default back). 'mine' overrides the
 *  default on every plate that has no step of its own. */
export function setAction(id: string, a: Action | null) { if (a) actions.set(id, a); else actions.delete(id); paintDock(); }
/** The default step: "Réserver", and the next free slot it books when there is one. */
export function setFallback(sub: string, run: (() => void) | null) { fallback = { label: 'Réserver', sub, run: run || plain }; paintDock(); }

// the dock shows once the hero's own buttons are gone, and steps aside whenever the same action is
// already on screen (the plan's or the quote's own button, the final call, the personal card) and for the footer
const seen = new Set<Element>(), watched = new Map<string, Element>();
const show = () => {
  const on = !seen.size;
  dock.classList.toggle('on', on);
  dock.setAttribute('aria-hidden', String(!on));
  dockBtn.tabIndex = on ? 0 : -1;
};
const dio = new IntersectionObserver((es) => { for (const e of es) { if (e.isIntersecting && e.target.isConnected) seen.add(e.target); else seen.delete(e.target); } show(); });
/** The dock steps aside while this element is on screen (a new element under the same key replaces the old). */
export function avoid(key: string, el: Element | null) {
  const old = watched.get(key);
  if (old === el) return;
  if (old) { dio.unobserve(old); seen.delete(old); }
  if (el) { watched.set(key, el); dio.observe(el); } else watched.delete(key);
  if (old) show();  // the observer reports new elements itself (no flash of the dock on first paint)
}

/** In-page links scroll smoothly (motion.smoothAnchors) but the browser no longer moves the focus: move it
 *  to the target's heading, so the next Tab continues from the plate that was chosen. */
function focusTarget(e: MouseEvent) {
  const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href^="#"]');
  const id = a?.getAttribute('href')!.slice(1);
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  const t = target.matches('section, main') ? target.querySelector<HTMLElement>('h1, h2') : target;
  if (!t) return;
  if (!t.matches('a, button, input, [tabindex]')) t.tabIndex = -1;
  t.focus({ preventScroll: true });
}

export function mountChrome() {
  const hd = $('[data-hd]')!, idx = $<HTMLButtonElement>('[data-idx]')!, nav = $('#planches')!;
  const links = $$<HTMLAnchorElement>('a[data-to]', nav);
  const plates = $$<HTMLElement>('[data-plate]');
  const names = new Map(links.map((a) => [a.dataset.to!, $('.t', a)?.textContent || '']));

  // which plate is under the reading line (a band at 40 % of the screen): no layout reads on scroll
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      plate = el.id;
      $$('[data-cur-n]').forEach((n) => text(n, el.dataset.plate || ''));
      $$('[data-cur-t]').forEach((n) => text(n, names.get(plate) || ''));
      links.forEach((a) => { if (a.dataset.to === plate) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      hd.dataset.tone = el.classList.contains('dark') ? 'dark' : 'light';
      paintDock();
    }
  }, { rootMargin: '-40% 0px -59% 0px' });
  plates.forEach((p) => io.observe(p));

  // the gauge under the header: how much of the drawing has been read
  const prog = $('[data-prog]')!;
  track($('#main'), (p) => { prog.style.transform = `scaleX(${p.toFixed(4)})`; }, 'sticky');

  // the plate index (phones and tablets): a disclosure, closed by Escape, a click outside or a choice;
  // closed, its links are inert at once (the fade-out is only for the eye)
  const wide = matchMedia('(min-width: 1180px)');
  const setOpen = (open: boolean, focus = false) => {
    hd.classList.toggle('open', open);
    idx.setAttribute('aria-expanded', String(open));
    nav.inert = !open && !wide.matches;
    if (open && focus) links[0]?.focus();
  };
  setOpen(false);
  wide.addEventListener('change', () => setOpen(false));
  idx.addEventListener('click', (e) => setOpen(idx.getAttribute('aria-expanded') !== 'true', (e as MouseEvent).detail === 0));
  nav.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) setOpen(false); });
  document.addEventListener('click', (e) => { if (hd.classList.contains('open') && !hd.contains(e.target as Node)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hd.classList.contains('open')) { setOpen(false); idx.focus(); } });
  addEventListener('scroll', () => { if (hd.classList.contains('open')) setOpen(false); }, { passive: true });
  document.addEventListener('click', focusTarget);

  [$('[data-hero-cta]'), $('[data-final-cta]'), $('.ft')].forEach((el, i) => avoid('static' + i, el));
  dockBtn.addEventListener('click', (e) => { e.preventDefault(); if (!isBookingOpen()) (actions.get(plate) || actions.get('mine') || fallback).run(); });
  paintDock();
}
