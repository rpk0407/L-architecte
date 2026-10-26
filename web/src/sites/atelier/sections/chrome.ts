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

  // the dock shows once the hero's own buttons are gone, and steps aside for the final call and the footer
  const seen = new Set<Element>();
  const show = () => {
    const on = !seen.size;
    dock.classList.toggle('on', on);
    dock.setAttribute('aria-hidden', String(!on));
    dockBtn.tabIndex = on ? 0 : -1;
  };
  const dio = new IntersectionObserver((es) => { for (const e of es) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); } show(); });
  [$('[data-hero-cta]'), $('[data-final-cta]'), $('.ft')].forEach((el) => el && dio.observe(el));
  dockBtn.addEventListener('click', (e) => { e.preventDefault(); if (!isBookingOpen()) (actions.get(plate) || fallback).run(); });
  paintDock();
}
