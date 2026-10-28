// AC-02 · /moi › Profil: what a client changes of himself. His barber, his name and birthday, his two kinds of SMS, a copy
// of his data by e-mail and the request to erase his file. Each choice saves as it is made. The way out (this phone, every
// phone, close the space) is the last card of the tab: Session.tsx. Found by the folder registry (web/src/moi/registry.ts), no line to add anywhere else.
// Same paper, ink and red as the site's pages (client.css): c-card, c-btn, c-note; only what they lack is in profile.css.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { CardProps, MoiCardMeta } from '../types';
import { Section, short } from '../profile/kit';
import './profile.css';

export const meta = { id: 'profile', tab: 'profile', order: 10 } satisfies MoiCardMeta;

/** GET /api/me/profile (server/http/routes-moi.js) */
type ProfileInfo = { email: string; phone: string; canAsk: boolean; eraseAt: number; demo: boolean };
/** What a write answers: the demo's persona gets `demo: true` and a message, nothing is written. */
type Answer = { ok: boolean; demo?: boolean; message?: string; sent?: boolean; already?: boolean; reason?: 'noEmail' | 'emailOff' | 'tooBig' };

const SALON_ONLY = 'Pour ça, passe au salon.';
/** « 14-03 » (the file's form) ⇄ « 14/03 » (what he types) */
const birthdayIn = (v: string) => (v ? v.replace('-', '/') : '');
const birthdayOut = (v: string) => v.trim().replace(/[./ ]/g, '-').replace(/^(\d)-/, '0$1-').replace(/-(\d)$/, '-0$1');
const BIRTHDAY_FORM = /^((0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2]))?$/;
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A real day of that month (29 February counts: he may have been born on it). */
const birthdayOk = (v: string) => BIRTHDAY_FORM.test(v) && (!v || Number(v.slice(0, 2)) <= DAYS_IN[Number(v.slice(3)) - 1]);

/** A line that says « Enregistré » (or what went wrong) for a few seconds, read out by screen readers. */
function useSaying() {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = (t: string, isBad = false) => {
    clearTimeout(timer.current);
    setText(t); setBad(isBad);
    timer.current = window.setTimeout(() => setText(''), isBad ? 6000 : 3000);
  };
  return { text, bad, say };
}

function Switch({ on, onChange, title, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="mp-switch" disabled={disabled} onClick={() => onChange(!on)}>
      <span className="mp-switch-t"><b>{title}</b>{hint ? <small>{hint}</small> : null}</span>
      <span className="mp-switch-k" aria-hidden><i /></span>
    </button>
  );
}

export default function Profile({ me, reload }: CardProps) {
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // bumped when what is on screen may no longer be what the server holds: the fields start again from `me`
  const [gen, setGen] = useState(0);
  const { text, bad, say } = useSaying();
  const loadInfo = () => { setFailed(false); api.get<ProfileInfo>('/api/me/profile').then(setInfo).catch(() => setFailed(true)); };
  useEffect(() => { loadInfo(); }, []);

  /** One write. The demo's persona changes nothing, and a refused write changes nothing: either way the fields are read again from the server's truth, so the screen does not lie. */
  async function write(call: () => Promise<Answer>, ok = 'Enregistré') {
    try {
      const r = await call();
      if (r.demo) { say(r.message || 'Démo : rien n’est changé'); setGen((g) => g + 1); reload(); return r; }
      say(ok); reload();
      return r;
    } catch (e: any) { say(e.message || 'Une erreur est survenue.', true); setGen((g) => g + 1); reload(); return null; }
  }

  return (
    <div className="mp">
      <Barber key={'b' + gen} me={me} write={write} />
      <Infos key={'i' + gen} me={me} info={info} write={write} />
      <Messages key={'m' + gen} me={me} write={write} />
      <Data info={info} failed={failed} write={write} say={say} refresh={loadInfo} />
      <p className={'mp-say c-note' + (bad ? ' warn' : ' ok')} role="status" aria-live="polite">{text}</p>
    </div>
  );
}

type Write = (call: () => Promise<Answer>, ok?: string) => Promise<Answer | null>;

