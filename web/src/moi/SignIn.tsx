// Signing in to /moi: a number, then the code received by SMS, on one card (AC-01's /api/public/account/*). The server's
// answer is the same for every number, so the page never says more than it does. From a booking (« Créer mon espace »,
// /moi?garder=<token>) the code is already on its way and the page says to which number. The demo signs in as its
// client without a code (texts are simulated there).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { KeepAnswer, StartAnswer, VerifyAnswer } from './types';

type Step = 'phone' | 'code' | 'first';

// as server/lib/util.js normPhone reads a number: 06…, +33 6…, 0033 6…, or another country's +…
function digits(v: string) { let d = String(v || '').replace(/[^\d+]/g, ''); if (d.startsWith('00')) d = '+' + d.slice(2); if (d.startsWith('+33')) d = '0' + d.slice(3); return d; }
const validPhone = (v: string) => { const d = digits(v); return /^0[1-9]\d{8}$/.test(d) || /^\+\d{8,15}$/.test(d); };
const RESEND_S = 30;
/** The number the site remembers on this phone (lx-me, see /confidentialite), to spare typing it again. */
function rememberedPhone() { try { const m = JSON.parse(localStorage.getItem('lx-me') || 'null'); return m && typeof m.phone === 'string' ? m.phone : ''; } catch { return ''; } }

