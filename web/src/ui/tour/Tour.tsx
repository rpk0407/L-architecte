// The guided tour (GUIDE-01a), one engine for the Comptoir and /moi: a dimmed page with a spotlight cut around the part
// a step points at (its data-guide mark), the explanation card beside it with an arrow, « Suivant » / « Retour », the
// progress and a dot per step of the page. The spotlight glides from part to part, the card follows and fades, a page
// change fades the two out and in; under prefers-reduced-motion everything is instant (tour.css).
// It goes to each step's page with the app's own router (`go`) and lets the page settle (its parts up to 3 s after a
// page change, less once the page is done: its empty state, data-tour-empty, or nothing new for a moment; longer while
// its data is still on its way, lib/api netIdle). The parts the page does not show then (an empty salon, a client with
// no carnet, a ticket with no member, a button hidden at this width) are left out all at once, before the page's first
// card: no card explains what is not there to tap, and the page's count « 2 / 5 » holds from its first card to its
// last. The `:param` places (a ticket, a file) are found before the first card, so a whole page is never dropped
// mid-way. It never gets stuck: a part gone later (the data changed) gets a centered card ('center', the Comptoir) or
// is left out ('skip', /moi). What to play and in what order: order.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { netIdle } from '../../lib/api';
import { playOrder, type Played } from './order';
import './tour.css';

export type TourEnd = 'done' | 'skip' | 'pause';
export type TourProps = {
  steps: Played[];
  /** the step to start on (a resumed tour) */
  start?: number;
  skin: 'comptoir' | 'site';
  /** 'tour': the whole visit (« Passer la visite »); 'page': one page's steps, from its « ? » (« Fermer ») */
  mode?: 'tour' | 'page';
  missing?: 'center' | 'skip';
  /** the app's router: open this address (as a step's place, `:params` resolved) */
  go: (url: string) => void;
  /** a place with `:params` (a client's file, a ticket) → a real address, or null: nothing to show, its steps are left out */
  resolve?: (place: string) => Promise<string | null>;
  /** what covers the page at the top (a sticky bar) and the bottom (a tab bar), in px */
  insets?: () => { top: number; bottom: number };
  onStep?: (s: Played, i: number) => void;
  /** done: past the last step; skip: « Passer la visite »; pause: Escape (the tour can be picked up again) */
  onEnd: (how: TourEnd, at: Played | null) => void;
};

/** how long a part may take to appear after this step changed the page (its data loading) */
const WAIT_MS = 3000;
/** on a page already open, a part that is not there by now is not coming */
const SETTLE_MS = 500;
/** a page with some of its parts in, no request on its way and nothing new on it for this long is done loading */
const QUIET_MS = 700;
/** a page whose data is still on its way past WAIT_MS (a cold server, a slow connection) is waited for up to this */
const LOAD_MS = 12000;
/** spotlight padding around the part, room between it and the card (the arrow), distance kept from the screen's edges */
const PAD = 8, GAP = 16, EDGE = 12;
/** below this width the card is a bottom card */
const PHONE = 640;
const CARD_W = 340;
/** what the phone's bottom card takes at most, and its margin */
const ROOM = 290;

type Box = { x: number; y: number; w: number; h: number };
type Side = 'top' | 'bottom' | 'left' | 'right';
/** the spotlight in page coordinates (it scrolls with the page); the card in page coordinates, or the phone's bottom card */
type Geo = { spot: Box | null; card: { x: number; y: number } | 'bottom' | 'top' | 'center'; arrow: { side: Side; at: number } | null; jump: boolean; top?: number };

/** French spacing that never breaks: « x », and the space before : ; ? ! */
const nb = (t: string) => t.replace(/« /g, '«\u00a0').replace(/ »/g, '\u00a0»').replace(/ ([:;?!])/g, '\u00a0$1');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Same address: the same path and the same query, in any order. */
export function sameUrl(a: string, b: string) {
  const ua = new URL(a, location.origin), ub = new URL(b, location.origin);
  if (ua.pathname.replace(/\/+$/, '') !== ub.pathname.replace(/\/+$/, '')) return false;
  const qa = [...ua.searchParams].map((x) => x.join('=')).sort().join('&'), qb = [...ub.searchParams].map((x) => x.join('=')).sort().join('&');
  return qa === qb;
}

