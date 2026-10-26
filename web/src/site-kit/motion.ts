// Motion for the public sites: one scroll loop for the whole page, transforms and opacity only,
// and nothing moves for people who asked their system for less motion.
export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 → 1 over [a, b] of t */
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);

type Track = { el: Element; mode: 'sticky' | 'through'; cb: (p: number, el: Element) => void; active: boolean; last: number };
const tracks: Track[] = [];
let ticking = false;
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
  for (const e of entries) for (const t of tracks) if (t.el === e.target) t.active = e.isIntersecting;
  schedule();
}, { rootMargin: '25% 0px 25% 0px' }) : null;

function frame() {
  ticking = false;
  const vh = window.innerHeight;
  for (const t of tracks) {
    if (!t.active) continue;
    const r = t.el.getBoundingClientRect();
    // sticky: 0 when the section's top reaches the top of the screen, 1 when its bottom reaches the bottom
    // through: 0 when it enters at the bottom, 1 when it leaves at the top
    const p = t.mode === 'sticky' ? clamp(-r.top / Math.max(1, r.height - vh)) : clamp((vh - r.top) / (r.height + vh));
    if (Math.abs(p - t.last) < 0.0005) continue;
    t.last = p;
    t.cb(p, t.el);
  }
}
function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', () => { for (const t of tracks) t.last = -1; schedule(); }, { passive: true });
}

/** Call cb(progress 0..1) as the element scrolls by. Returns a stop function. */
export function track(el: Element | null, cb: (p: number, el: Element) => void, mode: 'sticky' | 'through' = 'sticky') {
  if (!el) return () => {};
  const t: Track = { el, mode, cb, active: !io, last: -1 };
  tracks.push(t);
  io?.observe(el);
  bind();
  schedule();
  return () => { const i = tracks.indexOf(t); if (i >= 0) tracks.splice(i, 1); io?.unobserve(el); };
}
/** Writes the progress into a CSS variable (default --p) so the stylesheet does the animating. */
export function trackVar(el: Element | null, name = '--p', mode: 'sticky' | 'through' = 'sticky') {
  return track(el, (p, e) => (e as HTMLElement).style.setProperty(name, p.toFixed(4)), mode);
}

/** Adds .is-in once an element enters the screen ([data-reveal], optional data-delay in ms). */
export function reveal(root: ParentNode = document, selector = '[data-reveal]') {
  const els = Array.from(root.querySelectorAll<HTMLElement>(selector));
  if (reduced() || typeof IntersectionObserver === 'undefined') { els.forEach((el) => el.classList.add('is-in')); return; }
  const ob = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      const d = Number(el.dataset.delay || 0);
      if (d) el.style.transitionDelay = d + 'ms';
      el.classList.add('is-in');
      ob.unobserve(el);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  els.forEach((el) => ob.observe(el));
}

/** Wraps each word in a span with --i (its index), keeping <em>, <br> and non-breaking spaces. */
export function splitWords(el: HTMLElement) {
  let i = 0;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const parts = (child.textContent || '').split(/( +)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^ +$/.test(part)) { frag.appendChild(document.createTextNode(' ')); continue; }
          const w = document.createElement('span');
          w.className = 'w';
          w.style.setProperty('--i', String(i++));
          w.textContent = part;
          frag.appendChild(w);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === 1 && (child as Element).tagName !== 'BR') walk(child);
    }
  };
  walk(el);
  el.style.setProperty('--n', String(i));
  return i;
}

/** The element leans toward the pointer (desktop only). */
export function magnetic(el: HTMLElement | null, strength = 0.25) {
  if (!el || reduced() || matchMedia('(hover: none)').matches) return;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * strength).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * strength).toFixed(1)}px)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
}

/** Counts a number up when it first shows (5,0 · 316 avis). */
export function countUp(el: HTMLElement | null, to: number, o: { decimals?: number; ms?: number } = {}) {
  if (!el) return;
  const dec = o.decimals || 0, ms = o.ms || 1400;
  const fmt = (v: number) => v.toFixed(dec).replace('.', ',');
  if (reduced() || typeof IntersectionObserver === 'undefined') { el.textContent = fmt(to); return; }
  el.textContent = fmt(0);
  const ob = new IntersectionObserver((es) => {
    if (!es.some((e) => e.isIntersecting)) return;
    ob.disconnect();
    const t0 = performance.now();
    const step = (t: number) => { const k = ease(clamp((t - t0) / ms)); el.textContent = fmt(to * k); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }, { threshold: 0.5 });
  ob.observe(el);
}

/** Smooth scroll to an element, leaving room for a fixed header. */
export function scrollToEl(el: Element | null, offset = 0) {
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: y, behavior: reduced() ? 'auto' : 'smooth' });
}
/** In-page links (#section) scroll smoothly and keep the address bar tidy. */
export function smoothAnchors(offset = 0) {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
    if (!a) return;
    const id = a.getAttribute('href')!.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    scrollToEl(target, offset);
    history.replaceState(null, '', '#' + id);
  });
}
