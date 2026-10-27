# Operations

## Environment variables

Set them in Vercel › Project › Settings › Environment Variables. Nothing secret is ever committed.

| Variable | Required | What |
|---|---|---|
| `LX_MODE` | production | `production` for the real salon. Anything else runs the **demo** (seeded salon, simulated SMS and payments, demo access shown on the login screen). |
| `SESSION_SECRET` | production | 32+ random bytes (`openssl rand -base64 48`). Signs cookies and client links. Changing it signs everyone out and invalidates links already sent. Without it, production answers every `/api` route with 503 « Configuration incomplète : SESSION_SECRET ». |
| `SETUP_TOKEN` | first start | One-time code asked by the setup screen to create the owner account, so nobody else can claim an empty installation. Remove it afterwards (the Comptoir warns while it is still set). |
| `DATABASE_URL` (or `POSTGRES_URL`) | production | Postgres (Neon or Supabase from the Vercel marketplace, **EU region**). Tables are created on first start. |
| `BLOB_READ_WRITE_TOKEN` | alternative | Vercel Blob instead of Postgres. `LX_BLOB_PREFIX` (default `lx2`), `LX_BLOB_ACCESS` (`private` default). |
| `PUBLIC_URL` | recommended | `https://barberlarchitecte.com`: used in SMS links and payment return URLs. Defaults to the Vercel production URL. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for online payments | Without them (or without the webhook secret), production asks no deposit online and the till's QR code is off; the demo uses the test checkout page. With Stripe, an unpaid booking holds its slot at least 31 minutes, the lifetime of a Stripe checkout. |
| `SMS_PROVIDER` | for real SMS | `brevo` (with `BREVO_API_KEY`, `SMS_SENDER` ≤ 11 characters, e.g. `LArchitecte`) or `twilio` (with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). Without it, messages wait in the outbox (Relances › SMS envoyés, « en attente d’un fournisseur SMS »); once a provider is set, those more than 6 h late or whose appointment has started are marked « trop tard » instead of leaving. |
| `CRON_SECRET` | recommended | Enables `/api/cron/tick` for an external scheduler. |
| `LX_DATA_FILE`, `LX_FAKE_NOW`, `LX_INSECURE_COOKIES` | development only | Local journal file; a fixed clock (ignored in production); cookies over plain http (ignored by a production deployment on Vercel). |

The Comptoir shows what is missing: Réglages › Données › Système lists the store, the payment and SMS providers, and any warning.

## Going live (checklist)

1. **Database**: add Neon Postgres from the Vercel marketplace (region Frankfurt or Paris). It sets `DATABASE_URL`.
2. **Secrets**: `LX_MODE=production`, `SESSION_SECRET`, `SETUP_TOKEN`, `PUBLIC_URL`.
3. **Deploy**, open `/comptoir`: the setup screen asks for the setup token, the owner's name, e-mail, password and PIN. Then remove `SETUP_TOKEN`.
4. **Salon**: Réglages › Le salon (legal name, SIRET, VAT number for the tickets), Horaires (weekly hours, public holidays in one tap), Réservation (notice, cancellation delay, deposits), Messages.
5. **Team**: Équipe › Ajouter, one per person, with their PIN; set each barber's hours, services and commission.
6. **Catalogue**: services (price, length, online or not, deposit), products with stock.
7. **Devices**: on the salon tablet, sign in as the owner, Réglages › Appareils › Enregistrer ce poste. The team signs in there with their PIN.
8. **Stripe** (deposits, QR payments): create the account, add `STRIPE_SECRET_KEY`; add a webhook endpoint `https://<domain>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.expired`, copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Test with Stripe's test keys first, then switch to live keys before opening bookings: with test keys (`sk_test_`) in production, a test card confirms a booking and the till deducts its deposit although no money moved (the Comptoir warns « Stripe en mode test »).
9. **SMS**: Brevo account (French, pay as you go), sender name approved, then `SMS_PROVIDER=brevo`, `BREVO_API_KEY`, `SMS_SENDER`. Send a test from Relances to your own number.
10. **Scheduler for quiet hours**: a free cron (cron-job.org, or GitHub Actions) calling `GET https://<domain>/api/cron/tick` every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Vercel Pro can do it natively in `vercel.json` (`crons`). Without it, reminders still leave whenever the Comptoir or the site is open.
11. **Domain and indexing**: point the domain at Vercel; make `/` serve the site (replace `public/index.html`, the demo landing page, with the site, or redirect `/` to `/site`); remove the global `X-Robots-Tag: noindex` header in `vercel.json` and update `robots.txt` so Google indexes the site (keep `/comptoir`, `/r`, `/recu`, `/paiement` out of the index).
12. **Old WordPress**: export clients (name, phone, e-mail, consent) as CSV; import them as client files (a one-off script reading the CSV and calling `POST /api/v1/clients`, phone numbers deduplicate automatically). Keep WordPress read-only for a month, then redirect its booking URLs to `/site`.
13. **Fiscal**: until the till's certification or publisher's attestation is obtained (see [security](security.md#fiscal-note-france)), keep the current certified till as the legal one.

## Day to day

- Morning: the agenda is ready; walk-ins go in the queue (Agenda › Passage, key P), the site shows the live wait.
- At the till: open the drawer with the float, check out each client (the deposit and subscription are already on the ticket), propose the next appointment on the confirmation screen.
- Evening: Caisse & clôture › count the drawer by denomination, then close the day (Z). A closed day cannot change; mistakes are fixed the next day with a credit note.
- Weekly: Relances (clients past their rhythm), Rapports (heat map, team), stock alerts in the feed.
- Monthly: Rapports › Exports (sales, VAT and Z, commissions) for the accountant.

## Backups and archives

- The journal **is** the backup: append-only, every event hashed. Réglages › Données › "Archive complète du journal" downloads it (JSON, without personal data), verifiable offline. Keep one per month, and one per year for 6 years (fiscal archiving).
- Postgres providers keep point-in-time backups (Neon: 7 days on free plans, longer on paid ones).
- Client file export (CSV) from the same screen.

## Incidents

| Symptom | Where to look | What to do |
|---|---|---|
| "Pas de connexion" on the Comptoir | the network | Writes are idempotent: retrying never doubles a sale. |
| A client says the slot was free but booking failed | nothing wrong | Someone took it first; the site keeps their choices and shows the next slots. |
| SMS not leaving | Relances › SMS envoyés (status and error) | Check `SMS_PROVIDER` and the provider's credit; failed messages show the provider's reason. |
| Deposits stay "Acompte en attente" | Stripe dashboard › webhooks | The webhook secret or URL is wrong; unpaid deposits free the slot anyway once the wait is over (31 minutes with Stripe). A deposit paid after that is kept only if the slot is still free; otherwise the booking is cancelled and the deposit refunded. |
| "Anomalie" in Réglages › Données | the activity log, the database | The journal no longer verifies: stop, export the archive, contact the operator. Nothing in the app can produce this; only a direct database edit can. |
| A barber's phone is lost | Réglages › Appareils, Équipe › Déconnecter partout | Revoke the device and the sessions; change the PIN. |

Logs: Vercel › Project › Logs (`[lx]` prefix for the app's own messages).

## Demo

`LX_MODE` unset: the salon is seeded with ten weeks of history around today (520 clients, four barbers, closures, Z, gift cards, a past round of follow-ups) and keeps living: finished appointments are checked out, new days fill up, a client books online now and then. Réglages › Données › Remettre à zéro recreates it.
