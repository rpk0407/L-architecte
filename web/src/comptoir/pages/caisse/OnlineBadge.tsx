// « Payer ma coupe » as the salon reads it, wherever an appointment is listed (the agenda, « À encaisser », Mon espace):
// the client paid himself on his phone, he is paying, or the payment link is out. So nobody charges twice.
import type { OnlinePay } from '../../types';

export type PayState = { onlinePay?: OnlinePay; paidOnline?: boolean };
/** The words alone, for a line of text. */
export const onlineWords = (a: PayState) => (a.paidOnline ? 'payé en ligne' : a.onlinePay ? (a.onlinePay.state === 'paying' ? 'paiement en ligne en cours' : 'lien de paiement envoyé') : '');

export function OnlineBadge({ a }: { a: PayState }) {
  if (a.paidOnline) return <span className="badge badge-ok" data-guide="paid-online">Payé en ligne</span>;
  if (a.onlinePay) return <span className="badge badge-info" data-guide="pay-online-wait">{a.onlinePay.state === 'paying' ? 'Paiement en ligne en cours' : 'Lien de paiement envoyé'}</span>;
  return null;
}
