# Operations

## Environment variables

Set them in Vercel › Project › Settings › Environment Variables. Nothing secret is ever committed.

| Variable | Required | What |
|---|---|---|
| `LX_MODE` | production | `production` for the real salon. Anything else runs the **demo** (seeded salon, simulated SMS and payments, demo access shown on the login screen). |
| `SESSION_SECRET` | production | 32+ random bytes (`openssl rand -base64 48`). Signs cookies and client links. Changing it signs everyone out and invalidates links already sent. Without it, production answers every `/api` route with 503 « Configuration incomplète : SESSION_SECRET ». |
| `SETUP_TOKEN` | first start | One-time code asked by the setup screen to create the owner account, so nobody else can claim an empty installation. Remove it afterwards (the Comptoir warns while it is still set). |
| `DATABASE_URL` (or `POSTGRES_URL`) | production | Postgres (Neon or Supabase from the Vercel marketplace, **EU region**). Tables are created on first start. |
| `BLOB_READ_WRITE_TOKEN` | alternative | Vercel Blob instead of Postgres. `LX_BLOB_PREFIX` (default `lx2`), `LX_BLOB_ACCESS` (`private` default). With Postgres too, a Blob store holds the nightly backups (`backups/`). |
| `BACKUP_KEY` | production | 32 random bytes in base64 (`openssl rand -base64 32`): encrypts the nightly backups. Keep a copy **outside Vercel** (a password manager): without it no backup can be opened. Never change it, or older backups stay locked to the old key. |
| `PUBLIC_URL` | recommended | `https://barberlarchitecte.com`: used in SMS links and payment return URLs. Defaults to the Vercel production URL. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for online payments | Without them (or without the webhook secret), production asks no deposit online and the till's QR code is off; the demo uses the test checkout page. With Stripe, an unpaid booking holds its slot at least 31 minutes, the lifetime of a Stripe checkout. |
| `SMS_PROVIDER` | for real SMS | `brevo` (with `BREVO_API_KEY`, `SMS_SENDER` ≤ 11 characters, e.g. `LArchitecte`) or `twilio` (with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`). Without it, messages wait in the outbox (Relances › SMS envoyés, « en attente d’un fournisseur SMS »); once a provider is set, those more than 6 h late or whose appointment has started are marked « trop tard » instead of leaving. |
| `LX_INDEX` | at go-live | `1` lets search engines index the public site: the build removes its noindex and opens `robots.txt` (the Comptoir, client links, the API and `/demo` stay out). Unset, nothing is indexed. Takes effect on the next deploy. |
| `CRON_SECRET` | recommended | Enables `/api/cron/tick` for an external scheduler. |
| `LX_DATA_FILE`, `LX_FAKE_NOW`, `LX_INSECURE_COOKIES` | development only | Local journal file; a fixed clock (ignored in production); cookies over plain http (ignored by a production deployment on Vercel). |

The Comptoir shows what is missing: Réglages › Données › Système lists the store, the payment and SMS providers, and any warning.

## Going live (checklist)

1. **Database**: add Neon Postgres from the Vercel marketplace (region Frankfurt or Paris). It sets `DATABASE_URL`.
2. **Secrets**: `LX_MODE=production`, `SESSION_SECRET`, `SETUP_TOKEN`, `PUBLIC_URL`, `BACKUP_KEY`. Add a Vercel Blob store too, created with **Private** access (Vercel fixes it at creation; a public store refuses the backups), for the nightly backups: it sets `BLOB_READ_WRITE_TOKEN`. In production it is required: without it there is no automatic backup, the download is sealed in one response (Vercel caps those at 4.5 MB, about 30 000 operations, some 16 months of a busy salon) and a file over 2.5 MB cannot be uploaded for a restore.
3. **Deploy**, open `/comptoir`: the setup screen asks for the setup token, the owner's name, e-mail, password and PIN. Then remove `SETUP_TOKEN`.
4. **Salon**: Réglages › Le salon (legal name, SIRET, VAT number for the tickets), Horaires (weekly hours, public holidays in one tap), Réservation (notice, cancellation delay, deposits), Messages.
5. **Team**: Équipe › Ajouter, one per person, with their PIN; set each barber's hours, services and commission.
6. **Catalogue**: services (price, length, online or not, deposit), products with stock.
7. **Devices**: on the salon tablet, sign in as the owner, Réglages › Appareils › Enregistrer ce poste. The team signs in there with their PIN.
8. **Stripe** (deposits, QR payments): create the account, add `STRIPE_SECRET_KEY`; add a webhook endpoint `https://<domain>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.expired`, copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Test with Stripe's test keys first, then switch to live keys before opening bookings: with test keys (`sk_test_`) in production, a test card confirms a booking and the till deducts its deposit although no money moved (the Comptoir warns « Stripe en mode test »).
9. **SMS**: Brevo account (French, pay as you go), sender name approved, then `SMS_PROVIDER=brevo`, `BREVO_API_KEY`, `SMS_SENDER`. Send a test from Relances to your own number.
10. **Scheduler for quiet hours**: a free cron (cron-job.org, or GitHub Actions) calling `GET https://<domain>/api/cron/tick` every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Vercel Pro can do it natively in `vercel.json` (`crons`). Without it, reminders still leave whenever the Comptoir or the site is open.
11. **Domain and indexing**: point the domain at Vercel. `/` already serves the site (the demo page is at `/demo` and sends production visitors to `/`). Set `LX_INDEX=1` and `PUBLIC_URL` for Production and redeploy so Google indexes the site, with `sitemap.xml` and the canonical address. The build lists in `sitemap.xml` only the pages it has: `/formations`, `/carte-cadeau` and the legal pages join it when their packages ship, and until then the old WordPress links to them land on the 404 page.
12. **Old WordPress**: export clients (name, phone, e-mail, consent) as CSV; import them as client files (a one-off script reading the CSV and calling `POST /api/v1/clients`, phone numbers deduplicate automatically). Keep WordPress read-only for a month. Its indexed addresses already redirect to the matching place on the site (`vercel.json`), and the cancel, pay and account links in clients' old e-mails land on `/ancien-lien`, which never acts on them and opens the imported appointment or asks for the client's number.
13. **Fiscal**: until the till's certification or publisher's attestation is obtained (see [security](security.md#fiscal-note-france)), keep the current certified till as the legal one.

## Day to day

- Morning: the agenda is ready; walk-ins go in the queue (Agenda › Passage, key P), the site shows the live wait.
- At the till: open the drawer with the float, check out each client (the deposit and subscription are already on the ticket), propose the next appointment on the confirmation screen.
- Evening: Caisse & clôture › count the drawer by denomination, then close the day (Z). A closed day cannot change; mistakes are fixed the next day with a credit note.
- Weekly: Relances (clients past their rhythm), Rapports (heat map, team), stock alerts in the feed.
- Monthly: Rapports › Exports (sales, VAT and Z, commissions) for the accountant.

## Backups and archives

- **Nightly backup** (`server/core/backup.js`): after 03:00 Paris, the scheduler seals the whole journal, personal data and credentials included, gzips it and encrypts it with `BACKUP_KEY` (AES-256-GCM), then writes a private Blob file `backups/YYYY-MM-DD.json.gz.enc`. It keeps the last 30 days and the first backup of each of the last 12 months. It needs `BLOB_READ_WRITE_TOKEN` and `BACKUP_KEY`, and some traffic or the external cron after 03:00. Only a production salon writes backups (never the demo, nor a Vercel preview, even with the same Blob token), and each file carries its salon's identity (the hash of the journal's first event), so another deployment's files are never taken for this salon's. A backup taken before a client was erased still holds that client until it ages out (a year at most); one taken after holds none of their personal data.
- Réglages › Données › Sauvegardes: « Dernière sauvegarde : cette nuit 03:02 ✓ », in red when it is older than 36 h or when `BACKUP_KEY` or Blob is missing. « Télécharger la sauvegarde chiffrée » (keep one off Vercel each month), « Sauvegarder maintenant ».
- **Restore**: a new deployment with an empty database, the same `BACKUP_KEY`, a `SETUP_TOKEN` and the old Blob store (or the downloaded file). On the setup screen, « Installer depuis une sauvegarde »: pick a backup from Blob or upload the file (in one request up to 2.5 MB; a larger file goes in 2.5 MB parts and then needs the Blob store). The chain is verified before anything is written, and the journal then records « Salon restauré » with the file it came from; the team signs in with their usual passwords and PINs. Refused once the salon has any data. Reuse the same `SESSION_SECRET` and `PUBLIC_URL`, or every link clients already received by SMS (manage links, receipts, offers) stops working. **Everything after the backup's time is lost** (bookings, tickets, Z closures): and a client erased since then comes back, so do those erasures again (Clients › the client › « Effacer (RGPD) »).
- The fiscal archive: Réglages › Données › "Archive complète du journal" (JSON, without personal data, so it cannot restore the salon), verifiable offline. Keep one per month, and one per year for 6 years (fiscal archiving).
- Postgres providers keep their own point-in-time history, short on free plans (Neon: hours, not days; check the plan): not a backup to count on.
- Client file export (CSV) from the same screen.

## Incidents

| Symptom | Where to look | What to do |
|---|---|---|
| "Pas de connexion" on the Comptoir | the network | Writes are idempotent: retrying never doubles a sale. |
| A client says the slot was free but booking failed | nothing wrong | Someone took it first; the site keeps their choices and shows the next slots. |
| SMS not leaving | Relances › SMS envoyés (status and error) | Check `SMS_PROVIDER` and the provider's credit; failed messages show the provider's reason. |
| Deposits stay "Acompte en attente" | Stripe dashboard › webhooks | The webhook secret or URL is wrong; unpaid deposits free the slot anyway once the wait is over (31 minutes with Stripe). A deposit paid after that is kept only if the slot is still free; otherwise the booking is cancelled and the deposit refunded. |
| "Anomalie" in Réglages › Données | the activity log, the database | The journal no longer verifies: stop, export the archive, contact the operator. Nothing in the app can produce this; only a direct database edit can. |
| Backup line in red (Réglages › Données) | the message under it, Vercel logs (`[lx] backup`) | Missing `BACKUP_KEY` or Blob store: add it and redeploy. Blob down: it retries every 15 minutes; « Sauvegarder maintenant » once it is back. |
| A barber's phone is lost | Réglages › Appareils, Équipe › Déconnecter partout | Revoke the device and the sessions; change the PIN. |

Logs: Vercel › Project › Logs (`[lx]` prefix for the app's own messages).

## Demo

`LX_MODE` unset: the salon is seeded with ten weeks of history around today (520 clients, four barbers, closures, Z, gift cards, a past round of follow-ups) and keeps living: finished appointments are checked out, new days fill up, a client books online now and then. Réglages › Données › Remettre à zéro recreates it.
