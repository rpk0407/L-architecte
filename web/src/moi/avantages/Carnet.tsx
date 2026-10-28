// « Mes avantages » › the carnets the client holds (prepaid cuts, sold at the salon): cuts left and until when. A carnet is
// never called « abonnement » (that word is the monthly membership's, INDEX › Words).
import { useState } from 'react';
import { plural } from '../../lib/format';
import { AvRow, Sheet, dayWords, until } from '../kit';
import type { CardProps, MeCarnet } from '../types';

export const meta = { id: 'carnet', order: 20 };

/** The carnet's name as the client reads it: an old « Abonnement 5 coupes » becomes « Carnet 5 coupes ». */
function carnetName(k: MeCarnet) {
  if (/abonnement/i.test(k.name) || !k.name.trim()) return 'Carnet ' + k.total + ' coupes';
  return /^carnet/i.test(k.name) ? k.name : 'Carnet · ' + k.name;
}
const leftWords = (n: number) => plural(n, 'restante');

export default function Carnet({ me }: CardProps) {
  const [open, setOpen] = useState<MeCarnet | null>(null);
  const list = me.wallet?.carnets || [];
  if (!list.length) return null;
  return (
    <>
      {list.map((k) => <AvRow key={k.id} icon="ticket" title={carnetName(k)} sub={leftWords(k.left) + ' · ' + until(k.expires)} onOpen={() => setOpen(k)} guide="moi.carnet" />)}
      {open ? (
        <Sheet title={carnetName(open)} kicker="Mes avantages" onClose={() => setOpen(null)}>
          <div className="m-big"><b>{open.left}</b><span>{open.left > 1 ? 'coupes restantes' : 'coupe restante'} sur {open.total}</span></div>
          <p className="c-muted">Valable jusqu’au {dayWords(open.expires, { weekday: true, long: true })}. Chaque coupe se déduit au salon, au moment de payer.</p>
          <a className="c-btn" href="/?reserver">Réserver une coupe</a>
        </Sheet>
      ) : null}
    </>
  );
}
