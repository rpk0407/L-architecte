// GUIDE-01a · /moi's guided tour around the engine (ui/tour): the client steps of guide/steps/ (AC-02, AC-03a, FID-03,
// PAY-04, PAY-07…) that live in the signed-in space, « Bienvenue dans ton espace » once at the first visit, and « Comment
// ça marche ? » in Profil (startMoiTour). Where he stands stays on this phone (localStorage, never required: a private
// window only sees the welcome again). A part he does not have (no carnet, no membership) is simply not shown.
import { useEffect, useMemo, useState } from 'react';
import { Tour } from '../../ui/tour/Tour';
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
  useEffect(() => {
    const on = () => setRun((n) => n + 1);
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  if (!run || !steps.length) return null;
  return (
    <Tour key={run} steps={steps} skin="site" missing="skip"
      go={(p) => { go(p); window.scrollTo(0, 0); }}
      insets={() => ({ top: 0, bottom: (document.querySelector('.m-tabs') as HTMLElement | null)?.offsetHeight || 0 })}
      onEnd={(how, at) => { write({ v: TOUR_V, at: how === 'pause' && at ? at.id : '', done: how !== 'pause' }); setRun(0); }} />
  );
}

/** « Bienvenue dans ton espace », at the top of Rendez-vous, the first time only (seen as soon as it shows). */
export function MoiWelcome() {
  const [show] = useState(() => !read() && moiPlan().length > 0);
  const [open, setOpen] = useState(show);
  useEffect(() => { if (show) write({ v: TOUR_V, at: '', done: false }); }, []);
  if (!open) return null;
  return (
    <section className="c-card m-welcome" aria-labelledby="mw-t">
      <p className="c-k">Première visite</p>
      <h2 id="mw-t" className="c-h2">Bienvenue dans ton espace</h2>
      <p className="c-muted">Tes rendez-vous, tes visites et tes avantages au même endroit. On te montre comment ça marche, en une minute ?</p>
      <div className="m-welcome-acts">
        <button type="button" className="c-btn" onClick={() => { setOpen(false); startMoiTour(); }}>Voir comment ça marche</button>
        <button type="button" className="c-link" onClick={() => setOpen(false)}>Plus tard</button>
      </div>
    </section>
  );
}
