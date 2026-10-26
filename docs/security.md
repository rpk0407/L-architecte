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

## Payments

- **Stripe Checkout**: card data never touches the salon's server. Amounts are computed on the server; the webhook is verified (signature, 5-minute tolerance, constant-time comparison) and idempotent. Refunds go through Stripe with an idempotency key.
- The demo refuses live Stripe keys, so a demo can never charge anyone.
- At the till, card payments go through the salon's own terminal; the Comptoir records them.

## Personal data (GDPR)

- Collected: first name, phone, optionally last name, e-mail, notes, birthday. Purpose: managing appointments; marketing SMS only with consent (`marketing` flag), service SMS (confirmations, reminders) with an opt-out.
- Barbers see masked numbers (`06 •• •• •• 42`). Exports of the client file are owner-only.
- Erasure: client file › ⋯ › Effacer (RGPD). Personal data is removed from the state and from every event; tickets stay in the accounts without the name; the journal still verifies.
- Hosting: Vercel (EU region `cdg1`, Paris) and the chosen database (pick an EU region). Data belongs to the salon and can be exported at any time (Réglages › Données).

## Fiscal note (France)

Since 2018, software used to record sales must guarantee **inalterability, security, preservation and archiving** of the data (anti-fraud VAT law, art. 286 CGI), proved by a certificate (NF525 or equivalent) or a publisher's attestation. Le Comptoir implements the mechanisms (chained journal, numbered tickets without gaps, credit notes instead of edits, sealed Z closures with a perpetual grand total, archive export). **The formal certification or attestation is a separate step** to complete with the publisher before the till is used as the salon's official cash register; until then the salon's current certified till stays the legal one.

## Reporting a problem

Anything that looks like a security issue: stop using the affected feature, note the time, and contact whoever operates the installation. The activity log (Réglages › Journal) shows who did what and from which device.
