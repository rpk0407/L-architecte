// Signing in to /moi, signed out: a number, the code received by SMS, and (once, for a file that has never been opened) a
// first name, in the site's page frame (AC-01's /api/public/account/*). The server's answer is the same for every number,
// so the page never says more than it does: it builds its own words from what the person typed. From a booking
// (« Ouvrir mon espace », /moi?garder=<token>) the code is already on its way and the page says to which number. The demo
// signs in as its client without a code (texts are simulated there).
// One real <input> takes the code (CodeField) and it is the same tap that sends the code which gives it the focus, because
// a phone opens its keyboard only for a focus that comes from a tap. Each step is one history entry: the browser's Back
// goes to the step before, not out of /moi.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api, ApiError } from '../lib/api';
import { Icon } from '../ui/Icon';
import { CodeField, type CodeState } from './CodeField';
import { clock, rememberedPhone, showPhone, telHref, typedPhone, validPhone } from './phone';
import { perksLine } from './perks';
import { useSalon } from './salon';
import { SitePage } from './SitePage';
import type { KeepAnswer, StartAnswer, VerifyAnswer } from './types';

type Step = 'phone' | 'code' | 'first' | 'locked';
type Problem = { kind: 'phone' | 'short' | 'bad' | 'name' | 'net' | 'other'; text: string; retry?: () => void };

const RESEND_S = 30;
const NET = 'Pas de connexion. Vérifie ton réseau, puis réessaie.';
const NB = ' ';
/** the pairs of a number stay together at the end of a line */
const together = (t: string) => t.replace(/([\d•]) (?=[\d•])/g, '$1' + NB);
const KEEP_FAIL = 'Ça n’a pas marché. Réessaie dans un instant.';

/** How many steps this page has pushed on top of its own entry (the history state says it). */
const depth = (): number => (history.state && typeof history.state.moi === 'number' ? history.state.moi : 0);
/** This entry shows the number: no step of this page is behind it, so the next step pushes its own entry. */
const flat = () => history.replaceState({ moi: 0 }, '');

