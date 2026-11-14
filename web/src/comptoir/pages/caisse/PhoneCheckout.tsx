// Encaisser sur son téléphone: the barber has finished, he rings his client up where he stands. The same ticket as the
// till (Checkout: the booked services at their price, a product, the tip, a discount within his cap, card on the salon's
// terminal, cash, carnet or membership, gift card, the QR when Stripe is plugged in, several methods at once), in a
// bottom sheet, sent with `phone` so the server checks it is his own client, today, and that the owner allows it. The
// cash he takes stays with him: the end of day says how much each barber has to hand over (Caisse › Caisse & clôture).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { refreshAll, useQuery } from '../../../lib/query';
import { Button, Sheet } from '../../../ui/kit';
import { useApp } from '../../state';
import type { Agenda } from '../../types';
import { Checkout, Done } from './Checkout';
import '../caisse.css';

/* The sheet open on this phone, and its receipt once paid, live outside the row that opened it: when Mon espace reads
 * itself again (every 60 s), the paid row loses its button and « Prochain client » moves on, but the receipt stays on
 * screen until he taps « Terminé ». Every button and host registers; the first one mounted shows the sheet. */
let open: { apptId: string; done: any | null } | null = null;
let hosts: symbol[] = [];
let ver = 0;
const subs = new Set<() => void>();
const emit = () => { ver++; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function openPhoneCheckout(apptId: string) { open = { apptId, done: null }; emit(); }

function useHost() {
  const [me] = useState(() => Symbol('host'));
  useSyncExternalStore(subscribe, () => ver, () => ver);
  useEffect(() => {
    hosts = [...hosts, me]; emit();
    return () => { hosts = hosts.filter((h) => h !== me); emit(); };
  }, [me]);
  return open && hosts[0] === me ? open : null;
}

function PhoneSheet({ apptId, done }: { apptId: string; done: any | null }) {
  const { boot, pulse } = useApp();
  const today = pulse?.today || boot.today;
  // whoever is not a barber (the owner who also cuts) pays cash into the drawer: is it open?
  const { data } = useQuery<Agenda>(boot.me.role === 'barber' ? null : '/api/v1/agenda?day=' + today);
  // the ticket does not refresh the page behind it (the row would vanish with the receipt): done on closing
  const close = () => { open = null; emit(); refreshAll(); };
  const paid = (d: any) => { if (open && open.apptId === apptId) { open = { apptId, done: d }; emit(); } };
  return (
    <Sheet open onClose={close} title="Encaisser" kicker="Sur ton téléphone">
      <div className="ph-co" data-guide="phone-checkout">
        {done ? <Done done={done} onNext={close} phone /> : <Checkout key={apptId} apptId={apptId} phone drawerOpen={!!data?.drawer.open} onClose={close} onPaid={paid} />}
      </div>
    </Sheet>
  );
}

/** Keeps the sheet (and its receipt) on screen where no button is mounted any more, e.g. « Prochain client » with nobody left. */
export function PhoneCheckoutHost() {
  const cur = useHost();
  return cur ? <PhoneSheet apptId={cur.apptId} done={cur.done} /> : null;
}

/** Kept for callers that open the sheet themselves: shows it for one appointment until onDone. */
export function PhoneCheckout({ apptId, onDone }: { apptId: string; onDone: () => void }) {
  useEffect(() => {
    openPhoneCheckout(apptId);
    const f = () => { if (!open) onDone(); };
    subs.add(f);
    return () => { subs.delete(f); };
  }, [apptId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <PhoneCheckoutHost />;
}

type Row = { id: string; status: string; start: number; dur: number; paid: boolean };

/** One « Encaisser » for an appointment of his once the client is in the chair or the cut is over, unpaid, today. */
export function PhoneCheckoutButton({ row, nowMin, isToday = true, size }: { row: Row; nowMin: number | null; isToday?: boolean; size?: 'sm' }) {
  const { can, offline } = useApp();
  const cur = useHost();
  const due = row.status === 'in_chair' || row.status === 'done' || ((row.status === 'booked' || row.status === 'arrived') && nowMin != null && row.start + row.dur <= nowMin);
  const show = can('sale.phone') && isToday && !row.paid && due;
  return (
    <>
      {show ? <Button size={size} variant="primary" icon="caisse" disabled={offline} data-guide="phone-pay" onClick={() => openPhoneCheckout(row.id)}>Encaisser</Button> : null}
      {cur ? <PhoneSheet apptId={cur.apptId} done={cur.done} /> : null}
    </>
  );
}
