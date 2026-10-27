// The cards of Mon espace are the files of ./cards: each exports `meta = { id, title, chairOnly? }` and a default component.
// Another area adds a card by adding a file (FID-05's « À revoir »): there is no list to edit. The order and the hidden ones
// are the person's own (prefs.cards, prefs.hidden); what he did not place follows in the default order.
import type { ComponentType } from 'react';
import type { EspaceCardMeta, EspaceCardProps, Prefs } from '../../types';

const found = import.meta.glob<{ meta?: EspaceCardMeta; default?: ComponentType<EspaceCardProps> }>('./cards/*.tsx', { eager: true });

/** the default order; a card not named here comes after them, by id */
export const DEFAULT_ORDER = ['prochain', 'journee', 'trous', 'chiffres', 'habitues', 'anniversaires', 'avis', 'absences', 'salon'];

export type EspaceCard = { meta: EspaceCardMeta; C: ComponentType<EspaceCardProps> };
const ALL: EspaceCard[] = Object.values(found)
  .filter((m): m is { meta: EspaceCardMeta; default: ComponentType<EspaceCardProps> } => !!m.meta && !!m.default)
  .map((m) => ({ meta: m.meta, C: m.default }));

const rank = (id: string) => { const i = DEFAULT_ORDER.indexOf(id); return i < 0 ? DEFAULT_ORDER.length : i; };

/** Every card in this person's order, with whether he hid it. */
export function orderedCards(prefs: Pick<Prefs, 'cards' | 'hidden'> | undefined, chair = true): (EspaceCard & { hidden: boolean })[] {
  const mine = prefs?.cards || [], hidden = new Set(prefs?.hidden || []);
  const known = ALL.filter((c) => chair || !c.meta.chairOnly);
  const own = mine.map((id) => known.find((c) => c.meta.id === id)).filter((c): c is EspaceCard => !!c);
  const rest = known.filter((c) => !own.includes(c)).sort((a, b) => rank(a.meta.id) - rank(b.meta.id) || a.meta.id.localeCompare(b.meta.id));
  return [...own, ...rest].map((c) => ({ ...c, hidden: hidden.has(c.meta.id) }));
}
