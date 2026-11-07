// The tensions: where two good things pull against each other.
//
// A critique that only lists defects is half a job. Most of the interesting decisions in a shop like this are between two things
// the shop is right to want: a bold first screen and a stranger’s four questions, a held slot that builds trust for the hurried
// and a timer that frightens the slow. Each tension names its two sides, the checks that make it visible in a run, and the
// Cabinet’s default ruling: a recommendation for the owner to take or leave, never a verdict.
//
// `checks` are check ids; the dossier shows their live status beside each tension and says so when a check was not measured.

/** @typedef {{ id: string, fr: string, en: string, sides: [string, string], story: string, checks: string[], ruling: string, ownerDecision: boolean }} Tension */

/** @type {Tension[]} */
export const TENSIONS = [
  {
    id: 'T-01', fr: 'La vitrine ou la porte', en: 'The shopfront or the door', ownerDecision: false,
    sides: ['A bold, minimal first screen: the halftone « Frais. », one photograph, nothing else', 'A stranger at the door who needs three facts that are not on it: open now, a number, the way in'],
    story: 'The hero is the best thing on the site and it earns the shop its character. It also leaves the questions a person standing in the square asks (open? walk-in? how do I get there?) a scroll away, in the footer.',
    checks: ['rue.q.open', 'rue.q.call', 'rue.q.route'],
    ruling: 'Usability gets the slot that already exists for it, not the hero: the hero’s status notice (the one used for closures) can carry « Ouvert jusqu’à 18 h 30 · sans rendez-vous ». The wordmark and the photograph stay exactly as they are.'
  },
  {
    id: 'T-02', fr: 'Trois pastilles', en: 'Three pills', ownerDecision: false,
    sides: ['A first screen rich in live cues: a guide bubble, the next slot, the booking button', 'A short phone where they stack on top of each other'],
    story: 'On a 390×844 phone the three float without touching. On a 320×568 phone the booking button sits on the « Prochain créneau » pill, hiding the most persuasive thing on the screen.',
    checks: ['pouce.cover.phone', 'pouce.cover.phone-small', 'pouce.cover.phone-tiny', 'pouce.overlap.phone', 'pouce.overlap.phone-small', 'pouce.overlap.phone-tiny'],
    ruling: 'Below about 600 px of height, fold the next-slot pill into the booking button’s tray (« Réserver · Aujourd’hui 16 h »), or let the guide bubble leave after one view.'
  },
  {
    id: 'T-03', fr: 'Le tutoiement', en: 'Tu', ownerDecision: true,
    sides: ['The shop’s voice: warm, direct, Marseille, « tu » to everyone', 'The person who expects « vous »: L’Ancien, a parent, a trainee’s mother'],
    story: 'Nothing in the site is wrong: « Choisis ton créneau », « Prends place. » are the shop. But a sentence that reads as warm to a 22-year-old reads as familiar to a 67-year-old, and the confirmation, the deposit and the cancellation are the places it matters.',
    checks: [],
    ruling: 'Keep « tu »: it is the identity. Hold every sentence that carries a rule (deposit, cancellation, membership) to a calm, plain register that works for both, with no slang and no joke. This is for the owner to decide; the panel’s content designer reads for it.'
  },
  {
    id: 'T-04', fr: 'Le compte à rebours', en: 'The countdown', ownerDecision: false,
    sides: ['A held slot with a visible timer (5:00): trust for the hurried', 'A timer that rushes the slow, and a closed sheet that forgets the interrupted'],
    story: 'The hold is the reason a person can type without losing the slot, and it is shown honestly. It is also a limit, and WCAG 2.2.1 asks that a limit can be extended.',
    checks: ['ancien.timers', 'tram.interrupt', 'tram.impatient'],
    ruling: 'Keep the timer visible and honest. Add a single « Besoin de plus de temps ? » that renews the hold once, and make the booking request wait for the hold instead of racing it.'
  },
  {
    id: 'T-05', fr: 'L’acompte', en: 'The deposit', ownerDecision: false,
    sides: ['Protecting the chair: the owner’s margin on a long, dear service', 'The friction a deposit puts in front of a nervous first-timer'],
    story: 'The deposit is explained once, in words, before the button, with the refund rule beside it, and the button says what it does. That is the right answer to this tension, and it is easy to break.',
    checks: ['chrono.occasion.deposit', 'chrono.occasion.honest-button', 'chrono.occasion.pay-step'],
    ruling: 'Protect the current treatment as it is. If it ever changes, change the wording and never the order: amount, reason, refund rule, then the button.'
  },
  {
    id: 'T-06', fr: 'La mise en scène ou la lenteur', en: 'Stagecraft or speed', ownerDecision: false,
    sides: ['Motion, halftone, a heroic first screen: the craft the Passionné came for', 'A weak signal, a mid-range phone, a reduced-motion setting'],
    story: 'The page paints its first real content late on a weak signal because it is built in the browser; and its reveals must still show up when the animations are switched off.',
    checks: ['rue.first-paint', 'rue.weight', 'atelier.motion-cost', 'nuit.reduced-motion', 'nuit.reveal-visible', 'atelier.no-js'],
    ruling: 'Drama is a layer on top of a page that already works: the name, the address, the hours and a way to book should exist in the HTML before the first script runs, and stay when motion is off.'
  },
  {
    id: 'T-07', fr: 'Un client par réservation', en: 'One person per booking', ownerDecision: true,
    sides: ['Five taps for the hurried: the single-person path is the product’s strength', 'A parent who is two or three clients at once'],
    story: 'Adding a party-size step would put a question in front of everyone to serve the few. The confirmation is the place where it costs nobody anything.',
    checks: ['duo.capability', 'chrono.presse.taps'],
    ruling: 'Offer « Réserver pour quelqu’un d’autre » on the confirmation, reopening the sheet at the barber step with the first slot’s end as the earliest time. The five-tap path stays untouched.'
  },
  {
    id: 'T-08', fr: 'Dense au comptoir, large au fauteuil', en: 'Dense at the desk, large at the chair', ownerDecision: false,
    sides: ['An owner’s screen that packs a month into one view', 'A barber and a desk whose hands are full, wet or in a hurry'],
    story: 'The Comptoir is already large where it matters most (the PIN keypad, the two status buttons). The secondary controls beside the money are 34 px.',
    checks: ['mains.till.secondary', 'mains.barber.targets', 'mains.agenda.targets', 'mains.till.targets'],
    ruling: 'Size by role, not by screen: the surfaces the barber and the desk touch take 44 px as a floor and 48 px where money is involved; the owner’s analysis screens may stay dense.'
  },
  {
    id: 'T-09', fr: 'La porte du téléphone', en: 'The phone door', ownerDecision: true,
    sides: ['A shop that deliberately takes bookings online so that hands stay on the clippers', 'A client who would rather hear a voice, and a number that exists but cannot be tapped'],
    story: 'The salon’s number is configured and used in search results and in an error message, but nowhere a person can tap it.',
    checks: ['ancien.phone', 'rue.q.call'],
    ruling: 'A decision for the owner, not a design one: publish the number (menu foot and footer), or say in one plain line why not and what to do instead, with the writing address beside it.'
  },
  {
    id: 'T-10', fr: 'La vitrine claire', en: 'A bright shopfront in the dark', ownerDecision: true,
    sides: ['A light, photographic first screen that is the brand', 'A phone in dark mode at 23:12'],
    story: 'The hero is light in both schemes by design. In a dark room it is the brightest thing in the person’s world.',
    checks: ['nuit.dark-first', 'nuit.contrast'],
    ruling: 'Not a defect. If the brand wants to honour the dark scheme without losing the photograph, a darker veil on the grey ground is the smallest change that brings the first screen down.'
  }
];
