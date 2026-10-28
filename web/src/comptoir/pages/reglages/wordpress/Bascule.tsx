// Jour J, guided (Réglages › Reprendre WordPress › Jour J): the ten steps of the cut-over day in the order they happen, each
// ticked from what the server can check (GET /api/v1/bascule: the journal, the DNS, the old addresses, the parked site) or
// from the owner's word where only WordPress and IONOS know. Nothing here changes DNS or WordPress. Until « Ouvrir les envois »
// the salon sends no text to a client (server/http/scheduler.js); the return plan below is for a switch that goes wrong.
import { useState, type ReactNode } from 'react';
import { api, qs } from '../../../../lib/api';
import { plural } from '../../../../lib/format';
import { prime, refreshAll, useQuery } from '../../../../lib/query';
import { Icon } from '../../../../ui/Icon';
import { Button, Note, Skeleton, confirm, toast, toastError } from '../../../../ui/kit';
import './bascule.css';

type State = 'ok' | 'todo' | 'warn' | 'err' | 'info';
type Step = { id: string; state: State; line: string; at?: number; field?: string };
type Data = { steps: Step[]; hold: { on: boolean; queued: number }; since: { at: number; count: number }; domain: string; demo: boolean };

const KEY = 'lx-domain';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const remember = (d: string) => { try { if (d) localStorage.setItem(KEY, d); else localStorage.removeItem(KEY); } catch { /* private window */ } };
const WORD: Record<State, string> = { ok: 'fait', todo: 'à faire', warn: 'à vérifier', err: 'en panne', info: 'plus tard' };
const BADGE: Record<State, string> = { ok: ' badge-ok', todo: '', warn: ' badge-warn', err: ' badge-danger', info: ' badge-info' };

/** The file drop of the same page: the final sync is the same gesture as the first one. */
function toDrop() {
  const drop = document.querySelector<HTMLElement>('.wp-drop');
  if (!drop) return;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  drop.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  drop.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
}

/** What the day depends on beyond this card (docs/operations.md, « Avant d’ouvrir les envois »). */
const BEFORE = [
  '« Payé sur l’ancien site » est prêt à la caisse, pour les acomptes déjà réglés sur WordPress.',
  'L’espace client et les Relances auto restent éteints jusqu’à la bascule.',
  'Ce que le client demande lui-même (un code, un lien) et les messages d’un contrat partent même avant la bascule.',
  'La fidélité se lance après la synchro finale.',
  'Une fiche reprise de WordPress reste protégée jusqu’à sa première visite ici.',
  'Une fiche jamais informée reçoit la ligne sur ses données dans son premier SMS de service.'
];

type Row = { id: string; title: string; sub?: ReactNode; go?: ReactNode; extra?: ReactNode };

