// Mon espace: a barber's home on his phone. His next client with what was written about the cut, his day, his gaps and his
// figures, in cards he orders himself (Personnaliser). The cards are the files of ./espace/cards (espace/registry.ts).
import { useEffect, useState } from 'react';
import { refreshAll, useQuery } from '../../lib/query';
import { useInterval, useMedia } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { cap, dates, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Avatar, Button, Empty, Skeleton, Stale } from '../../ui/kit';
import { photoOf, useApp, useMaskedAmounts } from '../state';
import { PageTitle } from '../App';
import type { EspaceData, EspaceNow, NoteTarget } from '../types';
import { orderedCards } from './espace/registry';
import { Customize } from './espace/Customize';
import { CutNoteSheet } from './espace/CutNoteSheet';
import './espace.css';

/** Where he stands, in the words of the chip under his name: « Au fauteuil · Karim B. », « Libre jusqu’à 15 h 30 »… */
export function statusWords(n: EspaceNow): { text: string; tone: 'ok' | 'accent' | 'warn' | '' } {
  if (n.status === 'free') return { text: 'Libre jusqu’à ' + time(n.until), tone: 'ok' };
  if (n.status === 'busy') {
    if ('label' in n) return { text: 'Occupé · ' + (n.label || 'pause') + ' jusqu’à ' + time(n.until), tone: '' };
    if (n.phase === 'chair') return { text: 'Au fauteuil · ' + n.with, tone: 'accent' };
    return n.phase === 'arrived' ? { text: n.with + ' est arrivé', tone: 'ok' } : { text: n.with + ' est attendu', tone: 'warn' };
  }
  if (n.kind === 'before' && n.until != null) return { text: 'Ta journée commence à ' + time(n.until), tone: '' };
  if (n.kind === 'break' && n.until != null) return { text: 'Pause jusqu’à ' + time(n.until), tone: '' };
  if (n.kind === 'after') return { text: 'Ta journée est finie', tone: '' };
  return { text: 'Tu ne travailles pas aujourd’hui', tone: '' };
}

/** The amounts of a shared salon post start hidden; a tap on the eye shows them for 30 seconds. */
const REVEAL_MS = 30000;

export default function Espace() {
  const app = useApp();
  const { boot, offline } = app;
  // two columns as soon as the tablet in portrait has room for them (the rail leaves ~900 px)
  const wide = useMedia('(min-width: 900px)');
  // no chair, no page: the desk is told so without asking the server for what it would refuse
  const { data, error, loading, refresh } = useQuery<EspaceData>(boot.me.chair ? '/api/v1/espace' : null);
  const [noting, setNoting] = useState<NoteTarget | null>(null);
  const [custom, setCustom] = useState(false);
  const masked = useMaskedAmounts();
  const [shown, setShown] = useState(false);
  useEffect(() => { if (!shown) return; const t = window.setTimeout(() => setShown(false), REVEAL_MS); return () => clearTimeout(t); }, [shown]);
  // the clock moves without the journal moving (a client gets late, a gap closes): the page asks again every minute
  useInterval(() => { void refresh(); }, 60000);
  const reload = async () => { refreshAll(); await refresh(); };

  const me = boot.me;
  const today = app.pulse?.today || boot.today;
  const cards = orderedCards(me.prefs, me.chair).filter((c) => !c.hidden);
  const status = data?.now ? statusWords(data.now) : null;

  return (
    <div className="es" data-masked={masked && !shown ? '1' : undefined}>
      <PageTitle><h1>Mon espace</h1></PageTitle>
      <header className="es-head" data-guide="espace.entete">
        <Avatar name={me.name} initials={me.initials} color={me.color} photo={photoOf(me)} size="lg" />
        <div className="grow">
          <h2>Salut {me.name}</h2>
          <p className="muted">{cap(dates.dayLong(today))}</p>
        </div>
      </header>
      <div className="es-state">
        {status ? <span className={'es-status' + (status.tone ? ' ' + status.tone : '')} data-guide="espace.statut" role="status"><i aria-hidden />{status.text}</span> : null}
        {offline ? <Stale at={app.pulseAt} now={Date.now()} /> : null}
        {masked ? (
          <button type="button" className="es-eye" aria-pressed={shown} aria-label={shown ? 'Masquer les montants de mon espace' : 'Afficher les montants de mon espace pendant 30 secondes'} onClick={() => setShown(!shown)}>
            <Icon name={shown ? 'eyeOff' : 'eye'} size={16} />Montants
          </button>
        ) : null}
      </div>

      {!boot.me.chair ? (
        <section className="card"><Empty icon="chair" title="Pas de fauteuil, pas de Mon espace" action={<Link to="/agenda" className="btn btn-subtle">Ouvrir l’agenda</Link>}>Mon espace est pour ceux qui ont un fauteuil.</Empty></section>
      ) : loading ? <div className="col" style={{ gap: 14 }}><Skeleton h={230} r={22} /><Skeleton h={260} r={22} /></div> : error ? (
        <section className="card"><Empty icon="alert" title="Mon espace est indisponible" action={<Button variant="primary" onClick={() => { void refresh(); }}>Réessayer</Button>}>{error.message}</Empty></section>
      ) : data ? (
        <>
          <div className={wide ? 'es-cols' : 'es-col'}>
            {wide ? [cards.slice(0, 2), cards.slice(2)].map((col, i) => (
              <div key={i} className="es-col">{col.map(({ meta, C }) => <C key={meta.id} data={data} reload={reload} note={setNoting} />)}</div>
            )) : cards.map(({ meta, C }) => <C key={meta.id} data={data} reload={reload} note={setNoting} />)}
          </div>
          <div className="es-foot"><Button variant="ghost" icon="edit" onClick={() => setCustom(true)} data-guide="espace.personnaliser">Personnaliser</Button></div>
        </>
      ) : null}
      <CutNoteSheet target={noting} onClose={() => setNoting(null)} onSaved={() => { void reload(); }} />
      <Customize open={custom} onClose={() => setCustom(false)} />
    </div>
  );
}
