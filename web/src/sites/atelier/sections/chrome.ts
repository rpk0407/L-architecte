// The frame around the plates: the header (plate index, the plate you are on, the scroll gauge) and,
// on phones, the dock: one booking action under the thumb whose label follows the plate on screen
// ("Valider le devis · 45 €" on the quote, "Réserver ce plan" after the diagnostic).
import { openBooking, isBookingOpen } from '../../../site-kit/booking';
import { track } from '../../../site-kit/motion';
import { $, $$, text } from '../util';

export type Action = { label: string; sub: string; run: () => void };
const actions = new Map<string, Action>();
let plate = 'planche';
let fallback: Action = { label: 'Réserver', sub: 'sans compte', run: () => openBooking({ source: 'atelier-dock' }) };

const dock = $('[data-dock]')!, dockBtn = $<HTMLAnchorElement>('[data-dock-btn]')!;

function paintDock() {
  const a = actions.get(plate) || fallback;
  text($('[data-dock-label]', dock), a.label);
  text($('[data-dock-sub]', dock), a.sub);
}
/** A plate offers its own next step to the dock (null gives the default back). */
export function setAction(id: string, a: Action | null) { if (a) actions.set(id, a); else actions.delete(id); if (id === plate) paintDock(); }
// the dock shows once the hero's own buttons are gone, and steps aside whenever the same action is
// already on screen (the plan's or the quote's own button, the final call) and for the footer
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
  if (old) { dio.unobserve(old); seen.delete(old); }
  if (el) { watched.set(key, el); dio.observe(el); } else watched.delete(key);
  if (old) show();  // the observer reports new elements itself (no flash of the dock on first paint)
}
/** The default step: "Réserver" with the next free slot as its subtitle. */
export function setFallbackSub(sub: string) { fallback = { ...fallback, sub }; paintDock(); }

export function mountChrome() {
  const hd = $('[data-hd]')!, idx = $<HTMLButtonElement>('[data-idx]')!, nav = $('#planches')!;
  const links = $$<HTMLAnchorElement>('a[data-to]', nav);
  const plates = $$<HTMLElement>('[data-plate]');

  // which plate is under the reading line (a band at 40 % of the screen): no layout reads on scroll
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      plate = el.id;
      $$('[data-cur-n]').forEach((n) => text(n, el.dataset.plate || ''));
      links.forEach((a) => { if (a.dataset.to === plate) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      hd.dataset.tone = el.classList.contains('dark') ? 'dark' : 'light';
      paintDock();
    }
  }, { rootMargin: '-40% 0px -59% 0px' });
  plates.forEach((p) => io.observe(p));

  // the gauge under the header: how much of the drawing has been read
  const prog = $('[data-prog]')!;
  track($('#main'), (p) => { prog.style.transform = `scaleX(${p.toFixed(4)})`; }, 'sticky');

  // the plate index (phones and tablets): a disclosure, closed by Escape, a click outside or a choice
  const setOpen = (open: boolean, focus = false) => {
    hd.classList.toggle('open', open);
    idx.setAttribute('aria-expanded', String(open));
    if (open && focus) links[0]?.focus();
  };
  idx.addEventListener('click', (e) => setOpen(idx.getAttribute('aria-expanded') !== 'true', (e as MouseEvent).detail === 0));
  nav.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) setOpen(false); });
  document.addEventListener('click', (e) => { if (hd.classList.contains('open') && !hd.contains(e.target as Node)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && hd.classList.contains('open')) { setOpen(false); idx.focus(); } });
  addEventListener('scroll', () => { if (hd.classList.contains('open')) setOpen(false); }, { passive: true });

  [$('[data-hero-cta]'), $('[data-final-cta]'), $('.ft'), $('[data-validate]')].forEach((el, i) => avoid('static' + i, el));
  dockBtn.addEventListener('click', (e) => { e.preventDefault(); if (!isBookingOpen()) (actions.get(plate) || fallback).run(); });
  paintDock();
}
