// The salon right now: open or closed, until when, the wait without appointment. Read from the salon's
// clock (never the phone's), refreshed every minute while the tab is visible, painted wherever the page
// asks for it ([data-status], [data-dot], [data-wait]…). Text is only rewritten when it changes, so the
// aria-live regions announce a real change, not a heartbeat.
import * as S from '../../site-kit/salon';
import { dur } from '../../lib/format';
import { $$, text } from './util';

export type LiveView = { ready: boolean; open: boolean; label: string; wait: string | null };
const subs = new Set<(v: LiveView) => void>();
let ready = false;

function view(): LiveView {
  if (!ready) return { ready: false, open: false, label: 'Du mardi au samedi, 9 h – 18 h 30', wait: null };
  const st = S.openStatus(), live = S.knownLive(), sal = S.getSalon();
  let wait: string | null = null;
  if (st.open && live?.open && sal?.booking.walkinWait && live.waitMin != null) wait = live.waitMin <= 0 ? 'Sans attente en ce moment' : '≈ ' + dur(live.waitMin) + ' d’attente';
  return { ready: true, open: st.open, label: st.label, wait };
}

function paint() {
  const v = view();
  $$('[data-status]').forEach((el) => text(el, v.label));
  $$('[data-dot]').forEach((el) => el.classList.toggle('off', !v.open));
  $$('[data-wait]').forEach((el) => text(el, v.wait || ''));
  $$('[data-wait-cell]').forEach((el) => { el.hidden = !v.wait; });
  $$('[data-wait-line]').forEach((el) => { el.hidden = !v.wait; text(el, v.wait ? 'Sans rendez-vous · ' + v.wait : ''); });
  subs.forEach((fn) => fn(v));
}
export function onLive(fn: (v: LiveView) => void) { subs.add(fn); fn(view()); }

let timer = 0;
function tick() {
  clearTimeout(timer);
  if (document.visibilityState !== 'visible') return;
  S.getLive().finally(() => {
    paint();
    // once a minute: the open/closed line flips within a minute of the salon's own clock
    timer = window.setTimeout(tick, 60000);
  });
}

export function startLive() {
  S.loadSalon().then(() => { ready = true; paint(); tick(); }, () => { /* the static hours stay on screen */ });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ready) tick(); else clearTimeout(timer); });
}
