// The carnet bought with its dates (« 5 coupes sur 5 semaines »), in the client space: five dots (faite, réservée, à
// réserver), each week with its date, its page to move or cancel it, its receipt once done; the end of its validity,
// what is paid, a week without a date booked in one tap (the usual day, hour and barber when free, « Un autre moment »
// otherwise), and « Reprendre 5 coupes » after the last one. GET /api/me/formule (server/http/routes-formule.js).
import { useEffect, useState } from 'react';
import { api, uuid } from '../../lib/api';
import { dates, eur, time } from '../../lib/format';
import { dayWords } from '../kit';
import type { CardProps } from '../types';

export const meta = { id: 'formule', tab: 'home' as const, order: 20 };

type Week = {
  k: number; from: string; to: string; state: 'done' | 'booked' | 'open' | 'lost'; n: number; missed: boolean;
  appt: { day: string; start: number; staff: { id: string; name: string } | null; status: string; token: string | null; receipt: string | null } | null;
};
export type MeFormule = {
  id: string; name: string; price: number; credits: number; used: number; left: number; missed: 'lost' | 'once'; forFirst: string;
  pay: 'paid' | 'online' | 'pending' | 'due'; status: 'open' | 'ended' | 'released'; start: string; end: string; weeks: Week[]; receipt: string | null;
};
type Card = { offer: { id: string; slug: string | null; name: string; price: number; credits: number; pay: 'online' | 'salon' } | null; items: MeFormule[]; renew: boolean; demo: boolean };
type WeekSlots = { k: number; proposal: { day: string; start: number; staffId: string } | null; days: { day: string; slots: { m: number; s: string }[] }[]; staff: Record<string, string> };

const money = (c: number) => eur(c, { decimals: c % 100 !== 0 });
const DOT: Record<Week['state'], string> = { done: 'faite', booked: 'réservée', open: 'à réserver', lost: 'perdue' };
/** « 1 faite · 3 réservées · 1 à réserver » */
export function dotsWords(weeks: { state: Week['state'] }[]) {
  const n = (s: Week['state']) => weeks.filter((w) => w.state === s).length;
  const part = (s: Week['state'], one: string, many: string) => (n(s) ? n(s) + ' ' + (n(s) > 1 ? many : one) : '');
  return [part('done', 'faite', 'faites'), part('booked', 'réservée', 'réservées'), part('open', 'à réserver', 'à réserver'), part('lost', 'perdue', 'perdues')].filter(Boolean).join(' · ');
}
const whenOf = (day: string, start: number) => dayWords(day, { weekday: true }) + ' à ' + time(start);

