// The Comptoir: sign-in gate, then the shell around each page.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { Link, navigate, useRoute } from '../lib/router';
import { useHotkeys, useIsPhone, useLocal } from '../lib/hooks';
import { dates, time } from '../lib/format';
import { Icon } from '../ui/Icon';
import { Avatar, Button, ConfirmHost, Empty, Menu, Sheet, Toasts, dismiss, toast, Skeleton } from '../ui/kit';
import { AppProvider, photoOf, useApp } from './state';
import { forgetHome, homeOf } from './home';
import { Login, linkToken, type AuthState } from './Login';
import { Palette } from './Palette';
import { FeedSheet } from './Feed';
import type { Boot, FeedItem } from './types';
import { GUARD_OPEN, SECTION_CAP } from './pages/reglages/caps';
import { canOpenPath, navShows, phoneTabs, sectionNeed } from './access';
import { ArrivalBand } from './pages/espace/Arrival';

// The guided tour (steps, engine, welcome card) is its own chunk: the shell only asks for it once it is on screen.
const tourChunk = () => import('./guide/ComptoirTour');
const ComptoirTour = lazy(() => tourChunk().then((m) => ({ default: m.ComptoirTour })));
const TourWelcome = lazy(() => tourChunk().then((m) => ({ default: m.TourWelcome })));
const TourButtons = lazy(() => tourChunk().then((m) => ({ default: m.TourButtons })));
const TourPageItem = lazy(() => tourChunk().then((m) => ({ default: m.TourPageItem })));
const startTour = (scope: 'tour' | 'page', from: 'start' | 'resume' = 'start') => { tourChunk().then((m) => m.startTour(scope, from)).catch(() => {}); };

// The page chunks by name: Root asks for the opening page's while auth/state and bootstrap are on their way.
const LOAD: Record<string, () => Promise<{ default: ComponentType }>> = {
  accueil: () => import('./pages/Accueil'),
  pilotage: () => import('./pages/Pilotage'),
  espace: () => import('./pages/Espace'),
  agenda: () => import('./pages/Agenda'),
  caisse: () => import('./pages/Caisse'),
  clients: () => import('./pages/Clients'),
  relances: () => import('./pages/Relances'),
  messages: () => import('./pages/Messages'),
  rapports: () => import('./pages/Rapports'),
  equipe: () => import('./pages/Equipe'),
  catalogue: () => import('./pages/Catalogue'),
  reglages: () => import('./pages/Reglages')
};
const Accueil = lazy(LOAD.accueil);
const Pilotage = lazy(LOAD.pilotage);
const Espace = lazy(LOAD.espace);
const Agenda = lazy(LOAD.agenda);
const Caisse = lazy(LOAD.caisse);
const Clients = lazy(LOAD.clients);
const Relances = lazy(LOAD.relances);
const Messages = lazy(LOAD.messages);
const Rapports = lazy(LOAD.rapports);
const Equipe = lazy(LOAD.equipe);
const Catalogue = lazy(LOAD.catalogue);
const Reglages = lazy(LOAD.reglages);

// Each page and the capability needed to open it; the server refuses anyway, this only spares an empty or broken screen.
// A new page is one entry here (an address not listed opens the Agenda). No `cap` opens it for every role:
// Équipe and Catalogue are read-only without `team` / `catalog` (own card, prices), Relances refuses its own tabs.
type Route = { C: ComponentType; title: string; cap?: string; sub?: (id: string) => string | undefined };
const ROUTES: Record<string, Route> = {
  accueil: { C: Accueil, title: 'Accueil' },
  pilotage: { C: Pilotage, title: 'Pilotage', cap: 'report.shop' },
  espace: { C: Espace, title: 'Mon espace', cap: 'agenda.own' },
  agenda: { C: Agenda, title: 'Agenda', cap: 'agenda.own' },
  caisse: { C: Caisse, title: 'Caisse', cap: 'sale.create' },
  clients: { C: Clients, title: 'Clients', cap: 'client.view' },
  relances: { C: Relances, title: 'Relances' },
  // « mode téléphone »: the texts to clients a person sends from WhatsApp (a barber: his own clients')
  messages: { C: Messages, title: 'Messages', cap: 'agenda.own' },
  rapports: { C: Rapports, title: 'Rapports', cap: 'report.own' },
  equipe: { C: Equipe, title: 'Équipe' },
  catalogue: { C: Catalogue, title: 'Catalogue' },
  reglages: { C: Reglages, title: 'Réglages', sub: (id) => sectionNeed(id, { GUARD_OPEN, SECTION_CAP }) }
};

