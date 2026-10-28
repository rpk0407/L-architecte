// The client's pages, reached from an SMS or the site: my appointment, paying a deposit, my receipt, a gift card.
// No account, no password: each link carries a signature the server checks.
import { StrictMode, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, qs } from '../lib/api';
import { cap, dates, eur, time } from '../lib/format';
import './client.css';
import './cadeau.css';
import Member from './abonnement/Member';

type Booking = {
  code: string; status: 'pending' | 'booked' | 'arrived' | 'in_chair' | 'done' | 'no_show' | 'cancelled'; day: string; start: number; dur: number;
  services: { id: string; name: string; price: number; from: boolean }[]; price: number;
  staff: { id: string; name: string; initials: string; color: string } | null; anyStaff: boolean; first: string;
  deposit: { amount: number; paid: number; url: string | null } | null; canChange: boolean; cancelUntilHours: number;
  shop: { name: string; address: string; phone: string; mapsUrl: string }; cancelled: { by: string; at: number } | null;
};

function App() {
  const parts = location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(location.search);
  if (parts[0] === 'r' && parts[1]) return <Manage token={parts[1]} back={q.get('paiement')} />;
  if (parts[0] === 'paiement' && parts[1] === 'merci') return <Thanks ok={q.get('paiement') !== 'annule'} member={q.get('abonnement')} />;
  if (parts[0] === 'paiement' && parts[1]) return <Checkout id={parts[1]} />;
  if (parts[0] === 'recu' && parts[1]) return <Receipt token={parts[1]} />;
  if (parts[0] === 'cadeau' && parts[1]) return <Gift token={parts[1]} back={q.get('paiement')} />;
  if (parts[0] === 'abo' && parts[1]) return <Shell><Member token={parts[1]} /></Shell>;
  return <Shell><Lost /></Shell>;
}

function Shell({ children, shop }: { children: ReactNode; shop?: string }) {
  return (
    <div className="c-page">
      <header className="c-top"><a href="/" className="c-brand"><b>L’Architecte</b><small>{shop && shop !== 'Barber L’Architecte' ? shop : 'Barber · Marseille'}</small></a></header>
      <main className="c-main">{children}</main>
      <footer className="c-foot"><a href="/">barberlarchitecte.com</a></footer>
    </div>
  );
}
function Lost({ msg }: { msg?: string }) {
  return (
    <section className="c-card c-center">
      <p className="c-k">Lien introuvable</p>
      <h1 className="c-h">{msg || 'Ce lien n’est pas (ou plus) valable.'}</h1>
      <p className="c-muted">Vérifie le lien reçu par SMS, ou réserve directement sur le site.</p>
      <a className="c-btn" href="/?reserver">Réserver un créneau</a>
    </section>
  );
}
function Spinner() { return <div className="c-card c-center" aria-busy="true"><span className="c-spin" /><p className="c-muted">Un instant…</p></div>; }

/* ---------------- my appointment ---------------- */

