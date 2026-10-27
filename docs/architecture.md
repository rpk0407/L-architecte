# Architecture

## One journal, one truth

Everything the salon does (a booking, a sale, a price change, a cash count) is a **command**. A command reads the current state, checks the rules, and emits one or more **events**. Events are appended to the journal; the state is the result of applying every event in order (`server/core/state.js`, `evolve`). Nothing is updated in place.

```
command (server/commands/*.js)            pure: run(state, input, ctx) → events
   │  ctx.need('sale.create')             permission, checked on the server for every write
   ▼
engine.run (server/core/engine.js)        seals the events, appends them with optimistic concurrency, retries on conflict
   │
   ▼
store.append(events, epoch)               memory · file · Vercel Blob · Postgres (same contract, same tests)
   │
   ▼
state = evolve(state, event)              the projection every screen reads
```

Each event carries `p` (the previous event's hash) and `h` (its own SHA-256 over the previous hash and its content). Changing or removing any past event breaks every hash after it: `verifyChain` (Réglages › Données) walks the whole journal and says exactly where. Z closures store the hash of the journal at the moment of closing (their seal) and a perpetual grand total.

Personal data (names, phone numbers, notes) travel next to the event in a `pii` field. Only its hash is chained. Erasing a client (GDPR) blanks the `pii` of their events: the chain still verifies, the accounting stays intact, the person is gone.

## Concurrency and idempotency

- **Optimistic concurrency**: the engine appends at the version it read. If another server wrote first (two phones booking the same chair at the same second), the store refuses, the engine re-reads, re-runs the command against the new state, and only one booking wins. Tested in `tests/unit/agenda.test.js`.
- **Idempotency**: every write from the Comptoir carries an `x-request-id`. A request retried after a network drop returns the first result instead of charging twice. The till keeps one id per ticket. Retried on another instance (or after a restart), the answer is rebuilt from the events the first request wrote (`server/core/replay.js`); a gift card's full code is the one thing it cannot show again.
- **Holds**: a slot being filled in on the site is held for 5 minutes (`appt.held`), so the client doesn't lose it while typing. A pending deposit holds its slot until `deposit.until`, set at booking from the salon's setting (raised to at least 31 minutes with Stripe, whose checkout page lives that long); after that the slot is free again even before the scheduler runs (`occupies`), and a payment that arrives later is only kept if the slot is still free (otherwise it is refunded).

## Stores

| Store | When | Notes |
|---|---|---|
| Postgres (`DATABASE_URL`) | **production** | table `lx_events` (PK epoch, v), unique violation = conflict. Neon or Supabase from the Vercel marketplace. |
| Vercel Blob (`BLOB_READ_WRITE_TOKEN`) | small production, no database | `head.json` updated with ETag compare-and-swap, events in immutable segments of ~1000. |
| File (`LX_DATA_FILE`) | local development | one JSON line per event. |
| Memory | tests, throwaway demo | gone on restart. |

All four pass the same contract tests (`tests/unit/stores.test.js`; the Postgres part runs when `TEST_DATABASE_URL` is set, `npm run test:pg`).

## Requests

One Vercel Function (`api/main.js`) serves every `/api/*` route through `server/http/app.js`:

1. route match, then same-origin check for writes (Sec-Fetch-Site / Origin), JSON bodies only, 64 KB max;
2. the runtime (store, engine, providers) is built once per instance and reused;
3. the engine syncs with the store (at most every 1.5 s on shared stores), so several instances stay consistent; when the store does not answer, reads are served from the instance's memory for up to 10 minutes (header `x-lx-stale: 1`, a red strip in the Comptoir) and writes are refused with a 503 before anything happens;
4. session and device cookies are verified against the live state (a revoked person or device is out at once);
5. the route's capability is checked, then the handler runs.

Route families: `/api/public/*` (site and client pages, no account), `/api/auth/*`, `/api/v1/*` (staff), `/api/stripe/webhook`, `/api/cron/tick`.

## Background work

The scheduler (`server/http/scheduler.js`) sends reminders, expires holds and unpaid deposits, offers freed slots to the waiting list, asks for reviews, and delivers queued SMS. It runs at most once a minute, carried by traffic: the Comptoir's pulse (every 4 s while open) and the public site. For quiet hours, point an external cron at `/api/cron/tick` (see [operations](operations.md)). Message ids are deterministic (kind + target), so two instances ticking at once never send the same reminder twice.

## The Comptoir (web/)

React 19 + TypeScript (strict), built by Vite into `dist/`. No UI library: a small design system (`web/src/ui`) with its own icon set, self-hosted fonts (Instrument Sans and Serif), dark and light themes, and a privacy mode that blurs amounts when a client looks at the screen.

- `state.tsx` loads the bootstrap (who is signed in, settings, team, catalogue) and polls `/api/v1/pulse` every 4 s: when the journal version moves, cached queries refresh and new bookings show up in the feed with a toast.
- Pages are lazy-loaded; the agenda and the till load first. React vendor ≈ 70 KB gzip, each page 5 to 25 KB.
- Barbers on a salon device sign in with a PIN; the screen locks itself after 4 minutes without a touch, and the server refuses a PIN session after 10 minutes without a request (`pin_idle`), even if the tablet's own lock never ran.

## The site (public/site.html)

The existing site is kept as designed. Its booking engine (`LXE` inside the page) now reads the salon's catalogue, barbers, hours, closures and free slots from `/api/public`, holds the slot on the server, books, takes the deposit, moves and cancels through signed links, and puts people on the waiting list. Prices on the page follow the catalogue: a price changed in the Comptoir is the price on the site. So do the team section (the real barbers, their bio and Instagram from Équipe), the salon's Instagram (Réglages › Salon), the hours in words, the FAQ's prices (`menu`: every active service), the closure and opening banners, and the JSON-LD and meta description. The rest (hero and house texts, the FAQ's questions and words, reviews, photos, the Facebook and YouTube links) is fixed in `site.html`: the owner does not edit the site, a change there goes through the provider.

## Performance and scale

A salon writes a few hundred events a day; ten years is a few million. The projection lives in memory per instance and is rebuilt from the store on a cold start (thousands of events per second). Reports are memoised per journal version. Public availability answers are cacheable for a few seconds at the edge (`s-maxage=5`), holds and bookings are never cached. If the journal ever grows past what a cold start should replay, the next step is a periodic snapshot of the state stored next to the journal; the event format already allows it.
