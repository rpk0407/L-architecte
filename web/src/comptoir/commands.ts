// WP7 · La barre de commande: one table of everything the search can open or do (commands, pages, Réglages sections),
// as plain rules without React, so Palette.tsx and tests/unit/commands.test.js read the very same ones.
// No import: like access.ts it is handed the rules it reads (pages/reglages/caps.ts, access.ts), so node can load it.
export type Rules = {
  SECTION_CAP: Record<string, string>; OPEN_SECTIONS: readonly string[]; sectionCap: (id: string) => string | undefined;
  navShows: (x: { page: string; cap?: string }, can: (c: string) => boolean, chair: boolean) => boolean;
};

/** What a command may change outside the address bar: the shell hands these over. */
export type Ctx = { go: (to: string) => void; toggleMask: () => void; toggleTheme: () => void; tour: () => void };
export type Group = 'Actions' | 'Pages' | 'Réglages';
export type Entry = {
  id: string; group: Group; label: string; mots: string[]; cap?: string; icon: string; hint?: string;
  /** a page of the menu: shown by the same rule as the menu (navShows) */
  page?: string;
  run: (c: Ctx) => void;
};

const goTo = (to: string) => (c: Ctx) => c.go(to);
const act = (id: string, label: string, mots: string[], icon: string, run: (c: Ctx) => void, cap?: string, hint?: string): Entry => ({ id, group: 'Actions', label, mots, cap, icon, hint, run });
const pg = (page: string, label: string, icon: string, mots: string[], cap?: string, to = '/' + page): Entry => ({ id: 'p-' + page, group: 'Pages', label, mots, cap, icon, page, run: goTo(to) });

// Commands: the capability is the one the page it opens needs (a barber has none of the owner's).
const ACTIONS: Entry[] = [
  act('new', 'Nouveau rendez-vous', ['rdv', 'reserver', 'ajouter', 'creneau'], 'plus', goTo('/?new=1'), 'agenda.own', 'N'),
  act('walk', 'Ajouter un passage (sans rendez-vous)', ['passage', 'client sans rdv', 'file'], 'walk', goTo('/?walkin=1'), 'agenda.own', 'P'),
  act('absence', 'Poser une absence', ['conge', 'vacances', 'indisponible', 'repos'], 'calendar', goTo('/reglages/compte?absences=1'), 'agenda.own'),
  act('relancer', 'Relancer les habitués', ['relance', 'rappeler', 'clients en retard', 'sms'], 'relances', goTo('/relances'), 'marketing'),
  act('z', 'Faire le Z (compter la caisse et clôturer)', ['cloture', 'caisse', 'fin de journee', 'compter'], 'lock', goTo('/caisse/cloture'), 'closure'),
  act('objectif', 'Fixer l’objectif du mois', ['objectifs', 'chiffre vise', 'cible'], 'target', goTo('/reglages/objectifs'), 'settings'),
  act('exports', 'Exports du mois', ['export', 'csv', 'comptable', 'telecharger', 'fichier'], 'download', goTo('/rapports'), 'report.shop'),
  act('sale', 'Vente libre (produit, carte cadeau)', ['vendre', 'produit', 'carte cadeau', 'encaisser'], 'caisse', goTo('/caisse?vente=1'), 'sale.create'),
  act('mask', 'Masquer ou montrer les montants', ['confidentiel', 'flou', 'cacher', 'argent', 'prive'], 'eyeOff', (c) => c.toggleMask()),
  act('theme', 'Changer de thème (clair ou sombre)', ['theme', 'clair', 'sombre', 'nuit', 'couleurs'], 'sun', (c) => c.toggleTheme()),
  act('tour', 'Revoir la visite', ['visite', 'guide', 'aide', 'decouvrir', 'tutoriel'], 'sparkle', (c) => c.tour())
];

// Pages, with the rule of the menu (access.ts navShows) and the capability App.tsx's useNav gives each.
const PAGES: Entry[] = [
  pg('accueil', 'Accueil', 'house', ['a traiter', 'aujourd hui', 'ma journee', 'debut', 'page d ouverture']),
  pg('pilotage', 'Chiffres', 'target', ['pilotage', 'tableau de bord', 'objectif', 'chiffre d affaires'], 'report.shop'),
  pg('espace', 'Mon espace', 'chair', ['mon fauteuil', 'ma journee'], 'agenda.own'),
  pg('agenda', 'Agenda', 'agenda', ['rendez-vous', 'planning', 'liste d attente'], 'agenda.own'),
  pg('caisse', 'Caisse', 'caisse', ['tickets', 'ventes', 'encaissement'], 'sale.create'),
  pg('clients', 'Clients', 'clients', ['fiches', 'habitues', 'fichier clients'], 'client.view'),
  pg('relances', 'Relances', 'relances', ['messages', 'habitues en retard', 'demandes'], 'marketing'),
  pg('rapports', 'Rapports', 'rapports', ['chiffres', 'statistiques', 'exports', 'chiffre d affaires'], 'report.own'),
  pg('equipe', 'Équipe', 'equipe', ['barbiers', 'conges', 'paie', 'personnes'], 'team'),
  pg('catalogue', 'Catalogue', 'catalogue', ['prestations', 'produits', 'prix', 'tarifs', 'stock'], 'catalog'),
  pg('reglages', 'Réglages', 'reglages', ['parametres', 'configuration'])
];

