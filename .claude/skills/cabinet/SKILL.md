---
name: cabinet
description: "Convene Le Cabinet, the design review for Barber L'Architecte. Runs the persona-driven instruments against the built app, then a panel of specialist agents (art director, UX architect, content designer, accessibility lead, craft engineer, motion director, the owner's advocate, persona voices) critiques the evidence, and the director merges it into one dossier. Use for a full review, after any change to the site or the Comptoir UI, or before a seasonal peak."
disable-model-invocation: true
argument-hint: "[all | trial,trial | persona=id,id]"
---

# /cabinet · convene Le Cabinet

You are the **director**. The instruments measure, the panel judges, you synthesise. You never overrule a measurement, never invent evidence, and never change code unless the user asks you to.

Scope from the user: `$ARGUMENTS` (empty means all twelve trials).

## 0 · Orient (two minutes)

Skim `design/README.md`, `design/programme/00-shop.md` and `design/programme/panel-protocol.md`. You will brief the panel with the protocol, so know it.

## 1 · Measure

1. The trials drive the **built** app. If `dist/comptoir/index.html` is missing, run `npm run build` first.
2. Run `npm run ux`. For a narrower scope: `npm run ux -- --only=rue,pouce` (trials) and/or `--persona=ancien` (scenes). It takes about four minutes for everything, and prints the score tables and writes the dossier.
3. Note the run id (`.lx-data/ux/latest.json` holds it). Print a digest, not the whole file:

```bash
node -e "const r=JSON.parse(require('fs').readFileSync('.lx-data/ux/'+JSON.parse(require('fs').readFileSync('.lx-data/ux/latest.json','utf8')).runId+'/run.json','utf8'));for(const c of r.checks.filter(c=>c.status==='fail'||c.status==='warn'))console.log(c.status.padEnd(4),c.id.padEnd(34),String(c.value??'').slice(0,60))"
```

4. If a trial reports `*.crashed`, that is a harness problem, not a verdict on the product: say so, and stop to fix or report it before convening anyone.

## 2 · Convene the jury

In **one message**, launch these agents in parallel (the Agent tool, `subagent_type` as named). Give each: the run directory (`.lx-data/ux/<run>/`), a pointer to `design/programme/panel-protocol.md`, and their scope. Ask each to return the critique and the JSON block.

| Agent | Scores | Needs to look at |
|---|---|---|
| `art-director` | Design, Creativity | the screenshots, the filmstrip |
| `ux-architect` | Usability | chrono, tram, retour, clavier, duo, rue |
| `content-designer` | Content | guichet, chrono (deposit, confirmation), every sentence in the evidence text |
| `access-lead` | Usability, Craft | ancien, mains, nuit, atelier, pouce |
| `craft-engineer` | Craft | atelier, rue, nuit, retour |
| `motion-director` | Creativity | the filmstrip, nuit, atelier motion checks |
| `persona-voice` ×3 | none (voices) | the three lowest-scoring personas from `npm run ux:score`, one agent each, with the persona id |

If the named agents are not registered (a freshly created `.claude/agents` needs a session restart), start `general-purpose` agents and give them the body of the agent's file as their instructions.

Then, **after** the others return, launch `owner-advocate` with the merged reserves (as text) and ask for the ranked shortlist, the things to leave alone, and the decisions for the owner.

## 3 · Synthesise `panel.json`

Write `.lx-data/ux/<run>/panel.json` in the shape of `design/programme/05-rubric.md`.

- **Scores.** `design` = the art director's. `creativity` = the mean of the art director's and the motion director's (if both gave one). `content` = the content designer's. `usability` = the mean of the UX architect's and the access lead's. `craft` = the craft engineer's, with the access lead's if given. The script does the blend with the instruments; give only the panel's number.
- **Reserves.** De-duplicate: the same check or evidence with the same remedy is one reserve, with the highest severity and every `from` listed. Keep at most twelve. Keep the owner advocate's order as the order.
- **Disagreements.** When two lenses disagree (the art director wants the pills, the access lead wants them gone), do **not** average: record both in the reserve, say they disagree, and put the owner advocate's ruling beside them.
- **Tensions.** Carry the rulings; where the panel gave different ones, give both.
- **Voices.** Take the persona voices' JSON lines as they are.
- **Lenses.** List in `lenses` the name of every agent that actually returned (the dossier calls the jury partial when fewer than eight did).
- Every item must still cite an evidence id. Drop what does not.

## 4 · Hand it over

1. `npm run ux:report` (folds `panel.json` into the dossier and the score).
2. Tell the user, briefly, in this order: the dossier path; the five things to do first (with cost and the check that will prove each done); what to protect; the decisions only the owner can take (phone number, « tu », a party-size capability); what the run could not judge.
3. Offer `npm run ux:gate -- --update` **only if the user asks** to accept this run as the new baseline. Never run it unprompted: it is a decision.

## Rules

- A finding the instruments do not support is an opinion; label it so.
- Do not edit product code. If the user then asks for a fix, make it, re-run the affected trials, and run `npm run ux:gate`.
- Be honest about the lab: a local server, a pinned clock, an emulated keyboard, no real phone, no screen reader, no production data.
