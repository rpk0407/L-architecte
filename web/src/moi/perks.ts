// What the signed-out /moi promises of the space: only the advantages this salon really has.

/** « ta carte fidélité, ton carnet et ton abonnement »: in the order of the space, the gift card when too little else is there. */
export function perksLine(offers: { carnet: boolean; membership: boolean }, loyalty: boolean) {
  const list: string[] = [];
  if (loyalty) list.push('ta carte fidélité');
  if (offers.carnet) list.push('ton carnet');
  if (offers.membership) list.push('ton abonnement');
  // a salon with none of them still has the gift card: never a promise with nothing behind it
  if (list.length < 2) list.push('ta carte cadeau');
  const text = list.length > 1 ? list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1] : list[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}
