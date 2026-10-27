// Signing in: the team taps their face and types their code on the salon tablet;
// the owner signs in with e-mail and password anywhere.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { clock } from '../lib/format';
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
  // a browser that just became a salon device goes straight to the team's codes
  useEffect(() => { if (state.device && state.team.length) setView('team'); }, [state.device?.id]);
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden>L’A</span>
          <h1>Le Comptoir</h1>
          <p>{state.shop.name}{state.device ? ' · ' + state.device.name : ''}</p>
        </div>
        {view === 'setup' ? <Setup onDone={onDone} onRestored={() => { setView('owner'); onDone(); }} /> : null}
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

function Setup({ onDone, onRestored }: { onDone: () => void; onRestored: () => void }) {
  const [f, setF] = useState({ token: '', name: '', email: '', password: '', pin: '' });
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api.post('/api/setup', f); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  if (restoring) return <Restore token={f.token} setToken={(token) => setF({ ...f, token })} onBack={() => setRestoring(false)} onDone={onRestored} />;
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
      <button type="button" className="link" style={{ alignSelf: 'center' }} onClick={() => setRestoring(true)}>Installer depuis une sauvegarde</button>
      <p className="faint" style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="shield" size={14} />Mots de passe et codes sont chiffrés (scrypt) et jamais lisibles, même par nous.</p>
    </form>
  );
}

/* ---------------- installing from a backup ---------------- */

type SetupBackup = { name: string; day: string; at: number; count: number | null; size: number | null };
type SetupBackups = { blob: boolean; key: boolean; keyProblem: string; error: string; items: SetupBackup[] };
/** stays under the server's 3 MB per part, itself under Vercel's 4.5 MB body limit */
const PART = 2_500_000;

