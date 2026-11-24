---
name: cabinet-learn
description: "Teach the Cabinet something new. Folds a piece of real evidence (a number from the salon's journal, a remark a client made, an interview, an analytics figure, a no-show rate) into the hypotheses ledger and the personas, with provenance, then regenerates the atlas and re-runs the tests. This is how the harness is trained: the expertise lives in the repository, so every future session starts with it."
argument-hint: "<the evidence, in your own words, with where it came from>"
---

# /cabinet-learn · train the Cabinet

The evidence: `$ARGUMENTS`. If it has no source (« I think… »), say it is a hypothesis (class **H**) and record it as one; do not promote an opinion to knowledge.

## What this protects

A persona is a hypothesis until the salon's own journal says otherwise. This skill is the only sanctioned way a hypothesis changes class, a persona's weight moves, or a claim is retired. It keeps **provenance** (what, when, how many) and never deletes a refuted claim: a refuted hypothesis is knowledge.

## Never put personal data in the repository

Names, phone numbers, e-mails, messages, birth dates of real clients **do not go into any file here**. Aggregate (« 14 of 62 new clients said… »), anonymise (« a client in his sixties »), or describe the pattern. The product erases personal data on request; the design harness must not become a place where it survives.

## Procedure

1. **Classify it.** O (observed in the product), J (validated on the journal), D (domain knowledge), V (a vendor's claim: needs the URL), H (a hypothesis). A number from the journal is J; a client's remark is anecdote (H, with the sample size stated).
2. **Find what it touches.** Search `design/programme/09-hypotheses.md` (the H-ids), `design/programme/08-seasons.md`, and the `evidence` arrays and `weight` fields in `design/personas/clients.mjs` and `staff.mjs`.
3. **Update the ledger** (`09-hypotheses.md`): add the result to the row (date, number, sample, source), change the class to **J** if confirmed, or strike the claim and note what replaces it if refuted. Add a new row (next H-id) if it is a new claim.
4. **Update the personas** (the `.mjs` files, never the generated Markdown). If a weight moves, keep each side summing to 1 (`validateRoster` checks it). If a claim is confirmed, change its `cls` and `source`; if refuted, correct the text and say so in the `evidence`.
5. **Regenerate and test:** `npm run ux:atlas && npm run ux:test`. Both must pass; the atlas test fails when the Markdown is stale.
6. **Say what changed**, plainly: which hypotheses moved class, which personas' weights moved and by how much, which checks' *priority* changes as a result (the persona view of the score will shift), and what the next cheapest test is.
7. Suggest `/cabinet` to re-score, but do not run it unprompted.

## When the evidence contradicts the product

If it shows the product's assumptions are wrong (say, the deposit costs more bookings than assumed, or the Parent is bigger than the Passionné), **say so plainly**, name the tension (`design/programme/tensions.mjs`) it bears on, and propose the change to the default ruling: do not soften it because the product is good.

## Rules

- One piece of evidence, one change set. If the argument bundles several, handle them one by one.
- Sample sizes are part of the claim: « 3 clients » is an anecdote, « 412 appointments » is data.
- Do not edit `design/programme/01-personas.md`, `02-moments.md` or `03-tensions.md` by hand: they are generated.
