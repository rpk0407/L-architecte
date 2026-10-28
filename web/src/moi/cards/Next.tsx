// The hero of « Rendez-vous »: the next booking as the /r/ page shows it (same ticket, same words), with its four
// gestures in one row. Moving, cancelling and paying go through the booking's own /r/ token routes, so the rules (the
// cancellation window, the deposit) are exactly the guest's. The other bookings to come sit under it, one line each.
// The demo's client is every visitor's showcase: what a visitor moves, cancels or pays there stays on his phone, nothing
// is sent to the salon, so the next visitor finds the same bookings.
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { api } from '../../lib/api';
import { cap, dates, eur, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Move, STATUS_WORDS, icsUrl } from '../../client/booking';
import { dayWords, todayKey } from '../kit';
import type { CardProps, MeUpcoming } from '../types';

export const meta = { id: 'next', tab: 'home' as const, order: 10 };

/** « Aujourd’hui · 17 h », « Demain · 9 h 30 », « Mar. 3 nov. · 10 h 30 » */
function whenShort(day: string, start: number) {
  const d = dates.diffDays(todayKey(), day);
  return (d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : cap(dayWords(day, { weekday: true }))) + ' · ' + time(start);
}
/** « lun. 2 nov. 22 h 30 », from an instant */
function untilWords(ms: number) { const p = dates.localParts(ms); return dayWords(p.day, { weekday: true }) + ' ' + time(p.min); }

const DEMO_NOTE = ' Démo : rien n’est changé au salon.';
/** What the demo's visitor did to its bookings, on this phone only: moved to another slot, or cancelled. */
type Sim = Record<string, { day: string; start: number } | 'cancelled'>;
function simulated(list: MeUpcoming[], sim: Sim) {
  const out: MeUpcoming[] = [];
  for (const x of list) {
    const o = sim[x.id];
    if (o === 'cancelled') continue;
    if (!o) { out.push(x); continue; }
    const changeUntil = x.changeUntil + dates.instantOf(o.day, o.start) - dates.instantOf(x.day, x.start);
    out.push({ ...x, ...o, changeUntil, canChange: changeUntil > Date.now() });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.start - b.start));
}
// kept for the page's life: another tab and back shows the same moves and cancels
let demoSim: Sim = {};

export default function Next({ me, reload }: CardProps) {
  const [sim, setSimState] = useState<Sim>(() => demoSim);
  const setSim = (f: (x: Sim) => Sim) => setSimState((x) => (demoSim = f(x)));
  const list = useMemo(() => (me.demo ? simulated(me.upcoming || [], sim) : me.upcoming || []), [me.upcoming, me.demo, sim]);
  const [pick, setPick] = useState<string | null>(null);
  const [mode, setMode] = useState<'' | 'move' | 'cancel'>('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const b = list.find((x) => x.id === pick) || list[0] || null;
  // a booking moved or cancelled since: back to the first one
  useEffect(() => { if (pick && !list.some((x) => x.id === pick)) setPick(null); }, [list, pick]);
  // one live region that stays mounted, so what changed is read out
  const live = <div className="m-live" role="status">{note ? <p className={'c-note ' + note.tone}>{note.text}</p> : null}</div>;
  if (!b) return <>{live}</>;

  const tok = encodeURIComponent(b.token);
  const what = b.services.map((s) => s.name).join(' + ');
  const status = STATUS_WORDS[b.status];
  const tel = me.shop.phone ? 'tel:' + me.shop.phone.replace(/[^\d+]/g, '') : '';
  // no map link set by the salon: a search of its address (an empty href would open this page again)
  const maps = me.shop.mapsUrl || (me.shop.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(me.shop.address) : '');
  const choose = (id: string) => { setPick(id); setMode(''); setNote(null); };
  // the .ics is made at the tap, from the booking as it is now (the link falls back to its /r/ page, which has it too)
  const agenda = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    const url = icsUrl({ ...b, shop: me.shop }, b.manage);
    const a = document.createElement('a');
    a.href = url; a.download = 'rdv-' + b.code + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  const pay = async () => {
    if (me.demo) { setNote({ tone: 'ok', text: 'Ici, tu règles l’acompte par carte, et le rendez-vous est confirmé.' + DEMO_NOTE }); return; }
    setBusy(true);
    try { const r = await api.post<{ url: string }>('/api/public/bookings/' + tok + '/pay', {}); location.href = r.url; }
    catch (e: any) { setNote({ tone: 'warn', text: e.message }); setBusy(false); }
  };
  const cancel = async () => {
    if (me.demo) {
      setSim((x) => ({ ...x, [b.id]: 'cancelled' })); setMode(''); setPick(null);
      setNote({ tone: 'ok', text: 'C’est annulé. Le créneau est libéré.' + DEMO_NOTE });
      return;
    }
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
          <a className="m-act" href={b.manage} onClick={agenda}><Icon name="calendar" size={22} /><span>Agenda</span></a>
          {maps ? <a className="m-act" href={maps} target="_blank" rel="noopener"><Icon name="map" size={22} /><span>Itinéraire</span></a> : null}
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
      {mode === 'move' ? (
        <Move b={b} token={b.token} onDone={() => { setMode(''); setNote({ tone: 'ok', text: 'C’est déplacé. Un SMS de confirmation part tout de suite.' }); reload(); }} onCancel={() => setMode('')}
          onPick={me.demo ? (day, start) => { setSim((x) => ({ ...x, [b.id]: { day, start } })); setMode(''); setNote({ tone: 'ok', text: 'C’est déplacé.' + DEMO_NOTE }); } : undefined} />
      ) : null}

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
