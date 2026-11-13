// A sideways swipe of the finger on the phone agenda: the next or the previous day (or barber). The zone it listens on
// has `touch-action: pan-y` (agenda.css), so the page's own up-and-down scroll stays the browser's: as soon as the
// browser scrolls it cancels the pointer and nothing here moves. The finger is followed by a transform written straight
// on the element (no render while it moves); under « reduce motion » nothing slides, the day just changes.
import { useEffect, useRef, type RefObject } from 'react';
import { swipeAxis, swipeEnd } from './day';

export type SwipeOpts = {
  /** off: nothing is listened to (a planning wider than the screen scrolls sideways by itself) */
  on: boolean;
  /** -1: the finger went left (next), 1: right (previous). */
  go: (dir: -1 | 1) => void;
  /** false: nothing that way (the last barber): the element resists and comes back */
  can?: (dir: -1 | 1) => boolean;
};

const still = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** zone: where the finger is read; moved: what follows it (the zone itself when omitted). */
export function useSwipe(zone: RefObject<HTMLElement | null>, opts: SwipeOpts, moved?: RefObject<HTMLElement | null>) {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = zone.current;
    if (!el || !opts.on) return;
    const target = () => moved?.current || el;
    let id = -1, x0 = 0, y0 = 0, t0 = 0, dx = 0, axis: 'x' | 'y' | null = null, raf = 0, swipedAt = 0, timer = 0;
    const paint = () => { raf = 0; const t = target(); const dir = dx < 0 ? -1 : 1; const ok = o.current.can ? o.current.can(dir) : true; t.style.transform = 'translate3d(' + Math.round(dx * (ok ? 1 : 0.2)) + 'px,0,0)'; };
    const rest = (anim: boolean) => {
      const t = target();
      t.style.transition = anim && !still() ? 'transform .18s ease-out, opacity .18s ease-out' : '';
      t.style.transform = ''; t.style.opacity = '';
      if (anim) { clearTimeout(timer); timer = window.setTimeout(() => { t.style.transition = ''; t.style.willChange = ''; }, 220); } else t.style.willChange = '';
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = e.timeStamp; dx = 0; axis = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!axis) {
        axis = swipeAxis(mx, my);
        if (axis === 'y') { id = -1; return; }
        if (axis === 'x' && !still()) { const t = target(); t.style.transition = ''; t.style.willChange = 'transform'; }
      }
      if (axis !== 'x') return;
      dx = mx;
      if (!still() && !raf) raf = requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (axis !== 'x') return;
      swipedAt = Date.now();
      const dir = swipeEnd(dx, e.timeStamp - t0, el.clientWidth);
      if (!dir || (o.current.can && !o.current.can(dir))) return rest(true);
      if (still()) { o.current.go(dir); return rest(false); }
      // out by the side it was pushed to, then the new day comes in from the other one
      const t = target();
      t.style.transition = 'transform .14s ease-in, opacity .14s ease-in';
      t.style.transform = 'translate3d(' + dir * 60 + '%,0,0)'; t.style.opacity = '0';
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        o.current.go(dir);
        t.style.transition = 'none';
        t.style.transform = 'translate3d(' + -dir * 24 + '%,0,0)';
        requestAnimationFrame(() => requestAnimationFrame(() => rest(true)));
      }, 140);
    };
    const cancel = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; if (raf) { cancelAnimationFrame(raf); raf = 0; } if (axis === 'x') rest(true); };
    // the touch that ends a swipe is not a tap on the appointment under the finger
    const click = (e: MouseEvent) => { if (Date.now() - swipedAt < 350) { e.stopPropagation(); e.preventDefault(); } };
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel); el.removeEventListener('click', click, true);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(timer);
      rest(false);
    };
  }, [opts.on]);
}