export function SignIn({ demo, enabled, loyalty, garder, onIn }: { demo: boolean; enabled: boolean; loyalty: boolean; garder: string | null; onIn: (first: string) => void }) {
  const salon = useSalon();
  const keeping = enabled && !!garder;
  const [step, setStep] = useState<Step>(keeping ? 'code' : 'phone');
  /** the code is leaving (the first time): the code step shows it while the answer is awaited */
  const [sending, setSending] = useState(keeping);
  /** opened from a booking: the number is that booking's, there is no number step behind */
  const [link, setLink] = useState(keeping);
  const [resending, setResending] = useState(false);
  const remembered = useRef(showPhone(rememberedPhone()));
  const [phone, setPhone] = useState(remembered.current);
  const [token, setToken] = useState<string | null>(null);
  const [to, setTo] = useState('');
  // what the code is checked against, read when it is checked (a code filled by the demo arrives before a re-render)
  const via = useRef<{ token: string } | { phone: string }>({ phone: '' });
  const [code, setCode] = useState('');
  const [first, setFirst] = useState('');
  const [prob, setProb] = useState<Problem | null>(null);
  const [live, setLive] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [okay, setOkay] = useState(false);
  const [wait, setWait] = useState(0);
  const [focused, setFocused] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const kept = useRef(false);
  const sent = useRef(false);
  const verifying = useRef(false);
  /** the request the page is waiting for: an answer to an earlier one (the person went back) is dropped */
  const run = useRef(0);
  const timers = useRef<{ demo?: ReturnType<typeof setTimeout>; note?: ReturnType<typeof setTimeout> }>({});
  /** said by the step the browser's Back returns to */
  const afterPop = useRef<Problem | null>(null);
  /** « Changer de numéro » is walking the history back to the number: the entry it lands on is the number, whatever it says */
  const home = useRef(false);
  const mounted = useRef(false);

  // the code was sent: « Renvoyer le code » after 30 s
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  useEffect(() => () => { clearTimeout(timers.current.demo); clearTimeout(timers.current.note); }, []);

  // each step takes the focus: the code field (the keyboard), the name field, else the title (what a screen reader reads first)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; if (step === 'code') codeRef.current?.focus(); return; }
    if (step === 'code') codeRef.current?.focus();
    else if (step === 'first') firstRef.current?.focus();
    else head.current?.focus();
  }, [step]);

  const reset = () => {
    run.current++;
    clearTimeout(timers.current.demo);
    sent.current = false; verifying.current = false;
    setStep('phone'); setSending(false); setResending(false); setBusy(false); setOkay(false);
    setCode(''); setFirst(''); setToken(null); setProb(null); setLive(''); setNote(''); setWait(0);
    via.current = { phone: '' };
    flat();
  };
  /** « Changer de numéro » and the arrow of the code step: back to the number */
  const changeNumber = () => {
    // opened from a booking, the page's own entry is the code step: it becomes the number, only what was pushed above it goes
    const above = depth() - (link ? 1 : 0);
    if (link) setLink(false);
    if (above > 0) { home.current = true; history.go(-above); } else reset();
  };
  const backOne = () => { if (depth() > 0) history.back(); else changeNumber(); };

  // the browser's Back and Forward walk the steps
  useEffect(() => {
    const pop = () => {
      const n = depth();
      run.current++;
      clearTimeout(timers.current.demo);
      verifying.current = false;
      setBusy(false); setSending(false); setResending(false);
      if (home.current) { home.current = false; reset(); }
      else if (n >= 2 && sent.current) { setStep('first'); setProb(null); }
      else if (n === 1 && sent.current) { setStep('code'); setFirst(''); setProb(afterPop.current); afterPop.current = null; }
      else reset();
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  /** the code is on its way (or was just sent again): the page now says to what */
  const sentOk = (text: string, demoCode?: string, again?: boolean) => {
    sent.current = true;
    setSending(false); setResending(false); setBusy(false);
    setTo(text); setWait(RESEND_S); setProb(null);
    if (depth() < 1) history.pushState({ moi: 1 }, '');
    if (demoCode) {
      // the demo's texts are simulated: the code shows for a moment, « Code reçu », then goes in
      setCode(demoCode); setNote('Code reçu'); setLive('Code reçu, vérification.');
      const id = run.current;
      timers.current.demo = setTimeout(() => { if (id === run.current) verify(demoCode); }, 1100);
    } else if (again) {
      clearTimeout(timers.current.note);
      setNote('Nouveau code envoyé'); setLive('Nouveau code envoyé.');
      timers.current.note = setTimeout(() => setNote(''), 4000);
    } else setLive('Code envoyé. Entre les 6 chiffres reçus par SMS.');
    codeRef.current?.focus();
  };

  /** every way a request can end badly, the same words wherever it happens */
  const failed = (x: unknown, retry: () => void): Problem | 'locked' => {
    const a = x as ApiError;
    if (a && a.status === 429) return 'locked';
    if (a && a.status === 0) return { kind: 'net', text: NET, retry };
    return { kind: 'other', text: (a && a.message) || KEEP_FAIL };
  };
  const lock = () => { run.current++; clearTimeout(timers.current.demo); setSending(false); setResending(false); setBusy(false); verifying.current = false; setProb(null); setLive(''); setNote(''); setStep('locked'); };

  // « Ouvrir mon espace » from a booking: the code leaves at once, to the number of that booking
  const keep = (tok: string) => {
    const id = ++run.current;
    setSending(true); setProb(null); setStep('code');
    api.post<KeepAnswer>('/api/public/account/keep', { token: tok })
      .then((r) => { if (id !== run.current) return; setToken(tok); via.current = { token: tok }; sentOk('Code envoyé au ' + r.sentTo + ', en quelques secondes.', r.demoCode); })
      .catch((x) => {
        if (id !== run.current) return;
        const p = failed(x, () => keep(tok));
        if (p === 'locked') { lock(); return; }
        // the link opens nothing (old, wrong, used up): the number form is the way in, with the reason above it; its entry
        // (marked as a step above) is the number now, so the code that follows pushes its own and the arrow comes back to it
        flat();
        setSending(false); setLink(false); setStep('phone'); setProb(p); setLive('');
      });
  };
  useEffect(() => {
    // the page opens on the number (or on a booking's code): an entry marked by an earlier visit (reload, Back from another
    // page) is not a step of this one
    if (!(enabled && garder) && depth() > 0) flat();
    if (!enabled || !garder || kept.current) return;
    kept.current = true;
    // a reload must not text another code: the link leaves the address bar once used
    const q = new URLSearchParams(location.search);
    q.delete('garder');
    history.replaceState({ moi: 1 }, '', location.pathname + (q.toString() ? '?' + q.toString() : ''));
    keep(garder);
  }, [enabled, garder]);

  // WebOTP: the phone offers the code from the SMS (its last line names this site)
  useEffect(() => {
    if (step !== 'code' || sending || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    (navigator.credentials as any).get({ otp: { transport: ['sms'] }, signal: ac.signal })
      .then((c: { code?: string } | null) => { if (c && c.code && /^\d{6}$/.test(c.code)) { setCode(c.code); verify(c.code); } })
      .catch(() => { /* typed by hand */ });
    return () => ac.abort();
  }, [step, sending]);

  const start = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || sending) return;
    if (!validPhone(phone)) {
      setProb({ kind: 'phone', text: phone.trim() ? 'Vérifie ton numéro : 10 chiffres, comme 06 12 34 56 78.' : 'Donne ton numéro de mobile pour recevoir ton code.' });
      phoneRef.current?.focus();
      return;
    }
    const id = ++run.current;
    via.current = { phone };
    const shown = showPhone(phone);
    // the code step opens in the tap itself and its field takes the focus there: that is what opens a phone's keyboard
    flushSync(() => { setToken(null); setProb(null); setCode(''); setOkay(false); setNote(''); setTo(shown); setSending(true); setStep('code'); setLive('Étape 2 sur 2. On t’envoie ton code.'); });
    codeRef.current?.focus();
    api.post<StartAnswer>('/api/public/account/start', { phone })
      .then((r) => { if (id === run.current) sentOk(shown, r.demoCode); })
      .catch((x) => {
        if (id !== run.current) return;
        const p = failed(x, () => start());
        if (p === 'locked') { lock(); return; }
        // back to the number, with what went wrong said under it
        setSending(false); setStep('phone'); setProb(p); setLive('');
      });
  };
  const resend = () => {
    if (wait > 0 || resending || sending || busy) return;
    const id = ++run.current;
    setResending(true); setProb(null); setNote('');
    const call = token ? api.post<KeepAnswer>('/api/public/account/keep', { token }) : api.post<StartAnswer>('/api/public/account/start', { phone: (via.current as { phone: string }).phone });
    call.then((r) => { if (id === run.current) sentOk(token ? 'Code envoyé au ' + (r as KeepAnswer).sentTo + ', en quelques secondes.' : to, r.demoCode, true); })
      .catch((x) => {
        if (id !== run.current) return;
        const p = failed(x, resend);
        setResending(false);
        if (p === 'locked') lock(); else setProb(p);
      });
  };

  async function verify(c: string, name?: string) {
    if (verifying.current) return;
    if (!/^\d{6}$/.test(c)) { setProb({ kind: 'short', text: 'Le code a 6 chiffres.' }); codeRef.current?.focus(); return; }
    verifying.current = true;
    const id = run.current;
    setBusy(true); setProb(null); setNote(''); setLive('Vérification du code.');
    let done = false;
    try {
      const body = { ...via.current, code: c, ...(name != null ? { first: name } : {}) };
      const r = await api.post<VerifyAnswer>('/api/public/account/verify', body);
      if (id !== run.current) return;
      if (r.ok) { done = true; setOkay(true); setLive('C’est bon, ton espace s’ouvre.'); onIn(r.first); return; }
      // the right code at a first opening: one more question; a wrong name says so on the same field
      setLive('');
      if (name == null) {
        setStep('first'); setFirst('');
        if (depth() < 2) history.pushState({ moi: 2 }, '');
        setLive('Étape 3 sur 3. Une petite vérification.');
      } else { setProb({ kind: 'name', text: r.message }); firstRef.current?.focus(); }
    } catch (x) {
      if (id !== run.current) return;
      setLive('');
      const a = x as ApiError;
      const p = failed(x, () => verify(c, name));
      if (p === 'locked') { lock(); return; }
      if (a && a.status === 400 && a.code === 'bad_code') {
        const bad: Problem = { kind: 'bad', text: 'Ce code n’est pas le bon, ou il a expiré.' };
        setCode('');
        if (name != null) { afterPop.current = bad; history.back(); } else { setProb(bad); codeRef.current?.focus(); }
      } else setProb(p);
    } finally {
      if (!done) { verifying.current = false; setBusy(false); }
    }
  }
  const onCode = (d: string) => {
    setCode(d);
    if (prob) setProb(null);
    if (note === 'Code reçu') setNote('');
    // the sixth digit sends it: said out loud, so it is never a surprise
    if (d.length === 6 && !busy && !sending) verify(d);
  };
  const demoIn = async () => {
    setBusy(true); setProb(null);
    try { const r = await api.post<{ ok: true; first: string }>('/api/public/account/demo', {}); onIn(r.first); }
    catch (x) { const p = failed(x, demoIn); if (p === 'locked') lock(); else setProb(p); setBusy(false); }
  };

  /* ---------------- the closed space ---------------- */
  if (!enabled) {
    return (
      <SitePage solo space={false}>
        <div className="ms-head" data-guide="moi.signin">
          <p className="ms-k">Mon espace</p>
          <h1 tabIndex={-1}>L’espace client n’est pas encore <em>ouvert.</em></h1>
          <p className="ms-lead">Pour retrouver un rendez-vous, on t’envoie son lien par SMS.</p>
          <div className="ms-acts"><a className="c-btn" href="/mon-rendez-vous">Retrouver mon rendez-vous</a><a className="c-btn ghost" href="/?reserver">Réserver</a></div>
        </div>
      </SitePage>
    );
  }

  /* ---------------- what each step says ---------------- */
  const tel = telHref(salon.phone);
  const n = step === 'first' ? 3 : 2;
  const total = step === 'first' ? 3 : 2;
  const title: ReactNode = step === 'phone' ? <>Ouvre ton <em>espace</em></>
    : step === 'first' ? <>Une petite <em>vérification</em></>
    : step === 'locked' ? <>Trop d’essais pour le <em>moment</em></>
    : sending ? <>On t’envoie ton <em>code</em></> : <>Entre ton <em>code</em></>;
  const lead = step === 'phone' ? 'Ton prochain rendez-vous, tes reçus et tes avantages au même endroit. C’est facultatif : tu peux toujours réserver sans.'
    : step === 'first' ? 'Une seule fois, pour être sûr que ce numéro est bien le tien : quel prénom as-tu donné au salon ?'
    : step === 'locked' ? ''
    : sending ? (link && !to ? 'Le code part au numéro de ta réservation.' : 'Au ' + together(to) + '.')
    : token ? together(to) : 'Si ce numéro est connu du salon, un code arrive par SMS au ' + together(to) + ', en quelques secondes.';
  const cells: CodeState = okay ? 'ok' : prob && prob.kind === 'bad' ? 'bad' : busy || sending ? 'busy' : 'idle';
  const errLine = <p id="m-in-err" className="m-err" role="alert">{prob ? prob.text : ''}</p>;
  const spin = <span className="c-spin ms-spin" aria-hidden="true" />;
  const perks: [string, string][] = [
    ['calendar', 'Ton prochain rendez-vous, à déplacer ou annuler en un geste'],
    ['journal', 'Tes reçus et ton historique, quand tu veux'],
    ['star', perksLine(salon, loyalty)]
  ];

  return (
    <SitePage>
      <div className={'ms-head' + (step === 'phone' ? '' : ' compact')}>
        <p className="ms-k">Mon espace</p>
        <h1 id="m-in-t" ref={head} tabIndex={-1}>{title}</h1>
        {lead ? <p className="ms-lead" id="m-lead">{lead}</p> : null}
      </div>

      <div className="ms-side">
        <section className="ms-card m-in" aria-labelledby="m-in-t" data-guide="moi.signin">
          {step !== 'locked' ? (
            <>
              <div className="ms-stp">
                {step === 'first' ? <button type="button" className="ms-back" aria-label="Retour au code" onClick={backOne}><Icon name="arrowL" size={20} /></button>
                  : step === 'code' && !link ? <button type="button" className="ms-back" aria-label="Retour au numéro" onClick={backOne}><Icon name="arrowL" size={20} /></button> : null}
                <p className="ms-stp-k">Étape {step === 'phone' ? 1 : n} sur {total} · {step === 'phone' ? 'Ton numéro' : step === 'code' ? 'Ton code' : 'Ton prénom'}</p>
              </div>
              <div className="ms-prog" style={{ gridTemplateColumns: 'repeat(' + total + ', minmax(0, 1fr))' }} aria-hidden="true">
                {Array.from({ length: total }, (_, i) => { const at = step === 'phone' ? 1 : n; return <i key={i} className={i < at - 1 || okay ? 'done' : i === at - 1 ? 'on' : ''} />; })}
              </div>
            </>
          ) : null}

          {step === 'phone' ? (
            <form className="ms-form" onSubmit={start} noValidate data-guide="moi.signin.phone">
              <label htmlFor="m-phone">Ton numéro de mobile</label>
              <input id="m-phone" ref={phoneRef} className="ms-inp" name="phone" type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="go" autoCapitalize="none" placeholder="06 12 34 56 78" maxLength={24}
                value={phone} aria-invalid={!!prob && prob.kind === 'phone'} aria-describedby="m-phone-h m-in-err"
                onChange={(e) => { const el = e.target; setPhone(el.selectionStart === el.value.length ? typedPhone(el.value) : el.value); if (prob) setProb(null); }}
                onBlur={() => { if (validPhone(phone)) setPhone(showPhone(phone)); }} />
              <p id="m-phone-h" className="ms-hint">{remembered.current && phone === remembered.current ? 'Numéro retrouvé sur cet appareil. Ce n’est pas le tien ? Modifie-le.' : 'Celui de ta réservation, ou que le salon a pour toi.'}</p>
              {errLine}
              {prob && prob.kind === 'net' && prob.retry ? <button type="button" className="c-btn ghost ms-sm" onClick={prob.retry}>Réessayer</button> : null}
              {/* the tap itself starts it (not the submit that follows): a phone opens its keyboard only for a focus made inside the tap */}
              <button type="submit" className="c-btn" aria-busy={busy || sending} onClick={(e) => { e.preventDefault(); start(); }}>Recevoir mon code par SMS</button>
              <p className="ms-assure"><Icon name="lock" size={16} />Un SMS avec un code, c’est tout : pas de mot de passe, pas de pub.</p>
              <p className="ms-legal">Ce SMS ne sert qu’à te connecter. Rien n’est vendu ni partagé à des fins publicitaires. <a href="/confidentialite#t-space">Ta vie privée</a></p>
            </form>
          ) : step === 'code' ? (
            <form className="ms-form" onSubmit={(e) => { e.preventDefault(); verify(code); }} noValidate data-guide="moi.signin.code" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
              <label htmlFor="m-code">Le code reçu par SMS</label>
              <CodeField ref={codeRef} value={code} onChange={onCode} state={cells} describedBy="m-lead m-in-err" />
              <div className="ms-slot">
                {errLine}
                {prob ? null
                  : sending ? <p className="ms-state">{spin}{link && !to ? 'Un instant…' : 'On t’envoie le code…'}</p>
                  : okay ? <p className="ms-state ok" role="status"><Icon name="check" size={18} />C’est bon</p>
                  : note ? <p className="ms-state ok" role="status"><Icon name="check" size={18} />{note}</p>
                  : busy ? <p className="ms-state">{spin}Vérification…</p>
                  : !code && !focused ? <p className="ms-tip" aria-hidden="true">Touche ici pour saisir le code</p> : null}
              </div>
              {/* after a wrong code, while the wait runs, « Renvoyer le code dans 0:28 » below says it alone */}
              {prob && prob.kind === 'bad' && wait === 0 ? <button type="button" className="c-btn ghost ms-sm" onClick={resend}>Recevoir un nouveau code</button> : null}
              {prob && prob.kind === 'net' && prob.retry ? <button type="button" className="c-btn ghost ms-sm" onClick={prob.retry}>Réessayer</button> : null}
              {code.length === 6 && !okay && !busy && !prob && !sending && note !== 'Code reçu' ? <button type="submit" className="c-btn ink">Entrer</button> : null}
              <p className="ms-hint">Le code est valable 10 minutes.</p>
              <div className="ms-sub">
                {prob && prob.kind === 'bad' && wait === 0 ? null
                  : <button type="button" className="ms-lnk" disabled={wait > 0 || resending || sending} onClick={resend}>{resending ? 'Envoi…' : wait > 0 ? 'Renvoyer le code dans ' + clock(wait) : 'Renvoyer le code'}</button>}
                <button type="button" className="ms-lnk" onClick={changeNumber}>Changer de numéro</button>
              </div>
              {sent.current && wait === 0 && !sending ? (
                <div className="ms-help" role="group" aria-labelledby="m-help-t">
                  <h2 id="m-help-t">Rien reçu ?</h2>
                  <ul>
                    <li>Vérifie que c’est bien le numéro de ta réservation.</li>
                    {!token ? <li>Tu n’es encore jamais venu ? Ton espace s’ouvre avec ta première réservation.<br /><a className="ms-mini" href="/?reserver">Réserver</a></li> : null}
                    {tel ? <li>Un souci ? Appelle le salon :<br /><a href={tel}>{showPhone(salon.phone).replace(/ /g, NB)}</a></li> : null}
                    <li>Tu peux demander jusqu’à 3 codes par jour.</li>
                  </ul>
                </div>
              ) : null}
            </form>
          ) : step === 'first' ? (
            <form className="ms-form" onSubmit={(e) => { e.preventDefault(); if (first.trim()) verify(code, first.trim()); else { setProb({ kind: 'name', text: 'Écris ton prénom, comme sur ta réservation.' }); firstRef.current?.focus(); } }} noValidate>
              <label htmlFor="m-first">Ton prénom</label>
              <input id="m-first" ref={firstRef} className="ms-inp" name="first" type="text" autoComplete="given-name" enterKeyHint="done" placeholder="Comme sur ta réservation" maxLength={40}
                value={first} aria-describedby="m-lead m-in-err" aria-invalid={!!prob && prob.kind === 'name'}
                onChange={(e) => { setFirst(e.target.value); if (prob) setProb(null); }} />
              {errLine}
              {prob && prob.kind === 'net' && prob.retry ? <button type="button" className="c-btn ghost ms-sm" onClick={prob.retry}>Réessayer</button> : null}
              <button type="submit" className="c-btn" aria-busy={busy}>{busy ? <>{spin}Vérification…</> : 'Entrer'}</button>
              <div className="ms-sub"><button type="button" className="ms-lnk" onClick={changeNumber}>Changer de numéro</button></div>
            </form>
          ) : (
            <div className="ms-lock" role="alert">
              <span className="ms-lock-i" aria-hidden="true"><Icon name="lock" size={26} /></span>
              <p>Par sécurité, on fait une pause. Réessaie dans quelques minutes, ou appelle le salon.</p>
              <div className="ms-acts">
                {tel ? <a className="c-btn" href={tel}>Appeler le salon</a> : null}
                <a className={'c-btn' + (tel ? ' ghost' : '')} href="/">Retour au site</a>
              </div>
            </div>
          )}
          <p id="m-in-live" className="m-live" role="status">{live}</p>
        </section>

        {step === 'phone' ? (
          <>
            {demo ? (
              <section className="ms-demo" aria-labelledby="m-demo-t" data-guide="moi.signin.demo">
                <p className="ms-k red" id="m-demo-t">Démo</p>
                <p>Démo : aucun SMS ne part. Entre dans l’espace d’un client du salon de démonstration.</p>
                <button type="button" className="c-btn ghost" aria-busy={busy} onClick={demoIn}>Essayer avec un client de démo</button>
              </section>
            ) : null}
            <section className="ms-first" data-guide="moi.signin.book">
              <p>Tu n’es encore jamais venu ? Ton espace s’ouvre avec ta première réservation.</p>
              <a className="c-btn ghost" href="/?reserver">Réserver</a>
            </section>
            <p className="ms-quiet">Tu veux seulement retrouver un rendez-vous ? <a href="/mon-rendez-vous">Reçois son lien.</a></p>
          </>
        ) : null}
      </div>

      {step !== 'locked' ? (
        <ul className={'ms-perks' + (step === 'phone' ? '' : ' aside')} aria-label="Ce que tu trouves dans ton espace">
          {perks.map(([icon, text]) => <li key={icon}><span className="ms-pi" aria-hidden="true"><Icon name={icon} size={20} /></span><span>{text}</span></li>)}
        </ul>
      ) : null}
    </SitePage>
  );
}
