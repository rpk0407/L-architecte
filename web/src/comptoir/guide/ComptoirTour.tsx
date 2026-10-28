// GUIDE-01a · The Comptoir's guided tour around the engine (ui/tour): every steps file of guide/steps/ for this person
// (his role, the pages he can open), the welcome card at his first sign-in, the « Visite guidée » chip after « Plus
// tard », the « ? » of each page, and « Revoir la visite » (Réglages › Mise en route, the account menu: startTour()).
// Where he stands is in his prefs (prefs.tour, server/commands/team.js), so the tour follows him from the salon's
// tablet to his phone: written when he starts, pauses or ends it, and when he leaves the page mid-visit (not at every
// page: the activity journal is for real changes). A page's « ? » replays that page only and writes nothing.
// The public demo signs everyone in as the same owner: there the welcome's « vu » is also this browser tab's own, so
// one visitor's « Plus tard » does not take the welcome away from the next one (the salon's owner among them).
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { navigate, useRoute } from '../../lib/router';
import { dates } from '../../lib/format';
import { toast } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { Tour, type TourEnd } from '../../ui/tour/Tour';
import { COMPTOIR_PLACES, TOUR_V, collect, firstName, pageSteps, plan, resumeAt, welcomeOf, type Played } from '../../ui/tour/order';
import type { GuideRole } from '../../lib/guide';
import { useApp } from '../state';
import type { Agenda, ClientCard, TourPrefs } from '../types';
import './guide.css';

const STEPS = collect(import.meta.glob('./steps/*.ts', { eager: true }));

/* ---------------- who asked for the tour (one at a time, from anywhere in the Comptoir) ---------------- */

type Ask = { scope: 'tour' | 'page'; from: 'start' | 'resume'; n: number; path: string } | null;
let ask: Ask = null;
/** what he chose on this screen, before the server's answer comes back (the welcome goes at once); whose it is, for a
 *  salon tablet where the next person signs in without reloading the page */
let mine: { staffId: string; t: TourPrefs } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const listen = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const useAsk = () => useSyncExternalStore(listen, () => ask);

/** Start the whole visit from its first step (« Revoir la visite »), from where he stopped, or this page's steps (« ? »). */
export function startTour(scope: 'tour' | 'page' = 'tour', from: 'start' | 'resume' = 'start') {
  ask = { scope, from, n: (ask?.n || 0) + 1, path: location.pathname };
  emit();
}

const NEVER: TourPrefs = { v: 0, at: '', done: false };
const DEMO_SEEN = 'lx-tour-seen';
const seenHere = () => { try { return sessionStorage.getItem(DEMO_SEEN) === '1'; } catch { return true; } };

