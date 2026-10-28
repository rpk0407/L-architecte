// The guided tour (GUIDE-01a), one engine for the Comptoir and /moi: a dimmed page with a spotlight cut around the part
// a step points at (its data-guide mark), the explanation card beside it with an arrow, « Suivant » / « Retour », the
// progress and a dot per step of the page. The spotlight glides from part to part, the card follows and fades, a page
// change fades the two out and in; under prefers-reduced-motion everything is instant (tour.css).
// It goes to each step's page with the app's own router (`go`), waits for the part (up to 3 s after a page change),
// scrolls it into view, and never gets stuck: a part that is not there gets a centered card ('center', the Comptoir),
// or is left out ('skip', /moi: a client is only told about what he has). What to play and in what order: order.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import type { Played } from './order';
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
/** spotlight padding around the part, room between it and the card (the arrow), distance kept from the screen's edges */
const PAD = 8, GAP = 16, EDGE = 12;
/** below this width the card is a bottom card */
const PHONE = 640;
const CARD_W = 340;

type Box = { x: number; y: number; w: number; h: number };
type Side = 'top' | 'bottom' | 'left' | 'right';
/** the spotlight in page coordinates (it scrolls with the page); the card in page coordinates, or the phone's bottom card */
type Geo = { spot: Box | null; card: { x: number; y: number } | 'bottom' | 'center'; arrow: { side: Side; at: number } | null; jump: boolean };

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

