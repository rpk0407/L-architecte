// Who is signed in, what the salon looks like, and the live pulse that keeps every screen fresh.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onSignedOut, onStoreHealth } from '../lib/api';
import { refreshAll, forget, useQuery } from '../lib/query';
import { toast, STALE_MS } from '../ui/kit';
import type { Boot, FeedItem, Prefs, Pulse, Staff, Service } from './types';
import { buzz } from '../lib/hooks';
import { Icon } from '../ui/Icon';

type Ctx = {
  boot: Boot;
  can: (cap: string) => boolean;
  staffById: Map<string, Staff>;
  serviceById: Map<string, Service>;
  pulse: Pulse | null;
  /** the salon's database does not answer: screens read the server's memory, nothing is saved */
  storeDown: boolean;
  feed: FeedItem[];
  unread: number;
  markRead: () => void;
  /** server time: the salon's clock, not the device's */
  now: () => number;
  signOut: () => Promise<void>;
  lock: () => Promise<void>;
  reloadBoot: () => Promise<void>;
  /** device clock of the last pulse that answered (TEAM-02: <Stale at={pulseAt}> on phone pages) */
  pulseAt: number;
  /** no answer for 2 minutes or the device says it is offline: one-tap actions wait (TEAM-04, TEAM-05a) */
  offline: boolean;
};
const C = createContext<Ctx | null>(null);
export function useApp() { const c = useContext(C); if (!c) throw new Error('outside app'); return c; }

const LIVE_KINDS = new Set(['booking', 'cancel', 'move', 'payment', 'wait', 'walkin', 'noshow', 'stock', 'dispute', 'refund']);
/**
 * Is this line worth a toast for this person (TEAM-02 prefs.notify)? 'mine': his own chair's lines, and those about no
 * chair (the queue, the waiting list without preference, the stock); 'all': everything he may see; 'none': nothing.
 */
export function toastFor(f: FeedItem, me: { id: string; prefs?: Pick<Prefs, 'notify'> }) {
  const n = me.prefs?.notify || 'all';
  return n === 'all' || (n === 'mine' && (!f.staffId || f.staffId === me.id));
}
/** Pulse cadence: 4 s while someone is there (and always on the Agenda and the Caisse); 15 s once the page has seen no
 *  pointerdown, keydown or new version for 2 minutes. The first gesture, the page coming back to the front, or a move to
 *  the Agenda or the Caisse brings 4 s back. */
const PULSE_FAST = 4000, PULSE_SLOW = 15000, PULSE_IDLE_MS = 120000;
const LIVE_PAGES = new Set(['agenda', 'caisse']);
const livePage = () => LIVE_PAGES.has(location.pathname.replace(/^\/comptoir\/?/, '').split('/')[0]);
/** did the pulse change anything a screen shows? (`now` and `feed` alone do not: `now` is read through ctx.now()) */
function samePulse(a: Pulse | null, b: Pulse) {
  if (!a) return false;
  if (a.version !== b.version || a.cfg !== b.cfg || a.today !== b.today || a.min !== b.min) return false;
  const x = a.badges, y = b.badges;
  if (x.toPay !== y.toPay || x.queue !== y.queue || x.relances !== y.relances || x.waitlist !== y.waitlist || x.retention !== y.retention) return false;
  const p = a.alerts || [], q = b.alerts || [];
  return p.length === q.length && p.every((w, i) => w === q[i]);
}
/** the pulse and a page's query can both be refused at once: one notice is enough */
let idleToldAt = 0;