function One({ f, onChange, demo }: { f: MeFormule; onChange: (c: Card) => void; demo: boolean }) {
  const [slots, setSlots] = useState<Record<number, WeekSlots>>({});
  const [pick, setPick] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const open = f.status === 'open' && f.pay !== 'pending' ? f.weeks.filter((w) => w.state === 'open' && f.left > f.weeks.filter((x) => x.state === 'booked').length) : [];
  const key = open.map((w) => w.k).join(',');
  // what is free in each week without a date, so one tap books the usual slot
  useEffect(() => {
    let live = true;
    for (const w of open) api.get<WeekSlots>('/api/me/formule/' + f.id + '/weeks/' + w.k).then((r) => { if (live) setSlots((s) => ({ ...s, [w.k]: r })); }).catch(() => {});
    return () => { live = false; };
  }, [f.id, key]);
  const book = async (x: { day: string; start: number; staffId: string }) => {
    if (demo) { setErr('Démo : rien n’est réservé. Avec ton compte, un tap suffit.'); return; }
    setBusy(true); setErr('');
    try { onChange(await api.post<Card>('/api/me/formule/' + f.id + '/weeks', x, uuid())); setPick(null); }
    catch (e: any) { setErr(e.message); if (e?.status === 409) setSlots({}); }
    finally { setBusy(false); }
  };
  const first = f.weeks.find((w) => w.appt && w.appt.token && w.state === 'booked');
  const pour = f.forFirst ? ' de ' + f.forFirst : '';
  return (
    <section className="c-card m-fo" aria-label={f.name + pour} data-guide="moi-carnet">
      <div className="c-row"><h2 className="c-k">{f.name}{pour}</h2><span className="m-fo-n">{f.used} sur {f.credits}</span></div>
      <div className="m-fo-dots" role="img" aria-label={dotsWords(f.weeks)}>{f.weeks.map((w) => <i key={w.k} className={'fo-dot ' + w.state} title={DOT[w.state]} />)}</div>
      <p className="m-fo-l">{dotsWords(f.weeks)}</p>
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      <ul className="m-rows m-fo-w">
        {f.weeks.map((w) => {
          const a = w.appt;
          const s = slots[w.k];
          const usual = s && s.proposal;
          return (
            <li key={w.k} className={w.state === 'lost' ? 'gone' : ''}>
              <span className="m-rows-t">
                <b>{w.state === 'done' || w.state === 'booked' ? 'Coupe ' + w.n + ' · ' + (a ? whenOf(a.day, a.start) : '') : w.state === 'lost' ? 'Semaine perdue' : 'À réserver'}</b>
                <small>{w.state === 'done' ? 'Faite' + (a && a.staff ? ' avec ' + a.staff.name : '') : w.state === 'booked' ? 'Réservée' + (a && a.staff ? ' avec ' + a.staff.name : '') : w.state === 'lost' ? (w.missed ? 'Rendez-vous manqué' : 'Sans coupe') + ', du ' + dayWords(w.from) + ' au ' + dayWords(w.to) : 'Semaine du ' + dayWords(w.from) + ' au ' + dayWords(w.to)}</small>
                {w.state === 'open' && open.includes(w) ? (
                  <span className="m-fo-a">
                    {usual ? <button type="button" className="c-btn" disabled={busy} data-fo-week={f.id + '_' + w.k} onClick={() => book(usual)}>Réserver cette semaine · {whenOf(usual.day, usual.start)}{s.staff[usual.staffId] ? ' avec ' + s.staff[usual.staffId] : ''}</button>
                      : s ? <span className="c-muted">Rien de libre cette semaine : appelle le salon.</span> : <span className="c-spin" />}
                    {s && s.days.length ? <button type="button" className="c-link" onClick={() => { setPick(pick === w.k ? null : w.k); setDay(null); }}>{pick === w.k ? 'Fermer' : 'Un autre moment'}</button> : null}
                  </span>
                ) : null}
                {pick === w.k && s ? (() => {
                  const cur = s.days.find((d) => d.day === day) || s.days[0];
                  return (
                    <span className="m-fo-p">
                      <span className="c-days" role="group" aria-label="Un jour de cette semaine">
                        {s.days.map((d) => { const p = dates.dayParts(d.day); return <button key={d.day} type="button" aria-pressed={d.day === cur.day} onClick={() => setDay(d.day)}><small>{dates.DAYS_SH[p.wd]}</small><b>{p.d}</b><span>{d.slots.length} libres</span></button>; })}
                      </span>
                      <span className="c-slots">{cur.slots.map((x) => <button key={x.m + x.s} type="button" disabled={busy} aria-label={time(x.m) + (s.staff[x.s] ? ' avec ' + s.staff[x.s] : '')} onClick={() => book({ day: cur.day, start: x.m, staffId: x.s })}>{time(x.m)}</button>)}</span>
                    </span>
                  );
                })() : null}
              </span>
              {w.state === 'booked' && a && a.token ? <a className="c-link" href={'/r/' + a.token} aria-label={'Déplacer ou annuler la coupe ' + w.n}>Gérer</a> : null}
              {w.state === 'done' && a && a.receipt ? <a className="c-link" href={a.receipt}>Reçu</a> : null}
            </li>
          );
        })}
      </ul>
      <p className="c-muted">{f.status === 'released' ? 'La première coupe n’a pas eu lieu et rien n’était réglé : les autres rendez-vous ont été libérés.' : f.status === 'ended' ? (f.left ? 'Terminé le ' + dayWords(f.end, { long: true }) + '.' : 'Tes ' + f.credits + ' coupes sont faites.') : 'Tes coupes se prennent jusqu’au ' + dayWords(f.end, { weekday: true, long: true }) + (f.missed === 'once' ? ' (une semaine manquée se rattrape une fois).' : ' : une semaine sans coupe est perdue.')}</p>
      {f.status === 'open' || f.pay === 'paid' || f.pay === 'online' ? (
        <p className={'m-fo-pay' + (f.pay === 'due' || f.pay === 'pending' ? ' warn' : '')}>
          {f.pay === 'paid' ? 'Payé au salon : ' + money(f.price) + '.' : f.pay === 'online' ? 'Payé en ligne : ' + money(f.price) + '.' : f.pay === 'pending' ? money(f.price) + ' à régler en ligne pour confirmer tes rendez-vous.' : money(f.price) + ' à régler au salon, à ta première coupe.'}
          {f.receipt ? <> <a className="c-link" href={f.receipt}>Reçu du carnet</a></> : null}
          {f.pay === 'pending' && first && first.appt ? <> <a className="c-link" href={'/r/' + first.appt.token}>Régler</a></> : null}
        </p>
      ) : null}
    </section>
  );
}

export default function Formule({ me }: CardProps) {
  const [c, setC] = useState<Card | null>(null);
  // read again when the bookings change (a date moved, cancelled, paid)
  useEffect(() => { api.get<Card>('/api/me/formule').then(setC).catch(() => setC(null)); }, [me]);
  if (!c || (!c.items.length && !c.renew)) return null;
  return (
    <>
      {c.items.map((f) => <One key={f.id} f={f} onChange={setC} demo={c.demo} />)}
      {c.renew && c.offer ? (
        <section className="c-card m-fo" data-guide="moi-carnet-reprendre">
          <h2 className="c-k">{c.offer.name}</h2>
          <p className="c-muted">Ton carnet est terminé. On repart pour {c.offer.credits} coupes, une par semaine ?</p>
          <a className="c-btn" href={'/?reserver&prestation=' + encodeURIComponent(c.offer.slug || '')}>Reprendre {c.offer.credits} coupes · {money(c.offer.price)}</a>
        </section>
      ) : null}
    </>
  );
}
