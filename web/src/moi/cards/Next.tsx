// The hero of « Rendez-vous »: the next booking as the /r/ page shows it (same ticket, same words), with its four
// gestures in one row. Moving, cancelling and paying go through the booking's own /r/ token routes, so the rules (the
// cancellation window, the deposit) are exactly the guest's. The other bookings to come sit under it, one line each.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { cap, dates, eur, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Move, STATUS_WORDS, icsUrl } from '../../client/booking';
import { todayKey } from '../kit';
import type { CardProps, MeUpcoming } from '../types';

export const meta = { id: 'next', tab: 'home' as const, order: 10 };

/** « Aujourd’hui · 17 h », « Demain · 9 h 30 », « Mar. 3 nov. · 10 h 30 » */
function whenShort(day: string, start: number) {
  const d = dates.diffDays(todayKey(), day);
  return (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : cap(dates.dayShort(day))) + ' · ' + time(start);
}
/** « lun. 2 nov. 22 h 30 », from an instant */
function untilWords(ms: number) { const p = dates.localParts(ms); return dates.dayShort(p.day) + ' ' + time(p.min); }

export default function Next({ me, reload }: CardProps) {
  const list = me.upcoming || [];
  const [pick, setPick] = useState<string | null>(null);
  const [mode, setMode] = useState<'' | 'move' | 'cancel'>('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const b = list.find((x) => x.id === pick) || list[0] || null;
  // a booking moved or cancelled since: back to the first one
  useEffect(() => { if (pick && !list.some((x) => x.id === pick)) setPick(null); }, [list, pick]);
  const ics = useMemo(() => (b ? icsUrl({ ...b, shop: me.shop }, b.manage) : ''), [b && b.id, b && b.day, b && b.start]);
  useEffect(() => () => { if (ics) URL.revokeObjectURL(ics); }, [ics]);
  // one live region that stays mounted, so what changed is read out
  const live = <div className="m-live" role="status">{note ? <p className={'c-note ' + note.tone}>{note.text}</p> : null}</div>;
  if (!b) return <>{live}</>;

  const tok = encodeURIComponent(b.token);
  const what = b.services.map((s) => s.name).join(' + ');
  const status = STATUS_WORDS[b.status];
  const tel = me.shop.phone ? 'tel:' + me.shop.phone.replace(/[^\d+]/g, '') : '';
  const choose = (id: string) => { setPick(id); setMode(''); setNote(null); };
  const pay = async () => {
    setBusy(true);
    try { const r = await api.post<{ url: string }>('/api/public/bookings/' + tok + '/pay', {}); location.href = r.url; }
    catch (e: any) { setNote({ tone: 'warn', text: e.message }); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      const paid = b.deposit?.paid || 0;
      await api.post('/api/public/bookings/' + tok + '/cancel', {});
      setMode(''); setPick(null);
      setNote({ tone: 'ok', text: 'C’est annulé. Le créneau est libéré' + (paid ? ' et ton acompte de ' + eur(paid) + ' est remboursé sur ta carte (quelques jours selon ta banque).' : '.') });
      reload();
    } catch (e: any) { setNote({ tone: 'warn', text: e.message }); } finally { setBusy(false); }
  };

  return (
    <>
      {live}
      <section className="c-card c-ticket m-hero" aria-labelledby="m-hero-w" data-guide="moi.next">
        <div className="c-row"><span className={'c-pill ' + status[1]}>{status[0]}</span><span className="c-code">Code <b>{b.code}</b></span></div>
        <p className="c-k">{list.length > 1 && b.id !== list[0].id ? 'Plus tard' : 'Ton prochain rendez-vous'}</p>
        <h2 className="m-when" id="m-hero-w">{whenShort(b.day, b.start)}</h2>
        <div className="c-what">
          <span>{what}{b.staff ? ' · avec ' + b.staff.name : ''}<small>{dates.fmtDur(b.dur)} · {eur(b.price)}</small></span>
        </div>
        <div className="m-acts" data-guide="moi.next.actions">
          <a className="m-act" href={ics} download={'rdv-' + b.code + '.ics'}><Icon name="calendar" size={22} /><span>Agenda</span></a>
          <a className="m-act" href={me.shop.mapsUrl} target="_blank" rel="noopener"><Icon name="map" size={22} /><span>Itinéraire</span></a>
          {b.canChange ? (
            <>
              <button type="button" className="m-act" aria-pressed={mode === 'move'} onClick={() => setMode(mode === 'move' ? '' : 'move')}><Icon name="move" size={22} /><span>Déplacer</span></button>
              <button type="button" className="m-act" aria-pressed={mode === 'cancel'} onClick={() => setMode(mode === 'cancel' ? '' : 'cancel')}><Icon name="x" size={22} /><span>Annuler</span></button>
            </>
          ) : tel ? <a className="m-act wide" href={tel}><Icon name="phone" size={22} /><span>Appeler le salon</span></a> : null}
        </div>
        <p className="m-policy">{b.canChange ? 'Modifiable jusqu’à ' + untilWords(b.changeUntil) + '. Après, appelle le salon.' : 'Pour le déplacer ou l’annuler maintenant, appelle le salon' + (me.shop.phone ? ' au ' + me.shop.phone : '') + '.'}</p>
        {b.status === 'pending' && b.deposit ? (
          <div className="m-dep">
            <p>Acompte de {eur(b.deposit.amount, { decimals: b.deposit.amount % 100 !== 0 })} à régler pour confirmer, déduit du prix au salon.</p>
            <button type="button" className="c-btn" disabled={busy} onClick={pay}>Régler l’acompte</button>
          </div>
        ) : null}
      </section>

      {mode === 'cancel' ? (
        <section className="c-card" aria-labelledby="m-cx-t">
          <h2 className="c-h2" id="m-cx-t">Annuler ce rendez-vous ?</h2>
          <p className="c-muted">{b.deposit?.paid ? 'Ton acompte de ' + eur(b.deposit.paid) + ' te sera remboursé.' : 'Le créneau sera proposé à quelqu’un d’autre.'}</p>
          <div className="c-row"><button type="button" className="c-btn" disabled={busy} onClick={cancel}>Oui, annuler</button><button type="button" className="c-link" onClick={() => setMode('')}>Non, je garde</button></div>
        </section>
      ) : null}
      {mode === 'move' ? <Move b={b} token={b.token} onDone={() => { setMode(''); setNote({ tone: 'ok', text: 'C’est déplacé. Un SMS de confirmation part tout de suite.' }); reload(); }} onCancel={() => setMode('')} /> : null}

      {list.length > 1 ? (
        <div className="m-others" data-guide="moi.others">
          <p className="c-k" id="m-others-t">Aussi à venir</p>
          <ul aria-labelledby="m-others-t">
            {list.filter((x) => x.id !== b.id).map((x: MeUpcoming) => (
              <li key={x.id}><button type="button" onClick={() => choose(x.id)}><span><b>{whenShort(x.day, x.start)}{x.staff ? ' · ' + x.staff.name : ''}</b><small>{x.services.map((s) => s.name).join(' + ')}</small></span><Icon name="chevR" size={18} /></button></li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
