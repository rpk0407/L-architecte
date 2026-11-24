// The ratchet: what was good stays good.
//
// design/baseline.json remembers each check’s status, each instrumented axis score and each persona’s score at the last time a
// human accepted the run. `gate` compares a new run against it and fails on regressions only: a site this polished is far more
// likely to lose something it has than to find something it lacks. New findings are reported, never gated, unless they are
// serious (a new failing check of weight 4 or more). Only `--update` rewrites the baseline, and that is a decision, not a side effect.

const RANK = { pass: 2, warn: 1, fail: 0 };

export const TOLERANCE = { axis: 0.3, persona: 0.5 };

/** The compact form that is committed. */
export function snapshot(run, axes, personas) {
  return {
    version: 1, build: run.build, date: run.date,
    checks: Object.fromEntries(run.checks.filter((c) => c.status !== 'info').map((c) => [c.id, { status: c.status, weight: c.weight }])),
    axes: Object.fromEntries(Object.entries(axes).filter(([, v]) => v.score != null).map(([k, v]) => [k, v.score])),
    personas: Object.fromEntries(Object.entries(personas.byPersona).filter(([, v]) => v.score != null).map(([k, v]) => [k, v.score]))
  };
}

/**
 * Compare a run with the baseline.
 * @returns {{ ok: boolean, regressions: any[], improvements: any[], newFindings: any[], newBlockers: any[], dropped: string[], axisDrops: any[], personaDrops: any[] }}
 */
export function compare(baseline, run, axes, personas, tol = TOLERANCE) {
  const out = { ok: true, regressions: [], improvements: [], newFindings: [], newBlockers: [], dropped: [], axisDrops: [], personaDrops: [] };
  const now = new Map(run.checks.filter((c) => c.status !== 'info').map((c) => [c.id, c]));
  const ran = new Set(run.trials.map((t) => t.id));
  for (const [id, was] of Object.entries(baseline.checks || {})) {
    const c = now.get(id);
    if (!c) { if (ran.has(id.split('.')[0])) out.dropped.push(id); continue; }
    const d = RANK[c.status] - RANK[was.status];
    if (d < 0 && (c.status === 'fail' || c.weight >= 3)) out.regressions.push({ id, title: c.title, was: was.status, now: c.status, weight: c.weight, detail: c.detail });
    else if (d > 0) out.improvements.push({ id, title: c.title, was: was.status, now: c.status });
  }
  for (const [id, c] of now) {
    if (id in (baseline.checks || {})) continue;
    if (c.status === 'pass') continue;
    (c.status === 'fail' && c.weight >= 4 ? out.newBlockers : out.newFindings).push({ id, title: c.title, status: c.status, weight: c.weight, detail: c.detail });
  }
  for (const [k, was] of Object.entries(baseline.axes || {})) {
    const n = axes[k] && axes[k].score;
    if (n != null && was - n > tol.axis) out.axisDrops.push({ axis: k, was, now: n });
  }
  for (const [k, was] of Object.entries(baseline.personas || {})) {
    const n = personas.byPersona[k] && personas.byPersona[k].score;
    if (n != null && was - n > tol.persona) out.personaDrops.push({ persona: k, was, now: n });
  }
  out.ok = !out.regressions.length && !out.newBlockers.length && !out.axisDrops.length && !out.personaDrops.length;
  return out;
}
