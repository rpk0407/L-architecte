// @ts-check
// WP3 · the Accueil in one read, for every signed-in member of the team (no `cap`: the read itself is scoped by role and
// rights, see domain/home.js). A barber gets his own chair and his own appointments, never the salon's money.
import { home } from '../domain/home.js';

export function homeRoutes(app) {
  app.get('/api/v1/home', (r) => home(r.s, r.me, r.now));
}
