// Messages (« mode téléphone »): the texts to clients that wait for a person, one at a time, on the salon's phone.
// One button opens WhatsApp with the text ready (a wa.me link the server builds); back here, « Envoyé » records it and
// brings the next one, or « Envoyé, suivant » records it and opens the next chat at once: twenty reminders, twenty taps.
// Nothing is sent from here by itself, and nobody a client's choice (messages switched off) or number (no mobile) rules
// out is ever listed: the foot of the page says how many were left out and why.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { refreshAll, useQuery } from '../../lib/query';
import { useInterval } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { dayWord, plural, time } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { Button, Empty, Note, Skeleton, toast, toastError } from '../../ui/kit';
import { useApp } from '../state';
import { PageTitle } from '../App';
import './messages.css';

type Item = {
  id: string; kind: string; template: string; at: number; dueAt: number; client: { id: string; name: string };
  appt: { id: string; day: string; start: number; barber: string } | null; text: string; link: string; error: string;
};
type Hand = {
  items: Item[]; held: number; later: number; left: { optout: number; nomobile: number };
  mode: 'sms' | 'phone' | 'auto'; effective: 'sms' | 'phone' | 'auto'; hold: boolean; all: boolean; demo: boolean;
};

const TONE: Record<string, string> = { Annulation: 'badge-warn', Déplacement: 'badge-info', Rappel: 'badge-accent', 'Rappel du jour': 'badge-accent' };

/** « 2 ont les messages du salon coupés, 1 n’a pas de numéro de portable » */
export function leftWords(l: { optout: number; nomobile: number }): string {
  const parts = [];
  if (l.optout) parts.push(l.optout + (l.optout > 1 ? ' ont' : ' a') + ' les messages du salon coupés');
  if (l.nomobile) parts.push(l.nomobile + (l.nomobile > 1 ? ' n’ont pas' : ' n’a pas') + ' de numéro de portable');
  return parts.join(', ');
}

