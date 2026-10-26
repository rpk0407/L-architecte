// Signing in: the team taps their face and types their code on the salon tablet;
// the owner signs in with e-mail and password anywhere.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { buzz } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { Avatar, Button, Field, Note, toast } from '../ui/kit';

export type AuthState = {
  mode: 'demo' | 'production'; needsSetup: boolean; shop: { name: string };
  device: { id: string; name: string } | null;
  team: { id: string; name: string; initials: string; color: string; role: string; roleLabel: string }[];
  me: any;
  demo: { email: string; password: string; ownerPin: string; pins: Record<string, string>; giftcard: string } | null;
};

export function Login({ state, onDone }: { state: AuthState; onDone: () => void }) {
  const [view, setView] = useState<'team' | 'owner' | 'setup'>(state.needsSetup ? 'setup' : state.device && state.team.length ? 'team' : 'owner');
  const [who, setWho] = useState<AuthState['team'][number] | null>(null);
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden>L’A</span>
          <h1>Le Comptoir</h1>
          <p>{state.shop.name}{state.device ? ' · ' + state.device.name : ''}</p>
        </div>
        {view === 'setup' ? <Setup onDone={onDone} /> : null}
        {view === 'team' && !who ? <Team state={state} onPick={setWho} onOwner={() => setView('owner')} /> : null}
        {view === 'team' && who ? <Pin who={who} demoPin={state.demo ? (state.demo.pins[who.name] || (who.role === 'owner' ? state.demo.ownerPin : '')) : ''} onBack={() => setWho(null)} onDone={onDone} /> : null}
        {view === 'owner' ? <Owner state={state} onDone={onDone} onTeam={state.device && state.team.length ? () => setView('team') : null} /> : null}
      </div>
    </div>
  );
}

