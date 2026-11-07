# Le Ticket — « Ton ticket s’imprime. »

**The idea (four words):** *Ton ticket s’imprime.*
**One sentence:** the whole site is one ticket being printed for you, line by line (where, open, how much, how soon, with whom), booking is building that ticket with the total always on its last line, and the confirmation is the same paper torn off and stamped RÉSERVÉ in red.

**How the seed was twisted.** The seed offered a receipt as an *object*; I kept it as a *discipline*. The ticket is a width (one column of paper, 80 mm, at every screen size), a grammar (label … dot leaders … amount, right-aligned, tabular) and a rhythm (lines print in order). It is never a texture, never a monospace costume, and never skeuomorphic: no curl, no shadow, no thermal grain. The photographs do not go *on* the ticket; they are the counter the ticket lies on, and each one is a gap between two segments of paper. The printer is one typeface in three widths. The departures-board risk is avoided by refusing every screen cue: no glow, no flipping, no live colour except one green dot; paper, ink, one red.

## The insight (why this shop)

Barber L’Architecte already talks like a ticket. Its two most honest objects are the price list (« Les prix, sans surprise. ») and the confirmation ticket with its SMS word for word; the Comptoir prints tickets at the till and stamps a loyalty card (« Carte 5/9 »). The shop’s whole promise, « on construit ta coupe au millimètre, pour qu’elle tienne », is a promise of *precision you can read*: a price that does not grow at the till, a slot that is really held, a barber named in words. A ticket is the form of a promise kept in figures. And the name gives the stamp: an architect’s drawing is approved with a stencil stamp, so RÉSERVÉ in Allerta Stencil is « Bon pour exécution » for a haircut.

**Ownability test.** Cover the name: the stencil stamp and « au millimètre » only make sense for a shop called L’Architecte. Swap Marseille for Lyon: the stub reads « 16, place Pélabon, 13e », the real place, on every ticket. Swap barbers for dentists: a dentist cannot print « Reviens dans 28 jours » as both a joke and a truth about a fade.

## What it is not

- Not a retro receipt, not a skeuomorph, not a « vintage » barbershop.
- Not a departures board, not a command bar, not a timeline (the earlier round).
- Not a monospace costume: Archivo, not Courier.
- Not a joke site: one dry line at the very end, calm plain language on every rule.

## The one real risk

**The ticket stays 420 px wide on a desktop.** The rest of a 1440 px screen is the dark counter and one photograph with its own caption strip. Nothing stretches, nothing becomes a grid of cards. A client on a laptop will see a narrow column of paper and may read it as « a phone site ». I take that risk because the moment the ticket widens it stops being a ticket, and everything around it is kept quiet so that the column is the only loud thing.

## Identity

### Palette (paper, ink, one red)

| Token | Hex | Why |
|---|---|---|
| `--papier` | `#F3F2ED` | A cool paper white, deliberately not a cream (the banned cream + serif + terracotta is avoided by temperature). |
| `--papier-2` | `#E7E6DF` | The tray under the booking choices: paper on paper, no borders needed. |
| `--encre` | `#17160F` | Full ink, with a touch of brown so black type does not look like a screen. |
| `--encre-2` | `#5B5951` | Light ink for mentions; 6,3:1 on paper, so it can be used freely at 14 px. |
| `--rouge` | `#C8161D` | Stamp ink. It comes from the red piping of the shop’s own sofas and the LED under the mirror, cooled from the current LED red (`#EB4639`) so it reads as print. 5,2:1 on paper, 5,9:1 under white. Used only for the stamp, the deposit line and the main button. |
| `--comptoir` | `#141311` | The counter the ticket lies on: the page background on desktop, the gaps between segments on a phone. |
| green dot | `#2E7D4F` | One use: « Ouvert ». |

What I keep from today: the red (as stamp ink, justified above) and the paper-and-ink restraint. What I drop: the serif voice (Instrument Serif) and the halftone dissolve; the ticket’s own double-width mode replaces the serif as the voice, and the printer’s line-by-line reveal replaces the halftone.

