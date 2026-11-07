# The hypotheses ledger

The personas and the seasons are **hypotheses**. Research that is independent of software vendors is thin on barbershops: a search for it returns mostly vendor blogs, which are written to sell booking software. The only dependable evidence is **the salon’s own journal** and a few honest conversations. This ledger keeps every claim honest: its class, who it concerns, exactly how to test it, and what would change if it were false.

## Classes

| Class | Meaning |
|---|---|
| **O** | Observed in the product or its code: anyone can verify it today |
| **J** | Validated on the salon’s own journal (none yet) |
| **D** | Domain knowledge of the trade, not verified for this shop |
| **V** | Published by a vendor with a commercial interest: directional only |
| **H** | A hypothesis of the Cabinet: to be tested |

## How to retire a hypothesis

1. Pick the cheapest test in the « How to test » column.
2. Record the result in the row: the date, the number, the sample.
3. Change the class to **J** if the journal confirms it, or strike it and change the persona if it does not. Never delete a row: a refuted hypothesis is knowledge.
4. If a persona’s weight moves, change it in `design/personas/clients.mjs` and run `npm run ux:atlas`.

The `/cabinet-learn` skill walks through this and keeps the provenance.

## The ledger

| Id | Claim | Class | Personas | How to test | If false |
|---|---|---|---|---|---|
| H-01 | Regulars (visits ≥ 3 with the same barber) are about a quarter of visits | H | Fidèle | Clients › segments; share of visits by clients with ≥ 3 visits | Move weight between Fidèle and Nouveau |
| H-02 | Loyalty is to the barber more than to the shop | D | Fidèle | Share of a client’s visits with one `staffId`; ask five regulars what they would do if he left | The « person before the service » principle (P2) loses force; « Sans préférence » becomes the main path |
| H-03 | Regulars return every 2–4 weeks, clustered near 14, 21 and 28 days | D | Fidèle | Gap between consecutive visits per client | The rebook nudge’s timing is wrong |
| H-04 | A fifth of visits are first visits | H | Nouveau | Clients › segment « nouveaux » by month | The first-viewport work matters less, the rebook work more |
| H-05 | A stranger decides within seconds, on real work, price and « can I come soon » | D | Nouveau | A one-question exit poll at the till for a month: « qu’est-ce qui t’a décidé ? » | The street test’s seven questions are the wrong seven |
| H-06 | Online booking weighs on the choice of a barbershop (a vendor survey: 37% most likely to choose a shop that offers it) | V | Nouveau, Pressé | Ask new clients how they found and how they booked; compare with the journal’s `source` | Booking is a convenience, not a decision driver |
| H-07 | A large share of online bookings are made after 21:00 | D | Pressé | Booking timestamp hour for `source = site` | The night scene (dark, closed shop) is over-weighted |
| H-08 | Deposits cut no-shows by 40–60% and lose 3–5% of conversions (a vendor’s figures) | V | Pressé, Occasion, Gérant | No-show rate on the long services before and after the deposit (journal `appt.noshow`); needs weeks | The deposit’s friction is not worth its protection; revisit P6 and T-05 |
| H-09 | A parent books for two or three people in one sitting | D | Parent | Journal: pairs of appointments, different clients, same booking phone, created within ten minutes | T-07 (one person per booking) is a non-issue |
| H-10 | Occasion-driven clients buy the longest, dearest services within a week of the appointment | D | Occasion | Transformation, Décoloration and Silver bookings made ≤ 7 days ahead | The Occasion’s weight and the deposit’s emphasis shrink |
| H-11 | Young clients choose a barber by name and by style, through Instagram | D | Passionné | Count named barbers in the booking note; ask « comment as-tu connu ton barbier ? » | The roster’s faces and Instagram links matter less |
| H-12 | Older clients prefer to phone and need larger, higher-contrast text | D | Ancien | Journal: share of `source = phone` by age band; interview three clients over sixty | The phone path (T-09) is a low priority |
| H-13 | The owner would rather not take calls at the chair | H | Gérant, Ancien | Ask; count phone-sourced bookings and missed calls | Publish the number without hesitation |
| H-14 | Members value predictability and an easy exit | D | Abonné | Membership churn and the reason field; 14-day withdrawals | The cancellation work is polish, not trust |
| H-15 | French consumer law now expects cancelling online to be as easy as subscribing | D | Abonné | The salon’s counsel | The exit may stay as it is, with less urgency |
| H-16 | Gift cards sell in two peaks, around Father’s Day and Christmas | D | Cadeau | Catalogue › cartes cadeaux, sales by month for a year | The gift page’s priority drops outside two months |
| H-17 | A would-be trainee needs a price range and a date before he writes | H | Futur | Count enquiries whose first line asks « combien » or « quand »; A/B a range on one module | « Sur devis » is fine as it is |
| H-18 | A barber has about a minute between clients, with wet or gloved hands | D | Barbier | Shadow two barbers through a Saturday morning: time the gaps, photograph the hands | The 48 px bar for the status buttons can relax to 44 |
| H-19 | The front desk is interrupted every minute or so | D | Accueil | Shadow the desk for a Saturday morning; count the interruptions per hour | Modal sequences matter less |
| H-20 | The owner reviews the numbers in the evening, away from the shop | H | Gérant | The owner’s session timestamps by hour for a month | The 23:00 dark-laptop scene is the wrong scene |
| H-21 | Saturday morning is the peak and Tuesday is slow | H | all | Rapports › heat map | The clocks chosen for the scenes (`sam-09h40`, `mar-15h10`) need moving |
| H-22 | The days before the main religious festivals are among the year’s busiest | D | Occasion, Fidèle | The same weeks of previous years; the waiting list | The seasonal playbook (08-seasons) loses its biggest row |

## The vendor sources, and how far to trust them

The three vendor-published claims above come from software companies selling to barbershops. They are listed because they are the only quantitative claims in circulation, not because they are reliable: none was independently verified, and the deposit figures in particular are unsourced.

- Zenoti, [barbershop client insights](https://www.zenoti.com/thecheckin/barbershop/barbershop-client-insights): the survey behind H-06.
- Bookedin, [barbershop deposit policy guide](https://bookedin.com/?p=16018): the deposit figures behind H-08.
- Booksy, [crafting a no-show policy](https://biz.booksy.com/blog/how-to-deal-with-no-shows): the same family of claims.

Treat them as a reason to measure, never as a result.
