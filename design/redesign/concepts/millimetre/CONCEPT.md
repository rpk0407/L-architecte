# Au millimètre

**The idea (three words): « Tout est mesuré. »** The shop says « on construit ta coupe au millimètre »; the site takes it literally: six lengths (0 · 0,5 · 1 · 3 · 6 · 12 mm) give the sections their numbers, the photographs their six grey levels, and one variable typeface its six weights, so the type grows like hair, from a hairline at 0 mm to black at 12 mm.

## The insight (why this shop)

JKut is « le fondateur de la méthode *construction au millimètre* ». The phrase is the shop's, it is on the live site, and no concept has used it. A fade *is* a gradient of lengths in millimetres; the client file at the Comptoir already carries « sabot 0,5 ». The millimetre is the one unit that is this shop's, that is the barber's, and that a stranger understands on sight. Swap Marseille for Lyon: the measure still belongs to JKut's method and to place Pélabon in the copy. Swap barbers for dentists: nothing is measured in millimetres a client can see. It does not survive the swaps, so it is ownable.

## How the seed was twisted

The seed asked for weight driven by scroll and a ruler along the edge. Scroll-driven weight costs legibility (a title passing through weight 100 while being read) and is a gimmick. Here the weight is **fixed per section by what it measures**: the number of section 0 is a hairline, 12 is black; read top to bottom, the home is a fade. The only moving weight is in one word on the first screen, set letter by letter from 100 to 900 (the risk), and in the signature control. The ruler is one line in the left gutter on desktop, with ticks only where the sections are: a *cote*, not wallpaper. The visitor's hand is in one place only: **le sabot**, an optional fifth line of the booking.

## What it is not

Not a drawing board (L'Atelier), not a film timeline (Le Film), not a diagnostic or a quiz, not a departures board. Not a ruler-as-texture, not a tech-spec aesthetic with monospace everywhere, not a black-and-red barbershop. Nothing decorative: every element is a measure, a price, an hour or a name, or it is deleted.

## The one risk, said out loud

The hero word « millimètre » is set as a fade of weights, one letter per level. A viewer may read it as a rendering error for half a second. Everything else on the page is calm (one typeface for measures, one for voice, one line of colour) so that it reads as intention. If testing shows it reads as a bug, the fallback is already in the board: the six fixed weights on the section numbers carry the idea on their own.

## Identity

### Palette (hex and why)

| Token | Hex | Why |
|---|---|---|
| papier | `#F2F1EC` | The grey-green wall of `fade.jpg`, bleached. Neutral and cool, not cream. |
| 0 mm | `#E9E8E3` | The six levels are the six grey steps the posterised fade produces; they are the only greys the site uses. |
| 0,5 mm | `#CFCEC7` | Lines, inactive borders. |
| 1 mm | `#A9A8A1` | Ruler, disabled. |
| 3 mm | `#777670` | Decorative only (fails AA for small text; never used as text). |
| 6 mm | `#44433F` | Secondary surfaces in dark mode. |
| 12 mm · encre | `#161614` | Text, buttons. 16:1 on papier. |
| second (text) | `#5E5D58` | The one grey allowed for small text: 6:1 on papier. |
| LED | `#E2231A` | The red LED line along the salon's mirror. **A line, never a fill, never text** (it fails AA as text): the zero mark of the ruler, the held-slot timer, the focus ring. This is what remains of today's red, and why. |

Dark mode inverts the levels (papier becomes `#141413`, encre `#EDECE7`); the LED line stays.

### Type pairing

- **Anybody** (Etcetera Type; Google Fonts; `@fontsource-variable/anybody`, 5.3.0 on npm) for everything that is measured: section numbers, headlines, prices, hours, buttons, the wordmark. Two axes, weight 100→900 and width 50→150. The six weights of the site are six points on these axes (0 mm = wdth 70 / wght 100 … 12 mm = wdth 125 / wght 900). One file does all the display work. Fallbacks: Archivo Narrow, Helvetica Neue, Arial.
- **Fraunces** (Undercase Type; `@fontsource-variable/fraunces`) for the voice: paragraphs, the SMS, the rules. Its optical-size axis (9→144) means the letter knows what size it is printed at, which is, also, a measure. Used at opsz 12–18, weight 400, never as a display face, so this is not cream-serif-terracotta. Fallback: Georgia.
- Numbers tabular; prices « 20 € » and hours « 9 h 30 » with no-break spaces.

### Imagery

All four photographs become **black and white posterised in six levels** by an inline SVG filter (`feComponentTransfer` discrete), not by a file: the fade reads as a contour map of lengths. Crops hold the fade itself (`fade.jpg` at 62 % / 30 %), the curls and side part for the sections 0,5 and 1, the salon for Venir. No text is ever placed on a photograph; the two cotes « 0 mm » / « 12 mm » sit on paper chips with a leader line.

### Shape language

Corners at 1,5 mm, 1 px rules, no shadows, no glass. **Every spacing token is a length in CSS millimetres** (`--m2: 2mm` … `--m24: 24mm`; body text 4,5 mm). Honest note: a CSS millimetre is 3,78 px, not a physical millimetre on most screens; the unit is a discipline for tokens, not a promise of a ruler.

## The home, section by section

| mm | Section | What it says, and why here |
|---|---|---|
| **0** | La porte | The first screen. Name and « place Pélabon · Marseille 13e »; « Ouvert · jusqu'à 18 h 30 · sans rendez-vous »; the headline; « 5,0 · 316 avis Google »; « Prochain créneau · Aujourd'hui 16 h »; « Réserver · dès 15 € »; « Appeler · 04 91 00 00 00 » and « Itinéraire » side by side; then the posterised fade. The stranger reads where, open, price, soon, good, phone, directions, in that order, before any picture. |
| **0,5** | La méthode | The site's own paragraph (« Ici, on prend le temps… au millimètre, pour qu'elle tienne ») and one photograph. Nothing else: the method is the argument. |
| **1** | Le travail | « Sorti du fauteuil. » The three cuts with their written cotes (« Dégradé bas, raie tracée », « Boucles et barbe », « Dégradé à blanc, décoloré »); « Je veux cette coupe » opens the fiche with the service set. |
| **3** | L'équipe | « Choisis ton barbier. » Initials in Anybody, one line of bio each, « Le premier libre » first, « Touche un nom pour voir ses prochains créneaux ». |
| **6** | La carte | « Les prix, sans surprise. » A tabular table: service · what is included · time · price, in the three tabs; carnet 80 € and Hebdo 80 €/mois, « sans engagement »; then the eight short questions. |
| **12** | Venir | « 16, place Pélabon. » Hours in words, Appeler, Itinéraire, Instagram, YouTube, « Écrire au salon », carte cadeau, formations, résilier. Full black: the heaviest section carries everything that must be findable. |

