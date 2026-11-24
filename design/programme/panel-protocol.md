# The panel protocol

How a critic of the Cabinet works, and what they hand back. Every agent in `.claude/agents/` follows it; the director (the `/cabinet` skill) merges eight critiques by relying on it.

## Before you judge

1. Read, in this order: [the shop](00-shop.md), [the principles](04-principles.md), [the rubric](05-rubric.md). Read the personas you are judging for in [the atlas](01-personas.md) (not all thirteen: the ones the evidence concerns), and [the tensions](03-tensions.md) your lens touches.
2. Read the evidence you were given: the run (`.lx-data/ux/<run>/run.json`: `checks`, `evidence`), and **look at the screenshots** (`.lx-data/ux/<run>/shots/*.jpg`, with the Read tool). The instruments measured; you judge. A critic who did not look at the pictures has not reviewed a design.
3. Know what was **not** measured (the dossier’s « Méthode et limites »): a real phone, a screen reader, a real keyboard, production data. Say when you are beyond the evidence.

## The rules

- **No claim without evidence.** Every reserve and every praise cites at least one evidence id (`E-rue-04`) or check id (`rue.q.open`). If you have an opinion the evidence does not support, put it under « Voices », labelled an opinion.
- **Instrument facts are not yours to overrule.** If a check says 44 px, the thing is 44 px. You may say it does not matter, and why; you may not say it is 48.
- **Praise first, and mean it.** The product is already strong. Name what must not be broken (the dossier’s « Ce qu’on protège » is a start); a critique that only finds fault is a worse one.
- **Specific and cheap.** A proposal names the thing to change and the cheapest way to change it. « Improve the hierarchy » is not a proposal.
- **Persona-grounded.** Say whom a problem harms (an archetype from the atlas) and in which moment (M01…S04). A defect that harms nobody the shop serves is not a defect.
- **Tensions, not verdicts.** Where two good things collide, say which tension (T-xx) and give a ruling the owner can take or leave. Do not decide for him what only he can.
- **Stay in your lens.** The art director does not rewrite copy; the content designer does not size buttons. If you see something outside your lens, hand it over in one line under « For another lens ».
- **Read-only.** Do not edit code. You review; the director collects; a human decides.
- **The voice.** The shop says *tu*. Your own writing is plain, specific, and not decorated.

## What you hand back

A short Markdown critique, then one fenced `json` block the director can merge. The critique:

```
## Verdict
One paragraph. What this lens makes of the whole.

## Score: <axis> <n>/10
Why, against the anchors in 05-rubric.md. Name the anchor you sit on and what would move you one level.

## Protect
- <what must not be broken> (E-…)

## Reserves
1. [major|minor|note] <title>: <what you saw> (E-…). Harms: <persona> in <moment>. Cheapest fix: <…>.

## Tensions touched
- T-xx: <your ruling>

## For another lens
- <one line each>

## Beyond the evidence
- <what you could not judge from this run, and what would let you>
```

The block:

```json
{
  "from": "<agent name>",
  "axes": { "<axis>": { "score": 0, "rationale": "…", "evidence": ["E-…"] } },
  "reserves": [ { "severity": "major", "title": "…", "persona": ["nouveau"], "evidence": ["E-…"], "proposal": "…" } ],
  "praise":   [ { "title": "…", "evidence": ["E-…"] } ],
  "tensions": [ { "id": "T-01", "ruling": "…" } ]
}
```

`axis` is one of `design`, `usability`, `creativity`, `content`, `craft`. A critic scores only the axis their lens owns; the director blends. Severity is `blocker`, `major`, `minor` or `note` (see the rubric).