/** The setup routes take the token in a header (never in a URL) and an uploaded part as plain text. */
async function setupCall<T>(method: 'GET' | 'POST', path: string, token: string, body?: string | object): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'x-setup-token': token.trim() };
  if (body !== undefined) headers['content-type'] = typeof body === 'string' ? 'text/plain' : 'application/json';
  let res: Response;
  try { res = await fetch(path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'network', 'Pas de connexion. Vérifie le Wi-Fi, puis réessaie.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'http', data?.error?.message || 'Erreur ' + res.status);
  return data as T;
}

const size = (n: number) => (n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + ' Ko' : (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo');
const dm = (day: string) => day.slice(8) + '/' + day.slice(5, 7);
const backupLine = (b: SetupBackup) => 'Sauvegarde du ' + dm(b.day) + ' · ' + clock(b.at) + (b.count != null ? ' · ' + b.count.toLocaleString('fr-FR') + ' événements' : '');

function Restore({ token, setToken, onBack, onDone }: { token: string; setToken: (t: string) => void; onBack: () => void; onDone: () => void }) {
  const [list, setList] = useState<SetupBackups | null>(null);
  const [pick, setPick] = useState<SetupBackup | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const look = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy('list'); setErr(''); setPick(null);
    try { setList(await setupCall<SetupBackups>('GET', '/api/setup/backups', token)); } catch (x: any) { setErr(x.message); setList(null); } finally { setBusy(''); }
  };
  const done = () => { toast({ title: 'Salon restauré', sub: 'Connecte-toi avec ton compte habituel.', icon: 'shieldOk' }); onDone(); };
  const restoreStored = async (b: SetupBackup) => {
    setBusy('restore'); setErr('');
    try { await setupCall('POST', '/api/setup/restore', token, { name: b.name }); done(); } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  };
  const restoreFile = async (f: File) => {
    setErr('');
    try {
      const text = await f.text();
      const n = Math.max(1, Math.ceil(text.length / PART));
      // one part: a single request, so it works whichever server instance answers
      if (n === 1) {
        setBusy('Envoi et vérification…');
        await setupCall('POST', '/api/setup/restore/file', token, text);
        done();
        return;
      }
      for (let i = 0; i < n; i++) {
        setBusy('Envoi ' + (n > 1 ? (i + 1) + '/' + n : '') + '…');
        await setupCall('POST', `/api/setup/restore/chunk?i=${i}&n=${n}`, token, text.slice(i * PART, (i + 1) * PART));
      }
      setBusy('Vérification…');
      await setupCall('POST', '/api/setup/restore/commit', token, { n });
      done();
    } catch (x: any) { setErr(x.message); } finally { setBusy(''); }
  };
  const working = !!busy;
  // without the key nothing can be opened: no point choosing a file
  const locked = !!list && !list.key;
  return (
    <div className="card col" style={{ gap: 14, padding: 22 }}>
      <div><b className="serif" style={{ fontSize: 28 }}>Installer depuis une sauvegarde</b><p className="muted" style={{ marginTop: 6 }}>Le salon revient tel qu’il était au moment de la sauvegarde : clients, rendez-vous, ventes, équipe et accès. Il faut le code d’installation (SETUP_TOKEN) et la même clé BACKUP_KEY qu’à l’origine.</p></div>
      <form className="row" style={{ gap: 8, alignItems: 'flex-end' }} onSubmit={look}>
        <div style={{ flex: 1, minWidth: 0 }}><Field label="Code d’installation" htmlFor="rs-t"><input id="rs-t" className="input" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required /></Field></div>
        <Button variant="subtle" type="submit" busy={busy === 'list'} disabled={working || !token.trim()}>Voir les sauvegardes</Button>
      </form>
      {list && !list.key ? <Note tone="err" icon="alert">{list.keyProblem}</Note> : null}
      {list && list.error ? <Note tone="warn" icon="alert">{list.error}</Note> : null}
      {list && list.blob && list.items.length ? (
        <ul className="list">{list.items.map((b) => (
          <li key={b.name} className="li">
            <span className="li-main"><b>{backupLine(b)}</b>{b.size ? <small>{size(b.size)}, chiffrée</small> : null}</span>
            <Button size="sm" variant={pick?.name === b.name ? 'primary' : 'ghost'} disabled={working || !list.key} onClick={() => setPick(b)}>Restaurer</Button>
          </li>
        ))}</ul>
      ) : list ? <Note icon="info">{list.blob ? 'Aucune sauvegarde dans le stockage Blob de cette installation.' : 'Aucun stockage Blob relié à cette installation.'}{locked ? '' : ' Choisis le fichier de sauvegarde sur ton ordinateur.'}</Note> : null}
      {pick ? (
        <div className="col" style={{ gap: 10 }}>
          <Note tone="accent" icon="info">Restaurer la sauvegarde du {dm(pick.day)} à {clock(pick.at)} ? Tout ce qui a été fait après est perdu.</Note>
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" icon="check" busy={busy === 'restore'} disabled={working} onClick={() => restoreStored(pick)}>Oui, restaurer</Button>
            <Button variant="ghost" disabled={working} onClick={() => setPick(null)}>Annuler</Button>
          </div>
        </div>
      ) : null}
      <Field label="Ou un fichier de ton ordinateur" hint="Le fichier .json.gz.enc téléchargé depuis Réglages › Données">
        <label className="btn btn-ghost" aria-disabled={working || locked} style={{ justifyContent: 'flex-start', maxWidth: '100%', opacity: working || locked ? 0.38 : undefined, pointerEvents: locked ? 'none' : undefined }}>
          <input className="vh" type="file" accept=".enc,.json,application/octet-stream" disabled={working || locked} onChange={(e) => { setFile(e.target.files?.[0] || null); setPick(null); }} />
          <Icon name="box" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file ? file.name : 'Choisir le fichier…'}</span>
        </label>
      </Field>
      {file ? <Button variant="primary" icon="check" block busy={working && busy !== 'list' && busy !== 'restore'} disabled={working || locked || !token.trim()} onClick={() => restoreFile(file)}>{busy && busy !== 'list' && busy !== 'restore' ? busy : 'Restaurer ce fichier'}</Button> : null}
      {err ? <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 14 }}>{err}</p> : null}
      <button type="button" className="link" style={{ alignSelf: 'center' }} onClick={onBack} disabled={working}>Créer un salon neuf à la place</button>
    </div>
  );
}
