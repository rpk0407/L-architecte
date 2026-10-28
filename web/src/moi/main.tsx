// /moi, the client's own space on his phone (AC-03a): what is next, his visits and receipts, what he holds, in the look
// of the client pages (/r/). Three tabs; each shows the cards its folder holds (registry.ts), so other areas add a card
// by adding a file. Signed out (or the space closed by the salon), it is the sign-in. GET /api/me/home is read once, again
// when the phone comes back to the page, and after every action a card reports through reload().
import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type ApiError } from '../lib/api';
import { Icon } from '../ui/Icon';
import { tabCards } from './registry';
import { PATHS, safeNext, tabOf, type Tab } from './paths';
import { SignIn } from './SignIn';
import { Guard, dayWords, todayKey } from './kit';
import type { AccountState, Me } from './types';
import '../client/client.css';
import './moi.css';

const TAB_WORDS: Record<Tab, { label: string; icon: string; title: string }> = {
  home: { label: 'Rendez-vous', icon: 'calendar', title: 'Mon espace' },
  history: { label: 'Historique', icon: 'clock', title: 'Historique' },
  profile: { label: 'Profil', icon: 'user', title: 'Profil' }
};

function Shell({ children, tab, onTab }: { children: ReactNode; tab?: Tab; onTab?: (t: Tab) => void }) {
  return (
    <div className={'c-page m-page' + (tab ? ' m-tabbed' : '')}>
      <header className="c-top m-top">
        <a href="/" className="c-brand"><b>L’Architecte</b><small>Barber · Marseille</small></a>
        {tab ? <a className="m-book" href="/?reserver">Réserver</a> : null}
      </header>
      <main className="c-main" id="main">{children}</main>
      <footer className="c-foot"><a href="/">barberlarchitecte.com</a> · <a href="/confidentialite">Confidentialité</a></footer>
      {tab && onTab ? (
        <nav className="m-tabs" aria-label="Mon espace" data-guide="moi.tabs">
          {(Object.keys(PATHS) as Tab[]).map((t) => (
            <a key={t} href={PATHS[t]} aria-current={t === tab ? 'page' : undefined} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onTab(t); }}>
              <Icon name={TAB_WORDS[t].icon} size={22} /><span>{TAB_WORDS[t].label}</span>
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** « Salut Hamza », and when nothing is booked, when the next cut is due (never a made-up date: no rhythm below 2 visits). */
function Hello({ me }: { me: Me }) {
  const today = todayKey();
  const due = me.rhythm.dueDay;
  let line: ReactNode = null;
  if (!me.upcoming.length) {
    const book = <a className="c-btn" href="/?reserver">Réserver</a>;
    if (due) line = <><p className="m-due">{(due < today ? 'Ta coupe t’attend depuis le ' : 'Ta prochaine coupe vers le ') + dayWords(due, { weekday: true }, today) + '.'}</p>{book}</>;
    else if (me.rhythm.visits > 0) line = <><p className="m-due">Ta première coupe t’a plu ? Reprends un créneau.</p>{book}</>;
    else line = <><p className="m-due">Ta première coupe t’attend.</p>{book}</>;
  }
  return (
    <div className="m-hello" data-guide="moi.hello">
      <h1 className="c-h" tabIndex={-1}>{me.first ? 'Salut ' + me.first : 'Bonjour'}</h1>
      {line}
    </div>
  );
}

function TabHead({ tab, me }: { tab: Tab; me: Me }) {
  if (tab === 'home') return <Hello me={me} />;
  const visits = me.rhythm.visits;
  return (
    <div className="m-hello">
      <h1 className="c-h" tabIndex={-1}>{tab === 'history' ? 'Ton historique' : 'Ton profil'}</h1>
      {tab === 'history' && visits ? <p className="c-muted">{visits > 1 ? visits + ' visites au salon' : 'Une visite au salon'}{me.fenced ? ' depuis l’ouverture de ton espace' : ''}.</p> : null}
    </div>
  );
}

function App() {
  // read once: where the visitor came from (a booking's « Créer mon espace », a deep link)
  const start = useRef(new URLSearchParams(location.search));
  const [acc, setAcc] = useState<AccountState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  const [path, setPath] = useState(location.pathname);
  const moved = useRef(false);

  const go = useCallback((to: string, replace = false) => {
    if (to !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', to);
    setPath(location.pathname);
  }, []);
  const loadAccount = useCallback(() => api.get<AccountState>('/api/public/account').then((a) => { setAcc(a); setErr(''); return a; }), []);
  const reload = useCallback(() => {
    api.get<Me>('/api/me/home').then((m) => { setMe(m); setErr(''); }).catch((e: ApiError) => {
      // the session ended elsewhere (signed out of every device, number changed): back to the sign-in
      if (e.status === 401) { setMe(null); setAcc((a) => (a ? { ...a, signedIn: false } : a)); } else setErr(e.message);
    });
  }, []);
  const enter = useCallback((a: AccountState) => {
    if (!a.signedIn) return;
    const next = safeNext(start.current.get('next'), location.origin);
    if (next) go(next, true);
    else if (start.current.has('garder')) go(location.pathname, true);
    reload();
  }, [go, reload]);

  useEffect(() => {
    loadAccount().then(enter).catch((e: ApiError) => setErr(e.message));
    const back = () => setPath(location.pathname);
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  // back on the page (another app, the phone woke up): what changed at the salon shows
  useEffect(() => {
    if (!acc || !acc.signedIn) return;
    // focus and visibilitychange often come together: one read is enough
    let last = 0;
    const fresh = () => { if (document.visibilityState === 'visible' && Date.now() - last > 2000) { last = Date.now(); reload(); } };
    window.addEventListener('focus', fresh);
    document.addEventListener('visibilitychange', fresh);
    return () => { window.removeEventListener('focus', fresh); document.removeEventListener('visibilitychange', fresh); };
  }, [acc && acc.signedIn]);

  const tab = tabOf(path);
  useEffect(() => {
    document.title = (acc && acc.signedIn ? TAB_WORDS[tab].title : 'Mon espace') + ' · L’Architecte';
    // a tab chosen by hand: the reader starts at its title
    if (moved.current) (document.querySelector('.m-hello h1') as HTMLElement | null)?.focus();
  }, [tab, acc && acc.signedIn, !!me]);
  const onTab = (t: Tab) => { moved.current = true; go(PATHS[t]); window.scrollTo(0, 0); };

  if (err && !acc) {
    return (
      <Shell>
        <section className="c-card c-center"><p className="c-k">Mon espace</p><h1 className="c-h">Le salon ne répond pas.</h1><p className="c-muted" role="alert">{err}</p><button type="button" className="c-btn" onClick={() => location.reload()}>Réessayer</button></section>
      </Shell>
    );
  }
  if (!acc) return <Shell><div className="c-card c-center" aria-busy="true"><span className="c-spin" /><p className="c-muted">Un instant…</p></div></Shell>;
  if (!acc.signedIn) {
    return (
      <Shell>
        <SignIn demo={acc.demo} enabled={acc.enabled} garder={acc.enabled ? start.current.get('garder') : null} onIn={() => loadAccount().then(enter).catch((e: ApiError) => setErr(e.message))} />
      </Shell>
    );
  }
  if (!me) {
    // the space did not open (the salon did not answer): say so and offer to try again, no spinner left turning
    return (
      <Shell>
        {err ? (
          <section className="c-card c-center"><p className="c-k">Mon espace</p><h1 className="c-h">Ton espace ne s’ouvre pas.</h1><p className="c-muted" role="alert">{err}</p><button type="button" className="c-btn" onClick={() => { setErr(''); reload(); }}>Réessayer</button></section>
        ) : <div className="c-card c-center" aria-busy="true"><span className="c-spin" /><p className="c-muted">On ouvre ton espace…</p></div>}
      </Shell>
    );
  }
  return (
    <Shell tab={tab} onTab={onTab}>
      <TabHead tab={tab} me={me} />
      {err ? <p className="c-note warn" role="alert">{err}</p> : null}
      {tabCards(tab).map((c) => { const Card = c.default; return <Guard key={c.meta.id}><Card me={me} reload={reload} /></Guard>; })}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
