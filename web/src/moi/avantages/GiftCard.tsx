// « Mes avantages » › the gift cards on the client's file with money left: the last four of the code, the balance, until
// when. The full code is never shown here: whoever holds it spends the card.
import { useState } from 'react';
import { eur } from '../../lib/format';
import { AvRow, Sheet, dayWords, until } from '../kit';
import type { CardProps, MeGiftcard } from '../types';

export const meta = { id: 'giftcard', order: 40 };

const amount = (c: number) => eur(c, { decimals: c % 100 !== 0 });

export default function GiftCard({ me }: CardProps) {
  const [open, setOpen] = useState<MeGiftcard | null>(null);
  const list = me.wallet?.giftcards || [];
  if (!list.length) return null;
  return (
    <>
      {list.map((g) => <AvRow key={g.id} icon="gift" title={'Carte cadeau •••• ' + g.last4} sub={amount(g.balance) + ' · ' + until(g.expires)} onOpen={() => setOpen(g)} guide="moi.giftcard" />)}
      {open ? (
        <Sheet title={'Carte cadeau •••• ' + open.last4} kicker="Mes avantages" onClose={() => setOpen(null)}>
          <div className="m-big"><b>{amount(open.balance)}</b><span>à dépenser au salon</span></div>
          <p className="c-muted">Valable jusqu’au {dayWords(open.expires, { weekday: true, long: true })}, en une ou plusieurs fois. Au moment de payer, présente ta carte ou son code au salon.</p>
          <a className="c-btn" href="/?reserver">Réserver</a>
        </Sheet>
      ) : null}
    </>
  );
}
