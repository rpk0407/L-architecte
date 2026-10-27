// « Avis demandés »: the Google review requests that left after his clients' visits this month, and how many were opened.
// Hidden while the salon asks for none.
import type { EspaceCardMeta, EspaceCardProps } from '../../../types';
import { EsCard } from '../shared';

export const meta: EspaceCardMeta = { id: 'avis', title: 'Avis demandés', chairOnly: true };

export default function Avis({ data }: EspaceCardProps) {
  const r = data.reviews;
  if (!r) return null;
  return (
    <EsCard guide="espace.avis" title="Avis demandés" icon="star">
      <p className="es-big">{r.sent} demandé{r.sent > 1 ? 's' : ''} · {r.opened} ouvert{r.opened > 1 ? 's' : ''} <span className="muted">ce mois</span></p>
    </EsCard>
  );
}
