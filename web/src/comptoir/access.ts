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
