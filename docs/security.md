# Security

## Who can do what

Four roles, each a set of capabilities (`server/domain/permissions.js`). Every write and every read of sensitive data checks the capability **on the server**; the Comptoir only hides what you cannot use.

| | Owner | Manager | Front desk | Barber |
|---|---|---|---|---|
| Agenda of every chair | ✓ | ✓ | ✓ | setting |
| Check out, see all sales | ✓ | ✓ | ✓ | check out: setting |
| Refunds, Z closure | ✓ | ✓ | | |
| Full phone numbers, client export | ✓ | ✓ | numbers | |
| Salon figures, month goal, sales and VAT exports (`report.shop`) | ✓ | ✓ | | never (own figures always) |
| Each barber's figures without commissions or tips (`report.team`) | ✓ | ✓ | | setting |
| Text one's own regulars (`client.rebook`) | ✓ | ✓ | ✓ | setting (off in production) |
| Team, catalogue | ✓ | ✓ | | |
| Settings, devices, data, GDPR erasure | ✓ | | | |

The owner adjusts the barbers' toggles in Réglages › Équipe et accès; the matrix shown there is computed by the server from the saved settings. Discounts are capped by role (barbers 10 % by default, front desk 20 %).

What each person sees of the others (TEAM-01):
- `report.shop` is the owner's and the managers' only, for good: no switch gives it to a barber, so every colleague's revenue, commission, rates and tips, the sales and VAT exports with clients' names, the tickets on a client file and every owner read gated on it stay theirs. A test pins that a barber gets 403 on the sales, VAT, commissions, clients and journal exports under every team setting.
- « Ce que chacun voit des autres » (`team.teamView`): **Rien** (own figures only), **Le salon** (default: the month goal reached and the salon's fill, in %, never in euros) or **Toute l’équipe** (`report.team`: each barber's revenue, visits, fill, rebooking, no-shows and average ticket, never commission, rates or tips). A salon whose journal still has the old « Voir le chiffre du salon » switch on and never chose a view reads as **Toute l’équipe**: the closest match that leaks no export. Choosing a view retires the old switch.
- The month goal reaches the owner and managers only; the warnings that stop tonight's Z reach whoever may close the day; the server's own set-up warnings, the owner only.
- The live feed names the chair of every booking and ticket line (`staffId`). A deposit or online payment shows to the till (`sale.all`) and to the barber whose client it is, not to his colleagues; the Z amounts to `closure` or `report.shop` only.
- The desk (no chair, no `report.shop`) sees the whole salon's appointment counts and fill on the agenda, never an amount.
- Nobody changes his own role, and only the owner changes his own commission (`self_commission`, « Ta commission se règle avec le gérant. »). When anyone but the owner changes a colleague's commission or role, or sets a PIN or password, the same command records `team.changed` (ids, rates or role codes, no personal data) and the owner's feed says so: « Frank a changé la commission de JKut : 40 → 45 % ».

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

The referrer's link (FID-02, `/?parrain=<file id>.<HMAC 'ref'>`, server/http/routes-loyalty.js): `GET /api/public/parrain/:token` (30 a minute per IP) shows his first name and the welcome offer, only while referral is on and his file exists; a booking carrying it records the referral as the system, never blocking the booking, and only for a file that booking created (24 h), never seen before, with another number (last 8 digits) and e-mail than the referrer's, at most `perYear` referrals by the same referrer per calendar year (those rewarded, and those still within the referee's 60 days, so junk bookings through a link cannot use up his year for good); a file that opted out of the card takes no part. The answer to the booking says only `referral: { ok, why }`. The link between the two persons is erased with either of them (`client.erased.drop`).

`/mon-rendez-vous` has no account behind it: `POST /api/public/lookup {phone}` (server/http/routes-client.js) texts the links of the client's next two appointments, and only to the number on file (an erased client or a merged file's old number gets nothing). Whoever typed the number learns nothing: the answer is the same words and status for a known, unknown or erased number, and it leaves after 450 to 650 ms whatever the store, because the journal write runs after it (`waitUntil`). Limits: 10 asks per IP per hour (then a 429, which says nothing about the number), 3 per number per day in the instance's memory, and 3 texts per client per day kept in the journal across instances; past them the answer stays the same and nothing is sent. Both are shared by every page that texts a link or a code on demand (server/domain/linkcap.js, FID-01: the key `link|<ip>` and `linkSendsToday`, counting lookup, sign-in codes, membership and space links, access invites together), so three pages do not make nine texts; past them the answer stays the same and nothing is sent. The text is a service text asked for by the person holding the phone, so it leaves at once, quiet hours included: at worst a stranger who knows the number makes the salon text it three times in a day, with links only that phone can use.

