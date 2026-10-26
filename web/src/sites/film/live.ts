// What changes while the page is open: open or closed, the walk-in wait, the next free chairs.
// One read per minute while the tab is visible, plus one right after a booking; sections subscribe.
import * as S from '../../site-kit/salon';
import { cast, firstSlot, type NextSlot } from './data';
import { $, $$, setText } from './util';

export type LiveState = { open: boolean; label: string; wait: number | null; next: NextSlot | null; byBarber: Record<string, NextSlot | null>; slotsReady: boolean; castReady: boolean };
export const live: LiveState = { open: false, label: '', wait: null, next: null, byBarber: {}, slotsReady: false, castReady: false };

const subs = new Set<() => void>();
export function onLive(fn: () => void) { subs.add(fn); fn(); }
function emit() { subs.forEach((fn) => { try { fn(); } catch { /* one section must not stop the others */ } }); }

function readStatus() {
  // without the salon's own hours and clock, nothing live is claimed: the static hours stay on screen
  if (!S.getSalon()) return;
  const st = S.openStatus();
  const lv = S.knownLive();
  // the salon's own answer wins over the hours (a closure, a late opening)
  const open = lv ? lv.open && st.open : st.open;
  live.open = open;
  live.label = open || !st.open ? st.label : 'Fermé pour le moment';
  live.wait = open && lv && lv.waitMin != null ? lv.waitMin : null;
}

// The hero and the dock need the first free chair, painted as soon as it is known. Each barber's own chair is read
// once on load, then refreshed only while the casting is within a screen and a half (it is the only reader).
let castNear = true;
async function readSlots() {
  const any = await firstSlot('any').catch(() => null);
  live.next = any;
  live.slotsReady = true;
  if (!castNear && live.castReady) return;
  emit();
  const list = cast().filter((b) => b.id);
  const each = await Promise.all(list.map((b) => firstSlot(b.id!).catch(() => null)));
  live.byBarber = Object.fromEntries(list.map((b, i) => [b.id!, each[i]]));
  live.castReady = true;
}

let last = 0, timer = 0;
async function refresh() {
  last = Date.now();
  clearTimeout(timer);
  // the two reads do not depend on each other
  await Promise.all([S.loadSalon().catch(() => null), S.getLive()]);
  readStatus();
  emit();
  await readSlots().catch(() => {});
  emit();
  if (document.visibilityState === 'visible') timer = window.setTimeout(refresh, 60000);
}

/** Paints every [data-live] chip: dot + "Ouvert · jusqu’à 18 h 30". */
function paintChips() {
  if (!live.label) return;
  for (const el of $$('[data-live]')) {
    el.classList.toggle('is-open', live.open);
    el.querySelector('i')?.classList.toggle('off', !live.open);
    setText(el.querySelector('span'), live.label);
  }
}

export function startLive() {
  onLive(paintChips);
  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { clearTimeout(timer); return; }
    if (Date.now() - last > 55000) refresh(); else timer = window.setTimeout(refresh, 60000 - (Date.now() - last));
  });
  // a booking takes a slot: the chips must move on (book() already dropped the cache)
  addEventListener('lx:booked', () => { readSlots().then(emit, () => {}); });
  const roll = $('#casting');
  if (!roll || typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver((es) => {
    const near = es[es.length - 1].isIntersecting;
    // coming back near the casting: catch up on what changed while it was far (reads are cached 20 s)
    if (near && !castNear) { castNear = true; readSlots().then(emit, () => {}); }
    castNear = near;
  }, { rootMargin: '150% 0px 150% 0px' }).observe(roll);
}
