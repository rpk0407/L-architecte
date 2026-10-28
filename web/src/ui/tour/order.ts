// The guided tour's running order, without React (tests/unit/tour.test.js reads it in Node): which steps a person gets
// and in what order. Each app hands the steps its folder holds (import.meta.glob of guide/steps/*.ts) and its places;
// Tour.tsx plays the result. A step's place is where it is shown: the page it names, or, for a part that only lives in
// a view of that page (a client's file, a ticket, the Abonnés segment), the place that lists its target.
import type { GuideRole, GuideStep } from '../../lib/guide';

/** The tour's version: raised when the tour changes enough to be offered again (the welcome shows while prefs.tour.v is below it). */
export const TOUR_V = 1;
/** A step that gives no `order` sits after those that do, in its file's order. */
export const DEFAULT_ORDER = 100;

/** Where steps are shown, in the tour's order. `path` may hold a query and `:params` the app resolves (Tour's resolve). */
export type Place = { path: string; label: string; targets?: readonly string[] };
/** A step with the address it is shown at and the words of its page (« Caisse · Encaisser »). */
export type Played = GuideStep & { place: string; label: string };

/**
 * The owner's whole tour, in the order of a day at the salon (GUIDE-01a § 5): Mise en route, Pilotage or Mon espace,
 * Agenda, Caisse, Clients, Relances, Rapports, Équipe, Catalogue, Réglages (its sections in the order of its menu).
 * A page or a section not listed here plays after the closest listed one above it.
 */
export const COMPTOIR_PLACES: readonly Place[] = [
  { path: '/comptoir/reglages/mise-en-route', label: 'Mise en route' },
  { path: '/comptoir/pilotage', label: 'Pilotage' },
  { path: '/comptoir/espace', label: 'Mon espace' },
  { path: '/comptoir/agenda', label: 'Agenda' },
  { path: '/comptoir/agenda?vue=semaine', label: 'Agenda · Semaine', targets: ['ag-week'] },
  { path: '/comptoir/caisse', label: 'Caisse · Encaisser' },
  // a ticket open: the first client waiting to pay, or a free sale (ComptoirTour resolves it)
  { path: '/comptoir/caisse?rdv=:rdv', label: 'Caisse · Le ticket', targets: ['tk-head', 'till-chips', 'caisse.reward', 'tk-lines', 'till-member-line', 'tk-add', 'till-offer', 'tk-methods', 'tk-validate'] },
  { path: '/comptoir/caisse/ventes', label: 'Caisse · Ventes du jour' },
  { path: '/comptoir/caisse/cloture', label: 'Caisse · Clôture' },
  { path: '/comptoir/clients', label: 'Clients' },
  { path: '/comptoir/clients?segment=abonnes', label: 'Clients · Abonnés', targets: ['members-kpis', 'members-presence', 'members-missed', 'members-list', 'members-notyet', 'members-weeks', 'members-thisweek', 'members-write', 'members-carnets'] },
  // one client's file: a regular with the most to show (ComptoirTour resolves it)
  { path: '/comptoir/clients/:id', label: 'Clients · La fiche', targets: ['file-head', 'file-chips', 'file-kpis', 'file-tech', 'file-abonnement', 'member-offer', 'member-cancel', 'clients.notes-coupe', 'file-carnets', 'file-prefs', 'client-account', 'client-account-invite', 'client-account-revoke', 'client-account-detach', 'clients.loyalty', 'file-history'] },
  { path: '/comptoir/relances', label: 'Relances · À relancer' },
  { path: '/comptoir/relances/attente', label: 'Relances · Liste d’attente' },
  { path: '/comptoir/relances/demandes', label: 'Relances · Demandes' },
  { path: '/comptoir/relances/envoyes', label: 'Relances · Messages envoyés' },
  { path: '/comptoir/rapports', label: 'Rapports' },
  { path: '/comptoir/equipe', label: 'Équipe' },
  { path: '/comptoir/catalogue', label: 'Catalogue · Prestations' },
  { path: '/comptoir/catalogue/produits', label: 'Catalogue · Produits & stock' },
  { path: '/comptoir/catalogue/cartes', label: 'Catalogue · Cartes cadeaux' },
  { path: '/comptoir/reglages', label: 'Réglages' },
  ...([
    ['compte', 'Mon compte'], ['salon', 'Le salon'], ['horaires', 'Horaires et fermetures'], ['reservation', 'Réservation en ligne'],
    ['paiements', 'Paiements'], ['abonnements', 'Abonnements'], ['messages', 'Messages'], ['equipe', 'Équipe et accès'], ['objectifs', 'Objectifs'],
    ['fidelite', 'Fidélité'], ['appareils', 'Appareils'], ['donnees', 'Données et intégrité'], ['wordpress', 'Reprendre WordPress'], ['journal', 'Journal d’activité']
  ] as const).map(([id, label]) => ({ path: '/comptoir/reglages/' + id, label: 'Réglages · ' + label }))
];