### Type pairing

- **Archivo (variable, width 62 → 125)**: the printer. One grotesque drawn for newsprint with a real width axis, used as a receipt printer uses its modes: condensed caps (wdth 70, 600) for labels — OÙ, AVEC, TOTAL; normal (wdth 100) for the lines; double-width heavy (wdth 112, 800) for headlines and figures. Tabular figures everywhere so prices stack. Not Inter, not Space Grotesk; and not a monospace, because the ticket is an idea, not a costume.
- **Allerta Stencil**: the stamp and the wordmark only, two sizes, never text. The architect’s approval stamp made literal.
- Fallbacks: Archivo → Archivo Narrow, Helvetica Neue, Arial · Allerta Stencil → Stencil, Impact. Self-hosted in the build; two files, about 90 kB.

### Imagery treatment

The four photographs, in ink: grayscale with a touch more contrast, never duotoned red, never cropped to a mood. They are never behind text: the paper is between. Each photograph is a full-bleed gap between two segments of the ticket, and the next segment’s first line is its caption with a price (« Dégradé bas, raie tracée … 25 € · Je veux cette coupe »). Sequence on the home: fade (hero, under the ticket head), sidepart, curls (« Sorti du fauteuil »), salon (behind the stub, « 16, place Pélabon »). No portraits exist, so the barbers are initials in a stamp square.

### Shape language

Straight paper edges with punched quarter-circle notches at the corners of every segment (one CSS mask); dashed perforations; dot leaders; 2 px rules; 2 px radii at most. Buttons are flat ink outlines on paper, or flat red; no shadows, no gradients, no pills. The stamp is the only element allowed to rotate.

## The home: one ticket in nine segments

| # | Segment | What it prints | Why in that order |
|---|---|---|---|
| 00 | En-tête | L’ARCHITECTE · Barber · 16 place Pélabon · Marseille 13e · ● Ouvert · jusqu’à 18 h 30 | Name, place and state are static HTML (R5) |
| 01 | Prends place. | Où · Prochain créneau (double-width) · Coupe dès 20 € · 30 min · Barbe dès 15 € · 5,0 · 316 avis · [Appeler 04 91 00 00 00] [Itinéraire] · **Réserver · dès 15 €** · « Sans rendez-vous, on te prend tout de suite · Sans compte » | The seven street questions, in one viewport, for Yanis (R1) |
| 02 | Sorti du fauteuil. | Three photographs as gaps; each captioned on the next line with the cut, the price, the time and « Je veux cette coupe » (deep link) | Proof of work with a price on every picture |
| 03 | Avec qui ? | Sans préférence · Le plus tôt (first), then JKut, Frank, Le Soldat, Esteban: initials, bio, next free slot | Four barbers are four lines; « Le premier libre » is a normal answer |
| 04 | Les prix, sans surprise. | The carte as a price list, three categories, every line name … price · time, « includes » in light ink below | The ticket’s native form; nothing hidden in tabs |
| 05 | Ne nous crois pas sur parole. | 5,0 · 316 avis Google · ce qui revient : l’accueil, le professionnalisme, l’hygiène, les produits, l’ambiance, le suivi · Lire les avis | Trust as a printed line |
| 06 | Ta coupe, chaque mois. | Carnet 5 coupes 80 € (16 € la coupe, 10 semaines) drawn as the stamp card ▢▢▢▢▢ · Hebdo 80 €/mois · Sans engagement · résiliable en 3 clics | The stamp card is the shop’s own object |
| 07 | Tu te demandes ? | Eight questions as lines that open | Gérard reads before he taps |
| 08 | Le talon | Perforation · 16, place Pélabon · mar.–sam. 9 h – 18 h 30 · 04 91 00 00 00 · Itinéraire · Instagram · Facebook · YouTube · Écrire au salon · Carte cadeau · Formations · Mon espace · « Merci de ta visite. Reviens dans 28 jours. » | The tear-off stub holds the address and the phone: the way there is the last thing in hand |