/** « Mon barbier »: the chair he prefers, or « Peu importe ». */
function Barber({ me, write }: { me: CardProps['me']; write: Write }) {
  const [staffId, setStaffId] = useState<string | null>(me.prefs.staffId);
  useEffect(() => setStaffId(me.prefs.staffId), [me.prefs.staffId]);
  const pick = async (id: string | null) => {
    setStaffId(id);
    await write(() => api.patch('/api/me/prefs', { staffId: id }));
  };
  if (!me.team.length) return null;
  return (
    <Section k="Mon barbier" guide="profile-barber">
      <p className="c-muted c-small">Ton choix est noté sur ta fiche : le salon sait qui tu préfères.</p>
      <div className="mp-chips" role="group" aria-label="Mon barbier">
        <button type="button" className="mp-chip" aria-pressed={staffId === null} onClick={() => pick(null)}>Peu importe</button>
        {me.team.map((b) => <button key={b.id} type="button" className="mp-chip" aria-pressed={staffId === b.id} onClick={() => pick(b.id)}>{b.name}</button>)}
      </div>
    </Section>
  );
}

/** « Mes infos »: first name, last name, birthday; the number and the e-mail are the salon's to change. */
function Infos({ me, info, write }: { me: CardProps['me']; info: ProfileInfo | null; write: Write }) {
  const [f, setF] = useState({ first: me.first, last: me.last, birthday: birthdayIn(me.birthday) });
  useEffect(() => setF({ first: me.first, last: me.last, birthday: birthdayIn(me.birthday) }), [me.first, me.last, me.birthday]);
  const bday = birthdayOut(f.birthday);
  const bdayOk = birthdayOk(bday);
  // a space opened on a file that may have changed hands writes nothing of it (the server says the same)
  const locked = !!info && !info.canAsk;
  const save = (patch: Record<string, string>) => write(() => api.patch('/api/me/profile', patch));
  const blur = {
    first: () => { const v = f.first.trim(); if (v && v !== me.first) save({ first: v }); else setF((x) => ({ ...x, first: me.first })); },
    last: () => { const v = f.last.trim(); if (v !== me.last) save({ last: v }); },
    // « 14.03 » typed is kept as « 14/03 » once saved (and when it was already the file's)
    birthday: () => { if (!bdayOk) return; setF((x) => ({ ...x, birthday: birthdayIn(bday) })); if (bday !== me.birthday) save({ birthday: bday }); }
  };
  return (
    <Section k="Mes infos" guide="profile-infos">
      {locked ? <p className="c-note">{SALON_ONLY} Le salon vérifie que cette fiche est bien la tienne avant de te laisser la modifier.</p> : (
        <>
          <label className="mp-field" htmlFor="mp-first"><span>Prénom</span>
            <input id="mp-first" className="mp-input" value={f.first} maxLength={40} autoComplete="given-name" onChange={(e) => setF({ ...f, first: e.target.value })} onBlur={blur.first} />
          </label>
          <label className="mp-field" htmlFor="mp-last"><span>Nom</span>
            <input id="mp-last" className="mp-input" value={f.last} maxLength={40} autoComplete="family-name" onChange={(e) => setF({ ...f, last: e.target.value })} onBlur={blur.last} />
          </label>
          <label className="mp-field" htmlFor="mp-bday"><span>Anniversaire (jj/mm)</span>
            <input id="mp-bday" className="mp-input" value={f.birthday} maxLength={5} inputMode="numeric" placeholder="14/03" aria-invalid={!bdayOk} aria-describedby={bdayOk ? undefined : 'mp-bday-err'} autoComplete="off" onChange={(e) => setF({ ...f, birthday: e.target.value })} onBlur={blur.birthday} />
            {bdayOk ? null : <em id="mp-bday-err" className="mp-err" role="alert">Écris le jour puis le mois, par exemple 14/03.</em>}
          </label>
        </>
      )}
      <dl className="mp-known">
        {info?.phone ? <div><dt>Téléphone</dt><dd>{info.phone}</dd></div> : null}
        {info && !locked ? <div><dt>E-mail</dt><dd>{info.email || 'aucun'}</dd></div> : null}
      </dl>
      <p className="c-muted c-small">Changer de numéro ou d’e-mail ? Dis-le au salon.</p>
    </Section>
  );
}

