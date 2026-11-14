// Encaisser sur son téléphone: the barber has finished, he rings his client up where he stands. The same ticket as the
// till (Checkout: the booked services at their price, a product, the tip, a discount within his cap, card on the salon's
// terminal, cash, carnet or membership, gift card, the QR when Stripe is plugged in, several methods at once), in a
// bottom sheet, sent with `phone` so the server checks it is his own client and that the owner allows it. The cash he
// takes stays with him: the end of day says how much each barber has to hand over (Caisse › Caisse & clôture).
import { useState } from 'react';
import { refreshAll, useQuery } from '../../../lib/query';
import { Button, Sheet } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Agenda } from '../../types';
import { Checkout } from './Checkout';
import '../caisse.css';

export function PhoneCheckout({ apptId, onDone }: { apptId: string; onDone: () => void }) {
  const { boot, pulse } = useApp();
  const today = pulse?.today || boot.today;
  // whoever is not a barber (the owner who also cuts) pays cash into the drawer: is it open?
  const { data } = useQuery<Agenda>(boot.me.role === 'barber' ? null : '/api/v1/agenda?day=' + today);
  // the ticket does not refresh the page behind it (the row would vanish with the receipt): done on closing
  const close = () => { refreshAll(); onDone(); };
  return (
    <Sheet open onClose={close} title="Encaisser" kicker="Sur ton téléphone">
      <div className="ph-co" data-guide="phone-checkout">
        <Checkout key={apptId} apptId={apptId} phone drawerOpen={!!data?.drawer.open} onClose={close} />
      </div>
    </Sheet>
  );
}

type Row = { id: string; status: string; start: number; dur: number; paid: boolean };

/** One « Encaisser » for an appointment of his once the client is in the chair or the cut is over, unpaid, today. */
export function PhoneCheckoutButton({ row, nowMin, isToday = true, size }: { row: Row; nowMin: number | null; isToday?: boolean; size?: 'sm' }) {
  const { can, offline } = useApp();
  const [open, setOpen] = useState(false);
  const due = row.status === 'in_chair' || row.status === 'done' || ((row.status === 'booked' || row.status === 'arrived') && nowMin != null && row.start + row.dur <= nowMin);
  // an open sheet stays open whatever the row now says (paid, the next client): the receipt is still on it
  if (!open && (!can('sale.phone') || !isToday || row.paid || !due)) return null;
  return (
    <>
      {!row.paid ? <Button size={size} variant="primary" icon="caisse" disabled={offline} data-guide="phone-pay" onClick={() => setOpen(true)}>Encaisser</Button> : null}
      {open ? <PhoneCheckout apptId={row.id} onDone={() => setOpen(false)} /> : null}
    </>
  );
}
