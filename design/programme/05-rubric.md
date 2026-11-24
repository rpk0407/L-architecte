# The rubric

How the Cabinet scores, how a judge must argue, and what a ten means for a four-chair barbershop in Marseille.

## Two views of the same evidence

**The jury view** uses the four weights Awwwards publishes on [its evaluation page](https://awwwards.com/about-evaluation): **Design 40 · Usability 30 · Creativity 20 · Content 10**. Awwwards runs its developer jury separately, afterwards; its sub-criteria are not reproduced here. The Cabinet adds a fifth, **Craft**, outside the weighting: semantics, accessibility, performance and motion discipline, the things a developer would feel before naming. Its sub-criteria are ours.

**The persona view** answers the barber-shop question instead: how well is each person served? Each persona’s score is the share of the checks that name them, weighted by how much of the shop they are (a hypothesis, until the journal replaces it).

## What the instruments can and cannot score

| Axis | Weight | Instruments | Panel |
|---|---|---|---|
| Design | 40% | one signal (the dark first screen) | **yes**: the art director |
| Usability | 30% | **most of it** (60%) | yes (40%): the UX architect, the persona voices |
| Creativity | 20% | none | **yes**: the art director, the motion and craft lens |
| Content | 10% | the questions a page answers | **yes**: the content designer |
| Craft | separate | **most of it** (70%) | yes (30%): the craft engineer |

A script cannot judge whether a hero is beautiful. So Design, Creativity and Content stay **empty** until the panel has spoken, and a total is printed **only when all four jury axes exist**; otherwise it is called partial and must not be compared with a full one. The blend where both speak is in `design/instruments/lib/score.mjs` (`BLEND`).

## The evidence rule

**No claim without evidence.** Every finding the panel makes cites at least one evidence id from the run (`E-pouce-01`, a screenshot; `E-rue-05`, the text the first viewport said) or a check id (`rue.q.open`). A critique that cannot point at something the run captured is an opinion, and opinions go in the « Voices » section, labelled as such.

## Anchors: what the numbers mean here

Behaviourally anchored: each level says what you would *see*. Scores are for this shop on its own terms, against what a four-chair neighbourhood barbershop with a considered brand could be.

| | Design | Usability | Creativity | Content |
|---|---|---|---|---|
| **2** | A template; the razor-and-gold of every barbershop | A person gives up | Nothing to remember | Words that could belong to any shop |
| **4** | Coherent but generic; photography that is not theirs | Gets there with effort; mistakes are easy | One decent idea, applied once | Clear, flat, forgettable |
| **6** | A real system (type, colour, spacing) used with some care | The main path is smooth; edges are rough | A signature moment, not carried through | The voice is there, rules are said plainly |
| **8** | Unmistakably this shop; the details hold up when looked at closely | Every persona’s main path is easy; edge cases are handled | A system of surprises that all say the same thing | The voice carries the rules, the errors, the empty states |
| **10** | Someone would copy it, and fail, because it is the people | A stranger, a regular and the owner all think « of course » | The one site in the city that could only be theirs | You could hear it in the room |

**Calibration note.** The current site sits well above the middle on Design and Content by every sign the harness can see (a real typographic system, self-hosted fonts, a voice, a confirmation that names everything); the instruments find its weaknesses at the edges, not the centre. A panel that scores it a 5 has not looked; a panel that scores it a 10 has not tried to book on a 320 px phone on a weak signal.

## Severity

| | When |
|---|---|
| **Blocker** | a failing check of weight 4 or more: a person cannot do the job |
| **Major** | a failing check of weight 3 |
| **Minor** | a failing check of weight 1–2, or a wavering check of weight 3 or more |
| **Note** | a wavering check of weight 1–2 |
| **Decision** | not a defect: a choice for the owner (marked `decision: true`) |

## What the panel hands back: `panel.json`

```json
{
  "date": "2026-11-07", "run": "20261107-153000",
  "lenses": ["art-director", "ux-architect", "content-designer", "access-lead", "craft-engineer", "motion-director", "owner-advocate", "persona-voice"],
  "axes": {
    "design":     { "score": 8.4, "rationale": "…", "evidence": ["E-pouce-01", "E-rue-04"] },
    "usability":  { "score": 7.5, "rationale": "…" },
    "creativity": { "score": 8.8, "rationale": "…" },
    "content":    { "score": 8.6, "rationale": "…" },
    "craft":      { "score": 8.0, "rationale": "…" }
  },
  "reserves": [ { "severity": "major", "title": "…", "from": "art-director", "persona": ["nouveau"], "evidence": ["E-rue-04"], "proposal": "…" } ],
  "praise":   [ { "title": "…", "from": "…", "evidence": ["…"] } ],
  "tensions": [ { "id": "T-01", "ruling": "…" } ],
  "voices":   [ { "persona": "ancien", "says": "first-person think-aloud", "abandonsAt": "the step he would stop at" } ]
}
```

`lenses` names the agents that took part: the dossier says « 3 regards sur 8 » and calls the jury partial when fewer than all eight did, so a dry run is never mistaken for a verdict.

Save it as `.lx-data/ux/<run>/panel.json`, then `npm run ux:report` folds it into the dossier and the score.
