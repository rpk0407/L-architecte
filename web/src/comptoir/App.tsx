// The Comptoir: sign-in gate, then the shell around each page.
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api';
import { Link, navigate, useRoute } from '../lib/router';
import { useHotkeys, useIsPhone, useLocal } from '../lib/hooks';
import { Icon } from '../ui/Icon';
import { Avatar, Button, ConfirmHost, Empty, Menu, Sheet, Toasts, toast, Skeleton } from '../ui/kit';
import { AppProvider, useApp } from './state';
import { Login, type AuthState } from './Login';
import { Palette } from './Palette';
import { FeedSheet } from './Feed';
import type { Boot } from './types';

const Agenda = lazy(() => import('./pages/Agenda'));
const Caisse = lazy(() => import('./pages/Caisse'));
const Clients = lazy(() => import('./pages/Clients'));
const Relances = lazy(() => import('./pages/Relances'));
const Rapports = lazy(() => import('./pages/Rapports'));
const Equipe = lazy(() => import('./pages/Equipe'));
const Catalogue = lazy(() => import('./pages/Catalogue'));
const Reglages = lazy(() => import('./pages/Reglages'));
const Site = lazy(() => import('./pages/Site'));

// Each page and the capability needed to open it; the server refuses anyway, this only spares an empty or broken screen.
// A new page is one entry here (an address not listed opens the Agenda). No `cap` opens it for every role:
// Équipe and Catalogue are read-only without `team` / `catalog` (own card, prices), Relances refuses its own tabs.
type Route = { C: ComponentType; title: string; cap?: string; sub?: (id: string) => string | undefined };
// Réglages sections are the owner's unless listed: a new section open to every role is added here.
const OWN_SECTIONS = ['compte'];
const SECTION_CAP: Record<string, string> = { appareils: 'devices', donnees: 'data', journal: 'audit' };
const ROUTES: Record<string, Route> = {
  agenda: { C: Agenda, title: 'Agenda', cap: 'agenda.own' },
  caisse: { C: Caisse, title: 'Caisse', cap: 'sale.create' },
  clients: { C: Clients, title: 'Clients', cap: 'client.view' },
  relances: { C: Relances, title: 'Relances' },
  rapports: { C: Rapports, title: 'Rapports', cap: 'report.own' },
  equipe: { C: Equipe, title: 'Équipe' },
  catalogue: { C: Catalogue, title: 'Catalogue' },
  // what the site says: owner and managers, like the catalogue (`catalog`, checked again by /api/v1/site)
  site: { C: Site, title: 'Le site', cap: 'catalog' },
  reglages: { C: Reglages, title: 'Réglages', sub: (id) => (OWN_SECTIONS.includes(id) ? undefined : (Object.hasOwn(SECTION_CAP, id) ? SECTION_CAP[id] : 'settings')) }
};

export function Root() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState('');
  const load = async () => {
    try {
      setFailed('');
      const st = await api.get<AuthState>('/api/auth/state');
      setAuth(st);
      if (st.me) setBoot(await api.get<Boot>('/api/v1/bootstrap'));
      else setBoot(null);
    } catch (e: any) { setFailed(e?.message || 'Impossible de joindre le serveur.'); }
  };
  useEffect(() => { load(); }, []);
  if (failed) return <div className="auth"><div className="auth-box"><div className="empty"><b>Le Comptoir est injoignable</b><p>{failed}</p><Button variant="primary" onClick={load}>Réessayer</Button></div></div></div>;
  if (!auth) return <div className="auth"><div className="spin" style={{ width: 28, height: 28, color: 'var(--tx3)' }} /></div>;
  if (!auth.me || !boot) return <><Login state={auth} onDone={load} /><Toasts /></>;
  return (
    <AppProvider initial={boot} onOut={() => { setBoot(null); load(); }}>
      <Shell />
      <Toasts />
      <ConfirmHost />
    </AppProvider>
  );
}

type NavItem = { to: string; page: string; label: string; icon: string; cap?: string; badge?: number; soft?: boolean };

