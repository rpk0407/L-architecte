// Scoring: two views of the same checks, and no false precision.
//
// The jury view uses the four weights Awwwards publishes on its evaluation page (Design 40, Usability 30, Creativity 20,
// Content 10: https://awwwards.com/about-evaluation) plus a fifth, Craft, which is ours: a developer-lens track for
// semantics, accessibility, performance and motion discipline (Awwwards runs its developer jury separately, afterwards; its
// sub-criteria are not reproduced here). Instruments can only measure part of that: Usability and Craft are scored from checks;
// Design, Creativity and Content are judgements, so they stay empty until the panel has spoken (panel.json). A total is only
// ever printed when all four jury axes exist; otherwise it is called partial and must not be compared with a full one.
//
// The persona view answers the barber-shop question instead: how well is each person served, weighted by how much of the
// shop they are (their weight is an assumption until the journal replaces it).

export const AXES = {
  design: { fr: 'Design', weight: 0.4, judged: true },
  usability: { fr: 'Usabilité', weight: 0.3, judged: false },
  creativity: { fr: 'Créativité', weight: 0.2, judged: true },
  content: { fr: 'Contenu', weight: 0.1, judged: true },
  craft: { fr: 'Métier', weight: null, judged: false }
};

/** How much of a check’s weight it earns. `info` earns nothing and costs nothing. */
export const POINTS = { pass: 1, warn: 0.5, fail: 0 };

/** When both the instruments and the panel have an opinion on an axis: how much each counts. */
export const BLEND = { usability: { instruments: 0.6, panel: 0.4 }, craft: { instruments: 0.7, panel: 0.3 } };

/** 0–10 from a set of checks, weighted by each check’s own weight; null when nothing was measured. @param {import('./harness.mjs').Check[]} checks */
export function scoreOf(checks) {
  const m = checks.filter((c) => c.status !== 'info');
  const tally = { n: m.length, pass: 0, warn: 0, fail: 0, info: checks.length - m.length };
  let got = 0, max = 0;
  for (const c of m) { tally[c.status]++; got += POINTS[c.status] * c.weight; max += c.weight; }
  return { score: max ? +((10 * got) / max).toFixed(2) : null, ...tally };
}

/** The instrumented score of every axis. @param {import('./harness.mjs').Check[]} checks */
export function axisScores(checks) {
  return Object.fromEntries(Object.keys(AXES).map((a) => [a, scoreOf(checks.filter((c) => c.axis === a))]));
}

/** Each persona’s score from the checks that name them, and the client headline weighted by who they are. */
export function personaScores(checks, personas) {
  const out = {};
  for (const p of personas) out[p.id] = { ...scoreOf(checks.filter((c) => (c.personas || []).includes(p.id))), weight: p.weight, kind: p.kind };
  const headline = (kind) => {
    const rows = personas.filter((p) => p.kind === kind && out[p.id].score != null);
    const w = rows.reduce((a, p) => a + p.weight, 0);
    return w ? +(rows.reduce((a, p) => a + p.weight * out[p.id].score, 0) / w).toFixed(2) : null;
  };
  return { byPersona: out, clients: headline('client'), staff: headline('staff') };
}

/**
 * Fold the panel’s judgement (panel.json) into the instrumented axes.
 * @param {ReturnType<typeof axisScores>} inst @param {{ axes?: Record<string, { score: number }> } | null} panel
 */
export function jury(inst, panel) {
  const axes = {};
  for (const [a, def] of Object.entries(AXES)) {
    const i = inst[a].score, p = panel && panel.axes && panel.axes[a] ? panel.axes[a].score : null;
    let final = null, basis;
    if (def.judged) { final = p; basis = p == null ? 'awaiting the panel' : 'panel'; }
    else if (i != null && p != null) { const b = BLEND[a]; final = +(i * b.instruments + p * b.panel).toFixed(2); basis = `instruments ${b.instruments * 100}% · panel ${b.panel * 100}%`; }
    else { final = i; basis = i == null ? 'not measured' : 'instruments only'; }
    axes[a] = { fr: def.fr, weight: def.weight, instruments: i, panel: p, final, basis, counts: inst[a] };
  }
  const four = ['design', 'usability', 'creativity', 'content'];
  const have = four.filter((a) => axes[a].final != null);
  const wsum = have.reduce((s, a) => s + AXES[a].weight, 0);
  const total = have.length ? +(have.reduce((s, a) => s + AXES[a].weight * axes[a].final, 0) / wsum).toFixed(2) : null;
  return { axes, total, partial: have.length < four.length, covers: have.map((a) => AXES[a].fr) };
}

/** How serious a failing or wavering check is, for the punch list. */
export function severity(c) {
  if (c.status === 'fail') return c.weight >= 4 ? 'blocker' : c.weight === 3 ? 'major' : 'minor';
  if (c.status === 'warn') return c.weight >= 3 ? 'minor' : 'note';
  return null;
}
