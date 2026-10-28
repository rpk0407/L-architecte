// AC-02 · /moi › Profil, last card: leaving. This phone, every phone, or closing the space (the file and its bookings stay
// at the salon). Its own card with the highest order, so that the cards other packages add to Profil (calendar, loyalty,
// install) come above these exit and destructive rows. Found by the folder registry (web/src/moi/registry.ts).
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { MoiCardMeta } from '../types';
import { Section } from '../profile/kit';
import './profile.css';

export const meta = { id: 'session', tab: 'profile', order: 99 } satisfies MoiCardMeta;

export default function Session() {
  const [ask, setAsk] = useState<'' | 'all' | 'close'>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const head = useRef<HTMLParagraphElement>(null);
  const triggers = { all: useRef<HTMLButtonElement>(null), close: useRef<HTMLButtonElement>(null) };
  useEffect(() => { if (ask) head.current?.focus(); }, [ask]);
  // the cookie is gone: start again from the sign-in
  const leave = async (path: string) => {
    setBusy(true); setErr('');
    try { await api.post(path); location.assign('/moi'); } catch (e: any) { setErr(e.message || 'Une erreur est survenue.'); setBusy(false); }
  };
  // « Annuler » removes the group the focus was in: it goes back to the link that opened it
  const cancel = () => {
    const back = ask === 'all' ? triggers.all : triggers.close;
    setAsk('');
    requestAnimationFrame(() => back.current?.focus());
  };
  return (
    <div className="mp">
      <Section k="Mon espace" guide="profile-session">
        <button type="button" className="c-btn ghost mp-btn" disabled={busy} onClick={() => leave('/api/me/signout')}>Se déconnecter</button>
        {err ? <p className="c-note warn" role="alert">{err}</p> : null}
        {ask ? (
          <div className="mp-ask" role="group" aria-labelledby="mp-out-t">
            <p id="mp-out-t" ref={head} tabIndex={-1} className="mp-ask-t">{ask === 'all' ? 'Déconnecter tous mes appareils ?' : 'Supprimer mon espace ?'}</p>
            <p className="c-muted c-small">{ask === 'all' ? 'Ton espace se ferme sur tous tes téléphones, celui-ci compris. Tu te reconnectes avec un code par SMS.' : 'Ton espace disparaît. Ta fiche au salon reste, avec tes rendez-vous : tu peux en rouvrir un quand tu veux.'}</p>
            <div className="mp-row">
              <button type="button" className="c-btn mp-btn" disabled={busy} onClick={() => leave(ask === 'all' ? '/api/me/signout-all' : '/api/me/close')}>{ask === 'all' ? 'Déconnecter' : 'Supprimer mon espace'}</button>
              <button type="button" className="c-btn ghost mp-btn" onClick={cancel}>Annuler</button>
            </div>
          </div>
        ) : (
          <div className="mp-links">
            <button ref={triggers.all} type="button" className="c-link mp-link" onClick={() => setAsk('all')}>Déconnecter tous mes appareils</button>
            <button ref={triggers.close} type="button" className="c-link mp-link" onClick={() => setAsk('close')}>Supprimer mon espace</button>
            <small className="c-muted">Supprimer ton espace garde ta fiche au salon, avec tes rendez-vous.</small>
          </div>
        )}
      </Section>
    </div>
  );
}
