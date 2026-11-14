// FEATURE B · « Ce qui manque », under the next booking: what needs the client now (a deposit to pay, the membership's
// payment refused and how to fix it), then what is good to know (cuts left this month, the next charge, a carnet or a gift
// card that ends soon). GET /api/me/todo (server/domain/me.js meTodo). Nothing to say: one quiet line.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { eur, time } from '../../lib/format';
import { dayWords } from '../kit';
import type { CardProps } from '../types';

export const meta = { id: 'todo', tab: 'home' as const, order: 15 };

export type TodoItem = {
  id: string; tone: 'warn' | 'info'; title: string;
  amount?: number; day?: string; start?: number; from?: string; until?: string; left?: number; card?: string; last4?: string; bank?: boolean;
  /** formule: a week of his carnet without a date; the button books it from the carnet's card (its usual slot, one tap) */
  action?: { kind: 'link' | 'card' | 'membership' | 'formule'; label: string; href?: string; formule?: string; week?: number };
};
export type TodoPayment = { at: number; kind: 'membership' | 'deposit' | 'refund'; label: string; amount: number };
export type Todo = { items: TodoItem[]; payments: TodoPayment[] };

const money = (c: number) => eur(c, { decimals: c % 100 !== 0 });
/** The sentence under each title, from the item's facts. */
export function todoText(x: TodoItem): string {
  const k = x.id.split('_')[0];
  if (k === 'dep' && /^Carnet/.test(x.title)) return money(x.amount || 0) + ' à régler en ligne pour confirmer tes rendez-vous, dont le premier le ' + dayWords(x.day || '', { weekday: true }) + ' à ' + time(x.start || 0) + '.';
  if (x.id.startsWith('fo_due_')) return money(x.amount || 0) + ' à régler au salon, à ta première coupe. Les suivantes sont déjà payées.';
  if (x.id.startsWith('fo_wk_')) return 'Du ' + dayWords(x.from || '') + ' au ' + dayWords(x.until || '') + ' : une coupe par semaine, celle-ci n’a pas encore son rendez-vous.';
  if (x.id.startsWith('fo_end_')) return (x.left || 0) + ((x.left || 0) > 1 ? ' coupes restantes' : ' coupe restante') + ', à prendre avant le ' + dayWords(x.until || '', { long: true }) + ' au soir.';
  if (k === 'dep') return 'Acompte de ' + money(x.amount || 0) + ' pour confirmer ton rendez-vous du ' + dayWords(x.day || '', { weekday: true }) + ' à ' + time(x.start || 0) + '. Déduit du prix au salon.';
  if (x.id === 'mb_pastdue') return x.bank ? 'Ta banque demande de valider le paiement de ' + money(x.amount || 0) + '.' : 'Le paiement de ' + money(x.amount || 0) + ' n’est pas passé. Mets ta carte à jour : il repart tout seul ensuite.';
  if (x.id === 'mb_left') return 'À utiliser avant le ' + dayWords(x.until || '', { long: true }) + ' au soir.';
  if (x.id === 'mb_cancel') return 'Tes coupes restent incluses jusqu’au ' + dayWords(x.until || '', { long: true }) + ' au soir. Plus rien n’est prélevé ensuite.';
  if (x.id === 'mb_next') return money(x.amount || 0) + ' le ' + dayWords(x.day || '', { long: true }) + (x.card ? ', carte ' + x.card : '') + '.';
  if (k === 'pk') return (x.left || 0) + ((x.left || 0) > 1 ? ' coupes restantes' : ' coupe restante') + ', valable jusqu’au ' + dayWords(x.until || '', { long: true }) + '.';
  if (k === 'gc') return 'Reste ' + money(x.amount || 0) + ' sur la carte' + (x.last4 ? ' •••• ' + x.last4 : '') + ', valable jusqu’au ' + dayWords(x.until || '', { long: true }) + '.';
  return '';
}

export default function TodoCard({ me }: CardProps) {
  const [t, setT] = useState<Todo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // read again when the bookings or the wallet change (a deposit paid, a booking cancelled)
  useEffect(() => { api.get<Todo>('/api/me/todo').then(setT).catch(() => setT(null)); }, [me]);
  if (!t) return null;
  const card = async () => {
    if (me.demo) { setErr('Démo : ici, tu mets ta carte à jour sur la page sécurisée.'); return; }
    setBusy(true); setErr('');
    try { const r = await api.post<{ url: string }>('/api/me/membership/card', {}); location.href = r.url; }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  /** the carnet's card holds the week's button (its usual slot is read there): one tap from here books it */
  const week = (x: TodoItem) => {
    const b = document.querySelector<HTMLButtonElement>('[data-fo-week="' + x.action?.formule + '_' + x.action?.week + '"]');
    if (b) { b.scrollIntoView({ block: 'center' }); b.click(); } else document.querySelector('[data-guide="moi-carnet"]')?.scrollIntoView({ block: 'center' });
  };
  const open = () => { const row = document.querySelector<HTMLButtonElement>('[data-guide="moi-membership"]'); if (row) { row.scrollIntoView({ block: 'center' }); row.click(); } };
  return (
    <section className="c-card m-todo" aria-labelledby="m-todo-t" data-guide="moi.todo">
      <h2 className="c-k" id="m-todo-t">Ce qui manque</h2>
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      {!t.items.length ? <p className="c-muted">Rien ne manque : tout est à jour.</p> : (
        <ul className="m-todo-l">
          {t.items.map((x) => (
            <li key={x.id} className={x.tone}>
              <b>{x.title}</b>
              <span>{todoText(x)}</span>
              {x.action ? x.action.kind === 'link' ? <a className={'c-btn' + (x.tone === 'warn' ? '' : ' ghost')} href={x.action.href}>{x.action.label}</a>
                : x.action.kind === 'formule' ? <button type="button" className="c-btn" onClick={() => week(x)}>{x.action.label}</button>
                : x.action.kind === 'card' ? <button type="button" className="c-btn" disabled={busy} onClick={card}>{x.action.label}</button>
                : <button type="button" className="c-btn ghost" onClick={open}>{x.action.label}</button> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
