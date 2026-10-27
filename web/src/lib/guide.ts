// What a screen says about itself the first time someone opens it: the steps of the guided tours (Comptoir for the
// owner, the desk and each barber; /moi for clients). Each package that adds a screen describes its parts in its own
// file, data only, read by the tour with import.meta.glob:
//   web/src/comptoir/guide/steps/<PACKAGE-ID>.ts   and   web/src/moi/guide/steps/<PACKAGE-ID>.ts
// and marks those parts with data-guide="<id>" in the markup. The tour itself (order, progress, « Revoir la visite »)
// is built once every screen exists; until then these files are only read by their tests.

export type GuideRole = 'owner' | 'manager' | 'desk' | 'barber' | 'client';

export type GuideStep = {
  /** unique across all steps, e.g. 'caisse.online' */
  id: string;
  /** the route the step lives on, e.g. '/comptoir/caisse' or '/moi' */
  page: string;
  /** the data-guide value of the part it points at; none: a step about the whole page */
  target?: string;
  /** who sees it; none: everyone who can open the page */
  roles?: GuideRole[];
  /** a few words, the part's name as the screen shows it */
  title: string;
  /** what it does and when to use it, in two short sentences at most, with « tu » */
  body: string;
  /** a smaller number comes first on its page */
  order?: number;
};
