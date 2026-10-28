// Mon compte: what each person controls about themselves, whatever their role. TEAM-02: his photo, his phone (QR), his
// home page, his toasts, his amounts on the salon post, his agenda in his phone's calendar.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { useQuery } from '../../../lib/query';
import { useRoute } from '../../../lib/router';
import { Icon } from '../../../ui/Icon';
import { Avatar, Button, Field, Note, Seg, Switch, confirm, toast, toastError } from '../../../ui/kit';
import { photoOf, useApp } from '../../state';
import { useOpenPages } from '../../App';
import type { Prefs } from '../../types';
import { COLORS, MyAbsences } from '../Equipe';
import { PhoneList, PhoneQR } from './Phone';

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
      <section className="card col" style={{ gap: 14 }} data-guide="compte-profil">
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={me.name} initials={me.initials} color={f.color} photo={photoOf(me)} size="xl" />
          <div style={{ minWidth: 0 }}>
            <p className="section-k">{me.roleLabel}</p>
            <h2 className="rg-h">{me.name}</h2>
            {/* a linked phone's name is typed on the phone: a long one wraps instead of pushing the page sideways */}
            <p className="muted" style={{ fontSize: 13.5, marginTop: 6, overflowWrap: 'anywhere' }}>{me.session === 'pin' ? 'Connecté par code' : 'Connecté par mot de passe'}{me.device ? ' · ' + me.device.name : ''}</p>
          </div>
        </div>
        <PhotoField />
        {me.chair ? (
          <>
            <Field label="Ta couleur dans l’agenda"><div className="eq-colors">{COLORS.map((c) => <button key={c} type="button" aria-label={'Couleur ' + c} aria-pressed={f.color === c} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}</div></Field>
            <Field label="Ta présentation sur le site" hint={f.bio.length + ' / 280'} htmlFor="ac-b"><textarea id="ac-b" className="input textarea" rows={3} maxLength={280} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} placeholder="Ta spécialité, ton style, depuis quand tu coupes…" /></Field>
            <Field label="Ton Instagram" htmlFor="ac-ig"><input id="ac-ig" className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="https://instagram.com/…" /></Field>
            {dirty ? <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><Button variant="ghost" onClick={() => setF({ bio: me.bio, instagram: me.instagram, color: me.color })}>Annuler</Button><Button variant="primary" busy={busy} onClick={save}>Enregistrer</Button></div> : null}
          </>
        ) : null}
      </section>

      {boot.settings.team?.personalPhones !== false ? <PhoneCard /> : null}
      <PrefsCard />
      {boot.settings.team?.staffCalendar !== false ? <CalendarCard /> : null}

      <PinCard />
      {me.hasPwd || ['owner', 'manager'].includes(me.role) ? <PasswordCard /> : null}

      {me.chair ? <MyAbsences st={boot.staff.find((s) => s.id === me.id) || me} /> : null}

      <section className="card col" style={{ gap: 10 }} data-guide="compte-sessions">
        <div className="card-h"><h2><Icon name="lock" size={16} />Sessions</h2></div>
        <p className="muted" style={{ fontSize: 13.5 }}>Un téléphone perdu ? Ferme toutes tes sessions d’un coup : il faudra se reconnecter partout, ici compris.</p>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="ghost" icon="logout" onClick={async () => {
            if (!await confirm({ title: 'Te déconnecter partout ?', ok: 'Déconnecter', danger: true })) return;
            try { await api.post('/api/v1/staff/' + me.id + '/revoke'); } catch (e) { toastError(e); return; }
            await signOut();
          }}>Me déconnecter partout</Button>
          {me.device ? <Button variant="ghost" icon="device" onClick={async () => {
            // a linked phone forgotten is removed from Mes téléphones too (the server revokes it): a new QR links it again
            const body = me.device?.personal ? 'Ce téléphone sera retiré de tes téléphones. Pour l’utiliser à nouveau, il faudra le lier avec un nouveau QR code.' : 'Ce poste ne proposera plus la connexion par code. Il faudra l’enregistrer à nouveau depuis Réglages › Appareils.';
            if (!await confirm({ title: me.device?.personal ? 'Oublier ce téléphone ?' : 'Oublier cet appareil ?', body, ok: 'Oublier', danger: true })) return;
            await api.post('/api/auth/forget-device').catch(() => {});
            location.reload();
          }}>{me.device.personal ? 'Oublier ce téléphone' : 'Oublier cet appareil'}</Button> : null}
        </div>
      </section>
    </div>
  );
}

