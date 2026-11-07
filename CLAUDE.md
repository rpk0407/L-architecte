# Barber L’Architecte · Le Comptoir

A barbershop in Marseille (13e) and the system that runs it: the public site with live booking, and **Le Comptoir**, the back office (agenda, till, clients, follow-ups, figures, team, catalogue, settings). Event-sourced: every change is an event in a hash-chained journal. UI text is French; docs are English. Read `README.md` and `docs/architecture.md` before touching the server.

## Commands

```bash
npm ci
npm run build          # Vite → dist/ (the Comptoir and client pages) + public/
npm start              # http://localhost:3000, demo salon with ten weeks of history
npm test               # unit and API tests (node:test)
npm run test:e2e       # browser end to end (needs Playwright's Chromium)
npm run typecheck      # server (JSDoc) and web (TypeScript strict)
npm run verify         # typecheck + test + build
```

## Design work: the Cabinet (`design/`)

Any task that touches what a person **sees, taps, reads or waits for** (the booking sheet, `public/site.html`, the static pages, the Comptoir’s screens, copy) goes through the design harness. Read **`design/README.md`** first; it is short.

- **Before building:** `/cabinet-impact <the change>` maps it onto the personas, moments, principles, tensions and the behaviours that must not break.
- **After building:** `npm run build && npm run ux -- --only=<trials>`, then `npm run ux:gate`. A regression fails the gate; fix it, or say plainly why it is accepted.
- **A full review:** `/cabinet`. One persona, aloud: `/cabinet-walk <id>`. New evidence from the salon: `/cabinet-learn <evidence>`.
- **The specialists** are in `.claude/agents/` (art director, UX architect, content designer, accessibility lead, craft engineer, motion director, the owner’s advocate, persona voice). They follow `design/programme/panel-protocol.md`: no claim without an evidence id, instrument facts are not overruled, praise what must be protected.

### Rules of the house

1. **Personas are hypotheses.** `design/programme/09-hypotheses.md` says how to test each against the salon’s journal. Never present a persona’s claim as a fact about real clients.
2. **Never put real personal data in `design/`** (names, numbers, messages of real clients). Aggregate or anonymise.
3. **Don’t break what works.** `design/programme/04-principles.md` and the « Ce qu’on protège » list in the dossier are the shop’s capital; the site is already strong, so the risk is losing what it has.
4. **The voice is *tu*** (see `design/programme/07-lexicon.fr.md`). Rules (deposit, cancellation, membership) are said once, plainly, before the button.
5. **Honest numbers.** No fake urgency, no invented scarcity; a demo is labelled as one.
6. **Generated files are not edited by hand:** `design/programme/01-personas.md`, `02-moments.md`, `03-tensions.md` come from the data (`npm run ux:atlas`).

### Redesign work: the studio (`design/redesign/`)

The goal of the current phase is **at least two genuinely different alternative redesigns of the public site**, made by a studio and not a template. `design/redesign/BRIEF.md` binds every designer (R1–R10, what to protect, the anti-generic rules); `CONTENT.md` is the shop's real content (invent nothing). Order of work: **concepts first, the owner chooses, then build**: never build a site the owner has not picked. A concept lives in `design/redesign/concepts/<slug>/` (`CONCEPT.md`, `board.html`); `node design/redesign/audit-board.mjs <board.html>` screenshots a board and measures it with the harness's instruments. The studio's roles are in `.claude/agents/`: `concept-designer`, `creative-director`, `type-designer`, `graphic-designer`, `copywriter`, `creative-developer`, alongside the eight critics.

`npm run ux:test` (34 pure-logic tests) and `npm run ux:calibrate` (the instruments judged on labelled pages) must pass before the harness itself is changed.
