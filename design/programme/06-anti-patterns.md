# The anti-patterns

Three families of ways to get this wrong. The first two are the clichés the panel guards against; the third is the list of traps this particular product actually fell into (or nearly did) while it was being measured, each with the instrument that finds it. Add to the third whenever the field teaches something.

## 1 · The barbershop clichés

The look that says « barbershop » to a stock-photo library and « nobody in particular » to a client.

| Cliché | Why it fails here | How to see it |
|---|---|---|
| Black and gold, with a vintage flourish | The category’s uniform; says nothing about this place | panel (art director) |
| Crossed razors, scissors, skulls, a barber pole as decoration | Clip-art for a shop whose whole argument is its people | panel |
| Stock photography of other shops’ barbers | A stranger checks the photo before the price; a borrowed photo is a lie told in the first second | panel; the roster’s initials-instead-of-faces is the adjacent risk |
| « Classic cuts for the modern gentleman » | Copy that could be pasted into any site | panel (content designer) |
| A carousel hero that autoplays | Motion nobody asked for, a first frame nobody chose | `atelier.motion-loops`, `nuit.reduced-motion` |
| A PDF menu, or a menu in an image | Unreadable, unsearchable, unbookable | `chrono.nouveau.prices` |
| « Book now » with no price | Withholds the one fact the stranger came for | `rue.q.price` |
| An account wall before a booking | The hurried never create an account | `chrono.presse.required-fields` |
| Hours in a graphic, or the open status three scrolls down | The person at the door cannot read a graphic | `rue.q.open` |
| Instagram grid pasted in as the site | Someone else’s layout, someone else’s load time, someone else’s tracking | `privacy.third-party` |
| Fake scarcity (« only 2 slots left! ») | Eats the trust the honest hold timer builds | panel (owner advocate) |

## 2 · The generic-site tells

What a page looks like when nobody decided anything. If three of these are present the page has no author.

- Three identical feature cards with an icon, a heading and two lines
- A purple-to-blue gradient, a glass card, a blur nobody needed
- Emoji standing in for icons; a hero headline of « Elevate your … »
- Equal visual weight on everything: no first thing to look at
- A stock-looking person smiling at a laptop; a testimonial with no name
- Type scale of one size, spacing of one size, a radius of one size, a colour for everything
- Motion that is the same ease and the same duration on every element

## 3 · The traps found in the field

Each of these was a real finding, or a real near-miss, while measuring this product. The instrument that finds it is named.

| Trap | What happened | Instrument |
|---|---|---|
| **The overlapping pills** | On a 320×568 phone the floating « Réserver » sits on top of the hero’s « Prochain créneau » pill, hiding the most persuasive thing on the first screen | `pouce.overlap.*` |
| **The Back button** | Opening the booking sheet adds no history entry: the browser’s Back leaves the site and the booking with it | `retour.back` |
| **The false « slot taken »** | A returning client with remembered details taps « Confirmer » before the hold has answered and is told someone else took the slot | `tram.impatient` |
| **The keyboard’s shadow** | Guarded, not found: with the keyboard open, a phone field could sit under the sticky « Confirmer » bar. On the current site the field stays visible once the browser scrolls it into view (the check passes); the risk comes back with any new sticky footer | `clavier.field` |
| **The page without its script** | With JavaScript off, the page is its template: `{{chNum}} {{chName}}` | `atelier.no-js` |
| **The phone that exists and cannot be tapped** | The salon’s number is configured, used in search data and an error message, and nowhere a person can tap | `ancien.phone` |
| **The documented link that does not work** | The comment in `site.html` shows `prestation=coupe-classique`; only the short codes (`cl`, `cc`…) work | `retour.deeplink-readable` |
| **The small label on the photograph** | A 12.5 px label in a translucent pill over the photograph measures 2.5:1 | `ancien.contrast`, `nuit.contrast` |
| **The 34 px beside the money** | « Ajouter », « Remise », « Pourboire » are 34 px tall on the till | `mains.till.secondary` |
| **The date that was a city** | A regexp read « 13013 Marseille » as « 13 mars » and said the training page published dates | `design/calibration/cases.mjs` |
| **The cache that faded everything** | A shared colour cache was mutated by the first element with opacity, dimming every later element that used the same ink | `design/calibration/cases.mjs` |
| **The sticky hero that was an overlay** | A sticky full-screen hero was counted as 100% coverage | `design/calibration/cases.mjs` |

The last three are traps in the **instruments**, kept here because the same hand wrote both. A harness that cannot find its own mistakes will not find the shop’s.
