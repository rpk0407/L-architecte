// @ts-check
// The record of each WordPress run (Réglages › Reprendre WordPress), as the projection folds it: what the files held,
// what each batch did, what it skipped and why, which rows want a look. The batches are ordinary events (import.batch)
// that carry only counts and references (a WordPress booking number, a day, an opaque id): no name, no number, no free
// text, so an erasure has nothing to blank here and the report is rebuilt at read time (commands/import.js runLines).
// Registered in core/extensions.js; the commands are in commands/import.js. No import of the engine or the state here.

/** How many review references one run keeps; the counts stay exact beyond. */
export const REVIEW_KEEP = 5000;

/** @param {Record<string, any>} to @param {Record<string, any>|undefined} from */
function sum(to, from) {
  for (const [k, v] of Object.entries(from || {})) {
    if (typeof v === 'number') to[k] = (to[k] || 0) + v;
    else if (v && typeof v === 'object') sum(to[k] || (to[k] = {}), v);
  }
}

/** @type {import('../core/extensions.js').Extension} */
export const importsExtension = {
  init(s) { s.imports = { runs: new Map(), order: [], seen: new Map() }; },
  on: {
    'import.started': (s, e, d) => {
      const { id, ...rest } = d;
      s.imports.runs.set(id, { id, at: e.at, startedAt: e.at, by: e.actor.id, ...rest, batches: 0, lastIndex: -1, counts: {}, skip: {}, review: [], reviewTotal: 0, finishedAt: null, undoneAt: null });
      s.imports.order.push(id);
      s.imports.seen.set(id, new Set());
    },
    'import.batch': (s, e, d) => {
      const r = s.imports.runs.get(d.run);
      if (!r) return;
      r.batches++;
      if (typeof d.i === 'number' && d.i > r.lastIndex) r.lastIndex = d.i;
      sum(r.counts, d.counts);
      sum(r.skip, d.skip);
      for (const x of d.review || []) { r.reviewTotal++; if (r.review.length < REVIEW_KEEP) r.review.push(x); }
      // the files this batch made or met: a person counted once for the whole run, whatever the number of batches
      const seen = s.imports.seen.get(d.run);
      if (seen) for (const c of d.cids || []) seen.add(c);
    },
    'import.finished': (s, e, d) => {
      const r = s.imports.runs.get(d.id);
      if (!r || r.finishedAt) return;
      r.finishedAt = e.at;
      s.imports.seen.delete(d.id);
    }
  }
};

/** A run that can still take batches: known, not finished, not undone (WP-09). */
export const runOpen = (s, id) => {
  const r = id && s.imports && s.imports.runs.get(id);
  return r && !r.finishedAt && !r.undoneAt ? r : null;
};