function useNav(): NavItem[] {
  const { can, pulse, boot } = useApp();
  const b = pulse?.badges;
  const items: NavItem[] = [
    { to: '/', page: 'agenda', label: 'Agenda', icon: 'agenda', cap: 'agenda.own' },
    { to: '/caisse', page: 'caisse', label: 'Caisse', icon: 'caisse', cap: 'sale.create', badge: b?.toPay },
    { to: '/clients', page: 'clients', label: 'Clients', icon: 'clients', cap: 'client.view', badge: b?.retention, soft: true },
    { to: '/relances', page: 'relances', label: 'Relances', icon: 'relances', cap: 'marketing', badge: b?.relances, soft: true },
    { to: '/rapports', page: 'rapports', label: can('report.shop') ? 'Rapports' : 'Mes chiffres', icon: 'rapports', cap: 'report.own' },
    { to: '/equipe', page: 'equipe', label: 'Équipe', icon: 'equipe', cap: 'team' },
    { to: '/catalogue', page: 'catalogue', label: 'Catalogue', icon: 'catalogue', cap: 'catalog' },
    { to: '/site', page: 'site', label: 'Le site', icon: 'globe', cap: 'catalog' },
    { to: '/reglages', page: 'reglages', label: 'Réglages', icon: 'reglages' }
  ];
  void boot;
  return items.filter((x) => !x.cap || can(x.cap));
}

