---
name: cabinet-walk
description: "Walk one persona through the product, aloud. Runs that persona's scenes against the built app, then has the persona-voice agent think aloud over the evidence in the first person and say exactly where they would give up. Use to feel a change from the inside of one person, or to prepare for a persona-focused fix."
disable-model-invocation: true
argument-hint: "<persona id: fidele | nouveau | presse | parent | occasion | passionne | ancien | abonne | cadeau | futur | barbier | accueil | gerant>"
---

# /cabinet-walk · one person, aloud

Persona: `$ARGUMENTS`. If it is empty or unknown, run `npm run ux:list`, show the thirteen ids, and ask which.

## 1 · Find their scenes

Read the persona's entry in `design/programme/01-personas.md` (the **Scenes the harness runs** table). Each scene lists the trials to run. For `ancien` that is `ancien`; for `presse`, `chrono, nuit, clavier, tram, retour`.

## 2 · Run only those

The trials drive the built app (`npm run build` first if `dist/` is missing):

```bash
npm run ux -- --persona=<id> --only=<their trials> --run=walk-<id>
```

The run is written to `.lx-data/ux/walk-<id>/` (with a dossier you can mention but not rely on: it covers one persona only).

## 3 · Let them speak

Start the `persona-voice` agent with: the persona id, the run directory, and `design/programme/panel-protocol.md`. Tell it to **look at the screenshots** of this persona's scenes and to think aloud in the first person. (If `persona-voice` is not registered, start a `general-purpose` agent with the body of `.claude/agents/persona-voice.md` as its instructions.)

## 4 · Hand it back

Present, in this order:

1. **The walk** in the persona's own voice, as the agent returned it, with the evidence ids it reacted to.
2. **Where they would stop**, in one sentence, and the one change that would keep them.
3. **What delighted them**: what they would tell a friend. A persona who is happy is information too.
4. **What the instruments say about them**: the failing and wavering checks that name this persona (`personas` contains their id), with values.
5. If the user wants it kept, save the voice line into `.lx-data/ux/walk-<id>/panel.json` under `voices` (shape in `design/programme/05-rubric.md`) and run `npm run ux:report -- --run=walk-<id>`.

Never present the voice as the person's real opinion: it is a composite reasoning from evidence. Say so once, plainly.
