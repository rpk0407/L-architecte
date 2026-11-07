# The redesign brief

## The job

**At least two genuinely different alternative redesigns of the public website** of Barber L’Architecte, each a complete point of view and not a re-skin: the home, the booking, the confirmation, and the look of the pages around them (gift card, training, member pages, 404). They run on the **real booking API**, so they can be tested against the same thirteen people as the current site. The owner chooses one, or mixes them.

The standard is a real senior studio at its best: a concept you could say in four words, an identity that could only be this shop, and craft all the way down. **Nothing generic.**

## What the studio already knows

- The shop, its people, its prices, its voice: [`CONTENT.md`](CONTENT.md) (real, never invented) and [`../programme/00-shop.md`](../programme/00-shop.md).
- The thirteen people who use it and what each decides: [`../programme/01-personas.md`](../programme/01-personas.md), the moments of truth, the tensions, the principles.
- What the current site gets right and wrong, measured: `.lx-data/ux/baseline/` (run `npm run ux` to refresh) and the dossier in [`../programme/06-anti-patterns.md`](../programme/06-anti-patterns.md) (§3).
- What an earlier round already explored, and must **not** be repeated: **Le Film** (the visit as a film, scroll as the timeline, a cut that ages to « On recoupe ? »), **L’Atelier** (the architect’s drawing board: a diagnostic and a quote builder), **En direct** (the salon in real time: a command bar, a departures board). The current site is itself close to Le Film. Its code lives in PR #1 (`git fetch origin pull/1/head`), including a reusable **site kit** (a themable booking sheet, a typed API client, motion).

## What every redesign must solve (the measurable brief)

Each line is a finding of the harness; the check ids say how a built version will be judged.

| # | The redesign must… | Check |
|---|---|---|
| **R1** | Answer all seven street questions in the **first viewport** of a phone, within five seconds: where, open now / can I walk in, how much, can I come soon, is it any good, **can I phone**, **how do I get there** | `rue.q.*` |
| **R2** | Make the browser’s **Back** close the booking (not leave the site); keep deep links (`?reserver&barbier=…&prestation=…`, **readable names as well as codes**); Esc closes; focus moves in and back | `retour.*` |
| **R3** | Leave nothing tappable under anything else at **320×568**; every target ≥ 44 px (≥ 48 where money is); fixed UI ≤ 25% of the screen | `pouce.*` |
| **R4** | Offer a **tappable phone**, or say plainly in one line why not and what to do instead | `ancien.phone` |
| **R5** | Put the name, address, hours, phone and a way to book **in the HTML before any script runs** (no template source, no blank page) | `atelier.no-js` |
| **R6** | Let a parent book **a second person** from the confirmation | `duo.capability` |
| **R7** | Keep the confirmation’s nine things and the deposit said once, in words, before the button | `chrono.confirmation`, `chrono.occasion.*` |
| **R8** | Never say « Ce créneau vient d’être pris » about a slot that is only still being held | `tram.impatient` |
| **R9** | Meet AA contrast **including text over photographs**; almost no text under 14 px; with reduced motion nothing loops and nothing stays hidden | `ancien.*`, `nuit.*` |
| **R10** | Paint real content early on a weak signal; make **zero third-party requests**; self-host fonts | `rue.first-paint`, `privacy.third-party` |

## What we protect (never trade away)

« Réserver · dès 15 € » (the price in the main button) · the live **next slot** on the first screen · « **Sans préférence** · Le plus tôt » · the **held slot** with its visible timer · « **Comme la dernière fois ?** » · the **confirmation ticket** (day and hour in words, barber, address, the SMS word for word, calendar, directions, move, cancel) · the **deposit line** (amount, reason, refund rule, then the button) · the offline message that keeps what was typed · the sheet that resumes where it was left · **« Les prix, sans surprise. »** · no account needed · no third-party requests, self-hosted fonts.

## What is open, and what is not

**Open:** the whole identity (palette, type, shape, layout, imagery treatment, motion), the structure and order of the home, the names of the sections, the *shape* of the booking (sheet, page, inline, a new idea), the signature interaction, the photographs’ treatment.

**Not open:** the shop’s name and facts (address, hours, prices, bios), the **tutoiement** and the lexicon (`../programme/07-lexicon.fr.md`), the booking API and rules, the privacy stance, the four real photographs (art-direct them; do not pretend to have others: no portraits, hands, tools or street exist).

If you keep something of today’s identity (the red, the serif, the halftone), say **why**. If you drop it, say what replaces it.

## The anti-generic rules

1. **The ownability test.** Cover the name. Could this be any other barbershop? Swap Marseille for Lyon: does it still work? Swap barbers for dentists? If yes to any, it is not done.
2. **One idea, said everywhere.** Name the concept in four words or fewer and say what it is **not**. Every element must say something that serves the idea; an element that says nothing is deleted.
3. **Specific over tasteful.** Real units (millimetres, minutes, euros), the shop’s own words, the real place (place Pélabon, Marseille 13e), the real people (JKut, Frank, Le Soldat, Esteban), the real photographs. « Au millimètre » is the shop’s own phrase: it is a gift, and it is not yet used.
4. **One real aesthetic risk**, named out loud, with everything around it kept quiet. A page with five risks has none.
5. **Typography is where non-generic starts.** A pairing someone would remember, justified by the idea. Not the defaults of the last five years (Inter, Roboto, Poppins, Montserrat, Space Grotesk, a lone Playfair).
6. **Banned, because they are what everything looks like:** warm cream + serif display + terracotta; near-black with one acid-green or vermilion pop; purple-to-blue gradient hero; glass cards; three identical feature cards; emoji as icons; everything centred; the same radius and shadow on every block; a stock smile; and, from the trade, black-and-gold, crossed razors, skulls, a barber pole as decoration, « gentleman », « classic cuts ». (If the idea needs one of these, say so and why it is different here.)
7. **It must work as a product first:** R1–R10 are not decoration to add at the end; they shape the layout.

## The deliverable of this round: a concept, not a site

Per concept, in `design/redesign/concepts/<slug>/`:

- **`CONCEPT.md`**: the idea (≤ 4 words + one sentence) · the insight (why this shop) · what it is not · identity (palette with hex and rationale; type pairing and rationale; imagery treatment; shape language) · structure of the home (sections, order, what each says) · the booking (its shape and the signature interaction) · the confirmation · motion (what moves, why, what happens with reduced motion) · six headlines or lines in French (*tu*) · **how it answers R1–R10, one line each** · what it protects · who it serves best and worst among the thirteen · risks and what we would cut · a build plan in components and days.
- **`board.html`**: one self-contained page, mobile-first, that *shows* it: the first screen as a phone frame and as a desktop frame (real photographs from `../../../../public/img/`, real French copy), the booking moment, the confirmation ticket, the palette and the type specimen, one small **live** demonstration of the signature interaction, the voice samples, and the R1–R10 table. Fonts from Google Fonts by `<link>` (the build will self-host them). It must render cleanly at 390 and 1280 px: **screenshot it, look at the picture, fix what you see.**

## How concepts are judged

The owner decides. The harness measures the built versions on R1–R10 and on the thirteen personas. The panel critiques what the instruments cannot. A concept that is brilliant and fails R1 is a poster; a concept that passes everything and is generic is a template. We want neither.