/** /moi, signed in: its three tabs. */
export const MOI_PLACES: readonly Place[] = [
  { path: '/moi', label: 'Rendez-vous' },
  { path: '/moi/historique', label: 'Historique' },
  { path: '/moi/profil', label: 'Profil' }
];

/** Every step of every steps file, files in name order (a glob's order is not promised), each file's steps as written. */
export function collect(mods: Record<string, unknown>): GuideStep[] {
  return Object.keys(mods).sort().flatMap((k) => {
    const d = (mods[k] as { default?: unknown } | null)?.default;
    return Array.isArray(d) ? (d as GuideStep[]).filter((s) => s && typeof s.id === 'string' && typeof s.page === 'string') : [];
  });
}

const pathOf = (p: string) => p.split('?')[0].replace(/\/+$/, '') || '/';
const segs = (p: string) => pathOf(p).split('/').filter(Boolean);

/** Is this address (its path; the query is not looked at) the page of this place? `:x` matches any one part. */
export function matchPath(pattern: string, path: string): boolean {
  const a = segs(pattern), b = segs(path);
  return a.length === b.length && a.every((x, i) => (x.startsWith(':') ? b[i].length > 0 : x === b[i]));
}

/** The place of a step: the place listing its target, else its page's, else the closest listed page above it. */
export function placeOf(s: GuideStep, places: readonly Place[]): { rank: number; path: string; label: string } {
  let i = s.target ? places.findIndex((p) => p.targets?.includes(s.target!)) : -1;
  if (i >= 0) return { rank: i, path: places[i].path, label: places[i].label };
  i = places.findIndex((p) => p.path === s.page);
  if (i >= 0) return { rank: i, path: s.page, label: places[i].label };
  // a page this list does not know: right after the deepest listed page it sits under (its own page's words)
  let best = -1, depth = -1;
  places.forEach((p, j) => {
    if (p.targets || p.path.includes('?')) return;
    const a = segs(p.path), b = segs(s.page);
    if (a.length < b.length && a.length > depth && a.every((x, k) => x === b[k])) { best = j; depth = a.length; }
  });
  if (best < 0) return { rank: places.length, path: s.page, label: '' };
  // after every listed place under that page (its tabs and views), so a page stays in one piece
  const base = segs(places[best].path).join('/');
  let last = best;
  places.forEach((p, j) => { const q = segs(p.path).join('/'); if (q === base || q.startsWith(base + '/')) last = Math.max(last, j); });
  return { rank: last + 0.5, path: s.page, label: places[best].label.split(' · ')[0] };
}

export type PlanOpts = {
  places: readonly Place[];
  role: GuideRole;
  /** can this person open this page (its address, `:params` as written)? none: every page */
  canOpen?: (path: string) => boolean;
  /** an app's own rule on top (/moi keeps the signed-in steps of /moi only) */
  keep?: (s: GuideStep) => boolean;
};

