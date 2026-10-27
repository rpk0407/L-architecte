# Demo script (15 minutes)

Two screens: a laptop or tablet with **the Comptoir**, a phone with **the site**. The demo salon is alive: ten weeks of history, today's agenda filling up, clients booking online now and then. Start from a fresh salon: Comptoir › Réglages › Données › Remettre à zéro.

Access: owner `gerant@larchitecte.fr` / `Architecte13` · barbers' PINs JKut 2468, Frank 1357, Le Soldat 8642, Esteban 9753 · accueil Inès 1470.

## 1. "Your day, on one screen" (3 min) · Comptoir, owner

- **Agenda**: four chairs, live. Point at the red line (now), the KPIs (revenue so far, fill rate, walk-in wait), the feed on the right.
- Drag an appointment to another time or another barber: *the client gets an SMS with the new time*. Undo from the toast.
- Tap an appointment: status (arrivé → au fauteuil → terminé), the client's **technical card** ("dégradé bas, sabot 0,5"), history, messages.
- **Passage** (key P): a walk-in joins the queue; the site shows "sans rendez-vous ~15 min" in real time.
- ⌘K: search anything (a client, a page, "nouveau rendez-vous").

## 2. "A client books from his phone" (3 min) · phone on the site, Comptoir next to it

- On the phone: Réserver › Coupe + taille de barbe › a barber › a slot. *The slot is held for 5 minutes while he types; nobody else can take it.*
- Confirm. On the Comptoir, the booking appears in the feed with a toast, and in the agenda. *No refresh, no double booking: what the site shows is what is free.*
- Book a **Transformation** (50 €): the site asks a 15 € deposit. Pay on the test page (Stripe once connected). The page "Mon rendez-vous" shows *Confirmé*; it is also the link in the SMS: move or cancel without calling.
- Cancel it from the phone: the slot frees instantly; if someone is on the waiting list, they get the place by SMS.

## 3. "Getting paid" (3 min) · Caisse

- **À encaisser**: the clients who just finished. Tap one: the service, the barber, the deposit already deducted, the subscription already applied.
- Add a product, a tip, a discount (capped by role). Pay **cash**: type what he gives, the change is computed. Or **QR**: he scans and pays on his phone, the ticket closes itself.
- The confirmation screen proposes **the next appointment at his usual rhythm** (three slots, one tap). This is the single biggest driver of loyalty.
- **Ventes du jour**: every ticket, reprint, refund by credit note (a ticket never changes).
- **Caisse & clôture**: count the drawer by notes and coins, then the **Z**: sealed, numbered, with a perpetual grand total. *This is what the tax law asks of a till.*

## 4. "Knowing your business" (3 min) · Rapports, Clients, Relances

- **Rapports**: month to date against the goal, with the projection; revenue per day against last month; the **heat map** (when chairs are full, when they are empty); each barber's revenue, average ticket, rebooking rate and **commission**; exports for the accountant.
- **Clients**: segments (à relancer, fidèles, nouveaux, abonnés, VIP, absences, anniversaires). Open a regular: rhythm, spend, technical card.
- **Relances**: the clients who passed their usual rhythm. One personalised SMS to all of them; the counter shows it fits in one SMS. The stats show how many came back.

## 5. "Your team" (2 min) · Équipe, then a barber

- **Équipe**: who is in the chair right now, who is free, each one's hours with breaks, time off (the site stops offering those slots), services, commission, PIN.
- **Réglages › Équipe et accès**: what barbers may do (check out, see the whole agenda, see the salon's figures, maximum discount). The table shows exactly who can do what.
- Sign out, "Faire de ce navigateur un poste du salon", sign in as **JKut with his PIN**: his agenda, his clients, **his own numbers and commission**, nothing else. The session locks itself after 4 minutes.

## 6. "It's yours, and it's safe" (1 min) · Réglages › Données

- **Journal intact**: every operation since day one is chained and verified. A sale cannot be edited or deleted, only corrected by a credit note.
- Everything exports, at any time. A client can be erased (GDPR) without touching the accounts.

## Questions they usually ask

- *Does it replace WordPress?* Yes: the site, the booking, and the back office. Clients are imported from WordPress at go-live.
- *SMS cost?* Around 4 to 5 cents each with Brevo in France (check their current price list); every default text fits in one SMS.
- *Card fees?* Stripe's public rate for European cards is about 1.5 % + 0.25 € (check the current rate), only on online deposits and QR payments; the terminal stays for in-salon cards.
- *If the internet drops?* Nothing is lost: each action is retried safely, never doubled. The agenda reloads as soon as the connection is back.
- *Is it a certified till?* The mechanisms are there (sealed journal, numbered tickets, Z, archive); it is a « caisse de gestion » until an accredited body certifies it (NF525 or LNE), so the current certified till keeps printing the legal ticket.
