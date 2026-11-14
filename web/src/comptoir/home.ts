// Where /comptoir opens for each person: the home page he chose when it exists (TEAM-02), else the Accueil (WP5: one
// page for every role, each one seeing what GET /api/v1/home returns for him). Pilotage and Mon espace keep their
// addresses, one tap away. A build without the Accueil falls back on the role's page (the owner and managers on
// Pilotage, a chair on Mon espace, the desk on the Agenda), and on the Agenda whenever that page is missing.
// `available`: the pages this build has and this person may open (App.tsx ROUTES).
import type { Me } from './types';

export function homeOf(me: Pick<Me, 'role' | 'chair' | 'prefs'>, available: string[]): string {
  const has = (p: string) => available.includes(p);
  const pick = me.prefs?.home;
  if (pick && pick !== 'auto' && has(pick)) return pick;
  if (has('accueil')) return 'accueil';
  const auto = me.role === 'owner' || me.role === 'manager' ? 'pilotage' : me.chair ? 'espace' : 'agenda';
  return has(auto) ? auto : 'agenda';
}

/** Signing out (or a session ended by the server) removes the Accueil's local copy of the last answer (`lx-home`,
 *  pages/accueil/snapshot.ts): the next person on this browser never reads the previous one's day. */
export function forgetHome() {
  try { localStorage.removeItem('lx-home'); } catch { /* private mode: nothing was kept */ }
}