/** His tour as he left it: what he just chose on this screen, else his prefs (an older server sends none: never seen). */
function useTourPrefs(): TourPrefs {
  const { boot } = useApp();
  const m = useSyncExternalStore(listen, () => mine);
  if (m && m.staffId === boot.me.id) return m.t;
  if (boot.mode === 'demo' && !seenHere()) return NEVER;
  return boot.me.prefs?.tour || NEVER;
}
function save(staffId: string, t: TourPrefs, reload: () => Promise<void>) {
  mine = { staffId, t };
  emit();
  try { sessionStorage.setItem(DEMO_SEEN, '1'); } catch { /* private mode: the server's prefs decide */ }
  // the next screen he opens (his phone) picks it up; a failed write only means the welcome may come back there
  api.patch('/api/v1/prefs', { tour: t }).then(() => reload()).catch(() => {});
}
/** Leaving the page mid-visit (a reload, the tab closed): where he stands, best effort, without waiting for an answer. */
function saveOnLeave(t: TourPrefs) {
  try {
    void fetch('/api/v1/prefs', { method: 'PATCH', keepalive: true, credentials: 'same-origin', body: JSON.stringify({ tour: t }),
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-request-id': 'tour-' + Date.now().toString(36) + Math.random().toString(36).slice(2) } }).catch(() => {});
  } catch { /* nothing kept: he picks up from the last page he paused on */ }
}

/** This person's whole tour, in order. */
export function usePlan(canOpen: (path: string) => boolean): Played[] {
  const { boot } = useApp();
  const role = boot.me.role as GuideRole;
  return useMemo(() => plan(STEPS, { places: COMPTOIR_PLACES, role, canOpen }), [role, boot.me.caps.join(','), boot.me.chair]);
}

/* ---------------- the views a step needs: a ticket open, a client's file ---------------- */

/** A client waiting to pay today (his ticket is already filled), the one with the most to show (a membership, a carnet:
 *  their lines and chips), else an empty free sale (the parts it does not show are left out by the tour). */
async function aTicket(today: string, nowMin: number) {
  const cur = new URLSearchParams(location.search).get('rdv');
  if (location.pathname === '/comptoir/caisse' && cur) return '/comptoir/caisse?rdv=' + encodeURIComponent(cur);
  const a = await api.get<Agenda>('/api/v1/agenda?day=' + today).catch(() => null);
  const waiting = (a?.appts || []).filter((x) => !x.saleId && !x.legacy && !a!.closed && (x.status === 'in_chair' || x.status === 'done' || (['booked', 'arrived'].includes(x.status) && x.start + x.dur <= nowMin)));
  const score = (x: Agenda['appts'][number]) => (x.client?.memberships?.length ? 2 : 0) + (x.client?.packs?.length ? 1 : 0);
  const due = waiting.reduce<(typeof waiting)[number] | null>((b, x) => (!b || score(x) > score(b) ? x : b), null);
  return due ? '/comptoir/caisse?rdv=' + encodeURIComponent(due.id) : a && !a.closed ? '/comptoir/caisse?vente=1' : null;
}
/** The file open now, else a regular with the most to show: a membership, a carnet, a few visits. */
async function aFile() {
  const m = location.pathname.match(/^\/comptoir\/clients\/([^/]+)$/);
  if (m) return '/comptoir/clients/' + m[1];
  const r = await api.get<{ items: ClientCard[] }>('/api/v1/clients?sort=recent&limit=60').catch(() => null);
  const score = (c: ClientCard) => (c.memberships?.length ? 8 : 0) + (c.packs?.length ? 4 : 0) + Math.min(c.visits, 6) + (c.hasPhone ? 1 : 0);
  const best = (r?.items || []).reduce<ClientCard | null>((b, c) => (!b || score(c) > score(b) ? c : b), null);
  return best ? '/comptoir/clients/' + encodeURIComponent(best.id) : null;
}

/* ---------------- the pieces the shell places ---------------- */

/** Homes read at a glance on a phone (TEAM-04: his next client and four rows of his day without scrolling): the welcome
 *  goes under the page there, and the top bar's « Visite guidée » invites him meanwhile. */
export const GLANCE_PAGES: readonly string[] = ['espace'];

/** The tour itself, mounted once by the shell; it plays when someone asks (startTour). */
export function ComptoirTour({ canOpen }: { canOpen: (path: string) => boolean }) {
  const app = useApp();
  const a = useAsk();
  const all = usePlan(canOpen);
  const t = useTourPrefs();
  /** the step he is on, for a page left mid-visit */
  const at = useRef('');
  // signed out or locked mid-visit: the next person on this tablet starts from his own welcome
  useEffect(() => () => { ask = null; }, []);
  // the steps of the page in sight when « ? » was tapped, kept while the tour moves between its views
  const steps = !a ? [] : a.scope === 'page' ? pageSteps(all, a.path) : all;
  useEffect(() => { if (a && !steps.length) { ask = null; emit(); } }, [a, steps.length]);
  const whole = a?.scope === 'tour';
  useEffect(() => {
    if (!whole) return;
    const leave = () => { if (at.current) saveOnLeave({ v: TOUR_V, at: at.current, done: false }); };
    addEventListener('pagehide', leave);
    return () => removeEventListener('pagehide', leave);
  }, [whole, a?.n]);
  if (!a || !steps.length) return null;
  const onStep = (s: Played) => { at.current = s.id; };
  const onEnd = (how: TourEnd, stop: Played | null) => {
    ask = null;
    at.current = '';
    emit();
    if (!whole) return;
    if (how === 'pause') {
      save(app.boot.me.id, { v: TOUR_V, at: stop?.id || '', done: false }, app.reloadBoot);
      toast({ title: 'Visite en pause', sub: 'Reprends-la quand tu veux avec « Visite guidée », en haut.', icon: 'sparkle' });
      return;
    }
    save(app.boot.me.id, { v: TOUR_V, at: '', done: true }, app.reloadBoot);
    toast({ title: how === 'done' ? 'Visite terminée' : 'Visite passée', sub: 'Tu peux la revoir dans Réglages › Mise en route ou depuis ton compte.', icon: 'check' });
  };
  const today = app.pulse?.today || app.boot.today;
  const resolve = (place: string) =>
    place.startsWith('/comptoir/clients/') ? aFile()
      : place.startsWith('/comptoir/caisse?rdv=') ? aTicket(today, dates.localParts(app.now()).min)
        : Promise.resolve(null);
  return (
    <Tour key={a.n} steps={steps} start={whole && a.from === 'resume' ? resumeAt(steps, t.at) : 0} skin="comptoir" mode={a.scope} missing="center"
      go={(url) => navigate(url.replace(/^\/comptoir(?=\/|$)/, '') || '/')} resolve={resolve} onStep={onStep} onEnd={onEnd}
      insets={() => ({ top: (document.querySelector('.top') as HTMLElement | null)?.offsetHeight || 0, bottom: innerWidth < 900 ? (document.querySelector('.tabbar') as HTMLElement | null)?.offsetHeight || 0 : 0 })} />
  );
}

/** At his first sign-in, at the top of the page: an invitation, never in the way (the page stays usable under it). */
export function TourWelcome({ canOpen }: { canOpen: (path: string) => boolean }) {
  const app = useApp();
  const t = useTourPrefs();
  const a = useAsk();
  const all = usePlan(canOpen);
  if (t.v >= TOUR_V || a || !all.length) return null;
  const w = welcomeOf(app.boot.me.role as GuideRole, firstName(app.boot.me.name));
  return (
    // an aside: an invitation next to the page, not one of its sections
    <aside className="card tour-welcome" aria-labelledby="tw-t">
      <span className="tw-mark" aria-hidden><Icon name="sparkle" size={20} /></span>
      <div className="tw-main">
        <h2 id="tw-t">{w.title}</h2>
        <p>{w.line}</p>
      </div>
      <div className="tw-acts">
        <button type="button" className="btn btn-primary" onClick={() => { save(app.boot.me.id, { v: TOUR_V, at: all[0].id, done: false }, app.reloadBoot); startTour('tour', 'start'); }}>Commencer la visite</button>
        <button type="button" className="btn btn-ghost" onClick={() => save(app.boot.me.id, { v: TOUR_V, at: '', done: false }, app.reloadBoot)}>Plus tard</button>
      </div>
    </aside>
  );
}

/** In the top bar: « Visite guidée » until he has been through it, then the page's « ? » (its own steps only). */
export function TourButtons({ canOpen }: { canOpen: (path: string) => boolean }) {
  const t = useTourPrefs();
  const a = useAsk();
  const all = usePlan(canOpen);
  // read again at every move: the « ? » is this page's
  const route = useRoute();
  if (a || !all.length) return null;
  const here = pageSteps(all, location.pathname);
  const chip = (t.v > 0 && !t.done) || (t.v < TOUR_V && GLANCE_PAGES.includes(route.page));
  return (
    <>
      {chip ? (
        <button type="button" className="chip tour-chip" onClick={() => startTour('tour', 'resume')} aria-label="Visite guidée" title={t.at ? 'Reprendre la visite où tu l’as laissée' : 'Faire la visite guidée'}>
          <Icon name="sparkle" size={14} /><span aria-hidden>Visite<span className="tour-chip-more"> guidée</span></span>
        </button>
      ) : null}
      {here.length ? (
        <button type="button" className="btn btn-subtle btn-icon tour-help" aria-label="Comment marche cette page ?" title="Comment marche cette page ?" onClick={() => startTour('page')}>
          <span aria-hidden>?</span>
        </button>
      ) : null}
    </>
  );
}
