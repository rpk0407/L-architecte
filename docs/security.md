# Security

## Who can do what

Four roles, each a set of capabilities (`server/domain/permissions.js`). Every write and every read of sensitive data checks the capability **on the server**; the Comptoir only hides what you cannot use.

| | Owner | Manager | Front desk | Barber |
|---|---|---|---|---|
| Agenda of every chair | ✓ | ✓ | ✓ | setting |
| Check out, see all sales | ✓ | ✓ | ✓ | check out: setting |
| Refunds, Z closure | ✓ | ✓ | | |
| Full phone numbers, client export | ✓ | ✓ | numbers | |
| Salon figures | ✓ | ✓ | | setting (own figures always) |
| Team, catalogue | ✓ | ✓ | | |
| Settings, devices, data, GDPR erasure | ✓ | | | |

The owner adjusts the barbers' toggles in Réglages › Équipe et accès; the matrix shown there is computed by the server from the saved settings. Discounts are capped by role (barbers 10 % by default, front desk 20 %).

## Signing in

- **Owner and managers**: e-mail and password (10 characters minimum), from anywhere. Optional 30-day session.
- **Barbers and front desk**: a 4 to 6 digit PIN, **only on devices the owner enrolled** (Réglages › Appareils). A PIN typed on any other browser is refused. Obvious PINs (0000, 1234) are refused.
- Passwords and PINs are hashed with **scrypt** (N = 32768, r = 8, p = 1, random salt); comparisons are constant-time, and a dummy hash is computed for unknown accounts so timing reveals nothing.
- **Rate limits**: 6 failed logins per account per 15 minutes, 5 failed PINs per person per device per 5 minutes, global limits per IP. They count failures only, so a busy shop is never locked out. The counters live in the instance's memory: on several instances they are per instance, which still bounds guessing to a handful of tries per minute.
- PIN sessions lock after 4 minutes of inactivity (a shared tablet), last 12 hours at most, and are tied to the device.

## Sessions and cookies

- `lx_s` (session) and `lx_d` (device): **HttpOnly, Secure, SameSite=Strict**, HMAC-SHA256 signed with `SESSION_SECRET`. The device token is stored server-side as a SHA-256 hash only.
- Each request re-checks the session against the live state: removing a person, revoking their sessions ("Déconnecter partout"), changing their password, or revoking a device takes effect on the next request.
- Writes must be same-origin (Sec-Fetch-Site / Origin) and JSON: a page on another site cannot forge a request, on top of SameSite=Strict.

## Headers

`Strict-Transport-Security` (2 years), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (no camera, microphone, geolocation). The Comptoir and the client pages add a strict **Content-Security-Policy** (scripts from the site only, no inline script, no framing, forms only to the site and Stripe), `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy`. `/comptoir` is `noindex`.

## Client links

"Mon rendez-vous", receipts and waiting-list offers are reached through links signed with HMAC (`code.signature`). They expose no other appointment, cannot be guessed, and show no personal data beyond the client's first name.

`/mon-rendez-vous` has no account behind it: `POST /api/public/lookup {phone}` (server/http/routes-client.js) texts the links of the client's next two appointments, and only to the number on file (an erased client or a merged file's old number gets nothing). Whoever typed the number learns nothing: the answer is the same words and status for a known, unknown or erased number, and it leaves after 450 to 650 ms whatever the store, because the journal write runs after it (`waitUntil`). Limits: 10 asks per IP per hour (then a 429, which says nothing about the number), 3 per number per day in the instance's memory, and 3 texts per client per day kept in the journal across instances; past them the answer stays the same and nothing is sent. The text is a service text asked for by the person holding the phone, so it leaves at once, quiet hours included: at worst a stranger who knows the number makes the salon text it three times in a day, with links only that phone can use.

## Public endpoints

Everything under `/api/v1/*` needs a session and a capability. The routes below answer without one, each with its own guard:

| Endpoint | Who calls it | Guard | What it can change |
|---|---|---|---|
| `/api/public/*` | the site and the client pages | same-origin writes, rate limits, signed links for one booking | holds, bookings, moves and cancellations of the client's own booking |
| `/api/auth/*`, `/api/setup*` | the sign-in and setup screens | rate limits on failures; setup and restore need `SETUP_TOKEN` and an empty salon | sessions; the first owner, or a restore |
| `POST /api/stripe/webhook` | Stripe | signature with `STRIPE_WEBHOOK_SECRET` (5-minute tolerance), idempotent | payments only |
| `GET /api/cron/tick` | the external scheduler | `Authorization: Bearer <CRON_SECRET>` | runs the background work, as the scheduler does |
| `POST /api/sms/webhook?k=…` | the SMS provider (Brevo, Twilio) | CSRF check off (the provider is another site); the key `k` in the query string is derived from `CRON_SECRET` (HMAC, `webhookKey` in server/messaging/sms.js), compared in constant time; 120 calls per minute per IP; unknown without `CRON_SECRET` | **only marketing consent**: a STOP reply turns that client's offers off (`marketing: false`, source `stop`) and closes their offers still waiting. Service texts, bookings and files are never touched; an unknown number changes nothing |