## Public endpoints

Everything under `/api/v1/*` needs a session and a capability. The routes below answer without one, each with its own guard:

| Endpoint | Who calls it | Guard | What it can change |
|---|---|---|---|
| `/api/public/*` | the site and the client pages | same-origin writes, rate limits, signed links for one booking | holds, bookings, moves and cancellations of the client's own booking |
| `/api/auth/*`, `/api/setup*` | the sign-in and setup screens | rate limits on failures; setup and restore need `SETUP_TOKEN` and an empty salon | sessions; the first owner, or a restore |
| `POST /api/pay/stripe/webhook` (alias `/api/stripe/webhook`) | Stripe | signature with one of the secrets in `STRIPE_WEBHOOK_SECRET` (5-minute tolerance, constant time); any other provider name answers 404; idempotent per object | payments only: paid, expired, refunds made at Stripe, disputes, payouts and their fees |
| `GET /api/cron/tick` | the external scheduler | `Authorization: Bearer <CRON_SECRET>` | runs the background work, as the scheduler does |
| `POST /api/sms/webhook?k=…` | the SMS provider (Brevo, Twilio, or the salon's phone through SMS Gateway for Android) | CSRF check off (the provider is another site); the key `k` in the query string is derived from `CRON_SECRET` (HMAC, `webhookKey` in server/messaging/sms.js), compared in constant time; 120 calls per minute per IP; unknown without `CRON_SECRET` | **only consent**: a STOP reply turns that client's offers off (`marketing: false`, source `stop`) and closes their offers still waiting; the review request (a « relation » text) stops too, also one already waiting for the morning (skipped as it would leave). Service texts, bookings and files are never touched; an unknown number changes nothing. From the salon's phone also: a client's other answer becomes a request in Relances › Demandes (kind `sms`, its words and number in pii, recorded once per event id; the chained data names only the template and id of the text it answers), a mere « ok » to a review request, reminder or receipt filed by itself, and a delivery report marks that text failed or delivered. Nothing else |

Provider credentials (MSG-02): `BREVO_API_KEY` (SMS, e-mail, WhatsApp), `TWILIO_AUTH_TOKEN` and `SMSGATE_USERNAME`/`SMSGATE_PASSWORD` (the SMS Gateway app's cloud account, shown on its Home tab) live in Vercel only (type Sensitive). The Comptoir's Canal d'envoi (`GET /api/v1/messages/channels`, owner) says whether each one is set and never returns a key, a password or a username; the test text (`POST /api/v1/messages/channels/test`) goes only to a French mobile, three an hour per route, and writes nothing to the journal. The salon phone's own webhook signature (`X-Signature`) is not checked: the key `k` in the address the owner registers plays that role, as for Brevo. Whoever holds the SMS Gateway credentials can send texts from the salon's SIM: change them in the app (and in Vercel) if the phone or the account leaks. No WhatsApp Web automation is ever used (it breaks WhatsApp's terms and gets the number banned): only Brevo's official WhatsApp API with templates approved by Meta.

## Payments

- **Stripe Checkout**: card data never touches the salon's server. Amounts are computed on the server; the webhook is verified (signature, 5-minute tolerance, constant-time comparison) and idempotent. Refunds go through Stripe with an idempotency key, through the provider each payment used (`providerFor`).
- Stripe's customer and card ids tie a person to a card: they travel in the pii of `payment.succeeded` under the client's file (erased with it), and are not kept at all when no file is known (a QR at the till). Payment, charge, payout and dispute refs (`pi_`, `ch_`, `po_`, `du_`) stay in the chain: reconciliation needs them, and they name no one. Stripe's error texts are never shown to a client.
- Keeping or refunding a deposit whose visit will not happen (Caisse › À traiter, `POST /api/v1/payments/:id/keep|refund`) needs `sale.refund` (owner, manager); each is refused once the deposit is on a ticket or refunded, and a replayed request gets its first answer. A till refund is keyed at Stripe by its request id, so a replay never refunds twice.
- The demo refuses live Stripe keys, so a demo can never charge anyone.
- At the till, card payments go through the salon's own terminal; the Comptoir records them.
- **Memberships** (PAY-02): only the provider's webhook or the scheduler records a paid or refused invoice and the end (`server/commands/memberships.js`); a checkout is recorded by them too, or at the counter by a staff member with `client.edit` (channel `salon`), who learns nothing of another file from a known reference (`{ already: true }` only). A month is rung up by the system only, never at the till, and its ticket is not refunded at the till while the contract runs (the withdrawal or the cancellation ends it first). A client cancels or withdraws only on his own file, as the route vouches for it in the ctx (`meta.me.cid` from AC-01's `runAs`, or `meta.memberId` from a verified member link), never from a cid in the body; he never sets the refund (always the first month less the cuts taken) nor speaks for the salon. The salon needs `member.manage` (owner and manager) to cancel, withdraw with its own amount or give a cut the plan does not cover today (`force`, recorded on `member.used`). A barber sees a client's « abonné » badge and cuts, not the card label nor a payment in trouble, and no membership line in the feed. The processor's references (customer, subscription, card label) live in the pii of `member.activated`, never in the chain, and are not written at all under a file erased before the first payment; every member event carries `data.cid`. A checkout never paid leaves a plain client file (first name, number) with nothing in it: the retention purge of inactive files covers it.