/** The pages this person may open (a new page in ROUTES joins by itself: Mon espace, Pilotage), for homeOf. */
export function useOpenPages() {
  const { can } = useApp();
  return Object.keys(ROUTES).filter((k) => { const c = ROUTES[k].cap; return !c || can(c); });
}

/** Was someone signed in on this browser last time? (read: send the bootstrap with the sign-in check; write: remember) */
function wasIn(set?: boolean): boolean {
  try {
    if (set === undefined) return localStorage.getItem('lx-in') === '1';
    if (set) localStorage.setItem('lx-in', '1'); else localStorage.removeItem('lx-in');
  } catch { /* private mode: the check is simply sequential */ }
  return set === true;
}

export function Root() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState('');
  const load = async () => {
    try {
      setFailed('');
      // all three leave together: who is signed in, his bootstrap and the chunk of the page he opens on (the address's, else
      // the Accueil, the page /comptoir alone opens). The bootstrap only leaves early on a browser that was signed in (`lx-in`,
      // set below): for anyone else it would be a 401 in the console on every visit to the sign-in screen.
      const stP = api.get<AuthState>('/api/auth/state');
      const bootP = (wasIn() ? api.get<Boot>('/api/v1/bootstrap') : Promise.reject(new Error('not signed in'))).catch((e: unknown) => ({ failed: e }));
      const first = location.pathname.replace(/^\/comptoir\/?/, '').split('/')[0];
      (Object.hasOwn(LOAD, first) ? LOAD[first] : LOAD.accueil)().catch(() => {});
      const st = await stP;
      setAuth(st);
      if (st.me) {
        const b = await bootP;
        setBoot('failed' in b ? await api.get<Boot>('/api/v1/bootstrap') : b);
        wasIn(true);
      } else { setBoot(null); wasIn(false); }
    } catch (e: any) { setFailed(e?.message || 'Impossible de joindre le serveur.'); }
  };
  useEffect(() => { load(); }, []);
  if (failed) return <div className="auth"><div className="auth-box"><div className="empty"><b>Le Comptoir est injoignable</b><p>{failed}</p><Button variant="primary" onClick={load}>Réessayer</Button></div></div></div>;
  if (!auth) return <div className="auth"><div className="spin" style={{ width: 28, height: 28, color: 'var(--tx3)' }} /></div>;
  // a phone link (/comptoir/lier/…) shows its own screen, even on a browser already signed in
  if (!auth.me || !boot || linkToken()) return <><Login state={auth} onDone={load} /><Toasts /></>;
  return (
    // signed out (or the phone removed): the sign-in screen starts from the fresh state, never from the stale one
    <AppProvider initial={boot} onOut={() => { forgetHome(); wasIn(false); setBoot(null); setAuth(null); load(); }}>
      <Shell />
      <Toasts />
      <ConfirmHost />
    </AppProvider>
  );
}

/** GUIDE-01a: can this person open this page of the tour (/comptoir/<page>/<id>, a `:param` for any)? Its menu entry
 *  and its capability, as the shell decides them, so a barber's tour never shows a page he cannot open. */
export function useCanOpen(nav: NavItem[]) {
  const { can } = useApp();
  return (path: string) => canOpenPath(path, ROUTES, nav, can);
}

type NavItem = { to: string; page: string; label: string; icon: string; cap?: string; badge?: number; soft?: boolean };

