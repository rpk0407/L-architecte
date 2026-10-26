/* L’Atelier — the barber as architect. The page is a drawing board: paper, a millimetre grid, plates
 * numbered 01 to 09, construction lines, dimension lines ("cotes"), annotations and title blocks
 * ("cartouches"). « Construction au millimètre », taken literally.
 *
 * Grid      12 columns from 900 px (24 px gutters), 4 on phones; content 1360 px max; side margin --pad.
 *           Light plates are os paper with a 12 px minor / 60 px major grid; dark plates ("tirages",
 *           the prints) are encre with the same grid in os at a whisper.
 * Type      Instrument Serif for the voice: display clamp(56–184 px)/.86, plate titles clamp(46–124 px)/.9,
 *           negative tracking, italic for the emphasis. Instrument Sans for what is read fast: 17 px body,
 *           14.5 px secondary, 11.5 px uppercase micro-labels tracked .12em, tabular figures for prices.
 * Space     4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128 (--s1…--s10); plates breathe at clamp(88–168 px).
 * Colour    encre on os; blanc for the "calques" (cards, the quote); rouge only for intent: the primary
 *           action, the construction line that matters, the crosshair, the mirror's LED line. Small red text
 *           on paper uses a darker functional red (--rouge-ink) to keep AA.
 * Motion    --ease-out everywhere; lines draw (stroke-dashoffset) once, when seen; one scroll loop
 *           (motion.track) for the header gauge and the method line; transforms and opacity only.
 *           Reduced motion: everything drawn and visible, nothing scrubbed, no crosshair.
 * Funnel    hook (promise, live state, next free slot, book) → prints → diagnostic → method → proof
 *           → barbers with their slots → quote → price list and clauses → access and the last call.
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

loadSalon().catch(() => { /* first paint keeps the fallbacks; the sheet says so if it is opened */ });
bootBooking();
mountVersions('atelier');

mountChrome();
mountHero();
mountMine();
mountLooks();
mountDiagnostic();
mountChantier();
mountReleve();
mountTeam();
mountDevis();
mountCahier();
mountAcces();
startLive();
mountCrosshair();

reveal();
smoothAnchors(72);
