// A booking's shared bits, for the /r/ page (web/src/client/main.tsx) and the client space (/moi): the words of each
// status, the .ics file for the phone's calendar, and moving to another slot through the booking's signed /r/ token.
import { useEffect, useRef, useState } from 'react';
import { api, qs, uuid } from '../lib/api';
import { dates, time } from '../lib/format';

export type Booking = {
  code: string; status: 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show' | 'cancelled'; day: string; start: number; dur: number;
  services: { id: string; name: string; price: number; from: boolean }[]; price: number;
  staff: { id: string; name: string; initials: string; color: string } | null; anyStaff: boolean; first: string;
  deposit: { amount: number; paid: number; url: string | null } | null; canChange: boolean; cancelUntilHours: number;
  shop: { name: string; address: string; phone: string; mapsUrl: string }; cancelled: { by: string; at: number } | null;
  /** a date of a carnet bought with its dates: « coupe 3 sur 5 », and what is still to pay (cents, 0 once paid) */
  formule?: Formule;
};
export type Formule = { n: number; of: number; name: string; pay: 'paid' | 'online' | 'pending' | 'due'; due: number; end: string };
/** « coupe 3 sur 5 » */
export const serieWords = (f: { n: number; of: number }) => 'coupe ' + f.n + ' sur ' + f.of;

/** The pill of each status: its words and its tone (ok, warn, or none). */
export const STATUS_WORDS: Record<Booking['status'], [string, string]> = {
  pending: ['Acompte à régler', 'warn'], booked: ['Confirmé', 'ok'], arrived: ['Tu es arrivé', 'ok'], in_chair: ['C’est parti', 'ok'],
  done: ['Merci pour ta visite', ''], no_show: ['Rendez-vous manqué', 'warn'], cancelled: ['Annulé', 'warn']
};

/** What an .ics needs: a /r/ booking or a /moi one (whose shop comes from the space). */
export type IcsBooking = {
  code: string; day: string; start: number; dur: number; services: { name: string }[];
  staff: { name: string } | null; shop: { name: string; address: string };
};

/** A blob: URL of the booking as an .ics file; url is the page that manages it (the /r/ link). */
export function icsUrl(b: IcsBooking, url: string = location.href) {
  const what = b.services.map((s) => s.name).join(' + ');
  const d = b.day.replace(/-/g, ''), t1 = dates.hhmm(b.start).replace(':', '') + '00', t2 = dates.hhmm(b.start + b.dur).replace(':', '') + '00';
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//RDV//FR', 'BEGIN:VEVENT', 'UID:' + b.code + '@larchitecte', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
    'DTSTART;TZID=Europe/Paris:' + d + 'T' + t1, 'DTEND;TZID=Europe/Paris:' + d + 'T' + t2, 'SUMMARY:' + b.shop.name + ' · ' + what, 'LOCATION:' + b.shop.address.replace(/,/g, '\\,'),
    'DESCRIPTION:' + (b.staff ? 'Avec ' + b.staff.name + '. ' : '') + 'Code ' + b.code + '. ' + url, 'URL:' + url, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}

/** What moving needs to know of the booking: the same services, the same barber unless any was fine. */
export type MovableBooking = { services: { id: string }[]; anyStaff: boolean; staff: { id: string } | null };

/** onPick (the demo's client in /moi): the slot chosen is handed back and nothing is sent, so the showcase stays as it is. */
export function Move({ b, token, onDone, onCancel, onPick }: { b: MovableBooking; token: string; onDone: (b: Booking) => void; onCancel: () => void; onPick?: (day: string, start: number) => void }) {
  const [days, setDays] = useState<{ day: string; slots: { m: number; s: string }[] }[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** fresh: after a refusal (409, the slot was just taken) the free slots are read as the journal is, past any cache; the day in view is kept */
  const load = (fresh?: boolean) => api.get<{ days: { day: string; open: boolean; slots: { m: number; s: string }[] }[] }>('/api/public/availability' + qs({ services: b.services.map((s) => s.id).join(','), staff: b.anyStaff || !b.staff ? 'any' : b.staff.id, days: 14, move: token, fresh: fresh ? 1 : undefined }))
    .then((r) => { const open = r.days.filter((d) => d.open); setDays(open); setDay((cur) => (fresh && cur && open.some((d) => d.day === cur) ? cur : (open.find((d) => d.slots.length) || open[0])?.day || null)); });
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);
  // one id per attempt: a move whose answer was lost on the way is sent again under the same id (same slot), never done twice
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const go = async (m: number) => {
    if (!day) return;
    if (onPick) { onPick(day, m); return; }
    setBusy(true); setErr('');
    const key = day + '|' + m;
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, id: uuid() };
    try {
      const done = await api.post<Booking>('/api/public/bookings/' + encodeURIComponent(token) + '/move', { day, start: m }, attempt.current.id);
      attempt.current = null;
      onDone(done);
    } catch (e: any) {
      // an answer came back: this attempt is over (no network: the id is kept for the next tap on the same hour)
      if (e?.status) attempt.current = null;
      setErr(e.message); setBusy(false);
      if (e?.status === 409) load(true).catch(() => {});
    }
  };
  const cur = days?.find((d) => d.day === day);
  return (
    <section className="c-card">
      <div className="c-row"><h2 className="c-h2">Pour quand ?</h2><button type="button" className="c-link" onClick={onCancel}>Retour</button></div>
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      {!days ? <span className="c-spin" /> : (
        <>
          <div className="c-days" role="group" aria-label="Choisis un jour">
            {days.map((d) => { const p = dates.dayParts(d.day); return <button key={d.day} type="button" aria-pressed={d.day === day} className={d.slots.length ? '' : 'full'} onClick={() => setDay(d.day)}><small>{dates.DAYS_SH[p.wd]}</small><b>{p.d}</b><span>{d.slots.length ? d.slots.length + ' libres' : 'complet'}</span></button>; })}
          </div>
          {cur && cur.slots.length ? <div className="c-slots">{cur.slots.map((x) => <button key={x.m} type="button" disabled={busy} onClick={() => go(x.m)}>{time(x.m)}</button>)}</div> : <p className="c-muted">Complet ce jour-là. Essaie un autre jour.</p>}
          <p className="c-muted c-small">Même prestation{b.anyStaff || !b.staff ? '' : ', même barbier'}. Un tap sur l’heure suffit, l’ancien créneau est libéré.</p>
        </>
      )}
    </section>
  );
}
