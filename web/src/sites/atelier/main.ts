/* L’Atelier — the barber as architect. The page is a drawing board: paper, a millimetre grid, plates
 * numbered 01 to 09, construction lines, dimension lines ("cotes"), annotations and title blocks
 * ("cartouches"). « Construction au millimètre », taken literally.
 *
 * Grid      12 columns from 900 px (24 px gutters), 4 on phones; content 1360 px max; side margin --pad.
 *           Light plates are os paper with a 12 px minor / 60 px major grid; dark plates ("tirages",
 *           the prints) are encre with the same grid in os at a whisper.
 * Type      Instrument Serif for the voice: display clamp(56–184 px)/.86, plate titles clamp(46–124 px)/.9,
 *           negative tracking, italic for the emphasis. Instrument Sans for what is read fast: 17 px body,
 *           14.5 px secondary, uppercase micro-labels 11–11.5 px tracked .12em (never smaller), tabular figures.
 * Space     4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 (--s1…--s10); plates breathe at clamp(72–120 px).
 *           Plate openings: Pl. tag and rule, then the title on 8 columns and the lead on the last 4,
 *           except where the content is the opening (the score on 05, the quote beside the title on 07,
 *           the salon itself on 09).
 * Colour    encre on os; blanc for the "calques" (cards, the quote); rouge only for intent: the primary
 *           action, the construction line that matters, the crosshair, the mirror's LED line. Small red text
 *           on paper uses a darker functional red (--rouge-ink) to keep AA.
 * Motion    --ease-out everywhere; lines draw (stroke-dashoffset) once, when seen; one scroll loop
 *           (motion.track) for the header gauge and the method line; transforms and opacity only.
 *           Reduced motion: everything drawn and visible, nothing scrubbed, no crosshair.
 * Funnel    hook (promise, live state, proof, the next free slot booked in one tap; a returning client's
 *           own appointment) → prints → diagnostic → method → proof → barbers with their slots → quote
 *           → tariff and clauses → access and the last call.
 *           Every plate ends on a booking action prefilled with what it was about; on phones the dock
 *           carries that action under the thumb.
 */
import '../../site-kit/tokens.css';
import './atelier.css';
import './plates.css';
import { bootBooking } from '../../site-kit/booking';
import { mountVersions } from '../../site-kit/versions';
import { loadSalon } from '../../site-kit/salon';
import { reveal, smoothAnchors } from '../../site-kit/motion';
import { watchSheet } from './sheet';
import { startLive } from './live';
import { mountChrome } from './sections/chrome';
import { mountHero } from './sections/hero';
import { mountMine } from './sections/mine';
import { mountLooks } from './sections/looks';
import { mountDiagnostic } from './sections/diagnostic';
import { mountChantier } from './sections/chantier';
import { mountReleve } from './sections/releve';
import { mountTeam } from './sections/team';
import { mountDevis } from './sections/devis';
import { mountCahier } from './sections/cahier';
import { mountAcces } from './sections/acces';
import { mountCrosshair } from './sections/crosshair';

loadSalon().catch(() => { /* first paint keeps the fallbacks; booking actions explain it if tapped */ });
watchSheet();
bootBooking();
mountVersions('atelier');

// the first screen now; the plates below are built one per task, so no single long task holds the main
// thread at load (their static frames are already in the HTML: nothing shifts). A deep link builds them
// all at once, so the browser lands on the right plate.
mountChrome();
mountHero();
mountMine();
startLive();
const later = [mountLooks, mountDiagnostic, mountChantier, mountReleve, mountTeam, mountDevis, mountCahier, mountAcces];
const finish = () => { reveal(); mountCrosshair(); smoothAnchors(72); };
if (location.hash) { later.forEach((fn) => fn()); finish(); }
else {
  const step = () => { const fn = later.shift(); if (fn) { fn(); setTimeout(step, 0); } else finish(); };
  setTimeout(step, 0);
}