/* ---------------- TEAM-02: my photo, my phone, my Comptoir, my agenda ---------------- */

/** max bytes the server takes (commands/team.js PHOTO_MAX) */
const PHOTO_MAX = 24 * 1024;
/** The picked picture as a 192 px square JPEG (centre crop), light enough for the server: canvas, no library. */
async function squareJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const g = c.getContext('2d');
    if (!g || !side) throw new Error('Image illisible.');
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 192, 192);
    for (const q of [0.85, 0.72, 0.6, 0.45]) {
      const data = c.toDataURL('image/jpeg', q);
      if (Math.floor((data.length - data.indexOf(',') - 1) * 3 / 4) <= PHOTO_MAX) return data;
    }
    throw new Error('Photo trop lourde.');
  } finally { URL.revokeObjectURL(url); }
}

function PhotoField() {
  const { boot, reloadBoot } = useApp();
  const me = boot.me;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const send = async (data: string) => {
    setBusy(true);
    try { await api.post('/api/v1/staff/' + encodeURIComponent(me.id) + '/photo', { data }); await reloadBoot(); toast({ title: data ? 'Photo enregistrée' : 'Photo retirée', icon: 'check' }); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try { await send(await squareJpeg(f)); } catch (e: any) { toastError({ message: e?.message === 'Photo trop lourde.' ? 'Photo trop lourde.' : 'Cette image ne s’ouvre pas : essaie une photo JPEG.' }); }
    if (input.current) input.current.value = '';
  };
  return (
    <div className="kv" style={{ alignItems: 'center' }}>
      <span><b>Ma photo</b><br /><small className="faint">Dans le Comptoir et sur l’écran de connexion, pour l’équipe seulement.</small></span>
      <span className="row touch44" style={{ gap: 8 }}>
        {/* opened by « Choisir »: out of the tab order and of the accessibility tree, the button is the control */}
        <input ref={input} id="ac-photo" className="vh" type="file" accept="image/*" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
        <Button size="sm" variant="ghost" icon="user" busy={busy} onClick={() => input.current?.click()}>Choisir</Button>
        {me.photo ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => send('')}>Retirer</Button> : null}
      </span>
    </div>
  );
}

function PhoneCard() {
  const { boot } = useApp();
  const me = boot.me;
  const here = !!me.device?.personal;
  return (
    <section className="card col touch44" style={{ gap: 12 }} aria-labelledby="ac-phone" data-guide="compte-telephone">
      <div className="card-h"><h2 id="ac-phone"><Icon name="phone" size={16} />Mon téléphone</h2></div>
      {here ? <Note tone="ok" icon="check">Ce téléphone est lié. Ton code l’ouvre, une fois par jour.</Note> : (
        <>
          <p className="muted" style={{ fontSize: 13.5 }}>Le Comptoir dans ta poche : tes clients, ton agenda, tes alertes. Ton code une fois par jour.</p>
          <PhoneQR st={me} self />
        </>
      )}
      <div className="col" style={{ gap: 6 }}>
        <b style={{ fontSize: 13.5 }}>Mes téléphones</b>
        <PhoneList st={me} self />
      </div>
    </section>
  );
}