The returning client skips all of it: « Comme la dernière fois ? » is offered at the button.

## The booking: la fiche

When the unit is the millimetre, the booking is a **fiche technique**: four lines, Quoi · Qui · Quand · Toi, shown as a vertical cote with a dot per line (done = ink, current = LED ring), plus an optional fifth, measured line. On a phone it is a full page; on desktop a right-hand column next to the home. It is a route (`?reserver&barbier=jkut&prestation=cl`, and readable names `barbier=JKut&prestation=coupe-classique`): Back closes it, Esc closes it, focus returns to the button that opened it, and it resumes where it was left.

It keeps: the price in every button (« Continuer » next to « 20 € · Coupe classique · Sans préférence »), « Sans préférence · Le plus tôt » as the first card, the held slot as a thin LED line that shortens over five minutes with the minutes written next to it (no shouting countdown), the offline line that keeps what was typed, and « Comme la dernière fois ? » which now also brings back the barber's measure.

### The signature interaction: le sabot

The fifth line asks **« Les côtés, à combien ? »** A slider with six detents in millimetres (0 · 0,5 · 1 · 3 · 6 · 12). As it moves, the number grows like hair (Anybody from wdth 60 / wght 100 to wdth 128 / wght 900, 450 ms), a sentence says what that length is in plain words (« Trois millimètres. Le fondu, là où l'œil ne voit plus la marche. »), the posterised photo shows more levels, and the answer writes itself into « Un mot pour ton barbier » as « côtés 0,5 mm », which the client can complete. Default: « Le barbier décide ». It is optional, so Le Pressé never sees friction; it teaches vocabulary without a glossary, so Le Nouveau never feels stupid; and it lands in the client's technical note at the Comptoir (where « sabot 0,5 » already lives), so next time « Comme la dernière fois ? » returns the measure. It is live on the board.

### Money before the button

« Un acompte de 15 € est demandé pour cette prestation, déduit au salon. Annulé plus de 12 h avant, il est remboursé. » then « Réserver et régler l'acompte · 50 € », 52 px tall.

## The confirmation

« C'est réservé, Julien. » then the fiche becomes a **ticket coté**: the day and hour in words at the maximum weight (« mercredi 28 octobre · 9 h »), then the cut and price, the barber, the address, four actions in a 2×2 grid (Agenda (.ics), Itinéraire, Déplacer, Annuler), the SMS word for word, « Garde tout au même endroit » below and marked « Facultatif : ton rendez-vous est déjà confirmé », and at the foot **« Un deuxième, à la suite ? · Même jour, créneau suivant · Ajouter »**, which opens the fiche at the line Toi with day, barber and the next slot already set. The booking code lives in the status line, not in the headline.

## Motion

What moves: the sabot's number (font-variation-settings, 450 ms, one easing), the LED line of the held slot (linear, five minutes), and nothing else. No reveals, no parallax, no loop. With `prefers-reduced-motion`: the number jumps from detent to detent, the LED line is static and the minutes are written, nothing is hidden behind an animation.

## Six lines (tu)

1. « Ta coupe, au millimètre. »
2. « Les côtés, à combien ? »
3. « Le barbier décide. »
4. « Un deuxième, à la suite ? »
5. « Gardé 5 minutes. Pas pris. »
6. « Ça tient. Reviens quand ça lâche. »

## R1–R10, one honest line each

- **R1** Yes: the seven answers are above the fold in words, before the photograph, at 390 and at 320.
- **R2** Yes by design: the fiche is a route with a history entry; Back and Esc close it; readable names and codes both resolve. To be proven in the build, not on a board.
- **R3** Yes: nothing fixed except the fiche's foot (≤ 15 %); all targets ≥ 44 px, ≥ 52 px where money is; the board itself passes at 320×568.
- **R4** Yes: « Appeler · 04 91 00 00 00 » as `tel:` on the first screen and in Venir.
- **R5** Yes: name, address, hours, phone and a « Réserver » link to the fiche's route in the served HTML; the posterisation is an inline SVG filter, so the first paint needs no script.
- **R6** Yes: « Un deuxième, à la suite ? » on the ticket, same day, next slot, one first name to type.
- **R7** Yes: nine things on the ticket; the deposit said once, in words, before « Réserver et régler l'acompte ».
- **R8** Yes: the held slot says « Créneau gardé pour toi · 4 min 52 »; « vient d'être pris » exists only when the server says so at confirmation.
- **R9** Yes, with one thing to hold: no text on photographs; secondary grey at 6:1; the audit finds 0 lines below AA and nothing under 14 px; the hairline weight (0 mm) is reserved for large sizes (≥ 34 px). If the letter-fade hero fails a contrast check on a low-end screen, the hero falls back to a single weight.
- **R10** Yes: zero third-party requests in production (two self-hosted variable fonts, two files; no extra image for the posterised photos; the board uses Google Fonts by `<link>` only because the brief says so).

## What it protects

« Réserver · dès 15 € » · the live next slot on the first screen · « Sans préférence · Le plus tôt » first · the held slot and its visible (quiet) timer · « Comme la dernière fois ? », now with the measure · the ticket's nine things · the deposit line before the button · the offline message that keeps what was typed · the fiche that resumes · « Les prix, sans surprise. » · no account · no third-party requests, self-hosted fonts.

## Who it serves best and worst

**Best:** Le Passionné (Mehdi, 19: he speaks in millimetres and will send the fiche link with « côtés 0,5 mm » to his friends), Le Nouveau (Yanis, 22: the price, the place and the phone before anything; a way to say the cut without the vocabulary), Le Fidèle (Sofiane, 34: his measure comes back by itself). **Worst:** L'Ancien (Gérard, 67: a hairline number and a slider are not for him; what saves him is that the hairline is only ever large, every control has a word, the phone is a button, and the sabot is optional with « Le barbier décide » as the default) and Le Cadeau (Camille, 31: the millimetre says nothing to someone buying for her father; the gift-card page should lead with the price and the names, not the measure).

## Risks and what we would cut

- The letter-fade hero reads as a bug → cut to one weight; the section numbers keep the idea.
- Anybody's hairline is invisible on a dim phone → raise 0 mm to weight 200 and say so in the tokens.
- The sabot is used by nobody → keep the six detents as the only cost (one input, forty lines); it still writes the note.
- CSS millimetres confuse a developer → keep the tokens' names (`--m3`) and document that 1 mm = 3,78 px.
- Posterised photographs lose the platinum hair → keep six levels, never fewer, and allow the colour photograph on the Travail section if the owner asks.

## Build plan (components and days)

| Component | Days |
|---|---|
| Tokens (mm scale, six levels, LED), two self-hosted variable fonts, dark mode | 1 |
| Home: six sections, posterising filter, first screen in static HTML | 2 |
| La fiche: route, history, four lines as a cote, « Le plus tôt », held-slot line, offline, resume, deep links with readable names | 3 |
| Le sabot: six-detent input, note writing, Comptoir note round-trip | 1 |
| Ticket: nine things, deposit line, « Un deuxième, à la suite ? » | 1,5 |
| Pages around: carte cadeau, formations, membre, résilier, 404 in the same language | 1,5 |
| Harness pass: R1–R10 checks, thirteen personas, fixes | 2 |
| **Total** | **12 days** |

What we would simplify when built: the per-letter weights become one class on one word; the desktop-frame scaling and the demo's seven filters go; the ruler is a single CSS pseudo-element.