function Team({ state, onPick, onOwner }: { state: AuthState; onPick: (w: AuthState['team'][number]) => void; onOwner: () => void }) {
  return (
    <>
      <p className="muted" style={{ textAlign: 'center' }}>Qui prend le comptoir ?</p>
      <div className="team">
        {state.team.map((t) => (
          <button key={t.id} type="button" onClick={() => onPick(t)}>
            <Avatar name={t.name} initials={t.initials} color={t.color} size="lg" />
            <b>{t.name}</b><small>{t.roleLabel}</small>
          </button>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}><button type="button" className="link" onClick={onOwner}>Se connecter avec e-mail et mot de passe</button></div>
    </>
  );
}

function Pin({ who, demoPin, onBack, onDone }: { who: AuthState['team'][number]; demoPin: string; onBack: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (p = pin) => {
    if (p.length < 4 || busy) return;
    setBusy(true);
    try { await api.post('/api/auth/pin', { staffId: who.id, pin: p }); buzz(10); onDone(); }
    catch (e: any) { setErr(e.message); setPin(''); buzz([30, 40, 30]); setTimeout(() => setErr(''), 1600); }
    finally { setBusy(false); }
  };
  const press = (d: string) => {
    if (busy) return;
    buzz(5);
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length === 6) submit(next);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') onBack();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });
  return (
    <div className="col" style={{ gap: 18, alignItems: 'stretch' }}>
      <div className="row" style={{ justifyContent: 'center', gap: 14 }}>
        <Avatar name={who.name} initials={who.initials} color={who.color} size="lg" />
        <div><b style={{ font: '400 30px/1 var(--serif)' }}>{who.name}</b><p className="muted" style={{ fontSize: 13 }}>Ton code personnel</p></div>
      </div>
      <div className={'pin-dots' + (err ? ' err' : '')} aria-live="polite" aria-label={err || pin.length + ' chiffres saisis'}>
        {Array.from({ length: Math.max(4, Math.min(6, pin.length + (pin.length >= 4 ? 1 : 0))) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      {err ? <p role="alert" style={{ textAlign: 'center', color: 'var(--danger)', fontWeight: 600 }}>{err}</p> : null}
      <div className="keypad" style={{ maxWidth: 340, margin: '0 auto', width: '100%' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} aria-label={d}>{d}</button>)}
        <button type="button" className="fn" onClick={onBack}>Retour</button>
        <button type="button" onClick={() => press('0')} aria-label="0">0</button>
        <button type="button" className="go" onClick={() => submit()} disabled={pin.length < 4 || busy}>{busy ? '…' : 'Entrer'}</button>
      </div>
      {demoPin ? <p className="faint" style={{ textAlign: 'center', fontSize: 12.5 }}>Démo : le code de {who.name} est <b className="muted">{demoPin}</b></p> : null}
    </div>
  );
}

function Owner({ state, onDone, onTeam }: { state: AuthState; onDone: () => void; onTeam: (() => void) | null }) {
  const [email, setEmail] = useState(state.demo ? state.demo.email : '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErr('');
    try { await api.post('/api/auth/login', { email, password, remember }); onDone(); }
    catch (x: any) { setErr(x.message); }
    finally { setBusy(false); }
  };
  const demoDevice = async () => {
    setBusy(true);
    try { await api.post('/api/auth/device/demo'); toast('Ce navigateur est maintenant un poste du salon'); onDone(); }
    catch (x: any) { setErr(x.message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <form className="card col" style={{ gap: 14, padding: 22 }} onSubmit={go}>
        <Field label="E-mail" htmlFor="li-e"><input id="li-e" className="input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Mot de passe" htmlFor="li-p" error={err || null}><input id="li-p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!state.demo} /></Field>
        <label className="row" style={{ gap: 10, fontSize: 14, color: 'var(--tx2)' }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />Rester connecté 30 jours sur cet appareil</label>
        <Button variant="primary" size="lg" block busy={busy} type="submit">Se connecter</Button>
        {onTeam ? <button type="button" className="link" style={{ alignSelf: 'center' }} onClick={onTeam}>Revenir aux codes de l’équipe</button> : null}
      </form>
      {state.demo ? (
        <div className="demo-card">
          <span className="k">Démo</span>
          Gérant : <code>{state.demo.email}</code> · <code>{state.demo.password}</code><br />
          Pour essayer le mode tablette du salon (codes de l’équipe&nbsp;: {Object.entries(state.demo.pins).map(([n, p]) => <span key={n}>{n} <code>{p}</code> </span>)}) :
          <div style={{ marginTop: 10 }}><Button variant="ghost" size="sm" icon="device" onClick={demoDevice} busy={busy}>Faire de ce navigateur un poste du salon</Button></div>
        </div>
      ) : (
        <Note icon="shield">Sur la tablette du salon, connecte-toi une fois en gérant puis « Enregistre ce poste » dans Réglages › Appareils : l’équipe entrera ensuite avec son code.</Note>
      )}
    </>
  );
}

function Setup({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ token: '', name: '', email: '', password: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.post('/api/setup', f); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="card col" style={{ gap: 14, padding: 22 }} onSubmit={go}>
      <div><b className="serif" style={{ fontSize: 28 }}>Bienvenue.</b><p className="muted" style={{ marginTop: 6 }}>Crée le compte du gérant. Le code d’installation se trouve dans les réglages d’hébergement (SETUP_TOKEN).</p></div>
      <Field label="Code d’installation" htmlFor="su-t"><input id="su-t" className="input" value={f.token} onChange={set('token')} autoComplete="off" required /></Field>
      <div className="grid2 stack">
        <Field label="Ton prénom" htmlFor="su-n"><input id="su-n" className="input" value={f.name} onChange={set('name')} required /></Field>
        <Field label="Code à 4–6 chiffres" htmlFor="su-c" hint="Pour la tablette du salon"><input id="su-c" className="input" inputMode="numeric" value={f.pin} onChange={set('pin')} pattern="\d{4,6}" /></Field>
      </div>
      <Field label="E-mail" htmlFor="su-e"><input id="su-e" className="input" type="email" value={f.email} onChange={set('email')} required /></Field>
      <Field label="Mot de passe" htmlFor="su-p" hint="10 caractères minimum" error={err || null}><input id="su-p" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required minLength={10} /></Field>
      <Button variant="primary" size="lg" block busy={busy} type="submit" icon="check">Ouvrir le Comptoir</Button>
      <p className="faint" style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="shield" size={14} />Mots de passe et codes sont chiffrés (scrypt) et jamais lisibles, même par nous.</p>
    </form>
  );
}