function Manage({ token, back }: { token: string; back: string | null }) {
  const [b, setB] = useState<Booking | null>(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState<'' | 'move' | 'cancel'>('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: string; text: string } | null>(back === 'ok' ? { tone: 'ok', text: 'Paiement reçu. On confirme ton rendez-vous…' } : back === 'annule' ? { tone: 'warn', text: 'Paiement annulé. Ton créneau reste gardé quelques minutes : tu peux réessayer.' } : null);
  const load = () => api.get<Booking>('/api/public/bookings/' + encodeURIComponent(token)).then(setB).catch((e) => setErr(e.message));
  useEffect(() => { load(); if (back) history.replaceState(null, '', location.pathname); }, []);
  // after paying, the bank's confirmation can take a few seconds to reach the salon
  useEffect(() => {
    if (back !== 'ok' || !b || b.status !== 'pending') { if (back === 'ok' && b && b.status === 'booked') setNote({ tone: 'ok', text: 'Acompte reçu, ton rendez-vous est confirmé.' }); return; }
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [b]);
  if (err) return <Shell><Lost msg={err} /></Shell>;
  if (!b) return <Shell><Spinner /></Shell>;

  const start = dates.instantOf(b.day, b.start);
  const upcoming = ['pending', 'booked', 'arrived'].includes(b.status) && start + b.dur * 60000 > Date.now();
  const what = b.services.map((s) => s.name).join(' + ');
  const price = b.services.some((s) => s.from) ? 'dès ' + eur(b.price) : eur(b.price);
  const ics = () => {
    const d = b.day.replace(/-/g, ''), t1 = dates.hhmm(b.start).replace(':', '') + '00', t2 = dates.hhmm(b.start + b.dur).replace(':', '') + '00';
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber LArchitecte//RDV//FR', 'BEGIN:VEVENT', 'UID:' + b.code + '@larchitecte', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'),
      'DTSTART;TZID=Europe/Paris:' + d + 'T' + t1, 'DTEND;TZID=Europe/Paris:' + d + 'T' + t2, 'SUMMARY:' + b.shop.name + ' · ' + what, 'LOCATION:' + b.shop.address.replace(/,/g, '\\,'),
      'DESCRIPTION:' + (b.staff ? 'Avec ' + b.staff.name + '. ' : '') + 'Code ' + b.code + '. ' + location.href, 'URL:' + location.href, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  };
  const pay = async () => {
    setBusy(true);
    try { const r = await api.post<{ url: string }>('/api/public/bookings/' + encodeURIComponent(token) + '/pay', {}); location.href = r.url; }
    catch (e: any) { setNote({ tone: 'warn', text: e.message }); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      const paid = b.deposit?.paid || 0;
      const r = await api.post<Booking>('/api/public/bookings/' + encodeURIComponent(token) + '/cancel', {});
      setB(r); setMode('');
      setNote({ tone: 'ok', text: 'C’est annulé. Le créneau est libéré tout de suite' + (paid ? ' et ton acompte de ' + eur(paid) + ' est remboursé sur ta carte (quelques jours selon ta banque).' : '.') });
    } catch (e: any) { setNote({ tone: 'warn', text: e.message }); } finally { setBusy(false); }
  };
  const status = {
    pending: ['Acompte à régler', 'warn'], booked: ['Confirmé', 'ok'], arrived: ['Tu es arrivé', 'ok'], in_chair: ['C’est parti', 'ok'],
    done: ['Merci pour ta visite', ''], no_show: ['Rendez-vous manqué', 'warn'], cancelled: ['Annulé', 'warn']
  }[b.status] as [string, string];

  return (
    <Shell shop={b.shop.name}>
      {note ? <p className={'c-note ' + note.tone} role="status">{note.text}</p> : null}
      <section className="c-card c-ticket">
        <div className="c-row"><span className={'c-pill ' + status[1]}>{status[0]}</span><span className="c-code">Code <b>{b.code}</b></span></div>
        <p className="c-k">{b.first ? 'Ton rendez-vous, ' + b.first : 'Ton rendez-vous'}</p>
        <h1 className={'c-when' + (b.status === 'cancelled' ? ' gone' : '')}>{cap(dates.dayLong(b.day))}<br />à {time(b.start)}</h1>
        <div className="c-what">
          <span>{what}<small>{dates.fmtDur(b.dur)} · {price}</small></span>
          {b.staff ? <span className="c-staff"><i style={{ background: b.staff.color }}>{b.staff.initials}</i>avec {b.staff.name}</span> : null}
        </div>
        {b.deposit ? <p className="c-dep">{b.deposit.paid ? 'Acompte de ' + eur(b.deposit.paid, { decimals: b.deposit.paid % 100 !== 0 }) + ' payé, déduit au salon.' : 'Acompte de ' + eur(b.deposit.amount, { decimals: b.deposit.amount % 100 !== 0 }) + ' à régler pour confirmer.'}</p> : null}
        <p className="c-addr">{b.shop.address}</p>
      </section>

      {b.status === 'pending' && upcoming ? (
        <section className="c-card">
          <p className="c-muted">Ton créneau est gardé quelques minutes. Il sera confirmé dès le paiement de l’acompte, déduit du prix au salon.</p>
          <button type="button" className="c-btn" disabled={busy} onClick={pay}>Régler l’acompte · {eur(b.deposit?.amount || 0)}</button>
        </section>
      ) : null}

      {upcoming && mode === '' ? (
        <section className="c-actions">
          <a className="c-btn ghost" href={ics()} download={'rdv-' + b.code + '.ics'}>Ajouter à mon agenda</a>
          <a className="c-btn ghost" href={b.shop.mapsUrl} target="_blank" rel="noopener">Itinéraire</a>
          {b.canChange ? (
            <div className="c-row c-change">
              <button type="button" className="c-link" onClick={() => setMode('move')}>Déplacer</button>
              <button type="button" className="c-link" onClick={() => setMode('cancel')}>Annuler</button>
            </div>
          ) : ['pending', 'booked'].includes(b.status) ? (
            <p className="c-muted c-small">Moins de {b.cancelUntilHours} h avant le rendez-vous : pour le déplacer ou l’annuler, appelle le salon{b.shop.phone ? ' au ' : '.'}{b.shop.phone ? <a href={'tel:' + b.shop.phone.replace(/\s/g, '')}>{b.shop.phone}</a> : null}</p>
          ) : null}
        </section>
      ) : null}

      {mode === 'cancel' ? (
        <section className="c-card">
          <h2 className="c-h2">Annuler ce rendez-vous ?</h2>
          <p className="c-muted">{b.deposit?.paid ? 'Ton acompte de ' + eur(b.deposit.paid) + ' te sera remboursé.' : 'Le créneau sera proposé à quelqu’un d’autre.'}</p>
          <div className="c-row"><button type="button" className="c-btn" disabled={busy} onClick={cancel}>Oui, annuler</button><button type="button" className="c-link" onClick={() => setMode('')}>Non, je garde</button></div>
        </section>
      ) : null}

      {mode === 'move' ? <Move b={b} token={token} onDone={(nb) => { setB(nb); setMode(''); setNote({ tone: 'ok', text: 'C’est déplacé. Un SMS de confirmation part tout de suite.' }); }} onCancel={() => setMode('')} /> : null}

      {!upcoming && b.status !== 'pending' ? (
        <section className="c-card c-center">
          <p className="c-muted">{b.status === 'done' ? 'Ça t’a plu ? Le prochain se réserve en 30 secondes.' : 'Envie d’un autre créneau ?'}</p>
          <a className="c-btn" href="/?reserver">Reprendre rendez-vous</a>
        </section>
      ) : null}
    </Shell>
  );
}

function Move({ b, token, onDone, onCancel }: { b: Booking; token: string; onDone: (b: Booking) => void; onCancel: () => void }) {
  const [days, setDays] = useState<{ day: string; slots: { m: number; s: string }[] }[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.get<{ days: { day: string; open: boolean; slots: { m: number; s: string }[] }[] }>('/api/public/availability' + qs({ services: b.services.map((s) => s.id).join(','), staff: b.anyStaff || !b.staff ? 'any' : b.staff.id, days: 14, move: token }))
      .then((r) => { const open = r.days.filter((d) => d.open); setDays(open); setDay((open.find((d) => d.slots.length) || open[0])?.day || null); })
      .catch((e) => setErr(e.message));
  }, []);
  const go = async (m: number) => {
    if (!day) return;
    setBusy(true); setErr('');
    try { onDone(await api.post<Booking>('/api/public/bookings/' + encodeURIComponent(token) + '/move', { day, start: m })); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const cur = days?.find((d) => d.day === day);
  return (
    <section className="c-card">
      <div className="c-row"><h2 className="c-h2">Pour quand ?</h2><button type="button" className="c-link" onClick={onCancel}>Retour</button></div>
      {err ? <p className="c-note warn">{err}</p> : null}
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

/* ---------------- paying (test page, while no real provider is connected) ---------------- */

// start: a membership not started now (PAY-03), the day its first month is charged
type Pay = { id: string; status: string; amount: number; label: string; kind: string; provider: string; exp: number; shop: string; back: string | null; start?: string | null };
/** « Ton abonnement commence le lundi 17 novembre », for a start not asked for now */
const startWords = (day: string) => 'Ton abonnement commence le ' + dates.dayLong(day) + ' : rien n’est prélevé avant.';
function Checkout({ id }: { id: string }) {
  const [p, setP] = useState<Pay | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<'' | 'ok' | 'cancel'>('');
  useEffect(() => { api.get<Pay>('/api/public/payments/' + encodeURIComponent(id)).then(setP).catch((e) => setErr(e.message)); }, []);
  // a gift card bought on /carte-cadeau comes back to its own page (only that kind of address: never an open redirect)
  const retour = new URLSearchParams(location.search).get('retour') || '';
  const gift = /^\/cadeau\/[A-Za-z0-9_.-]{8,120}$/.test(retour) ? retour : null;
  // a membership subscribed on the site comes back to its member page (PAY-04), as from Stripe's page
  const abo = /^\/abo\/[A-Za-z0-9_.~-]{8,160}$/.test(retour) ? retour : null;
  const after = (ok: boolean, res?: { status?: string; start?: string }) => {
    if (gift) { location.href = ok ? gift + '?paiement=ok' : '/carte-cadeau?paiement=annule'; return; }
    // a membership says what happened: paid now, or recorded for its start day (nothing charged)
    if (ok && p!.kind === 'membership' && abo) { location.href = abo + '?paiement=ok'; return; }
    if (ok && p!.kind === 'membership') { location.href = '/paiement/merci?abonnement=' + encodeURIComponent(res && res.status === 'scheduled' && res.start ? res.start : 'ok'); return; }
    // a subscription left at the checkout: back to the site's sheet, as Stripe's cancelUrl does (PAY-04)
    if (p!.kind === 'membership') { location.href = '/?abonnement=annule'; return; }
    location.href = p!.back ? p!.back + '?paiement=' + (ok ? 'ok' : 'annule') : '/paiement/merci' + (ok ? '' : '?paiement=annule');
  };
  const run = async (outcome: 'ok' | 'cancel') => {
    setBusy(outcome);
    try { const res = await api.post<{ status?: string; start?: string }>('/api/public/payments/' + encodeURIComponent(id) + '/simulate', { outcome }); await new Promise((r) => setTimeout(r, 700)); after(outcome === 'ok', res); }
    catch (e: any) { setErr(e.message); setBusy(''); }
  };
  if (err) return <Shell><Lost msg={err} /></Shell>;
  if (!p) return <Shell><Spinner /></Shell>;
  // a member's « Changer de carte » in the demo (PAY-03, simulated portalUrl): nothing to change
  if (p.kind === 'membership' && new URLSearchParams(location.search).has('carte')) return <Shell shop={p.shop}><section className="c-card c-center"><p className="c-k">Carte de paiement</p><h1 className="c-h">Démo : la carte est à jour.</h1><p className="c-muted">Avec Stripe, cette page est celle de Stripe : la nouvelle carte sert dès le prochain prélèvement.</p><button type="button" className="c-btn" onClick={() => { if (history.length > 1) history.back(); else location.href = '/'; }}>Revenir à mon abonnement</button></section></Shell>;
  if (p.kind === 'membership' && p.status === 'scheduled' && p.start) return <Shell shop={p.shop}><section className="c-card c-center"><p className="c-k">Abonnement enregistré</p><h1 className="c-h">{startWords(p.start)}</h1><p className="c-muted">La confirmation est partie par e-mail.</p></section></Shell>;
  if (p.status !== 'pending') return <Shell shop={p.shop}><section className="c-card c-center"><p className="c-k">Paiement</p><h1 className="c-h">{p.status === 'paid' ? 'Déjà payé. Merci !' : 'Ce paiement n’est plus en attente.'}</h1>{gift ? <a className="c-btn" href={gift}>Voir ma carte cadeau</a> : p.back ? <a className="c-btn" href={p.back}>Voir mon rendez-vous</a> : null}</section></Shell>;
  const later = p.kind === 'membership' && p.start ? p.start : null;
  return (
    <Shell shop={p.shop}>
      <section className="c-card c-pay">
        <p className="c-test">Page de paiement de test · aucune carte n’est débitée</p>
        <p className="c-k">{p.shop}</p>
        <h1 className="c-amount">{eur(p.amount, { decimals: p.amount % 100 !== 0 })}</h1>
        <p className="c-muted">{p.label}</p>
        <div className="c-cardfield" aria-hidden><span>Carte</span><b>4242 4242 4242 4242</b><small>12 / 34 · 123</small></div>
        {later ? <p className="c-muted">{startWords(later)}</p> : null}
        <button type="button" className="c-btn" disabled={!!busy} onClick={() => run('ok')}>{busy === 'ok' ? (later ? 'Enregistrement…' : 'Paiement…') : later ? 'Confirmer mon abonnement' : 'Payer ' + eur(p.amount, { decimals: p.amount % 100 !== 0 })}</button>
        <button type="button" className="c-link" disabled={!!busy} onClick={() => run('cancel')}>Annuler</button>
        <p className="c-muted c-small">Une fois Stripe branché, cette étape se fait sur la page sécurisée de Stripe (carte, Apple Pay, Google Pay).</p>
      </section>
    </Shell>
  );
}

/** member: a membership's checkout (PAY-03), 'ok' paid now, else the day it starts (nothing charged before) */
function Thanks({ ok, member }: { ok: boolean; member?: string | null }) {
  const later = ok && member && /^\d{4}-\d{2}-\d{2}$/.test(member) ? member : null;
  const title = !ok ? 'Paiement annulé.' : later ? 'Abonnement enregistré.' : member ? 'Merci, ton abonnement est actif.' : 'Merci, c’est payé.';
  const sub = !ok ? 'Rien n’a été débité. Montre l’écran au barbier pour payer autrement.' : later ? startWords(later) + ' La confirmation est partie par e-mail.' : member ? 'La confirmation part par SMS et par e-mail. Tes coupes sont incluses dès aujourd’hui.' : 'Le salon l’a reçu, tu peux ranger ton téléphone.';
  return (
    <Shell>
      <section className="c-card c-center">
        <span className={'c-check' + (ok ? '' : ' no')} aria-hidden>{ok ? '✓' : '×'}</span>
        <h1 className="c-h">{title}</h1>
        <p className="c-muted">{sub}</p>
      </section>
    </Shell>
  );
}

/* ---------------- the receipt ---------------- */

type Rec = { ref: string; day: string; at: number; first: string; shop: { name: string; legalName: string; address: string; siret: string; vatNumber: string }; lines: { name: string; qty: number; net: number }[]; totals: { total: number; tip: number; due: number; discount: number; vat: { rate: number; base: number; tax: number }[] }; discount: { amount: number; reason: string } | null; tip: { amount: number } | null; payments: { method: string; amount: number }[]; refunded: number; footer: string };
const METHOD: Record<string, string> = { card: 'Carte', cash: 'Espèces', online: 'En ligne', giftcard: 'Carte cadeau', deposit: 'Acompte' };
function Receipt({ token }: { token: string }) {
  const [r, setR] = useState<Rec | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get<Rec>('/api/public/receipts/' + encodeURIComponent(token)).then(setR).catch((e) => setErr(e.message)); }, []);
  const at = useMemo(() => (r ? dates.localParts(r.at) : null), [r]);
  if (err) return <Shell><Lost msg={err} /></Shell>;
  if (!r || !at) return <Shell><Spinner /></Shell>;
  const d = (c: number) => eur(c, { decimals: true });
  return (
    <Shell shop={r.shop.name}>
      <section className="c-card c-rec">
        <p className="c-k">{r.first ? 'Merci ' + r.first + ' !' : 'Merci !'}</p>
        <h1 className="c-h">Ticket {r.ref}</h1>
        <p className="c-muted">{cap(dates.dayLong(r.day))} à {time(at.min)}</p>
        <div className="c-lines">
          {r.lines.map((l, i) => <p key={i}><span>{l.qty > 1 ? l.qty + ' × ' : ''}{l.name}</span><b>{d(l.net)}</b></p>)}
          {r.totals.discount ? <p className="sub"><span>dont remise{r.discount?.reason ? ' · ' + r.discount.reason : ''}</span><span>−{d(r.totals.discount)}</span></p> : null}
          <p className="tot"><span>Total TTC</span><b>{d(r.totals.total)}</b></p>
          {r.totals.vat.map((v) => <p key={v.rate} className="sub"><span>TVA {v.rate / 100} % sur {d(v.base)}</span><span>{d(v.tax)}</span></p>)}
          {r.tip ? <p className="sub"><span>Pourboire</span><span>{d(r.tip.amount)}</span></p> : null}
          {r.payments.map((p, i) => <p key={'p' + i} className="sub"><span>{METHOD[p.method] || p.method}</span><span>{d(p.amount)}</span></p>)}
          {r.refunded ? <p className="sub"><span>Remboursé</span><span>−{d(r.refunded)}</span></p> : null}
        </div>
        <p className="c-legal">{r.shop.legalName || r.shop.name} · {r.shop.address}{r.shop.siret ? ' · SIRET ' + r.shop.siret : ''}{r.shop.vatNumber ? ' · TVA ' + r.shop.vatNumber : ''}</p>
        {r.footer ? <p className="c-muted">{r.footer}</p> : null}
        <div className="c-row c-noprint"><button type="button" className="c-btn ghost" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button><a className="c-link" href="/?reserver">Reprendre rendez-vous</a></div>
      </section>
    </Shell>
  );
}

/* ---------------- a gift card bought online ---------------- */

type GiftCard = {
  status: 'pending' | 'paid' | 'failed' | 'ready' | 'spent' | 'expired' | 'void' | 'replaced'; amount: number; balance?: number; code?: string | null; last4?: string; expires?: string;
  first: string; from: string; message: string; delivery: 'buyer' | 'recipient'; sendAt: number; hidden?: 'reissued' | 'secret';
  // state: as the server reads the text's status (only a text that left reads 'sent')
  sms?: { status: string; state?: 'planned' | 'leaving' | 'sent' | 'failed'; dueAt: number; to: string } | null;
  shop: { name: string; address: string; phone: string };
};
const dmy = (day: string) => day.split('-').reverse().join('/');
/** "jeudi 24 décembre à 19 h", from an instant (Paris time). */
function whenWords(ms: number) { const p = dates.localParts(ms); return dates.dayLong(p.day) + ' à ' + time(p.min); }

function Gift({ token, back }: { token: string; back: string | null }) {
  const [g, setG] = useState<GiftCard | null>(null);
  const [err, setErr] = useState('');
  const [tries, setTries] = useState(0);
  const load = () => api.get<GiftCard>('/api/public/giftcards/' + encodeURIComponent(token)).then(setG).catch((e) => setErr(e.message));
  useEffect(() => { document.title = 'Carte cadeau · Barber L’Architecte'; load(); if (back) history.replaceState(null, '', location.pathname); }, []);
  // the bank's confirmation can take a few seconds to reach the salon
  const waiting = !!g && (g.status === 'pending' || g.status === 'paid');
  useEffect(() => {
    if (!waiting || tries >= 45) return;
    const t = setTimeout(() => { setTries((n) => n + 1); load(); }, 2000);
    return () => clearTimeout(t);
  }, [g]);
  if (err) return <Shell><Lost msg={err} /></Shell>;
  if (!g) return <Shell><Spinner /></Shell>;
  const amount = (c: number) => eur(c, { decimals: c % 100 !== 0 });

  if (waiting) {
    return (
      <Shell shop={g.shop.name}>
        <section className="c-card c-center" aria-busy={tries < 45}>
          {tries < 45 ? <span className="c-spin" /> : null}
          <p className="c-k">Carte cadeau · {amount(g.amount)}</p>
          <h1 className="c-h">{tries < 45 ? (back === 'ok' || g.status === 'paid' ? 'Paiement reçu, on prépare ta carte…' : 'On attend la confirmation du paiement…') : 'La confirmation tarde.'}</h1>
          <p className="c-muted">{tries < 45 ? 'Quelques secondes, ne ferme pas cette page.' : 'Garde ce lien et reviens dans quelques minutes, ou appelle le salon' + (g.shop.phone ? ' au ' + g.shop.phone : '') + '.'}</p>
        </section>
      </Shell>
    );
  }
  if (g.status === 'failed') {
    return (
      <Shell shop={g.shop.name}>
        <section className="c-card c-center">
          <span className="c-check no" aria-hidden>×</span>
          <h1 className="c-h">Le paiement n’est pas passé.</h1>
          <p className="c-muted">Rien n’a été débité. Tu peux recommencer, ou l’acheter directement au salon.</p>
          <a className="c-btn" href="/carte-cadeau">Offrir une carte cadeau</a>
        </section>
      </Shell>
    );
  }
  const ready = g.status === 'ready' && !!g.code;
  // still valid, but its code is not one this page can show
  const valid = g.status === 'ready' && !g.code;
  const why = valid ? (g.hidden === 'reissued' ? 'Ta carte a reçu un nouveau code : il t’a été donné par le salon' + (g.sms && g.sms.state === 'planned' ? ' et part par SMS le ' + whenWords(g.sms.dueAt) : '') + '. Sinon, demande-le au salon.' : 'Carte valable : demande ton code au salon.') : ({ spent: 'Carte utilisée en entier. Merci !', expired: 'Cette carte a expiré le ' + dmy(g.expires || '') + '.', void: 'Cette carte a été annulée.', replaced: 'Cette carte a été remplacée par une nouvelle : son code ne marche plus. Le salon t’a donné le nouveau.' } as Record<string, string>)[g.status] || '';
  const left = g.balance != null && g.balance < g.amount ? g.balance : null;
  const sms = g.sms && g.delivery === 'recipient' ? g.sms : null;
  const st = sms ? sms.state || (sms.status === 'sent' || sms.status === 'simulated' ? 'sent' : sms.status === 'queued' ? 'leaving' : 'failed') : '';
  const later = st === 'planned' && !!sms && sms.dueAt > Date.now() + 60000;
  return (
    <Shell shop={g.shop.name}>
      {back === 'ok' ? <p className="c-note ok" role="status">Paiement reçu, ta carte est prête.</p> : null}
      {why ? <p className={'c-note' + (valid ? '' : ' warn')} role="status">{why}</p> : null}
      <section className={'c-card g-card' + (ready || valid ? '' : ' g-off')} aria-label="Carte cadeau">
        <div className="g-top"><span className="g-brand">L’Architecte</span><span className="g-kind">Carte cadeau</span></div>
        <p className="g-for">{g.first ? 'Pour ' + g.first : 'Offerte avec plaisir'}</p>
        <p className="g-amount">{amount(g.amount)}{left != null && ready ? <small>reste {amount(left)}</small> : null}</p>
        {g.message ? <p className="g-msg">« {g.message} »</p> : null}
        {g.from ? <p className="g-from">De la part de {g.from}</p> : null}
        {ready ? <div className="g-code"><small>Code à donner au salon</small><b>{g.code}</b></div> : g.last4 ? <div className="g-code"><small>Carte</small><b>•••• {g.last4}</b></div> : null}
        {g.expires ? <p className="g-exp">Valable jusqu’au {dmy(g.expires)}, en une ou plusieurs fois.</p> : null}
        <p className="g-shop">{g.shop.name} · {g.shop.address}{g.shop.phone ? ' · ' + g.shop.phone : ''}</p>
      </section>
      {ready && sms ? <p className={'c-muted g-sms' + (st === 'sent' ? '' : st === 'failed' ? ' no' : ' wait')}>{later ? 'Le code part par SMS au ' + sms.to + ' le ' + whenWords(sms.dueAt) + '.' : st === 'failed' ? 'Le SMS au ' + sms.to + ' n’a pas pu partir : transmets-lui ce lien ou imprime la carte.' : st === 'sent' ? 'Envoyée par SMS au ' + sms.to + '.' : 'Le SMS au ' + sms.to + ' part dans quelques minutes.'}</p> : null}
      {ready ? (
        <section className="c-actions c-noprint">
          <button type="button" className="c-btn ghost" onClick={() => window.print()}>Imprimer la carte</button>
          <a className="c-btn" href="/?reserver">Réserver</a>
          <p className="c-muted c-small">À présenter au salon au moment de payer{g.delivery === 'buyer' ? ' : imprime-la, ou envoie ce lien à qui tu l’offres' : ''}.</p>
        </section>
      ) : (
        <section className="c-card c-center c-noprint"><a className="c-btn" href="/?reserver">Réserver un créneau</a></section>
      )}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
