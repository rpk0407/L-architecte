// The capability each Réglages section needs, written once: Reglages.tsx lists the sections a person may open, App.tsx
// guards the address (/reglages/<id>). The server refuses anyway; this only keeps the two screens from drifting apart.

/** The owner's sections and the capability each needs. A new section is one line here; one forgotten here is the
 *  owner's ('settings', below), never open to every role by default. */
export const SECTION_CAP: Record<string, string> = {
  'mise-en-route': 'settings',
  salon: 'settings',
  horaires: 'settings',
  reservation: 'settings',
  paiements: 'settings',
  messages: 'settings',
  equipe: 'settings',
  objectifs: 'settings',
  appareils: 'devices',
  donnees: 'data',
  wordpress: 'settings',
  journal: 'audit'
};
/** Open to every role. */
export const OPEN_SECTIONS: readonly string[] = ['compte'];

export const isSection = (id: string) => Object.hasOwn(SECTION_CAP, id) || OPEN_SECTIONS.includes(id);

/** What a listed section needs to show in Réglages: nothing for Mon compte, 'settings' for one missing from the table. */
export const sectionCap = (id: string): string | undefined => (OPEN_SECTIONS.includes(id) ? undefined : Object.hasOwn(SECTION_CAP, id) ? SECTION_CAP[id] : 'settings');

/** For App.tsx's guard of /reglages/<id> (imported there as OWN_SECTIONS): the addresses it lets through to Réglages,
 *  which then decides. Mon compte, and an id no section has (an old /reglages/securite bookmark): Réglages opens the
 *  first section the person may see, Mon compte for a barber, instead of refusing them. A section the person may not
 *  open is never in Réglages' own list, so letting its address through shows nothing of it. */
export const GUARD_OPEN = { includes: (id: string) => !isSection(id) || OPEN_SECTIONS.includes(id) };
