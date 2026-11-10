// GUIDE-01a · Who opens which page of the Comptoir, as plain rules without React or imports: the shell (App.tsx: its
// guard, its menu, the guided tour's canOpen) and tests/unit/tour.test.js read the very same ones.

export type RouteNeed = { cap?: string; sub?: (id: string) => string | undefined };
export type Sections = { GUARD_OPEN: { includes: (id: string) => boolean }; SECTION_CAP: Record<string, string> };

/** What the address of a Réglages section needs: nothing for those Réglages decides itself (Mon compte, an old id),
 *  its table's capability, 'settings' for one the table forgets (never open to every role by default). */
export const sectionNeed = (id: string, c: Sections): string | undefined =>
  c.GUARD_OPEN.includes(id) ? undefined : Object.hasOwn(c.SECTION_CAP, id) ? c.SECTION_CAP[id] : 'settings';

/** A menu entry this person gets: its capability; the desk (no chair, no salon figures) has no page of zeros in
 *  Rapports, and Mon espace is a chair's. */
export const navShows = (x: { page: string; cap?: string }, can: (c: string) => boolean, chair: boolean): boolean =>
  (!x.cap || can(x.cap)) && !(x.page === 'rapports' && !chair && !can('report.shop')) && !(x.page === 'espace' && !chair);

/** Can this person open this address (/comptoir/<page>/<id>, a `:param` standing for any id)? A page of his menu, then
 *  what the page (or its section) needs. */
export function canOpenPath(path: string, routes: Record<string, RouteNeed>, nav: readonly { page: string }[], can: (c: string) => boolean): boolean {
  const [page = 'agenda', id] = path.split('?')[0].replace(/^\/comptoir/, '').split('/').filter(Boolean);
  if (!Object.hasOwn(routes, page) || !nav.some((x) => x.page === page)) return false;
  const r = routes[page];
  const need = id && !id.startsWith(':') && r.sub ? r.sub(id) : r.cap;
  return !need || can(need);
}

/** The phone's tab bar (WP4): the person's opening page first, then the three of `prefs.tabs` he chose (pages he cannot
 *  open are skipped), else his role's: the owner and managers Agenda, Clients, Chiffres (Pilotage); a chair or the desk
 *  Agenda, Caisse, Clients. Short of three, the role's fill in, then the rest, always in the same order: the tabs never
 *  move by themselves. `has`: the pages in his menu. */
export function phoneTabs(first: string, pref: readonly string[] | undefined, who: { chair: boolean; shop: boolean }, has: (page: string) => boolean): string[] {
  const out = [first];
  const add = (p: unknown) => { if (typeof p === 'string' && out.length < 4 && !out.includes(p) && has(p)) out.push(p); };
  (pref ?? []).forEach(add);
  (!who.chair && who.shop ? ['agenda', 'clients', 'pilotage'] : ['agenda', 'caisse', 'clients']).forEach(add);
  ['agenda', 'caisse', 'clients', 'pilotage', 'espace', 'rapports', 'relances'].forEach(add);
  return out;
}
