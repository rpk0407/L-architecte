# The demand calendar

When people want a barber, as the Cabinet understands it. **Every line here is a hypothesis (H) or domain knowledge (D), not a measurement.** The salon’s own journal is the only authority: each row says where to read the real number in the Comptoir. The UX consequence is what the Cabinet would design for *if* the row is true.

Dates of the religious calendar move about **eleven days earlier each year** (the lunar year is shorter than the solar one): never hard-code them; read the calendar.

## The week

| Pattern | Class | Where to check | If true, design for it |
|---|---|---|---|
| Saturday morning is the peak; the shop is open Tuesday to Saturday only, so every walk-in competes with every booking | H | Rapports › heat map (occupancy by hour and day) | The home’s « Prochain créneau » and the walk-in wait are the hero’s most valuable lines; a full Saturday should say so honestly and offer the waiting list |
| Friday late afternoon is a pre-weekend rush (the Passionné’s Friday evening) | H | Rapports › heat map | Surface « dernières places » only when it is true (P13) |
| Tuesday is slow; Monday is closed, so Monday-night bookers plan for Tuesday | H | Rapports › by weekday; booking timestamp vs. appointment | The closed-day truth (« demain · 9 h ») is the product’s most-seen sentence on Sunday night and Monday |
| Lunch break (12:00–14:00) is a walk-in and last-minute window | H | Journal: appointments created the same day | Same-day slots and the walk-in wait deserve the first screen at midday |

## The month

| Pattern | Class | Where to check | If true |
|---|---|---|---|
| Visits cluster after pay day (the last days of the month, the first days of the next) | H | Rapports › revenue per day | Month-end is the moment for the membership pitch and for gift cards |
| A cut every 2–4 weeks keeps a fade sharp; regulars rebook at their own rhythm | D | Clients › segments; the gap between visits | « Comme la dernière fois ? » and the SMS reminder are timed to the client’s rhythm, not the calendar’s |

## The year

| Moment | Class | Where to check | If true |
|---|---|---|---|
| The days before the main religious festivals are among the year’s busiest in many barbershops | D | Rapports for the same weeks of previous years; the waiting list | Open extra slots early, say honestly when the week is full, raise the deposit policy on those days only if the owner decides to |
| Ramadan shifts demand towards the evening and the hours after the break of fast | D | Heat map during Ramadan | Late-opening, evening slots, and a site that does not offer a morning that nobody wants |
| Weddings: Saturdays from May to September, with the groom’s party | D | Transformation, Décoloration and Silver bookings made within seven days of the appointment | The Occasion’s journey (deposit clarity, a human to ask) matters most here; a group booking is the missing capability (T-07) |
| Before the summer break and the departures for the holidays | D | The « repris avant de partir » rate; July bookings | Rebook-at-the-chair and « avant de partir » nudges |
| The return to school and work in September: children’s cuts, first-day cuts | D | September bookings by client age | The Parent’s journey (two or three clients at once) |
| Christmas and the New Year: gift cards and party cuts | D | Catalogue › cartes cadeaux, sales by month | The Cadeau’s page, delivery by email or SMS, a card that looks like a gift |
| Home matches of the city’s football club on a Saturday evening | H | Heat map on match days | A quieter late Saturday and a rush before kick-off |
| The first heat of the year, and the mistral | H | Weather against walk-ins | Low priority; do not design for it before the journal shows it |

## How to use this

Before a seasonal peak, run `npm run ux` with the persona scenes that matter (`--persona=occasion,parent,cadeau`), look at what the dossier flags for them, and fix **that**, not the whole site. After the peak, compare what the journal shows with this table, and change the table, not the story.
