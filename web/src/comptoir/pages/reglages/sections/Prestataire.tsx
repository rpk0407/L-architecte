// « Accès prestataire » (server/commands/support.js): the owner lets the person who set the salon up work in his
// Comptoir for 24 hours, without giving his password. The prestataire sends a link (…/reglages/prestataire?demande=…)
// or the request itself; the owner checks the code both read, types his password, and may remove the access at any time.
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { refreshAll, useQuery } from '../../../../lib/query';
import { setQuery, useRoute } from '../../../../lib/router';
import { clock, dates } from '../../../../lib/format';
import { Icon } from '../../../../ui/Icon';
import { Button, Empty, Field, Note, Skeleton, confirm, toast, toastError } from '../../../../ui/kit';
import { useApp } from '../../../state';

type Access = { id: string; at: number; exp: number; label: string; code: string; current: boolean };
const day = (ms: number) => dates.dayShort(dates.localParts(ms).day);
const codeOf = (h: string) => (h.slice(0, 4) + '-' + h.slice(4, 8)).toUpperCase();
/** the 64 signs of a request, from a pasted link or from the request alone */
const demandeOf = (v: string) => { const m = /[a-f0-9]{64}/i.exec(v.trim()); return m ? m[0].toLowerCase() : ''; };

export default function Prestataire() {
  const { boot } = useApp();
  const route = useRoute();
  const { data, loading } = useQuery<{ hours: number; items: Access[] }>('/api/v1/support');
  const [pasted, setPasted] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const demande = demandeOf(route.query.get('demande') || '') || demandeOf(pasted);
  const hours = data?.hours ?? 24;
  const owner = boot.me.role === 'owner';

  const accept = async () => {
    setErr(''); setBusy(true);
    try {
      await api.post('/api/v1/support', { demande, password });
      toast({ title: 'Accès ouvert pour ' + hours + ' h', sub: 'Tu peux le retirer ici à tout moment.', icon: 'shieldOk' });
      setPassword(''); setPasted(''); setQuery({ demande: null }); refreshAll();
    } catch (e) { setErr((e as Error).message || 'Impossible d’ouvrir l’accès.'); } finally { setBusy(false); }
  };
  const remove = async (g: Access) => {
    if (!await confirm({ title: 'Retirer cet accès ?', body: 'Le prestataire ne peut plus rien faire dans ton Comptoir, tout de suite.', ok: 'Retirer', danger: true })) return;
    try { await api.del('/api/v1/support/' + g.id); toast('Accès retiré'); refreshAll(); } catch (e) { toastError(e); }
  };

  if (!owner) return <Note>Seul le gérant ouvre un accès prestataire.</Note>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card col" style={{ gap: 12 }} data-guide="prestataire-main">
        <div className="card-h"><h2><Icon name="shield" size={16} />Laisser ton prestataire travailler dans ton Comptoir</h2></div>
        <p className="muted" style={{ fontSize: 14 }}>
          Pour qu’il remplisse le salon à ta place (mentions légales, horaires, reprise de l’ancien site) sans que tu lui donnes ton mot de passe.
          L’accès dure {hours} heures, s’arrête tout seul, et tu le retires quand tu veux. Tout ce qu’il fait est écrit « Prestataire » dans le journal d’activité.
        </p>
        <p className="faint" style={{ fontSize: 13 }}>Il ne peut toucher ni aux mots de passe, ni aux codes de l’équipe, ni aux appareils, ni effacer un client.</p>
        {!demande ? (
          <Field label="La demande de ton prestataire" htmlFor="sp-d" hint="Ouvre le lien qu’il t’a envoyé, ou colle-le ici.">
            <input id="sp-d" className="input" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://…/comptoir/reglages/prestataire?demande=…" autoComplete="off" />
          </Field>
        ) : (
          <>
            <Note>
              Code de la demande : <b className="tnum" style={{ fontSize: 18, letterSpacing: 1 }}>{codeOf(demande)}</b><br />
              Vérifie que ton prestataire t’annonce le même code. S’il est différent, n’accepte pas.
            </Note>
            <Field label="Ton mot de passe, pour confirmer" htmlFor="sp-p" error={err || null}>
              <input id="sp-p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && password) void accept(); }} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" icon="check" busy={busy} disabled={!password} onClick={accept}>Autoriser pendant {hours} h</Button>
              <Button variant="ghost" onClick={() => { setPasted(''); setPassword(''); setErr(''); setQuery({ demande: null }); }}>Refuser</Button>
            </div>
          </>
        )}
      </section>
      <section className="card">
        <div className="card-h"><h2><Icon name="shieldOk" size={16} />Accès ouverts</h2></div>
        {loading && !data ? <Skeleton h={80} /> : !data?.items.length ? <Empty icon="shield" title="Aucun accès ouvert">Personne d’autre que ton équipe n’entre dans ton Comptoir.</Empty> : (
          <ul className="list">{data.items.map((g) => (
            <li key={g.id} className="li">
              <span className="rg-dev"><Icon name="shield" size={18} /></span>
              <span className="li-main"><b>{g.label} · code {g.code}</b><span className="muted" style={{ fontSize: 13 }}>Ouvert {day(g.at)} à {clock(g.at)}, jusqu’à {day(g.exp)} à {clock(g.exp)}</span></span>
              <Button size="sm" variant="ghost" icon="trash" onClick={() => remove(g)}>Retirer</Button>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
