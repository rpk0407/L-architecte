// FEATURE B · What the /r/ page adds for a client without an account (GET /api/public/contact/:token,
// server/http/routes-client.js): his other bookings to come (those he booked for a child or a friend too), « Préviens-moi
// si un créneau se libère plus tôt » on this one, how the salon reaches him, and WhatsApp to write to the salon. And the
// offer a « créneau libéré » text carries (?plus-tot=day.minute): one tap moves the booking there, through the usual move.
import { useEffect, useState } from 'react';
import { api, uuid } from '../lib/api';
import { cap, dates, eur, time } from '../lib/format';
import type { Booking } from './booking';

export type Via = 'sms' | 'whatsapp' | 'email';
export type ContactItem = {
  token: string; code: string; self: boolean; day: string; start: number; dur: number; status: 'pending' | 'booked';
  services: { name: string; price: number; from: boolean }[]; price: number; staff: { name: string; initials: string; color: string } | null; anyStaff: boolean;
  deposit: { amount: number; paid: number; open: boolean } | null; canChange: boolean; changeUntil: number; earlier: boolean; forFirst: string;
};
export type ContactView = {
  items: ContactItem[]; cancelUntilHours: number; notify: { via: Via; options: Via[] } | null;
  shop: { name: string; address: string; phone: string; mapsUrl: string; whatsapp: string };
};

const VIA_WORDS: Record<Via, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'E-mail' };
const priceOf = (x: { price: number; services: { from: boolean }[] }) => (x.services.some((s) => s.from) ? 'dès ' + eur(x.price) : eur(x.price));
const whenOf = (day: string, start: number) => cap(dates.dayLong(day)) + ' à ' + time(start);

/** « jeudi 19 novembre à 10 h », from the text's ?plus-tot=2026-11-19.600 */
export function readEarlier(v: string | null): { day: string; start: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d{1,4})$/.exec(v || '');
  return m && Number(m[2]) < 1440 ? { day: m[1], start: Number(m[2]) } : null;
}

/** The slot a « créneau libéré » text offers: take it (the usual move, checked again), or keep the booking. */
export function EarlierOffer({ b, token, slot, onDone, onClose }: { b: Booking; token: string; slot: { day: string; start: number }; onDone: (b: Booking) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rid] = useState(uuid);
  const later = slot.day > b.day || (slot.day === b.day && slot.start >= b.start);
  if (later || !['booked', 'pending'].includes(b.status)) return null;
  const take = async () => {
    setBusy(true); setErr('');
    try { onDone(await api.post<Booking>('/api/public/bookings/' + encodeURIComponent(token) + '/move', { day: slot.day, start: slot.start }, rid)); }
    catch (e: any) { setErr(e.code === 'taken' ? 'Ce créneau vient d’être repris. Ton rendez-vous ne bouge pas.' : e.message); setBusy(false); }
  };
  return (
    <section className="c-card c-earlier" aria-labelledby="c-earlier-t">
      <p className="c-k">Un créneau s’est libéré</p>
      <h2 className="c-h2" id="c-earlier-t">{whenOf(slot.day, slot.start)}{b.staff ? ' avec ' + b.staff.name : ''}</h2>
      <p className="c-muted">Au lieu de {dates.dayLong(b.day)} à {time(b.start)}. Même prestation, même prix.</p>
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      {!b.canChange ? <p className="c-note warn">Ton rendez-vous est trop proche pour être déplacé en ligne. Appelle le salon{b.shop.phone ? ' au ' + b.shop.phone : ''}.</p> : (
        <div className="c-row"><button type="button" className="c-btn" disabled={busy} onClick={take}>{busy ? 'Un instant…' : 'Avancer à ce créneau'}</button><button type="button" className="c-link" onClick={onClose}>Je garde mon heure</button></div>
      )}
    </section>
  );
}