/**
 * The steps this person gets, in the order they play: the role filter (no `roles`: everyone who can open the page),
 * the pages he can open, then the places' order, `order` within a place, and the files' order. An id seen twice keeps
 * its first step.
 */
export function plan(steps: readonly GuideStep[], o: PlanOpts): Played[] {
  const seen = new Set<string>();
  const rows: { s: Played; rank: number; at: number }[] = [];
  steps.forEach((s, at) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    if (s.roles && s.roles.length && !s.roles.includes(o.role)) return;
    if (o.keep && !o.keep(s)) return;
    const p = placeOf(s, o.places);
    if (o.canOpen && !o.canOpen(p.path)) return;
    rows.push({ s: { ...s, place: p.path, label: p.label }, rank: p.rank, at });
  });
  // pages the list does not know, in the order they first appear
  const first = new Map<string, number>();
  rows.forEach((r) => { if (!first.has(r.s.place)) first.set(r.s.place, r.at); });
  rows.sort((a, b) => a.rank - b.rank || first.get(a.s.place)! - first.get(b.s.place)! || (a.s.order ?? DEFAULT_ORDER) - (b.s.order ?? DEFAULT_ORDER) || a.at - b.at);
  return rows.map((r) => r.s);
}

/**
 * A place's steps as they play, once its page is on screen: the parts on screen in the page's own order, top to bottom
 * (`dom`: below 0 when a's part comes first), so that the steps several files wrote for one page follow the page as it
 * shows them; then the parts it does not show, in `order` (as planned). `order` thus ranks a place's steps before its
 * page is open (plan), breaks ties between parts at the same spot, and places the parts not on screen (lib/guide.ts).
 */
export function playOrder<T extends GuideStep>(group: readonly T[], shown: (s: T) => boolean, dom: (a: T, b: T) => number): T[] {
  const pos = new Map(group.map((s, k) => [s, k]));
  const on = group.filter(shown).sort((a, b) => dom(a, b) || (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) || pos.get(a)! - pos.get(b)!);
  return [...on, ...group.filter((s) => !shown(s))];
}

/** The steps of the page this address shows (« ? » in its header), in the tour's order. */
export function pageSteps(played: readonly Played[], path: string): Played[] {
  return played.filter((s) => matchPath(s.place, path));
}

/** Where to pick up: the step he stopped on, or the start. */
export function resumeAt(played: readonly Played[], at: string | null | undefined): number {
  const i = at ? played.findIndex((s) => s.id === at) : -1;
  return i < 0 ? 0 : i;
}


/** A name that is a role, not a name (the demo's « Le gérant »): the welcome then calls nobody by it. */
const ROLE_NAME = /^(l[ea]\s+)?(gérante?|patronne?|propriétaire|manager|accueil|admin(istrateur|istratrice)?)$/i;
/** How the welcome calls him: his first name, his whole name when it starts with an article (« Le Soldat »), nothing
 *  when his name is his role. */
export function firstName(name: string): string {
  const n = name.trim();
  if (ROLE_NAME.test(n)) return '';
  return /^(le|la|les|l’|l')\s*/i.test(n) ? n : n.split(/\s+/)[0] || '';
}

/** The welcome card's words for this person (owner and manager: everything; the desk; a barber: what his rights open).
 *  No count of steps: a part with nothing to show yet is passed over, so the number would not hold. */
export function welcomeOf(role: GuideRole, first: string): { title: string; line: string } {
  const title = 'Bienvenue dans ton Comptoir' + (first ? ', ' + first : '') + '. On fait le tour en quelques minutes ?';
  const what = role === 'owner' || role === 'manager'
    ? 'L’agenda, la caisse, les clients, les chiffres et les réglages, partie par partie.'
    : role === 'desk'
      ? 'L’agenda, la caisse et les clients : ce que tu fais à l’accueil, partie par partie.'
      : 'Ton espace, ton agenda et ce que le salon t’a ouvert, partie par partie.';
  return { title, line: what + ' Tu t’arrêtes quand tu veux, la visite reprend là où tu l’as laissée.' };
}
