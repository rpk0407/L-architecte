# Barber L'Architecte · Le Comptoir

The salon's own system, replacing the WordPress setup: the public site where clients book, and **Le Comptoir**, the screen the owner and the team run the shop from (agenda, till, clients, follow-ups, figures, team, catalogue, settings).

| URL | What | Who |
|---|---|---|
| `/` (also `/site`) | The public site with live booking | clients |
| `/demo` | Demo landing page: how it works, demo access (goes to `/` outside the demo) | the owner, during the demo |
| `/comptoir` | Le Comptoir, the back office | owner, managers, front desk, barbers |
| `/r/:token` | "Mon rendez-vous": confirm, pay the deposit, move, cancel | a client, from the SMS link |
| `/paiement/:id`, `/recu/:token` | Test checkout (until Stripe is connected), receipt | clients |

## Run it

```bash
npm ci
npm run build          # the Comptoir and client pages (Vite) into dist/, with public/ (LX_INDEX=1: indexable by search engines)
npm start              # http://localhost:3000, demo salon with ten weeks of history
npm test               # unit and API tests (node:test), 79 tests
npm run test:e2e       # browser end to end on the demo salon, then on a fresh production salon (needs Playwright's Chromium)
npm run typecheck      # server (JSDoc) and web (TypeScript strict)
```

For development, `npm run dev` (API, data kept in `.lx-data/`) together with `npm run dev:web` (Vite, hot reload on :5173). `LX_FAKE_NOW=2026-10-27T15:10:00+01:00 npm start` pins the clock to a busy Tuesday afternoon (it is ignored in production).

Demo access (demo mode only): owner `gerant@larchitecte.fr` / `Architecte13`. Barbers sign in with a PIN on a salon device: JKut 2468, Frank 1357, Le Soldat 8642, Esteban 9753. On the login screen, "Faire de ce navigateur un poste du salon" turns the browser into a salon device.

## How it is built

```
public/          the site (site.html), the demo landing page, images
web/             Vite + React 19 + TypeScript: the Comptoir (web/src/comptoir) and the client pages (web/src/client)
api/main.js      the one Vercel Function; every /api/* route goes through it
server/
  core/          the journal (hash chain), the projection (state.js), the engine (commands, optimistic concurrency)
  commands/      every write: agenda, sales, clients, team, catalogue, settings, payments, messages, system tick
  domain/        availability, permissions, deposit policy, insights (reports), cash (Z), messages, demo seed
  http/          router, auth and session cookies, public/staff/admin routes, views, scheduler
  store/         memory, file (local), Vercel Blob, Postgres: same contract, same tests
  payments/      Stripe over REST (no SDK) and a simulated provider
  messaging/     Brevo or Twilio SMS
shared/          dates and money, shared by the server and the browser so the till and the ticket always agree
tests/           unit, API flows, store contract, end to end
docs/            architecture, security, operations, demo script, roadmap
```

Every change is an **event** appended to a journal, each one carrying the SHA-256 of the previous: the state is rebuilt from it, nothing is ever updated in place, and anyone can verify that no sale was altered (Réglages › Données). Personal data sits next to each event, outside the chain, so a client can be erased (GDPR) without breaking the proof. More in [docs/architecture.md](docs/architecture.md).

## Documentation

- [Architecture](docs/architecture.md): the journal, the engine, the stores, the request pipeline, performance.
- [Security](docs/security.md): authentication, roles, devices, cookies, payments, personal data.
- [Operations](docs/operations.md): environment variables, going live (Postgres, Stripe, SMS, domain), the scheduler, backups, incidents.
- [Demo script](docs/demo-script.md): a 15-minute walk-through for the owner.
- [Roadmap](docs/roadmap.md): what comes next, client side and salon side.