/** Under the ticket: « Préviens-moi », the other bookings of the contact, how the salon reaches him, WhatsApp. */
export function Contact({ token, b }: { token: string; b: Booking }) {
  const [v, setV] = useState<ContactView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string } | null>(null);
  const t = encodeURIComponent(token);
  useEffect(() => { api.get<ContactView>('/api/public/contact/' + t).then(setV).catch(() => setV(null)); }, [token, b.status, b.day, b.start]);
  if (!v) return null;
  const me = v.items.find((x) => x.self) || null;
  const others = v.items.filter((x) => !x.self);
  const post = async (path: string, body: any, ok: string) => {
    setBusy(true); setNote(null);
    try { setV(await api.post<ContactView>('/api/public/contact/' + t + path, body, uuid())); setNote({ tone: 'ok', text: ok }); }
    catch (e: any) { setNote({ tone: 'warn', text: e.message }); } finally { setBusy(false); }
  };
  const wa = v.shop.whatsapp ? 'https://wa.me/' + v.shop.whatsapp + '?text=' + encodeURIComponent('Bonjour, c’est pour mon rendez-vous ' + b.code + ' du ' + dates.dayLong(b.day) + ' à ' + time(b.start) + '.') : '';
  return (
    <>
      {note ? <p className={'c-note ' + note.tone} role="status">{note.text}</p> : null}
      {me && me.status === 'booked' && me.canChange ? (
        <button type="button" className="c-card c-switch" aria-pressed={me.earlier} disabled={busy} data-guide="r.earlier"
          onClick={() => post('/earlier', { code: me.code, on: !me.earlier }, me.earlier ? 'C’est retiré : ton rendez-vous reste comme il est.' : 'C’est noté. Si un créneau plus tôt se libère' + (me.staff ? ' avec ' + me.staff.name : '') + ', on te prévient.')}>
          <span><b>Préviens-moi si un créneau se libère plus tôt</b><small>{me.earlier ? 'Activé. Un message part dès qu’une place plus tôt se libère avec le même barbier.' : 'Avec le même barbier. Rien ne bouge sans ton accord.'}</small></span>
          <i aria-hidden>{me.earlier ? '✓' : '+'}</i>
        </button>
      ) : null}

      {others.length ? (
        <section className="c-card c-others" aria-labelledby="c-others-t" data-guide="r.others">
          <h2 className="c-k" id="c-others-t">Tes autres rendez-vous</h2>
          <ul>
            {others.map((x) => (
              <li key={x.code}>
                <a href={'/r/' + x.token}>
                  <span>
                    <b>{whenOf(x.day, x.start)}</b>
                    <small>{[x.forFirst ? 'Pour ' + x.forFirst : '', x.services.map((s) => s.name).join(' + '), x.staff ? 'avec ' + x.staff.name : '', priceOf(x)].filter(Boolean).join(' · ')}</small>
                    {x.status === 'pending' && x.deposit ? <small className="warn">Acompte de {eur(x.deposit.amount)} à régler</small> : !x.canChange ? <small>Moins de {v.cancelUntilHours} h avant : pour changer, appelle le salon.</small> : null}
                  </span>
                  <i aria-hidden>→</i>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {v.notify && v.notify.options.length > 1 ? (
        <section className="c-card c-via" aria-labelledby="c-via-t" data-guide="r.via">
          <h2 className="c-k" id="c-via-t">Comment le salon te prévient</h2>
          <p className="c-muted c-small">Pour les rappels et quand un créneau se libère plus tôt. Les bons plans restent à part.</p>
          <div className="c-chips" role="group" aria-labelledby="c-via-t">
            {(['whatsapp', 'sms', 'email'] as Via[]).filter((x) => v.notify!.options.includes(x)).map((x) => (
              <button key={x} type="button" className="c-chip" aria-pressed={v.notify!.via === x} disabled={busy} onClick={() => { if (v.notify!.via !== x) post('/notify', { via: x }, 'C’est noté : le salon te prévient par ' + VIA_WORDS[x] + '.'); }}>{VIA_WORDS[x]}</button>
            ))}
          </div>
        </section>
      ) : null}

      {wa ? <a className="c-btn ghost c-wa" href={wa} target="_blank" rel="noopener">Écrire au salon sur WhatsApp</a> : null}
    </>
  );
}
