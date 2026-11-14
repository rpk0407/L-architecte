// WP5 · Accueil: what a card's single button does, and the order and folding of the cards. Plain rules without React:
// the page (Card.tsx, Customize.tsx) and tests/unit/accueil.test.js read the same ones.
import type { HomeCard, HomeCardGroup, HomeCardId } from '../../types';

/** go: open that address of the Comptoir. handover: the plan of an absence already posted, opened over the page. */
export type Step = { kind: 'go'; to: string } | { kind: 'handover'; id: string };

/**
 * `go` navigates; `bulk` opens the list it acts on (Relances) with the preview sheet already up (`?apercu=1`, WP6);
 * `sheet` opens Équipe's HandoverSheet for the clients of a posted absence (`orphelins`, ref: the absence). Two sheets
 * have no in-place form yet and open the page that holds theirs: a request still waiting is answered in Équipe
 * (Valider / Refuser, which then opens the plan), and the month's goal is set in Réglages › Objectifs.
 */
export function stepOf(card: Pick<HomeCard, 'id' | 'action'>): Step {
  const a = card.action;
  if (a.kind === 'sheet') {
    if (card.id === 'orphelins' && a.ref) return { kind: 'handover', id: a.ref };
    if (a.ref === 'objectif' || card.id === 'objectif') return { kind: 'go', to: '/reglages/objectifs' };
    return { kind: 'go', to: '/equipe' };
  }
  // WP6: the card's button opens the grouped send's sheet (Relances, « Aperçu et envoi »), one touch from the card
  if (a.kind === 'bulk') return { kind: 'go', to: (a.to || '/relances') + (a.to?.includes('?') ? '&' : '?') + 'apercu=1' };
  return { kind: 'go', to: a.to || '/agenda' };
}

/** Five cards in sight at most; the rest is folded (« 2 autres »). */
export const MAX_CARDS = 5;
export function fold<T>(cards: readonly T[], max = MAX_CARDS): { shown: T[]; folded: T[] } {
  return { shown: cards.slice(0, max), folded: cards.slice(max) };
}

export const GROUP_LABEL: Record<HomeCardGroup, string> = { bloque: 'Ce qui bloque', attend: 'Quelqu’un attend', rapporte: 'Ce qui rapporte', entretien: 'Entretien' };
/** A card's name where its sentence is not on screen (Personnaliser: a hidden card has no title from the server). */
export const CARD_NAME: Record<HomeCardId | 'retard', string> = {
  z: 'Z de caisse', encaisser: 'À encaisser', retard: 'Clients en retard', prochain: 'Mon prochain client', messages: 'Messages à envoyer', 'absence-demande': 'Demandes d’absence', orphelins: 'Clients à replacer',
  demandes: 'Demandes et réponses', relances: 'Habitués à relancer', semaine: 'La semaine', echecs: 'Messages en échec', stock: 'Stock bas',
  purge: 'Fiches à purger', comptable: 'Fichiers du comptable', objectif: 'Objectif du mois'
};
export const nameOf = (id: string): string => (Object.hasOwn(CARD_NAME, id) ? CARD_NAME[id as HomeCardId] : id);

/** How many rows of « Aujourd’hui » a phone shows before « et N autres » (the Agenda has them all). */
export const PHONE_APPTS = 6;
/** The amount of « relances » is an estimate (each client's usual ticket); the others are sums of real tickets. */
export const isEstimate = (id: string): boolean => id === 'relances';
/** An estimate is written to the euro (« env. 427 € », as Pilotage rounds its own); a sum of tickets is written as sent. */
export const shownAmount = (id: string, cents: number): number => (isEstimate(id) ? Math.round(cents / 100) * 100 : cents);

/**
 * The pinned order after moving card `i` one place up or down. The server orders by group first, so a card only
 * changes place with a neighbour of its own group: anything else returns null (the arrow is disabled).
 */
export function moved(cards: readonly Pick<HomeCard, 'id' | 'group'>[], i: number, by: -1 | 1): string[] | null {
  const a = cards[i], b = cards[i + by];
  if (!a || !b || a.group !== b.group) return null;
  const ids = cards.map((c) => c.id);
  [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
  return ids;
}

/** prefs.homeHidden after a switch. */
export function hiddenAfter(hidden: readonly string[], id: string, show: boolean): string[] {
  const rest = hidden.filter((x) => x !== id);
  return show ? rest : [...rest, id];
}

/** The page's own blocks, which this person may switch off: his prefs (`homeBlocks`), with what this device kept
 *  before (`lx-accueil-blocs`) as the first-run fallback. */
export type Blocks = { prochain: boolean; fauteuils: boolean; jour: boolean };
export const BLOCKS_KEY = 'lx-accueil-blocs';
export const ALL_BLOCKS: Blocks = { prochain: true, fauteuils: true, jour: true };
export const BLOCK_NAME: Record<keyof Blocks, string> = { prochain: 'Prochain', fauteuils: 'Fauteuils', jour: 'Aujourd’hui' };
/** Whatever the device kept (an older shape, a hand-edited value): three booleans, on by default. */
export function blocksOf(v: unknown): Blocks {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { prochain: o.prochain !== false, fauteuils: o.fauteuils !== false, jour: o.jour !== false };
}
