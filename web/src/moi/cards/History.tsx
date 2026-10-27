// « Historique »: the client's visits, newest first, each with its receipt when there is one; missed and cancelled
// bookings stay, faint. « Voir plus » asks for the page before the last day shown (GET /api/me/history?before=).
import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api';
import { dates, eur } from '../../lib/format';
import type { CardProps, MeHistory, MeHistoryItem } from '../types';

export const meta = { id: 'history', tab: 'history' as const, order: 10 };

const PAST: Record<MeHistoryItem['status'], string> = { done: '', no_show: 'Manqué', cancelled: 'Annulé' };
/** « 12 oct. », the year when it is not this one */
function dayWords(day: string, year: string) { const p = dates.dayParts(day); return p.d + ' ' + dates.MONTHS_SH[p.m - 1] + (day.slice(0, 4) !== year ? ' ' + p.y : ''); }

export default function History({ me }: CardProps) {
  const [items, setItems] = useState<MeHistoryItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = async (before?: string) => {
    setBusy(true); setErr('');
    try {
      const r = await api.get<MeHistory>('/api/me/history' + qs({ before }));
      setItems((cur) => (before && cur ? [...cur, ...r.items] : r.items));
      setMore(r.more);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const year = dates.localParts(Date.now()).day.slice(0, 4);
  const fence = me.fenced && me.historyFrom ? <p className="c-muted c-small m-fence">Ton historique d’avant le {dates.dayLong(me.historyFrom)} n’apparaît pas ici. S’il est à toi, demande-le au salon.</p> : null;

  return (
    <section className="c-card m-hist" aria-labelledby="m-hist-t" aria-busy={busy} data-guide="moi.history">
      <h2 className="c-k" id="m-hist-t">Tes visites</h2>
      {fence}
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      {!items ? (busy ? <span className="c-spin" /> : null) : !items.length ? (
        <p className="c-muted">Rien encore : ton historique s’écrit à ta première visite.</p>
      ) : (
        <ul className="m-rows">
          {items.map((x, i) => {
            const gone = x.status !== 'done';
            return (
              <li key={x.day + x.start + ':' + i} className={gone ? 'gone' : ''}>
                <span className="m-rows-t">
                  <b>{dayWords(x.day, year)} · {x.services.map((s) => s.name).join(' + ') || 'Passage'}</b>
                  <small>{[x.staff ? x.staff.name : '', gone ? PAST[x.status] : eur(x.receipt ? x.paid : x.price)].filter(Boolean).join(' · ')}</small>
                </span>
                {x.receipt ? <a className="m-rec" href={x.receipt} aria-label={'Reçu du ' + dayWords(x.day, year)}>Reçu</a> : null}
              </li>
            );
          })}
        </ul>
      )}
      {more ? <button type="button" className="c-btn ghost m-more" disabled={busy} onClick={() => items && items.length && load(items[items.length - 1].day)}>{busy ? 'Un instant…' : 'Voir plus'}</button> : null}
    </section>
  );
}