function useNav(): NavItem[] {
  const { can, pulse, boot } = useApp();
  const b = pulse?.badges;
  // the texts waiting for this person, and whether the salon sends by hand at all (else the page stays out of the menu)
  const hand = b as { hand?: number; handOn?: boolean } | undefined;
  const items: NavItem[] = [
    // everyone's Accueil (WP5), then the owner's and the managers' Pilotage (TEAM-05a) and a chair's Mon espace (TEAM-04); /comptoir alone opens each person's home (home.ts)
    { to: '/accueil', page: 'accueil', label: 'Accueil', icon: 'house' },
    { to: '/pilotage', page: 'pilotage', label: 'Chiffres', icon: 'target', cap: 'report.shop' },
    { to: '/espace', page: 'espace', label: 'Mon espace', icon: 'chair', cap: 'agenda.own' },
    { to: '/agenda', page: 'agenda', label: 'Agenda', icon: 'agenda', cap: 'agenda.own' },
    { to: '/caisse', page: 'caisse', label: 'Caisse', icon: 'caisse', cap: 'sale.create', badge: b?.toPay },
    { to: '/clients', page: 'clients', label: 'Clients', icon: 'clients', cap: 'client.view', badge: b?.retention, soft: true },
    ...(hand?.handOn || hand?.hand ? [{ to: '/messages', page: 'messages', label: 'Messages', icon: 'sms', cap: 'agenda.own', badge: hand.hand }] : []),
    { to: '/relances', page: 'relances', label: 'Relances', icon: 'relances', cap: 'marketing', badge: b?.relances, soft: true },
    { to: '/rapports', page: 'rapports', label: can('report.shop') ? 'Rapports' : 'Mes chiffres', icon: 'rapports', cap: 'report.own' },
    { to: '/equipe', page: 'equipe', label: 'Équipe', icon: 'equipe', cap: 'team', badge: (b as { requests?: number } | undefined)?.requests },
    { to: '/catalogue', page: 'catalogue', label: 'Catalogue', icon: 'catalogue', cap: 'catalog' },
    { to: '/reglages', page: 'reglages', label: 'Réglages', icon: 'reglages' }
  ];
  // the desk has no chair: no figures of its own, so no page of zeros (the agenda gives it the salon's counts)
  return items.filter((x) => navShows(x, can, boot.me.chair));
}

