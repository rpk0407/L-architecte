// FEATURE B · « Tes paiements » in the history tab: each month of the membership charged, each deposit paid online and
// what came back, newest first (GET /api/me/todo, server/domain/me.js meTodo). The tickets of the visits, with their
// receipts, are in « Tes visites » just above.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { dates, eur } from '../../lib/format';
import { dayWords } from '../kit';
import type { CardProps } from '../types';
import type { Todo } from './Todo';

export const meta = { id: 'payments', tab: 'history' as const, order: 20 };

export default function Payments({ me }: CardProps) {
  const [t, setT] = useState<Todo | null>(null);
  useEffect(() => { api.get<Todo>('/api/me/todo').then(setT).catch(() => setT(null)); }, [me]);
  if (!t || !t.payments.length) return null;
  return (
    <section className="c-card m-hist" aria-labelledby="m-pay-t" data-guide="moi.payments">
      <h2 className="c-k" id="m-pay-t">Tes paiements</h2>
      <ul className="m-rows">
        {t.payments.map((p, i) => (
          <li key={p.at + ':' + i}>
            <span className="m-rows-t"><b>{p.label}</b><small>{dayWords(dates.localParts(p.at).day, { long: true })}</small></span>
            <b className={'m-pay-a' + (p.kind === 'refund' ? ' back' : '')}>{(p.kind === 'refund' ? '+ ' : '') + eur(p.amount, { decimals: p.amount % 100 !== 0 })}</b>
          </li>
        ))}
      </ul>
      <p className="c-muted c-small">Les tickets de tes visites, avec leurs reçus, sont dans « Tes visites ».</p>
    </section>
  );
}
