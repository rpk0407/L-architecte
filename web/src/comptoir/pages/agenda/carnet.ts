// The weekly formule the salon sells, read off the catalogue. On its own (no React, no sheet): the Accueil's dock asks it
// without loading the Agenda's sheets.
import type { Service } from '../../types';

/** The weekly carnet the salon sells, with the cut it pays for; null when there is none. */
export function weeklyCarnet(services: Service[]): { pack: Service; coverId: string } | null {
  const pack = services.filter((s) => s.active && s.pack && s.pack.weekly).sort((a, b) => a.order - b.order)[0];
  const coverId = pack ? (pack.pack!.serviceIds || []).find((id) => services.some((s) => s.id === id && s.active)) : null;
  return pack && coverId ? { pack, coverId } : null;
}
