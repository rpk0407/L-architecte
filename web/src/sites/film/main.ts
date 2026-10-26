/* Le Film · /film
   A visit to L’Architecte told as a short film; the scroll is the timeline and it runs exactly as long as a
   classic cut (the HUD timecode reaches the catalogue's 30 min at the credits).

   Art direction
   · Ink-dominant (--encre), photographs in black and white, one red: the LED line of the salon's mirror,
     reused as the accent (CTA, emphasis, the live "rec" mark). Bone paper (--os) only for the programme (06)
     and the booking ticket, like printed matter handed out at a cinema.
   · Film grammar as structure, not decoration: a slug line per sequence (number · title · screenplay
     heading), letterbox bars that open on the first shot and close in briefly at each cut, subtitles for
     reviews and captions, end credits for the barbers and the footer.
   · Grid: 4 columns on phones, 12 from 900 px, gutters --pad (20 → 80 px), content max 1440 px.
   · Type: Instrument Serif for the voice, three display sizes (--t-mega title cards, --t-h2 sequence
     titles, --t-h3 names and prices), italic for emphasis; Instrument Sans for anything read fast,
     micro-labels at 11.5 px uppercase with .16em tracking, tabular figures for time and money.
   · Spacing: one 4/8 scale (--s1 … --s10 = 4, 8, 12, 16, 24, 32, 48, 64, 96, 144 px).
   · Motion: the scroll is the only clock. Pinned shots are scrubbed through motion.track (one rAF loop,
     transforms, opacity and cross-fades of pre-filtered layers; nothing re-filters per frame). Entrances
     use --ease-out. With reduced motion every pinned shot falls back to a plain, complete layout. */
import '../../site-kit/tokens.css';
import './base.css';
import './sections.css';
import { bootBooking } from '../../site-kit/booking';
import { mountVersions } from '../../site-kit/versions';
import { onChange } from '../../site-kit/salon';
import { reveal, smoothAnchors } from '../../site-kit/motion';
import { mountChrome } from './chrome';
import { startLive } from './live';
import { mountPersonal } from './personal';
import { svc, priceText, durText } from './data';
import { $$, setText } from './util';
import { mountHero } from './sections/hero';
import { mountManifesto } from './sections/manifesto';
import { mountLooks } from './sections/looks';
import { mountTemps } from './sections/temps';
import { mountPreuve } from './sections/preuve';
import { mountCasting } from './sections/casting';
import { mountSeance } from './sections/seance';
import { mountLieu } from './sections/lieu';
import { mountFaq } from './sections/faq';

/** Prices, durations and names quoted in the copy follow the live catalogue. */
function paintCatalogue() {
  const fill = (attr: string, fn: (x: NonNullable<ReturnType<typeof svc>>) => string) => $$(`[data-${attr}]`).forEach((el) => { const x = svc(el.getAttribute('data-' + attr)!); if (x) setText(el, fn(x)); });
  fill('price', priceText);
  fill('dur', durText);
  fill('name', (x) => x.name);
  fill('inc', (x) => x.includes.slice(0, 3).join(', ').toLowerCase());
}

mountHero();
mountManifesto();
mountLooks();
mountTemps();
mountPreuve();
mountCasting();
mountSeance();
mountLieu();
mountFaq();
mountPersonal();
mountChrome();
startLive();
paintCatalogue();
onChange(paintCatalogue);
reveal();
smoothAnchors(0);
bootBooking();
mountVersions('film');