## Payments

- **Stripe Checkout**: card data never touches the salon's server. Amounts are computed on the server; the webhook is verified (signature, 5-minute tolerance, constant-time comparison) and idempotent. Refunds go through Stripe with an idempotency key.
- The demo refuses live Stripe keys, so a demo can never charge anyone.
- At the till, card payments go through the salon's own terminal; the Comptoir records them.

## Personal data (GDPR)

- Collected: first name, phone, optionally last name, e-mail, notes, birthday. Purpose: managing appointments; marketing SMS only with consent (`marketing` flag), service SMS (confirmations, reminders) with an opt-out.
- Barbers see masked numbers (`06 •• •• •• 42`). Exports of the client file are owner-only.
- Erasure: client file › ⋯ › Effacer (RGPD). What is still open is listed first (bookings to come, subscription cuts, gift card balance): the bookings are cancelled and the client texted before the number goes. Personal data is removed from the state and from every event; tickets stay in the accounts without the name; the journal still verifies. The `client.erased` event keeps only keyed hashes of the number and e-mail (HMAC-SHA256 under a key derived from `SESSION_SECRET`, cut to 32 hex characters), so a re-run of the WordPress import skips the rows of the person from before the erasure (« client effacé à sa demande »); a booking the old site recorded after it comes in (the person came back). A plain hash would not do: the chain keeps it for good, and every French mobile can be hashed in minutes. Changing `SESSION_SECRET` (or restoring with another one) means an import no longer recognises the people erased before.
- Gift cards bought online (`/carte-cadeau`): the order's names, numbers and message travel only in the pii of its `payment.created` event, under the id the buyer's file takes once paid (or the file the number already has), so erasing that file erases the order. No file is created before the payment is confirmed. Follow-up: an order never paid keeps that pii until a retention purge covers abandoned payments.
- Access and portability: client file › ⋯ › Exporter ses données (a JSON of the file, bookings, tickets, cards, texts; `client.export`).
- Hosting: Vercel (EU region `cdg1`, Paris) and the chosen database (pick an EU region). Data belongs to the salon and can be exported at any time (Réglages › Données).
- The site's legal pages are filled from the settings, so they say what the salon actually does: `/mentions-legales` (publisher, SIRET, APE, RM/RNE, publication director, host, database, mediator: Réglages › Le salon › Site et mentions légales), `/confidentialite` (the register below, the browser storage `lx-me` and a button to clear it, the CNIL) and `/cgv` (deposit, cancellation delay and no-show fee from Réglages › Réservation). The CGV carry a version date. `updateSettings` dates `shop.cgvVersion` itself (`cgvPatch` in `server/settings/shop.js`, on the server's clock) whenever a patch changes the deposit rules or the cancellation delay, whatever screen sent it; the version never goes back (a stale screen resending an older one is ignored) and is never after today. When the text of `public/cgv.html` changes, bump `CGV_TEXT` in `server/settings/shop.js` and the page's `data-cgv-text` together (a unit test keeps them equal): the CGV in force are the newer of the two, `cgvVersionOf(settings.shop)`, which is what a booking should record. A bump by hand is a `PATCH /api/v1/settings {shop:{cgvVersion:'YYYY-MM-DD'}}` (forward only). The no-show fee clause stays off the CGV until a card can really be kept for it (`payments.live` and `payments.cardOnFile` in `/api/public/salon`); the SMS confirmation is mentioned only when texts really leave.

Before go-live, for the CGV and the privacy page:
- Connecting Stripe makes the deposit rule appear in the CGV: bump the version that day (a `PATCH` of `shop.cgvVersion`, or any deposit change).
- Have a lawyer read the CGV once: deposit as « acompte » rather than « arrhes », and the **right of withdrawal** for online bookings (L221-5 and L221-18: the page has no clause yet, and leaving it out extends the withdrawal period by 12 months, L221-20). Add the clause the lawyer settles on (it applies, with the express request to be served within the 14 days, L221-25, or the exemption that applies).
- `/confidentialite` promises the client file is erased 3 years after the last visit: Clients › Sans visite depuis 3 ans › Anonymiser does it (with the names and typed reasons left on tickets and bookings without a file). It is not automatic: the Clients tab carries a badge with the number of files due and the list a banner that leads to them; the owner runs it when they appear (at least once a month). A step in the nightly tick or the digest (`server/commands/tick-steps.js`) would make it automatic.
- Check the « base de données » line against the real store (Réglages › Le salon shows it) and the database region (EU).

### Registre des traitements