The gift card, training, member and 404 pages are shorter tickets on the same counter (a 404 is a ticket with one line: « Rien à ce nom. Le salon, lui, est bien 16 place Pélabon. »).

## The booking

**Shape:** a page, not a bottom sheet. The route `?reserver` is pushed on history; the choices sit on the grey tray at the top; the paper is pinned at the foot (sticky, never more than a quarter of the screen: on a 568 px screen it keeps only the service line and the total). Four questions in the sheet’s own words: « On te fait quoi ? » · « Avec qui ? » · « Quand ? » · « À ton nom ». Choosing advances by itself.

**Signature interaction: « la ligne s’imprime ».** Every choice prints one more line onto the paper at the foot: label, dot leaders, amount, from left to right in 420 ms; the total is always the last line before the button, so the price is in the footer at every step by construction, not by habit. A service from 50 € prints an extra line in red, « Acompte maintenant … 15 € », and the plain sentence appears before the button. A deep link pre-prints the lines (codes `cl`, `tr` and readable names `coupe-classique`, `frank`). Press « Réserver » and the stamp comes down.

Protected behaviours kept: the price in the button (« Réserver · dès 15 € », « Reprendre · 25 € », « Réserver et régler l’acompte · 15 € »); « Sans préférence · Le plus tôt » first; the held slot with its visible timer (« Créneau gardé pour toi · 4:51 »), above the form, never under a keyboard; « Comme la dernière fois ? » as a pre-printed ticket with one « Reprendre » button; offline keeps what was typed on the paper; the sheet resumes where it was left because the lines are already printed.

## The confirmation

The same paper, torn off: the stencil stamp RÉSERVÉ with the code (LA-BXUF), « C’est réservé, Julien. », then the nine things as lines: **Quand** mercredi 28 octobre · 9 h (double-width) · **Avec** Frank · Coupe classique · 30 min … 20 € · **Où** 16, place Pélabon, 13013 Marseille · À régler au salon … 20 € · the SMS word for word in a box · Agenda (.ics) · Itinéraire · Déplacer · Annuler. Then « Quelqu’un d’autre à la suite ? … 9 h 30 avec Frank » and « Ajouter une personne », which staples a second ticket under the first on the same phone number (R6). Under a perforation, the stub: « Carte fidélité 5 / 9 » with its nine squares, « Si besoin … 04 91 00 00 00 », and « Garde ce ticket. On ne te le redemandera pas. »

## Motion

- **What moves:** lines print (a clip-path reveal, 420 ms, staggered 120 ms); the stamp slams (scale 1.9 → 1, 220 ms, rotated −8°); the cursor on the line being chosen blinks. Nothing loops except the cursor.
- **Why:** the printer’s rhythm is the concept’s only animation and it carries information (what was just added).
- **Reduced motion:** no print reveal, no slam, no blink; everything is simply present. Nothing is ever hidden behind motion.

## Six lines (tu)

1. **Prends place.** — head of the ticket.
2. **Les prix, sans surprise.** — the carte, unchanged: it is already a ticket’s promise.
3. **Ton ticket s’imprime.** — the booking page’s title while a deep link pre-prints the lines.
4. **Réservé. À mercredi, Julien.** — under the stamp.
5. **Quelqu’un d’autre à la suite ?** — the second-person line, with the next slot already printed.
6. **Merci de ta visite. Reviens dans 28 jours.** — last line of the stub; the one joke, and it is true of a fade.

## R1–R10, one honest line each