const marked = (target: string) => [...document.querySelectorAll<HTMLElement>('[data-guide="' + CSS.escape(target) + '"]')].filter((el) => !el.closest('.tour'));
/** The first part on screen marked with this data-guide (a hidden copy, a phone-only or desktop-only one, is passed over). */
export function findPart(target: string): HTMLElement | null {
  for (const el of marked(target)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}
/** Nothing to show for this part here: the page has it but hides it at this width, or the page is in its empty state. */
const notHere = (target: string) => !!document.querySelector('[data-tour-empty]') || marked(target).length > 0;

export function Tour({ steps, start = 0, skin, mode = 'tour', missing = 'center', go, resolve, insets, onStep, onEnd }: TourProps) {
  const [list, setList] = useState(steps);
  const listRef = useRef(steps);
  listRef.current = list;
  const [cur, setCur] = useState<{ i: number; el: HTMLElement | null; jump: boolean } | null>(null);
  const curRef = useRef(cur);
  curRef.current = cur;
  const [geo, setGeoState] = useState<Geo | null>(null);
  const geoRef = useRef(geo);
  /** a new placement only when something moved (a ResizeObserver or a scroll would otherwise re-render for nothing) */
  const setGeo = (g: Geo) => {
    // beside ↔ centered ↔ bottom are different positionings: gliding from one to the other would fly across the screen
    const kind = (x: Geo | null) => (!x ? '' : typeof x.card === 'string' ? x.card : 'beside');
    if (geoRef.current && kind(geoRef.current) !== kind(g)) g = { ...g, jump: true };
    if (JSON.stringify(g) === JSON.stringify(geoRef.current)) return;
    geoRef.current = g;
    setGeoState(g);
  };
  const [away, setAway] = useState(true);
  /** on a phone, room under the page for the bottom card (the tour's own block, after the app), so the last part of a
   *  page can be scrolled above the card */
  const [room] = useState(() => innerWidth < PHONE);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const token = useRef(0);
  const urls = useRef(new Map<string, string | null>());
  /** the places whose page has settled: their missing parts are already left out */
  const settled = useRef(new Set<string>());
  /** where the page is being scrolled to: the card is placed for the page as it will stand */
  const aim = useRef<{ top: number; left: number } | null>(null);
  const cardH = useRef(200);
  const ended = useRef(false);
  const inset = () => (insets ? insets() : { top: 0, bottom: 0 });
  const phone = () => innerWidth < PHONE;

  const finish = (how: TourEnd) => {
    if (ended.current) return;
    ended.current = true;
    token.current++;
    const c = curRef.current;
    onEnd(how, c ? listRef.current[c.i] || null : null);
  };

  /** Leave out the steps `out` picks, then carry on from where `i` stood (backwards: the step before them). */
  const drop = (out: (s: Played) => boolean, i: number, dir: number) => {
    const l = listRef.current;
    const nl = l.filter((s) => !out(s));
    let ni = i - l.slice(0, i).filter(out).length;
    if (dir < 0) ni -= 1;
    if (!nl.length || ni >= nl.length) { listRef.current = nl; setList(nl); return finish('done'); }
    listRef.current = nl;
    setList(nl);
    void show(Math.max(0, ni), ni < 0 ? 1 : dir);
  };

  /** What is left of this place in its play order (order.ts playOrder: the page's own order for the parts on screen,
   *  then `order` for the rest); a part whose data came late joins in its turn. */
  const reorder = (i: number): boolean => {
    const l = listRef.current, place = l[i].place;
    let end = i;
    while (end < l.length && l[end].place === place) end++;
    const group = l.slice(i, end);
    const at = new Map(group.map((s) => [s.id, s.target ? findPart(s.target) : null]));
    const next = playOrder(group, (s) => !!at.get(s.id), (a, b) => { const p = at.get(a.id)!.compareDocumentPosition(at.get(b.id)!); return p & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : p & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0; });
    if (next.every((s, k) => s === group[k])) return false;
    const nl = [...l.slice(0, i), ...next, ...l.slice(end)];
    listRef.current = nl;
    setList(nl);
    return nl[i].id !== l[i].id;
  };

  /** Bring the part into view: centered in what the page and the card leave free, and only when it is not in view already. */
  const scrollTo = (el: HTMLElement) => {
    const smooth: ScrollBehavior = reduced() ? 'auto' : 'smooth';
    let r = el.getBoundingClientRect();
    // a row that scrolls sideways (the segments): the part to its middle
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) {
        const pr = p.getBoundingClientRect();
        p.scrollTo({ left: p.scrollLeft + (r.left - pr.left) - (pr.width - r.width) / 2, behavior: smooth });
        break;
      }
    }
    // a list that scrolls on its own (the Clients list): the part into its view first, at once, so that the window's
    // scroll and the card's place below are worked out from where the part really is
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (!/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
      const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (er.top >= pr.top + PAD && er.bottom <= pr.bottom - PAD) continue;
      p.scrollTop += er.top - pr.top - Math.max(PAD, (pr.height - er.height) / 2);
    }
    r = el.getBoundingClientRect();
    const { top: it, bottom: ib } = inset();
    const vh = innerHeight;
    const low = phone() ? vh - cardH.current - 24 : vh - ib;
    const room = low - it - 2 * PAD;
    if (r.top - PAD >= it + 4 && r.bottom + PAD <= low - 4) { aim.current = { top: scrollY, left: scrollX }; return; }
    const max = Math.max(0, document.documentElement.scrollHeight - vh);
    const docTop = r.top + scrollY;
    const top = clamp(r.height <= room ? docTop - it - PAD - (room - r.height) / 2 : docTop - it - 2 * PAD, 0, max);
    aim.current = { top, left: scrollX };
    window.scrollTo({ top, behavior: smooth });
  };

  /** Wait for this place's page to settle: every part in, or the page done without some (its empty state, parts hidden
   *  at this width, or some parts in and nothing new for QUIET_MS), or `long` ms (3 s after a page change). The page is
   *  done only once its data is in: while a request is on its way it is not quiet, and past the 3 s it is waited for (up
   *  to LOAD_MS), so a slow connection shows the same parts as a fast one. false: the visitor moved on meanwhile. */
  const settle = async (place: string, my: number, long: boolean) => {
    const targets = [...new Set(listRef.current.filter((x) => x.place === place && x.target).map((x) => x.target!))];
    if (!targets.length) return true;
    let last = Date.now();
    const mo = typeof MutationObserver === 'function' ? new MutationObserver((ms) => {
      if (ms.some((m) => { const n = m.target.nodeType === 1 ? (m.target as Element) : m.target.parentElement; return !n?.closest('.tour'); })) last = Date.now();
    }) : null;
    mo?.observe(document.body, { childList: true, subtree: true, characterData: true });
    const t0 = Date.now(), until = t0 + (long ? WAIT_MS : SETTLE_MS), cap = t0 + LOAD_MS;
    try {
      for (;;) {
        const out = targets.filter((t) => !findPart(t)), now = Date.now(), quiet = Math.min(now - last, netIdle());
        if (!out.length || now >= cap || (now >= until && netIdle() >= QUIET_MS)) return true;
        if (now - t0 >= SETTLE_MS && netIdle() >= QUIET_MS && (out.every(notHere) || (out.length < targets.length && quiet >= QUIET_MS))) return true;
        await sleep(80);
        if (my !== token.current) return false;
      }
    } finally { mo?.disconnect(); }
  };

  /** Show step i (dir: the way the visitor is going, for steps left out on the way). */
  const show = async (i: number, dir = 1) => {
    const my = ++token.current;
    const s = listRef.current[i];
    if (!s) return finish('done');
    const url = s.place.includes(':') ? urls.current.get(s.place) ?? null : s.place;
    if (url == null) return drop((x) => x.place === s.place, i, dir);
    const moving = !sameUrl(url, location.pathname + location.search);
    if (moving) {
      setAway(true);
      if (!reduced()) await sleep(200);
      if (my !== token.current) return;
      go(url);
    }
    const fresh = !settled.current.has(s.place);
    if (fresh) {
      if (!(await settle(s.place, my, moving || !curRef.current))) return;
      settled.current.add(s.place);
      // what the page does not show now is not coming: all left out at once, before its first card (one wait, and the
      // page's count holds)
      const gone = new Set(listRef.current.filter((x) => x.place === s.place && x.target && !findPart(x.target)).map((x) => x.id));
      if (gone.has(s.id)) return drop((x) => gone.has(x.id), i, dir);
      if (gone.size) {
        const nl = listRef.current.filter((x) => !gone.has(x.id));
        listRef.current = nl;
        setList(nl);
        i = nl.indexOf(s);
      }
    }
    let el: HTMLElement | null = null;
    if (s.target) {
      // a settled page met again (« Retour » from the next page): its part, as long as the page may take
      const until = Date.now() + (fresh ? 0 : moving ? WAIT_MS : SETTLE_MS);
      while (!(el = findPart(s.target)) && Date.now() < until && !notHere(s.target)) {
        await sleep(80);
        if (my !== token.current) return;
      }
    }
    if (!el && s.target && (missing === 'skip' || notHere(s.target))) return drop((x) => x.id === s.id, i, dir);
    // going forward, the rest of this place in the page's order (a step that moves ahead is shown in its turn)
    if (dir > 0 && reorder(i)) return show(i, dir);
    if (el) scrollTo(el); else aim.current = { top: scrollY, left: scrollX };
    const next = { i, el, jump: moving || !curRef.current };
    curRef.current = next;
    setCur(next);
    setAway(false);
    onStep?.(listRef.current[i], i);
  };

  // the views a place needs (a ticket, a file) are found first: a place with nothing to show is left out before the
  // first card, not when the tour gets there
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const my = token.current;
    void (async () => {
      const want = clamp(start, 0, Math.max(0, steps.length - 1));
      const ps = [...new Set(steps.map((s) => s.place).filter((p) => p.includes(':')))];
      await Promise.all(ps.map(async (p) => { urls.current.set(p, resolve ? await resolve(p).catch(() => null) : null); }));
      if (my !== token.current) return;
      const l = steps.filter((s) => !s.place.includes(':') || urls.current.get(s.place) != null);
      listRef.current = l;
      setList(l);
      // the step he stopped on, or the first one after it that is left
      const k = l.findIndex((s) => steps.indexOf(s) >= want);
      if (k < 0) return finish('done');
      void show(k);
    })();
    return () => { token.current++; if (prev && prev.isConnected) prev.focus?.(); };
  }, []);

  /** Place the spotlight and the card for the current step (full: choose the card's side again). */
  const place = (full: boolean, jump = false) => {
    if (!cur) return;
    const c = card.current;
    if (c) cardH.current = c.offsetHeight;
    let el = cur.el;
    const s = listRef.current[cur.i];
    if (el && !el.isConnected && s?.target) el = findPart(s.target);
    if (!el) { setGeo({ spot: null, card: phone() ? 'bottom' : 'center', arrow: null, jump }); return; }
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    // never wider than the screen (a tab bar edge to edge would widen the page and push the card off it); a part fixed
    // to the screen (the tab bar) stays within it, or the page would grow under it at every scroll
    const fixed = (() => { for (let p: HTMLElement | null = el; p; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') return true; return false; })();
    const x0 = Math.max(r.left - PAD, 0), x1 = Math.min(r.right + PAD, vw);
    const y0 = fixed ? Math.max(r.top - PAD, 0) : r.top - PAD, y1 = fixed ? Math.min(r.bottom + PAD, vh) : r.bottom + PAD;
    const spot = { x: x0 + scrollX, y: y0 + scrollY, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    const g0 = geoRef.current;
    if (!full && g0) { if (g0.spot && Math.abs(g0.spot.x - spot.x) + Math.abs(g0.spot.y - spot.y) + Math.abs(g0.spot.w - spot.w) + Math.abs(g0.spot.h - spot.h) < 1) return; setGeo({ ...g0, spot, jump: false }); return; }
    const a = aim.current || { top: scrollY, left: scrollX };
    // the part as it will stand on screen once the page has scrolled
    const v = { x: spot.x - a.left, y: spot.y - a.top, w: spot.w, h: spot.h };
    const H = cardH.current, W = c ? c.offsetWidth : CARD_W;
    const { top: it, bottom: ib } = inset();
    // a part the page could not bring into view: the card in sight all the same
    if (v.y >= vh || v.y + v.h <= 0) { setGeo({ spot, card: phone() ? 'bottom' : 'center', arrow: null, jump }); return; }
    if (phone()) {
      const cardTop = vh - H - EDGE;
      const above = v.y + v.h <= cardTop - 6;
      const at = clamp(v.x + v.w / 2 - EDGE, 24, vw - 2 * EDGE - 24);
      // a part the page cannot lift above the card (the tab bar, fixed at the bottom): the card at the top instead
      // (its arrow only when the part is right under it: from afar it would point at something else)
      if (!above && v.y - GAP - H >= it + EDGE) { setGeo({ spot, card: 'top', top: it + EDGE, arrow: v.y - (it + EDGE + H) <= 48 ? { side: 'bottom', at } : null, jump }); return; }
      setGeo({ spot, card: 'bottom', arrow: above ? { side: 'top', at } : null, jump });
      return;
    }
    const cx = clamp(v.x + v.w / 2 - W / 2, EDGE, vw - W - EDGE), cy = clamp(v.y + v.h / 2 - H / 2, it + EDGE, vh - ib - H - EDGE);
    const opts: [boolean, { x: number; y: number }, Side, number][] = [
      [v.y + v.h + GAP + H <= vh - ib - EDGE, { x: cx, y: v.y + v.h + GAP }, 'top', v.x + v.w / 2 - cx],
      [v.y - GAP - H >= it + EDGE, { x: cx, y: v.y - GAP - H }, 'bottom', v.x + v.w / 2 - cx],
      [v.x + v.w + GAP + W <= vw - EDGE, { x: v.x + v.w + GAP, y: cy }, 'left', v.y + v.h / 2 - cy],
      [v.x - GAP - W >= EDGE, { x: v.x - GAP - W, y: cy }, 'right', v.y + v.h / 2 - cy]
    ];
    const hit = opts.find((o) => o[0]);
    if (!hit) { setGeo({ spot, card: { x: vw - W - 24 + a.left, y: vh - ib - H - 24 + a.top }, arrow: null, jump }); return; }
    const len = hit[2] === 'top' || hit[2] === 'bottom' ? W : H;
    setGeo({ spot, card: { x: hit[1].x + a.left, y: hit[1].y + a.top }, arrow: { side: hit[2], at: clamp(hit[3], 22, len - 22) }, jump });
  };

  // a new step: its words render, then the card is measured and placed before the screen paints
  useLayoutEffect(() => { place(true, cur?.jump); }, [cur]);
  useEffect(() => { if (cur) nextBtn.current?.focus({ preventScroll: true }); }, [cur?.i]);

  // the window resized, the page scrolled (a part in a sticky bar), the part changed size (its data arrived)
  useEffect(() => {
    if (!cur) return;
    let raf = 0;
    // a resize places everything again for the page as it is; the part's own size, on the page as it is being scrolled to
    const later = (how: 'resize' | 'size' | 'scroll') => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (how === 'resize') aim.current = null; place(how !== 'scroll'); }); };
    const onResize = () => later('resize'), onScroll = () => later('scroll');
    addEventListener('resize', onResize);
    addEventListener('scroll', onScroll, { passive: true });
    // the page settled where it was scrolled: from now on the card is placed for the page as it is
    const settle = window.setTimeout(() => { aim.current = null; }, 900);
    const ro = cur.el && typeof ResizeObserver === 'function' ? new ResizeObserver(() => later('size')) : null;
    if (cur.el) ro?.observe(cur.el);
    return () => { cancelAnimationFrame(raf); clearTimeout(settle); removeEventListener('resize', onResize); removeEventListener('scroll', onScroll); ro?.disconnect(); };
  }, [cur]);

  const next = () => { if (!cur) return; if (cur.i >= listRef.current.length - 1) finish('done'); else void show(cur.i + 1, 1); };
  const back = () => { if (cur && cur.i > 0) void show(cur.i - 1, -1); };

  // the tour's keys come first (a capture listener on window runs before the app's): the app's shortcuts (g, /, ⌘K, n,
  // p) wait, Tab stays in the card, Enter and Space press the card's buttons
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish('pause'); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); if (e.key === 'ArrowRight') next(); else back(); return; }
      if (e.key === 'Tab' && card.current) {
        const f = [...card.current.querySelectorAll<HTMLElement>('button:not([disabled])')];
        if (!f.length) return;
        const at = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); e.stopImmediatePropagation();
        f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        return;
      }
      // any other key goes no further: its default stays (Enter and Space on a card button press it)
      e.stopImmediatePropagation();
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  });

  const s = cur ? list[cur.i] : null;
  const group = s ? list.filter((x) => x.place === s.place) : [];
  // the count is the page's (settled before its first card, so it holds); the bar under it is the whole visit's, and
  // only ever moves forward when a page further on has less to show
  const k = s ? group.indexOf(s) + 1 : 0;
  const done = cur ? (cur.i + 1) / Math.max(1, list.length) : 0;
  const last = !!cur && cur.i >= list.length - 1;
  const g = geo;
  const lit = !!(s && g && g.spot && !away);
  const cardStyle = !g || g.card === 'bottom' || g.card === 'center' ? undefined : g.card === 'top' ? { top: g.top } : { transform: 'translate3d(' + Math.round(g.card.x) + 'px,' + Math.round(g.card.y) + 'px,0)' };
  const where = !g ? 'center' : typeof g.card === 'string' ? g.card : 'beside';

  return createPortal(
    <div className="tour" data-skin={skin} style={room ? { height: ROOM } : undefined}>
      <div className="tour-dim" data-on={lit ? '0' : '1'} aria-hidden onClick={(e) => e.stopPropagation()} />
      <div className={'tour-spot' + (g?.jump ? ' tour-jump' : '')} data-on={lit ? '1' : '0'} aria-hidden
        style={g && g.spot ? { transform: 'translate3d(' + Math.round(g.spot.x) + 'px,' + Math.round(g.spot.y) + 'px,0)', width: Math.round(g.spot.w), height: Math.round(g.spot.h) } : undefined} />
      {s ? (
        <div ref={card} className={'tour-card' + (g?.jump ? ' tour-jump' : '')} data-where={where} data-on={away || !g ? '0' : '1'} style={cardStyle}
          role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" data-step={s.id} data-target={s.target || ''}>
          {/* one live region for the dialog's whole life (a new one at each step, already filled, is not read out) */}
          <p className="tour-live" aria-live="polite" aria-atomic="true">{nb(s.title) + '. ' + nb(s.body)}</p>
          {g?.arrow ? <i className="tour-arrow" data-side={g.arrow.side} style={g.arrow.side === 'top' || g.arrow.side === 'bottom' ? { left: g.arrow.at } : { top: g.arrow.at }} aria-hidden /> : null}
          <span className="tour-bar" aria-hidden><i style={{ transform: 'scaleX(' + done.toFixed(4) + ')' }} /></span>
          <div className="tour-in" key={s.id}>
            <div className="tour-head">
              <p className="tour-k">{s.label ? <span>{s.label}</span> : null}<span className="tour-n" aria-label={'Étape ' + k + ' sur ' + group.length + ' de cette page'}>{k} / {group.length}</span></p>
              <button type="button" className="tour-skip" onClick={() => finish(mode === 'page' ? 'done' : 'skip')}>{mode === 'page' ? 'Fermer' : 'Passer la visite'}</button>
            </div>
            <h2 id="tour-t" className="tour-t">{nb(s.title)}</h2>
            <p id="tour-b" className="tour-b">{nb(s.body)}</p>
          </div>
          <div className="tour-foot">
            {group.length > 1 && group.length <= 16 ? <span className="tour-dots" data-many={group.length > 9 ? '1' : undefined} aria-hidden>{group.map((x) => <i key={x.id} data-on={x.id === s.id ? '1' : '0'} />)}</span> : <span />}
            <span className="tour-acts">
              {cur!.i > 0 ? <button type="button" className="tour-btn ghost" onClick={back}><Icon name="chevL" size={16} />Retour</button> : null}
              <button ref={nextBtn} type="button" className="tour-btn" onClick={next}>{last ? 'Terminer' : 'Suivant'}{last ? null : <Icon name="arrowR" size={16} />}</button>
            </span>
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  );
}