function Shell() {
  const app = useApp();
  const { boot, unread } = app;
  const route = useRoute();
  const nav = useNav();
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

  // a shared salon tablet locks itself when nobody touches it
  useEffect(() => {
    if (boot.me.session !== 'pin') return;
    let t = 0;
    const reset = () => { clearTimeout(t); t = window.setTimeout(() => { app.lock(); }, 4 * 60000); };
    const evs = ['pointerdown', 'keydown', 'scroll'];
    evs.forEach((e) => addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t); evs.forEach((e) => removeEventListener(e, reset)); };
  }, [boot.me.session]);

  useHotkeys({
    'mod+k': (e) => { e.preventDefault(); setPalette(true); },
    '/': (e) => { e.preventDefault(); setPalette(true); },
    'g': () => navigate('/'),
    'escape': () => setPalette(false)
  }, []);

  const page = route.page;
  // own keys only: /comptoir/constructor must not pick up Object.prototype
  const r = Object.hasOwn(ROUTES, page) ? ROUTES[page] : ROUTES.agenda;
  const need = route.id && r.sub ? r.sub(route.id) : r.cap;
  const Page = r.C;
  const allowed = !need || app.can(need);
  const phoneTabs = nav.filter((x) => ['agenda', 'caisse', 'clients', 'rapports'].includes(x.page)).slice(0, 4);
  const rest = nav.filter((x) => !phoneTabs.includes(x));

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
            <Avatar name={boot.me.name} initials={boot.me.initials} color={boot.me.color} size="sm" />
            <span className="grow"><b className="ellipsis">{boot.me.name}</b><small>{boot.me.roleLabel}{boot.me.device ? ' · ' + boot.me.device.name : ''}</small></span>
          </button>
        </div>
      </aside>

      <div className="main">
        {boot.mode === 'demo' ? <div className="demo-band">Démo · aucune donnée réelle, aucun SMS ni paiement réel{app.can('settings') ? <> · <button type="button" onClick={() => navigate('/reglages/donnees')}>remettre à zéro</button></> : null}</div> : null}
        <header className={'top' + (scrolled ? ' scrolled' : '')}>
          <div className="top-title" id="page-title" />
          <div className="top-acts">
            <Button className="hide-phone" icon="search" aria-label="Rechercher (⌘K)" title="Rechercher · ⌘K" onClick={() => setPalette(true)} />
            <Button icon={priv === '1' ? 'eyeOff' : 'eye'} aria-label={priv === '1' ? 'Afficher les montants' : 'Masquer les montants'} title="Masquer les montants à l’écran" aria-pressed={priv === '1'} onClick={() => { setPriv(priv === '1' ? '0' : '1'); toast(priv === '1' ? 'Montants visibles' : 'Montants masqués à l’écran'); }} />
            <Button className="hide-phone" icon={theme === 'dark' ? 'sun' : 'moon'} aria-label="Changer de thème" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
            <button type="button" className="btn btn-subtle btn-icon" aria-label={'Le fil' + (unread ? ', ' + unread + ' nouveautés' : '')} onClick={() => { setFeedOpen(true); app.markRead(); }}>
              <Icon name="bell" />{unread ? <span className="dotn" aria-hidden>{unread > 9 ? '9+' : unread}</span> : null}
            </button>
            {phone ? <button type="button" className="me-btn" style={{ width: 'auto', padding: 2 }} onClick={(e) => setUserMenu(e.currentTarget.getBoundingClientRect())} aria-label="Mon compte"><Avatar name={boot.me.name} initials={boot.me.initials} color={boot.me.color} size="sm" /></button> : null}
          </div>
        </header>
        <main className="page" key={page} id="main">
          {allowed ? <Suspense fallback={<PageSkeleton />}><Page /></Suspense> : <Reserved title={r.title} back={page === 'reglages' ? 'compte' : 'agenda'} />}
        </main>
      </div>

      <nav className="tabbar" aria-label="Navigation">
        {phoneTabs.map((x) => (
          <Link key={x.page} to={x.to} aria-current={page === x.page ? 'page' : undefined}><Icon name={x.icon} />{x.label}{x.badge ? <span className="nb">{x.badge}</span> : null}</Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-current={rest.some((x) => x.page === page) ? 'page' : undefined}><Icon name="more" />Plus</button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="Plus" kicker={boot.me.name + ' · ' + boot.me.roleLabel}>
        <div className="list">
          {rest.map((x) => <Link key={x.page} to={x.to} className="li" onClick={() => setMore(false)}><Icon name={x.icon} size={22} /><span className="li-main"><b>{x.label}</b></span>{x.badge ? <span className="badge badge-accent">{x.badge}</span> : <Icon name="chevR" size={18} />}</Link>)}
          <button type="button" className="li" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} /><span className="li-main"><b>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</b></span></button>
          <button type="button" className="li" onClick={() => { setMore(false); setPalette(true); }}><Icon name="search" size={22} /><span className="li-main"><b>Rechercher</b><small>Un client, une page, une action</small></span></button>
          <a className="li" href="/" target="_blank" rel="noopener"><Icon name="globe" size={22} /><span className="li-main"><b>Voir le site client</b></span><Icon name="ext" size={18} /></a>
        </div>
      </Sheet>

      <Menu anchor={userMenu} onClose={() => setUserMenu(null)}>
        <p className="k">{boot.me.name} · {boot.me.roleLabel}</p>
        <button type="button" onClick={() => navigate('/reglages/compte')}><Icon name="key" />Mon mot de passe et mon code</button>
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</button>
        <div className="sep" />
        {boot.me.device ? <button type="button" onClick={() => app.lock()}><Icon name="lock" />Verrouiller · changer de personne</button> : null}
        <button type="button" onClick={() => app.signOut()}><Icon name="logout" />Se déconnecter</button>
      </Menu>

      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
      <FeedSheet open={feedOpen} onClose={() => setFeedOpen(false)} />
    </div>
  );
}

/** An owner page opened by someone without the right: a clear refusal and a way back, not a broken screen.
 *  Without `title` it is a part of a page that already has its own (a tab). */
export function Reserved({ title, back = 'agenda' }: { title?: string; back?: 'agenda' | 'compte' }) {
  return (
    <>
      {title ? <PageTitle><h1>{title}</h1></PageTitle> : null}
      <section className="card">
        <Empty icon="lock" title="Réservé au gérant" action={<Link to={back === 'compte' ? '/reglages/compte' : '/'} className="btn btn-subtle">{back === 'compte' ? 'Mon compte' : 'Retour à l’agenda'}</Link>}>
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
