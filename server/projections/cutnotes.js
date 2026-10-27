// @ts-check
// Cut notes (TEAM-04): what a barber writes about a cut for whoever cuts next. cut.noted { id, apptId, cid, staffId, day }
// with pii { text } (a few words about the cut: personal data, so next to the event and erased with the client).
// s.cutNotes: cid → the last 20 notes, newest first; a second note on the same appointment replaces the first, which
// stays in `prev` (the journal keeps every version). Reads go through the client's file ids, so a merge needs nothing here.
// A copy whose text was already erased is not kept. Registered in core/extensions.js; the command is commands/cutnotes.js.
// No import of the engine or the state here (see core/extensions.js).

/** notes kept per file, and earlier versions kept per note */
export const KEEP = 20, PREV = 5;

/** @typedef {{ id: string, apptId: string, staffId: string, day: string, text: string, at: number, prev: { text: string, at: number }[] }} CutNote */

/** newest visit first, then the latest written */
const byNewest = (/** @type {CutNote} */ a, /** @type {CutNote} */ b) => b.day.localeCompare(a.day) || b.at - a.at;

/** @type {import('../core/extensions.js').Extension} */
export const cutnotesExtension = {
  init(s) { s.cutNotes = new Map(); s.cutNoteOf = new Map(); },
  on: {
    'cut.noted': (s, e, d, p) => {
      const text = p && typeof p.text === 'string' ? p.text : '';
      if (!d || !d.cid || !d.apptId || !text) return;
      // the note this appointment already had (under the file it was written for, a merged one included) is replaced
      const was = s.cutNoteOf.get(d.apptId);
      /** @type {CutNote | undefined} */
      let old;
      if (was) {
        const list = s.cutNotes.get(was) || [];
        old = list.find((n) => n.apptId === d.apptId);
        if (old) s.cutNotes.set(was, list.filter((n) => n !== old));
      }
      const prev = old ? [{ text: old.text, at: old.at }, ...old.prev].slice(0, PREV) : [];
      const list = [{ id: d.id, apptId: d.apptId, staffId: d.staffId, day: d.day, text, at: e.at, prev }, ...(s.cutNotes.get(d.cid) || [])].sort(byNewest);
      for (const n of list.splice(KEEP)) if (s.cutNoteOf.get(n.apptId) === d.cid) s.cutNoteOf.delete(n.apptId);
      s.cutNotes.set(d.cid, list);
      s.cutNoteOf.set(d.apptId, d.cid);
    },
    // the client is erased: their notes go with them (the events' text was redacted in the store, core/engine.js)
    'client.erased': (s, e, d) => {
      for (const cid of d.ids || [d.id]) {
        for (const n of s.cutNotes.get(cid) || []) s.cutNoteOf.delete(n.apptId);
        s.cutNotes.delete(cid);
      }
    }
  }
};

/**
 * The notes of a file and every file merged into it (ids: commands/clients.js fileIds), newest visit first.
 * @param {any} s @param {string[]} ids @param {number} [limit]
 * @returns {CutNote[]}
 */
export function cutNotesOf(s, ids, limit = KEEP) {
  if (!s.cutNotes) return [];
  const all = /** @type {CutNote[]} */ ([]);
  for (const id of ids) all.push(...(s.cutNotes.get(id) || []));
  return all.sort(byNewest).slice(0, limit);
}
