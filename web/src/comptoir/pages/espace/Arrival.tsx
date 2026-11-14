// FEATURE C · « Le client est là ? ». The server puts the question in the pulse (arrivals, server/domain/arrival.js) at
// the start of each of his bookings, and again 10 minutes later while nothing happened. The band shows it wherever he is
// in the Comptoir; Mon espace shows it as a card at the top instead. A new question (or the second ask) buzzes once.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { refreshAll } from '../../../lib/query';
import { buzz } from '../../../lib/hooks';
import { time } from '../../../lib/format';
import { Icon } from '../../../ui/Icon';
import { Button, toast, toastError } from '../../../ui/kit';
import { useApp } from '../../state';
import './arrival.css';

export type Arrival = { id: string; name: string; start: number; services: string[]; ask: number; again: boolean };
type Answer = 'here' | 'later' | 'absent';

/** The questions of the last pulse, minus the ones answered on this phone while the next pulse is on its way. */
export function useArrivals() {
  const { pulse } = useApp();
  const list = ((pulse as unknown as { arrivals?: Arrival[] } | null)?.arrivals) || [];
  const [gone, setGone] = useState<Record<string, true>>({});
  return { list: list.filter((a) => !gone[a.id + ':' + a.ask]), hide: (a: Arrival) => setGone((g) => ({ ...g, [a.id + ':' + a.ask]: true })) };
}

const DONE: Record<Answer, (n: string) => string> = { here: (n) => n + ' est arrivé', later: () => 'On te redemande dans 10 min', absent: (n) => n + ' marqué absent' };

/** One question with its three answers. */
function Ask({ a, onAnswered, inline }: { a: Arrival; onAnswered: (a: Arrival) => void; inline?: boolean }) {
  const { offline } = useApp();
  const [busy, setBusy] = useState<Answer | ''>('');
  const first = a.name.split(' ')[0];
  const answer = async (x: Answer) => {
    setBusy(x);
    try {
      await api.post('/api/v1/appointments/' + a.id + '/arrival', { answer: x });
      onAnswered(a);
      toast({ title: DONE[x](first), icon: 'check' });
      refreshAll();
    } catch (e) { toastError(e); } finally { setBusy(''); }
  };
  return (
    <div className={'es-ask' + (inline ? ' inline' : '')} role="alertdialog" aria-label={'Le client est là ? ' + a.name} data-arrival={a.id}>
      <p className="es-ask-q"><Icon name="bell" size={16} /><span><b>{a.name} est là ?</b><small>{time(a.start)} · {a.services.join(' + ')}{a.again ? ' · on te redemande' : ''}</small></span></p>
      <div className="es-ask-acts">
        <Button variant="primary" icon="check" busy={busy === 'here'} disabled={offline || !!busy} onClick={() => answer('here')}>Il est là</Button>
        <Button variant="subtle" busy={busy === 'later'} disabled={offline || !!busy} onClick={() => answer('later')}>Pas encore</Button>
        <Button variant="ghost" icon="x" busy={busy === 'absent'} disabled={offline || !!busy} onClick={() => answer('absent')}>Absent</Button>
      </div>
    </div>
  );
}

/** The questions as a card list (Mon espace). */
export function ArrivalCards() {
  const { list, hide } = useArrivals();
  if (!list.length) return null;
  return <section className="es-asks" aria-label="Le client est là ?">{list.map((a) => <Ask key={a.id + ':' + a.ask} a={a} onAnswered={hide} inline />)}</section>;
}

/** The band of the Comptoir's shell: on every page but Mon espace (which shows the cards), and the buzz of a new question. */
export function ArrivalBand({ page }: { page: string }) {
  const { boot } = useApp();
  const { list, hide } = useArrivals();
  const seen = useRef<Set<string>>(new Set());
  const keys = list.map((a) => a.id + ':' + a.ask).join(',');
  useEffect(() => {
    const fresh = list.filter((a) => !seen.current.has(a.id + ':' + a.ask));
    for (const a of list) seen.current.add(a.id + ':' + a.ask);
    if (fresh.length && boot.me.prefs?.buzz !== false) buzz([30, 80, 30]);
  }, [keys]);
  if (!boot.me.chair || page === 'espace' || !list.length) return null;
  return <div className="es-askband" role="region" aria-label="Le client est là ?">{list.map((a) => <Ask key={a.id + ':' + a.ask} a={a} onAnswered={hide} />)}</div>;
}

/** What the desk reads on the agenda (GET /api/v1/agenda adds `arrival` to today's started bookings), or ''. */
export function arrivalWords(x: { arrival?: { ask: number; due: boolean; later: number | null } | null } | null | undefined): string {
  const q = x && x.arrival;
  if (!q) return '';
  if (q.later != null) return 'Barbier : « Pas encore » à ' + time(q.later) + (q.due ? ', redemandé' : ', redemandé à ' + time(q.ask));
  return 'Demandé au barbier à ' + time(q.ask) + ' : pas de réponse';
}
