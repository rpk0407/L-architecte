/* En direct — Barber L’Architecte, the salon in real time.
 *
 * Art direction
 * - Idea: a departures board in a warm room. The page answers « je peux passer quand, avec qui ? » before
 *   it tells a story: the live status is the headline, the command bar is the hero's main act, and the
 *   brand chapters (the work, the proof, the prices, the place) follow the control room.
 * - Colour: encre UI (#0F0E0D, encre2/3 for panels), os for text, cendre for secondary text (7:1 on encre).
 *   Vert-vif means "now": the open status and a chair free right now, nowhere else. Rouge is the one
 *   action of a block, the LED line (reading progress, the board's top edge, the salon photo) and « au
 *   millimètre ». No other hue: monograms are stone with the dot screen, each barber's colour only a thin
 *   ring around his and a dot on the board. The one photo is graded towards black and white.
 * - Type: Instrument Serif for the voice (status, titles, prices, times in prose), tight leading, negative
 *   tracking, italics for the second beat; Instrument Sans for everything read fast, uppercase micro
 *   labels at 11–12 px with .12em tracking and a serif italic number (01, 02…) per chapter.
 *   Scale (fluid): display 64→176 · h2 44→112 · h3 34→56 · lead 19→24 · body 16–17 · small 13–14 · micro 11.5.
 * - Grid: 4 columns on phones (16 px gutters), 8 on tablets, 12 from 1100 px, max 1440 + --g margins.
 *   Desktop opens on a two-column control room: status, your appointment and the command bar on the left,
 *   the departures board on the right; the four chairs side by side under both. Then full-width chapters.
 * - Titles: the roman-then-italic beat is kept for two moments (« Construction au millimètre », the last
 *   call); the others are set roman, the address is set on the board's flaps.
 * - Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 72 · 112 (--s1…--s9), nothing in between.
 * - Motion: data moves, the page doesn't. Flaps turn when a value changes; numbers land, they don't
 *   bounce. Entrances 600–900 ms on --ease-out, interactions 160–240 ms, scroll only through motion.track
 *   (LED progress, a few pixels of photo drift, the salon photo's opening). Reduced motion: no flaps, no
 *   drift, no rotation, every chapter in normal flow.
 */
import '../../site-kit/tokens.css';
import './base.css';
import './room.css';
import './brand.css';
import * as S from '../../site-kit/salon';
import { bootBooking } from '../../site-kit/booking';
import { mountVersions } from '../../site-kit/versions';
import { SHOP } from '../../site-kit/content';
import { reveal, splitWords } from '../../site-kit/motion';
import { $, $$, h } from './dom';
import { barbers, pool, services } from './store';
import { initNav } from './sections/nav';
import { paintHero, paintClock } from './sections/hero';
import { initCommand, refreshCommand } from './sections/command';
import { initBoard, drawFilters, refreshBoard, boardFailed } from './sections/board';
import { paintChairs } from './sections/chairs';
import { paintMe, tickMe } from './sections/me';
import { initCarte, paintCarte } from './sections/carte';
import { initProof } from './sections/proof';
import { initWork, paintLooks } from './sections/work';
import { initSalon, paintSalon } from './sections/salon';

bootBooking();
mountVersions('direct');

let sheetOpen = false, deferred = false, failed = false;

/** One module that throws must not leave the others unpainted (or the page without its clock). */
function safe(f: () => void) { try { f(); } catch (e) { console.warn('[direct]', e); } }

/** Everything that shows live data, from what is already known (no network here). */
function paintAll() {
  // lists are not rebuilt under an open sheet: closing it must give the focus back to the button that opened it
  if (sheetOpen) { deferred = true; return; }
  // his appointment card can appear above what he is looking at: keep that element where it was on screen
  const a = document.activeElement as HTMLElement | null;
  const anchor = a && a !== document.body && !a.closest('.hero, .lxb') ? a : null;
  const y0 = anchor?.getBoundingClientRect().top;
  safe(() => paintHero(failed));
  safe(() => paintChairs(failed));
  safe(paintMe);
  safe(paintSalon);
  if (anchor && y0 != null && anchor.isConnected) { const dy = anchor.getBoundingClientRect().top - y0; if (Math.abs(dy) > 1) window.scrollBy(0, dy); }
}

/** Ask the salon again (the kit caches 20 s): today's cuts for the hero, the board's service, the live wait. */
function refresh(fresh = false) {
  return Promise.all([
    pool(['cl'], fresh).then(() => { failed = false; }, () => { failed = true; }),
    refreshBoard(fresh),
    S.getLive()
  ]).then(() => { paintAll(); refreshCommand(); });
}

// The catalogue and the team: content.ts until the salon answers, then the salon's, redrawn the first time
// it answers (at load or on a later tick after a failure) and whenever it changes.
let catalogue = '';
S.onChange(() => {
  const sig = JSON.stringify([services(), barbers()]);
  if (sig === catalogue || !S.getSalon()) return;
  catalogue = sig;
  safe(drawFilters); safe(paintCarte); safe(paintLooks);
});

// The salon unreachable when someone taps « Réserver »: the sheet would open on placeholders that never
// resolve. Ask once more; if it answers, carry on with the same tap, otherwise say so next to the dock.
const toast = $('[data-toast]')!;
let toastT = 0;
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>('[data-book]');
  if (!el || S.getSalon()) return;
  e.preventDefault();
  e.stopPropagation();
  S.loadSalon().then(() => el.click(), () => {
    clearTimeout(toastT);
    toast.classList.add('on');
    // written once the region is visible, so screen readers hear it
    requestAnimationFrame(() => toast.replaceChildren('Le salon ne répond pas pour l’instant. Réessaie dans un instant, ou ', h('a', { href: 'mailto:' + SHOP.email }, 'écris au salon'), '.'));
    toastT = window.setTimeout(() => toast.classList.remove('on'), 9000);
  });
}, true);

// The sheet walks the history (one entry per step) and closing goes back through it. The mode is stored
// per entry, so it has to be manual from the start: otherwise going back to this page's own entry puts
// back its old scroll offset, after the anchoring above, and the visitor lands somewhere else.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
initNav((open) => {
  sheetOpen = open;
  if (open) return;
  // a frame later, once the sheet has handed the focus back to the button that opened it (the anchor)
  if (deferred) { deferred = false; requestAnimationFrame(paintAll); }
  // the sheet held a slot while it was open: once released, it is free again everywhere
  setTimeout(() => refresh(true), 300);
});

// entrances and the first request before any painting: nothing below can keep the page dark or offline
$$('[data-split]').forEach((el) => { splitWords(el); el.setAttribute('data-reveal', ''); });
reveal(document);
S.loadSalon().then(() => refresh(), () => { failed = true; safe(boardFailed); paintAll(); });

safe(initCommand);
safe(() => initBoard(() => paintChairs(failed)));
safe(initCarte);
safe(initProof);
safe(initWork);
safe(initSalon);
paintAll();

/* once a minute, on the salon's clock, while the tab is visible: the clock, the countdown, fresh slots */
let tickT = 0;
function schedule() {
  clearTimeout(tickT);
  if (document.hidden) return;
  tickT = window.setTimeout(() => { paintClock(); tickMe(); refresh(); schedule(); }, 60000 - (S.now() % 60000) + 40);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { paintClock(); tickMe(); refresh(); } schedule(); });
schedule();

// a booking from any entry point: new slots everywhere, and his appointment at the top
addEventListener('lx:booked', () => { refresh(true); });
addEventListener('lx:me', () => { paintAll(); });
