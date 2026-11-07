# Le Cabinet

The design harness of Barber L’Architecte: a senior design team, written down so that it survives the session that wrote it.

It has three parts and one rule, and a studio that uses them to make things (see `design/redesign/`).

```
 THE PROGRAMME          THE INSTRUMENTS               THE PANEL                 THE DOSSIER
 who they are,          Playwright, as each persona,  eight specialist agents,  one page: the verdict,
 what they decide  ───▶ at a pinned moment, on a  ───▶ each looking at the  ───▶ what to protect, what to fix,
 (data the tests run)   real device and network       evidence, none overruling  where two good things
                        and measure the real site     a measurement              collide, who each is for
                                  │                              │
                                  └────── the ratchet: what was good stays good ──────┘
```

**The rule: the instruments measure, the panel judges, the director synthesises.** A script cannot tell whether a hero is beautiful, so Design, Creativity and Content stay empty until the panel has spoken; a person cannot count tap targets, so Usability and Craft are mostly instrumented. Every claim cites an evidence id.

## Quick start

```bash
npm ci
npm run build                 # the trials drive the built app
npm run ux                    # all 12 trials, about four minutes → .lx-data/ux/<run>/dossier.html
npm run ux -- --only=rue,pouce --persona=nouveau
npm run ux:gate               # compare with design/baseline.json (fails on regressions only)
npm run ux:calibrate          # prove the instruments tell a good page from a bad one
npm run ux:test               # the pure-logic tests, no browser
npm run ux:atlas              # regenerate the programme files from the personas' data
```

Then, in Claude Code: `/cabinet` for a full review, `/cabinet-walk ancien` for one person aloud, `/cabinet-impact <a change>` before building, `/cabinet-learn <evidence>` when the salon tells you something.

## What is in it

| Where | What |
|---|---|
| `design/programme/` | The knowledge: [the shop](programme/00-shop.md), [personas](programme/01-personas.md), [moments](programme/02-moments.md), [tensions](programme/03-tensions.md), [principles](programme/04-principles.md), [rubric](programme/05-rubric.md), [anti-patterns](programme/06-anti-patterns.md), [lexicon](programme/07-lexicon.fr.md), [seasons](programme/08-seasons.md), [hypotheses](programme/09-hypotheses.md), [panel protocol](programme/panel-protocol.md). `01`–`03` are generated. |
| `design/personas/` | The thirteen personas as **executable data** (`clients.mjs`, `staff.mjs`), the questions they ask a page, the schema and the atlas generator. |
| `design/instruments/` | The harness: `lib/` (server on a pinned clock, scenes, in-page measurement, contrast on pixels, scoring, ratchet, booking driver), `trials/` (the twelve), `report/` (the dossier), `cli.mjs`. |
| `design/calibration/` | 25 labelled pages and the verdict each instrument must reach on them. |
| `design/tests/` | 27 pure-logic tests (WCAG arithmetic against published values, scoring, the ratchet, roster integrity, drift guards). |
| `design/baseline.json` | The ratchet’s memory: what was good when a human last accepted a run. |
| `.claude/agents/`, `.claude/skills/` | The panel (eight critics, read-only) and the studio (six makers: concept designer, creative director, type designer, graphic designer, copywriter, creative developer), and the four workflows. |
| `design/redesign/` | The redesign phase: [`BRIEF.md`](redesign/BRIEF.md) (R1–R10, what to protect, the anti-generic rules), [`CONTENT.md`](redesign/CONTENT.md) (the shop’s real content), `concepts/<slug>/` (one concept each: `CONCEPT.md` and a visual `board.html`) and `audit-board.mjs`, which screenshots a board and measures it with the harness’s instruments. |

## The personas are executable

A persona owns **scenes**: a pinned clock, a device, a network, a colour scheme, an intent and the trials to run. Adding a scene adds browser coverage without touching a trial.

```js
{ id: 'presse.nuit', label: '23:12 in bed, dark mode, one thumb, the shop is closed',
  clock: 'mar-23h12', device: 'phone', network: '4g', scheme: 'dark',
  intent: 'Book the earliest slot with anyone, then survive the keyboard and a dropped signal',
  trials: ['chrono', 'nuit', 'clavier', 'tram', 'retour'], flow: 'fastest' }
```

The clock is real: the demo salon is started with `LX_FAKE_NOW`, so a scene happens on a closed Tuesday night or at the Saturday rush. Eight clocks are pinned (`design/instruments/lib/surface.mjs`), one server per distinct clock.

## The twelve trials

