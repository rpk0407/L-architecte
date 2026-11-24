---
name: cabinet-impact
description: "Before building a change to the booking sheet, the public site or the Comptoir, map its impact on the personas, moments of truth, house principles, tensions and protected behaviours, and say which checks to watch or add. Read-only, no browser; use it at the start of any UI or UX change, and when someone proposes a new feature."
argument-hint: "<the change, in a sentence>"
allowed-tools: Read Grep Glob
---

# /cabinet-impact · before you build

The change: `$ARGUMENTS`. If it is vague, restate it in one precise sentence and say what you assumed.

Read `design/programme/00-shop.md`, then only the parts of the atlas, the moments, the principles, the tensions and the hypotheses that the change touches (`design/programme/0*.md`). Read the code the change would touch; do not edit anything.

## Produce this, and nothing longer

**The change, restated.** One sentence, and what you assumed.

**Who it helps, who it hurts.**

| Persona | Moment | Effect | Why |
|---|---|---|---|
| (an archetype from the atlas) | (M01…S04) | helps / hurts / neutral | (one clause, in their terms) |

Include the persona it is *for* and the persona most likely to be hurt by it. If you cannot name a persona it helps, say the change has no client.

**Principles touched.** P1…P13, and whether the change honours or strains each.

**Tensions touched.** T-01…T-10: which, and the default ruling's view of this change. Flag any that are the owner's to decide.

**What is protected near it.** The « Ce qu'on protège » behaviours within reach of the change (`protect: true` checks, the persona's `protect` list). Name the existing check that would catch a regression.

**Checks to watch and to add.** Existing check ids that will move (`rue.q.open`, `pouce.overlap.*`, …); new checks or calibration cases the change deserves (a trial, a persona scene, a case in `design/calibration/cases.mjs`). If the change adds a path no persona walks, say which persona and scene to add.

**The smallest version.** The cheapest version that captures most of the gain, using what already exists in the product (the hero's notice slot, the sheet's confirmation, a `min-height`).

**What to learn first.** The hypothesis in `design/programme/09-hypotheses.md` that decides whether this is worth doing, and the cheapest way to test it on the salon's journal.

**Verdict.** `go`, `go small`, or `hold`, in one line with the reason.

## Rules

- Cite files and ids, not impressions.
- Do not design the solution; map the consequences. If the change collides with a protected behaviour, say so first.
- A change that adds work for the front desk costs the shop every day: say how much.