export function SignIn({ demo, enabled, garder, onIn }: { demo: boolean; enabled: boolean; garder: string | null; onIn: () => void }) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(rememberedPhone);
  const [token, setToken] = useState<string | null>(null);
  // what the code is checked against, read when it is checked (a code filled by the demo arrives before a re-render)
  const via = useRef<{ token: string } | { phone: string }>({ phone: '' });
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [lead, setLead] = useState('');
  const [err, setErr] = useState('');
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const kept = useRef(false);

  // the code was sent: « Renvoyer » after 30 s
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // the code step; the demo's code goes straight to verify (which holds busy from here on)
  const toCode = (text: string, demoCode?: string) => {
    setBusy(false); setLead(text); setStep('code'); setWait(RESEND_S); setErr('');
    if (demoCode) { setCode(demoCode); verify(demoCode); } else setTimeout(() => codeRef.current?.focus(), 0);
  };

  // « Créer mon espace » from a booking: the code leaves at once, to the number of that booking
  useEffect(() => {
    if (!enabled || !garder || kept.current) return;
    kept.current = true;
    // a reload must not text another code: the link leaves the address bar once used
    const q = new URLSearchParams(location.search);
    q.delete('garder');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
    setBusy(true);
    api.post<KeepAnswer>('/api/public/account/keep', { token: garder })
      .then((r) => { setToken(garder); via.current = { token: garder }; toCode('On t’a envoyé un code au ' + r.sentTo + '.', r.demoCode); })
      .catch((e: ApiError) => { setErr(e.message); setBusy(false); });
  }, [enabled, garder]);

  // WebOTP: the phone offers the code from the SMS (its last line names this site)
  useEffect(() => {
    if (step !== 'code' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as any).get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((c: { code?: string } | null) => { if (c && c.code && /^\d{6}$/.test(c.code)) { setCode(c.code); verify(c.code); } })
      .catch(() => { /* typed by hand */ });
    return () => ac.abort();
  }, [step]);

  const start = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!validPhone(phone)) { setErr(phone.trim() ? 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.' : 'Donne ton numéro de téléphone.'); return; }
    setBusy(true); setErr('');
    try { const r = await api.post<StartAnswer>('/api/public/account/start', { phone }); setToken(null); via.current = { phone }; toCode(r.message, r.demoCode); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const resend = async () => {
    if (wait > 0 || busy) return;
    setBusy(true); setErr('');
    try {
      if (token) { const r = await api.post<KeepAnswer>('/api/public/account/keep', { token }); toCode('On t’a renvoyé un code au ' + r.sentTo + '.', r.demoCode); }
      else { const r = await api.post<StartAnswer>('/api/public/account/start', { phone }); toCode(r.message, r.demoCode); }
    } catch (x: any) { setErr(x.message); setBusy(false); }
  };
  async function verify(c: string, name?: string) {
    if (!/^\d{6}$/.test(c)) { setErr('Le code a 6 chiffres.'); return; }
    setBusy(true); setErr(''); setLive('Code envoyé, vérification…');
    try {
      const body = { ...via.current, code: c, ...(name != null ? { first: name } : {}) };
      const r = await api.post<VerifyAnswer>('/api/public/account/verify', body);
      if (r.ok) { setLive('C’est bon, ton espace s’ouvre.'); onIn(); return; }
      // the right code at a first opening: one more question; a wrong name says so on the same field
      setLive('');
      if (name == null) setStep('first'); else setErr(r.message);
    } catch (x: any) {
      setLive(''); setErr(x.message);
      if (name == null) { setCode(''); codeRef.current?.focus(); }
    } finally { setBusy(false); }
  }
  const onCode = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 6);
    setCode(d);
    if (err) setErr('');
    // the sixth digit sends it: said out loud, so it is never a surprise
    if (d.length === 6 && !busy) verify(d);
  };
  const demoIn = async () => {
    setBusy(true); setErr('');
    try { await api.post('/api/public/account/demo', {}); onIn(); }
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  const back = () => { setStep('phone'); setCode(''); setToken(null); setErr(''); setLive(''); };

  if (!enabled) {
    return (
      <section className="c-card c-center" data-guide="moi.signin">
        <p className="c-k">Ton espace</p>
        <h1 className="c-h">L’espace client n’est pas encore ouvert.</h1>
        <p className="c-muted">Pour retrouver un rendez-vous, on t’envoie son lien par SMS.</p>
        <a className="c-btn" href="/mon-rendez-vous">Retrouver mon rendez-vous</a>
        <a className="c-link" href="/?reserver">Réserver</a>
      </section>
    );
  }

  return (
    <>
      <section className="c-card m-in" aria-labelledby="m-in-t" data-guide="moi.signin">
        <p className="c-k">Mon espace</p>
        <h1 className="c-h" id="m-in-t">{step === 'first' ? 'Une dernière question' : token ? 'Crée ton espace' : 'Ton espace'}</h1>
        {step === 'phone' ? (
          <form className="m-form" onSubmit={start} noValidate data-guide="moi.signin.phone">
            <p className="c-muted">Tes rendez-vous, tes reçus, ta prochaine coupe. Sans mot de passe.</p>
            <label htmlFor="m-phone">Ton numéro</label>
            <input id="m-phone" className="m-inp" type="tel" inputMode="tel" autoComplete="tel" placeholder="06 12 34 56 78" maxLength={24} value={phone} aria-invalid={!!err} aria-describedby="m-in-err" onChange={(e) => { setPhone(e.target.value); if (err) setErr(''); }} />
            <button type="submit" className="c-btn" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir mon code'}</button>
          </form>
        ) : step === 'code' ? (
          <form className="m-form" onSubmit={(e) => { e.preventDefault(); verify(code); }} noValidate data-guide="moi.signin.code">
            <p className="c-muted">{lead || 'Si ce numéro est connu du salon, tu reçois un code par SMS.'}</p>
            <label htmlFor="m-code">Le code reçu par SMS</label>
            <input id="m-code" ref={codeRef} className="m-inp m-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="• • • • • •" value={code} aria-invalid={!!err} aria-describedby="m-in-err m-in-live" onChange={(e) => onCode(e.target.value)} />
            <button type="submit" className="c-btn" disabled={busy || code.length !== 6}>{busy ? 'Vérification…' : 'Entrer'}</button>
            <div className="m-links">
              <button type="button" className="c-link" disabled={wait > 0 || busy} onClick={resend}>{wait > 0 ? 'Pas reçu ? Renvoyer dans ' + wait + ' s' : 'Pas reçu ? Renvoyer'}</button>
              <button type="button" className="c-link" onClick={back}>Changer de numéro</button>
            </div>
          </form>
        ) : (
          <form className="m-form" onSubmit={(e) => { e.preventDefault(); if (first.trim()) verify(code, first.trim()); }} noValidate>
            <p className="c-muted">Pour être sûr que ce numéro est toujours le tien.</p>
            <label htmlFor="m-first">Ton prénom ?</label>
            <input id="m-first" className="m-inp" type="text" autoComplete="given-name" maxLength={40} value={first} aria-describedby="m-in-err" onChange={(e) => setFirst(e.target.value)} autoFocus />
            <button type="submit" className="c-btn" disabled={busy || !first.trim()}>{busy ? 'Vérification…' : 'Entrer'}</button>
          </form>
        )}
        <p id="m-in-err" className="m-err" role="alert">{err}</p>
        <p id="m-in-live" className="m-live" role="status">{live}</p>
        <a className="c-link m-lost" href="/mon-rendez-vous">Juste retrouver un rendez-vous ? Lien par SMS</a>
      </section>

      {demo ? (
        <section className="c-card m-demo" aria-labelledby="m-demo-t" data-guide="moi.signin.demo">
          <p className="c-k" id="m-demo-t">Démo</p>
          <p className="c-muted">Démo : aucun SMS ne part. Entre dans l’espace d’un client du salon de démonstration.</p>
          <button type="button" className="c-btn ghost" disabled={busy} onClick={demoIn}>Essayer avec un client de démo</button>
        </section>
      ) : null}

      <section className="c-card c-center m-first" data-guide="moi.signin.book">
        <p className="c-muted">Pas encore venu ? Ton espace s’ouvre avec ta première réservation.</p>
        <a className="c-btn" href="/?reserver">Réserver</a>
      </section>
    </>
  );
}