export function AppProvider({ initial, onOut, children }: { initial: Boot; onOut: () => void; children: ReactNode }) {
  const [boot, setBoot] = useState(initial);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [storeDown, setStoreDown] = useState(false);
  // the device clock of the last pulse that answered lives in a ref; `pulseAt` (context) only moves when the screen is
  // about to show it, i.e. when `offline` turns on, so a quiet pulse does not re-render every consumer
  const pulseAtRef = useRef(Date.now());
  const [pulseAt, setPulseAt] = useState(() => pulseAtRef.current);
  const [offline, setOffline] = useState(false);
  const onOutRef = useRef(onOut);
  onOutRef.current = onOut;
  const meRef = useRef(boot.me);
  meRef.current = boot.me;
  const version = useRef(initial.version);
  const offset = useRef(initial.now - Date.now());
  const caps = useMemo(() => new Set(boot.me.caps), [boot.me.caps]);

  // the first page of the feed, then the pulse appends to it
  const first = useQuery<{ items: FeedItem[] }>('/api/v1/feed');
  useEffect(() => { if (first.data && !feed.length) setFeed(first.data.items); }, [first.data]);

  useEffect(() => onSignedOut((e) => {
    forget(); onOutRef.current();
    // the server ended a PIN session left alone: say why the tablet is back on the code pad
    if (e.code === 'pin_idle' && Date.now() - idleToldAt > 5000) {
      idleToldAt = Date.now();
      const phone = !!meRef.current.device?.personal;
      toast({ kind: 'info', icon: 'lock', title: phone ? 'Téléphone verrouillé' : 'Poste verrouillé', sub: phone ? '12 h sans activité : saisis ton code.' : '10 minutes sans activité : saisis ton code.' });
    }
  }), []);

  // every answer says whether the database is there; the pulse (every 4 s) clears the banner once it is back
  useEffect(() => onStoreHealth(setStoreDown), []);
  useEffect(() => {
    if (storeDown) document.documentElement.dataset.down = '1'; else delete document.documentElement.dataset.down;
    return () => { delete document.documentElement.dataset.down; };
  }, [storeDown]);

  useEffect(() => {
    let alive = true, timer = 0;
    let touched = Date.now();   // last gesture or last new version
    const wake = () => { touched = Date.now(); };
    const delay = () => (document.visibilityState === 'visible' && !livePage() && Date.now() - touched > PULSE_IDLE_MS ? PULSE_SLOW : PULSE_FAST);
    const tick = async () => {
      if (document.visibilityState === 'hidden') { timer = window.setTimeout(tick, PULSE_FAST); return; }
      try {
        const p = await api.get<Pulse>('/api/v1/pulse?since=' + version.current);
        if (!alive) return;
        offset.current = p.now - Date.now();
        pulseAtRef.current = Date.now();
        setOffline(false);
        setPulse((prev) => (samePulse(prev, p) ? prev : p));
        if (p.version !== version.current) {
          touched = Date.now();
          version.current = p.version;
          refreshAll();
          if (p.feed.length) {
            setFeed((f) => [...p.feed.slice().reverse(), ...f].slice(0, 80));
            const me = meRef.current;
            const live = p.feed.filter((x) => LIVE_KINDS.has(x.kind) && x.by !== 'staff' && toastFor(x, me));
            if (live.length) {
              setUnread((n) => n + live.length);
              const last = live[live.length - 1];
              toast({ kind: 'info', title: last.title, sub: last.sub, icon: last.kind === 'booking' ? 'calendar' : last.kind === 'cancel' ? 'x' : last.kind === 'payment' ? 'card' : last.kind === 'dispute' ? 'alert' : last.kind === 'member' ? 'card' : 'bell' });
              if (me.prefs?.buzz !== false) buzz([12, 50, 12]);
            }
          }
        }
      } catch { /* offline: the next tick retries */ }
      if (alive) timer = window.setTimeout(tick, delay());
    };
    timer = window.setTimeout(tick, 1500);
    // a gesture after a slow stretch: pulse now (the timer may be 15 s away) and go back to 4 s
    const gesture = () => {
      const slow = Date.now() - touched > PULSE_IDLE_MS;
      wake();
      if (slow) { clearTimeout(timer); timer = window.setTimeout(tick, 0); }
    };
    const vis = () => { if (document.visibilityState === 'visible') { wake(); clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', vis);
    addEventListener('pointerdown', gesture, { passive: true });
    addEventListener('keydown', gesture);
    return () => {
      alive = false; clearTimeout(timer);
      document.removeEventListener('visibilitychange', vis);
      removeEventListener('pointerdown', gesture); removeEventListener('keydown', gesture);
    };
  }, []);

  // the stale chip and `offline` follow the clock, not only the pulses (a phone back from sleep); the state only moves when
  // the answer changes, so this check re-renders nothing on a quiet screen
  useEffect(() => {
    const check = () => {
      const off = (typeof navigator !== 'undefined' && navigator.onLine === false) || Date.now() - pulseAtRef.current > STALE_MS;
      setOffline((was) => {
        if (off && !was) setPulseAt(pulseAtRef.current);
        return off;
      });
    };
    const t = window.setInterval(check, 15000);
    addEventListener('online', check); addEventListener('offline', check);
    return () => { clearInterval(t); removeEventListener('online', check); removeEventListener('offline', check); };
  }, []);

  const reloadBoot = useCallback(async () => { const b = await api.get<Boot>('/api/v1/bootstrap'); setBoot(b); }, []);
  useEffect(() => { if (pulse && pulse.cfg !== boot.cfg) reloadBoot().catch(() => {}); }, [pulse?.cfg]);

  const staffById = useMemo(() => new Map(boot.staff.map((s) => [s.id, s])), [boot.staff]);
  const serviceById = useMemo(() => new Map(boot.services.map((s) => [s.id, s])), [boot.services]);
  const can = useCallback((c: string) => caps.has(c), [caps]);
  const markRead = useCallback(() => setUnread(0), []);
  const now = useCallback(() => Date.now() + offset.current, []);
  const signOut = useCallback(async () => { await api.post('/api/auth/logout').catch(() => {}); forget(); onOutRef.current(); }, []);
  const value = useMemo<Ctx>(() => ({
    boot, can, staffById, serviceById,
    pulse, storeDown, feed, unread,
    markRead, now,
    signOut, lock: signOut,
    reloadBoot, pulseAt, offline
  }), [boot, can, staffById, serviceById, pulse, storeDown, feed, unread, markRead, now, signOut, reloadBoot, pulseAt, offline]);
  return (
    <C.Provider value={value}>
      {storeDown ? (
        <div className="down-bar" role="alert">
          <Icon name="alert" /><b>Connexion à la base perdue · lecture seule</b>
          <span className="down-sub">Rien ne s’enregistre : note les nouveaux tickets sur papier.</span>
        </div>
      ) : null}
      {children}
    </C.Provider>
  );
}

/** A salon post anyone may look at (a PIN session on a device that is nobody's own phone): with prefs.blur 'auto', the
 *  amounts of Mon espace and Pilotage start masked there (TEAM-04, TEAM-05). */
export function useSharedScreen() {
  const { boot } = useApp();
  return boot.me.session === 'pin' && !boot.me.device?.personal;
}
/** Whether this person's amounts start masked on this screen: 'on' always, 'off' never, 'auto' on a shared salon post. */
export function useMaskedAmounts() {
  const shared = useSharedScreen();
  const blur = useApp().boot.me.prefs?.blur || 'auto';
  return blur === 'on' || (blur === 'auto' && shared);
}
/** A team member's photo URL (TEAM-02): its version in the URL, so it is cached for good and a new one is a new URL. */
export function photoOf(st: Pick<Staff, 'id' | 'photo'> | null | undefined) {
  return st && st.photo ? '/api/v1/staff/' + encodeURIComponent(st.id) + '/photo?v=' + st.photo : null;
}