The salon's record of processing (RGPD art. 30), kept here and summarised for clients on `/confidentialite`. Each processor needs its data processing agreement accepted (Vercel, Neon, Brevo and Stripe offer theirs online).

| Traitement | Finalité | Base légale | Durée | Sous-traitants |
|---|---|---|---|---|
| Rendez-vous | Réserver, confirmer, déplacer, annuler; liste d’attente | Contrat (6.1.b) | Fiche client: 3 ans après la dernière visite | Vercel (hébergement), Neon (base de données, UE) |
| SMS de service | Confirmation, rappel, place libérée, reçu, lien Mon rendez-vous sur demande | Contrat (6.1.b), désactivable par client | Comme la fiche; journal d’envoi avec elle | Brevo (SMS, France) |
| E-mails de service | Confirmation avec le fichier agenda (.ics), déplacement, annulation, aux clients qui ont donné leur e-mail | Contrat (6.1.b), désactivable dans Réglages › Messages | Comme la fiche; journal d’envoi avec elle | Brevo (e-mail transactionnel, France) |
| SMS marketing (bons plans, relances) | Faire revenir un client au bon rythme | Consentement (6.1.a), STOP à tout moment | Jusqu’au retrait du consentement, au plus comme la fiche | Brevo |
| Caisse et comptabilité | Tickets, avoirs, clôtures Z, exports pour le comptable | Obligation légale (6.1.c) | Tickets 10 ans; journal fiscal 6 ans (sans nom: les données personnelles sont hors chaîne et effaçables) | Vercel, Neon |
| Acomptes en ligne | Encaisser l’acompte, le rembourser | Contrat (6.1.b) | Avec le ticket (10 ans); la carte reste chez Stripe | Stripe (paiement) |
| Comptes de l’équipe | Connexion, droits, appareils autorisés | Intérêt légitime (6.1.f) / contrat de travail | Durée de l’activité dans le salon | Vercel, Neon |
| Journal d’activité et sécurité | Savoir qui a fait quoi, limiter les tentatives de connexion | Intérêt légitime (6.1.f) | Avec le journal (6 ans); compteurs de tentatives en mémoire seulement | Vercel, Neon |

On the client's phone, the site keeps `lx-me` (what they typed and links to their last bookings) and `lx-focus` (the booking just made) in local storage: not a cookie, never sent anywhere, cleared from `/confidentialite`. The public site sets no cookie and runs no analytics; the Comptoir's session cookies are strictly necessary. The fonts are served from the salon's own domain (`/fonts`, copied from `@fontsource` at build time): no page of the site asks Google Fonts or any other third party. Only the Comptoir's and client pages carry a CSP (`font-src 'self'`, `vercel.json`); the public pages have none, so `tests/unit/public-fonts.test.js` is what keeps them off third-party fonts.

## Fiscal note (France)

**Le Comptoir is a management till (« caisse de gestion »), not the salon's legal cash register.** In production the Caisse page says so on every tab: « Caisse de gestion : le ticket légal sort de ta caisse certifiée. » The demo does not show it.

Since 2018, software that records sales for clients who are not businesses must guarantee **inalterability, security, preservation and archiving** of the data (anti-fraud VAT law, art. 286, I-3° bis CGI). The 2025 finance law (loi n° 2025-127 du 14 février 2025) appears to have ended the publisher's self-certification: the only proof left is a **certificate issued by an accredited body**, in practice NF525 (issued by Infocert) or the LNE's certification. The salon's accountant is to confirm this reading. Until a certificate exists, the salon's current certified till stays the legal one: every sale is also rung up there and the client's legal ticket comes from it. Le Comptoir's tickets are management records: the day's figures, the barbers' commissions, the client's history and follow-ups.

What Le Comptoir already has: a SHA-256 chained journal, numbered tickets without gaps, credit notes instead of edits, a sealed daily Z with a perpetual grand total, and an archive export verifiable offline. What a certification would still need, at least:

- **Signed tickets**: each ticket, and the grand totals, carry an electronic signature, not only a link in the chain.
- **Monthly and annual closures**, each with its own perpetual totals, on top of the daily Z.
- **A duplicata counter**: every reprint of a ticket is numbered and marked « duplicata », and the count is kept.
- **A technical event log (JET)**: start and stop, errors, archives, version changes and data purges, chained like the journal.
- **Signed archives**: periodic archives (at least yearly) sealed with a signature, kept 6 years.
- Then the audit itself, by the accredited body, for each published version.

The risk if Le Comptoir is used as the till without a certificate: a **7 500 € fine per system** (art. 1770 duodecies CGI), with 60 days to put a compliant till in place after a tax inspection. Nothing in this repository changes the Z for this; the work above is a separate project, listed in the [roadmap](roadmap.md#before-go-live).

## Reporting a problem

Anything that looks like a security issue: stop using the affected feature, note the time, and contact whoever operates the installation. The activity log (Réglages › Journal) shows who did what and from which device.
