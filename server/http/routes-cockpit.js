// @ts-check
// TEAM-05a · Pilotage: the owner's cockpit in one read. report.shop is the owner's and the managers' for good (TEAM-01), so
// no setting opens another barber's takings through this route.
import { HttpError } from './kit.js';
import { cockpit, RANGES } from '../domain/cockpit.js';
import { isDay } from '../../shared/dates.js';

export function cockpitRoutes(app) {
  // ?range=day|week|month (default day) &day=YYYY-MM-DD (any day of the period; a coming day reads as today)
  app.get('/api/v1/cockpit', (r) => {
    const range = r.query.get('range') || 'day';
    if (!RANGES.includes(/** @type {any} */ (range))) throw new HttpError(400, 'invalid', 'Période inconnue : jour, semaine ou mois.');
    const day = r.query.get('day') || r.local.day;
    if (!isDay(day) || day < '2000-01-01') throw new HttpError(400, 'invalid', 'Jour invalide.');
    return cockpit(r.s, { range: /** @type {any} */ (range), day, today: r.local.day, now: r.now });
  }, { cap: 'report.shop' });
}
