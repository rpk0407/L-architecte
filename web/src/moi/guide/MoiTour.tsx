// GUIDE-01a · /moi's guided tour around the engine (ui/tour): the client steps of guide/steps/ (AC-02, AC-03a, FID-03,
// PAY-04, PAY-07…) that live in the signed-in space, « Bienvenue, Yanis » once on this phone, and « Comment
// ça marche ? » in Profil (startMoiTour). Where he stands stays on this phone (localStorage, never required: a private
// window only sees the welcome again). A part he does not have (no carnet, no membership) is simply not shown.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tour } from '../../ui/tour/Tour';
import { Icon } from '../../ui/Icon';
import { dayWords } from '../kit';
import type { Me } from '../types';
import { MOI_PLACES, TOUR_V, collect, plan } from '../../ui/tour/order';
import './welcome.css';

const STEPS = collect(import.meta.glob('./steps/*.ts', { eager: true }));
const KEY = 'lx-moi-tour';
const EVENT = 'lx:moi-tour';

type Seen = { v: number; at: string; done: boolean };
function read(): Seen | null {
  try { const x = JSON.parse(localStorage.getItem(KEY) || 'null'); return x && typeof x.v === 'number' ? x : null; } catch { return null; }
}
function write(x: Seen) { try { localStorage.setItem(KEY, JSON.stringify(x)); } catch { /* private mode: nothing kept */ } }

/** Replay the tour from its first step (Profil › « Comment ça marche ? »). */
export function startMoiTour() { dispatchEvent(new Event(EVENT)); }

/** The steps of the signed-in space, in its tabs' order: the sign-in's own steps are for the signed-out page. */
export const moiPlan = () => plan(STEPS, { places: MOI_PLACES, role: 'client', keep: (s) => /^\/moi(\/|$)/.test(s.page) && !(s.target || '').startsWith('moi.signin') });

/** The tour, mounted once in the signed-in space; `go` is /moi's own navigation. */
export function MoiTour({ go }: { go: (path: string) => void }) {
  const [run, setRun] = useState(0);
  const steps = useMemo(moiPlan, []);
  /** the tab he started from: the tour ends where he was */
  const from = useRef('/moi');
  useEffect(() => {
    const on = () => { from.current = location.pathname; setRun((n) => n + 1); };
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  if (!run || !steps.length) return null;
  return (
    <Tour key={run} steps={steps} skin="site" missing="skip"
      go={(p) => { go(p); window.scrollTo(0, 0); }}
      insets={() => ({ top: 0, bottom: (document.querySelector('.m-tabs') as HTMLElement | null)?.offsetHeight || 0 })}
      onEnd={(how, at) => {
        write({ v: TOUR_V, at: how === 'pause' && at ? at.id : '', done: how !== 'pause' });
        setRun(0);
        if (location.pathname !== from.current) { go(from.current); window.scrollTo(0, 0); }
      }} />
  );
}

/**
 * « Bienvenue, Yanis », at the top of Rendez-vous, once per phone (seen as soon as it shows): the space is open, and what
 * is already there, said from what he really has (his booking, the loyalty card only if the salon runs it). The tour it
 * offers is the optional part.
 */
export function MoiWelcome({ me, loyalty }: { me: Me; loyalty: boolean }) {
  const [show] = useState(() => !read() && moiPlan().length > 0);
  const [open, setOpen] = useState(show);
  useEffect(() => { if (show) write({ v: TOUR_V, at: '', done: false }); }, []);
  if (!open) return null;
  const next = me.upcoming[0];
  const ticks = [
    next ? 'Ton rendez-vous du ' + dayWords(next.day, { long: true }) + ' est là, avec Agenda, Itinéraire, Déplacer, Annuler' : 'Ton prochain rendez-vous s’affichera ici, à déplacer ou annuler en un geste',
    'Tes reçus arrivent après chaque visite',
    ...(loyalty ? ['Ta carte fidélité se remplit à chaque coupe payée'] : [])
  ];
  return (
    <section className="c-card m-welcome" aria-labelledby="mw-t">
      <p className="c-k">Ton espace est ouvert</p>
      <h2 id="mw-t" className="c-h2">Bienvenue{me.first ? ', ' + me.first : ''}</h2>
      <ul className="m-welcome-ticks">
        {ticks.map((t) => <li key={t}><span className="m-tick" aria-hidden="true"><Icon name="check" size={14} /></span><span>{t}</span></li>)}
      </ul>
      <div className="m-welcome-acts">
        <button type="button" className="c-btn ghost" onClick={() => { setOpen(false); startMoiTour(); }}>Voir comment ça marche</button>
        <button type="button" className="c-link" onClick={() => setOpen(false)}>Plus tard</button>
      </div>
    </section>
  );
}