function Shell() {
  const app = useApp();
  const { boot, unread } = app;
  const route = useRoute();
  const nav = useNav();
  const canOpen = useCanOpen(nav);
  const phone = useIsPhone();
  const [palette, setPalette] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [userMenu, setUserMenu] = useState<DOMRect | null>(null);
  const [theme, setTheme] = useLocal<'dark' | 'light'>('lx-theme', 'dark');
  const [priv, setPriv] = useLocal<string>('lx-private', '0');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (priv === '1') document.documentElement.dataset.private = '1'; else delete document.documentElement.dataset.private; }, [priv]);
  useEffect(() => { const on = () => setScrolled(scrollY > 4); addEventListener('scroll', on, { passive: true }); return () => removeEventListener('scroll', on); }, []);

  // a shared salon tablet locks itself when nobody touches it; a barber's own phone does not (12 h on the server)
  const personal = !!boot.me.device?.personal;
  useEffect(() => {
    if (boot.me.session !== 'pin' || personal) return;
    let t = 0;
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => { app.lock(); }, 4 * 60000); };
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t); evs.forEach((e) => removeEventListener(e, reset)); };
  }, [boot.me.session, personal]);

  useAbsenceToasts();

  useHotkeys({
    'mod+k': (e) => { e.preventDefault(); setPalette(true); },
    '/': (e) => { e.preventDefault(); setPalette(true); },
    'g': () => navigate('/agenda'),
    'escape': () => setPalette(false)
  }, []);

  // /comptoir alone opens this person's home; with a query it is an older deep link into the agenda (?day=&rdv=)
  const pages = useOpenPages();
  const home = route.bare ? (location.search ? 'agenda' : homeOf(boot.me, pages)) : null;
  useEffect(() => { if (home) navigate('/' + home + location.search, { replace: true }); }, [route.key]);
  const page = home || route.page;
  // own keys only: /comptoir/constructor must not pick up Object.prototype
  const r = Object.hasOwn(ROUTES, page) ? ROUTES[page] : ROUTES.agenda;
  const need = route.id && r.sub ? r.sub(route.id) : r.cap;
  const Page = r.C;
  const allowed = !need || app.can(need);
  // his opening page, then his three chosen tabs (prefs.tabs) or his role's; the rest is behind « Plus », with its badges added up
  const tabNames = phoneTabs(homeOf(boot.me, nav.map((x) => x.page)), boot.me.prefs?.tabs, { chair: !!boot.me.chair, shop: app.can('report.shop') }, (p) => nav.some((x) => x.page === p));
  const tabs = tabNames.map((p) => nav.find((x) => x.page === p)).filter((x): x is NavItem => !!x);
  const rest = nav.filter((x) => !tabs.includes(x));
  const restBadge = rest.reduce((n, x) => n + (x.badge || 0), 0);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const toggleMask = () => { setPriv(priv === '1' ? '0' : '1'); toast(priv === '1' ? 'Montants visibles' : 'Montants masqués à l’écran'); };

  return (
    <div className="app">
      <aside className="side" aria-label="Navigation">
        <div className="brand"><span className="brand-mark" aria-hidden>L’A</span><span className="brand-t"><b>Le Comptoir</b><small>L’Architecte</small></span></div>
        <nav className="nav">
          {nav.map((x) => (
            <Link key={x.page} to={x.to} aria-current={page === x.page ? 'page' : undefined}>
              <Icon name={x.icon} />{x.label}{x.badge ? <span className={'nb' + (x.soft ? ' soft' : '')}>{x.badge}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          <a className="nav-site link" href="/" target="_blank" rel="noopener" style={{ padding: '0 12px', fontSize: 13 }}>Voir le site client</a>
          <button type="button" className="me-btn" onClick={(e) => setUserMenu(e.currentTarget.getBoundingClientRect())} aria-label="Mon compte">
            <Avatar name={boot.me.name} initials={boot.me.initials} color={boot.me.color} photo={photoOf(boot.me)} size="sm" />
            <span className="grow"><b className="ellipsis">{boot.me.name}</b><small>{boot.me.roleLabel}{boot.me.device ? ' · ' + boot.me.device.name : ''}</small></span>
          </button>
        </div>
      </aside>

      <div className="main">
        {boot.mode === 'demo' ? <div className="demo-band">Démo · aucune donnée réelle, aucun SMS ni paiement réel{app.can('settings') ? <> · <button type="button" onClick={() => navigate('/reglages/donnees')}>remettre à zéro</button></> : null}</div> : null}
        {/* a breakdown the owner was told by e-mail today (SMS, planificateur, sauvegarde): it stays in sight while the day lasts */}
        {(app.pulse?.alerts ?? boot.alerts ?? []).map((w) => <div key={w} className="alert-band" role="alert"><Icon name="alert" size={15} /><span>{w}</span></div>)}
        {/* no connection: said calmly within seconds, with the hour of what is on screen; gone as soon as it is back */}
        {app.offline ? <div className="offline-band" role="status" data-offline><Icon name="alert" size={15} /><span><b>Hors ligne</b> : ce que tu vois date de {time(dates.localParts(app.pulseAt + (app.now() - Date.now())).min)}. Les encaissements ne sont pas enregistrés tant que la connexion n’est pas revenue.</span></div> : null}
        {/* FEATURE C: « Le client est là ? » for the barber's own booking that just started, wherever he is */}
        <ArrivalBand page={page} />
        <header className={'top' + (scrolled ? ' scrolled' : '')}>
          <div className="top-title" id="page-title" />
          <div className="top-acts">
            {phone ? null : <Suspense fallback={null}><TourButtons canOpen={canOpen} /></Suspense>}
            <Button icon="search" aria-label="Rechercher (⌘K)" title="Rechercher · ⌘K" onClick={() => setPalette(true)} />
            <Button className="hide-phone" icon={priv === '1' ? 'eyeOff' : 'eye'} aria-label={priv === '1' ? 'Afficher les montants' : 'Masquer les montants'} title="Masquer les montants à l’écran" aria-pressed={priv === '1'} onClick={toggleMask} />
            <Button className="hide-phone" icon={theme === 'dark' ? 'sun' : 'moon'} aria-label="Changer de thème" onClick={toggleTheme} />
            <button type="button" className="btn btn-subtle btn-icon" aria-label={'Le fil' + (unread ? ', ' + unread + ' nouveautés' : '')} onClick={() => { setFeedOpen(true); app.markRead(); }}>
              <Icon name="bell" />{unread ? <span className="dotn" aria-hidden>{unread > 9 ? '9+' : unread}</span> : null}
            </button>
            {phone ? <button type="button" className="me-btn" style={{ width: 'auto', padding: 2 }} onClick={(e) => setUserMenu(e.currentTarget.getBoundingClientRect())} aria-label="Mon compte"><Avatar name={boot.me.name} initials={boot.me.initials} color={boot.me.color} photo={photoOf(boot.me)} size="sm" /></button> : null}
          </div>
        </header>
        <main className="page" key={page} id="main">
          {phone ? null : <Suspense fallback={null}><TourWelcome canOpen={canOpen} /></Suspense>}
          {allowed ? <Suspense fallback={<PageSkeleton />}><Page /></Suspense> : <Reserved title={r.title} back={page === 'reglages' ? 'compte' : 'agenda'} />}
          {/* on a phone the welcome goes under the content, on every page */}
          {phone ? <Suspense fallback={null}><TourWelcome canOpen={canOpen} /></Suspense> : null}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navigation">
        {tabs.map((x) => (
          <Link key={x.page} to={x.to} aria-current={page === x.page ? 'page' : undefined}><Icon name={x.icon} />{x.label}{x.badge ? <span className="nb">{x.badge}</span> : null}</Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-current={rest.some((x) => x.page === page) ? 'page' : undefined}><Icon name="more" />Plus{restBadge ? <span className="nb" aria-label={restBadge + ' à voir'}>{restBadge}</span> : null}</button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Plus" kicker={boot.me.name + ' · ' + boot.me.roleLabel}>
        <div className="list">
          {rest.map((x) => <Link key={x.page} to={x.to} className="li" onClick={() => setMore(false)}><Icon name={x.icon} size={22} /><span className="li-main"><b>{x.label}</b></span>{x.badge ? <span className="badge badge-accent">{x.badge}</span> : <Icon name="chevR" size={18} />}</Link>)}
          {/* a chair's own absences, two taps away on the phone (Mon compte) */}
          {boot.me.chair ? <Link to="/reglages/compte?absences=1" className="li" onClick={() => setMore(false)}><Icon name="calendar" size={22} /><span className="li-main"><b>Mes absences</b><small>Poser un congé, suivre une demande</small></span><Icon name="chevR" size={18} /></Link> : null}
          <a className="li" href="/" target="_blank" rel="noopener"><Icon name="globe" size={22} /><span className="li-main"><b>Voir le site client</b></span><Icon name="ext" size={18} /></a>
        </div>
      </Sheet>

      <Menu anchor={userMenu} onClose={() => setUserMenu(null)}>
        <p className="k">{boot.me.name} · {boot.me.roleLabel}</p>
        <button type="button" onClick={() => navigate('/reglages/compte')}><Icon name="key" />Mon mot de passe et mon code</button>
        {/* the phone's top bar keeps loupe, bell and avatar: the rest is here */}
        {phone ? <button type="button" onClick={() => startTour('tour', 'resume')}><Icon name="sparkle" />Visite guidée</button> : null}
        {/* only on a page that has guide steps (the tour's chunk knows them) */}
        {phone ? <Suspense fallback={null}><TourPageItem canOpen={canOpen} /></Suspense> : null}
        {phone ? <button type="button" onClick={toggleMask}><Icon name={priv === '1' ? 'eye' : 'eyeOff'} />{priv === '1' ? 'Afficher les montants' : 'Masquer les montants'}</button> : null}
        <button type="button" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
        <button type="button" onClick={() => startTour('tour', 'start')}><Icon name="sparkle" />Revoir la visite</button>
        <div className="sep" />
        {boot.me.device ? <button type="button" onClick={() => app.lock()}><Icon name="lock" />{personal ? 'Verrouiller' : 'Verrouiller · changer de personne'}</button> : null}
        <button type="button" onClick={() => app.signOut()}><Icon name="logout" />Se déconnecter</button>
      </Menu>

      {palette ? <Palette onClose={() => setPalette(false)} toggleMask={toggleMask} toggleTheme={toggleTheme} /> : null}
      <FeedSheet open={feedOpen} onClose={() => setFeedOpen(false)} />
      <Suspense fallback={null}><ComptoirTour canOpen={canOpen} /></Suspense>
    </div>
  );
}

type AbsenceItem = FeedItem & { timeoffId?: string; aboutStaffId?: string; request?: boolean; pending?: boolean; mine?: boolean };
/**
 * Absences as they happen: a barber's request reaches the owner as a toast he can answer there (Valider opens the
 * plan when clients are on it), and the barber hears the answer. Only what arrives while the Comptoir is open.
 */
function useAbsenceToasts() {
  const app = useApp();
  const since = useRef(app.now());
  const seen = useRef(new Set<number>());
  // the request toasts still on screen: decided elsewhere (Équipe, another device), they go
  const open = useRef(new Map<string, number>());
  useEffect(() => {
    for (const f of app.feed as AbsenceItem[]) {
      if (f.kind !== 'timeoff' || f.at < since.current || seen.current.has(f.v) || !f.timeoffId) continue;
      seen.current.add(f.v);
      const id = f.timeoffId;
      const shown = open.current.get(id);
      if (shown != null && !f.request) { dismiss(shown); open.current.delete(id); }
      if (f.request && f.pending && app.can('team')) {
        open.current.set(id, toast({
          kind: 'info', icon: 'calendar', title: f.title, sub: f.sub, ttl: 20000,
          // Équipe's own answer (its chunk loads on the tap): a request withdrawn meanwhile is said, not an error
          actions: [false, true].map((yes) => ({ label: yes ? 'Valider' : 'Refuser', run: () => { void import('./pages/Equipe').then((m) => m.decideRequest(id, yes, (f.aboutStaffId && app.staffById.get(f.aboutStaffId)?.name) || '')); } }))
        }));
      } else if (f.mine) toast({ kind: 'info', icon: 'calendar', title: f.title, sub: f.sub, ttl: 8000 });
    }
  }, [app.feed]);
}

/** An owner page opened by someone without the right: a clear refusal and a way back, not a broken screen.
 *  Without `title` it is a part of a page that already has its own (a tab). */
export function Reserved({ title, back = 'agenda' }: { title?: string; back?: 'agenda' | 'compte' }) {
  return (
    <>
      {title ? <PageTitle><h1>{title}</h1></PageTitle> : null}
      <section className="card">
        <Empty icon="lock" title="Réservé au gérant" action={<Link to={back === 'compte' ? '/reglages/compte' : '/agenda'} className="btn btn-subtle">{back === 'compte' ? 'Mon compte' : 'Retour à l’agenda'}</Link>}>
          Demande-lui si tu as besoin de modifier ça.
        </Empty>
      </section>
    </>
  );
}

function PageSkeleton() {
  return <div className="col" style={{ gap: 14 }}><Skeleton h={40} w={260} /><div className="kpis">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={108} r={20} />)}</div><Skeleton h={420} r={22} /></div>;
}

/** Pages render their title into the top bar. */
export function PageTitle({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById('page-title')); }, []);
  useEffect(() => { const t = document.querySelector('#page-title h1')?.textContent; if (t) document.title = t + ' · Le Comptoir'; });
  return el ? createPortal(children, el) : null;
}
