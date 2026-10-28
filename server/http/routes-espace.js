// @ts-check
// TEAM-04 · Mon espace: a barber's home in one read, and the cut notes he keeps on his clients. Only for a chair (the
// owner or a manager who cuts too, a barber); the desk has none and is told so. The read is computed for the person who
// asks and nobody else (domain/espace.js).
import { HttpError } from './kit.js';
import { fileOf } from './routes-staff.js';
import { espaceView, noteWho } from '../domain/espace.js';
import { addCutNote } from '../commands/cutnotes.js';
import { cutNotesOf } from '../projections/cutnotes.js';
import { fileIds } from '../commands/clients.js';
import { isDay } from '../../shared/dates.js';

export function espaceRoutes(app) {
  app.get('/api/v1/espace', (r) => {
    if (!r.me.chair) throw new HttpError(409, 'no_chair', 'Mon espace est pour ceux qui ont un fauteuil.');
    const day = r.query.get('day');
    // a past day shows what happened, a coming day what is booked; the live parts (now, next) are today's
    return espaceView(r.s, r.me, r.caps, { day: day && isDay(day) ? day : r.local.day, now: r.now });
  }, { cap: 'agenda.own' });

  /** A note on a cut: by the appointment's barber (or whoever edits every booking), in the chair or within two weeks. */
  app.post('/api/v1/appointments/:id/cut-note', (r) => r.run(addCutNote, { id: r.params.id, text: r.body.text }), { cap: 'agenda.own' });

  /** The notes of one client's file (merged files included), for the client file: who wrote them, and when. */
  app.get('/api/v1/clients/:id/cut-notes', (r) => {
    const c = fileOf(r);
    const items = c.erased ? [] : cutNotesOf(r.s, fileIds(r.s, c)).map((n) => ({
      id: n.id, apptId: n.apptId, day: n.day, ...noteWho(r.s, n), mine: n.by === r.me.id, text: n.text, edited: n.prev.length > 0
    }));
    return { items };
  }, { cap: 'client.view' });
}
