# Roadmap

What exists is listed in the [README](../README.md). These are the next steps, ordered by what they bring the salon for the effort.

## Before go-live

1. **Import from WordPress**: clients (with consent flags) and upcoming appointments, deduplicated by phone number. A one-off script against the existing API.
2. **Stripe and Brevo accounts**, the external cron, the domain, indexing (see [operations](operations.md#going-live-checklist)).
3. **Till certification**: until then Le Comptoir is a « caisse de gestion » (the Caisse page says so in production) and the salon's certified till prints the legal ticket. The publisher's self-certification appears to be gone since the 2025 finance law (to be confirmed by the salon's accountant), so replacing the certified till means certification by an accredited body (NF525 by Infocert, or LNE) after building what it requires: signed tickets, monthly and annual closures, a duplicata counter, the technical event log (JET) and signed archives. Using the Comptoir as the till without it risks a 7 500 € fine per system. Details in [security](security.md#fiscal-note-france).
4. **Legal pages** on the site (mentions légales, CGV for deposits and cancellation, privacy policy) from the settings already entered.

## Client side

- **Card on file instead of a deposit** for regulars: Stripe SetupIntent at booking, no charge unless they miss the appointment. The no-show fee setting and the provider's off-session charge are in place; the booking step and the "charge the fee" action on a missed appointment remain.
- **"Mon espace" without password**: a link by SMS shows all of a client's appointments, receipts, remaining subscription cuts and gift card balance.
- **Gift cards sold online**: buy on the site, the code arrives by SMS or e-mail, redeemable at the till (gift cards and their liability accounting already exist).
- **Subscriptions online**: buy the 5-cut pack on the site, book the five cuts in one go at the client's rhythm.
- **Waiting list by time window** on the site ("any Saturday morning in the next two weeks"), not only one day.
- **Google Reserve / "Réserver" button on Google Maps** pointing at the site's booking sheet (`/site?reserver`).
- **Wallet pass** (Apple / Google) for the appointment, updated when it moves.
- **Before/after photos** on the client file (with consent), shown back to the client in "Mon espace".

## Salon side

- **Card terminal integration** (SumUp or Stripe Terminal): the amount is pushed to the terminal from the till, no double entry.
- **Supplier orders**: the stock alerts turn into a purchase order to send by e-mail; deliveries received in one tap.
- **Payroll in the provider's format**: the monthly statement per barber and the payroll CSV exist (Rapports › Relevés de paie: réalisé, commission on TTC or HT, tips card and cash, carnet and membership cuts, days); an import file in the payroll provider's own format (Silae, PayFit) remains.
- **Chair rental** (barbers renting a chair): rent schedule, their own till and figures, the salon's cut.
- **Several salons**: one owner, several locations, figures side by side, clients shared. The journal per salon already makes this a configuration rather than a rewrite.
- **Offline till**: tickets queued on the tablet when the internet drops, sent with their idempotency key when it comes back (the server side is already idempotent).
- **Push notifications** on the barbers' phones for their own new bookings (the Comptoir is already an installable web app).
- **Smarter follow-ups**: send the relance automatically at each client's rhythm (with the owner's opt-in), A/B test two texts, birthday message with a small gift.

## Engineering

- State snapshots stored next to the journal once it passes ~500,000 events (faster cold starts).
- Rate limits shared across instances (Postgres or Upstash) instead of per instance.
- Accessibility audit with screen readers on the till and the agenda board (keyboard support is in place).
- Error reporting (Sentry) and uptime check on `/api/public/live`.