/** The first part on screen marked with this data-guide (a hidden copy, a phone-only or desktop-only one, is passed over). */
export function findPart(target: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-guide="' + CSS.escape(target) + '"]')) {
    if (el.closest('.tour')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

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
  const setGeo = (g: Geo) => { if (JSON.stringify(g) === JSON.stringify(geoRef.current)) return; geoRef.current = g; setGeoState(g); };
  const [away, setAway] = useState(true);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const token = useRef(0);
  const urls = useRef(new Map<string, string | null>());
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

  /** The page's own order, top to bottom, for what is left of this place: the parts on screen first (a part whose data
   *  came late joins in its turn), then those it does not show, each with its centered card. */
  const reorder = (i: number): boolean => {
    const l = listRef.current, place = l[i].place;
    let end = i;
    while (end < l.length && l[end].place === place) end++;
    const group = l.slice(i, end);
    const at = new Map(group.map((s) => [s.id, s.target ? findPart(s.target) : null]));
    const byPage = group.filter((s) => at.get(s.id)).sort((a, b) => { const p = at.get(a.id)!.compareDocumentPosition(at.get(b.id)!); return p & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : p & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0; });
    const next = [...byPage, ...group.filter((s) => !at.get(s.id))];
    if (next.every((s, k) => s === group[k])) return false;
    const nl = [...l.slice(0, i), ...next, ...l.slice(end)];
    listRef.current = nl;
    setList(nl);
    return nl[i].id !== l[i].id;
  };

  /** Bring the part into view: centered in what the page and the card leave free, and only when it is not in view already. */
  const scrollTo = (el: HTMLElement) => {
    const smooth: ScrollBehavior = reduced() ? 'auto' : 'smooth';
    const r = el.getBoundingClientRect();
    // a row that scrolls sideways (the segments): the part to its middle
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) {
        const pr = p.getBoundingClientRect();
        p.scrollTo({ left: p.scrollLeft + (r.left - pr.left) - (pr.width - r.width) / 2, behavior: smooth });
        break;
      }
    }
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

  /** Show step i (dir: the way the visitor is going, for steps left out on the way). */
  const show = async (i: number, dir = 1) => {
    const my = ++token.current;
    const s = listRef.current[i];
    if (!s) return finish('done');
    let url: string | null = s.place;
    if (s.place.includes(':')) {
      if (!urls.current.has(s.place)) urls.current.set(s.place, resolve ? await resolve(s.place).catch(() => null) : null);
      if (my !== token.current) return;
      url = urls.current.get(s.place) ?? null;
    }
    if (url == null) return drop((x) => x.place === s.place, i, dir);
    const moving = !sameUrl(url, location.pathname + location.search);
    if (moving) {
      setAway(true);
      if (!reduced()) await sleep(200);
      if (my !== token.current) return;
      go(url);
    }
    let el: HTMLElement | null = null;
    if (s.target) {
      const until = Date.now() + (moving || !curRef.current ? WAIT_MS : SETTLE_MS);
      while (!(el = findPart(s.target)) && Date.now() < until) {
        await sleep(80);
        if (my !== token.current) return;
      }
      if (my !== token.current) return;
    }
    if (!el && s.target && missing === 'skip') return drop((x) => x.id === s.id, i, dir);
    // going forward, the rest of this place in the page's order (a step that moves ahead is shown in its turn)
    if (dir > 0 && reorder(i)) return show(i, dir);
    if (el) scrollTo(el); else aim.current = { top: scrollY, left: scrollX };
    const next = { i, el, jump: moving || !curRef.current };
    curRef.current = next;
    setCur(next);
    setAway(false);
    onStep?.(listRef.current[i], i);
  };

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    void show(clamp(start, 0, Math.max(0, steps.length - 1)));
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
    const spot = { x: r.left + scrollX - PAD, y: r.top + scrollY - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD };
    const g0 = geoRef.current;
    if (!full && g0) { if (g0.spot && Math.abs(g0.spot.x - spot.x) + Math.abs(g0.spot.y - spot.y) + Math.abs(g0.spot.w - spot.w) + Math.abs(g0.spot.h - spot.h) < 1) return; setGeo({ ...g0, spot, jump: false }); return; }
    const a = aim.current || { top: scrollY, left: scrollX };
    // the part as it will stand on screen once the page has scrolled
    const v = { x: spot.x - a.left, y: spot.y - a.top, w: spot.w, h: spot.h };
    const vw = document.documentElement.clientWidth, vh = innerHeight, H = cardH.current, W = c ? c.offsetWidth : CARD_W;
    const { top: it, bottom: ib } = inset();
    if (phone()) {
      const cardTop = vh - H - EDGE;
      const above = v.y + v.h <= cardTop - 6;
      setGeo({ spot, card: 'bottom', arrow: above ? { side: 'top', at: clamp(v.x + v.w / 2 - EDGE, 24, vw - 2 * EDGE - 24) } : null, jump });
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

  // the tour's keys come first: the app's shortcuts (g, /, ⌘K) wait, Tab stays in the card
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const inCard = !!card.current && card.current.contains(e.target as Node);
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
      if (!inCard) e.stopImmediatePropagation();
    };
    addEventListener('keydown', on, true);
    return () => removeEventListener('keydown', on, true);
  });

  const s = cur ? list[cur.i] : null;
  const group = s ? list.filter((x) => x.place === s.place) : [];
  const last = !!cur && cur.i >= list.length - 1;
  const g = geo;
  const lit = !!(s && g && g.spot && !away);
  const cardStyle = !g || g.card === 'bottom' || g.card === 'center' ? undefined : { transform: 'translate3d(' + Math.round(g.card.x) + 'px,' + Math.round(g.card.y) + 'px,0)' };
  const where = !g ? 'center' : g.card === 'bottom' ? 'bottom' : g.card === 'center' ? 'center' : 'beside';

  return createPortal(
    <div className="tour" data-skin={skin}>
      <div className="tour-dim" data-on={lit ? '0' : '1'} aria-hidden onClick={(e) => e.stopPropagation()} />
      <div className={'tour-spot' + (g?.jump ? ' tour-jump' : '')} data-on={lit ? '1' : '0'} aria-hidden
        style={g && g.spot ? { transform: 'translate3d(' + Math.round(g.spot.x) + 'px,' + Math.round(g.spot.y) + 'px,0)', width: Math.round(g.spot.w), height: Math.round(g.spot.h) } : undefined} />
      {s ? (
        <div ref={card} className={'tour-card' + (g?.jump ? ' tour-jump' : '')} data-where={where} data-on={away || !g ? '0' : '1'} style={cardStyle}
          role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" data-step={s.id} data-target={s.target || ''}>
          {g?.arrow ? <i className="tour-arrow" data-side={g.arrow.side} style={g.arrow.side === 'top' || g.arrow.side === 'bottom' ? { left: g.arrow.at } : { top: g.arrow.at }} aria-hidden /> : null}
          <div className="tour-in" key={s.id}>
            <div className="tour-head">
              <p className="tour-k">{s.label ? <span>{s.label}</span> : null}<span className="tour-n">{cur!.i + 1} / {list.length}</span></p>
              <button type="button" className="tour-skip" onClick={() => finish(mode === 'page' ? 'done' : 'skip')}>{mode === 'page' ? 'Fermer' : 'Passer la visite'}</button>
            </div>
            <h2 id="tour-t" className="tour-t" aria-live="polite">{nb(s.title)}</h2>
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
