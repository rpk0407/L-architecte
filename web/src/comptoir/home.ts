// Where /comptoir opens for each person (TEAM-02): the home page he chose when it exists, else his role's (the owner and
// managers on Pilotage, a chair on Mon espace, the desk on the Agenda), and the Agenda whenever that page is missing.
// `available`: the pages this build has and this person may open (App.tsx ROUTES); Mon espace (TEAM-04) and Pilotage
// (TEAM-05) join it when their pages land, with no change here.
import type { Me } from './types';

export function homeOf(me: Pick<Me, 'role' | 'chair' | 'prefs'>, available: string[]): string {
  const has = (p: string) => available.includes(p);
  const pick = me.prefs?.home;
  if (pick && pick !== 'auto' && has(pick)) return pick;
  const auto = me.role === 'owner' || me.role === 'manager' ? 'pilotage' : me.chair ? 'espace' : 'agenda';
  return has(auto) ? auto : 'agenda';
}
