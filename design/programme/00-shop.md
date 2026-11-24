# The shop as it is

What the Cabinet knows about Barber L’Architecte before it judges anything. Everything here is either **observed** in this repository (so it can be checked) or marked as an assumption. Read this first; the trials, the agents and the dossier all rest on it.

## The place

- **Barber L’Architecte**, 16 place Pélabon, 13013 Marseille (13th arrondissement). Open **Tuesday to Saturday, 9:00–18:30**. Closed Sunday and Monday. *(observed: `public/site.html`, JSON-LD)*
- **Four chairs** and a front desk: the demo salon seeds four barbers (JKut, Frank, Le Soldat, Esteban) and a desk. The personas here are composites, never these people.
- An **approved training salon** (« agrément de formateur en coiffure »): it runs short courses, quoted on request. *(observed: `public/formations.html`)*
- The site displays a Google rating (5,0 · 316 avis). It is a **constant in `public/site.html`** (`REVIEWS = { rating: 5, count: 316 }`), kept by hand: it can drift from Google’s own number, which is a small matter for the principle of honest numbers (P13).
- Services in the demo catalogue run from a beard contour at 15 € to Silver at 100 €; the everyday cut is 20 € for 30 minutes. A long service (Transformation, 50 €, one hour) takes a **15 € deposit**, refunded when cancelled more than 12 hours ahead. *(observed: `server/domain/seed.js`; the live catalogue is whatever the owner sets in Comptoir › Catalogue)*
- **Memberships** (weekly or monthly rhythm, with a rule for a missed week: lost, carried over, or unlimited), a **carnet** of five cuts, **gift cards**, a **waiting list**, a walk-in queue (« Passage »), loyalty cards, client files with a technical note per client (« sabot 0,5 »), cut notes written by barbers, SMS reminders with a link to move or cancel.

## The product surface

| URL | What it is | Who it is for | Moments |
|---|---|---|---|
| `/` | The public site with live booking | every client | M01–M07, M09, M13 |
| `/?reserver` (+ `&barbier=jkut&prestation=cl`) | The booking sheet, optionally pre-filled (the catalogue’s short codes: `cl`, `cc`, `ct`, `tr`…) | a shared link, an Instagram bio, a QR code | M03, M04 |
| `/r/:token` | « Mon rendez-vous »: confirm, pay the deposit, move, cancel | a client, from the SMS | M06, M08 |
| `/moi` | « Mon espace »: next appointment, visits, receipts, carnets (off in production until opened) | a returning client | M13 |
| `/abo/:token`, `/resilier` | The member page; cancelling without an account | a member | M14 |
| `/carte-cadeau` | Buy a gift card | someone who is not a client | M02, M07 |
| `/formations` | The training offer and its enquiry form | a would-be barber | M01, M02 |
| `/comptoir` | Le Comptoir: agenda, till, clients, follow-ups, reports, team, catalogue, settings | owner, desk, barbers | M10–M12, S01–S04 |

### The booking sheet’s contract

Service → barber → slot → details → confirmation, as a bottom sheet. Choosing a service, a barber or a slot advances by itself. The selectors the harness relies on are the ones `tests/e2e` already depends on, and they live in one file: `design/instruments/lib/surface.mjs`. If the markup changes, that file is the only one to touch.

## The brand, from the code

- **Voice.** *Tutoiement* throughout, short sentences, wordplay on *coupe* (a haircut, and an architect’s section drawing): « Prends place. », « Sorti du fauteuil. », « Les prix, sans surprise. », « On recoupe ? ». See [the lexicon](07-lexicon.fr.md).
- **Palette.** Stone, bone, white, ink, ash and one red: `--pierre #D3D0C8`, `--os #ECE8E0`, `--blanc #F6F3EE`, `--encre #0F0E0D`, `--cendre #ABA59C`, `--rouge #EB4639`. Light by default, dark with the phone. *(observed: `public/pages.css`)*
- **Type.** Instrument Serif for voice (display, prices, the wordmark), Instrument Sans for work. Self-hosted: no visitor’s address reaches a font provider.
- **Shapes and motion.** Pill buttons; chapter numbers (« 04 L’équipe »); a halftone dissolve on the hero wordmark; a bottom sheet with a step progress; line-by-line reveals; the photograph as the argument.
- **Privacy as a design value.** Self-hosted fonts, no third-party requests, a privacy mode that blurs amounts, amounts hidden by default on a shared device, honest « Démo » labelling.

## Business truths (and how sure we are)

| Truth | Status |
|---|---|
| A four-chair shop lives on its regulars; the first visit is the funnel | domain knowledge (D) |
| No-shows are the owner’s worst leak and the deposit is the answer, at some cost in conversions | vendor claim, unverified (V): test on the journal |
| Saturday morning is the peak; Tuesday afternoon is the demo’s « busy » | hypothesis (H): Rapports › heat map |
| The owner would rather not take calls at the chair | hypothesis (H): ask |
| A returning client rebooking at the chair is the biggest loyalty driver | observed in the product’s own demo script (O) |
| The front desk is the bottleneck on a Saturday | hypothesis (H): shadow it |

The full ledger, with how to test each, is [the hypotheses](09-hypotheses.md).

## What « good » means here

1. **It fills chairs without adding work at the desk.** A booking that arrives complete, on time, paid when it should be.
2. **It feels like this shop and no other.** A template with a razor on it fails this even if it passes everything else.
3. **It works on a cracked phone, on a weak signal, in a hurry, with wet hands.** The real conditions, not the review conditions.