export default function Messages() {
  const app = useApp();
  const { data, error, refresh } = useQuery<Hand>('/api/v1/messages/hand');
  // the message in hand, and whether its chat was opened (then the buttons ask what happened)
  const [cur, setCur] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  // a reminder becomes due, a booking comes in: the list follows without a tap
  useInterval(() => { void refresh(); }, 30000);
  // back from WhatsApp: the list as it is now (someone else may have sent some from another phone)
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const items = data?.items ?? [];
  const item = items.find((x) => x.id === cur) || items[0] || null;
  const next = item ? items[(items.indexOf(item) + 1) % items.length] : null;
  const after = next && item && next.id !== item.id ? next : null;
  const today = app.pulse?.today || app.boot.today;

  /** Record what happened to the message in hand, then show the next one (`open`: its chat is opening too). */
  const mark = async (m: Item, o: { skip?: boolean; open?: Item | null } = {}) => {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; skipped?: string }>('/api/v1/messages/hand/' + encodeURIComponent(m.id) + '/sent', o.skip ? { skip: true } : {});
      if (!r.ok && r.skipped) toast({ title: 'Message retiré', sub: r.skipped + '.', icon: 'info' });
      else if (!o.skip) setDone((n) => n + 1);
      setCur(o.open ? o.open.id : null);
      setOpened(o.open ? o.open.id : null);
      refreshAll();
      await refresh();
    } catch (e) { toastError(e); void refresh(); } finally { setBusy(false); }
  };

  const title = <PageTitle><h1>Messages</h1></PageTitle>;
  if (!data) return <>{title}{error ? <section className="card"><Empty icon="alert" title="Impossible de charger les messages" action={<Button onClick={() => void refresh()}>Réessayer</Button>}>{error.message}</Empty></section> : <Skeleton h={320} r={22} />}</>;

  const isOpen = !!item && opened === item.id;
  const left = leftWords(data.left);
  const leftN = data.left.optout + data.left.nomobile;
  return (
    <div className="mh" data-guide="messages-main">
      {title}
      <header className="mh-head">
        <p className="mh-count" aria-live="polite"><b>{items.length}</b> {items.length > 1 ? 'messages à envoyer' : 'message à envoyer'}{done ? <span className="faint"> · {plural(done, 'envoyé')}</span> : null}</p>
        <p className="muted">{data.all ? 'Depuis le WhatsApp du salon.' : 'Tes clients seulement.'} Un bouton ouvre WhatsApp avec le message déjà écrit : tu appuies sur Envoyer, tu reviens ici.</p>
      </header>

      {data.hold ? <Note tone="warn" icon="lock">Rien ne part avant la bascule depuis l’ancien site : {data.held ? plural(data.held, 'message') + ' ' + (data.held > 1 ? 'attendent' : 'attend') : 'les messages aux clients attendent'}. L’ancien site envoie encore les siens.</Note> : null}

      {item ? (
        <section className="card mh-card" aria-label={'Message pour ' + item.client.name} data-msg={item.id}>
          <div className="mh-who">
            <span className={'badge ' + (TONE[item.kind] || '')}>{item.kind}</span>
            <b className="ellipsis">{item.client.name}</b>
          </div>
          {item.appt ? <p className="mh-appt"><Icon name="calendar" size={15} />{dayWord(item.appt.day, today)} à {time(item.appt.start)}{item.appt.barber ? ' · ' + item.appt.barber : ''}</p> : null}
          <div className="bubble mh-text"><p>{item.text}</p></div>
          {item.error ? <p className="mh-why faint">L’envoi automatique n’a pas pris ce message : {item.error.replace(/^WhatsApp : /, '')}.</p> : null}
          {!isOpen ? (
            <a className="btn btn-primary btn-lg btn-block" href={item.link} target="_blank" rel="noopener noreferrer" onClick={() => { setCur(item.id); setOpened(item.id); }}><Icon name="sms" />Ouvrir WhatsApp</a>
          ) : (
            <div className="mh-acts">
              {after ? (
                // one tap: this one is recorded and the next chat opens
                <a className={'btn btn-primary btn-lg btn-block' + (busy ? ' is-busy' : '')} href={after.link} target="_blank" rel="noopener noreferrer" aria-disabled={busy || undefined}
                  onClick={(e) => { if (busy) { e.preventDefault(); return; } void mark(item, { open: after }); }}><Icon name="check" />Envoyé, message suivant</a>
              ) : null}
              <Button variant={after ? 'subtle' : 'primary'} size="lg" block busy={busy} icon={after ? undefined : 'check'} onClick={() => void mark(item)}>Envoyé</Button>
              <a className="btn btn-ghost btn-block" href={item.link} target="_blank" rel="noopener noreferrer">Pas parti : rouvrir WhatsApp</a>
            </div>
          )}
          <button type="button" className="link mh-skip" disabled={busy} onClick={() => void mark(item, { skip: true })}>Ne pas envoyer celui-ci</button>
        </section>
      ) : (
        <section className="card">
          <Empty icon="check" title={done ? 'Tout est parti' : 'Rien à envoyer'}>
            {data.hold ? 'Les messages attendent la bascule.' : data.effective === 'phone' ? (data.later ? plural(data.later, 'message') + ' ' + (data.later > 1 ? 'arriveront' : 'arrivera') + ' ici à son heure (les rappels, la veille au soir).' : 'Les confirmations et les rappels arrivent ici dès qu’il y en a.') : 'Les messages aux clients partent tout seuls. Ceux qu’un envoi automatique refuse arrivent ici.'}
          </Empty>
        </section>
      )}

      {items.length > 1 ? (
        <section className="card mh-rest" aria-label="À suivre">
          <p className="section-k">À suivre</p>
          <ul className="list">
            {items.filter((x) => x.id !== item?.id).map((x) => (
              <li key={x.id}>
                <button type="button" className="li" onClick={() => { setCur(x.id); setOpened(null); scrollTo({ top: 0 }); }}>
                  <span className="li-main"><b>{x.client.name}</b><small>{x.kind}{x.appt ? ' · ' + dayWord(x.appt.day, today) + ' à ' + time(x.appt.start) : ''}</small></span>
                  <Icon name="chevR" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mh-foot">
        {leftN ? <p data-left><Icon name="info" size={15} />{plural(leftN, 'client')} d’aujourd’hui et de demain sans message : {left}. Un appel reste possible.</p> : null}
        {items.length && data.later ? <p><Icon name="clock" size={15} />{plural(data.later, 'message')} {data.later > 1 ? 'arriveront' : 'arrivera'} plus tard, à son heure.</p> : null}
        {data.demo ? <p><Icon name="info" size={15} />Démo : les clients et leurs numéros sont inventés. N’envoie rien pour de vrai.</p> : null}
        {app.can('settings') ? <p><Link to="/reglages/messages" className="link">Choisir comment partent les messages</Link></p> : null}
      </footer>
    </div>
  );
}
