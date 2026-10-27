// Mon compte: what each person controls about themselves, whatever their role.
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useRoute } from '../../../lib/router';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Field, Note, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import { COLORS, MyAbsences } from '../Equipe';

export function Account() {
  const { boot, reloadBoot, signOut } = useApp();
  const me = boot.me;
  const [f, setF] = useState({ bio: me.bio, instagram: me.instagram, color: me.color });
  const [busy, setBusy] = useState(false);
  const route = useRoute();
  // ?absences=1, from the phone's "Plus" menu: straight to them
  useEffect(() => { if (route.query.get('absences') && me.chair) requestAnimationFrame(() => document.getElementById('absences')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }, [route.key]);
  const dirty = f.bio !== me.bio || f.instagram !== me.instagram || f.color !== me.color;
  const save = async () => {
    setBusy(true);
    try { await api.patch('/api/v1/staff/' + me.id, f); toast({ title: 'Profil enregistré', icon: 'check' }); await reloadBoot(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={me.name} initials={me.initials} color={f.color} size="xl" />
          <div>
            <p className="section-k">{me.roleLabel}</p>
            <h2 className="rg-h">{me.name}</h2>
            <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>{me.session === 'pin' ? 'Connecté par code' : 'Connecté par mot de passe'}{me.device ? ' · ' + me.device.name : ''}</p>
          </div>
        </div>
        {me.chair ? (
          <>
            <Field label="Ta couleur dans l’agenda"><div className="eq-colors">{COLORS.map((c) => <button key={c} type="button" aria-label={'Couleur ' + c} aria-pressed={f.color === c} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}</div></Field>
            <Field label="Ta présentation sur le site" hint={f.bio.length + ' / 280'} htmlFor="ac-b"><textarea id="ac-b" className="input textarea" rows={3} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Ta spécialité, ton style, depuis quand tu coupes…" /></Field>
            <Field label="Ton Instagram" htmlFor="ac-ig"><input id="ac-ig" className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="https://instagram.com/…" /></Field>
            {dirty ? <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><Button variant="ghost" onClick={() => setF({ bio: me.bio, instagram: me.instagram, color: me.color })}>Annuler</Button><Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button></div> : null}
          </>
        ) : null}
      </section>

      <PinCard />
      {me.hasPwd || ['owner', 'manager'].includes(me.role) ? <PasswordCard /> : null}

      {me.chair ? <MyAbsences st={boot.staff.find((s) => s.id === me.id) || me} /> : null}

      <section className="card col" style={{ gap: 10 }}>
        <div className="card-h"><h2><Icon name="lock" size={16} />Sessions</h2></div>
        <p className="muted" style={{ fontSize: 13.5 }}>Un téléphone perdu ? Ferme toutes tes sessions d’un coup : il faudra se reconnecter partout, ici compris.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="ghost" icon="logout" onClick={async () => {
            if (!await confirm({ title: 'Te déconnecter partout ?', ok: 'Déconnecter', danger: true })) return;
            try { await api.post('/api/v1/staff/' + me.id + '/revoke'); } catch (e) { toastError(e); return; }
            await signOut();
          }}>Me déconnecter partout</Button>
          {me.device ? <Button variant="ghost" icon="device" onClick={async () => {
            if (!await confirm({ title: 'Oublier cet appareil ?', body: 'Ce poste ne proposera plus la connexion par code. Il faudra l’enregistrer à nouveau depuis Réglages › Appareils.', ok: 'Oublier', danger: true })) return;
            await api.post('/api/auth/forget-device').catch(() => {});
            location.reload();
          }}>Oublier cet appareil</Button> : null}
        </div>
      </section>
    </div>
  );
}

function PinCard() {
  const { boot } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const needCur = boot.me.hasPin && boot.me.session === 'pin';
  const weak = next && (/^(\d)\1+$/.test(next) || '0123456789'.includes(next) || '9876543210'.includes(next));
  const ok = /^\d{4,6}$/.test(next) && !weak && next === again && (!needCur || /^\d{4,6}$/.test(cur));
  const go = async () => {
    setBusy(true);
    try { await api.post('/api/auth/pin-change', { current: needCur ? cur : undefined, next }); toast({ title: 'Nouveau code enregistré', icon: 'key' }); setCur(''); setNext(''); setAgain(''); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  useEffect(() => { setAgain(''); }, [next.length < 4]);
  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="card-h"><h2><Icon name="key" size={16} />Code PIN</h2><span className={'badge ' + (boot.me.hasPin ? 'badge-ok' : 'badge-warn')}>{boot.me.hasPin ? 'défini' : 'aucun'}</span></div>
      <p className="muted" style={{ fontSize: 13.5 }}>Pour se connecter en deux secondes sur les appareils du salon. 4 à 6 chiffres, ni 0000 ni 1234 : il protège la caisse.</p>
      <div className="grid3 stack">
        {needCur ? <Field label="Code actuel" htmlFor="pc-c"><input id="pc-c" className="input tnum" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} /></Field> : null}
        <Field label="Nouveau code" error={weak ? 'Trop facile à deviner.' : null} htmlFor="pc-n"><input id="pc-n" className="input tnum" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="Encore une fois" error={again && again !== next && again.length >= next.length ? 'Les deux codes diffèrent.' : null} htmlFor="pc-a"><input id="pc-a" className="input tnum" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" busy={busy} disabled={!ok} onClick={go}>Changer mon code</Button></div>
    </section>
  );
}

function PasswordCard() {
  const { boot } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const score = strength(next);
  const go = async () => {
    setBusy(true);
    try { await api.post('/api/auth/password', { current: cur, next }); toast({ title: 'Mot de passe changé', sub: 'Tes autres sessions ont été fermées.', icon: 'lock' }); setCur(''); setNext(''); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="card-h"><h2><Icon name="lock" size={16} />Mot de passe</h2><span className="faint" style={{ fontSize: 13 }}>{boot.me.email || ''}</span></div>
      <p className="muted" style={{ fontSize: 13.5 }}>Pour se connecter depuis n’importe où (chez toi, en déplacement). Changer le mot de passe ferme tes autres sessions.</p>
      <div className="grid2 stack">
        {boot.me.hasPwd ? <Field label="Mot de passe actuel" htmlFor="pw-c"><input id="pw-c" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field> : null}
        <Field label="Nouveau mot de passe" hint={next ? ['Trop court', 'Faible', 'Correct', 'Solide', 'Excellent'][score] : '10 caractères minimum. Une petite phrase marche très bien.'} htmlFor="pw-n">
          <input id="pw-n" className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      {next ? <div className="rg-strength" aria-hidden>{[0, 1, 2, 3].map((i) => <i key={i} className={i < score ? 'on s' + score : ''} />)}</div> : null}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" busy={busy} disabled={next.length < 10 || (boot.me.hasPwd && !cur)} onClick={go}>Changer le mot de passe</Button></div>
      {!boot.me.hasPwd ? <Note icon="info">Tu n’as pas encore de mot de passe : seul le code fonctionne, et seulement sur les appareils du salon.</Note> : null}
    </section>
  );
}

function strength(p: string) {
  if (p.length < 10) return 0;
  let n = 1;
  if (p.length >= 14) n++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) n++;
  if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p)) n++;
  return Math.min(4, n);
}