## Personal data (GDPR)

- Collected: first name, phone, optionally last name, e-mail, notes, birthday. Purpose: managing appointments; marketing SMS only with consent (`marketing` flag), service SMS (confirmations, reminders) with an opt-out.
- Barbers see masked numbers (`06 •• •• •• 42`). Exports of the client file are owner-only.
- Erasure: client file › ⋯ › Effacer (RGPD). A running membership refuses it (cancel it first). What is still open is listed first (bookings to come, carnet cuts, gift card balance): the bookings are cancelled and the client texted before the number goes. Personal data is removed from the state and from every event; tickets stay in the accounts without the name; the journal still verifies. The `client.erased` event keeps only keyed hashes of the number and e-mail (HMAC-SHA256 under a key derived from `SESSION_SECRET`, cut to 32 hex characters), so a re-run of the WordPress import skips the rows of the person from before the erasure (« client effacé à sa demande »); a booking the old site recorded after it comes in (the person came back). A plain hash would not do: the chain keeps it for good, and every French mobile can be hashed in minutes. Changing `SESSION_SECRET` (or restoring with another one) means an import no longer recognises the people erased before.
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
| SMS de service | Confirmation, rappel, place libérée, reçu, lien Mon rendez-vous sur demande; par WhatsApp quand le salon l’a activé, le SMS en secours (Brevo en secours du téléphone du salon) | Contrat (6.1.b), désactivable par client | Comme la fiche; journal d’envoi avec elle | Brevo (SMS et WhatsApp, France; WhatsApp: Meta), ou le téléphone du salon (SMS Gateway for Android: le texte transite par son serveur cloud) |
| Réponses des clients au téléphone du salon | Lire et répondre à un client qui répond à un SMS | Intérêt légitime (6.1.f) | Comme la fiche (effacées avec elle); sans fiche, comme les demandes du site | SMS Gateway for Android (serveur cloud) |
| E-mails de service | Confirmation avec le fichier agenda (.ics), déplacement, annulation, aux clients qui ont donné leur e-mail | Contrat (6.1.b), désactivable dans Réglages › Messages | Comme la fiche; journal d’envoi avec elle | Brevo (e-mail transactionnel, France) |
| Demande d’avis Google | Demander un avis après une visite terminée et payée, une fois par trimestre au plus, la même à chaque client | Intérêt légitime (6.1.f) : client venu au salon; STOP l’arrête | Comme la fiche; journal d’envoi avec elle; l’ouverture du lien ne garde que l’identifiant du message | Brevo, ou le téléphone du salon (SMS), ou Brevo e-mail pour une fiche sans téléphone |
| WhatsApp | Messages de service seulement (confirmation, rappel, annulation, reçu); jamais d’avis ni d’offre sans accord à part | Contrat (6.1.b) | Comme la fiche | Brevo (WhatsApp), Meta |
| Clients repris de WordPress | Garder les fiches et rendez-vous de l’ancien site; informer chaque client (art. 14): le premier message de service ajoute « Nouveau site du salon. Tes données : …/confidentialite », et aucune demande d’avis ni offre ne part avant qu’il soit parti (la page dit d’où vient la fiche) | Contrat (6.1.b) pour les rendez-vous, intérêt légitime (6.1.f) pour la fiche | Comme la fiche | Vercel, Neon |
| SMS marketing (bons plans, relances) | Faire revenir un client au bon rythme | Consentement (6.1.a), STOP à tout moment (« STOP au 36173 » par Brevo, « STOP : réponds STOP » depuis le téléphone du salon) | Jusqu’au retrait du consentement, au plus comme la fiche | Brevo, ou le téléphone du salon |
| Caisse et comptabilité | Tickets, avoirs, clôtures Z, exports pour le comptable | Obligation légale (6.1.c) | Tickets 10 ans; journal fiscal 6 ans (sans nom: les données personnelles sont hors chaîne et effaçables) | Vercel, Neon |
| Acomptes en ligne | Encaisser l’acompte, le rembourser | Contrat (6.1.b) | Avec le ticket (10 ans); la carte reste chez Stripe | Stripe (paiement) |
| Comptes de l’équipe | Connexion, droits, appareils autorisés | Intérêt légitime (6.1.f) / contrat de travail | Durée de l’activité dans le salon | Vercel, Neon |
| Journal d’activité et sécurité | Savoir qui a fait quoi, limiter les tentatives de connexion | Intérêt légitime (6.1.f) | Avec le journal (6 ans); compteurs de tentatives en mémoire seulement | Vercel, Neon |

