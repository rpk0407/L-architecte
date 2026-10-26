/* En direct — Barber L’Architecte, the salon in real time.
 *
 * Art direction
 * - Idea: a departures board in a warm room. The page answers « je peux passer quand, avec qui ? » before
 *   it tells a story: the live status is the headline, the command bar is the hero's main act, and the
 *   brand chapters (the work, the proof, the prices, the place) follow the control room.
 * - Colour: encre UI (#0F0E0D, encre2/3 for panels), os for text, cendre for secondary text (7:1 on encre).
 *   Vert-vif is reserved for "live" (dots, open status), rouge for the one action of a block, the LED
 *   line (reading progress, the board's top edge, the salon photo) and « au millimètre ». No other hue,
 *   except each barber's own colour on his monogram.
 * - Type: Instrument Serif for the voice (status, titles, prices, times in prose), tight leading, negative
 *   tracking, italics for the second beat; Instrument Sans for everything read fast, uppercase micro
 *   labels at 11–12 px with .12em tracking and a serif italic number (01, 02…) per chapter.
 *   Scale (fluid): display 64→176 · h2 44→112 · h3 34→56 · lead 19→24 · body 16–17 · small 13–14 · micro 11.5.
 * - Grid: 4 columns on phones (16 px gutters), 8 on tablets, 12 from 1100 px, max 1440 + --g margins.
 *   Desktop opens on a two-column control room: hero, command bar and board on the left (7/12); the salon
 *   photo, your appointment and the barbers on the right (5/12). Then full-width chapters.
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
import { reveal, splitWords } from '../../site-kit/motion';
import { $$ } from './dom';
import { pool, onShared } from './store';
import { initNav } from './sections/nav';
import { paintHero, paintClock } from './sections/hero';
import { initCommand, refreshCommand } from './sections/command';
import { initBoard, drawFilters, refreshBoard } from './sections/board';
import { paintChairs } from './sections/chairs';
import { paintMe, tickMe } from './sections/me';
import { initCarte, paintCarte } from './sections/carte';
import { initProof } from './sections/proof';
import { initWork, paintLooks } from './sections/work';
import { initSalon, paintSalon } from './sections/salon';

bootBooking();
mountVersions('direct');

let sheetOpen = false, deferred = false, failed = false;

/** Everything that shows live data, from what is already known (no network here). */
function paintAll() {
  // lists are not rebuilt under an open sheet: closing it must give the focus back to the button that opened it
  if (sheetOpen) { deferred = true; return; }
  paintHero(failed);
  paintChairs();
  paintMe();
  paintSalon();
}

/** Ask the salon again (the kit caches 20 s): today's cuts for the hero, the board's service, the live wait. */
function refresh(fresh = false) {
  return Promise.all([
    pool(['cl'], fresh).then(() => { failed = false; }, () => { failed = true; }),
    refreshBoard(fresh),
    S.getLive()
  ]).then(() => { paintAll(); refreshCommand(); });
}

initNav((open) => { sheetOpen = open; if (!open && deferred) { deferred = false; paintAll(); } });
initCommand();
initBoard();
initCarte();
initProof();
initWork();
initSalon();
paintAll();

$$('[data-split]').forEach((el) => { splitWords(el); el.setAttribute('data-reveal', ''); });
reveal(document);

onShared(() => { paintChairs(); });
S.loadSalon().then(() => { drawFilters(); paintCarte(); paintLooks(); paintAll(); return refresh(); }, () => { failed = true; paintAll(); });

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