- **R1** The seven answers are the seven lines of the ticket head (où, ouvert, prochain créneau, coupe dès 20 €, 5,0 · 316 avis, Appeler, Itinéraire) above « Réserver · dès 15 € »; the board shows it fits at 390 and at 320.
- **R2** The booking is a route pushed on history: Back and Esc tear the page off, focus returns to « Réserver »; links accept `cl` and `coupe-classique`, `jkut` and `JKut`.
- **R3** No fixed UI on the home; in the booking the sticky paper foot is ≤ 25 % (service + total only at 568 px); every target ≥ 48 px, money buttons 56 px; the board audit finds nothing under 44 px at 320.
- **R4** « Appeler · 04 91 00 00 00 » is a 48 px button on the first screen, a line on the stub, and « Si besoin » on the confirmation.
- **R5** The ticket head is static HTML; the printer only reveals, never injects; without JS the page is a complete ticket and the booking is a form that posts.
- **R6** « Quelqu’un d’autre à la suite ? » prints the next slot with the same barber; « Ajouter une personne » staples a second ticket to the same number.
- **R7** The nine things are the lines of the stamped ticket; the deposit is one red line and one plain sentence (amount, reason, refund) before « Réserver et régler l’acompte ».
- **R8** The hold has its own line and timer; on expiry it reads « Le créneau n’est plus gardé · on regarde s’il est encore libre » and the printed choices stay; « vient d’être pris » is reserved for a real collision.
- **R9** Text is never on a photograph (the paper is between); smallest text 14 px; light ink 6,3:1, red 5,2:1; reduced motion removes every animation. The audit passes all lines at three viewports.
- **R10** First paint is text on paper with the photograph loading behind; two self-hosted font files; the map is a link, not an embed; zero third-party requests (the board’s Google Fonts link is the lab’s only exception, replaced in the build).

## What it protects

« Réserver · dès 15 € » · the live next slot in double-width on the first screen · « Sans préférence · Le plus tôt » first · the held slot with its timer · « Comme la dernière fois ? » with one « Reprendre » · the confirmation ticket and its nine things · the deposit line said once before the button · the offline message that keeps what was printed · the booking that resumes (the lines are still there) · « Les prix, sans surprise. » · no account · no third party, self-hosted fonts.

## Who it serves best and worst

- **Best:** Le Nouveau (Yanis): price, place and slot readable in five seconds, no vocabulary needed, a photo with a price on it. Le Pressé (Julien): five taps and the total never leaves the screen. L’Ancien (Gérard): big figures, words not icons, the phone on the first screen and on the stub, nothing moving under reduced motion. L’Accueil (Lina): the ticket the client holds matches the ticket the till prints.
- **Worst:** Le Passionné (Mehdi): a ticket is a poor gallery; three photographs with prices will not feed someone who came for the Instagram feed, and the site sends him there. L’Occasion (Théo) is served on the deposit but gets no mood-board for a Silver. The desktop visitor in general, by the risk above.

## Risks and what we would cut

- The narrow desktop column (the stated risk): if it tests badly we widen the counter, not the paper: a second photograph and the carte on the left, the ticket on the right.
- The stamp could tip into kitsch: it is used exactly twice (confirmation, loyalty card) and never animated more than once; if it still reads as a joke, it becomes a flat red word with a rule above and below.
- The dry humour on the stub: one line; cut first if anyone on the panel winces.
- The print animation on a slow phone: it is a clip-path on a list and costs nothing; if it ever delays content, it is removed and the lines are simply there.

## Build plan (components, days)

| Component | Days |
|---|---|
| Tokens, two fonts self-hosted, the `.paper` segment with notch mask, perforation, `.line` grammar with dot leaders and tabular figures | 1 |
| Home as nine segments on the counter, photographs as gaps, desktop counter layout | 2 |
| Booking page as a route (history, Esc, focus, deep links with names), tray + sticky paper foot, the printing line, held-slot timer, deposit line, offline keep | 3 |
| Confirmation ticket with stamp, nine things, SMS, .ics, second person, stub with loyalty card; « Comme la dernière fois ? » | 1,5 |
| Gift card, training, member and 404 pages as short tickets | 1 |
| Reduced motion, no-JS form, contrast and target pass, harness run against the thirteen | 1,5 |
| **Total** | **10 days** |

What I would simplify when built: the printer animation is one keyframe on a list; the notches are one mask utility; the desktop keeps the 420 px column and gains nothing else; the board’s live demo becomes the real booking foot, unchanged in shape.