function PrefsCard() {
  const { boot, reloadBoot, can } = useApp();
  const p = boot.me.prefs;
  const pages = useOpenPages();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Partial<Prefs>) => {
    setBusy(true);
    try { await api.patch('/api/v1/prefs', patch); await reloadBoot(); toast({ title: 'Enregistré', icon: 'check' }); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  // only the pages this build has and this person may open (Mon espace and Pilotage join when they land)
  const homes: { v: Prefs['home']; t: string }[] = [{ v: 'auto', t: 'Auto' }];
  if (pages.includes('espace') && boot.me.chair) homes.push({ v: 'espace', t: 'Mon espace' });
  homes.push({ v: 'agenda', t: 'Agenda' });
  if (pages.includes('pilotage') && can('report.shop')) homes.push({ v: 'pilotage', t: 'Pilotage' });
  const home = homes.some((h) => h.v === p.home) ? p.home : 'auto';
  return (
    <section className="card col touch44" style={{ gap: 14 }} aria-labelledby="ac-prefs" aria-busy={busy || undefined} data-guide="compte-comptoir">
      <div className="card-h"><h2 id="ac-prefs"><Icon name="sparkle" size={16} />Mon Comptoir</h2></div>
      <Field label="Ma page d’accueil" hint="Ce qui s’ouvre quand tu arrives sur le Comptoir.">
        <Seg label="Ma page d’accueil" value={home} options={homes} onChange={(v) => save({ home: v })} />
      </Field>
      <Field label="Me prévenir" hint="Les alertes à l’écran quand un client réserve, annule ou arrive.">
        <Seg label="Me prévenir" value={p.notify} options={[{ v: 'mine', t: 'Mes clients' }, { v: 'all', t: 'Tout le salon' }, { v: 'none', t: 'Rien' }]} onChange={(v) => save({ notify: v })} />
      </Field>
      <Switch on={p.buzz} onChange={(v) => save({ buzz: v })} title="Vibrer" hint="Le téléphone vibre avec l’alerte, quand il le peut." disabled={p.notify === 'none'} />
      {/* only once a page blurs them (Mon espace and Pilotage read useMaskedAmounts): a promise the screens keep */}
      {pages.includes('espace') || pages.includes('pilotage') ? (
        <Field label="Montants sur le poste du salon" hint="Sur la tablette du salon, tes montants restent flous tant que tu ne les touches pas.">
          <Seg label="Montants sur le poste du salon" value={p.blur === 'off' ? 'off' : 'auto'} options={[{ v: 'auto', t: 'Masqués' }, { v: 'off', t: 'Visibles' }]} onChange={(v) => save({ blur: v })} />
        </Field>
      ) : null}
    </section>
  );
}

type Cal = { allowed: boolean; on: boolean; url: string | null; https: string | null };
function CalendarCard() {
  const { boot, reloadBoot } = useApp();
  const q = useQuery<Cal>('/api/v1/prefs/calendar');
  const [cal, setCal] = useState<Cal | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setCal(q.data); }, [q.data]);
  const c = cal || q.data;
  // webcal: opens the Calendar app on an iPhone, an iPad (which may say Macintosh, with a touch screen) or a Mac;
  // elsewhere (Android, Windows, Linux) the address is copied into Google Agenda
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const mac = !ios && /Macintosh/.test(ua);
  const turn = async (on: boolean) => {
    setBusy(true);
    try { setCal(await api.post<Cal>('/api/v1/prefs/calendar', { on })); await reloadBoot(); toast({ title: on ? 'Lien créé' : 'Agenda coupé', sub: on ? 'L’ancien lien ne marche plus.' : undefined, icon: 'calendar' }); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(c?.https || ''); toast({ title: 'Lien copié', sub: 'Dans Google Agenda : Autres agendas › À partir de l’URL.', icon: 'copy' }); }
    catch { toastError({ message: 'Copie impossible : appuie longuement sur le lien.' }); }
  };
  const name = async (v: boolean) => {
    try { await api.patch('/api/v1/prefs', { calName: v }); await reloadBoot(); } catch (e) { toastError(e); }
  };
  return (
    <section className="card col" style={{ gap: 12 }} aria-labelledby="ac-cal" data-guide="compte-agenda">
      <div className="card-h"><h2 id="ac-cal"><Icon name="calendar" size={16} />Mon agenda dans mon téléphone</h2></div>
      <Switch on={!!c?.on} disabled={busy || !c} onChange={turn} title="Mes rendez-vous dans mon agenda" hint="Apple ou Google Agenda le met à jour tout seul." />
      {c?.on && c.url ? (
        <>
          <div className="row wrap" style={{ gap: 8 }}>
            {ios || mac ? <a className="btn btn-primary" href={c.url}><Icon name="calendar" />{ios ? 'Ajouter à mon iPhone' : 'Ajouter à mon calendrier'}</a> : null}
            <Button variant={ios || mac ? 'ghost' : 'primary'} icon="copy" onClick={copy}>Copier le lien</Button>
            <Button variant="ghost" icon="undo" busy={busy} onClick={() => turn(true)}>Nouveau lien</Button>
          </div>
          <Switch on={boot.me.prefs.calName} onChange={name} title="Afficher le prénom" hint="Le prénom du client à côté de la prestation, jamais son nom." />
        </>
      ) : null}
      <p className="faint" style={{ fontSize: 12.5 }}>Prestation et numéro de visite, le prénom si tu l’affiches ; jamais son téléphone, une note ni un prix. Un nouveau lien coupe l’ancien.</p>
    </section>
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
    <section className="card col" style={{ gap: 12 }} data-guide="compte-pin">
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
    <section className="card col" style={{ gap: 12 }} data-guide="compte-mdp">
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