| Trial | The situation | What it asks |
|---|---|---|
| `rue` | Standing in the square, a weak signal, five seconds | Seven questions at the door; a real filmstrip; first paint; weight |
| `pouce` | One thumb, three phone sizes | Target sizes (with WCAG 2.5.8’s own spacing exception), fixed UI over content, controls covered at rest and at the foot |
| `chrono` | Booking, as four personas | Taps, characters, seconds against each persona’s budget; the price, the deposit, the confirmation |
| `clavier` | The keyboard is half the screen | Is the field he is typing in still visible? |
| `tram` | The signal drops; a child shouts; an impatient thumb | A human message, fields kept, resume where he left, no false « slot taken » |
| `retour` | Back, a shared link, Escape, Tab | The Back button, deep links, focus in and out of the sheet |
| `nuit` | 23:12, dark, the shop closed | The truth about being closed; the dark first screen; contrast; reduced motion |
| `ancien` | Large print, a wide thumb | Reflow at 320 px, text size, contrast over photographs, names, a number to call, timers |
| `guichet` | The gift, training and cancellation pages | The question each visitor brings: answered in words, or not |
| `mains` | The Comptoir with wet hands | PIN keypad, status buttons, till targets, privacy, the owner’s one-screen verdict |
| `atelier` | A developer’s eye | Semantics, the Tab walk, motion cost, images, interaction speed, the page without JavaScript |
| `duo` | A parent, two sons | Can he say « two people » anywhere? |

## Scoring, and why it is cautious

- **Jury view:** Design 40 · Usability 30 · Creativity 20 · Content 10 (the weights [Awwwards publishes](https://awwwards.com/about-evaluation)), plus **Craft**, a separate track of ours. A total is printed **only when all four jury axes exist**; otherwise it is labelled partial.
- **Persona view:** how well each person is served, weighted by how much of the shop they are (a hypothesis until the journal replaces it).
- A check is `pass`, `warn` (half), `fail`, or `info` (counted for nothing). Weights run 1–5; severity follows from status and weight. See [the rubric](programme/05-rubric.md).

## The ratchet

`npm run ux:gate` compares a run with `design/baseline.json`. It fails on **regressions** (a pass that became a fail, a heavy pass that wavered, an axis down by 0.3, a persona down by 0.5, a new failing check of weight 4+) and never on what was already wrong. `npm run ux:gate -- --update` accepts a run as the new baseline: it is a decision, so it is never automatic. To wire it into CI: `npm run build && npm run ux && npm run ux:gate`.

## Calibration: how the instruments are « trained »

An instrument that cannot tell a good page from a bad one cannot judge the shop. `design/calibration/cases.mjs` holds labelled pages and the verdict each instrument must reach: all-48-px buttons, twenty-pixel icons two pixels apart, #999 on white (2.85:1, the published value), white text across a gradient. The cases that matter most are the **adversarial near-misses found while building the harness**: a sticky hero counted as an overlay, a colour cache shared between elements, « 13013 Marseille » read as « 13 mars ». Add a case whenever an instrument is wrong in the field; never loosen one to make a run pass.

## Extending it

- **A persona or scene:** edit `design/personas/clients.mjs` or `staff.mjs`, run `npm run ux:atlas`, `npm run ux:test`.
- **A question a page must answer:** add it to `design/personas/questions.mjs`.
- **A check:** in the trial, `h.check({ id, title, axis, weight, status, … personas, evidence, fix })`. Ids are stable: the ratchet remembers them.
- **A trial:** `design/instruments/trials/<id>.mjs` exporting `meta` and `run(h)`; add the id to `TRIALS` in `design/personas/schema.mjs` (a test keeps the registry and the folder in step).
- **An instrument:** add it to `lib/inpage.mjs`, then **a calibration case first**.
- **The markup changed:** `design/instruments/lib/surface.mjs` is the one file that knows the selectors.

## Limits, said plainly

- **A laboratory, not a field.** The demo salon, a pinned clock, Chromium, throttled latency and CPU. Load times are upper bounds (a local server sends nothing compressed): read them run against run.
- **No real phone, no screen reader, no production data.** The keyboard is emulated by shortening the viewport; the screen-reader view is the agents’ reasoning, not VoiceOver’s.
- **The personas are hypotheses.** The independent research on barber-shop UX is thin; much of what is published is by software vendors. See [the ledger](programme/09-hypotheses.md) for how to test each claim.
- **The panel is a model reasoning from evidence**, not a user. It is useful because it must cite what it saw, and dangerous when it is trusted more than the instruments or the salon.
- **Nothing here replaces watching three real clients book on their own phones.** Do that too.
