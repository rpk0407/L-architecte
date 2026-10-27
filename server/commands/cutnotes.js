// @ts-check
// A cut note (TEAM-04): a few words about the cut, written by the barber who did it (or whoever edits every booking),
// while the client is in the chair or in the two weeks after. The text is personal data: it travels in pii, under the
// client's file (data.cid), so erasing the file takes it away. A second note on the same appointment replaces the first
// in what is shown; the journal keeps both.
import { fail } from '../core/engine.js';
import { str, id, obj, parse } from '../lib/validate.js';
import { diffDays } from '../../shared/dates.js';
import { getAppt, getClient, needChair } from './common.js';

/** the longest a note stays open to writing after the visit */
export const NOTE_DAYS = 14;
/** what the shared screens say when the note cannot be written */
export const NOTE_STATUS = 'La note de coupe se prend au fauteuil ou après la coupe.';

const noteSchema = obj({ id: id(), text: str({ min: 1, max: 280 }) });

export const addCutNote = {
  run(s, input, ctx) {
    const x = parse(noteSchema, input);
    const a = getAppt(s, x.id);
    needChair(ctx, a.staffId);
    if (a.status !== 'in_chair' && a.status !== 'done') fail(409, 'status', NOTE_STATUS);
    if (diffDays(a.day, ctx.local.day) > NOTE_DAYS) fail(409, 'too_old', 'Trop tard pour cette note : ' + NOTE_DAYS + ' jours après la coupe au plus.');
    if (!a.clientId) fail(409, 'no_client', 'Ce passage n’a pas de fiche client : crée la fiche pour garder une note de coupe.');
    const c = getClient(s, a.clientId);
    if (c.erased) fail(409, 'erased', 'Cette fiche a été effacée.');
    const noteId = ctx.id('cn');
    ctx.emit('cut.noted', { id: noteId, apptId: a.id, cid: c.id, staffId: a.staffId, day: a.day }, { text: x.text });
    return { ok: true, id: noteId };
  }
};
