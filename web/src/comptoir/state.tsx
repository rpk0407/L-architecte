// Who is signed in, what the salon looks like, and the live pulse that keeps every screen fresh.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, onSignedOut, onStoreHealth } from '../lib/api';
import { refreshAll, forget, useQuery } from '../lib/query';
import { toast } from '../ui/kit';
import type { Boot, FeedItem, Pulse, Staff, Service } from './types';
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
};
const C = createContext<Ctx | null>(null);
export function useApp() { const c = useContext(C); if (!c) throw new Error('outside app'); return c; }

const LIVE_KINDS = new Set(['booking', 'cancel', 'move', 'payment', 'wait', 'walkin', 'noshow', 'stock', 'dispute', 'refund']);
/** the pulse and a page's query can both be refused at once: one notice is enough */
let idleToldAt = 0;

export function AppProvider({ initial, onOut, children }: { initial: Boot; onOut: () => void; children: ReactNode }) {
  const [boot, setBoot] = useState(initial);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [storeDown, setStoreDown] = useState(false);
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
      toast({ kind: 'info', icon: 'lock', title: 'Poste verrouillé', sub: '10 minutes sans activité : saisis ton code.' });
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
        if (p.version !== version.current) {
          version.current = p.version;
          refreshAll();
          if (p.feed.length) {
            setFeed((f) => [...p.feed.slice().reverse(), ...f].slice(0, 80));
            const live = p.feed.filter((x) => LIVE_KINDS.has(x.kind) && x.by !== 'staff');
            if (live.length) {
              setUnread((n) => n + live.length);
              const last = live[live.length - 1];
              toast({ kind: 'info', title: last.title, sub: last.sub, icon: last.kind === 'booking' ? 'calendar' : last.kind === 'cancel' ? 'x' : last.kind === 'payment' ? 'card' : last.kind === 'dispute' ? 'alert' : 'bell' });
              buzz([12, 50, 12]);
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
    reloadBoot
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