/** « Messages »: the confirmations and reminders, and the offers (with the day he agreed). */
function Messages({ me, write }: { me: CardProps['me']; write: Write }) {
  const [sms, setSms] = useState(me.consent.sms);
  const [marketing, setMarketing] = useState(me.consent.marketing);
  useEffect(() => { setSms(me.consent.sms); setMarketing(me.consent.marketing); }, [me.consent.sms, me.consent.marketing]);
  return (
    <Section k="Messages" guide="profile-messages">
      <Switch on={sms} title="Confirmations et rappels par SMS" hint="Un SMS pour confirmer, un autre la veille pour te rappeler. Coupés, tu ne reçois pas non plus ceux du salon quand il déplace ou annule ton rendez-vous." onChange={(v) => { setSms(v); write(() => api.patch('/api/me/consent', { sms: v })); }} />
      <Switch on={marketing} title="Bons plans par SMS (15 ans et plus)" hint={'Jamais imposé. STOP à tout moment.' + (marketing && me.consent.marketingAt ? ' Accord donné le ' + short(me.consent.marketingAt) : '')} onChange={(v) => { setMarketing(v); write(() => api.patch('/api/me/consent', { marketing: v })); }} />
    </Section>
  );
}

/** « Mes données »: a copy by e-mail, and the request to erase the file. */
function Data({ info, failed, write, say, refresh }: { info: ProfileInfo | null; failed: boolean; write: Write; say: (t: string, bad?: boolean) => void; refresh: () => void }) {
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const head = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) head.current?.focus(); }, [asking]);
  // « Annuler » removes the group the focus was in: it goes back to the link that opened it
  const cancel = () => { setAsking(false); requestAnimationFrame(() => trigger.current?.focus()); };
  const send = async () => {
    setBusy('export');
    const r = await write(() => api.post('/api/me/export'), 'Envoyé');
    // the answer says where it went (« Envoyé à k•••@gmail.com »), or why nothing left and that the salon is told
    if (r && r.message && !r.demo) say(r.message, r.reason === 'noEmail');
    setBusy('');
  };
  const erase = async () => {
    setBusy('erase');
    const r = await write(() => api.post('/api/me/erase-request'), 'Demande envoyée');
    if (r && r.message && !r.demo) say(r.message);
    setAsking(false); refresh(); setBusy('');
  };
  return (
    <Section k="Mes données" guide="profile-data">
      {failed ? (
        <>
          <p className="c-note warn">Je n’arrive pas à charger cette partie. Vérifie ta connexion.</p>
          <button type="button" className="c-btn ghost mp-btn" onClick={refresh}>Réessayer</button>
        </>
      ) : info && !info.canAsk ? <p className="c-note">{SALON_ONLY}</p> : (
        <>
          <p className="c-muted c-small">{info?.email ? 'Tout ce que le salon garde de toi, dans un fichier envoyé à ' + info.email + '.' : 'Tout ce que le salon garde de toi, sur demande.'}</p>
          <button type="button" className="c-btn ghost mp-btn" disabled={busy === 'export' || !info} onClick={send}>Recevoir mes données par e-mail</button>
          {info?.eraseAt ? (
            <p className="c-note ok">Demande d’effacement envoyée le {short(info.eraseAt)} : le salon efface ta fiche sous un mois.</p>
          ) : asking ? (
            <div className="mp-ask" role="group" aria-labelledby="mp-ask-t">
              <p id="mp-ask-t" ref={head} tabIndex={-1} className="mp-ask-t">Effacer ma fiche ?</p>
              <p className="c-muted c-small">Le salon efface ta fiche sous un mois. Tes rendez-vous à venir seront annulés, et ce qui reste sur un carnet ou une carte cadeau sera perdu. Un abonnement en cours se règle d’abord avec le salon.</p>
              <div className="mp-row">
                <button type="button" className="c-btn mp-btn" disabled={busy === 'erase'} onClick={erase}>Envoyer la demande</button>
                <button type="button" className="c-btn ghost mp-btn" onClick={cancel}>Annuler</button>
              </div>
            </div>
          ) : (
            <button ref={trigger} type="button" className="c-link mp-link" disabled={!info} onClick={() => setAsking(true)}>Demander l’effacement</button>
          )}
        </>
      )}
    </Section>
  );
}
