// The booking sheet, seen from the page. The kit draws it; this module keeps the page honest around it:
// - renders that would destroy the element that opened the sheet wait until it closes (whenClosed), so
//   the kit can give the focus back to it;
// - closed, the sheet is inert (out of the tab order and the accessibility tree);
// - Escape closes it from wherever the focus is, and when a step re-draws its body the focus lands on the
//   same control again, or on the step's title, never on <body>;
// - when the salon cannot be reached, a booking action says so, with the way to come anyway, instead of
//   opening a sheet that would load forever.
import * as S from '../../site-kit/salon';
import { openBooking, closeBooking, isBookingOpen, type Prefill } from '../../site-kit/booking';
import { SHOP } from '../../site-kit/content';

const NB = '\u00a0';
let root: HTMLElement | null = null;
const waiting = new Set<() => void>();
let origin: HTMLElement | null = null;

/** Runs fn now, or once the booking sheet has closed (the same fn queued twice runs once). */
export function whenClosed(fn: () => void) { if (isBookingOpen()) waiting.add(fn); else fn(); }

/** Where focus goes back when the element that opened the sheet is gone: its card's or plate's heading. */
function home(el: HTMLElement | null) {
  const box = el?.closest('.arch, .mine-card, .dx-plan, .qt, .look, section, footer');
  const t = box?.querySelector<HTMLElement>('h1, h2, h3');
  if (t && !t.hasAttribute('tabindex')) t.tabIndex = -1;
  return t || null;
}

function attach(el: HTMLElement) {
  root = el;
  root.inert = !root.classList.contains('open');
  let wasOpen = !root.inert;
  new MutationObserver(() => {
    const open = root!.classList.contains('open');
    if (open === wasOpen) return;
    wasOpen = open;
    root!.inert = !open;
    if (open) {
      const a = document.activeElement as HTMLElement | null;
      origin = a && a !== document.body && !root!.contains(a) ? a : origin;
      return;
    }
    // closed: the renders that waited, then make sure the focus is somewhere a sighted user can see it
    const jobs = [...waiting];
    waiting.clear();
    jobs.forEach((fn) => fn());
    const from = origin, fallback = home(from);
    origin = null;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && !root!.contains(a)) return;
      (from?.isConnected ? from : fallback)?.focus({ preventScroll: true });
    }, 0);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  // a step re-draws the whole body: put the focus back on the same control, or on the step's title
  let sig: string | null = null;
  root.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-a]');
    sig = b ? ['a', 'id', 'day', 'm'].map((k) => b.dataset[k] ? `[data-${k}="${CSS.escape(b.dataset[k]!)}"]` : '').join('') : null;
  }, true);
  const body = root.querySelector('.lxb-body');
  if (body) new MutationObserver(() => {
    if (!isBookingOpen()) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const same = sig ? root!.querySelector<HTMLElement>('.lxb-sheet ' + sig) : null;
    (same && same.offsetParent ? same : root!.querySelector<HTMLElement>('#lxb-t'))?.focus({ preventScroll: true });
  }).observe(body, { childList: true });
}

/* ---------------- the salon cannot be reached ---------------- */

let down: HTMLElement | null = null, downFrom: HTMLElement | null = null, retry: (() => void) | null = null;
function showDown(from: Element | null, again: () => void) {
  downFrom = from as HTMLElement | null;
  retry = again;
  if (!down) {
    const p = document.createElement('div');
    p.className = 'down';
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'Réservation en ligne indisponible');
    const k = document.createElement('p'), t = document.createElement('p'), s = document.createElement('p'), mail = document.createElement('a');
    k.className = 'micro'; k.textContent = 'Réservation en ligne';
    t.className = 'down-t'; t.setAttribute('role', 'alert');
    mail.href = 'mailto:' + SHOP.email; mail.textContent = SHOP.email;
    s.className = 'down-s';
    s.append(`Passe au salon, ${SHOP.address}, ${SHOP.city.replace(' ', NB)}${NB}: ${SHOP.hoursText.charAt(0).toLowerCase() + SHOP.hoursText.slice(1)}. Ou écris-nous${NB}: `, mail, '.');
    const a = document.createElement('div'), r = document.createElement('button'), c = document.createElement('button');
    a.className = 'down-a';
    r.type = 'button'; r.className = 'btn sm'; r.textContent = 'Réessayer';
    c.type = 'button'; c.className = 'tl'; c.textContent = 'Fermer';
    r.addEventListener('click', () => {
      r.disabled = true;
      S.loadSalon().then(() => { hideDown(false); retry?.(); }, () => { t.textContent = 'Toujours pas de réponse du salon. Réessaie dans un instant.'; }).finally(() => { r.disabled = false; });
    });
    c.addEventListener('click', () => hideDown(true));
    p.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideDown(true); });
    a.append(r, c);
    p.append(k, t, s, a);
    document.body.append(p);
    down = p;
  }
  (down.querySelector('.down-t') as HTMLElement).textContent = 'Le salon ne répond pas pour le moment.';
  down.classList.add('on');
  (down.querySelector('.btn') as HTMLElement).focus({ preventScroll: true });
}
function hideDown(refocus: boolean) {
  if (!down) return;
  down.classList.remove('on');
  if (refocus) downFrom?.focus({ preventScroll: true });
}

/** openBooking, but a salon that does not answer gets one retry and then an honest message. */
export function book(p: Prefill, from: Element | null = document.activeElement) {
  if (S.getSalon()) { openBooking(p); return; }
  S.loadSalon().then(() => openBooking(p), () => showDown(from, () => openBooking(p)));
}

export function watchSheet() {
  const found = document.querySelector<HTMLElement>('.lxb');
  if (found) attach(found);
  else {
    const mo = new MutationObserver(() => { const el = document.querySelector<HTMLElement>(':scope > .lxb'); if (el) { mo.disconnect(); attach(el); } });
    mo.observe(document.body, { childList: true });
  }
  // Escape from anywhere (the kit listens on the sheet only, and its focus arrives 320 ms after opening)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isBookingOpen() && !(root && root.contains(e.target as Node))) { e.preventDefault(); closeBooking(); }
  });
  // [data-book] while the salon is unreachable: try again once, then explain (capture: before the kit)
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest?.<HTMLElement>('[data-book]');
    if (!el || S.getSalon() || !el.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    S.loadSalon().then(() => el.click(), () => showDown(el, () => el.click()));
  }, true);
}
