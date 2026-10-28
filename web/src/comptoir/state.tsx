// Who is signed in, what the salon looks like, and the live pulse that keeps every screen fresh.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
/** the pulse and a page's query can both be refused at once: one notice is enough */
let idleToldAt = 0;

export function AppProvider({ initial, onOut, children }: { initial: Boot; onOut: () => void; children: ReactNode }) {
  const [boot, setBoot] = useState(initial);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [storeDown, setStoreDown] = useState(false);
  const [pulseAt, setPulseAt] = useState(() => Date.now());
  const [clockNow, setClockNow] = useState(() => Date.now());
  const meRef = useRef(boot.me);
  meRef.current = boot.me;
  const version = useRef(initial.version);
  const offset = useRef(initial.now - Date.now());
  const caps = new Set(boot.me.caps);

  // the first page of the feed, then the pulse appends to it
  const first = useQuery<{ items: FeedItem[] }>('/api/v1/feed');
  useEffect(() => { if (first.data && !feed.length) setFeed(first.data.items); }, [first.data]);

  useEffect(() => onSignedOut((e) => {
    forget(); onOut();
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
    const tick = async () => {
      if (document.visibilityState === 'hidden') { timer = window.setTimeout(tick, 4000); return; }
      try {
        const p = await api.get<Pulse>('/api/v1/pulse?since=' + version.current);
        if (!alive) return;
        offset.current = p.now - Date.now();
        setPulse(p);
        setPulseAt(Date.now());
        if (p.version !== version.current) {
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
      if (alive) timer = window.setTimeout(tick, 4000);
    };
    timer = window.setTimeout(tick, 1500);
    const vis = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, []);

  // the stale chip and `offline` follow the clock, not only the pulses (a phone back from sleep)
  useEffect(() => {
    const t = window.setInterval(() => setClockNow(Date.now()), 15000);
    const on = () => setClockNow(Date.now());
    addEventListener('online', on); addEventListener('offline', on);
    return () => { clearInterval(t); removeEventListener('online', on); removeEventListener('offline', on); };
  }, []);
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || Math.max(clockNow, pulseAt) - pulseAt > STALE_MS;

  const reloadBoot = async () => { const b = await api.get<Boot>('/api/v1/bootstrap'); setBoot(b); };
  useEffect(() => { if (pulse && pulse.cfg !== boot.cfg) reloadBoot().catch(() => {}); }, [pulse?.cfg]);

  const value: Ctx = {
    boot,
    can: (c) => caps.has(c),
    staffById: new Map(boot.staff.map((s) => [s.id, s])),
    serviceById: new Map(boot.services.map((s) => [s.id, s])),
    pulse, storeDown, feed, unread,
    markRead: () => setUnread(0),
    now: () => Date.now() + offset.current,
    signOut: async () => { await api.post('/api/auth/logout').catch(() => {}); forget(); onOut(); },
    lock: async () => { await api.post('/api/auth/logout').catch(() => {}); forget(); onOut(); },
    reloadBoot, pulseAt, offline
  };
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
