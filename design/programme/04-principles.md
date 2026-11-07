# The house principles

Thirteen rules the Cabinet holds the product to. Each says what it protects, which trial can see it, what the product already does well (so it is not broken), and how it usually breaks. A principle with no test hook is a hope; the ones marked *judged* are for the panel.

| # | Principle | Trial / check | Judged? |
|---|---|---|---|
| P1 | The price before the commitment | `chrono.nouveau.prices`, `chrono.nouveau.price-always`, `rue.q.price` | |
| P2 | The person before the service | `chrono.nouveau.barbers-next`, `chrono.fidele.rebook-card` | |
| P3 | One thumb, one gesture | `pouce.*`, `chrono.*.taps` | |
| P4 | Time is the currency | `nuit.closed-truth`, `rue.q.soon`, the hold timer | |
| P5 | Never lose what he typed | `tram.*`, `clavier.*` | |
| P6 | Say the rule in words | `chrono.occasion.*` | ✓ (content) |
| P7 | The last word is an SMS | `chrono.confirmation` | |
| P8 | Protect the shopfront from itself | `rue.first-paint`, `nuit.reduced-motion`, `atelier.no-js` | |
| P9 | Wet hands | `mains.*` | |
| P10 | The client is looking at the screen | `mains.barber.privacy`, `mains.owner.privacy-toggle` | |
| P11 | An identity, not a template | | ✓ (art director) |
| P12 | A dignified exit | `guichet.abonne.*`, `retour.back` | |
| P13 | Honest numbers | | ✓ (owner advocate) |

---

**P1 · The price before the commitment.** Price, duration and the deposit are visible before anything is chosen or promised. *Already so:* « Réserver · dès 15 € » is the primary button; every service line carries price and duration; the footer shows the price at every step. *Breaks when:* a price appears only at payment; a « dès » with no « dès what? ».

**P2 · The person before the service.** People are loyal to a barber, not a shop. « Sans préférence » is a respectable answer, a named barber is one tap with their next free time beside the name, and « Comme la dernière fois ? » puts the person first for a regular. *Breaks when:* the roster is a list of labels; a returning client is asked who he is.

**P3 · One thumb, one gesture.** Every primary action is reachable with one thumb, at 44 px or more, with nothing precise to hit. *Already so:* the booking button rests at 95% of the screen height. *Breaks when:* a 40 px pill, a floating button on top of another control on a short phone.

**P4 · Time is the currency.** Show waits and durations honestly, including that the shop is closed. *Already so:* at 23:12 the site offers « demain · 9 h », never « aujourd’hui »; a held slot with a visible timer. *Breaks when:* a slot « today » at night; a calendar with no counts.

**P5 · Never lose what he typed.** A dropped connection, a closed sheet, an impatient thumb: nothing typed is lost and nothing false is said. *Already so:* « Pas de connexion. Vérifie ton réseau et réessaie. » with the fields kept; the sheet resumes at the slot. *Breaks when:* « Ce créneau vient d’être pris » is said about a slot that is only still being held; a focused field hides behind the sticky footer.

**P6 · Say the rule in words.** A deposit, a cancellation, a membership rule, once, plainly, before the button, with the reason. *Already so:* « Un acompte de 15 € est demandé pour cette prestation, déduit au salon. Annulé plus de 12 h avant, il est remboursé. » *Breaks when:* the rule is in the CGV only; the button says « Confirmer » and then asks for money.

**P7 · The last word is an SMS.** The confirmation hands back everything: the day and hour in words, the barber, the address, the SMS he will receive word for word, a calendar file, directions, move, cancel. *Already so:* all nine. *Breaks when:* a thank-you screen that is a dead end.

**P8 · Protect the shopfront from itself.** Drama is a layer on top of a page that already works: the name, the address, the hours and a way to book exist before the first script runs, and stay when motion is off. *Breaks when:* the page is blank until JavaScript runs (on a weak signal, or with a filter); a reveal waits for an animation that is switched off; a loop that never stops.

**P9 · Wet hands.** The staff screens are sized and sequenced for hands that are wet, gloved or full: 56 px on the PIN keypad, 48 px where money is involved, 44 px as the floor, in sequence with what is next. *Already so:* the keypad (62 px) and the two status buttons. *Breaks when:* a secondary action beside the money is 34 px.

**P10 · The client is looking at the screen.** On a shared device, nothing a client should not see is on the first screen. *Already so:* amounts hidden by default, a one-tap privacy mode. *Breaks when:* a number appears before anyone chose to show it.

**P11 · An identity, not a template.** *Judged.* The shop could be any shop if it used any template; it is not. Check the [anti-patterns](06-anti-patterns.md).

**P12 · A dignified exit.** Cancelling and erasing are as easy as joining, without an account and without justifying. *Already so:* « Résilier mon abonnement » in every footer; « Renoncer au contrat ici » for the 14-day right. *Breaks when:* a maze; the Back button that throws him off the site mid-booking.

**P13 · Honest numbers.** *Judged.* No fake urgency, no invented scarcity, no dark patterns, deltas explained (« en cours · comparé à mardi dernier en entier »), a demo labelled as one, and a rating that is kept in step with the source it quotes (today it is a hand-kept constant). A number the owner cannot explain is a number he will stop trusting.
