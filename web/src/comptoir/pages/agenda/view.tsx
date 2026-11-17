// How each person reads the agenda on this device: how big (zoom), whose chairs (the team's or his own), and with or
// without what stands around it (« Agenda seul »). Kept on the device and per person: a salon tablet is shared.
import { useEffect, useRef, type RefObject } from 'react';
import { useLocal } from '../../../lib/hooks';
import { Icon } from '../../../ui/Icon';

/** a callback that never changes but always calls the latest one (so a listener is set once) */
function useEvent<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef((...a: A) => ref.current(...a)).current;
}

/** each layout multiplies its own scale (pixels per minute) by one of these */
export const ZOOMS = [0.6, 0.8, 1, 1.3, 1.7];
const ZOOM_DEFAULT = 2;
export type AgendaView = { zoom: number; who: 'equipe' | 'moi'; focus: boolean };
const KEY = 'lx-agenda-view:';

/** whatever was stored (an older shape, a hand-edited value): a view that can be drawn */
export function readView(raw: unknown): AgendaView {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const z = Number(o.zoom);
  return { zoom: Number.isInteger(z) && z >= 0 && z < ZOOMS.length ? z : ZOOM_DEFAULT, who: o.who === 'moi' ? 'moi' : 'equipe', focus: o.focus === true };
}
export const scaleOf = (v: AgendaView) => ZOOMS[v.zoom] ?? 1;

export function useAgendaView(meId: string): [AgendaView, (patch: Partial<AgendaView>) => void] {
  const [raw, setRaw] = useLocal<unknown>(KEY + meId, null);
  const view = readView(raw);
  const set = useEvent((patch: Partial<AgendaView>) => setRaw(readView({ ...view, ...patch })));
  return [view, set];
}

/** − and +, and « Agenda seul »: the same three buttons on the tablet's board and on the phone's bar. */
export function AgendaTools({ view, set, compact }: { view: AgendaView; set: (patch: Partial<AgendaView>) => void; compact?: boolean }) {
  return (
    <div className={'ag-tools' + (compact ? ' compact' : '')} role="group" aria-label="Taille et place de l’agenda">
      <button type="button" className="ag-tool" aria-label="Réduire l’agenda" title="Réduire" disabled={view.zoom <= 0} onClick={() => set({ zoom: view.zoom - 1 })}><Icon name="minus" size={17} /></button>
      <button type="button" className="ag-tool" aria-label="Agrandir l’agenda" title="Agrandir" disabled={view.zoom >= ZOOMS.length - 1} onClick={() => set({ zoom: view.zoom + 1 })}><Icon name="plus" size={17} /></button>
      <button type="button" className="ag-tool ag-tool-f" aria-pressed={view.focus} aria-label={view.focus ? 'Tout afficher autour de l’agenda' : 'Afficher l’agenda seul'} title={view.focus ? 'Tout afficher' : 'Agenda seul'} onClick={() => set({ focus: !view.focus })}>
        <Icon name={view.focus ? 'collapse' : 'expand'} size={16} />{compact ? null : <span>{view.focus ? 'Tout afficher' : 'Agenda seul'}</span>}
      </button>
    </div>
  );
}

/**
 * Two fingers on the planning (a tablet), or Ctrl + the wheel (a trackpad's pinch): one zoom step each time the fingers
 * have moved apart or together by about a fifth. The page itself does not zoom under the gesture.
 */
export function usePinchZoom(ref: RefObject<HTMLElement | null>, step: (dir: 1 | -1) => void, on = true) {
  const go = useEvent(step);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    let d0 = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e: TouchEvent) => { d0 = e.touches.length === 2 ? dist(e.touches) : 0; };
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !d0) return;
      e.preventDefault();
      const d = dist(e.touches), r = d / d0;
      if (r > 1.22) { go(1); d0 = d; } else if (r < 0.82) { go(-1); d0 = d; }
    };
    const end = (e: TouchEvent) => { if (e.touches.length < 2) d0 = 0; };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = Date.now();
      if (now - last.current < 180 || !e.deltaY) return;
      last.current = now;
      go(e.deltaY < 0 ? 1 : -1);
    };
    // Safari's own pinch would zoom the whole page
    const gesture = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gesture);
    return () => {
      el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end);
      el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', gesture);
    };
  }, [on]);
}