On the client's phone, the site keeps `lx-me` (what they typed and links to their last bookings) and `lx-focus` (the booking just made) in local storage: not a cookie, never sent anywhere, cleared from `/confidentialite`. The public site sets no cookie and runs no analytics; the Comptoir's session cookies are strictly necessary. The fonts are served from the salon's own domain (`/fonts`, copied from `@fontsource` at build time): no page of the site asks Google Fonts or any other third party. Only the Comptoir's and client pages carry a CSP (`font-src 'self'`, `vercel.json`); the public pages have none, so `tests/unit/public-fonts.test.js` is what keeps them off third-party fonts.

## WordPress import

The run record of each import: `import.started`, `import.batch` and `import.finished` carry counts, WordPress booking numbers, days, opaque ids, the names of the services left unmatched and the names of the files, never a name, a number or an e-mail (the report rebuilds its lines from the client files at read time, « Client effacé » once erased). Import rows accept no field the schema does not name, so no import can set a consent: imported files are `marketing: false` with `marketingSrc: 'wordpress'` (never asked). The file names come from the owner's computer and sit in the chain, so they cannot be erased: name the exports without a client's name.

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

## Signed closures and the technical log

CPT-01a. Every Z, every month closure (the sum of its Z, with the period's grand total and the perpetual totals, BOFiP §170) and every year closure (the month numbered `fiscal.yearEndMonth` closes the year too) is sealed on the journal hash like a Z, then **signed** by the tick that follows (`server/commands/steps/fiscal.js`): Ed25519 over `{ ref, kind, of, seal, digest }`, where `digest` is the SHA-256 of the closure's record. `verifySeal` (`server/domain/fiscal.js`) checks one against a public key. The chain proves the journal was not edited by someone who could not recompute it; the signature, with a key kept outside the database, proves the closures were not rewritten by someone who could.

- **The key**: `LX_SIGN_KEY` (32 bytes, base64; see [operations](operations.md#environment-variables)). Without it a key is generated once and kept with the data (`source: store`): it signs, but whoever holds the database holds the key, so the owner's warnings say so until the variable is set (Réglages › Données › Système; Mise en route lists it once WP-10 reads the `fiscal` section's `golive`). The demo signs with a fixed, public key (`source: demo`), even when `LX_SIGN_KEY` is set. The key's id (first 16 hex characters of the SHA-256 of the raw public key) and its public key are written to the technical log the first tick they are used; GET `/api/v1/fiscal/log` returns every public key (`keys`), so a signature can be checked without the Comptoir.
- **The anti-rewrite rule**: a closure older than 36 h is signed only if it was already waiting when the current key first appeared (that key's backlog, signed `late`, « signée en retard »). Anything else that old stays « non signée » for good, unless a genuinely new key appears: a backlog is fixed when a key is first logged, so a key already seen (coming back after another, or logged again by whoever rewrites the tail) never gets a second one, and a tail of the journal rewritten and re-sealed cannot be signed quietly. Two deployments with different keys on one database each sign what is fresh with their own, without logging their key again. At most 100 signatures per tick, the fresh ones first. The demo, which writes its own past, signs everything.
- **The technical log** (`tech.logged`, GET `/api/v1/fiscal/log`, owner and managers): each signing key, each software version the first tick it runs (once: a build that runs again, after a rollback or beside another build on one database, is not logged a second time), and each restore. CPT-02 adds archives and exports.
- **The version** (`server/version.js`): `1.0 (a1b2c3d)`, the build being the deployed commit. Bump the **major** on any change to tickets, closures or the journal format (a version whose proof of compliance must be renewed, BOFiP §380), the **minor** for anything else.
- **Replay check**: `node scripts/replay-diff.mjs <journal>` replays a journal copy with the code of the checkout and prints the figures a code change must never move (Z and grand total, month closures, gift card and carnet balances, deposits held, client counts; members and loyalty once they exist). Run it on copies of the demo and production journals with the base and with the merged tip of each wave; any difference (`--compare <earlier output>`) is drift and fails the wave.

## Reporting a problem

Anything that looks like a security issue: stop using the affected feature, note the time, and contact whoever operates the installation. The activity log (Réglages › Journal) shows who did what and from which device.
