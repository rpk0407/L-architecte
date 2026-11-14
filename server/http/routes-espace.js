// @ts-check
// TEAM-04 · Mon espace: a barber's home in one read, and the cut notes he keeps on his clients. Only for a chair (the
// owner or a manager who cuts too, a barber); the desk has none and is told so. The read is computed for the person who
// asks and nobody else (domain/espace.js).
import { HttpError } from './kit.js';
import { fileOf } from './routes-staff.js';
import { espaceView, noteWho, planningView, PLAN_DAYS } from '../domain/espace.js';
import { answerArrival } from '../commands/arrival.js';
import { addCutNote } from '../commands/cutnotes.js';
import { cutNotesOf } from '../projections/cutnotes.js';
import { fileIds } from '../commands/clients.js';
import { isDay, diffDays } from '../../shared/dates.js';

export function espaceRoutes(app) {
  app.get('/api/v1/espace', (r) => {
    if (!r.me.chair) throw new HttpError(409, 'no_chair', 'Mon espace est pour ceux qui ont un fauteuil.');
    const day = r.query.get('day');
    // a past day shows what happened, a coming day what is booked; the live parts (now, next) are today's
    return espaceView(r.s, r.me, r.caps, { day: day && isDay(day) ? day : r.local.day, now: r.now });
  }, { cap: 'agenda.own' });

  /** FEATURE C · « Mon planning »: one day of his own column, from a week back to the 14 days ahead. */
  app.get('/api/v1/espace/planning', (r) => {
    if (!r.me.chair) throw new HttpError(409, 'no_chair', 'Mon planning est pour ceux qui ont un fauteuil.');
    const q = r.query.get('day');
    const day = q && isDay(q) ? q : r.local.day;
    const ahead = diffDays(r.local.day, day);
    if (ahead < -7 || ahead >= PLAN_DAYS) throw new HttpError(400, 'invalid', 'Ce jour est hors de ton planning.');
    return planningView(r.s, r.me, { day, now: r.now });
  }, { cap: 'agenda.own' });

  /** FEATURE C · « Le client est là ? »: here, later or absent, by the booking's barber (or whoever edits every booking). */
  app.post('/api/v1/appointments/:id/arrival', (r) => r.run(answerArrival, { id: r.params.id, answer: r.body.answer }), { cap: 'agenda.own' });

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
