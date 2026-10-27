// AC-02 · What the salon sees of a client's space, in the client's file: is there one, since when, last seen, which barber
// he prefers, whether he asked to be erased; and what it can do about it: text him the way in, sign his devices out, free a
// number that changed hands. Collapsed: the file stays short; a request to erase shows in the header whatever its state.
import { useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll, useQuery } from '../../../lib/query';
import { ago, dates, plural } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, Note, confirm, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import './account.css';

/** GET /api/v1/clients/:id/account (server/http/routes-me.js accountView) */
type AccountData = { has: false } | { has: true; since: number; lastAt: number; count: number; fenced: boolean; historyFrom: string | null; named: boolean; prefs: { staffId: string | null }; eraseAt: number };

const short = (ms: number) => { const p = dates.localParts(ms); return p.d + ' ' + dates.MONTHS_SH[p.m - 1]; };

export default function AccountCard({ c }: { c: { id: string; hasPhone: boolean; erased: boolean } }) {
  const { boot, can, staffById } = useApp();
  const { data, error } = useQuery<AccountData>(c.erased ? null : '/api/v1/clients/' + c.id + '/account');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const enabled = !!boot.settings?.accounts?.enabled;
  // a role that cannot read files gets a 403: nothing to show, nothing to explain
  if (c.erased || error || !data) return null;
  const a = data.has ? data : null;
  // closed and nobody has one: nothing to say about this file (Réglages › Réservation holds the switch)
  if (!a && !enabled) return null;

  const run = async (key: string, path: string, done: string) => {
    setBusy(key);
    try { await api.post(path, {}); toast({ title: done, icon: 'check' }); refreshAll(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const invite = async () => {
    setBusy('invite');
    try {
      const r = await api.post<{ sent: boolean }>('/api/v1/clients/' + c.id + '/account/invite', {});
      toast({ title: r.sent ? 'Envoyé · 3 liens au plus par jour' : 'Pas envoyé : vérifie le numéro de la fiche', icon: r.sent ? 'check' : 'info' });
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const revoke = async () => {
    if (await confirm({ title: 'Déconnecter ses appareils ?', body: 'Son espace se ferme sur tous ses téléphones. Il se reconnecte avec un code par SMS.', ok: 'Déconnecter' })) run('revoke', '/api/v1/clients/' + c.id + '/account/revoke', 'Appareils déconnectés');
  };
  const detach = async () => {
    if (await confirm({ title: 'Détacher ce numéro ?', body: 'Le numéro quitte cette fiche et son espace se ferme. Le prochain qui réserve avec ce numéro aura une fiche neuve.', ok: 'Détacher', danger: true })) run('detach', '/api/v1/clients/' + c.id + '/detach-phone', 'Numéro détaché');
  };

  const pref = a?.prefs?.staffId ? staffById.get(a.prefs.staffId)?.name : '';
  const id = 'ac-' + c.id;
  return (
    <div className="card ac" data-guide="client-account">
      <button type="button" className="ac-h" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="user" size={16} />
        <b className="grow">Espace client</b>
        {a?.eraseAt ? <span className="badge badge-warn">Effacement demandé</span> : null}
        {a ? <span className="badge badge-ok">Ouvert</span> : <span className="faint">Pas d’espace client</span>}
        <Icon name={open ? 'chevU' : 'chevD'} size={16} />
      </button>
      {open ? (
        <div id={id} className="ac-b col" style={{ gap: 10 }}>
          {a ? (
            <>
              <p className="ac-line">Ouvert le {short(a.since)} · vu {ago(a.lastAt)} · {plural(a.count, 'connexion')}</p>
              {pref ? <p className="ac-line">Préfère {pref}</p> : null}
              {a.eraseAt ? <Note tone="warn" icon="alert">Effacement demandé le {short(a.eraseAt)}. À traiter sous un mois : menu ⋯ › Effacer.</Note> : null}
              {a.fenced ? <Note tone="warn" icon="alert">Ouvert sur une fiche inactive : vérifie que c’est la même personne.</Note> : null}
              {!enabled ? <p className="ac-line faint">L’espace client est fermé pour le moment (Réglages › Réservation).</p> : null}
            </>
          ) : null}
          <div className="ac-acts">
            {can('client.edit') && enabled && c.hasPhone ? <Button icon="sms" busy={busy === 'invite'} onClick={invite} data-guide="client-account-invite">Envoyer le lien de son espace</Button> : null}
            {a && can('client.edit') ? <Button icon="lock" busy={busy === 'revoke'} onClick={revoke} data-guide="client-account-revoke">Déconnecter ses appareils</Button> : null}
            {a && can('agenda.edit') ? <Button variant="ghost" busy={busy === 'detach'} onClick={detach} data-guide="client-account-detach">Numéro réattribué ? Détacher ce numéro</Button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
