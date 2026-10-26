// The kit's booking sheet, as the film hands it over. Its look is set in base.css (--lxb-*); here is what the kit
// leaves to the page: focus that falls out of the sheet when a step is re-drawn, Esc wherever focus is, a visible
// way out when the salon cannot be reached, and focus back in the right place when the element that opened the
// sheet was re-drawn while it was open (a booking re-paints the hero card and the casting chips).
import { openBooking, closeBooking, isBookingOpen, type Prefill } from '../../site-kit/booking';
import * as S from '../../site-kit/salon';
import { SHOP } from '../../site-kit/content';
import { $, esc } from './util';

let last: Prefill = {};
let from: { src: string; staff: string; chain: Element[] } | null = null;

const DOWN = 'Le salon ne répond pas pour le moment.';

/** What the visitor tapped: its prefill (to retry) and where it sat (to find its replacement). */
function remember(el: HTMLElement) {
  const d = el.dataset;
  last = { slugs: d.bookSlug?.split(','), serviceIds: d.bookService?.split(','), staffKey: d.bookStaff, staffId: d.bookStaffId, day: d.bookDay, start: d.bookStart ? Number(d.bookStart) : undefined, source: d.bookSource };
  const chain: Element[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) chain.push(p);
  from = { src: d.bookSource || '', staff: d.bookStaffId || '', chain };
}

/** After closing: if focus was left on nothing (or inside the hidden sheet), put it on the opener's replacement. */
function restore() {
  const a = document.activeElement;
  if (!from || (a && a !== document.body && !a.closest('.lxb'))) return;
  const f = from;
  const same = Array.from(document.querySelectorAll<HTMLElement>('[data-book-source]')).find((el) => el.dataset.bookSource === f.src && (!f.staff || el.dataset.bookStaffId === f.staff));
  const holder = f.chain.find((el) => el.isConnected);
  const t = same || holder?.querySelector<HTMLElement>('a[href], button') || (holder as HTMLElement | undefined);
  if (t && !t.matches('a[href], button')) t.setAttribute('tabindex', '-1');
  t?.focus({ preventScroll: true });
}

/** The kit keeps a grey skeleton when the salon cannot be loaded: say so, and offer a retry and the salon itself. */
function notice(root: HTMLElement) {
  const body = $('.lxb-body', root), sr = $('.lxb-sr', root);
  if (!body || $('[data-fm-retry]', body)) return;
  body.innerHTML = `<p class="lxb-err" role="alert">${esc(DOWN)}</p>
    <p class="lxb-muted">Réessaie dans un instant. Tu peux aussi passer au salon, ${esc(SHOP.address)} (${esc(SHOP.hoursText.charAt(0).toLowerCase() + SHOP.hoursText.slice(1))}), ou lui écrire.</p>
    <button type="button" class="lxb-cta inline" data-fm-retry>Réessayer</button>
    <div class="lxb-acts"><a class="lxb-ghost" href="mailto:${esc(SHOP.email)}">Écrire au salon</a><a class="lxb-ghost" href="${esc(SHOP.maps)}" target="_blank" rel="noopener">Itinéraire</a></div>`;
  if (sr && sr.textContent !== DOWN) sr.textContent = DOWN;
}

function watch(root: HTMLElement) {
  let wasOpen = false;
  new MutationObserver(() => {
    const open = root.classList.contains('open');
    if (open) {
      wasOpen = true;
      const down = !S.getSalon();
      root.classList.toggle('is-down', down);
      if (down) notice(root);
      // a step re-drawn under the focused button drops focus to the page: bring it back to the step's title
      const a = document.activeElement;
      if (!a || a === document.body) $('#lxb-t', root)?.focus({ preventScroll: true });
    } else if (wasOpen) {
      wasOpen = false;
      restore();
    }
  }).observe(root, { attributes: true, attributeFilter: ['class', 'data-step'], childList: true, subtree: true });
}

export function mountSheet() {
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    const el = t.closest?.('[data-book]') as HTMLElement | null;
    if (el) remember(el);
    const retry = t.closest?.('[data-fm-retry]') as HTMLButtonElement | null;
    if (retry) { retry.disabled = true; retry.textContent = 'On réessaie…'; openBooking(last); }
  }, true);
  // the kit listens for Esc on the sheet only; after a re-draw focus may be outside it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isBookingOpen() && !document.activeElement?.closest('.lxb')) { e.preventDefault(); closeBooking(); }
  });
  // the sheet is built on first use
  const found = () => { const r = $('.lxb'); if (r) { watch(r); return true; } return false; };
  if (found()) return;
  const mo = new MutationObserver(() => { if (found()) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}