export function Bascule() {
  const [domain, setDomain] = useState(read);
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [force, setForce] = useState<string | null>(null);
  // the browser's memory is a fallback the server uses only when nothing else names the domain
  const key = '/api/v1/bascule' + qs({ remembered: domain });
  const { data, error, loading } = useQuery<Data>(key);

  /** One gesture at a time; the screens that read the same facts (Mise en route, Santé) follow. */
  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    try { await fn(); if (done) toast({ title: done, icon: 'check' }); refreshAll(); } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  const tick = (item: string, done = true) => act(item, () => api.post('/api/v1/bascule/tick', { item, done }));
  /** « Vérifier »: asks the network again, with the domain typed. */
  const verify = (d: string) => act('verify', async () => {
    const next = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const k = '/api/v1/bascule' + qs({ domain: next });
    const fresh = await api.get<Data>(k + (next ? '&' : '?') + 'refresh=1');
    remember(next); setDomain(next); setTyped(null);
    prime('/api/v1/bascule' + qs({ remembered: next }), fresh);
  });
  const freeze = () => act('freeze', () => api.post('/api/v1/bascule/freeze', {}).catch((e) => {
    // already frozen (a retry, another screen): only the reminders are left to tick
    if (e && e.code === 'frozen') return api.post('/api/v1/bascule/tick', { item: 'reminders-off', done: true });
    throw e;
  }), 'WordPress est noté comme bloqué');
  const open = async (reason?: string) => {
    const ok = await confirm({
      title: 'Ouvrir les envois ?', ok: 'Ouvrir les envois',
      body: 'Dès maintenant, le salon envoie ses rappels et ses messages aux clients. Les messages qui attendent partent, sauf ceux de plus de 6 h.'
    });
    if (ok) await act('switch', () => api.post('/api/v1/bascule/switch', reason ? { force: true, reason } : {}), 'Les envois sont ouverts');
  };

  if (loading && !data) return <section className="card jj" aria-label="Jour J"><Skeleton h={22} w="30%" /><Skeleton h={220} r={16} /></section>;
  if (!data) return <section className="card jj" aria-label="Jour J"><Note tone="err" icon="alert">{error?.message || 'Le serveur ne répond pas.'}</Note></section>;

  const by = Object.fromEntries(data.steps.map((x) => [x.id, x])) as Record<string, Step>;
  const st = (id: string): Step => by[id] || { id, state: 'info', line: '' };
  const switched = st('switch').state === 'ok';
  const ready = st('freeze').state === 'ok' && st('final-sync').state === 'ok';
  // why « Ouvrir les envois » is greyed out, in words
  const waits = st('freeze').state !== 'ok' ? 'Dis d’abord que WordPress est bloqué (étape 2).' : st('final-sync').state === 'err' ? 'Coupe la réservation en ligne sur WordPress, puis refais la synchro finale (étape 3).' : st('final-sync').state !== 'ok' ? 'Fais d’abord la synchro finale, après le blocage (étape 3).' : '';
  const done = (id: string) => st(id).state === 'ok';
  const text = typed ?? data.domain;

  const rows: Row[] = [
    { id: 'first-run', title: 'Premier passage' },
    {
      id: 'freeze', title: 'Bloque les réservations sur WordPress et coupe ses rappels',
      sub: 'Salon Booking › Réglages : réservation en ligne désactivée, rappels SMS et e-mail coupés.',
      go: !done('freeze') && !switched ? <Button variant="primary" icon="check" busy={busy === 'freeze'} onClick={freeze}>C’est fait</Button> : undefined,
      // the freeze also notes the reminders as cut; only a freeze noted another way leaves them to say
      extra: done('freeze') && !done('reminders-off')
        ? <div className="jj-after"><span>{st('reminders-off').line}</span><Button variant="subtle" icon="check" busy={busy === 'reminders-off'} onClick={() => tick('reminders-off')}>Rappels coupés</Button></div> : undefined
    },
    {
      id: 'final-sync', title: 'Synchro finale',
      go: !switched && (!done('final-sync') || st('final-sync').state === 'err') ? <Button variant={st('freeze').state === 'ok' ? 'primary' : 'subtle'} icon="download" onClick={toDrop}>Synchroniser</Button> : undefined
    },
    {
      id: 'cold-backup', title: 'Copie complète de l’ancien site',
      sub: 'Chez IONOS : la base (phpMyAdmin › Exporter) et le dossier wp-content (SFTP). Range-la chiffrée hors ligne, efface-la dans 12 mois.',
      go: !done('cold-backup') ? <Button variant="subtle" icon="check" busy={busy === 'cold-backup'} onClick={() => tick('cold-backup')}>C’est fait</Button> : undefined
    },
    {
      id: 'dns', title: 'Domaine',
      extra: (
        <form className="jj-domain" onSubmit={(e) => { e.preventDefault(); void verify(text); }}>
          <label htmlFor="jj-domain">Ton domaine</label>
          <input id="jj-domain" className="input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="barberlarchitecte.com" value={text} onChange={(e) => setTyped(e.target.value)} />
          <Button type="submit" variant="subtle" icon="globe" busy={busy === 'verify'}>Vérifier</Button>
        </form>
      )
    },
    {
      id: 'redirects', title: 'Anciennes adresses',
      go: <Button variant="subtle" icon="link" busy={busy === 'verify'} onClick={() => void verify(text)}>Vérifier</Button>
    },
    {
      id: 'ancien', title: 'Ancien site garé',
      sub: st('ancien').state === 'warn' || st('ancien').state === 'todo' ? 'Dans WordPress, Réglages › Lecture : « Demander aux moteurs de recherche de ne pas indexer ce site ».' : undefined,
      go: st('ancien').state === 'warn' ? <Button variant="subtle" icon="check" busy={busy === 'ancien-noindex'} onClick={() => tick('ancien-noindex')}>C’est fait</Button> : undefined
    },
    {
      id: 'switch', title: 'Bascule faite',
      sub: switched ? undefined : data.hold.on ? 'Tant que les envois sont fermés, aucun SMS ni e-mail ne part vers un client. Ceux que le client a demandés (code, lien) partent quand même.' : undefined,
      go: !switched ? <Button variant="primary" icon="sms" busy={busy === 'switch'} disabled={!ready} aria-describedby={waits ? 'jj-waits' : undefined} onClick={() => void open()}>Ouvrir les envois</Button> : undefined,
      extra: !switched ? (
        <>
          {waits ? <p id="jj-waits" className="jj-sub">{waits}</p> : null}
          <div className="jj-before">
            <b id="jj-before">Avant d’ouvrir les envois</b>
            <ul aria-labelledby="jj-before">{BEFORE.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          {force === null
          ? <button type="button" className="jj-link" onClick={() => setForce('')}>La synchro finale est impossible ? Forcer la bascule</button>
          : (
            <form className="jj-force" onSubmit={(e) => { e.preventDefault(); void open(force.trim()); }}>
              <label htmlFor="jj-reason">Pourquoi forcer la bascule ?</label>
              <input id="jj-reason" className="input" maxLength={200} value={force} onChange={(e) => setForce(e.target.value)} placeholder="Ex. l’hébergeur bloque les exports" />
              <Button type="submit" variant="danger" busy={busy === 'switch'} disabled={!force.trim()}>Ouvrir quand même</Button>
              <Button variant="ghost" onClick={() => setForce(null)}>Annuler</Button>
            </form>
          )}
        </>
      ) : undefined
    },
    {
      id: 'app-password', title: 'Mot de passe d’application révoqué',
      sub: 'Le lendemain : WordPress › Utilisateurs › ton profil › Mots de passe d’application.',
      go: switched && !done('app-password') ? <Button variant="subtle" icon="check" busy={busy === 'app-password'} onClick={() => tick('app-password')}>C’est fait</Button> : undefined
    },
    {
      id: 'licences', title: 'Licences et hébergement résiliés',
      sub: 'Une fois la copie de l’ancien site rangée. Garde le domaine et la boîte mail chez IONOS.',
      go: switched && !done('licences') ? <Button variant="subtle" icon="check" busy={busy === 'licences'} onClick={() => tick('licences')}>C’est fait</Button> : undefined,
      extra: done('licences') && !done('ancien-removed')
        ? <div className="jj-after"><span>{st('ancien-removed').line}</span><Button variant="subtle" icon="check" busy={busy === 'ancien-removed'} onClick={() => tick('ancien-removed')}>Sous-domaine supprimé</Button></div> : undefined
    }
  ];
  // the step the owner is on: the first one that is neither done nor for later
  // (once the sends are open, the steps before it are behind: forced or not, they are no longer « now »)
  const current = rows.slice(switched ? rows.findIndex((r) => r.id === 'switch') + 1 : 0).find((r) => st(r.id).state !== 'ok' && st(r.id).state !== 'info')?.id;
  const shownLine = (r: Row) => {
    const s = st(r.id);
    if (r.id === 'licences' && done('ancien-removed')) return s.line + ' ' + st('ancien-removed').line;
    return s.line;
  };

  return (
    <section className="card col jj" style={{ gap: 14 }} aria-label="Jour J" data-guide="wp-jourj">
      <div className="card-h"><h2><Icon name="bolt" size={16} />Jour J</h2>{data.demo ? <span className="badge badge-info">démo</span> : null}</div>
      <p className="muted jj-intro">Les dix étapes du jour de la bascule, dans l’ordre. Les coches viennent de ce que le Comptoir peut vérifier ; le reste, c’est toi qui le dis. Rien ici ne touche à WordPress ni aux DNS.</p>
      {data.hold.on ? <Note icon="lock">Avant la bascule, le salon n’envoie aucun SMS ni e-mail à un client : WordPress envoie encore les siens.{data.hold.queued ? ' ' + data.hold.queued + (data.hold.queued > 1 ? ' messages attendent' : ' message attend') + ' la bascule.' : ''}</Note> : null}
      <ol className="jj-list" aria-label="Les étapes du jour J">
        {rows.map((r, i) => {
          const s = st(r.id);
          return (
            <li key={r.id} className={'jj-step ' + s.state + (r.id === current ? ' now' : '')} data-step={r.id} data-state={s.state} aria-current={r.id === current ? 'step' : undefined}>
              <span className="jj-n" aria-hidden>{s.state === 'ok' ? <Icon name="check" size={16} /> : s.state === 'warn' || s.state === 'err' ? <Icon name="alert" size={16} /> : i + 1}</span>
              <div className="jj-main">
                <div className="jj-t"><b>{r.title}</b><span className={'badge' + BADGE[s.state]}>{data.demo && s.state === 'info' ? 'démo' : WORD[s.state]}</span></div>
                {shownLine(r) ? <p className="jj-line">{shownLine(r)}</p> : null}
                {r.sub && s.state !== 'ok' ? <p className="jj-sub">{r.sub}</p> : null}
                {r.extra}
              </div>
              {r.go ? <div className="jj-go">{r.go}</div> : null}
            </li>
          );
        })}
      </ol>
      <details className="jj-back">
        <summary>Plan de retour</summary>
        <div className="col" style={{ gap: 10 }}>
          <p>Si le site ne répond pas ou que les réservations échouent et que ce n’est pas réglé en une heure :</p>
          <ol className="jj-back-steps">
            <li>Ton prestataire remet chez IONOS les valeurs notées à J-2 : <code>A</code> et <code>AAAA</code> de <code>@</code>, <code>CNAME</code> de <code>www</code>. Avec le TTL à 300 s, l’ancien site revient en quelques minutes.</li>
            <li>Il remet les deux adresses de WordPress à <code>https://barberlarchitecte.com</code> et décoche la case d’indexation.</li>
            <li>Il retire <code>SMS_PROVIDER</code>, <code>EMAIL_FROM</code> et <code>PUBLIC_URL</code> du nouveau salon et redéploie : plus rien ne part d’ici.</li>
            <li><b>Remets WordPress en route : réservation en ligne et rappels.</b></li>
            <li>Saisis dans WordPress les rendez-vous pris ici depuis son blocage, puis on recommence un autre lundi.</li>
          </ol>
          <div className="row jj-back-acts">
            <a className="btn btn-subtle" href="/api/v1/bascule/since" download><Icon name="download" />Télécharger les rendez-vous pris ici depuis le blocage de WordPress (CSV)</a>
            <span className="faint">{data.since.at ? (data.since.count ? plural(data.since.count, 'rendez-vous') + ' à saisir dans WordPress' : 'Aucun rendez-vous pris ici depuis le blocage') : 'La liste commence au blocage de WordPress.'}</span>
          </div>
        </div>
      </details>
    </section>
  );
}