// The 16 sections of Réglages (the labels of Reglages.tsx), their words and the right caps.ts gives each.
const SECTIONS: Record<string, { label: string; icon: string; mots: string[] }> = {
  'mise-en-route': { label: 'Mise en route', icon: 'check', mots: ['demarrer', 'ouverture', 'sante', 'etapes'] },
  wordpress: { label: 'Reprendre WordPress', icon: 'download', mots: ['importer', 'ancien site', 'reprise', 'migration'] },
  compte: { label: 'Mon compte', icon: 'user', mots: ['code', 'mot de passe', 'profil', 'pin', 'absences', 'conges'] },
  salon: { label: 'Le salon', icon: 'map', mots: ['adresse', 'telephone', 'coordonnees', 'ticket', 'mentions', 'nom'] },
  horaires: { label: 'Horaires et fermetures', icon: 'clock', mots: ['ouverture', 'jours feries', 'fermeture', 'conges', 'semaine'] },
  reservation: { label: 'Réservation en ligne', icon: 'globe', mots: ['acompte', 'acomptes', 'annulation', 'delai', 'site', 'reserver'] },
  paiements: { label: 'Paiements', icon: 'card', mots: ['stripe', 'pourboire', 'carte bancaire', 'especes', 'moyens'] },
  abonnements: { label: 'Abonnements', icon: 'card', mots: ['formule', 'mensuel', 'forfait', 'delai de grace'] },
  messages: { label: 'Messages', icon: 'sms', mots: ['sms', 'email', 'textes', 'rappel', 'modele'] },
  equipe: { label: 'Équipe et accès', icon: 'shield', mots: ['droits', 'permissions', 'acces', 'barbiers', 'autorisations'] },
  objectifs: { label: 'Objectifs', icon: 'target', mots: ['objectif', 'chiffre vise', 'cible', 'mois'] },
  fidelite: { label: 'Fidélité', icon: 'gift', mots: ['tampons', 'parrainage', 'carte', 'recompense'] },
  compta: { label: 'Comptabilité', icon: 'euro', mots: ['tva', 'plan de comptes', 'comptable', 'export comptable', 'taxe'] },
  appareils: { label: 'Appareils', icon: 'device', mots: ['postes', 'tablette', 'connexion par code', 'autorises'] },
  donnees: { label: 'Données et intégrité', icon: 'shieldOk', mots: ['sauvegarde', 'verification', 'exports', 'rgpd', 'systeme', 'sante'] },
  journal: { label: 'Journal d’activité', icon: 'journal', mots: ['historique', 'qui a fait', 'audit', 'traces'] }
};

/** The one table, in the order a list shows ties: what to do, where to go, what to adjust. */
export function buildEntries(r: Rules): Entry[] {
  const settings: Entry[] = Object.keys(SECTIONS).map((id) => ({
    id: 's-' + id, group: 'Réglages' as Group, label: SECTIONS[id].label, mots: ['reglages', ...SECTIONS[id].mots], cap: r.sectionCap(id), icon: SECTIONS[id].icon,
    run: goTo('/reglages/' + id)
  }));
  return [...ACTIONS, ...PAGES, ...settings];
}
/** The ids of the Réglages sections the table carries (tests/unit/commands.test.js keeps them in step with caps.ts). */
export const SECTION_IDS: readonly string[] = Object.keys(SECTIONS);

/** What this person may open or do: the capability, and for a page the menu's own rule. */
export function allowed(r: Rules, entries: readonly Entry[], can: (c: string) => boolean, chair: boolean): Entry[] {
  return entries.filter((e) => (!e.cap || can(e.cap)) && (!e.page || r.navShows({ page: e.page, cap: e.cap }, can, chair)));
}

/** Lower case, no accents: « Équipe » and « equipe » are the same word. */
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();

/** How well an entry answers a typed text (0 = not at all): each typed word must start a word of the label (best),
 *  start a keyword, or sit inside the label. No language model: words, as before. */
export function score(e: Entry, q: string): number {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const label = norm(e.label), lw = label.split(' ');
  const kw = e.mots.map(norm);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (label.startsWith(w)) s = 6;
    else if (lw.some((x) => x.startsWith(w))) s = 5;
    else if (kw.some((k) => k.split(' ').some((x) => x.startsWith(w)))) s = 3;
    else if (label.includes(w)) s = 2;
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** The entries answering a text, best first (a tie keeps the table's order: commands, pages, sections). */
export function search(entries: readonly Entry[], q: string, max = 8): Entry[] {
  return entries.map((e, i) => ({ e, i, s: score(e, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.e);
}

export const RECENTS_KEY = 'lx-palette-recents';
export const RECENTS_MAX = 5;
/** The last five ids used, newest first, each once. */
export const pushRecent = (list: readonly string[], id: string): string[] => [id, ...list.filter((x) => x !== id)].slice(0, RECENTS_MAX);
/** The recents as entries this person may still use (an id that no longer exists or is no longer allowed drops out). */
export const recentEntries = (list: readonly string[], entries: readonly Entry[]): Entry[] => list.map((id) => entries.find((e) => e.id === id)).filter((e): e is Entry => !!e).slice(0, RECENTS_MAX);
